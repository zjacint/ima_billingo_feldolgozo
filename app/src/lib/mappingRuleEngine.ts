/**
 * Kontír/áfa javaslati motor — ld. docs/tervezes.md 9. fejezet. Egy szabály
 * (`MappingRule`) több, EGYIDEJŰLEG (ÉS kapcsolatban) illesztendő feltételt
 * hordozhat (partner, termék név, megjegyzés, bizonylattípus, áfa
 * kulcs/kód) — ez teszi lehetővé az olyan összetett eseteket, mint
 * "előlegszámla ÉS fordított áfa -> áfa körön kívüli", vagy "a megjegyzés
 * tartalmazza a »garanciális visszatartás« szöveget -> negatív tétel".
 */

import { MappingRuleSource } from "@prisma/client";
import { prisma } from "./db";
import type { ImaGlaAccount, ImaGlaDetailRow, ImaSalesAnalyticsRow, ImaVatKey } from "./imaApiClient";
import type { AmountSign, InvoiceLine } from "./types";

export interface MappingSuggestion {
  /** `null`, ha csak az áfa kód jött egy `VatCodeMapping`-ből (ld. lent) — a kontír ilyenkor nyitott marad. */
  glaCode: string | null;
  /**
   * `null`, ha egy előlegre felülbírált tételnél (ld. `suggestMappingForLine`
   * "Előleg-felülbírálás" szakasza) nem volt normál javaslat, amiből az
   * áfa kód átvehető lett volna — ilyenkor csak a kontír biztos, a sor
   * `needs_review` marad, amíg a könyvelő ki nem tölti az áfa kódot.
   */
  vatCode: string | null;
  /** Külön ÁFA főkönyvi szám, megjelenítésre — ld. `MappingRule.vatGlaCode` doksztringje. */
  vatGlaCode: string | null;
  amountSign: AmountSign;
  source: MappingRuleSource | "vat_mapping" | "advance_reference";
  confidence: number | null;
  /** A ténylegesen illeszkedő szabály azonosítója — "milyen szabály futott le rá" (ld. docs/tervezes.md 10.). */
  ruleId: string;
  /** Emberi olvasható összefoglaló a szabály feltételeiről, pl. „partner: X · termék: „Y"". */
  ruleSummary: string;
  /** ld. `InvoiceLine.suggestedInexactMatchField` doksztringje (docs/tervezes.md 9.4.2). */
  inexactMatchField: "productNamePattern" | "vatPattern" | null;
  inexactMatchValue: string | null;
}

/** Egy szabály feltételeinek rövid, olvasható összefoglalója — a Kontír/áfa
 * szabályok oldal és a számla-részletező egyaránt ezt jeleníti meg. */
export function summarizeRuleConditions(rule: RuleLike & { partnerName?: string | null }): string {
  const parts: string[] = [];
  if (rule.partnerName) parts.push(`partner: ${rule.partnerName}`);
  else if (rule.partnerId) parts.push("partner: (ismeretlen)");
  if (rule.productNamePattern) parts.push(`termék: „${rule.productNamePattern}”`);
  if (rule.commentPattern) parts.push(`megjegyzés: „${rule.commentPattern}”`);
  if (rule.documentTypePattern) parts.push(`bizonylattípus: „${rule.documentTypePattern}”`);
  if (rule.vatPattern) parts.push(`áfa: „${rule.vatPattern}”`);
  return parts.join(" · ") || "—";
}

/** Egy számlasor illesztéshez szükséges kontextusa (ld. docs/tervezes.md 9.1). */
export interface LineMatchContext {
  partnerId: string | null;
  productName: string;
  /** A tétel saját megjegyzése (Billingo `DocumentItem.comment`). */
  lineComment: string | null;
  /** A számla fejléc-szintű megjegyzése (Billingo `Document.comment`). */
  headerComment: string | null;
  /** A Billingo `Document.type` értéke (pl. "invoice", "advance"). */
  documentType: string;
  /** A Billingo `Vat` mező eredeti értéke (pl. "27%", "F.AFA"). */
  vatPercentOrCode: string;
}

/**
 * Kis/nagybetű-független tartalmazás-illesztés, `|`-lal elválasztott
 * alternatívákkal (bármelyik egyezése elég). Üres/hiányzó minta esetén a
 * feltétel "nincs megadva"-nak számít — ezt a hívó (matchesAllConditions)
 * kezeli, ide már csak ténylegesen megadott minta jut.
 */
function matchesPattern(pattern: string, value: string | null): boolean {
  if (!value) return false;
  const alternatives = pattern
    .split("|")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (alternatives.length === 0) return false;
  const valueLower = value.toLowerCase();
  return alternatives.some((alt) => valueLower.includes(alt));
}

/** A `|`-lal elválasztott minta valamelyik alternatívája SZÓ SZERINT (nem csak részlegesen) egyezik-e az értékkel. */
function patternHasExactValue(pattern: string, value: string): boolean {
  const alternatives = pattern.split("|").map((p) => p.trim().toLowerCase());
  return alternatives.includes(value.trim().toLowerCase());
}

/**
 * Megállapítja, hogy a győztes szabály `productNamePattern`/`vatPattern`
 * feltétele csak RÉSZLEGES (substring) egyezéssel talált-e rá a kontextusra
 * — ld. `InvoiceLine.suggestedInexactMatchField` doksztringje. `null`, ha a
 * szabálynak nincs ilyen feltétele, vagy a pontos érték már szó szerint
 * benne van. Csak a `productNamePattern`/`vatPattern` mezőket nézi — ezek
 * az egyedüli olyan feltételek, amiket a rendszer (tanulás vagy összevonás
 * révén) automatikusan bővíthet; a `commentPattern`/`partnerId` kézi
 * felvitelűek, oda nincs "bővítési javaslat".
 */
function findInexactMatchField(
  rule: RuleLike,
  context: LineMatchContext
): { field: "productNamePattern" | "vatPattern"; value: string } | null {
  if (rule.productNamePattern && context.productName && !patternHasExactValue(rule.productNamePattern, context.productName)) {
    return { field: "productNamePattern", value: context.productName };
  }
  if (rule.vatPattern && context.vatPercentOrCode && !patternHasExactValue(rule.vatPattern, context.vatPercentOrCode)) {
    return { field: "vatPattern", value: context.vatPercentOrCode };
  }
  return null;
}

interface RuleLike {
  partnerId: string | null;
  productNamePattern: string | null;
  commentPattern: string | null;
  documentTypePattern: string | null;
  vatPattern: string | null;
}

/**
 * Megszámolja, hány feltétel van megadva a szabályon (specifikusság), és
 * hogy MIND illeszkedik-e a kontextusra. Ha egy feltétel nincs megadva,
 * nem vesz részt az illesztésben (nem számít se pro, se kontra).
 */
export function matchRuleAgainstContext(
  rule: RuleLike,
  context: LineMatchContext
): { matches: boolean; specificity: number } {
  let specificity = 0;

  if (rule.partnerId) {
    specificity += 1;
    if (rule.partnerId !== context.partnerId) return { matches: false, specificity };
  }
  if (rule.productNamePattern) {
    specificity += 1;
    if (!matchesPattern(rule.productNamePattern, context.productName)) return { matches: false, specificity };
  }
  if (rule.commentPattern) {
    specificity += 1;
    const matchesComment =
      matchesPattern(rule.commentPattern, context.lineComment) ||
      matchesPattern(rule.commentPattern, context.headerComment);
    if (!matchesComment) return { matches: false, specificity };
  }
  if (rule.documentTypePattern) {
    specificity += 1;
    if (!matchesPattern(rule.documentTypePattern, context.documentType)) return { matches: false, specificity };
  }
  if (rule.vatPattern) {
    specificity += 1;
    if (!matchesPattern(rule.vatPattern, context.vatPercentOrCode)) return { matches: false, specificity };
  }

  if (specificity === 0) return { matches: false, specificity: 0 };
  return { matches: true, specificity };
}

/**
 * A tétel/számla NORMÁL (előleg-felismerés előtti) javaslata: a
 * legspecifikusabb illeszkedő `MappingRule`, vagy annak hiányában a
 * `VatCodeMapping` áfa-kód-fallback — ld. korábban `suggestMappingForLine`
 * doksztringje, változatlan logika, csak kiemelve egy segédfüggvénybe,
 * hogy az előleg-felismerés (ld. lent) ezt hívja elő először, majd
 * szükség esetén felülbírálja a kontírt.
 */
async function computeStandardSuggestion(
  companyId: string,
  context: LineMatchContext
): Promise<MappingSuggestion | null> {
  const rules = await prisma.mappingRule.findMany({
    where: { companyId, active: true },
    include: { partner: true },
    orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
  });

  let best: { rule: (typeof rules)[number]; specificity: number } | null = null;
  for (const rule of rules) {
    const { matches, specificity } = matchRuleAgainstContext(rule, context);
    if (!matches) continue;
    if (
      !best ||
      specificity > best.specificity ||
      (specificity === best.specificity && rule.source === MappingRuleSource.manual && best.rule.source !== MappingRuleSource.manual)
    ) {
      best = { rule, specificity };
    }
  }

  if (!best) {
    // Nincs illeszkedő MappingRule — utolsó esélyként megnézzük, van-e
    // EGZAKT Billingo áfa érték -> IMA áfa kód megfeleltetés (ld.
    // docs/tervezes.md 8.3). Ez csak az áfa
    // kódot adja, a kontírt (glaCode) NEM — a sor emiatt továbbra is
    // `needs_review` marad, de a könyvelőnek eggyel kevesebb mezőt kell
    // kézzel kitöltenie.
    const vatMapping = await prisma.vatCodeMapping.findUnique({
      where: { companyId_billingoVatValue: { companyId, billingoVatValue: context.vatPercentOrCode } },
    });
    if (!vatMapping) return null;
    return {
      glaCode: null,
      vatCode: vatMapping.imaVatCode,
      vatGlaCode: null,
      amountSign: "original",
      source: "vat_mapping",
      confidence: null,
      ruleId: vatMapping.id,
      ruleSummary: `Áfa megfeleltetés: „${vatMapping.billingoVatValue}” → ${vatMapping.imaVatCode}`,
      inexactMatchField: null,
      inexactMatchValue: null,
    };
  }

  // "Utoljára használva" nyomon követése — ez adja a "gyorsított törlési
  // protokoll" alapját a soha nem illeszkedő (élő számlán sosem lefutó)
  // szabályok kereséséhez a Kontír/áfa szabályok oldalon. Szándékosan
  // awaitolt (nem "fire and forget"), mert a hívó
  // (Billingo-szinkron/újraszámolás) a teljes választ visszaadja, mielőtt a
  // Cloud Run példány leállhatna — egy el nem várt írás elveszhetne.
  await prisma.mappingRule.update({
    where: { id: best.rule.id },
    data: { lastMatchedAt: new Date() },
  });

  const inexactMatch = findInexactMatchField(best.rule, context);

  return {
    glaCode: best.rule.glaCode,
    vatCode: best.rule.vatCode,
    vatGlaCode: best.rule.vatGlaCode,
    amountSign: best.rule.amountSign,
    source: best.rule.source,
    confidence: best.rule.confidence,
    ruleId: best.rule.id,
    ruleSummary: summarizeRuleConditions({ ...best.rule, partnerName: best.rule.partner?.name ?? null }),
    inexactMatchField: inexactMatch?.field ?? null,
    inexactMatchValue: inexactMatch?.value ?? null,
  };
}

/**
 * Egy tételsor megjegyzésében szereplő, zárójelbe tett hivatkozást
 * keres: egy végszámla korábbi előleget levonó tétele a megjegyzésében
 * az előlegszámla számát hordozza ilyen formában: `"(2026-3645)"`. Az
 * első zárójelezett szakaszt adja vissza (trimmelve), vagy `null`-t, ha
 * nincs ilyen.
 */
export function parseAdvanceReferenceNumber(comment: string | null): string | null {
  if (!comment) return null;
  const match = comment.match(/\(([^()]+)\)/);
  return match ? match[1]!.trim() || null : null;
}

/**
 * Az "elsődleges előleg főkönyvi szám" — ld. docs/tervezes.md 9.5.
 * Elsődlegesen a
 * `Company.primaryAdvanceGlaCode` Beállítás; ha az üres, megpróbáljuk
 * levezetni a meglévő, "advance" bizonylattípusra illeszkedő (tanult vagy
 * kézi) szabályokból — ha azok MIND ugyanarra az egy kontírra mutatnak,
 * azt használjuk, egyébként `null`-t adunk vissza (nem találgatunk).
 */
export async function resolvePrimaryAdvanceGlaCode(companyId: string): Promise<string | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { primaryAdvanceGlaCode: true } });
  if (company?.primaryAdvanceGlaCode) return company.primaryAdvanceGlaCode;

  const rules = await prisma.mappingRule.findMany({
    where: { companyId, active: true, documentTypePattern: { contains: "advance", mode: "insensitive" } },
    select: { glaCode: true },
  });
  const distinctCodes = new Set(rules.map((r) => r.glaCode));
  return distinctCodes.size === 1 ? [...distinctCodes][0]! : null;
}

/**
 * Egy tételsorhoz javasolt kontírt/áfa kulcsot/előjelet ad. Két lépésben
 * dolgozik:
 *
 * 1. `computeStandardSuggestion` — a legspecifikusabb illeszkedő
 *    `MappingRule` (ld. doksztringje fent), vagy `VatCodeMapping`
 *    fallback.
 * 2. **Előleg-felülbírálás** (ld. docs/tervezes.md 9.5): HA (a) a
 *    tétel maga egy előlegszámlán van (`context.documentType === "advance"`
 *    — normál, végszámla ÉS stornó számlára egyaránt ugyanez a logika
 *    vonatkozik, nincs külön eset), VAGY (b) a tétel megjegyzése egy MÁR
 *    a mi adatbázisunkban szereplő, igazoltan előleg típusú számlára
 *    hivatkozik (`parseAdvanceReferenceNumber`) — a kontír FÜGGETLENÜL a
 *    normál szabály-illesztéstől mindig az "elsődleges előleg főkönyvi
 *    számra" (`resolvePrimaryAdvanceGlaCode`) megy, az áfa kód/kontír/
 *    előjel viszont a normál javaslatból származik (ha van). Ha a
 *    hivatkozott számláról nincs adatunk (pl. még nincs szinkronizálva),
 *    vagy nincs beállítva/levezethető elsődleges előleg kontír, NEM
 *    találgatunk — a normál javaslat változatlanul megy tovább.
 *
 * A `options.primaryAdvanceGlaCode` a hívó által ELŐRE kiszámított érték
 * (ld. `resolvePrimaryAdvanceGlaCode`) — kötegelt hívóknak (Billingo-
 * szinkron, javaslat-újraszámolás) kötelező előre, egyszer/cégenként
 * kiszámítani és átadni, hogy ne fusson le egy plusz DB-lekérdezés
 * SORONKÉNT; ha nincs átadva (`undefined`), a függvény maga számolja ki
 * (alacsonyabb hívásszámú helyeknek, pl. egyetlen sor felülvizsgálatánál).
 */
export async function suggestMappingForLine(
  companyId: string,
  context: LineMatchContext,
  options: { primaryAdvanceGlaCode?: string | null } = {}
): Promise<MappingSuggestion | null> {
  const standard = await computeStandardSuggestion(companyId, context);

  const isDirectAdvance = context.documentType === "advance";
  let isAdvanceReference = false;
  if (!isDirectAdvance) {
    const referencedNumber = parseAdvanceReferenceNumber(context.lineComment);
    if (referencedNumber) {
      const referencedInvoice = await prisma.invoice.findFirst({
        where: { companyId, billingoDocumentNumber: referencedNumber },
        select: { invoiceType: true },
      });
      isAdvanceReference = referencedInvoice?.invoiceType === "advance";
    }
  }
  if (!isDirectAdvance && !isAdvanceReference) return standard;

  const primaryAdvanceGlaCode =
    options.primaryAdvanceGlaCode !== undefined ? options.primaryAdvanceGlaCode : await resolvePrimaryAdvanceGlaCode(companyId);
  if (!primaryAdvanceGlaCode) return standard;

  return {
    glaCode: primaryAdvanceGlaCode,
    vatCode: standard?.vatCode ?? null,
    vatGlaCode: standard?.vatGlaCode ?? null,
    amountSign: standard?.amountSign ?? "original",
    source: "advance_reference",
    confidence: null,
    ruleId: standard?.ruleId ?? "advance-reference",
    ruleSummary: isDirectAdvance
      ? "Előlegszámla — elsődleges előleg főkönyvi szám"
      : "Előleg-hivatkozás a megjegyzésben — elsődleges előleg főkönyvi szám",
    inexactMatchField: standard?.inexactMatchField ?? null,
    inexactMatchValue: standard?.inexactMatchValue ?? null,
  };
}

/** Kérésenkénti csomagméret — ld. `runConsolidateBatch` doksztringje. */
const CONSOLIDATE_BATCH_SIZE = 20;

export interface ConsolidateCursor {
  /** Még feldolgozandó csoportok, egyenként a bennük lévő MappingRule id-k listájaként. */
  pendingGroups: string[][];
  mergedGroups: number;
  deletedRules: number;
}

async function mergeGroupBatch(groupsBatch: string[][]): Promise<{ mergedGroups: number; deletedRules: number }> {
  const allIds = groupsBatch.flat();
  const rows = await prisma.mappingRule.findMany({ where: { id: { in: allIds } } });
  const byId = new Map(rows.map((r) => [r.id, r]));

  let mergedGroups = 0;
  let deletedRules = 0;
  for (const ids of groupsBatch) {
    const group = ids.map((id) => byId.get(id)).filter((r): r is (typeof rows)[number] => r != null);
    // Ha a csoport időközben (pl. egy másik törlés miatt) 2 alá csökkent, kihagyjuk.
    if (group.length < 2) continue;

    const keeper = group.reduce((best, r) => ((r.confidence ?? 0) > (best.confidence ?? 0) ? r : best));
    const lastMatchedAt = group
      .map((r) => r.lastMatchedAt)
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const avgConfidence = group.reduce((sum, r) => sum + (r.confidence ?? 0), 0) / group.length;

    await prisma.mappingRule.update({
      where: { id: keeper.id },
      data: { partnerId: null, confidence: avgConfidence, lastMatchedAt: lastMatchedAt ?? null },
    });

    const toDelete = group.filter((r) => r.id !== keeper.id).map((r) => r.id);
    if (toDelete.length > 0) {
      const { count } = await prisma.mappingRule.deleteMany({ where: { id: { in: toDelete } } });
      deletedRules += count;
    }
    mergedGroups += 1;
  }

  return { mergedGroups, deletedRules };
}

/**
 * EGY csomagot (`CONSOLIDATE_BATCH_SIZE` szabály-csoport) dolgoz fel — HTTP
 * kérésenként ennyi munkát végez a `/api/companies/[companyId]/rules/
 * consolidate` route, hogy egyetlen kérés se futhasson bele a Cloud Run
 * időtúllépésébe/memóriakorlátjába nagyobb szabálylistánál — ld.
 * docs/tervezes.md 9.4. Első híváskor `cursor` legyen `null` (ekkor
 * lekérdezi és csoportosítja az ÖSSZES tanult, partneres szabályt); a
 * visszaadott `cursor`-t add tovább a KÖVETKEZŐ hívásnak, amíg `done: true`
 * nem érkezik.
 *
 * Kézzel indítható tisztító művelet a MÁR LÉTREJÖTT, partner-specifikus
 * tanult szabályokra — MINDEN olyan (>=2 db) `learned_invoiceanalytics`
 * szabály-csoportot összevon egyetlen partner nélküli szabállyá, amelyik a
 * partneren kívül MINDEN feltételben és hatásban (termékminta,
 * megjegyzésminta, bizonylattípus, áfa minta, kontír, áfa kód, előjel)
 * pontosan megegyezik — ld. docs/tervezes.md 9.4. Hasznos, ha ugyanaz a
 * tranzakció sok partnernél ismétlődik, és emiatt sok, egyébként azonos
 * szabály halmozódott fel csak eltérő partnerrel. A `learnFromInvoiceAnalytics`
 * MINDIG partner nélküli szabályt tanul (ld. ott), tehát ez a művelet csak
 * a régi adatbázis-állapot egyszeri tisztítására szolgál, új tanulás után
 * nincs rá szükség.
 */
export async function runConsolidateBatch(
  companyId: string,
  cursor: ConsolidateCursor | null
): Promise<{ cursor: ConsolidateCursor | null; mergedGroups: number; deletedRules: number; done: boolean }> {
  let pendingGroups: string[][];
  let mergedGroups = cursor?.mergedGroups ?? 0;
  let deletedRules = cursor?.deletedRules ?? 0;

  if (cursor) {
    pendingGroups = cursor.pendingGroups;
  } else {
    const rules = await prisma.mappingRule.findMany({
      where: { companyId, source: MappingRuleSource.learned_invoiceanalytics, partnerId: { not: null } },
      select: {
        id: true,
        productNamePattern: true,
        commentPattern: true,
        documentTypePattern: true,
        vatPattern: true,
        glaCode: true,
        vatCode: true,
        amountSign: true,
      },
    });
    const groups = new Map<string, string[]>();
    for (const rule of rules) {
      const key = [
        (rule.productNamePattern ?? "").toLowerCase(),
        (rule.commentPattern ?? "").toLowerCase(),
        (rule.documentTypePattern ?? "").toLowerCase(),
        (rule.vatPattern ?? "").toLowerCase(),
        rule.glaCode,
        rule.vatCode,
        rule.amountSign,
      ].join("::");
      const group = groups.get(key);
      if (group) group.push(rule.id);
      else groups.set(key, [rule.id]);
    }
    pendingGroups = [...groups.values()].filter((ids) => ids.length >= 2);
  }

  const batch = pendingGroups.slice(0, CONSOLIDATE_BATCH_SIZE);
  const rest = pendingGroups.slice(CONSOLIDATE_BATCH_SIZE);

  const batchResult = await mergeGroupBatch(batch);
  mergedGroups += batchResult.mergedGroups;
  deletedRules += batchResult.deletedRules;

  const done = rest.length === 0;
  return {
    cursor: done ? null : { pendingGroups: rest, mergedGroups, deletedRules },
    mergedGroups,
    deletedRules,
    done,
  };
}

/**
 * Kényelmi wrapper: in-process ciklusban hívja a `runConsolidateBatch`-et
 * addig, amíg `done: true` nem lesz — csak a CLI/Cloud Run Job számára. A
 * `/api/companies/[companyId]/rules/consolidate` route-nak (böngészős
 * "Duplikátumok összevonása" gomb) EZT NEM SZABAD hívnia — a
 * `runConsolidateBatch`-et hívja közvetlenül, csomagonként egy HTTP
 * kéréssel.
 */
export async function consolidateExistingRules(
  companyId: string
): Promise<{ mergedGroups: number; deletedRules: number }> {
  let cursor: ConsolidateCursor | null = null;
  let mergedGroups = 0;
  let deletedRules = 0;
  for (;;) {
    const step = await runConsolidateBatch(companyId, cursor);
    mergedGroups = step.mergedGroups;
    deletedRules = step.deletedRules;
    if (step.done) break;
    cursor = step.cursor;
  }
  return { mergedGroups, deletedRules };
}

interface ProductPairCounts {
  /** Az első előfordulásnál látott írásmód — ez kerül be a végleges mintába. */
  productNamePattern: string;
  documentTypePattern: string | null;
  counts: Map<string, number>;
  total: number;
}

interface ResolvedProduct {
  productNamePattern: string;
  documentTypePattern: string | null;
  glaCode: string;
  vatCode: string;
  /** Külön ÁFA főkönyvi szám (ld. `ImaSalesAnalyticsRow.vatGlaCode`) — csak megjelenítésre. */
  vatGlaCode: string | null;
  confidence: number;
  total: number;
}

interface LearnedBucket {
  glaCode: string;
  vatCode: string;
  vatGlaCode: string | null;
  documentTypePattern: string | null;
  /** Az ehhez a kontír/áfa páros(hoz tartozó, `|`-lal összefűzendő terméknevek — dedupelve, kis/nagybetűtől függetlenül. */
  productNames: string[];
  productNamesSeenLower: Set<string>;
  total: number;
  weightedConfidence: number;
}

/**
 * Az `/invoiceanalytics`-ból (`fetchImaSalesInvoiceAnalytics`) kapott
 * sorokból tanult `MappingRule` javaslatokat épít/frissít — ld.
 * docs/tervezes.md 9.4.
 *
 * A korábbi (partner+termék-alapú, majd 3+ partner egyhangú egyezése esetén
 * összevonó) tanulási modellt ez a függvény TELJESEN FELVÁLTJA — a szabály
 * elsődleges kulcsa immár a KIMENET (kontír + áfa kód), nem a bemenet
 * (termék/partner). Ez azért lehetséges, mert a tanult szabályok innentől
 * kezdve eleve partner-függetlenek (a partner-egyeztetés, adószám- vagy
 * névalapú párosítás gépezete emiatt feleslegessé vált, törölve).
 *
 * Két menetben dolgozik:
 * 1. Termékenként (pontosabban termék + bizonylattípus párosonként)
 *    megállapítja, melyik (kontír, áfa kód, áfa-kontír) hármas a
 *    DOMINÁNS (leggyakoribb) — ez védi ki azt, ha egy termék elvétve
 *    (pl. elgépelés/kivételes eset miatt) más kontírra futott ki egy-egy
 *    sornál.
 * 2. A termékeket a dominás hármasuk szerint "megfordítva" csoportosítja:
 *    a kontír (`glaCode`) az ELSŐDLEGES, az áfa kód (`vatCode`) a
 *    MÁSODLAGOS csoportosító dimenzió (a bizonylattípussal és az
 *    áfa-kontírral együtt alkotják a végleges szabály "kimenetét"), és
 *    MINDEN termék, ami erre a hármasra futott ki, egyetlen szabály
 *    `productNamePattern` mezőjébe kerül, `|`-lal elválasztva (a meglévő
 *    OR-illesztést használva, ld. `matchesPattern`). Így egy gyakori
 *    kontír/áfa párosra akár több tucat termék is EGYETLEN szabályt kap,
 *    ahelyett hogy minden termék+partner kombináció külön szabályt
 *    generálna — ez szünteti meg a korábbi ~500 szabályos, ~80%-ban
 *    duplikált végeredményt, kézi összevonás nélkül.
 *
 * A kontírkódot (`glaCode`) a `GLAID` mezőből tanuljuk — ez adja a
 * tényleges árbevétel-kontírt (a `Bal_Account_No` ezzel szemben mindig a
 * VEVŐI/követelés főkönyvi szám, sosem árbevétel — ld.
 * `ImaSalesAnalyticsRow.glaId` doksztringje).
 * Az `imaGlaAccounts` referencia-listával (`fetchImaGlaAccounts`) validáljuk,
 * ha elérhető; ha a `glaId` nem szerepel a cég valódi számlatükrében, a sor
 * kimarad (`skippedIncomplete`), NEM esünk vissza a vevői számra. A tétel
 * ÁFA-postázásának külön főkönyvi számát (`vatGlaCode`, a `GLA_CodeSales`
 * mezőből) is megtanuljuk/eltároljuk — ez csak megjelenítésre/ellenőrzésre
 * szolgál, az IMA beküldő végpont nem fogad el rá külön felülbírálást.
 *
 * **Az áfa kód (`vatCode`) forrása**: a `/invoiceanalytics` séma
 * (`docs/ima-api/openapi-clientapi.json`) NEM ad vissza külön áfa KÓD
 * mezőt soronként, csak `PL_VATPercent`-et (puszta százalék) és
 * `VatL_Name`-et (áfa kulcs NEVE — analóg a `/vatkeys` `VAT_Name`
 * mezőjével, ami elkülönül a `VAT_Code`-tól). Pusztán a százalékra
 * hagyatkozva a nulla százalékos, DE eltérő KÓDÚ áfa kategóriák (pl.
 * MAA-AM vs MAA-TM, mindkettő 0%) egyetlen `"0%"` szabályba olvadnának
 * össze, elveszítve a valódi megkülönböztető kódot. Ezért a `VatL_Name`-et
 * az `imaVatKeys` referencia-listával (`fetchImaVatKeys`, `VAT_Name` ->
 * `VAT_Code`) feloldjuk a TÉNYLEGES kódra, és csak akkor esünk vissza a
 * puszta százalékra, ha nincs egyezés a referencia-listában (vagy az
 * nincs átadva) — ugyanaz az elv, mint a `glaId` validálása
 * `imaGlaAccounts` ellen.
 *
 * A csoportosítás a bizonylattípust (`InvoiceDocType`) is figyelembe veszi,
 * hogy egy előlegszámla-sor automatikusan KÜLÖN tanult szabályt kapjon,
 * mint egy normál számlasor ugyanarra a kontír/áfa párra (ld. 9.4/1. pont).
 * ⚠️ Az `InvoiceDocType` szótára nem élőben ellenőrzött a Billingo
 * `Document.type` értékeivel szemben (ld. docs/tervezes.md 12. Nyitott
 * kérdések) — ha nem egyezik, a tanult `documentTypePattern` egyszerűen nem
 * fog illeszkedni, ilyenkor kézi szabály pótolja.
 *
 * Mivel a szabály kulcsa a kimenet (kontír+áfa+bizonylattípus+áfa-kontír),
 * egy már létező tanult szabály `productNamePattern`-jét a függvény MINDEN
 * futáskor TELJESEN ÚJRASZÁMOLJA (felülírja) a friss analitika-adatokból —
 * ez elvárt, mert a `fetchImaSalesInvoiceAnalytics` mindig a teljes
 * historikus adatsort adja vissza, nem csak az újonnan érkezett sorokat.
 *
 * A `commentPattern`/`vatPattern` alapú szabályokat NEM tanuljuk automatikusan
 * — ezek megbízható felismeréséhez nincs elég strukturált jel az analitika-
 * válaszban, kizárólag kézi szabályként vehetők fel.
 *
 * **`/gladetails` kereszt-ellenőrzés** (`reference.imaGlaDetails`, opcionális,
 * ld. docs/tervezes.md 13. fejezet): a `/gladetails` a TÉNYLEGES kontírkódot
 * (`GLA_Code`) adja vissza közvetlenül, nem egy `/glaaccounts`-szal
 * feloldandó azonosítót (mint az `/invoiceanalytics` `GLAID`-je) — ha egy
 * sorhoz `invoiceNo`+`description` alapján talál egyezést a gladetails-
 * adatban, AZT preferálja a `GLAID`-ből levezetett kód helyett (mindkettőt a
 * cég számlatükrével validálva, ha van referencia). Ha nincs egyezés vagy
 * nincs átadva `imaGlaDetails`, a viselkedés változatlan (visszaesik a
 * `GLAID`-alapú levezetésre).
 */
export interface PendingRuleMerge {
  manualRuleId: string;
  manualRuleSummary: string;
  glaCode: string;
  vatCode: string;
  /** Melyik feltétel-mezőhöz fűződne hozzá az új érték — termék-alapú vagy áfakulcs-alapú tanulásból jött-e a kollízió. */
  field: "productNamePattern" | "vatPattern";
  /** Értékek (terméknevek vagy Billingo áfa-értékek), amik a tanulás szerint ide tartoznának, de a kézi szabály mintájában még nincsenek benne. */
  valuesToAdd: string[];
}

/**
 * Kollíziót keres egy tanult eredmény (termék- VAGY áfakulcs-alapú) és a
 * cég aktív, kézzel felvitt (`manual`) szabályai között — könyvelői döntés
 * alapján (2026.08.14): egy találat akkor "azonos", ha (a) a kézi szabály
 * feltételei az adott kontextusra is illeszkednének, ÉS (b) a kimenete
 * (kontír + áfa kód) megegyezik azzal, amire a tanulás ebből a bemenetből
 * kijönne. A kontextusban NEM szereplő feltételtől (pl. partner, ha csak
 * áfakulcs-alapú a bemenet) függő kézi szabályok emiatt sosem ütköznek — a
 * tanult adat ezekhez nem ad kontextust. Csak akkor éri meg jelezni, ha a
 * tanult eredmény konfidenciája eléri a 80%-ot — az ez alatti, bizonytalan
 * mintázatot nem érdemes egy kézi döntéssel összevonni.
 */
function findCollidingManualRule(
  context: LineMatchContext,
  output: { glaCode: string; vatCode: string },
  confidence: number,
  manualRules: (RuleLike & { id: string; glaCode: string; vatCode: string; summary: string })[]
): { id: string; summary: string } | null {
  if (confidence < 0.8) return null;
  let best: { rule: { id: string; summary: string }; specificity: number } | null = null;
  for (const rule of manualRules) {
    if (rule.glaCode !== output.glaCode || rule.vatCode !== output.vatCode) continue;
    const { matches, specificity } = matchRuleAgainstContext(rule, context);
    if (!matches) continue;
    if (!best || specificity > best.specificity) {
      best = { rule: { id: rule.id, summary: rule.summary }, specificity };
    }
  }
  return best?.rule ?? null;
}

export async function learnFromInvoiceAnalytics(
  companyId: string,
  actingUserId: string,
  rows: ImaSalesAnalyticsRow[],
  reference: { imaGlaAccounts?: ImaGlaAccount[]; imaVatKeys?: ImaVatKey[]; imaGlaDetails?: ImaGlaDetailRow[] } = {}
): Promise<{ createdOrUpdated: number; skippedIncomplete: number; pendingMerges: PendingRuleMerge[] }> {
  const validGlaCodes = new Set((reference.imaGlaAccounts ?? []).map((a) => a.code.trim()));
  // `VatL_Name` (/invoiceanalytics) -> `VAT_Code` (/vatkeys) — ld. a
  // függvény doksztringjét fent.
  const vatCodeByName = new Map(
    (reference.imaVatKeys ?? []).map((v) => [v.name.trim().toLowerCase(), v.code])
  );
  // `/gladetails` kereszt-ellenőrzés indexe — ld. a függvény doksztringje.
  // Első előfordulás nyer, ha egy (számla, leírás) párra több gladetails
  // sor is illeszkedne (pl. ismétlődő tétel-leírás ugyanazon a számlán).
  const glaDetailsIndex = new Map<string, string>();
  for (const d of reference.imaGlaDetails ?? []) {
    const key = `${d.invoiceNo.trim().toLowerCase()}::${d.description.trim().toLowerCase()}`;
    if (!glaDetailsIndex.has(key)) glaDetailsIndex.set(key, d.glaCode.trim());
  }

  // 1. menet: termékenként (+ bizonylattípusonként) a domináns kontír/áfa hármas.
  // Ugyanebben a menetben, PÁRHUZAMOSAN, áfa kulcsonként (termékfüggetlenül)
  // is számoljuk, melyik kontír a domináns — ld. lent, "áfa kulcs -> kontír"
  // tanulás (2026.08.14, könyvelői döntés).
  const byProduct = new Map<string, ProductPairCounts>();
  const byVatCode = new Map<string, Map<string, number>>();
  const byVatCodeTotal = new Map<string, number>();
  let skippedIncomplete = 0;

  for (const row of rows) {
    const glaCodeFromId = row.glaId != null ? String(row.glaId) : null;
    const glaCodeFromIdValid =
      glaCodeFromId && (validGlaCodes.size === 0 || validGlaCodes.has(glaCodeFromId)) ? glaCodeFromId : null;
    // `/gladetails` preferálva, ha van egyezés (számla+leírás alapján) —
    // ld. a függvény doksztringje ("gladetails kereszt-ellenőrzés").
    const glaDetailsKey = row.invoiceNo ? `${row.invoiceNo.trim().toLowerCase()}::${row.description.trim().toLowerCase()}` : null;
    const glaCodeFromDetails = glaDetailsKey ? (glaDetailsIndex.get(glaDetailsKey) ?? null) : null;
    const glaCodeFromDetailsValid =
      glaCodeFromDetails && (validGlaCodes.size === 0 || validGlaCodes.has(glaCodeFromDetails)) ? glaCodeFromDetails : null;
    const glaCode = glaCodeFromDetailsValid ?? glaCodeFromIdValid;
    const vatCodeFromName = row.vatName ? vatCodeByName.get(row.vatName.trim().toLowerCase()) : undefined;
    const vatCode = vatCodeFromName ?? (row.vatPercent != null ? `${row.vatPercent}%` : row.vatName);
    if (!glaCode || !vatCode || !row.itemName) {
      skippedIncomplete += 1;
      continue;
    }

    const productNamePattern = row.itemName.trim();
    const documentTypePattern = row.invoiceDocType?.trim() || null;
    const productKey = `${productNamePattern.toLowerCase()}::${(documentTypePattern ?? "").toLowerCase()}`;
    const pairKey = `${glaCode}::${vatCode}::${row.vatGlaCode ?? ""}`;

    let entry = byProduct.get(productKey);
    if (!entry) {
      entry = { productNamePattern, documentTypePattern, counts: new Map(), total: 0 };
      byProduct.set(productKey, entry);
    }
    entry.counts.set(pairKey, (entry.counts.get(pairKey) ?? 0) + 1);
    entry.total += 1;

    const vatGlaPairKey = `${glaCode}::${row.vatGlaCode ?? ""}`;
    const vatCounts = byVatCode.get(vatCode) ?? new Map<string, number>();
    vatCounts.set(vatGlaPairKey, (vatCounts.get(vatGlaPairKey) ?? 0) + 1);
    byVatCode.set(vatCode, vatCounts);
    byVatCodeTotal.set(vatCode, (byVatCodeTotal.get(vatCode) ?? 0) + 1);
  }

  const resolvedProducts: ResolvedProduct[] = [];
  for (const entry of byProduct.values()) {
    let bestPair: string | null = null;
    let bestCount = 0;
    for (const [pairKey, count] of entry.counts) {
      if (count > bestCount) {
        bestPair = pairKey;
        bestCount = count;
      }
    }
    if (!bestPair) continue;
    const [glaCode, vatCode, vatGlaCode] = bestPair.split("::") as [string, string, string];
    resolvedProducts.push({
      productNamePattern: entry.productNamePattern,
      documentTypePattern: entry.documentTypePattern,
      glaCode,
      vatCode,
      vatGlaCode: vatGlaCode || null,
      confidence: bestCount / entry.total,
      total: entry.total,
    });
  }

  // Kollízió-vizsgálat kézi szabályokkal, MIELŐTT a termékek tanult
  // szabály-mintába kerülnének — ld. `findCollidingManualRule`
  // doksztringje. Az ütköző termékek NEM kapnak külön tanult szabályt (ez
  // csak duplikálná a kézi szabályt), hanem egy jóváhagyásra váró
  // összevonási javaslatba kerülnek — a tényleges összefűzést a hívó
  // (route) csak explicit könyvelői megerősítés után alkalmazza
  // (`applyPendingRuleMerges`).
  const manualRules = await prisma.mappingRule.findMany({
    where: { companyId, source: MappingRuleSource.manual, active: true },
    include: { partner: true },
  });
  const manualRulesForCollision = manualRules.map((r) => ({
    ...r,
    summary: summarizeRuleConditions({ ...r, partnerName: r.partner?.name ?? null }),
  }));

  const pendingMergesByRule = new Map<string, PendingRuleMerge>();
  function collectPendingMerge(
    collision: { id: string; summary: string },
    field: "productNamePattern" | "vatPattern",
    value: string,
    glaCode: string,
    vatCode: string
  ) {
    const key = `${collision.id}::${field}`;
    let merge = pendingMergesByRule.get(key);
    if (!merge) {
      merge = { manualRuleId: collision.id, manualRuleSummary: collision.summary, glaCode, vatCode, field, valuesToAdd: [] };
      pendingMergesByRule.set(key, merge);
    }
    const existingRule = manualRules.find((r) => r.id === collision.id);
    const alreadyInPattern = (existingRule?.[field] ?? "").split("|").map((s) => s.trim().toLowerCase());
    if (
      !alreadyInPattern.includes(value.toLowerCase()) &&
      !merge.valuesToAdd.some((v) => v.toLowerCase() === value.toLowerCase())
    ) {
      merge.valuesToAdd.push(value);
    }
  }

  const productsToLearn: ResolvedProduct[] = [];
  for (const p of resolvedProducts) {
    const context: LineMatchContext = {
      partnerId: null,
      productName: p.productNamePattern,
      lineComment: null,
      headerComment: null,
      documentType: p.documentTypePattern ?? "",
      vatPercentOrCode: "",
    };
    const collision = findCollidingManualRule(context, p, p.confidence, manualRulesForCollision);
    if (!collision) {
      productsToLearn.push(p);
      continue;
    }
    collectPendingMerge(collision, "productNamePattern", p.productNamePattern, p.glaCode, p.vatCode);
  }

  // Áfa kulcs -> kontír "kizárólagos" kapcsolat tanulása (2026.08.14,
  // könyvelői döntés): "az elsődleges egyezés a kontírszám... ha van olyan
  // áfa kulcs, ami csak egy kontírszámhoz kapcsolódik, akkor egy új
  // termék esetén, ami ezt az áfa kulcsot kapja, azonos szabályt kell
  // lefuttatni" — 100%-os egyezésnél mindenképp, a már bevezetett 80%-os
  // konfidencia-küszöbnél is javasoljuk. Az IMA áfa kódot a (Billingo érték
  // -> IMA kód) `VatCodeMapping` FORDÍTVA feloldva Billingo-oldali
  // `vatPattern`-né alakítjuk — ha nincs ilyen megfeleltetés beállítva, a
  // kódot nem tudjuk biztonságosan Billingo-mintává alakítani, ezért
  // kihagyjuk (nem tippelünk). A termék-alapú tanuláshoz hasonlóan a
  // szabály `productNamePattern` NÉLKÜL jön létre — pusztán az áfa kulcs a
  // feltétele, ezért csak akkor nyer a javaslati motorban, ha nincs
  // specifikusabb (pl. termék-alapú) találat.
  const vatCodeMappings = await prisma.vatCodeMapping.findMany({ where: { companyId } });
  const billingoValueByImaVatCode = new Map<string, string>();
  for (const m of vatCodeMappings) {
    if (!billingoValueByImaVatCode.has(m.imaVatCode)) billingoValueByImaVatCode.set(m.imaVatCode, m.billingoVatValue);
  }

  interface ResolvedVatGroup {
    vatCode: string;
    billingoVatValue: string;
    glaCode: string;
    vatGlaCode: string | null;
    confidence: number;
  }
  const resolvedVatGroups: ResolvedVatGroup[] = [];
  for (const [vatCode, counts] of byVatCode) {
    const billingoVatValue = billingoValueByImaVatCode.get(vatCode);
    if (!billingoVatValue) continue; // Nincs Billingo <-> IMA áfa megfeleltetés — nem tippelünk.
    let bestPair: string | null = null;
    let bestCount = 0;
    for (const [pairKey, count] of counts) {
      if (count > bestCount) {
        bestPair = pairKey;
        bestCount = count;
      }
    }
    if (!bestPair) continue;
    const [glaCode, vatGlaCode] = bestPair.split("::") as [string, string];
    const total = byVatCodeTotal.get(vatCode) ?? bestCount;
    resolvedVatGroups.push({ vatCode, billingoVatValue, glaCode, vatGlaCode: vatGlaCode || null, confidence: bestCount / total });
  }

  const vatGroupsToLearn: ResolvedVatGroup[] = [];
  for (const g of resolvedVatGroups) {
    const context: LineMatchContext = {
      partnerId: null,
      productName: "",
      lineComment: null,
      headerComment: null,
      documentType: "",
      vatPercentOrCode: g.billingoVatValue,
    };
    const collision = findCollidingManualRule(context, g, g.confidence, manualRulesForCollision);
    if (!collision) {
      vatGroupsToLearn.push(g);
      continue;
    }
    collectPendingMerge(collision, "vatPattern", g.billingoVatValue, g.glaCode, g.vatCode);
  }
  const pendingMerges = [...pendingMergesByRule.values()].filter((m) => m.valuesToAdd.length > 0);

  let vatRuleCreatedOrUpdated = 0;
  for (const g of vatGroupsToLearn) {
    if (g.confidence < 0.8) continue;
    const existing = await prisma.mappingRule.findFirst({
      where: {
        companyId,
        partnerId: null,
        productNamePattern: null,
        documentTypePattern: null,
        vatPattern: g.billingoVatValue,
        source: MappingRuleSource.learned_invoiceanalytics,
      },
    });
    if (existing) {
      await prisma.mappingRule.update({
        where: { id: existing.id },
        data: { glaCode: g.glaCode, vatCode: g.vatCode, vatGlaCode: g.vatGlaCode, confidence: g.confidence, updatedById: actingUserId },
      });
    } else {
      await prisma.mappingRule.create({
        data: {
          companyId,
          partnerId: null,
          vatPattern: g.billingoVatValue,
          glaCode: g.glaCode,
          vatCode: g.vatCode,
          vatGlaCode: g.vatGlaCode,
          source: MappingRuleSource.learned_invoiceanalytics,
          confidence: g.confidence,
          updatedById: actingUserId,
        },
      });
    }
    vatRuleCreatedOrUpdated += 1;
  }

  // 2. menet: megfordítva csoportosítva — kontír (elsődleges) + áfa kód
  // (másodlagos) + bizonylattípus/áfa-kontír a szabály "kimenete", a
  // hozzá tartozó összes termék a mintája. Az ütköző (kézi szabállyal
  // egyező) termékek itt szándékosan kimaradnak, ld. fent.
  const buckets = new Map<string, LearnedBucket>();
  for (const p of productsToLearn) {
    const bucketKey = `${p.glaCode}::${p.vatCode}::${p.vatGlaCode ?? ""}::${(p.documentTypePattern ?? "").toLowerCase()}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        glaCode: p.glaCode,
        vatCode: p.vatCode,
        vatGlaCode: p.vatGlaCode,
        documentTypePattern: p.documentTypePattern,
        productNames: [],
        productNamesSeenLower: new Set(),
        total: 0,
        weightedConfidence: 0,
      };
      buckets.set(bucketKey, bucket);
    }
    const nameLower = p.productNamePattern.toLowerCase();
    if (!bucket.productNamesSeenLower.has(nameLower)) {
      bucket.productNamesSeenLower.add(nameLower);
      bucket.productNames.push(p.productNamePattern);
    }
    bucket.total += p.total;
    bucket.weightedConfidence += p.confidence * p.total;
  }

  let createdOrUpdated = vatRuleCreatedOrUpdated;
  for (const bucket of buckets.values()) {
    const productNamePattern = bucket.productNames.join(" | ");
    const confidence = bucket.total > 0 ? bucket.weightedConfidence / bucket.total : 0;

    const existing = await prisma.mappingRule.findFirst({
      where: {
        companyId,
        partnerId: null,
        documentTypePattern: bucket.documentTypePattern,
        glaCode: bucket.glaCode,
        vatCode: bucket.vatCode,
        vatGlaCode: bucket.vatGlaCode,
        source: MappingRuleSource.learned_invoiceanalytics,
      },
    });

    if (existing) {
      // Kézzel felülírt (manual) szabály mellett is hagyjuk frissülni a
      // tanult sort — a javaslati motor (suggestMappingForLine) úgyis a
      // manual szabálynak ad elsőbbséget azonos specifikusságnál, tehát ez
      // nem írja felül a könyvelő döntését.
      await prisma.mappingRule.update({
        where: { id: existing.id },
        data: {
          productNamePattern,
          confidence,
          updatedById: actingUserId,
        },
      });
    } else {
      await prisma.mappingRule.create({
        data: {
          companyId,
          partnerId: null,
          productNamePattern,
          documentTypePattern: bucket.documentTypePattern,
          glaCode: bucket.glaCode,
          vatCode: bucket.vatCode,
          vatGlaCode: bucket.vatGlaCode,
          source: MappingRuleSource.learned_invoiceanalytics,
          confidence,
          updatedById: actingUserId,
        },
      });
    }
    createdOrUpdated += 1;
  }

  return { createdOrUpdated, skippedIncomplete, pendingMerges };
}

/**
 * A `learnFromInvoiceAnalytics` által jelzett összevonási javaslatok
 * TÉNYLEGES alkalmazása — csak explicit könyvelői megerősítés után hívandó
 * (ld. docs/tervezes.md 9.4.1, könyvelői döntés 2026.08.14: "a tanult
 * adatot fűzze hozzá a kézi szabályhoz... jelezze, hogy mi fog történni").
 * Minden kézi szabályhoz hozzáfűzi a hiányzó értéket (termék VAGY áfa-minta,
 * `field` szerint, `|`-lal elválasztva, kis/nagybetű-független
 * deduplikálással) — a szabály kontír/áfa/egyéb mezői VÁLTOZATLANOK
 * maradnak, hiszen a kollízió definíció szerint ezek már egyeztek.
 */
export async function applyPendingRuleMerges(
  companyId: string,
  actingUserId: string,
  merges: { manualRuleId: string; field: "productNamePattern" | "vatPattern"; valuesToAdd: string[] }[]
): Promise<{ mergedRules: number; addedValues: number }> {
  let mergedRules = 0;
  let addedValues = 0;
  for (const merge of merges) {
    if (merge.valuesToAdd.length === 0) continue;
    const rule = await prisma.mappingRule.findFirst({
      where: { id: merge.manualRuleId, companyId, source: MappingRuleSource.manual },
    });
    if (!rule) continue;

    const currentValue = rule[merge.field];
    const existingLower = (currentValue ?? "").split("|").map((s) => s.trim().toLowerCase());
    const toAdd = merge.valuesToAdd.filter((n) => !existingLower.includes(n.toLowerCase()));
    if (toAdd.length === 0) continue;

    const newPattern = [currentValue, ...toAdd].filter((s): s is string => Boolean(s && s.trim())).join(" | ");
    await prisma.mappingRule.update({
      where: { id: rule.id },
      data: { [merge.field]: newPattern, updatedById: actingUserId },
    });
    mergedRules += 1;
    addedValues += toAdd.length;
  }
  return { mergedRules, addedValues };
}

/**
 * A "kérdezzük meg, bővüljön-e a szabály" könyvelői kérés (2026.08.14)
 * kötegelt megvalósítása — ld. docs/tervezes.md 9.4.2. SZÁNDÉKOSAN nem fut
 * élő újra-illesztést a cég összes számláján/tételén (ez pontosan a
 * 2026.08.12-i 504-es hibaosztályt ismételné meg, ld. `recomputeSuggestions`
 * doksztringje) — kizárólag a szinkron/újraszámolás során MÁR kiszámolt és
 * eltárolt `suggestedInexactMatchField`/`suggestedInexactMatchValue`
 * jelzőket olvassa ki és csoportosítja szabályonként. Csak KÉZI szabályra
 * ajánl bővítést — a tanult szabályok termékmintáját a "Szabályok tanulása"
 * úgyis teljesen újraszámolja minden futtatáskor, egy ide írt kézi bővítés
 * ott azonnal elveszne.
 */
export async function findPendingRuleExpansions(companyId: string): Promise<PendingRuleMerge[]> {
  const [invoices, manualRules] = await Promise.all([
    prisma.invoice.findMany({ where: { companyId }, select: { lines: true } }),
    prisma.mappingRule.findMany({ where: { companyId, source: MappingRuleSource.manual }, include: { partner: true } }),
  ]);
  const manualById = new Map(manualRules.map((r) => [r.id, r]));

  const pendingByKey = new Map<string, PendingRuleMerge>();
  for (const invoice of invoices) {
    const lines = invoice.lines as unknown as InvoiceLine[];
    for (const line of lines) {
      if (!line.suggestedInexactMatchField || !line.suggestedInexactMatchValue || !line.suggestedRuleId) continue;
      const rule = manualById.get(line.suggestedRuleId);
      if (!rule) continue;

      const key = `${rule.id}::${line.suggestedInexactMatchField}`;
      let merge = pendingByKey.get(key);
      if (!merge) {
        merge = {
          manualRuleId: rule.id,
          manualRuleSummary: summarizeRuleConditions({ ...rule, partnerName: rule.partner?.name ?? null }),
          glaCode: rule.glaCode,
          vatCode: rule.vatCode,
          field: line.suggestedInexactMatchField,
          valuesToAdd: [],
        };
        pendingByKey.set(key, merge);
      }
      const value = line.suggestedInexactMatchValue;
      if (!merge.valuesToAdd.some((v) => v.toLowerCase() === value.toLowerCase())) {
        merge.valuesToAdd.push(value);
      }
    }
  }
  return [...pendingByKey.values()];
}

/**
 * Számla jóváhagyás és IMA beküldés — ld. docs/tervezes.md 6. és 8.
 * fejezet: synced/needs_review -> approved -> submitted/booked/failed.
 */

import { InvoiceStatus, MappingRuleSource } from "@prisma/client";
import { prisma } from "./db";
import { invoiceIsFullyClassified, isPartnerReadyForSubmission, type AmountSign, type InvoiceLine } from "./types";
import {
  fetchImaPartners,
  pushSalesInvoiceRawAdd,
  uploadSalesInvoiceImageToIma,
  type ImaCredentials,
  type ImaSalesInvoiceLine,
} from "./imaApiClient";
import { fetchBillingoDocumentPdf } from "./billingoApiClient";
import { resolvePrimaryAdvanceGlaCode, suggestMappingForLine, type LineMatchContext } from "./mappingRuleEngine";
import { isOssRelevantPartner, findMissingOssVatMappings } from "./ossThreshold";
import { findUniqueImaPartnerMatch } from "./partnerMatching";

const REJECTABLE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.synced,
  InvoiceStatus.needs_review,
  InvoiceStatus.approved,
  InvoiceStatus.failed,
];

export class ValidationError extends Error {}

function toIsoDate(d: Date | null): string {
  if (!d) throw new ValidationError("Hiányzó dátum a számlán — a beküldéshez szükséges.");
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` -> `YYYYMMDD` — a nyers `/api/invoices/sales/add` végpont ezt a formátumot várja. */
function toCompactDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

/**
 * A Billingo `Document.type` (nálunk `Invoice.invoiceType`) értékét az IMA
 * nyers beküldő végpont saját `invoice_type` enumjára képezi le
 * (`docs/ima-api/openapi-clientapi.json` `SalesInvoiceHeader.invoice_type`:
 * kizárólag `"invoice" | "creditentr" | "storno"` — ezen a végponton NINCS
 * külön "advance" érték). Élő teszttel megerősítve: egy előlegszámla nyers
 * `"advance"` értékkel beküldve HTTP 422-t adott ("The selected invoice
 * type is invalid.") — az IMA-oldali megkülönböztetést a kontír (ld.
 * `primaryAdvanceGlaCode`), nem a fejléc-típus hordozza.
 *
 * ⚠️ 2026.08.16-i javítás: a korábbi verzió `"storno"`/`"correction"`
 * értékekre figyelt, de a Billingo TÉNYLEGES `DocumentType` értékei
 * `"cancellation"` (sztornó) és `"modification"` (helyesbítő) — ezek
 * SOHA nem egyeztek, a leképezés élesben sosem talált (minden sztornó/
 * helyesbítő számla simán `"invoice"`-ként ment volna ki IMA-nak, rossz
 * kontírral/előjellel). A `receipt_cancellation` (nyugta sztornó) a
 * sztornóval egyező logikát kap.
 */
function mapInvoiceTypeToIma(billingoType: string): "invoice" | "creditentr" | "storno" {
  if (billingoType === "cancellation" || billingoType === "receipt_cancellation") return "storno";
  if (billingoType === "modification") return "creditentr";
  return "invoice";
}

/**
 * A könyvelő jóváhagyása: a UI-n véglegesített `lines` tömböt írja a
 * számlára (soronkénti `approvedGlaCode`/`approvedVatCode` kitöltve — a
 * jóváhagyás csak akkor engedhető meg, ha minden sor osztályozott, ld.
 * `invoiceIsFullyClassified`). Ha egy sor jóváhagyott kontír/áfa értéke
 * eltér a javasolttól, a motor egy partner+termék-specifikus `manual`
 * `MappingRule`-t hoz létre/frissít (ld. docs/tervezes.md 9.4/4. pont —
 * visszacsatolás). A megjegyzés-/áfa-alapú feltételeket (`commentPattern`,
 * `vatPattern`) és az `amountSign`-t ez a visszacsatolás SZÁNDÉKOSAN nem
 * generálja automatikusan — ezekhez a könyvelőnek explicit szabályt kell
 * felvennie a Kontír/áfa szabályok oldalon (ld. 9.4).
 *
 * Csak könyvelő hívhatja (ld. src/lib/access.ts requireKonyvelo) — az
 * override implicit MappingRule-írással jár, ami a testvérprojekt
 * mintájában is könyvelői jogosultsághoz kötött.
 */
export async function approveInvoice(
  actingUserId: string,
  invoiceId: string,
  lines: InvoiceLine[],
  /**
   * Kézzel felülírt ÁFA teljesítés dátum — KÜLÖN mező a Billingo eredeti
   * `fulfillmentDate`-től (azt NEM írja felül), hogy a Számla-részletező
   * mindkettőt (eredeti teljesítés dátuma ÉS a beküldött áfa dátuma) meg
   * tudja jeleníteni — ld. docs/tervezes.md 8.2.
   * `undefined` = nincs változtatás, `null` = felülbírálás törlése (vissza
   * az eredeti `fulfillmentDate`-re).
   */
  vatFulfillmentDateOverride?: Date | null
) {
  if (!invoiceIsFullyClassified(lines)) {
    throw new ValidationError("Minden tételsorhoz kötelező a kontír és az áfa kulcs jóváhagyás előtt.");
  }

  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

  for (const line of lines) {
    if (line.approvedGlaCode === line.suggestedGlaCode && line.approvedVatCode === line.suggestedVatCode) {
      continue;
    }
    // Partner+termék-specifikus szabályt keresünk/hozunk létre — NEM
    // pusztán partner-szintűt —, hogy egy számla több, eltérően kezelendő
    // tétele ne írja felül egymás visszacsatolt szabályát.
    const existing = await prisma.mappingRule.findFirst({
      where: {
        companyId: invoice.companyId,
        partnerId: invoice.partnerId,
        productNamePattern: line.productName,
        source: MappingRuleSource.manual,
      },
    });
    if (existing) {
      await prisma.mappingRule.update({
        where: { id: existing.id },
        data: { glaCode: line.approvedGlaCode!, vatCode: line.approvedVatCode!, updatedById: actingUserId },
      });
    } else {
      await prisma.mappingRule.create({
        data: {
          companyId: invoice.companyId,
          partnerId: invoice.partnerId,
          productNamePattern: line.productName,
          glaCode: line.approvedGlaCode!,
          vatCode: line.approvedVatCode!,
          source: MappingRuleSource.manual,
          updatedById: actingUserId,
        },
      });
    }
  }

  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      lines: lines as unknown as object,
      status: InvoiceStatus.approved,
      approvedById: actingUserId,
      approvedAt: new Date(),
      rejectedById: null,
      rejectedAt: null,
      rejectionReason: null,
      ...(vatFulfillmentDateOverride !== undefined ? { vatFulfillmentDateOverride } : {}),
    },
  });
}

const BULK_APPROVE_CANDIDATE_STATUSES: InvoiceStatus[] = [InvoiceStatus.synced, InvoiceStatus.needs_review];

/**
 * Több számla egyszerre történő jóváhagyása — a Számlák oldal tömeges
 * műveletéhez (ld. docs/tervezes.md 10. fejezet). `synced` ÉS
 * `needs_review` állapotú számla is jelölhető: a tömeges kontír/áfa
 * beállítás (`bulkSetInvoiceLineMapping`) egy korábban jóváhagyott
 * számlát is `needs_review`-ra állít vissza, tehát enélkül az ilyen
 * számlák örökre kimaradnának a tömeges jóváhagyásból. Minden sornál a
 * MÁR BEÁLLÍTOTT jóváhagyott érték (`approvedGlaCode` stb., pl. a tömeges
 * kontír/áfa eszközből) elsőbbséget élvez a javasolt értékkel szemben —
 * csak akkor esünk vissza a javasoltra, ha nincs kézzel beállított érték —,
 * hogy egy korábbi kézi korrekció sose vesszen el egy tömeges jóváhagyás
 * során. Jóváhagyás előtt számlánként ellenőrizzük, hogy minden, a
 * beküldéshez (exporthoz) szükséges mező elérhető és kitöltött-e (kontír,
 * áfa kulcs minden soron, partner + a partner adószáma/teljes számlázási
 * címe, nincs figyelmen kívül hagyott árfolyam-figyelmeztetés) — ami nem
 * felel meg, azt a `results` tömbben jelezzük vissza a konkrét okkal, nem
 * pedig egyszerűen kihagyjuk a kijelölhető számlák közül.
 */
export async function bulkApproveInvoices(actingUserId: string, invoiceIds: string[]) {
  const results: { invoiceId: string; ok: boolean; error?: string }[] = [];
  for (const invoiceId of invoiceIds) {
    try {
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { partner: true } });
      if (!BULK_APPROVE_CANDIDATE_STATUSES.includes(invoice.status)) {
        results.push({ invoiceId, ok: false, error: "Ebben az állapotban nem hagyható jóvá tömegesen." });
        continue;
      }
      const lines = invoice.lines as unknown as InvoiceLine[];
      const approvedLines: InvoiceLine[] = lines.map((line) => ({
        ...line,
        approvedGlaCode: line.approvedGlaCode ?? line.suggestedGlaCode,
        approvedVatCode: line.approvedVatCode ?? line.suggestedVatCode,
        approvedVatGlaCode: line.approvedVatGlaCode ?? line.suggestedVatGlaCode,
        approvedAmountSign: line.approvedAmountSign ?? line.suggestedAmountSign ?? "original",
      }));

      if (!invoiceIsFullyClassified(approvedLines)) {
        results.push({ invoiceId, ok: false, error: "Nincs minden tételsorhoz kontír és áfa kulcs megadva." });
        continue;
      }
      if (!invoice.partnerId || !invoice.partner) {
        results.push({ invoiceId, ok: false, error: "A számlához nincs partner rendelve." });
        continue;
      }
      if (!isPartnerReadyForSubmission(invoice.partner)) {
        results.push({ invoiceId, ok: false, error: "A partnerhez hiányzik az adószám vagy a teljes számlázási cím." });
        continue;
      }
      if (invoice.exchangeRateWarning) {
        results.push({ invoiceId, ok: false, error: `Árfolyam-figyelmeztetés: ${invoice.exchangeRateWarning}` });
        continue;
      }

      await approveInvoice(actingUserId, invoiceId, approvedLines);
      results.push({ invoiceId, ok: true });
    } catch (err) {
      results.push({ invoiceId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/**
 * Egy jóváhagyott számlát visszahelyez felülvizsgálandó állapotba — ld.
 * docs/tervezes.md 6. fejezet. Csak `approved` állapotú
 * számlára engedélyezett — `booked`/`submitted` számla már ténylegesen
 * elment IMA-nak, azt ez nem érinti (a helyi visszavonás nem vonja vissza
 * az IMA-oldali könyvelést). A tételsorok jóváhagyott (`approved*`) értékei
 * megmaradnak — csak a státusz és a jóváhagyó/időpont törlődik, hogy a
 * könyvelő a meglévő értékekből kiindulva javíthasson, ne kelljen elölről
 * kezdenie.
 */
export async function unapproveInvoice(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.status !== InvoiceStatus.approved) {
    throw new ValidationError("Csak jóváhagyott állapotú számla vonható vissza.");
  }
  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.needs_review,
      approvedById: null,
      approvedAt: null,
    },
  });
}

/** Több jóváhagyott számla egyszerre történő visszavonása — ld. `unapproveInvoice`. */
export async function bulkUnapproveInvoices(invoiceIds: string[]) {
  const results: { invoiceId: string; ok: boolean; error?: string }[] = [];
  for (const invoiceId of invoiceIds) {
    try {
      await unapproveInvoice(invoiceId);
      results.push({ invoiceId, ok: true });
    } catch (err) {
      results.push({ invoiceId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

const BULK_MAPPING_EDITABLE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.synced,
  InvoiceStatus.needs_review,
  InvoiceStatus.approved,
  InvoiceStatus.failed,
];

export interface BulkLineMappingInput {
  glaCode?: string;
  vatCode?: string;
  vatGlaCode?: string | null;
  amountSign?: AmountSign;
}

/**
 * Több számla összes tételsorára EGYSZERRE alkalmazza ugyanazt a
 * kontír/áfa/előjel értéket — a Számlák oldal tömeges javítási eszköze
 * (ld. docs/tervezes.md 10. fejezet). MINDEN mező opcionális — csak a
 * ténylegesen megadott mezők módosulnak, a többi
 * tételsor-érték érintetlen marad (ugyanaz az elv, mint a Kontír/áfa
 * szabályok oldal csoportos módosítása, `BulkEditModal`). Egy "szabály
 * alkalmazása" a UI szintjén ennek a függvénynek a hívása a kiválasztott
 * `MappingRule` kimeneti mezőivel (glaCode/vatCode/vatGlaCode/amountSign)
 * — nincs külön backend útvonal a kettőre, a kliens tölti ki a mezőket a
 * választott szabályból.
 *
 * Csak MÉG BE NEM KÜLDÖTT (`synced`/`needs_review`/`approved`/`failed`)
 * számlákon engedélyezett — `booked`/`submitted`/`rejected` számlát nem
 * módosít (a `booked` már ténylegesen elment IMA-nak, azt a helyi
 * módosítás nem vonná vissza). Ha egy MÁR JÓVÁHAGYOTT számlát érint a
 * módosítás, a számla visszakerül `needs_review` állapotba (a jóváhagyó/
 * időpont törlődik) — a megváltozott megfeleltetést friss, explicit
 * jóváhagyásnak kell megerősítenie, nem maradhat "jóváhagyva" jelöléssel
 * egy módosítás után, amit senki nem nézett át.
 */
export async function bulkSetInvoiceLineMapping(invoiceIds: string[], data: BulkLineMappingInput) {
  const results: { invoiceId: string; ok: boolean; error?: string }[] = [];
  for (const invoiceId of invoiceIds) {
    try {
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (!BULK_MAPPING_EDITABLE_STATUSES.includes(invoice.status)) {
        results.push({
          invoiceId,
          ok: false,
          error: "Ebben az állapotban (pl. már beküldve/könyvelve/elutasítva) nem módosítható.",
        });
        continue;
      }
      const lines = invoice.lines as unknown as InvoiceLine[];
      const newLines: InvoiceLine[] = lines.map((line) => ({
        ...line,
        approvedGlaCode: data.glaCode ?? line.approvedGlaCode,
        approvedVatCode: data.vatCode ?? line.approvedVatCode,
        approvedVatGlaCode: data.vatGlaCode !== undefined ? data.vatGlaCode : line.approvedVatGlaCode,
        approvedAmountSign: data.amountSign ?? line.approvedAmountSign ?? "original",
      }));
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          lines: newLines as unknown as object,
          ...(invoice.status === InvoiceStatus.approved
            ? { status: InvoiceStatus.needs_review, approvedById: null, approvedAt: null }
            : {}),
        },
      });
      results.push({ invoiceId, ok: true });
    } catch (err) {
      results.push({ invoiceId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/**
 * Több jóváhagyott (vagy korábban hibázott) számla egyszerre történő
 * beküldése IMA-nak — ld. docs/tervezes.md 10. fejezet, tömeges export.
 * Számlánként külön hívás (nem kötegelve az IMA API felé), hogy egy hibás
 * számla ne akassza meg a többit — ugyanaz az elv, mint a szállítói
 * oldalon (12.4 fejezet).
 */
export async function bulkSubmitInvoicesToIma(actingUserId: string, invoiceIds: string[]) {
  const results: { invoiceId: string; ok: boolean; error?: string }[] = [];
  for (const invoiceId of invoiceIds) {
    try {
      const updated = await submitInvoiceToIma(actingUserId, invoiceId);
      results.push({ invoiceId, ok: updated.status === InvoiceStatus.booked, error: updated.imaPushError ?? undefined });
    } catch (err) {
      results.push({ invoiceId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/**
 * A könyvelő explicit kizár egy számlát a beküldésből (pl. téves adat,
 * duplikátum, nem könyvelendő tétel) — `booked` státuszú számla nem
 * utasítható el (az már ténylegesen bekönyvelődött IMA-ban), ld.
 * docs/tervezes.md 6. fejezet.
 */
export async function rejectInvoice(actingUserId: string, invoiceId: string, reason: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (!REJECTABLE_STATUSES.includes(invoice.status)) {
    throw new ValidationError("Ez a számla állapotában (pl. már könyvelve) nem utasítható el.");
  }
  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.rejected,
      rejectedById: actingUserId,
      rejectedAt: new Date(),
      rejectionReason: reason,
    },
  });
}

/** Egy korábban elutasított számlát visszahelyez felülvizsgálandó állapotba. */
export async function unrejectInvoice(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.status !== InvoiceStatus.rejected) {
    throw new ValidationError("Ez a számla nincs elutasítva.");
  }
  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: InvoiceStatus.needs_review,
      rejectedById: null,
      rejectedAt: null,
      rejectionReason: null,
    },
  });
}

const RECOMPUTE_CANDIDATE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.synced,
  InvoiceStatus.needs_review,
  InvoiceStatus.failed,
];

/** Kérésenkénti csomagméret — ld. `runRecomputeSuggestionsBatch` doksztringje. */
const RECOMPUTE_BATCH_SIZE = 20;

export interface RecomputeSuggestionsCursor {
  offset: number;
  checked: number;
}

/**
 * EGY csomagot (`RECOMPUTE_BATCH_SIZE` számla) dolgoz fel — HTTP kérésenként
 * ennyi munkát végez a `/api/companies/[companyId]/recompute-suggestions`
 * route, hogy egyetlen kérés se futhasson bele a Cloud Run
 * időtúllépésébe (504) — ld. docs/tervezes.md 9.4. Első
 * híváskor `cursor` legyen `null`; a visszaadott `cursor`-t add tovább a
 * KÖVETKEZŐ hívásnak, amíg `done: true` nem érkezik. A jelöltek halmaza
 * (synced/needs_review/failed) a csomagok között NEM változik meg
 * (egy számla ezen a három státuszon belül vált, ki nem esik közülük),
 * ezért az offset/skip lapozás biztonságos — nem marad ki és nem
 * duplikálódik számla a csomagok között.
 */
export async function runRecomputeSuggestionsBatch(
  companyId: string,
  cursor: RecomputeSuggestionsCursor | null
): Promise<{ cursor: RecomputeSuggestionsCursor | null; checked: number; done: boolean }> {
  const offset = cursor?.offset ?? 0;
  let checked = cursor?.checked ?? 0;

  const invoices = await prisma.invoice.findMany({
    where: { companyId, status: { in: RECOMPUTE_CANDIDATE_STATUSES } },
    include: { partner: true },
    orderBy: { id: "asc" },
    skip: offset,
    take: RECOMPUTE_BATCH_SIZE,
  });

  // Csomagonként EGYSZER számoljuk ki (nem soronként) — ld.
  // mappingRuleEngine.ts `suggestMappingForLine` doksztringje.
  const primaryAdvanceGlaCode = await resolvePrimaryAdvanceGlaCode(companyId);

  for (const invoice of invoices) {
    const lines = invoice.lines as unknown as InvoiceLine[];
    const newLines: InvoiceLine[] = [];
    for (const line of lines) {
      const context: LineMatchContext = {
        partnerId: invoice.partnerId,
        productName: line.productName,
        lineComment: line.comment,
        headerComment: invoice.comment,
        documentType: invoice.invoiceType,
        vatPercentOrCode: line.vatPercentOrCode,
      };
      const suggestion = await suggestMappingForLine(companyId, context, { primaryAdvanceGlaCode });
      newLines.push({
        ...line,
        suggestedGlaCode: suggestion?.glaCode ?? null,
        suggestedVatCode: suggestion?.vatCode ?? null,
        suggestedVatGlaCode: suggestion?.vatGlaCode ?? null,
        suggestedAmountSign: suggestion?.amountSign ?? null,
        suggestedRuleSource: suggestion?.source ?? null,
        suggestedRuleId: suggestion?.ruleId ?? null,
        suggestedRuleSummary: suggestion?.ruleSummary ?? null,
        suggestedInexactMatchField: suggestion?.inexactMatchField ?? null,
        suggestedInexactMatchValue: suggestion?.inexactMatchValue ?? null,
      });
    }

    const fullyClassified = newLines.length > 0 && newLines.every((l) => l.suggestedGlaCode && l.suggestedVatCode);
    const status =
      fullyClassified && isPartnerReadyForSubmission(invoice.partner) && !invoice.exchangeRateWarning
        ? InvoiceStatus.synced
        : InvoiceStatus.needs_review;

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { lines: newLines as unknown as object, status },
    });
    checked += 1;
  }

  const done = invoices.length < RECOMPUTE_BATCH_SIZE;
  return {
    cursor: done ? null : { offset: offset + invoices.length, checked },
    checked,
    done,
  };
}

/**
 * Kényelmi wrapper: in-process ciklusban hívja a `runRecomputeSuggestionsBatch`-et
 * addig, amíg `done: true` nem lesz — csak a CLI/Cloud Run Job számára (ahol
 * nincs HTTP kérés-időkorlát). A `/api/companies/[companyId]/recompute-suggestions`
 * route-nak (böngészős "Javaslatok újraszámolása" gomb) EZT NEM SZABAD
 * hívnia — a `runRecomputeSuggestionsBatch`-et hívja közvetlenül,
 * csomagonként egy HTTP kéréssel.
 */
export async function recomputeSuggestionsForCompany(companyId: string) {
  let cursor: RecomputeSuggestionsCursor | null = null;
  let checked = 0;
  for (;;) {
    const step = await runRecomputeSuggestionsBatch(companyId, cursor);
    checked = step.checked;
    if (step.done) break;
    cursor = step.cursor;
  }

  return { checked, updated: checked };
}

/**
 * A Billingo PDF letöltése és IMA-hoz csatolása egy már beküldött (ismert
 * `imaSalesheaderId`-jű) számlához — BEST EFFORT: sosem dob, a hívó dönti
 * el, mit kezd a visszaadott hibaüzenettel. Külön függvény, hogy mind a
 * beküldés utáni automatikus próbálkozás (`submitInvoiceToIma`), mind a
 * kézi újrapróbálás (`retryInvoiceImageUpload`, ha a PDF a beküldéskor még
 * nem volt kész, vagy a feltöltés akkor hibázott) ugyanazt hívja.
 */
async function attachInvoiceImage(
  billingoApiKey: string,
  billingoDocumentId: string,
  fileName: string,
  imaCredentials: ImaCredentials,
  imaSalesheaderId: number
): Promise<{ uploaded: boolean; error: string | null }> {
  try {
    const pdf = await fetchBillingoDocumentPdf(billingoApiKey, billingoDocumentId);
    if (!pdf) {
      return { uploaded: false, error: "A Billingo PDF még nem generálódott le — próbáld újra pár perc múlva." };
    }
    const result = await uploadSalesInvoiceImageToIma(imaCredentials, imaSalesheaderId, pdf.buffer, fileName, pdf.contentType);
    return { uploaded: result.ok, error: result.error };
  } catch (err) {
    return { uploaded: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Ha a beküldött számla partnerének még NEM volt ismert IMA azonosítója
 * (`imaPartnerCode`), a `partner: {...}` objektumos út az IMA-oldalon
 * automatikusan feloldja/létrehozza — ez a függvény ezt a friss/most
 * feloldott partnert próbálja visszakeresni (adószám, ennek hiányában
 * pontos névegyezés — ld. `findUniqueImaPartnerMatch`) és az azonosítóját
 * visszaírni a `Partner.imaPartnerCode` mezőbe, hogy a KÖVETKEZŐ számlája
 * már a megbízhatóbb `partner_id`-s utat használhassa (ld. docs/tervezes.md
 * 12.1 "Partnerek automatikus létrehozása IMA-ban", könyvelői döntés
 * 2026.08.16). BEST EFFORT — sosem dob, a hívó (submitInvoiceToIma) a
 * beküldés sikerét ettől függetlenül kezeli.
 */
async function tryLinkNewlyCreatedImaPartner(
  credentials: ImaCredentials,
  partner: { id: string; name: string; taxNumber: string | null }
): Promise<void> {
  try {
    const imaPartners = await fetchImaPartners(credentials, { type: "customer" });
    const matchId = findUniqueImaPartnerMatch(partner, imaPartners);
    if (matchId == null) return;
    await prisma.partner.update({ where: { id: partner.id }, data: { imaPartnerCode: String(matchId) } });
  } catch (err) {
    console.error(`IMA partner visszaírás sikertelen (partner ${partner.id}):`, err);
  }
}

/**
 * A jóváhagyott számlát beküldi az IMA nyers `/api/invoices/sales/add`
 * végpontjára (ld. docs/tervezes.md 8. fejezet — nem a
 * `/api/import/sales-invoice`-ot, mert az az IMA-oldali
 * `import_batch_id` szerverhibába ütközik, ld. imaApiClient.ts). Sikeres
 * beszúrásnál a számla
 * azonnal `booked` — az IMA válasza maga a megerősítés, nincs külön kézi
 * lépés (ugyanaz az elv, mint a szállítói oldalon). Hiba esetén `failed`,
 * a hibaszöveg eltárolva — a UI-n ismételten hívható. Sikeres beküldés
 * után best-effort megpróbálja csatolni a Billingo PDF-et is (ld.
 * `attachInvoiceImage`) — ennek sikertelensége NEM befolyásolja a számla
 * `booked` állapotát, csak az `imaImageUploaded`/`imaImageUploadError`
 * mezőkben látszik, és a Számla-részletezőn kézzel újrapróbálható.
 */
export async function submitInvoiceToIma(actingUserId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { partner: true, company: true },
  });

  if (invoice.status !== InvoiceStatus.approved && invoice.status !== InvoiceStatus.failed) {
    throw new ValidationError("Csak jóváhagyott (vagy korábban hibázott) számla küldhető be.");
  }
  if (!invoice.partner) {
    throw new ValidationError("A számlához nincs partner rendelve.");
  }
  const { company } = invoice;
  if (!company.imaApiKey || !company.imaApiUser || !company.imaApiCompany) {
    throw new ValidationError("A céghez nincs teljesen kitöltve az IMA API kapcsolat (Beállítások oldal).");
  }

  const lines = invoice.lines as unknown as InvoiceLine[];
  if (!invoiceIsFullyClassified(lines)) {
    throw new ValidationError("A számla tételsorai nincsenek teljesen osztályozva.");
  }

  // A nyers beküldő végpont `payment_method` mezője "leírás alapú
  // azonosítás" — csak egy, a cégnél ténylegesen létező IMA fizetési mód
  // leírása (`PaymentM_Desc`) fogadható el, a mi belső, normalizált kódunk
  // (pl. "transfer") HTTP 422-t ad ("Payment method not found for
  // id/desc"), ld. docs/tervezes.md 8.5. Ezért itt előre feloldjuk a
  // könyvelő által beállított megfeleltetésből, és ha nincs beállítva,
  // inkább itt hibázunk egyértelmű üzenettel, mint hogy IMA-nál bukjon.
  const paymentMethodMapping = await prisma.paymentMethodMapping.findUnique({
    where: {
      companyId_billingoPaymentMethod: { companyId: invoice.companyId, billingoPaymentMethod: invoice.paymentMethod },
    },
  });
  if (!paymentMethodMapping) {
    throw new ValidationError(
      `Nincs beállítva IMA fizetési mód megfeleltetés a(z) „${invoice.paymentMethod}” Billingo fizetési módhoz — állítsd be a Beállítások oldalon.`
    );
  }

  // OSS (uniós egyablakos rendszer) szigorú áfa-megfeleltetés — CSAK akkor
  // kötelező, ha a cég ténylegesen regisztrált OSS-re (`ossRegistered`,
  // könyvelői beállítás) ÉS a partner OSS-érintett (külföldi EU
  // magánszemély) — ld. ossThreshold.ts, docs/tervezes.md 13. fejezet,
  // könyvelői döntés (2026.08.16): "ha nem magyar áfával számolunk akkor
  // az egy szigorú megfeleltetés legyen az IMA-ban... amíg nincs
  // létrehozva megfelelő áfa kulcs". Csak validál — a jóváhagyáskor már
  // beállított `approvedVatCode`-ot nem írja felül, csak megköveteli, hogy
  // a ténylegesen használt Billingo áfa érték(ek)hez legyen ország-szintű
  // megfeleltetés rögzítve.
  if (company.ossRegistered && isOssRelevantPartner(invoice.partner)) {
    const missing = await findMissingOssVatMappings(
      invoice.companyId,
      invoice.partner.countryCode!,
      lines.map((l) => l.vatPercentOrCode)
    );
    if (missing.length > 0) {
      throw new ValidationError(
        `OSS-érintett külföldi magánszemély partner (${invoice.partner.countryCode}) — nincs beállítva szigorú áfa kulcs megfeleltetés ehhez: ${missing.join(", ")}. Állítsd be a Beállítások oldalon (OSS áfa megfeleltetés).`
      );
    }
  }

  // Az `amountSign: negative` (pl. garanciális visszatartás, ld.
  // docs/tervezes.md 9.2) sorok előjelet váltanak: a nettó egységár és a
  // tétel nettó/áfa/bruttó összege is negatívba fordul, hogy a beküldött
  // sorok belsőleg (mennyiség × egységár ≈ összeg) konzisztensek maradjanak.
  const submitLines: ImaSalesInvoiceLine[] = lines.map((line) => {
    const negative = line.approvedAmountSign === "negative";
    const sign = negative ? -1 : 1;
    return {
      productOrServiceName: line.productName,
      quantity: line.quantity,
      unitOfMeasure: line.unitOfMeasure,
      netUnitCost: line.netUnitCost * sign,
      netAmount: line.netAmount * sign,
      vatAmount: line.vatAmount * sign,
      grossAmount: line.grossAmount * sign,
      vatCode: line.approvedVatCode!,
      glaCode: line.approvedGlaCode,
    };
  });

  // A fejléc bruttó összesítőt a ténylegesen beküldött (előjel-korrigált)
  // sorokból számoljuk újra — NEM az `Invoice.grossAmount` (a Billingo
  // eredeti, korrekció nélküli) mezőjéből —, hogy a fejléc és a sorok
  // összege garantáltan egyezzen (ld. 12.4.1 tanulság: fejléc/sor eltérés
  // váratlan kerekítés-sort okozott a szállítói oldalon).
  const headerGrossAmount = submitLines.reduce((sum, l) => sum + l.grossAmount, 0);

  const docDateIso = toIsoDate(invoice.docDate);

  const result = await pushSalesInvoiceRawAdd(
    { apiKey: company.imaApiKey, user: company.imaApiUser, company: company.imaApiCompany },
    {
      // Az IMA duplikáció-védelme erre (+ postingDate) fut — a Billingo
      // dokumentum-azonosító stabil és cégen belül egyedi.
      invoiceExternalId: invoice.billingoDocumentId,
      invoiceType: mapInvoiceTypeToIma(invoice.invoiceType),
      docDate: toCompactDate(docDateIso),
      postingDate: toCompactDate(docDateIso),
      // A könyvelő kézi felülbírálása (vatFulfillmentDateOverride) elsőbbséget
      // élvez a Billingo eredeti teljesítés dátumával szemben — ld. approveInvoice.
      vatFulfillmentDate: toCompactDate(
        invoice.vatFulfillmentDateOverride
          ? toIsoDate(invoice.vatFulfillmentDateOverride)
          : invoice.fulfillmentDate
            ? toIsoDate(invoice.fulfillmentDate)
            : docDateIso
      ),
      dueDate: toCompactDate(invoice.dueDate ? toIsoDate(invoice.dueDate) : docDateIso),
      paymentMethod: paymentMethodMapping.imaPaymentMethodDesc,
      currencyCode: invoice.currencyCode,
      exchangeRate: invoice.exchangeRate != null ? Number(invoice.exchangeRate) : null,
      grossAmount: headerGrossAmount,
      partnerName: invoice.partner.name,
      vatRegNumber: invoice.partner.taxNumber,
      postalCode: invoice.partner.postalCode,
      city: invoice.partner.city,
      addrStreet: invoice.partner.addressStreet,
      countryCode: invoice.partner.countryCode,
      partnerId:
        invoice.partner.imaPartnerCode && /^\d+$/.test(invoice.partner.imaPartnerCode)
          ? Number(invoice.partner.imaPartnerCode)
          : null,
      lines: submitLines,
    }
  );

  if (result.success && !invoice.partner.imaPartnerCode) {
    await tryLinkNewlyCreatedImaPartner(
      { apiKey: company.imaApiKey, user: company.imaApiUser, company: company.imaApiCompany },
      { id: invoice.partner.id, name: invoice.partner.name, taxNumber: invoice.partner.taxNumber }
    );
  }

  let imageUploaded = false;
  let imageUploadError: string | null = null;
  if (result.success && result.imaInvoiceId != null && company.billingoApiKey) {
    const imageResult = await attachInvoiceImage(
      company.billingoApiKey,
      invoice.billingoDocumentId,
      `${invoice.billingoDocumentNumber ?? invoice.billingoDocumentId}.pdf`,
      { apiKey: company.imaApiKey, user: company.imaApiUser, company: company.imaApiCompany },
      result.imaInvoiceId
    );
    imageUploaded = imageResult.uploaded;
    imageUploadError = imageResult.error;
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: result.success
      ? {
          status: InvoiceStatus.booked,
          imaSalesheaderId: result.imaInvoiceId,
          imaPushError: null,
          imaImageUploaded: imageUploaded,
          imaImageUploadError: imageUploadError,
        }
      : {
          status: InvoiceStatus.failed,
          imaPushError: result.error,
        },
  });

  await prisma.auditLog.create({
    data: {
      companyId: invoice.companyId,
      actorId: actingUserId,
      action: "ima_push",
      entityType: "Invoice",
      entityId: invoice.id,
      before: { status: invoice.status },
      after: { status: updated.status, error: result.error },
    },
  });

  return updated;
}

/**
 * A számlakép (Billingo PDF) csatolásának kézi újrapróbálása egy már
 * beküldött (`booked`) számlához — arra az esetre, ha a beküldéskor a PDF
 * még nem volt kész, vagy a feltöltés hibázott (ld. `attachInvoiceImage`,
 * `submitInvoiceToIma`). Csak `booked` állapotú, ismert `imaSalesheaderId`-jű
 * számlára engedélyezett.
 */
export async function retryInvoiceImageUpload(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { company: true } });
  if (invoice.status !== InvoiceStatus.booked || invoice.imaSalesheaderId == null) {
    throw new ValidationError("Csak sikeresen beküldött (könyvelt) számla számlaképe tölthető fel újra.");
  }
  const { company } = invoice;
  if (!company.billingoApiKey || !company.imaApiKey || !company.imaApiUser || !company.imaApiCompany) {
    throw new ValidationError("A céghez nincs teljesen kitöltve a Billingo/IMA API kapcsolat.");
  }

  const imageResult = await attachInvoiceImage(
    company.billingoApiKey,
    invoice.billingoDocumentId,
    `${invoice.billingoDocumentNumber ?? invoice.billingoDocumentId}.pdf`,
    { apiKey: company.imaApiKey, user: company.imaApiUser, company: company.imaApiCompany },
    invoice.imaSalesheaderId
  );

  return prisma.invoice.update({
    where: { id: invoiceId },
    data: { imaImageUploaded: imageResult.uploaded, imaImageUploadError: imageResult.error },
  });
}

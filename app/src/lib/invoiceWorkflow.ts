/**
 * Számla jóváhagyás és IMA beküldés — ld. docs/tervezes.md 6. és 8.
 * fejezet: synced/needs_review -> approved -> submitted/booked/failed.
 */

import { InvoiceStatus, MappingRuleSource } from "@prisma/client";
import { prisma } from "./db";
import {
  invoiceIsFullyClassified,
  invoiceHasComplianceWarning,
  isPartnerReadyForSubmission,
  isPartnerPrivateIndividual,
  type AmountSign,
  type InvoiceLine,
} from "./types";
import { checkLineCompliance } from "./invoiceCompliance";
import { reconcileLineAmounts, reconcileLinesToHeaderTotal } from "./amountReconciliation";
import {
  fetchImaGlaDetails,
  fetchImaPartners,
  pushSalesInvoiceRawAdd,
  uploadSalesInvoiceImageToIma,
  type ImaCredentials,
  type ImaSalesInvoiceLine,
} from "./imaApiClient";
import { fetchBillingoDocumentPdf } from "./billingoApiClient";
import {
  resolveInheritedLineMapping,
  resolvePrimaryAdvanceGlaCode,
  suggestMappingForLine,
  type LineMatchContext,
  type MappingSuggestion,
} from "./mappingRuleEngine";
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
 * címe, nincs figyelmen kívül hagyott árfolyam- vagy megfelelőségi
 * figyelmeztetés, ld. `invoiceCompliance.ts`) — ami nem
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
      if (invoiceHasComplianceWarning(approvedLines)) {
        results.push({ invoiceId, ok: false, error: "Megfelelőségi figyelmeztetés van a számlán — egyenként ellenőrizendő." });
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
    include: { partner: true, company: true },
    orderBy: { id: "asc" },
    skip: offset,
    take: RECOMPUTE_BATCH_SIZE,
  });

  // Csomagonként EGYSZER számoljuk ki (nem soronként) — ld.
  // mappingRuleEngine.ts `suggestMappingForLine` doksztringje.
  const primaryAdvanceGlaCode = await resolvePrimaryAdvanceGlaCode(companyId);
  // ld. billingoSync.ts `buildReverseChargeLookup` doksztringje — ugyanaz
  // a (cégenkénti, egyszeri lekérdezésű) minta itt, a javaslatok
  // újraszámolásánál is.
  const vatMappings = await prisma.vatCodeMapping.findMany({ where: { companyId } });
  const reverseChargeLookup = new Map(vatMappings.map((m) => [m.billingoVatValue, m.isReverseCharge]));

  for (const invoice of invoices) {
    const lines = invoice.lines as unknown as InvoiceLine[];
    const newLines: InvoiceLine[] = [];
    for (const line of lines) {
      // Speciális, dokumentum-kapcsolatot figyelembe vevő felülbírálás —
      // ld. billingoSync.ts `saveBillingoDocument` ugyanezen lépése,
      // `resolveInheritedLineMapping` doksztringje, docs/tervezes.md 24.
      // fejezet.
      const inherited = await resolveInheritedLineMapping(
        companyId,
        { invoiceType: invoice.invoiceType, relatedDocumentIds: invoice.relatedDocumentIds },
        { productName: line.productName, quantity: line.quantity, netAmount: line.netAmount },
        {
          enableCancellationInheritance: invoice.company.enableCancellationInheritance,
          enableModificationInheritance: invoice.company.enableModificationInheritance,
        }
      );

      let suggestion: MappingSuggestion | null;
      if (inherited) {
        suggestion = {
          glaCode: inherited.glaCode,
          vatCode: inherited.vatCode,
          vatGlaCode: inherited.vatGlaCode,
          amountSign: inherited.amountSign,
          source: inherited.source,
          confidence: null,
          ruleId: inherited.source,
          ruleSummary: inherited.ruleSummary,
          inexactMatchField: null,
          inexactMatchValue: null,
        };
      } else {
        const context: LineMatchContext = {
          partnerId: invoice.partnerId,
          productName: line.productName,
          lineComment: line.comment,
          headerComment: invoice.comment,
          documentType: invoice.invoiceType,
          vatPercentOrCode: line.vatPercentOrCode,
          hasAdvanceSettlement: invoice.hasAdvanceSettlement,
          isNegativeAmount: line.netAmount < 0,
        };
        suggestion = await suggestMappingForLine(companyId, context, {
          primaryAdvanceGlaCode,
          enableAdvanceSignOverride: invoice.company.enableAdvanceSignOverride,
        });
      }
      const complianceWarnings = checkLineCompliance({
        vatPercentOrCode: line.vatPercentOrCode,
        isReverseCharge: reverseChargeLookup.get(line.vatPercentOrCode) ?? false,
        partnerIsPrivateIndividual: isPartnerPrivateIndividual(invoice.partner),
        isAdvanceDocument: invoice.invoiceType === "advance",
      });
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
        complianceWarnings: complianceWarnings.length > 0 ? complianceWarnings : null,
      });
    }

    const fullyClassified = newLines.length > 0 && newLines.every((l) => l.suggestedGlaCode && l.suggestedVatCode);
    const status =
      fullyClassified &&
      isPartnerReadyForSubmission(invoice.partner) &&
      !invoice.exchangeRateWarning &&
      !invoiceHasComplianceWarning(newLines)
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
 * Duplikált beküldés (`ImaSalesInvoiceSubmitResult.duplicate`, ld.
 * imaApiClient.ts `pushSalesInvoiceRawAdd` — az IMA "Invoice already
 * exists (SH_NO + PostingDate)" hibája) esetén megpróbálja megtalálni a
 * IMA-oldalon MÁR LÉTREJÖTT bizonylat azonosítóját, hogy a helyi állapot
 * automatikusan helyreálljon (ne maradjon örökre `failed`-ben, ha a
 * bizonylat valójában sikeresen létrejött, csak a válasz veszett el egy
 * korábbi kísérletnél) — ld. docs/tervezes.md 20. fejezet.
 *
 * A `/gladetails` (Főkönyvi kivonat, KÖNYVELT/kontírozott tételek) végpontot
 * használja, NEM a `/nav`-ot (könyvelői felismerés: ott a még nem
 * kontírozott, NAV-online-ból beérkezett bizonylatok is látszanának, ami
 * hamis pozitív találatot adhatna egy MÁSIK, még nem is beküldött
 * bizonylatra). Az `InvoiceNo` mezőt (Billingo-formátumú számlaszám) a
 * `mappingRuleEngine.ts` már megbízhatóan, kereszt-ellenőrzésre használja
 * ugyanígy string-egyezéssel, ld. ott — ugyanaz a garancia vonatkozik erre
 * a keresésre is. A bizonylat dátumára (`docDateIso`, ami a beküldött
 * `posting_date`-tel egyezik) szűkítve kérdez le, hogy ne kelljen a teljes
 * historikus GL-t áttölteni.
 *
 * Csak akkor ad vissza (nem-null) találatot, ha a számlaszámra
 * illeszkedő GL-sorok MIND ugyanahhoz az egyetlen `salesHeaderId`-hez
 * tartoznak — bármilyen bizonytalanság (nincs találat, vagy ELLENTMONDÓ
 * `salesHeaderId`-k) esetén `null`-t ad, ilyenkor a hívó megtartja a
 * normál "ellenőrizd kézzel IMA-ban" hibaüzenetet, NEM találgat.
 */
async function tryReconcileDuplicateSubmission(
  credentials: ImaCredentials,
  params: { invoiceNumber: string; docDateIso: string }
): Promise<number | null> {
  try {
    const rows = await fetchImaGlaDetails(credentials, {
      fromDate: params.docDateIso,
      untilDate: params.docDateIso,
    });
    const matches = rows.filter((r) => r.invoiceNo === params.invoiceNumber);
    if (matches.length === 0) return null;
    const distinctSalesHeaderIds = new Set(
      matches.map((m) => m.salesHeaderId).filter((id): id is number => id != null)
    );
    if (distinctSalesHeaderIds.size !== 1) return null;
    return [...distinctSalesHeaderIds][0]!;
  } catch (err) {
    console.error(`IMA duplikáció-feloldás sikertelen (számla ${params.invoiceNumber}):`, err);
    return null;
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

  // Védőháló: a `saveBillingoDocument` a szinkron pontján már (1)
  // soronként konzisztenssé teszi a
  // nettó+áfa=bruttó összefüggést, ÉS (2) a sorok összegét a bizonylat
  // FIX fejléc-összesítőjéhez (`Invoice.netAmount`/`vatAmount`/
  // `grossAmount`, a Billingo `summary`/`gross_total` mezőiből) igazítja
  // — ld. amountReconciliation.ts doksztringje, docs/tervezes.md 21.
  // fejezet, könyvelői pontosítás: "nem a sorokból számolunk... az
  // összesen adat, ami a számla fejből érkezik, az a fix. A sorokat lehet
  // mozgatni." A beküldés viszont a DB-ben MÁR TÁROLT sorértékeket
  // használja, ami egy korábbi (e javítás ELŐTTI) szinkronból még
  // inkonzisztens lehet — itt, közvetlenül a tényleges IMA-export előtt,
  // ugyanezt a két lépést újra elvégezzük.
  const reconciledLines = lines.map((line) => {
    const { netAmount, vatAmount, grossAmount } = reconcileLineAmounts(line.netAmount, line.vatAmount, line.grossAmount);
    return { ...line, netAmount, vatAmount, grossAmount };
  });
  const rawHeaderNetAmount = invoice.netAmount != null ? Number(invoice.netAmount) : null;
  const rawHeaderVatAmount = invoice.vatAmount != null ? Number(invoice.vatAmount) : null;
  const rawHeaderGrossAmount = invoice.grossAmount != null ? Number(invoice.grossAmount) : null;
  // A tárolt fejléc-összesítő MAGA is lehet inkonzisztens (ld.
  // `saveBillingoDocument`-ben ugyanez a lépés, és annak doksztringje —
  // élő IMA-hiba mutatta meg: "Explicit line amounts are inconsistent")
  // — ezért itt is a `reconcileLineAmounts`-szal tesszük konzisztensre,
  // MIELŐTT ehhez igazítanánk a sorokat.
  const linesAlignedToHeader =
    rawHeaderNetAmount != null && rawHeaderVatAmount != null && rawHeaderGrossAmount != null
      ? reconcileLinesToHeaderTotal(
          reconciledLines,
          reconcileLineAmounts(rawHeaderNetAmount, rawHeaderVatAmount, rawHeaderGrossAmount)
        ).lines
      : reconciledLines;

  // Az `amountSign: negative` (pl. garanciális visszatartás, ld.
  // docs/tervezes.md 9.2) sorok előjelet váltanak: a nettó egységár és a
  // tétel nettó/áfa/bruttó összege is negatívba fordul, hogy a beküldött
  // sorok belsőleg (mennyiség × egységár ≈ összeg) konzisztensek maradjanak.
  const submitLines: ImaSalesInvoiceLine[] = linesAlignedToHeader.map((line) => {
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
  // sorokból számoljuk — az `approvedAmountSign: negative` felülbírálás
  // miatt ez eltérhet a fenti, Billingo-fejlécből származó (mindig
  // pozitív) `Invoice.grossAmount`-tól; enélkül a fejléc és a ténylegesen
  // beküldött sorok összege NEM egyezne (a normál, felülbírálás nélküli
  // esetben ez pontosan megegyezik `Invoice.grossAmount`-tal, hiszen a
  // sorok fent már ahhoz lettek igazítva).
  const headerGrossAmount = submitLines.reduce((sum, l) => sum + l.grossAmount, 0);

  const docDateIso = toIsoDate(invoice.docDate);
  const credentials = { apiKey: company.imaApiKey, user: company.imaApiUser, company: company.imaApiCompany };
  const invoiceExternalId = invoice.billingoDocumentNumber ?? invoice.billingoDocumentId;

  // Előzetes ("preflight") ellenőrzés — könyvelői jelzés (2026.09.17): "azt
  // is ellenőriznünk kellene, mielőtt átküldjük az ima-ba a számlát, hogy
  // ott könyvelt státuszú-e... most egy csomónál úgy volt, hogy már
  // könyvelt állapotú volt, de mi átküldtük." Ugyanazt a `/gladetails`-
  // alapú keresést futtatjuk le, mint a duplikáció-feloldás (ld.
  // `tryReconcileDuplicateSubmission`, docs/tervezes.md 20. fejezet), csak
  // PROAKTÍVAN, a tényleges API-hívás ELŐTT — ha a bizonylat már
  // megtalálható IMA-ban (kontírozva), egyáltalán nem küldjük be újra
  // (elkerülve egy esetleges IMA-oldali duplikátum-bizonylat létrejöttét
  // is, nem csak a hibaüzenetet), hanem egyből "könyvelt"-re állítjuk a
  // felismert azonosítóval.
  const preExistingImaInvoiceId = await tryReconcileDuplicateSubmission(credentials, {
    invoiceNumber: invoiceExternalId,
    docDateIso,
  });

  let resolvedImaInvoiceId: number | null;
  let finalSuccess: boolean;
  let finalError: string | null;
  let reconciledFromDuplicate = false;
  let originalDuplicateError: string | null = null;
  let preFlightMatch = false;

  if (preExistingImaInvoiceId != null) {
    resolvedImaInvoiceId = preExistingImaInvoiceId;
    finalSuccess = true;
    finalError = null;
    preFlightMatch = true;
  } else {
    const result = await pushSalesInvoiceRawAdd(credentials, {
      // ⚠️ 2026.09.14-i javítás: az `invoice_external_id` mező az IMA
      // OpenAPI sémája szerint "SH_NO" — ez NEM egy rejtett, csak
      // duplikáció-védelemre szolgáló belső azonosító, hanem TÉNYLEGESEN
      // ez jelenik meg az IMA felületén a bizonylat számaként ("Vevői
      // szám" mező a Karton nézeten) — élő teszttel megerősítve
      // (könyvelői visszajelzés): a korábbi `billingoDocumentId` (Billingo
      // BELSŐ, numerikus dokumentum-azonosítója, pl. "134697529") ehelyett
      // fiktív/értelmezhetetlen számként jelent meg IMA-ban, a Billingo
      // valódi számlaszáma ("2026-4027") helyett. A `billingoDocumentNumber`
      // (a Billingo TÉNYLEGES, emberi olvasásra szánt számlaszáma) ugyanúgy
      // cégen belül egyedi és stabil, tehát az IMA duplikáció-védelemhez
      // (ez + `postingDate`) is megfelel — csak arra az elméleti esetre
      // esünk vissza a belső ID-ra, ha valamiért hiányozna (ld.
      // `Invoice.billingoDocumentNumber: String?` nullable mező, schema.prisma).
      invoiceExternalId,
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
    });

    // Duplikáció-feloldás: ha az IMA azt jelezte, hogy a bizonylat MÁR
    // LÉTEZIK (ld. `pushSalesInvoiceRawAdd` doksztringje — jellemzően egy
    // korábbi kísérlet válasza veszett el, miközben a beszúrás IMA-oldalon
    // sikeres volt), megpróbáljuk automatikusan megtalálni a ténylegesen
    // létrejött bizonylat azonosítóját, hogy a helyi állapot ne ragadjon
    // örökre `failed`-ben — ld. `tryReconcileDuplicateSubmission`
    // doksztringje, docs/tervezes.md 20. fejezet. (A fenti PREFLIGHT
    // ellenőrzés a leggyakoribb esetet már elkerüli, de elméletben
    // előfordulhat, hogy a bizonylat PONT a preflight ellenőrzés és a
    // tényleges beküldés közt jön létre IMA-ban máshonnan — ez a
    // védőháló erre is jó.)
    resolvedImaInvoiceId = result.imaInvoiceId;
    finalSuccess = result.success;
    finalError = result.error;
    if (!result.success && result.duplicate) {
      const recoveredId = await tryReconcileDuplicateSubmission(credentials, {
        invoiceNumber: invoiceExternalId,
        docDateIso,
      });
      if (recoveredId != null) {
        resolvedImaInvoiceId = recoveredId;
        finalSuccess = true;
        finalError = null;
        reconciledFromDuplicate = true;
        originalDuplicateError = result.error;
      }
    }
  }

  if (finalSuccess && !invoice.partner.imaPartnerCode) {
    await tryLinkNewlyCreatedImaPartner(credentials, {
      id: invoice.partner.id,
      name: invoice.partner.name,
      taxNumber: invoice.partner.taxNumber,
    });
  }

  let imageUploaded = false;
  let imageUploadError: string | null = null;
  if (finalSuccess && resolvedImaInvoiceId != null && company.billingoApiKey) {
    const imageResult = await attachInvoiceImage(
      company.billingoApiKey,
      invoice.billingoDocumentId,
      `${invoiceExternalId}.pdf`,
      credentials,
      resolvedImaInvoiceId
    );
    imageUploaded = imageResult.uploaded;
    imageUploadError = imageResult.error;
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: finalSuccess
      ? {
          status: InvoiceStatus.booked,
          imaSalesheaderId: resolvedImaInvoiceId,
          imaPushError: null,
          imaImageUploaded: imageUploaded,
          imaImageUploadError: imageUploadError,
        }
      : {
          status: InvoiceStatus.failed,
          imaPushError: finalError,
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
      after: {
        status: updated.status,
        error: finalError,
        ...(preFlightMatch ? { preFlightMatch: true } : {}),
        ...(reconciledFromDuplicate ? { reconciledFromDuplicate: true, originalError: originalDuplicateError } : {}),
      },
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

export interface ImaReconciliationResult {
  /** Hány helyileg `booked` (könyveltnek jelölt) számlát ellenőriztünk. */
  checked: number;
  /** Azok a számlák, amik IMA-oldalon NEM voltak megtalálhatók, ezért visszaálltak `approved`-re. */
  reset: { invoiceId: string; billingoDocumentNumber: string }[];
}

/**
 * Ellenőrzi, hogy a helyileg "könyvelt" (`booked`) állapotú számlák
 * TÉNYLEGESEN megvannak-e IMA-oldalon — könyvelői kérés (2026.09.14): "most
 * töröltem az összes bizonylatot, amit átadtunk az IMA-ba... ami nincs az
 * ima-ban, azt annál ne legyen könyvelt/ima-ba átadott a státusz." Ez a
 * helyzet bármikor előállhat (nem csak egy tömeges törlés után) — pl. egy
 * korábbi beküldés IMA-oldalon sikeres volt, de a helyi állapot valamiért
 * mégsem frissült rendesen.
 *
 * A `/gladetails` (Főkönyvi kivonat — csak a TÉNYLEGESEN kontírozott/
 * könyvelt tételek) végpontot használja, UGYANAZT az `invoiceNo` mezőt,
 * amit a duplikáció-feloldás (`tryReconcileDuplicateSubmission`) is
 * megbízhatóan, Billingo-formátumú számlaszámként kezel — NEM a `/nav`
 * végpontot, mert ott a még nem kontírozott, NAV-onlineból beérkezett
 * bizonylatok is szerepelnének, ami hamis "megvan" eredményt adna egy
 * valójában nem-kontírozott bizonylatra.
 *
 * Fontos: ez EGYENKÉNT, a tényleges számlaszám alapján ellenőriz minden
 * helyileg `booked` számlát — NEM egy "utolsó IMA-sorszám" küszöbre épít.
 * Ez azért lényeges, mert több számlatömb (eltérő prefixű számlaszám-
 * sorozat) esetén egyetlen "utolsó szám" nem tudná helyesen lefedni az
 * összes sorozatot — az egyenkénti, számlaszám szerinti meglét-ellenőrzés
 * viszont magától, sorozatok számától függetlenül helyesen működik.
 *
 * A helyileg `booked` számlák kelt-dátumainak (docDate) minimumától
 * maximumáig kér le egy IMA-lekérdezést (egyetlen hívással, dátum-
 * tartományra szűkítve — nem kell a teljes historikus GL-t áttölteni).
 * Minden olyan helyi számlát, aminek a számlaszáma NEM szerepel a
 * visszakapott listában, visszaállít `approved` státuszra (törli az
 * `imaSalesheaderId`-t, `imaPushError`-ba egy magyarázó üzenetet ír) — ez
 * a normál "Beküldés IMA-nak" úton újra beküldhetővé teszi, a duplikáció-
 * feloldással és a nettó+áfa=bruttó-korrekcióval együtt (ld.
 * `submitInvoiceToIma`).
 */
export async function reconcileBookedInvoicesWithIma(companyId: string): Promise<ImaReconciliationResult> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  if (!company.imaApiKey || !company.imaApiUser || !company.imaApiCompany) {
    throw new ValidationError("A céghez nincs teljesen beállítva az IMA API hozzáférés.");
  }

  const bookedInvoices = await prisma.invoice.findMany({
    where: { companyId, status: InvoiceStatus.booked },
    select: { id: true, billingoDocumentNumber: true, billingoDocumentId: true, docDate: true },
  });
  if (bookedInvoices.length === 0) return { checked: 0, reset: [] };

  const docDates = bookedInvoices.map((i) => i.docDate).filter((d): d is Date => d != null);
  const minDate = docDates.length > 0 ? new Date(Math.min(...docDates.map((d) => d.getTime()))) : new Date();
  const maxDate = docDates.length > 0 ? new Date(Math.max(...docDates.map((d) => d.getTime()))) : new Date();

  const glaRows = await fetchImaGlaDetails(
    { apiKey: company.imaApiKey, user: company.imaApiUser, company: company.imaApiCompany },
    { fromDate: minDate.toISOString().slice(0, 10), untilDate: maxDate.toISOString().slice(0, 10) }
  );
  const foundInvoiceNumbers = new Set(glaRows.map((r) => r.invoiceNo));

  const toReset = bookedInvoices
    .map((inv) => ({ invoiceId: inv.id, billingoDocumentNumber: inv.billingoDocumentNumber ?? inv.billingoDocumentId }))
    .filter((inv) => !foundInvoiceNumbers.has(inv.billingoDocumentNumber));

  if (toReset.length > 0) {
    await prisma.$transaction(
      toReset.map((inv) =>
        prisma.invoice.update({
          where: { id: inv.invoiceId },
          data: {
            status: InvoiceStatus.approved,
            imaSalesheaderId: null,
            imaPushError:
              "IMA-egyeztetés: a bizonylat nem található IMA-ban (törölve lett IMA-oldalon, vagy a korábbi " +
              "beküldés válasza tévesen jelzett sikert) — újra be kell küldeni.",
          },
        })
      )
    );
  }

  return { checked: bookedInvoices.length, reset: toReset };
}

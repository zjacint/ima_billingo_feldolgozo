/**
 * Billingo -> admin adatbázis szinkron — ld. docs/tervezes.md 7. fejezet.
 * Cégenkénti időzített job (Cloud Scheduler) vagy kézi "Szinkronizálás
 * most" gomb hívja (ld. src/app/api/companies/[companyId]/sync/route.ts).
 */

import { InvoiceStatus, type Company } from "@prisma/client";
import { prisma } from "./db";
import {
  fetchBillingoDocumentBatch,
  fetchBillingoDocumentsByNumberRange,
  isSyncedBillingoDocumentType,
  mapBillingoPaymentMethodToIma,
  SYNCED_BILLINGO_DOCUMENT_TYPES,
  type BillingoDocument,
  type BillingoDocumentType,
} from "./billingoApiClient";
import { resolvePrimaryAdvanceGlaCode, suggestMappingForLine, type LineMatchContext } from "./mappingRuleEngine";
import { checkExchangeRateDeviation } from "./exchangeRate";
import { detectInvoicePaymentTransaction } from "./paymentTransactionDetection";
import { extractYearFromPrefix, findInvoiceNumberGaps, groupConsecutiveNumbers } from "./invoiceNumberGaps";
import { isPartnerReadyForSubmission, type InvoiceLine } from "./types";

export interface BillingoSyncResult {
  fetched: number;
  created: number;
  updated: number;
  skippedNoPartner: number;
}

/** Egy Billingo API oldal max. 100 dokumentum — ennyi oldalanként (~200 db) dolgozunk fel/mentünk egy csomagban. */
const BATCH_PAGES = 2;

/**
 * Egy HTTP kérésen (`runBillingoSyncBatch`) átívelő szinkron-állapot — a
 * kliens (`SyncControls.tsx`) ezt adja vissza a KÖVETKEZŐ POST /sync
 * hívásnak, amíg `done: true` nem érkezik. Szerializálható (JSON), semmi
 * DB-kapcsolat vagy generátor-állapot nincs benne — ld. docs/tervezes.md
 * 7. fejezet, `fetchBillingoDocumentBatch` doksztringje (Cloud Run 504
 * hosszabb dátumtartománynál).
 */
export interface BillingoSyncCursor {
  documentType: BillingoDocumentType;
  page: number;
  /** A `Company.billingoLastSyncedInvoiceDate` végleges frissítéséhez összegyűjtött, eddig látott legkésőbbi számla-kelte. */
  maxInvoiceDateIso: string | null;
  result: BillingoSyncResult;
}

/**
 * Hány napot tolunk vissza a következő szinkron `start_date` szűrőjén a
 * legutóbb látott számla-kelthez képest — ld. docs/tervezes.md 14.
 * fejezet, könyvelői visszajelzés (2026.08.16): teszt után a szinkronizált
 * számlák száma nem lett 100%-os. **Pontosítás (könyvelő, 2026.08.16): a
 * NAV számla-adatközlési specifikáció miatt Billingo-ban NEM lehet egy
 * ÚJABBAN kiállított bizonylatot egy KORÁBBI keltre dátumozni, mint egy
 * már meglévő — csak AZONOS napra.** Tehát a valódi kockázat nem a
 * "korábbi kelt", hanem az, hogy a `billingoLastSyncedInvoiceDate` napján
 * a szinkron lefutása UTÁN is rögzíthetnek még számlát (a nap még nem
 * "zárt le") — ha a következő szinkron `start_date`-je PONTOSAN erre a
 * napra esne, ez elvben már lefedné (a Billingo `start_date` szűrő
 * dátum-granularitású, `>=`), de a néhány napos átfedés extra biztonságot
 * ad más, itt még fel nem merült él-esetekre is — a szinkront idempotens
 * újra-lekérdezéssel (már meglévő számlák upsert-je, nem duplikáció) teszi
 * biztonságosabbá, csekély többletköltségért cserébe. Csak a KURZORRA
 * (`billingoLastSyncedInvoiceDate`) vonatkozik, a cégen egyszer beállított
 * `billingoSyncFromDate` floor-t nem tolja el.
 */
const SYNC_OVERLAP_DAYS = 3;

function subtractDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

const NOT_OVERWRITABLE: InvoiceStatus[] = [
  InvoiceStatus.approved,
  InvoiceStatus.submitted,
  InvoiceStatus.booked,
];

/**
 * Egyetlen Billingo bizonylatot ment el (partner upsert + tételsor-javaslatok
 * + Invoice upsert). A hívó csomagonként (ld. `syncCompanyBillingoInvoices`)
 * futtatja, hogy a teljes bizonylat-halmaz SOHA ne legyen egyszerre
 * memóriában — ld. docs/tervezes.md 7. fejezet.
 */
async function saveBillingoDocument(
  companyId: string,
  company: Company,
  doc: BillingoDocument,
  result: BillingoSyncResult,
  primaryAdvanceGlaCode: string | null
): Promise<void> {
  // Korábban a törölt/sztornózott Billingo bizonylatokat teljesen kihagytuk
  // — könyvelői kérésre (2026.08.16) ez megváltozott: ezek is bekerülnek
  // (`Invoice.billingoCancelled`-del megjelölve, ld. lent), hogy a
  // könyvelő lássa és eldönthesse (a meglévő "Elutasítás" művelettel),
  // nem a szinkron dobja el csendben.
  if (!doc.partner) {
    result.skippedNoPartner += 1;
    return;
  }

  const partner = await prisma.partner.upsert({
    where: { companyId_billingoPartnerId: { companyId, billingoPartnerId: doc.partner.billingoPartnerId } },
    update: {
      name: doc.partner.name,
      taxNumber: doc.partner.taxNumber,
      postalCode: doc.partner.postalCode,
      city: doc.partner.city,
      addressStreet: doc.partner.addressStreet,
      countryCode: doc.partner.countryCode,
    },
    create: {
      companyId,
      billingoPartnerId: doc.partner.billingoPartnerId,
      name: doc.partner.name,
      taxNumber: doc.partner.taxNumber,
      postalCode: doc.partner.postalCode,
      city: doc.partner.city,
      addressStreet: doc.partner.addressStreet,
      countryCode: doc.partner.countryCode,
    },
  });

  const lines: InvoiceLine[] = [];
  for (const item of doc.items) {
    const context: LineMatchContext = {
      partnerId: partner.id,
      productName: item.name,
      lineComment: item.comment,
      headerComment: doc.comment,
      documentType: doc.type,
      vatPercentOrCode: item.vat,
    };
    const suggestion = await suggestMappingForLine(companyId, context, { primaryAdvanceGlaCode });
    lines.push({
      productName: item.name,
      comment: item.comment,
      quantity: item.quantity,
      unitOfMeasure: item.unit,
      netUnitCost: item.netUnitAmount,
      vatPercentOrCode: item.vat,
      netAmount: item.netAmount,
      vatAmount: item.vatAmount,
      grossAmount: item.grossAmount,
      suggestedGlaCode: suggestion?.glaCode ?? null,
      suggestedVatCode: suggestion?.vatCode ?? null,
      suggestedVatGlaCode: suggestion?.vatGlaCode ?? null,
      suggestedAmountSign: suggestion?.amountSign ?? null,
      suggestedRuleSource: suggestion?.source ?? null,
      suggestedRuleId: suggestion?.ruleId ?? null,
      suggestedRuleSummary: suggestion?.ruleSummary ?? null,
      suggestedInexactMatchField: suggestion?.inexactMatchField ?? null,
      suggestedInexactMatchValue: suggestion?.inexactMatchValue ?? null,
      approvedGlaCode: null,
      approvedVatCode: null,
      approvedVatGlaCode: null,
      approvedAmountSign: null,
    });
  }

  // Devizás számlánál a Billingo `conversion_rate`-je a könyvelendő
  // árfolyam (nem cseréljük le) — de ELLENŐRIZZÜK a hivatalos MNB/bank
  // jegyzés ellen, mert a Billingo csak MNB-t ajánl fel automatikusan,
  // egy attól eltérőt nem (ld. src/lib/exchangeRate.ts,
  // docs/tervezes.md 7. fejezet). Hálózati/API hiba esetén NEM
  // blokkoljuk a szinkront, csak a figyelmeztetést hagyjuk el.
  let exchangeRateWarning: string | null = null;
  if (doc.currency.trim().toUpperCase() !== "HUF") {
    if (doc.conversionRate == null || doc.conversionRate === 0) {
      exchangeRateWarning = "Hiányzik az árfolyam a Billingo számlán, pedig nem HUF a devizanem.";
    } else if (doc.invoiceDate) {
      try {
        exchangeRateWarning = await checkExchangeRateDeviation(
          company,
          doc.currency,
          new Date(doc.invoiceDate),
          doc.conversionRate
        );
      } catch (err) {
        console.error(`Árfolyam-ellenőrzés sikertelen (${doc.invoiceNumber}):`, err);
      }
    }
  }

  // Fizetési szolgáltatói (pl. Stripe) tranzakcióazonosító felismerése a
  // fejléc-/tétel-megjegyzésekben — ld. paymentTransactionDetection.ts,
  // docs/tervezes.md 13. fejezet. Csak jelzésre szolgál, az IMA beküldést
  // nem befolyásolja.
  const detectedTransaction = detectInvoicePaymentTransaction(
    doc.comment,
    doc.items.map((item) => item.comment)
  );

  const fullyClassified = lines.length > 0 && lines.every((l) => l.suggestedGlaCode && l.suggestedVatCode);
  const status: InvoiceStatus =
    fullyClassified && isPartnerReadyForSubmission(partner) && !exchangeRateWarning
      ? InvoiceStatus.synced
      : InvoiceStatus.needs_review;

  const netAmount = lines.reduce((sum, l) => sum + l.netAmount, 0);
  const vatAmount = lines.reduce((sum, l) => sum + l.vatAmount, 0);

  const existing = await prisma.invoice.findUnique({
    where: { companyId_billingoDocumentId: { companyId, billingoDocumentId: doc.id } },
  });

  if (existing && NOT_OVERWRITABLE.includes(existing.status)) {
    // Már jóváhagyott/beküldött/könyvelt számlát nem írunk felül egy
    // újabb szinkronnal (ld. docs/tervezes.md 7. fejezet) — a könyvelő
    // esetleges felülírásait ez védi.
    return;
  }

  const data = {
    billingoDocumentNumber: doc.invoiceNumber,
    partnerId: partner.id,
    status,
    invoiceType: doc.type,
    hasAdvanceSettlement: doc.hasRelatedDocuments,
    paymentMethod: mapBillingoPaymentMethodToIma(doc.paymentMethod),
    currencyCode: doc.currency,
    exchangeRate: doc.conversionRate,
    exchangeRateWarning,
    docDate: doc.invoiceDate ? new Date(doc.invoiceDate) : null,
    fulfillmentDate: doc.fulfillmentDate ? new Date(doc.fulfillmentDate) : null,
    dueDate: doc.dueDate ? new Date(doc.dueDate) : null,
    netAmount,
    vatAmount,
    grossAmount: doc.grossTotal,
    comment: doc.comment,
    lines: lines as unknown as object,
    detectedPaymentTransactionId: detectedTransaction?.transactionId ?? null,
    detectedPaymentProcessor: detectedTransaction?.processor ?? null,
    billingoCancelled: doc.cancelled,
  };

  if (existing) {
    await prisma.invoice.update({ where: { id: existing.id }, data });
    result.updated += 1;
  } else {
    await prisma.invoice.create({
      data: { companyId, billingoDocumentId: doc.id, ...data },
    });
    result.created += 1;
  }
}

/**
 * EGY csomagot (~200 bizonylat, ld. `fetchBillingoDocumentBatch`) dolgoz fel
 * és ment el — HTTP kérésenként ennyi munkát végez a `/api/companies/
 * [companyId]/sync` route, hogy egyetlen kérés se futhasson bele a Cloud Run
 * időtúllépésébe (504), függetlenül attól, hogy összesen mennyi bizonylatot
 * kell lekérdezni (ld. docs/tervezes.md 7. fejezet). Első híváskor
 * `cursor` legyen `null`; a visszaadott `cursor`-t add tovább a
 * KÖVETKEZŐ hívásnak, amíg `done: true` nem érkezik.
 *
 * A `Company.billingoLastSyncedInvoiceDate` kurzort SZÁNDÉKOSAN csak a
 * TELJES szinkron végén (amikor `done: true`) írjuk — a Billingo a
 * legfrissebb bizonylatot adja vissza ELSŐKÉNT, tehát ha csomagonként előre
 * tolnánk, egy félbeszakadt szinkron a MÉG FELDOLGOZATLAN régebbi
 * csomagokat véglegesen kihagyná a következő futásnál (a `start_date`
 * szűrő csak alsó határ). Eddig a pontig a `maxInvoiceDateIso` csak a
 * kliensnél/state-ben utazó cursor RÉSZE, nem kerül adatbázisba.
 */
export async function runBillingoSyncBatch(
  companyId: string,
  cursor: BillingoSyncCursor | null
): Promise<{ cursor: BillingoSyncCursor | null; result: BillingoSyncResult; done: boolean }> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  if (!company.billingoApiKey) {
    throw new Error("A céghez nincs beállítva Billingo API kulcs.");
  }

  // Ismételt szinkronnál a legkésőbbi eddig LÁTOTT SZÁMLA-KELTE (nem a
  // szinkron futtatásának időpontja!) a szűrő alsó határa — a Billingo
  // `start_date` a számla keltére szűr, ezért ha a szinkron futtatási
  // időpontját használnánk, egy aznap még hozzáadott (de ugyanarra a
  // napra keltezett — korábbi keltre a NAV-szabály miatt nem lehet, ld.
  // `SYNC_OVERLAP_DAYS` doksztringje) számla véglegesen kimaradna.
  // `SYNC_OVERLAP_DAYS` napos átfedéssel toljuk vissza extra biztonságnak.
  // Az ELSŐ szinkronnál a cégen beállított `billingoSyncFromDate` a floor
  // (ha van), hogy egy új cégnél ne kelljen évekre visszamenőleg
  // lekérdezni a teljes Billingo-előzményt (ld. docs/tervezes.md 7.
  // fejezet) — ezt NEM toljuk el, mert az egy szándékosan beállított,
  // egyszeri határ.
  const startDate = company.billingoLastSyncedInvoiceDate
    ? subtractDays(company.billingoLastSyncedInvoiceDate, SYNC_OVERLAP_DAYS).toISOString().slice(0, 10)
    : company.billingoSyncFromDate?.toISOString().slice(0, 10);

  const state: BillingoSyncCursor = cursor ?? {
    documentType: SYNCED_BILLINGO_DOCUMENT_TYPES[0]!,
    page: 1,
    maxInvoiceDateIso: company.billingoLastSyncedInvoiceDate?.toISOString() ?? null,
    result: { fetched: 0, created: 0, updated: 0, skippedNoPartner: 0 },
  };

  const batch = await fetchBillingoDocumentBatch(
    company.billingoApiKey,
    { startDate },
    { documentType: state.documentType, page: state.page },
    BATCH_PAGES
  );

  // Cégenként/csomagonként EGYSZER számoljuk ki (nem soronként) — ld.
  // mappingRuleEngine.ts `suggestMappingForLine` doksztringje.
  const primaryAdvanceGlaCode = await resolvePrimaryAdvanceGlaCode(companyId);

  state.result.fetched += batch.documents.length;
  let maxInvoiceDate = state.maxInvoiceDateIso ? new Date(state.maxInvoiceDateIso) : null;
  for (const doc of batch.documents) {
    if (doc.invoiceDate) {
      const docInvoiceDate = new Date(doc.invoiceDate);
      if (!maxInvoiceDate || docInvoiceDate > maxInvoiceDate) maxInvoiceDate = docInvoiceDate;
    }
    await saveBillingoDocument(companyId, company, doc, state.result, primaryAdvanceGlaCode);
  }
  state.maxInvoiceDateIso = maxInvoiceDate ? maxInvoiceDate.toISOString() : null;

  if (batch.nextCursor) {
    return { cursor: { ...state, page: batch.nextCursor.page }, result: state.result, done: false };
  }
  const typeIndex = SYNCED_BILLINGO_DOCUMENT_TYPES.indexOf(state.documentType);
  const nextType = SYNCED_BILLINGO_DOCUMENT_TYPES[typeIndex + 1];
  if (nextType) {
    // Az aktuális típus kimerült — jöhet a következő a listából (ld.
    // `SYNCED_BILLINGO_DOCUMENT_TYPES`) az elejétől.
    return { cursor: { ...state, documentType: nextType, page: 1 }, result: state.result, done: false };
  }

  // Minden típus kimerült — a kurzor véglegesen lezárva, most írjuk az
  // adatbázisba az összegyűjtött legkésőbbi számla-keltét.
  await prisma.company.update({
    where: { id: companyId },
    data: { lastBillingoSyncAt: new Date(), billingoLastSyncedInvoiceDate: maxInvoiceDate },
  });

  return { cursor: null, result: state.result, done: true };
}

/**
 * Kényelmi wrapper: a `runBillingoSyncBatch`-et in-process (nem HTTP
 * kérésenként) hívja addig, amíg `done: true` nem lesz — a Cloud Run Job /
 * CLI (`npm run sync:billingo`, `scripts/sync-billingo.ts`) hívja, ahol
 * NINCS HTTP kérés-időkorlát, tehát a csomagolt feldolgozás (memóriavédelem)
 * elég, a lapozáson-átívelő cursor-visszaadás felesleges bonyodalom lenne.
 * A `/api/companies/[companyId]/sync` route-nak (böngészős "Szinkronizálás
 * most" gomb) EZT NEM SZABAD hívnia — az `runBillingoSyncBatch`-et hívja
 * közvetlenül, csomagonként egy HTTP kéréssel (ld. docs/tervezes.md 7.).
 */
export async function syncCompanyBillingoInvoices(companyId: string): Promise<BillingoSyncResult> {
  let cursor: BillingoSyncCursor | null = null;
  let result: BillingoSyncResult = { fetched: 0, created: 0, updated: 0, skippedNoPartner: 0 };
  for (;;) {
    const step = await runBillingoSyncBatch(companyId, cursor);
    result = step.result;
    if (step.done) break;
    cursor = step.cursor;
  }
  return result;
}

/** Hány (összefüggő) hiányzó-sorszám tartományt kérdezünk le Billingo-tól kérésenként — ld. `runGapFillBatch` doksztringje. */
const GAP_FILL_RANGES_PER_BATCH = 5;

interface GapFillWorkItem {
  prefix: string;
  year: number;
  range: { start: number; end: number };
}

export interface GapFillResult {
  /** Hány hiányzó sorszámot ellenőriztünk eddig (tartományban lévő összes szám, nem csak a talált tartományoké). */
  numbersChecked: number;
  /** Ténylegesen importált (számla-típusú, korábban hiányzó) bizonylatok száma. */
  imported: number;
  /** Létezik Billingo-ban, de NEM szinkronizálandó típus (pl. offer/draft) — kihagyva. */
  skippedNonInvoiceType: number;
  /** Billingo egyáltalán nem ad vissza bizonylatot erre a sorszámra — valószínűleg sosem lett kiállítva, vagy törölve lett a számozásból. */
  notFoundInBillingo: number;
}

export interface GapFillCursor {
  pendingItems: GapFillWorkItem[];
  skippedNoYear: string[];
  result: GapFillResult;
}

/**
 * A hiányzó-számlaszám ellenőrzés (`invoiceNumberGaps.ts`) által talált
 * hiányokat kérdezi le CÉLZOTTAN Billingo-tól — ld. docs/tervezes.md 16.
 * fejezet, könyvelői kérés (2026.08.23): "a hiánylista szerinti számlákat
 * a program lekérdezni". A Billingo `/documents` `start_number`/
 * `end_number`/`start_year`/`end_year` szűrőjével (nem dátum-alapú, ld.
 * `fetchBillingoDocumentsByNumberRange`) közvetlenül a hiányzó
 * sorszám-tartományokra kérdez rá, típusszűrés NÉLKÜL — így meg tudja
 * különböztetni, hogy egy hiányzó szám ténylegesen nem létezik Billingo-
 * ban, vagy létezik, csak egy általunk nem szinkronizált típus.
 *
 * Első híváskor (`cursor: null`) újraszámolja az aktuális hiány-listát az
 * adatbázisban lévő számlaszámokból, csoportonként (prefixenként)
 * kinyeri az évet (`extractYearFromPrefix` — ha nem sikerül, a csoportot
 * kihagyja, `skippedNoYear`-be kerül), az egymást követő hiányzó
 * sorszámokat tartományokká vonja össze (`groupConsecutiveNumbers`), és
 * ebből építi a feldolgozandó munkalistát. HTTP kérésenként csak
 * `GAP_FILL_RANGES_PER_BATCH` tartományt dolgoz fel (ugyanaz a
 * csomagolt/folytatható minta, mint `runBillingoSyncBatch`-nél — a
 * hiánylista akár száz tartományt is tartalmazhat, egyetlen kérés sem
 * futhat bele a Cloud Run időtúllépésébe).
 */
export async function runGapFillBatch(
  companyId: string,
  cursor: GapFillCursor | null
): Promise<{ cursor: GapFillCursor | null; result: GapFillResult; skippedNoYear: string[]; done: boolean }> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  if (!company.billingoApiKey) {
    throw new Error("A céghez nincs beállítva Billingo API kulcs.");
  }

  let state: GapFillCursor;
  if (cursor) {
    state = cursor;
  } else {
    const invoices = await prisma.invoice.findMany({
      where: { companyId, billingoDocumentNumber: { not: null } },
      select: { billingoDocumentNumber: true },
    });
    const groups = findInvoiceNumberGaps(invoices.map((i) => i.billingoDocumentNumber!).filter(Boolean));

    const pendingItems: GapFillWorkItem[] = [];
    const skippedNoYear: string[] = [];
    for (const g of groups) {
      const year = extractYearFromPrefix(g.prefix);
      if (year == null) {
        skippedNoYear.push(g.prefix);
        continue;
      }
      for (const range of groupConsecutiveNumbers(g.missingNumbers)) {
        pendingItems.push({ prefix: g.prefix, year, range });
      }
    }
    state = {
      pendingItems,
      skippedNoYear,
      result: { numbersChecked: 0, imported: 0, skippedNonInvoiceType: 0, notFoundInBillingo: 0 },
    };
  }

  const primaryAdvanceGlaCode = await resolvePrimaryAdvanceGlaCode(companyId);
  const batch = state.pendingItems.slice(0, GAP_FILL_RANGES_PER_BATCH);
  const rest = state.pendingItems.slice(GAP_FILL_RANGES_PER_BATCH);
  const syncResult: BillingoSyncResult = { fetched: 0, created: 0, updated: 0, skippedNoPartner: 0 };

  for (const item of batch) {
    const docs = await fetchBillingoDocumentsByNumberRange(company.billingoApiKey, {
      startNumber: item.range.start,
      endNumber: item.range.end,
      year: item.year,
    });

    const foundNumbers = new Set<number>();
    for (const doc of docs) {
      const match = doc.invoiceNumber.match(/^(.*?)(\d+)$/);
      const num = match ? Number(match[2]!) : null;
      if (num != null) foundNumbers.add(num);

      if (!isSyncedBillingoDocumentType(doc.type)) {
        state.result.skippedNonInvoiceType += 1;
        continue;
      }
      // `saveBillingoDocument` csendben visszatérhet mentés nélkül (nincs
      // partner, vagy már jóváhagyott/beküldött státuszú — ld. ott) — az
      // `imported` számláló csak a ténylegesen létrejött/frissült
      // sorokat számolja, a `created`/`updated` delta alapján.
      const beforeSaved = syncResult.created + syncResult.updated;
      await saveBillingoDocument(companyId, company, doc, syncResult, primaryAdvanceGlaCode);
      if (syncResult.created + syncResult.updated > beforeSaved) {
        state.result.imported += 1;
      }
    }
    for (let n = item.range.start; n <= item.range.end; n++) {
      state.result.numbersChecked += 1;
      if (!foundNumbers.has(n)) state.result.notFoundInBillingo += 1;
    }
  }

  const done = rest.length === 0;
  return {
    cursor: done ? null : { ...state, pendingItems: rest },
    result: state.result,
    skippedNoYear: state.skippedNoYear,
    done,
  };
}

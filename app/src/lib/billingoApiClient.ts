/**
 * Billingo API v3 kliens — a kimenő (vevői) számlák lekérdezéséhez. Séma
 * forrás: docs/billingo-api/openapi.yaml (a felhasználótól kapott hivatalos
 * leírás). Hitelesítés: `X-API-KEY` header, cégenkénti kulccsal
 * (`Company.billingoApiKey`, ld. docs/tervezes.md 2.1/4. fejezet).
 */

const BILLINGO_API_BASE_URL = process.env.BILLINGO_API_BASE_URL ?? "https://api.billingo.hu/v3";

export interface BillingoDocumentItem {
  name: string;
  /** A tétel saját megjegyzése — a `commentPattern` szabályok illesztik (ld. docs/tervezes.md 9.1). */
  comment: string | null;
  quantity: number;
  unit: string | null;
  netUnitAmount: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  /** A Billingo `Vat` mező eredeti értéke — pl. "27%" vagy "AAM" (ld. docs/tervezes.md 8.3). */
  vat: string;
}

export interface BillingoDocumentPartner {
  billingoPartnerId: string;
  name: string;
  taxNumber: string | null;
  postalCode: string | null;
  city: string | null;
  addressStreet: string | null;
  countryCode: string | null;
}

export interface BillingoDocument {
  id: string;
  invoiceNumber: string;
  type: string;
  cancelled: boolean;
  currency: string;
  conversionRate: number | null;
  invoiceDate: string | null;
  fulfillmentDate: string | null;
  dueDate: string | null;
  grossTotal: number;
  paymentMethod: string;
  /** A számla fejléc-szintű megjegyzése — a `commentPattern` szabályok (is) illesztik. */
  comment: string | null;
  partner: BillingoDocumentPartner | null;
  items: BillingoDocumentItem[];
  /** Van-e kapcsolódó (elszámolt) előlegszámla — ld. `mapDocument`. */
  hasRelatedDocuments: boolean;
}

/**
 * A tárolt `invoiceType` (nyers Billingo `Document.type`) és a
 * `hasAdvanceSettlement` (kapcsolódó előlegszámla van-e) alapján adja meg a
 * könyvelő számára érthető magyar típus-címkét — ld. docs/tervezes.md 10.
 * fejezet.
 */
export function invoiceKindLabel(invoiceType: string, hasAdvanceSettlement: boolean): string {
  if (invoiceType === "advance") return "Előlegszámla";
  if (invoiceType === "invoice" && hasAdvanceSettlement) return "Végszámla";
  if (invoiceType === "invoice") return "Normál számla";
  if (invoiceType === "modification") return "Helyesbítő számla";
  if (invoiceType === "cancellation") return "Sztornó számla";
  if (invoiceType === "receipt") return "Nyugta";
  if (invoiceType === "receipt_cancellation") return "Nyugta sztornó";
  return invoiceType;
}

/**
 * Az IMA `/api/import/sales-invoice` leírása szerint (ld.
 * docs/ima-api/sales-invoice-import-endpoint.md) a `payment_method` javasolt
 * kódjai: transfer, cash, card, cod, other. A Billingo `PaymentMethod` enum
 * ennél részletesebb — best-effort leképezés, nem élőben ellenőrzött (ld.
 * docs/tervezes.md 12. Nyitott kérdések).
 */
export function mapBillingoPaymentMethodToIma(billingoMethod: string): string {
  switch (billingoMethod) {
    case "wire_transfer":
    case "elore_utalas":
    case "transferwise":
      return "transfer";
    case "cash":
      return "cash";
    case "bankcard":
    case "online_bankcard":
    case "szep_card":
    case "ep_kartya":
      return "card";
    case "cash_on_delivery":
      return "cod";
    default:
      return "other";
  }
}

class BillingoApiError extends Error {}

export interface BillingoDocumentPdf {
  buffer: Buffer;
  contentType: string;
}

/**
 * Egy bizonylat PDF-jét tölti le (`GET /documents/{id}/download`). `null`-t
 * ad vissza HTTP 202-nél — a Billingo dokumentáció szerint ez azt jelenti,
 * hogy a PDF még nem generálódott le, a hívónak később újra kell próbálnia
 * (NEM hibaként kezelendő).
 */
export async function fetchBillingoDocumentPdf(apiKey: string, documentId: string): Promise<BillingoDocumentPdf | null> {
  const res = await fetch(`${BILLINGO_API_BASE_URL}/documents/${documentId}/download`, {
    headers: { "X-API-KEY": apiKey, Accept: "application/pdf" },
  });
  if (res.status === 202) return null;
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new BillingoApiError(`Billingo PDF letöltése sikertelen: HTTP ${res.status}: ${bodyText.slice(0, 500)}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: res.headers.get("content-type") ?? "application/pdf" };
}

async function billingoFetch(apiKey: string, path: string): Promise<unknown> {
  const res = await fetch(`${BILLINGO_API_BASE_URL}${path}`, {
    headers: { "X-API-KEY": apiKey, Accept: "application/json" },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new BillingoApiError(`Billingo API HTTP ${res.status}: ${bodyText.slice(0, 500)}`);
  }
  return res.json();
}

function mapPartner(raw: Record<string, unknown> | null | undefined): BillingoDocumentPartner | null {
  if (!raw) return null;
  const address = (raw.address ?? {}) as Record<string, unknown>;
  return {
    billingoPartnerId: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    taxNumber: raw.taxcode ? String(raw.taxcode) : null,
    postalCode: address.post_code ? String(address.post_code) : null,
    city: address.city ? String(address.city) : null,
    addressStreet: address.address ? String(address.address) : null,
    countryCode: address.country_code ? String(address.country_code) : null,
  };
}

function mapItem(raw: Record<string, unknown>): BillingoDocumentItem {
  return {
    name: String(raw.name ?? ""),
    comment: raw.comment ? String(raw.comment) : null,
    quantity: Number(raw.quantity ?? 0),
    unit: raw.unit ? String(raw.unit) : null,
    netUnitAmount: Number(raw.net_unit_amount ?? 0),
    netAmount: Number(raw.net_amount ?? 0),
    vatAmount: Number(raw.vat_amount ?? 0),
    grossAmount: Number(raw.gross_amount ?? 0),
    vat: String(raw.vat ?? ""),
  };
}

function mapDocument(raw: Record<string, unknown>): BillingoDocument {
  // `document_partner` a jelenlegi mező, a `partner` deprecated — ha az API
  // válasza csak az utóbbit adja (régebbi integráció), arra esünk vissza.
  const partnerRaw = (raw.document_partner ?? raw.partner) as Record<string, unknown> | undefined;
  return {
    id: String(raw.id ?? ""),
    invoiceNumber: String(raw.invoice_number ?? ""),
    type: String(raw.type ?? "invoice"),
    cancelled: Boolean(raw.cancelled),
    currency: String(raw.currency ?? "HUF"),
    conversionRate: raw.conversion_rate != null ? Number(raw.conversion_rate) : null,
    invoiceDate: raw.invoice_date ? String(raw.invoice_date) : null,
    fulfillmentDate: raw.fulfillment_date ? String(raw.fulfillment_date) : null,
    dueDate: raw.due_date ? String(raw.due_date) : null,
    grossTotal: Number(raw.gross_total ?? 0),
    paymentMethod: String(raw.payment_method ?? "other"),
    comment: raw.comment ? String(raw.comment) : null,
    partner: mapPartner(partnerRaw),
    items: Array.isArray(raw.items) ? raw.items.map((i) => mapItem(i as Record<string, unknown>)) : [],
    // `related_documents` nem üres, ha ez a (type: invoice) bizonylat egy
    // korábbi előlegszámlát számol el ("végszámla") — ld. docs/tervezes.md
    // 7. fejezet.
    hasRelatedDocuments: Array.isArray(raw.related_documents) && raw.related_documents.length > 0,
  };
}

export interface FetchBillingoDocumentsOptions {
  /** Csak ez a dátum után kiállított számlák (YYYY-MM-DD) — ld. docs/tervezes.md 7. fejezet. */
  startDate?: string;
}

/**
 * A Billingo `DocumentType` enum teljes listája 17 értéket tartalmaz
 * (`docs/billingo-api/openapi.yaml` `DocumentType` séma), de ennek nagy
 * része NEM számla a szó valódi (könyvelésre kerülő) értelmében — draft*
 * (még ki sem állított piszkozat), offer/order_form (ajánlat/megrendelő),
 * waybill (szállítólevél), dossier (iratgyűjtő), cert_of_completion
 * (teljesítésigazolás), proforma (díjbekérő, nincs önálló áfa-hatása).
 * Ide csak a TÉNYLEGES könyvelési hatással bíró bizonylattípusok
 * kerülnek — könyvelői döntés (2026.08.16): "ami nem számla, azokat nem
 * kérjük".
 */
export type BillingoDocumentType = "invoice" | "advance" | "modification" | "cancellation" | "receipt" | "receipt_cancellation";

/** A ténylegesen szinkronizálandó típusok listája — ld. `BillingoDocumentType` doksztringje. */
export const SYNCED_BILLINGO_DOCUMENT_TYPES: readonly BillingoDocumentType[] = [
  "invoice",
  "advance",
  "modification",
  "cancellation",
  "receipt",
  "receipt_cancellation",
];

/** `true`, ha a Billingo-oldali (nyers) típusérték a szinkronizálandó típusok egyike — ld. `SYNCED_BILLINGO_DOCUMENT_TYPES`. */
export function isSyncedBillingoDocumentType(type: string): type is BillingoDocumentType {
  return (SYNCED_BILLINGO_DOCUMENT_TYPES as readonly string[]).includes(type);
}

/**
 * Adott (év, sorszám-tartomány) szerint kér le bizonylatokat — a `/documents`
 * `start_number`/`end_number`/`start_year`/`end_year` szűrőjével, ld.
 * `docs/billingo-api/openapi.yaml`. SZÁNDÉKOSAN nem szűr `type`-ra: a
 * hiányzó-számlaszám ellenőrzés (ld. docs/tervezes.md 16. fejezet) így meg
 * tudja különböztetni, hogy egy hiányzó sorszám ténylegesen NEM LÉTEZIK
 * Billingo-ban (üres válasz), vagy létezik, csak egy általunk nem
 * szinkronizált típus (pl. `offer`/`draft`) — ez utóbbi esetben a hívó
 * dönt, kihagyja-e.
 */
export async function fetchBillingoDocumentsByNumberRange(
  apiKey: string,
  options: { startNumber: number; endNumber: number; year: number }
): Promise<BillingoDocument[]> {
  const params = new URLSearchParams({
    page: "1",
    per_page: "100",
    start_number: String(options.startNumber),
    end_number: String(options.endNumber),
    start_year: String(options.year),
    end_year: String(options.year),
  });
  const body = (await billingoFetch(apiKey, `/documents?${params.toString()}`)) as { data?: unknown[] };
  const data = Array.isArray(body.data) ? body.data : [];
  return data.map((d) => mapDocument(d as Record<string, unknown>));
}

export interface BillingoBatchCursor {
  documentType: BillingoDocumentType;
  /** A Billingo-oldal, ahonnan a csomag kezdődik (1-alapú). */
  page: number;
}

export interface BillingoDocumentBatchResult {
  documents: BillingoDocument[];
  documentType: BillingoDocumentType;
  /** A Billingo válasz `total` mezője — az adott típusból összesen ennyi bizonylat várható. */
  totalForType: number;
  /** Ha ebből a típusból van még lekérdezendő oldal, ez a cursor a következő csomaghoz — ha a típus kimerült, null. */
  nextCursor: BillingoBatchCursor | null;
}

async function fetchBillingoDocumentPage(
  apiKey: string,
  options: FetchBillingoDocumentsOptions,
  documentType: BillingoDocumentType,
  page: number
): Promise<{ documents: BillingoDocument[]; isLastPage: boolean; total: number }> {
  const params = new URLSearchParams({ page: String(page), per_page: "100", type: documentType });
  if (options.startDate) params.set("start_date", options.startDate);

  const body = (await billingoFetch(apiKey, `/documents?${params.toString()}`)) as {
    data?: unknown[];
    current_page?: number;
    last_page?: number;
    total?: number;
  };
  const data = Array.isArray(body.data) ? body.data : [];
  return {
    documents: data.map((d) => mapDocument(d as Record<string, unknown>)),
    isLastPage: !body.last_page || (body.current_page ?? page) >= body.last_page,
    total: body.total ?? 0,
  };
}

/**
 * Egyetlen, LEHATÁROLT csomagot (`pagesPerBatch` Billingo-oldal, egyenként
 * max. 100 dokumentum, tehát alapból ~200 db) kér le egy adott pozíciótól
 * (`cursor`) kezdve — a `/documents` `type` szűrője EGYETLEN értéket fogad
 * el (nem listát), ezért a hívónak (`runBillingoSyncBatch`, ld. lent)
 * VÉGIG kell mennie a `SYNCED_BILLINGO_DOCUMENT_TYPES` teljes listáján,
 * típusonként külön cursorral.
 *
 * FONTOS: mind a hat típust le kell kérdezni — ha csak `type=invoice`
 * futna, a többi (előleg, helyesbítő, sztornó, nyugta) SOHA nem kerülne be
 * a rendszerbe (ld. docs/tervezes.md 15. fejezet, 2026.08.16-i bővítés).
 *
 * **Csomagolt ÉS lapozáson-átívelően folytatható lekérdezés**: egyetlen
 * HTTP kérésen belül generátorral (`for await`) végigfutó csomagolás
 * megvédene a memóriától, de a teljes szinkron ÖSSZESSÉGÉBEN továbbra is
 * egyetlen HTTP kérés-válasz ciklus maradna — nagy dátumtartománynál ez
 * önmagában túllépné a Cloud Run kérés-időkorlátját. Ez a függvény ezért
 * HTTP KÉRÉSENKÉNT csak EGY csomagot kérdez le és ad vissza
 * (`nextCursor`), amit a hívó (`runBillingoSyncBatch`, `billingoSync.ts`)
 * a KÖVETKEZŐ HTTP kérésnek ad tovább — így egyetlen kérés sem futhat
 * bele az időtúllépésbe, függetlenül a teljes dátumtartomány méretétől.
 * A Billingo válasz `total` mezője (ld. `DocumentList` séma) adja meg
 * előre, hány bizonylat várható típusonként — ehhez NEM kell külön "hány
 * lesz" lekérdezés, az első oldal válasza már tartalmazza.
 */
export async function fetchBillingoDocumentBatch(
  apiKey: string,
  options: FetchBillingoDocumentsOptions,
  cursor: BillingoBatchCursor,
  pagesPerBatch = 2
): Promise<BillingoDocumentBatchResult> {
  const documents: BillingoDocument[] = [];
  let page = cursor.page;
  let totalForType = 0;
  let isLastPage = false;

  for (let i = 0; i < pagesPerBatch; i++) {
    const pageResult = await fetchBillingoDocumentPage(apiKey, options, cursor.documentType, page);
    documents.push(...pageResult.documents);
    totalForType = pageResult.total;
    isLastPage = pageResult.isLastPage;
    if (isLastPage) break;
    page += 1;
  }

  return {
    documents,
    documentType: cursor.documentType,
    totalForType,
    nextCursor: isLastPage ? null : { documentType: cursor.documentType, page: page + 1 },
  };
}

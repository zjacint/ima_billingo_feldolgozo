/**
 * IMA import CSV generálás a kimenő (vevői) számlákhoz — ideiglenes,
 * kézi import útvonal, amíg az API-n (`/api/invoices/sales/add`) keresztüli
 * beküldés nincs élőben megerősítve. Az oszlopnevek és a fájlformátum
 * (pontosvessző, UTF-8 BOM, CRLF) szó szerint megegyezik a testvérprojekt
 * (`<sibling-project-repo>`, bejövő számla oldal) `src/lib/imaExport.ts`
 * moduljával, ami a MEGLÉVŐ, éles n8n workflow Google Sheets-importjának
 * sémáját követi (`workflows/IMA_kulfoldi_szamla_royal_fixed.json`) — az
 * IMA ugyanazt a "Vevő ..." mezőnevű importtáblát használja a bizonylat
 * irányától (vevői/szállítói) függetlenül.
 *
 * Néhány oszlopot (Rendelésszám, Nyelv, Árfolyam bank, Főkönyv vevő /
 * Főkönyv vevő azonosító, a részletes címoszlopok, Magánszemély) SZÁNDÉKOSAN
 * üresen hagyunk — nincs hozzá strukturált adatunk, ezeket a könyvelőnek
 * kell kitöltenie import előtt, ha az IMA-oldali sablon megköveteli.
 */

export const IMA_CSV_COLUMNS = [
  "Számlaszám",
  "Számla típus",
  "Hivatkozási számlaszám",
  "Számla kelte",
  "Telj. időpontja",
  "Fiz. határidő",
  "Fizetés módja",
  "Rendelésszám",
  "Nyelv",
  "Devizanem",
  "Árfolyam bank",
  "Árfolyam",
  "Vevő neve",
  "Vevő irsz.",
  "Vevő város",
  "Vevő utca",
  "Vevő adószám",
  "Nettó összesen",
  "Áfa összesen",
  "Bruttó összesen",
  "Főkönyv vevő",
  "Főkönyv vevő azonosító",
  "Főkönyvi dátum",
  "Termék,szolgáltatás",
  "Mennyiség",
  "Mennyiségi egység",
  "Nettó egységár",
  "Áfakulcs",
  "Tétel nettó érték",
  "Tétel áfa érték",
  "Tétel bruttó érték",
  "Tétel árbevétel főkönyv",
  "Tétel árbevétel áfa",
  "Tétel gazdasági esemény",
  "Tétel áfa gazdasági esemény",
  "Tétel megjegyzés",
  "Tétel árrés áfaalap",
  "Közterület",
  "Közterület jellege",
  "Házszám",
  "Épület",
  "Lépcsoház",
  "Emelet",
  "Ajtó",
  "Országkód",
  "Magánszemély",
] as const;

export type ImaCsvColumn = (typeof IMA_CSV_COLUMNS)[number];
export type ImaCsvRow = Record<ImaCsvColumn, string>;

export function formatHuDate(d: Date | null | undefined): string {
  if (!d) return "";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd}`;
}

/** Tizedesvesszős szám-string, ezres tagolás nélkül (az IMA import ezt fogadja el, ld. testvérprojekt `numberFormat.ts`). */
export function formatHuNumber(value: unknown): string {
  if (value == null) return "";
  const n = Number(value as never);
  if (!Number.isFinite(n)) return "";
  return n.toString().replace(".", ",");
}

export interface ImaCsvExportLine {
  productName: string;
  comment: string | null;
  quantity: number;
  unitOfMeasure: string | null;
  netUnitCost: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  glaCode: string | null;
  vatCode: string | null;
  vatGlaCode: string | null;
}

export interface ImaCsvExportInvoice {
  invoiceNumber: string;
  invoiceType: string;
  docDate: Date | null;
  fulfillmentDate: Date | null;
  vatFulfillmentDate: Date | null;
  dueDate: Date | null;
  paymentMethod: string;
  currencyCode: string;
  exchangeRate: number | null;
  netAmount: number | null;
  vatAmount: number | null;
  grossAmount: number | null;
  partnerName: string | null;
  partnerTaxNumber: string | null;
  partnerPostalCode: string | null;
  partnerCity: string | null;
  partnerAddressStreet: string | null;
  partnerCountryCode: string | null;
  lines: ImaCsvExportLine[];
}

/**
 * Egy számlát annyi CSV sorrá alakít, ahány tétele van — ugyanaz az elv,
 * mint a testvérprojekt `buildExportRows`-ában: az IMA import egy sor =
 * egy tétel, a fejléc-adatok minden sorban megismétlődnek.
 */
export function buildImaCsvRows(
  invoice: ImaCsvExportInvoice,
  parseAdvanceReferenceNumber: (comment: string | null) => string | null
): ImaCsvRow[] {
  return invoice.lines.map((line) => {
    const row: ImaCsvRow = Object.fromEntries(IMA_CSV_COLUMNS.map((c) => [c, ""])) as ImaCsvRow;

    row["Számlaszám"] = invoice.invoiceNumber;
    row["Számla típus"] = invoice.invoiceType;
    row["Hivatkozási számlaszám"] = parseAdvanceReferenceNumber(line.comment) ?? "";
    row["Számla kelte"] = formatHuDate(invoice.docDate);
    row["Telj. időpontja"] = formatHuDate(invoice.vatFulfillmentDate ?? invoice.fulfillmentDate);
    row["Fiz. határidő"] = formatHuDate(invoice.dueDate);
    row["Fizetés módja"] = invoice.paymentMethod;
    row["Devizanem"] = invoice.currencyCode;
    row["Árfolyam"] = invoice.exchangeRate != null ? formatHuNumber(invoice.exchangeRate) : "";
    row["Vevő neve"] = invoice.partnerName ?? "";
    row["Vevő irsz."] = invoice.partnerPostalCode ?? "";
    row["Vevő város"] = invoice.partnerCity ?? "";
    row["Vevő utca"] = invoice.partnerAddressStreet ?? "";
    row["Vevő adószám"] = invoice.partnerTaxNumber ?? "";
    row["Nettó összesen"] = formatHuNumber(invoice.netAmount);
    row["Áfa összesen"] = formatHuNumber(invoice.vatAmount);
    row["Bruttó összesen"] = formatHuNumber(invoice.grossAmount);
    row["Főkönyvi dátum"] = formatHuDate(invoice.docDate);
    row["Termék,szolgáltatás"] = line.productName;
    row["Mennyiség"] = formatHuNumber(line.quantity);
    row["Mennyiségi egység"] = line.unitOfMeasure ?? "";
    row["Nettó egységár"] = formatHuNumber(line.netUnitCost);
    row["Áfakulcs"] = line.vatCode ?? "";
    row["Tétel nettó érték"] = formatHuNumber(line.netAmount);
    row["Tétel áfa érték"] = formatHuNumber(line.vatAmount);
    row["Tétel bruttó érték"] = formatHuNumber(line.grossAmount);
    row["Tétel árbevétel főkönyv"] = line.glaCode ?? "";
    row["Tétel árbevétel áfa"] = line.vatGlaCode ?? "";
    row["Tétel gazdasági esemény"] = line.productName;
    row["Tétel megjegyzés"] = line.comment ?? "";
    row["Országkód"] = invoice.partnerCountryCode ?? "";

    return row;
  });
}

function escapeCsvValue(value: string): string {
  if (value.includes(";") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Pontosvesszős CSV, UTF-8 BOM-mal és CRLF sortöréssel (az IMA import ezt várja). */
export function imaCsvRowsToCsv(rows: ImaCsvRow[]): string {
  const lines = [IMA_CSV_COLUMNS.join(";")];
  for (const row of rows) {
    lines.push(IMA_CSV_COLUMNS.map((c) => escapeCsvValue(row[c])).join(";"));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

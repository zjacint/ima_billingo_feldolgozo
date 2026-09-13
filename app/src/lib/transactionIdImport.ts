/**
 * Tranzakcióazonosító import CSV — ld. docs/tervezes.md 17. fejezet,
 * könyvelői kérés (2026.08.23): a felismert Stripe-tranzakcióazonosítót
 * (ld. paymentTransactionDetection.ts) csak az IMA-oldali SZÁMLA SOR
 * azonosítójával (`ImaSalesAnalyticsRow.lineId`) párosítva lehet
 * ténylegesen felhasználni — ezért a beküldés (CSV export) UTÁN, a
 * ténylegesen könyvelt (`booked`) számlákra, élőben lekérdezzük az
 * `/invoiceanalytics`-ot, és ebből a sor-azonosítót a felismert
 * tranzakcióazonosítóval párosítva adjuk ki külön fájlban.
 */

const CSV_HEADER = ["Szamla_sor_azonosito", "Tranzakciószám"];

export interface TransactionIdImportRow {
  salesLineId: number;
  transactionId: string;
}

function escapeCsvField(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function transactionIdImportRowsToCsv(rows: TransactionIdImportRow[]): string {
  const lines = [CSV_HEADER.join(";")];
  for (const r of rows) {
    lines.push([String(r.salesLineId), r.transactionId].map(escapeCsvField).join(";"));
  }
  return lines.join("\n");
}

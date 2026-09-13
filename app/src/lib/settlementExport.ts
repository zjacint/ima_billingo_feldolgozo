/**
 * Kiegyenlítési (fizetési tranzakcióazonosító) export — ld.
 * paymentTransactionDetection.ts, docs/tervezes.md 13. fejezet. A felismert
 * tranzakcióazonosítót tartalmazó számlákat egy KÜLÖN CSV-be gyűjti (nem az
 * IMA importba), amit a könyvelő a Stripe (vagy más szolgáltató) kivonata
 * ellen egyeztethet.
 */

import { prisma } from "./db";

const CSV_HEADER = ["Szamla_szam", "Datum", "Partner", "Osszeg", "Devizanem", "Tranzakcio_azonosito", "Szolgaltato"];

export interface SettlementExportRow {
  billingoDocumentNumber: string;
  docDate: string | null;
  partnerName: string | null;
  grossAmount: number | null;
  currencyCode: string;
  transactionId: string;
  processor: string;
}

function escapeCsvField(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function settlementRowsToCsv(rows: SettlementExportRow[]): string {
  const lines = [CSV_HEADER.join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.billingoDocumentNumber,
        r.docDate ?? "",
        r.partnerName ?? "",
        r.grossAmount != null ? String(r.grossAmount) : "",
        r.currencyCode,
        r.transactionId,
        r.processor,
      ]
        .map((v) => escapeCsvField(String(v)))
        .join(";")
    );
  }
  return lines.join("\n");
}

export interface RecurringPartnerStat {
  partnerId: string;
  partnerName: string;
  totalInvoices: number;
  detectedInvoices: number;
  ratio: number;
}

const RECURRING_MIN_COUNT = 2;
const RECURRING_MIN_RATIO = 0.5;

/**
 * Mely partnereknél fordul elő RENDSZERESEN tranzakcióazonosító-jellegű
 * megjegyzés — ld. docs/tervezes.md 13. fejezet, könyvelői ötlet
 * (2026.08.16): "ha a számláknál rendszeresen látunk ilyen jellegű
 * információt, akkor feltételezhetjük, hogy ez akár a kiegyenlítésre is
 * vonatkozhat". Kizárólag JELZÉSRE szolgál a Számlák oldalon — nem állít be
 * automatikusan semmit, a könyvelő dönti el, hogy egy adott partner minden
 * jövőbeli számláját kiegyenlítés-relevánsnak tekinti-e.
 */
export async function findRecurringSettlementPartners(companyId: string): Promise<RecurringPartnerStat[]> {
  const invoices = await prisma.invoice.findMany({
    where: { companyId, partnerId: { not: null } },
    select: { partnerId: true, partner: { select: { name: true } }, detectedPaymentTransactionId: true },
  });

  const byPartner = new Map<string, { name: string; total: number; detected: number }>();
  for (const inv of invoices) {
    if (!inv.partnerId) continue;
    const entry = byPartner.get(inv.partnerId) ?? { name: inv.partner?.name ?? "—", total: 0, detected: 0 };
    entry.total += 1;
    if (inv.detectedPaymentTransactionId) entry.detected += 1;
    byPartner.set(inv.partnerId, entry);
  }

  const result: RecurringPartnerStat[] = [];
  for (const [partnerId, e] of byPartner) {
    const ratio = e.total > 0 ? e.detected / e.total : 0;
    if (e.detected >= RECURRING_MIN_COUNT && ratio >= RECURRING_MIN_RATIO) {
      result.push({ partnerId, partnerName: e.name, totalInvoices: e.total, detectedInvoices: e.detected, ratio });
    }
  }
  return result.sort((a, b) => b.ratio - a.ratio);
}

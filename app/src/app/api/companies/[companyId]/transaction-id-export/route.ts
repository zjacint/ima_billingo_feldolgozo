import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { prisma } from "@/lib/db";
import { fetchImaSalesInvoiceAnalytics } from "@/lib/imaApiClient";
import { transactionIdImportRowsToCsv, type TransactionIdImportRow } from "@/lib/transactionIdImport";

const schema = z.object({ invoiceIds: z.array(z.string()).min(1) });

/**
 * A felismert Stripe-tranzakcióazonosítót az IMA-oldali SZÁMLA SOR
 * azonosítójával (`/invoiceanalytics` `lineID`) párosítva adja ki CSV-ben
 * — ld. transactionIdImport.ts, docs/tervezes.md 17. fejezet. Csak
 * `booked` (ténylegesen IMA-ban könyvelt) számlákra értelmezhető, mert az
 * `/invoiceanalytics` csak a már ténylegesen létrejött IMA-oldali
 * könyvelési tételeket adja vissza.
 */
export async function POST(req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }

    const company = await prisma.company.findUniqueOrThrow({ where: { id: params.companyId } });
    if (!company.imaApiKey || !company.imaApiUser || !company.imaApiCompany) {
      return NextResponse.json({ error: "A céghez nincs teljesen kitöltve az IMA API kapcsolat." }, { status: 400 });
    }

    const invoices = await prisma.invoice.findMany({
      where: { id: { in: parsed.data.invoiceIds }, companyId: params.companyId },
    });

    const skipped: { invoiceId: string; billingoDocumentNumber: string | null; reason: string }[] = [];
    const candidates = invoices.filter((inv) => {
      if (inv.status !== "booked") {
        skipped.push({ invoiceId: inv.id, billingoDocumentNumber: inv.billingoDocumentNumber, reason: "Nincs még könyvelve IMA-ban." });
        return false;
      }
      if (!inv.detectedPaymentTransactionId) {
        skipped.push({ invoiceId: inv.id, billingoDocumentNumber: inv.billingoDocumentNumber, reason: "Nincs felismert tranzakcióazonosító." });
        return false;
      }
      if (!inv.billingoDocumentNumber) {
        skipped.push({ invoiceId: inv.id, billingoDocumentNumber: null, reason: "Nincs számlaszám." });
        return false;
      }
      return true;
    });

    const rows: TransactionIdImportRow[] = [];
    const exportedInvoiceIds: string[] = [];

    if (candidates.length > 0) {
      // A lekérdezést a kijelölt számlák kelt-tartományára szűkítjük — ne
      // kelljen a cég teljes historikus /invoiceanalytics adatát lehúzni
      // csak néhány számla sor-azonosítójáért.
      const docDates = candidates.map((inv) => inv.docDate).filter((d): d is Date => d != null);
      const fromDate = docDates.length > 0 ? new Date(Math.min(...docDates.map((d) => d.getTime()))) : undefined;
      const untilDate = docDates.length > 0 ? new Date(Math.max(...docDates.map((d) => d.getTime()))) : undefined;

      const analyticsRows = await fetchImaSalesInvoiceAnalytics(
        { apiKey: company.imaApiKey, user: company.imaApiUser, company: company.imaApiCompany },
        {
          fromDate: fromDate ? fromDate.toISOString().slice(0, 10) : undefined,
          untilDate: untilDate ? untilDate.toISOString().slice(0, 10) : undefined,
        }
      );
      const lineIdsByInvoiceNo = new Map<string, number[]>();
      for (const row of analyticsRows) {
        if (!row.invoiceNo || row.lineId == null) continue;
        const key = row.invoiceNo.trim().toLowerCase();
        const list = lineIdsByInvoiceNo.get(key) ?? [];
        list.push(row.lineId);
        lineIdsByInvoiceNo.set(key, list);
      }

      for (const inv of candidates) {
        const lineIds = lineIdsByInvoiceNo.get(inv.billingoDocumentNumber!.trim().toLowerCase());
        if (!lineIds || lineIds.length === 0) {
          skipped.push({
            invoiceId: inv.id,
            billingoDocumentNumber: inv.billingoDocumentNumber,
            reason: "Nem található az IMA /invoiceanalytics adatban (még nem indexelte IMA, próbáld később).",
          });
          continue;
        }
        for (const lineId of lineIds) {
          rows.push({ salesLineId: lineId, transactionId: inv.detectedPaymentTransactionId! });
        }
        exportedInvoiceIds.push(inv.id);
      }
    }

    if (exportedInvoiceIds.length > 0) {
      await prisma.invoice.updateMany({
        where: { id: { in: exportedInvoiceIds } },
        data: { settlementExportedAt: new Date() },
      });
    }

    const csv = transactionIdImportRowsToCsv(rows);
    const headers = new Headers({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tranzakcio-azonosito-import-${new Date().toISOString().slice(0, 10)}.csv"`,
      "X-Skipped-Count": String(skipped.length),
    });
    if (skipped.length > 0) {
      headers.set("X-Skipped-Invoices", encodeURIComponent(JSON.stringify(skipped)));
    }
    return new NextResponse(csv, { status: 200, headers });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : message }, { status });
  }
}

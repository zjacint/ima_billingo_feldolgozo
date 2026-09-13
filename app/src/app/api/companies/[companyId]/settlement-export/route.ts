import { NextResponse } from "next/server";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { prisma } from "@/lib/db";
import { settlementRowsToCsv, type SettlementExportRow } from "@/lib/settlementExport";

/**
 * A még nem exportált, felismert fizetési tranzakcióazonosítójú számlákat
 * gyűjti egy kiegyenlítési CSV-be, és megjelöli őket exportáltnak — ld.
 * settlementExport.ts, docs/tervezes.md 13. fejezet. Nem érinti a számla
 * IMA-beküldési állapotát/adatait.
 */
export async function POST(_req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);

    const invoices = await prisma.invoice.findMany({
      where: { companyId: params.companyId, detectedPaymentTransactionId: { not: null }, settlementExportedAt: null },
      include: { partner: true },
      orderBy: { docDate: "asc" },
    });

    const rows: SettlementExportRow[] = invoices.map((inv) => ({
      billingoDocumentNumber: inv.billingoDocumentNumber ?? inv.billingoDocumentId,
      docDate: inv.docDate ? inv.docDate.toISOString().slice(0, 10) : null,
      partnerName: inv.partner?.name ?? null,
      grossAmount: inv.grossAmount != null ? Number(inv.grossAmount) : null,
      currencyCode: inv.currencyCode,
      transactionId: inv.detectedPaymentTransactionId!,
      processor: inv.detectedPaymentProcessor ?? "ismeretlen",
    }));

    if (invoices.length > 0) {
      await prisma.invoice.updateMany({
        where: { id: { in: invoices.map((i) => i.id) } },
        data: { settlementExportedAt: new Date() },
      });
    }

    const csv = settlementRowsToCsv(rows);
    const headers = new Headers({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kiegyenlites-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
    return new NextResponse(csv, { status: 200, headers });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

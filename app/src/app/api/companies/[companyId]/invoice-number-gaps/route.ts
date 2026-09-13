import { NextResponse } from "next/server";
import { requireCompanyMembership, errorToResponseInit } from "@/lib/access";
import { prisma } from "@/lib/db";
import { findInvoiceNumberGaps } from "@/lib/invoiceNumberGaps";

/**
 * A cég összes szinkronizált számlaszámát megvizsgálja, hiányzó
 * sorszámokat keres prefixenként (számlatömbönként) — ld.
 * invoiceNumberGaps.ts, docs/tervezes.md 14. fejezet. Csak olvas.
 */
export async function POST(_req: Request, { params }: { params: { companyId: string } }) {
  try {
    await requireCompanyMembership(params.companyId);

    const invoices = await prisma.invoice.findMany({
      where: { companyId: params.companyId, billingoDocumentNumber: { not: null } },
      select: { billingoDocumentNumber: true },
    });
    const documentNumbers = invoices.map((i) => i.billingoDocumentNumber!).filter(Boolean);
    const groups = findInvoiceNumberGaps(documentNumbers);

    return NextResponse.json({ checkedCount: documentNumbers.length, groups });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

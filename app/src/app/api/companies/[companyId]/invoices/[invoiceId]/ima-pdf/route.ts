import { NextResponse } from "next/server";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { prisma } from "@/lib/db";
import { fetchImaInvoicePdf } from "@/lib/imaApiClient";

/**
 * Egy már beküldött (`booked`) számla IMA-oldali PDF-jét kéri vissza
 * ellenőrzésre — ld. docs/tervezes.md 13. fejezet, "IMA-beküldés
 * ellenőrzése". Csak olvas, semmit nem módosít.
 */
export async function GET(_req: Request, { params }: { params: { companyId: string; invoiceId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: params.invoiceId },
      include: { company: true },
    });
    if (invoice.companyId !== params.companyId) {
      return NextResponse.json({ error: "A számla nem ehhez a céghez tartozik." }, { status: 404 });
    }
    if (invoice.imaSalesheaderId == null) {
      return NextResponse.json({ error: "A számlának nincs ismert IMA azonosítója (még nem lett sikeresen beküldve)." }, { status: 400 });
    }
    const { company } = invoice;
    if (!company.imaApiKey || !company.imaApiUser || !company.imaApiCompany) {
      return NextResponse.json({ error: "A céghez nincs teljesen kitöltve az IMA API kapcsolat." }, { status: 400 });
    }

    const pdf = await fetchImaInvoicePdf(
      { apiKey: company.imaApiKey, user: company.imaApiUser, company: company.imaApiCompany },
      invoice.imaSalesheaderId
    );

    return new NextResponse(new Uint8Array(pdf.buffer), {
      status: 200,
      headers: {
        "Content-Type": pdf.contentType,
        "Content-Disposition": `attachment; filename="ima-${invoice.billingoDocumentNumber ?? invoice.billingoDocumentId}.pdf"`,
      },
    });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : message }, { status });
  }
}

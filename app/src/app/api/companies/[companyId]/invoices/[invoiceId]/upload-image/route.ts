import { NextResponse } from "next/server";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { retryInvoiceImageUpload, ValidationError } from "@/lib/invoiceWorkflow";

export async function POST(_req: Request, { params }: { params: { companyId: string; invoiceId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const invoice = await retryInvoiceImageUpload(params.invoiceId);
    return NextResponse.json(invoice);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

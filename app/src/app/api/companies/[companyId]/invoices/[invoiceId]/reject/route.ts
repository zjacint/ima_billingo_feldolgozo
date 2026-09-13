import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { rejectInvoice, unrejectInvoice, ValidationError } from "@/lib/invoiceWorkflow";

const schema = z.object({ reason: z.string().min(1) });

export async function POST(req: Request, { params }: { params: { companyId: string; invoiceId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Az elutasítás indoklása kötelező." }, { status: 400 });
    }
    const invoice = await rejectInvoice(session.user.id, params.invoiceId, parsed.data.reason);
    return NextResponse.json(invoice);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: { companyId: string; invoiceId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const invoice = await unrejectInvoice(params.invoiceId);
    return NextResponse.json(invoice);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

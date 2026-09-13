import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { approveInvoice, ValidationError } from "@/lib/invoiceWorkflow";
import type { InvoiceLine } from "@/lib/types";

const lineSchema = z.object({
  productName: z.string(),
  comment: z.string().nullable(),
  quantity: z.number(),
  unitOfMeasure: z.string().nullable(),
  netUnitCost: z.number(),
  vatPercentOrCode: z.string(),
  netAmount: z.number(),
  vatAmount: z.number(),
  grossAmount: z.number(),
  suggestedGlaCode: z.string().nullable(),
  suggestedVatCode: z.string().nullable(),
  suggestedVatGlaCode: z.string().nullable(),
  suggestedAmountSign: z.enum(["original", "negative"]).nullable(),
  suggestedRuleSource: z.enum(["learned_invoiceanalytics", "manual", "vat_mapping", "advance_reference"]).nullable(),
  suggestedRuleId: z.string().nullable(),
  suggestedRuleSummary: z.string().nullable(),
  // `.optional()` is: régebbi, e mezők bevezetése ELŐTT szinkronizált
  // számlák tárolt `lines` JSON-jából hiányozhat a kulcs (nem null, hanem
  // nincs is jelen) — a legközelebbi szinkron/újraszámolás pótolja.
  suggestedInexactMatchField: z.enum(["productNamePattern", "vatPattern"]).nullable().optional(),
  suggestedInexactMatchValue: z.string().nullable().optional(),
  approvedGlaCode: z.string().nullable(),
  approvedVatCode: z.string().nullable(),
  approvedVatGlaCode: z.string().nullable(),
  approvedAmountSign: z.enum(["original", "negative"]).nullable(),
});

const schema = z.object({
  lines: z.array(lineSchema),
  // "YYYY-MM-DD" — kézzel felülírt ÁFA teljesítés dátum, KÜLÖN a Billingo
  // eredeti teljesítés dátumától — ld. docs/tervezes.md 8.2.
  vatFulfillmentDateOverride: z.string().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: { companyId: string; invoiceId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const invoice = await approveInvoice(
      session.user.id,
      params.invoiceId,
      parsed.data.lines as InvoiceLine[],
      parsed.data.vatFulfillmentDateOverride !== undefined
        ? parsed.data.vatFulfillmentDateOverride
          ? new Date(parsed.data.vatFulfillmentDateOverride)
          : null
        : undefined
    );
    return NextResponse.json(invoice);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

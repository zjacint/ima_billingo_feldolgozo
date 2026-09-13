import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { bulkSetInvoiceLineMapping } from "@/lib/invoiceWorkflow";

// Tömeges kontír/áfa beállítás a Számlák oldalon kijelölt számlákra — ld.
// docs/tervezes.md 10. fejezet. MINDEN mező opcionális — a kliens csak
// azokat küldi, amiket ténylegesen módosítani akar (ugyanaz az elv, mint
// a Kontír/áfa szabályok csoportos módosítása).
const schema = z.object({
  invoiceIds: z.array(z.string()).min(1),
  data: z.object({
    glaCode: z.string().min(1).optional(),
    vatCode: z.string().min(1).optional(),
    vatGlaCode: z.string().nullable().optional(),
    amountSign: z.enum(["original", "negative"]).optional(),
  }),
});

export async function POST(req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    if (Object.keys(parsed.data.data).length === 0) {
      return NextResponse.json({ error: "Legalább egy mezőt meg kell adni a módosításhoz." }, { status: 400 });
    }
    const results = await bulkSetInvoiceLineMapping(parsed.data.invoiceIds, parsed.data.data);
    return NextResponse.json({ results });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

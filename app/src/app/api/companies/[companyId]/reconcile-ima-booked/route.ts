import { NextResponse } from "next/server";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { reconcileBookedInvoicesWithIma } from "@/lib/invoiceWorkflow";

/**
 * A helyileg "könyvelt" (`booked`) számlák IMA-oldali tényleges meglétét
 * ellenőrzi, és visszaállítja `approved`-re, amit nem talál — ld.
 * `reconcileBookedInvoicesWithIma` (invoiceWorkflow.ts) doksztringje,
 * docs/tervezes.md 22. fejezet. Egyetlen kéréssel fut (a `/gladetails`
 * lekérdezés dátumtartományra szűkített, nem soronkénti), nem a
 * csomagolt/folytatható mintát követi, mint a Billingo-szinkron.
 */
export async function POST(_req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const result = await reconcileBookedInvoicesWithIma(params.companyId);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : message }, { status });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { runRecomputeSuggestionsBatch, type RecomputeSuggestionsCursor } from "@/lib/invoiceWorkflow";

const schema = z.object({ cursor: z.record(z.unknown()).nullable().optional() });

/**
 * EGY csomagot (20 számla) dolgoz fel kérésenként, hogy elkerüljük a
 * nagyszámú számlán 504 timeout-ot — ld. `runRecomputeSuggestionsBatch`
 * (invoiceWorkflow.ts) doksztringje, docs/tervezes.md 9.4. A kliens
 * (SyncControls.tsx) a válaszban kapott `cursor`-t adja vissza a következő
 * hívásnak, amíg `done: true` nem érkezik.
 */
export async function POST(req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const cursor = (parsed.data.cursor ?? null) as RecomputeSuggestionsCursor | null;
    const step = await runRecomputeSuggestionsBatch(params.companyId, cursor);
    return NextResponse.json(step);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

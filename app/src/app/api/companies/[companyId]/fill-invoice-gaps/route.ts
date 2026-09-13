import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { runGapFillBatch, type GapFillCursor } from "@/lib/billingoSync";

// A cursor a kliensnél (SyncControls.tsx) utazik kérésről kérésre — ld.
// /api/companies/[companyId]/sync/route.ts ugyanezen mintája.
const schema = z.object({ cursor: z.record(z.unknown()).nullable().optional() });

/**
 * EGY csomagnyi (`GAP_FILL_RANGES_PER_BATCH` tartomány) hiányzó számlaszám-
 * tartományt kérdez le célzottan Billingo-tól kérésenként — ld.
 * `runGapFillBatch` (billingoSync.ts) doksztringje, docs/tervezes.md 16.
 * fejezet. A kliens a válaszban kapott `cursor`-t adja vissza a következő
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
    const cursor = (parsed.data.cursor ?? null) as GapFillCursor | null;
    const step = await runGapFillBatch(params.companyId, cursor);
    return NextResponse.json(step);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : message }, { status });
  }
}

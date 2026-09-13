import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { runBillingoSyncBatch, type BillingoSyncCursor } from "@/lib/billingoSync";

// A cursor a kliensnél (SyncControls.tsx) utazik kérésről kérésre — nem kell
// szigorú validáció, csak annyi, hogy JSON objektum legyen (a szerver úgyis
// felülírja/ellenőrzi a benne lévő mezőket a saját logikájával).
const schema = z.object({ cursor: z.record(z.unknown()).nullable().optional() });

/**
 * EGY szinkron-csomagot (~200 bizonylat) dolgoz fel kérésenként, hogy
 * hosszabb dátumtartománynál se fusson bele egyetlen kérés sem a Cloud Run
 * időtúllépésébe (504) — ld. `runBillingoSyncBatch` (billingoSync.ts)
 * doksztringje, docs/tervezes.md 7. fejezet. A kliens (SyncControls.tsx) a
 * válaszban kapott `cursor`-t adja vissza a következő hívásnak, amíg
 * `done: true` nem érkezik.
 */
export async function POST(req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const cursor = (parsed.data.cursor ?? null) as BillingoSyncCursor | null;
    const step = await runBillingoSyncBatch(params.companyId, cursor);
    return NextResponse.json(step);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : message }, { status });
  }
}

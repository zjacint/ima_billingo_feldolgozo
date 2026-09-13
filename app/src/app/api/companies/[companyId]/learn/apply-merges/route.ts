import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { applyPendingRuleMerges } from "@/lib/mappingRuleEngine";

const schema = z.object({
  merges: z.array(
    z.object({
      manualRuleId: z.string().min(1),
      field: z.enum(["productNamePattern", "vatPattern"]),
      valuesToAdd: z.array(z.string().min(1)),
    })
  ),
});

/**
 * A "Szabályok tanulása" gomb által jelzett, kézi szabállyal ütköző
 * termékek explicit könyvelői jóváhagyás utáni összevonása — ld.
 * mappingRuleEngine.ts `applyPendingRuleMerges`.
 */
export async function POST(req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const result = await applyPendingRuleMerges(params.companyId, session.user.id, parsed.data.merges);
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

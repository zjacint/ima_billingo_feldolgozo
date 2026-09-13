import { NextResponse } from "next/server";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { findPendingRuleExpansions } from "@/lib/mappingRuleEngine";

/**
 * A már kiszámolt, eltárolt "csak részleges egyezéssel talált rá a
 * szabály" jelzők alapján kézi szabály-bővítési javaslatokat ad vissza —
 * ld. mappingRuleEngine.ts `findPendingRuleExpansions`.
 */
export async function POST(_req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const pendingMerges = await findPendingRuleExpansions(params.companyId);
    return NextResponse.json({ pendingMerges });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { prisma } from "@/lib/db";

const schema = z.object({ ruleIds: z.array(z.string()).min(1) });

export async function POST(req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    // companyId is scoped explicitly so a rule from another company can't be deleted this way.
    const { count } = await prisma.mappingRule.deleteMany({
      where: { id: { in: parsed.data.ruleIds }, companyId: params.companyId },
    });
    return NextResponse.json({ deleted: count });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

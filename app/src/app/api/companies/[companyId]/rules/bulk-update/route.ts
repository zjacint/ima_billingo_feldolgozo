import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { prisma } from "@/lib/db";

// Csoportos módosítás a Kontír/áfa szabályok oldalon kijelölt szabályokra —
// ld. docs/tervezes.md 10. fejezet. MINDEN mező opcionális — a kliens
// csak azokat a mezőket küldi, amiket ténylegesen módosítani akar (a
// többi szabály értéke érintetlen marad, ld. RulesEditor.tsx
// BulkEditModal).
const schema = z.object({
  ruleIds: z.array(z.string()).min(1),
  data: z.object({
    glaCode: z.string().min(1).optional(),
    vatCode: z.string().min(1).optional(),
    vatGlaCode: z.string().nullable().optional(),
    amountSign: z.enum(["original", "negative"]).optional(),
    active: z.boolean().optional(),
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
    const { count } = await prisma.mappingRule.updateMany({
      where: { id: { in: parsed.data.ruleIds }, companyId: params.companyId },
      data: { ...parsed.data.data, updatedById: session.user.id },
    });
    return NextResponse.json({ updated: count });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

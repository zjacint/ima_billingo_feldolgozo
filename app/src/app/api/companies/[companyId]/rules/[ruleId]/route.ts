import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";

const schema = z.object({
  partnerId: z.string().nullable().optional(),
  productNamePattern: z.string().nullable().optional(),
  commentPattern: z.string().nullable().optional(),
  documentTypePattern: z.string().nullable().optional(),
  vatPattern: z.string().nullable().optional(),
  glaCode: z.string().min(1).optional(),
  vatCode: z.string().min(1).optional(),
  vatGlaCode: z.string().nullable().optional(),
  amountSign: z.enum(["original", "negative"]).optional(),
  note: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { companyId: string; ruleId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const existing = await prisma.mappingRule.findUniqueOrThrow({ where: { id: params.ruleId } });
    const merged = { ...existing, ...parsed.data };
    // 9.1: legalább egy feltétel megadása kötelező szerkesztés után is —
    // enélkül a szabály minden sorra illeszkedne.
    if (
      !merged.partnerId &&
      !merged.productNamePattern &&
      !merged.commentPattern &&
      !merged.documentTypePattern &&
      !merged.vatPattern
    ) {
      return NextResponse.json(
        { error: "Legalább egy feltétel megadása kötelező (partner, termékminta, megjegyzés, bizonylattípus vagy áfa minta)." },
        { status: 400 }
      );
    }
    const rule = await prisma.mappingRule.update({
      where: { id: params.ruleId },
      data: { ...parsed.data, updatedById: session.user.id },
    });
    return NextResponse.json(rule);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_req: Request, { params }: { params: { companyId: string; ruleId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    await prisma.mappingRule.delete({ where: { id: params.ruleId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { MappingRuleSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";

export async function GET(_req: Request, { params }: { params: { companyId: string } }) {
  try {
    await requireCompanyMembership(params.companyId);
    const rules = await prisma.mappingRule.findMany({
      where: { companyId: params.companyId },
      include: { partner: true },
      orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
    });
    return NextResponse.json(rules);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

const schema = z.object({
  partnerId: z.string().nullable().optional(),
  productNamePattern: z.string().nullable().optional(),
  commentPattern: z.string().nullable().optional(),
  documentTypePattern: z.string().nullable().optional(),
  vatPattern: z.string().nullable().optional(),
  glaCode: z.string().min(1),
  vatCode: z.string().min(1),
  vatGlaCode: z.string().nullable().optional(),
  amountSign: z.enum(["original", "negative"]).optional(),
  note: z.string().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const d = parsed.data;
    // A 9.1 fejezet szerint legalább egy feltétel megadása kötelező —
    // enélkül a szabály minden sorra illeszkedne.
    if (!d.partnerId && !d.productNamePattern && !d.commentPattern && !d.documentTypePattern && !d.vatPattern) {
      return NextResponse.json(
        { error: "Legalább egy feltétel megadása kötelező (partner, termékminta, megjegyzés, bizonylattípus vagy áfa minta)." },
        { status: 400 }
      );
    }
    const rule = await prisma.mappingRule.create({
      data: {
        companyId: params.companyId,
        partnerId: d.partnerId ?? null,
        productNamePattern: d.productNamePattern ?? null,
        commentPattern: d.commentPattern ?? null,
        documentTypePattern: d.documentTypePattern ?? null,
        vatPattern: d.vatPattern ?? null,
        glaCode: d.glaCode,
        vatCode: d.vatCode,
        vatGlaCode: d.vatGlaCode ?? null,
        amountSign: d.amountSign ?? "original",
        note: d.note ?? null,
        source: MappingRuleSource.manual,
        updatedById: session.user.id,
      },
    });
    return NextResponse.json(rule, { status: 201 });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

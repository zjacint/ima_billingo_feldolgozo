import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";

export async function GET(_req: Request, { params }: { params: { companyId: string } }) {
  try {
    await requireCompanyMembership(params.companyId);
    const mappings = await prisma.vatCodeMapping.findMany({
      where: { companyId: params.companyId },
      orderBy: { billingoVatValue: "asc" },
    });
    return NextResponse.json(mappings);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

const schema = z.object({
  billingoVatValue: z.string().min(1),
  imaVatCode: z.string().min(1),
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
    const mapping = await prisma.vatCodeMapping.create({
      data: {
        companyId: params.companyId,
        billingoVatValue: parsed.data.billingoVatValue.trim(),
        imaVatCode: parsed.data.imaVatCode.trim(),
        note: parsed.data.note ?? null,
      },
    });
    return NextResponse.json(mapping, { status: 201 });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";

const schema = z.object({
  billingoVatValue: z.string().min(1).optional(),
  imaVatCode: z.string().min(1).optional(),
  note: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { companyId: string; vatMappingId: string } }
) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const data = { ...parsed.data };
    if (data.billingoVatValue) data.billingoVatValue = data.billingoVatValue.trim();
    if (data.imaVatCode) data.imaVatCode = data.imaVatCode.trim();
    const mapping = await prisma.vatCodeMapping.update({
      where: { id: params.vatMappingId },
      data,
    });
    return NextResponse.json(mapping);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { companyId: string; vatMappingId: string } }
) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    await prisma.vatCodeMapping.delete({ where: { id: params.vatMappingId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

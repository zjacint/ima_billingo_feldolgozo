import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";

const schema = z.object({
  countryCode: z.string().min(2).max(2).optional(),
  billingoVatValue: z.string().min(1).optional(),
  imaVatCode: z.string().min(1).optional(),
  note: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { companyId: string; ossMappingId: string } }
) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const data = { ...parsed.data };
    if (data.countryCode) data.countryCode = data.countryCode.trim().toUpperCase();
    if (data.billingoVatValue) data.billingoVatValue = data.billingoVatValue.trim();
    if (data.imaVatCode) data.imaVatCode = data.imaVatCode.trim();
    const mapping = await prisma.ossVatCodeMapping.update({
      where: { id: params.ossMappingId },
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
  { params }: { params: { companyId: string; ossMappingId: string } }
) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    await prisma.ossVatCodeMapping.delete({ where: { id: params.ossMappingId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

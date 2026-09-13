import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { prisma } from "@/lib/db";

const schema = z.object({ imaPartnerCode: z.string() });

export async function PATCH(req: Request, { params }: { params: { companyId: string; partnerId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const partner = await prisma.partner.findFirst({
      where: { id: params.partnerId, companyId: params.companyId },
    });
    if (!partner) {
      return NextResponse.json({ error: "Partner nem található." }, { status: 404 });
    }
    const updated = await prisma.partner.update({
      where: { id: partner.id },
      data: { imaPartnerCode: parsed.data.imaPartnerCode || null },
    });
    return NextResponse.json(updated);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

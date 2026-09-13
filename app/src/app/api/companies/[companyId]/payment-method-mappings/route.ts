import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";

const schema = z.object({
  billingoPaymentMethod: z.string().min(1),
  // Üres string = a párosítás törlése (vissza "nincs beállítva"-ra).
  imaPaymentMethodDesc: z.string(),
});

/**
 * Upsert egy fizetési mód-megfeleltetésre — fix kulcskészlet (a
 * `mapBillingoPaymentMethodToIma` öt normalizált értéke), ezért nincs
 * külön create/delete végpont, csak ez az egy PATCH: üres
 * `imaPaymentMethodDesc` törli a sort, egyébként upsertál.
 */
export async function PATCH(req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const { billingoPaymentMethod, imaPaymentMethodDesc } = parsed.data;

    if (!imaPaymentMethodDesc.trim()) {
      await prisma.paymentMethodMapping.deleteMany({
        where: { companyId: params.companyId, billingoPaymentMethod },
      });
      return NextResponse.json({ ok: true });
    }

    const mapping = await prisma.paymentMethodMapping.upsert({
      where: { companyId_billingoPaymentMethod: { companyId: params.companyId, billingoPaymentMethod } },
      create: { companyId: params.companyId, billingoPaymentMethod, imaPaymentMethodDesc: imaPaymentMethodDesc.trim() },
      update: { imaPaymentMethodDesc: imaPaymentMethodDesc.trim() },
    });
    return NextResponse.json(mapping);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

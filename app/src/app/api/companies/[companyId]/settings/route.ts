import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";

const schema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(["active", "paused"]).optional(),
  billingoApiKey: z.string().optional(),
  // "YYYY-MM-DD" vagy üres string (törlés) — ld. docs/tervezes.md 7. fejezet.
  billingoSyncFromDate: z.string().optional(),
  useMnbExchangeRate: z.boolean().optional(),
  exchangeRateBank: z.string().optional(),
  imaApiKey: z.string().optional(),
  imaApiUser: z.string().optional(),
  imaApiCompany: z.string().optional(),
  // Üres string = törlés (visszaáll az automatikus levezetésre) — ld.
  // mappingRuleEngine.ts `resolvePrimaryAdvanceGlaCode`.
  primaryAdvanceGlaCode: z.string().optional(),
  // "OSS jelző" — ld. ossThreshold.ts, docs/tervezes.md 13. fejezet.
  ossRegistered: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const { billingoSyncFromDate, exchangeRateBank, primaryAdvanceGlaCode, ...rest } = parsed.data;
    const company = await prisma.company.update({
      where: { id: params.companyId },
      data: {
        ...rest,
        ...(billingoSyncFromDate !== undefined
          ? { billingoSyncFromDate: billingoSyncFromDate ? new Date(billingoSyncFromDate) : null }
          : {}),
        ...(exchangeRateBank !== undefined ? { exchangeRateBank: exchangeRateBank || null } : {}),
        ...(primaryAdvanceGlaCode !== undefined ? { primaryAdvanceGlaCode: primaryAdvanceGlaCode || null } : {}),
      },
    });
    return NextResponse.json(company);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

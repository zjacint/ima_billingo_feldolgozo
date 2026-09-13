import { NextResponse } from "next/server";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { prisma } from "@/lib/db";
import { refreshImaReferenceCache } from "@/lib/imaReferenceCache";

export async function POST(_req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: params.companyId } });
    if (!company.imaApiKey || !company.imaApiUser || !company.imaApiCompany) {
      return NextResponse.json({ error: "A céghez nincs teljesen kitöltve az IMA API kapcsolat." }, { status: 400 });
    }

    const result = await refreshImaReferenceCache(params.companyId, {
      apiKey: company.imaApiKey,
      user: company.imaApiUser,
      company: company.imaApiCompany,
    });
    return NextResponse.json(result);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : message }, { status });
  }
}

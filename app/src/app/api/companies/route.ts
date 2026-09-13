import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { createCompany, ForbiddenError } from "@/lib/rbac";

const schema = z.object({ name: z.string().min(1) });

export async function GET() {
  try {
    await requireSession();
    const companies = await prisma.company.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json(companies);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Hiányzó vagy érvénytelen cégnév." }, { status: 400 });
    }
    const company = await createCompany(session.user.id, { name: parsed.data.name });
    return NextResponse.json(company, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

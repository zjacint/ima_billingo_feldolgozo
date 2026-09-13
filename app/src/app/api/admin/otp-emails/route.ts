import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, requireAdmin, errorToResponseInit } from "@/lib/access";
import { addOtpAllowedEmail } from "@/lib/rbac";

export async function GET() {
  try {
    const session = await requireSession();
    requireAdmin(session);
    const emails = await prisma.otpAllowedEmail.findMany({
      include: { addedBy: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(emails);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

const schema = z.object({ email: z.string().email(), note: z.string().optional() });

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    requireAdmin(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen email cím." }, { status: 400 });
    }
    const entry = await addOtpAllowedEmail(session.user.id, parsed.data);
    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

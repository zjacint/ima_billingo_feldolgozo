import { NextResponse } from "next/server";
import { requireSession, requireAdmin, errorToResponseInit } from "@/lib/access";
import { removeOtpAllowedEmail } from "@/lib/rbac";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireSession();
    requireAdmin(session);
    await removeOtpAllowedEmail(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

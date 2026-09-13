import { NextResponse } from "next/server";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireSession, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { createUser, changeUserRole, addUserToCompany, removeUserFromCompany, ForbiddenError, InvariantViolationError } from "@/lib/rbac";

export async function GET() {
  try {
    await requireSession();
    const users = await prisma.user.findMany({
      include: { companyMemberships: { include: { company: true } } },
      orderBy: { email: "asc" },
    });
    return NextResponse.json(users);
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.nativeEnum(UserRole),
  companyIds: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    requireKonyvelo(session);
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const user = await createUser(session.user.id, parsed.data);
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof InvariantViolationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

const patchSchema = z.object({
  userId: z.string(),
  action: z.enum(["change-role", "add-to-company", "remove-from-company"]),
  role: z.nativeEnum(UserRole).optional(),
  companyId: z.string().optional(),
});

export async function PATCH(req: Request) {
  try {
    const session = await requireSession();
    requireKonyvelo(session);
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }
    const { userId, action, role, companyId } = parsed.data;

    if (action === "change-role") {
      if (!role) return NextResponse.json({ error: "Hiányzó szerepkör." }, { status: 400 });
      await changeUserRole(session.user.id, userId, role);
    } else if (action === "add-to-company") {
      if (!companyId) return NextResponse.json({ error: "Hiányzó companyId." }, { status: 400 });
      await addUserToCompany(session.user.id, companyId, userId);
    } else if (action === "remove-from-company") {
      if (!companyId) return NextResponse.json({ error: "Hiányzó companyId." }, { status: 400 });
      await removeUserFromCompany(session.user.id, companyId, userId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof InvariantViolationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

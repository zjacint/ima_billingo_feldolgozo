import { getServerSession, type Session } from "next-auth";
import { authOptions } from "./auth";
import { prisma } from "./db";

export class UnauthenticatedError extends Error {}
export class NotAMemberError extends Error {}
export class RequiresKonyveloError extends Error {}
export class RequiresAdminError extends Error {}

/**
 * Céghez nem köthető műveletekhez (pl. új cég létrehozása, admin OTP
 * fehérlista) — csak a bejelentkezést ellenőrzi.
 */
export async function requireSession(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session) {
    throw new UnauthenticatedError("Nincs bejelentkezve.");
  }
  return session;
}

/**
 * Minden céghez kötött API route ugyanazt a két ellenőrzést végzi el
 * belépés előtt: van-e bejelentkezett session, és a felhasználó tagja-e az
 * adott cégnek (docs/tervezes.md 5. fejezet — a UI-n túl a backendnek is
 * érvényesítenie kell).
 */
export async function requireCompanyMembership(companyId: string): Promise<{
  session: Session;
}> {
  const session = await getServerSession(authOptions);
  if (!session) {
    throw new UnauthenticatedError("Nincs bejelentkezve.");
  }

  const membership = await prisma.companyUser.findUnique({
    where: {
      companyId_userId: { companyId, userId: session.user.id },
    },
  });
  if (!membership) {
    throw new NotAMemberError("A felhasználó nem tagja ennek a cégnek.");
  }

  return { session };
}

/**
 * Új kontír/áfa szabály létrehozása/módosítása/törlése, cég létrehozása,
 * IMA-beküldés — csak könyvelőnek engedélyezett (docs/tervezes.md 5.1
 * fejezet). Az adminisztrátor a meglévő szabályokat használhatja, de újat
 * nem hozhat létre és nem módosíthat.
 */
export function requireKonyvelo(session: Session) {
  if (session.user.role !== "konyvelo") {
    throw new RequiresKonyveloError(
      "Ehhez a művelethez könyvelői jogosultság szükséges."
    );
  }
}

/**
 * Az OTP fehérlista karbantartása kizárólag adminisztrátor szerepkörnek
 * (docs/tervezes.md 5. fejezet) — a rendszer adminisztratív beállítása, nem
 * üzleti szabály.
 */
export function requireAdmin(session: Session) {
  if (session.user.role !== "adminisztrator") {
    throw new RequiresAdminError(
      "Ehhez a művelethez adminisztrátori jogosultság szükséges."
    );
  }
}

export function errorToResponseInit(err: unknown): { status: number; message: string } {
  if (err instanceof UnauthenticatedError) return { status: 401, message: err.message };
  if (err instanceof NotAMemberError) return { status: 404, message: err.message };
  if (err instanceof RequiresKonyveloError) return { status: 403, message: err.message };
  if (err instanceof RequiresAdminError) return { status: 403, message: err.message };
  return { status: 500, message: "Váratlan hiba történt." };
}

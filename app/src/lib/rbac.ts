import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "./db";

/**
 * Kikényszeríti a docs/tervezes.md 5. fejezetében rögzített (a
 * testvérprojekt 5.2-jéből átvett) üzleti szabályokat, amiket a Postgres
 * séma önmagában (FK/unique) nem tud garantálni:
 *   1. minden felhasználónak pontosan egy szerepköre van (Prisma enum +
 *      NOT NULL oszlop már a séma szintjén biztosítja),
 *   2. minden céghez kötelező legalább egy felhasználó,
 *   3. új céget csak könyvelő hozhat létre, és ő rendeli hozzá a többieket,
 *   4. egy céghez rendelt felhasználók között kötelező legalább egy
 *      könyvelő — létrehozáskor ÉS minden hozzárendelés-módosításnál is.
 *
 * Minden itt található művelet egy Prisma tranzakción belül fut.
 */

export class ForbiddenError extends Error {}
export class InvariantViolationError extends Error {}

function assertKonyvelo(actingUserRole: UserRole) {
  if (actingUserRole !== UserRole.konyvelo) {
    throw new ForbiddenError("Ehhez a művelethez könyvelői jogosultság szükséges.");
  }
}

export interface CreateCompanyInput {
  name: string;
  additionalUserIds?: string[];
}

/**
 * Új cég létrehozása. Csak könyvelő hívhatja. A létrehozó könyvelő
 * automatikusan hozzárendelődik a céghez, így a "legalább egy könyvelő"
 * szabály a létrehozás pillanatában mindig teljesül.
 */
export async function createCompany(actingUserId: string, input: CreateCompanyInput) {
  return prisma.$transaction(async (tx) => {
    const actingUser = await tx.user.findUniqueOrThrow({ where: { id: actingUserId } });
    assertKonyvelo(actingUser.role);

    const company = await tx.company.create({
      data: { name: input.name, createdById: actingUserId },
    });

    const memberIds = new Set([actingUserId, ...(input.additionalUserIds ?? [])]);
    await tx.companyUser.createMany({
      data: [...memberIds].map((userId) => ({ companyId: company.id, userId })),
      skipDuplicates: true,
    });

    return company;
  });
}

/** Felhasználó hozzárendelése egy meglévő céghez. Csak könyvelő hívhatja. */
export async function addUserToCompany(actingUserId: string, companyId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const actingUser = await tx.user.findUniqueOrThrow({ where: { id: actingUserId } });
    assertKonyvelo(actingUser.role);

    await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    await tx.user.findUniqueOrThrow({ where: { id: userId } });

    await tx.companyUser.upsert({
      where: { companyId_userId: { companyId, userId } },
      create: { companyId, userId },
      update: {},
    });
  });
}

async function countKonyveloMembers(
  tx: Prisma.TransactionClient,
  companyId: string,
  excludingUserId?: string
) {
  return tx.companyUser.count({
    where: {
      companyId,
      userId: excludingUserId ? { not: excludingUserId } : undefined,
      user: { role: UserRole.konyvelo },
    },
  });
}

/**
 * Felhasználó eltávolítása egy cégtől. Elutasításra kerül, ha ez lenne az
 * utolsó felhasználó, vagy az utolsó könyvelő a cég mellett.
 */
export async function removeUserFromCompany(actingUserId: string, companyId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const actingUser = await tx.user.findUniqueOrThrow({ where: { id: actingUserId } });
    assertKonyvelo(actingUser.role);

    const totalMembers = await tx.companyUser.count({ where: { companyId } });
    if (totalMembers <= 1) {
      throw new InvariantViolationError("Egy cégtől nem távolítható el az utolsó hozzárendelt felhasználó.");
    }

    const remainingKonyvelo = await countKonyveloMembers(tx, companyId, userId);
    if (remainingKonyvelo === 0) {
      throw new InvariantViolationError("Egy cégtől nem távolítható el az utolsó hozzárendelt könyvelő.");
    }

    await tx.companyUser.delete({ where: { companyId_userId: { companyId, userId } } });
  });
}

/**
 * Felhasználó szerepkörének módosítása. Ha a módosítás könyvelőből
 * adminisztrátorrá fokozná le, ellenőrzi, hogy a felhasználó összes
 * jelenlegi cégénél marad-e legalább egy másik könyvelő.
 */
export async function changeUserRole(actingUserId: string, targetUserId: string, newRole: UserRole) {
  return prisma.$transaction(async (tx) => {
    const actingUser = await tx.user.findUniqueOrThrow({ where: { id: actingUserId } });
    assertKonyvelo(actingUser.role);

    const targetUser = await tx.user.findUniqueOrThrow({ where: { id: targetUserId } });

    if (targetUser.role === UserRole.konyvelo && newRole === UserRole.adminisztrator) {
      const memberships = await tx.companyUser.findMany({
        where: { userId: targetUserId },
        select: { companyId: true },
      });

      for (const { companyId } of memberships) {
        const remainingKonyvelo = await countKonyveloMembers(tx, companyId, targetUserId);
        if (remainingKonyvelo === 0) {
          throw new InvariantViolationError(
            `A felhasználó nem fokozható le adminisztrátorrá, mert az utolsó könyvelő lenne a(z) ${companyId} azonosítójú cég mellett.`
          );
        }
      }
    }

    return tx.user.update({ where: { id: targetUserId }, data: { role: newRole } });
  });
}

/**
 * Új felhasználó pre-provisioning (ld. src/lib/auth.ts — a bejelentkezés
 * csak azonosít, a User rekordnak már léteznie kell). Csak könyvelő
 * hívhatja, és rögtön hozzárendelheti egy vagy több céghez.
 */
export async function createUser(
  actingUserId: string,
  input: { email: string; name: string; role: UserRole; companyIds?: string[] }
) {
  return prisma.$transaction(async (tx) => {
    const actingUser = await tx.user.findUniqueOrThrow({ where: { id: actingUserId } });
    assertKonyvelo(actingUser.role);

    const user = await tx.user.create({
      data: { email: input.email.toLowerCase(), name: input.name, role: input.role },
    });

    if (input.companyIds?.length) {
      await tx.companyUser.createMany({
        data: input.companyIds.map((companyId) => ({ companyId, userId: user.id })),
        skipDuplicates: true,
      });
    }

    return user;
  });
}

/**
 * Az OTP fehérlista karbantartása — csak adminisztrátor hívhatja (ld.
 * src/lib/access.ts requireAdmin, docs/tervezes.md 5. fejezet). Szándékosan
 * NEM hoz létre `User` rekordot: a fehérlistázott email cím csak a
 * *hitelesítés módját* nyitja meg, a tényleges belépéshez könyvelőnek
 * továbbra is létre kell hoznia a `User` rekordot (createUser).
 */
export async function addOtpAllowedEmail(
  actingUserId: string,
  input: { email: string; note?: string }
) {
  return prisma.otpAllowedEmail.create({
    data: {
      email: input.email.toLowerCase(),
      note: input.note,
      addedById: actingUserId,
    },
  });
}

export async function removeOtpAllowedEmail(id: string) {
  await prisma.otpAllowedEmail.delete({ where: { id } });
}

import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seed script: létrehozza az első könyvelő és adminisztrátor felhasználót,
 * hogy legyen kivel bejelentkezni (ld. docs/tervezes.md 5. fejezet — a
 * bejelentkezés csak azonosít, előre létrehozott User rekord nélkül minden
 * belépés elutasításra kerül). ÁLLÍTSD ÁT a SEED_ACCOUNTANT_EMAIL /
 * SEED_ADMIN_EMAIL env változókat a valódi example.com-s Google fiók(ok)
 * címére futtatás előtt — a placeholder címekkel nem lehet bejelentkezni.
 *
 * Futtatás: npm run seed (valódi DATABASE_URL ellen).
 */
async function main() {
  const accountantEmail = process.env.SEED_ACCOUNTANT_EMAIL ?? "konyvelo@example.com";
  const accountantName = process.env.SEED_ACCOUNTANT_NAME ?? "Minta Könyvelő";
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminName = process.env.SEED_ADMIN_NAME ?? "Minta Adminisztrátor";

  const accountant = await prisma.user.upsert({
    where: { email: accountantEmail },
    update: {},
    create: { email: accountantEmail, name: accountantName, role: UserRole.konyvelo },
  });

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, name: adminName, role: UserRole.adminisztrator },
  });

  console.log("Seed kész — bejelentkezésre kész felhasználók:");
  console.log(`  könyvelő: ${accountant.email}`);
  console.log(`  adminisztrátor: ${adminEmail}`);
  console.log(
    "Ha ezek placeholder (@example.com) címek, futtasd újra SEED_ACCOUNTANT_EMAIL/SEED_ADMIN_EMAIL env változókkal a valódi Google-fiók email címére állítva."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

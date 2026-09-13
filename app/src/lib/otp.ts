import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 10;
const MAX_REQUESTS_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;

function hashCode(email: string, code: string): string {
  // Az emailt is bekeverjük a hash-be, hogy ugyanaz a kód más email címre
  // ne legyen érvényes, ha két sor véletlenül azonos kódot kapna.
  return createHash("sha256").update(`${email.toLowerCase()}:${code}`).digest("hex");
}

export class RateLimitedError extends Error {}

/**
 * Új 6 jegyű kódot generál és ír be az adatbázisba egy email címhez.
 * Óránkénti kérésszám-limitet érvényesít (ld. docs/tervezes.md 5. fejezet)
 * — FÜGGETLENÜL attól, hogy az email cím szerepel-e az `OtpAllowedEmail`
 * fehérlistán, hogy a hívó (src/app/api/auth/otp/request/route.ts) mindig
 * egységes választ tudjon adni, és ne legyen email-enumerálási lehetőség.
 */
export async function createOtpCode(email: string): Promise<string> {
  const emailLower = email.toLowerCase();
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await prisma.otpCode.count({
    where: { email: emailLower, createdAt: { gte: since } },
  });
  if (recentCount >= MAX_REQUESTS_PER_HOUR) {
    throw new RateLimitedError("Túl sok kódkérés — próbáld újra később.");
  }

  const code = randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, "0");
  await prisma.otpCode.create({
    data: {
      email: emailLower,
      codeHash: hashCode(emailLower, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
    },
  });
  return code;
}

/**
 * Egy beírt kódot ellenőriz. A legfrissebb, még nem felhasznált, le nem
 * járt sort nézi az adott email címhez; sikertelen próbálkozásokat számol,
 * és `MAX_VERIFY_ATTEMPTS` felett a sort érvénytelenné teszi (elfogyasztja),
 * hogy ne legyen korlátlan brute-force lehetőség egyetlen kiküldött kódra.
 */
export async function verifyOtpCode(email: string, code: string): Promise<boolean> {
  const emailLower = email.toLowerCase();
  const candidate = await prisma.otpCode.findFirst({
    where: { email: emailLower, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!candidate) return false;

  if (candidate.attempts >= MAX_VERIFY_ATTEMPTS) {
    await prisma.otpCode.update({ where: { id: candidate.id }, data: { consumedAt: new Date() } });
    return false;
  }

  const expectedHash = Buffer.from(hashCode(emailLower, code));
  const actualHash = Buffer.from(candidate.codeHash);
  const matches =
    expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);

  if (matches) {
    await prisma.otpCode.update({ where: { id: candidate.id }, data: { consumedAt: new Date() } });
    return true;
  }

  await prisma.otpCode.update({
    where: { id: candidate.id },
    data: { attempts: { increment: 1 } },
  });
  return false;
}

/** Admin fehérlista-ellenőrzés — case-insensitive. */
export async function isEmailOtpAllowed(email: string): Promise<boolean> {
  const entry = await prisma.otpAllowedEmail.findUnique({
    where: { email: email.toLowerCase() },
  });
  return entry !== null;
}

import type { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./db";
import { isEmailOtpAllowed, verifyOtpCode } from "./otp";

/**
 * A felhasználókat NEM az első bejelentkezés hozza létre — a
 * docs/tervezes.md 5.2 fejezete (a testvérprojektből átvett elv) szerint a
 * felhasználó-létrehozás/hozzárendelés könyvelői jogosultsághoz kötött,
 * explicit adminisztrációs művelet. Ha az email címhez nincs `User` rekord,
 * a belépés elutasításra kerül — mindkét bejelentkezési módnál (Google SSO
 * ÉS email-OTP).
 *
 * JWT session-stratégiát használunk (nincs szükség a NextAuth Prisma
 * Adapter Account/Session tábláira) — a token/session callback egészíti ki
 * a saját `User` tábla `id`/`role` mezőivel.
 */
export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    // Email-OTP a nem-domain (nem Google Workspace) felhasználóknak, ld.
    // docs/tervezes.md 5. fejezet. A kód kiküldése külön lépés
    // (src/app/api/auth/otp/request/route.ts) — itt csak a beírt kódot
    // ellenőrizzük.
    CredentialsProvider({
      id: "email-otp",
      name: "Email kód",
      credentials: {
        email: { label: "Email", type: "email" },
        code: { label: "Kód", type: "text" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const code = credentials?.code?.trim();
        if (!email || !code) return null;

        const allowed = await isEmailOtpAllowed(email);
        if (!allowed) return null;

        const ok = await verifyOtpCode(email, code);
        if (!ok) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user, account }) {
      // Az email-OTP providernél a kód-ellenőrzés és a User-lookup már
      // megtörtént az authorize()-ban — ott már csak pre-provisioned
      // felhasználó juthat el idáig, nincs további teendő.
      if (account?.provider === "email-otp") return true;

      const email = user.email;
      if (!email) return false;
      const emailLower = email.toLowerCase();

      const allowedDomain = process.env.ALLOWED_GOOGLE_WORKSPACE_DOMAIN;
      const matchesDomain = !allowedDomain || emailLower.endsWith(`@${allowedDomain.toLowerCase()}`);
      if (!matchesDomain) return false;

      const existing = await prisma.user.findUnique({ where: { email } });
      return existing !== null;
    },
    async jwt({ token }) {
      if (token.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email },
        });
        if (dbUser) {
          token.userId = dbUser.id;
          token.role = dbUser.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.role = token.role as "konyvelo" | "adminisztrator";
      }
      return session;
    },
  },
  pages: {
    signIn: "/signin",
  },
};

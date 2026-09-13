import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import UsersManager from "./UsersManager";

export default async function UsersPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/signin");
  if (session.user.role !== "konyvelo") redirect("/dashboard");

  const [users, companies] = await Promise.all([
    prisma.user.findMany({
      include: { companyMemberships: { include: { company: true } } },
      orderBy: { email: "asc" },
    }),
    prisma.company.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <h1>Felhasználók kezelése</h1>
        <p className="muted text-sm">
          A bejelentkezéshez (Google SSO vagy email-OTP) mindenképp itt
          létrehozott felhasználói rekord szükséges — ld. docs/tervezes.md 5.
          fejezet.
        </p>
      </div>
      <UsersManager
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          companies: u.companyMemberships.map((m) => ({ id: m.company.id, name: m.company.name })),
        }))}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}

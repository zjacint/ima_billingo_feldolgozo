import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CompanyStatusBadge } from "@/components/StatusBadge";

export default async function CompanySelectorPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/signin");

  const memberships = await prisma.companyUser.findMany({
    where: { userId: session.user.id },
    include: { company: true },
    orderBy: { company: { name: "asc" } },
  });

  return (
    <div className="stack-lg">
      <div className="page-header">
        <h1>Cégválasztó</h1>
      </div>

      <div className="cluster">
        {session.user.role === "konyvelo" && (
          <>
            <Link href="/dashboard/new-company" className="btn btn-sm btn-primary">
              + Új cég létrehozása
            </Link>
            <Link href="/dashboard/users" className="btn btn-sm">
              Felhasználók kezelése
            </Link>
          </>
        )}
        {session.user.role === "adminisztrator" && (
          <Link href="/dashboard/admin/otp-emails" className="btn btn-sm">
            Engedélyezett OTP e-mailek
          </Link>
        )}
      </div>

      {memberships.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            Ehhez a fiókhoz még nincs cég hozzárendelve. Kérj egy könyvelőt,
            hogy rendeljen hozzá legalább egy céghez.
          </p>
        </div>
      ) : (
        <div className="stack">
          {memberships.map(({ company }) => (
            <Link
              key={company.id}
              href={`/dashboard/${company.id}`}
              className="card cluster"
              style={{ justifyContent: "space-between", textDecoration: "none" }}
            >
              <span style={{ fontWeight: 650, color: "var(--color-text)" }}>{company.name}</span>
              <CompanyStatusBadge status={company.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

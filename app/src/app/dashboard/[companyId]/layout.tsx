import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { companyId: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/signin");

  const membership = await prisma.companyUser.findUnique({
    where: { companyId_userId: { companyId: params.companyId, userId: session.user.id } },
    include: { company: true },
  });
  if (!membership) notFound();

  const base = `/dashboard/${params.companyId}`;

  return (
    <div className="stack-lg">
      <Link href="/dashboard" className="back-link">
        ← Cégválasztó
      </Link>
      <div className="page-header">
        <div className="eyebrow">Cég</div>
        <h1>{membership.company.name}</h1>
      </div>
      <nav className="tabs">
        <Link href={base}>Számlák</Link>
        <Link href={`${base}/rules`}>Kontír / áfa szabályok</Link>
        <Link href={`${base}/partners`}>Partnerek</Link>
        <Link href={`${base}/settings`}>Beállítások</Link>
        <Link href={`${base}/help`}>Súgó</Link>
      </nav>
      {children}
    </div>
  );
}

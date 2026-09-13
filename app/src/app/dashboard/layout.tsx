import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import SignOutButton from "@/components/SignOutButton";
import { RoleBadge } from "@/components/StatusBadge";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/signin");

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/dashboard" className="brand">
            <span className="brand-mark">B→I</span>
            Billingo → IMA admin
          </Link>
          <div className="topbar-user">
            <span>{session.user.name ?? session.user.email}</span>
            <RoleBadge role={session.user.role} />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}

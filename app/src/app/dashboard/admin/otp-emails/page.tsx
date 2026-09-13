import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import OtpEmailsManager from "./OtpEmailsManager";

export default async function OtpEmailsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/signin");
  if (session.user.role !== "adminisztrator") redirect("/dashboard");

  const emails = await prisma.otpAllowedEmail.findMany({
    include: { addedBy: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="stack-lg">
      <div className="page-header">
        <h1>Engedélyezett OTP e-mailek</h1>
        <p className="muted text-sm">
          A itt felvett email címek jogosultak az email-kódos bejelentkezés{" "}
          <em>kérésére</em> — a tényleges belépéshez emellett egy, a{" "}
          <a href="/dashboard/users">Felhasználók</a> oldalon létrehozott
          rekord is szükséges (ld. docs/tervezes.md 5. fejezet).
        </p>
      </div>
      <OtpEmailsManager
        emails={emails.map((e) => ({
          id: e.id,
          email: e.email,
          note: e.note,
          addedBy: e.addedBy.name,
          createdAt: e.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}

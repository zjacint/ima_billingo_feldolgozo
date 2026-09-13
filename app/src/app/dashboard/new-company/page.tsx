import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import NewCompanyForm from "./NewCompanyForm";

export default async function NewCompanyPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/signin");
  if (session.user.role !== "konyvelo") redirect("/dashboard");

  return (
    <div className="stack-lg">
      <div className="page-header">
        <h1>Új cég létrehozása</h1>
      </div>
      <div className="card" style={{ maxWidth: 480 }}>
        <NewCompanyForm />
      </div>
    </div>
  );
}

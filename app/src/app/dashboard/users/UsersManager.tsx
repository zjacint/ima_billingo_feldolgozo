"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RoleBadge } from "@/components/StatusBadge";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "konyvelo" | "adminisztrator";
  companies: { id: string; name: string }[];
}

interface CompanyOption {
  id: string;
  name: string;
}

export default function UsersManager({ users, companies }: { users: UserRow[]; companies: CompanyOption[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"konyvelo" | "adminisztrator">("konyvelo");
  const [companyId, setCompanyId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createUser() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role, companyIds: companyId ? [companyId] : [] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen létrehozás (${res.status})`);
      setEmail("");
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const resBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(resBody.error ?? `Sikertelen művelet (${res.status})`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="card-title">Új felhasználó</div>
        <div className="form-grid">
          <label className="field">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            Név
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Szerepkör
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="konyvelo">Könyvelő</option>
              <option value="adminisztrator">Adminisztrátor</option>
            </select>
          </label>
          <label className="field">
            Cég hozzárendelése (opcionális)
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">— nincs —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="alert alert-error">{error}</p>}
        <div>
          <button className="btn btn-primary" onClick={createUser} disabled={submitting || !email || !name}>
            Létrehozás
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Név</th>
              <th>Szerepkör</th>
              <th>Cégek</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.name}</td>
                <td className="cluster">
                  <RoleBadge role={u.role} />
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      patch({ userId: u.id, action: "change-role", role: u.role === "konyvelo" ? "adminisztrator" : "konyvelo" })
                    }
                  >
                    Váltás {u.role === "konyvelo" ? "adminisztrátorra" : "könyvelőre"}
                  </button>
                </td>
                <td>
                  <div className="cluster">
                    {u.companies.map((c) => (
                      <span key={c.id} className="badge badge-neutral cluster">
                        {c.name}
                        <button
                          className="btn btn-sm"
                          style={{ padding: "0 0.3rem" }}
                          onClick={() => patch({ userId: u.id, action: "remove-from-company", companyId: c.id })}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) patch({ userId: u.id, action: "add-to-company", companyId: e.target.value });
                      e.target.value = "";
                    }}
                  >
                    <option value="">+ cég hozzáadása</option>
                    {companies
                      .filter((c) => !u.companies.some((uc) => uc.id === c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

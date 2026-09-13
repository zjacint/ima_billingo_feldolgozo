"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface EmailRow {
  id: string;
  email: string;
  note: string | null;
  addedBy: string;
  createdAt: string;
}

export default function OtpEmailsManager({ emails }: { emails: EmailRow[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addEmail() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/otp-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, note: note || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen hozzáadás (${res.status})`);
      setEmail("");
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeEmail(id: string) {
    if (!window.confirm("Biztosan törlöd ezt az email címet a fehérlistáról?")) return;
    const res = await fetch(`/api/admin/otp-emails/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="card-title">Új email cím engedélyezése</div>
        <div className="form-grid">
          <label className="field">
            Email cím
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            Megjegyzés (opcionális)
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="pl. külső könyvelő, XY Kft."
            />
          </label>
        </div>
        {error && <p className="alert alert-error">{error}</p>}
        <div>
          <button className="btn btn-primary" onClick={addEmail} disabled={submitting || !email}>
            Hozzáadás
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Megjegyzés</th>
              <th>Hozzáadta</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {emails.map((e) => (
              <tr key={e.id}>
                <td>{e.email}</td>
                <td className="muted">{e.note ?? "—"}</td>
                <td className="muted">{e.addedBy}</td>
                <td>
                  <button className="btn btn-sm btn-danger" onClick={() => removeEmail(e.id)}>
                    Törlés
                  </button>
                </td>
              </tr>
            ))}
            {emails.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Még nincs engedélyezett email cím.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

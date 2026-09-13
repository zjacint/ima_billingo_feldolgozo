"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewCompanyForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen létrehozás (${res.status})`);
      router.push(`/dashboard/${body.id}/settings`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <label className="field">
        Cégnév
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {error && <p className="alert alert-error">{error}</p>}
      <div>
        <button className="btn btn-primary" onClick={submit} disabled={submitting || !name}>
          Létrehozás
        </button>
      </div>
    </div>
  );
}

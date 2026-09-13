"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function SignInPage() {
  const [mode, setMode] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestCode() {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      setMessage(body.message ?? "Kód elküldve, ha a cím jogosult.");
      setMode("code");
    } catch {
      setError("Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await signIn("email-otp", { email, code, redirect: false, callbackUrl: "/dashboard" });
      if (res?.error) {
        setError("Érvénytelen vagy lejárt kód.");
      } else if (res?.url) {
        window.location.href = res.url;
      }
    } catch {
      setError("Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <div className="card" style={{ maxWidth: 380, width: "100%" }}>
        <div style={{ textAlign: "center" }}>
          <div
            className="brand-mark"
            style={{ width: 44, height: 44, fontSize: "0.85rem", margin: "0 auto 1rem" }}
          >
            B→I
          </div>
          <h1 style={{ marginBottom: "0.4rem" }}>Billingo → IMA admin</h1>
          <p className="muted text-sm">Jelentkezz be a fiókoddal.</p>
        </div>

        <button
          className="btn btn-primary"
          style={{ width: "100%", marginTop: "1.25rem" }}
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
        >
          Bejelentkezés Google-lal
        </button>

        <div className="cluster" style={{ margin: "1.25rem 0", color: "var(--color-text-muted)" }}>
          <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--color-border)" }} />
          <span className="text-sm">vagy</span>
          <hr style={{ flex: 1, border: "none", borderTop: "1px solid var(--color-border)" }} />
        </div>

        {mode === "start" ? (
          <div className="stack">
            <label className="field">
              Email cím
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nev@ceg.hu"
              />
            </label>
            <button className="btn" onClick={requestCode} disabled={submitting || !email}>
              Bejelentkezési kód kérése
            </button>
          </div>
        ) : (
          <div className="stack">
            <p className="text-sm muted" style={{ marginTop: 0 }}>
              Kód elküldve ide: <strong>{email}</strong>
            </p>
            <label className="field">
              Bejelentkezési kód
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </label>
            <button className="btn btn-primary" onClick={verifyCode} disabled={submitting || code.length !== 6}>
              Bejelentkezés
            </button>
            <button className="btn btn-sm" onClick={() => setMode("start")} disabled={submitting}>
              Másik email cím / új kód
            </button>
          </div>
        )}

        {message && <p className="alert alert-success" style={{ marginTop: "1rem" }}>{message}</p>}
        {error && <p className="alert alert-error" style={{ marginTop: "1rem" }}>{error}</p>}

        <p className="muted text-sm" style={{ marginTop: "1.5rem" }}>
          Ha még nem vagy hozzárendelve egyetlen céghez sem, vagy az email
          címed nincs engedélyezve, a bejelentkezés elutasításra kerül — ehhez
          egy könyvelőnek/adminisztrátornak kell hozzárendelnie a fiókodat.
        </p>
      </div>
    </main>
  );
}

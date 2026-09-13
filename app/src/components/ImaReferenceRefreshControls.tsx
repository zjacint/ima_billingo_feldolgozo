"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Spinner from "./Spinner";

/**
 * Kézzel indítható IMA számlatükör/áfa kulcs lista frissítés — ld.
 * docs/tervezes.md 10. fejezet. A Kontír/áfa szabályok és a Beállítások
 * oldal is ezt a gombot jeleníti meg — mindkét helyen ugyanazt a
 * DB-cache-t (`ImaGlaAccountCache`/`ImaVatKeyCache`) frissíti.
 */
export default function ImaReferenceRefreshControls({
  companyId,
  canRefresh,
  lastUpdatedAt,
}: {
  companyId: string;
  canRefresh: boolean;
  lastUpdatedAt: string | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/ima-reference/refresh`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen frissítés (${res.status})`);
      setMessage(
        `Frissítve: ${body.glaAccountCount} kontír, ${body.vatKeyCount} áfa kulcs, ${body.partnerCount} partner, ` +
          `${body.paymentMethodCount} fizetési mód.`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cluster">
      <button className="btn btn-sm" onClick={run} disabled={!canRefresh || submitting}>
        {submitting ? (
          <>
            <Spinner /> Frissítés…
          </>
        ) : (
          "Számlatükör/áfa kulcsok/partnerek frissítése (IMA)"
        )}
      </button>
      <span className="muted text-sm">
        {lastUpdatedAt
          ? `Utoljára frissítve: ${new Date(lastUpdatedAt).toLocaleString("hu-HU")}`
          : "Még nincs frissítve — a kontír/áfa mezők javaslat nélkül, sima szövegmezőként működnek, amíg le nem futtatod."}
      </span>
      {message && <span className="text-sm" style={{ color: "var(--color-success)" }}>{message}</span>}
      {error && <span className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</span>}
    </div>
  );
}

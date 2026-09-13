"use client";

import { useState } from "react";

export interface RecurringPartnerInfo {
  partnerName: string;
  totalInvoices: number;
  detectedInvoices: number;
}

/**
 * Kiegyenlítési (fizetési tranzakcióazonosító) export sáv a Számlák oldalon
 * — ld. settlementExport.ts, docs/tervezes.md 13. fejezet. A letöltés a
 * MÉG NEM exportált, felismert azonosítójú számlákat gyűjti egy külön
 * CSV-be (nem az IMA importba), és megjelöli őket exportáltnak.
 */
export default function SettlementExportControls({
  companyId,
  pendingCount,
  recurringPartners,
}: {
  companyId: string;
  pendingCount: number;
  recurringPartners: RecurringPartnerInfo[];
}) {
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setDownloading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/settlement-export`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sikertelen export (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kiegyenlites-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Kiegyenlítési export letöltve.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setDownloading(false);
    }
  }

  if (pendingCount === 0 && recurringPartners.length === 0 && !message && !error) return null;

  return (
    <div className="card stack">
      <div className="card-title">Kiegyenlítés (fizetési tranzakcióazonosítók)</div>
      {pendingCount > 0 ? (
        <div className="cluster" style={{ justifyContent: "space-between" }}>
          <p className="text-sm" style={{ margin: 0 }}>
            {pendingCount} számla megjegyzésében találtunk fizetési tranzakcióazonosítót (pl. Stripe), amit még nem
            exportáltunk kiegyenlítéshez. A számla adatait ez nem módosítja — csak egy külön egyeztető fájl forrása.
          </p>
          <button className="btn btn-sm" onClick={download} disabled={downloading}>
            {downloading ? "Letöltés…" : "Kiegyenlítési export letöltése (CSV)"}
          </button>
        </div>
      ) : (
        <p className="text-sm muted" style={{ margin: 0 }}>
          Nincs még exportálatlan, felismert tranzakcióazonosítójú számla.
        </p>
      )}
      {recurringPartners.length > 0 && (
        <p className="text-sm muted" style={{ margin: 0 }}>
          Rendszeresen (a számláik legalább felén) tranzakcióazonosítót tartalmazó partnerek:{" "}
          {recurringPartners
            .map((p) => `${p.partnerName} (${p.detectedInvoices}/${p.totalInvoices} számla)`)
            .join(", ")}
          . Érdemes lehet minden jövőbeli számlájukat kiegyenlítés-relevánsnak tekinteni.
        </p>
      )}
      {message && (
        <p className="alert alert-success" style={{ margin: 0 }}>
          {message}
        </p>
      )}
      {error && (
        <p className="alert alert-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InvoiceStatusBadge, MappingRuleSourceBadge } from "@/components/StatusBadge";
import type { InvoiceLine } from "@/lib/types";

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  transfer: "Átutalás",
  cash: "Készpénz",
  card: "Bankkártya",
  cod: "Utánvét",
  other: "Egyéb",
};

/**
 * Egy tételsor kontír/áfa/előjel szerkesztő panelje — ld.
 * docs/tervezes.md 10. fejezet. A lista maga csak olvasható (4
 * szerkeszthető mezőt soronként megjeleníteni sok tételes számláknál
 * zsúfolt lenne), a szerkesztés egy fókuszált panelben történik — a
 * mentés itt csak a helyi (még be nem küldött) `lines` state-et
 * módosítja, a tényleges jóváhagyás továbbra is a "Jóváhagyás" gombbal
 * történik.
 */
function LineEditModal({
  line,
  onClose,
  onSave,
}: {
  line: InvoiceLine;
  onClose: () => void;
  onSave: (data: {
    approvedVatCode: string | null;
    approvedGlaCode: string | null;
    approvedVatGlaCode: string | null;
    approvedAmountSign: "original" | "negative";
  }) => void;
}) {
  const [vatCode, setVatCode] = useState(line.approvedVatCode ?? "");
  const [glaCode, setGlaCode] = useState(line.approvedGlaCode ?? "");
  const [vatGlaCode, setVatGlaCode] = useState(line.approvedVatGlaCode ?? "");
  const [amountSign, setAmountSign] = useState<"original" | "negative">(line.approvedAmountSign ?? "original");

  function handleSave() {
    onSave({
      approvedVatCode: vatCode.trim() || null,
      approvedGlaCode: glaCode.trim() || null,
      approvedVatGlaCode: vatGlaCode.trim() || null,
      approvedAmountSign: amountSign,
    });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <div className="card-title">Tétel szerkesztése</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          {line.productName}
          {line.comment && <div>{line.comment}</div>}
        </p>
        <div className="form-grid">
          <label className="field">
            Áfa besorolás (IMA)
            <span className="field-hint">Billingo eredeti áfa érték: „{line.vatPercentOrCode}”.</span>
            <input type="text" value={vatCode} onChange={(e) => setVatCode(e.target.value)} />
          </label>
          <label className="field">
            Árbevétel kontír
            <input type="text" value={glaCode} onChange={(e) => setGlaCode(e.target.value)} />
          </label>
          <label className="field">
            Áfa kontír (opcionális)
            <input type="text" value={vatGlaCode} onChange={(e) => setVatGlaCode(e.target.value)} placeholder="pl. 4671" />
          </label>
          <label className="field">
            Előjel
            <select value={amountSign} onChange={(e) => setAmountSign(e.target.value as "original" | "negative")}>
              <option value="original">Eredeti</option>
              <option value="negative">Negatív</option>
            </select>
          </label>
        </div>
        {line.suggestedRuleSummary && (
          <p className="text-sm muted" style={{ margin: 0 }}>
            Javasolta: {line.suggestedRuleSummary}
          </p>
        )}
        <div className="cluster" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-sm" onClick={onClose}>
            Mégse
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleSave}>
            Mentés
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InvoiceDetail({
  companyId,
  invoiceId,
  billingoDocumentNumber,
  status,
  partnerName,
  partnerReadyForSubmission,
  currencyCode,
  grossAmount,
  imaPushError,
  imaSalesheaderId,
  imaImageUploaded,
  imaImageUploadError,
  exchangeRateWarning,
  docDate,
  fulfillmentDate,
  dueDate,
  paymentMethod,
  initialVatFulfillmentDateOverride,
  rejectionReason,
  billingoCancelled,
  lines: initialLines,
}: {
  companyId: string;
  invoiceId: string;
  billingoDocumentNumber: string;
  status: string;
  partnerName: string;
  /** ld. `isPartnerReadyForSubmission` (src/lib/types.ts) — ismert IMA partner ESETÉN a hiányos Billingo-adat sem blokkol. */
  partnerReadyForSubmission: boolean;
  currencyCode: string;
  grossAmount: number;
  imaPushError: string | null;
  imaSalesheaderId: number | null;
  imaImageUploaded: boolean;
  imaImageUploadError: string | null;
  exchangeRateWarning: string | null;
  /** Kelt dátum (Billingo `invoice_date`), "YYYY-MM-DD" vagy üres. */
  docDate: string;
  /** Billingo eredeti teljesítés dátuma — csak megjelenítve, nem szerkeszthető itt. */
  fulfillmentDate: string;
  dueDate: string;
  paymentMethod: string;
  /** Kézzel felülírt ÁFA dátum — ha üres, a `fulfillmentDate` megy ki beküldéskor. */
  initialVatFulfillmentDateOverride: string;
  rejectionReason: string | null;
  /** ld. docs/tervezes.md 15. fejezet — a Billingo-oldali `cancelled` mező. */
  billingoCancelled: boolean;
  lines: InvoiceLine[];
}) {
  const router = useRouter();
  const [lines, setLines] = useState<InvoiceLine[]>(
    initialLines.map((l) => ({
      ...l,
      approvedGlaCode: l.approvedGlaCode ?? l.suggestedGlaCode,
      approvedVatCode: l.approvedVatCode ?? l.suggestedVatCode,
      approvedVatGlaCode: l.approvedVatGlaCode ?? l.suggestedVatGlaCode,
      approvedAmountSign: l.approvedAmountSign ?? l.suggestedAmountSign ?? "original",
    }))
  );
  const [vatFulfillmentDateOverride, setVatFulfillmentDateOverride] = useState(initialVatFulfillmentDateOverride);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingLineIdx, setEditingLineIdx] = useState<number | null>(null);

  const canEdit = status === "synced" || status === "needs_review" || status === "failed";
  const canReject = ["synced", "needs_review", "approved", "failed"].includes(status);
  const isFullyClassified = lines.every((l) => l.approvedGlaCode && l.approvedVatCode);

  function saveLineFromModal(
    idx: number,
    data: {
      approvedVatCode: string | null;
      approvedGlaCode: string | null;
      approvedVatGlaCode: string | null;
      approvedAmountSign: "original" | "negative";
    }
  ) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...data } : l)));
  }

  async function approve() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, vatFulfillmentDateOverride: vatFulfillmentDateOverride || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen jóváhagyás (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function unapprove() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/invoices/${invoiceId}/unapprove`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen visszavonás (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitToIma() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/invoices/${invoiceId}/submit`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen beküldés (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadImage() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/invoices/${invoiceId}/upload-image`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen feltöltés (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function downloadImaPdf() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/invoices/${invoiceId}/ima-pdf`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sikertelen letöltés (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ima-${billingoDocumentNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function reject() {
    if (!rejectReason.trim()) {
      setError("Az elutasítás indoklása kötelező.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/invoices/${invoiceId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen elutasítás (${res.status})`);
      setShowRejectForm(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function unreject() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/invoices/${invoiceId}/reject`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen visszaállítás (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="cluster" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="card-title">{billingoDocumentNumber}</div>
            <div className="muted text-sm">
              {partnerName} · {grossAmount.toLocaleString("hu-HU")} {currencyCode}
            </div>
          </div>
          <InvoiceStatusBadge status={status} />
        </div>
        {billingoCancelled && (
          <p className="alert alert-error" style={{ margin: 0 }}>
            Ez a bizonylat törölve/sztornózva van Billingo-ban. Ellenőrizd, hogy tényleg
            könyvelendő-e — ha nem, utasítsd el a lenti "Elutasítás" gombbal.
          </p>
        )}
        {!partnerReadyForSubmission && (
          <p className="alert alert-warning" style={{ margin: 0 }}>
            A partnerhez hiányzik az adószám vagy a teljes számlázási cím, ÉS nincs ismert IMA
            partner-azonosítója sem — ez szükséges az IMA-oldali automatikus feloldáshoz (ld.
            docs/tervezes.md 8.1). Ellenőrizd a Billingo partneradatokat, vagy párosítsd a partnert
            a Partnerek oldalon.
          </p>
        )}
        {imaPushError && (
          <p className="alert alert-error" style={{ margin: 0 }}>
            Legutóbbi IMA beküldési hiba: {imaPushError}
          </p>
        )}
        {imaSalesheaderId && (
          <div className="cluster" style={{ alignItems: "center" }}>
            <p className="alert alert-success" style={{ margin: 0 }}>
              IMA salesheader azonosító: {imaSalesheaderId}
            </p>
            <button
              className="btn btn-sm"
              onClick={downloadImaPdf}
              disabled={submitting}
              title="Az IMA-oldalon ténylegesen létrejött számla PDF-jét kéri vissza — ellenőrzésre, hogy a beküldés valóban a várt adatokkal könyvelődött-e."
            >
              IMA számla PDF letöltése (ellenőrzés)
            </button>
          </div>
        )}
        {status === "booked" && (
          <div className="cluster" style={{ alignItems: "center" }}>
            {imaImageUploaded ? (
              <span className="badge badge-success">Számlakép feltöltve IMA-hoz</span>
            ) : (
              <span className="badge badge-warning">
                Számlakép nincs feltöltve{imaImageUploadError ? `: ${imaImageUploadError}` : ""}
              </span>
            )}
            <button className="btn btn-sm" onClick={uploadImage} disabled={submitting}>
              {imaImageUploaded ? "Számlakép újraküldése" : "Számlakép feltöltése"}
            </button>
          </div>
        )}
        {exchangeRateWarning && (
          <p className="alert alert-warning" style={{ margin: 0 }}>
            ⚠ {exchangeRateWarning}
          </p>
        )}
        {status === "rejected" && rejectionReason && (
          <p className="alert alert-warning" style={{ margin: 0 }}>
            Elutasítva: {rejectionReason}
          </p>
        )}

        {/* Fejadatok — csak a Billingo fejlécből származó, számla-szintű adatok. */}
        <div className="form-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <span className="field-hint">Partner</span>
            <span>{partnerName}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <span className="field-hint">Kelt dátum</span>
            <span>{docDate ? new Date(docDate).toLocaleDateString("hu-HU") : "—"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <span className="field-hint">Teljesítés dátuma (Billingo)</span>
            <span>{fulfillmentDate ? new Date(fulfillmentDate).toLocaleDateString("hu-HU") : "—"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <span className="field-hint">Fizetési határidő</span>
            <span>{dueDate ? new Date(dueDate).toLocaleDateString("hu-HU") : "—"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <span className="field-hint">Fizetési mód</span>
            <span>{PAYMENT_METHOD_LABEL[paymentMethod] ?? paymentMethod}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <span className="field-hint">Devizanem</span>
            <span>{currencyCode}</span>
          </div>
          <label className="field">
            ÁFA dátuma (beküldéshez)
            <span className="field-hint">
              Ha üresen hagyod, a fenti Billingo teljesítés dátuma megy ki ÁFA teljesítés
              dátumaként — itt csak akkor adj meg mást, ha ettől eltérő ÁFA dátumot kell
              könyvelni.
            </span>
            <input
              type="date"
              value={vatFulfillmentDateOverride}
              disabled={!canEdit}
              onChange={(e) => setVatFulfillmentDateOverride(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Termék neve</th>
              <th>Nettó érték</th>
              <th>Áfa kulcs (Billingo)</th>
              <th>Áfa besorolás (IMA)</th>
              <th>Árbevétel kontír</th>
              <th>Áfa kontír</th>
              <th>Előjel</th>
              <th>Milyen szabály futott le rá</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx}>
                <td>
                  {line.productName}
                  {line.comment && <div className="muted text-sm">{line.comment}</div>}
                </td>
                <td>{line.netAmount.toLocaleString("hu-HU")}</td>
                <td>{line.vatPercentOrCode}</td>
                <td>{line.approvedVatCode ?? <span className="muted">—</span>}</td>
                <td>{line.approvedGlaCode ?? <span className="muted">—</span>}</td>
                <td>{line.approvedVatGlaCode ?? <span className="muted">—</span>}</td>
                <td>{line.approvedAmountSign === "negative" ? "Negatív" : "Eredeti"}</td>
                <td>
                  {line.suggestedRuleSource ? (
                    <MappingRuleSourceBadge source={line.suggestedRuleSource} />
                  ) : (
                    <span className="muted text-sm">—</span>
                  )}
                </td>
                <td>
                  {canEdit && (
                    <button className="btn btn-sm" onClick={() => setEditingLineIdx(idx)}>
                      Szerkesztés
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingLineIdx != null && lines[editingLineIdx] && (
        <LineEditModal
          line={lines[editingLineIdx]!}
          onClose={() => setEditingLineIdx(null)}
          onSave={(data) => saveLineFromModal(editingLineIdx, data)}
        />
      )}

      {error && <p className="alert alert-error">{error}</p>}

      <div className="cluster">
        {canEdit && (
          <button className="btn btn-primary" onClick={approve} disabled={submitting || !isFullyClassified}>
            Jóváhagyás
          </button>
        )}
        {(status === "approved" || status === "failed") && (
          <button className="btn btn-primary" onClick={submitToIma} disabled={submitting}>
            {status === "failed" ? "Újraküldés IMA-nak" : "Beküldés IMA-nak"}
          </button>
        )}
        {status === "approved" && (
          <button className="btn" onClick={unapprove} disabled={submitting}>
            Jóváhagyás visszavonása
          </button>
        )}
        {status === "rejected" ? (
          <button className="btn" onClick={unreject} disabled={submitting}>
            Elutasítás visszavonása
          </button>
        ) : (
          canReject &&
          !showRejectForm && (
            <button className="btn btn-danger" onClick={() => setShowRejectForm(true)} disabled={submitting}>
              Elutasítás
            </button>
          )
        )}
      </div>

      {showRejectForm && (
        <div className="card stack">
          <label className="field">
            Elutasítás indoklása
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="pl. téves adat, duplikátum, nem könyvelendő"
            />
          </label>
          <div className="cluster">
            <button className="btn btn-danger" onClick={reject} disabled={submitting}>
              Elutasítás megerősítése
            </button>
            <button className="btn btn-sm" onClick={() => setShowRejectForm(false)} disabled={submitting}>
              Mégse
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

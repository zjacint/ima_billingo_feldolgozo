"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { InvoiceStatusBadge } from "@/components/StatusBadge";
import CodeNameCombobox, { type CodeNameOption } from "@/components/CodeNameCombobox";
import Spinner from "@/components/Spinner";

export interface InvoiceRow {
  id: string;
  billingoDocumentNumber: string;
  partnerName: string | null;
  fulfillmentDate: string | null;
  netAmount: number | null;
  vatAmount: number | null;
  grossAmount: number | null;
  currencyCode: string;
  /** Ember-olvasható típus-címke — "Előlegszámla" | "Végszámla" | "Normál számla" (ld. billingoApiClient.ts invoiceKindLabel). */
  invoiceKind: string;
  status: string;
  imaPushError: string | null;
  exchangeRateWarning: string | null;
  rejectionReason: string | null;
  /** A Billingo-oldali `cancelled` mező — ld. docs/tervezes.md 15. fejezet. */
  billingoCancelled: boolean;
}

export interface RuleOption {
  id: string;
  /** Ember-olvasható összefoglaló a szabály feltételeiről (ld. summarizeRuleConditions). */
  summary: string;
  glaCode: string;
  vatCode: string;
  vatGlaCode: string | null;
  amountSign: "original" | "negative";
}

const NO_CHANGE = "__no_change__";

/**
 * Tömeges kontír/áfa/előjel beállítás a Számlák oldalon kijelölt
 * számlákra — ld. docs/tervezes.md 10. fejezet. A szabály-választó
 * pusztán kényelmi funkció: kiválasztáskor a választott szabály kimeneti
 * mezőivel tölti fel az alábbi mezőket, amik ezután kézzel is
 * módosíthatók/törölhetők — a mentés mindkét esetben ugyanazt a
 * `bulk-set-mapping` végpontot hívja. MINDEN mező opcionális — csak a
 * ténylegesen kitöltött mezők módosulnak a kijelölt számlák MINDEN
 * tételsorán.
 */
function BulkMappingModal({
  count,
  glaAccountOptions,
  vatKeyOptions,
  ruleOptions,
  onClose,
  onSave,
}: {
  count: number;
  glaAccountOptions: CodeNameOption[];
  vatKeyOptions: CodeNameOption[];
  ruleOptions: RuleOption[];
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [ruleId, setRuleId] = useState("");
  const [glaCode, setGlaCode] = useState("");
  const [vatCode, setVatCode] = useState("");
  const [vatGlaCode, setVatGlaCode] = useState("");
  const [amountSign, setAmountSign] = useState(NO_CHANGE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAnyChange = Boolean(glaCode || vatCode || vatGlaCode || amountSign !== NO_CHANGE);

  function applyRule(id: string) {
    setRuleId(id);
    const rule = ruleOptions.find((r) => r.id === id);
    if (!rule) return;
    setGlaCode(rule.glaCode);
    setVatCode(rule.vatCode);
    setVatGlaCode(rule.vatGlaCode ?? "");
    setAmountSign(rule.amountSign);
  }

  async function handleSave() {
    const data: Record<string, unknown> = {};
    if (glaCode) data.glaCode = glaCode;
    if (vatCode) data.vatCode = vatCode;
    if (vatGlaCode) data.vatGlaCode = vatGlaCode;
    if (amountSign !== NO_CHANGE) data.amountSign = amountSign;

    setSaving(true);
    setError(null);
    try {
      await onSave(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <div className="card-title">Kontír/áfa beállítása ({count} számla)</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          A kijelölt számlák MINDEN tételsorára alkalmazódik, amit itt megadsz — csak a
          ténylegesen kitöltött mezők módosulnak. Beküldött/könyvelt/elutasított számlát nem
          érint. Ha egy már jóváhagyott számlát módosítasz, az visszakerül felülvizsgálandó
          állapotba (friss jóváhagyás szükséges).
        </p>
        {ruleOptions.length > 0 && (
          <label className="field">
            Szabály alkalmazása (opcionális, kényelmi kitöltés)
            <select value={ruleId} onChange={(e) => applyRule(e.target.value)}>
              <option value="">— válassz egy meglévő szabályt —</option>
              {ruleOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.summary} → {r.glaCode} / {r.vatCode}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="form-grid">
          <label className="field">
            Árbevétel kontír (GL kód)
            <CodeNameCombobox
              value={glaCode}
              onChange={(v) => {
                setGlaCode(v);
                setRuleId("");
              }}
              options={glaAccountOptions}
              placeholder="— nem módosítom —"
            />
          </label>
          <label className="field">
            Áfa kulcs (IMA)
            <CodeNameCombobox
              value={vatCode}
              onChange={(v) => {
                setVatCode(v);
                setRuleId("");
              }}
              options={vatKeyOptions}
              placeholder="— nem módosítom —"
            />
          </label>
          <label className="field">
            Áfa kontír (opcionális)
            <CodeNameCombobox
              value={vatGlaCode}
              onChange={(v) => {
                setVatGlaCode(v);
                setRuleId("");
              }}
              options={glaAccountOptions}
              placeholder="— nem módosítom —"
            />
          </label>
          <label className="field">
            Összeg előjele
            <select
              value={amountSign}
              onChange={(e) => {
                setAmountSign(e.target.value);
                setRuleId("");
              }}
            >
              <option value={NO_CHANGE}>— nem módosítom —</option>
              <option value="original">Eredeti</option>
              <option value="negative">Negatív</option>
            </select>
          </label>
        </div>
        {error && <p className="alert alert-error">{error}</p>}
        <div className="cluster" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-sm" onClick={onClose} disabled={saving}>
            Mégse
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving || !hasAnyChange}>
            {saving ? (
              <>
                <Spinner /> Mentés…
              </>
            ) : (
              `Alkalmazás ${count} számlára`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function InvoiceListTable({
  companyId,
  invoices,
  glaAccountOptions,
  vatKeyOptions,
  ruleOptions,
}: {
  companyId: string;
  invoices: InvoiceRow[];
  glaAccountOptions: CodeNameOption[];
  vatKeyOptions: CodeNameOption[];
  ruleOptions: RuleOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBulkMapping, setShowBulkMapping] = useState(false);

  const selectableForApprove = invoices.filter((i) => i.status === "synced" || i.status === "needs_review");
  const selectableForSubmit = invoices.filter((i) => i.status === "approved" || i.status === "failed");
  const selectableForUnapprove = invoices.filter((i) => i.status === "approved");
  const selectableForTransactionExport = invoices.filter((i) => i.status === "booked");
  const MAPPING_EDITABLE_STATUSES = new Set(["synced", "needs_review", "approved", "failed"]);
  const selectableForMapping = invoices.filter((i) => MAPPING_EDITABLE_STATUSES.has(i.status));
  const selectedApprovable = [...selected].filter((id) => selectableForApprove.some((i) => i.id === id));
  const selectedSubmittable = [...selected].filter((id) => selectableForSubmit.some((i) => i.id === id));
  const selectedUnapprovable = [...selected].filter((id) => selectableForUnapprove.some((i) => i.id === id));
  const selectedForTransactionExport = [...selected].filter((id) => selectableForTransactionExport.some((i) => i.id === id));
  const selectedForMapping = [...selected].filter((id) => selectableForMapping.some((i) => i.id === id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function bulkAction(kind: "bulk-approve" | "bulk-submit" | "bulk-unapprove", invoiceIds: string[]) {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/invoices/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen művelet (${res.status})`);
      const results: { invoiceId: string; ok: boolean; error?: string }[] = body.results ?? [];
      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount;
      setMessage(
        `${okCount} sikeres${failCount > 0 ? `, ${failCount} sikertelen (nyisd meg egyenként a hibás számlákat a részletekért)` : ""}.`
      );
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function downloadCsvExport(invoiceIds: string[]) {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/invoices/export-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sikertelen export (${res.status})`);
      }
      const skippedHeader = res.headers.get("X-Skipped-Invoices");
      const skipped: { billingoDocumentNumber: string | null; reason: string }[] = skippedHeader
        ? JSON.parse(decodeURIComponent(skippedHeader))
        : [];
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ima-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(
        skipped.length > 0
          ? `CSV letöltve. ${skipped.length} számla kimaradt (nincs teljes kontír/áfa): ${skipped
              .map((s) => s.billingoDocumentNumber ?? "?")
              .join(", ")}.`
          : "CSV letöltve."
      );
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function downloadTransactionIdExport(invoiceIds: string[]) {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/transaction-id-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Sikertelen export (${res.status})`);
      }
      const skippedHeader = res.headers.get("X-Skipped-Invoices");
      const skipped: { billingoDocumentNumber: string | null; reason: string }[] = skippedHeader
        ? JSON.parse(decodeURIComponent(skippedHeader))
        : [];
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tranzakcio-azonosito-import-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(
        skipped.length > 0
          ? `Tranzakcióazonosító import letöltve. ${skipped.length} számla kimaradt: ${skipped
              .map((s) => `${s.billingoDocumentNumber ?? "?"} (${s.reason})`)
              .join(", ")}.`
          : "Tranzakcióazonosító import letöltve."
      );
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function bulkSetMapping(data: Record<string, unknown>) {
    const res = await fetch(`/api/companies/${companyId}/invoices/bulk-set-mapping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceIds: selectedForMapping, data }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Sikertelen módosítás (${res.status})`);
    const results: { invoiceId: string; ok: boolean; error?: string }[] = body.results ?? [];
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    setMessage(
      `${okCount} számla módosítva${failCount > 0 ? `, ${failCount} sikertelen` : ""}.`
    );
    setSelected(new Set());
    setShowBulkMapping(false);
    router.refresh();
  }

  return (
    <div className="stack">
      <div className="cluster">
        <button
          className="btn btn-sm"
          disabled={submitting || selectedApprovable.length === 0}
          onClick={() => bulkAction("bulk-approve", selectedApprovable)}
        >
          Kijelöltek jóváhagyása ({selectedApprovable.length})
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={submitting || selectedSubmittable.length === 0}
          onClick={() => bulkAction("bulk-submit", selectedSubmittable)}
        >
          Kijelöltek beküldése IMA-nak ({selectedSubmittable.length})
        </button>
        <button
          className="btn btn-sm"
          disabled={submitting || selectedSubmittable.length === 0}
          onClick={() => downloadCsvExport(selectedSubmittable)}
          title="Amíg az IMA API-n keresztüli beküldés nincs élőben megerősítve, ez a kijelölt (jóváhagyott/hibás) számlákat IMA-import CSV-ként tölti le kézi feltöltéshez."
        >
          CSV export ({selectedSubmittable.length})
        </button>
        <button
          className="btn btn-sm"
          disabled={submitting || selectedForTransactionExport.length === 0}
          onClick={() => downloadTransactionIdExport(selectedForTransactionExport)}
          title="A már IMA-ban könyvelt, felismert fizetési tranzakcióazonosítót tartalmazó számlákhoz az IMA-oldali számla sor azonosítót kérdezi le (/invoiceanalytics), és ezzel párosítva adja ki CSV-ben."
        >
          Tranzakcióazonosító import ({selectedForTransactionExport.length})
        </button>
        <button
          className="btn btn-sm"
          disabled={submitting || selectedUnapprovable.length === 0}
          onClick={() => bulkAction("bulk-unapprove", selectedUnapprovable)}
        >
          Jóváhagyás visszavonása ({selectedUnapprovable.length})
        </button>
        <button
          className="btn btn-sm"
          disabled={submitting || selectedForMapping.length === 0}
          onClick={() => setShowBulkMapping(true)}
        >
          Kontír/áfa beállítása ({selectedForMapping.length})
        </button>
      </div>
      <p className="text-sm muted" style={{ margin: 0 }}>
        A &bdquo;Kontír/áfa beállítása&rdquo; a kijelölt, még be nem küldött számlák MINDEN
        tételsorára ráírja a megadott kontírt/áfa kulcsot/előjelet — egyenként vagy meglévő szabály
        alapján is.
      </p>
      <p className="alert alert-warning" style={{ margin: 0 }}>
        ⚠️ Az IMA API-s beküldés IMA-oldali szerverhibába ütközhet
        (&bdquo;import_batch_id&rdquo;) — próbáld ki egy olyan számlával, aminek
        partnere már párosítva van a Partnerek oldalon (a friss javítás ilyenkor
        ismert IMA-azonosítót küld, ami elkerülheti a hibát). Ha párosítatlan
        partnerrel is elhasal, vagy párosítottal is, használd a &bdquo;CSV
        export&rdquo; gombot tartalékként — ugyanazt a jóváhagyott/hibás kört tölti
        le IMA-import CSV-ként, kézi feltöltéshez.
      </p>
      {message && <p className="alert alert-success" style={{ margin: 0 }}>{message}</p>}
      {error && <p className="alert alert-error" style={{ margin: 0 }}>{error}</p>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={invoices.length > 0 && invoices.every((i) => selected.has(i.id))}
                  onChange={(e) => toggleAll(invoices.map((i) => i.id), e.target.checked)}
                />
              </th>
              <th>Számlaszám</th>
              <th>Partner</th>
              <th>Teljesítés dátuma</th>
              <th>Nettó</th>
              <th>Áfa</th>
              <th>Bruttó</th>
              <th>Típus</th>
              <th>Devizanem</th>
              <th>Státusz</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td>
                  <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} />
                </td>
                <td>{inv.billingoDocumentNumber}</td>
                <td>{inv.partnerName ?? "—"}</td>
                <td>{inv.fulfillmentDate ? new Date(inv.fulfillmentDate).toLocaleDateString("hu-HU") : "—"}</td>
                <td>{inv.netAmount != null ? inv.netAmount.toLocaleString("hu-HU") : "—"}</td>
                <td>{inv.vatAmount != null ? inv.vatAmount.toLocaleString("hu-HU") : "—"}</td>
                <td>{inv.grossAmount != null ? inv.grossAmount.toLocaleString("hu-HU") : "—"}</td>
                <td>{inv.invoiceKind}</td>
                <td>{inv.currencyCode}</td>
                <td>
                  <InvoiceStatusBadge status={inv.status} />
                  {inv.billingoCancelled && (
                    <div className="text-sm" style={{ color: "var(--color-danger)", marginTop: "0.2rem" }}>
                      Törölve Billingo-ban
                    </div>
                  )}
                  {inv.status === "rejected" && inv.rejectionReason && (
                    <div className="muted text-sm" style={{ marginTop: "0.2rem" }}>
                      {inv.rejectionReason}
                    </div>
                  )}
                  {inv.exchangeRateWarning && (
                    <div className="text-sm" style={{ color: "var(--color-warning)", marginTop: "0.2rem" }}>
                      ⚠ {inv.exchangeRateWarning}
                    </div>
                  )}
                </td>
                <td>
                  <Link href={`/dashboard/${companyId}/invoices/${inv.id}`} className="btn btn-sm">
                    Megnyitás
                  </Link>
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={11} className="muted">
                  Nincs a szűrésnek megfelelő számla.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showBulkMapping && (
        <BulkMappingModal
          count={selectedForMapping.length}
          glaAccountOptions={glaAccountOptions}
          vatKeyOptions={vatKeyOptions}
          ruleOptions={ruleOptions}
          onClose={() => setShowBulkMapping(false)}
          onSave={bulkSetMapping}
        />
      )}
    </div>
  );
}

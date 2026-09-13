"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type CodeNameOption } from "@/components/CodeNameCombobox";

interface OssVatMappingRow {
  id: string;
  countryCode: string;
  billingoVatValue: string;
  imaVatCode: string;
  note: string | null;
}

function VatCodeSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: CodeNameOption[];
  onChange: (value: string) => void;
}) {
  const hasCurrentValue = value === "" || options.some((o) => o.code === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 160 }}>
      <option value="" disabled>
        {options.length === 0 ? "— nincs elérhető áfa kulcs (frissítsd fent) —" : "— válassz —"}
      </option>
      {!hasCurrentValue && <option value={value}>{value} (nincs a jelenlegi listában)</option>}
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.code} — {o.name}
        </option>
      ))}
    </select>
  );
}

/**
 * SZIGORÚ (ország + Billingo áfa érték) -> IMA áfa kód megfeleltetés az OSS
 * (uniós egyablakos rendszer) szerint kiállított számlákhoz — ld.
 * ossThreshold.ts, docs/tervezes.md 13. fejezet. Csak akkor kötelező a
 * beküldés/CSV export előtt, ha a fenti "OSS jelző" be van kapcsolva ÉS a
 * partner OSS-érintett (külföldi EU magánszemély) — egyébként pusztán
 * előkészíthető.
 */
export default function OssVatMappingSettings({
  companyId,
  vatKeyOptions,
  mappings,
}: {
  companyId: string;
  vatKeyOptions: CodeNameOption[];
  mappings: OssVatMappingRow[];
}) {
  const router = useRouter();
  const [countryCode, setCountryCode] = useState("");
  const [billingoVatValue, setBillingoVatValue] = useState("");
  const [imaVatCode, setImaVatCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function createMapping() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/oss-vat-mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryCode, billingoVatValue, imaVatCode, note: note || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen létrehozás (${res.status})`);
      setCountryCode("");
      setBillingoVatValue("");
      setImaVatCode("");
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function patchMapping(id: string, data: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/companies/${companyId}/oss-vat-mappings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      router.refresh();
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? `Sikertelen módosítás (${res.status})`);
  }

  async function deleteMapping(id: string) {
    if (!window.confirm("Biztosan törlöd ezt az OSS áfa megfeleltetést?")) return;
    const res = await fetch(`/api/companies/${companyId}/oss-vat-mappings/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="card stack">
      <div className="card-title">OSS áfa kulcs megfeleltetés (tagállam szerint)</div>
      <p className="text-sm muted" style={{ marginTop: 0 }}>
        Csak akkor kötelező, ha fent az &bdquo;OSS jelző&rdquo; be van kapcsolva: külföldi EU
        magánszemély partnernek a saját tagállama áfájával kiállított számla beküldése/CSV
        exportja addig figyelmeztet, amíg a ténylegesen használt (tagállam, Billingo áfa érték)
        párhoz nincs itt IMA áfa kód rendelve. Egyes tagállamok azonos áfa kulcsot is használhatnak
        — ezért a tagállam MINDIG a megfeleltetés része, nem csak az áfa érték.
      </p>

      <div className="form-grid">
        <label className="field">
          Tagállam (ISO kód)
          <input
            type="text"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            placeholder="pl. DE"
            maxLength={2}
            style={{ maxWidth: 80 }}
          />
        </label>
        <label className="field">
          Billingo áfa érték
          <input
            type="text"
            value={billingoVatValue}
            onChange={(e) => setBillingoVatValue(e.target.value)}
            placeholder="pl. 19%"
          />
        </label>
        <label className="field">
          IMA áfa kód
          <VatCodeSelect value={imaVatCode} options={vatKeyOptions} onChange={setImaVatCode} />
        </label>
        <label className="field">
          Megjegyzés (opcionális)
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      <div>
        <button
          className="btn btn-primary"
          onClick={createMapping}
          disabled={submitting || countryCode.trim().length !== 2 || !billingoVatValue.trim() || !imaVatCode.trim()}
        >
          Létrehozás
        </button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Tagállam</th>
              <th>Billingo áfa érték</th>
              <th>IMA áfa kód</th>
              <th>Megjegyzés</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => (
              <tr key={m.id}>
                <td>
                  <input
                    type="text"
                    defaultValue={m.countryCode}
                    maxLength={2}
                    style={{ maxWidth: 70 }}
                    onBlur={(e) => {
                      const next = e.target.value.toUpperCase();
                      if (next !== m.countryCode) patchMapping(m.id, { countryCode: next });
                    }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    defaultValue={m.billingoVatValue}
                    onBlur={(e) =>
                      e.target.value !== m.billingoVatValue &&
                      patchMapping(m.id, { billingoVatValue: e.target.value })
                    }
                    style={{ minWidth: 100 }}
                  />
                </td>
                <td>
                  <VatCodeSelect
                    value={m.imaVatCode}
                    options={vatKeyOptions}
                    onChange={(value) => value !== m.imaVatCode && patchMapping(m.id, { imaVatCode: value })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    defaultValue={m.note ?? ""}
                    onBlur={(e) => e.target.value !== (m.note ?? "") && patchMapping(m.id, { note: e.target.value || null })}
                    style={{ minWidth: 140 }}
                  />
                </td>
                <td>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteMapping(m.id)}>
                    Törlés
                  </button>
                </td>
              </tr>
            ))}
            {mappings.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Még nincs OSS áfa megfeleltetés.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

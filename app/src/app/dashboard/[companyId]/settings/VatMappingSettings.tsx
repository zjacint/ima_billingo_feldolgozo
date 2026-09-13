"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type CodeNameOption } from "@/components/CodeNameCombobox";

interface VatMappingRow {
  id: string;
  billingoVatValue: string;
  imaVatCode: string;
  note: string | null;
}

/**
 * Az IMA áfa kód KIZÁRÓLAG az API-n lekért `/vatkeys` listából választható
 * legördülőben — ld. docs/tervezes.md 8.3. Szigorú `<select>` (nem
 * szabadszöveges `CodeNameCombobox`), hogy csak ténylegesen létező IMA
 * áfa kód legyen párosítható.
 */
function VatCodeSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: CodeNameOption[];
  onChange: (value: string) => void;
}) {
  // Ha a jelenlegi érték (pl. korábbi, még szabadszöveges bevitelből
  // maradt kód, vagy egy azóta frissített referencia-listából kikerült
  // kód) nincs benne az aktuális listában, mégis megjelenítjük — hogy ne
  // tűnjön el/üresedjen ki láthatatlanul a mezőből.
  const hasCurrentValue = value === "" || options.some((o) => o.code === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 160 }}>
      <option value="" disabled>
        {options.length === 0 ? "— nincs elérhető áfa kulcs (frissítsd fent) —" : "— válassz —"}
      </option>
      {!hasCurrentValue && (
        <option value={value}>{value} (nincs a jelenlegi listában)</option>
      )}
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.code} — {o.name}
        </option>
      ))}
    </select>
  );
}

function EditableVatCodeCell({
  initialValue,
  options,
  onCommit,
}: {
  initialValue: string;
  options: CodeNameOption[];
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <VatCodeSelect
      value={value}
      options={options}
      onChange={(next) => {
        setValue(next);
        if (next !== initialValue) onCommit(next);
      }}
    />
  );
}

/**
 * Explicit, kézzel karbantartott Billingo áfa érték -> IMA áfa kód
 * megfeleltetés — a kontírozási szabályok (Kontír/áfa szabályok oldal)
 * mellett, jól láthatóan/szerkeszthetően a Beállításokban (ld.
 * docs/tervezes.md 8.3). Ez a legalacsonyabb prioritású forrás a
 * javaslati motorban (`suggestMappingForLine`) — csak akkor esik erre
 * vissza, ha egyetlen MappingRule sem ad áfa kódot.
 */
export default function VatMappingSettings({
  companyId,
  vatKeyOptions,
  mappings,
}: {
  companyId: string;
  vatKeyOptions: CodeNameOption[];
  mappings: VatMappingRow[];
}) {
  const router = useRouter();
  const [billingoVatValue, setBillingoVatValue] = useState("");
  const [imaVatCode, setImaVatCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function createMapping() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/vat-mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingoVatValue, imaVatCode, note: note || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen létrehozás (${res.status})`);
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
    const res = await fetch(`/api/companies/${companyId}/vat-mappings/${id}`, {
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
    if (!window.confirm("Biztosan törlöd ezt az áfa megfeleltetést?")) return;
    const res = await fetch(`/api/companies/${companyId}/vat-mappings/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="card stack">
      <div className="card-title">ÁFA kulcs megfeleltetés</div>
      <p className="text-sm muted" style={{ marginTop: 0 }}>
        A Billingo tételen szereplő áfa érték (pl. „27%”, „AAM”, „F.AFA”) és az IMA-nak
        ténylegesen küldendő áfa kód közötti explicit párosítás — a kontírozási szabályok
        (partner/termék-specifikus) mellett ez az &bdquo;alapértelmezett&rdquo; fordítás:
        csak akkor lép életbe, ha egyetlen Kontír/áfa szabály sem ad áfa kódot egy tételre.
      </p>

      <div className="form-grid">
        <label className="field">
          Billingo áfa érték
          <input
            type="text"
            value={billingoVatValue}
            onChange={(e) => setBillingoVatValue(e.target.value)}
            placeholder="pl. 27% vagy AAM"
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
          disabled={submitting || !billingoVatValue.trim() || !imaVatCode.trim()}
        >
          Létrehozás
        </button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
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
                    defaultValue={m.billingoVatValue}
                    onBlur={(e) =>
                      e.target.value !== m.billingoVatValue &&
                      patchMapping(m.id, { billingoVatValue: e.target.value })
                    }
                    style={{ minWidth: 120 }}
                  />
                </td>
                <td>
                  <EditableVatCodeCell
                    initialValue={m.imaVatCode}
                    options={vatKeyOptions}
                    onCommit={(value) => patchMapping(m.id, { imaVatCode: value })}
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
                <td colSpan={4} className="muted">
                  Még nincs áfa megfeleltetés.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

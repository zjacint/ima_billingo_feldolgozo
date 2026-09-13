"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CodeNameCombobox, { type CodeNameOption } from "@/components/CodeNameCombobox";

interface PartnerRow {
  id: string;
  name: string;
  taxNumber: string | null;
  postalCode: string | null;
  city: string | null;
  addressStreet: string | null;
  imaPartnerCode: string | null;
  imaPartnerName: string | null;
}

/**
 * Egy partner IMA-párosításának szerkesztő panelje — ugyanaz a lista/modál
 * felosztás, mint a Kontír/áfa szabályoknál és a számla tételsoroknál: a
 * táblázat csak olvasható, a tényleges szerkesztés (a kereshető IMA-partner
 * combobox) egy fókuszált panelben történik soronként, hogy sok partnernél
 * ne kelljen egyszerre több száz interaktív widgetet renderelni.
 */
function PartnerEditModal({
  partner,
  imaOptions,
  onClose,
  onSave,
}: {
  partner: PartnerRow;
  imaOptions: CodeNameOption[];
  onClose: () => void;
  onSave: (imaPartnerCode: string) => Promise<void>;
}) {
  const [value, setValue] = useState(partner.imaPartnerCode ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card stack" onClick={(e) => e.stopPropagation()}>
        <div className="card-title">{partner.name}</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          Adószám: {partner.taxNumber ?? "— nincs —"}
        </p>
        <label className="field">
          IMA partner
          <CodeNameCombobox value={value} onChange={setValue} options={imaOptions} placeholder="pl. 123" />
        </label>
        {error && <p className="alert alert-error">{error}</p>}
        <div className="cluster" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-sm" onClick={onClose} disabled={saving}>
            Mégse
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
            Mentés
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PartnersEditor({
  companyId,
  partners,
  imaPartnerOptions,
  totalUnmatchedCount,
}: {
  companyId: string;
  partners: PartnerRow[];
  imaPartnerOptions: (CodeNameOption & { taxNumber: string | null })[];
  totalUnmatchedCount: number;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const imaOptions: CodeNameOption[] = imaPartnerOptions.map((p) => ({ code: p.code, name: p.name }));
  const editingPartner = partners.find((p) => p.id === editingId) ?? null;

  async function save(partnerId: string, imaPartnerCode: string) {
    const res = await fetch(`/api/companies/${companyId}/partners/${partnerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imaPartnerCode }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Sikertelen mentés (${res.status})`);
    router.refresh();
  }

  async function autoMatch() {
    setMatching(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/partners/auto-match`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen párosítás (${res.status})`);
      setMessage(
        `${body.matchedCount} partner automatikusan párosítva (${body.candidateCount} párosítatlan közül): ` +
          `${body.matchedByTaxNumber} adószám alapján, ${body.matchedByName} pontos névegyezés alapján ` +
          `(pl. adószám nélküli magánszemély vevőknél).`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setMatching(false);
    }
  }

  async function consolidate() {
    if (!window.confirm("Biztosan összevonod a duplikált partnereket? A művelet nem visszavonható.")) return;
    setConsolidating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/partners/consolidate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen összevonás (${res.status})`);
      setMessage(
        `${body.mergedGroups} duplikátum-csoport összevonva, ${body.deletedPartners} felesleges partner-sor törölve ` +
          "(a hozzájuk tartozó számlák és szabályok átkerültek a megmaradt partnerre)."
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setConsolidating(false);
    }
  }

  return (
    <div className="stack">
      <div className="cluster">
        <button className="btn btn-sm" onClick={autoMatch} disabled={matching || totalUnmatchedCount === 0}>
          Automatikus párosítás adószám alapján ({totalUnmatchedCount} párosítatlan)
        </button>
        <button className="btn btn-sm" onClick={consolidate} disabled={consolidating}>
          Duplikátumok összevonása
        </button>
      </div>
      {message && <p className="alert alert-success" style={{ margin: 0 }}>{message}</p>}
      {error && <p className="alert alert-error" style={{ margin: 0 }}>{error}</p>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Partner neve</th>
              <th>Adószám</th>
              <th>Számlázási cím</th>
              <th>IMA partner</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => {
              const complete = Boolean(p.taxNumber && p.postalCode && p.city && p.addressStreet);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.taxNumber ?? <span className="muted">— nincs —</span>}</td>
                  <td>
                    {complete ? (
                      <span className="badge badge-success">Teljes</span>
                    ) : (
                      <span className="badge badge-warning">Hiányos — IMA beküldést blokkolja</span>
                    )}
                  </td>
                  <td>
                    {p.imaPartnerCode ? (
                      p.imaPartnerName ?? `#${p.imaPartnerCode}`
                    ) : (
                      <span className="muted">— nincs párosítva —</span>
                    )}
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => setEditingId(p.id)}>
                      Szerkesztés
                    </button>
                  </td>
                </tr>
              );
            })}
            {partners.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nincs partner ezen az oldalon.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingPartner && (
        <PartnerEditModal
          partner={editingPartner}
          imaOptions={imaOptions}
          onClose={() => setEditingId(null)}
          onSave={(imaPartnerCode) => save(editingPartner.id, imaPartnerCode)}
        />
      )}
    </div>
  );
}

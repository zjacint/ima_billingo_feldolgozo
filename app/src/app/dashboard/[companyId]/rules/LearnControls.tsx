"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";

interface PendingMerge {
  manualRuleId: string;
  manualRuleSummary: string;
  glaCode: string;
  vatCode: string;
  field: "productNamePattern" | "vatPattern";
  valuesToAdd: string[];
}

const FIELD_LABEL: Record<PendingMerge["field"], string> = {
  productNamePattern: "termékek",
  vatPattern: "áfa-minták",
};

/** Ugyanarra a (szabály, mező) kulcsra érkező javaslatokat egy sorba vonja össze, az értékeket deduplikálva. */
function mergePendingMerges(existing: PendingMerge[], incoming: PendingMerge[]): PendingMerge[] {
  const byKey = new Map(existing.map((m) => [`${m.manualRuleId}::${m.field}`, { ...m, valuesToAdd: [...m.valuesToAdd] }]));
  for (const m of incoming) {
    const key = `${m.manualRuleId}::${m.field}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...m, valuesToAdd: [...m.valuesToAdd] });
      continue;
    }
    for (const v of m.valuesToAdd) {
      if (!current.valuesToAdd.some((existingValue) => existingValue.toLowerCase() === v.toLowerCase())) {
        current.valuesToAdd.push(v);
      }
    }
  }
  return [...byKey.values()];
}

export default function LearnControls({ companyId, canLearn }: { companyId: string; canLearn: boolean }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [findingExpansions, setFindingExpansions] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingMerges, setPendingMerges] = useState<PendingMerge[]>([]);

  async function run() {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/learn`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen művelet (${res.status})`);
      setMessage(
        `Tanulás kész: ${body.fetchedRows} sor, ${body.createdOrUpdated} szabály ` +
          `(termék- és áfakulcs-alapú kontír/áfa csoportonként egy) frissítve/létrehozva` +
          (body.skippedIncomplete > 0 ? `, ${body.skippedIncomplete} sor kimaradt hiányos adat miatt.` : ".")
      );
      setPendingMerges((prev) => mergePendingMerges(prev, body.pendingMerges ?? []));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  async function findExpansions() {
    setFindingExpansions(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/rule-expansions`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen keresés (${res.status})`);
      const found: PendingMerge[] = body.pendingMerges ?? [];
      setMessage(
        found.length > 0
          ? `${found.length} kézi szabályhoz találtunk bővítési javaslatot (részleges egyezéssel talált tételek alapján).`
          : "Nincs bővítési javaslat — minden kézi szabályt eddig csak a mintájában szó szerint szereplő értékkel illesztett a rendszer."
      );
      setPendingMerges((prev) => mergePendingMerges(prev, found));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setFindingExpansions(false);
    }
  }

  async function applyMerges() {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/learn/apply-merges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merges: pendingMerges.map((m) => ({ manualRuleId: m.manualRuleId, field: m.field, valuesToAdd: m.valuesToAdd })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen összevonás (${res.status})`);
      setMessage(`Összevonva: ${body.mergedRules} kézi szabály bővült ${body.addedValues} értékkel.`);
      setPendingMerges([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="card stack">
      <div className="cluster">
        <button className="btn btn-primary" onClick={run} disabled={!canLearn || submitting}>
          {submitting ? (
            <>
              <Spinner /> Tanulás…
            </>
          ) : (
            "Szabályok tanulása (IMA invoiceanalytics)"
          )}
        </button>
        <button className="btn btn-sm" onClick={findExpansions} disabled={findingExpansions}>
          {findingExpansions ? (
            <>
              <Spinner /> Keresés…
            </>
          ) : (
            "Bővítési javaslatok keresése"
          )}
        </button>
      </div>
      {message && <p className="alert alert-success" style={{ margin: 0 }}>{message}</p>}
      {error && <p className="alert alert-error" style={{ margin: 0 }}>{error}</p>}

      {pendingMerges.length > 0 && (
        <div className="card stack" style={{ background: "var(--color-warning-soft, transparent)" }}>
          <div className="card-title">{pendingMerges.length} kézi szabály bővítési javaslattal</div>
          <p className="text-sm muted" style={{ marginTop: 0 }}>
            Vagy azért, mert egy tanult eredmény pontosan ugyanarra a kontír/áfa eredményre futott ki, mint egy
            meglévő kézi szabály (ilyenkor nem jött létre külön tanult szabály), vagy mert egy tétel a kézi szabály
            mintáját csak részlegesen (nem szó szerint) találta el. Jóváhagyás esetén a lenti értékek hozzáfűzésre
            kerülnek az érintett kézi szabály megfelelő mintájához — a kontír/áfa nem változik. Jóváhagyás nélkül
            legközelebb újra megjelennek.
          </p>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {pendingMerges.map((m) => (
              <li key={`${m.manualRuleId}::${m.field}`}>
                <strong>{m.manualRuleSummary}</strong> ({m.glaCode} / {m.vatCode}) — hozzáadandó {FIELD_LABEL[m.field]}:{" "}
                {m.valuesToAdd.join(", ")}
              </li>
            ))}
          </ul>
          <div className="cluster">
            <button className="btn btn-sm btn-primary" onClick={applyMerges} disabled={applying}>
              {applying ? (
                <>
                  <Spinner /> Összevonás…
                </>
              ) : (
                "Összevonások jóváhagyása"
              )}
            </button>
            <button className="btn btn-sm" onClick={() => setPendingMerges([])} disabled={applying}>
              Mégse
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";

interface InvoiceNumberGapGroup {
  prefix: string;
  minNumber: number;
  maxNumber: number;
  missingNumbers: number[];
}

export default function SyncControls({ companyId, canSync }: { companyId: string; canSync: boolean }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<"sync" | "recompute" | "gaps" | "fillgaps" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gapGroups, setGapGroups] = useState<InvoiceNumberGapGroup[] | null>(null);

  async function runSync() {
    setSubmitting("sync");
    setError(null);
    setMessage(null);
    try {
      // A szinkron CSOMAGONKÉNT (kérésenként ~200 bizonylat) fut — egyetlen
      // kérés sem futhat bele a Cloud Run időtúllépésébe (504), függetlenül
      // attól, hogy összesen mennyi bizonylatot kell lekérdezni (ld.
      // docs/tervezes.md 7. fejezet). A kliens a kapott cursor-t adja vissza
      // a következő hívásnak, amíg a szerver `done: true`-t nem jelez.
      let cursor: Record<string, unknown> | null = null;
      let lastResult: { fetched: number; created: number; updated: number } | null = null;
      for (;;) {
        const res: Response = await fetch(`/api/companies/${companyId}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor }),
        });
        const body: Record<string, any> = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Sikertelen művelet (${res.status})`);
        lastResult = body.result;
        setMessage(
          `Szinkronizálás… ${body.result.fetched} lekérve eddig, ${body.result.created} új, ${body.result.updated} frissítve.`
        );
        if (body.done) break;
        cursor = body.cursor;
      }
      setMessage(
        `Szinkron kész: ${lastResult?.fetched ?? 0} lekérve, ${lastResult?.created ?? 0} új, ${lastResult?.updated ?? 0} frissítve.`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(null);
    }
  }

  async function runRecompute() {
    setSubmitting("recompute");
    setError(null);
    setMessage(null);
    try {
      // Csomagonként (kérésenként 20 számla) fut, ugyanazon okból, mint a
      // szinkron: nagyobb számlaállománynál elkerüli a 504 timeout-ot —
      // ld. docs/tervezes.md 9.4.
      let cursor: Record<string, unknown> | null = null;
      let lastChecked = 0;
      for (;;) {
        const res: Response = await fetch(`/api/companies/${companyId}/recompute-suggestions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor }),
        });
        const body: Record<string, any> = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Sikertelen művelet (${res.status})`);
        lastChecked = body.checked;
        setMessage(`Javaslatok frissítése… ${body.checked} számla ellenőrizve eddig.`);
        if (body.done) break;
        cursor = body.cursor;
      }
      setMessage(`Javaslatok frissítve: ${lastChecked} még nem jóváhagyott számla ellenőrizve.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(null);
    }
  }

  async function runGapCheck() {
    setSubmitting("gaps");
    setError(null);
    setMessage(null);
    setGapGroups(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/invoice-number-gaps`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen ellenőrzés (${res.status})`);
      setGapGroups(body.groups);
      const totalMissing = (body.groups as InvoiceNumberGapGroup[]).reduce((sum, g) => sum + g.missingNumbers.length, 0);
      setMessage(
        totalMissing > 0
          ? `${body.checkedCount} számla ellenőrizve, ${totalMissing} hiányzó sorszám találva (részletek lent).`
          : `${body.checkedCount} számla ellenőrizve, nincs hiányzó sorszám.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(null);
    }
  }

  async function runGapFill() {
    setSubmitting("fillgaps");
    setError(null);
    setMessage(null);
    setGapGroups(null);
    try {
      // Ugyanaz a csomagolt/folytatható minta, mint a szinkronnál — a
      // hiánylista akár száz tartományt is tartalmazhat, ld.
      // runGapFillBatch (billingoSync.ts) doksztringje.
      let cursor: Record<string, unknown> | null = null;
      let lastResult: { numbersChecked: number; imported: number; skippedNonInvoiceType: number; notFoundInBillingo: number } | null =
        null;
      let skippedNoYear: string[] = [];
      for (;;) {
        const res: Response = await fetch(`/api/companies/${companyId}/fill-invoice-gaps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor }),
        });
        const body: Record<string, any> = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Sikertelen művelet (${res.status})`);
        lastResult = body.result;
        skippedNoYear = body.skippedNoYear ?? [];
        setMessage(`Hiányzó számlák lekérése… ${body.result.numbersChecked} sorszám ellenőrizve eddig.`);
        if (body.done) break;
        cursor = body.cursor;
      }
      setMessage(
        `Kész: ${lastResult?.numbersChecked ?? 0} hiányzó sorszám ellenőrizve, ${lastResult?.imported ?? 0} számla importálva, ` +
          `${lastResult?.skippedNonInvoiceType ?? 0} nem-számla típusként kihagyva, ${lastResult?.notFoundInBillingo ?? 0} ` +
          `nem létezik Billingo-ban.` +
          (skippedNoYear.length > 0
            ? ` (${skippedNoYear.length} prefixnél nem sikerült évet kinyerni, kézzel kell ellenőrizni: ${skippedNoYear.join(", ")})`
            : "")
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="card stack">
      <div className="cluster">
        <button className="btn btn-primary" onClick={runSync} disabled={!canSync || submitting !== null}>
          {submitting === "sync" ? (
            <>
              <Spinner /> Szinkronizálás…
            </>
          ) : (
            "Szinkronizálás most (Billingo)"
          )}
        </button>
        <button className="btn" onClick={runRecompute} disabled={submitting !== null}>
          {submitting === "recompute" ? (
            <>
              <Spinner /> Frissítés…
            </>
          ) : (
            "Javaslatok újraszámolása"
          )}
        </button>
        <button className="btn" onClick={runGapCheck} disabled={submitting !== null}>
          {submitting === "gaps" ? (
            <>
              <Spinner /> Ellenőrzés…
            </>
          ) : (
            "Hiányzó számlaszámok ellenőrzése"
          )}
        </button>
        <button className="btn" onClick={runGapFill} disabled={submitting !== null}>
          {submitting === "fillgaps" ? (
            <>
              <Spinner /> Lekérdezés…
            </>
          ) : (
            "Hiányzó számlák lekérése Billingo-ból"
          )}
        </button>
        <span className="muted text-sm">
          Ha új szabályt tanultál/vettél fel, a "Javaslatok újraszámolása" futtatja le a még nem
          jóváhagyott számlákra — szinkron nélkül, gyorsan.
        </span>
      </div>
      {message && <p className="alert alert-success" style={{ margin: 0 }}>{message}</p>}
      {error && <p className="alert alert-error" style={{ margin: 0 }}>{error}</p>}
      {gapGroups && gapGroups.length > 0 && (
        <div className="stack" style={{ gap: "0.25rem" }}>
          <p className="text-sm muted" style={{ margin: 0 }}>
            A hiányzó sorszám nem feltétlenül szinkronizálási hiba — lehet ténylegesen törölt
            bizonylat is, aminek Billingo egyáltalán nem ad ki adatot. A "Hiányzó számlák lekérése
            Billingo-ból" gomb célzottan rákérdez ezekre a sorszámokra, és megmondja, melyik létezik
            ténylegesen.
          </p>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {gapGroups.map((g) => (
              <li key={g.prefix} className="text-sm">
                <strong>„{g.prefix}”</strong> ({g.minNumber}–{g.maxNumber}): hiányzik{" "}
                {g.missingNumbers.map((n) => `${g.prefix}${n}`).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

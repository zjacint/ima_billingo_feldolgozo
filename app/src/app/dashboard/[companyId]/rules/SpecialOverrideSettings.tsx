"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Speciális, dokumentum-kapcsolatot figyelembe vevő kontír-felülbírálási
 * szabályok ki/bekapcsolása — ld. mappingRuleEngine.ts
 * `resolveInheritedLineMapping`/`suggestMappingForLine`, docs/tervezes.md
 * 24. fejezet, könyvelői kérés (2026.09.16-17). Ezeknek nincs
 * "szerkeszthető" tartalmuk (nem egy `MappingRule`-hoz hasonló, szabadon
 * definiálható feltétel/kimenet pár) — a céljuk (melyik főkönyvi számra
 * menjen) vagy előre rögzített (az elsődleges előleg főkönyvi szám, ld. a
 * Beállítások oldal), vagy magából az eredeti bizonylatból származik
 * (stornó/helyesbítő öröklés) — ezért a felület egyszerű, cégenkénti
 * ki/bekapcsolókból áll, könyvelői döntés: "egyenként, külön kapcsolóval".
 */
export default function SpecialOverrideSettings({
  companyId,
  initialEnableAdvanceSignOverride,
  initialEnableCancellationInheritance,
  initialEnableModificationInheritance,
}: {
  companyId: string;
  initialEnableAdvanceSignOverride: boolean;
  initialEnableCancellationInheritance: boolean;
  initialEnableModificationInheritance: boolean;
}) {
  const router = useRouter();
  const [enableAdvanceSignOverride, setEnableAdvanceSignOverride] = useState(initialEnableAdvanceSignOverride);
  const [enableCancellationInheritance, setEnableCancellationInheritance] = useState(
    initialEnableCancellationInheritance
  );
  const [enableModificationInheritance, setEnableModificationInheritance] = useState(
    initialEnableModificationInheritance
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enableAdvanceSignOverride,
          enableCancellationInheritance,
          enableModificationInheritance,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen mentés (${res.status})`);
      setMessage(
        "Mentve. A már szinkronizált, még nem jóváhagyott számlákon a Vezérlőpult „Javaslatok " +
          "újraszámolása” gombjával érvényesítheted az új beállítást."
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card stack">
      <div className="card-title">Speciális felülbírálási szabályok</div>
      <p className="text-sm muted" style={{ marginTop: 0 }}>
        Ezek NEM a normál Kontír/áfa szabályokkal (fent) egyenrangú, szabadon szerkeszthető
        szabályok — a bizonylatok közti KAPCSOLATOT figyelembe vevő, beépített mechanizmusok,
        amiket csak ki/be lehet kapcsolni. Alapértelmezetten ki vannak kapcsolva — csak akkor
        kapcsold be, ha átgondoltad, hogy a cégre illik-e.
      </p>

      <label className="cluster" style={{ fontWeight: 600, fontSize: "0.9rem", alignItems: "flex-start" }}>
        <input
          type="checkbox"
          checked={enableAdvanceSignOverride}
          onChange={(e) => setEnableAdvanceSignOverride(e.target.checked)}
        />
        <span>
          Végszámla negatív tételei — előleg-visszavonás
          <div className="text-sm muted" style={{ fontWeight: 400 }}>
            Ha a számlának van kapcsolódó elszámolt előlege, és egy tétel nettó összege negatív,
            az automatikusan az elsődleges előleg főkönyvi számra (ld. Beállítások oldal)
            kontírozódik — a megjegyzésben szereplő hivatkozás-felismerés MELLETT, kiegészítő
            jelként.
          </div>
        </span>
      </label>

      <label className="cluster" style={{ fontWeight: 600, fontSize: "0.9rem", alignItems: "flex-start" }}>
        <input
          type="checkbox"
          checked={enableCancellationInheritance}
          onChange={(e) => setEnableCancellationInheritance(e.target.checked)}
        />
        <span>
          Stornó számla — kontír öröklése az eredetiből
          <div className="text-sm muted" style={{ fontWeight: 400 }}>
            Egy stornó számla tételei a stornózott (eredeti) számla azonos tételének jóváhagyott
            kontírját/áfa kódját öröklik — termékmegnevezés, mennyiség és összeg alapú
            párosítással. Ha a párosítás nem egyértelmű, a normál szabály-illesztés dönt (nincs
            találgatás).
          </div>
        </span>
      </label>

      <label className="cluster" style={{ fontWeight: 600, fontSize: "0.9rem", alignItems: "flex-start" }}>
        <input
          type="checkbox"
          checked={enableModificationInheritance}
          onChange={(e) => setEnableModificationInheritance(e.target.checked)}
        />
        <span>
          Helyesbítő (módosító) számla — kontír öröklése az eredetiből
          <div className="text-sm muted" style={{ fontWeight: 400 }}>
            Ugyanaz, mint a stornó öröklés, de helyesbítő számlára — a párosítás itt jellemzően
            bizonytalanabb, ezért gyakrabban esik vissza a normál szabály-illesztésre.
          </div>
        </span>
      </label>

      {error && <p className="alert alert-error">{error}</p>}
      {message && <p className="alert alert-success">{message}</p>}
      <div>
        <button className="btn btn-primary" onClick={save} disabled={submitting}>
          Mentés
        </button>
      </div>
    </div>
  );
}

import Link from "next/link";
import type { OssStatus } from "@/lib/ossThreshold";

function formatHuf(n: number): string {
  return `${Math.round(n).toLocaleString("hu-HU")} Ft`;
}

/**
 * Folyamatos OSS küszöb-kijelzés a Számlák oldal tetején — ld.
 * ossThreshold.ts, docs/tervezes.md 13. fejezet, könyvelői kérés:
 * "Folyamatos figyelés valid ötlet, használjuk" (NEM csak számlánkénti
 * figyelmeztetés). FÜGGETLEN az "OSS jelző" beállítástól — ez a küszöb
 * MEGKÖZELÍTÉSÉRE/ÁTLÉPÉSÉRE figyelmeztet, hogy a könyvelő időben szóljon
 * a kliensnek a regisztráció szükségességéről.
 */
export default function OssStatusCard({ companyId, status }: { companyId: string; status: OssStatus }) {
  const ratioPercent = Math.min(200, Math.round(status.ratio * 100));
  const level: "ok" | "warning" | "danger" =
    status.currentYearCrossed ? "danger" : status.ratio >= 0.7 ? "warning" : "ok";
  const barColor =
    level === "danger" ? "var(--color-danger, #dc2626)" : level === "warning" ? "var(--color-warning, #d97706)" : "var(--color-success, #16a34a)";

  if (status.currentYearTotalHuf === 0 && status.previousYearTotalHuf === 0 && !status.ossRegistered) {
    return null;
  }

  return (
    <div className="card stack">
      <div className="card-title">OSS küszöb (külföldi EU magánszemély, magyar áfás számlák, {status.currentYear})</div>
      <div className="cluster" style={{ justifyContent: "space-between" }}>
        <span className="text-sm">
          {formatHuf(status.currentYearTotalHuf)} / {formatHuf(status.thresholdHuf)} ({ratioPercent}%)
        </span>
        {status.currentYearCrossed && <span className="alert alert-error" style={{ margin: 0, padding: "0.15rem 0.5rem" }}>Átlépve</span>}
        {!status.currentYearCrossed && level === "warning" && (
          <span className="alert alert-warning" style={{ margin: 0, padding: "0.15rem 0.5rem" }}>Közelít</span>
        )}
      </div>
      <div style={{ background: "var(--color-border, #e5e7eb)", borderRadius: 4, height: 8, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, ratioPercent)}%`, background: barColor, height: "100%" }} />
      </div>
      {status.currentYearCrossed && (
        <p className="alert alert-error" style={{ margin: 0 }}>
          Idén már meghaladta a 10.000 EUR-nak megfelelő (3.100.000 Ft) küszöböt a külföldi EU
          magánszemélyeknek magyar áfával kiállított számlák összege — szólj a kliensnek, hogy a
          tagállam áfájára kell áttérnie (OSS), és állítsd be a szigorú áfa megfeleltetést a
          Beállításokban.
        </p>
      )}
      {status.carriedOverFromPreviousYear && (
        <p className="alert alert-warning" style={{ margin: 0 }}>
          Tavaly ({status.currentYear - 1}) átlépte a küszöböt, és az OSS jelző be van kapcsolva —
          emiatt idén az év elejétől folytatólagosan OSS-köteles, függetlenül az idei összegtől.
        </p>
      )}
      {!status.ossRegistered && (
        <p className="text-sm muted" style={{ margin: 0 }}>
          Az &bdquo;OSS jelző&rdquo; jelenleg KI van kapcsolva — a szigorú áfa megfeleltetés nincs
          kikényszerítve. Ha a kliens ténylegesen regisztrált OSS-re, kapcsold be a{" "}
          <Link href={`/dashboard/${companyId}/settings`}>Beállításokban</Link>.
        </p>
      )}
    </div>
  );
}

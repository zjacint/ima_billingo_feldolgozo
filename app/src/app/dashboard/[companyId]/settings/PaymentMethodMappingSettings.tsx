"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const BILLINGO_PAYMENT_METHODS: { code: string; label: string }[] = [
  { code: "transfer", label: "Átutalás" },
  { code: "cash", label: "Készpénz" },
  { code: "card", label: "Bankkártya" },
  { code: "cod", label: "Utánvét" },
  { code: "other", label: "Egyéb" },
];

interface ImaPaymentMethodOption {
  desc: string;
  navPayMethodType: string | null;
}

/**
 * Explicit megfeleltetés a Billingo-ból normalizált fizetési mód-kódjaink
 * (fix, öt lehetséges érték — ld. `mapBillingoPaymentMethodToIma`) és a
 * cégnél ténylegesen létező IMA fizetési mód leírása között. Az IMA nyers
 * beküldő végpontja csak egy, a cégnél valóban létező `PaymentM_Desc`
 * értéket fogad el — élő beküldési hiba (HTTP 422, "Payment method not
 * found") nyomán vált kötelezővé ez a beállítás minden fizetési módra,
 * amit ténylegesen küldeni akarunk.
 */
export default function PaymentMethodMappingSettings({
  companyId,
  imaPaymentMethodOptions,
  initialMappings,
}: {
  companyId: string;
  imaPaymentMethodOptions: ImaPaymentMethodOption[];
  initialMappings: Record<string, string>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(initialMappings);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(code: string) {
    setSavingCode(code);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/payment-method-mappings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingoPaymentMethod: code, imaPaymentMethodDesc: values[code] ?? "" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen mentés (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ismeretlen hiba történt.");
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <div className="card stack">
      <div className="card-title">Fizetési mód megfeleltetés</div>
      <p className="text-sm muted" style={{ marginTop: 0 }}>
        Az IMA beküldés a fizetési módot leírás alapján azonosítja — csak a cégnél
        ténylegesen beállított IMA fizetési mód fogadható el. Minden itt párosítatlanul
        hagyott Billingo fizetési móddal érkező számla beküldése hibázni fog, amíg be nem
        állítod.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Billingo fizetési mód</th>
              <th>IMA fizetési mód</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {BILLINGO_PAYMENT_METHODS.map((bm) => {
              const changed = (values[bm.code] ?? "") !== (initialMappings[bm.code] ?? "");
              return (
                <tr key={bm.code}>
                  <td>{bm.label}</td>
                  <td style={{ minWidth: "16rem" }}>
                    <select
                      value={values[bm.code] ?? ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [bm.code]: e.target.value }))}
                    >
                      <option value="">
                        {imaPaymentMethodOptions.length === 0
                          ? "— nincs elérhető IMA fizetési mód (frissítsd fent) —"
                          : "— nincs beállítva —"}
                      </option>
                      {imaPaymentMethodOptions.map((o) => (
                        <option key={o.desc} value={o.desc}>
                          {o.desc}
                          {o.navPayMethodType ? ` (${o.navPayMethodType})` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="btn btn-sm" disabled={!changed || savingCode === bm.code} onClick={() => save(bm.code)}>
                      Mentés
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

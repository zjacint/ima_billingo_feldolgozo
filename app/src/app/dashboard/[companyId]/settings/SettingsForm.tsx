"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CodeNameCombobox, { type CodeNameOption } from "@/components/CodeNameCombobox";

export default function SettingsForm({
  companyId,
  initialName,
  initialStatus,
  initialBillingoApiKey,
  initialBillingoSyncFromDate,
  billingoSyncStarted,
  initialUseMnbExchangeRate,
  initialExchangeRateBank,
  exchangeRateBankOptions,
  initialImaApiKey,
  initialImaApiUser,
  initialImaApiCompany,
  initialPrimaryAdvanceGlaCode,
  derivedPrimaryAdvanceGlaCode,
  glaAccountOptions,
  initialOssRegistered,
}: {
  companyId: string;
  initialName: string;
  initialStatus: "active" | "paused";
  initialBillingoApiKey: string;
  initialBillingoSyncFromDate: string;
  billingoSyncStarted: boolean;
  initialUseMnbExchangeRate: boolean;
  initialExchangeRateBank: string;
  exchangeRateBankOptions: { code: string; label: string }[];
  initialImaApiKey: string;
  initialImaApiUser: string;
  initialImaApiCompany: string;
  initialPrimaryAdvanceGlaCode: string;
  /** Ha `initialPrimaryAdvanceGlaCode` üres, ezt vezetné le a rendszer a meglévő "advance" szabályokból (ha egyértelmű). */
  derivedPrimaryAdvanceGlaCode: string | null;
  glaAccountOptions: CodeNameOption[];
  initialOssRegistered: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState(initialStatus);
  const [billingoApiKey, setBillingoApiKey] = useState(initialBillingoApiKey);
  const [billingoSyncFromDate, setBillingoSyncFromDate] = useState(initialBillingoSyncFromDate);
  const [useMnbExchangeRate, setUseMnbExchangeRate] = useState(initialUseMnbExchangeRate);
  const [exchangeRateBank, setExchangeRateBank] = useState(initialExchangeRateBank);
  const [imaApiKey, setImaApiKey] = useState(initialImaApiKey);
  const [imaApiUser, setImaApiUser] = useState(initialImaApiUser);
  const [imaApiCompany, setImaApiCompany] = useState(initialImaApiCompany);
  const [primaryAdvanceGlaCode, setPrimaryAdvanceGlaCode] = useState(initialPrimaryAdvanceGlaCode);
  const [ossRegistered, setOssRegistered] = useState(initialOssRegistered);
  const [showBillingoApiKey, setShowBillingoApiKey] = useState(false);
  const [showImaApiKey, setShowImaApiKey] = useState(false);
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
          name,
          status,
          billingoApiKey,
          billingoSyncFromDate,
          useMnbExchangeRate,
          exchangeRateBank: useMnbExchangeRate ? "" : exchangeRateBank,
          imaApiKey,
          imaApiUser,
          imaApiCompany,
          primaryAdvanceGlaCode,
          ossRegistered,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Sikertelen mentés (${res.status})`);
      setMessage("Beállítások mentve.");
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
        <div className="card-title">Cégadatok</div>
        <label className="field">
          Cégnév
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="cluster" style={{ fontWeight: 600, fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={status === "paused"}
            onChange={(e) => setStatus(e.target.checked ? "paused" : "active")}
          />
          Feldolgozás szüneteltetése
        </label>
        {error && <p className="alert alert-error">{error}</p>}
        {message && <p className="alert alert-success">{message}</p>}
        <div>
          <button className="btn btn-primary" onClick={save} disabled={submitting}>
            Mentés
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">Billingo API kapcsolat</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          A Billingo fiók Beállítások → API kulcsok menüjéből másolható ki.
        </p>
        <label className="field">
          Billingo API kulcs
          <span className="cluster">
            <input
              type={showBillingoApiKey ? "text" : "password"}
              value={billingoApiKey}
              onChange={(e) => setBillingoApiKey(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn btn-sm" onClick={() => setShowBillingoApiKey((v) => !v)}>
              {showBillingoApiKey ? "Elrejtés" : "Megmutatás"}
            </button>
          </span>
        </label>
        <label className="field">
          Szinkron kezdő dátuma (opcionális)
          <span className="field-hint">
            A Billingo számlák <strong>keltéhez</strong> (kiállítás dátuma)
            képest szűr. Csak az ELSŐ szinkronra vonatkozik: enélkül egy
            újonnan induló cégnél is a teljes Billingo-előzményt (akár évekre
            visszamenőleg) lekérdezné a rendszer. Állítsd be pl. a cég IMA-s
            indulásának dátumára — az ez előtti keltezésű számlákat a
            rendszer figyelmen kívül hagyja. {billingoSyncStarted && (
              <strong>
                A szinkron már elindult ennél a cégnél — ennek a mezőnek a
                módosítása utólag NEM kéri le visszamenőleg a korábbi
                számlákat, csak új cégnél/az első szinkron előtt van hatása.
              </strong>
            )}
          </span>
          <input
            type="date"
            value={billingoSyncFromDate}
            onChange={(e) => setBillingoSyncFromDate(e.target.value)}
          />
        </label>
        <div>
          <button className="btn btn-primary" onClick={save} disabled={submitting}>
            Mentés
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">Devizás számlák árfolyam-ellenőrzése</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          A devizás Billingo számlán szereplő árfolyamot NEM cseréljük le —
          csak ellenőrizzük a hivatalos jegyzés ellen, mert a Billingo a
          felhasználónak alapból az MNB árfolyamot ajánlja fel, egy attól
          eltérőt nem validál. Ha a számlán szereplő árfolyam jelentősen
          (5%-nál jobban) eltér, a számla felülvizsgálandó státuszba kerül.
        </p>
        <label className="cluster" style={{ fontWeight: 600, fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={useMnbExchangeRate}
            onChange={(e) => setUseMnbExchangeRate(e.target.checked)}
          />
          MNB árfolyamhoz ellenőrizzünk
        </label>
        {!useMnbExchangeRate && (
          <label className="field">
            Melyik bank árfolyamához ellenőrizzünk?
            <span className="field-hint">
              A napiarfolyam.hu-n jelenleg élőnek látszó (nemrég frissített)
              bankok listája — a kiválasztott bank "deviza eladási"
              árfolyamát vetjük össze a Billingo-számlával.
            </span>
            <select value={exchangeRateBank} onChange={(e) => setExchangeRateBank(e.target.value)}>
              <option value="">— válassz bankot —</option>
              {exchangeRateBank && !exchangeRateBankOptions.some((b) => b.code === exchangeRateBank) && (
                <option value={exchangeRateBank}>
                  {exchangeRateBank} (jelenleg beállítva, de már nem szerepel az élő listában)
                </option>
              )}
              {exchangeRateBankOptions.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div>
          <button className="btn btn-primary" onClick={save} disabled={submitting}>
            Mentés
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">IMA API kapcsolat (kimenő számla beküldés)</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          A beküldés a <code>/api/invoices/sales/add</code> nyers végpontra
          megy (ld. docs/tervezes.md 8. fejezet, 2026.08.12-i váltás a
          korábbi <code>/api/import/sales-invoice</code>-ról) — az API host
          NEM cégenkénti beállítás.
        </p>
        <label className="field">
          IMA API kulcs
          <span className="cluster">
            <input
              type={showImaApiKey ? "text" : "password"}
              value={imaApiKey}
              onChange={(e) => setImaApiKey(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn btn-sm" onClick={() => setShowImaApiKey((v) => !v)}>
              {showImaApiKey ? "Elrejtés" : "Megmutatás"}
            </button>
          </span>
        </label>
        <label className="field">
          IMA felhasználó (a &bdquo;user&rdquo; HTTP fejléc értéke)
          <input type="text" value={imaApiUser} onChange={(e) => setImaApiUser(e.target.value)} />
        </label>
        <label className="field">
          IMA cégazonosító (a &bdquo;company&rdquo; HTTP fejléc értéke)
          <input type="text" value={imaApiCompany} onChange={(e) => setImaApiCompany(e.target.value)} />
        </label>
        <div>
          <button className="btn btn-primary" onClick={save} disabled={submitting}>
            Mentés
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">Előlegszámlák kontírozása</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          Az előlegszámlák (Billingo &bdquo;advance&rdquo; típus) ÉS a végszámla/normál/
          stornó számlák azon tételei, amik a megjegyzésükben egy már igazoltan előleg
          típusú számlára hivatkoznak (pl. „(2026-3645)”), mindig erre a főkönyvi számra
          kontírozódnak — a szabály-illesztéstől függetlenül (ld. docs/tervezes.md 9.5).
        </p>
        <label className="field">
          Elsődleges előleg főkönyvi szám
          <span className="field-hint">
            Ha üresen hagyod, a rendszer megpróbálja levezetni a meglévő, &bdquo;advance&rdquo;
            bizonylattípusra tanult szabályokból.
            {!initialPrimaryAdvanceGlaCode &&
              (derivedPrimaryAdvanceGlaCode
                ? ` Jelenleg ezt vezetné le: „${derivedPrimaryAdvanceGlaCode}”.`
                : " Jelenleg nem tud egyértelműen levezetni semmit — amíg üres, ezek a tételek is a normál szabályok szerint kontírozódnak.")}
          </span>
          <CodeNameCombobox
            value={primaryAdvanceGlaCode}
            onChange={setPrimaryAdvanceGlaCode}
            options={glaAccountOptions}
            placeholder="pl. 911"
          />
        </label>
        <div>
          <button className="btn btn-primary" onClick={save} disabled={submitting}>
            Mentés
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="card-title">OSS (uniós egyablakos rendszer)</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          A 10.000 EUR-os küszöb figyelése (ld. a Számlák oldal tetején) FÜGGETLENÜL ettől a
          kapcsolótól mindig fut. Ez a jelző kizárólag azt jelöli, hogy a kliens TÉNYLEGESEN
          regisztrált-e OSS-re — csak ekkor válik kötelezővé a lenti szigorú (tagállam + áfa
          kulcs) megfeleltetés a külföldi EU magánszemély partnerek beküldésénél/CSV exportjánál.
          A rendszer csak azt dolgozza fel, amit a kliens már kiállított — nem dönt helyette arról,
          hogy OSS szerint kell-e számláznia.
        </p>
        <label className="cluster" style={{ fontWeight: 600, fontSize: "0.9rem" }}>
          <input type="checkbox" checked={ossRegistered} onChange={(e) => setOssRegistered(e.target.checked)} />
          A kliens ténylegesen regisztrált OSS-re
        </label>
        <div>
          <button className="btn btn-primary" onClick={save} disabled={submitting}>
            Mentés
          </button>
        </div>
      </div>
    </div>
  );
}

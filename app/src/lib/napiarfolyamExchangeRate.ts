/**
 * napiarfolyam.hu API 1.0 kliens — azoknak a cégeknek, amelyek az MNB
 * hivatalos árfolyama helyett egy konkrét bank jegyzését használják a
 * Billingo számláikon, és ez ellen szeretnék ellenőrizni a tényleges
 * (Billingo `conversion_rate`) árfolyamot (ld. `Company.useMnbExchangeRate`
 * / `exchangeRateBank`, src/lib/exchangeRate.ts, docs/tervezes.md 7.
 * fejezet). Átvéve a testvérprojektből
 * (`<sibling-project>/src/lib/napiarfolyamExchangeRate.ts`), ahol
 * árfolyam-*forrásként* szolgált egy PDF-ből kinyert, árfolyamot nem
 * tartalmazó bejövő számlához — itt viszont csak ELLENŐRZÉSKÉNT
 * használjuk, mert a kimenő Billingo-számla a ténylegesen alkalmazott
 * árfolyamot már tartalmazza.
 *
 * Ebből a sandbox-környezetből nem sikerült élőben elérni a
 * napiarfolyam.hu-t, de egy valós mintaválasz alapján néhány fontos
 * eltérés ismert a dokumentációhoz képest:
 *  - a szűretlen (bank/valuta param nélküli) válasz TÖBB tucat bank-kódot
 *    ad vissza, sokuk évekkel/évtizeddel ezelőtti, "megfagyott" utolsó
 *    jegyzéssel — ezek élő árfolyam-forrásként használhatatlanok, ezért a
 *    bank-lista csak a nemrég (ld. freshDays) frissített bankokat ajánlja;
 *  - a "citibank" kód valójában "citybank" (fals doksi-elgépelés);
 *  - a számok pontos (nem vesszős) tizedesjellel érkeznek.
 */

import { parseHungarianOrPlainNumber } from "@/lib/numberFormat";

const NAPIARFOLYAM_BASE_URL = "http://api.napiarfolyam.hu";

// Ismert bank-kódok emberi olvasható neve — csak megjelenítéshez, a
// VÁLASZTHATÓ bankok listáját a `fetchNapiarfolyamBankList()` élő
// lekérdezésére kell alapozni, nem erre a fix listára.
const BANK_LABELS: Record<string, string> = {
  otp: "OTP Bank",
  kh: "K&H Bank",
  cib: "CIB Bank",
  erste: "Erste Bank",
  raiffeisen: "Raiffeisen Bank",
  unicredit: "UniCredit Bank",
  mkb: "MKB Bank (megszűnt, ld. MBH Bank)",
  commerz: "Commerzbank",
  citybank: "Citibank",
  volksbank: "Volksbank (megszűnt)",
  sberbank: "Sberbank Magyarország (megszűnt 2022-ben)",
  bb: "Budapest Bank (megszűnt, ld. MBH Bank)",
  allianz: "Allianz Bank (megszűnt)",
  kdb: "KDB Bank",
  oberbank: "Oberbank",
  sopron: "Sopron Bank (megszűnt, ld. Évo Bank)",
  evo: "Évo Bank",
  mfb: "MFB",
  fhb: "FHB / Takarékbank",
  magnet: "MagNet Bank",
  granit: "Gránit Bank",
  akcenta: "AKCENTA CZ",
  mbh: "MBH Bank",
  "mbh-bb": "MBH Bank (volt Budapest Bank ág)",
  "mbh-mkb": "MBH Bank (volt MKB ág)",
  "mbh-tak": "MBH Bank (volt Takarékbank ág)",
  banco: "Banco Primus",
  dtbank: "Duna Takarék Bank",
  hanwha: "Hanwha",
  ing: "ING Bank",
  kinizsi: "Kinizsi Bank",
  mtb: "Magyar Takarékszövetkezeti Bank (megszűnt)",
  nhb: "NHB Növekedési Hitel Bank",
  polgari: "Polgári Bank",
  b3takarek: "B3 Takarék Szövetkezet",
  szechenyi: "Széchenyi Kereskedelmi Bank (megszűnt)",
};

const FALLBACK_BANK_CODES = [
  "otp", "kh", "cib", "erste", "raiffeisen", "unicredit", "oberbank", "kdb",
  "mfb", "magnet", "granit", "akcenta", "mbh",
];

function toBankOption(code: string): { code: string; label: string } {
  return { code, label: BANK_LABELS[code] ?? code };
}

export const NAPIARFOLYAM_BANKS_FALLBACK: { code: string; label: string }[] =
  FALLBACK_BANK_CODES.map(toBankOption);

export interface NapiarfolyamRate {
  date: string;
  bank: string;
  currency: string;
  rate: number;
}

function formatDatumParam(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    String(d.getUTCDate()).padStart(2, "0")
  );
}

export function parseNapiarfolyamXml(xml: string, bank: string, currency: string): NapiarfolyamRate | null {
  const devizaMatch = xml.match(/<deviza>([\s\S]*?)<\/deviza>/);
  if (!devizaMatch) return null;

  const items = [...devizaMatch[1]!.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  const matches = items
    .map((m) => {
      const itemXml = m[1]!;
      const get = (tag: string) => itemXml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim();
      return {
        bank: get("bank"),
        date: get("datum"),
        currency: get("penznem"),
        eladas: get("eladas"),
      };
    })
    .filter(
      (item) =>
        item.bank?.toLowerCase() === bank.toLowerCase() &&
        item.currency?.toUpperCase() === currency.toUpperCase() &&
        item.date &&
        item.eladas
    );

  if (matches.length === 0) return null;

  matches.sort((a, b) => a.date!.localeCompare(b.date!));
  const last = matches[matches.length - 1]!;

  return {
    date: last.date!,
    bank,
    currency: currency.toUpperCase(),
    rate: parseHungarianOrPlainNumber(last.eladas!),
  };
}

export function parseNapiarfolyamBankCodes(
  xml: string,
  { freshDays = 30, referenceDate = new Date() }: { freshDays?: number; referenceDate?: Date } = {}
): string[] {
  const devizaMatch = xml.match(/<deviza>([\s\S]*?)<\/deviza>/);
  if (!devizaMatch) return [];

  const cutoff = new Date(referenceDate);
  cutoff.setUTCDate(cutoff.getUTCDate() - freshDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const latestByBank = new Map<string, string>();
  for (const m of devizaMatch[1]!.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const itemXml = m[1]!;
    const bank = itemXml.match(/<bank>([^<]*)<\/bank>/)?.[1]?.trim().toLowerCase();
    const datum = itemXml.match(/<datum>([^<]*)<\/datum>/)?.[1]?.trim();
    if (!bank || bank === "mnb" || !datum) continue;
    const current = latestByBank.get(bank);
    if (!current || datum > current) latestByBank.set(bank, datum);
  }

  return [...latestByBank.entries()]
    .filter(([, datum]) => datum >= cutoffStr)
    .map(([bank]) => bank)
    .sort();
}

/**
 * A ténylegesen élő (nemrég frissített) bankok listáját kérdezi le élőben,
 * emberi olvasható címkével. Hálózati hiba (vagy üres eredmény) esetén a
 * statikus `NAPIARFOLYAM_BANKS_FALLBACK` listát adja vissza.
 */
export async function fetchNapiarfolyamBankList(): Promise<{ code: string; label: string }[]> {
  try {
    const res = await fetch(NAPIARFOLYAM_BASE_URL, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const codes = parseNapiarfolyamBankCodes(xml);
    if (codes.length === 0) throw new Error("Üres bank-lista az API válaszban.");
    return codes.map(toBankOption);
  } catch (err) {
    console.error("napiarfolyam.hu bank-lista lekérdezése sikertelen, fallback lista használata:", err);
    return NAPIARFOLYAM_BANKS_FALLBACK;
  }
}

/**
 * Egy adott bank egy devizanemhez tartozó árfolyamát kéri le a megadott
 * napra (vagy — ha arra nincs jegyzés — a legutóbbi korábbi jegyzett
 * napra, `lookbackDays` napos ablakban visszamenőleg, max. 31 nap az API
 * korlátja miatt). `null`-t ad vissza, ha az ablakban egyáltalán nincs
 * jegyzés az adott bank+deviza párra.
 */
export async function fetchNapiarfolyamRate(
  bank: string,
  currency: string,
  onOrBeforeDate: Date,
  { lookbackDays = 8 }: { lookbackDays?: number } = {}
): Promise<NapiarfolyamRate | null> {
  const curr = currency.trim().toUpperCase();
  if (curr === "HUF") return null;

  const startDate = new Date(onOrBeforeDate);
  startDate.setUTCDate(startDate.getUTCDate() - Math.min(lookbackDays, 31));

  const url = new URL(NAPIARFOLYAM_BASE_URL);
  url.searchParams.set("bank", bank);
  url.searchParams.set("valutanem", "deviza");
  url.searchParams.set("datum", formatDatumParam(startDate));
  url.searchParams.set("datumend", formatDatumParam(onOrBeforeDate));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`napiarfolyam.hu lekérdezés sikertelen: HTTP ${res.status}`);
  }

  const xml = await res.text();
  return parseNapiarfolyamXml(xml, bank, curr);
}

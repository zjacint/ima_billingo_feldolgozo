/**
 * MNB (Magyar Nemzeti Bank) hivatalos árfolyam-webservice kliens.
 *
 * Itt NEM árfolyam-forrásként használjuk (a kimenő Billingo-számla a
 * ténylegesen alkalmazott árfolyamot már tartalmazza, ld.
 * `Invoice.exchangeRate` / `docs/tervezes.md` 8. fejezet), hanem
 * ELLENŐRZÉSKÉNT: a Billingo a felhasználónak alapból az MNB árfolyamot
 * ajánlja fel, de ha valaki attól eltérő (kézzel beírt) árfolyamot
 * használt, azt itt vetjük össze a hivatalos jegyzéssel (ld.
 * src/lib/exchangeRate.ts, docs/tervezes.md 7. fejezet).
 *
 * ⚠️ NEM ELLENŐRZÖTT ÉLŐ MNB VÁLASZ ELLEN (átvéve a testvérprojektből,
 * `<sibling-project>/src/lib/mnbExchangeRate.ts`, ahol ugyanez a
 * figyelmeztetés áll — ebből a sandbox-környezetből nem sikerült élőben
 * elérni a mnb.hu-t). Az első éles használat előtt egy valós lekérdezéssel
 * kell megerősíteni, hogy a `parseMnbResponse` által feltételezett
 * XML-szerkezet egyezik-e a ténylegessel.
 */

import { parseHungarianOrPlainNumber } from "@/lib/numberFormat";

const MNB_URL = "https://www.mnb.hu/arfolyamok.asmx";
const MNB_NAMESPACE = "http://www.mnb.hu/webservices/";

export interface MnbRate {
  /** A ténylegesen felhasznált (jegyzett) nap, ÉÉÉÉ-HH-NN alakban — ez
   * eltérhet a kért napjától, ha arra nem volt jegyzés. */
  date: string;
  currency: string;
  unit: number;
  rate: number;
}

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Csak a parseMnbResponse belső logikájának tesztelhetőségéhez exportálva. */
export function parseMnbResponse(soapXml: string, currency: string): MnbRate | null {
  const resultMatch = soapXml.match(/<GetExchangeRatesResult>([\s\S]*?)<\/GetExchangeRatesResult>/);
  if (!resultMatch) {
    throw new Error("Váratlan MNB SOAP válasz — GetExchangeRatesResult nem található.");
  }
  const inner = decodeXmlEntities(resultMatch[1]!);

  const dayMatches = [...inner.matchAll(/<Day date="([\d-]+)">([\s\S]*?)<\/Day>/g)];
  if (dayMatches.length === 0) return null;

  // Az ablakban az utolsó (legkésőbbi, de a kért napnál nem későbbi) napot
  // vesszük — ez a legfrissebb elérhető jegyzés a kért napig visszamenőleg.
  const lastDay = dayMatches[dayMatches.length - 1]!;
  const [, date, dayXml] = lastDay;

  const rateMatch = dayXml!.match(/<Rate unit="(\d+)" curr="([A-Z]+)">([^<]+)<\/Rate>/);
  if (!rateMatch) return null;
  const [, unitStr, curr, rateText] = rateMatch;
  if (curr !== currency) {
    throw new Error(`Váratlan devizakód az MNB válaszban: kért ${currency}, kapott ${curr}.`);
  }

  return {
    date: date!,
    currency,
    unit: Number(unitStr),
    rate: parseHungarianOrPlainNumber(rateText!),
  };
}

/**
 * Egy deviza HUF-árfolyamát kéri le a megadott napra (vagy — ha arra nincs
 * jegyzés — a legutóbbi korábbi jegyzett napra, `lookbackDays` napos
 * ablakban visszamenőleg). `null`-t ad vissza, ha az ablakban egyáltalán
 * nincs jegyzés (pl. túl rövid `lookbackDays` egy hosszú ünnepi időszakhoz).
 */
export async function fetchMnbExchangeRate(
  currency: string,
  onOrBeforeDate: Date,
  { lookbackDays = 8 }: { lookbackDays?: number } = {}
): Promise<MnbRate | null> {
  const curr = currency.trim().toUpperCase();
  if (curr === "HUF") return null;

  const startDate = new Date(onOrBeforeDate);
  startDate.setUTCDate(startDate.getUTCDate() - lookbackDays);

  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><GetExchangeRates xmlns="${MNB_NAMESPACE}">` +
    `<startDate>${formatIsoDate(startDate)}</startDate>` +
    `<endDate>${formatIsoDate(onOrBeforeDate)}</endDate>` +
    `<currencyNames>${curr}</currencyNames>` +
    `</GetExchangeRates></soap:Body></soap:Envelope>`;

  const res = await fetch(MNB_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `"${MNB_NAMESPACE}GetExchangeRates"`,
    },
    body: envelope,
  });

  if (!res.ok) {
    throw new Error(`MNB árfolyam-lekérdezés sikertelen: HTTP ${res.status}`);
  }

  const soapXml = await res.text();
  return parseMnbResponse(soapXml, curr);
}

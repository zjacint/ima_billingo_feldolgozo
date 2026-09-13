/**
 * Devizás Billingo-számlák árfolyam-ELLENŐRZÉSE — NEM árfolyam-forrás (a
 * Billingo `conversion_rate`-je a ténylegesen alkalmazott, könyvelendő
 * árfolyam, ld. docs/tervezes.md 8. fejezet). A Billingo a felhasználónak
 * alapból az MNB árfolyamot ajánlja fel, de egy ettől eltérő (kézzel
 * beírt) árfolyamot nem validál — ez a modul azt vizsgálja, hogy egy
 * számlán szereplő árfolyam mennyire tér el a cégen beállított hivatalos
 * (MNB vagy egy konkrét bank, napiarfolyam.hu) jegyzéstől, hogy a
 * könyvelő figyelmét felhívja egy esetleges elgépelésre/hibás adatra
 * (ld. docs/tervezes.md 7. fejezet).
 */

import { fetchMnbExchangeRate } from "@/lib/mnbExchangeRate";
import { fetchNapiarfolyamRate } from "@/lib/napiarfolyamExchangeRate";

export interface ExchangeRateCompanyPreference {
  useMnbExchangeRate: boolean;
  exchangeRateBank: string | null;
}

/** Ennél nagyobb relatív eltérésnél (5%) jelezzük a figyelmeztetést. */
const DEVIATION_TOLERANCE = 0.05;

async function resolveReferenceRate(
  company: ExchangeRateCompanyPreference,
  currency: string,
  onOrBeforeDate: Date
): Promise<number | undefined> {
  if (company.useMnbExchangeRate) {
    const mnbRate = await fetchMnbExchangeRate(currency, onOrBeforeDate);
    return mnbRate ? mnbRate.rate / mnbRate.unit : undefined;
  }
  if (!company.exchangeRateBank) return undefined;
  const bankRate = await fetchNapiarfolyamRate(company.exchangeRateBank, currency, onOrBeforeDate);
  return bankRate?.rate;
}

/**
 * Egy Billingo számlán szereplő árfolyamot vet össze a hivatalos (MNB/bank)
 * jegyzéssel. `null`-t ad vissza, ha nincs eltérés (vagy nem devizás a
 * számla). A hívó felelőssége a hálózati/API hibák elkapása — ez a
 * függvény szándékosan dob, ha a referencia-lekérdezés hibázik, hogy a
 * hívó el tudja dönteni, blokkolja-e emiatt a szinkront vagy sem.
 */
export async function checkExchangeRateDeviation(
  company: ExchangeRateCompanyPreference,
  currency: string,
  invoiceDate: Date,
  actualRate: number
): Promise<string | null> {
  if (currency.trim().toUpperCase() === "HUF") return null;

  const referenceRate = await resolveReferenceRate(company, currency, invoiceDate);
  if (referenceRate == null || referenceRate === 0) {
    return `Nem sikerült ellenőrizni az árfolyamot (nincs hivatalos ${
      company.useMnbExchangeRate ? "MNB" : company.exchangeRateBank
    } jegyzés erre a napra vagy devizára).`;
  }

  const deviation = Math.abs(actualRate - referenceRate) / referenceRate;
  if (deviation <= DEVIATION_TOLERANCE) return null;

  const referenceLabel = company.useMnbExchangeRate ? "MNB" : `${company.exchangeRateBank} (napiarfolyam.hu)`;
  return `A számlán szereplő árfolyam (${actualRate}) ${(deviation * 100).toFixed(1)}%-kal eltér a hivatalos ${referenceLabel} árfolyamtól (${referenceRate.toFixed(4)}).`;
}

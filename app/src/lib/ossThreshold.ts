/**
 * EU OSS (egyablakos rendszer) 10.000 EUR-os távértékesítési/távolról
 * nyújtható szolgáltatási küszöb figyelése — ld. docs/tervezes.md 13.
 * fejezet. Forrás: NAV tájékoztató ("A nem uniós és uniós egyablakos
 * rendszerre... vonatkozó áfaszabályok", 2024.01.26) + könyvelői döntés
 * (2026.08.16).
 *
 * Egyszerűsített hatókör (könyvelői döntés): MINDEN olyan számla, amit
 * külföldi (nem magyar) EU tagállami, közösségi adószám NÉLKÜLI
 * (magánszemély/B2C) partnernek állítottak ki magyar áfával, beleszámít a
 * küszöbbe — nincs külön termék/szolgáltatás-típus szűrés (a NAV
 * tájékoztató szerint ez formálisan csak távértékesítésre/távolról
 * nyújtható szolgáltatásra vonatkozna, de a könyvelő az egyszerűbb,
 * mindent-beleszámító szabályt választotta).
 *
 * A HUF-egyenérték a törvényi FIX összeg (Áfa tv. 256. § (3) bek., az MNB
 * 2017.12.05-i, 313,96 HUF/EUR árfolyama alapján) — NEM élő árfolyamos
 * átváltás.
 */

import { InvoiceStatus } from "@prisma/client";
import { prisma } from "./db";

export const OSS_THRESHOLD_HUF = 3_100_000;

/** ISO 3166-1 alpha-2 EU tagállami kódok, Magyarország NÉLKÜL. */
export const EU_MEMBER_COUNTRY_CODES_EXCL_HU = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/**
 * OSS-érintett (küszöbbe beleszámító) partner: külföldi EU tagállami,
 * közösségi adószám NÉLKÜLI magánszemély — ld. könyvelői megerősítés: "a
 * B2B vevő esetén a közösségi adószám megléte... jelzi, hogy nem kell az
 * OSS értékhatárba beszámítani". Az adószám hiánya (ugyanaz a jel, mint a
 * meglévő magánszemély-párosításnál, ld. partners/auto-match) jelöli a
 * magánszemélyt (B2C).
 */
export function isOssRelevantPartner(partner: { countryCode: string | null; taxNumber: string | null }): boolean {
  if (!partner.countryCode) return false;
  if (!EU_MEMBER_COUNTRY_CODES_EXCL_HU.has(partner.countryCode.toUpperCase())) return false;
  return !partner.taxNumber;
}

/** A tényleges kiállítás alapján számít — az elutasított (könyvelőileg kizárt) számlák nem számítanak bele. */
const COUNTED_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.synced,
  InvoiceStatus.needs_review,
  InvoiceStatus.approved,
  InvoiceStatus.submitted,
  InvoiceStatus.booked,
  InvoiceStatus.failed,
];

function hufEquivalent(invoice: { currencyCode: string; grossAmount: unknown; exchangeRate: unknown }): number {
  const gross = invoice.grossAmount != null ? Number(invoice.grossAmount) : 0;
  if (invoice.currencyCode.trim().toUpperCase() === "HUF") return gross;
  const rate = invoice.exchangeRate != null ? Number(invoice.exchangeRate) : null;
  return rate ? gross * rate : gross;
}

async function sumOssRelevantHuf(companyId: string, year: number): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId,
      status: { in: COUNTED_STATUSES },
      docDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      partner: { countryCode: { not: null }, taxNumber: null },
    },
    select: { grossAmount: true, currencyCode: true, exchangeRate: true, partner: { select: { countryCode: true, taxNumber: true } } },
  });
  let total = 0;
  for (const inv of invoices) {
    if (!inv.partner || !isOssRelevantPartner(inv.partner)) continue;
    total += hufEquivalent(inv);
  }
  return total;
}

export interface OssStatus {
  currentYear: number;
  currentYearTotalHuf: number;
  previousYearTotalHuf: number;
  thresholdHuf: number;
  currentYearCrossed: boolean;
  previousYearCrossed: boolean;
  /**
   * Tavaly átlépte a küszöböt ÉS a cég OSS jelzője igaz — ilyenkor az idei
   * év elejétől folytatólagosan OSS-kötelesnek számít, FÜGGETLENÜL attól,
   * hogy az idei összeg önmagában még nem érné el a küszöböt (könyvelői
   * szabály, 2026.08.16: "januárral nullázódik, de csak ha nem lépett át
   * vagy az OSS jelző nem true" — vagyis ha ÁTLÉPETT ÉS a jelző true, NEM
   * nullázódik).
   */
  carriedOverFromPreviousYear: boolean;
  ossRegistered: boolean;
  ratio: number;
}

/**
 * Az adott (ország, Billingo áfa érték) párokhoz HIÁNYZÓ szigorú
 * `OssVatCodeMapping` bejegyzéseket adja vissza — üres tömb, ha minden
 * érték le van fedve. A hívó (beküldés/CSV export) dönti el, mit kezd egy
 * nem üres eredménnyel (blokkolás vagy kihagyás+jelzés) — ld.
 * invoiceWorkflow.ts `submitInvoiceToIma`, export-csv route.
 */
export async function findMissingOssVatMappings(
  companyId: string,
  countryCode: string,
  vatValues: string[]
): Promise<string[]> {
  const distinct = [...new Set(vatValues)];
  if (distinct.length === 0) return [];
  const mappings = await prisma.ossVatCodeMapping.findMany({
    where: { companyId, countryCode, billingoVatValue: { in: distinct } },
    select: { billingoVatValue: true },
  });
  const mapped = new Set(mappings.map((m) => m.billingoVatValue));
  return distinct.filter((v) => !mapped.has(v));
}

export async function computeOssStatus(companyId: string): Promise<OssStatus> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { ossRegistered: true } });
  const now = new Date();
  const currentYear = now.getUTCFullYear();

  const [currentYearTotalHuf, previousYearTotalHuf] = await Promise.all([
    sumOssRelevantHuf(companyId, currentYear),
    sumOssRelevantHuf(companyId, currentYear - 1),
  ]);

  const currentYearCrossed = currentYearTotalHuf >= OSS_THRESHOLD_HUF;
  const previousYearCrossed = previousYearTotalHuf >= OSS_THRESHOLD_HUF;

  return {
    currentYear,
    currentYearTotalHuf,
    previousYearTotalHuf,
    thresholdHuf: OSS_THRESHOLD_HUF,
    currentYearCrossed,
    previousYearCrossed,
    carriedOverFromPreviousYear: previousYearCrossed && company.ossRegistered,
    ossRegistered: company.ossRegistered,
    ratio: OSS_THRESHOLD_HUF > 0 ? currentYearTotalHuf / OSS_THRESHOLD_HUF : 0,
  };
}

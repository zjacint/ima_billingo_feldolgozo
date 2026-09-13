/**
 * IMA számlatükör/áfa kulcs lista KÉZZEL frissíthető DB-másolata — ld.
 * docs/tervezes.md 10. fejezet.
 *
 * A Kontír/áfa szabályok és Beállítások oldal a `getCachedGlaAccounts`/
 * `getCachedVatKeys` függvényekkel KIZÁRÓLAG ebből a táblából olvas —
 * SOHA nem hív ki élőben IMA-t oldalbetöltéskor. A tényleges IMA-
 * lekérdezést és a tábla frissítését a `refreshImaReferenceCache`
 * végzi, amit csak a "Frissítés" gomb indít
 * (`/api/companies/[companyId]/ima-reference/refresh`).
 */

import { prisma } from "./db";
import {
  fetchImaGlaAccounts,
  fetchImaVatKeys,
  fetchImaPartners,
  fetchImaPaymentMethods,
  type ImaCredentials,
} from "./imaApiClient";

export async function getCachedGlaAccounts(companyId: string) {
  return prisma.imaGlaAccountCache.findMany({
    where: { companyId },
    orderBy: { code: "asc" },
    select: { code: true, name: true },
  });
}

export async function getCachedVatKeys(companyId: string) {
  return prisma.imaVatKeyCache.findMany({
    where: { companyId },
    orderBy: { code: "asc" },
    select: { code: true, name: true, percent: true },
  });
}

export async function getGlaAccountCacheUpdatedAt(companyId: string): Promise<Date | null> {
  const latest = await prisma.imaGlaAccountCache.findFirst({
    where: { companyId },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return latest?.updatedAt ?? null;
}

export async function getCachedImaPartners(companyId: string) {
  return prisma.imaPartnerCache.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    select: { imaPartnerId: true, name: true, taxNumber: true },
  });
}

export async function getCachedImaPaymentMethods(companyId: string) {
  return prisma.imaPaymentMethodCache.findMany({
    where: { companyId },
    orderBy: { desc: "asc" },
    select: { imaId: true, desc: true, navPayMethodType: true },
  });
}

/**
 * Élőben lekéri IMA-tól a számlatükröt, az áfa kulcs listát, a (vevő)
 * partnerlistát és a fizetési mód listát, majd teljesen felülírja a cég
 * cache-sorait (törli a már nem létező kódokat, upsertálja a többit) — egy
 * tranzakcióban, hogy a Kontír/áfa szabályok, Beállítások és Partnerek
 * oldal soha ne lásson félkész (részben törölt, részben régi) állapotot.
 */
export async function refreshImaReferenceCache(
  companyId: string,
  credentials: ImaCredentials
): Promise<{ glaAccountCount: number; vatKeyCount: number; partnerCount: number; paymentMethodCount: number }> {
  const [glaAccounts, vatKeys, partnersRaw, paymentMethods] = await Promise.all([
    fetchImaGlaAccounts(credentials),
    fetchImaVatKeys(credentials),
    fetchImaPartners(credentials),
    fetchImaPaymentMethods(credentials),
  ]);

  // Az IMA `/partners` válasza ugyanazt a `Partner_ID`-t több sorban is
  // visszaadhatja (pl. több számlázási cím esetén soronként) — a cache
  // egy partnert egy sorral tárol, ezért itt dedupláljuk `imaPartnerId`
  // szerint, mielőtt a unique kényszeres táblába írnánk.
  const partners = [...new Map(partnersRaw.map((p) => [p.id, p])).values()];

  await prisma.$transaction([
    prisma.imaGlaAccountCache.deleteMany({ where: { companyId } }),
    prisma.imaGlaAccountCache.createMany({
      data: glaAccounts.map((a) => ({ companyId, code: a.code, name: a.name })),
    }),
    prisma.imaVatKeyCache.deleteMany({ where: { companyId } }),
    prisma.imaVatKeyCache.createMany({
      data: vatKeys.map((v) => ({ companyId, code: v.code, name: v.name, percent: v.percent })),
    }),
    prisma.imaPartnerCache.deleteMany({ where: { companyId } }),
    prisma.imaPartnerCache.createMany({
      data: partners.map((p) => ({ companyId, imaPartnerId: p.id, name: p.name, taxNumber: p.taxNumber })),
    }),
    prisma.imaPaymentMethodCache.deleteMany({ where: { companyId } }),
    prisma.imaPaymentMethodCache.createMany({
      data: paymentMethods.map((p) => ({
        companyId,
        imaId: p.id,
        desc: p.desc,
        navPayMethodType: p.navPayMethodType,
      })),
    }),
  ]);

  return {
    glaAccountCount: glaAccounts.length,
    vatKeyCount: vatKeys.length,
    partnerCount: partners.length,
    paymentMethodCount: paymentMethods.length,
  };
}

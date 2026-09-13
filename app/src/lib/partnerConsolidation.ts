/**
 * Duplikált `Partner` sorok összevonása — a Billingo szinkron néha
 * ugyanazt a valós céget/magánszemélyt több, különböző
 * `billingoPartnerId`-vel is felveheti (pl. adat-módosítás után Billingo
 * új partner-rekordot hoz létre). Ugyanaz az elv, mint a Kontír/áfa
 * szabályok "Duplikátumok összevonása" gombjánál — kézzel indítható, nem
 * automatikus.
 */

import { prisma } from "./db";
import type { Partner } from "@prisma/client";

function normalizeTaxNumber(v: string | null): string | null {
  if (!v) return null;
  const digits = v.replace(/[^0-9]/g, "");
  return digits || null;
}

function normalizeName(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Csoportosítás kulcsa: adószám, ha van (megbízhatóbb), egyébként a
 * (normalizált) név — ugyanaz a két-szintű logika, mint a partner
 * auto-match funkciónál (`/api/companies/[companyId]/partners/auto-match`),
 * hogy a magánszemély (adószám nélküli) vevők duplikátumai is felismerésre
 * kerüljenek.
 */
function groupKey(p: Partner): string {
  const tax = normalizeTaxNumber(p.taxNumber);
  return tax ? `tax:${tax}` : `name:${normalizeName(p.name)}`;
}

/**
 * Egy csoporton belül kiválasztja, melyik `Partner` marad meg
 * "elsődlegesként": előnyben részesíti azt, akinek már van kézzel
 * párosított IMA-azonosítója (ne vesszen el egy korábbi kézi munka), majd
 * a legteljesebb címadatút, végül a legkorábban létrejöttet.
 */
function pickPrimary(group: Partner[]): Partner {
  return [...group].sort((a, b) => {
    const aHasCode = a.imaPartnerCode ? 1 : 0;
    const bHasCode = b.imaPartnerCode ? 1 : 0;
    if (aHasCode !== bHasCode) return bHasCode - aHasCode;
    const aComplete = Number(Boolean(a.taxNumber && a.postalCode && a.city && a.addressStreet));
    const bComplete = Number(Boolean(b.taxNumber && b.postalCode && b.city && b.addressStreet));
    if (aComplete !== bComplete) return bComplete - aComplete;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0]!;
}

export async function consolidateDuplicatePartners(
  companyId: string
): Promise<{ mergedGroups: number; deletedPartners: number }> {
  const partners = await prisma.partner.findMany({ where: { companyId } });

  const groups = new Map<string, Partner[]>();
  for (const p of partners) {
    const key = groupKey(p);
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  let mergedGroups = 0;
  let deletedPartners = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const primary = pickPrimary(group);
    const duplicateIds = group.filter((p) => p.id !== primary.id).map((p) => p.id);
    if (duplicateIds.length === 0) continue;

    await prisma.$transaction([
      prisma.invoice.updateMany({ where: { partnerId: { in: duplicateIds } }, data: { partnerId: primary.id } }),
      prisma.mappingRule.updateMany({ where: { partnerId: { in: duplicateIds } }, data: { partnerId: primary.id } }),
      prisma.partner.deleteMany({ where: { id: { in: duplicateIds } } }),
    ]);
    mergedGroups += 1;
    deletedPartners += duplicateIds.length;
  }

  return { mergedGroups, deletedPartners };
}

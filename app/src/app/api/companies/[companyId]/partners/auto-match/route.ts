import { NextResponse } from "next/server";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { prisma } from "@/lib/db";
import { normalizeName, normalizeTaxNumber } from "@/lib/partnerMatching";

/**
 * A cég még párosítatlan (`imaPartnerCode` üres) partnereit automatikusan
 * összeköti egy IMA-cache-beli partnerrel. Két körben, PONTOSAN EGY
 * illeszkedő IMA partnert megkövetelve mindkettőben (kétértelmű vagy
 * hiányzó adatnál szándékosan nem tippel, azt kézzel kell párosítani):
 * 1) adószám alapján — ez a megbízhatóbb, cégek esetén ez a jellemző;
 * 2) csak az 1. körben párosítatlanul maradt, adószám NÉLKÜLI partnerekre:
 *    pontos névegyezés — ez segíti a magánszemély vevőket, akiknek
 *    jellemzően nincs adószámuk.
 */
export async function POST(_req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);

    const [partners, imaPartners] = await Promise.all([
      prisma.partner.findMany({
        where: { companyId: params.companyId, OR: [{ imaPartnerCode: null }, { imaPartnerCode: "" }] },
      }),
      prisma.imaPartnerCache.findMany({ where: { companyId: params.companyId } }),
    ]);

    const imaByTaxNumber = new Map<string, number[]>();
    const imaByName = new Map<string, number[]>();
    for (const p of imaPartners) {
      const taxKey = normalizeTaxNumber(p.taxNumber);
      if (taxKey) {
        const list = imaByTaxNumber.get(taxKey) ?? [];
        list.push(p.imaPartnerId);
        imaByTaxNumber.set(taxKey, list);
      }
      const nameKey = normalizeName(p.name);
      if (nameKey) {
        const list = imaByName.get(nameKey) ?? [];
        list.push(p.imaPartnerId);
        imaByName.set(nameKey, list);
      }
    }

    let matchedByTaxNumber = 0;
    let matchedByName = 0;
    const updates: ReturnType<typeof prisma.partner.update>[] = [];
    for (const partner of partners) {
      const taxKey = normalizeTaxNumber(partner.taxNumber);
      const taxCandidates = taxKey ? imaByTaxNumber.get(taxKey) : undefined;
      if (taxCandidates && taxCandidates.length === 1) {
        matchedByTaxNumber += 1;
        updates.push(
          prisma.partner.update({ where: { id: partner.id }, data: { imaPartnerCode: String(taxCandidates[0]) } })
        );
        continue;
      }
      // Csak adószám NÉLKÜLI partnernél próbálkozunk névvel — ha van
      // adószáma, de nem talált rá egyértelmű IMA-találatot, inkább nem
      // tippelünk névre, mert az adószám-eltérés valódi hibát is jelezhet.
      if (taxKey) continue;
      const nameKey = normalizeName(partner.name);
      const nameCandidates = nameKey ? imaByName.get(nameKey) : undefined;
      if (nameCandidates && nameCandidates.length === 1) {
        matchedByName += 1;
        updates.push(
          prisma.partner.update({ where: { id: partner.id }, data: { imaPartnerCode: String(nameCandidates[0]) } })
        );
      }
    }
    await prisma.$transaction(updates);

    return NextResponse.json({
      matchedCount: matchedByTaxNumber + matchedByName,
      matchedByTaxNumber,
      matchedByName,
      candidateCount: partners.length,
    });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

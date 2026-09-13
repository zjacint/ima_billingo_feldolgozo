import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCachedImaPartners, getGlaAccountCacheUpdatedAt } from "@/lib/imaReferenceCache";
import ImaReferenceRefreshControls from "@/components/ImaReferenceRefreshControls";
import PartnersEditor from "./PartnersEditor";

// Lapozott lista — ugyanaz a minta, mint a Számlák/Kontír-szabályok
// oldalon: egyetlen nagy, egyben betöltött lista nagy partnerszámnál
// elakadó görgetést és felesleges DOM-terhelést okozna.
const PARTNERS_PAGE_SIZE = 50;

export default async function PartnersPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { page?: string };
}) {
  const currentPage = Math.max(1, Number(searchParams.page ?? "1") || 1);

  const [company, partners, totalPartnerCount, totalUnmatchedCount, imaPartners, cacheUpdatedAt] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: params.companyId } }),
    prisma.partner.findMany({
      where: { companyId: params.companyId },
      orderBy: { name: "asc" },
      skip: (currentPage - 1) * PARTNERS_PAGE_SIZE,
      take: PARTNERS_PAGE_SIZE,
    }),
    prisma.partner.count({ where: { companyId: params.companyId } }),
    // A cég ÖSSZES párosítatlan partnerének száma, függetlenül az
    // oldalazástól — az "Automatikus párosítás" gomb is az összesre fut,
    // nem csak az aktuális oldalra (ld. PartnersEditor.tsx).
    prisma.partner.count({
      where: { companyId: params.companyId, OR: [{ imaPartnerCode: null }, { imaPartnerCode: "" }] },
    }),
    getCachedImaPartners(params.companyId),
    getGlaAccountCacheUpdatedAt(params.companyId),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalPartnerCount / PARTNERS_PAGE_SIZE));

  const canQueryIma = Boolean(company.imaApiKey && company.imaApiUser && company.imaApiCompany);
  const imaPartnerNameById = new Map(imaPartners.map((p) => [String(p.imaPartnerId), p.name]));

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="card-title">IMA partnerlista</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          A Billingo-ból szinkronizált partnerekhez itt párosítható egy már IMA-ban létező
          partner — ez csak MEGJELENÍTÉSRE/ellenőrzésre szolgál (a beküldés a
          <code> partner: {"{...}"}</code> objektumot küldi üzleti adatokból, ld.
          docs/tervezes.md 8.1/12. fejezet), de segít átlátni, mely partnerek léteznek már
          IMA oldalon.
        </p>
        <ImaReferenceRefreshControls
          companyId={params.companyId}
          canRefresh={canQueryIma}
          lastUpdatedAt={cacheUpdatedAt ? cacheUpdatedAt.toISOString() : null}
        />
      </div>
      <PartnersEditor
        companyId={params.companyId}
        totalUnmatchedCount={totalUnmatchedCount}
        partners={partners.map((p) => ({
          id: p.id,
          name: p.name,
          taxNumber: p.taxNumber,
          postalCode: p.postalCode,
          city: p.city,
          addressStreet: p.addressStreet,
          imaPartnerCode: p.imaPartnerCode,
          imaPartnerName: p.imaPartnerCode ? (imaPartnerNameById.get(p.imaPartnerCode) ?? null) : null,
        }))}
        imaPartnerOptions={imaPartners.map((p) => ({
          code: String(p.imaPartnerId),
          name: p.name,
          taxNumber: p.taxNumber,
        }))}
      />

      {totalPages > 1 && (
        <div className="cluster" style={{ justifyContent: "space-between" }}>
          <span className="muted text-sm">
            {totalPartnerCount} partner — {currentPage}. / {totalPages} oldal
          </span>
          <div className="cluster">
            <Link
              href={`/dashboard/${params.companyId}/partners${currentPage > 2 ? `?page=${currentPage - 1}` : ""}`}
              className={`btn btn-sm${currentPage <= 1 ? " btn-disabled" : ""}`}
              aria-disabled={currentPage <= 1}
              tabIndex={currentPage <= 1 ? -1 : undefined}
            >
              ← Előző
            </Link>
            <Link
              href={`/dashboard/${params.companyId}/partners?page=${currentPage + 1}`}
              className={`btn btn-sm${currentPage >= totalPages ? " btn-disabled" : ""}`}
              aria-disabled={currentPage >= totalPages}
              tabIndex={currentPage >= totalPages ? -1 : undefined}
            >
              Következő →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

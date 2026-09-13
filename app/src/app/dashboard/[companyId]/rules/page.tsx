import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCachedGlaAccounts, getCachedVatKeys, getGlaAccountCacheUpdatedAt } from "@/lib/imaReferenceCache";
import ImaReferenceRefreshControls from "@/components/ImaReferenceRefreshControls";
import LearnControls from "./LearnControls";
import RulesEditor from "./RulesEditor";

// Lapozott lista — egyetlen nagy (akár több száz soros) betöltés a
// szerveren memóriatúlterhelést (OOM, Cloud Run konténer-újraindulás/503)
// és a böngészőben elakadó görgetést is okozhat — ld. docs/tervezes.md
// 10. fejezet.
const RULES_PAGE_SIZE = 50;

export default async function RulesPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { page?: string };
}) {
  const currentPage = Math.max(1, Number(searchParams.page ?? "1") || 1);

  const [company, rules, totalRuleCount, partners] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: params.companyId } }),
    prisma.mappingRule.findMany({
      where: { companyId: params.companyId },
      select: {
        id: true,
        partnerId: true,
        partner: { select: { name: true } },
        productNamePattern: true,
        commentPattern: true,
        documentTypePattern: true,
        vatPattern: true,
        glaCode: true,
        vatCode: true,
        vatGlaCode: true,
        amountSign: true,
        note: true,
        source: true,
        confidence: true,
        active: true,
        lastMatchedAt: true,
      },
      orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
      skip: (currentPage - 1) * RULES_PAGE_SIZE,
      take: RULES_PAGE_SIZE,
    }),
    prisma.mappingRule.count({ where: { companyId: params.companyId } }),
    prisma.partner.findMany({
      where: { companyId: params.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalRuleCount / RULES_PAGE_SIZE));

  const canLearn = Boolean(company.imaApiKey && company.imaApiUser && company.imaApiCompany);

  // Kereshető javaslatot ad a kontír/áfa mezőkhöz (ld. CodeNameCombobox) —
  // némán üres listával fut tovább, ha még nincs frissítve, a mezők
  // ilyenkor is szerkeszthetők maradnak, csak javaslat nélkül (ld.
  // docs/tervezes.md 10. fejezet, testvérprojekt-minta). KIZÁRÓLAG a
  // DB-cache-ből olvasunk, SOHA nem hívunk ki élőben IMA-t oldalbetöltéskor
  // — a frissítést a felhasználó kézzel indítja (ld.
  // ImaReferenceRefreshControls).
  const [glaAccounts, vatKeys, glaAccountCacheUpdatedAt] = await Promise.all([
    getCachedGlaAccounts(params.companyId),
    getCachedVatKeys(params.companyId),
    getGlaAccountCacheUpdatedAt(params.companyId),
  ]);

  return (
    <div className="stack-lg">
      <p className="muted text-sm">
        A &bdquo;Tanult&rdquo; szabályokat az IMA korábbi könyvelési
        analitikájából ({"/invoiceanalytics"}) tölti fel a &bdquo;Szabályok
        tanulása&rdquo; gomb — kézzel bármikor kiegészíthetők/felülírhatók, a
        kézi szabály elsőbbséget élvez (ld. docs/tervezes.md 9. fejezet).
      </p>
      <LearnControls companyId={params.companyId} canLearn={canLearn} />
      {!canLearn && (
        <p className="alert alert-warning" style={{ margin: 0 }}>
          A tanuláshoz töltsd ki az IMA API kapcsolatot a Beállítások oldalon.
        </p>
      )}
      <ImaReferenceRefreshControls
        companyId={params.companyId}
        canRefresh={canLearn}
        lastUpdatedAt={glaAccountCacheUpdatedAt ? glaAccountCacheUpdatedAt.toISOString() : null}
      />
      <RulesEditor
        companyId={params.companyId}
        partners={partners.map((p) => ({ id: p.id, name: p.name }))}
        glaAccountOptions={glaAccounts.map((a) => ({ code: a.code, name: a.name }))}
        vatKeyOptions={vatKeys.map((v) => ({ code: v.code, name: v.name }))}
        totalRuleCount={totalRuleCount}
        rules={rules.map((r) => ({
          id: r.id,
          partnerId: r.partnerId,
          partnerName: r.partner?.name ?? null,
          productNamePattern: r.productNamePattern,
          commentPattern: r.commentPattern,
          documentTypePattern: r.documentTypePattern,
          vatPattern: r.vatPattern,
          glaCode: r.glaCode,
          vatCode: r.vatCode,
          vatGlaCode: r.vatGlaCode,
          amountSign: r.amountSign,
          note: r.note,
          source: r.source,
          confidence: r.confidence,
          active: r.active,
          lastMatchedAt: r.lastMatchedAt ? r.lastMatchedAt.toISOString() : null,
        }))}
      />

      {totalPages > 1 && (
        <div className="cluster" style={{ justifyContent: "space-between" }}>
          <span className="muted text-sm">
            {totalRuleCount} szabály — {currentPage}. / {totalPages} oldal
          </span>
          <div className="cluster">
            <Link
              href={`/dashboard/${params.companyId}/rules${currentPage > 2 ? `?page=${currentPage - 1}` : ""}`}
              className={`btn btn-sm${currentPage <= 1 ? " btn-disabled" : ""}`}
              aria-disabled={currentPage <= 1}
              tabIndex={currentPage <= 1 ? -1 : undefined}
            >
              ← Előző
            </Link>
            <Link
              href={`/dashboard/${params.companyId}/rules?page=${currentPage + 1}`}
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

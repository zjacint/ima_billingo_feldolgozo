import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invoiceKindLabel } from "@/lib/billingoApiClient";
import { getCachedGlaAccounts, getCachedVatKeys } from "@/lib/imaReferenceCache";
import { summarizeRuleConditions } from "@/lib/mappingRuleEngine";
import { computeOssStatus } from "@/lib/ossThreshold";
import SyncControls from "./SyncControls";
import InvoiceListTable from "./InvoiceListTable";
import OssStatusCard from "./OssStatusCard";

// A csoportos "szabály alkalmazása" választólistájához — csak aktív
// szabályok, ésszerű felső korlát, hogy egy pathologikus esetben se
// nőjön korlátlanra a lista (ld. docs/tervezes.md 9.4).
const RULE_PICKER_LIMIT = 500;

const STATUS_OPTIONS = [
  { value: "", label: "Összes" },
  { value: "needs_review", label: "Felülvizsgálandó" },
  { value: "synced", label: "Szinkronizálva (automatikusan osztályozva)" },
  { value: "approved", label: "Jóváhagyva (exportra kész)" },
  { value: "submitted", label: "Beküldés alatt" },
  { value: "booked", label: "Könyvelve (IMA)" },
  { value: "failed", label: "Hibás beküldés" },
  { value: "rejected", label: "Elutasítva" },
];

/** ld. `invoiceKindLabel` (billingoApiClient.ts) — ugyanazokat a bizonylattípus-kategóriákat adja szűrhető formában. */
const KIND_OPTIONS = [
  { value: "", label: "Összes" },
  { value: "advance", label: "Előlegszámla" },
  { value: "final", label: "Végszámla" },
  { value: "normal", label: "Normál számla" },
  { value: "modification", label: "Helyesbítő számla" },
  { value: "cancellation", label: "Sztornó számla" },
  { value: "receipt", label: "Nyugta" },
  { value: "receipt_cancellation", label: "Nyugta sztornó" },
];

// Lapozott lista — enélkül több száz számla egyben renderelése lassítja a
// felületet (ld. docs/tervezes.md 10. fejezet).
const PAGE_SIZE = 50;

export default async function CompanyInvoicesPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: {
    status?: string;
    from?: string;
    to?: string;
    fulfillmentFrom?: string;
    fulfillmentTo?: string;
    kind?: string;
    page?: string;
  };
}) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: params.companyId } });

  const where: Prisma.InvoiceWhereInput = { companyId: params.companyId };
  if (searchParams.status) {
    where.status = searchParams.status as Prisma.EnumInvoiceStatusFilter["equals"];
  }
  if (searchParams.from || searchParams.to) {
    where.docDate = {
      ...(searchParams.from ? { gte: new Date(searchParams.from) } : {}),
      ...(searchParams.to ? { lte: new Date(searchParams.to) } : {}),
    };
  }
  if (searchParams.fulfillmentFrom || searchParams.fulfillmentTo) {
    where.fulfillmentDate = {
      ...(searchParams.fulfillmentFrom ? { gte: new Date(searchParams.fulfillmentFrom) } : {}),
      ...(searchParams.fulfillmentTo ? { lte: new Date(searchParams.fulfillmentTo) } : {}),
    };
  }
  // A bizonylat "típusa" (ld. `invoiceKindLabel`) az `invoiceType` +
  // `hasAdvanceSettlement` mezők KOMBINÁCIÓJÁBÓL adódik (pl. a "Végszámla"
  // nem egy külön DB-érték) — ezért a szűrő ezt a kombinációt fordítja
  // vissza where-feltétellé, nem egyetlen mezőre szűr.
  switch (searchParams.kind) {
    case "advance":
      where.invoiceType = "advance";
      break;
    case "final":
      where.invoiceType = "invoice";
      where.hasAdvanceSettlement = true;
      break;
    case "normal":
      where.invoiceType = "invoice";
      where.hasAdvanceSettlement = false;
      break;
    case "modification":
    case "cancellation":
    case "receipt":
    case "receipt_cancellation":
      where.invoiceType = searchParams.kind;
      break;
    default:
      break;
  }

  const currentPage = Math.max(1, Number(searchParams.page ?? "1") || 1);
  // A jelenlegi szűrő/lapozás állapota, hogy a számla megnyitásakor
  // ("Megnyitás" gomb) és onnan visszalépve ("← Számlák" link) NE vesszen
  // el — könyvelői jelzés (2026.09.17): korábban ez azonnal visszaállt az
  // alapértékre, ha egy tételt közvetlenül szerkesztettek.
  const currentQuery = buildQueryString(searchParams);
  const returnTo = `/dashboard/${params.companyId}${currentQuery ? `?${currentQuery}` : ""}`;

  const [invoices, totalCount, glaAccounts, vatKeys, rules, ossStatus] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: {
        id: true,
        billingoDocumentNumber: true,
        billingoDocumentId: true,
        partner: { select: { name: true } },
        fulfillmentDate: true,
        netAmount: true,
        vatAmount: true,
        grossAmount: true,
        currencyCode: true,
        invoiceType: true,
        hasAdvanceSettlement: true,
        status: true,
        imaPushError: true,
        exchangeRateWarning: true,
        rejectionReason: true,
        billingoCancelled: true,
      },
      orderBy: { docDate: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.invoice.count({ where }),
    // A tömeges kontír/áfa beállítás combobox javaslataihoz — KIZÁRÓLAG a
    // kézzel frissített DB-cache-ből, ld. imaReferenceCache.ts.
    getCachedGlaAccounts(params.companyId),
    getCachedVatKeys(params.companyId),
    // A tömeges "szabály alkalmazása" választólistájához.
    prisma.mappingRule.findMany({
      where: { companyId: params.companyId, active: true },
      select: {
        id: true,
        partnerId: true,
        partner: { select: { name: true } },
        productNamePattern: true,
        commentPattern: true,
        documentTypePattern: true,
        vatPattern: true,
        amountSignPattern: true,
        glaCode: true,
        vatCode: true,
        vatGlaCode: true,
        amountSign: true,
      },
      orderBy: { updatedAt: "desc" },
      take: RULE_PICKER_LIMIT,
    }),
    computeOssStatus(params.companyId),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const missingConnections: string[] = [];
  if (!company.billingoApiKey) missingConnections.push("Billingo API kulcs");
  if (!company.imaApiKey || !company.imaApiUser || !company.imaApiCompany) missingConnections.push("IMA API kapcsolat");

  return (
    <div className="stack-lg">
      {missingConnections.length > 0 && (
        <p className="alert alert-warning">
          Hiányzó beállítás(ok): {missingConnections.join(", ")} — töltsd ki a{" "}
          <Link href={`/dashboard/${params.companyId}/settings`}>Beállítások</Link> oldalon.
        </p>
      )}

      <SyncControls companyId={params.companyId} canSync={!!company.billingoApiKey} />

      <OssStatusCard companyId={params.companyId} status={ossStatus} />

      {/* A kiegyenlítés (Stripe-tranzakció) CSV export egyelőre elrejtve —
          könyvelői kérés (2026.09.17): "erre lesz külön ötletem" — a
          SettlementExportControls komponens és a hozzá tartozó API/logika
          változatlanul megvan, csak a Számlák fülön nem jelenik meg. */}

      <form className="card cluster" method="get">
        <label className="field" style={{ minWidth: 200 }}>
          Státusz
          <select name="status" defaultValue={searchParams.status ?? ""}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Kelte-tól
          <input type="date" name="from" defaultValue={searchParams.from ?? ""} />
        </label>
        <label className="field">
          Kelte-ig
          <input type="date" name="to" defaultValue={searchParams.to ?? ""} />
        </label>
        <label className="field">
          Teljesítés-tól
          <input type="date" name="fulfillmentFrom" defaultValue={searchParams.fulfillmentFrom ?? ""} />
        </label>
        <label className="field">
          Teljesítés-ig
          <input type="date" name="fulfillmentTo" defaultValue={searchParams.fulfillmentTo ?? ""} />
        </label>
        <label className="field" style={{ minWidth: 180 }}>
          Típus
          <select name="kind" defaultValue={searchParams.kind ?? ""}>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button className="btn btn-primary" type="submit" style={{ marginTop: "1.4rem" }}>
            Szűrés
          </button>
        </div>
        {(searchParams.status ||
          searchParams.from ||
          searchParams.to ||
          searchParams.fulfillmentFrom ||
          searchParams.fulfillmentTo ||
          searchParams.kind) && (
          <Link href={`/dashboard/${params.companyId}`} className="btn btn-sm" style={{ marginTop: "1.4rem" }}>
            Szűrők törlése
          </Link>
        )}
      </form>

      {totalPages > 1 && (
        <PaginationBar
          companyId={params.companyId}
          searchParams={searchParams}
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={totalCount}
        />
      )}

      <InvoiceListTable
        companyId={params.companyId}
        returnTo={returnTo}
        invoices={invoices.map((inv) => ({
          id: inv.id,
          billingoDocumentNumber: inv.billingoDocumentNumber ?? inv.billingoDocumentId,
          partnerName: inv.partner?.name ?? null,
          fulfillmentDate: inv.fulfillmentDate ? inv.fulfillmentDate.toISOString() : null,
          netAmount: inv.netAmount != null ? Number(inv.netAmount) : null,
          vatAmount: inv.vatAmount != null ? Number(inv.vatAmount) : null,
          grossAmount: inv.grossAmount != null ? Number(inv.grossAmount) : null,
          currencyCode: inv.currencyCode,
          invoiceKind: invoiceKindLabel(inv.invoiceType, inv.hasAdvanceSettlement),
          status: inv.status,
          imaPushError: inv.imaPushError,
          exchangeRateWarning: inv.exchangeRateWarning,
          rejectionReason: inv.rejectionReason,
          billingoCancelled: inv.billingoCancelled,
        }))}
        glaAccountOptions={glaAccounts.map((a) => ({ code: a.code, name: a.name }))}
        vatKeyOptions={vatKeys.map((v) => ({ code: v.code, name: v.name }))}
        ruleOptions={rules.map((r) => ({
          id: r.id,
          summary: summarizeRuleConditions({ ...r, partnerName: r.partner?.name ?? null }),
          glaCode: r.glaCode,
          vatCode: r.vatCode,
          vatGlaCode: r.vatGlaCode,
          amountSign: r.amountSign,
        }))}
      />

      {totalPages > 1 && (
        <PaginationBar
          companyId={params.companyId}
          searchParams={searchParams}
          currentPage={currentPage}
          totalPages={totalPages}
          totalCount={totalCount}
        />
      )}
    </div>
  );
}

type InvoiceListSearchParams = {
  status?: string;
  from?: string;
  to?: string;
  fulfillmentFrom?: string;
  fulfillmentTo?: string;
  kind?: string;
};

/** Lapozó sáv — a lista TETEJÉN és ALJÁN is megjelenik (könyvelői kérés, 2026.09.17), ugyanazzal a logikával. */
function PaginationBar({
  companyId,
  searchParams,
  currentPage,
  totalPages,
  totalCount,
}: {
  companyId: string;
  searchParams: InvoiceListSearchParams;
  currentPage: number;
  totalPages: number;
  totalCount: number;
}) {
  return (
    <div className="cluster" style={{ justifyContent: "space-between" }}>
      <span className="muted text-sm">
        {totalCount} számla — {currentPage}. / {totalPages} oldal
      </span>
      <div className="cluster">
        <Link
          href={buildPageHref(companyId, searchParams, currentPage - 1)}
          className={`btn btn-sm${currentPage <= 1 ? " btn-disabled" : ""}`}
          aria-disabled={currentPage <= 1}
          tabIndex={currentPage <= 1 ? -1 : undefined}
        >
          ← Előző
        </Link>
        <Link
          href={buildPageHref(companyId, searchParams, currentPage + 1)}
          className={`btn btn-sm${currentPage >= totalPages ? " btn-disabled" : ""}`}
          aria-disabled={currentPage >= totalPages}
          tabIndex={currentPage >= totalPages ? -1 : undefined}
        >
          Következő →
        </Link>
      </div>
    </div>
  );
}

/** A jelenlegi szűrő-paraméterekből épít egy query stringet (page nélkül) — ld. `returnTo`. */
function buildQueryString(searchParams: InvoiceListSearchParams): string {
  const params = new URLSearchParams();
  if (searchParams.status) params.set("status", searchParams.status);
  if (searchParams.from) params.set("from", searchParams.from);
  if (searchParams.to) params.set("to", searchParams.to);
  if (searchParams.fulfillmentFrom) params.set("fulfillmentFrom", searchParams.fulfillmentFrom);
  if (searchParams.fulfillmentTo) params.set("fulfillmentTo", searchParams.fulfillmentTo);
  if (searchParams.kind) params.set("kind", searchParams.kind);
  return params.toString();
}

function buildPageHref(companyId: string, searchParams: InvoiceListSearchParams, page: number): string {
  const params = new URLSearchParams(buildQueryString(searchParams));
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/dashboard/${companyId}${query ? `?${query}` : ""}`;
}

import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invoiceKindLabel } from "@/lib/billingoApiClient";
import { getCachedGlaAccounts, getCachedVatKeys } from "@/lib/imaReferenceCache";
import { summarizeRuleConditions } from "@/lib/mappingRuleEngine";
import { findRecurringSettlementPartners } from "@/lib/settlementExport";
import { computeOssStatus } from "@/lib/ossThreshold";
import SyncControls from "./SyncControls";
import InvoiceListTable from "./InvoiceListTable";
import SettlementExportControls from "./SettlementExportControls";
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

// Lapozott lista — enélkül több száz számla egyben renderelése lassítja a
// felületet (ld. docs/tervezes.md 10. fejezet).
const PAGE_SIZE = 50;

export default async function CompanyInvoicesPage({
  params,
  searchParams,
}: {
  params: { companyId: string };
  searchParams: { status?: string; from?: string; to?: string; page?: string };
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

  const currentPage = Math.max(1, Number(searchParams.page ?? "1") || 1);

  const [invoices, totalCount, glaAccounts, vatKeys, rules, pendingSettlementCount, recurringSettlementPartners, ossStatus] = await Promise.all([
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
        glaCode: true,
        vatCode: true,
        vatGlaCode: true,
        amountSign: true,
      },
      orderBy: { updatedAt: "desc" },
      take: RULE_PICKER_LIMIT,
    }),
    prisma.invoice.count({
      where: { companyId: params.companyId, detectedPaymentTransactionId: { not: null }, settlementExportedAt: null },
    }),
    findRecurringSettlementPartners(params.companyId),
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

      <SettlementExportControls
        companyId={params.companyId}
        pendingCount={pendingSettlementCount}
        recurringPartners={recurringSettlementPartners.map((p) => ({
          partnerName: p.partnerName,
          totalInvoices: p.totalInvoices,
          detectedInvoices: p.detectedInvoices,
        }))}
      />

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
        <div>
          <button className="btn btn-primary" type="submit" style={{ marginTop: "1.4rem" }}>
            Szűrés
          </button>
        </div>
        {(searchParams.status || searchParams.from || searchParams.to) && (
          <Link href={`/dashboard/${params.companyId}`} className="btn btn-sm" style={{ marginTop: "1.4rem" }}>
            Szűrők törlése
          </Link>
        )}
      </form>

      <InvoiceListTable
        companyId={params.companyId}
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
        <div className="cluster" style={{ justifyContent: "space-between" }}>
          <span className="muted text-sm">
            {totalCount} számla — {currentPage}. / {totalPages} oldal
          </span>
          <div className="cluster">
            <Link
              href={buildPageHref(params.companyId, searchParams, currentPage - 1)}
              className={`btn btn-sm${currentPage <= 1 ? " btn-disabled" : ""}`}
              aria-disabled={currentPage <= 1}
              tabIndex={currentPage <= 1 ? -1 : undefined}
            >
              ← Előző
            </Link>
            <Link
              href={buildPageHref(params.companyId, searchParams, currentPage + 1)}
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

function buildPageHref(
  companyId: string,
  searchParams: { status?: string; from?: string; to?: string },
  page: number
): string {
  const params = new URLSearchParams();
  if (searchParams.status) params.set("status", searchParams.status);
  if (searchParams.from) params.set("from", searchParams.from);
  if (searchParams.to) params.set("to", searchParams.to);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/dashboard/${companyId}${query ? `?${query}` : ""}`;
}

import { prisma } from "@/lib/db";
import { fetchNapiarfolyamBankList } from "@/lib/napiarfolyamExchangeRate";
import {
  getCachedGlaAccounts,
  getCachedVatKeys,
  getCachedImaPaymentMethods,
  getGlaAccountCacheUpdatedAt,
} from "@/lib/imaReferenceCache";
import { resolvePrimaryAdvanceGlaCode } from "@/lib/mappingRuleEngine";
import ImaReferenceRefreshControls from "@/components/ImaReferenceRefreshControls";
import SettingsForm from "./SettingsForm";
import VatMappingSettings from "./VatMappingSettings";
import PaymentMethodMappingSettings from "./PaymentMethodMappingSettings";
import OssVatMappingSettings from "./OssVatMappingSettings";

export default async function CompanySettingsPage({ params }: { params: { companyId: string } }) {
  const [
    company,
    bankOptions,
    vatMappings,
    glaAccounts,
    vatKeys,
    imaPaymentMethods,
    paymentMethodMappings,
    glaAccountCacheUpdatedAt,
    derivedPrimaryAdvanceGlaCode,
    ossVatMappings,
  ] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: params.companyId } }),
    fetchNapiarfolyamBankList(),
    prisma.vatCodeMapping.findMany({
      where: { companyId: params.companyId },
      orderBy: { billingoVatValue: "asc" },
    }),
    // KIZÁRÓLAG a DB-cache-ből olvasunk, SOHA nem hívunk ki élőben IMA-t
    // oldalbetöltéskor — ld. imaReferenceCache.ts.
    getCachedGlaAccounts(params.companyId),
    getCachedVatKeys(params.companyId),
    getCachedImaPaymentMethods(params.companyId),
    prisma.paymentMethodMapping.findMany({ where: { companyId: params.companyId } }),
    getGlaAccountCacheUpdatedAt(params.companyId),
    // Csak a hint-szöveghez ("ha üresen hagyod, ezt vezetnénk le") — ld.
    // mappingRuleEngine.ts.
    resolvePrimaryAdvanceGlaCode(params.companyId),
    prisma.ossVatCodeMapping.findMany({
      where: { companyId: params.companyId },
      orderBy: [{ countryCode: "asc" }, { billingoVatValue: "asc" }],
    }),
  ]);

  const canQueryIma = Boolean(company.imaApiKey && company.imaApiUser && company.imaApiCompany);

  return (
    <div className="stack-lg">
      <SettingsForm
        companyId={params.companyId}
        initialName={company.name}
        initialStatus={company.status}
        initialBillingoApiKey={company.billingoApiKey ?? ""}
        initialBillingoSyncFromDate={
          company.billingoSyncFromDate ? company.billingoSyncFromDate.toISOString().slice(0, 10) : ""
        }
        billingoSyncStarted={company.lastBillingoSyncAt != null}
        initialUseMnbExchangeRate={company.useMnbExchangeRate}
        initialExchangeRateBank={company.exchangeRateBank ?? ""}
        exchangeRateBankOptions={bankOptions}
        initialImaApiKey={company.imaApiKey ?? ""}
        initialImaApiUser={company.imaApiUser ?? ""}
        initialImaApiCompany={company.imaApiCompany ?? ""}
        initialPrimaryAdvanceGlaCode={company.primaryAdvanceGlaCode ?? ""}
        derivedPrimaryAdvanceGlaCode={derivedPrimaryAdvanceGlaCode}
        glaAccountOptions={glaAccounts.map((a) => ({ code: a.code, name: a.name }))}
        initialOssRegistered={company.ossRegistered}
      />
      <div className="card stack">
        <div className="card-title">IMA számlatükör / áfa kulcsok</div>
        <p className="text-sm muted" style={{ marginTop: 0 }}>
          A Kontír/áfa szabályok oldal kontír/áfa mezőinek kereshető javaslatai ebből a
          (kézzel frissíthető) listából jönnek — nem hívjuk ki élőben IMA-t minden
          oldalbetöltésnél.
        </p>
        <ImaReferenceRefreshControls
          companyId={params.companyId}
          canRefresh={canQueryIma}
          lastUpdatedAt={glaAccountCacheUpdatedAt ? glaAccountCacheUpdatedAt.toISOString() : null}
        />
      </div>
      <VatMappingSettings
        companyId={params.companyId}
        vatKeyOptions={vatKeys.map((v) => ({ code: v.code, name: v.name }))}
        mappings={vatMappings.map((m) => ({
          id: m.id,
          billingoVatValue: m.billingoVatValue,
          imaVatCode: m.imaVatCode,
          note: m.note,
        }))}
      />
      <PaymentMethodMappingSettings
        companyId={params.companyId}
        imaPaymentMethodOptions={imaPaymentMethods.map((p) => ({ desc: p.desc, navPayMethodType: p.navPayMethodType }))}
        initialMappings={Object.fromEntries(
          paymentMethodMappings.map((m) => [m.billingoPaymentMethod, m.imaPaymentMethodDesc])
        )}
      />
      <OssVatMappingSettings
        companyId={params.companyId}
        vatKeyOptions={vatKeys.map((v) => ({ code: v.code, name: v.name }))}
        mappings={ossVatMappings.map((m) => ({
          id: m.id,
          countryCode: m.countryCode,
          billingoVatValue: m.billingoVatValue,
          imaVatCode: m.imaVatCode,
          note: m.note,
        }))}
      />
    </div>
  );
}

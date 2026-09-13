/**
 * Minden (IMA API kapcsolattal rendelkező) cégnél újratanulja a kontír/áfa
 * javaslatokat az `/invoiceanalytics`-ból — ld. docs/tervezes.md 9. fejezet.
 * Futtatás: npm run learn:invoiceanalytics.
 */
import { PrismaClient } from "@prisma/client";
import { fetchImaSalesInvoiceAnalytics } from "../src/lib/imaApiClient";
import { learnFromInvoiceAnalytics } from "../src/lib/mappingRuleEngine";

const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany({
    where: { status: "active", imaApiKey: { not: null }, imaApiUser: { not: null }, imaApiCompany: { not: null } },
  });

  for (const company of companies) {
    try {
      const actingUser = await prisma.user.findFirstOrThrow({
        where: { companyMemberships: { some: { companyId: company.id } }, role: "konyvelo" },
      });
      const rows = await fetchImaSalesInvoiceAnalytics({
        apiKey: company.imaApiKey!,
        user: company.imaApiUser!,
        company: company.imaApiCompany!,
      });
      const result = await learnFromInvoiceAnalytics(company.id, actingUser.id, rows);
      console.log(`[${company.name}] rows=${rows.length} createdOrUpdated=${result.createdOrUpdated}`);
    } catch (err) {
      console.error(`[${company.name}] tanulási hiba:`, err instanceof Error ? err.message : err);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

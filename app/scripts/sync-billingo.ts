/**
 * Minden (Billingo API kulccsal rendelkező) cég Billingo szinkronját
 * lefuttatja — CLI belépési pont Cloud Scheduler / Cloud Run Job
 * ütemezéshez, alternatívaként a UI "Szinkronizálás most" gombjához (ld.
 * docs/tervezes.md 7. fejezet). Futtatás: npm run sync:billingo.
 */
import { PrismaClient } from "@prisma/client";
import { syncCompanyBillingoInvoices } from "../src/lib/billingoSync";

const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany({
    where: { status: "active", billingoApiKey: { not: null } },
  });

  for (const company of companies) {
    try {
      const result = await syncCompanyBillingoInvoices(company.id);
      console.log(`[${company.name}] fetched=${result.fetched} created=${result.created} updated=${result.updated}`);
    } catch (err) {
      console.error(`[${company.name}] szinkron hiba:`, err instanceof Error ? err.message : err);
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

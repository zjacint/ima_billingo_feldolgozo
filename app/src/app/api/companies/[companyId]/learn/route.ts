import { NextResponse } from "next/server";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { prisma } from "@/lib/db";
import { fetchImaGlaAccounts, fetchImaGlaDetails, fetchImaSalesInvoiceAnalytics, fetchImaVatKeys } from "@/lib/imaApiClient";
import { learnFromInvoiceAnalytics } from "@/lib/mappingRuleEngine";

export async function POST(_req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: params.companyId } });
    if (!company.imaApiKey || !company.imaApiUser || !company.imaApiCompany) {
      return NextResponse.json({ error: "A céghez nincs teljesen kitöltve az IMA API kapcsolat." }, { status: 400 });
    }
    const credentials = { apiKey: company.imaApiKey, user: company.imaApiUser, company: company.imaApiCompany };

    // A számlatükröt és az áfa kulcs listát referencia-adatként kérjük le
    // a validált kontírkód-, ill. a névből visszafejtett áfa KÓD-
    // párosításhoz — ld. src/lib/mappingRuleEngine.ts, docs/tervezes.md 9.4.
    // A /invoiceanalytics csak áfa NEVET ad, nem kódot, ezt a /vatkeys
    // listával oldjuk fel. A tanult szabályok partner-függetlenek, ezért
    // partner-referencia lekérdezésre nincs szükség.
    // A /gladetails-et is lekérjük, kereszt-ellenőrzésre/preferált kontír-
    // forrásként (ld. mappingRuleEngine.ts "gladetails kereszt-ellenőrzés").
    // Defenzíven `.catch(() => [])`-fal — ha ez a lekérdezés hibázik
    // (pl. a cégnél nincs elérhető adat egy dátumtartományra), a tanulás
    // a megszokott GLAID-alapú levezetésre esik vissza, nem hiúsul meg.
    const [rows, imaGlaAccounts, imaVatKeys, imaGlaDetails] = await Promise.all([
      fetchImaSalesInvoiceAnalytics(credentials),
      fetchImaGlaAccounts(credentials).catch(() => []),
      fetchImaVatKeys(credentials).catch(() => []),
      fetchImaGlaDetails(credentials).catch(() => []),
    ]);
    // A `result.pendingMerges` a kézi szabállyal ütköző, jóváhagyásra váró
    // összevonási javaslatokat hordozza — ld. mappingRuleEngine.ts
    // `findCollidingManualRule`. A tényleges alkalmazás külön, explicit
    // megerősítés utáni hívás: POST .../learn/apply-merges.
    const result = await learnFromInvoiceAnalytics(params.companyId, session.user.id, rows, {
      imaGlaAccounts,
      imaVatKeys,
      imaGlaDetails,
    });
    return NextResponse.json({ fetchedRows: rows.length, ...result });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : message }, { status });
  }
}

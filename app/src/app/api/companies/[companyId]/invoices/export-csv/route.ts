import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyMembership, requireKonyvelo, errorToResponseInit } from "@/lib/access";
import { prisma } from "@/lib/db";
import { buildImaCsvRows, imaCsvRowsToCsv, type ImaCsvExportInvoice } from "@/lib/imaCsvExport";
import { parseAdvanceReferenceNumber } from "@/lib/mappingRuleEngine";
import { isOssRelevantPartner, findMissingOssVatMappings } from "@/lib/ossThreshold";
import type { InvoiceLine } from "@/lib/types";

const schema = z.object({ invoiceIds: z.array(z.string()).min(1) });

/**
 * IMA import CSV letöltése kijelölt számlákra — kézi/tartalék útvonal,
 * amíg az API-n keresztüli beküldés élő megbízhatósága nincs megerősítve
 * (ld. docs/tervezes.md 8. és 12. fejezet). Csak a jóváhagyott (`approved*`)
 * kontír/áfa értékeket exportálja soronként — ha egy sorhoz ez hiányzik,
 * a számlát kihagyja és a hiányzó okot egy külön fejlécben jelzi vissza,
 * hogy a letöltés soha ne generáljon csendben hiányos IMA-importsort.
 */
export async function POST(req: Request, { params }: { params: { companyId: string } }) {
  try {
    const { session } = await requireCompanyMembership(params.companyId);
    requireKonyvelo(session);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Érvénytelen adatok." }, { status: 400 });
    }

    const invoices = await prisma.invoice.findMany({
      where: { id: { in: parsed.data.invoiceIds }, companyId: params.companyId },
      include: { partner: true, company: true },
    });

    const skipped: { invoiceId: string; billingoDocumentNumber: string | null; reason: string }[] = [];
    const allRows = [];

    for (const invoice of invoices) {
      const lines = invoice.lines as unknown as InvoiceLine[];
      const unclassified = lines.some((l) => !l.approvedGlaCode || !l.approvedVatCode);
      if (unclassified) {
        skipped.push({
          invoiceId: invoice.id,
          billingoDocumentNumber: invoice.billingoDocumentNumber,
          reason: "Nincs minden tételsorhoz jóváhagyott kontír/áfa kulcs.",
        });
        continue;
      }

      // OSS szigorú áfa-megfeleltetés ellenőrzése — ld. invoiceWorkflow.ts
      // `submitInvoiceToIma` ugyanerre a logikára épülő doksztringje.
      if (invoice.company.ossRegistered && invoice.partner && isOssRelevantPartner(invoice.partner)) {
        const missing = await findMissingOssVatMappings(
          invoice.companyId,
          invoice.partner.countryCode!,
          lines.map((l) => l.vatPercentOrCode)
        );
        if (missing.length > 0) {
          skipped.push({
            invoiceId: invoice.id,
            billingoDocumentNumber: invoice.billingoDocumentNumber,
            reason: `OSS-érintett külföldi magánszemély partner (${invoice.partner.countryCode}) — hiányzó szigorú áfa megfeleltetés: ${missing.join(", ")}.`,
          });
          continue;
        }
      }

      const exportInvoice: ImaCsvExportInvoice = {
        invoiceNumber: invoice.billingoDocumentNumber ?? invoice.billingoDocumentId,
        invoiceType: invoice.invoiceType,
        docDate: invoice.docDate,
        fulfillmentDate: invoice.fulfillmentDate,
        vatFulfillmentDate: invoice.vatFulfillmentDateOverride ?? invoice.fulfillmentDate,
        dueDate: invoice.dueDate,
        paymentMethod: invoice.paymentMethod,
        currencyCode: invoice.currencyCode,
        exchangeRate: invoice.exchangeRate != null ? Number(invoice.exchangeRate) : null,
        netAmount: invoice.netAmount != null ? Number(invoice.netAmount) : null,
        vatAmount: invoice.vatAmount != null ? Number(invoice.vatAmount) : null,
        grossAmount: invoice.grossAmount != null ? Number(invoice.grossAmount) : null,
        partnerName: invoice.partner?.name ?? null,
        partnerTaxNumber: invoice.partner?.taxNumber ?? null,
        partnerPostalCode: invoice.partner?.postalCode ?? null,
        partnerCity: invoice.partner?.city ?? null,
        partnerAddressStreet: invoice.partner?.addressStreet ?? null,
        partnerCountryCode: invoice.partner?.countryCode ?? null,
        lines: lines.map((l) => ({
          productName: l.productName,
          comment: l.comment,
          quantity: l.quantity,
          unitOfMeasure: l.unitOfMeasure,
          netUnitCost: l.netUnitCost,
          netAmount: l.approvedAmountSign === "negative" ? -l.netAmount : l.netAmount,
          vatAmount: l.approvedAmountSign === "negative" ? -l.vatAmount : l.vatAmount,
          grossAmount: l.approvedAmountSign === "negative" ? -l.grossAmount : l.grossAmount,
          glaCode: l.approvedGlaCode,
          vatCode: l.approvedVatCode,
          vatGlaCode: l.approvedVatGlaCode,
        })),
      };

      allRows.push(...buildImaCsvRows(exportInvoice, parseAdvanceReferenceNumber));
    }

    const csv = imaCsvRowsToCsv(allRows);
    const headers = new Headers({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ima-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      "X-Skipped-Count": String(skipped.length),
    });
    if (skipped.length > 0) {
      headers.set("X-Skipped-Invoices", encodeURIComponent(JSON.stringify(skipped)));
    }
    return new NextResponse(csv, { status: 200, headers });
  } catch (err) {
    const { status, message } = errorToResponseInit(err);
    return NextResponse.json({ error: message }, { status });
  }
}

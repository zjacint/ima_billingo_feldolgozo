import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isPartnerReadyForSubmission, type InvoiceLine } from "@/lib/types";
import InvoiceDetail from "./InvoiceDetail";

export default async function InvoiceDetailPage({
  params,
}: {
  params: { companyId: string; invoiceId: string };
}) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: params.invoiceId },
    include: { partner: true },
  });
  if (!invoice || invoice.companyId !== params.companyId) notFound();

  return (
    <div className="stack-lg">
      <Link href={`/dashboard/${params.companyId}`} className="back-link">
        ← Számlák
      </Link>
      <InvoiceDetail
        companyId={params.companyId}
        invoiceId={invoice.id}
        billingoDocumentNumber={invoice.billingoDocumentNumber ?? invoice.billingoDocumentId}
        status={invoice.status}
        partnerName={invoice.partner?.name ?? "—"}
        partnerReadyForSubmission={isPartnerReadyForSubmission(invoice.partner)}
        currencyCode={invoice.currencyCode}
        grossAmount={invoice.grossAmount != null ? Number(invoice.grossAmount) : 0}
        imaPushError={invoice.imaPushError}
        imaSalesheaderId={invoice.imaSalesheaderId}
        imaImageUploaded={invoice.imaImageUploaded}
        imaImageUploadError={invoice.imaImageUploadError}
        exchangeRateWarning={invoice.exchangeRateWarning}
        docDate={invoice.docDate ? invoice.docDate.toISOString().slice(0, 10) : ""}
        fulfillmentDate={invoice.fulfillmentDate ? invoice.fulfillmentDate.toISOString().slice(0, 10) : ""}
        dueDate={invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : ""}
        paymentMethod={invoice.paymentMethod}
        initialVatFulfillmentDateOverride={
          invoice.vatFulfillmentDateOverride ? invoice.vatFulfillmentDateOverride.toISOString().slice(0, 10) : ""
        }
        rejectionReason={invoice.rejectionReason}
        billingoCancelled={invoice.billingoCancelled}
        lines={invoice.lines as unknown as InvoiceLine[]}
      />
    </div>
  );
}

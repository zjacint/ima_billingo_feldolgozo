-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "ossRegistered" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "detectedPaymentProcessor" TEXT,
ADD COLUMN     "detectedPaymentTransactionId" TEXT,
ADD COLUMN     "settlementExportedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "oss_vat_code_mappings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "billingoVatValue" TEXT NOT NULL,
    "imaVatCode" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oss_vat_code_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oss_vat_code_mappings_companyId_countryCode_billingoVatValu_key" ON "oss_vat_code_mappings"("companyId", "countryCode", "billingoVatValue");

-- AddForeignKey
ALTER TABLE "oss_vat_code_mappings" ADD CONSTRAINT "oss_vat_code_mappings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

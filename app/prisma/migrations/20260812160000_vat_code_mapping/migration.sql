-- CreateTable
CREATE TABLE "vat_code_mappings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "billingoVatValue" TEXT NOT NULL,
    "imaVatCode" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_code_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vat_code_mappings_companyId_billingoVatValue_key" ON "vat_code_mappings"("companyId", "billingoVatValue");

-- AddForeignKey
ALTER TABLE "vat_code_mappings" ADD CONSTRAINT "vat_code_mappings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

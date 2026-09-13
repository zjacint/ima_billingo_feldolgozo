-- CreateTable
CREATE TABLE "ima_payment_method_cache" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "imaId" INTEGER NOT NULL,
    "desc" TEXT NOT NULL,
    "navPayMethodType" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ima_payment_method_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_method_mappings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "billingoPaymentMethod" TEXT NOT NULL,
    "imaPaymentMethodDesc" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_method_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ima_payment_method_cache_companyId_imaId_key" ON "ima_payment_method_cache"("companyId", "imaId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_mappings_companyId_billingoPaymentMethod_key" ON "payment_method_mappings"("companyId", "billingoPaymentMethod");

-- AddForeignKey
ALTER TABLE "ima_payment_method_cache" ADD CONSTRAINT "ima_payment_method_cache_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_method_mappings" ADD CONSTRAINT "payment_method_mappings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ima_gla_account_cache" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ima_gla_account_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ima_vat_key_cache" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percent" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ima_vat_key_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ima_gla_account_cache_companyId_code_key" ON "ima_gla_account_cache"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ima_vat_key_cache_companyId_code_key" ON "ima_vat_key_cache"("companyId", "code");

-- AddForeignKey
ALTER TABLE "ima_gla_account_cache" ADD CONSTRAINT "ima_gla_account_cache_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ima_vat_key_cache" ADD CONSTRAINT "ima_vat_key_cache_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

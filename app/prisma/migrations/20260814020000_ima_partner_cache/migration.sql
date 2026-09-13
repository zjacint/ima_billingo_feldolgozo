-- CreateTable
CREATE TABLE "ima_partner_cache" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "imaPartnerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "taxNumber" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ima_partner_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ima_partner_cache_companyId_imaPartnerId_key" ON "ima_partner_cache"("companyId", "imaPartnerId");

-- AddForeignKey
ALTER TABLE "ima_partner_cache" ADD CONSTRAINT "ima_partner_cache_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

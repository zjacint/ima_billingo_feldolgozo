-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "exchangeRateBank" TEXT,
ADD COLUMN     "useMnbExchangeRate" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "exchangeRateWarning" TEXT;

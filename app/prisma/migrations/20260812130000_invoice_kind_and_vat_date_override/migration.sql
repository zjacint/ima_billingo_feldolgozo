-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "hasAdvanceSettlement" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vatFulfillmentDateOverride" TIMESTAMP(3);

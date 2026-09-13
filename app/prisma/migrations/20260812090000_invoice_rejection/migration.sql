-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'rejected';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

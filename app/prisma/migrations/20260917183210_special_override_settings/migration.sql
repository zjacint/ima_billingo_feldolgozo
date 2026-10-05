-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "enableAdvanceSignOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enableCancellationInheritance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enableModificationInheritance" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "relatedDocumentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

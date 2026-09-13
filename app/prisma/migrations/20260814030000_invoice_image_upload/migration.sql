-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "imaImageUploadError" TEXT,
ADD COLUMN     "imaImageUploaded" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "AmountSign" AS ENUM ('original', 'negative');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "comment" TEXT;

-- AlterTable
ALTER TABLE "mapping_rules" ADD COLUMN     "amountSign" "AmountSign" NOT NULL DEFAULT 'original',
ADD COLUMN     "commentPattern" TEXT,
ADD COLUMN     "documentTypePattern" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "vatPattern" TEXT;

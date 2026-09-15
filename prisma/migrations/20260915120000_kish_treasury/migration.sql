-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SyndicateTxKind" ADD VALUE 'RESOURCE_DELIVERY';
ALTER TYPE "SyndicateTxKind" ADD VALUE 'RESOURCE_PICKUP';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FleetMission" ADD VALUE 'KISH_DELIVERY';
ALTER TYPE "FleetMission" ADD VALUE 'KISH_PICKUP';

-- AlterTable
ALTER TABLE "syndicate_banks" ADD COLUMN     "ore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "plasma" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "polymers" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "syndicate_transactions" ADD COLUMN     "ore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "plasma" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "polymers" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "pickupPlasma" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "targetSyndicateId" TEXT;

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_targetSyndicateId_fkey" FOREIGN KEY ("targetSyndicateId") REFERENCES "syndicates"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SyndicateTxKind" ADD VALUE 'TREASURY_UPGRADE';
ALTER TYPE "SyndicateTxKind" ADD VALUE 'KISH_DEFENSE';
ALTER TYPE "SyndicateTxKind" ADD VALUE 'KISH_RAIDED';

-- AlterEnum
ALTER TYPE "FleetMission" ADD VALUE 'KISH_RAID';

-- AlterTable
ALTER TABLE "syndicates" ADD COLUMN     "debrisOre" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "debrisPolymers" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "treasuryLevel" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "syndicate_defenses" (
    "id" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "type" "DefenseType" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "syndicate_defenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "syndicate_defenses_syndicateId_type_key" ON "syndicate_defenses"("syndicateId", "type");

-- AddForeignKey
ALTER TABLE "syndicate_defenses" ADD CONSTRAINT "syndicate_defenses_syndicateId_fkey" FOREIGN KEY ("syndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;


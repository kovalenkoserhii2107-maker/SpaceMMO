-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SyndicateTxKind" ADD VALUE 'GATE_BUILD';
ALTER TYPE "SyndicateTxKind" ADD VALUE 'KISH_MOVE';

-- AlterTable
ALTER TABLE "syndicates" ADD COLUMN     "kishMovedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "syndicate_banks" ADD COLUMN     "antimatter" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "syndicate_transactions" ADD COLUMN     "antimatter" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "viaGate" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "syndicate_gates" (
    "id" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowShips" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syndicate_gates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "syndicate_gates_syndicateId_systemId_key" ON "syndicate_gates"("syndicateId", "systemId");

-- AddForeignKey
ALTER TABLE "syndicate_gates" ADD CONSTRAINT "syndicate_gates_syndicateId_fkey" FOREIGN KEY ("syndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_gates" ADD CONSTRAINT "syndicate_gates_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "solar_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;


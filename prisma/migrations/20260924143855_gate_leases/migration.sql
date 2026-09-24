-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SyndicateTxKind" ADD VALUE 'GATE_LEASE_INCOME';
ALTER TYPE "SyndicateTxKind" ADD VALUE 'GATE_LEASE_PAYMENT';
ALTER TYPE "SyndicateTxKind" ADD VALUE 'GATE_LEASE_REFUND';

-- CreateTable
CREATE TABLE "gate_leases" (
    "id" TEXT NOT NULL,
    "ownerSyndicateId" TEXT NOT NULL,
    "tenantCommanderId" TEXT,
    "tenantSyndicateId" TEXT,
    "price" INTEGER NOT NULL,
    "hours" INTEGER NOT NULL,
    "offeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "paidById" TEXT,

    CONSTRAINT "gate_leases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gate_leases_ownerSyndicateId_idx" ON "gate_leases"("ownerSyndicateId");

-- CreateIndex
CREATE INDEX "gate_leases_tenantCommanderId_idx" ON "gate_leases"("tenantCommanderId");

-- CreateIndex
CREATE INDEX "gate_leases_tenantSyndicateId_idx" ON "gate_leases"("tenantSyndicateId");

-- AddForeignKey
ALTER TABLE "gate_leases" ADD CONSTRAINT "gate_leases_ownerSyndicateId_fkey" FOREIGN KEY ("ownerSyndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_leases" ADD CONSTRAINT "gate_leases_tenantCommanderId_fkey" FOREIGN KEY ("tenantCommanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_leases" ADD CONSTRAINT "gate_leases_tenantSyndicateId_fkey" FOREIGN KEY ("tenantSyndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

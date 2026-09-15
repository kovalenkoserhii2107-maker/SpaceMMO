-- CreateEnum
CREATE TYPE "SyndicatePermission" AS ENUM ('APPLICATIONS', 'KICK', 'PROMOTE', 'BROADCAST', 'WITHDRAW', 'TAX', 'CODEX', 'RULES', 'DIPLOMACY', 'KISH');

-- CreateEnum
CREATE TYPE "SyndicateRecruitment" AS ENUM ('OPEN', 'APPLICATION', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SyndicateTxKind" ADD VALUE 'TAX';
ALTER TYPE "SyndicateTxKind" ADD VALUE 'ENTRY_FEE';
ALTER TYPE "SyndicateTxKind" ADD VALUE 'KISH_UPGRADE';

-- AlterTable
ALTER TABLE "commanders" ADD COLUMN     "syndicateJoinedAt" TIMESTAMP(3),
ADD COLUMN     "syndicateLeftAt" TIMESTAMP(3),
ADD COLUMN     "syndicateMerit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "syndicateRankId" TEXT;

-- AlterTable
ALTER TABLE "syndicates" ADD COLUMN     "entryFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kishLevel" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "kishSystemId" TEXT,
ADD COLUMN     "minScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pendingTaxRate" INTEGER,
ADD COLUMN     "recruitment" "SyndicateRecruitment" NOT NULL DEFAULT 'APPLICATION',
ADD COLUMN     "taxEffectiveAt" TIMESTAMP(3),
ADD COLUMN     "taxRate" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "syndicate_transactions" ADD COLUMN     "actorId" TEXT;

-- AlterTable
ALTER TABLE "syndicate_applications" ADD COLUMN     "codexVersionId" TEXT;

-- CreateTable
CREATE TABLE "syndicate_ranks" (
    "id" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "permissions" "SyndicatePermission"[],
    "dailyWithdrawLimit" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syndicate_ranks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syndicate_codex_versions" (
    "id" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syndicate_codex_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syndicate_tax_ledger" (
    "id" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "commanderId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "syndicate_tax_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "syndicate_ranks_syndicateId_name_key" ON "syndicate_ranks"("syndicateId", "name");

-- CreateIndex
CREATE INDEX "syndicate_codex_versions_syndicateId_createdAt_idx" ON "syndicate_codex_versions"("syndicateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "syndicate_tax_ledger_syndicateId_commanderId_day_key" ON "syndicate_tax_ledger"("syndicateId", "commanderId", "day");

-- AddForeignKey
ALTER TABLE "commanders" ADD CONSTRAINT "commanders_syndicateRankId_fkey" FOREIGN KEY ("syndicateRankId") REFERENCES "syndicate_ranks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicates" ADD CONSTRAINT "syndicates_kishSystemId_fkey" FOREIGN KEY ("kishSystemId") REFERENCES "solar_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_transactions" ADD CONSTRAINT "syndicate_transactions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "commanders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_ranks" ADD CONSTRAINT "syndicate_ranks_syndicateId_fkey" FOREIGN KEY ("syndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_codex_versions" ADD CONSTRAINT "syndicate_codex_versions_syndicateId_fkey" FOREIGN KEY ("syndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_codex_versions" ADD CONSTRAINT "syndicate_codex_versions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "commanders"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "SyndicateTechType" AS ENUM ('MINING', 'CONSTRUCTION', 'CARGO', 'TRADE', 'VAULT', 'COUNTERINTEL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SyndicateTxKind" ADD VALUE 'ACADEMY_UPGRADE';
ALTER TYPE "SyndicateTxKind" ADD VALUE 'SYNDICATE_RESEARCH';

-- AlterEnum
ALTER TYPE "SyndicatePermission" ADD VALUE 'ACADEMY';

-- AlterTable
ALTER TABLE "syndicates" ADD COLUMN     "academyLevel" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "syndicate_technologies" (
    "id" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "tech" "SyndicateTechType" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "syndicate_technologies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syndicate_research" (
    "id" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "tech" "SyndicateTechType" NOT NULL,
    "targetLevel" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishesAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "syndicate_research_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "syndicate_technologies_syndicateId_tech_key" ON "syndicate_technologies"("syndicateId", "tech");

-- CreateIndex
CREATE UNIQUE INDEX "syndicate_research_syndicateId_key" ON "syndicate_research"("syndicateId");

-- AddForeignKey
ALTER TABLE "syndicate_technologies" ADD CONSTRAINT "syndicate_technologies_syndicateId_fkey" FOREIGN KEY ("syndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_research" ADD CONSTRAINT "syndicate_research_syndicateId_fkey" FOREIGN KEY ("syndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;


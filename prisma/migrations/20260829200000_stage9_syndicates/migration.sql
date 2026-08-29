-- Этап 9: синдикаты, общий банк, заявки и войны альянсов.
-- Новые таблицы и необязательные колонки: существующие данные не затрагиваются.
-- CreateEnum
CREATE TYPE "SyndicateRole" AS ENUM ('LEADER', 'OFFICER', 'MEMBER');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SyndicateTxKind" AS ENUM ('DONATION', 'FOUNDING', 'PAYOUT');

-- AlterTable
ALTER TABLE "commanders" ADD COLUMN     "syndicateId" TEXT,
ADD COLUMN     "syndicateRole" "SyndicateRole";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "lastSeenAt";

-- CreateTable
CREATE TABLE "syndicates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syndicates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syndicate_banks" (
    "id" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "credits" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "syndicate_banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syndicate_transactions" (
    "id" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "commanderId" TEXT,
    "kind" "SyndicateTxKind" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syndicate_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syndicate_applications" (
    "id" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "commanderId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "syndicate_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "syndicate_wars" (
    "id" TEXT NOT NULL,
    "aggressorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "declaredById" TEXT,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "syndicate_wars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "syndicates_name_key" ON "syndicates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "syndicates_tag_key" ON "syndicates"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "syndicates_leaderId_key" ON "syndicates"("leaderId");

-- CreateIndex
CREATE UNIQUE INDEX "syndicate_banks_syndicateId_key" ON "syndicate_banks"("syndicateId");

-- CreateIndex
CREATE INDEX "syndicate_transactions_syndicateId_createdAt_idx" ON "syndicate_transactions"("syndicateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "syndicate_applications_syndicateId_commanderId_key" ON "syndicate_applications"("syndicateId", "commanderId");

-- CreateIndex
CREATE UNIQUE INDEX "syndicate_wars_aggressorId_targetId_key" ON "syndicate_wars"("aggressorId", "targetId");

-- AddForeignKey
ALTER TABLE "commanders" ADD CONSTRAINT "commanders_syndicateId_fkey" FOREIGN KEY ("syndicateId") REFERENCES "syndicates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicates" ADD CONSTRAINT "syndicates_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_banks" ADD CONSTRAINT "syndicate_banks_syndicateId_fkey" FOREIGN KEY ("syndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_transactions" ADD CONSTRAINT "syndicate_transactions_syndicateId_fkey" FOREIGN KEY ("syndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_transactions" ADD CONSTRAINT "syndicate_transactions_commanderId_fkey" FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_applications" ADD CONSTRAINT "syndicate_applications_syndicateId_fkey" FOREIGN KEY ("syndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_applications" ADD CONSTRAINT "syndicate_applications_commanderId_fkey" FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_applications" ADD CONSTRAINT "syndicate_applications_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "commanders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_wars" ADD CONSTRAINT "syndicate_wars_aggressorId_fkey" FOREIGN KEY ("aggressorId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_wars" ADD CONSTRAINT "syndicate_wars_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "SyndicateModuleKind" AS ENUM ('KISH', 'SKARBNYTSIA', 'AKADEMIIA', 'DOZOR', 'BRAMA');

-- AlterEnum
ALTER TYPE "SyndicateTxKind" ADD VALUE 'BUILD_REFUND';

-- AlterEnum
ALTER TYPE "SyndicateTechType" ADD VALUE 'ENGINEERING';

-- CreateTable
CREATE TABLE "syndicate_constructions" (
    "id" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "module" "SyndicateModuleKind" NOT NULL,
    "systemId" TEXT,
    "targetLevel" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishesAt" TIMESTAMP(3) NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "ore" INTEGER NOT NULL DEFAULT 0,
    "polymers" INTEGER NOT NULL DEFAULT 0,
    "actorId" TEXT,

    CONSTRAINT "syndicate_constructions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "syndicate_constructions_syndicateId_key" ON "syndicate_constructions"("syndicateId");

-- CreateIndex
CREATE INDEX "syndicate_constructions_finishesAt_idx" ON "syndicate_constructions"("finishesAt");

-- AddForeignKey
ALTER TABLE "syndicate_constructions" ADD CONSTRAINT "syndicate_constructions_syndicateId_fkey" FOREIGN KEY ("syndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;


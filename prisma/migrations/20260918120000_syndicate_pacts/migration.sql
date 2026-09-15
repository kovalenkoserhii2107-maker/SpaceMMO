-- CreateEnum
CREATE TYPE "PactType" AS ENUM ('NON_AGGRESSION', 'ALLIANCE', 'TRADE');

-- CreateEnum
CREATE TYPE "PactStatus" AS ENUM ('PROPOSED', 'ACTIVE');

-- CreateTable
CREATE TABLE "syndicate_pacts" (
    "id" TEXT NOT NULL,
    "firstSyndicateId" TEXT NOT NULL,
    "secondSyndicateId" TEXT NOT NULL,
    "type" "PactType" NOT NULL,
    "status" "PactStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposerSyndicateId" TEXT NOT NULL,
    "proposedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "syndicate_pacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "syndicate_pacts_secondSyndicateId_idx" ON "syndicate_pacts"("secondSyndicateId");

-- CreateIndex
CREATE UNIQUE INDEX "syndicate_pacts_firstSyndicateId_secondSyndicateId_type_key" ON "syndicate_pacts"("firstSyndicateId", "secondSyndicateId", "type");

-- AddForeignKey
ALTER TABLE "syndicate_pacts" ADD CONSTRAINT "syndicate_pacts_firstSyndicateId_fkey" FOREIGN KEY ("firstSyndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "syndicate_pacts" ADD CONSTRAINT "syndicate_pacts_secondSyndicateId_fkey" FOREIGN KEY ("secondSyndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;


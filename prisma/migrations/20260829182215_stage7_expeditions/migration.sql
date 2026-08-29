-- CreateEnum
CREATE TYPE "ExpeditionOutcome" AS ENUM ('SILENCE', 'RESOURCES', 'PIRATES_WON', 'PIRATES_LOST', 'EVADED');

-- AlterEnum
ALTER TYPE "FleetMission" ADD VALUE 'EXPEDITION';

-- AlterEnum
ALTER TYPE "TechnologyType" ADD VALUE 'ASTROPHYSICS';

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "cargoAntimatter" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "targetSystemId" TEXT;

-- CreateTable
CREATE TABLE "expedition_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "outcome" "ExpeditionOutcome" NOT NULL,
    "lootMetal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lootCrystal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lootAntimatter" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expedition_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expedition_reports_userId_createdAt_idx" ON "expedition_reports"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "expedition_reports" ADD CONSTRAINT "expedition_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedition_reports" ADD CONSTRAINT "expedition_reports_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "solar_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_targetSystemId_fkey" FOREIGN KEY ("targetSystemId") REFERENCES "solar_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

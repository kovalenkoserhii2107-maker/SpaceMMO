-- CreateEnum
CREATE TYPE "FleetMission" AS ENUM ('TRANSPORT', 'SCAN');

-- CreateEnum
CREATE TYPE "FleetStatus" AS ENUM ('OUTBOUND', 'RETURNING');

-- CreateTable
CREATE TABLE "fleets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originBaseId" TEXT NOT NULL,
    "originPlanetId" TEXT NOT NULL,
    "targetPlanetId" TEXT NOT NULL,
    "mission" "FleetMission" NOT NULL,
    "status" "FleetStatus" NOT NULL DEFAULT 'OUTBOUND',
    "probes" INTEGER NOT NULL DEFAULT 0,
    "transporters" INTEGER NOT NULL DEFAULT 0,
    "lightFighters" INTEGER NOT NULL DEFAULT 0,
    "cargoMetal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cargoCrystal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fuelSpent" DOUBLE PRECISION NOT NULL,
    "distance" INTEGER NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "departedAt" TIMESTAMP(3) NOT NULL,
    "arrivesAt" TIMESTAMP(3) NOT NULL,
    "returnsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planet_scans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,

    CONSTRAINT "planet_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fleets_status_arrivesAt_idx" ON "fleets"("status", "arrivesAt");

-- CreateIndex
CREATE INDEX "fleets_status_returnsAt_idx" ON "fleets"("status", "returnsAt");

-- CreateIndex
CREATE INDEX "fleets_userId_idx" ON "fleets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "planet_scans_userId_planetId_key" ON "planet_scans"("userId", "planetId");

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_originBaseId_fkey" FOREIGN KEY ("originBaseId") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_originPlanetId_fkey" FOREIGN KEY ("originPlanetId") REFERENCES "planets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_targetPlanetId_fkey" FOREIGN KEY ("targetPlanetId") REFERENCES "planets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planet_scans" ADD CONSTRAINT "planet_scans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planet_scans" ADD CONSTRAINT "planet_scans_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "planets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

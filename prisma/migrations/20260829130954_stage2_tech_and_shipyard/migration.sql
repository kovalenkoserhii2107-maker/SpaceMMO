-- CreateEnum
CREATE TYPE "BuildingType" AS ENUM ('METAL_MINE', 'CRYSTAL_MINE', 'DEUTERIUM_MINE', 'SOLAR_PLANT', 'RESEARCH_LAB', 'SHIPYARD');

-- CreateEnum
CREATE TYPE "TechnologyType" AS ENUM ('ENERGY_TECH', 'COMPUTING_TECH', 'MINING_TECH', 'COMBUSTION_DRIVE');

-- CreateEnum
CREATE TYPE "ShipType" AS ENUM ('PROBE', 'TRANSPORTER', 'LIGHT_FIGHTER');

-- AlterTable
ALTER TABLE "bases" ADD COLUMN     "researchLabLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shipyardLevel" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "build_jobs" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "building" "BuildingType" NOT NULL,
    "targetLevel" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishesAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "build_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "researches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tech" "TechnologyType" NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "researches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "tech" "TechnologyType" NOT NULL,
    "targetLevel" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishesAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ships" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "type" "ShipType" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ship_jobs" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "type" "ShipType" NOT NULL,
    "remaining" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitSeconds" DOUBLE PRECISION NOT NULL,
    "nextUnitAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ship_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "build_jobs_baseId_key" ON "build_jobs"("baseId");

-- CreateIndex
CREATE UNIQUE INDEX "researches_userId_tech_key" ON "researches"("userId", "tech");

-- CreateIndex
CREATE UNIQUE INDEX "research_jobs_userId_key" ON "research_jobs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "research_jobs_baseId_key" ON "research_jobs"("baseId");

-- CreateIndex
CREATE UNIQUE INDEX "ships_baseId_type_key" ON "ships"("baseId", "type");

-- CreateIndex
CREATE INDEX "ship_jobs_baseId_createdAt_idx" ON "ship_jobs"("baseId", "createdAt");

-- AddForeignKey
ALTER TABLE "build_jobs" ADD CONSTRAINT "build_jobs_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "researches" ADD CONSTRAINT "researches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ships" ADD CONSTRAINT "ships_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ship_jobs" ADD CONSTRAINT "ship_jobs_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

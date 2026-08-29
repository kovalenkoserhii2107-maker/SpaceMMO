-- CreateEnum
CREATE TYPE "DefenseType" AS ENUM ('ROCKET_LAUNCHER', 'LASER_TURRET');

-- CreateEnum
CREATE TYPE "BattleWinner" AS ENUM ('ATTACKER', 'DEFENDER');

-- AlterEnum
ALTER TYPE "FleetMission" ADD VALUE 'ATTACK';

-- CreateTable
CREATE TABLE "defenses" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "type" "DefenseType" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "defenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defense_jobs" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "type" "DefenseType" NOT NULL,
    "remaining" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitSeconds" DOUBLE PRECISION NOT NULL,
    "nextUnitAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "defense_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_reports" (
    "id" TEXT NOT NULL,
    "attackerId" TEXT NOT NULL,
    "defenderId" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "winner" "BattleWinner" NOT NULL,
    "plunderMetal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plunderCrystal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "war_declarations" (
    "id" TEXT NOT NULL,
    "aggressorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "war_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "defenses_baseId_type_key" ON "defenses"("baseId", "type");

-- CreateIndex
CREATE INDEX "defense_jobs_baseId_createdAt_idx" ON "defense_jobs"("baseId", "createdAt");

-- CreateIndex
CREATE INDEX "battle_reports_attackerId_createdAt_idx" ON "battle_reports"("attackerId", "createdAt");

-- CreateIndex
CREATE INDEX "battle_reports_defenderId_createdAt_idx" ON "battle_reports"("defenderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "war_declarations_aggressorId_targetId_key" ON "war_declarations"("aggressorId", "targetId");

-- AddForeignKey
ALTER TABLE "defenses" ADD CONSTRAINT "defenses_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "defense_jobs" ADD CONSTRAINT "defense_jobs_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_reports" ADD CONSTRAINT "battle_reports_attackerId_fkey" FOREIGN KEY ("attackerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_reports" ADD CONSTRAINT "battle_reports_defenderId_fkey" FOREIGN KEY ("defenderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_reports" ADD CONSTRAINT "battle_reports_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "planets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "war_declarations" ADD CONSTRAINT "war_declarations_aggressorId_fkey" FOREIGN KEY ("aggressorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "war_declarations" ADD CONSTRAINT "war_declarations_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

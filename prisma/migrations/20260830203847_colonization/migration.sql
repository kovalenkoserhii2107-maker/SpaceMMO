-- AlterEnum
ALTER TYPE "FleetMission" ADD VALUE 'COLONIZE';

-- AlterEnum
ALTER TYPE "ShipType" ADD VALUE 'COLONY_SHIP';

-- AlterTable
ALTER TABLE "fleet_templates" ADD COLUMN     "colonyShips" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "colonyShips" INTEGER NOT NULL DEFAULT 0;

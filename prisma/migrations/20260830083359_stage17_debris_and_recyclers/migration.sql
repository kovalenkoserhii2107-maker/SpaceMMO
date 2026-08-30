-- AlterEnum
ALTER TYPE "FleetMission" ADD VALUE 'HARVEST';

-- AlterEnum
ALTER TYPE "ShipType" ADD VALUE 'RECYCLER';

-- AlterTable
ALTER TABLE "fleet_templates" ADD COLUMN     "recyclers" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "recyclers" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "planets" ADD COLUMN     "debrisSilicate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "debrisTitanite" DOUBLE PRECISION NOT NULL DEFAULT 0;

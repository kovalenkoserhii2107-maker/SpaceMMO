-- AlterEnum
ALTER TYPE "FleetMission" ADD VALUE 'HOLD';

-- AlterEnum
ALTER TYPE "FleetStatus" ADD VALUE 'HOLDING';

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "holdSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "holdUntil" TIMESTAMP(3);


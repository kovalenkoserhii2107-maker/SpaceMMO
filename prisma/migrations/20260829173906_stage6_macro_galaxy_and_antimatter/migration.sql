-- CreateEnum
CREATE TYPE "SystemAnomaly" AS ENUM ('NONE', 'BLACK_HOLE');

-- AlterEnum
ALTER TYPE "BuildingType" ADD VALUE 'ANTIMATTER_SYNTH';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TechnologyType" ADD VALUE 'HYPERSPACE_PHYSICS';
ALTER TYPE "TechnologyType" ADD VALUE 'HYPERDRIVE';

-- AlterTable
ALTER TABLE "bases" ADD COLUMN     "antimatter" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "antimatterSynthLevel" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "antimatterSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "interstellar" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "planets" ADD COLUMN     "antimatterRichness" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "solar_systems" ADD COLUMN     "anomaly" "SystemAnomaly" NOT NULL DEFAULT 'NONE';

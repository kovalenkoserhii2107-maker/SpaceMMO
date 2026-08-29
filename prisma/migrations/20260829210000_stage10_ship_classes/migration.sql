-- Этап 10: новые классы кораблей под типы урона.
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShipType" ADD VALUE 'HEAVY_CRUISER';
ALTER TYPE "ShipType" ADD VALUE 'ION_FRIGATE';

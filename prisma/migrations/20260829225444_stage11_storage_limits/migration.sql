-- AlterEnum
ALTER TYPE "BuildingType" ADD VALUE 'STORAGE';

-- AlterTable
ALTER TABLE "bases" ADD COLUMN     "storageLevel" INTEGER NOT NULL DEFAULT 0;

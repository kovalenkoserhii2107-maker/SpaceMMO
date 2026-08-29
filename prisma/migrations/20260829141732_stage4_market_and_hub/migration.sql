-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "TradeResource" AS ENUM ('METAL', 'CRYSTAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FleetMission" ADD VALUE 'HUB_DELIVERY';
ALTER TYPE "FleetMission" ADD VALUE 'HUB_PICKUP';

-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "pickupCrystal" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "pickupMetal" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "targetHubId" TEXT,
ALTER COLUMN "targetPlanetId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "credits" DOUBLE PRECISION NOT NULL DEFAULT 1000;

-- CreateTable
CREATE TABLE "trade_hubs" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "trade_hubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_storages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "metal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "crystal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "hub_storages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_orders" (
    "id" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "resource" "TradeResource" NOT NULL,
    "pricePerUnit" DOUBLE PRECISION NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "remaining" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "resource" "TradeResource" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "pricePerUnit" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_hubs_systemId_key" ON "trade_hubs"("systemId");

-- CreateIndex
CREATE UNIQUE INDEX "hub_storages_userId_hubId_key" ON "hub_storages"("userId", "hubId");

-- CreateIndex
CREATE INDEX "market_orders_hubId_resource_side_pricePerUnit_idx" ON "market_orders"("hubId", "resource", "side", "pricePerUnit");

-- CreateIndex
CREATE INDEX "trades_hubId_createdAt_idx" ON "trades"("hubId", "createdAt");

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_targetHubId_fkey" FOREIGN KEY ("targetHubId") REFERENCES "trade_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_hubs" ADD CONSTRAINT "trade_hubs_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "solar_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_storages" ADD CONSTRAINT "hub_storages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_storages" ADD CONSTRAINT "hub_storages_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "trade_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "trade_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "trade_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

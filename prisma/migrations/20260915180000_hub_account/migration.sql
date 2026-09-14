-- AlterTable
ALTER TABLE "market_orders" ADD COLUMN     "localPart" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "barter_offers" ADD COLUMN     "localPart" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "hub_accounts" (
    "id" TEXT NOT NULL,
    "commanderId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "ore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "polymers" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "hub_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hub_accounts_commanderId_key" ON "hub_accounts"("commanderId");

-- AddForeignKey
ALTER TABLE "hub_accounts" ADD CONSTRAINT "hub_accounts_commanderId_fkey" FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


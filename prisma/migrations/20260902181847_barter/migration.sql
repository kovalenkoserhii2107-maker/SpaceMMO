-- CreateTable
CREATE TABLE "barter_offers" (
    "id" TEXT NOT NULL,
    "commanderId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "giveResource" "TradeResource" NOT NULL,
    "giveQuantity" DOUBLE PRECISION NOT NULL,
    "wantResource" "TradeResource" NOT NULL,
    "wantQuantity" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barter_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "barter_offers_hubId_createdAt_idx" ON "barter_offers"("hubId", "createdAt");

-- AddForeignKey
ALTER TABLE "barter_offers" ADD CONSTRAINT "barter_offers_commanderId_fkey" FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barter_offers" ADD CONSTRAINT "barter_offers_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "trade_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

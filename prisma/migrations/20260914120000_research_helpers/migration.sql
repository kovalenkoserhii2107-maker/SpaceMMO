-- AlterTable
ALTER TABLE "research_jobs" ADD COLUMN     "labLevel" INTEGER;

-- CreateTable
CREATE TABLE "research_helpers" (
    "id" TEXT NOT NULL,
    "commanderId" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "labLevel" INTEGER NOT NULL,
    "ore" INTEGER NOT NULL,
    "polymers" INTEGER NOT NULL,
    "plasma" INTEGER NOT NULL,
    "savedSeconds" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_helpers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "research_helpers_baseId_key" ON "research_helpers"("baseId");

-- CreateIndex
CREATE INDEX "research_helpers_commanderId_idx" ON "research_helpers"("commanderId");

-- AddForeignKey
ALTER TABLE "research_helpers" ADD CONSTRAINT "research_helpers_commanderId_fkey" FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_helpers" ADD CONSTRAINT "research_helpers_baseId_fkey" FOREIGN KEY ("baseId") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;


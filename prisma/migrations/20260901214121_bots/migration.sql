-- CreateEnum
CREATE TYPE "BotCharacter" AS ENUM ('AGGRESSOR', 'TRADER');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'BOT';

-- CreateTable
CREATE TABLE "bots" (
    "id" TEXT NOT NULL,
    "commanderId" TEXT NOT NULL,
    "character" "BotCharacter" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextDecisionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memory" JSONB NOT NULL DEFAULT '{}',
    "lastAction" TEXT,
    "lastActionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bots_commanderId_key" ON "bots"("commanderId");

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_commanderId_fkey" FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

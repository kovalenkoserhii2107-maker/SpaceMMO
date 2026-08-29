-- CreateEnum
CREATE TYPE "StarClass" AS ENUM ('BLUE', 'WHITE', 'YELLOW', 'ORANGE', 'RED');

-- CreateEnum
CREATE TYPE "PlanetType" AS ENUM ('ROCKY', 'OCEANIC', 'DESERT', 'ICE', 'GAS_GIANT', 'VOLCANIC', 'TOXIC');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solar_systems" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "galaxyX" INTEGER NOT NULL,
    "galaxyY" INTEGER NOT NULL,
    "starClass" "StarClass" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solar_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "PlanetType" NOT NULL,
    "size" INTEGER NOT NULL,
    "metalRichness" DOUBLE PRECISION NOT NULL,
    "crystalRichness" DOUBLE PRECISION NOT NULL,
    "deuteriumRichness" DOUBLE PRECISION NOT NULL,
    "energyRichness" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "planets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bases" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planetId" TEXT NOT NULL,
    "metal" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "crystal" DOUBLE PRECISION NOT NULL DEFAULT 300,
    "deuterium" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "metalMineLevel" INTEGER NOT NULL DEFAULT 0,
    "crystalMineLevel" INTEGER NOT NULL DEFAULT 0,
    "deuteriumMineLevel" INTEGER NOT NULL DEFAULT 0,
    "solarPlantLevel" INTEGER NOT NULL DEFAULT 0,
    "lastTickAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_sessionToken_key" ON "users"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "solar_systems_name_key" ON "solar_systems"("name");

-- CreateIndex
CREATE UNIQUE INDEX "solar_systems_galaxyX_galaxyY_key" ON "solar_systems"("galaxyX", "galaxyY");

-- CreateIndex
CREATE INDEX "planets_systemId_idx" ON "planets"("systemId");

-- CreateIndex
CREATE UNIQUE INDEX "planets_systemId_position_key" ON "planets"("systemId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "bases_planetId_key" ON "bases"("planetId");

-- CreateIndex
CREATE INDEX "bases_userId_idx" ON "bases"("userId");

-- AddForeignKey
ALTER TABLE "planets" ADD CONSTRAINT "planets_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "solar_systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bases" ADD CONSTRAINT "bases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bases" ADD CONSTRAINT "bases_planetId_fkey" FOREIGN KEY ("planetId") REFERENCES "planets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

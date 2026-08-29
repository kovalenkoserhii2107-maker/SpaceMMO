-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "cargoDeuterium" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "fleet_templates" (
    "id" TEXT NOT NULL,
    "commanderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "probes" INTEGER NOT NULL DEFAULT 0,
    "transporters" INTEGER NOT NULL DEFAULT 0,
    "lightFighters" INTEGER NOT NULL DEFAULT 0,
    "heavyCruisers" INTEGER NOT NULL DEFAULT 0,
    "ionFrigates" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleet_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fleet_templates_commanderId_idx" ON "fleet_templates"("commanderId");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_templates_commanderId_name_key" ON "fleet_templates"("commanderId", "name");

-- AddForeignKey
ALTER TABLE "fleet_templates" ADD CONSTRAINT "fleet_templates_commanderId_fkey" FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

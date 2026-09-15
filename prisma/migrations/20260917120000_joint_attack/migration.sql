-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "jointLeadId" TEXT;

-- CreateIndex
CREATE INDEX "fleets_jointLeadId_idx" ON "fleets"("jointLeadId");

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_jointLeadId_fkey" FOREIGN KEY ("jointLeadId") REFERENCES "fleets"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "GateRequestKind" AS ENUM ('TOLL', 'LEASE');

-- CreateTable
CREATE TABLE "gate_access_requests" (
    "id" TEXT NOT NULL,
    "ownerSyndicateId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "kind" "GateRequestKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declinedAt" TIMESTAMP(3),

    CONSTRAINT "gate_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gate_access_requests_requesterId_idx" ON "gate_access_requests"("requesterId");

-- CreateIndex
CREATE UNIQUE INDEX "gate_access_requests_ownerSyndicateId_requesterId_key" ON "gate_access_requests"("ownerSyndicateId", "requesterId");

-- AddForeignKey
ALTER TABLE "gate_access_requests" ADD CONSTRAINT "gate_access_requests_ownerSyndicateId_fkey" FOREIGN KEY ("ownerSyndicateId") REFERENCES "syndicates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_access_requests" ADD CONSTRAINT "gate_access_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

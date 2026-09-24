-- AlterEnum
ALTER TYPE "FleetMission" ADD VALUE 'GATE_SIEGE';

-- AlterEnum
ALTER TYPE "SyndicatePermission" ADD VALUE 'GATES';

-- AlterEnum
ALTER TYPE "SyndicateTxKind" ADD VALUE 'GATE_TOLL';

-- AlterTable
ALTER TABLE "syndicate_gates" ADD COLUMN     "disabledUntil" TIMESTAMP(3),
ADD COLUMN     "siegeImmuneUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "syndicates" ADD COLUMN     "gateToll" INTEGER;

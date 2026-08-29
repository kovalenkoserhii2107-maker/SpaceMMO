-- Этап 10: колонки под новые классы кораблей во флоте.
-- AlterTable
ALTER TABLE "fleets" ADD COLUMN     "heavyCruisers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ionFrigates" INTEGER NOT NULL DEFAULT 0;

-- Расширение арсенала: 12 классов кораблей и 5 классов обороны.
--
-- Миграция написана вручную, потому что сгенерированная уничтожила бы данные.
-- Prisma пересоздает enum с приведением через text (`type::text::ShipType_new`),
-- и первая же строка со старым значением уронила бы миграцию, а колонки флота
-- она сносит через DROP COLUMN + ADD COLUMN — вместе с каждым флотом в полете
-- и каждым сохраненным шаблоном. Здесь и значения, и колонки переименованы.

-- Значения enum переименовываются на месте: строки в ships/ship_jobs
-- и defenses/defense_jobs продолжают ссылаться на них без единого UPDATE.
ALTER TYPE "ShipType" RENAME VALUE 'TRANSPORTER' TO 'SMALL_CARGO';
ALTER TYPE "ShipType" RENAME VALUE 'HEAVY_CRUISER' TO 'CRUISER';
ALTER TYPE "ShipType" RENAME VALUE 'ION_FRIGATE' TO 'FRIGATE';

-- Позиции заданы явно, чтобы порядок значений в БД совпал с порядком
-- в schema.prisma: иначе Prisma будет каждый раз видеть дрейф схемы.
ALTER TYPE "ShipType" ADD VALUE 'LARGE_CARGO' AFTER 'SMALL_CARGO';
ALTER TYPE "ShipType" ADD VALUE 'HEAVY_FIGHTER' AFTER 'LIGHT_FIGHTER';
ALTER TYPE "ShipType" ADD VALUE 'BOMBER' AFTER 'FRIGATE';
ALTER TYPE "ShipType" ADD VALUE 'BATTLESHIP' AFTER 'BOMBER';
ALTER TYPE "ShipType" ADD VALUE 'CARRIER' AFTER 'BATTLESHIP';

ALTER TYPE "DefenseType" RENAME VALUE 'CANNON_TURRET' TO 'CANNON';
ALTER TYPE "DefenseType" RENAME VALUE 'LASER_TURRET' TO 'LASER';
ALTER TYPE "DefenseType" ADD VALUE 'GAUSS' AFTER 'LASER';
ALTER TYPE "DefenseType" ADD VALUE 'PLASMA' AFTER 'GAUSS';
ALTER TYPE "DefenseType" ADD VALUE 'SUPER_WEAPON' AFTER 'PLASMA';

-- Колонки состава флота: переименование сохраняет корабли, DROP+ADD стер бы их.
ALTER TABLE "fleets" RENAME COLUMN "transporters" TO "smallCargo";
ALTER TABLE "fleets" RENAME COLUMN "heavyCruisers" TO "cruisers";
ALTER TABLE "fleets" RENAME COLUMN "ionFrigates" TO "frigates";
ALTER TABLE "fleets" ADD COLUMN "largeCargo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "fleets" ADD COLUMN "heavyFighters" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "fleets" ADD COLUMN "bombers" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "fleets" ADD COLUMN "battleships" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "fleets" ADD COLUMN "carriers" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "fleet_templates" RENAME COLUMN "transporters" TO "smallCargo";
ALTER TABLE "fleet_templates" RENAME COLUMN "heavyCruisers" TO "cruisers";
ALTER TABLE "fleet_templates" RENAME COLUMN "ionFrigates" TO "frigates";
ALTER TABLE "fleet_templates" ADD COLUMN "largeCargo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "fleet_templates" ADD COLUMN "heavyFighters" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "fleet_templates" ADD COLUMN "bombers" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "fleet_templates" ADD COLUMN "battleships" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "fleet_templates" ADD COLUMN "carriers" INTEGER NOT NULL DEFAULT 0;

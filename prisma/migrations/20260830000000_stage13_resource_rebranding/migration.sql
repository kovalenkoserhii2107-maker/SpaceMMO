-- Ребрендинг ресурсов: Металл → Титанит, Кристалл → Силикат,
-- Дейтерий → Тритий, Антиматерия → Эридий.
--
-- Только переименования: RENAME COLUMN и RENAME VALUE атомарны и не трогают
-- данные, поэтому миграция безопасна на заполненной базе. Сгенерированный
-- Prisma вариант сносил бы колонки и терял склады всех колоний.

-- Богатство планет
ALTER TABLE "planets" RENAME COLUMN "metalRichness" TO "titaniteRichness";
ALTER TABLE "planets" RENAME COLUMN "crystalRichness" TO "silicateRichness";
ALTER TABLE "planets" RENAME COLUMN "deuteriumRichness" TO "tritiumRichness";
ALTER TABLE "planets" RENAME COLUMN "antimatterRichness" TO "eridiumRichness";

-- Склад и инфраструктура базы
ALTER TABLE "bases" RENAME COLUMN "metal" TO "titanite";
ALTER TABLE "bases" RENAME COLUMN "crystal" TO "silicate";
ALTER TABLE "bases" RENAME COLUMN "deuterium" TO "tritium";
ALTER TABLE "bases" RENAME COLUMN "antimatter" TO "eridium";
ALTER TABLE "bases" RENAME COLUMN "metalMineLevel" TO "titaniteMineLevel";
ALTER TABLE "bases" RENAME COLUMN "crystalMineLevel" TO "silicateMineLevel";
ALTER TABLE "bases" RENAME COLUMN "deuteriumMineLevel" TO "tritiumMineLevel";
ALTER TABLE "bases" RENAME COLUMN "antimatterSynthLevel" TO "eridiumSynthLevel";

-- Грузы и топливо флота
ALTER TABLE "fleets" RENAME COLUMN "cargoMetal" TO "cargoTitanite";
ALTER TABLE "fleets" RENAME COLUMN "cargoCrystal" TO "cargoSilicate";
ALTER TABLE "fleets" RENAME COLUMN "cargoDeuterium" TO "cargoTritium";
ALTER TABLE "fleets" RENAME COLUMN "cargoAntimatter" TO "cargoEridium";
ALTER TABLE "fleets" RENAME COLUMN "pickupMetal" TO "pickupTitanite";
ALTER TABLE "fleets" RENAME COLUMN "pickupCrystal" TO "pickupSilicate";
ALTER TABLE "fleets" RENAME COLUMN "antimatterSpent" TO "eridiumSpent";

-- Трофеи боев и экспедиций
ALTER TABLE "battle_reports" RENAME COLUMN "plunderMetal" TO "plunderTitanite";
ALTER TABLE "battle_reports" RENAME COLUMN "plunderCrystal" TO "plunderSilicate";
ALTER TABLE "battle_reports" RENAME COLUMN "plunderDeuterium" TO "plunderTritium";
ALTER TABLE "expedition_reports" RENAME COLUMN "lootMetal" TO "lootTitanite";
ALTER TABLE "expedition_reports" RENAME COLUMN "lootCrystal" TO "lootSilicate";
ALTER TABLE "expedition_reports" RENAME COLUMN "lootAntimatter" TO "lootEridium";

-- Склады на торговом хабе
ALTER TABLE "hub_storages" RENAME COLUMN "metal" TO "titanite";
ALTER TABLE "hub_storages" RENAME COLUMN "crystal" TO "silicate";

-- Перечисления: значения переименовываются на месте, ордера и стройки остаются валидными
ALTER TYPE "TradeResource" RENAME VALUE 'METAL' TO 'TITANITE';
ALTER TYPE "TradeResource" RENAME VALUE 'CRYSTAL' TO 'SILICATE';
ALTER TYPE "BuildingType" RENAME VALUE 'METAL_MINE' TO 'TITANITE_MINE';
ALTER TYPE "BuildingType" RENAME VALUE 'CRYSTAL_MINE' TO 'SILICATE_MINE';
ALTER TYPE "BuildingType" RENAME VALUE 'DEUTERIUM_MINE' TO 'TRITIUM_MINE';
ALTER TYPE "BuildingType" RENAME VALUE 'ANTIMATTER_SYNTH' TO 'ERIDIUM_SYNTH';

-- Финальная номенклатура: Титанит → Руда, Силикат → Полимеры,
-- Тритий → Плазма, Эридий → Антиматерия.
--
-- Только переименования. RENAME COLUMN и RENAME VALUE атомарны и не трогают
-- данные, поэтому накопленные ресурсы, уровни зданий и открытые ордера
-- переживают миграцию. Сгенерированный Prisma вариант снес бы колонки.

-- Богатство планет и поля обломков
ALTER TABLE "planets" RENAME COLUMN "titaniteRichness" TO "oreRichness";
ALTER TABLE "planets" RENAME COLUMN "silicateRichness" TO "polymersRichness";
ALTER TABLE "planets" RENAME COLUMN "tritiumRichness" TO "plasmaRichness";
ALTER TABLE "planets" RENAME COLUMN "eridiumRichness" TO "antimatterRichness";
ALTER TABLE "planets" RENAME COLUMN "debrisTitanite" TO "debrisOre";
ALTER TABLE "planets" RENAME COLUMN "debrisSilicate" TO "debrisPolymers";

-- Склад и инфраструктура базы
ALTER TABLE "bases" RENAME COLUMN "titanite" TO "ore";
ALTER TABLE "bases" RENAME COLUMN "silicate" TO "polymers";
ALTER TABLE "bases" RENAME COLUMN "tritium" TO "plasma";
ALTER TABLE "bases" RENAME COLUMN "eridium" TO "antimatter";
ALTER TABLE "bases" RENAME COLUMN "titaniteMineLevel" TO "oreMineLevel";
ALTER TABLE "bases" RENAME COLUMN "silicateMineLevel" TO "polymerPlantLevel";
ALTER TABLE "bases" RENAME COLUMN "tritiumMineLevel" TO "plasmaReactorLevel";
ALTER TABLE "bases" RENAME COLUMN "solarPlantLevel" TO "powerPlantLevel";
ALTER TABLE "bases" RENAME COLUMN "researchLabLevel" TO "scienceCenterLevel";
ALTER TABLE "bases" RENAME COLUMN "eridiumSynthLevel" TO "antimatterFactoryLevel";

-- Грузы и топливо флота
ALTER TABLE "fleets" RENAME COLUMN "cargoTitanite" TO "cargoOre";
ALTER TABLE "fleets" RENAME COLUMN "cargoSilicate" TO "cargoPolymers";
ALTER TABLE "fleets" RENAME COLUMN "cargoTritium" TO "cargoPlasma";
ALTER TABLE "fleets" RENAME COLUMN "cargoEridium" TO "cargoAntimatter";
ALTER TABLE "fleets" RENAME COLUMN "pickupTitanite" TO "pickupOre";
ALTER TABLE "fleets" RENAME COLUMN "pickupSilicate" TO "pickupPolymers";
ALTER TABLE "fleets" RENAME COLUMN "eridiumSpent" TO "antimatterSpent";

-- Трофеи боев и экспедиций
ALTER TABLE "battle_reports" RENAME COLUMN "plunderTitanite" TO "plunderOre";
ALTER TABLE "battle_reports" RENAME COLUMN "plunderSilicate" TO "plunderPolymers";
ALTER TABLE "battle_reports" RENAME COLUMN "plunderTritium" TO "plunderPlasma";
ALTER TABLE "expedition_reports" RENAME COLUMN "lootTitanite" TO "lootOre";
ALTER TABLE "expedition_reports" RENAME COLUMN "lootSilicate" TO "lootPolymers";
ALTER TABLE "expedition_reports" RENAME COLUMN "lootEridium" TO "lootAntimatter";

-- Склады на торговом хабе
ALTER TABLE "hub_storages" RENAME COLUMN "titanite" TO "ore";
ALTER TABLE "hub_storages" RENAME COLUMN "silicate" TO "polymers";

-- Перечисления: значения меняются на месте, поэтому открытые ордера,
-- активные стройки и позиции обороны остаются валидными
ALTER TYPE "TradeResource" RENAME VALUE 'TITANITE' TO 'ORE';
ALTER TYPE "TradeResource" RENAME VALUE 'SILICATE' TO 'POLYMERS';
ALTER TYPE "BuildingType" RENAME VALUE 'TITANITE_MINE' TO 'ORE_MINE';
ALTER TYPE "BuildingType" RENAME VALUE 'SILICATE_MINE' TO 'POLYMER_PLANT';
ALTER TYPE "BuildingType" RENAME VALUE 'TRITIUM_MINE' TO 'PLASMA_REACTOR';
ALTER TYPE "BuildingType" RENAME VALUE 'SOLAR_PLANT' TO 'POWER_PLANT';
ALTER TYPE "BuildingType" RENAME VALUE 'RESEARCH_LAB' TO 'SCIENCE_CENTER';
ALTER TYPE "BuildingType" RENAME VALUE 'ERIDIUM_SYNTH' TO 'ANTIMATTER_FACTORY';
ALTER TYPE "DefenseType" RENAME VALUE 'ROCKET_LAUNCHER' TO 'CANNON_TURRET';

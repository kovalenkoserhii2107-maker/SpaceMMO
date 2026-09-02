-- Раздельные склады: у каждого ресурса свой лимит и свой уровень.
--
-- Общий лимит создавал тупик без выхода: обильный ресурс вытеснял дефицитный,
-- на полном складе добыча вставала сразу по всем трем, и дефицитный уже
-- не мог появиться никогда.
--
-- Миграция написана руками. Сгенерированная пересоздала бы enum через
-- USING type::text и удалила колонку с уровнем — переименование сохраняет
-- и уровни баз, и ссылки на STORAGE в незавершенных очередях стройки.

-- Старое значение становится рудным складом: все ссылки на него переезжают сами.
ALTER TYPE "BuildingType" RENAME VALUE 'STORAGE' TO 'ORE_STORAGE';
ALTER TYPE "BuildingType" ADD VALUE 'POLYMER_STORAGE';
ALTER TYPE "BuildingType" ADD VALUE 'PLASMA_STORAGE';

ALTER TABLE "bases" RENAME COLUMN "storageLevel" TO "oreStorageLevel";
ALTER TABLE "bases" ADD COLUMN "polymerStorageLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bases" ADD COLUMN "plasmaStorageLevel" INTEGER NOT NULL DEFAULT 0;

-- Никто не должен потерять вместимость: уже построенный склад засчитывается
-- всем трем ресурсам разом.
UPDATE "bases"
SET "polymerStorageLevel" = "oreStorageLevel",
    "plasmaStorageLevel" = "oreStorageLevel";

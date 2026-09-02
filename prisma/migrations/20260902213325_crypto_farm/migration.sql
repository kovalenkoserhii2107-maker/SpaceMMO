-- Майнинг криптогривны: ферма и технология под нее.
--
-- Написано руками: сгенерированная миграция пересоздала бы оба enum через
-- USING type::text и потеряла бы и уровни зданий, и изученные технологии.
-- ADD VALUE дописывает значение, не трогая существующие строки.
ALTER TYPE "BuildingType" ADD VALUE 'CRYPTO_FARM';
ALTER TYPE "TechnologyType" ADD VALUE 'CRYPTO_TECH';

ALTER TABLE "bases" ADD COLUMN "cryptoFarmLevel" INTEGER NOT NULL DEFAULT 0;

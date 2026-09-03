-- «Бункерование»: новое значение в enum технологий.
--
-- Именно ALTER TYPE ADD VALUE, а не пересоздание enum, которое генерирует
-- prisma migrate: пересоздание идет через USING type::text и уносит с собой
-- строки таблицы researches вместе со всей наукой игроков.
ALTER TYPE "TechnologyType" ADD VALUE IF NOT EXISTS 'VAULT_TECH';

-- «Шпионаж»: новое значение в enum технологий.
--
-- ALTER TYPE ADD VALUE, а не пересоздание enum: пересоздание идет через
-- USING type::text и уносит с собой всю науку игроков.
ALTER TYPE "TechnologyType" ADD VALUE IF NOT EXISTS 'ESPIONAGE';

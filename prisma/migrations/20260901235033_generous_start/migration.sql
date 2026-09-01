-- Щедрый стартовый запас: первый час игрок должен строить, а не ждать,
-- пока накопится на первую шахту. Затрагивает только новые колонии.
ALTER TABLE "bases" ALTER COLUMN "ore" SET DEFAULT 1500;
ALTER TABLE "bases" ALTER COLUMN "polymers" SET DEFAULT 800;
ALTER TABLE "bases" ALTER COLUMN "plasma" SET DEFAULT 400;

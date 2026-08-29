-- Этап 8: разделение учетной записи и игровой личности.
--
-- Ключевой прием миграции: Commander.id берется РАВНЫМ старому users.id.
-- Благодаря этому все внешние ключи игровых таблиц остаются валидными —
-- достаточно переименовать колонку userId в commanderId и перевесить связь
-- на новую таблицу. Данные Фаз 1-2 (базы, флоты, биржа, бои) не теряются.

-- 1. Новые перечисления и таблицы
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'GOOGLE', 'APPLE', 'FACEBOOK');

CREATE TABLE "commanders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "avatarId" TEXT NOT NULL DEFAULT 'nova',
    "credits" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "battlesWon" INTEGER NOT NULL DEFAULT 0,
    "battlesLost" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commanders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '★',
    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commander_achievements" (
    "id" TEXT NOT NULL,
    "commanderId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commander_achievements_pkey" PRIMARY KEY ("id")
);

-- 2. Переносим игровую личность из users в commanders, сохраняя идентификатор
INSERT INTO "commanders" ("id", "userId", "nickname", "credits", "createdAt", "lastSeenAt")
SELECT "id", "id", "username", "credits", "createdAt", "lastSeenAt" FROM "users";

-- 3. users превращается в учетную запись
ALTER TABLE "users" ADD COLUMN "email" TEXT;
ALTER TABLE "users" ADD COLUMN "authProvider" "AuthProvider" NOT NULL DEFAULT 'LOCAL';
ALTER TABLE "users" ADD COLUMN "providerId" TEXT;
ALTER TABLE "users" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "users" ADD COLUMN "passwordResetToken" TEXT;
ALTER TABLE "users" ADD COLUMN "passwordResetExpires" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- Легаси-аккаунтам выдаем служебный email; пароль задается скриптом npm run legacy:password
UPDATE "users" SET "email" = lower("id") || '@legacy.local' WHERE "email" IS NULL;
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;

DROP INDEX IF EXISTS "users_username_key";
DROP INDEX IF EXISTS "users_sessionToken_key";
ALTER TABLE "users" DROP COLUMN "username";
ALTER TABLE "users" DROP COLUMN "sessionToken";
ALTER TABLE "users" DROP COLUMN "credits";

-- 4. Игровые таблицы переезжают на commanders
ALTER TABLE "bases" DROP CONSTRAINT "bases_userId_fkey";
ALTER TABLE "bases" RENAME COLUMN "userId" TO "commanderId";
DROP INDEX IF EXISTS "bases_userId_idx";

ALTER TABLE "researches" DROP CONSTRAINT "researches_userId_fkey";
ALTER TABLE "researches" RENAME COLUMN "userId" TO "commanderId";
DROP INDEX IF EXISTS "researches_userId_tech_key";

ALTER TABLE "research_jobs" DROP CONSTRAINT "research_jobs_userId_fkey";
ALTER TABLE "research_jobs" RENAME COLUMN "userId" TO "commanderId";
DROP INDEX IF EXISTS "research_jobs_userId_key";

ALTER TABLE "fleets" DROP CONSTRAINT "fleets_userId_fkey";
ALTER TABLE "fleets" RENAME COLUMN "userId" TO "commanderId";
DROP INDEX IF EXISTS "fleets_userId_idx";

ALTER TABLE "planet_scans" DROP CONSTRAINT "planet_scans_userId_fkey";
ALTER TABLE "planet_scans" RENAME COLUMN "userId" TO "commanderId";
DROP INDEX IF EXISTS "planet_scans_userId_planetId_key";

ALTER TABLE "hub_storages" DROP CONSTRAINT "hub_storages_userId_fkey";
ALTER TABLE "hub_storages" RENAME COLUMN "userId" TO "commanderId";
DROP INDEX IF EXISTS "hub_storages_userId_hubId_key";

ALTER TABLE "market_orders" DROP CONSTRAINT "market_orders_userId_fkey";
ALTER TABLE "market_orders" RENAME COLUMN "userId" TO "commanderId";

ALTER TABLE "expedition_reports" DROP CONSTRAINT "expedition_reports_userId_fkey";
ALTER TABLE "expedition_reports" RENAME COLUMN "userId" TO "commanderId";
DROP INDEX IF EXISTS "expedition_reports_userId_createdAt_idx";

ALTER TABLE "trades" DROP CONSTRAINT "trades_buyerId_fkey";
ALTER TABLE "trades" DROP CONSTRAINT "trades_sellerId_fkey";
ALTER TABLE "battle_reports" DROP CONSTRAINT "battle_reports_attackerId_fkey";
ALTER TABLE "battle_reports" DROP CONSTRAINT "battle_reports_defenderId_fkey";
ALTER TABLE "war_declarations" DROP CONSTRAINT "war_declarations_aggressorId_fkey";
ALTER TABLE "war_declarations" DROP CONSTRAINT "war_declarations_targetId_fkey";

-- 5. Индексы и связи новой схемы
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_passwordResetToken_key" ON "users"("passwordResetToken");
CREATE UNIQUE INDEX "users_authProvider_providerId_key" ON "users"("authProvider", "providerId");

CREATE UNIQUE INDEX "commanders_userId_key" ON "commanders"("userId");
CREATE UNIQUE INDEX "commanders_nickname_key" ON "commanders"("nickname");
CREATE UNIQUE INDEX "achievements_code_key" ON "achievements"("code");
CREATE UNIQUE INDEX "commander_achievements_commanderId_achievementId_key"
    ON "commander_achievements"("commanderId", "achievementId");

CREATE INDEX "bases_commanderId_idx" ON "bases"("commanderId");
CREATE UNIQUE INDEX "researches_commanderId_tech_key" ON "researches"("commanderId", "tech");
CREATE UNIQUE INDEX "research_jobs_commanderId_key" ON "research_jobs"("commanderId");
CREATE INDEX "fleets_commanderId_idx" ON "fleets"("commanderId");
CREATE UNIQUE INDEX "planet_scans_commanderId_planetId_key" ON "planet_scans"("commanderId", "planetId");
CREATE UNIQUE INDEX "hub_storages_commanderId_hubId_key" ON "hub_storages"("commanderId", "hubId");
CREATE INDEX "expedition_reports_commanderId_createdAt_idx"
    ON "expedition_reports"("commanderId", "createdAt");

ALTER TABLE "commanders" ADD CONSTRAINT "commanders_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commander_achievements" ADD CONSTRAINT "commander_achievements_commanderId_fkey"
    FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commander_achievements" ADD CONSTRAINT "commander_achievements_achievementId_fkey"
    FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bases" ADD CONSTRAINT "bases_commanderId_fkey"
    FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "researches" ADD CONSTRAINT "researches_commanderId_fkey"
    FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_commanderId_fkey"
    FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_commanderId_fkey"
    FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "planet_scans" ADD CONSTRAINT "planet_scans_commanderId_fkey"
    FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hub_storages" ADD CONSTRAINT "hub_storages_commanderId_fkey"
    FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_commanderId_fkey"
    FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expedition_reports" ADD CONSTRAINT "expedition_reports_commanderId_fkey"
    FOREIGN KEY ("commanderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trades" ADD CONSTRAINT "trades_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trades" ADD CONSTRAINT "trades_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "battle_reports" ADD CONSTRAINT "battle_reports_attackerId_fkey"
    FOREIGN KEY ("attackerId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "battle_reports" ADD CONSTRAINT "battle_reports_defenderId_fkey"
    FOREIGN KEY ("defenderId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "war_declarations" ADD CONSTRAINT "war_declarations_aggressorId_fkey"
    FOREIGN KEY ("aggressorId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "war_declarations" ADD CONSTRAINT "war_declarations_targetId_fkey"
    FOREIGN KEY ("targetId") REFERENCES "commanders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

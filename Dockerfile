# Space Strategy MMO — production образ
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json ./
COPY src ./src
# Клиент генерируется ПОСЛЕ копирования исходников, и порядок здесь несущий.
# Генератор пишет в src/generated/prisma, поэтому `COPY src` следом положил бы
# поверх свежего клиента локальный — а он на машине разработчика может быть
# сгенерирован прошлой версией Prisma. Именно так собранный образ получил
# импорты с расширением .ts и падал на старте, хотя локально все собиралось.
#
# Сам вызов в базу не ходит, но конфиг у CLI один на все команды и адрес
# требует. Настоящий в образ не кладется намеренно: .env исключен
# .dockerignore, секреты живут в окружении машины. Поэтому подставляется
# заглушка — она видна только этой команде и в слой не попадает.
RUN DATABASE_URL="postgresql://placeholder/placeholder" npx prisma generate
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY public ./public
EXPOSE 3000
CMD ["node", "dist/index.js"]

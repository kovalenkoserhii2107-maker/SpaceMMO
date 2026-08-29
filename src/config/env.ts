import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Переменная окружения ${name} не задана. Проверь .env`);
  }
  return value;
}

export const env = {
  port: Number(process.env['PORT'] ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
} as const;

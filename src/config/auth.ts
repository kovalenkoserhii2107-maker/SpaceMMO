import { env } from './env.js';

/**
 * Настройки авторизации.
 *
 * Внешний провайдер один — Google. Apple требует платной подписки и ротации
 * секрета раз в полгода, Facebook — ревью приложения с непредсказуемым сроком;
 * держать их заготовки в коде значило бы делать вид, что вход через них
 * почти готов. В перечислении `AuthProvider` они остались: убрать значение
 * из enum в PostgreSQL можно только пересозданием типа, а пользы от этого нет.
 */
export const authConfig = {
  jwtSecret: process.env['JWT_SECRET'] ?? 'dev-secret-change-me',
  /** Срок жизни токена доступа. */
  tokenTtlSeconds: 60 * 60 * 24 * 7,
  /** Срок жизни ссылки для смены пароля. */
  resetTtlMinutes: 30,
  providers: {
    GOOGLE: { clientId: process.env['GOOGLE_CLIENT_ID'] ?? '' },
  },
} as const;

/** Провайдеры, вход через которые сервер вообще умеет обслуживать. */
export type ExternalProvider = keyof typeof authConfig.providers;

export function isExternalProvider(value: string): value is ExternalProvider {
  return Object.prototype.hasOwnProperty.call(authConfig.providers, value);
}

export function isProviderConfigured(provider: ExternalProvider): boolean {
  return authConfig.providers[provider].clientId.length > 0;
}

/** В разработке разрешаем дефолтный секрет, но предупреждаем об этом один раз. */
export function warnIfInsecureSecret(): void {
  if (authConfig.jwtSecret === 'dev-secret-change-me' && env.nodeEnv === 'production') {
    console.error('[auth] JWT_SECRET не задан — в production это недопустимо');
  }
}

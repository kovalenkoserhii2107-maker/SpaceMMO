import { env } from './env.js';

/**
 * Настройки авторизации.
 * Ключи сторонних провайдеров подключаются позже — здесь для них уже
 * заготовлены места, чтобы код входа не пришлось переписывать.
 */
export const authConfig = {
  jwtSecret: process.env['JWT_SECRET'] ?? 'dev-secret-change-me',
  /** Срок жизни токена доступа. */
  tokenTtlSeconds: 60 * 60 * 24 * 7,
  /** Срок жизни ссылки для смены пароля. */
  resetTtlMinutes: 30,
  providers: {
    GOOGLE: { clientId: process.env['GOOGLE_CLIENT_ID'] ?? '' },
    APPLE: { clientId: process.env['APPLE_CLIENT_ID'] ?? '' },
    FACEBOOK: { clientId: process.env['FACEBOOK_APP_ID'] ?? '' },
  },
} as const;

export function isProviderConfigured(provider: 'GOOGLE' | 'APPLE' | 'FACEBOOK'): boolean {
  return authConfig.providers[provider].clientId.length > 0;
}

/** В разработке разрешаем дефолтный секрет, но предупреждаем об этом один раз. */
export function warnIfInsecureSecret(): void {
  if (authConfig.jwtSecret === 'dev-secret-change-me' && env.nodeEnv === 'production') {
    console.error('[auth] JWT_SECRET не задан — в production это недопустимо');
  }
}

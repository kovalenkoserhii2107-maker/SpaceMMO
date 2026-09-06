import { env } from './env.js';

/**
 * Настройки авторизации.
 *
 * Внешних провайдера два — Google и Telegram. Apple требует платной подписки
 * и ротации секрета раз в полгода, Facebook — ревью приложения
 * с непредсказуемым сроком;
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
    /**
     * Google опознается публичным client id: он уезжает в браузер роутом
     * `/api/auth/config` и секретом не является.
     */
    GOOGLE: { clientId: process.env['GOOGLE_CLIENT_ID'] ?? '', secret: '' },
    /**
     * Telegram опознается **секретом** — токеном бота, которым подписан
     * `initData`. Поэтому он лежит в отдельном поле, а не в `clientId`:
     * поля с этим именем отдаются клиенту, и однажды кто-нибудь дописал бы
     * туда телеграмовский, не заметив разницы. Разные имена делают такую
     * ошибку невозможной, а не маловероятной.
     */
    TELEGRAM: { clientId: '', secret: process.env['TELEGRAM_BOT_TOKEN'] ?? '' },
  },
} as const;

/** Провайдеры, вход через которые сервер вообще умеет обслуживать. */
export type ExternalProvider = keyof typeof authConfig.providers;

export function isExternalProvider(value: string): value is ExternalProvider {
  return Object.prototype.hasOwnProperty.call(authConfig.providers, value);
}

export function isProviderConfigured(provider: ExternalProvider): boolean {
  const { clientId, secret } = authConfig.providers[provider];
  return clientId.length > 0 || secret.length > 0;
}

/** В разработке разрешаем дефолтный секрет, но предупреждаем об этом один раз. */
export function warnIfInsecureSecret(): void {
  if (authConfig.jwtSecret === 'dev-secret-change-me' && env.nodeEnv === 'production') {
    console.error('[auth] JWT_SECRET не задан — в production это недопустимо');
  }
}

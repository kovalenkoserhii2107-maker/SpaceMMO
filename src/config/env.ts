import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Переменная окружения ${name} не задана. Проверь .env`);
  }
  return value;
}

const nodeEnv = process.env['NODE_ENV'] ?? 'development';

export const env = {
  port: Number(process.env['PORT'] ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  nodeEnv,
  /**
   * Отдавать ли код смены пароля прямо в ответе.
   *
   * Пока не подключена отправка писем, иначе пароль на стенде не сменить.
   * Но роут открытый: с включенным флагом любой, кто знает чужой email,
   * получает действующий код и забирает аккаунт. Поэтому по умолчанию выключено
   * и в production не включается ни при каком значении переменной — забытый
   * `.env` не должен превращаться в дыру.
   */
  exposeResetToken: nodeEnv !== 'production' && process.env['AUTH_EXPOSE_RESET_TOKEN'] === 'true',
} as const;

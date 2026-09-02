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

  /**
   * Ключ Gemini для ботов. Пусто — боты играют по статичным характерам.
   *
   * Отсутствие ключа не ошибка и не должно ронять сервер: ИИ здесь надстройка
   * над рабочим ботом, а не условие его работы.
   */
  geminiKey: process.env['GEMINI_API_KEY'] ?? '',

  /**
   * Модель. Вынесена в переменную, потому что Google меняет и снимает
   * идентификаторы быстрее, чем стоит править код: смена модели не должна
   * требовать пересборки.
   */
  geminiModel: process.env['GEMINI_MODEL'] ?? 'gemini-3.5-flash-lite',
} as const;

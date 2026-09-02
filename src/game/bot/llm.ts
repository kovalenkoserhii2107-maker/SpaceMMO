/**
 * Обращение к языковой модели за планом и текстами для ботов.
 *
 * Модель здесь надстройка, а не условие работы. Нет ключа, упал API, пришел
 * мусор вместо JSON — бот продолжает играть по статичному характеру, и это
 * штатный режим, а не авария: ИИ добавляет ботам сообразительность и живую
 * речь, но играть за них умеет и код.
 *
 * Провайдер спрятан за двумя функциями, поэтому смена Gemini на другую модель
 * — правка одного файла. Наружу уходит уже разобранный и проверенный объект,
 * а не сырой ответ: все, что модель написала, — недоверенные данные.
 */
import { env } from '../../config/env.js';

/** Сколько ждем ответа. Бот не должен зависать в сети: у него есть чем играть. */
const TIMEOUT_MS = 12_000;

/** Потолок на ответ — план и письмо оба короткие, длинный ответ это сбой. */
const MAX_OUTPUT_TOKENS = 800;

export function llmEnabled(): boolean {
  return env.geminiKey.length > 0;
}

interface AskOptions {
  system: string;
  user: string;
  /** Ждем строгий JSON: у Gemini для этого есть отдельный режим ответа. */
  json: boolean;
}

/**
 * Один вызов модели. Возвращает текст ответа или null при любой неудаче.
 *
 * Молчаливого проглатывания ошибок здесь нет — они пишутся в лог, — но наружу
 * уходит именно null: вызывающий обязан уметь обойтись без ответа, и заставлять
 * его разбирать причины отказа значит размазывать эту обязанность по коду.
 */
async function ask(options: AskOptions): Promise<string | null> {
  if (!llmEnabled()) return null;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(env.geminiModel)}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        // Ключ заголовком, а не в query: строка запроса попадает в логи.
        'x-goog-api-key': env.geminiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: options.system }] },
        contents: [{ role: 'user', parts: [{ text: options.user }] }],
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: options.json ? 0.4 : 0.9,
          ...(options.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });

    if (!response.ok) {
      console.error(`[bot-llm] ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
    return text && text.trim() ? text : null;
  } catch (error) {
    // AbortError на таймауте — тоже сюда: для бота это ровно то же самое,
    // что и отказ сервиса, и вести себя он должен одинаково.
    console.error('[bot-llm] запрос не удался', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Спросить JSON. Разбор здесь же: строка наружу никому не нужна. */
export async function askJson(system: string, user: string): Promise<unknown | null> {
  const text = await ask({ system, user, json: true });
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error('[bot-llm] ответ не разобрался как JSON');
    return null;
  }
}

/**
 * Спросить текст письма.
 *
 * Длина режется здесь, а не доверяется модели: письмо уходит живому игроку
 * в почтовый ящик, и простыня на десять экранов — это порча интерфейса.
 */
export async function askText(system: string, user: string, limit = 600): Promise<string | null> {
  const text = await ask({ system, user, json: false });
  if (!text) return null;

  const clean = text.trim().replace(/\s+/gu, ' ');
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

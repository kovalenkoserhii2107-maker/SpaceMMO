/**
 * Учет обращений к языковой модели.
 *
 * Проверяется то, ради чего он написан: дневная норма общая на всех ботов,
 * попытка считается независимо от того, ответил ли сервис, и потолок писем
 * живому игроку стоит в коде, а не в просьбе к модели.
 */
import {
  ATTEMPT_GAP_MS,
  DAILY_BUDGET,
  DAILY_LETTERS,
  DAILY_LETTERS_PER_PLAYER,
  mayAsk,
  mayWrite,
  readSpend,
  today,
  withAttempt,
  withLetter,
  type BotSpend,
} from '../src/game/bot/budget.js';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`PASS | ${name}${detail ? ` :: ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`FAIL | ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

const NOW = Date.parse('2026-09-03T12:00:00Z');
const fresh = (): BotSpend => readSpend(null, NOW);

console.log('=== 1. Чтение счетчика ===');
{
  check('пустая память дает нулевой счетчик', fresh().calls === 0 && fresh().letters === 0);
  check('сутки берутся по UTC', fresh().day === today(NOW) && fresh().day === '2026-09-03');
}

{
  // Счетчик за прошлые сутки не чинится, а обнуляется: он ничего не значит.
  const stale = readSpend({ spend: { day: '2026-09-02', calls: 399, letters: 6, toPlayer: { a: 2 } } }, NOW);
  check('вчерашний счетчик обнуляется', stale.calls === 0 && stale.letters === 0, `${stale.calls} вызовов`);
}

{
  /*
   * `Bot.memory` — это JSON в базе, переживающий изменения игры (правила 8 и 9).
   * Мусор в нем не должен ни ронять бота, ни открывать ему безлимитный расход.
   */
  const junk = readSpend({ spend: { day: today(NOW), calls: 'много', letters: -5, toPlayer: 'нет' } }, NOW);
  check('мусор в памяти читается как ноль, а не как безлимит', junk.calls === 0 && junk.letters === 0);
  const infinite = readSpend({ spend: { day: today(NOW), calls: Number.POSITIVE_INFINITY } }, NOW);
  check('бесконечность в счетчике не проходит', infinite.calls === 0);
}

console.log('\n=== 2. Дневная норма ===');
{
  const spend = fresh();
  check('при свободной норме спрашивать можно', mayAsk(spend, 0, NOW));
  check('на исчерпанной норме — нельзя', !mayAsk(spend, DAILY_BUDGET, NOW));
  check('норма общая: чужой расход закрывает и нам', !mayAsk(spend, DAILY_BUDGET + 10, NOW));
}

{
  /*
   * Защита от холостого цикла: при недоступном API повод никуда не девается,
   * и бот ломился бы к модели каждые сорок пять секунд, выбирая норму
   * за полчаса на одних отказах.
   */
  const tried = withAttempt(fresh(), NOW);
  check('попытка считается сразу, а не по факту ответа', tried.calls === 1);
  check('сразу после попытки спрашивать нельзя', !mayAsk(tried, 0, NOW + 1000));
  check('после паузы — снова можно', mayAsk(tried, 0, NOW + ATTEMPT_GAP_MS));
}

console.log('\n=== 3. Потолок переписки ===');
{
  let spend = fresh();
  check('первое письмо игроку проходит', mayWrite(spend, 'игрок'));

  for (let i = 0; i < DAILY_LETTERS_PER_PLAYER; i += 1) spend = withLetter(spend, 'игрок');
  check(
    'сверх нормы одному игроку бот не пишет',
    !mayWrite(spend, 'игрок'),
    `${spend.toPlayer['игрок']} писем`,
  );
  check('но другому игроку — пишет', mayWrite(spend, 'другой'));
}

{
  // Общий потолок бьет раньше персонального, если адресатов много.
  let spend = fresh();
  for (let i = 0; i < DAILY_LETTERS; i += 1) spend = withLetter(spend, `игрок-${i}`);
  check(
    'общий потолок писем закрывает и незнакомых адресатов',
    !mayWrite(spend, 'кто-то-новый'),
    `${spend.letters} писем за сутки`,
  );
}

{
  /*
   * Призыв о помощи считается письмами наравне с ответами. Раньше он шел мимо
   * потолка совсем — письмо собирает код, модели оно не стоит ничего, — но
   * потолок защищает ящик живого игрока, а не бюджет, и рассылке он нужен
   * даже больше: адресатов у нее шестеро разом. Живой игрок получил такую
   * рассылку, ответил на нее и продолжил получать то же самое.
   */
  let spend = fresh();
  for (let i = 0; i < DAILY_LETTERS_PER_PLAYER; i += 1) spend = withLetter(spend, 'игрок');
  check(
    'исчерпав лимит на игрока, призыв ему не уходит',
    !mayWrite(spend, 'игрок'),
    `${spend.toPlayer['игрок']} писем`,
  );
  check('а соседу, которому не писали, уходит', mayWrite(spend, 'сосед'));
}

console.log(`\n=== ИТОГ: ${passed}/${passed + failed} пройдено ===`);
if (failed > 0) process.exitCode = 1;

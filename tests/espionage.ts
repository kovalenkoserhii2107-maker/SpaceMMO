/**
 * Шпионаж: лестница раскрытия и броски.
 *
 * Разведка случайна, поэтому проверяется она так же, как бой (правило 15):
 * точные утверждения — на зерне, доли — сериями. Одиночный прогон здесь
 * не доказывает ничего.
 */
import {
  ESPIONAGE_DETAILS,
  JOKER,
  atLeast,
  espionageSeed,
  resolveEspionage,
  type EspionageDetail,
} from '../src/game/espionage.js';

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

/** Доля исходов в серии: единственный честный способ проверить вероятность. */
function share(runs: number, gap: number, predicate: (o: ReturnType<typeof resolveEspionage>) => boolean): number {
  let hits = 0;
  for (let i = 0; i < runs; i += 1) {
    if (predicate(resolveEspionage(Math.max(0, gap), Math.max(0, -gap)))) hits += 1;
  }
  return hits / runs;
}

const RUNS = 20_000;
const near = (value: number, target: number, slack = 0.02) => Math.abs(value - target) <= slack;

console.log('=== 1. Лестница монотонна ===');
{
  /*
   * Немонотонность — тот самый класс ошибок, ради которого лестница вынесена
   * в перечисление. В первом наброске разница −1 открывала оборону, которой
   * не давала разница 0: отставать было выгоднее, чем идти вровень.
   */
  let ok = true;
  let previous = -1;
  const seen: string[] = [];
  for (let gap = -1; gap <= 6; gap += 1) {
    // Джокер выключен: смотрим саму ступень, а не удачу.
    const outcome = resolveEspionage(10 + gap, 10, () => 0.999);
    const index = ESPIONAGE_DETAILS.indexOf(outcome.detail);
    seen.push(`${gap >= 0 ? '+' : ''}${gap}:${outcome.detail}`);
    if (index < previous) ok = false;
    previous = index;
  }
  check('ступень не падает с ростом перевеса', ok, seen.join(' '));
}

{
  check(
    'сравнение ступеней работает по порядку, а не по алфавиту',
    atLeast('TECHS', 'FLEET_COUNT') && !atLeast('BUILDINGS', 'DEFENCE_TYPES'),
  );
}

console.log('\n=== 2. Пороги раскрытия ===');
{
  const rows: Array<[number, EspionageDetail]> = [
    [-1, 'BUILDINGS'],
    [0, 'FLEET_COUNT'],
    [1, 'DEFENCE_COUNT'],
    [2, 'DEFENCE_TYPES'],
    [3, 'FULL_FORCES'],
    [4, 'FULL_FORCES'],
    [5, 'TECHS'],
    [9, 'TECHS'],
  ];
  for (const [gap, expected] of rows) {
    const outcome = resolveEspionage(10 + gap, 10, () => 0.999);
    check(`перевес ${gap >= 0 ? '+' : ''}${gap} дает ${expected}`, outcome.detail === expected, outcome.detail);
  }
}

console.log('\n=== 3. Судьба дрона ===');
{
  const lost2 = share(RUNS, -2, (o) => o.droneLost);
  check(
    'отстав на два уровня, дрон гибнет почти всегда',
    near(lost2, 1 - JOKER, 0.01),
    `${(lost2 * 100).toFixed(1)}%`,
  );
  check('но не всегда: джокер оставляет шанс', lost2 < 1, `${(lost2 * 100).toFixed(1)}%`);

  const lost1 = share(RUNS, -1, (o) => o.droneLost);
  check('отстав на уровень — половина вылетов', near(lost1, 0.5), `${(lost1 * 100).toFixed(1)}%`);

  const lost0 = share(RUNS, 0, (o) => o.droneLost);
  check('на равных дрон не сбивают', lost0 === 0, `${(lost0 * 100).toFixed(1)}%`);
}

console.log('\n=== 4. Заметность ===');
{
  const rows: Array<[number, number]> = [
    [0, 1 - JOKER],
    [1, 0.7],
    [2, 0.4],
    [3, 0.1],
    [4, JOKER],
  ];
  for (const [gap, expected] of rows) {
    const noticed = share(RUNS, gap, (o) => o.alert !== 'NONE');
    check(
      `при перевесе +${gap} замечают в ${(expected * 100).toFixed(0)}% случаев`,
      near(noticed, expected),
      `${(noticed * 100).toFixed(1)}%`,
    );
  }
  check(
    'полной невидимости не бывает: джокер работает и здесь',
    share(RUNS, 6, (o) => o.alert !== 'NONE') > 0,
  );
}

console.log('\n=== 5. Что узнает цель ===');
{
  const rows: Array<[number, string]> = [
    [-1, 'ORIGIN_AND_LEAK'],
    [0, 'ORIGIN'],
    [1, 'IDENTITY'],
    [2, 'PRESENCE'],
    [5, 'PRESENCE'],
  ];
  for (const [gap, expected] of rows) {
    // Бросок заметности выключен: смотрим содержание, а не удачу.
    const outcome = resolveEspionage(10 + gap, 10, () => 0);
    check(`при перевесе ${gap >= 0 ? '+' : ''}${gap} цель узнает ${expected}`, outcome.alert === expected, outcome.alert);
  }
}

console.log('\n=== 6. Склад ===');
{
  const even = share(RUNS, 0, (o) => o.resourcesSeen);
  check('на равных склад виден в четырех случаях из пяти', near(even, 0.8), `${(even * 100).toFixed(1)}%`);
  const ahead = share(RUNS, 1, (o) => o.resourcesSeen);
  check('с перевесом — почти всегда', near(ahead, 1 - JOKER, 0.01), `${(ahead * 100).toFixed(1)}%`);
  const behind = share(RUNS, -1, (o) => o.resourcesSeen);
  check('отставая — никогда', behind === 0, `${(behind * 100).toFixed(1)}%`);
}

console.log('\n=== 7. Воспроизводимость ===');
{
  /*
   * Без зерна один и тот же пролет давал бы разные ответы при каждом
   * пересчете, и проверить лестницу было бы нечем.
   */
  const a = resolveEspionage(3, 1, espionageSeed('рейс-1', 'планета-7'));
  const b = resolveEspionage(3, 1, espionageSeed('рейс-1', 'планета-7'));
  check(
    'одно зерно — один исход',
    a.detail === b.detail && a.droneLost === b.droneLost && a.alert === b.alert,
  );
  const c = espionageSeed('рейс-2', 'планета-7');
  const d = espionageSeed('рейс-1', 'планета-7');
  check('разные рейсы дают разные броски', c() !== d());
}

console.log(`\n=== ИТОГ: ${passed}/${passed + failed} пройдено ===`);
if (failed > 0) process.exitCode = 1;

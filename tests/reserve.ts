/**
 * Резерв хаба: коридор от производства, импорт по потолку, выкуп на фонд.
 *
 * Формулы проверяются напрямую на игровом модуле — сервер не нужен.
 *
 * Запуск: npm run test:reserve
 */
import {
  farmParity,
  RESERVE_BUY_SHARE,
  RESERVE_CEILING,
  RESERVE_IMPORT_LOT,
  reserveBand,
  reserveQuotes,
} from '../src/game/reserve.js';
import { creditOutput, emptyLevels, NEUTRAL_MODIFIERS, productionPerSecond } from '../src/game/rules.js';
import { buyerEscrow } from '../src/game/market.js';

const results: Array<{ name: string; passed: boolean }> = [];
function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

console.log('\n=== 1. Коридор от производства ===');
{
  /*
   * Пол — паритет: шахта того же уровня, что ферма, приносит по нему ровно
   * столько же гривны. Проверяем на настоящих формулах добычи и фермы,
   * с энергией с запасом, на нескольких уровнях: паритет от уровня
   * не зависит, и этим он годится в опору.
   */
  const richness = { ore: 1, polymers: 1, plasma: 1, energy: 1, antimatter: 1 };
  for (const level of [3, 10, 20]) {
    const levels = { ...emptyLevels(), ORE_MINE: level, POLYMER_PLANT: level, CRYPTO_FARM: level, POWER_PLANT: 40 };
    const rate = productionPerSecond(levels, richness, undefined, 0, NEUTRAL_MODIFIERS);
    const farm = creditOutput(levels);
    check(
      `на ${level} уровне шахта по полу приносит столько же, сколько ферма`,
      Math.abs(rate.ore * reserveBand('ORE').floor - farm) / farm < 0.01 &&
        Math.abs(rate.polymers * reserveBand('POLYMERS').floor - farm) / farm < 0.01,
      `ферма ${farm.toFixed(1)}, руда ${(rate.ore * reserveBand('ORE').floor).toFixed(1)}`,
    );
  }
  check('паритет руды 7.5, полимеров 10.34', farmParity('ORE') === 7.5 && Math.abs(farmParity('POLYMERS') - 10.34) < 0.01);
  check('потолок вчетверо выше пола', reserveBand('ORE').ceiling === reserveBand('ORE').floor * RESERVE_CEILING);
}

console.log('\n=== 2. Денег резерв не печатает ===');
{
  const empty = reserveQuotes(0);
  check('без фонда выкупа нет вовсе', empty.every((quote) => quote.side === 'SELL'));
  check(
    'импорт стоит по потолку на всю норму',
    empty.length === 2 && empty.every((quote) => quote.price === reserveBand(quote.resource).ceiling && quote.amount === RESERVE_IMPORT_LOT),
  );

  const fund = 1_000_000;
  const escrow = reserveQuotes(fund)
    .filter((quote) => quote.side === 'BUY')
    .reduce((sum, quote) => sum + buyerEscrow(quote.amount, quote.price), 0);
  check(
    'выкуп за ход не берет больше своей доли фонда',
    escrow <= fund * RESERVE_BUY_SHARE * 1.01,
    `залог ${Math.round(escrow)} из ${fund * RESERVE_BUY_SHARE}`,
  );
  check(
    'выкуп стоит по полу',
    reserveQuotes(fund).filter((quote) => quote.side === 'BUY').every((quote) => quote.price === reserveBand(quote.resource).floor),
  );
}

const passed = results.filter((row) => row.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);

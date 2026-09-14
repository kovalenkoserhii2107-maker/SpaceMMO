/**
 * Правила синдиката: предел состава, цена Коша, налог, ранги и права.
 *
 * Формулы проверяются напрямую на игровом модуле — сервер не нужен.
 *
 * Запуск: npm run test:syndicate
 */
import {
  DEFAULT_RANKS,
  MAX_TAX_RATE,
  SYNDICATE_PERMISSIONS,
  TAX_DELAY_MS,
  effectiveTaxRate,
  hasPermission,
  kishUpgradeCost,
  legacyRankPosition,
  memberCap,
  normalizeCodex,
  normalizeRankName,
  outranks,
  splitTax,
  withdrawAllowance,
} from '../src/game/syndicate.js';

const results: Array<{ name: string; passed: boolean }> = [];
function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

console.log('\n=== 1. Кіш задает предел состава ===');
{
  check('на первом уровне Коша трое', memberCap(1) === 3);
  check('каждый уровень добавляет одного', memberCap(2) === 4 && memberCap(10) === 12);
  check('нулевой и дробный уровень не ломают предел', memberCap(0) === 3 && memberCap(2.9) === 4);
  check('первый уровень бесплатен', kishUpgradeCost(1) === 0);
  check('второй стоит 25 тысяч, дальше удваивается',
    kishUpgradeCost(2) === 25_000 && kishUpgradeCost(3) === 50_000 && kishUpgradeCost(10) === 6_400_000);
}

console.log('\n=== 2. Налог с фермы ===');
{
  const now = 1_000_000;
  check('без отложенной ставки действует текущая',
    effectiveTaxRate({ taxRate: 10, pendingTaxRate: null, taxEffectiveAt: null }, now) === 10);
  check('до срока новая ставка не действует',
    effectiveTaxRate({ taxRate: 10, pendingTaxRate: 25, taxEffectiveAt: now + 1 }, now) === 10);
  check('в срок и после — действует новая',
    effectiveTaxRate({ taxRate: 10, pendingTaxRate: 25, taxEffectiveAt: now }, now) === 25);
  check('ставка зажата потолком', effectiveTaxRate({ taxRate: 90, pendingTaxRate: null, taxEffectiveAt: null }, now) === MAX_TAX_RATE);
  check('отрицательная ставка — ноль', effectiveTaxRate({ taxRate: -5, pendingTaxRate: null, taxEffectiveAt: null }, now) === 0);
  check('задержка — ровно сутки', TAX_DELAY_MS === 86_400_000);

  const split = splitTax(1000, 15);
  check('налог и остаток дают намытое целиком', split.tax === 150 && split.kept === 850);
  const small = splitTax(6, 15);
  check('налог округляется вниз в пользу участника', small.tax === 0 && small.kept === 6);
  check('дробь намытого в налог не попадает', splitTax(99.9, 10).tax === 9);
}

console.log('\n=== 3. Ранги и права ===');
{
  const leader = { isLeader: true, position: 0, permissions: [] };
  const officer = { isLeader: false, position: 1, permissions: ['APPLICATIONS', 'KICK', 'WITHDRAW'] };
  const officer2 = { isLeader: false, position: 1, permissions: ['KICK'] };
  const member = { isLeader: false, position: 2, permissions: [] };

  check('у главаря все права даже без записи в ранге',
    SYNDICATE_PERMISSIONS.every((permission) => hasPermission(leader, permission)));
  check('офицер имеет только свои права', hasPermission(officer, 'KICK') && !hasPermission(officer, 'TAX'));
  check('рядовой без прав', !hasPermission(member, 'BROADCAST'));

  check('офицер действует на рядового', outranks(officer, member));
  check('офицер не действует на офицера того же места', !outranks(officer, officer2));
  check('рядовой не действует на офицера', !outranks(member, officer));
  check('на главаря не действует никто, даже другой «главарь»', !outranks(officer, leader) && !outranks(leader, leader));

  check('главарь выдает без предела', withdrawAllowance(leader, 0, 1e9) === Number.POSITIVE_INFINITY);
  check('без права выдачи — ноль, какой бы ни был лимит', withdrawAllowance(member, 1_000_000, 0) === 0);
  check('лимит уменьшается выданным за сутки', withdrawAllowance(officer, 10_000, 3_500) === 6_500);
  check('перерасход не уходит в минус', withdrawAllowance(officer, 10_000, 12_000) === 0);

  check('стартовые ранги повторяют прежние роли',
    DEFAULT_RANKS.length === 3 &&
      DEFAULT_RANKS[legacyRankPosition('LEADER')]!.name === 'Главарь' &&
      DEFAULT_RANKS[legacyRankPosition('OFFICER')]!.permissions.includes('DIPLOMACY') &&
      DEFAULT_RANKS[legacyRankPosition('MEMBER')]!.permissions.length === 0);
  check('неизвестная прежняя роль читается как рядовой', legacyRankPosition(null) === 2);
}

console.log('\n=== 4. Тексты ===');
{
  check('кодекс принимает обычный текст с переносами', normalizeCodex('Первое.\r\nВторое.') === 'Первое.\nВторое.');
  check('управляющие символы вырезаются', normalizeCodex('ab') === 'ab');
  check('длиннее пяти тысяч — отказ', normalizeCodex('я'.repeat(5001)) === null);
  check('пустой кодекс допустим — это «кодекса нет»', normalizeCodex('   ') === '');
  check('имя ранга: пробелы схлопываются', normalizeRankName('  Старший   пилот ') === 'Старший пилот');
  check('имя ранга: разметка не проходит', normalizeRankName('<b>Босс</b>') === null);
  check('имя ранга: одна буква — мало', normalizeRankName('А') === null);
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);

/**
 * Правила синдиката: предел состава, цена Коша, налог, ранги и права.
 *
 * Формулы проверяются напрямую на игровом модуле — сервер не нужен.
 *
 * Запуск: npm run test:syndicate
 */
import {
  BUFF_TENURE_MS,
  PACT_NOTICE_MS,
  isPactKind,
  pactInForce,
  pactPair,
  pactsForbidAttack,
  plunderTreasury,
  treasuryProtectedShare,
  treasuryUpgradeCost,
  KISH_MOVE_COOLDOWN_MS,
  bramaThroughput,
  bramaUpgradeCost,
  kishMoveAvailableAt,
  kishMoveCost,
  DEFAULT_RANKS,
  academyUpgradeCost,
  effectiveSyndicateTechs,
  emptySyndicateTechLevels,
  syndicateBuffs,
  syndicateResearchSeconds,
  syndicateTechCost,
  MAX_TAX_RATE,
  SYNDICATE_PERMISSIONS,
  TAX_DELAY_MS,
  effectiveTaxRate,
  hasPermission,
  isWatched,
  kishUpgradeCost,
  legacyRankPosition,
  memberCap,
  normalizeCodex,
  normalizeRankName,
  outranks,
  splitTax,
  watchRadius,
  watchUpgradeCost,
  withdrawAllowance,
} from '../src/game/syndicate.js';
import { splitSurvivors } from '../src/game/fleets.js';
import { emptyShipCounts } from '../src/game/ships.js';

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
  check('второй стоит 250 тысяч, дальше удваивается',
    kishUpgradeCost(2) === 250_000 && kishUpgradeCost(3) === 500_000 && kishUpgradeCost(10) === 64_000_000);
}

console.log('\n=== 1б. Дозор ===');
{
  check('не построенный Дозор не видит ничего', !isWatched(0, 0) && watchRadius(0) === -1);
  check('первый уровень смотрит только за системой Коша', isWatched(1, 0) && !isWatched(1, 0.5));
  check('каждый уровень расширяет круг на три единицы', watchRadius(2) === 3 && watchRadius(7) === 18);
  check('граница круга включается', isWatched(3, 6) && !isWatched(3, 6.01));
  check('первый уровень стоит 200 тысяч, дальше удваивается',
    watchUpgradeCost(1) === 200_000 && watchUpgradeCost(2) === 400_000 && watchUpgradeCost(5) === 3_200_000);
}

console.log('\n=== 1в. Академія и технологии ===');
{
  const first = syndicateTechCost(1);
  const seventh = syndicateTechCost(7);
  check('первый уровень технологии — базовая цена', first.credits === 10_000 && first.ore === 10_000);
  check('каждый уровень втрое дороже предыдущего',
    syndicateTechCost(2).credits === 30_000 && seventh.credits === 7_290_000, `седьмой ${seventh.credits}`);
  check('Академія дорожает вдвое', academyUpgradeCost(1).credits === 300_000 && academyUpgradeCost(3).credits === 1_200_000);
  check('лишние уровни Академії ускоряют изучение',
    syndicateResearchSeconds(3, 5) < syndicateResearchSeconds(3, 3), `${syndicateResearchSeconds(3, 3)} с → ${syndicateResearchSeconds(3, 5)} с`);

  const levels = { ...emptySyndicateTechLevels(), MINING: 7, TRADE: 40, COUNTERINTEL: 7 };
  const now = 10 * BUFF_TENURE_MS;
  const newcomer = syndicateBuffs(levels, now - BUFF_TENURE_MS + 1, now);
  check('новичку младше двух суток бонусов нет', newcomer.mining === 1 && newcomer.counterIntel === 0);
  const veteran = syndicateBuffs(levels, now - BUFF_TENURE_MS, now);
  check('седьмой уровень добычи дает +21%', Math.abs(veteran.mining - 1.21) < 1e-9);
  check('скидка на комиссию не уводит ее в минус', veteran.tradeFee === 0);
  check('контрразведка: +1 уровень за каждые три', veteran.counterIntel === 2);

  const done = effectiveSyndicateTechs(emptySyndicateTechLevels(), { tech: 'CARGO', targetLevel: 2, finishesAt: 100 }, 100);
  const pending = effectiveSyndicateTechs(emptySyndicateTechLevels(), { tech: 'CARGO', targetLevel: 2, finishesAt: 101 }, 100);
  check('завершенное по сроку изучение действует до записи', done.CARGO === 2 && pending.CARGO === 0);
}

console.log('\n=== 1г. Брама и перенос Коша ===');
{
  check('первый уровень Брамы — по 500 тысяч, дальше вдвое', bramaUpgradeCost(1).ore === 500_000 && bramaUpgradeCost(3).credits === 2_000_000);
  check('пропускная способность — 200 кораблей в час за уровень', bramaThroughput(1) === 200 && bramaThroughput(4) === 800);
  check('перенос Коша — 500 антиматерии за единицу расстояния', kishMoveCost(4.5) === 2250 && kishMoveCost(0) === 1);
  check('перенос не чаще раза в сутки', kishMoveAvailableAt(1000) === 1000 + KISH_MOVE_COOLDOWN_MS && kishMoveAvailableAt(null) === 0);
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
  check('управляющие символы вырезаются', normalizeCodex('a\u0007b') === 'ab');
  check('длиннее пяти тысяч — отказ', normalizeCodex('я'.repeat(5001)) === null);
  check('пустой кодекс допустим — это «кодекса нет»', normalizeCodex('   ') === '');
  check('имя ранга: пробелы схлопываются', normalizeRankName('  Старший   пилот ') === 'Старший пилот');
  check('имя ранга: разметка не проходит', normalizeRankName('<b>Босс</b>') === null);
  check('имя ранга: одна буква — мало', normalizeRankName('А') === null);
}

console.log('\n=== 1д. Скарбниця и налет на Кіш ===');
{
  check('без Скарбниці несгораема пятая часть казны', treasuryProtectedShare(0) === 0.2);
  check('каждый уровень добавляет пять процентов', Math.abs(treasuryProtectedShare(4) - 0.4) < 1e-9);
  check('несгораемая доля не выше четырех пятых', treasuryProtectedShare(40) === 0.8);
  check('Скарбниця стоит 200 тысяч и дорожает вдвое', treasuryUpgradeCost(1).credits === 200_000 && treasuryUpgradeCost(3).ore === 800_000);
  const loot = plunderTreasury({ ore: 10_000, polymers: 10_000, plasma: 1_000 }, 0.2, 100_000);
  check('налетчик уносит девять десятых уязвимой части', loot.ore === 7200 && loot.polymers === 7200 && loot.plasma === 720);
  const small = plunderTreasury({ ore: 10_000, polymers: 10_000, plasma: 1_000 }, 0.2, 8_000);
  check('трюмы заполняются рудой, затем полимерами', small.ore === 7200 && small.polymers === 800 && small.plasma === 0 && small.cargoLimited);
}

console.log('\n=== 5. Удержание: дележ уцелевших ===');
{
  const base = { ...emptyShipCounts(), LIGHT_FIGHTER: 30, CRUISER: 2 };
  const ally = { ...emptyShipCounts(), LIGHT_FIGHTER: 10, CRUISER: 1 };
  const survivors = { ...emptyShipCounts(), LIGHT_FIGHTER: 20, CRUISER: 1 };
  const [baseLeft, allyLeft] = splitSurvivors(survivors, [base, ally]) as [typeof base, typeof base];
  check('уцелевшие делятся пропорционально вкладу', baseLeft.LIGHT_FIGHTER === 15 && allyLeft.LIGHT_FIGHTER === 5);
  check('сумма долей совпадает с итогом боя', baseLeft.CRUISER + allyLeft.CRUISER === 1);
  check('остаток уходит тому, у кого класса было больше', baseLeft.CRUISER === 1 && allyLeft.CRUISER === 0);
  const wiped = splitSurvivors(emptyShipCounts(), [base, ally]);
  check('разгром обнуляет всех', wiped.every((part) => part.LIGHT_FIGHTER === 0 && part.CRUISER === 0));
  const [solo] = splitSurvivors({ ...emptyShipCounts(), LIGHT_FIGHTER: 99 }, [base]) as [typeof base];
  check('никто не получает больше, чем привел', solo.LIGHT_FIGHTER === 30);
}

console.log('\n=== 6. Пакты ===');
{
  check('пара синдикатов упорядочена независимо от стороны', pactPair('b', 'a').join() === pactPair('a', 'b').join() && pactPair('b', 'a')[0] === 'a');
  check('принятый пакт без срока действует', pactInForce({ status: 'ACTIVE', endsAt: null }, 1000));
  check('предложенный пакт еще не действует', !pactInForce({ status: 'PROPOSED', endsAt: null }, 1000));
  check('расторгнутый пакт действует до конца срока', pactInForce({ status: 'ACTIVE', endsAt: 5000 }, 4999) && !pactInForce({ status: 'ACTIVE', endsAt: 5000 }, 5000));
  check('срок расторжения — сутки', PACT_NOTICE_MS === 24 * 60 * 60 * 1000);
  check('ненападение и союз запрещают атаку, торговое соглашение — нет',
    pactsForbidAttack(['NON_AGGRESSION']) && pactsForbidAttack(['ALLIANCE']) && !pactsForbidAttack(['TRADE']) && !pactsForbidAttack([]));
  check('вид пакта проверяется по списку', isPactKind('ALLIANCE') && !isPactKind('WAR') && !isPactKind(1));
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);

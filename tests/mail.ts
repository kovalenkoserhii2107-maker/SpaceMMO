/**
 * Центр связи: приватность ящика, доставка системных отчетов и рассылка синдиката.
 *
 * Главная проверка здесь — приватность. Письмо принадлежит получателю, и ни один
 * запрос не должен отдать или изменить чужое даже по прямому идентификатору:
 * ящик открывается только своим токеном.
 *
 * Формулировки отчетов проверяются на чистом модуле reportMail, потому что
 * поднимать настоящий бой ради текста письма незачем.
 *
 * Запуск: npm run test:mail
 */
import { buildBattleMail, buildExpeditionMail, buildSpyMail } from '../src/services/reportMail.js';
import { emptyDefenseCounts } from '../src/game/defenses.js';
import { emptyShipCounts, type ShipCounts } from '../src/game/ships.js';
import { resolveBattle } from '../src/game/combat.js';
import { plunderAmount } from '../src/game/combat.js';
import { storageCapacityForLevel } from '../src/game/rules.js';
import type { ScanPayload } from '../src/game/fogOfWar.js';

const BASE_URL = 'http://localhost:3000';
const results: Array<{ name: string; passed: boolean }> = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as Record<string, any> };
}

function fleet(partial: Partial<ShipCounts>): ShipCounts {
  return { ...emptyShipCounts(), ...partial };
}

/* ------------------------- 1. Формулировки отчетов ------------------------- */

console.log('\n=== 1. Системные отчеты ===');

{
  const outcome = resolveBattle(
    { ships: fleet({ HEAVY_CRUISER: 20, TRANSPORTER: 10 }), defenses: emptyDefenseCounts() },
    { ships: fleet({ LIGHT_FIGHTER: 2 }), defenses: emptyDefenseCounts() },
  );
  const plunder = plunderAmount(
    { titanite: 12000, silicate: 8000, tritium: 0 },
    storageCapacityForLevel(1),
    100000,
  );

  const mail = buildBattleMail({
    attackerId: 'atk',
    defenderId: 'def',
    attackerName: 'Адмирал',
    defenderName: 'Пилот',
    planetName: 'Кобзар II',
    outcome,
    plunder,
  });

  check('бой дает ровно два письма', mail.length === 2, `${mail.length}`);
  check(
    'письма адресованы обеим сторонам',
    mail[0]!.recipientId === 'atk' && mail[1]!.recipientId === 'def',
  );
  check(
    'оба письма системные и одного типа',
    mail.every((m) => m.senderId === undefined && m.type === 'BATTLE_REPORT'),
  );
  check(
    'отчеты зеркальные: у каждого своя роль',
    (mail[0]!.payload as any).role === 'ATTACKER' && (mail[1]!.payload as any).role === 'DEFENDER',
  );
  check(
    'победитель и проигравший видят разные заголовки',
    mail[0]!.subject !== mail[1]!.subject,
    `${mail[0]!.subject} / ${mail[1]!.subject}`,
  );
  check(
    'атакующий читает про свои трофеи, защитник — про свои потери',
    mail[0]!.body.includes('Вывезено') && mail[1]!.body.includes('Со склада вывезено'),
  );
  check(
    'в теле письма есть обе стороны потерь',
    mail[0]!.body.includes('Наши потери') && mail[0]!.body.includes('Потери противника'),
  );
}

{
  // Проигранная атака: трофеев нет ни в одном письме.
  const outcome = resolveBattle(
    { ships: fleet({ LIGHT_FIGHTER: 1 }), defenses: emptyDefenseCounts() },
    { ships: fleet({ HEAVY_CRUISER: 30 }), defenses: emptyDefenseCounts() },
  );
  const plunder = plunderAmount({ titanite: 12000, silicate: 8000, tritium: 0 }, 10000, 0);
  const mail = buildBattleMail({
    attackerId: 'atk',
    defenderId: 'def',
    attackerName: 'Адмирал',
    defenderName: 'Пилот',
    planetName: 'Ярило I',
    outcome,
    plunder,
  });

  check(
    'при отбитой атаке письма говорят об обороне, а не о добыче',
    mail[0]!.body.includes('Атака отбита') && mail[1]!.body.includes('Оборона выстояла'),
  );
}

{
  const mail = buildExpeditionMail({
    commanderId: 'cmd',
    systemName: 'Сич',
    result: {
      outcome: 'RESOURCES',
      loot: { titanite: 2000, silicate: 0, eridium: 0 },
      pirates: null,
      battle: null,
      survivors: fleet({ TRANSPORTER: 2 }),
      summary: 'Заброшенный груз: подняли на борт 2000 титанита.',
    },
  });

  check('экспедиция дает одно системное письмо', mail.length === 1 && mail[0]!.type === 'EXPEDITION');
  check(
    'в письме экспедиции есть система, итог и добыча',
    mail[0]!.body.includes('Сич') &&
      mail[0]!.body.includes('2000 титанита') &&
      mail[0]!.body.includes('без потерь'),
  );
}

{
  const payload: ScanPayload = {
    owner: 'Противник',
    colonized: true,
    richness: { titanite: 1, silicate: 1, tritium: 1, energy: 1, eridium: 1 },
    buildings: {
      TITANITE_MINE: 12,
      SILICATE_MINE: 8,
      TRITIUM_MINE: 6,
      SOLAR_PLANT: 14,
      RESEARCH_LAB: 4,
      SHIPYARD: 5,
      ERIDIUM_SYNTH: 1,
      STORAGE: 3,
    },
    resources: { titanite: 5000, silicate: 3000, tritium: 1000, eridium: 10 },
    fleet: fleet({ HEAVY_CRUISER: 20 }),
    defenses: { ROCKET_LAUNCHER: 10, LASER_TURRET: 5 },
  };

  const mail = buildSpyMail({
    commanderId: 'cmd',
    planetName: 'Кобзар II',
    systemName: 'Сич',
    payload,
  });
  check('разведка дает одно письмо', mail.length === 1 && mail[0]!.type === 'SPY_REPORT');
  check(
    'в отчете разведки есть склад, флот и оборона',
    mail[0]!.body.includes('5000 титанита') &&
      mail[0]!.body.includes('крейсера 20') &&
      mail[0]!.body.includes('ракетных установок 10'),
  );

  const empty = buildSpyMail({
    commanderId: 'cmd',
    planetName: 'Пустышка',
    systemName: 'Сич',
    payload: { ...payload, colonized: false },
  });
  check('необитаемая планета дает короткий отчет', empty[0]!.body.includes('Колонии нет'));
}

/* ------------------------- 2. Приватность ящика ------------------------- */

console.log('\n=== 2. Приватность ящика ===');

const suffix = Date.now().toString(36);
const password = 'mail-pass-123';

async function register(prefix: string) {
  const email = `${prefix}-${suffix}@spacemmo.local`;
  const registered = await api('POST', '/api/auth/register', { email, password });
  const token = registered.data['token'] as string | undefined;
  if (!token) return null;
  const nickname = `${prefix === 'commander' ? 'Связист' : 'Соглядатай'}-${suffix}`;
  const onboarded = await api('POST', '/api/auth/commander', { nickname, avatarId: 'nova' }, token);
  if (onboarded.status !== 200) return null;
  return { token, nickname };
}

const alice = await register('commander');
const bob = await register('stranger');

if (!alice || !bob) {
  check('стенд поднялся: два командира созданы', false, 'онбординг не прошел');
} else {
  const anonymous = await api('GET', '/api/mail');
  check('ящик закрыт без токена', anonymous.status === 401);

  const sent = await api(
    'POST',
    '/api/mail',
    { to: bob.nickname, subject: 'Секрет', body: 'Координаты склада: орбита 3.' },
    alice.token,
  );
  check('личное письмо отправлено', sent.status === 200, JSON.stringify(sent.data));
  check(
    'ответ не раскрывает внутренний id получателя',
    !('recipientId' in sent.data),
    JSON.stringify(sent.data),
  );

  const bobBox = await api('GET', '/api/mail', undefined, bob.token);
  const letter = (bobBox.data['messages'] as any[])[0];
  check('письмо лежит у получателя и не прочитано', letter?.subject === 'Секрет' && !letter.isRead);
  check('счетчик непрочитанных вырос', bobBox.data['unread'] === 1, `${bobBox.data['unread']}`);

  const aliceBox = await api('GET', '/api/mail', undefined, alice.token);
  check(
    'отправитель не видит письмо в своем ящике',
    (aliceBox.data['messages'] as any[]).length === 0,
    `писем у отправителя: ${(aliceBox.data['messages'] as any[]).length}`,
  );

  // Ключевая проверка: чужой ящик недоступен даже по прямому идентификатору письма.
  const foreignRead = await api('POST', `/api/mail/${letter.id}/read`, {}, alice.token);
  check('чужое письмо нельзя пометить прочитанным', foreignRead.status === 404, JSON.stringify(foreignRead.data));

  const foreignDelete = await api('DELETE', `/api/mail/${letter.id}`, undefined, alice.token);
  check('чужое письмо нельзя удалить', foreignDelete.status === 404);

  const afterAttempts = await api('GET', '/api/mail', undefined, bob.token);
  const still = (afterAttempts.data['messages'] as any[])[0];
  check(
    'после чужих попыток письмо на месте и по-прежнему не прочитано',
    still?.id === letter.id && still.isRead === false,
  );

  // «Прочитать все» тоже не должно задевать чужие ящики.
  await api('POST', '/api/mail/read-all', {}, alice.token);
  const afterReadAll = await api('GET', '/api/mail', undefined, bob.token);
  check(
    'массовое «прочитать все» не трогает чужой ящик',
    (afterReadAll.data['messages'] as any[])[0].isRead === false,
  );

  const ownRead = await api('POST', `/api/mail/${letter.id}/read`, {}, bob.token);
  check('свое письмо помечается прочитанным', ownRead.status === 200);
  const afterOwnRead = await api('GET', '/api/mail', undefined, bob.token);
  check('счетчик непрочитанных обнулился', afterOwnRead.data['unread'] === 0);

  /* --- Валидация --- */

  const noRecipient = await api('POST', '/api/mail', { subject: 'x', body: 'y' }, alice.token);
  check('письмо без получателя отклонено', noRecipient.status === 400);

  const unknown = await api(
    'POST',
    '/api/mail',
    { to: 'Кого-Точно-Нет', subject: 'x', body: 'y' },
    alice.token,
  );
  check('письмо несуществующему позывному отклонено', unknown.status === 404);

  const toSelf = await api(
    'POST',
    '/api/mail',
    { to: alice.nickname, subject: 'x', body: 'y' },
    alice.token,
  );
  check('письмо самому себе отклонено', toSelf.status === 400, JSON.stringify(toSelf.data));

  const emptySubject = await api(
    'POST',
    '/api/mail',
    { to: bob.nickname, subject: '   ', body: 'y' },
    alice.token,
  );
  check('пустая тема отклонена', emptySubject.status === 400);

  const hugeBody = await api(
    'POST',
    '/api/mail',
    { to: bob.nickname, subject: 'x', body: 'п'.repeat(5000) },
    alice.token,
  );
  check('переросший лимит текст отклонен', hugeBody.status === 400);

  const badFilter = await api('GET', '/api/mail?type=NONSENSE', undefined, alice.token);
  check('неизвестный фильтр отклонен', badFilter.status === 400);

  const filtered = await api('GET', '/api/mail?type=BATTLE_REPORT', undefined, bob.token);
  check(
    'фильтр по типу не показывает письма других типов',
    (filtered.data['messages'] as any[]).length === 0,
  );

  /* --- Рассылка синдиката --- */

  const noSyndicate = await api(
    'POST',
    '/api/syndicates/broadcast',
    { subject: 'Сбор', body: 'Общий сбор в 20:00' },
    alice.token,
  );
  check(
    'рассылка недоступна вне синдиката',
    noSyndicate.status === 409,
    JSON.stringify(noSyndicate.data),
  );
}

/* ------------------------- Итог ------------------------- */

const passed = results.filter((item) => item.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);

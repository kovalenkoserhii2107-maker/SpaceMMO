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
import {
  buildBattleMail,
  buildDeployMail,
  buildExpeditionMail,
  buildReturnMail,
  buildSpyMail,
  buildTransportMail,
} from '../src/services/reportMail.js';
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
    { ships: fleet({ CRUISER: 20, SMALL_CARGO: 10 }), defenses: emptyDefenseCounts() },
    { ships: fleet({ LIGHT_FIGHTER: 2 }), defenses: emptyDefenseCounts() },
  );
  const plunder = plunderAmount(
    { ore: 12000, polymers: 8000, plasma: 0 },
    storageCapacityForLevel(1),
    100000,
  );

  const mail = buildBattleMail({
    attackerId: 'atk',
    defenderId: 'def',
    attackerName: 'Адмирал',
    defenderName: 'Пилот',
    location: { planetName: 'Кобзар II', systemName: 'Кобзар', position: 2, galaxyX: 4, galaxyY: 7 },
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
    'в теме письма есть и планета, и система',
    mail.every((m) => m.subject.includes('Кобзар II') && m.subject.includes('(Кобзар)')),
    `${mail[0]!.subject}`,
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

  // Ниже — то, из чего интерфейс рисует отчет. Тело письма остается запасным
  // вариантом для старых писем, а UI читает структурную нагрузку.
  const payload = mail[0]!.payload as any;
  check(
    'в отчете есть координаты боя, а не только имя планеты',
    payload.location.systemName === 'Кобзар' &&
      payload.location.position === 2 &&
      payload.location.galaxyX === 4 &&
      payload.location.galaxyY === 7,
  );
  check(
    'в отчете есть настоящий исход и число раундов',
    ['ATTACKER', 'DEFENDER', 'DRAW'].includes(payload.result) && payload.rounds >= 1,
    `${payload.result}, раундов ${payload.rounds}`,
  );
  check(
    'потери приходят построчно с «было» и «потеряно» для каждого класса',
    payload.attackerLosses.every(
      (row: any) => typeof row.key === 'string' && row.before > 0 && row.lost >= 0 && row.lost <= row.before,
    ),
    `строк ${payload.attackerLosses.length}`,
  );
}

{
  // Проигранная атака: трофеев нет ни в одном письме.
  const outcome = resolveBattle(
    { ships: fleet({ LIGHT_FIGHTER: 1 }), defenses: emptyDefenseCounts() },
    { ships: fleet({ CRUISER: 30 }), defenses: emptyDefenseCounts() },
  );
  const plunder = plunderAmount({ ore: 12000, polymers: 8000, plasma: 0 }, 10000, 0);
  const mail = buildBattleMail({
    attackerId: 'atk',
    defenderId: 'def',
    attackerName: 'Адмирал',
    defenderName: 'Пилот',
    location: { planetName: 'Ярило I', systemName: 'Ярило', position: 1, galaxyX: 2, galaxyY: 9 },
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
      loot: { ore: 2000, polymers: 0, antimatter: 0 },
      pirates: null,
      battle: null,
      survivors: fleet({ SMALL_CARGO: 2 }),
      summary: 'Заброшенный груз: подняли на борт 2000 руды.',
    },
  });

  check('экспедиция дает одно системное письмо', mail.length === 1 && mail[0]!.type === 'EXPEDITION');
  check(
    'в письме экспедиции есть система, итог и добыча',
    mail[0]!.body.includes('Сич') &&
      mail[0]!.body.includes('2000 руды') &&
      mail[0]!.body.includes('без потерь'),
  );
}

{
  const payload: ScanPayload = {
    owner: 'Противник',
    colonized: true,
    richness: { ore: 1, polymers: 1, plasma: 1, energy: 1, antimatter: 1 },
    buildings: {
      ORE_MINE: 12,
      POLYMER_PLANT: 8,
      PLASMA_REACTOR: 6,
      POWER_PLANT: 14,
      SCIENCE_CENTER: 4,
      SHIPYARD: 5,
      ANTIMATTER_FACTORY: 1,
      STORAGE: 3,
    },
    resources: { ore: 5000, polymers: 3000, plasma: 1000, antimatter: 10 },
    fleet: fleet({ CRUISER: 20 }),
    defenses: { CANNON: 10, LASER: 5 },
  };

  /*
   * Отчет собирается на ступени полного доступа: здесь проверяются
   * формулировки, а лестница раскрытия — в `tests/espionage.ts`.
   */
  const seenAll = { detail: 'TECHS', droneLost: false, resourcesSeen: true, alert: 'NONE' } as const;
  const mail = buildSpyMail({
    commanderId: 'cmd',
    planetName: 'Кобзар II',
    systemName: 'Сич',
    planetType: 'ROCKY',
    payload,
    outcome: seenAll,
  });
  check('разведка дает одно письмо', mail.length === 1 && mail[0]!.type === 'SPY_REPORT');
  check(
    'в отчете разведки есть склад, флот и оборона',
    mail[0]!.body.includes('5000 руды') &&
      mail[0]!.body.includes('крейсера 20') &&
      mail[0]!.body.includes('ракетных установок 10'),
  );

  const empty = buildSpyMail({
    commanderId: 'cmd',
    planetName: 'Пустышка',
    systemName: 'Сич',
    planetType: 'ROCKY',
    payload: { ...payload, colonized: false },
    outcome: seenAll,
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


/* ------------------------- Письма логистики ------------------------- */

console.log('\n=== Логистика: доставка, дислокация, возвращение ===');

const roster = [
  { key: 'SMALL_CARGO', label: 'Малый транспорт', before: 6, lost: 0 },
  { key: 'CRUISER', label: 'Тяжелый крейсер', before: 2, lost: 0 },
];

{
  // Доставка на свою колонию: письмо одно, второе адресовать некому.
  const own = buildTransportMail({
    senderId: 'atk',
    recipientId: 'atk',
    senderName: 'Адмирал',
    planetName: 'Ярило I',
    systemName: 'Ярило',
    fleet: roster,
    cargo: { ore: 5000, polymers: 2000, plasma: 0 },
  });
  check('доставка себе дает одно письмо', own.length === 1, `${own.length}`);
  check('в письме о доставке есть груз и место', own[0]!.body.includes('5000 руды') && own[0]!.body.includes('Ярило I'));
  check('логистика идет своим типом', own[0]!.type === 'FLEET', own[0]!.type);
  check('плазму с нулем не перечисляем', !own[0]!.body.includes('0 плазмы'));

  // Доставка чужой колонии: получатель тоже должен узнать, кто прислал груз.
  const foreign = buildTransportMail({
    senderId: 'atk',
    recipientId: 'def',
    senderName: 'Адмирал',
    planetName: 'Кобзар II',
    systemName: 'Сич',
    fleet: roster,
    cargo: { ore: 1000, polymers: 0, plasma: 500 },
  });
  check('доставка чужому дает два письма', foreign.length === 2, `${foreign.length}`);
  check(
    'письма адресованы отправителю и получателю',
    foreign[0]!.recipientId === 'atk' && foreign[1]!.recipientId === 'def',
  );
  check(
    'получатель видит, кто прислал груз',
    foreign[1]!.body.includes('Адмирал') && foreign[1]!.body.includes('1000 руды'),
  );
  check(
    'роли в нагрузке различаются',
    (foreign[0]!.payload as any).role === 'SENDER' && (foreign[1]!.payload as any).role === 'RECIPIENT',
  );
}

{
  const mail = buildDeployMail({
    commanderId: 'atk',
    baseName: 'Колония Хорс IV',
    planetName: 'Хорс IV',
    systemName: 'Сектор 866',
    fleet: roster,
    cargo: { ore: 0, polymers: 0, plasma: 0 },
  });
  check('дислокация дает письмо', mail.length === 1 && mail[0]!.type === 'FLEET');
  check(
    'в письме о дислокации есть состав и колония',
    mail[0]!.body.includes('Малый транспорт ×6') && mail[0]!.body.includes('Хорс IV'),
  );
  check('пустой трюм в дислокации не упоминается', !mail[0]!.body.includes('Доставлено'));

  const loaded = buildDeployMail({
    commanderId: 'atk',
    baseName: 'Колония Хорс IV',
    planetName: 'Хорс IV',
    systemName: 'Сектор 866',
    fleet: roster,
    cargo: { ore: 300, polymers: 0, plasma: 0 },
  });
  check('груз при дислокации попадает в письмо', loaded[0]!.body.includes('Доставлено: 300 руды'));
}

{
  // Пустой возврат молчит: о рейсе уже был свой отчет, второе письмо на каждый
  // вылет удвоило бы ящик.
  const empty = buildReturnMail({
    commanderId: 'atk',
    baseName: 'Колония Ярило I',
    planetName: 'Ярило I',
    missionLabel: 'Разведка',
    fleet: roster,
    cargo: { ore: 0, polymers: 0, plasma: 0, antimatter: 0 },
  });
  check('пустой возврат письма не дает', empty.length === 0, `${empty.length}`);

  const loot = buildReturnMail({
    commanderId: 'atk',
    baseName: 'Колония Ярило I',
    planetName: 'Ярило I',
    missionLabel: 'Атака',
    fleet: roster,
    cargo: { ore: 17650, polymers: 0, plasma: 0, antimatter: 0 },
  });
  check('возврат с добычей письмо дает', loot.length === 1 && loot[0]!.type === 'FLEET');
  check(
    'в письме о возврате есть добыча и миссия',
    loot[0]!.body.includes('17650 руды') && loot[0]!.subject.includes('атака'),
    loot[0]!.subject,
  );
  check(
    'антиматерия в трюме тоже считается грузом',
    buildReturnMail({
      commanderId: 'atk',
      baseName: 'база',
      planetName: 'Ярило I',
      missionLabel: 'Экспедиция',
      fleet: roster,
      cargo: { ore: 0, polymers: 0, plasma: 0, antimatter: 12 },
    }).length === 1,
  );
}

const passed = results.filter((item) => item.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);

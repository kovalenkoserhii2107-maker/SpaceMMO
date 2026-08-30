/**
 * Синдикаты: права ролей, общий банк и дипломатия альянсов.
 *
 * Основание синдиката стоит криптогривну, поэтому лидерами выступают
 * «богатые» аккаунты из конфигурации, а рядовых участников скрипт создает сам.
 * В конце синдикаты распускаются, чтобы стенд возвращался в исходное состояние.
 *
 * Запуск: node tests/syndicates.mjs <файл-с-ид.json>
 */
import { readFileSync } from 'node:fs';

const BASE_URL = 'http://localhost:3000';
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = [];

function check(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data: data || {} };
}

async function signIn(email, password) {
  const res = await api('POST', '/api/auth/login', { email, password });
  return res.data.token;
}

const stamp = Date.now().toString(36);

async function makeCommander(suffix) {
  const email = `syn-${stamp}-${suffix}@spacemmo.local`;
  const registered = await api('POST', '/api/auth/register', { email, password: 'syndicate-pass-1' });
  const token = registered.data.token;
  const created = await api('POST', '/api/auth/commander', {
    nickname: `Син-${stamp}-${suffix}`,
    avatarId: 'nova',
  }, token);
  return { token, id: created.data.commander?.id, nickname: created.data.commander?.nickname };
}

const leader = { token: await signIn(config.admiralEmail, config.admiralPassword) };
const rival = { token: await signIn(config.pilotEmail, config.pilotPassword) };
const officer = await makeCommander('officer');
const member = await makeCommander('member');
const outsider = await makeCommander('outsider');

/* ---------- Создание ---------- */
const founded = await api('POST', '/api/syndicates', { name: `Сич ${stamp}`, tag: `S${stamp.slice(-3)}` }, leader.token);
check('лидер основал синдикат', founded.status === 200, JSON.stringify(founded.data));

const poor = await api('POST', '/api/syndicates', { name: `Бедный ${stamp}`, tag: `B${stamp.slice(-3)}` }, member.token);
check('без криптогривны синдикат не создать', poor.status === 409, JSON.stringify(poor.data));

const twice = await api('POST', '/api/syndicates', { name: `Второй ${stamp}`, tag: `V${stamp.slice(-3)}` }, leader.token);
check('второй синдикат на командира не создается', twice.status === 409, JSON.stringify(twice.data));

const mine = (await api('GET', '/api/syndicates', undefined, leader.token)).data;
const syndicateId = mine.mine?.id;
check('синдикат виден создателю с ролью лидера', mine.mine?.role === 'LEADER', `роль ${mine.mine?.role}`);
check('банк создан пустым', mine.mine?.bank === 0, `банк ${mine.mine?.bank}`);
check('операция основания попала в журнал', (mine.mine?.transactions ?? []).some((t) => t.kind === 'FOUNDING'));

/* ---------- Заявки и права ---------- */
await api('POST', `/api/syndicates/${syndicateId}/apply`, undefined, officer.token);
await api('POST', `/api/syndicates/${syndicateId}/apply`, undefined, member.token);

const pending = (await api('GET', '/api/syndicates', undefined, leader.token)).data.mine.applications;
check('лидер видит обе заявки', pending.length === 2, `заявок ${pending.length}`);

const strangerApprove = await api('POST', `/api/syndicates/applications/${pending[0].id}/approve`, undefined, outsider.token);
check('посторонний не может одобрить заявку', strangerApprove.status === 409, `HTTP ${strangerApprove.status}`);

for (const application of pending) {
  await api('POST', `/api/syndicates/applications/${application.id}/approve`, undefined, leader.token);
}

const afterJoin = (await api('GET', '/api/syndicates', undefined, leader.token)).data.mine;
check('оба командира приняты в синдикат', afterJoin.members.length === 3, `участников ${afterJoin.members.length}`);

/* ---------- Ключевая проверка: рядовой участник ---------- */
await api('POST', `/api/syndicates/${syndicateId}/apply`, undefined, outsider.token);
const fresh = (await api('GET', '/api/syndicates', undefined, leader.token)).data.mine.applications;

const memberApprove = await api('POST', `/api/syndicates/applications/${fresh[0].id}/approve`, undefined, member.token);
check(
  'рядовой участник НЕ может одобрить заявку',
  memberApprove.status === 403,
  `HTTP ${memberApprove.status} ${JSON.stringify(memberApprove.data)}`,
);

const memberView = (await api('GET', '/api/syndicates', undefined, member.token)).data.mine;
check('рядовому участнику заявки не показываются', memberView.applications.length === 0, `видит ${memberView.applications.length}`);

const memberKick = await api('POST', `/api/syndicates/members/${officer.id}/kick`, undefined, member.token);
check('рядовой участник не может исключать', memberKick.status === 403, `HTTP ${memberKick.status}`);

const memberPromote = await api('POST', `/api/syndicates/members/${member.id}/role`, { role: 'OFFICER' }, member.token);
check('рядовой участник не может назначать офицеров', memberPromote.status === 403, `HTTP ${memberPromote.status}`);

const memberDisband = await api('POST', '/api/syndicates/disband', undefined, member.token);
check('рядовой участник не может распустить синдикат', memberDisband.status === 403, `HTTP ${memberDisband.status}`);

/* ---------- Офицер ---------- */
const promote = await api('POST', `/api/syndicates/members/${officer.id}/role`, { role: 'OFFICER' }, leader.token);
check('лидер назначил офицера', promote.status === 200, JSON.stringify(promote.data));

const officerApprove = await api('POST', `/api/syndicates/applications/${fresh[0].id}/approve`, undefined, officer.token);
check('офицер МОЖЕТ одобрить заявку', officerApprove.status === 200, JSON.stringify(officerApprove.data));

const officerDisband = await api('POST', '/api/syndicates/disband', undefined, officer.token);
check('офицер не может распустить синдикат', officerDisband.status === 403, `HTTP ${officerDisband.status}`);

/* ---------- Банк ---------- */
const before = (await api('GET', '/api/syndicates', undefined, leader.token)).data;
const donation = await api('POST', '/api/syndicates/donate', { amount: 500 }, leader.token);
check('пожертвование принято', donation.status === 200, JSON.stringify(donation.data));

const after = (await api('GET', '/api/syndicates', undefined, leader.token)).data;
check(
  'банк вырос, а личный счет уменьшился ровно на сумму',
  after.mine.bank - before.mine.bank === 500 && Math.round(before.credits - after.credits) === 500,
  `банк ${before.mine.bank}→${after.mine.bank}, счет ${before.credits}→${after.credits}`,
);
check('пожертвование попало в журнал', after.mine.transactions.some((t) => t.kind === 'DONATION' && t.amount === 500));

const tooMuch = await api('POST', '/api/syndicates/donate', { amount: 10_000_000 }, member.token);
check('пожертвование сверх лимита отклонено', tooMuch.status === 400, `HTTP ${tooMuch.status}`);

const broke = await api('POST', '/api/syndicates/donate', { amount: 999_999 }, member.token);
check('пожертвование сверх личного счета отклонено', broke.status === 409, JSON.stringify(broke.data));

/* --- атомарность: параллельные пожертвования не уводят счет в минус --- */
const budget = Math.floor((await api('GET', '/api/syndicates', undefined, leader.token)).data.credits);
const chunk = Math.floor(budget / 2) + 1;
const parallel = await Promise.all(
  Array.from({ length: 5 }, () => api('POST', '/api/syndicates/donate', { amount: chunk }, leader.token)),
);
const okCount = parallel.filter((r) => r.status === 200).length;
const settled = (await api('GET', '/api/syndicates', undefined, leader.token)).data;
check(
  'гонка пожертвований: счет не уходит в минус',
  settled.credits >= 0 && okCount <= 1,
  `успешных ${okCount} по ${chunk} ₴, остаток ${settled.credits}`,
);

/* ---------- Дипломатия ---------- */
const personalWar = await api('POST', '/api/war/declare', { targetId: outsider.id }, member.token);
check(
  'член синдиката НЕ может объявить личную войну',
  personalWar.status === 409 && /синдикат/i.test(personalWar.data.error || ''),
  JSON.stringify(personalWar.data),
);

const rivalFounded = await api('POST', '/api/syndicates', { name: `Орда ${stamp}`, tag: `O${stamp.slice(-3)}` }, rival.token);
check('второй синдикат основан соперником', rivalFounded.status === 200, JSON.stringify(rivalFounded.data));

const rivalId = (await api('GET', '/api/syndicates', undefined, rival.token)).data.mine.id;

const memberWar = await api('POST', '/api/war/syndicate/declare', { targetSyndicateId: rivalId }, member.token);
check('рядовой участник не может объявить войну синдикату', memberWar.status === 409, JSON.stringify(memberWar.data));

const officerWar = await api('POST', '/api/war/syndicate/declare', { targetSyndicateId: rivalId }, officer.token);
check('офицер объявил войну вражескому синдикату', officerWar.status === 200, JSON.stringify(officerWar.data));

const duplicateWar = await api('POST', '/api/war/syndicate/declare', { targetSyndicateId: rivalId }, leader.token);
check('повторное объявление войны отклонено', duplicateWar.status === 409, JSON.stringify(duplicateWar.data));

const warView = (await api('GET', '/api/war', undefined, rival.token)).data;
check(
  'вражеский синдикат видит войну у себя',
  (warView.syndicateWars ?? []).some((war) => !war.declaredByUs),
  JSON.stringify(warView.syndicateWars),
);

const peace = await api('POST', '/api/war/syndicate/peace', { targetSyndicateId: rivalId }, leader.token);
check('лидер заключил мир', peace.status === 200, JSON.stringify(peace.data));

/* ---------- Права офицера на исключение ---------- */
const officerKicksMember = await api('POST', `/api/syndicates/members/${outsider.id}/kick`, undefined, officer.token);
check(
  'офицер МОЖЕТ исключить рядового участника',
  officerKicksMember.status === 200,
  JSON.stringify(officerKicksMember.data),
);

// Возвращаем исключенного и делаем его офицером, чтобы проверить защиту равных.
await api('POST', `/api/syndicates/${syndicateId}/apply`, undefined, outsider.token);
const reapply = (await api('GET', '/api/syndicates', undefined, leader.token)).data.mine.applications;
await api('POST', `/api/syndicates/applications/${reapply[0].id}/approve`, undefined, leader.token);
await api('POST', `/api/syndicates/members/${outsider.id}/role`, { role: 'OFFICER' }, leader.token);

const officerKicksOfficer = await api('POST', `/api/syndicates/members/${outsider.id}/kick`, undefined, officer.token);
check(
  'офицер НЕ может исключить другого офицера',
  officerKicksOfficer.status === 403,
  JSON.stringify(officerKicksOfficer.data),
);

const officerKicksLeaderTry = await api('POST', `/api/syndicates/members/${(await api('GET', '/api/syndicates', undefined, leader.token)).data.mine.members.find((m) => m.role === 'LEADER').commanderId}/kick`, undefined, officer.token);
check(
  'офицер НЕ может исключить лидера',
  officerKicksLeaderTry.status === 403,
  JSON.stringify(officerKicksLeaderTry.data),
);

/* ---------- Рассылка по синдикату ---------- */

{
  const memberBroadcast = await api('POST', '/api/syndicates/broadcast',
    { subject: 'Самоуправство', body: 'Всем срочно' }, member.token);
  check('рядовой участник не может делать рассылку', memberBroadcast.status === 403,
    JSON.stringify(memberBroadcast.data));

  const emptySubject = await api('POST', '/api/syndicates/broadcast',
    { subject: '  ', body: 'текст' }, leader.token);
  check('рассылка без темы отклонена', emptySubject.status === 400);

  const sent = await api('POST', '/api/syndicates/broadcast',
    { subject: 'Общий сбор', body: 'Собираемся у хаба в 20:00.' }, leader.token);
  check('лидер разослал письмо составу', sent.status === 200, JSON.stringify(sent.data));

  // Рассылка уходит всем участникам, включая самого автора: в ящике должна
  // остаться история отправленного.
  const boxes = await Promise.all(
    [leader.token, member.token, officer.token].map((token) =>
      api('GET', '/api/mail?type=SYNDICATE', undefined, token)),
  );
  check('письмо дошло каждому участнику',
    boxes.every((box) => (box.data.messages || []).length > 0),
    boxes.map((b) => (b.data.messages || []).length).join('/'));
  check('в теме рассылки стоит тег синдиката',
    boxes[0].data.messages[0].subject.includes('[') && boxes[0].data.messages[0].subject.includes('Общий сбор'),
    boxes[0].data.messages[0].subject);
  check('подпись автора добавлена к тексту',
    boxes[1].data.messages[0].body.includes('синдикат'),
    boxes[1].data.messages[0].body.slice(-60));

  const officerBroadcast = await api('POST', '/api/syndicates/broadcast',
    { subject: 'От офицера', body: 'Проверка связи' }, officer.token);
  check('офицер тоже может рассылать', officerBroadcast.status === 200,
    JSON.stringify(officerBroadcast.data));
}

/* ---------- Передача лидерства ---------- */
const memberTransfer = await api('POST', `/api/syndicates/members/${member.id}/role`, { role: 'LEADER' }, member.token);
check('рядовой участник не может передать лидерство', memberTransfer.status === 403, `HTTP ${memberTransfer.status}`);

const transfer = await api('POST', `/api/syndicates/members/${officer.id}/role`, { role: 'LEADER' }, leader.token);
check('лидер передал лидерство офицеру', transfer.status === 200, JSON.stringify(transfer.data));

const afterTransfer = (await api('GET', '/api/syndicates', undefined, officer.token)).data.mine;
const oldLeader = afterTransfer.members.find((m) => m.nickname.includes('Адмирал') || m.role === 'OFFICER');
check(
  'новый лидер получил права, старый стал офицером',
  afterTransfer.role === 'LEADER' && afterTransfer.members.some((m) => m.role === 'OFFICER'),
  `роли: ${afterTransfer.members.map((m) => m.role).join(', ')}`,
);

const oldLeaderDisband = await api('POST', '/api/syndicates/disband', undefined, leader.token);
check('бывший лидер больше не может распустить синдикат', oldLeaderDisband.status === 403, `HTTP ${oldLeaderDisband.status}`);

// Возвращаем лидерство, чтобы уборка прошла от исходного аккаунта.
await api('POST', `/api/syndicates/members/${(await api('GET', '/api/syndicates', undefined, officer.token)).data.mine.members.find((m) => m.role === 'OFFICER' && m.nickname.includes('Адмирал')).commanderId}/role`, { role: 'LEADER' }, officer.token);

/* ---------- Уборка ---------- */
for (const account of [member, officer, outsider]) {
  await api('POST', '/api/syndicates/leave', undefined, account.token);
}
const disband = await api('POST', '/api/syndicates/disband', undefined, leader.token);
check('лидер распустил синдикат', disband.status === 200, JSON.stringify(disband.data));
await api('POST', '/api/syndicates/disband', undefined, rival.token);

const finalState = (await api('GET', '/api/syndicates', undefined, leader.token)).data;
check('после роспуска командир снова одиночка', finalState.mine === null);

const failed = results.filter((r) => !r.passed);
console.log(`\n=== ИТОГ: ${results.length - failed.length}/${results.length} пройдено ===`);
for (const f of failed) console.log(`  СЛОМАНО: ${f.name}`);

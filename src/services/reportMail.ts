/**
 * Превращение игровых событий в письма центра связи.
 *
 * Модуль чистый: он только формулирует текст и полезную нагрузку, а доставкой
 * занимается mailService. Благодаря этому формулировки отчетов проверяются
 * тестами без базы и без работающего сервера.
 *
 * Один бой дает два письма — атакующему и защитнику. Тексты зеркальные:
 * победа одного и есть поражение другого, но «мои потери» у каждого свои.
 */
import { atLeast, type EspionageAlert, type EspionageDetail, type EspionageOutcome } from '../game/espionage.js';
import type { BattleOutcome, PlunderResult, UnitLoss } from '../game/combat.js';
import type { ScanPayload } from '../game/fogOfWar.js';
import type { ExpeditionResult } from '../game/expeditions.js';
import type { OutgoingMessage } from './mailService.js';

/** Потери одной строкой; без потерь тоже надо сказать явно. */
export function describeLosses(losses: UnitLoss[]): string {
  const real = losses.filter((item) => item.lost > 0);
  if (real.length === 0) return 'без потерь';
  return real.map((item) => `${item.label} −${item.lost} из ${item.before}`).join(', ');
}

function describeLoot(loot: { ore: number; polymers: number; plasma: number }): string {
  const parts = [
    loot.ore > 0 ? `${loot.ore} руды` : null,
    loot.polymers > 0 ? `${loot.polymers} полимеров` : null,
    loot.plasma > 0 ? `${loot.plasma} плазмы` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'ничего';
}

/** Где случился бой: отчет открывают спустя часы, и «у планеты X» без системы бесполезно. */
export interface BattleLocation {
  planetName: string;
  systemName: string;
  position: number;
  galaxyX: number;
  galaxyY: number;
}

export interface BattleMailInput {
  attackerId: string;
  defenderId: string;
  attackerName: string;
  defenderName: string;
  location: BattleLocation;
  outcome: BattleOutcome;
  plunder: PlunderResult;
}

export function buildBattleMail(input: BattleMailInput): OutgoingMessage[] {
  const { outcome, plunder, location, attackerName, defenderName } = input;
  const planetName = location.planetName;
  const attackerWon = outcome.winner === 'ATTACKER';
  const loot = describeLoot(plunder);

  const payload = {
    planetName,
    location,
    attackerName,
    defenderName,
    winner: outcome.winner,
    /*
     * Настоящий исход, включая ничью: `winner` отдает ее защитнику, а игроку
     * важно видеть разницу между «отбились» и «никто не дожал».
     */
    result: outcome.combat.winner,
    rounds: outcome.combat.rounds.length,
    attackerFirepower: Math.round(outcome.attackerPower.firepower),
    defenderFirepower: Math.round(outcome.defenderPower.firepower),
    attackerLosses: outcome.attackerLosses,
    defenderLosses: outcome.defenderLosses,
    attackerDamageReport: outcome.attackerDamageReport,
    defenderDamageReport: outcome.defenderDamageReport,
    plunder: {
      ore: plunder.ore,
      polymers: plunder.polymers,
      plasma: plunder.plasma,
      protectedAmount: Math.round(plunder.protectedAmount),
      surplus: Math.round(plunder.surplus),
      cargoLimited: plunder.cargoLimited,
    },
    debris: outcome.debris,
  };

  // Обломки образуют обе стороны, поэтому строка одинаковая в обоих письмах.
  const debrisLine =
    outcome.debris.ore + outcome.debris.polymers > 0
      ? `\nНа орбите осталось обломков: ${outcome.debris.ore} руды, ` +
        `${outcome.debris.polymers} полимеров.`
      : '';

  const attackerBody =
    `Бой у планеты ${planetName}. Противник: ${defenderName}.\n` +
    `Огневая мощь: наша ${payload.attackerFirepower} против ${payload.defenderFirepower}.\n` +
    `Наши потери: ${describeLosses(outcome.attackerLosses)}.\n` +
    `Потери противника: ${describeLosses(outcome.defenderLosses)}.\n` +
    (attackerWon
      ? `Вывезено: ${loot}. Хранилище противника укрыло ${payload.plunder.protectedAmount}` +
        (plunder.cargoLimited ? ', остальное не влезло в трюмы уцелевших.' : '.')
      : 'Атака отбита, трофеев нет.') +
    debrisLine;

  const defenderBody =
    `Наша колония ${planetName} атакована. Нападавший: ${attackerName}.\n` +
    `Огневая мощь: наша ${payload.defenderFirepower} против ${payload.attackerFirepower}.\n` +
    `Наши потери: ${describeLosses(outcome.defenderLosses)}.\n` +
    `Потери нападавшего: ${describeLosses(outcome.attackerLosses)}.\n` +
    (attackerWon
      ? `Со склада вывезено: ${loot}. Хранилище укрыло ${payload.plunder.protectedAmount}.`
      : 'Оборона выстояла, склад цел.') +
    debrisLine;

  // В теме — исход и место: список писем просматривают, не открывая, и
  // «где это было» там нужнее всего.
  const where = `${planetName} (${location.systemName})`;

  return [
    {
      recipientId: input.attackerId,
      type: 'BATTLE_REPORT',
      subject: `${attackerWon ? 'Победа' : 'Поражение'}: атака на ${where}`,
      body: attackerBody,
      payload: { ...payload, role: 'ATTACKER' },
    },
    {
      recipientId: input.defenderId,
      type: 'BATTLE_REPORT',
      subject: `${attackerWon ? 'Колония разграблена' : 'Атака отбита'}: ${where}`,
      body: defenderBody,
      payload: { ...payload, role: 'DEFENDER' },
    },
  ];
}

export interface ExpeditionMailInput {
  commanderId: string;
  systemName: string;
  result: ExpeditionResult;
}

export function buildExpeditionMail(input: ExpeditionMailInput): OutgoingMessage[] {
  const { result, systemName } = input;
  const loot = describeLoot({
    ore: result.loot.ore,
    polymers: result.loot.polymers,
    plasma: 0,
  });
  const antimatter = result.loot.antimatter > 0 ? `, антиматерия ${result.loot.antimatter}` : '';

  // Потери экспедиции знает только бой с пиратами: в тихом вылете терять нечего.
  const losses = result.battle ? result.battle.attackerLosses : [];

  const body =
    `Экспедиция в глубокий космос системы ${systemName}.\n` +
    `${result.summary}\n` +
    `Добыча: ${loot}${antimatter}.\n` +
    `Потери: ${describeLosses(losses)}.`;

  return [
    {
      recipientId: input.commanderId,
      type: 'EXPEDITION',
      subject: `Экспедиция: ${EXPEDITION_SUBJECTS[result.outcome]}`,
      body,
      payload: {
        systemName,
        outcome: result.outcome,
        summary: result.summary,
        loot: result.loot,
        losses,
        survivors: result.survivors,
      },
    },
  ];
}

const EXPEDITION_SUBJECTS: Record<ExpeditionResult['outcome'], string> = {
  SILENCE: 'пустой вылет',
  RESOURCES: 'найден груз',
  PIRATES_WON: 'засада отбита',
  PIRATES_LOST: 'флот потерян',
  EVADED: 'уклонились от засады',
};

export interface SpyMailInput {
  commanderId: string;
  planetName: string;
  systemName: string;
  payload: ScanPayload;
  /** Чем кончился пролет: до какой ступени дотянулись и уцелел ли дрон. */
  outcome: EspionageOutcome;
}

/**
 * Отчет разведки. Отдельное письмо нужно потому, что снимок стареет:
 * в ящике остается зафиксированный момент, даже когда карта уже показывает «???».
 */
export function buildSpyMail(input: SpyMailInput): OutgoingMessage[] {
  const { payload, planetName, systemName } = input;

  if (input.outcome.droneLost) {
    return [
      {
        recipientId: input.commanderId,
        type: 'SPY_REPORT',
        subject: `Разведка: зонд не вернулся с ${planetName}`,
        body:
          `Зонд ушел к ${planetName} (система ${systemName}) и на связь не вышел. ` +
          `Там знали, что он летит, — чужая контрразведка сильнее нашей. ` +
          `Пока «Шпионаж» не подтянут, посылать туда больше нечего.`,
        payload: { planetName, systemName, droneLost: true },
      },
    ];
  }

  if (!payload.colonized) {
    return [
      {
        recipientId: input.commanderId,
        type: 'SPY_REPORT',
        subject: `Разведка: ${planetName} необитаема`,
        body: `Зонд обследовал ${planetName} (система ${systemName}). Колонии нет, следов активности не обнаружено.`,
        payload: { planetName, systemName, colonized: false },
      },
    ];
  }

  const { outcome } = input;

  /*
   * Отказ формулируется по причине, а не общей фразой.
   *
   * «Данных нет» сказало бы неправду сразу в трех разных случаях: дрон сбит,
   * дрон долетел, но не дотянулся, дрону не повезло со складом. Игроку важно
   * знать, что именно исправить, — а исправляется это одним: уровнем.
   */
  const stock = payload.resources;
  const fleet = payload.fleet;
  const defenses = payload.defenses;
  const buildings = payload.buildings;
  const shows = (floor: EspionageDetail) => atLeast(outcome.detail, floor);
  const sum = (counts: Record<string, number> | null | undefined) =>
    counts ? Object.values(counts).reduce((total, value) => total + Math.max(0, value), 0) : 0;

  const fleetLine = shows('FULL_FORCES')
    ? fleet
      ? `Флот на орбите: зонды ${fleet.PROBE}, транспорты ${fleet.SMALL_CARGO}, ` +
        `истребители ${fleet.LIGHT_FIGHTER}, крейсера ${fleet.CRUISER}, фрегаты ${fleet.FRIGATE}.`
      : 'Флот на орбите: пусто.'
    : shows('FLEET_COUNT')
      ? `Флот на орбите: ${sum(fleet)} вымпелов, классы различить не удалось.`
      : 'Флот на орбите: зонд не дотянулся.';

  const defenseLine = shows('DEFENCE_TYPES')
    ? defenses
      ? `Оборона: ракетных установок ${defenses.CANNON}, лазерных орудий ${defenses.LASER}.`
      : 'Оборона: пусто.'
    : shows('DEFENCE_COUNT')
      ? `Оборона: ${sum(defenses)} огневых точек, типы различить не удалось.`
      : 'Оборона: зонд не дотянулся.';

  const stockLine = !outcome.resourcesSeen
    ? 'Склад: к учету подобраться не вышло.'
    : shows('FULL_FORCES')
      ? stock
        ? `Склад: ${stock.ore} руды, ${stock.polymers} полимеров, ${stock.plasma} плазмы.`
        : 'Склад: пусто.'
      : `Склад: около ${Math.round(
          (stock?.ore ?? 0) + (stock?.polymers ?? 0) + (stock?.plasma ?? 0),
        )} единиц, что именно лежит — неизвестно.`;

  const techLine = shows('TECHS')
    ? `Технологии: ${
        Object.entries(payload.techs ?? {})
          .filter(([, level]) => level > 0)
          .map(([tech, level]) => `${tech} ${level}`)
          .join(', ') || 'ничего не изучено'
      }.`
    : null;

  const buildLine = buildings
    ? `Инфраструктура: шахты ${buildings.ORE_MINE}/${buildings.POLYMER_PLANT}/${buildings.PLASMA_REACTOR}, ` +
      `верфь ${buildings.SHIPYARD}, склады ${buildings.ORE_STORAGE}/${buildings.POLYMER_STORAGE}/${buildings.PLASMA_STORAGE}.`
    : 'Инфраструктура: данных нет.';

  return [
    {
      recipientId: input.commanderId,
      type: 'SPY_REPORT',
      subject: `Разведка: ${planetName} (${payload.owner ?? 'владелец неизвестен'})`,
      body: [
        `Зонд обследовал ${planetName} (система ${systemName}).`,
        `Владелец: ${payload.owner ?? 'неизвестен'}.`,
        stockLine,
        fleetLine,
        defenseLine,
        buildLine,
        ...(techLine ? [techLine] : []),
      ].join('\n'),
      payload: { planetName, systemName, ...payload },
    },
  ];
}

export interface HarvestMailInput {
  commanderId: string;
  planetName: string;
  systemName: string;
  capacity: number;
  ore: number;
  polymers: number;
}

/**
 * Отчет переработчика.
 *
 * Пустой рейс — тоже результат: поле мог собрать другой игрок, пока флот летел.
 * Об этом надо сказать прямо, иначе исчезнувшие обломки выглядят как баг.
 */
export function buildHarvestMail(input: HarvestMailInput): OutgoingMessage[] {
  const total = input.ore + input.polymers;
  const empty = total <= 0;

  const body = empty
    ? `Переработчики вышли на орбиту ${input.planetName} (система ${input.systemName}), ` +
      'но поле обломков оказалось пустым — его успели собрать раньше. Флот возвращается ни с чем.'
    : `Переработчики собрали поле обломков на орбите ${input.planetName} ` +
      `(система ${input.systemName}).\n` +
      `Поднято: ${input.ore} руды, ${input.polymers} полимеров.\n` +
      `Трюмы: занято ${total} из ${input.capacity}.`;

  return [
    {
      recipientId: input.commanderId,
      type: 'EXPEDITION',
      subject: empty
        ? `Переработка: пусто у ${input.planetName}`
        : `Переработка: собрано ${total} у ${input.planetName}`,
      body,
      payload: {
        planetName: input.planetName,
        systemName: input.systemName,
        ore: input.ore,
        polymers: input.polymers,
        capacity: input.capacity,
      },
    },
  ];
}

/* ------------------------- Логистика ------------------------- */

export interface CargoAmounts {
  ore: number;
  polymers: number;
  plasma: number;
  antimatter?: number;
}

/** Состав флота одной строкой: «крейсера ×5, транспорты ×4». */
export function describeFleet(ships: UnitLoss[]): string {
  const real = ships.filter((item) => item.before > 0);
  if (real.length === 0) return 'пустой флот';
  return real.map((item) => `${item.label} ×${item.before}`).join(', ');
}

function cargoTotal(cargo: CargoAmounts): number {
  return cargo.ore + cargo.polymers + cargo.plasma + (cargo.antimatter ?? 0);
}

function describeCargo(cargo: CargoAmounts): string {
  const parts = [
    cargo.ore > 0 ? `${cargo.ore} руды` : null,
    cargo.polymers > 0 ? `${cargo.polymers} полимеров` : null,
    cargo.plasma > 0 ? `${cargo.plasma} плазмы` : null,
    cargo.antimatter && cargo.antimatter > 0 ? `${cargo.antimatter} антиматерии` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'ничего';
}

export interface TransportMailInput {
  senderId: string;
  /** Владелец колонии-получателя; null — колония ничья или своя же. */
  recipientId: string | null;
  senderName: string;
  planetName: string;
  systemName: string;
  fleet: UnitLoss[];
  cargo: CargoAmounts;
  /** Рейс в один конец: корабли перешли получателю вместе с грузом. */
  handedOver?: boolean;
}

/**
 * Доставка груза.
 *
 * Чужой колонии уходит второе письмо: без него ресурсы появлялись бы на складе
 * молча, и получатель не знал бы, кого благодарить. Передача флота — событие
 * крупнее доставки, поэтому оба письма про нее говорят прямо: у отправителя
 * кораблей больше нет, у получателя они появились.
 */
export function buildTransportMail(input: TransportMailInput): OutgoingMessage[] {
  const { planetName, systemName, cargo } = input;
  const where = `${planetName} (${systemName})`;
  const payload = {
    kind: 'TRANSPORT' as const,
    planetName,
    systemName,
    cargo,
    fleet: input.fleet,
  };

  const messages: OutgoingMessage[] = [
    {
      recipientId: input.senderId,
      type: 'FLEET',
      subject: input.handedOver ? `Флот передан: ${where}` : `Доставка: ${where}`,
      body:
        `Флот доставил груз на ${where}.\n` +
        `Выгружено: ${describeCargo(cargo)}.\n` +
        `Состав: ${describeFleet(input.fleet)}. ` +
        (input.handedOver
          ? 'Рейс был без возврата: корабли переданы владельцу колонии.'
          : 'Флот возвращается домой.'),
      payload: { ...payload, role: 'SENDER', handedOver: Boolean(input.handedOver) },
    },
  ];

  if (input.recipientId && input.recipientId !== input.senderId) {
    messages.push({
      recipientId: input.recipientId,
      type: 'FLEET',
      subject: input.handedOver ? `Получены корабли: ${where}` : `Получен груз: ${where}`,
      body:
        `На вашу колонию ${where} доставлен груз.\n` +
        `Отправитель: ${input.senderName}.\n` +
        `Получено: ${describeCargo(cargo)}.` +
        (input.handedOver
          ? `\nКорабли остались вам: ${describeFleet(input.fleet)}.`
          : ''),
      payload: {
        ...payload,
        role: 'RECIPIENT',
        senderName: input.senderName,
        handedOver: Boolean(input.handedOver),
      },
    });
  }

  return messages;
}

export interface DeployMailInput {
  commanderId: string;
  baseName: string;
  planetName: string;
  systemName: string;
  fleet: UnitLoss[];
  cargo: CargoAmounts;
}

/** Дислокация: флот прибыл на свою колонию и остается там. */
export function buildDeployMail(input: DeployMailInput): OutgoingMessage[] {
  const where = `${input.planetName} (${input.systemName})`;
  const cargo = cargoTotal(input.cargo) > 0 ? `\nДоставлено: ${describeCargo(input.cargo)}.` : '';

  return [
    {
      recipientId: input.commanderId,
      type: 'FLEET',
      subject: `Дислокация: ${where}`,
      body:
        `Флот прибыл на ${input.baseName} и переведен в состав колонии ${where}.\n` +
        `Прибыло: ${describeFleet(input.fleet)}.${cargo}`,
      payload: {
        kind: 'DEPLOY',
        planetName: input.planetName,
        systemName: input.systemName,
        fleet: input.fleet,
        cargo: input.cargo,
      },
    },
  ];
}

export interface ColonyMailInput {
  commanderId: string;
  baseName: string;
  planetName: string;
  systemName: string;
  galaxyX: number;
  galaxyY: number;
  position: number;
  /** Флот, оставшийся у новой колонии: сам основатель уже разобран. */
  fleet: UnitLoss[];
  cargo: CargoAmounts;
  /** Сколько колоний теперь занято и сколько всего доступно. */
  used: number;
  slots: number;
}

/** Колония основана: планета занята, флот переходит новой базе. */
export function buildColonyMail(input: ColonyMailInput): OutgoingMessage[] {
  const where = `${input.planetName} (${input.systemName})`;
  const coords = `${input.galaxyX}:${input.galaxyY}:${input.position}`;
  const cargo = cargoTotal(input.cargo) > 0 ? `\nВыгружено: ${describeCargo(input.cargo)}.` : '';
  const rest = input.fleet.length > 0 ? `\nОстались у колонии: ${describeFleet(input.fleet)}.` : '';

  return [
    {
      recipientId: input.commanderId,
      type: 'FLEET',
      subject: `Колония основана: ${where}`,
      body:
        `Колониальный транспорт сел на ${where}, координаты ${coords}. ` +
        `Корабль разобран на первую инфраструктуру, база «${input.baseName}» на связи.\n` +
        `Занято колоний: ${input.used} из ${input.slots}.${rest}${cargo}`,
      payload: {
        kind: 'COLONIZE',
        planetName: input.planetName,
        systemName: input.systemName,
        galaxyX: input.galaxyX,
        galaxyY: input.galaxyY,
        position: input.position,
        fleet: input.fleet,
        cargo: input.cargo,
      },
    },
  ];
}

export interface ColonyFailedMailInput {
  commanderId: string;
  planetName: string;
  systemName: string;
  reason: string;
  fleet: UnitLoss[];
}

/**
 * Колонизация сорвалась. Письмо обязательно: рейс односторонний, игрок ждет
 * новую базу и без объяснения увидел бы только вернувшийся домой флот.
 */
export function buildColonyFailedMail(input: ColonyFailedMailInput): OutgoingMessage[] {
  const where = `${input.planetName} (${input.systemName})`;

  return [
    {
      recipientId: input.commanderId,
      type: 'FLEET',
      subject: `Колонизация сорвана: ${where}`,
      body:
        `Высадка на ${where} отменена: ${input.reason}.\n` +
        `Флот возвращается домой, колониальный транспорт цел. ` +
        `Обратный путь топлива не стоил — он не был оплачен при вылете.\n` +
        `В составе: ${describeFleet(input.fleet)}.`,
      payload: {
        kind: 'COLONIZE_FAILED',
        planetName: input.planetName,
        systemName: input.systemName,
        reason: input.reason,
        fleet: input.fleet,
      },
    },
  ];
}

export interface ReturnMailInput {
  commanderId: string;
  baseName: string;
  planetName: string;
  missionLabel: string;
  fleet: UnitLoss[];
  cargo: CargoAmounts;
}

/**
 * Возвращение флота.
 *
 * Письмо шлется только когда флот привез груз. Пустой возврат — это конец
 * рейса, о котором уже был свой отчет (бой, разведка, экспедиция), и второе
 * письмо на каждый вылет удвоило бы ящик, ничего не добавив.
 */
export function buildReturnMail(input: ReturnMailInput): OutgoingMessage[] {
  if (cargoTotal(input.cargo) <= 0) return [];

  return [
    {
      recipientId: input.commanderId,
      type: 'FLEET',
      subject: `Флот вернулся: ${input.missionLabel.toLowerCase()}`,
      body:
        `Флот вернулся на ${input.baseName} (${input.planetName}).\n` +
        `Разгружено: ${describeCargo(input.cargo)}.\n` +
        `Состав: ${describeFleet(input.fleet)}.`,
      payload: {
        kind: 'RETURN',
        planetName: input.planetName,
        missionLabel: input.missionLabel,
        fleet: input.fleet,
        cargo: input.cargo,
      },
    },
  ];
}

/**
 * Письмо цели: у нее над планетой кто-то пролетел.
 *
 * Подробность решает та же лестница, прочитанная с другой стороны: уровень
 * контрразведки говорит не только «заметил ли», но и «что именно понял».
 * Отставая, видишь только чужой след; идя вровень — имя и адрес; опережая —
 * еще и то, что успели прочесть, а это ценнее всего остального: зная,
 * что утекло, понимаешь, к чему готовиться.
 */
export interface IntrusionMailInput {
  commanderId: string;
  planetName: string;
  alert: EspionageAlert;
  detail: EspionageDetail;
  spyName: string;
  spyHome: string | null;
  droneLost: boolean;
}

export function buildIntrusionMail(input: IntrusionMailInput): OutgoingMessage[] {
  const { alert, planetName, spyName, spyHome, detail, droneLost } = input;
  if (alert === 'NONE') return [];

  const leaked =
    detail === 'NONE'
      ? 'Прочесть он ничего не успел.'
      : atLeast(detail, 'TECHS')
        ? 'Он видел всё: склад, флот, оборону и наши технологии.'
        : atLeast(detail, 'FULL_FORCES')
          ? 'Он разобрал склад, флот и оборону по составу.'
          : atLeast(detail, 'DEFENCE_TYPES')
            ? 'Он разобрал нашу оборону по типам и сосчитал флот.'
            : atLeast(detail, 'DEFENCE_COUNT')
              ? 'Он сосчитал наш флот и огневые точки, но типов не разобрал.'
              : 'Он сосчитал вымпелы на орбите, не разобрав классов.';

  const shot = droneLost ? ' Дрон сбит.' : '';

  const body =
    alert === 'PRESENCE'
      ? `Над ${planetName} прошел чужой зонд. Чей — установить не удалось.${shot}`
      : alert === 'IDENTITY'
        ? `Над ${planetName} прошел зонд «${spyName}».${shot}`
        : alert === 'ORIGIN'
          ? `Над ${planetName} прошел зонд «${spyName}»${spyHome ? `, пришел он с ${spyHome}` : ''}.${shot}`
          : `Над ${planetName} прошел зонд «${spyName}»${spyHome ? `, пришел он с ${spyHome}` : ''}.${shot} ${leaked}`;

  return [
    {
      recipientId: input.commanderId,
      type: 'SPY_REPORT',
      subject: alert === 'PRESENCE' ? `Чужой зонд над ${planetName}` : `«${spyName}» шпионил за ${planetName}`,
      body,
      payload: { planetName, alert, spyName: alert === 'PRESENCE' ? null : spyName, spyHome, droneLost },
    },
  ];
}

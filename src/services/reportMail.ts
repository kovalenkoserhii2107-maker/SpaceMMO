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

function describeLoot(loot: { titanite: number; silicate: number; tritium: number }): string {
  const parts = [
    loot.titanite > 0 ? `${loot.titanite} титанита` : null,
    loot.silicate > 0 ? `${loot.silicate} силикатов` : null,
    loot.tritium > 0 ? `${loot.tritium} трития` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'ничего';
}

export interface BattleMailInput {
  attackerId: string;
  defenderId: string;
  attackerName: string;
  defenderName: string;
  planetName: string;
  outcome: BattleOutcome;
  plunder: PlunderResult;
}

export function buildBattleMail(input: BattleMailInput): OutgoingMessage[] {
  const { outcome, plunder, planetName, attackerName, defenderName } = input;
  const attackerWon = outcome.winner === 'ATTACKER';
  const loot = describeLoot(plunder);

  const payload = {
    planetName,
    attackerName,
    defenderName,
    winner: outcome.winner,
    attackerFirepower: Math.round(outcome.attackerPower.firepower),
    defenderFirepower: Math.round(outcome.defenderPower.firepower),
    attackerLosses: outcome.attackerLosses,
    defenderLosses: outcome.defenderLosses,
    attackerDamageReport: outcome.attackerDamageReport,
    defenderDamageReport: outcome.defenderDamageReport,
    plunder: {
      titanite: plunder.titanite,
      silicate: plunder.silicate,
      tritium: plunder.tritium,
      protectedAmount: Math.round(plunder.protectedAmount),
      surplus: Math.round(plunder.surplus),
      cargoLimited: plunder.cargoLimited,
    },
  };

  const attackerBody =
    `Бой у планеты ${planetName}. Противник: ${defenderName}.\n` +
    `Огневая мощь: наша ${payload.attackerFirepower} против ${payload.defenderFirepower}.\n` +
    `Наши потери: ${describeLosses(outcome.attackerLosses)}.\n` +
    `Потери противника: ${describeLosses(outcome.defenderLosses)}.\n` +
    (attackerWon
      ? `Вывезено: ${loot}. Хранилище противника укрыло ${payload.plunder.protectedAmount}` +
        (plunder.cargoLimited ? ', остальное не влезло в трюмы уцелевших.' : '.')
      : 'Атака отбита, трофеев нет.');

  const defenderBody =
    `Наша колония ${planetName} атакована. Нападавший: ${attackerName}.\n` +
    `Огневая мощь: наша ${payload.defenderFirepower} против ${payload.attackerFirepower}.\n` +
    `Наши потери: ${describeLosses(outcome.defenderLosses)}.\n` +
    `Потери нападавшего: ${describeLosses(outcome.attackerLosses)}.\n` +
    (attackerWon
      ? `Со склада вывезено: ${loot}. Хранилище укрыло ${payload.plunder.protectedAmount}.`
      : 'Оборона выстояла, склад цел.');

  return [
    {
      recipientId: input.attackerId,
      type: 'BATTLE_REPORT',
      subject: `${attackerWon ? 'Победа' : 'Поражение'}: атака на ${planetName}`,
      body: attackerBody,
      payload: { ...payload, role: 'ATTACKER' },
    },
    {
      recipientId: input.defenderId,
      type: 'BATTLE_REPORT',
      subject: `${attackerWon ? 'Колония разграблена' : 'Атака отбита'}: ${planetName}`,
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
    titanite: result.loot.titanite,
    silicate: result.loot.silicate,
    tritium: 0,
  });
  const eridium = result.loot.eridium > 0 ? `, эридий ${result.loot.eridium}` : '';

  // Потери экспедиции знает только бой с пиратами: в тихом вылете терять нечего.
  const losses = result.battle ? result.battle.attackerLosses : [];

  const body =
    `Экспедиция в глубокий космос системы ${systemName}.\n` +
    `${result.summary}\n` +
    `Добыча: ${loot}${eridium}.\n` +
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
}

/**
 * Отчет разведки. Отдельное письмо нужно потому, что снимок стареет:
 * в ящике остается зафиксированный момент, даже когда карта уже показывает «???».
 */
export function buildSpyMail(input: SpyMailInput): OutgoingMessage[] {
  const { payload, planetName, systemName } = input;

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

  const stock = payload.resources;
  const fleet = payload.fleet;
  const defenses = payload.defenses;
  const buildings = payload.buildings;

  const fleetLine = fleet
    ? `Флот на орбите: зонды ${fleet.PROBE}, транспорты ${fleet.TRANSPORTER}, ` +
      `истребители ${fleet.LIGHT_FIGHTER}, крейсера ${fleet.HEAVY_CRUISER}, фрегаты ${fleet.ION_FRIGATE}.`
    : 'Флот на орбите: данных нет.';
  const defenseLine = defenses
    ? `Оборона: ракетных установок ${defenses.ROCKET_LAUNCHER}, лазерных орудий ${defenses.LASER_TURRET}.`
    : 'Оборона: данных нет.';
  const stockLine = stock
    ? `Склад: ${stock.titanite} титанита, ${stock.silicate} силикатов, ${stock.tritium} трития.`
    : 'Склад: данных нет.';
  const buildLine = buildings
    ? `Инфраструктура: шахты ${buildings.TITANITE_MINE}/${buildings.SILICATE_MINE}/${buildings.TRITIUM_MINE}, ` +
      `верфь ${buildings.SHIPYARD}, хранилище ${buildings.STORAGE}.`
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
      ].join('\n'),
      payload: { planetName, systemName, ...payload },
    },
  ];
}

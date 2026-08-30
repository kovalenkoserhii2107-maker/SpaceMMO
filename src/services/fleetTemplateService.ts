/**
 * Шаблоны флотов: сохраненные составы для быстрой отправки.
 *
 * Шаблон — это только числа, без привязки к базе: один и тот же «фарм-отряд»
 * выставляется с любой колонии. Наличие кораблей проверяет отправка флота,
 * поэтому шаблон можно сохранить и заранее, под будущий состав.
 */
import { prisma } from '../db/prisma.js';
import { emptyShipCounts, type ShipCounts } from '../game/ships.js';
import { fleetSize } from '../game/fleets.js';

export type TemplateResult =
  | { ok: true; message: string }
  | { ok: false; error: string; status: number };

export interface FleetTemplateView {
  id: string;
  name: string;
  ships: ShipCounts;
  /** Всего кораблей — по нему шаблоны сортируются в списке. */
  size: number;
}

/** Одновременно держим немного шаблонов: список должен оставаться обозримым. */
const MAX_TEMPLATES = 12;
const MAX_NAME_LENGTH = 32;

export function validateTemplateName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (name.length < 2 || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

export async function listTemplates(commanderId: string): Promise<FleetTemplateView[]> {
  const rows = await prisma.fleetTemplate.findMany({
    where: { commanderId },
    orderBy: { name: 'asc' },
  });
  return rows.map(toView);
}

export async function createTemplate(
  commanderId: string,
  name: string,
  ships: ShipCounts,
): Promise<TemplateResult> {
  if (fleetSize(ships) <= 0) {
    return { ok: false, error: 'В шаблоне нет ни одного корабля', status: 400 };
  }

  const count = await prisma.fleetTemplate.count({ where: { commanderId } });
  if (count >= MAX_TEMPLATES) {
    return { ok: false, error: `Больше ${MAX_TEMPLATES} шаблонов не хранится`, status: 409 };
  }

  const existing = await prisma.fleetTemplate.findUnique({
    where: { commanderId_name: { commanderId, name } },
  });
  if (existing) return { ok: false, error: 'Шаблон с таким названием уже есть', status: 409 };

  await prisma.fleetTemplate.create({ data: { commanderId, name, ...toColumns(ships) } });
  return { ok: true, message: `Шаблон «${name}» сохранен` };
}

export async function updateTemplate(
  commanderId: string,
  id: string,
  name: string,
  ships: ShipCounts,
): Promise<TemplateResult> {
  if (fleetSize(ships) <= 0) {
    return { ok: false, error: 'В шаблоне нет ни одного корабля', status: 400 };
  }

  // Владельца проверяем в самом условии обновления: чужой шаблон просто не найдется.
  const template = await prisma.fleetTemplate.findFirst({ where: { id, commanderId } });
  if (!template) return { ok: false, error: 'Шаблон не найден', status: 404 };

  const clash = await prisma.fleetTemplate.findUnique({
    where: { commanderId_name: { commanderId, name } },
  });
  if (clash && clash.id !== id) {
    return { ok: false, error: 'Шаблон с таким названием уже есть', status: 409 };
  }

  await prisma.fleetTemplate.update({ where: { id }, data: { name, ...toColumns(ships) } });
  return { ok: true, message: `Шаблон «${name}» обновлен` };
}

export async function deleteTemplate(commanderId: string, id: string): Promise<TemplateResult> {
  const { count } = await prisma.fleetTemplate.deleteMany({ where: { id, commanderId } });
  if (count === 0) return { ok: false, error: 'Шаблон не найден', status: 404 };
  return { ok: true, message: 'Шаблон удален' };
}

interface TemplateRow {
  id: string;
  name: string;
  probes: number;
  transporters: number;
  lightFighters: number;
  heavyCruisers: number;
  ionFrigates: number;
  recyclers: number;
  colonyShips: number;
}

function toView(row: TemplateRow): FleetTemplateView {
  const ships = emptyShipCounts();
  ships.PROBE = row.probes;
  ships.TRANSPORTER = row.transporters;
  ships.LIGHT_FIGHTER = row.lightFighters;
  ships.HEAVY_CRUISER = row.heavyCruisers;
  ships.ION_FRIGATE = row.ionFrigates;
  ships.RECYCLER = row.recyclers;
  ships.COLONY_SHIP = row.colonyShips;

  return { id: row.id, name: row.name, ships, size: fleetSize(ships) };
}

function toColumns(ships: ShipCounts): Omit<TemplateRow, 'id' | 'name'> {
  return {
    probes: ships.PROBE,
    transporters: ships.TRANSPORTER,
    lightFighters: ships.LIGHT_FIGHTER,
    heavyCruisers: ships.HEAVY_CRUISER,
    ionFrigates: ships.ION_FRIGATE,
    recyclers: ships.RECYCLER,
    colonyShips: ships.COLONY_SHIP,
  };
}

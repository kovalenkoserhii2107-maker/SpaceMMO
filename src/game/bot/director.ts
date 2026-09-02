/**
 * Планировщик ботов: будит их по расписанию и исполняет решения.
 *
 * Единственное место, где бот касается мира, — и касается он его ровно теми же
 * методами, что и живой игрок: `gameLoop.startBuild`, `orderShips`, `sendFleet`,
 * `marketService.placeOrder`. Прямых UPDATE по игровому состоянию здесь нет
 * ни одного, и это не стилистика: тик держит командиров в памяти и периодически
 * сбрасывает их в БД, поэтому запись мимо него живет до ближайшего сброса
 * (правило 12 в CLAUDE.md).
 *
 * Бот не висит в памяти постоянно. Планировщик грузит его на время решения
 * через `getCommander` — с обычным догоном офлайна, — а дальше бота выселяет
 * штатный таймер простоя. Десять ботов стоят примерно как один онлайновый
 * игрок, и офлайн им начисляется по тем же правилам, что и живым.
 */
import { prisma } from '../../db/prisma.js';
import { gameLoop, type ActionResult } from '../gameLoop.js';
import { placeOrder } from '../../services/marketService.js';
import { deliver } from '../../services/mailService.js';
import { emptyShipCounts, type ShipCounts } from '../ships.js';
import { fleetCapacity } from '../fleets.js';
import { normalizeDefenses, normalizeShips } from '../fogOfWar.js';
import { spentOnDefense, spentOnFleet } from '../score.js';
import type { CommanderRuntimeState } from '../baseState.js';
import {
  decide,
  type BotFreePlanet,
  type BotIntent,
  type BotRaidTarget,
  type BotSnapshot,
} from './decide.js';
import {
  DECISION_INTERVAL_MS,
  DECISION_JITTER_MS,
  isBotCharacter,
  type BotCharacter,
} from './personality.js';
import { askReply, askStrategy, llmEnabled, type BotBrief } from './mind.js';
import { PLAN_TTL_MS, readStoredPlan, withPlan, type BotPlan } from './plan.js';

/**
 * Справочная цена ресурса в криптогривне.
 *
 * Своей цены у игры нет: стакан целиком игрокский. Но бот обязан от чего-то
 * отсчитывать коридор, иначе на пустом рынке он выставит первую попавшуюся
 * цену и станет либо бесплатным насосом, либо пылесосом. Отношение взято
 * из относительной скорости добычи: полимеры добываются примерно в полтора
 * раза медленнее руды, значит и стоить должны дороже во столько же.
 */
const REFERENCE_PRICE: Record<'ORE' | 'POLYMERS', number> = { ORE: 10, POLYMERS: 14 };

/** Сколько ботов планировщик обрабатывает за один заход. */
const BATCH = 5;

/** Как часто планировщик просыпается сам. */
const SWEEP_MS = 10_000;

function jitteredNext(now: number): Date {
  return new Date(now + DECISION_INTERVAL_MS + Math.floor(Math.random() * DECISION_JITTER_MS));
}

/* ------------------------- Сбор снимка ------------------------- */

/** Расстояние между системами на макро-карте. */
function distance(a: { galaxyX: number; galaxyY: number }, b: { galaxyX: number; galaxyY: number }): number {
  return Math.hypot(a.galaxyX - b.galaxyX, a.galaxyY - b.galaxyY);
}

/**
 * Что бот знает о мире.
 *
 * Все, что здесь читается, бот мог бы увидеть и сам: свободные планеты и чужие
 * колонии видны на карте, состав обороны — только по своей же разведке.
 * Заглядывать в чужие базы напрямую бот не должен, иначе он играет с картами
 * на столе, а живой игрок — вслепую.
 */
async function buildSnapshot(
  commander: CommanderRuntimeState,
  character: BotCharacter,
): Promise<BotSnapshot | null> {
  const bases = [...commander.bases.values()];
  if (bases.length === 0) return null;

  const home = bases[0]!;
  const homeGalaxy = home.galaxy;

  const [freeRows, foreignRows, scans, orders] = await Promise.all([
    prisma.planet.findMany({
      where: { base: null },
      select: { id: true, systemId: true, system: { select: { galaxyX: true, galaxyY: true } } },
      take: 200,
    }),
    prisma.base.findMany({
      where: { commanderId: { not: commander.commanderId } },
      select: {
        planetId: true,
        commanderId: true,
        commander: { select: { createdAt: true } },
        planet: { select: { system: { select: { galaxyX: true, galaxyY: true } } } },
      },
      take: 200,
    }),
    prisma.planetScan.findMany({
      where: { commanderId: commander.commanderId },
      select: { planetId: true, data: true },
    }),
    // Открытые заявки: без них бот выставлял бы одну и ту же каждые
    // сорок пять секунд — условие, которое ее породило, держится часами.
    prisma.marketOrder.findMany({
      where: { commanderId: commander.commanderId, remaining: { gt: 0 } },
      select: { side: true, resource: true },
    }),
  ]);

  const scanned = new Map<string, number>();
  for (const scan of scans) {
    const payload = scan.data as Record<string, unknown> | null;
    // Снимок разведки — данные из прошлого и переживает изменения игры,
    // поэтому состав нормализуется, а не читается как есть (правило 8).
    const ships = normalizeShips(payload?.['ships'] as never);
    const defenses = normalizeDefenses(payload?.['defenses'] as never);
    scanned.set(scan.planetId, spentOnFleet(ships) + spentOnDefense(defenses));
  }

  const now = Date.now();
  const freePlanets: BotFreePlanet[] = freeRows.map((row) => ({
    planetId: row.id,
    systemId: row.systemId,
    distance: distance(homeGalaxy, row.system),
  }));

  const raidTargets: BotRaidTarget[] = foreignRows.map((row) => ({
    planetId: row.planetId,
    commanderId: row.commanderId,
    accountAgeDays: (now - row.commander.createdAt.getTime()) / 86_400_000,
    knownStrength: scanned.has(row.planetId) ? (scanned.get(row.planetId) as number) : null,
    distance: distance(homeGalaxy, row.planet.system),
  }));

  return {
    character,
    credits: commander.credits,
    techs: commander.techs,
    researching: commander.research !== null,
    bases: bases.map((base) => ({
      id: base.id,
      planetId: base.planetId,
      systemId: base.systemId,
      levels: base.levels,
      richness: base.richness,
      anomaly: base.anomaly,
      resources: base.resources,
      ships: base.ships,
      defenses: base.defenses,
      building: base.buildJob !== null,
      shipQueue: base.shipJobs.length,
      defenseQueue: base.defenseJobs.length,
    })),
    fleetsInFlight: commander.fleets.length,
    freePlanets,
    raidTargets,
    market: [
      { resource: 'ORE', reference: REFERENCE_PRICE.ORE },
      { resource: 'POLYMERS', reference: REFERENCE_PRICE.POLYMERS },
    ],
    openOrders: orders.map((order) => ({
      side: order.side as 'BUY' | 'SELL',
      resource: order.resource as 'ORE' | 'POLYMERS',
    })),
    colonizing: commander.fleets.some((fleet) => fleet.mission === 'COLONIZE'),
  };
}

/* ------------------------- Исполнение ------------------------- */

/**
 * Одно намерение — один вызов того же метода, которым ходит живой игрок.
 * Отказ здесь штатен и ничего не ломает: бот принимал решение по снимку,
 * а за секунды между снимком и вызовом ресурсы мог съесть завершившийся
 * заказ. Следующий заход просто решит заново.
 */
async function execute(commanderId: string, intent: BotIntent): Promise<ActionResult> {
  switch (intent.kind) {
    case 'BUILD':
      return gameLoop.startBuild(commanderId, intent.baseId, intent.building);

    case 'RESEARCH':
      return gameLoop.startResearch(commanderId, intent.baseId, intent.tech);

    case 'SHIPS':
      return gameLoop.orderShips(commanderId, intent.baseId, intent.ship, intent.count);

    case 'DEFENSE':
      return gameLoop.orderDefenses(commanderId, intent.baseId, intent.defense, intent.count);

    case 'COLONIZE': {
      const ships = emptyShipCounts();
      ships.COLONY_SHIP = 1;
      return gameLoop.sendFleet(
        commanderId,
        intent.baseId,
        { planetId: intent.planetId },
        'COLONIZE',
        ships,
        { ore: 0, polymers: 0, plasma: 0 },
      );
    }

    case 'SCAN': {
      const ships = emptyShipCounts();
      ships.PROBE = 1;
      return gameLoop.sendFleet(
        commanderId,
        intent.baseId,
        { planetId: intent.planetId },
        'SCAN',
        ships,
        { ore: 0, polymers: 0, plasma: 0 },
      );
    }

    case 'RAID':
      return gameLoop.sendFleet(
        commanderId,
        intent.baseId,
        { planetId: intent.planetId },
        'ATTACK',
        intent.ships,
        { ore: 0, polymers: 0, plasma: 0 },
      );

    case 'ORDER': {
      const result = await placeOrder(commanderId, {
        side: intent.side,
        resource: intent.resource,
        quantity: intent.amount,
        pricePerUnit: intent.price,
      });
      return result;
    }

    default: {
      // Исчерпывающая проверка: новый вид намерения не проедет молча.
      const never: never = intent;
      return { ok: false, error: `Неизвестное намерение ${JSON.stringify(never)}` };
    }
  }
}

/**
 * Довезти излишек до хаба.
 *
 * Продавать на бирже можно только со склада хаба, а добывается все на базе,
 * поэтому торговля бота — это рейс, а не одна кнопка. Рейс отправляется
 * отдельно от ордеров: пока груз летит, продавать нечего.
 */
async function deliverToHub(
  commanderId: string,
  snapshot: BotSnapshot,
  hubId: string,
): Promise<string | null> {
  const base = snapshot.bases[0];
  if (!base) return null;

  const cargoShips = base.ships.LARGE_CARGO + base.ships.SMALL_CARGO;
  if (cargoShips === 0) return null;

  const ships = emptyShipCounts();
  ships.LARGE_CARGO = base.ships.LARGE_CARGO;
  ships.SMALL_CARGO = base.ships.SMALL_CARGO;

  /*
   * Везем долю излишка, но не больше, чем влезает в трюмы.
   *
   * Без этой обрезки рейс просто не улетал: доля считалась от склада, легко
   * перекрывала вместимость одного транспорта, и sendFleet отвечал отказом.
   * Молча — потому что отказ здесь штатен, — и торговля бота не работала вовсе.
   */
  const hold = fleetCapacity(ships);
  if (hold <= 0) return null;

  // Больше сорока процентов не увозим: остальное нужно самой базе на стройку.
  let ore = Math.floor(base.resources.ore * 0.4);
  let polymers = Math.floor(base.resources.polymers * 0.4);
  if (ore + polymers > hold) {
    // Режем пропорционально, чтобы не вывезти один ресурс целиком.
    const scale = hold / (ore + polymers);
    ore = Math.floor(ore * scale);
    polymers = Math.floor(polymers * scale);
  }
  if (ore + polymers < 100) return null;

  const result = await gameLoop.sendFleet(
    commanderId,
    base.id,
    { hubId },
    'HUB_DELIVERY',
    ships,
    { ore, polymers, plasma: 0 },
  );
  return result.ok ? `отвез в хаб ${ore + polymers}` : null;
}

/* ------------------------- Роли языковой модели ------------------------- */

/**
 * Короткая сводка для стратега.
 *
 * Только то, от чего зависит стратегия: полный снимок базы это сотни чисел,
 * из которых модели нужны единицы, а платим мы за каждое.
 */
async function buildBrief(
  commander: CommanderRuntimeState,
  snapshot: BotSnapshot,
): Promise<BotBrief> {
  const capital = snapshot.bases[0]!;
  const positive = (source: Record<string, number>) =>
    Object.fromEntries(Object.entries(source).filter(([, value]) => value > 0));

  // Соседи глазами бота: позывной, сила и есть ли война. Точный состав чужой
  // обороны сюда не идет — его бот знает только по своей же разведке.
  const wars = await prisma.warDeclaration.findMany({
    // Мир снимает саму запись, поэтому отдельного признака «война окончена»
    // в ней нет: есть строка — есть война.
    where: { OR: [{ aggressorId: commander.commanderId }, { targetId: commander.commanderId }] },
    select: { aggressorId: true, targetId: true },
  });
  const enemies = new Set(
    wars.flatMap((war) => [war.aggressorId, war.targetId]).filter((id) => id !== commander.commanderId),
  );

  const neighbours = await prisma.commander.findMany({
    where: { id: { in: [...new Set(snapshot.raidTargets.map((target) => target.commanderId))] } },
    select: { id: true, nickname: true },
    take: 10,
  });
  const strength = new Map(
    snapshot.raidTargets.map((target) => [target.commanderId, target.knownStrength ?? 0]),
  );

  return {
    nickname: (await prisma.commander.findUnique({
      where: { id: commander.commanderId },
      select: { nickname: true },
    }))?.nickname ?? 'бот',
    colonies: snapshot.bases.length,
    credits: Math.round(commander.credits),
    stock: {
      ore: Math.round(capital.resources.ore),
      polymers: Math.round(capital.resources.polymers),
      plasma: Math.round(capital.resources.plasma),
    },
    levels: positive(capital.levels as unknown as Record<string, number>),
    techs: positive(commander.techs as unknown as Record<string, number>),
    ships: positive(capital.ships as unknown as Record<string, number>),
    defenses: positive(capital.defenses as unknown as Record<string, number>),
    neighbours: neighbours.map((row) => ({
      nickname: row.nickname,
      score: Math.round(strength.get(row.id) ?? 0),
      atWar: enemies.has(row.id),
    })),
    freePlanetsNearby: snapshot.freePlanets.length,
    events: await recentEvents(commander.commanderId),
  };
}

/**
 * Что случилось с ботом за последние часы — по его же почтовому ящику.
 *
 * Отдельного журнала для этого заводить незачем: все, что с ботом происходит,
 * и так приходит ему письмом, как приходило бы живому игроку.
 */
async function recentEvents(commanderId: string): Promise<string[]> {
  const since = new Date(Date.now() - PLAN_TTL_MS);
  const rows = await prisma.message.findMany({
    where: { recipientId: commanderId, createdAt: { gte: since } },
    select: { subject: true },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  return rows.map((row) => row.subject);
}

async function savePlan(botId: string, plan: BotPlan): Promise<void> {
  await prisma.bot.update({
    where: { id: botId },
    data: { memory: { plan: plan as unknown as object, planMadeAt: Date.now() } },
  });
}

/**
 * Ответить на письма живых игроков.
 *
 * Отвечаем только на личные письма и только на непрочитанные: системные отчеты
 * бот получает пачками, и отвечать на собственный боевой отчет незачем.
 * Письмо помечается прочитанным в любом случае — молчание модели не должно
 * приводить к тому, что бот пытается ответить на него снова и снова.
 */
async function answerMail(commanderId: string, character: BotCharacter): Promise<number> {
  if (!llmEnabled()) return 0;

  const letters = await prisma.message.findMany({
    where: { recipientId: commanderId, isRead: false, type: 'PLAYER', senderId: { not: null } },
    select: { id: true, subject: true, body: true, senderId: true, sender: { select: { nickname: true } } },
    orderBy: { createdAt: 'asc' },
    // Потолок на заход: если бота завалили письмами, отвечать на все разом
    // значит и заход растянуть, и токены сжечь.
    take: 3,
  });
  if (letters.length === 0) return 0;

  await prisma.message.updateMany({
    where: { id: { in: letters.map((letter) => letter.id) }, recipientId: commanderId },
    data: { isRead: true },
  });

  let sent = 0;
  for (const letter of letters) {
    const text = await askReply(
      character,
      letter.sender?.nickname ?? 'неизвестный',
      letter.subject,
      letter.body,
    );
    if (!text || !letter.senderId) continue;

    await deliver([
      {
        recipientId: letter.senderId,
        senderId: commanderId,
        type: 'PLAYER',
        subject: `Re: ${letter.subject}`.slice(0, 120),
        body: text,
      },
    ]);
    sent += 1;
  }
  return sent;
}

/* ------------------------- Заход бота ------------------------- */

export interface BotTurn {
  commanderId: string;
  nickname: string;
  actions: string[];
}

/**
 * Один заход одного бота: снимок → решения → исполнение.
 *
 * Экспортируется отдельно от планировщика, чтобы админка могла разбудить
 * бота вручную и сразу показать, что он сделал.
 */
export async function runBotTurn(botId: string): Promise<BotTurn | null> {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: {
      id: true,
      character: true,
      commanderId: true,
      memory: true,
      commander: { select: { nickname: true } },
    },
  });
  if (!bot || !isBotCharacter(bot.character)) return null;

  const commander = await gameLoop.getCommander(bot.commanderId);
  if (!commander) return null;

  const snapshot = await buildSnapshot(commander, bot.character);
  if (!snapshot) return null;

  const actions: string[] = [];

  /*
   * Стратегию бот переосмысливает редко — раз в несколько часов. Спрашивать
   * модель на каждом заходе значило бы отдавать ей арифметику, которую код
   * считает точнее, и платить за это в сотни раз больше: план раз в шесть
   * часов стоит около четырех тысяч токенов в сутки, вызов на каждый заход —
   * почти два миллиона.
   */
  let plan = readStoredPlan(bot.memory, bot.character);
  if (llmEnabled() && (!plan || Date.now() - plan.madeAt > PLAN_TTL_MS)) {
    const fresh = await askStrategy(bot.character, await buildBrief(commander, snapshot));
    if (fresh) {
      plan = { plan: fresh, madeAt: Date.now() };
      await savePlan(bot.id, fresh);
      actions.push(`ПЛАН: ${fresh.note || 'стратегия обновлена'}`);
    }
  }

  const profile = withPlan(bot.character, plan?.plan ?? null);
  for (const intent of decide(snapshot, profile)) {
    const result = await execute(bot.commanderId, intent);
    if (result.ok) actions.push(`${intent.kind}: ${intent.why}`);
  }

  // Дипломат: ответы на письма живых игроков.
  const replied = await answerMail(bot.commanderId, bot.character);
  if (replied > 0) actions.push(`ОТВЕТ: писем ${replied}`);

  // Торговый рейс идет после решений: ордера бот выставляет с того, что уже
  // лежит в хабе, а этот рейс наполняет хаб к следующему заходу.
  const hub = await prisma.tradeHub.findFirst({
    where: { system: { planets: { some: { base: { commanderId: bot.commanderId } } } } },
    select: { id: true },
  });
  if (hub) {
    const delivery = await deliverToHub(bot.commanderId, snapshot, hub.id);
    if (delivery) actions.push(delivery);
  }

  const last = actions[actions.length - 1] ?? null;
  await prisma.bot.update({
    where: { id: bot.id },
    data: {
      nextDecisionAt: jitteredNext(Date.now()),
      ...(last ? { lastAction: last, lastActionAt: new Date() } : {}),
    },
  });

  return { commanderId: bot.commanderId, nickname: bot.commander.nickname, actions };
}

/* ------------------------- Планировщик ------------------------- */

class BotDirector {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweep();
    }, SWEEP_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Заход планировщика: берет подошедших по расписанию и водит их по очереди. */
  private async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const due = await prisma.bot.findMany({
        where: { active: true, nextDecisionAt: { lte: new Date() } },
        select: { id: true },
        orderBy: { nextDecisionAt: 'asc' },
        take: BATCH,
      });

      for (const bot of due) {
        try {
          await runBotTurn(bot.id);
        } catch (error) {
          // Один сорвавшийся бот не должен останавливать остальных: расписание
          // все равно сдвигаем, иначе он застрянет и будет выбираться каждый заход.
          console.error(`[bot] заход ${bot.id} сорвался`, error);
          await prisma.bot
            .update({ where: { id: bot.id }, data: { nextDecisionAt: jitteredNext(Date.now()) } })
            .catch(() => undefined);
        }
      }
    } catch (error) {
      console.error('[bot] заход планировщика сорвался', error);
    } finally {
      this.running = false;
    }
  }
}

export const botDirector = new BotDirector();
export type { ShipCounts };

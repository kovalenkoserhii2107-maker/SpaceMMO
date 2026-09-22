/**
 * Разбор решений живых ботов по копии базы: что бот хочет построить,
 * чего ему не хватает и какие намерения выдает `decide`.
 *
 * Запускать только по копии, а не по боевой базе: загрузка командира
 * догоняет его таймеры, и второй процесс поверх живого мира затер бы их
 * (правило 12). Ничего не исполняет — только печатает.
 *
 *   DATABASE_URL=<копия> npx tsx src/scripts/botDiag.ts
 */
import { writeFileSync } from 'node:fs';
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import { buildSnapshot } from '../game/bot/director.js';
import { buildingPlan, decide, syndicateGoal } from '../game/bot/decide.js';
import { isBotCharacter } from '../game/bot/personality.js';
import { readStoredPlan, withPlan } from '../game/bot/plan.js';
import { creditOutput, productionPerSecond, storageCapacities, systemModifiers, upgradeCost } from '../game/rules.js';
import { cryptoBonus, economyBonuses, researchCost, timeCompressionDrain } from '../game/techTree.js';

const round = (value: number) => Math.round(value).toLocaleString('ru-RU');
const triple = (r: { ore: number; polymers: number; plasma: number }) =>
  `${round(r.ore)} / ${round(r.polymers)} / ${round(r.plasma)}`;

/*
 * `--dump <файл>` пишет ботов в стартовый файл прогона (`npm run forecast --
 * 2 --from <файл>`): так правку можно проверить на живом мире, а не только
 * на новой расстановке. Берется столица — прогон знает одну базу на бота.
 */
const dumpAt = process.argv.indexOf('--dump');
const dumpPath = dumpAt > 0 ? process.argv[dumpAt + 1] : undefined;
const dump: { bots: unknown[]; trades: unknown[] } = { bots: [], trades: [] };

const bots = await prisma.bot.findMany({
  select: { character: true, commanderId: true, memory: true, commander: { select: { nickname: true } } },
  orderBy: { commander: { nickname: 'asc' } },
});

for (const bot of bots) {
  if (!isBotCharacter(bot.character)) continue;
  const commander = await gameLoop.getCommander(bot.commanderId);
  if (!commander) continue;
  const snapshot = await buildSnapshot(commander, bot.character, bot.memory);
  if (!snapshot) continue;

  const profile = withPlan(bot.character, readStoredPlan(bot.memory, bot.character)?.plan ?? null);
  const capital = snapshot.bases[0]!;

  if (dumpPath) {
    const now = Date.now();
    const live = [...commander.bases.values()][0]!;
    const left = (at: number) => Math.max(0, (at - now) / 1000);
    dump.bots.push({
      name: bot.commander.nickname,
      character: bot.character,
      richness: capital.richness,
      // Орбита решает дорогу до хаба, а с ней время рейса и топливо.
      position: live.position,
      levels: capital.levels,
      techs: snapshot.techs,
      stock: { ore: capital.resources.ore, polymers: capital.resources.polymers, plasma: capital.resources.plasma },
      credits: snapshot.credits,
      ships: capital.ships,
      defenses: capital.defenses,
      hub: { ore: snapshot.hubStorage.ore, polymers: snapshot.hubStorage.polymers, level: snapshot.hubStorage.level },
      build: live.buildJob
        ? {
            type: live.buildJob.building,
            left: left(live.buildJob.finishesAt),
            total: Math.max(1, (live.buildJob.finishesAt - live.buildJob.startedAt) / 1000),
          }
        : null,
      research: commander.research ? { tech: commander.research.tech, left: left(commander.research.finishesAt) } : null,
      shipJobs: live.shipJobs.map((job) => ({
        type: job.type,
        count: job.remaining,
        left: left(job.nextUnitAt) + job.unitSeconds * Math.max(0, job.remaining - 1),
      })),
      defenseJobs: live.defenseJobs.map((job) => ({
        type: job.type,
        count: job.remaining,
        left: left(job.nextUnitAt) + job.unitSeconds * Math.max(0, job.remaining - 1),
      })),
    });
  }
  const caps = storageCapacities(capital.levels);
  const rate = productionPerSecond(
    capital.levels,
    capital.richness,
    economyBonuses(snapshot.techs),
    0,
    systemModifiers(capital.anomaly),
    timeCompressionDrain(snapshot.techs),
  );

  console.log(`\n===== ${bot.commander.nickname} (${bot.character}) ₴${round(snapshot.credits)}`);
  console.log(`  склад      ${triple(capital.resources)}`);
  console.log(`  вмест.     ${triple(caps)}`);
  console.log(`  добыча/ч   ${triple({ ore: rate.ore * 3600, polymers: rate.polymers * 3600, plasma: rate.plasma * 3600 })}`);
  console.log(`  ферма/ч    ₴${round(creditOutput(capital.levels, cryptoBonus(snapshot.techs)) * 3600)}`);
  console.log(`  бюджет     ${JSON.stringify(profile.budget)}`);
  console.log(`  стройка идет: ${capital.building}, наука идет: ${snapshot.researching}`);

  const plan = buildingPlan(capital, snapshot.techs, bot.character, profile);
  // Часы собственной добычи до цены — тот же счет, что у горизонта накопления.
  const hoursTo = (cost: { ore: number; polymers: number; plasma: number }) => {
    let hours = 0;
    for (const resource of ['ore', 'polymers', 'plasma'] as const) {
      const gap = cost[resource] - Math.max(0, capital.resources[resource]);
      if (gap > 0) hours = Math.max(hours, rate[resource] > 0 ? gap / (rate[resource] * 3600) : Infinity);
    }
    return hours === Infinity ? '∞' : `${hours.toFixed(1)} ч`;
  };
  for (const type of plan.slice(0, 5)) {
    const cost = upgradeCost(type, capital.levels[type] + 1);
    console.log(`  план  ${type.padEnd(16)} → ${capital.levels[type] + 1}: ${triple(cost)}  (${hoursTo(cost)})`);
  }
  const researchShare = profile.budget.research;
  for (const tech of profile.researchOrder.slice(0, 4)) {
    const cost = researchCost(tech, snapshot.techs[tech] + 1);
    const inShare = (['ore', 'polymers', 'plasma'] as const).every(
      (resource) => cost[resource] <= capital.resources[resource] * researchShare,
    );
    console.log(`  наука ${tech.padEnd(18)} → ${snapshot.techs[tech] + 1}: ${triple(cost)}  (${hoursTo(cost)}, в доле ${inShare ? 'да' : 'нет'})`);
  }
  console.log(`  рынок ${snapshot.market.map((m) => `${m.resource} ${m.reference} skew ${m.skew}`).join('; ')}`);
  console.log(`  хаб   руда ${round(snapshot.hubStorage.ore)} пол ${round(snapshot.hubStorage.polymers)} свободно ${round(snapshot.hubStorage.free)}`);
  const own = snapshot.syndicate;
  if (own) {
    const goal = syndicateGoal(own, profile.syndicateFocus);
    console.log(
      `  синд  [${own.tag}] ${own.members}/${own.memberCap} казна ₴${round(own.bank.credits)} р ${round(own.bank.ore)} п ${round(own.bank.polymers)}` +
        ` | Академия ${own.academyLevel} | заявок ${own.applications.length} | цель ${goal ? `${goal.key} (₴${round(goal.cost.credits)} р ${round(goal.cost.ore)} п ${round(goal.cost.polymers)})` : '—'}`,
    );
  }
  console.log(
    `  синдикаты ${snapshot.syndicates.map((item) => `[${item.tag}] ${item.members}/${item.memberCap}${item.sameSystem ? ' рядом' : ''}`).join(', ') || '—'}`,
  );

  for (const intent of decide(snapshot, profile)) {
    const detail =
      'building' in intent ? intent.building
      : 'tech' in intent ? intent.tech
      : intent.kind === 'TAKE' ? `${intent.amount}`
      : intent.kind === 'ORDER' ? `${intent.side} ${intent.resource} ${intent.amount}@${intent.price}`
      : '';
    console.log(`  → ${intent.kind} ${detail} — ${'why' in intent ? intent.why : ''}`);
  }
}

if (dumpPath) {
  dump.trades = await prisma.trade.findMany({
    orderBy: { createdAt: 'desc' },
    select: { resource: true, pricePerUnit: true, quantity: true },
    take: 60,
  });
  writeFileSync(dumpPath, JSON.stringify(dump, null, 1));
  console.log(`\nдамп: ${dumpPath}, ботов ${dump.bots.length}`);
}

process.exit(0);

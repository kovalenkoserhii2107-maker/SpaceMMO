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
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import { buildSnapshot } from '../game/bot/director.js';
import { buildingPlan, decide } from '../game/bot/decide.js';
import { isBotCharacter } from '../game/bot/personality.js';
import { readStoredPlan, withPlan } from '../game/bot/plan.js';
import { creditOutput, productionPerSecond, storageCapacities, systemModifiers, upgradeCost } from '../game/rules.js';
import { cryptoBonus, economyBonuses, researchCost, timeCompressionDrain } from '../game/techTree.js';

const round = (value: number) => Math.round(value).toLocaleString('ru-RU');
const triple = (r: { ore: number; polymers: number; plasma: number }) =>
  `${round(r.ore)} / ${round(r.polymers)} / ${round(r.plasma)}`;

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
  for (const type of plan.slice(0, 5)) {
    const cost = upgradeCost(type, capital.levels[type] + 1);
    console.log(`  план  ${type.padEnd(16)} → ${capital.levels[type] + 1}: ${triple(cost)}`);
  }
  for (const tech of profile.researchOrder.slice(0, 4)) {
    const cost = researchCost(tech, snapshot.techs[tech] + 1);
    console.log(`  наука ${tech.padEnd(18)} → ${snapshot.techs[tech] + 1}: ${triple(cost)}`);
  }
  console.log(`  рынок ${snapshot.market.map((m) => `${m.resource} ${m.reference} skew ${m.skew}`).join('; ')}`);
  console.log(`  хаб   руда ${round(snapshot.hubStorage.ore)} пол ${round(snapshot.hubStorage.polymers)} свободно ${round(snapshot.hubStorage.free)}`);

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

process.exit(0);

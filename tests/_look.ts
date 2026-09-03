import { prisma } from '../src/db/prisma.js';
import { marketPrice } from '../src/game/market.js';
import { storageCapacities } from '../src/game/rules.js';
import { readSpend, DAILY_BUDGET } from '../src/game/bot/budget.js';

const names = new Map((await prisma.commander.findMany({ select: { id: true, nickname: true } })).map(c => [c.id, c.nickname]));
const trades = await prisma.trade.findMany({ orderBy: { createdAt: 'desc' }, take: 120,
  select: { resource: true, pricePerUnit: true, quantity: true, createdAt: true, sellerId: true, buyerId: true } });

console.log('=== Рынок ===');
for (const r of ['ORE', 'POLYMERS'] as const) {
  const { price, seeded } = marketPrice(r, trades);
  const day = trades.filter(t => t.resource === r);
  const oldest = day.length ? day[day.length - 1]!.pricePerUnit : null;
  console.log(`  ${r}: ${price}${seeded ? ' (затравка)' : ''}${oldest ? `  (за окно сделок: ${oldest} → ${day[0]!.pricePerUnit})` : ''}`);
}
for (const mins of [20, 180]) {
  const recent = trades.filter(t => t.createdAt.getTime() >= Date.now() - mins * 60_000);
  const pairs = new Map<string, number>();
  for (const t of recent) { const k = `${names.get(t.sellerId)} → ${names.get(t.buyerId)} ${t.resource}`; pairs.set(k, (pairs.get(k) ?? 0) + 1); }
  console.log(`  сделок за ${mins} мин: ${recent.length}`);
  for (const [k, n] of [...pairs].sort((a,b)=>b[1]-a[1]).slice(0, 6)) console.log(`    ${n} × ${k}`);
}
console.log('\n  Стакан:');
const book = await prisma.marketOrder.findMany({ where: { remaining: { gt: 0 } }, orderBy: [{ resource: 'asc' }, { pricePerUnit: 'asc' }] });
if (!book.length) console.log('    пуст');
for (const o of book) console.log(`    ${names.get(o.commanderId)} ${o.side} ${o.resource} ${Math.round(o.remaining)} по ${o.pricePerUnit}`);

console.log('\n=== Боты ===');
let calls = 0, letters = 0;
for (const b of await prisma.commander.findMany({ where: { user: { role: 'BOT' } }, include: { bases: { include: { ships: true, defenses: true } }, bot: true } })) {
  const base = b.bases[0]!; const lv = base as unknown as Record<string, number>;
  const levels = { ORE_MINE: lv['oreMineLevel']!, POLYMER_PLANT: lv['polymerPlantLevel']!, PLASMA_REACTOR: lv['plasmaReactorLevel']!,
    POWER_PLANT: lv['powerPlantLevel']!, SCIENCE_CENTER: lv['scienceCenterLevel']!, SHIPYARD: lv['shipyardLevel']!,
    ANTIMATTER_FACTORY: lv['antimatterFactoryLevel']!, CRYPTO_FARM: lv['cryptoFarmLevel']!,
    ORE_STORAGE: lv['oreStorageLevel']!, POLYMER_STORAGE: lv['polymerStorageLevel']!, PLASMA_STORAGE: lv['plasmaStorageLevel']! };
  const caps = storageCapacities(levels as never);
  const spend = readSpend(b.bot?.memory); calls += spend.calls; letters += spend.letters;
  const mem = (b.bot?.memory ?? {}) as Record<string, unknown>;
  const plan = mem['plan'] as Record<string, unknown> | undefined;
  const age = ((Date.now() - b.createdAt.getTime()) / 3600_000).toFixed(1);
  const pct = (v: number, c: number) => `${Math.round((v/c)*100)}%`;
  console.log(`\n  ${b.nickname} (${b.bot?.character}, ${age} ч, колоний ${b.bases.length}) — ${Math.round(b.credits)} ₴`);
  console.log(`    шахты ${lv['oreMineLevel']}/${lv['polymerPlantLevel']}/${lv['plasmaReactorLevel']}, энергия ${lv['powerPlantLevel']}, лаб ${lv['scienceCenterLevel']}, верфь ${lv['shipyardLevel']}, ФЕРМА ${lv['cryptoFarmLevel']}`);
  console.log(`    склад: руда ${pct(base.ore, caps.ore)}, полимеры ${pct(base.polymers, caps.polymers)}, плазма ${pct(base.plasma, caps.plasma)}`);
  console.log(`    флот: ${base.ships.filter(x=>x.count>0).map(x=>`${x.type} ${x.count}`).join(', ') || 'пусто'}`);
  console.log(`    оборона: ${base.defenses.filter(x=>x.count>0).map(x=>`${x.type} ${x.count}`).join(', ') || 'пусто'}`);
  console.log(`    вызовов ${spend.calls}, писем ${spend.letters}; замысел: ${plan?.['note'] ?? '—'}`);
  const j = (mem['journal'] ?? []) as string[];
  if (j.length) console.log(`    журнал: ${j.slice(-3).join(' | ')}`);
}
console.log(`\n  Модель: ${calls} вызовов из ${DAILY_BUDGET}, писем ${letters}`);
const all = await prisma.commander.findMany({ select: { credits: true } });
console.log(`  Денежная масса: ${Math.round(all.reduce((s,c)=>s+c.credits,0))} ₴`);
const wars = await prisma.warDeclaration.count();
const battles = await prisma.battleReport.count({ where: { createdAt: { gte: new Date(Date.now() - 6*3600_000) } } });
console.log(`  Войн: ${wars}, боев за 6 часов: ${battles}`);
await prisma.$disconnect();

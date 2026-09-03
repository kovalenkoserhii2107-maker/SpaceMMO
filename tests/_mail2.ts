import { prisma } from '../src/db/prisma.js';
import { readSpend } from '../src/game/bot/budget.js';
const me = await prisma.commander.findFirst({ where: { nickname: 'LoRaWAN' } });
const inbox = await prisma.message.findMany({
  where: { recipientId: me!.id, type: 'PLAYER' },
  include: { sender: { select: { nickname: true } } },
  orderBy: { createdAt: 'desc' }, take: 40,
});
console.log(`Писем от игроков всего: ${inbox.length}`);
const bySubject = new Map<string, number>();
for (const m of inbox) {
  const k = `${m.sender?.nickname}: ${m.subject}`;
  bySubject.set(k, (bySubject.get(k) ?? 0) + 1);
}
for (const [k, n] of [...bySubject].sort((a,b)=>b[1]-a[1])) console.log(`  ${n} × ${k}`);
console.log('\nПоследние 8 с временем:');
for (const m of inbox.slice(0, 8)) console.log(`  ${m.createdAt.toLocaleString('ru')} ${m.sender?.nickname}: ${m.subject}`);
console.log('\nПамять Купця:');
const b = await prisma.bot.findFirst({ where: { commander: { nickname: 'Купець' } } });
const mem = (b!.memory ?? {}) as Record<string, unknown>;
console.log('  rallied:', JSON.stringify(mem['rallied']));
console.log('  spend:', JSON.stringify(readSpend(b!.memory)));
await prisma.$disconnect();

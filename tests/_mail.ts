import { prisma } from '../src/db/prisma.js';
const me = await prisma.commander.findFirst({ where: { nickname: 'LoRaWAN' } });
console.log('=== письма мне за 6 часов ===');
const inbox = await prisma.message.findMany({
  where: { recipientId: me!.id, createdAt: { gte: new Date(Date.now() - 6 * 3600_000) } },
  include: { sender: { select: { nickname: true } } },
  orderBy: { createdAt: 'desc' }, take: 25,
});
for (const m of inbox) console.log(`  ${m.createdAt.toLocaleTimeString('ru')} от ${m.sender?.nickname ?? 'система'} [${m.type}] ${m.subject}`);
console.log(`\n=== мои письма ботам ===`);
const out = await prisma.message.findMany({
  where: { senderId: me!.id }, include: { recipient: { select: { nickname: true } } },
  orderBy: { createdAt: 'desc' }, take: 10,
});
for (const m of out) console.log(`  ${m.createdAt.toLocaleTimeString('ru')} → ${m.recipient.nickname}: «${m.subject}» прочитано=${m.isRead}`);
console.log('\n=== память ботов ===');
for (const b of await prisma.bot.findMany({ include: { commander: { select: { nickname: true } } } })) {
  const m = (b.memory ?? {}) as Record<string, unknown>;
  console.log(`  ${b.commander.nickname}: ключи [${Object.keys(m).join(', ')}]`);
}
await prisma.$disconnect();

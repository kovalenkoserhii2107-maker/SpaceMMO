import { prisma } from '../src/db/prisma.js';
import { storageCapacity, storageUsed } from '../src/game/market.js';
const names = new Map((await prisma.commander.findMany({ select: { id: true, nickname: true } })).map(c => [c.id, c.nickname]));
for (const s of await prisma.hubStorage.findMany()) {
  const cap = storageCapacity(s.level);
  const used = storageUsed(s);
  console.log(`${names.get(s.commanderId) ?? s.commanderId}: ур.${s.level} вместимость ${cap}, лежит ${Math.round(used)} (руда ${Math.round(s.ore)}, полимеры ${Math.round(s.polymers)}), свободно ${Math.round(cap - used)}`);
}
await prisma.$disconnect();

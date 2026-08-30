/**
 * Выдача и снятие роли администратора.
 *
 * Роль не выдается через игровой API ни при каких условиях — только этим
 * скриптом с доступом к серверу. Иначе повышение прав стало бы частью
 * поверхности атаки: любая дыра в игровых роутах превращалась бы в God Mode.
 *
 * Запуск: npm run admin:grant -- <email> [--revoke]
 */
import { prisma } from '../db/prisma.js';

const email = process.argv[2]?.trim().toLowerCase();
const revoke = process.argv.includes('--revoke');

if (!email) {
  console.error('Использование: npm run admin:grant -- <email> [--revoke]');
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
if (!user) {
  console.error(`[admin] аккаунт ${email} не найден`);
  await prisma.$disconnect();
  process.exit(1);
}

const role = revoke ? 'USER' : 'ADMIN';
await prisma.user.update({ where: { id: user.id }, data: { role } });
console.log(`[admin] ${email}: ${user.role} → ${role}`);

await prisma.$disconnect();

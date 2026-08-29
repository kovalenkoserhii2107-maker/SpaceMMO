/**
 * Выдача пароля легаси-аккаунту.
 *
 * Аккаунты, созданные до появления авторизации, мигрировали без пароля: у них
 * служебный email вида <id>@legacy.local и пустой passwordHash. Скрипт задает им
 * пароль и, при желании, нормальный email — чтобы старыми командирами можно было играть.
 *
 * Запуск: npm run legacy:password -- <позывной> <пароль> [email]
 */
import { prisma } from '../db/prisma.js';
import { hashPassword, validateEmail, validatePassword } from '../services/authService.js';

const [nickname, password, email] = process.argv.slice(2);

if (!nickname || !password) {
  console.error('Использование: npm run legacy:password -- <позывной> <пароль> [email]');
  process.exit(1);
}

const commander = await prisma.commander.findUnique({
  where: { nickname },
  include: { user: true },
});
if (!commander) {
  console.error(`Командир «${nickname}» не найден`);
  process.exit(1);
}

if (!validatePassword(password)) {
  console.error('Пароль должен быть от 8 до 128 символов');
  process.exit(1);
}

const nextEmail = email ? validateEmail(email) : null;
if (email && !nextEmail) {
  console.error('Некорректный email');
  process.exit(1);
}

await prisma.user.update({
  where: { id: commander.userId },
  data: {
    passwordHash: await hashPassword(password),
    ...(nextEmail ? { email: nextEmail } : {}),
  },
});

console.log(`[legacy] пароль установлен для «${nickname}» (${nextEmail ?? commander.user.email})`);
await prisma.$disconnect();

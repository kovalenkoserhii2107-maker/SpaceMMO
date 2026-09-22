/**
 * Сверка карты `el` в `public/app.js` с ее использованием и с разметкой.
 *
 * `audit:client` ловит только необъявленные имена, а обращение к полю
 * объекта для него законно. Забытый в карте узел поэтому проходил все
 * проверки и падал уже в браузере: `el.cargoPlasmaLabel` не был объявлен,
 * `syncCargoLimits` валилась на третьей строке груза и уносила с собой весь
 * хвост настройки формы по миссии — лишний груз висел на шпионском зонде.
 *
 * Проверяется две вещи:
 *   1. каждое `el.имя` в коде объявлено в карте;
 *   2. каждый `$('id')` из карты есть в `index.html` — карта собирается
 *      при загрузке, до всякой динамической разметки, и отсутствующий id
 *      молча дает `null`, который упадет при первом обращении.
 *
 * Запуск: npm run audit:client (идет следом за проверкой имен).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = readFileSync(path.join(root, 'public/app.js'), 'utf8');
const html = readFileSync(path.join(root, 'public/index.html'), 'utf8');

const start = app.indexOf('const el = {');
if (start < 0) {
  console.error('[audit:client] карта `el` не найдена в public/app.js');
  process.exit(1);
}
const end = app.indexOf('\n  };', start);
const block = app.slice(start, end);

const declared = new Map<string, string | null>();
for (const match of block.matchAll(/^\s{4}([A-Za-z_$][\w$]*):\s*(.+?),?\s*$/gm)) {
  const id = /^\$\('([^']+)'\)$/.exec(match[2]!.replace(/,$/, ''))?.[1] ?? null;
  declared.set(match[1]!, id);
}

/*
 * Имена, собираемые из частей: `el[\`res${Key}\`]` в шапке ресурсов.
 * Проверять их по коду нечем, поэтому они перечислены здесь и сверяются
 * с картой так же, как прямые обращения.
 */
const COMPOSED = ['resOre', 'resPolymers', 'resPlasma'];

const used = new Map<string, number>();
const lines = app.split('\n');
lines.forEach((line, index) => {
  for (const match of line.matchAll(/(?<![.\w$])el\.([A-Za-z_$][\w$]*)/g)) {
    if (!used.has(match[1]!)) used.set(match[1]!, index + 1);
  }
});
for (const name of COMPOSED) if (!used.has(name)) used.set(name, 0);

const problems: string[] = [];
for (const [name, line] of used) {
  if (!declared.has(name)) {
    problems.push(`el.${name} не объявлен в карте \`el\`${line ? ` (первое обращение — app.js:${line})` : ''}`);
  }
}
for (const [name, id] of declared) {
  if (id && !html.includes(`id="${id}"`)) {
    problems.push(`el.${name} ищет #${id}, а в index.html такого id нет`);
  }
}

if (problems.length) {
  console.error(`[audit:client] карта \`el\` расходится с кодом или разметкой:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`[audit:client] карта \`el\`: ${declared.size} узлов, ${used.size} обращений — сходится`);

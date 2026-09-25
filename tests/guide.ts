/**
 * База знаний: статьи собираются игровыми формулами, и ошибка в них видна
 * игроку текстом «NaN» или «undefined» посреди справки. Проверяем, что
 * сборка не роняется, числа в тексте настоящие, а каждая ссылка
 * «Как это работает» из интерфейса ведет на существующую статью.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gameGuide } from '../src/game/guide.js';

const results: Array<{ name: string; passed: boolean }> = [];
function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

const articles = gameGuide();
const ids = new Set(articles.map((article) => article.id));

console.log('\n=== 1. Статьи ===');
check('статьи собираются', articles.length > 0, `${articles.length}`);
check('идентификаторы не повторяются', ids.size === articles.length);
check('у каждой статьи есть раздел, заголовок, суть и содержание',
  articles.every((article) => article.section && article.title && article.summary && article.blocks.length > 0));

const text = JSON.stringify(articles);
const broken = text.match(/.{0,40}(NaN|undefined|Infinity|\[object Object\]).{0,20}/);
check('в тексте нет NaN, undefined и Infinity', broken === null, broken?.[0]);

const tables = articles.flatMap((article) => article.blocks.filter((block) => block.kind === 'table'));
check('строки таблиц той же ширины, что заголовок',
  tables.every((block) => block.kind === 'table' && block.rows.every((row) => row.length === block.head.length)));

check('картинок в таблице столько же, сколько строк',
  tables.every((block) => block.kind !== 'table' || !block.icons || block.icons.length === block.rows.length));

/*
 * Отсутствующий файл клиент прячет, а не ломает, поэтому глазами пропажу
 * не заметить: статья просто окажется без картинки. Сверяем с диском.
 */
const images = articles.flatMap((article) => [
  article.cover.src,
  ...article.blocks.flatMap((block) =>
    block.kind === 'figures' ? block.items.map((item) => item.src)
      : block.kind === 'table' ? (block.icons ?? []).filter((icon): icon is string => icon !== null) : []),
]);
const lost = [...new Set(images)].filter((src) => !existsSync(new URL(`../public${src}`, import.meta.url)));
check('у каждой статьи есть обложка, и все картинки лежат в public/assets', lost.length === 0, lost.join(', '));

console.log('\n=== 2. Ссылки из интерфейса ===');
const client = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8') +
  readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const linked = [...client.matchAll(/data-guide="([a-z-]+)"/g)].map((match) => match[1]!);
check('ссылки на базу знаний есть', linked.length > 0, `${linked.length}`);
const missing = linked.filter((id) => !ids.has(id));
check('каждая ссылка ведет на существующую статью', missing.length === 0, missing.join(', '));

const passed = results.filter((row) => row.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);

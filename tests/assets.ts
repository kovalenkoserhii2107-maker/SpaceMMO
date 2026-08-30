/**
 * Растровые иллюстрации: соответствие файлов и типов объектов.
 *
 * Имя файла выводится из типа в нижнем регистре, таблицы соответствий в коде нет.
 * Ровно поэтому нужен этот тест: несовпадение имени ничего не ломает — карточка
 * молча показывает заглушку, и подмена замечается только глазами. Тест делает
 * такую опечатку видимой сразу.
 *
 * Отсутствие файла — не ошибка: заглушка предусмотрена, и новый класс объекта
 * может появиться раньше, чем для него нарисуют картинку. Тест разделяет
 * «картинки пока нет» и «картинка есть, но лежит не под тем именем».
 *
 * Запуск: npm run test:assets
 */
import { existsSync, readdirSync } from 'node:fs';
import { DEFENSE_TYPES } from '../src/game/defenses.js';
import { BUILDING_TYPES } from '../src/game/rules.js';
import { SHIP_TYPES } from '../src/game/ships.js';
import { TECHNOLOGY_TYPES } from '../src/game/techTree.js';

const results: Array<{ name: string; passed: boolean }> = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

const ROOT = 'public/assets';
const GROUPS: Array<{ folder: string; kind: string; types: readonly string[] }> = [
  { folder: 'buildings', kind: 'постройки', types: BUILDING_TYPES },
  { folder: 'ships', kind: 'корабли', types: SHIP_TYPES },
  { folder: 'defense', kind: 'оборона', types: DEFENSE_TYPES },
  { folder: 'tech', kind: 'технологии', types: TECHNOLOGY_TYPES },
];

console.log('\n=== Папки и соответствие имен ===');

for (const group of GROUPS) {
  const dir = `${ROOT}/${group.folder}`;
  check(`${group.kind}: папка ${group.folder}/ существует`, existsSync(dir));
  if (!existsSync(dir)) continue;

  const files = readdirSync(dir).filter((file) => file.endsWith('.webp'));
  const expected = new Set(group.types.map((type) => `${type.toLowerCase()}.webp`));

  // Файл, не совпавший ни с одним типом, никогда не будет показан.
  const orphans = files.filter((file) => !expected.has(file));
  check(
    `${group.kind}: нет файлов мимо конвенции`,
    orphans.length === 0,
    orphans.length ? `не будут показаны: ${orphans.join(', ')}` : `файлов ${files.length}`,
  );

  const present = group.types.filter((type) => files.includes(`${type.toLowerCase()}.webp`));
  const absent = group.types.filter((type) => !files.includes(`${type.toLowerCase()}.webp`));
  console.log(
    `       ${group.kind}: есть ${present.length} из ${group.types.length}` +
      (absent.length ? `, ждут картинки: ${absent.map((t) => t.toLowerCase()).join(', ')}` : ''),
  );
}

console.log('\n=== Клиент ===');

const client = await import('node:fs').then((fs) => fs.readFileSync('public/app.js', 'utf8'));

check(
  'путь собирается из типа, а не из таблицы соответствий',
  client.includes('`/assets/${ART_FOLDERS[kind]') && client.includes('type.toLowerCase()'),
);
check(
  'у каждой группы карточек своя папка',
  ['buildings', 'ships', 'defense', 'tech'].every((folder) => client.includes(`'${folder}'`)),
);
check(
  'отсутствие картинки переводит карточку в заглушку',
  client.includes("addEventListener('error'") && client.includes('art-missing'),
);
check(
  'ленивую загрузку не вернули: в скрытой панели она не даст сработать заглушке',
  !client.includes("image.loading = 'lazy'"),
);

const styles = await import('node:fs').then((fs) => fs.readFileSync('public/styles.css', 'utf8'));
check(
  'место под баннер занято до загрузки картинки',
  /\.art \{[^}]*aspect-ratio: 5 \/ 2/s.test(styles),
  'aspect-ratio на контейнере не дает карточкам прыгать',
);
check(
  'картинка кадрируется, а не растягивается',
  /\.art img \{[^}]*object-fit: cover/s.test(styles),
);
check('заглушка стилизована', styles.includes('.art.art-missing'));

const html = await import('node:fs').then((fs) => fs.readFileSync('public/index.html', 'utf8'));
check(
  'крупных SVG-иллюстраций в спрайте не осталось',
  !html.includes('<symbol id="art-'),
);
check(
  'мелкие иконки ресурсов на месте',
  ['ore', 'polymers', 'plasma', 'antimatter', 'energy', 'credits'].every((name) =>
    html.includes(`<symbol id="ico-${name}"`),
  ),
);

const passed = results.filter((item) => item.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);

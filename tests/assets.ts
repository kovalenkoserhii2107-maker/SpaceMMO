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
/**
 * Тела на карте: биомы планет плюс центр системы и точка глубокого космоса.
 *
 * Имена биомов не совпадают с перечислением `PlanetType`: арт назван по биому
 * («terran», «lava»), а тип — по свойству («OCEANIC», «VOLCANIC»). Связывает их
 * маппинг `PLANET_ART` в клиенте, поэтому список здесь дублируется намеренно —
 * тест сверяет обе стороны и ловит расхождение.
 */
const PLANET_SLOTS = [
  'star',
  'black_hole',
  'deep_space',
  'rocky',
  'terran',
  'desert',
  'ice',
  'gas_giant',
  'lava',
  'toxic',
];

/*
 * Черновики, оставшиеся от прошлых поставок арта: типов с такими именами нет и
 * не планируется. Держим их списком, чтобы эвристика опечаток срабатывала на
 * действительно новых файлах, а не на этих двух при каждом новом типе.
 */
const KNOWN_DRAFTS = new Set(['automation.webp', 'plasma_technology.webp']);

const GROUPS: Array<{ folder: string; kind: string; types: readonly string[] }> = [
  { folder: 'buildings', kind: 'постройки', types: BUILDING_TYPES },
  { folder: 'ships', kind: 'корабли', types: SHIP_TYPES },
  { folder: 'defense', kind: 'оборона', types: DEFENSE_TYPES },
  { folder: 'tech', kind: 'технологии', types: TECHNOLOGY_TYPES },
  { folder: 'planets', kind: 'тела карты', types: PLANET_SLOTS },
];

console.log('\n=== Папки и соответствие имен ===');

for (const group of GROUPS) {
  const dir = `${ROOT}/${group.folder}`;
  check(`${group.kind}: папка ${group.folder}/ существует`, existsSync(dir));
  if (!existsSync(dir)) continue;

  const files = readdirSync(dir).filter((file) => file.endsWith('.webp'));
  const expected = new Set(group.types.map((type) => `${type.toLowerCase()}.webp`));

  const present = group.types.filter((type) => files.includes(`${type.toLowerCase()}.webp`));
  const absent = group.types.filter((type) => !files.includes(`${type.toLowerCase()}.webp`));

  /*
   * Файл, не совпавший ни с одним типом, никогда не будет показан. Но опасен он
   * только пока есть незаполненные слоты: тогда это почти наверняка опечатка
   * в имени, и картинка молча подменяется заглушкой. Если все слоты заполнены,
   * лишний файл — просто забытый черновик, и ронять из-за него прогон незачем.
   */
  const orphans = files.filter((file) => !expected.has(file) && !KNOWN_DRAFTS.has(file));
  check(
    `${group.kind}: имена совпадают с типами`,
    orphans.length === 0 || absent.length === 0,
    orphans.length === 0
      ? `файлов ${files.length}`
      : absent.length === 0
        ? `лишние черновики (все слоты заполнены): ${orphans.join(', ')}`
        : `похоже на опечатку в имени: ${orphans.join(', ')} при пустых слотах ` +
          `${absent.map((t) => t.toLowerCase()).join(', ')}`,
  );
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
  'картинка кадрируется, а не растягивается',
  /\.art img \{[^}]*object-fit: cover/s.test(styles),
);
check('заглушка стилизована', styles.includes('.art.art-missing'));
check(
  'обложка карточки — строгий квадрат',
  /\.art \{[^}]*aspect-ratio: 1 \/ 1/s.test(styles),
);
check(
  'карточки тянутся на высоту ряда, кнопка прижата к низу',
  styles.includes('height: 100%') && styles.includes('margin-top: auto'),
);

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

console.log('\n=== Карта системы ===');

check(
  'карта круговая: положение считается через полярные координаты',
  client.includes('function polar(') && client.includes('function orbitRadius('),
);
check(
  'центр системы отличает звезду от черной дыры',
  client.includes("'black_hole' : 'star'"),
);
check(
  'картинка планеты берется по биому, а не по номеру орбиты',
  client.includes('PLANET_ART[planet.type]'),
);

// Маппинг в клиенте и список слотов должны сходиться: иначе биом молча
// подменяется заглушкой, и заметить это можно только глазами.
const mapped = [...client.matchAll(/^\s{4}(?:ROCKY|OCEANIC|DESERT|ICE|GAS_GIANT|VOLCANIC|TOXIC): '([a-z_]+)',/gm)]
  .map((match) => match[1] as string);
check(
  'все биомы из маппинга есть в списке ожидаемых файлов',
  mapped.length === 7 && mapped.every((name) => PLANET_SLOTS.includes(name)),
  mapped.join(', '),
);
check(
  'звезда и туманность не обрезаются кругом и смешиваются с фоном',
  client.includes("kind: 'glow'") && styles.includes('mix-blend-mode: screen'),
);
check(
  'у светящихся тел мягкий край: яркое содержимое не обрывается рамкой кадра',
  client.includes("image.setAttribute('mask', 'url(#glowFade)')") && client.includes('glowFadeGrad'),
);
check(
  'планеты обрезаются кругом и не смешиваются',
  /\} else \{[\s\S]{0,260}clip-path/.test(client) && !client.includes("kind = 'glow'"),
);
check(
  'сломанная картинка тела снимается, иначе браузер рисует свою иконку поверх круга',
  /addEventListener\('error', \(\) => image\.remove\(\)\)/.test(client),
);
// Круг-заглушка должен появляться до раннего выхода по отсутствующему src,
// иначе тело без картинки не нарисуется вовсе.
const bodyFn = client.slice(client.indexOf('function celestialBody('));
check(
  'круг-заглушка рисуется до проверки на отсутствующую картинку',
  bodyFn.indexOf("class: `body") < bodyFn.indexOf('if (!src) return;'),
);
check(
  'холст карты квадратный',
  html.includes('id="system-map" viewBox="0 0 860 860"'),
);


const passed = results.filter((item) => item.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);

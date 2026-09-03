/**
 * Шпионаж: что зонд привезет и узнает ли об этом цель.
 *
 * Модуль чистый — только таблицы и броски. Все проценты собраны здесь нарочно:
 * их придется крутить по результатам наблюдения, и лазить за ними по трем
 * файлам не годится.
 *
 * Решает всё разница уровней `d = уровень шпиона − уровень цели`, а не
 * абсолютный уровень. Поэтому «Шпионаж» — технология сразу и наступательная,
 * и оборонительная: вложившийся в нее и видит больше, и показывает меньше.
 * Торговцу она нужна ровно как контрразведка.
 *
 * Броски принимают `rng` параметром, как бой: настоящая разведка бросает
 * настоящие кости, тесты подставляют зерно и проверяют распределение
 * (правило 15).
 */

/**
 * Что зонд сумел прочесть. Порядок — это и есть лестница: каждая следующая
 * ступень включает всё, что дают предыдущие.
 *
 * Немонотонности быть не должно. В первом наброске разница −1 открывала
 * оборону, которой не давала разница 0, — то есть отставать было выгоднее,
 * чем идти вровень. Перечисление снимает этот класс ошибок: ступень сравнима
 * с соседней, и «меньше» нельзя перепутать с «больше».
 */
export const ESPIONAGE_DETAILS = [
  /** Дрон не вернулся: не привез ничего. */
  'NONE',
  /** Постройки и недра: их видно издалека, и меняются они медленно. */
  'BUILDINGS',
  /** + флот общим числом, без разбора по классам. */
  'FLEET_COUNT',
  /** + оборона общим числом. */
  'DEFENCE_COUNT',
  /** + оборона по типам. */
  'DEFENCE_TYPES',
  /** + флот по типам и ресурсы по видам. */
  'FULL_FORCES',
  /** + уровни технологий. */
  'TECHS',
] as const;

export type EspionageDetail = (typeof ESPIONAGE_DETAILS)[number];

/** Ступень не ниже указанной: сравнение по порядку перечисления. */
export function atLeast(detail: EspionageDetail, floor: EspionageDetail): boolean {
  return ESPIONAGE_DETAILS.indexOf(detail) >= ESPIONAGE_DETAILS.indexOf(floor);
}

/**
 * Что узнала цель о незваном госте.
 *
 * Та же лестница, прочитанная с другой стороны: уровень контрразведки решает
 * не только «заметил ли», но и «что именно понял». Знать, что именно утекло,
 * ценнее всего остального — по этому понятно, к чему готовиться.
 */
export type EspionageAlert =
  /** Не заметили вовсе. */
  | 'NONE'
  /** «Кто-то пролетал»: чужой след без имени. */
  | 'PRESENCE'
  /** Кто и когда. */
  | 'IDENTITY'
  /** Кто, откуда и когда. */
  | 'ORIGIN'
  /** Кто, откуда, когда и что успел прочесть. */
  | 'ORIGIN_AND_LEAK';

export interface EspionageOutcome {
  /** Насколько глубоко зонд заглянул. */
  detail: EspionageDetail;
  /** Дрон уничтожен и домой не вернется. */
  droneLost: boolean;
  /** Виден ли склад: на равных уровнях это отдельный бросок. */
  resourcesSeen: boolean;
  /** Что досталось цели. */
  alert: EspionageAlert;
}

/**
 * Джокер: доля, на которую не влияет ничто.
 *
 * Абсолютов в такой системе быть не должно. Стопроцентная невидимость
 * превращает верхний уровень в выключатель, а стопроцентное уничтожение —
 * в запрет на попытку. Один процент оставляет и то, и другое возможным,
 * и работает он в обе стороны: и против шпиона, и против цели.
 */
export const JOKER = 0.01;

/** Шанс, что дрон не вернется, по разнице уровней. */
function lossChance(gap: number): number {
  if (gap <= -2) return 1 - JOKER;
  if (gap === -1) return 0.5;
  return 0;
}

/** До какой ступени дотягивается уцелевший дрон. */
function detailFor(gap: number): EspionageDetail {
  if (gap <= -1) return 'BUILDINGS';
  if (gap === 0) return 'FLEET_COUNT';
  if (gap === 1) return 'DEFENCE_COUNT';
  if (gap === 2) return 'DEFENCE_TYPES';
  if (gap <= 4) return 'FULL_FORCES';
  return 'TECHS';
}

/**
 * Шанс, что цель заметит пролет.
 *
 * Тридцать процентов невидимости за уровень превосходства, как и задумано,
 * но потолок — не сто, а девяносто девять: джокер работает и здесь.
 */
function noticeChance(gap: number): number {
  if (gap <= 0) return 1 - JOKER;
  if (gap === 1) return 0.7;
  if (gap === 2) return 0.4;
  if (gap === 3) return 0.1;
  return JOKER;
}

/** Насколько подробно цель разглядела шпиона. */
function alertFor(gap: number): EspionageAlert {
  if (gap <= -1) return 'ORIGIN_AND_LEAK';
  if (gap === 0) return 'ORIGIN';
  if (gap === 1) return 'IDENTITY';
  return 'PRESENCE';
}

/**
 * Виден ли склад.
 *
 * На равных уровнях это отдельный бросок в четыре пятых: склад — то, ради чего
 * чаще всего и летят, и на равных за него надо еще и повезти. С превосходством
 * он виден всегда, если не считать джокера.
 */
function resourcesChance(gap: number): number {
  if (gap < 0) return 0;
  if (gap === 0) return 0.8;
  return 1 - JOKER;
}

/**
 * Разыграть пролет зонда.
 *
 * Броски независимы: уцелел дрон или нет, заметили его или нет — разные
 * события. Дрон может привезти всё и остаться незамеченным, а может погибнуть,
 * успев наделать шума, — второе как раз худший исход, и он возможен.
 */
export function resolveEspionage(
  spyLevel: number,
  targetLevel: number,
  rng: () => number = Math.random,
): EspionageOutcome {
  const gap = Math.max(0, spyLevel) - Math.max(0, targetLevel);

  const droneLost = rng() < lossChance(gap);
  const noticed = rng() < noticeChance(gap);
  const resourcesRoll = rng();

  const detail = droneLost ? 'NONE' : detailFor(gap);

  return {
    detail,
    droneLost,
    // Уничтоженный дрон не привозит ничего, включая склад.
    resourcesSeen: !droneLost && resourcesRoll < resourcesChance(gap),
    alert: noticed ? alertFor(gap) : 'NONE',
  };
}

/**
 * Зерно для броска: состав рейса и цель.
 *
 * Без него один и тот же пролет давал бы разные ответы при каждом пересчете,
 * а проверить лестницу тестами стало бы нечем (правило 15). Той же уловкой
 * засеян предпросмотр боя в симуляторе.
 */
export function espionageSeed(fleetId: string, planetId: string): () => number {
  let state = 0;
  for (const text of [fleetId, planetId]) {
    for (let i = 0; i < text.length; i += 1) {
      state = (state * 31 + text.charCodeAt(i)) >>> 0;
    }
  }
  return () => {
    // xorshift32: короткий, воспроизводимый и без внешних зависимостей.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

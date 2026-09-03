/**
 * Туман войны: что игрок видит на карте системы.
 * Своя планета — всё; чужая — только астрономические данные,
 * пока туда не слетает зонд. Данные скана «стареют» и остаются снимком.
 */
import { DEFENSE_TYPES, emptyDefenseCounts, type DefenseCounts } from './defenses.js';
import { BUILDING_TYPES, emptyLevels, type BuildingLevels } from './rules.js';
import { SHIP_TYPES, emptyShipCounts, type ShipCounts } from './ships.js';

export type PlanetVisibility = 'OWN' | 'SCANNED' | 'UNKNOWN';

/**
 * Свежесть разведданных.
 *
 * Снимок зонда не обновляется сам, а флот и склад противника меняются быстро.
 * Поэтому старые цифры не показываются как факт: через сутки они устаревают
 * настолько, что верить им опаснее, чем не знать вовсе.
 */
export type ScanFreshness = 'FRESH' | 'STALE' | 'OUTDATED';

/** До часа данные считаем актуальными. */
const FRESH_SECONDS = 3600;
/** После суток флот и склад скрываются: цифры уже вводят в заблуждение. */
const OUTDATED_SECONDS = 24 * 3600;

export function scanFreshness(ageSeconds: number): ScanFreshness {
  if (ageSeconds < FRESH_SECONDS) return 'FRESH';
  if (ageSeconds < OUTDATED_SECONDS) return 'STALE';
  return 'OUTDATED';
}

/*
 * Снимки лежат в БД как JSON и переживают изменения игры: в старых нет ни новых
 * классов кораблей, ни обороны. Нормализация обязательна — иначе недостающий
 * ключ уезжает в интерфейс как `undefined` и игрок видит «крейсера undefined».
 */

export function normalizeShips(source: Partial<ShipCounts> | null | undefined): ShipCounts {
  const ships = emptyShipCounts();
  if (!source) return ships;
  for (const type of SHIP_TYPES) ships[type] = safeCount(source[type]);
  return ships;
}

/**
 * Уровни построек из снимка разведки.
 *
 * Снимок лежит в БД как JSON и переживает изменения игры: в отчете, снятом
 * до появления какого-нибудь здания, его ключа просто нет. Без нормализации
 * такое поле доезжало до клиента как `undefined` и рисовалось в карточке
 * планеты словом «undefined» — единственный снимок, который этого не проходил.
 */
export function normalizeBuildings(source: Partial<BuildingLevels> | null | undefined): BuildingLevels | null {
  if (!source) return null;
  const levels = emptyLevels();
  for (const type of BUILDING_TYPES) levels[type] = safeCount(source[type]);
  return levels;
}

export function normalizeDefenses(source: Partial<DefenseCounts> | null | undefined): DefenseCounts {
  const defenses = emptyDefenseCounts();
  if (!source) return defenses;
  for (const type of DEFENSE_TYPES) defenses[type] = safeCount(source[type]);
  return defenses;
}

/*
 * Богатство из снимка.
 *
 * Возвращаем null, когда в снимке нет ни одного пригодного числа: раньше такой
 * снимок превращался в «×0» по всем ресурсам, а это не «неизвестно», а «добывать
 * нечего» — прямая дезинформация. Пустого богатства у планет не бывает,
 * поэтому все нули означают именно потерянные данные.
 */
function normalizeRichness(
  source: Partial<ScanPayload['richness']> | null | undefined,
): ScanPayload['richness'] | null {
  if (!source) return null;

  const richness = {
    ore: safeFactor(source.ore),
    polymers: safeFactor(source.polymers),
    plasma: safeFactor(source.plasma),
    energy: safeFactor(source.energy),
    antimatter: safeFactor(source.antimatter),
  };
  /*
   * Смотрим только на добычные коэффициенты. В снимках прошлой номенклатуры
   * уцелела одна `energy` — по ней снимок выглядел бы годным, а четыре главные
   * цифры показывались бы как «×0». Нулевого богатства у планет не бывает,
   * поэтому нули здесь означают потерянные данные, а не бедную планету.
   */
  const known = [richness.ore, richness.polymers, richness.plasma, richness.antimatter].some(
    (value) => value > 0,
  );
  return known ? richness : null;
}

/**
 * Склад из снимка.
 *
 * Единственное поле, которое раньше уезжало к клиенту как есть. Снимок переживает
 * переименования ресурсов, и в старом лежат ключи прошлой номенклатуры — клиент
 * получал `undefined` и показывал «не число» вместо цифры склада.
 */
function normalizeStock(
  source: Partial<ScanPayload['resources']> | null | undefined,
): ScanPayload['resources'] | null {
  if (!source) return null;

  const stock = {
    ore: safeAmount(source.ore),
    polymers: safeAmount(source.polymers),
    plasma: safeAmount(source.plasma),
    antimatter: safeAmount(source.antimatter),
  };
  const known = [source.ore, source.polymers, source.plasma, source.antimatter].some((value) =>
    Number.isFinite(value),
  );
  return known ? stock : null;
}

function safeFactor(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

function safeAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

function safeCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0;
}

/** Снимок планеты, который зонд сохраняет в PlanetScan.data. */
export interface ScanPayload {
  owner: string | null;
  colonized: boolean;
  richness: { ore: number; polymers: number; plasma: number; energy: number; antimatter: number };
  buildings: BuildingLevels | null;
  resources: { ore: number; polymers: number; plasma: number; antimatter: number } | null;
  fleet: ShipCounts | null;
  /** Стационарная оборона колонии. У снимков, снятых до Этапа 12, поля нет. */
  defenses?: DefenseCounts | null;
}

export interface PlanetView {
  planetId: string;
  name: string;
  position: number;
  type: string;
  size: number;
  visibility: PlanetVisibility;
  /** null — неизвестно (планета не разведана). */
  colonized: boolean | null;
  owner: string | null;
  isOwn: boolean;
  richness: ScanPayload['richness'] | null;
  buildings: BuildingLevels | null;
  resources: ScanPayload['resources'] | null;
  fleet: ShipCounts | null;
  defenses: DefenseCounts | null;
  /** Поле обломков на орбите: видно всем, туман войны его не скрывает. */
  debris: { ore: number; polymers: number };
  /** Возраст данных разведки в секундах. */
  scanAgeSeconds: number | null;
  /** Свежесть разведданных; null — планета не разведана. */
  freshness: ScanFreshness | null;
  /**
   * Данные устарели настолько, что флот и склад скрыты.
   * Уровни построек остаются: здания не разбирают за сутки.
   */
  staleHidden: boolean;
  /**
   * Флот скрыт не возрастом, а нехваткой «Шпионажа».
   *
   * Отдельно от `staleHidden` нарочно: «данные протухли» и «мы не умеем это
   * прочесть» — разные новости, и вторая говорит игроку, что делать.
   */
  fleetLocked: boolean;
}

/**
 * Астрономические факты о планете — то, что видно без разведки.
 *
 * Поле обломков сюда же: оно висит на орбите и светится на радарах, поэтому
 * известно всем и не скрывается туманом войны. Иначе гонка за обломками была бы
 * невозможна — соперники просто не знали бы, куда лететь.
 */
interface PlanetFacts {
  planetId: string;
  name: string;
  position: number;
  type: string;
  size: number;
  debris: { ore: number; polymers: number };
}

/** Своя планета: видно всё и в реальном времени. */
export function ownPlanetView(facts: PlanetFacts, payload: ScanPayload): PlanetView {
  return {
    ...facts,
    visibility: 'OWN',
    colonized: true,
    owner: payload.owner,
    isOwn: true,
    richness: payload.richness,
    buildings: payload.buildings,
    resources: payload.resources,
    fleet: payload.fleet,
    defenses: payload.defenses ?? null,
    scanAgeSeconds: 0,
    freshness: 'FRESH',
    staleHidden: false,
    // Свою планету видно всю: тут нечего расшифровывать.
    fleetLocked: false,
  };
}

/** Чужая планета: данные только из последнего скана, иначе — пусто. */
export function foreignPlanetView(
  facts: PlanetFacts,
  scan: { data: ScanPayload; scannedAt: Date } | null,
  now: number,
  /**
   * Видит ли разведчик чужой флот. Решает «Шпионаж», и решает по нынешнему
   * уровню, а не по тому, каким он был при пролете зонда: снимок хранит все,
   * что зонд снял, а показываем ровно то, что мы способны прочесть сейчас.
   * Иначе выученная технология не открывала бы старые снимки, и игроку
   * пришлось бы перелетать все заново без всякой на то причины.
   */
  seesFleet = true,
): PlanetView {
  if (!scan) {
    return {
      ...facts,
      visibility: 'UNKNOWN',
      colonized: null,
      owner: null,
      isOwn: false,
      richness: null,
      buildings: null,
      resources: null,
      fleet: null,
      defenses: null,
      scanAgeSeconds: null,
      freshness: null,
      staleHidden: false,
      fleetLocked: false,
    };
  }

  const ageSeconds = Math.max(0, Math.round((now - scan.scannedAt.getTime()) / 1000));
  const freshness = scanFreshness(ageSeconds);
  // Устаревшие цифры не отдаем даже в API: клиент не должен иметь возможности
  // показать их «на свой страх и риск» — это ровно тот случай, когда отсутствие
  // данных честнее старых данных.
  const outdated = freshness === 'OUTDATED';

  return {
    ...facts,
    visibility: 'SCANNED',
    colonized: scan.data.colonized,
    owner: scan.data.owner,
    isOwn: false,
    richness: normalizeRichness(scan.data.richness),
    buildings: normalizeBuildings(scan.data.buildings),
    resources: outdated ? null : normalizeStock(scan.data.resources),
    fleet: outdated || !seesFleet ? null : normalizeShips(scan.data.fleet),
    defenses: outdated || !scan.data.defenses ? null : normalizeDefenses(scan.data.defenses),
    scanAgeSeconds: ageSeconds,
    freshness,
    staleHidden: outdated,
    fleetLocked: !outdated && !seesFleet,
  };
}

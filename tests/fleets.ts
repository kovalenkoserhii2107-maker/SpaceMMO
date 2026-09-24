/**
 * Полеты: расчет маршрута, топливо и типы миссий.
 *
 * Формулы проверяются напрямую на игровых модулях — это те же функции, которые
 * зовет Game Loop при вылете и роут предпросмотра. Живой сервер нужен только
 * последней секции: там сверяются правила допуска к вылету и поиск по координатам.
 *
 * Запуск: npm run test:fleets
 */
import {
  fleetCapacity,
  gateLegShare,
  galaxyDistance,
  isFleetMission,
  isOneWayMission,
  resolveOneWay,
  splitLoot,
  MISSION_LABELS,
  planFlight,
  validateComposition,
  type FleetMission,
} from '../src/game/fleets.js';
import { emptyShipCounts, missingShipRequirements, type ShipCounts } from '../src/game/ships.js';
import { colonySlots, emptyTechLevels, type TechLevels } from '../src/game/techTree.js';
import { emptyLevels } from '../src/game/rules.js';
import { gateLeaseRefund, isGateLeaseHours } from '../src/game/syndicate.js';

const BASE_URL = 'http://localhost:3000';
const results: Array<{ name: string; passed: boolean }> = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

function fleet(counts: Partial<ShipCounts>): ShipCounts {
  return { ...emptyShipCounts(), ...counts };
}

function techs(levels: Partial<TechLevels> = {}): TechLevels {
  return { ...emptyTechLevels(), ...levels };
}

const HOME = { position: 3, system: { galaxyX: 1, galaxyY: 1 } };
const NEIGHBOUR = { position: 7, system: { galaxyX: 1, galaxyY: 1 } };
const FAR_SYSTEM = { position: 2, system: { galaxyX: 4, galaxyY: 5 } };

/* ------------------------- 1. Типы миссий ------------------------- */

console.log('\n=== 1. Типы миссий ===');

{
  const required: FleetMission[] = ['ATTACK', 'TRANSPORT', 'DEPLOY', 'SCAN', 'COLONIZE'];
  check(
    'все базовые миссии распознаются',
    required.every((mission) => isFleetMission(mission)),
  );
  check(
    'у каждой миссии есть подпись для интерфейса',
    required.every((mission) => Boolean(MISSION_LABELS[mission])),
    required.map((m) => MISSION_LABELS[m]).join(', '),
  );
  check('выдуманная миссия не проходит', !isFleetMission('WARP') && !isFleetMission(''));

  check(
    'в один конец летят дислокация и колонизация',
    isOneWayMission('DEPLOY') &&
      isOneWayMission('COLONIZE') &&
      !isOneWayMission('ATTACK') &&
      !isOneWayMission('TRANSPORT') &&
      !isOneWayMission('SCAN'),
  );
}

/* ------------------------- 2. Скорость и время ------------------------- */

console.log('\n=== 2. Скорость и время ===');

{
  // Скорость флота — по самому медленному кораблю: транспорт тормозит крейсера.
  const fast = planFlight(fleet({ CRUISER: 5 }), techs(), HOME, NEIGHBOUR);
  const slowed = planFlight(fleet({ CRUISER: 5, RECYCLER: 1 }), techs(), HOME, NEIGHBOUR);
  check(
    'один тихоход замедляет весь флот',
    slowed.speed < fast.speed && slowed.flightSeconds > fast.flightSeconds,
    `${fast.speed} → ${slowed.speed}, время ${fast.flightSeconds} → ${slowed.flightSeconds} с`,
  );

  const drive = planFlight(fleet({ CRUISER: 5 }), techs({ COMBUSTION_DRIVE: 6 }), HOME, NEIGHBOUR);
  check(
    'реактивный двигатель ускоряет полет',
    drive.speed > fast.speed && drive.flightSeconds < fast.flightSeconds,
    `${fast.flightSeconds} с → ${drive.flightSeconds} с`,
  );

  const near = planFlight(fleet({ SMALL_CARGO: 3 }), techs(), HOME, { position: 4, system: HOME.system });
  const far = planFlight(fleet({ SMALL_CARGO: 3 }), techs(), HOME, NEIGHBOUR);
  check(
    'дальняя орбита дольше ближней',
    far.flightSeconds > near.flightSeconds && far.distance > near.distance,
    `${near.distance} орбит / ${near.flightSeconds} с против ${far.distance} / ${far.flightSeconds} с`,
  );

  check(
    'трюмы считаются по составу',
    fleetCapacity(fleet({ SMALL_CARGO: 3 })) === near.capacity && near.capacity > 0,
    `${near.capacity}`,
  );
}

/* ------------------------- 3. Межзвездный прыжок ------------------------- */

console.log('\n=== 3. Межзвездный прыжок ===');

{
  const intra = planFlight(fleet({ CRUISER: 4 }), techs(), HOME, NEIGHBOUR);
  const jump = planFlight(fleet({ CRUISER: 4 }), techs(), HOME, FAR_SYSTEM);

  check('полет внутри системы идет на плазме', intra.kind === 'INTRA' && intra.fuel > 0 && intra.antimatter === 0);
  check(
    'прыжок между системами идет на антиматерии',
    jump.kind === 'INTERSTELLAR' && jump.antimatter > 0 && jump.fuel === 0,
    `${jump.antimatter} антиматерии`,
  );
  check(
    'прыжок дольше внутрисистемного полета',
    jump.flightSeconds > intra.flightSeconds,
    `${intra.flightSeconds} с против ${jump.flightSeconds} с`,
  );

  const hyper = planFlight(fleet({ CRUISER: 4 }), techs({ HYPERDRIVE: 5 }), HOME, FAR_SYSTEM);
  check(
    'гипердвигатель ускоряет и удешевляет прыжок',
    hyper.flightSeconds < jump.flightSeconds && hyper.antimatter < jump.antimatter,
    `${jump.flightSeconds} с / ${jump.antimatter} → ${hyper.flightSeconds} с / ${hyper.antimatter}`,
  );

  check(
    'расстояние по галактике считается по координатам',
    galaxyDistance({ galaxyX: 1, galaxyY: 1 }, { galaxyX: 4, galaxyY: 5 }) === 5,
    `${galaxyDistance({ galaxyX: 1, galaxyY: 1 }, { galaxyX: 4, galaxyY: 5 })}`,
  );
}

/* ------------------------- 4. Топливо в один конец ------------------------- */

console.log('\n=== 4. Топливо в один конец ===');

{
  const ships = fleet({ CRUISER: 6, SMALL_CARGO: 4 });

  const round = planFlight(ships, techs(), HOME, NEIGHBOUR);
  const oneWay = planFlight(ships, techs(), HOME, NEIGHBOUR, { oneWay: true });
  // Расход округляется вверх, поэтому половина сходится с точностью до единицы.
  check(
    'рейс без возврата стоит вдвое дешевле по плазме',
    Math.abs(oneWay.fuel * 2 - round.fuel) <= 1,
    `${round.fuel} против ${oneWay.fuel}`,
  );
  check(
    'время в пути от этого не меняется',
    oneWay.flightSeconds === round.flightSeconds && oneWay.distance === round.distance,
  );

  const roundJump = planFlight(ships, techs({ HYPERDRIVE: 2 }), HOME, FAR_SYSTEM);
  const oneWayJump = planFlight(ships, techs({ HYPERDRIVE: 2 }), HOME, FAR_SYSTEM, { oneWay: true });
  check(
    'то же и с антиматерией на прыжке',
    Math.abs(oneWayJump.antimatter * 2 - roundJump.antimatter) <= 1,
    `${roundJump.antimatter} против ${oneWayJump.antimatter}`,
  );

  // Пустой флот никуда не летит — на нем расчет не должен ломаться.
  const nobody = planFlight(emptyShipCounts(), techs(), HOME, NEIGHBOUR);
  check('пустой состав не дает ни времени, ни расхода', nobody.flightSeconds === 0 && nobody.fuel === 0);
}

/* ------------------------- 4b. Рейс без возврата по выбору ------------------------- */

console.log('\n=== 4b. Рейс без возврата по выбору ===');

{
  // У дислокации и колонизации односторонность — свойство миссии, и снять
  // ее нельзя: флот там остается по самому смыслу задачи.
  check(
    'дислокация и колонизация односторонни при любом флажке',
    resolveOneWay('DEPLOY', false) && resolveOneWay('COLONIZE', false),
  );
  check(
    'транспорт слушается флажка',
    resolveOneWay('TRANSPORT', true) && !resolveOneWay('TRANSPORT', false),
  );
  // Атаке и разведке возвращаться обязательно: флот, брошенный у чужой
  // колонии, достался бы противнику даром.
  check(
    'атака и разведка возвращаются всегда',
    !resolveOneWay('ATTACK', true) && !resolveOneWay('SCAN', true),
  );

  const ships = fleet({ SMALL_CARGO: 6 });
  const round = planFlight(ships, techs(), HOME, NEIGHBOUR);
  const gift = planFlight(ships, techs(), HOME, NEIGHBOUR, { oneWay: resolveOneWay('TRANSPORT', true) });
  check(
    'односторонняя помощь стоит вдвое дешевле',
    Math.abs(gift.fuel * 2 - round.fuel) <= 1,
    `${round.fuel} против ${gift.fuel}`,
  );
}

/* ------------------------- 5. Колонизация ------------------------- */

console.log('\n=== 5. Колонизация ===');

{
  check(
    'без основателя колонизация не проходит',
    validateComposition('COLONIZE', fleet({ SMALL_CARGO: 10, CRUISER: 5 })) !== null,
  );
  check(
    'с основателем состав принимается',
    validateComposition('COLONIZE', fleet({ COLONY_SHIP: 1 })) === null,
  );
  check(
    'пустой состав не летит колонизировать',
    validateComposition('COLONIZE', emptyShipCounts()) !== null,
  );

  // Слот на старте один, дальше по слоту за каждые два уровня астрофизики.
  const slots = [0, 1, 2, 3, 4, 5, 6].map((level) => colonySlots(techs({ ASTROPHYSICS: level })));
  check(
    'слоты растут через уровень астрофизики',
    slots.join(',') === '1,1,2,2,3,3,4',
    `уровни 0..6 → ${slots.join(', ')}`,
  );
  check(
    'без астрофизики колония ровно одна',
    colonySlots(techs()) === 1 && colonySlots(techs({ ASTROPHYSICS: -5 })) === 1,
  );

  // Постройка закрыта до астрофизики: слот без корабля бесполезен и наоборот.
  const noTech = missingShipRequirements('COLONY_SHIP', emptyLevels(), techs({ COMBUSTION_DRIVE: 3 }));
  check(
    'колонизатор требует астрофизику и верфь',
    noTech.length > 0 && noTech.some((item) => item.key === 'ASTROPHYSICS'),
    noTech.map((item) => `${item.label} ур. ${item.level}`).join(', '),
  );

  // Колонизатор тихоходен: он тормозит конвой, и это осознанная цена.
  const escort = planFlight(fleet({ CRUISER: 4 }), techs(), HOME, NEIGHBOUR);
  const withFounder = planFlight(fleet({ CRUISER: 4, COLONY_SHIP: 1 }), techs(), HOME, NEIGHBOUR);
  check(
    'основатель замедляет конвой',
    withFounder.speed < escort.speed,
    `${escort.speed} → ${withFounder.speed}`,
  );
  check(
    'у основателя есть трюм под припасы колонии',
    fleetCapacity(fleet({ COLONY_SHIP: 1 })) > 0,
    `вместимость ${fleetCapacity(fleet({ COLONY_SHIP: 1 }))}`,
  );
}

/* ------------------------- 6. Живой сервер ------------------------- */

console.log('\n=== 6. Правила вылета и поиск по координатам ===');

async function live(): Promise<void> {
  const config = JSON.parse(process.argv[2] ? await readConfig(process.argv[2]) : '{}');
  if (!config.admiralEmail) {
    console.log('SKIP | нет конфигурации стенда: передай путь к stand.json аргументом');
    return;
  }

  const login = async (email: string, password: string): Promise<string> => {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return ((await response.json()) as { token: string }).token;
  };

  const token = await login(config.admiralEmail, config.admiralPassword);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const state = (await (await fetch(`${BASE_URL}/api/state`, { headers })).json()) as {
    bases: Array<{ baseId: string; planetId: string; position: number }>;
  };
  const base = state.bases[0]!;

  const send = async (body: object): Promise<{ ok?: boolean; error?: string }> =>
    (await (
      await fetch(`${BASE_URL}/api/bases/${base.baseId}/fleets`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    ).json()) as { ok?: boolean; error?: string };

  const map = (await (await fetch(`${BASE_URL}/api/map`, { headers })).json()) as {
    galaxyX: number;
    galaxyY: number;
    planets: Array<{ planetId: string; colonized: boolean | null; isOwn: boolean }>;
  };

  /*
   * Отказ должен прийти именно по цели, а не потому, что на базе нет кораблей:
   * иначе проверка проходит вхолостую. Флот мог погибнуть в прошлом прогоне,
   * поэтому при пустой базе выдаем один транспорт пультом гейм-мастера —
   * он единственный правит состояние, не споря с тиком.
   */
  const stock = state.bases[0] as unknown as { fleet: Record<string, number> };
  let available = Object.entries(stock.fleet).find(([, count]) => count > 0);

  if (!available) {
    const me = (await (await fetch(`${BASE_URL}/api/auth/me`, { headers })).json()) as {
      commander: { id: string } | null;
    };
    if (me.commander) {
      await fetch(`${BASE_URL}/api/admin/commanders/${me.commander.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ bases: [{ baseId: base.baseId, ships: { SMALL_CARGO: 2 } }] }),
      });
      available = ['SMALL_CARGO', 2];
    }
  }

  const one = available ? { [available[0]]: 1 } : null;

  const foreignPlanet = map.planets.find((planet) => planet.colonized && !planet.isOwn);
  const emptyPlanet = map.planets.find((planet) => !planet.colonized && !planet.isOwn);

  if (!one) {
    check('дислокация: на базе нет кораблей для проверки', false, 'пустой флот');
  } else {
    const foreign = foreignPlanet
      ? await send({ targetPlanetId: foreignPlanet.planetId, mission: 'DEPLOY', ships: one })
      : null;
    check(
      'дислокация не уходит на чужую колонию',
      foreign !== null && foreign.ok !== true && /колони/i.test(foreign.error ?? ''),
      foreign ? (foreign.error ?? 'запрос прошел') : 'в системе нет чужой колонии',
    );

    /*
     * Свободной орбиты в домашней системе может не остаться — тестовые аккаунты
     * занимают колонии. Тогда ищем незаселенную планету по соседним системам,
     * иначе проверка молча выродилась бы в «условий не нашлось».
     */
    let target = emptyPlanet;
    if (!target) {
      const galaxy = (await (await fetch(`${BASE_URL}/api/galaxy`, { headers })).json()) as {
        systems: Array<{ systemId: string }>;
      };
      for (const system of galaxy.systems.slice(0, 6)) {
        const view = (await (
          await fetch(`${BASE_URL}/api/map?systemId=${system.systemId}`, { headers })
        ).json()) as { planets: Array<{ planetId: string; colonized: boolean | null; isOwn: boolean }> };
        target = view.planets.find((planet) => !planet.colonized && !planet.isOwn);
        if (target) break;
      }
    }

    const empty = target
      ? await send({ targetPlanetId: target.planetId, mission: 'DEPLOY', ships: one })
      : null;
    check(
      'дислокация не уходит на пустую планету',
      empty !== null && empty.ok !== true && /колони/i.test(empty.error ?? ''),
      empty ? (empty.error ?? 'запрос прошел') : 'в системе нет свободной планеты',
    );
  }

  const found = await fetch(
    `${BASE_URL}/api/planets/at?x=${map.galaxyX}&y=${map.galaxyY}&position=${base.position}`,
    { headers },
  );
  const foundBody = (await found.json()) as { planetId?: string; isOwn?: boolean };
  check(
    'поиск по координатам находит свою планету',
    found.ok && foundBody.planetId === base.planetId && foundBody.isOwn === true,
    `${foundBody.planetId ?? 'не найдена'}`,
  );

  const missing = await fetch(`${BASE_URL}/api/planets/at?x=999&y=999&position=1`, { headers });
  check('за пределами галактики планеты нет', missing.status === 404, `HTTP ${missing.status}`);

  const broken = await fetch(`${BASE_URL}/api/planets/at?x=да&y=нет&position=1`, { headers });
  check('нечисловые координаты отклоняются', broken.status === 400, `HTTP ${broken.status}`);

  const anon = await fetch(`${BASE_URL}/api/planets/at?x=1&y=1&position=1`);
  check('поиск закрыт для неавторизованных', anon.status === 401, `HTTP ${anon.status}`);
}

async function readConfig(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
}

console.log('\n=== Совместная атака: дележ добычи ===');
{
  const caps = [1000, 500, 0];
  const parts = splitLoot({ ore: 1000, polymers: 499, plasma: 1 }, caps);
  const total = (field: 'ore' | 'polymers' | 'plasma') => parts.reduce((sum, part) => sum + part[field], 0);
  check('добыча делится без потерь', total('ore') === 1000 && total('polymers') === 499 && total('plasma') === 1,
    `${total('ore')}/${total('polymers')}/${total('plasma')}`);
  check('никто не везет сверх своих трюмов', parts.every((part, index) => part.ore + part.polymers + part.plasma <= caps[index]!));
  check('флот без трюмов не везет ничего', parts[2]!.ore + parts[2]!.polymers + parts[2]!.plasma === 0);
  check('доля пропорциональна трюмам', Math.abs(parts[0]!.ore - 2 * parts[1]!.ore) <= 2, `${parts[0]!.ore} против ${parts[1]!.ore}`);

  const tight = splitLoot({ ore: 10, polymers: 10, plasma: 0 }, [7, 7, 6]);
  check('впритык заполненные трюмы делятся ровно',
    tight.reduce((sum, part) => sum + part.ore, 0) === 10 && tight.reduce((sum, part) => sum + part.polymers, 0) === 10 &&
    tight.every((part, index) => part.ore + part.polymers <= [7, 7, 6][index]!));

  const over = splitLoot({ ore: 100, polymers: 0, plasma: 0 }, [30, 20]);
  check('не влезшее в трюмы остается у защитника', over[0]!.ore + over[1]!.ore === 50, `${over[0]!.ore}+${over[1]!.ore}`);
  check('без флотов делить нечего', splitLoot({ ore: 5, polymers: 5, plasma: 5 }, []).length === 0);
}

console.log('\n=== Сроки полетов, Брамы и аренда ===');
{
  const home = { galaxyX: 0, galaxyY: 0 };
  const far = (d: number) => ({ galaxyX: d, galaxyY: 0 });
  const one = (type: keyof ShipCounts) => ({ ...emptyShipCounts(), [type]: 1 });
  const techs = (drive: number, hyper: number): TechLevels => ({ ...emptyTechLevels(), COMBUSTION_DRIVE: drive, HYPERDRIVE: hyper });
  const intra = (ships: ShipCounts, t: TechLevels, orbits: number) =>
    planFlight(ships, t, { position: 1, system: home }, { position: 1 + orbits, system: home });
  const jump = (ships: ShipCounts, t: TechLevels, d: number) =>
    planFlight(ships, t, { position: 1, system: home }, { position: 1, system: far(d) });
  const minutes = (s: number) => s / 60;
  const hours = (s: number) => s / 3600;

  const cargo = one('SMALL_CARGO');
  const near = intra(cargo, techs(0, 0), 1).flightSeconds;
  const across = intra(cargo, techs(0, 0), 15).flightSeconds;
  check('до соседней планеты около пяти минут', minutes(near) >= 4 && minutes(near) <= 6, `${near} с`);
  check('через всю систему около двадцати минут', minutes(across) >= 18 && minutes(across) <= 22, `${across} с`);
  check('реактивный двигатель сокращает полет по системе', intra(cargo, techs(10, 0), 15).flightSeconds < across * 0.6);

  const neighbour = jump(cargo, techs(0, 1), 3).flightSeconds;
  check('соседняя система — от получаса до часа', minutes(neighbour) >= 30 && minutes(neighbour) <= 60, `${Math.round(minutes(neighbour))} мин`);
  const slowest = jump(one('RECYCLER'), techs(0, 1), 28).flightSeconds;
  check('самая дальняя у самого медленного — почти неделя', hours(slowest) >= 120 && hours(slowest) <= 170, `${hours(slowest).toFixed(1)} ч`);
  check('гипердвигатель ускоряет прыжок', jump(cargo, techs(0, 10), 28).flightSeconds < jump(cargo, techs(0, 1), 28).flightSeconds * 0.6);
  check('дальность решает квадратом', jump(cargo, techs(0, 1), 20).flightSeconds > jump(cargo, techs(0, 1), 10).flightSeconds * 3);

  const probe = one('PROBE');
  check('зонд пересекает систему за двадцать секунд', intra(probe, techs(0, 0), 15).flightSeconds <= 20);
  check('зонд пересекает галактику за две минуты', jump(probe, techs(0, 1), 28).flightSeconds <= 120);
  check('зонд в составе флота не ускоряет флот', jump({ ...cargo, PROBE: 1 }, techs(0, 1), 3).flightSeconds === neighbour);

  // Топливо считается по пути в прежней мере: сроки выросли, расход — нет.
  check('плазма на рейс прежняя', intra({ ...emptyShipCounts(), SMALL_CARGO: 10 }, techs(0, 0), 3).fuel === Math.ceil(10 * 0.4 * ((20 + 25 * 3) * 100 / 100) * 2));

  const viaGate = planFlight(cargo, techs(0, 0), { position: 3, system: home }, { position: 5, system: far(28) }, { viaGate: true });
  const plain = intra(cargo, techs(0, 0), 3).flightSeconds + intra(cargo, techs(0, 0), 5).flightSeconds;
  check('прыжок через Браму мгновенный: только путь к вратам и от них', viaGate.flightSeconds === plain, `${viaGate.flightSeconds} против ${plain}`);
  check('доля пути до врат растет с дальностью орбиты', gateLegShare(8, 1) > gateLegShare(1, 8));
  check('доля пути до врат между нулем и единицей', gateLegShare(3, 5) > 0 && gateLegShare(3, 5) < 1);

  const start = 0;
  const end = 168 * 3600 * 1000;
  check('возврат за половину срока — половина платы', gateLeaseRefund(1000, start, end, end / 2) === 500);
  check('после конца срока возвращать нечего', gateLeaseRefund(1000, start, end, end + 1) === 0);
  check('до начала срока возвращается вся плата', gateLeaseRefund(1000, start, end, start - 10) === 1000);
  check('сроки аренды — только из набора', isGateLeaseHours(168) && !isGateLeaseHours(100) && !isGateLeaseHours('168'));
}

try {
  await live();
} catch (error) {
  check('живые проверки', false, String(error));
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
if (passed !== results.length) process.exit(1);

/* Командный центр — клиент Этапов 1-2. Все расчеты на сервере, клиент только рисует состояние. */
(() => {
  'use strict';

  const TOKEN_KEY = 'spacemmo.token';

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    username: '',
    bases: [],
    research: { techs: {}, active: null },
    fleets: [],
    credits: 0,
    activeBaseId: null,
    activeTab: 'buildings',
    socket: null,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    loginScreen: $('login-screen'),
    loginForm: $('login-form'),
    username: $('username'),
    loginError: $('login-error'),
    dashboard: $('dashboard'),
    userName: $('user-name'),
    connStatus: $('conn-status'),
    logout: $('logout'),
    baseList: $('base-list'),
    baseName: $('base-name'),
    planetMeta: $('planet-meta'),
    richness: $('richness'),
    tabs: $('tabs'),
    buildJob: $('build-job'),
    buildings: $('buildings'),
    researchJob: $('research-job'),
    technologies: $('technologies'),
    fleet: $('fleet'),
    shipQueue: $('ship-queue'),
    ships: $('ships'),
    buildMessage: $('build-message'),
    resMetal: $('res-metal'),
    resCrystal: $('res-crystal'),
    resDeuterium: $('res-deuterium'),
    resEnergy: $('res-energy'),
    resEfficiency: $('res-efficiency'),
    rateMetal: $('rate-metal'),
    rateCrystal: $('rate-crystal'),
    rateDeuterium: $('rate-deuterium'),
    rateEnergy: $('rate-energy'),
    rateEfficiency: $('rate-efficiency'),
    systemMap: $('system-map'),
    mapCanvas: document.querySelector('.map-canvas'),
    mapTooltip: $('map-tooltip'),
    planetInfo: $('planet-info'),
    dispatch: $('dispatch'),
    mission: $('mission'),
    fleetInputs: $('fleet-inputs'),
    cargoMetal: $('cargo-metal'),
    cargoCrystal: $('cargo-crystal'),
    flightPlan: $('flight-plan'),
    sendFleetButton: $('send-fleet'),
    fleetList: $('fleet-list'),
    resCredits: $('res-credits'),
    hubStorage: $('hub-storage'),
    upgradeStorage: $('upgrade-storage'),
    orderSide: $('order-side'),
    orderResource: $('order-resource'),
    orderQuantity: $('order-quantity'),
    orderPrice: $('order-price'),
    orderHint: $('order-hint'),
    placeOrderButton: $('place-order'),
    orderBook: $('order-book'),
    myOrders: $('my-orders'),
    tradeLog: $('trade-log'),
    cargoMetalLabel: $('cargo-metal-label'),
    cargoCrystalLabel: $('cargo-crystal-label'),
  };

  const PLANET_TYPES = {
    ROCKY: 'Каменистая',
    OCEANIC: 'Океаническая',
    DESERT: 'Пустынная',
    ICE: 'Ледяная',
    GAS_GIANT: 'Газовый гигант',
    VOLCANIC: 'Вулканическая',
    TOXIC: 'Токсичная',
  };

  const SHIP_LABELS = { PROBE: 'Зонды', TRANSPORTER: 'Транспорты', LIGHT_FIGHTER: 'Истребители' };

  const fmt = (value) => Math.floor(value).toLocaleString('ru-RU');
  const fmtRate = (value) => `+${value.toFixed(2)}/с`;

  function fmtTime(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h} ч ${m} мин`;
    if (m > 0) return `${m} мин ${s} с`;
    return `${s} с`;
  }

  /* ---------- Авторизация ---------- */

  el.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    el.loginError.hidden = true;

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: el.username.value }),
      });
      const data = await response.json();

      if (!response.ok) {
        showLoginError(data.error || 'Не удалось войти');
        return;
      }

      state.token = data.token;
      localStorage.setItem(TOKEN_KEY, data.token);
      await enterGame();
    } catch (error) {
      showLoginError('Сервер недоступен');
    }
  });

  el.logout.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    if (state.socket) state.socket.disconnect();
    state.token = '';
    state.bases = [];
    cards.buildings.clear();
    cards.technologies.clear();
    cards.ships.clear();
    cardsBaseId = null;
    el.dashboard.hidden = true;
    el.loginScreen.hidden = false;
  });

  function showLoginError(message) {
    el.loginError.textContent = message;
    el.loginError.hidden = false;
  }

  async function enterGame() {
    const response = await fetch('/api/state', { headers: authHeaders() });
    if (!response.ok) {
      localStorage.removeItem(TOKEN_KEY);
      state.token = '';
      showLoginError('Сессия истекла, войди заново');
      return;
    }

    const data = await response.json();
    state.username = data.user.username;
    el.userName.textContent = data.user.username;
    el.loginScreen.hidden = true;
    el.dashboard.hidden = false;
    applyState(data);
    connectSocket();
    await loadMap();
    await loadMarket();
  }

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` };
  }

  /* ---------- Реалтайм ---------- */

  function connectSocket() {
    if (state.socket) state.socket.disconnect();

    const socket = io({ auth: { token: state.token } });
    state.socket = socket;

    socket.on('connect', () => setConnection(true));
    socket.on('disconnect', () => setConnection(false));
    socket.on('connect_error', () => setConnection(false));
    socket.on('state:update', (payload) => applyState(payload));
  }

  function setConnection(online) {
    el.connStatus.textContent = online ? 'онлайн' : 'офлайн';
    el.connStatus.className = `status ${online ? 'online' : 'offline'}`;
  }

  /* ---------- Вкладки ---------- */

  el.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('.tab');
    if (!button) return;
    state.activeTab = button.dataset.tab;

    for (const tab of el.tabs.querySelectorAll('.tab')) {
      tab.classList.toggle('active', tab.dataset.tab === state.activeTab);
    }
    for (const panel of document.querySelectorAll('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== state.activeTab;
    }
    if (state.activeTab === 'map') void loadMap();
    if (state.activeTab === 'market') void loadMarket();
  });

  /* ---------- Рендер ---------- */

  function applyState(payload) {
    state.bases = payload.bases || [];
    state.research = payload.research || { techs: {}, active: null };
    state.fleets = payload.fleets || [];
    state.credits = payload.credits || 0;
    el.resCredits.textContent = fmt(state.credits);
    if (!state.bases.length) return;
    if (!state.bases.some((base) => base.baseId === state.activeBaseId)) {
      state.activeBaseId = state.bases[0].baseId;
    }
    renderBaseList();
    renderActiveBase();
  }

  function activeBase() {
    return state.bases.find((base) => base.baseId === state.activeBaseId) || null;
  }

  /** Список баз перерисовывается только при изменении состава или выбора. */
  let baseListSignature = '';
  function renderBaseList() {
    const signature = state.bases.map((base) => `${base.baseId}:${base.baseName}`).join('|') + `#${state.activeBaseId}`;
    if (signature === baseListSignature) return;
    baseListSignature = signature;

    el.baseList.innerHTML = '';
    for (const base of state.bases) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = base.baseId === state.activeBaseId ? 'active' : '';
      button.textContent = base.baseName;
      const meta = document.createElement('small');
      meta.textContent = `${base.systemName} · орбита ${base.position}`;
      button.appendChild(meta);
      button.addEventListener('click', () => {
        state.activeBaseId = base.baseId;
        renderBaseList();
        renderActiveBase();
      });
      li.appendChild(button);
      el.baseList.appendChild(li);
    }
  }

  function renderActiveBase() {
    const base = activeBase();
    if (!base) return;

    el.resMetal.textContent = fmt(base.resources.metal);
    el.resCrystal.textContent = fmt(base.resources.crystal);
    el.resDeuterium.textContent = fmt(base.resources.deuterium);
    el.resEnergy.textContent = fmt(base.energy.available);
    el.rateMetal.textContent = fmtRate(base.productionPerSecond.metal);
    el.rateCrystal.textContent = fmtRate(base.productionPerSecond.crystal);
    el.rateDeuterium.textContent = fmtRate(base.productionPerSecond.deuterium);
    el.rateEnergy.textContent = `из ${fmt(base.energy.output)}`;

    const efficiency = Math.round(base.energy.efficiency * 100);
    el.resEfficiency.textContent = `${efficiency}%`;
    el.resEfficiency.style.color = efficiency < 100 ? 'var(--warn)' : '';
    el.rateEfficiency.textContent = efficiency < 100 ? 'дефицит энергии' : 'мощность шахт';

    el.baseName.textContent = base.baseName;
    el.planetMeta.textContent =
      `${base.planetName} · ${PLANET_TYPES[base.planetType] || base.planetType} · ` +
      `система ${base.systemName} · орбита ${base.position} · слотов ${base.size}`;

    el.richness.innerHTML = `
      <div>Металл<b>×${base.richness.metal}</b></div>
      <div>Кристаллы<b>×${base.richness.crystal}</b></div>
      <div>Дейтерий<b>×${base.richness.deuterium}</b></div>
      <div>Инсоляция<b>×${base.richness.energy}</b></div>`;

    renderJobBanner(el.buildJob, base.buildJob && {
      title: `${base.buildJob.label} → ур. ${base.buildJob.targetLevel}`,
      remainingSeconds: base.buildJob.remainingSeconds,
      totalSeconds: base.buildJob.totalSeconds,
    });
    renderJobBanner(el.researchJob, state.research.active && {
      title: `${state.research.active.label} → ур. ${state.research.active.targetLevel}`,
      remainingSeconds: state.research.active.remainingSeconds,
      totalSeconds: state.research.active.totalSeconds,
    });

    renderCards(base);
    renderFleet(base);
    renderQueue(base);
    renderFleetList();
    renderFleetMarkers();
    if (map.data) renderPlanetInfo();
  }

  function renderJobBanner(node, job) {
    if (!job) {
      node.hidden = true;
      return;
    }
    node.hidden = false;

    if (!node.firstChild) {
      node.innerHTML = '<div class="job-title"><span></span><b></b></div><div class="bar"><i></i></div>';
    }
    node.querySelector('.job-title span').textContent = job.title;
    node.querySelector('.job-title b').textContent = `осталось ${fmtTime(job.remainingSeconds)}`;
    const done = job.totalSeconds > 0 ? (job.totalSeconds - job.remainingSeconds) / job.totalSeconds : 1;
    node.querySelector('.bar > i').style.width = `${Math.min(100, Math.max(0, done * 100))}%`;
  }

  /**
   * Карточки создаются один раз на базу и дальше обновляются точечно:
   * полная перерисовка каждую секунду ломала бы клики по кнопкам.
   */
  const cards = { buildings: new Map(), technologies: new Map(), ships: new Map() };
  let cardsBaseId = null;

  function renderCards(base) {
    if (cardsBaseId !== base.baseId) {
      cardsBaseId = base.baseId;
      for (const map of Object.values(cards)) map.clear();
      el.buildings.innerHTML = '';
      el.technologies.innerHTML = '';
      el.ships.innerHTML = '';

      for (const building of base.buildings) {
        cards.buildings.set(building.type, createActionCard(el.buildings, building.label, '', () =>
          send(`/api/bases/${base.baseId}/build`, { type: building.type })));
      }
      for (const tech of base.technologies) {
        cards.technologies.set(tech.tech, createActionCard(el.technologies, tech.label, tech.description, () =>
          send(`/api/bases/${base.baseId}/research`, { tech: tech.tech })));
      }
      for (const ship of base.ships) {
        cards.ships.set(ship.type, createShipCard(el.ships, ship, base.baseId));
      }
    }

    for (const building of base.buildings) {
      updateBuildingCard(cards.buildings.get(building.type), base, building);
    }
    for (const tech of base.technologies) {
      updateTechCard(cards.technologies.get(tech.tech), base, tech);
    }
    for (const ship of base.ships) {
      updateShipCard(cards.ships.get(ship.type), base, ship);
    }
  }

  function createCardShell(container, title, description) {
    const article = document.createElement('article');
    article.className = 'card';

    const header = document.createElement('header');
    const heading = document.createElement('h4');
    heading.textContent = title;
    const level = document.createElement('span');
    level.className = 'level';
    header.append(heading, level);

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = description;
    desc.hidden = !description;

    const cost = document.createElement('div');
    cost.className = 'cost';
    const costMetal = document.createElement('span');
    const costCrystal = document.createElement('span');
    const costDeuterium = document.createElement('span');
    cost.append(costMetal, costCrystal, costDeuterium);

    const time = document.createElement('div');
    time.className = 'time';

    const reqs = document.createElement('div');
    reqs.className = 'reqs';

    article.append(header, desc, cost, time, reqs);
    container.appendChild(article);

    return { article, level, costMetal, costCrystal, costDeuterium, time, reqs };
  }

  function createActionCard(container, title, description, onClick) {
    const shell = createCardShell(container, title, description);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    button.addEventListener('click', onClick);
    shell.article.appendChild(button);
    return { ...shell, button };
  }

  function createShipCard(container, ship, baseId) {
    const shell = createCardShell(container, ship.label, ship.description);

    const order = document.createElement('div');
    order.className = 'order';
    const quantity = document.createElement('input');
    quantity.type = 'number';
    quantity.min = '1';
    quantity.max = '100';
    quantity.value = '1';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    button.textContent = 'Построить';
    button.addEventListener('click', () =>
      send(`/api/bases/${baseId}/ships`, { type: ship.type, quantity: Number(quantity.value) }));

    order.append(quantity, button);
    shell.article.appendChild(order);
    return { ...shell, button, quantity };
  }

  function fillCost(card, cost, resources) {
    setCostPart(card.costMetal, '◼', cost.metal, resources.metal);
    setCostPart(card.costCrystal, '◆', cost.crystal, resources.crystal);
    setCostPart(card.costDeuterium, '⬢', cost.deuterium, resources.deuterium);
  }

  function setCostPart(node, icon, amount, stock) {
    node.hidden = amount <= 0;
    node.textContent = `${icon} ${fmt(amount)}`;
    node.className = stock < amount ? 'lack' : '';
  }

  function fillRequirements(card, requirements) {
    if (!requirements.length) {
      card.reqs.hidden = true;
      return;
    }
    card.reqs.hidden = false;
    card.reqs.textContent =
      'Требуется: ' + requirements.map((req) => `${req.label} ур. ${req.level}`).join(', ');
  }

  function updateBuildingCard(card, base, building) {
    if (!card) return;
    card.level.textContent = `Ур. ${building.level}`;
    fillCost(card, building.cost, base.resources);
    card.time.textContent = `Время постройки: ${fmtTime(building.seconds)}`;
    fillRequirements(card, building.requirements);

    const locked = building.requirements.length > 0;
    card.article.classList.toggle('locked', locked);
    card.button.disabled = locked || building.busy || !building.canAfford;
    card.button.textContent = building.busy
      ? 'Идет стройка'
      : building.level === 0
        ? `Построить (ур. ${building.nextLevel})`
        : `Улучшить до ур. ${building.nextLevel}`;
  }

  function updateTechCard(card, base, tech) {
    if (!card) return;
    card.level.textContent = `Ур. ${tech.level}`;
    fillCost(card, tech.cost, base.resources);
    card.time.textContent = `Время изучения: ${fmtTime(tech.seconds)}`;
    fillRequirements(card, tech.requirements);

    const locked = tech.requirements.length > 0;
    card.article.classList.toggle('locked', locked);
    card.button.disabled = locked || tech.busy || !tech.canAfford;
    card.button.textContent = tech.busy
      ? 'Лаборатория занята'
      : `Изучить ур. ${tech.nextLevel}`;
  }

  function updateShipCard(card, base, ship) {
    if (!card) return;
    card.level.textContent = `В ангаре: ${ship.owned}`;
    fillCost(card, ship.cost, base.resources);
    card.time.textContent = `Время постройки: ${fmtTime(ship.unitSeconds)} за корабль`;
    fillRequirements(card, ship.requirements);

    const locked = ship.requirements.length > 0;
    card.article.classList.toggle('locked', locked);
    card.button.disabled = locked || !ship.canAfford;
    card.quantity.disabled = locked;
  }

  function renderFleet(base) {
    el.fleet.innerHTML = '';
    for (const [type, label] of Object.entries(SHIP_LABELS)) {
      const item = document.createElement('div');
      const value = document.createElement('b');
      value.textContent = fmt(base.fleet[type] || 0);
      item.append(value, document.createTextNode(label));
      el.fleet.appendChild(item);
    }
  }

  function renderQueue(base) {
    el.shipQueue.innerHTML = '';
    if (!base.shipQueue.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Очередь верфи пуста';
      el.shipQueue.appendChild(empty);
      return;
    }

    base.shipQueue.forEach((job, index) => {
      const item = document.createElement('div');
      item.className = 'queue-item';
      const title = document.createElement('b');
      title.textContent = `${job.label} — осталось ${job.remaining} из ${job.quantity}`;
      const timer = document.createElement('span');
      timer.textContent = index === 0
        ? `следующий через ${fmtTime(job.nextUnitInSeconds)}`
        : `в очереди · по ${fmtTime(job.unitSeconds)}`;
      item.append(title, timer);
      el.shipQueue.appendChild(item);
    });
  }

  async function send(url, body) {
    try {
      const response = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const data = await response.json();

      if (!response.ok) {
        showBuildMessage(data.error || 'Действие отклонено', false);
        return false;
      }
      showBuildMessage(data.message || 'Готово', true);
      if (state.socket) state.socket.emit('state:request');
      return true;
    } catch (error) {
      showBuildMessage('Сервер недоступен', false);
      return false;
    }
  }

  let messageTimer = null;
  function showBuildMessage(text, ok) {
    el.buildMessage.textContent = text;
    el.buildMessage.className = `build-message ${ok ? 'ok' : 'bad'}`;
    el.buildMessage.hidden = false;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { el.buildMessage.hidden = true; }, 4000);
  }


  /* ---------- Этап 3: карта системы ---------- */

  const PLANET_COLORS = {
    ROCKY: '#b08968', OCEANIC: '#4a90d9', DESERT: '#d9a441', ICE: '#8fd0e8',
    GAS_GIANT: '#c08bd9', VOLCANIC: '#d9614a', TOXIC: '#8fbf5a',
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAP = { width: 900, height: 340, starX: 60, firstOrbit: 250, orbitStep: 215 };

  const map = { data: null, selectedId: null, selectedKind: 'PLANET', hoverId: null, plan: null, planTimer: null };

  const MISSION_OPTIONS = {
    PLANET: [['TRANSPORT', 'Транспортировка'], ['SCAN', 'Разведка зондом']],
    HUB: [['HUB_DELIVERY', 'Доставка на хаб'], ['HUB_PICKUP', 'Вывоз с хаба']],
  };

  function hubX() {
    return MAP.starX + 118;
  }

  function planetX(position) {
    return MAP.starX + MAP.firstOrbit + (position - 1) * MAP.orbitStep;
  }

  async function loadMap() {
    const response = await fetch('/api/map', { headers: authHeaders() });
    if (!response.ok) return;
    map.data = await response.json();
    renderMap();
    renderPlanetInfo();
  }

  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
    return node;
  }

  function renderMap() {
    if (!map.data) return;
    const svg = el.systemMap;
    svg.innerHTML = '';

    const defs = svgEl('defs');
    defs.innerHTML =
      '<radialGradient id="starGlow"><stop offset="0%" stop-color="#fff3c4"/>' +
      '<stop offset="60%" stop-color="#ffb347"/><stop offset="100%" stop-color="rgba(255,140,60,0)"/></radialGradient>';
    svg.appendChild(defs);

    svg.appendChild(svgEl('circle', { class: 'star-core', cx: MAP.starX, cy: MAP.height / 2, r: 72 }));
    const starLabel = svgEl('text', { x: MAP.starX, y: MAP.height - 14, class: 'planet-label' });
    starLabel.textContent = `${map.data.systemName} · ${map.data.starClass}`;
    svg.appendChild(starLabel);

    for (const planet of map.data.planets) {
      const x = planetX(planet.position);
      const y = MAP.height / 2;
      svg.appendChild(svgEl('circle', {
        class: 'orbit', cx: MAP.starX, cy: y, r: x - MAP.starX,
      }));

      const group = svgEl('g', {
        class: `planet-dot${planet.planetId === map.selectedId ? ' selected' : ''}`,
      });

      const radius = planet.visibility === 'UNKNOWN' ? 22 : 28;
      group.appendChild(svgEl('circle', {
        class: 'body', cx: x, cy: y, r: radius,
        fill: planet.visibility === 'UNKNOWN' ? '#3a4360' : (PLANET_COLORS[planet.type] || '#7f8db5'),
        opacity: planet.visibility === 'UNKNOWN' ? 0.55 : 1,
      }));

      if (planet.isOwn) {
        group.appendChild(svgEl('circle', {
          cx: x, cy: y, r: radius + 7, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.5,
        }));
      } else if (planet.colonized) {
        group.appendChild(svgEl('circle', {
          cx: x, cy: y, r: radius + 7, fill: 'none', stroke: 'var(--err)',
          'stroke-width': 1.2, 'stroke-dasharray': '3 4',
        }));
      }

      const label = svgEl('text', { x, y: y + radius + 26, class: `planet-label${planet.isOwn ? ' own' : ''}` });
      label.textContent = planet.name;
      group.appendChild(label);

      const status = svgEl('text', { x, y: y + radius + 44, class: 'planet-label' });
      status.textContent = planet.visibility === 'UNKNOWN' ? 'нет данных' :
        planet.colonized ? (planet.isOwn ? 'ваша колония' : `колония: ${planet.owner}`) : 'необитаема';
      group.appendChild(status);

      group.addEventListener('mouseenter', (event) => showTooltip(planet, event));
      group.addEventListener('mousemove', (event) => positionTooltip(event));
      group.addEventListener('mouseleave', hideTooltip);
      group.addEventListener('click', () => selectPlanet(planet.planetId));
      svg.appendChild(group);
    }

    if (map.data.hub) renderHub(map.data.hub);
    renderFleetMarkers();
  }

  /** Нейтральная станция у звезды — точка входа на биржу. */
  function renderHub(hub) {
    const svg = el.systemMap;
    const x = hubX();
    const y = MAP.height / 2 - 96;

    const group = svgEl('g', {
      class: `hub-node${map.selectedKind === 'HUB' && map.selectedId === hub.hubId ? ' selected' : ''}`,
    });
    group.appendChild(svgEl('rect', {
      x: x - 20, y: y - 14, width: 40, height: 28, rx: 7,
      fill: '#2a3350', stroke: 'rgba(126, 231, 135, 0.65)', 'stroke-width': 1.5,
    }));
    group.appendChild(svgEl('line', {
      x1: x - 30, y1: y, x2: x + 30, y2: y, stroke: 'rgba(126, 231, 135, 0.5)', 'stroke-width': 2,
    }));

    const label = svgEl('text', { x, y: y - 24, class: 'planet-label' });
    label.textContent = hub.name;
    group.appendChild(label);

    const storage = svgEl('text', { x, y: y + 30, class: 'planet-label' });
    storage.textContent = hub.storage
      ? `склад: ${fmt(hub.storage.metal)} Me · ${fmt(hub.storage.crystal)} Cr`
      : 'склад пуст';
    group.appendChild(storage);

    group.addEventListener('mouseenter', (event) => showHubTooltip(hub, event));
    group.addEventListener('mousemove', (event) => positionTooltip(event));
    group.addEventListener('mouseleave', hideTooltip);
    group.addEventListener('click', () => selectHub(hub));
    svg.appendChild(group);
  }

  function showHubTooltip(hub, event) {
    el.mapTooltip.innerHTML = hub.storage
      ? `<b>${hub.name}</b><br>нейтральная торговая станция · орбита ${hub.position}<br>` +
        `твой склад: ${fmt(hub.storage.metal)} Me · ${fmt(hub.storage.crystal)} Cr<br>` +
        `занято ${fmt(hub.storage.metal + hub.storage.crystal)} из ${fmt(hub.storage.capacity)}`
      : `<b>${hub.name}</b><br>нейтральная торговая станция`;
    el.mapTooltip.hidden = false;
    positionTooltip(event);
  }

  function selectHub(hub) {
    map.selectedKind = 'HUB';
    map.selectedId = hub.hubId;
    renderMap();
    renderPlanetInfo();
  }

  /** Маркеры флотов двигаются между тиками по меткам времени. */
  function renderFleetMarkers() {
    if (!map.data) return;
    const svg = el.systemMap;
    for (const node of [...svg.querySelectorAll('.fleet-layer')]) node.remove();

    const layer = svgEl('g', { class: 'fleet-layer' });
    const now = Date.now();
    const byId = new Map(map.data.planets.map((p) => [p.planetId, p]));

    for (const fleet of state.fleets) {
      const origin = byId.get(fleet.originPlanetId);
      const target = fleet.targetKind === 'HUB'
        ? { position: null, hub: true }
        : byId.get(fleet.targetPlanetId);
      if (!origin || !target) continue;

      const outbound = fleet.status === 'OUTBOUND';
      const from = outbound ? origin : target;
      const to = outbound ? target : origin;
      const legStart = outbound ? fleet.departedAt : fleet.arrivesAt;
      const legEnd = outbound ? fleet.arrivesAt : fleet.returnsAt;
      const progress = Math.min(1, Math.max(0, (now - legStart) / Math.max(1, legEnd - legStart)));

      const x1 = from.hub ? hubX() : planetX(from.position);
      const x2 = to.hub ? hubX() : planetX(to.position);
      const y = MAP.height / 2 - 62;
      layer.appendChild(svgEl('line', { class: 'fleet-line', x1, y1: y, x2, y2: y }));
      layer.appendChild(svgEl('circle', {
        class: 'fleet-marker', cx: x1 + (x2 - x1) * progress, cy: y, r: 5,
      }));

      const label = svgEl('text', { x: x1 + (x2 - x1) * progress, y: y - 12, class: 'planet-label' });
      label.textContent = `${fleet.missionLabel} · ${fleet.etaSeconds} с`;
      layer.appendChild(label);
    }

    svg.appendChild(layer);
  }

  function showTooltip(planet, event) {
    map.hoverId = planet.planetId;
    el.mapTooltip.innerHTML = planetDetailsHtml(planet, true);
    el.mapTooltip.hidden = false;
    positionTooltip(event);
  }

  function positionTooltip(event) {
    const rect = el.mapCanvas.getBoundingClientRect();
    const left = Math.min(Math.max(8, event.clientX - rect.left + 14), Math.max(8, rect.width - 268));
    const top = Math.min(Math.max(8, event.clientY - rect.top - 20), Math.max(8, rect.height - 150));
    el.mapTooltip.style.left = `${left}px`;
    el.mapTooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    map.hoverId = null;
    el.mapTooltip.hidden = true;
  }

  /** Туман войны: чужая неразведанная планета показывает только астрономию. */
  function planetDetailsHtml(planet, short) {
    const head = `<b>${planet.name}</b><br>орбита ${planet.position} · ${PLANET_TYPES[planet.type] || planet.type} · слотов ${planet.size}`;

    if (planet.visibility === 'UNKNOWN') {
      return `${head}<br><span class="unknown">Данных нет. Отправь зонд для сканирования.</span>`;
    }

    const rich = planet.richness
      ? `<br>богатство: Me ×${planet.richness.metal} · Cr ×${planet.richness.crystal} · De ×${planet.richness.deuterium}`
      : '';
    const owner = planet.colonized ? `<br>владелец: <b>${planet.owner || 'неизвестен'}</b>` : '<br>колонии нет';
    const buildings = planet.buildings
      ? `<br>шахты: ${planet.buildings.METAL_MINE}/${planet.buildings.CRYSTAL_MINE}/${planet.buildings.DEUTERIUM_MINE}` +
        ` · лаб ${planet.buildings.RESEARCH_LAB} · верфь ${planet.buildings.SHIPYARD}`
      : '';
    const resources = planet.resources
      ? `<br>склад: ${fmt(planet.resources.metal)} Me · ${fmt(planet.resources.crystal)} Cr · ${fmt(planet.resources.deuterium)} De`
      : '';
    const fleet = planet.fleet
      ? `<br>флот: зонды ${planet.fleet.PROBE} · транспорты ${planet.fleet.TRANSPORTER} · истребители ${planet.fleet.LIGHT_FIGHTER}`
      : '';
    const age = planet.visibility === 'SCANNED'
      ? `<br><span class="unknown">данные разведки: ${fmtTime(planet.scanAgeSeconds)} назад</span>`
      : '';
    const hint = short ? '' : '<br>';

    return head + owner + rich + buildings + resources + fleet + age + hint;
  }

  function selectPlanet(planetId) {
    map.selectedKind = 'PLANET';
    map.selectedId = planetId;
    renderMap();
    renderPlanetInfo();
  }

  function selectedPlanet() {
    if (!map.data || map.selectedKind !== 'PLANET') return null;
    return map.data.planets.find((p) => p.planetId === map.selectedId) || null;
  }

  function selectedHub() {
    if (!map.data || map.selectedKind !== 'HUB') return null;
    return map.data.hub && map.data.hub.hubId === map.selectedId ? map.data.hub : null;
  }

  /** Список миссий зависит от того, что выбрано: планета или хаб. */
  function syncMissionOptions() {
    const options = MISSION_OPTIONS[map.selectedKind] || MISSION_OPTIONS.PLANET;
    const current = el.mission.value;
    const same = [...el.mission.options].map((o) => o.value).join() === options.map((o) => o[0]).join();
    if (!same) {
      el.mission.innerHTML = '';
      for (const [value, label] of options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        el.mission.appendChild(option);
      }
    }
    if (options.some((o) => o[0] === current)) el.mission.value = current;

    const pickup = el.mission.value === 'HUB_PICKUP';
    el.cargoMetalLabel.textContent = pickup ? 'Забрать металла' : 'Металл';
    el.cargoCrystalLabel.textContent = pickup ? 'Забрать кристаллов' : 'Кристаллы';
  }

  function renderPlanetInfo() {
    const base = activeBase();
    const hub = selectedHub();

    if (hub) {
      el.planetInfo.innerHTML = hub.storage
        ? `<b>${hub.name}</b><br>нейтральная торговая станция · орбита ${hub.position}<br>` +
          `твой склад: <b>${fmt(hub.storage.metal)}</b> Me · <b>${fmt(hub.storage.crystal)}</b> Cr<br>` +
          `занято ${fmt(hub.storage.metal + hub.storage.crystal)} из ${fmt(hub.storage.capacity)} ` +
          `(свободно ${fmt(hub.storage.free)})`
        : `<b>${hub.name}</b><br>нейтральная торговая станция`;
      el.dispatch.hidden = !base;
      if (base) {
        syncMissionOptions();
        renderFleetInputs();
      }
      return;
    }

    const planet = selectedPlanet();
    if (!planet) {
      el.planetInfo.innerHTML = 'Наведи курсор или выбери планету на карте.';
      el.dispatch.hidden = true;
      return;
    }

    el.planetInfo.innerHTML = planetDetailsHtml(planet, false);
    el.dispatch.hidden = !base || planet.planetId === base.planetId;
    if (!el.dispatch.hidden) {
      syncMissionOptions();
      renderFleetInputs();
    }
  }

  function renderFleetInputs() {
    const base = activeBase();
    if (!base) return;

    if (el.fleetInputs.childElementCount === 0) {
      for (const [type, label] of Object.entries(SHIP_LABELS)) {
        const field = document.createElement('label');
        field.className = 'field';
        const caption = document.createElement('span');
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.value = '0';
        input.dataset.ship = type;
        input.addEventListener('input', schedulePlan);
        field.append(caption, input);
        el.fleetInputs.appendChild(field);
        fleetInputs[type] = { caption, input };
      }
    }

    for (const [type, label] of Object.entries(SHIP_LABELS)) {
      fleetInputs[type].caption.textContent = `${label} (${base.fleet[type]})`;
      fleetInputs[type].input.max = String(base.fleet[type]);
    }
  }

  const fleetInputs = {};

  function readComposition() {
    const ships = { PROBE: 0, TRANSPORTER: 0, LIGHT_FIGHTER: 0 };
    for (const [type, refs] of Object.entries(fleetInputs)) {
      ships[type] = Math.max(0, Number(refs.input.value) || 0);
    }
    return ships;
  }

  function schedulePlan() {
    clearTimeout(map.planTimer);
    map.planTimer = setTimeout(refreshPlan, 250);
  }

  /** Расчет маршрута считает сервер — клиент только показывает результат. */
  function currentTarget() {
    const hub = selectedHub();
    if (hub) return { targetHubId: hub.hubId };
    const planet = selectedPlanet();
    return planet ? { targetPlanetId: planet.planetId } : null;
  }

  async function refreshPlan() {
    const base = activeBase();
    const target = currentTarget();
    if (!base || !target) return;

    const ships = readComposition();
    if (!ships.PROBE && !ships.TRANSPORTER && !ships.LIGHT_FIGHTER) {
      map.plan = null;
      el.flightPlan.textContent = 'Выбери корабли, чтобы увидеть расчет.';
      return;
    }

    try {
      const response = await fetch(`/api/bases/${base.baseId}/fleets/preview`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ...target, ships }),
      });
      if (!response.ok) {
        map.plan = null;
        el.flightPlan.textContent = 'Не удалось рассчитать маршрут';
        return;
      }
      map.plan = await response.json();

      const cargo = Number(el.cargoMetal.value || 0) + Number(el.cargoCrystal.value || 0);
      const overload = cargo > map.plan.capacity;
      const noFuel = map.plan.fuel > base.resources.deuterium;

      el.flightPlan.innerHTML =
        `дистанция: <b>${map.plan.distance}</b> орбит · скорость <b>${map.plan.speed}</b><br>` +
        `время в пути: <b>${fmtTime(map.plan.flightSeconds)}</b> в одну сторону<br>` +
        `топливо (туда-обратно): <b class="${noFuel ? 'bad' : ''}">${map.plan.fuel}</b> дейтерия ` +
        `(на складе ${fmt(base.resources.deuterium)})<br>` +
        `трюмы: <b class="${overload ? 'bad' : ''}">${fmt(cargo)}</b> из ${fmt(map.plan.capacity)}`;
    } catch (error) {
      el.flightPlan.textContent = 'Не удалось рассчитать маршрут';
    }
  }

  async function sendFleet() {
    const base = activeBase();
    const target = currentTarget();
    if (!base || !target) return;

    const amounts = {
      metal: Number(el.cargoMetal.value) || 0,
      crystal: Number(el.cargoCrystal.value) || 0,
    };
    const pickup = el.mission.value === 'HUB_PICKUP';

    const ok = await send(`/api/bases/${base.baseId}/fleets`, {
      ...target,
      mission: el.mission.value,
      ships: readComposition(),
      cargo: pickup ? { metal: 0, crystal: 0 } : amounts,
      pickup: pickup ? amounts : { metal: 0, crystal: 0 },
    });

    // Сбрасываем форму, чтобы повторный клик не отправил тот же флот дважды.
    if (ok) {
      for (const refs of Object.values(fleetInputs)) refs.input.value = '0';
      el.cargoMetal.value = '0';
      el.cargoCrystal.value = '0';
      map.plan = null;
      el.flightPlan.textContent = 'Выбери корабли, чтобы увидеть расчет.';
    }
    await loadMap();
    await loadMarket();
  }

  function renderFleetList() {
    el.fleetList.innerHTML = '';
    if (!state.fleets.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Флотов в полете нет';
      el.fleetList.appendChild(empty);
      return;
    }

    for (const fleet of state.fleets) {
      const item = document.createElement('div');
      item.className = 'queue-item';
      const title = document.createElement('b');
      const direction = fleet.status === 'OUTBOUND'
        ? `${fleet.originPlanetName} → ${fleet.targetName}`
        : `${fleet.targetName} → ${fleet.originPlanetName} (возврат)`;
      const cargo = fleet.cargo.metal + fleet.cargo.crystal > 0
        ? `, груз ${fmt(fleet.cargo.metal)} Me / ${fmt(fleet.cargo.crystal)} Cr`
        : '';
      title.textContent = `${fleet.missionLabel}: ${direction}`;
      const meta = document.createElement('span');
      meta.textContent = `${fleet.composition}${cargo} · прибытие через ${fmtTime(fleet.etaSeconds)}`;
      item.append(title, meta);
      el.fleetList.appendChild(item);
    }
  }

  el.sendFleetButton.addEventListener('click', () => void sendFleet());
  el.mission.addEventListener('change', () => {
    syncMissionOptions();
    schedulePlan();
  });
  el.cargoMetal.addEventListener('input', schedulePlan);
  el.cargoCrystal.addEventListener('input', schedulePlan);


  /* ---------- Этап 4: хаб и биржа ---------- */

  const market = { data: null, timer: null };
  const RESOURCE_LABELS = { METAL: 'Металл', CRYSTAL: 'Кристаллы' };

  async function loadMarket() {
    try {
      const response = await fetch('/api/market', { headers: authHeaders() });
      if (!response.ok) return;
      market.data = await response.json();
      renderMarket();
    } catch (error) {
      /* биржа подтянется на следующем обновлении */
    }
  }

  function renderMarket() {
    if (!market.data) return;
    renderHubStorage();
    renderOrderBook();
    renderMyOrders();
    renderTradeLog();
  }

  function renderHubStorage() {
    const storage = market.data.storage;
    if (!market.data.hub || !storage) {
      el.hubStorage.textContent = 'Торговый хаб недоступен';
      el.upgradeStorage.disabled = true;
      return;
    }

    el.hubStorage.innerHTML =
      `<b>${market.data.hub.name}</b><br>` +
      `металл: <b>${fmt(storage.metal)}</b> · кристаллы: <b>${fmt(storage.crystal)}</b><br>` +
      `занято ${fmt(storage.metal + storage.crystal)} из <b>${fmt(storage.capacity)}</b> ` +
      `(свободно ${fmt(storage.free)})<br>` +
      `уровень склада: <b>${storage.level}</b><br>` +
      `расширение до ур. ${storage.nextLevel}: ${fmt(storage.upgradeCost.metal)} Me + ` +
      `${fmt(storage.upgradeCost.crystal)} Cr со склада хаба → ${fmt(storage.nextCapacity)}`;

    el.upgradeStorage.disabled =
      storage.metal < storage.upgradeCost.metal || storage.crystal < storage.upgradeCost.crystal;
  }

  function renderOrderBook() {
    el.orderBook.innerHTML = '';

    for (const resource of ['METAL', 'CRYSTAL']) {
      const side = document.createElement('div');
      side.className = 'book-side';

      const title = document.createElement('h4');
      title.textContent = RESOURCE_LABELS[resource];
      side.appendChild(title);

      const book = market.data.book[resource] || { buy: [], sell: [] };
      side.appendChild(buildOrderTable('Продажа', book.sell, resource));
      side.appendChild(buildOrderTable('Покупка', book.buy, resource));
      el.orderBook.appendChild(side);
    }
  }

  function buildOrderTable(caption, orders, resource) {
    const wrap = document.createElement('div');
    const table = document.createElement('table');
    const isSell = caption === 'Продажа';

    const head = document.createElement('tr');
    head.innerHTML = `<th>${caption}</th><th>цена ₴</th><th>объем</th><th>сделка</th>`;
    table.appendChild(head);

    if (!orders.length) {
      const empty = document.createElement('div');
      empty.className = 'book-empty';
      empty.textContent = `${caption}: ордеров нет`;
      wrap.appendChild(empty);
      return wrap;
    }

    for (const order of orders) {
      const row = document.createElement('tr');
      if (order.mine) row.className = 'mine';

      const trader = document.createElement('td');
      trader.textContent = order.mine ? 'мой ордер' : order.trader;

      const price = document.createElement('td');
      price.className = isSell ? 'price-sell' : 'price-buy';
      price.textContent = order.pricePerUnit.toFixed(2);

      const volume = document.createElement('td');
      volume.textContent = fmt(order.remaining);

      const action = document.createElement('td');
      if (!order.mine) {
        const amount = document.createElement('input');
        amount.type = 'number';
        amount.className = 'fill-amount';
        amount.min = '1';
        amount.max = String(Math.floor(order.remaining));
        amount.value = String(Math.floor(order.remaining));

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = isSell ? 'Купить' : 'Продать';
        button.addEventListener('click', () => void fillOrder(order, Number(amount.value)));

        action.append(amount, button);
      }

      row.append(trader, price, volume, action);
      table.appendChild(row);
    }

    wrap.appendChild(table);
    return wrap;
  }

  /** Исполнение чужого ордера на указанный объем. */
  async function fillOrder(order, quantity) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showBuildMessage('Некорректный объем сделки', false);
      return;
    }

    await send(`/api/market/orders/${order.id}/fill`, { quantity: Math.floor(quantity) });
    await loadMarket();
  }

  function renderMyOrders() {
    el.myOrders.innerHTML = '';
    const orders = market.data.myOrders || [];

    if (!orders.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Своих ордеров нет';
      el.myOrders.appendChild(empty);
      return;
    }

    for (const order of orders) {
      const item = document.createElement('div');
      item.className = 'queue-item';

      const title = document.createElement('b');
      title.textContent =
        `${order.side === 'SELL' ? 'Продажа' : 'Покупка'}: ${RESOURCE_LABELS[order.resource]} ` +
        `${fmt(order.remaining)} из ${fmt(order.quantity)} по ${order.pricePerUnit.toFixed(2)} ₴`;

      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ghost';
      cancel.textContent = 'Снять';
      cancel.addEventListener('click', async () => {
        await sendDelete(`/api/market/orders/${order.id}`);
        await loadMarket();
      });

      item.append(title, cancel);
      el.myOrders.appendChild(item);
    }
  }

  function renderTradeLog() {
    el.tradeLog.innerHTML = '';
    const trades = market.data.trades || [];

    if (!trades.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Сделок пока не было';
      el.tradeLog.appendChild(empty);
      return;
    }

    for (const trade of trades) {
      const item = document.createElement('div');
      item.className = 'queue-item';
      const title = document.createElement('b');
      title.textContent =
        `${RESOURCE_LABELS[trade.resource]} ×${fmt(trade.quantity)} по ${trade.pricePerUnit.toFixed(2)} ₴ ` +
        `= ${fmt(trade.total)} ₴`;
      const meta = document.createElement('span');
      meta.textContent = `${trade.seller} → ${trade.buyer}${trade.mine ? ' · моя сделка' : ''}`;
      item.append(title, meta);
      el.tradeLog.appendChild(item);
    }
  }

  async function placeOrder() {
    await send('/api/market/orders', {
      side: el.orderSide.value,
      resource: el.orderResource.value,
      quantity: Number(el.orderQuantity.value),
      pricePerUnit: Number(el.orderPrice.value),
    });
    await loadMarket();
  }

  async function sendDelete(url) {
    try {
      const response = await fetch(url, { method: 'DELETE', headers: authHeaders() });
      const data = await response.json();
      showBuildMessage(response.ok ? data.message || 'Готово' : data.error || 'Не вышло', response.ok);
      return response.ok;
    } catch (error) {
      showBuildMessage('Сервер недоступен', false);
      return false;
    }
  }

  function updateOrderHint() {
    const storage = market.data && market.data.storage;
    const quantity = Number(el.orderQuantity.value) || 0;
    const price = Number(el.orderPrice.value) || 0;
    const total = Math.round(quantity * price * 100) / 100;

    if (el.orderSide.value === 'SELL') {
      const available = storage
        ? (el.orderResource.value === 'METAL' ? storage.metal : storage.crystal)
        : 0;
      el.orderHint.innerHTML =
        `Продажа заблокирует <b>${fmt(quantity)}</b> со склада хаба (там ${fmt(available)}).<br>` +
        `Выручка при полном исполнении: <b>${fmt(total)} ₴</b>`;
    } else {
      el.orderHint.innerHTML =
        `Покупка заблокирует <b>${fmt(total)} ₴</b> (баланс ${fmt(state.credits)} ₴).<br>` +
        `Товар придет на склад хаба — нужно место.`;
    }
  }

  el.placeOrderButton.addEventListener('click', () => void placeOrder());
  el.upgradeStorage.addEventListener('click', async () => {
    await send('/api/market/storage/upgrade', {});
    await loadMarket();
  });
  for (const node of [el.orderSide, el.orderResource, el.orderQuantity, el.orderPrice]) {
    node.addEventListener('input', updateOrderHint);
    node.addEventListener('change', updateOrderHint);
  }

  /* ---------- Старт ---------- */
  if (state.token) {
    enterGame().catch(() => {
      el.loginScreen.hidden = false;
    });
  }
})();

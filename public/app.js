/* Командный центр — клиент Этапов 1-2. Все расчеты на сервере, клиент только рисует состояние. */
(() => {
  'use strict';

  const TOKEN_KEY = 'spacemmo.token';

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    username: '',
    bases: [],
    research: { techs: {}, active: null },
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
  });

  /* ---------- Рендер ---------- */

  function applyState(payload) {
    state.bases = payload.bases || [];
    state.research = payload.research || { techs: {}, active: null };
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
        return;
      }
      showBuildMessage(data.message || 'Готово', true);
      if (state.socket) state.socket.emit('state:request');
    } catch (error) {
      showBuildMessage('Сервер недоступен', false);
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

  /* ---------- Старт ---------- */
  if (state.token) {
    enterGame().catch(() => {
      el.loginScreen.hidden = false;
    });
  }
})();

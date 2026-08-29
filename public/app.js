/* Командный центр — клиент игры. Все расчеты на сервере, клиент только рисует состояние. */
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
    dashboard: $('dashboard'),
    authTabs: document.querySelector('.auth-tabs'),
    authForm: $('auth-form'),
    authEmail: $('auth-email'),
    authPassword: $('auth-password'),
    authSubmit: $('auth-submit'),
    authMessage: $('auth-message'),
    forgotPassword: $('forgot-password'),
    providers: document.querySelector('.providers'),
    resetForm: $('reset-form'),
    resetToken: $('reset-token'),
    resetPassword: $('reset-password'),
    resetMessage: $('reset-message'),
    resetBack: $('reset-back'),
    commanderForm: $('commander-form'),
    commanderNickname: $('commander-nickname'),
    commanderMessage: $('commander-message'),
    commanderLogout: $('commander-logout'),
    commanderProfile: $('commander-profile'),
    commanderAvatar: $('commander-avatar'),
    avatarPicker: $('avatar-picker'),
    achievements: $('achievements'),
    syndicatePanel: $('syndicate-panel'),
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
    defenses: $('defenses'),
    defenseSummary: $('defense-summary'),
    defenseQueue: $('defense-queue'),
    diplomacy: $('diplomacy'),
    battles: $('battles'),
    expeditionSlots: $('expedition-slots'),
    expeditions: $('expeditions'),
    resAntimatter: $('res-antimatter'),
    rateAntimatter: $('rate-antimatter'),
    galaxyMap: $('galaxy-map'),
    mapModes: document.querySelector('.map-modes'),
    mapCaption: $('map-caption'),
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

  const SHIP_LABELS = {
    PROBE: 'Зонды',
    TRANSPORTER: 'Транспорты',
    LIGHT_FIGHTER: 'Истребители',
    HEAVY_CRUISER: 'Крейсера',
    ION_FRIGATE: 'Фрегаты',
  };

  const fmt = (value) => Math.floor(value).toLocaleString('ru-RU');
  const fmtRate = (value) => `+${value.toFixed(2)}/с`;
  /** Антиматерия копится долями, поэтому мелкие значения показываем точнее. */
  const fmtAmount = (value) => (value > 0 && value < 10 ? value.toFixed(2) : fmt(value));

  function fmtTime(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h} ч ${m} мин`;
    if (m > 0) return `${m} мин ${s} с`;
    return `${s} с`;
  }

  /* ---------- Авторизация и онбординг ---------- */

  const auth = { mode: 'login', avatars: [], avatarId: 'nova', profile: null };

  const screens = {
    auth: $('auth-screen'),
    reset: $('reset-screen'),
    commander: $('commander-screen'),
    dashboard: $('dashboard'),
  };

  function showScreen(name) {
    for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  }

  function showAuthMessage(node, text, ok) {
    node.textContent = text;
    node.className = `auth-message ${ok ? 'ok' : 'bad'}`;
    node.hidden = false;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {}),
      },
    });
    let data = null;
    try { data = await response.json(); } catch (error) { data = null; }
    return { ok: response.ok, status: response.status, data: data || {} };
  }

  /* --- переключение вход / регистрация --- */
  el.authTabs.addEventListener('click', (event) => {
    const button = event.target.closest('.auth-tab');
    if (!button) return;
    auth.mode = button.dataset.auth;
    for (const tab of el.authTabs.querySelectorAll('.auth-tab')) {
      tab.classList.toggle('active', tab.dataset.auth === auth.mode);
    }
    el.authSubmit.textContent = auth.mode === 'login' ? 'Войти' : 'Создать аккаунт';
    el.authPassword.autocomplete = auth.mode === 'login' ? 'current-password' : 'new-password';
    el.authMessage.hidden = true;
  });

  el.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const path = auth.mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const result = await api(path, {
      method: 'POST',
      body: JSON.stringify({ email: el.authEmail.value, password: el.authPassword.value }),
    });

    if (!result.ok) {
      showAuthMessage(el.authMessage, result.data.error || 'Не удалось войти', false);
      return;
    }

    state.token = result.data.token;
    localStorage.setItem(TOKEN_KEY, state.token);
    await startSession();
  });

  /* --- вход через провайдеров: обработчики готовы, ключей пока нет --- */
  el.providers.addEventListener('click', async (event) => {
    const button = event.target.closest('.provider');
    if (!button) return;

    const provider = button.dataset.provider;
    // Когда появятся ключи, здесь будет получение id_token у SDK провайдера.
    const result = await api(`/api/auth/oauth/${provider.toLowerCase()}`, {
      method: 'POST',
      body: JSON.stringify({ idToken: '' }),
    });
    showAuthMessage(el.authMessage, result.data.error || 'Провайдер ответил неожиданно', result.ok);
  });

  /* --- смена пароля --- */
  el.forgotPassword.addEventListener('click', async () => {
    const email = el.authEmail.value.trim();
    if (!email) {
      showAuthMessage(el.authMessage, 'Введи email — на него придет код', false);
      return;
    }

    const result = await api('/api/auth/password/reset-request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    if (!result.ok) {
      showAuthMessage(el.authMessage, result.data.error || 'Не удалось создать запрос', false);
      return;
    }

    showScreen('reset');
    el.resetToken.value = result.data.devToken || '';
    showAuthMessage(
      el.resetMessage,
      result.data.devToken
        ? 'Код подставлен автоматически: почта еще не подключена.'
        : result.data.message,
      true,
    );
  });

  el.resetBack.addEventListener('click', () => showScreen('auth'));

  el.resetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await api('/api/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({ token: el.resetToken.value.trim(), password: el.resetPassword.value }),
    });

    if (!result.ok) {
      showAuthMessage(el.resetMessage, result.data.error || 'Не удалось сменить пароль', false);
      return;
    }

    state.token = result.data.token;
    localStorage.setItem(TOKEN_KEY, state.token);
    await startSession();
  });

  /* --- онбординг: создание командира --- */
  function renderAvatars() {
    el.avatarPicker.innerHTML = '';
    for (const avatar of auth.avatars) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `avatar-option${avatar.id === auth.avatarId ? ' active' : ''}`;
      option.innerHTML = `<b>${avatar.glyph}</b>${avatar.label}`;
      option.addEventListener('click', () => {
        auth.avatarId = avatar.id;
        renderAvatars();
      });
      el.avatarPicker.appendChild(option);
    }
  }

  el.commanderForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await api('/api/auth/commander', {
      method: 'POST',
      body: JSON.stringify({ nickname: el.commanderNickname.value, avatarId: auth.avatarId }),
    });

    if (!result.ok) {
      showAuthMessage(el.commanderMessage, result.data.error || 'Не удалось создать командира', false);
      return;
    }
    auth.profile = result.data.commander;
    await enterGame();
  });

  el.commanderLogout.addEventListener('click', () => logout());

  function authHeaders() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` };
  }

  /** Загрузка игрового состояния и переход в дашборд. */
  async function enterGame() {
    const response = await fetch('/api/state', { headers: authHeaders() });

    if (response.status === 409) {
      // Сервер требует онбординг: аккаунт есть, командира еще нет.
      renderAvatars();
      showScreen('commander');
      return;
    }
    if (!response.ok) {
      logout();
      showAuthMessage(el.authMessage, 'Сессия истекла, войди заново', false);
      return;
    }

    const data = await response.json();
    state.username = data.commander.nickname;
    el.userName.textContent = data.commander.nickname;
    if (auth.profile) {
      const avatar = auth.avatars.find((item) => item.id === auth.profile.avatarId);
      el.commanderAvatar.textContent = avatar ? avatar.glyph : '✦';
    }
    showScreen('dashboard');

    applyState(data);
    connectSocket();
    renderProfile();
    await loadMap();
    await loadGalaxy();
    await loadMarket();
    await loadWar();
  }

  /**
   * Точка входа после получения токена: сервер сам решает, пускать ли в игру.
   * Нет командира — показываем онбординг, а не пустой дашборд.
   */
  async function startSession() {
    const session = await api('/api/auth/me');
    if (!session.ok) {
      logout();
      return;
    }

    auth.avatars = session.data.avatars || [];
    auth.profile = session.data.commander;
    if (!auth.avatarId && auth.avatars.length) auth.avatarId = auth.avatars[0].id;

    if (!session.data.commander) {
      renderAvatars();
      showScreen('commander');
      return;
    }
    await enterGame();
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    if (state.socket) state.socket.disconnect();
    state.token = '';
    state.bases = [];
    auth.profile = null;
    cards.buildings.clear();
    cards.technologies.clear();
    cards.ships.clear();
    cards.defenses.clear();
    cardsBaseId = null;
    showScreen('auth');
  }

  /* --- профиль и достижения --- */
  function renderProfile() {
    if (!auth.profile) return;
    const p = auth.profile;
    const avatar = auth.avatars.find((item) => item.id === p.avatarId);

    el.commanderProfile.innerHTML =
      `<div class="hub-storage"><b>${avatar ? avatar.glyph : '✦'} ${p.nickname}</b><br>` +
      `боев выиграно: <b>${p.battlesWon}</b> · проиграно: <b>${p.battlesLost}</b><br>` +
      `родная колония: <b>${p.homePlanet || '—'}</b><br>` +
      `в строю с ${new Date(p.createdAt).toLocaleDateString('ru-RU')}</div>`;

    el.achievements.innerHTML = '';
    for (const achievement of p.achievements || []) {
      const card = document.createElement('article');
      card.className = `card achievement${achievement.unlockedAt ? ' unlocked' : ''}`;
      card.innerHTML =
        `<header><h4>${achievement.icon} ${achievement.title}</h4></header>` +
        `<div class="desc">${achievement.description}</div>` +
        (achievement.unlockedAt
          ? `<div class="when">получено ${new Date(achievement.unlockedAt).toLocaleString('ru-RU')}</div>`
          : '<div class="time">еще не получено</div>');
      el.achievements.appendChild(card);
    }
  }

  async function refreshProfile() {
    const session = await api('/api/auth/me');
    if (!session.ok) return;
    auth.avatars = session.data.avatars || auth.avatars;
    auth.profile = session.data.commander;
    renderProfile();
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
    if (state.activeTab === 'map') {
      void loadMap();
      void loadGalaxy();
    }
    if (state.activeTab === 'market') void loadMarket();
    if (state.activeTab === 'syndicate') void loadSyndicate();
    if (state.activeTab === 'war') {
      void loadWar();
      void refreshProfile();
    }
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
    el.resAntimatter.textContent = fmt(base.resources.antimatter);
    el.rateAntimatter.textContent = `+${base.productionPerSecond.antimatter.toFixed(3)}/с`;
    el.rateEnergy.textContent = `из ${fmt(base.energy.output)}`;

    const efficiency = Math.round(base.energy.efficiency * 100);
    el.resEfficiency.textContent = `${efficiency}%`;
    el.resEfficiency.style.color = efficiency < 100 ? 'var(--warn)' : '';
    el.rateEfficiency.textContent = efficiency < 100 ? 'дефицит энергии' : 'мощность шахт';

    el.baseName.textContent = base.baseName;
    el.planetMeta.textContent =
      `${base.planetName} · ${PLANET_TYPES[base.planetType] || base.planetType} · ` +
      `система ${base.systemName} · орбита ${base.position} · слотов ${base.size}` +
      (base.anomaly === 'BLACK_HOLE' ? ' · черная дыра: искажение времени' : '');

    el.richness.innerHTML = `
      <div>Металл<b>×${base.richness.metal}</b></div>
      <div>Кристаллы<b>×${base.richness.crystal}</b></div>
      <div>Дейтерий<b>×${base.richness.deuterium}</b></div>
      <div>Инсоляция<b>×${base.richness.energy}</b></div>
      <div>Антиматерия<b>×${base.richness.antimatter}</b></div>`;

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
    renderDefenses(base);
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
  const cards = { buildings: new Map(), technologies: new Map(), ships: new Map(), defenses: new Map() };
  let cardsBaseId = null;

  function renderCards(base) {
    if (cardsBaseId !== base.baseId) {
      cardsBaseId = base.baseId;
      for (const map of Object.values(cards)) map.clear();
      el.buildings.innerHTML = '';
      el.technologies.innerHTML = '';
      el.ships.innerHTML = '';
      el.defenses.innerHTML = '';

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
      for (const item of base.defenseCards) {
        cards.defenses.set(item.type, createDefenseCard(el.defenses, item, base.baseId));
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
    for (const item of base.defenseCards) {
      updateShipCard(cards.defenses.get(item.type), base, item, 'На позиции');
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

    const combat = document.createElement('div');
    combat.className = 'combat-line';

    const time = document.createElement('div');
    time.className = 'time';

    const reqs = document.createElement('div');
    reqs.className = 'reqs';

    article.append(header, desc, combat, cost, time, reqs);
    container.appendChild(article);

    return { article, level, costMetal, costCrystal, costDeuterium, combat, time, reqs };
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

  function createDefenseCard(container, item, baseId) {
    const shell = createCardShell(container, item.label, item.description);

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
      send(`/api/bases/${baseId}/defenses`, { type: item.type, quantity: Number(quantity.value) }));

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

  /** Строка боевого профиля: тип урона и слои защиты — по ней собирают контр-флот. */
  function combatLine(combat) {
    if (!combat) return '';
    const attack = combat.damage > 0 ? `урон ${combat.damage} (${combat.damageLabel})` : 'без оружия';
    const layers = [
      combat.shield > 0 ? `щиты ${combat.shield}` : null,
      combat.armor > 0 ? `броня ${combat.armor}` : null,
      `корпус ${combat.hull}`,
    ].filter(Boolean);
    return `${attack} · ${layers.join(' · ')}`;
  }

  function updateShipCard(card, base, ship, ownedLabel = 'В ангаре') {
    if (!card) return;
    card.level.textContent = `${ownedLabel}: ${ship.owned}`;
    if (card.combat) card.combat.textContent = combatLine(ship.combat);
    fillCost(card, ship.cost, base.resources);
    card.time.textContent = `Время постройки: ${fmtTime(ship.unitSeconds)} за штуку`;
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


  /* ---------- Карта системы ---------- */

  const PLANET_COLORS = {
    ROCKY: '#b08968', OCEANIC: '#4a90d9', DESERT: '#d9a441', ICE: '#8fd0e8',
    GAS_GIANT: '#c08bd9', VOLCANIC: '#d9614a', TOXIC: '#8fbf5a',
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAP = { width: 900, height: 340, starX: 60, firstOrbit: 250, orbitStep: 215 };

  const map = { data: null, selectedId: null, selectedKind: 'PLANET', hoverId: null, plan: null, planTimer: null };

  const MISSION_OPTIONS = {
    PLANET: [['TRANSPORT', 'Транспортировка'], ['SCAN', 'Разведка зондом'], ['ATTACK', 'Атака']],
    HUB: [['HUB_DELIVERY', 'Доставка на хаб'], ['HUB_PICKUP', 'Вывоз с хаба']],
    DEEP_SPACE: [['EXPEDITION', 'Экспедиция']],
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
    updateMapCaption();
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
    renderDeepSpace();
    renderFleetMarkers();
  }

  /** Глубокий космос — абстрактная 16-я позиция системы, точка экспедиций. */
  function renderDeepSpace() {
    const svg = el.systemMap;
    const x = MAP.width - 46;
    const y = MAP.height / 2;

    const group = svgEl('g', {
      class: `planet-dot${map.selectedKind === 'DEEP_SPACE' ? ' selected' : ''}`,
    });
    group.appendChild(svgEl('circle', {
      class: 'body', cx: x, cy: y, r: 24,
      fill: 'rgba(157, 123, 255, 0.10)', stroke: 'rgba(157, 123, 255, 0.55)',
      'stroke-width': 1.5, 'stroke-dasharray': '4 4',
    }));

    const label = svgEl('text', { x, y: y + 46, class: 'planet-label' });
    label.textContent = 'Глубокий космос';
    group.appendChild(label);

    const position = svgEl('text', { x, y: y + 60, class: 'planet-label' });
    position.textContent = 'позиция 16';
    group.appendChild(position);

    group.addEventListener('mouseenter', (event) => {
      el.mapTooltip.innerHTML =
        '<b>Глубокий космос</b><br>16-я позиция системы · точка экспедиций<br>' +
        '<span class="unknown">Что там — неизвестно до прилета.</span>';
      el.mapTooltip.hidden = false;
      positionTooltip(event);
    });
    group.addEventListener('mousemove', (event) => positionTooltip(event));
    group.addEventListener('mouseleave', hideTooltip);
    group.addEventListener('click', () => selectDeepSpace());
    svg.appendChild(group);
  }

  function selectDeepSpace() {
    map.selectedKind = 'DEEP_SPACE';
    map.selectedId = map.data ? map.data.systemId : null;
    renderMap();
    renderPlanetInfo();
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
        : fleet.targetKind === 'DEEP_SPACE'
          ? { position: null, deep: true }
          : byId.get(fleet.targetPlanetId);
      if (!origin || !target) continue;

      const outbound = fleet.status === 'OUTBOUND';
      const from = outbound ? origin : target;
      const to = outbound ? target : origin;
      const legStart = outbound ? fleet.departedAt : fleet.arrivesAt;
      const legEnd = outbound ? fleet.arrivesAt : fleet.returnsAt;
      const progress = Math.min(1, Math.max(0, (now - legStart) / Math.max(1, legEnd - legStart)));

      const x1 = from.hub ? hubX() : from.deep ? MAP.width - 46 : planetX(from.position);
      const x2 = to.hub ? hubX() : to.deep ? MAP.width - 46 : planetX(to.position);
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
      ? `<br>богатство: Me ×${planet.richness.metal} · Cr ×${planet.richness.crystal} · ` +
        `De ×${planet.richness.deuterium} · антиматерия ×${planet.richness.antimatter}`
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

  function deepSpaceSelected() {
    return Boolean(map.data && map.selectedKind === 'DEEP_SPACE');
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

    if (deepSpaceSelected()) {
      const slots = war.data && war.data.expeditionSlots;
      el.planetInfo.innerHTML =
        `<b>Глубокий космос</b><br>система ${map.data.systemName} · 16-я позиция<br>` +
        'Экспедиция уходит за пределы орбит: там можно найти брошенный груз, ' +
        'наткнуться на пиратов или не найти ничего.<br>' +
        (slots ? `слотов экспедиций: <b>${slots.used}</b> из <b>${slots.total}</b>` : '');
      el.dispatch.hidden = !base;
      if (base) {
        syncMissionOptions();
        renderFleetInputs();
      }
      return;
    }

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
    if (deepSpaceSelected()) return { targetSystemId: map.data.systemId };
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
      const jump = map.plan.kind === 'INTERSTELLAR';

      // Внутри системы жжем дейтерий, между системами — антиматерию.
      const fuelAmount = jump ? map.plan.antimatter : map.plan.fuel;
      const fuelStock = jump ? base.resources.antimatter : base.resources.deuterium;
      const fuelName = jump ? 'антиматерии' : 'дейтерия';
      const noFuel = fuelAmount > fuelStock;

      el.flightPlan.innerHTML =
        (jump
          ? `<b>Гиперпрыжок</b> · дистанция <b>${map.plan.distance}</b> ед. по галактике<br>`
          : `дистанция: <b>${map.plan.distance}</b> орбит · скорость <b>${map.plan.speed}</b><br>`) +
        `время в пути: <b>${fmtTime(map.plan.flightSeconds)}</b> в одну сторону<br>` +
        `топливо (туда-обратно): <b class="${noFuel ? 'bad' : ''}">${fmtAmount(fuelAmount)}</b> ${fuelName} ` +
        `(на складе ${fmtAmount(fuelStock)})<br>` +
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
    await loadGalaxy();
    await loadMarket();
    await loadWar();
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


  /* ---------- Хаб и биржа ---------- */

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


  /* ---------- Оборона, бои, дипломатия ---------- */

  const DEFENSE_LABELS = { ROCKET_LAUNCHER: 'Ракетные установки', LASER_TURRET: 'Лазерные орудия' };
  const war = { data: null };

  async function loadWar() {
    try {
      const response = await fetch('/api/war', { headers: authHeaders() });
      if (!response.ok) return;
      war.data = await response.json();
      renderDiplomacy();
      renderBattles();
      renderExpeditions();
    } catch (error) {
      /* подтянется на следующем обновлении */
    }
  }

  function renderDiplomacy() {
    el.diplomacy.innerHTML = '';
    const mySyndicate = war.data && war.data.syndicate;

    // В синдикате дипломатия ведется на уровне альянсов, а не отдельных командиров.
    if (mySyndicate) {
      renderSyndicateDiplomacy(mySyndicate);
      return;
    }

    const players = (war.data && war.data.players) || [];

    if (!players.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'В системе нет других колоний';
      el.diplomacy.appendChild(empty);
      return;
    }

    for (const player of players) {
      const item = document.createElement('div');
      item.className = 'queue-item war-item';

      const info = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = `${player.nickname} · ${player.planetName}`;
      const status = document.createElement('div');
      status.className = player.atWar ? 'status-war' : 'status-peace';
      status.textContent = player.atWar
        ? `война${player.declaredByMe ? ' (объявили мы)' : ' (объявили нам)'}`
        : 'мир';
      info.append(title, status);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = player.atWar ? 'ghost' : 'primary';
      button.textContent = player.atWar ? 'Заключить мир' : 'Объявить войну';
      button.addEventListener('click', async () => {
        await send(`/api/war/${player.atWar ? 'peace' : 'declare'}`, { targetId: player.commanderId });
        await loadWar();
        await loadMap();
      });

      item.append(info, button);
      el.diplomacy.appendChild(item);
    }
  }

  /** Войны синдикатов: объявлять и мириться могут лидер и офицеры. */
  function renderSyndicateDiplomacy(mine) {
    const canDeclare = mine.role === 'LEADER' || mine.role === 'OFFICER';

    const header = document.createElement('div');
    header.className = 'queue-item';
    header.innerHTML =
      `<b>Синдикат [${mine.tag}] ${mine.name}</b>` +
      `<span>${canDeclare
        ? 'ты можешь объявлять войну и заключать мир от лица синдиката'
        : 'войну объявляют лидер и офицеры — личные войны недоступны'}</span>`;
    el.diplomacy.appendChild(header);

    const others = (war.data.otherSyndicates || []);
    if (!others.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Других синдикатов в галактике пока нет';
      el.diplomacy.appendChild(empty);
      return;
    }

    for (const other of others) {
      const row = document.createElement('div');
      row.className = 'queue-item war-item';

      const info = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = `[${other.tag}] ${other.name}`;
      const status = document.createElement('div');
      status.className = other.atWar ? 'status-war' : 'status-peace';
      status.textContent = other.atWar ? 'война синдикатов' : 'мир';
      info.append(title, status);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = other.atWar ? 'ghost' : 'primary';
      button.textContent = other.atWar ? 'Заключить мир' : 'Объявить войну';
      button.disabled = !canDeclare;
      button.addEventListener('click', async () => {
        await send(`/api/war/syndicate/${other.atWar ? 'peace' : 'declare'}`, {
          targetSyndicateId: other.syndicateId || other.id,
        });
        await loadWar();
      });

      row.append(info, button);
      el.diplomacy.appendChild(row);
    }
  }

  function renderBattles() {
    el.battles.innerHTML = '';
    const battles = (war.data && war.data.battles) || [];

    if (!battles.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Боев еще не было';
      el.battles.appendChild(empty);
      return;
    }

    for (const battle of battles) {
      const card = document.createElement('article');
      card.className = `battle ${battle.victory ? 'win' : 'loss'}`;

      const header = document.createElement('header');
      const title = document.createElement('h4');
      title.textContent = `${battle.attackerName} → ${battle.defenderName} · ${battle.planetName}`;
      const verdict = document.createElement('span');
      verdict.className = 'verdict';
      verdict.textContent = battle.victory
        ? (battle.role === 'ATTACKER' ? 'победа: атака удалась' : 'победа: атака отбита')
        : (battle.role === 'ATTACKER' ? 'поражение: флот разбит' : 'поражение: оборона пала');
      header.append(title, verdict);

      const powers = document.createElement('div');
      powers.className = 'line';
      powers.innerHTML =
        `роль: <b>${battle.role === 'ATTACKER' ? 'атакующий' : 'защитник'}</b> · ` +
        `огневая мощь <b>${fmt(battle.attackerPower)}</b> против <b>${fmt(battle.defenderPower)}</b>`;

      const losses = document.createElement('div');
      losses.className = 'line';
      losses.innerHTML =
        `мои потери: <b>${describeLosses(battle.myLosses)}</b><br>` +
        `потери противника: <b>${describeLosses(battle.enemyLosses)}</b>`;

      const plunder = document.createElement('div');
      plunder.className = 'line';
      const looted = battle.plunder.metal + battle.plunder.crystal > 0;
      plunder.innerHTML = looted
        ? `награблено: <b>${fmt(battle.plunder.metal)}</b> металла и <b>${fmt(battle.plunder.crystal)}</b> кристаллов` +
          `${battle.role === 'DEFENDER' ? ' (вывезено с нашего склада)' : ''}`
        : 'ресурсы не вывозились';

      const when = document.createElement('div');
      when.className = 'line';
      when.textContent = new Date(battle.createdAt).toLocaleString('ru-RU');

      card.append(header, powers, losses);

      // Куда ушел урон — главный ответ на вопрос «почему я проиграл».
      for (const [report, title] of [
        [battle.myDamage, 'мой урон'],
        [battle.enemyDamage, 'урон противника'],
      ]) {
        if (!report) continue;
        const line = document.createElement('div');
        line.className = 'line';
        const mix = (report.damageMix || []).map((d) => d.label).join(', ') || 'без оружия';
        line.innerHTML =
          `${title} (${mix}): щиты поглотили <b>${fmt(report.shield)}</b>, ` +
          `броня <b>${fmt(report.armor)}</b>, по корпусу прошло <b>${fmt(report.hull)}</b>`;
        card.appendChild(line);
      }

      card.append(plunder, when);
      el.battles.appendChild(card);
    }
  }

  function describeLosses(losses) {
    const real = (losses || []).filter((item) => item.lost > 0);
    if (!real.length) return 'без потерь';
    return real.map((item) => `${item.label} −${item.lost} из ${item.before}`).join(', ');
  }

  function renderDefenses(base) {
    el.defenseSummary.innerHTML = '';
    for (const [type, label] of Object.entries(DEFENSE_LABELS)) {
      const item = document.createElement('div');
      const value = document.createElement('b');
      value.textContent = fmt(base.defenses[type] || 0);
      item.append(value, document.createTextNode(label));
      el.defenseSummary.appendChild(item);
    }

    el.defenseQueue.innerHTML = '';
    if (!base.defenseQueue.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Очередь обороны пуста';
      el.defenseQueue.appendChild(empty);
    } else {
      base.defenseQueue.forEach((job, index) => {
        const item = document.createElement('div');
        item.className = 'queue-item';
        const title = document.createElement('b');
        title.textContent = `${job.label} — осталось ${job.remaining} из ${job.quantity}`;
        const timer = document.createElement('span');
        timer.textContent = index === 0
          ? `следующая через ${fmtTime(job.nextUnitInSeconds)}`
          : `в очереди · по ${fmtTime(job.unitSeconds)}`;
        item.append(title, timer);
        el.defenseQueue.appendChild(item);
      });
    }
  }


  /* ---------- Макро-карта галактики ---------- */

  const GALAXY = { width: 900, height: 560, margin: 60 };
  const galaxy = { data: null, mode: 'system' };

  async function loadGalaxy() {
    try {
      const response = await fetch('/api/galaxy', { headers: authHeaders() });
      if (!response.ok) return;
      galaxy.data = await response.json();
      if (galaxy.mode === 'galaxy') renderGalaxy();
      updateMapCaption();
    } catch (error) {
      /* подтянется при следующем открытии карты */
    }
  }

  /** Координаты сетки галактики переводим в координаты SVG. */
  function galaxyPoint(system, bounds) {
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanY = Math.max(1, bounds.maxY - bounds.minY);
    const usableW = GALAXY.width - GALAXY.margin * 2;
    const usableH = GALAXY.height - GALAXY.margin * 2;
    return {
      x: GALAXY.margin + ((system.galaxyX - bounds.minX) / spanX) * usableW,
      y: GALAXY.margin + ((system.galaxyY - bounds.minY) / spanY) * usableH,
    };
  }

  const STAR_COLORS = {
    BLUE: '#8ab4ff', WHITE: '#e8eeff', YELLOW: '#ffd66b', ORANGE: '#ff9f5a', RED: '#ff6b6b',
  };

  function renderGalaxy() {
    if (!galaxy.data) return;
    const svg = el.galaxyMap;
    svg.innerHTML = '';

    const systems = galaxy.data.systems;
    const bounds = {
      minX: Math.min(...systems.map((s) => s.galaxyX)),
      maxX: Math.max(...systems.map((s) => s.galaxyX)),
      minY: Math.min(...systems.map((s) => s.galaxyY)),
      maxY: Math.max(...systems.map((s) => s.galaxyY)),
    };

    // Сетка, чтобы карта читалась как координатное пространство.
    for (let i = 0; i <= 4; i += 1) {
      const x = GALAXY.margin + ((GALAXY.width - GALAXY.margin * 2) / 4) * i;
      const y = GALAXY.margin + ((GALAXY.height - GALAXY.margin * 2) / 4) * i;
      svg.appendChild(svgEl('line', { class: 'galaxy-grid', x1: x, y1: GALAXY.margin, x2: x, y2: GALAXY.height - GALAXY.margin }));
      svg.appendChild(svgEl('line', { class: 'galaxy-grid', x1: GALAXY.margin, y1: y, x2: GALAXY.width - GALAXY.margin, y2: y }));
    }

    for (const system of systems) {
      const point = galaxyPoint(system, bounds);
      const blackHole = system.anomaly === 'BLACK_HOLE';

      const group = svgEl('g', {
        class: `system-node${system.isHome ? ' home' : ''}` +
          (map.data && map.data.systemId === system.systemId ? ' selected' : ''),
      });

      group.appendChild(svgEl('circle', {
        class: 'halo', cx: point.x, cy: point.y, r: 16,
        fill: 'none', stroke: system.hasOwnColony ? 'var(--accent)' : 'rgba(120,160,255,0.25)',
        'stroke-width': system.hasOwnColony ? 2 : 1,
      }));

      if (blackHole) {
        group.appendChild(svgEl('circle', { class: 'blackhole-ring', cx: point.x, cy: point.y, r: 11 }));
        group.appendChild(svgEl('circle', { class: 'star', cx: point.x, cy: point.y, r: 6, fill: '#120a1c', stroke: '#ff8fd8' }));
      } else {
        group.appendChild(svgEl('circle', {
          class: 'star', cx: point.x, cy: point.y, r: 7,
          fill: STAR_COLORS[system.starClass] || '#cfd8ff',
        }));
      }

      const label = svgEl('text', { x: point.x, y: point.y + 30, class: `system-label${system.isHome ? ' home' : ''}` });
      label.textContent = system.name;
      group.appendChild(label);

      const coords = svgEl('text', { x: point.x, y: point.y + 44, class: 'system-label' });
      coords.textContent = `${system.galaxyX}:${system.galaxyY}`;
      group.appendChild(coords);

      group.addEventListener('mouseenter', (event) => showSystemTooltip(system, event));
      group.addEventListener('mousemove', (event) => positionTooltip(event));
      group.addEventListener('mouseleave', hideTooltip);
      group.addEventListener('click', () => void openSystem(system.systemId));
      svg.appendChild(group);
    }
  }

  function showSystemTooltip(system, event) {
    const blackHole = system.anomaly === 'BLACK_HOLE';
    el.mapTooltip.innerHTML =
      `<b>${system.name}</b><br>координаты ${system.galaxyX}:${system.galaxyY} · планет ${system.planetCount}<br>` +
      (blackHole
        ? '<span class="unknown">Черная дыра: искажение времени</span><br>' +
          'синтез антиматерии +50%, стройка и наука на 30% дольше<br>'
        : `звезда класса ${system.starClass}<br>`) +
      (system.hasOwnColony ? 'здесь ваша колония<br>' : system.colonized ? 'система заселена<br>' : 'колоний нет<br>') +
      (system.scannedPlanets > 0 ? `разведано планет: ${system.scannedPlanets}` : 'разведданных нет');
    el.mapTooltip.hidden = false;
    positionTooltip(event);
  }

  /** Открывает систему на микро-карте: своя или чужая, с тем же туманом войны. */
  async function openSystem(systemId) {
    const response = await fetch(`/api/map?systemId=${encodeURIComponent(systemId)}`, {
      headers: authHeaders(),
    });
    if (!response.ok) return;
    map.data = await response.json();
    map.selectedId = null;
    map.selectedKind = 'PLANET';
    setMapMode('system');
    renderMap();
    renderPlanetInfo();
    updateMapCaption();
  }

  /**
   * У SVG нет HTML-свойства hidden: присваивание node.hidden не отражается
   * в атрибуте, и CSS-правило [hidden] его не видит. Поэтому переключаем атрибутом.
   */
  function toggleNode(node, visible) {
    if (visible) node.removeAttribute('hidden');
    else node.setAttribute('hidden', '');
  }

  function setMapMode(mode) {
    galaxy.mode = mode;
    toggleNode(el.systemMap, mode === 'system');
    toggleNode(el.galaxyMap, mode === 'galaxy');
    hideTooltip();

    for (const button of el.mapModes.querySelectorAll('.mode')) {
      button.classList.toggle('active', button.dataset.mode === mode);
    }
    if (mode === 'galaxy') renderGalaxy();
    updateMapCaption();
  }

  function updateMapCaption() {
    if (galaxy.mode === 'galaxy') {
      const total = galaxy.data ? galaxy.data.systems.length : 0;
      const holes = galaxy.data ? galaxy.data.systems.filter((s) => s.anomaly === 'BLACK_HOLE').length : 0;
      el.mapCaption.innerHTML = `систем в галактике: <b>${total}</b> · черных дыр: <b>${holes}</b>`;
      return;
    }

    if (!map.data) {
      el.mapCaption.textContent = '';
      return;
    }
    const blackHole = map.data.anomaly === 'BLACK_HOLE';
    el.mapCaption.innerHTML =
      `система <b>${map.data.systemName}</b> · координаты ${map.data.galaxyX}:${map.data.galaxyY}` +
      (map.data.isHome ? ' · родная' : ' · чужая система') +
      (blackHole ? ' · <span class="anomaly">черная дыра: искажение времени</span>' : '');
  }

  el.mapModes.addEventListener('click', (event) => {
    const button = event.target.closest('.mode');
    if (button) setMapMode(button.dataset.mode);
  });


  /* ---------- Экспедиции ---------- */

  const EXPEDITION_TONE = {
    SILENCE: 'neutral', EVADED: 'neutral', RESOURCES: 'win', PIRATES_WON: 'win', PIRATES_LOST: 'loss',
  };
  const EXPEDITION_TITLE = {
    SILENCE: 'Мертвая тишина',
    EVADED: 'Засада обойдена',
    RESOURCES: 'Заброшенный груз',
    PIRATES_WON: 'Пираты отбиты',
    PIRATES_LOST: 'Флот потерян',
  };

  function renderExpeditions() {
    const data = war.data;
    if (!data) return;

    const slots = data.expeditionSlots || { total: 0, used: 0 };
    el.expeditionSlots.innerHTML = slots.total > 0
      ? `<div class="hub-storage">Экспедиционных слотов: <b>${slots.used}</b> из <b>${slots.total}</b><br>` +
        'Лимит задает уровень «Астрофизики»: 1 → 1, 4 → 2, 9 → 3.<br>' +
        'Точка выхода — глубокий космос (16-я позиция) любой системы на карте.</div>'
      : '<div class="hub-storage">Экспедиции недоступны: изучи технологию <b>«Астрофизика»</b>.</div>';

    el.expeditions.innerHTML = '';
    const reports = data.expeditions || [];

    if (!reports.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Отчетов об экспедициях еще нет';
      el.expeditions.appendChild(empty);
      return;
    }

    for (const report of reports) {
      const tone = EXPEDITION_TONE[report.outcome] || 'neutral';
      const card = document.createElement('article');
      card.className = `battle ${tone === 'win' ? 'win' : tone === 'loss' ? 'loss' : ''}`;

      const header = document.createElement('header');
      const title = document.createElement('h4');
      title.textContent = `${EXPEDITION_TITLE[report.outcome] || report.outcome} · ${report.systemName}`;
      const when = document.createElement('span');
      when.className = 'verdict';
      when.textContent = new Date(report.createdAt).toLocaleString('ru-RU');
      header.append(title, when);

      const summary = document.createElement('div');
      summary.className = 'line';
      summary.textContent = report.summary;

      card.append(header, summary);

      const loot = report.loot.metal + report.loot.crystal + report.loot.antimatter;
      if (loot > 0) {
        const line = document.createElement('div');
        line.className = 'line';
        const parts = [];
        if (report.loot.metal) parts.push(`${fmt(report.loot.metal)} металла`);
        if (report.loot.crystal) parts.push(`${fmt(report.loot.crystal)} кристаллов`);
        if (report.loot.antimatter) parts.push(`${fmtAmount(report.loot.antimatter)} антиматерии`);
        line.innerHTML = `добыча: <b>${parts.join(', ')}</b>`;
        card.appendChild(line);
      }

      if (report.losses.length) {
        const line = document.createElement('div');
        line.className = 'line';
        line.innerHTML =
          'потери: <b>' + report.losses.map((l) => `${l.label} −${l.lost} из ${l.before}`).join(', ') + '</b>';
        card.appendChild(line);
      }

      el.expeditions.appendChild(card);
    }
  }


  /* ---------- Синдикаты ---------- */

  const syndicate = { data: null };
  const ROLE_LABELS = { LEADER: 'лидер', OFFICER: 'офицер', MEMBER: 'участник' };
  const TX_LABELS = { DONATION: 'пожертвование', FOUNDING: 'основание', PAYOUT: 'выплата' };

  async function loadSyndicate() {
    const result = await api('/api/syndicates');
    if (!result.ok) return;
    syndicate.data = result.data;
    renderSyndicate();
  }

  /** Отправка действия синдиката с последующим обновлением панели. */
  async function syndicateAction(path, body) {
    const result = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
    showBuildMessage(result.data.message || result.data.error || 'Готово', result.ok);
    await loadSyndicate();
    await loadWar();
    return result.ok;
  }

  function renderSyndicate() {
    const data = syndicate.data;
    if (!data) return;
    el.syndicatePanel.innerHTML = '';
    if (data.mine) renderMySyndicate(data);
    else renderSyndicateList(data);
  }

  /* --- без синдиката: список и создание --- */
  function renderSyndicateList(data) {
    const grid = document.createElement('div');
    grid.className = 'syndicate-grid';

    const create = document.createElement('div');
    create.className = 'hub-card';
    create.innerHTML =
      '<h3 class="section-title">Создать синдикат</h3>' +
      `<div class="hub-storage">Основание стоит <b>${fmt(data.foundingCost)} ₴</b> ` +
      `(на счету ${fmt(data.credits)} ₴). Основатель становится лидером.</div>`;

    const nameField = document.createElement('label');
    nameField.className = 'field';
    nameField.innerHTML = '<span>Название</span>';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 32;
    nameField.appendChild(nameInput);

    const tagField = document.createElement('label');
    tagField.className = 'field';
    tagField.innerHTML = '<span>Тег (2-5 символов)</span>';
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.maxLength = 5;
    tagField.appendChild(tagInput);

    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'primary';
    createButton.textContent = 'Основать синдикат';
    createButton.disabled = data.credits < data.foundingCost;
    createButton.addEventListener('click', () =>
      syndicateAction('/api/syndicates', { name: nameInput.value, tag: tagInput.value }));

    create.append(nameField, tagField, createButton);

    const list = document.createElement('div');
    list.className = 'hub-card';
    list.innerHTML = '<h3 class="section-title">Действующие синдикаты</h3>';

    if (!data.list.length) {
      const empty = document.createElement('div');
      empty.className = 'hub-storage';
      empty.textContent = 'Синдикатов пока нет — станешь первым.';
      list.appendChild(empty);
    }

    for (const item of data.list) {
      const row = document.createElement('div');
      row.className = 'queue-item member-row';

      const info = document.createElement('div');
      info.innerHTML =
        `<b>[${item.tag}] ${item.name}</b>` +
        `<div class="role">лидер: ${item.leader} · участников: ${item.members}</div>`;

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'ghost';
      if (item.applicationStatus === 'PENDING') {
        action.textContent = 'Заявка отправлена';
        action.disabled = true;
      } else {
        action.textContent = 'Подать заявку';
        action.addEventListener('click', () => syndicateAction(`/api/syndicates/${item.id}/apply`));
      }

      row.append(info, action);
      list.appendChild(row);
    }

    grid.append(create, list);
    el.syndicatePanel.appendChild(grid);
  }

  /* --- свой синдикат --- */
  function renderMySyndicate(data) {
    const mine = data.mine;
    const canReview = mine.role === 'LEADER' || mine.role === 'OFFICER';
    const isLeader = mine.role === 'LEADER';

    const header = document.createElement('div');
    header.className = 'syndicate-header';
    header.innerHTML =
      `<div><h3><span class="tag">[${mine.tag}]</span> ${mine.name}</h3>` +
      `<div class="role">твоя роль: <b>${ROLE_LABELS[mine.role]}</b> · участников: ${mine.members.length} · ` +
      `основан ${new Date(mine.createdAt).toLocaleDateString('ru-RU')}</div></div>` +
      `<div class="bank">банк синдиката<b>${fmt(mine.bank)} ₴</b>личный счет: ${fmt(data.credits)} ₴</div>`;
    el.syndicatePanel.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'syndicate-grid';

    // Пожертвования
    const bank = document.createElement('div');
    bank.className = 'hub-card';
    bank.innerHTML = '<h3 class="section-title">Пожертвование в банк</h3>';
    const donateForm = document.createElement('div');
    donateForm.className = 'donate-form';
    const amount = document.createElement('input');
    amount.type = 'number';
    amount.min = '1';
    amount.value = '100';
    const donateButton = document.createElement('button');
    donateButton.type = 'button';
    donateButton.className = 'primary';
    donateButton.textContent = 'Внести';
    donateButton.addEventListener('click', () =>
      syndicateAction('/api/syndicates/donate', { amount: Number(amount.value) }));
    donateForm.append(amount, donateButton);
    bank.appendChild(donateForm);

    const log = document.createElement('div');
    log.className = 'queue';
    for (const tx of mine.transactions) {
      const row = document.createElement('div');
      row.className = 'queue-item';
      const title = document.createElement('b');
      title.textContent = `${tx.nickname || 'система'} — ${fmt(tx.amount)} ₴`;
      const meta = document.createElement('span');
      meta.textContent = `${TX_LABELS[tx.kind] || tx.kind} · ${new Date(tx.createdAt).toLocaleString('ru-RU')}`;
      row.append(title, meta);
      log.appendChild(row);
    }
    if (!mine.transactions.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Операций пока не было';
      log.appendChild(empty);
    }
    bank.appendChild(log);

    // Состав
    const roster = document.createElement('div');
    roster.className = 'hub-card';
    roster.innerHTML = '<h3 class="section-title">Состав синдиката</h3>';

    for (const member of mine.members) {
      const row = document.createElement('div');
      row.className = 'queue-item member-row';
      const info = document.createElement('div');
      info.innerHTML =
        `<b>${member.nickname}</b><div class="role ${member.role}">${ROLE_LABELS[member.role]} · ` +
        `боев ${member.battlesWon}/${member.battlesLost}</div>`;

      const actions = document.createElement('div');
      actions.className = 'member-actions';
      // Лидер правит всем составом, офицер может исключить рядового.
      if (!isLeader && mine.role === 'OFFICER' && member.role === 'MEMBER') {
        const kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'ghost';
        kick.textContent = 'Исключить';
        kick.addEventListener('click', () =>
          syndicateAction(`/api/syndicates/members/${member.commanderId}/kick`));
        actions.appendChild(kick);
      }

      if (isLeader && member.role !== 'LEADER') {
        const crown = document.createElement('button');
        crown.type = 'button';
        crown.className = 'ghost';
        crown.textContent = 'Сделать лидером';
        crown.addEventListener('click', () =>
          syndicateAction(`/api/syndicates/members/${member.commanderId}/role`, { role: 'LEADER' }));
        actions.appendChild(crown);

        const promote = document.createElement('button');
        promote.type = 'button';
        promote.className = 'ghost';
        promote.textContent = member.role === 'OFFICER' ? 'Снять офицера' : 'В офицеры';
        promote.addEventListener('click', () =>
          syndicateAction(`/api/syndicates/members/${member.commanderId}/role`, {
            role: member.role === 'OFFICER' ? 'MEMBER' : 'OFFICER',
          }));

        const kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'ghost';
        kick.textContent = 'Исключить';
        kick.addEventListener('click', () =>
          syndicateAction(`/api/syndicates/members/${member.commanderId}/kick`));

        actions.append(promote, kick);
      }

      row.append(info, actions);
      roster.appendChild(row);
    }

    grid.append(bank, roster);
    el.syndicatePanel.appendChild(grid);

    // Заявки видны только тем, кто их разбирает
    if (canReview) {
      const applications = document.createElement('div');
      applications.className = 'hub-card';
      applications.innerHTML = '<h3 class="section-title">Заявки на вступление</h3>';

      if (!mine.applications.length) {
        const empty = document.createElement('div');
        empty.className = 'hub-storage';
        empty.textContent = 'Новых заявок нет';
        applications.appendChild(empty);
      }

      for (const application of mine.applications) {
        const row = document.createElement('div');
        row.className = 'queue-item member-row';
        const info = document.createElement('div');
        info.innerHTML =
          `<b>${application.nickname}</b><div class="role">подана ` +
          `${new Date(application.createdAt).toLocaleString('ru-RU')}</div>`;

        const actions = document.createElement('div');
        actions.className = 'member-actions';
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.className = 'primary';
        accept.textContent = 'Принять';
        accept.addEventListener('click', () =>
          syndicateAction(`/api/syndicates/applications/${application.id}/approve`));
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'ghost';
        reject.textContent = 'Отклонить';
        reject.addEventListener('click', () =>
          syndicateAction(`/api/syndicates/applications/${application.id}/reject`));

        actions.append(accept, reject);
        row.append(info, actions);
        applications.appendChild(row);
      }
      el.syndicatePanel.appendChild(applications);
    }

    // Выход и роспуск
    const footer = document.createElement('div');
    footer.className = 'hub-card';
    const exit = document.createElement('button');
    exit.type = 'button';
    exit.className = 'ghost';
    if (isLeader) {
      exit.textContent = 'Распустить синдикат';
      exit.addEventListener('click', () => syndicateAction('/api/syndicates/disband'));
      footer.innerHTML = '<div class="hub-storage">Роспуск вернет остаток банка лидеру.</div>';
    } else {
      exit.textContent = 'Покинуть синдикат';
      exit.addEventListener('click', () => syndicateAction('/api/syndicates/leave'));
    }
    footer.appendChild(exit);
    el.syndicatePanel.appendChild(footer);
  }

  /* ---------- Старт ---------- */
  el.logout.addEventListener('click', () => logout());

  if (state.token) {
    startSession().catch(() => showScreen('auth'));
  } else {
    showScreen('auth');
  }
})();

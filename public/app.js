/* Командный центр — клиент Этапа 1. Все расчеты на сервере, клиент только рисует состояние. */
(() => {
  'use strict';

  const TOKEN_KEY = 'spacemmo.token';

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    username: '',
    bases: [],
    activeBaseId: null,
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
    buildings: $('buildings'),
    buildMessage: $('build-message'),
    resMetal: $('res-metal'),
    resCrystal: $('res-crystal'),
    resDeuterium: $('res-deuterium'),
    resEnergy: $('res-energy'),
    rateMetal: $('rate-metal'),
    rateCrystal: $('rate-crystal'),
    rateDeuterium: $('rate-deuterium'),
    rateEnergy: $('rate-energy'),
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

  const fmt = (value) => Math.floor(value).toLocaleString('ru-RU');
  const fmtRate = (value) => `+${value.toFixed(2)}/с`;

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
    applyState(data.bases);
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
    socket.on('state:update', (payload) => applyState(payload.bases));
  }

  function setConnection(online) {
    el.connStatus.textContent = online ? 'онлайн' : 'офлайн';
    el.connStatus.className = `status ${online ? 'online' : 'offline'}`;
  }

  /* ---------- Рендер ---------- */

  function applyState(bases) {
    state.bases = bases;
    if (!bases.length) return;
    if (!bases.some((base) => base.baseId === state.activeBaseId)) {
      state.activeBaseId = bases[0].baseId;
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

    el.baseName.textContent = base.baseName;
    el.planetMeta.textContent =
      `${base.planetName} · ${PLANET_TYPES[base.planetType] || base.planetType} · ` +
      `система ${base.systemName} · орбита ${base.position} · слотов ${base.size}`;

    el.richness.innerHTML = `
      <div>Металл<b>×${base.richness.metal}</b></div>
      <div>Кристаллы<b>×${base.richness.crystal}</b></div>
      <div>Дейтерий<b>×${base.richness.deuterium}</b></div>
      <div>Инсоляция<b>×${base.richness.energy}</b></div>`;

    renderBuildings(base);
  }

  /**
   * Карточки построек создаются один раз на базу и дальше обновляются точечно:
   * полная перерисовка каждую секунду ломала бы клики по кнопкам.
   */
  const cards = new Map();
  let cardsBaseId = null;

  function renderBuildings(base) {
    if (cardsBaseId !== base.baseId) {
      cardsBaseId = base.baseId;
      cards.clear();
      el.buildings.innerHTML = '';
      for (const building of base.buildings) {
        cards.set(building.type, createCard(base.baseId, building));
      }
    }

    for (const building of base.buildings) {
      const card = cards.get(building.type);
      if (!card) continue;
      updateCard(card, base, building);
    }
  }

  function createCard(baseId, building) {
    const article = document.createElement('article');
    article.className = 'building';

    const header = document.createElement('header');
    const title = document.createElement('h4');
    title.textContent = building.label;
    const level = document.createElement('span');
    level.className = 'level';
    header.append(title, level);

    const cost = document.createElement('div');
    cost.className = 'cost';
    const costMetal = document.createElement('span');
    const costCrystal = document.createElement('span');
    cost.append(costMetal, costCrystal);

    const energyNote = document.createElement('div');
    energyNote.className = 'energy-note';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    button.addEventListener('click', () => build(baseId, building.type));

    article.append(header, cost, energyNote, button);
    el.buildings.appendChild(article);

    return { level, costMetal, costCrystal, energyNote, button };
  }

  function updateCard(card, base, building) {
    card.level.textContent = `Ур. ${building.level}`;

    card.costMetal.textContent = `◼ ${fmt(building.cost.metal)}`;
    card.costMetal.className = base.resources.metal < building.cost.metal ? 'lack' : '';
    card.costCrystal.textContent = `◆ ${fmt(building.cost.crystal)}`;
    card.costCrystal.className = base.resources.crystal < building.cost.crystal ? 'lack' : '';

    card.energyNote.textContent = building.hasEnergy
      ? `Энергобаланс: ${building.energyDelta >= 0 ? '+' : ''}${building.energyDelta.toFixed(1)}`
      : 'Не хватает энергии';
    card.energyNote.className = `energy-note ${building.hasEnergy ? '' : 'bad'}`;

    card.button.disabled = !building.canAfford || !building.hasEnergy;
    card.button.textContent = building.level === 0
      ? `Построить (ур. ${building.nextLevel})`
      : `Улучшить до ур. ${building.nextLevel}`;
  }

  async function build(baseId, type) {
    try {
      const response = await fetch(`/api/bases/${baseId}/build`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ type }),
      });
      const data = await response.json();

      if (!response.ok) {
        showBuildMessage(data.error || 'Постройка отклонена', false);
        return;
      }
      showBuildMessage(`Готово: уровень ${data.level}`, true);
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

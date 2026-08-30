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
    storage: $('storage'),
    storageText: $('storage-text'),
    storageFill: $('storage-fill'),
    storageNote: $('storage-note'),
    tabs: $('tabs'),
    buildJob: $('build-job'),
    buildings: $('buildings'),
    researchJob: $('research-job'),
    technologies: $('technologies'),
    fleet: $('fleet'),
    shipQueue: $('ship-queue'),
    ships: $('ships'),
    buildMessage: $('build-message'),
    resOre: $('res-ore'),
    resPolymers: $('res-polymers'),
    resPlasma: $('res-plasma'),
    resEnergy: $('res-energy'),
    resEfficiency: $('res-efficiency'),
    rateOre: $('rate-ore'),
    ratePolymers: $('rate-polymers'),
    ratePlasma: $('rate-plasma'),
    rateEnergy: $('rate-energy'),
    rateEfficiency: $('rate-efficiency'),
    systemMap: $('system-map'),
    mapCanvas: document.querySelector('.map-canvas'),
    mapTooltip: $('map-tooltip'),
    planetInfo: $('planet-info'),
    dispatch: $('dispatch'),
    mission: $('mission'),
    fleetInputs: $('fleet-inputs'),
    fleetAll: $('fleet-all'),
    fleetNone: $('fleet-none'),
    dispatchTarget: $('dispatch-target'),
    coordInput: $('coord-input'),
    coordGo: $('coord-go'),
    coordNote: $('coord-note'),
    cargoOre: $('cargo-ore'),
    cargoPolymers: $('cargo-polymers'),
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
    cargoOreLabel: $('cargo-ore-label'),
    cargoPolymersLabel: $('cargo-polymers-label'),
    cargoPlasma: $('cargo-plasma'),
    cargoPlasmaField: $('cargo-plasma-field'),
    cargoInputs: $('cargo-inputs'),
    adminTab: $('admin-tab'),
    adminSearch: $('admin-search'),
    adminRows: $('admin-rows'),
    adminDetail: $('admin-detail'),
    mailButton: $('mail-button'),
    mailBadge: $('mail-badge'),
    mailFilters: $('mail-filters'),
    mailList: $('mail-list'),
    mailSummary: $('mail-summary'),
    mailReadAll: $('mail-read-all'),
    mailTo: $('mail-to'),
    mailSubject: $('mail-subject'),
    mailBody: $('mail-body'),
    mailSend: $('mail-send'),
    mailBroadcast: $('mail-broadcast'),
    broadcastSubject: $('broadcast-subject'),
    broadcastBody: $('broadcast-body'),
    broadcastSend: $('broadcast-send'),
    presetSelect: $('preset-select'),
    presetManage: $('preset-manage'),
    presetList: $('preset-list'),
    presetName: $('preset-name'),
    presetInputs: $('preset-inputs'),
    presetSave: $('preset-save'),
    presetBack: $('preset-back'),
    presetCancel: $('preset-cancel'),
    simAttacker: $('sim-attacker'),
    simDefender: $('sim-defender'),
    simDefenses: $('sim-defenses'),
    simEspionage: $('sim-espionage'),
    simEspionageNote: $('sim-espionage-note'),
    simStockOre: $('sim-stock-ore'),
    simStockPolymers: $('sim-stock-polymers'),
    simStockPlasma: $('sim-stock-plasma'),
    simStockStorage: $('sim-stock-storage'),
    simRun: $('sim-run'),
    simReset: $('sim-reset'),
    simResult: $('sim-result'),
    simFillMine: $('sim-fill-mine'),
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
    RECYCLER: 'Переработчики',
  };

  /**
   * Иконка ресурса из инлайнового спрайта.
   *
   * Иконки несут смысл вместе с числом, поэтому у них есть текстовая подпись
   * в title: цифра без названия читается быстрее, но остается доступной.
   */
  const RESOURCE_NAMES = {
    ore: 'Руда',
    polymers: 'Полимеры',
    plasma: 'Плазма',
    antimatter: 'Антиматерия',
    energy: 'Энергия',
    credits: 'Криптогривна',
    efficiency: 'Эффективность шахт',
  };

  function icon(name, extraClass = '') {
    const label = RESOURCE_NAMES[name] || name;
    return (
      `<svg class="ico ${name}${extraClass ? ' ' + extraClass : ''}" role="img" aria-label="${label}">` +
      `<title>${label}</title><use href="#ico-${name}"/></svg>`
    );
  }

  /**
   * Крупная иллюстрация объекта: постройка, оборона или корабль.
   *
   * Путь собирается из типа в нижнем регистре, отдельной таблицы соответствий
   * нет — достаточно положить файл с правильным именем в нужную папку.
   * Пока картинки нет, карточка показывает заглушку: `onerror` помечает блок
   * классом, и верстка от отсутствия файла не разъезжается.
   */
  const ART_FOLDERS = { building: 'buildings', ship: 'ships', defense: 'defense', tech: 'tech' };

  function artNode(type, label, kind, extraClass = '') {
    const slug = type.toLowerCase();
    const wrap = document.createElement('div');
    wrap.className = `art ${slug}${extraClass ? ' ' + extraClass : ''}`;

    const image = document.createElement('img');
    image.alt = label;
    // Без lazy: карточки создаются в скрытой панели, и отложенная загрузка
    // не стартует до ее показа — заглушка тогда не появляется вовсе.
    // Картинок десятки и они мелкие, экономить тут нечего.
    image.addEventListener('error', () => {
      wrap.classList.add('art-missing');
      wrap.dataset.placeholder = label.slice(0, 2).toUpperCase();
      image.remove();
    });

    wrap.appendChild(image);
    // src ставим после подписки и вставки: так событие ошибки точно не потеряется.
    image.src = `/assets/${ART_FOLDERS[kind] || 'buildings'}/${slug}.webp`;
    return wrap;
  }

  /** Иконка как DOM-узел — там, где строка собирается не через innerHTML. */
  function iconNode(name, extraClass = '') {
    const wrap = document.createElement('span');
    wrap.innerHTML = icon(name, extraClass);
    return wrap.firstChild;
  }

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

  const auth = { mode: 'login', avatars: [], avatarId: 'nova', profile: null, account: null };

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
    await loadPresets();
    await loadMail();
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
    // Роль живет на учетной записи, а не на командире: командиров у аккаунта
    // может не быть вовсе, а права доступа к серверу есть всегда.
    auth.account = session.data.user || null;
    syncAdminTab();
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
    auth.account = null;
    syncAdminTab();
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
    auth.account = session.data.user || auth.account;
    syncAdminTab();
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

    // Бейдж приходит пушем в момент доставки: опрашивать ящик ради счетчика
    // незачем, а письмо может прийти в любой момент — хоть от боя, хоть от игрока.
    socket.on('mail:unread', (payload) => {
      setUnread(payload.unread);
      if (state.activeTab === 'mail') void loadMail();
    });
  }

  function setConnection(online) {
    el.connStatus.textContent = online ? 'онлайн' : 'офлайн';
    el.connStatus.className = `status ${online ? 'online' : 'offline'}`;
  }

  /* ---------- Вкладки ---------- */

  el.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('.tab');
    if (button) showPanel(button.dataset.tab);
  });

  /**
   * Переключение панели. Вынесено из обработчика вкладок, потому что панель
   * шаблонов открывается кнопкой из формы отправки, а вкладки для нее нет.
   */
  function showPanel(name) {
    state.activeTab = name;

    for (const tab of el.tabs.querySelectorAll('.tab')) {
      tab.classList.toggle('active', tab.dataset.tab === name);
    }
    for (const panel of document.querySelectorAll('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== name;
    }

    if (name === 'map') {
      void loadMap();
      void loadGalaxy();
    }
    if (name === 'market') void loadMarket();
    if (name === 'syndicate') void loadSyndicate();
    if (name === 'war') {
      void loadWar();
      void refreshProfile();
    }
    if (name === 'simulator') {
      initSimulator();
      void loadEspionageTargets();
    }
    if (name === 'presets') void loadPresets();
    if (name === 'admin') void loadAdminList();
    if (name === 'mail') {
      void loadMail();
      if (!syndicate.data) void loadSyndicate();
      else syncBroadcastForm();
    }
  }

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

    el.resOre.textContent = fmt(base.resources.ore);
    el.resPolymers.textContent = fmt(base.resources.polymers);
    el.resPlasma.textContent = fmt(base.resources.plasma);
    el.resEnergy.textContent = fmt(base.energy.available);

    // На полном складе шахты стоят: показывать их проектную скорость —
    // значит спорить с надписью «добыча остановлена» прямо над ней.
    const mining = base.storage && base.storage.full ? 0 : null;
    for (const [node, rate] of [
      [el.rateOre, base.productionPerSecond.ore],
      [el.ratePolymers, base.productionPerSecond.polymers],
      [el.ratePlasma, base.productionPerSecond.plasma],
    ]) {
      node.textContent = mining === null ? fmtRate(rate) : 'склад полон';
      node.style.color = mining === null ? '' : 'var(--err)';
    }
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
      <div title="Руда">${icon('ore')}<b>×${base.richness.ore}</b></div>
      <div title="Полимеры">${icon('polymers')}<b>×${base.richness.polymers}</b></div>
      <div title="Плазма">${icon('plasma')}<b>×${base.richness.plasma}</b></div>
      <div title="Инсоляция">${icon('energy')}<b>×${base.richness.energy}</b></div>
      <div title="Антиматерия">${icon('antimatter')}<b>×${base.richness.antimatter}</b></div>`;

    renderStorage(base.storage);

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

  /**
   * Заполненность склада. Полный склад — не косметика: добыча встает,
   * поэтому предупреждение выводим тем же местом, где показан сам лимит.
   */
  function renderStorage(storage) {
    if (!storage) return;

    const fill = Math.max(0, Math.min(1, storage.fill));
    el.storageFill.style.width = `${(fill * 100).toFixed(1)}%`;
    el.storageText.textContent = `Занято: ${fmt(storage.used)} / ${fmt(storage.capacity)}`;

    const overflow = storage.used > storage.capacity;
    el.storage.classList.toggle('full', storage.full);
    el.storage.classList.toggle('near', !storage.full && storage.fill >= 0.85);

    // Уязвимый излишек появляется только за порогом 90% вместимости,
    // поэтому на полупустом складе про грабеж молчим — там терять нечего.
    const risk = storage.vulnerable > 0 ? ` Под грабеж попадает ${fmt(storage.vulnerable)}.` : '';

    if (storage.full) {
      el.storageNote.textContent =
        'Склады переполнены. Добыча остановлена.' +
        (overflow ? ` Сверх лимита лежит ${fmt(storage.used - storage.capacity)}.` : '') +
        risk;
    } else {
      el.storageNote.textContent = `Свободно ${fmt(storage.free)}.` + risk;
    }
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
          send(`/api/bases/${base.baseId}/build`, { type: building.type }), building.type, 'building'));
      }
      for (const tech of base.technologies) {
        cards.technologies.set(tech.tech, createActionCard(el.technologies, tech.label, tech.description, () =>
          send(`/api/bases/${base.baseId}/research`, { tech: tech.tech }), tech.tech, 'tech'));
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

  function createCardShell(container, title, description, type, kind) {
    const article = document.createElement('article');
    article.className = 'card';

    // Обложка: иллюстрация и заголовок в одной полосе. Уровень уезжает вправо,
    // остальное содержимое карточки идет ниже на всю ширину — так сетка
    // не зависит от размера иллюстрации и не ломается на узких экранах.
    const header = document.createElement('header');
    header.className = 'card-cover';
    if (type) header.appendChild(artNode(type, title, kind));

    const titles = document.createElement('div');
    titles.className = 'card-titles';
    const heading = document.createElement('h4');
    heading.textContent = title;
    const level = document.createElement('span');
    level.className = 'level';
    titles.append(heading, level);
    header.appendChild(titles);

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = description;
    desc.hidden = !description;

    const cost = document.createElement('div');
    cost.className = 'cost';
    const costOre = document.createElement('span');
    const costPolymers = document.createElement('span');
    const costPlasma = document.createElement('span');
    cost.append(costOre, costPolymers, costPlasma);

    const combat = document.createElement('div');
    combat.className = 'combat-line';

    const time = document.createElement('div');
    time.className = 'time';

    const reqs = document.createElement('div');
    reqs.className = 'reqs';

    article.append(header, desc, combat, cost, time, reqs);
    container.appendChild(article);

    return { article, level, costOre, costPolymers, costPlasma, combat, time, reqs };
  }

  function createActionCard(container, title, description, onClick, type, kind) {
    const shell = createCardShell(container, title, description, type, kind);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    button.addEventListener('click', onClick);
    shell.article.appendChild(button);
    return { ...shell, button };
  }

  function createShipCard(container, ship, baseId) {
    const shell = createCardShell(container, ship.label, ship.description, ship.type, 'ship');

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
    const shell = createCardShell(container, item.label, item.description, item.type, 'defense');

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
    setCostPart(card.costOre, 'ore', cost.ore, resources.ore);
    setCostPart(card.costPolymers, 'polymers', cost.polymers, resources.polymers);
    setCostPart(card.costPlasma, 'plasma', cost.plasma, resources.plasma);
  }

  function setCostPart(node, resource, amount, stock) {
    node.hidden = amount <= 0;
    node.innerHTML = `${icon(resource, 'sm')} ${fmt(amount)}`;
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
    // Тем же местом, что и боевой профиль у кораблей: короткая строка эффекта.
    card.combat.textContent = building.effect || '';
    fillCost(card, building.cost, base.resources);
    card.time.textContent = `Время постройки: ${fmtTime(building.seconds)}`;
    fillRequirements(card, building.requirements);

    const locked = building.requirements.length > 0;
    card.article.classList.toggle('locked', locked);
    card.article.classList.toggle('built', building.level > 0);
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
    const parts = [
      combat.attack > 0 ? `атака ${combat.attack}` : 'без оружия',
      combat.shield > 0 ? `щит ${combat.shield}` : null,
      `корпус ${combat.hull}`,
      combat.note,
    ].filter(Boolean);
    return parts.join(' · ');
  }

  function updateShipCard(card, base, ship, ownedLabel = 'В ангаре') {
    if (!card) return;
    card.level.textContent = `${ownedLabel}: ${ship.owned}`;
    card.article.classList.toggle('built', ship.owned > 0);
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

  async function send(url, body, method = 'POST') {
    try {
      const response = await fetch(url, {
        method,
        headers: authHeaders(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
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

  /**
   * Имя файла биома. Маппинг, а не прямое приведение типа к нижнему регистру:
   * арт назван по биому («terran», «lava»), а перечисление — по свойству
   * («OCEANIC», «VOLCANIC»). Совпадать они не обязаны, и подгонять одно под
   * другое переименованием файлов означало бы ломать присланные ассеты.
   */
  const PLANET_ART = {
    ROCKY: 'rocky',
    OCEANIC: 'terran',
    DESERT: 'desert',
    ICE: 'ice',
    GAS_GIANT: 'gas_giant',
    VOLCANIC: 'lava',
    TOXIC: 'toxic',
  };

  const PLANET_COLORS = {
    ROCKY: '#b08968', OCEANIC: '#4a90d9', DESERT: '#d9a441', ICE: '#8fd0e8',
    GAS_GIANT: '#c08bd9', VOLCANIC: '#d9614a', TOXIC: '#8fbf5a',
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  /**
   * Геометрия круговой карты.
   *
   * Холст квадратный, звезда в центре, планеты — на концентрических орбитах.
   * Радиус орбиты считается не жестким шагом, а делением доступного места между
   * орбитами: система с пятью планетами и система с тремя одинаково вписываются
   * в круг, и внешняя орбита никогда не уезжает за край.
   */
  const MAP = {
    size: 860,
    center: 430,
    starRadius: 58,
    /** Первая орбита отодвинута за корону звезды и кольцо хаба. */
    firstOrbit: 168,
    /** До внешней орбиты: остаток радиуса уходит под тело планеты и две подписи. */
    lastOrbit: 300,
    /** Хаб висит на своем кольце между короной звезды и первой орбитой. */
    hubOrbit: 118,
    deepOrbit: 334,
  };

  const map = {
    data: null,
    selectedId: null,
    selectedKind: 'PLANET',
    hoverId: null,
    plan: null,
    planTimer: null,
    /** Цель, найденная по координатам: может лежать вне текущей системы. */
    coordTarget: null,
  };

  const MISSION_OPTIONS = {
    PLANET: [['TRANSPORT', 'Транспортировка'], ['SCAN', 'Разведка зондом'], ['ATTACK', 'Атака']],
    /* Своя колония: атаковать себя нельзя, зато можно перебросить туда флот. */
    OWN_PLANET: [['TRANSPORT', 'Транспортировка'], ['DEPLOY', 'Дислокация']],
    HUB: [['HUB_DELIVERY', 'Доставка на хаб'], ['HUB_PICKUP', 'Вывоз с хаба']],
    DEEP_SPACE: [['EXPEDITION', 'Экспедиция']],
  };

  /** Самая дальняя занятая орбита — по ней раскладываются остальные. */
  function maxPosition() {
    const positions = (map.data?.planets ?? []).map((planet) => planet.position);
    return positions.length ? Math.max(...positions) : 1;
  }

  function orbitRadius(position) {
    const last = maxPosition();
    if (last <= 1) return MAP.firstOrbit;
    const step = (MAP.lastOrbit - MAP.firstOrbit) / (last - 1);
    return MAP.firstOrbit + (position - 1) * step;
  }

  /**
   * Угол планеты на орбите. Считается от позиции, а не от индекса в списке:
   * планета всегда оказывается в одном и том же месте карты, и точки не
   * перескакивают между перерисовками.
   */
  function orbitAngle(position) {
    const last = maxPosition();
    return (-90 + ((position - 1) * 360) / Math.max(1, last)) * (Math.PI / 180);
  }

  function polar(radius, angle) {
    return {
      x: MAP.center + Math.cos(angle) * radius,
      y: MAP.center + Math.sin(angle) * radius,
    };
  }

  function planetPoint(position) {
    return polar(orbitRadius(position), orbitAngle(position));
  }

  /**
   * Хаб и глубокий космос стоят в фиксированных секторах: их положение не зависит
   * от состава системы, поэтому игрок всегда знает, где их искать.
   */
  /** Насколько свечение выходит за логический радиус тела. */
  const STAR_SPREAD = 1.9;
  const DEEP_SPACE_RADIUS = 24;
  const DEEP_SPACE_SPREAD = 2.4;

  const HUB_ANGLE = (-145 * Math.PI) / 180;
  const DEEP_SPACE_ANGLE = (52 * Math.PI) / 180;

  function hubPoint() {
    return polar(MAP.hubOrbit, HUB_ANGLE);
  }

  function deepSpacePoint() {
    return polar(MAP.deepOrbit, DEEP_SPACE_ANGLE);
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

  /**
   * Тело на карте: цветной круг-заглушка плюс картинка поверх.
   *
   * Рендер раздвоен, потому что арт двух разных сортов.
   *
   * `solid` — планета: непрозрачный шар на черном квадрате. Ему нужна круглая
   * обрезка, которая просто срезает углы фона, и никакого смешивания: под
   * `screen` планета стала бы полупрозрачной и потеряла объем.
   *
   * `glow` — звезда и туманность: мягкое свечение, у которого нет края. Жесткий
   * круг рубил бы корону и рваные края туманности, поэтому обрезки нет вовсе,
   * а черный фон убирается смешиванием `screen`: черное в нем дает ноль вклада
   * и растворяется, светлое остается. Картинку такому телу даем крупнее его
   * логического радиуса — свечению нужно место, чтобы разойтись.
   *
   * Сломанную ссылку обязательно снимаем: Chrome рисует на месте не
   * загрузившегося <image> собственную иконку «битой картинки», и она
   * перекрывает круг — рассчитывать, что фон просто останется виден, нельзя.
   */
  function celestialBody(group, cx, cy, radius, options) {
    const { fill, opacity = 1, src, clipId, kind = 'solid', spread = 1 } = options;

    group.appendChild(svgEl('circle', {
      class: `body${kind === 'glow' ? ' glow-body' : ''}`, cx, cy, r: radius, fill, opacity,
    }));
    if (!src) return;

    const glow = kind === 'glow';
    const half = radius * (glow ? spread : 1);

    const image = svgEl('image', {
      class: glow ? 'body-art glow' : 'body-art',
      x: cx - half,
      y: cy - half,
      width: half * 2,
      height: half * 2,
      preserveAspectRatio: 'xMidYMid slice',
    });

    if (glow) {
      image.setAttribute('mask', 'url(#glowFade)');
    } else {
      const clip = svgEl('clipPath', { id: clipId });
      clip.appendChild(svgEl('circle', { cx, cy, r: radius }));
      group.appendChild(clip);
      image.setAttribute('clip-path', `url(#${clipId})`);
    }

    image.addEventListener('error', () => image.remove());
    group.appendChild(image);
    // href ставим после подписки, чтобы не потерять событие ошибки.
    image.setAttribute('href', src);
  }

  function renderMap() {
    if (!map.data) return;
    const svg = el.systemMap;
    svg.innerHTML = '';

    const defs = svgEl('defs');
    defs.innerHTML =
      '<radialGradient id="starGlow"><stop offset="0%" stop-color="#fff3c4"/>' +
      '<stop offset="55%" stop-color="#ffb347"/><stop offset="100%" stop-color="rgba(255,140,60,0)"/></radialGradient>' +
      '<radialGradient id="holeGlow"><stop offset="0%" stop-color="#05070f"/>' +
      '<stop offset="70%" stop-color="#2b1840"/><stop offset="100%" stop-color="rgba(157,123,255,0)"/></radialGradient>' +
      // Мягкий круглый спад по краю светящегося тела. Режим screen убирает черный
      // фон картинки, но яркое содержимое, доходящее до края кадра, все равно
      // обрывалось бы прямой линией — маска растворяет его вместо обрезки.
      '<radialGradient id="glowFadeGrad">' +
      '<stop offset="52%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/>' +
      '</radialGradient>' +
      '<mask id="glowFade" maskContentUnits="objectBoundingBox">' +
      '<rect width="1" height="1" fill="url(#glowFadeGrad)"/></mask>';
    svg.appendChild(defs);

    // Орбиты рисуем первыми, чтобы тела легли поверх колец.
    for (const planet of map.data.planets) {
      svg.appendChild(svgEl('circle', {
        class: 'orbit', cx: MAP.center, cy: MAP.center, r: orbitRadius(planet.position),
      }));
    }

    renderStar();

    for (const planet of map.data.planets) {
      const { x, y } = planetPoint(planet.position);

      const group = svgEl('g', {
        class: `planet-dot${planet.planetId === map.selectedId ? ' selected' : ''}`,
      });

      const radius = planet.visibility === 'UNKNOWN' ? 22 : 28;

      // Пунктирное кольцо обломков — под телом планеты, чтобы не перекрывать его.
      if (planet.debris && planet.debris.ore + planet.debris.polymers > 0) {
        group.appendChild(svgEl('circle', {
          class: 'debris-ring', cx: x, cy: y, r: radius + 12,
        }));
      }

      celestialBody(group, x, y, radius, {
        kind: 'solid',
        fill: planet.visibility === 'UNKNOWN' ? '#3a4360' : (PLANET_COLORS[planet.type] || '#7f8db5'),
        opacity: planet.visibility === 'UNKNOWN' ? 0.55 : 1,
        // Картинка привязана к биому планеты, а не к номеру орбиты: ледяной мир
        // должен выглядеть ледяным в любой системе.
        src: `/assets/planets/${PLANET_ART[planet.type] || planet.type.toLowerCase()}.webp`,
        clipId: `clip-planet-${planet.planetId}`,
      });

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

      // Подписи уходят наружу вдоль радиуса: на круговой карте «вниз» у внутренних
      // орбит упирается прямо в звезду, и текст ложился бы на нее.
      const caption = polar(orbitRadius(planet.position) + radius + 18, orbitAngle(planet.position));

      const label = svgEl('text', {
        x: caption.x, y: caption.y, class: `planet-label${planet.isOwn ? ' own' : ''}`,
      });
      label.textContent = planet.name;
      group.appendChild(label);

      const status = svgEl('text', { x: caption.x, y: caption.y + 16, class: 'planet-label' });
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

  /** Центр системы: звезда или черная дыра. */
  function renderStar() {
    const svg = el.systemMap;
    const hole = map.data.anomaly === 'BLACK_HOLE';
    const group = svgEl('g', { class: 'star-node' });

    group.appendChild(svgEl('circle', {
      class: hole ? 'hole-core' : 'star-core',
      cx: MAP.center, cy: MAP.center, r: MAP.starRadius + 22,
    }));
    celestialBody(group, MAP.center, MAP.center, MAP.starRadius, {
      kind: 'glow',
      fill: hole ? '#120b1f' : '#ffb347',
      src: `/assets/planets/${hole ? 'black_hole' : 'star'}.webp`,
      spread: STAR_SPREAD,
    });

    // Свечение крупнее логического радиуса, поэтому подпись отодвигаем за его
    // разлет — иначе название системы тонет в короне.
    const captionY = MAP.center + MAP.starRadius * STAR_SPREAD + 18;

    const label = svgEl('text', { x: MAP.center, y: captionY, class: 'planet-label' });
    label.textContent = `${map.data.systemName} · ${map.data.starClass}`;
    group.appendChild(label);

    if (hole) {
      const anomaly = svgEl('text', {
        x: MAP.center, y: captionY + 16, class: 'planet-label',
      });
      anomaly.textContent = 'черная дыра · искажение времени';
      group.appendChild(anomaly);
    }

    svg.appendChild(group);
  }

  /** Точка выхода в глубокий космос: своя орбита за внешним кольцом системы. */
  function renderDeepSpace() {
    const svg = el.systemMap;
    const { x, y } = deepSpacePoint();

    const group = svgEl('g', {
      class: `planet-dot${map.selectedKind === 'DEEP_SPACE' ? ' selected' : ''}`,
    });
    group.appendChild(svgEl('circle', {
      class: 'body', cx: x, cy: y, r: DEEP_SPACE_RADIUS,
      fill: 'rgba(157, 123, 255, 0.10)', stroke: 'rgba(157, 123, 255, 0.55)',
      'stroke-width': 1.5, 'stroke-dasharray': '4 4',
    }));
    celestialBody(group, x, y, DEEP_SPACE_RADIUS, {
      kind: 'glow',
      fill: 'transparent',
      src: '/assets/planets/deep_space.webp',
      spread: DEEP_SPACE_SPREAD,
    });

    // Подписи наружу по радиусу, как у планет и хаба, но за разлетом туманности.
    const caption = polar(MAP.deepOrbit + DEEP_SPACE_RADIUS * DEEP_SPACE_SPREAD + 16, DEEP_SPACE_ANGLE);

    const label = svgEl('text', { x: caption.x, y: caption.y, class: 'planet-label' });
    label.textContent = 'Глубокий космос';
    group.appendChild(label);

    const position = svgEl('text', { x: caption.x, y: caption.y + 15, class: 'planet-label' });
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
    clearCoordTarget();
    renderMap();
    renderPlanetInfo();
  }

  /** Нейтральная станция у звезды — точка входа на биржу. */
  function renderHub(hub) {
    const svg = el.systemMap;
    const { x, y } = hubPoint();

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

    // Подпись уходит наружу по радиусу: хаб висит близко к звезде, и текст
    // «под ним» лег бы прямо на корону.
    //
    // На карте оставлено только название: содержимое склада — длинная строка,
    // которая в тесном центре наезжала на сам хаб. Цифры и так есть в тултипе
    // и в панели справа, и там их можно показать с иконками, чего SVG-текст
    // не умеет в принципе.
    const caption = polar(MAP.hubOrbit + 36, HUB_ANGLE);

    const label = svgEl('text', { x: caption.x, y: caption.y, class: 'planet-label' });
    label.textContent = hub.name;
    group.appendChild(label);

    group.addEventListener('mouseenter', (event) => showHubTooltip(hub, event));
    group.addEventListener('mousemove', (event) => positionTooltip(event));
    group.addEventListener('mouseleave', hideTooltip);
    group.addEventListener('click', () => selectHub(hub));
    svg.appendChild(group);
  }

  function showHubTooltip(hub, event) {
    el.mapTooltip.innerHTML = hub.storage
      ? `<b>${hub.name}</b><br>нейтральная торговая станция · орбита ${hub.position}<br>` +
        `твой склад: ${icon('ore', 'sm')} ${fmt(hub.storage.ore)} · ${icon('polymers', 'sm')} ${fmt(hub.storage.polymers)}<br>` +
        `занято ${fmt(hub.storage.ore + hub.storage.polymers)} из ${fmt(hub.storage.capacity)}`
      : `<b>${hub.name}</b><br>нейтральная торговая станция`;
    el.mapTooltip.hidden = false;
    positionTooltip(event);
  }

  function selectHub(hub) {
    map.selectedKind = 'HUB';
    map.selectedId = hub.hubId;
    clearCoordTarget();
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

      // Точки на круговой карте, поэтому маршрут — отрезок между ними,
      // а маркер едет по этому отрезку пропорционально пройденному времени.
      const a = from.hub ? hubPoint() : from.deep ? deepSpacePoint() : planetPoint(from.position);
      const b = to.hub ? hubPoint() : to.deep ? deepSpacePoint() : planetPoint(to.position);

      layer.appendChild(svgEl('line', {
        class: 'fleet-line', x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      }));

      const cx = a.x + (b.x - a.x) * progress;
      const cy = a.y + (b.y - a.y) * progress;
      layer.appendChild(svgEl('circle', { class: 'fleet-marker', cx, cy, r: 5 }));

      const label = svgEl('text', { x: cx, y: cy - 12, class: 'planet-label' });
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

    // Обломки светятся на радарах: их видно и по неразведанной планете,
    // поэтому строка идет до проверки на туман войны.
    const debris = debrisHtml(planet);

    if (planet.visibility === 'UNKNOWN') {
      return `${head}${debris}<br><span class="unknown">Данных нет. Отправь зонд для сканирования.</span>`;
    }

    const rich = planet.richness
      ? `<br>богатство: ${icon('ore', 'sm')} ×${planet.richness.ore} · ` +
        `${icon('polymers', 'sm')} ×${planet.richness.polymers} · ${icon('plasma', 'sm')} ×${planet.richness.plasma} · ` +
        `${icon('antimatter', 'sm')} ×${planet.richness.antimatter}`
      : '';
    const owner = planet.colonized ? `<br>владелец: <b>${planet.owner || 'неизвестен'}</b>` : '<br>колонии нет';
    const buildings = planet.buildings
      ? `<br>шахты: ${planet.buildings.ORE_MINE}/${planet.buildings.POLYMER_PLANT}/${planet.buildings.PLASMA_REACTOR}` +
        ` · лаб ${planet.buildings.SCIENCE_CENTER} · верфь ${planet.buildings.SHIPYARD}`
      : '';
    // Флот и склад меняются быстро: после суток сервер их уже не отдает,
    // и показывать нечего — вместо цифр честные «???».
    const unknown = '<span class="unknown-value">???</span>';
    const resources = planet.colonized
      ? planet.resources
        ? `<br>склад: ${icon('ore', 'sm')} ${fmt(planet.resources.ore)} · ` +
          `${icon('polymers', 'sm')} ${fmt(planet.resources.polymers)} · ${icon('plasma', 'sm')} ${fmt(planet.resources.plasma)}`
        : planet.staleHidden
          ? `<br>склад: ${unknown}`
          : ''
      : '';
    const fleet = planet.colonized
      ? planet.fleet
        ? `<br>флот: зонды ${planet.fleet.PROBE} · транспорты ${planet.fleet.TRANSPORTER} · ` +
          `истребители ${planet.fleet.LIGHT_FIGHTER} · крейсера ${planet.fleet.HEAVY_CRUISER} · ` +
          `фрегаты ${planet.fleet.ION_FRIGATE}`
        : planet.staleHidden
          ? `<br>флот: ${unknown}`
          : ''
      : '';
    const defenses = planet.defenses
      ? `<br>оборона: ракеты ${planet.defenses.CANNON_TURRET} · лазеры ${planet.defenses.LASER_TURRET}`
      : planet.colonized && planet.staleHidden
        ? `<br>оборона: ${unknown}`
        : '';
    const age = planet.visibility === 'SCANNED' ? scanAgeHtml(planet) : '';
    const hint = short ? '' : '<br>';

    return head + debris + owner + rich + buildings + resources + fleet + defenses + age + hint;
  }

  /** Поле обломков на орбите. Туман войны его не скрывает — гонка честная. */
  function debrisHtml(planet) {
    const debris = planet.debris;
    if (!debris || debris.ore + debris.polymers <= 0) return '';
    return (
      `<br><span class="debris">обломки: ${icon('ore', 'sm')} ${fmt(debris.ore)} · ` +
      `${icon('polymers', 'sm')} ${fmt(debris.polymers)}</span>`
    );
  }

  const FRESHNESS_LABELS = {
    FRESH: { css: 'fresh', text: 'данные свежие' },
    STALE: { css: 'stale', text: 'данные могут быть неточны' },
    OUTDATED: { css: 'outdated', text: 'данные устарели' },
  };

  /**
   * Индикатор свежести разведданных.
   * Снимок зонда не обновляется сам, поэтому возраст — такая же часть данных,
   * как и сами цифры: по суточному снимку планировать атаку нельзя.
   */
  function scanAgeHtml(planet) {
    const mark = FRESHNESS_LABELS[planet.freshness] || FRESHNESS_LABELS.OUTDATED;
    const age = `разведка ${fmtTime(planet.scanAgeSeconds)} назад`;
    const badge = `<span class="freshness ${mark.css}">${age}</span>`;

    if (planet.freshness === 'OUTDATED') {
      return `<br>${badge}<br><span class="scan-hidden">Данные устарели: флот и склад скрыты. Отправь зонд заново.</span>`;
    }
    if (planet.freshness === 'STALE') {
      return `<br>${badge}<br><span class="scan-warning">Данные могут быть неточны.</span>`;
    }
    return `<br>${badge}`;
  }

  function selectPlanet(planetId) {
    map.selectedKind = 'PLANET';
    map.selectedId = planetId;
    clearCoordTarget();
    renderMap();
    renderPlanetInfo();
  }

  /** Клик по карте отменяет цель, набранную координатами: иначе он бы не работал. */
  function clearCoordTarget() {
    if (!map.coordTarget) return;
    map.coordTarget = null;
    el.coordInput.value = '';
    el.coordNote.textContent = '';
    el.coordNote.className = 'coord-note';
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
    const target = dispatchTarget();
    const kind = target ? target.kind : map.selectedKind;
    const base = target && target.kind === 'PLANET' && target.isOwn
      ? MISSION_OPTIONS.OWN_PLANET
      : MISSION_OPTIONS[kind] || MISSION_OPTIONS.PLANET;
    const options = [...base];

    // «Переработка» появляется только когда в составе есть переработчик и над
    // планетой действительно висит поле: пустой пункт меню сбивал бы с толку.
    if (!map.coordTarget && map.selectedKind === 'PLANET') {
      const planet = selectedPlanet();
      const hasDebris = planet && planet.debris && planet.debris.ore + planet.debris.polymers > 0;
      const picked = readComposition();
      if (hasDebris && picked.RECYCLER > 0) options.push(['HARVEST', 'Переработка обломков']);
    }

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
    // Подпись перерисовывается вместе с иконкой: textContent стер бы SVG из разметки.
    el.cargoOreLabel.innerHTML = `${icon('ore', 'sm')} ${pickup ? 'Забрать руды' : 'Руда'}`;
    el.cargoPolymersLabel.innerHTML = `${icon('polymers', 'sm')} ${pickup ? 'Забрать полимеров' : 'Полимеры'}`;

    // Хаб торгует только рудой и полимерами, плазму туда не возят.
    const hubRun = pickup || el.mission.value === 'HUB_DELIVERY';
    el.cargoPlasmaField.hidden = hubRun;
    if (hubRun) el.cargoPlasma.value = '0';

    // Переработчики летят за обломками, а не с грузом: трюмы должны быть пусты.
    // Разведке трюмы тоже ни к чему — зонд везет данные, а не ресурсы.
    const harvest = el.mission.value === 'HARVEST' || el.mission.value === 'SCAN';
    el.cargoInputs.hidden = harvest;
    if (harvest) {
      el.cargoOre.value = '0';
      el.cargoPolymers.value = '0';
      el.cargoPlasma.value = '0';
    }
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
        renderDispatchTarget();
      }
      return;
    }

    const hub = selectedHub();

    if (hub) {
      el.planetInfo.innerHTML = hub.storage
        ? `<b>${hub.name}</b><br>нейтральная торговая станция · орбита ${hub.position}<br>` +
          `твой склад: ${icon('ore', 'sm')} <b>${fmt(hub.storage.ore)}</b> · ` +
          `${icon('polymers', 'sm')} <b>${fmt(hub.storage.polymers)}</b><br>` +
          `занято ${fmt(hub.storage.ore + hub.storage.polymers)} из ${fmt(hub.storage.capacity)} ` +
          `(свободно ${fmt(hub.storage.free)})`
        : `<b>${hub.name}</b><br>нейтральная торговая станция`;
      el.dispatch.hidden = !base;
      if (base) {
        syncMissionOptions();
        renderFleetInputs();
        renderDispatchTarget();
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
    el.dispatch.hidden = !base || (!map.coordTarget && planet.planetId === base.planetId);
    if (!el.dispatch.hidden) {
      syncMissionOptions();
      renderFleetInputs();
      renderDispatchTarget();
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
        input.addEventListener('input', () => {
          syncMissionOptions();
          schedulePlan();
        });
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

  /**
   * Куда летим. Цель, найденная по координатам, перекрывает выбор на карте:
   * она может лежать в другой системе, которой на текущей карте просто нет.
   */
  function dispatchTarget() {
    if (map.coordTarget) {
      return {
        kind: 'PLANET',
        request: { targetPlanetId: map.coordTarget.planetId },
        name: map.coordTarget.planetName,
        place:
          `система ${map.coordTarget.systemName} · орбита ${map.coordTarget.position} · ` +
          `${map.coordTarget.galaxyX}:${map.coordTarget.galaxyY}`,
        owner: map.coordTarget.owner,
        isOwn: map.coordTarget.isOwn,
      };
    }
    if (deepSpaceSelected()) {
      return {
        kind: 'DEEP_SPACE',
        request: { targetSystemId: map.data.systemId },
        name: 'Глубокий космос',
        place: `система ${map.data.systemName} · 16-я позиция`,
        owner: null,
        isOwn: false,
      };
    }
    const hub = selectedHub();
    if (hub) {
      return {
        kind: 'HUB',
        request: { targetHubId: hub.hubId },
        name: hub.name,
        place: `нейтральная станция · орбита ${hub.position}`,
        owner: null,
        isOwn: false,
      };
    }
    const planet = selectedPlanet();
    if (planet) {
      return {
        kind: 'PLANET',
        request: { targetPlanetId: planet.planetId },
        name: planet.name,
        place: `система ${map.data.systemName} · орбита ${planet.position}`,
        owner: planet.owner,
        isOwn: planet.isOwn,
      };
    }
    return null;
  }

  /** Расчет маршрута считает сервер — клиент только показывает результат. */
  function currentTarget() {
    const target = dispatchTarget();
    return target ? target.request : null;
  }

  /** Шаг «Цель»: что именно выбрано и кому оно принадлежит. */
  function renderDispatchTarget() {
    const target = dispatchTarget();
    if (!target) {
      el.dispatchTarget.innerHTML = '<span class="muted">Цель не выбрана: кликни планету на карте или введи координаты.</span>';
      return;
    }
    const owner = target.isOwn
      ? '<span class="own">своя колония</span>'
      : target.owner
        ? `владелец: ${escapeHtml(target.owner)}`
        : target.kind === 'PLANET'
          ? 'колонии нет'
          : '';
    el.dispatchTarget.innerHTML =
      `<b>${escapeHtml(target.name)}</b><span>${escapeHtml(target.place)}</span>` +
      (owner ? `<span>${owner}</span>` : '');
  }

  async function refreshPlan() {
    const base = activeBase();
    const target = currentTarget();
    if (!base || !target) return;

    const ships = readComposition();
    // Проверяем любой класс, а не три исходных: иначе флот из одних крейсеров,
    // фрегатов или переработчиков остается без расчета маршрута.
    const picked = Object.values(ships).reduce((total, count) => total + count, 0);
    if (picked <= 0) {
      map.plan = null;
      el.flightPlan.textContent = 'Выбери корабли, чтобы увидеть расчет.';
      return;
    }

    try {
      const response = await fetch(`/api/bases/${base.baseId}/fleets/preview`, {
        method: 'POST',
        headers: authHeaders(),
        // Миссию шлем в расчет: рейс в один конец не платит за обратный путь.
        body: JSON.stringify({ ...target, ships, mission: el.mission.value }),
      });
      if (!response.ok) {
        map.plan = null;
        el.flightPlan.textContent = 'Не удалось рассчитать маршрут';
        return;
      }
      map.plan = await response.json();

      const cargo =
        Number(el.cargoOre.value || 0) +
        Number(el.cargoPolymers.value || 0) +
        Number(el.cargoPlasma.value || 0);
      const overload = cargo > map.plan.capacity;
      const jump = map.plan.kind === 'INTERSTELLAR';

      // Внутри системы жжем плазма, между системами — антиматерия.
      const fuelAmount = jump ? map.plan.antimatter : map.plan.fuel;
      const fuelStock = jump ? base.resources.antimatter : base.resources.plasma;
      const fuelName = jump ? 'антиматерии' : 'плазмы';
      const noFuel = fuelAmount > fuelStock;
      // Дислокация домой не возвращается, и топливо за обратный путь не берется.
      const oneWay = el.mission.value === 'DEPLOY';

      el.flightPlan.innerHTML =
        (jump
          ? `<b>Гиперпрыжок</b> · дистанция <b>${map.plan.distance}</b> ед. по галактике<br>`
          : `дистанция: <b>${map.plan.distance}</b> орбит · скорость <b>${map.plan.speed}</b><br>`) +
        `время в пути: <b>${fmtTime(map.plan.flightSeconds)}</b>` +
        (oneWay ? ' — флот остается на месте<br>' : ' в одну сторону<br>') +
        `топливо (${oneWay ? 'в один конец' : 'туда-обратно'}): ` +
        `<b class="${noFuel ? 'bad' : ''}">${fmtAmount(fuelAmount)}</b> ${fuelName} ` +
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
      ore: Number(el.cargoOre.value) || 0,
      polymers: Number(el.cargoPolymers.value) || 0,
      plasma: Number(el.cargoPlasma.value) || 0,
    };
    const pickup = el.mission.value === 'HUB_PICKUP';

    const ok = await send(`/api/bases/${base.baseId}/fleets`, {
      ...target,
      mission: el.mission.value,
      ships: readComposition(),
      cargo: pickup ? { ore: 0, polymers: 0, plasma: 0 } : amounts,
      pickup: pickup ? { ore: amounts.ore, polymers: amounts.polymers } : { ore: 0, polymers: 0 },
    });

    // Сбрасываем форму, чтобы повторный клик не отправил тот же флот дважды.
    if (ok) {
      for (const refs of Object.values(fleetInputs)) refs.input.value = '0';
      el.cargoOre.value = '0';
      el.cargoPolymers.value = '0';
      el.cargoPlasma.value = '0';
      el.presetSelect.value = '';
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
      const cargo = fleet.cargo.ore + fleet.cargo.polymers > 0
        ? `, груз ${icon('ore', 'sm')} ${fmt(fleet.cargo.ore)} · ` +
          `${icon('polymers', 'sm')} ${fmt(fleet.cargo.polymers)}` +
          (fleet.cargo.plasma > 0 ? ` · ${icon('plasma', 'sm')} ${fmt(fleet.cargo.plasma)}` : '')
        : '';
      title.textContent = `${fleet.missionLabel}: ${direction}`;
      const meta = document.createElement('span');
      // Строка груза содержит иконки-разметку, поэтому только innerHTML:
      // через textContent теги вывалились бы в интерфейс текстом.
      meta.innerHTML =
        `${escapeHtml(fleet.composition)}${cargo} · прибытие через ${fmtTime(fleet.etaSeconds)}`;
      item.append(title, meta);
      el.fleetList.appendChild(item);
    }
  }

  /* Шаг 1: набрать весь доступный флот или очистить состав. */
  el.fleetAll.addEventListener('click', () => {
    const base = activeBase();
    if (!base) return;
    for (const [type, refs] of Object.entries(fleetInputs)) {
      refs.input.value = String(base.fleet[type] || 0);
    }
    syncMissionOptions();
    schedulePlan();
  });

  el.fleetNone.addEventListener('click', () => {
    for (const refs of Object.values(fleetInputs)) refs.input.value = '0';
    syncMissionOptions();
    schedulePlan();
  });

  /* Шаг 2: цель по координатам «система X:Y, орбита N». */
  async function lookupCoords() {
    const raw = el.coordInput.value.trim();
    const parts = raw.split(/[^0-9-]+/).filter(Boolean);
    const note = (text, bad) => {
      el.coordNote.textContent = text;
      el.coordNote.className = `coord-note${bad ? ' bad' : ''}`;
    };

    if (parts.length !== 3) {
      note('Координаты задаются как X:Y:орбита — например 1:1:3', true);
      return;
    }

    try {
      const query = new URLSearchParams({ x: parts[0], y: parts[1], position: parts[2] });
      const response = await fetch(`/api/planets/at?${query}`, { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) {
        note(data.error || 'Планета не найдена', true);
        return;
      }

      map.coordTarget = data;
      note(`Цель: ${data.planetName} (${data.systemName})`, false);
      syncMissionOptions();
      renderDispatchTarget();
      schedulePlan();
    } catch {
      note('Не удалось проверить координаты', true);
    }
  }

  el.coordGo.addEventListener('click', () => void lookupCoords());
  el.coordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void lookupCoords();
    }
  });

  el.sendFleetButton.addEventListener('click', () => void sendFleet());
  el.mission.addEventListener('change', () => {
    syncMissionOptions();
    schedulePlan();
  });
  el.cargoOre.addEventListener('input', schedulePlan);
  el.cargoPolymers.addEventListener('input', schedulePlan);
  el.cargoPlasma.addEventListener('input', schedulePlan);


  /* ---------- Хаб и биржа ---------- */

  const market = { data: null, timer: null };
  const RESOURCE_LABELS = { ORE: 'Руда', POLYMERS: 'Полимеры' };
  /** Биржа оперирует enum-ключами, иконки — именами ресурсов. */
  const RESOURCE_ICONS = { ORE: 'ore', POLYMERS: 'polymers' };

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
      `${icon('ore', 'sm')} <b>${fmt(storage.ore)}</b> · ${icon('polymers', 'sm')} <b>${fmt(storage.polymers)}</b><br>` +
      `занято ${fmt(storage.ore + storage.polymers)} из <b>${fmt(storage.capacity)}</b> ` +
      `(свободно ${fmt(storage.free)})<br>` +
      `уровень склада: <b>${storage.level}</b><br>` +
      `расширение до ур. ${storage.nextLevel}: ${icon('ore', 'sm')} ${fmt(storage.upgradeCost.ore)} + ` +
      `${icon('polymers', 'sm')} ${fmt(storage.upgradeCost.polymers)} со склада хаба → ${fmt(storage.nextCapacity)}`;

    el.upgradeStorage.disabled =
      storage.ore < storage.upgradeCost.ore || storage.polymers < storage.upgradeCost.polymers;
  }

  function renderOrderBook() {
    el.orderBook.innerHTML = '';

    for (const resource of ['ORE', 'POLYMERS']) {
      const side = document.createElement('div');
      side.className = 'book-side';

      const title = document.createElement('h4');
      title.innerHTML = `${icon(RESOURCE_ICONS[resource])} ${RESOURCE_LABELS[resource]}`;
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
    head.innerHTML =
      `<th>${caption}</th><th>цена ${icon('credits', 'sm')}</th><th>объем</th><th>сделка</th>`;
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
      title.innerHTML =
        `${order.side === 'SELL' ? 'Продажа' : 'Покупка'}: ${icon(RESOURCE_ICONS[order.resource], 'sm')} ` +
        `${fmt(order.remaining)} из ${fmt(order.quantity)} по ${order.pricePerUnit.toFixed(2)} ` +
        `${icon('credits', 'sm')}`;

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
      title.innerHTML =
        `${icon(RESOURCE_ICONS[trade.resource], 'sm')} ×${fmt(trade.quantity)} ` +
        `по ${trade.pricePerUnit.toFixed(2)} = <b>${fmt(trade.total)}</b> ${icon('credits', 'sm')}`;
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
        ? (el.orderResource.value === 'ORE' ? storage.ore : storage.polymers)
        : 0;
      el.orderHint.innerHTML =
        `Продажа заблокирует <b>${fmt(quantity)}</b> со склада хаба (там ${fmt(available)}).<br>` +
        `Выручка при полном исполнении: <b>${fmt(total)}</b> ${icon('credits', 'sm')}`;
    } else {
      el.orderHint.innerHTML =
        `Покупка заблокирует <b>${fmt(total)}</b> ${icon('credits', 'sm')} ` +
        `(баланс ${fmt(state.credits)}).<br>` +
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

  const DEFENSE_LABELS = { CANNON_TURRET: 'Пушечные турели', LASER_TURRET: 'Лазерные турели' };
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
      const looted = battle.plunder.ore + battle.plunder.polymers + battle.plunder.plasma > 0;
      plunder.innerHTML = looted
        ? 'награблено: ' +
          [
            [battle.plunder.ore, 'ore'],
            [battle.plunder.polymers, 'polymers'],
            [battle.plunder.plasma, 'plasma'],
          ]
            .filter(([amount]) => amount > 0)
            .map(([amount, res]) => `${icon(res, 'sm')} <b>${fmt(amount)}</b>`)
            .join(' · ') +
          `${battle.role === 'DEFENDER' ? ' (вывезено с нашего склада)' : ''}`
        : 'ресурсы не вывозились';

      // Почему увезли именно столько: сколько спрятало хранилище защитника.
      const safe = battle.victory && battle.role === 'ATTACKER' ? battle.storageDefense : null;

      // Обломки образуют обе стороны, поэтому строка одинакова для всех.
      const debris = document.createElement('div');
      debris.className = 'line';
      const debrisTotal = battle.debris ? battle.debris.ore + battle.debris.polymers : 0;
      debris.innerHTML =
        debrisTotal > 0
          ? `на орбите осело обломков: ${icon('ore', 'sm')} <b>${fmt(battle.debris.ore)}</b> · ` +
            `${icon('polymers', 'sm')} <b>${fmt(battle.debris.polymers)}</b> — их можно собрать переработчиком`
          : 'обломков не осталось';

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

      card.append(plunder, debris);

      if (safe) {
        const line = document.createElement('div');
        line.className = 'line';
        const reason = safe.cargoLimited
          ? 'остальное не влезло в трюмы уцелевших'
          : 'больше из хранилища не достать';
        line.innerHTML =
          `хранилище врага (ур. вместимости <b>${fmt(safe.capacity)}</b>): на складе лежало ` +
          `<b>${fmt(safe.stored)}</b>, из них защищено <b>${fmt(safe.protectedAmount)}</b>, ` +
          `уязвимый излишек <b>${fmt(safe.surplus)}</b> — ${reason}`;
        card.appendChild(line);
      }

      card.append(when);
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

      const loot = report.loot.ore + report.loot.polymers + report.loot.antimatter;
      if (loot > 0) {
        const line = document.createElement('div');
        line.className = 'line';
        const parts = [];
        if (report.loot.ore) parts.push(`${icon('ore', 'sm')} ${fmt(report.loot.ore)}`);
        if (report.loot.polymers) parts.push(`${icon('polymers', 'sm')} ${fmt(report.loot.polymers)}`);
        if (report.loot.antimatter) parts.push(`${icon('antimatter', 'sm')} ${fmtAmount(report.loot.antimatter)}`);
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
    syncBroadcastForm();
  }

  /**
   * Форма рассылки видна только тем, кто вправе ее отправить.
   * Право проверяет и сервер, но прятать заведомо запрещенную кнопку честнее,
   * чем показывать ее и отвечать отказом.
   */
  function syncBroadcastForm() {
    const mine = syndicate.data && syndicate.data.mine;
    el.mailBroadcast.hidden = !mine || (mine.role !== 'LEADER' && mine.role !== 'OFFICER');
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
      `<div class="hub-storage">Основание стоит <b>${fmt(data.foundingCost)}</b> ${icon('credits', 'sm')} ` +
      `(на счету ${fmt(data.credits)}). Основатель становится лидером.</div>`;

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
      `<div class="bank">банк синдиката<b>${fmt(mine.bank)} ${icon('credits', 'sm')}</b>` +
      `личный счет: ${fmt(data.credits)} ${icon('credits', 'sm')}</div>`;
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
      title.innerHTML = `${tx.nickname || 'система'} — ${fmt(tx.amount)} ${icon('credits', 'sm')}`;
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


  /* ---------- Шаблоны флотов ---------- */

  const presets = { list: [], editingId: null };

  async function loadPresets() {
    renderPresetInputs();
    try {
      const response = await fetch('/api/commander/fleet-templates', { headers: authHeaders() });
      if (!response.ok) return;
      presets.list = (await response.json()).templates || [];
      renderPresetSelect();
      renderPresetList();
    } catch (error) {
      // Молча: без шаблонов интерфейс отправки работает как раньше.
    }
  }

  function renderPresetSelect() {
    const current = el.presetSelect.value;
    el.presetSelect.innerHTML = '<option value="">— вручную —</option>';
    for (const preset of presets.list) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = `${preset.name} (${preset.size})`;
      el.presetSelect.appendChild(option);
    }
    if (presets.list.some((preset) => preset.id === current)) el.presetSelect.value = current;
  }

  /**
   * Шаблон заполняет инпуты, но не отправляет флот: игрок видит состав
   * и может поправить его перед вылетом.
   */
  function applyPreset(id) {
    const preset = presets.list.find((item) => item.id === id);
    if (!preset) return;

    for (const [type, refs] of Object.entries(fleetInputs)) {
      refs.input.value = String(preset.ships[type] || 0);
    }
    schedulePlan();

    const base = activeBase();
    const missing = base
      ? Object.keys(SHIP_LABELS).filter((type) => (preset.ships[type] || 0) > base.fleet[type])
      : [];
    if (missing.length) {
      showBuildMessage(`Шаблон «${preset.name}»: на базе не хватает кораблей`, false);
    }
  }

  function renderPresetList() {
    el.presetList.innerHTML = '';
    if (!presets.list.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Шаблонов пока нет';
      el.presetList.appendChild(empty);
      return;
    }

    for (const preset of presets.list) {
      const item = document.createElement('div');
      item.className = 'queue-item preset-item';

      const body = document.createElement('div');
      body.className = 'preset-body';
      body.innerHTML =
        `<div class="preset-name">${preset.name}</div>` +
        `<div class="preset-ships">${describePreset(preset.ships)}</div>`;

      const actions = document.createElement('div');
      actions.className = 'preset-actions';

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ghost';
      edit.textContent = 'Править';
      edit.addEventListener('click', () => startPresetEdit(preset));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost';
      remove.textContent = 'Удалить';
      remove.addEventListener('click', () => deletePreset(preset));

      actions.append(edit, remove);
      item.append(body, actions);
      el.presetList.appendChild(item);
    }
  }

  function describePreset(ships) {
    const parts = Object.entries(SHIP_LABELS)
      .filter(([type]) => (ships[type] || 0) > 0)
      .map(([type, label]) => `${label} ×${ships[type]}`);
    return parts.length ? parts.join(', ') : 'пустой состав';
  }

  const presetInputs = {};

  function renderPresetInputs() {
    if (el.presetInputs.childElementCount > 0) return;
    for (const [type, label] of Object.entries(SHIP_LABELS)) {
      const field = document.createElement('label');
      field.className = 'field';
      const caption = document.createElement('span');
      caption.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.value = '0';
      field.append(caption, input);
      el.presetInputs.appendChild(field);
      presetInputs[type] = input;
    }
  }

  function readPresetInputs() {
    const ships = {};
    for (const [type, input] of Object.entries(presetInputs)) {
      ships[type] = Math.max(0, Math.floor(Number(input.value) || 0));
    }
    return ships;
  }

  function startPresetEdit(preset) {
    presets.editingId = preset.id;
    el.presetName.value = preset.name;
    for (const [type, input] of Object.entries(presetInputs)) {
      input.value = String(preset.ships[type] || 0);
    }
    el.presetSave.textContent = 'Сохранить изменения';
    el.presetCancel.hidden = false;
  }

  function resetPresetForm() {
    presets.editingId = null;
    el.presetName.value = '';
    for (const input of Object.values(presetInputs)) input.value = '0';
    el.presetSave.textContent = 'Сохранить шаблон';
    el.presetCancel.hidden = true;
  }

  async function savePreset() {
    const name = el.presetName.value.trim();
    const body = { name, ships: readPresetInputs() };
    const editing = presets.editingId;

    const ok = editing
      ? await send(`/api/commander/fleet-templates/${editing}`, body, 'PUT')
      : await send('/api/commander/fleet-templates', body);

    if (ok) {
      resetPresetForm();
      await loadPresets();
    }
  }

  async function deletePreset(preset) {
    if (await send(`/api/commander/fleet-templates/${preset.id}`, undefined, 'DELETE')) {
      if (presets.editingId === preset.id) resetPresetForm();
      await loadPresets();
    }
  }

  el.presetSelect.addEventListener('change', () => {
    if (el.presetSelect.value) applyPreset(el.presetSelect.value);
  });
  el.presetManage.addEventListener('click', () => {
    renderPresetInputs();
    showPanel('presets');
  });
  el.presetBack.addEventListener('click', () => showPanel('map'));
  el.presetSave.addEventListener('click', () => void savePreset());
  el.presetCancel.addEventListener('click', () => resetPresetForm());

  /* ---------- Боевой симулятор ---------- */

  const sim = { attacker: {}, defender: {}, defenses: {}, targets: [] };

  const DEFENSE_SIM_LABELS = { CANNON_TURRET: 'Пушечные турели', LASER_TURRET: 'Лазерные турели' };

  function buildCountInputs(container, labels, store) {
    if (container.childElementCount > 0) return;
    for (const [type, label] of Object.entries(labels)) {
      const field = document.createElement('label');
      field.className = 'field';
      const caption = document.createElement('span');
      caption.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.value = '0';
      field.append(caption, input);
      container.appendChild(field);
      store[type] = input;
    }
  }

  function readCounts(store) {
    const counts = {};
    for (const [type, input] of Object.entries(store)) {
      counts[type] = Math.max(0, Math.floor(Number(input.value) || 0));
    }
    return counts;
  }

  function writeCounts(store, values) {
    for (const [type, input] of Object.entries(store)) {
      input.value = String((values && values[type]) || 0);
    }
  }

  function initSimulator() {
    buildCountInputs(el.simAttacker, SHIP_LABELS, sim.attacker);
    buildCountInputs(el.simDefender, SHIP_LABELS, sim.defender);
    buildCountInputs(el.simDefenses, DEFENSE_SIM_LABELS, sim.defenses);
  }

  /** Разведанные цели: то, что можно подставить одним выбором. */
  async function loadEspionageTargets() {
    try {
      const response = await fetch('/api/commander/espionage', { headers: authHeaders() });
      if (!response.ok) return;
      sim.targets = (await response.json()).targets || [];
    } catch (error) {
      sim.targets = [];
    }

    el.simEspionage.innerHTML = '<option value="">— вручную —</option>';
    for (const target of sim.targets) {
      const option = document.createElement('option');
      option.value = target.planetId;
      option.textContent =
        `${target.planetName} (${target.owner || 'без владельца'}) · ${fmtTime(target.ageSeconds)} назад`;
      el.simEspionage.appendChild(option);
    }
    if (!sim.targets.length) {
      el.simEspionage.innerHTML = '<option value="">нет свежих отчетов разведки</option>';
    }
  }

  function applyEspionage(planetId) {
    const target = sim.targets.find((item) => item.planetId === planetId);
    if (!target) {
      el.simEspionageNote.hidden = true;
      return;
    }

    writeCounts(sim.defender, target.ships);
    writeCounts(sim.defenses, target.defenses);
    el.simStockOre.value = String(target.stock.ore);
    el.simStockPolymers.value = String(target.stock.polymers);
    el.simStockPlasma.value = String(target.stock.plasma);
    el.simStockStorage.value = String(target.stock.storageLevel);

    // Возраст снимка — часть ответа: по суточным данным планировать нельзя.
    const notes = [];
    if (target.freshness === 'STALE') notes.push('Данные могут быть неточны: снимку больше часа.');
    if (!target.hasDefenseData) notes.push('В этом снимке нет обороны — заполни ее вручную.');
    el.simEspionageNote.hidden = notes.length === 0;
    el.simEspionageNote.textContent = notes.join(' ');
    el.simEspionageNote.style.color = target.freshness === 'STALE' ? 'var(--warn)' : '';
  }

  async function runSimulation() {
    const body = {
      attacker: { ships: readCounts(sim.attacker) },
      defender: {
        ships: readCounts(sim.defender),
        defenses: readCounts(sim.defenses),
        stock: {
          ore: Math.max(0, Math.floor(Number(el.simStockOre.value) || 0)),
          polymers: Math.max(0, Math.floor(Number(el.simStockPolymers.value) || 0)),
          plasma: Math.max(0, Math.floor(Number(el.simStockPlasma.value) || 0)),
          storageLevel: Math.max(0, Math.floor(Number(el.simStockStorage.value) || 0)),
        },
      },
    };

    try {
      const response = await fetch('/api/commander/simulate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        showBuildMessage(data.error || 'Симуляция не удалась', false);
        return;
      }
      renderSimulation(data);
    } catch (error) {
      showBuildMessage('Симуляция не удалась', false);
    }
  }

  function renderSimulation(result) {
    el.simResult.innerHTML = '';
    el.simResult.appendChild(renderBattleReport(battleReportFromSimulation(result)));

    // Разбор урона нужен именно в предпросмотре: по нему видно, вязнет залп
    // в щитах или проходит по корпусу, и что менять в составе.
    const details = document.createElement('div');
    details.className = 'battle-damage';
    details.appendChild(line(
      `потери атакующего <b>${Math.round(result.attackerLossRatio * 100)}%</b>, ` +
      `защитника <b>${Math.round(result.defenderLossRatio * 100)}%</b>`));

    for (const [report, caption] of [
      [result.attackerDamageReport, 'урон атакующего'],
      [result.defenderDamageReport, 'урон защитника'],
    ]) {
      if (!report) continue;
      const mix = (report.damageMix || []).map((d) => d.label).join(', ') || 'без оружия';
      details.appendChild(line(
        `${caption} (${mix}): щиты поглотили <b>${fmt(report.shield)}</b>, ` +
        `броня <b>${fmt(report.armor)}</b>, по корпусу прошло <b>${fmt(report.hull)}</b>`));
    }

    el.simResult.appendChild(details);
  }

  function line(html) {
    const node = document.createElement('div');
    node.className = 'line';
    node.innerHTML = html;
    return node;
  }

  el.simRun.addEventListener('click', () => void runSimulation());
  el.simEspionage.addEventListener('change', () => applyEspionage(el.simEspionage.value));
  el.simReset.addEventListener('click', () => {
    writeCounts(sim.attacker, {});
    writeCounts(sim.defender, {});
    writeCounts(sim.defenses, {});
    el.simStockOre.value = '0';
    el.simStockPolymers.value = '0';
    el.simStockPlasma.value = '0';
    el.simStockStorage.value = '0';
    el.simEspionage.value = '';
    el.simEspionageNote.hidden = true;
    el.simResult.innerHTML = '';
  });
  el.simFillMine.addEventListener('click', () => {
    const base = activeBase();
    if (base) writeCounts(sim.attacker, base.fleet);
  });


  /* ---------- Боевой отчет ---------- */

  /*
   * Один компонент на два источника: письмо из центра связи и предпросмотр
   * симулятора. Оба приводятся к общей форме адаптерами ниже — иначе отчет
   * пришлось бы верстать дважды и правки расходились бы.
   *
   * Отчеты в ящике — данные из прошлого: письмо, отправленное до появления
   * координат или ничьей, приходит без этих полей. Поэтому компонент читает
   * нагрузку защищенно и просто не рисует то, чего в ней нет.
   */

  const BATTLE_STATUS = {
    WIN: { label: 'Победа', className: 'win' },
    LOSS: { label: 'Поражение', className: 'loss' },
    DRAW: { label: 'Ничья', className: 'draw' },
  };

  /** Исход глазами того, кто читает отчет: одна и та же битва для сторон разная. */
  function battleStatus(result, role) {
    if (result === 'DRAW') return BATTLE_STATUS.DRAW;
    return result === role ? BATTLE_STATUS.WIN : BATTLE_STATUS.LOSS;
  }

  function unitFolder(key) {
    return SHIP_LABELS[key] ? 'ship' : 'defense';
  }

  function unitLabel(key, fallback) {
    return SHIP_LABELS[key] || DEFENSE_LABELS[key] || fallback || key;
  }

  /** Строка потерь: было, потеряно, осталось. Ноль потерь тоже показываем — это результат. */
  function lossRows(losses) {
    return (losses || []).map((row) => ({
      key: row.key,
      label: unitLabel(row.key, row.label),
      before: row.before || 0,
      lost: row.lost || 0,
      left: Math.max(0, (row.before || 0) - (row.lost || 0)),
    }));
  }

  function lossTable(rows) {
    const table = document.createElement('table');
    table.className = 'losses';
    table.innerHTML =
      '<thead><tr><th>Юнит</th><th>Было</th><th>Потеряно</th><th>Осталось</th></tr></thead>';

    const body = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      if (row.left === 0) tr.className = 'wiped';

      const name = document.createElement('td');
      name.className = 'unit';
      name.appendChild(artNode(row.key, row.label, unitFolder(row.key), 'art-mini'));
      const caption = document.createElement('span');
      caption.textContent = row.label;
      name.appendChild(caption);

      tr.appendChild(name);
      for (const [value, className] of [
        [row.before, ''],
        [row.lost, row.lost > 0 ? 'lost' : ''],
        [row.left, ''],
      ]) {
        const cell = document.createElement('td');
        cell.className = className;
        cell.textContent = className === 'lost' && value > 0 ? `−${fmt(value)}` : fmt(value);
        tr.appendChild(cell);
      }
      body.appendChild(tr);
    }

    table.appendChild(body);
    return table;
  }

  function battleColumn(title, side) {
    const column = document.createElement('div');
    column.className = 'battle-side';

    const head = document.createElement('h5');
    head.textContent = side.name ? `${title}: ${side.name}` : title;
    column.appendChild(head);

    const rows = lossRows(side.losses);
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Сил не было';
      column.appendChild(empty);
      return column;
    }

    column.appendChild(lossTable(rows));

    // Полное уничтожение стоит назвать словами: пустая колонка нулей читается
    // хуже, чем прямая надпись.
    if (rows.every((row) => row.left === 0)) {
      const wiped = document.createElement('p');
      wiped.className = 'fleet-wiped';
      wiped.textContent = 'Флот уничтожен';
      column.appendChild(wiped);
    }

    return column;
  }

  function resourceTotal(node, label, amounts) {
    const block = document.createElement('div');
    block.className = 'battle-total';

    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = label;
    block.appendChild(caption);

    const value = document.createElement('div');
    value.className = 'amounts';
    value.innerHTML = amounts
      .filter((item) => item.value > 0)
      .map((item) => `${icon(item.key, 'sm')} <b>${fmt(item.value)}</b>`)
      .join(' · ');
    if (!value.innerHTML) value.innerHTML = '<b class="muted">—</b>';
    block.appendChild(value);

    node.appendChild(block);
  }

  /**
   * Отчет о бое. `report` — нормализованная форма (см. адаптеры ниже).
   * Пораундового лога здесь нет намеренно: сводка «было / стало» отвечает
   * на вопрос «что я потерял», а разбор по раундам — уже другая задача.
   */
  function renderBattleReport(report) {
    const status = battleStatus(report.result, report.role);

    const card = document.createElement('article');
    card.className = `battle-report ${status.className}`;

    /* Заголовок: исход, место боя и дата. */
    const header = document.createElement('header');
    const verdict = document.createElement('span');
    verdict.className = `battle-verdict ${status.className}`;
    verdict.textContent = report.statusLabel || status.label;

    const where = document.createElement('div');
    where.className = 'battle-where';
    where.innerHTML =
      `<b>${escapeHtml(report.title)}</b>` +
      (report.place ? `<span>${escapeHtml(report.place)}</span>` : '');

    header.append(verdict, where);
    if (report.date) {
      const date = document.createElement('span');
      date.className = 'battle-date';
      date.textContent = new Date(report.date).toLocaleString('ru-RU');
      header.appendChild(date);
    }
    card.appendChild(header);

    /* Итоги: обломки и трофеи крупно — это то, ради чего отчет открывают. */
    const summary = document.createElement('div');
    summary.className = 'battle-summary';
    resourceTotal(summary, 'Обломки на орбите', [
      { key: 'ore', value: (report.debris && report.debris.ore) || 0 },
      { key: 'polymers', value: (report.debris && report.debris.polymers) || 0 },
    ]);
    // Трофеи показываем всегда, даже нулевые: «награблено —» после отбитой
    // атаки — это ответ, а не пустое место.
    const loot = report.plunder || {};
    resourceTotal(summary, report.plunderLabel || 'Награблено', [
      { key: 'ore', value: loot.ore || 0 },
      { key: 'polymers', value: loot.polymers || 0 },
      { key: 'plasma', value: loot.plasma || 0 },
    ]);
    card.appendChild(summary);

    if (report.note) {
      const note = document.createElement('p');
      note.className = 'battle-note';
      note.innerHTML = report.note;
      card.appendChild(note);
    }

    /* Потери сторон: атакующий слева, защитник справа. */
    const sides = document.createElement('div');
    sides.className = 'battle-sides';
    sides.append(
      battleColumn('Атакующий', report.attacker),
      battleColumn('Защитник', report.defender),
    );
    card.appendChild(sides);

    if (report.footer) {
      const footer = document.createElement('p');
      footer.className = 'battle-footer';
      footer.innerHTML = report.footer;
      card.appendChild(footer);
    }

    return card;
  }

  /** Письмо центра связи → отчет. */
  function battleReportFromMail(message) {
    const payload = message.payload;
    if (!payload || !payload.attackerLosses || !payload.defenderLosses) return null;

    const place = payload.location
      ? `${payload.location.planetName} · система ${payload.location.systemName} · ` +
        `орбита ${payload.location.position} · ${payload.location.galaxyX}:${payload.location.galaxyY}`
      : payload.planetName || '';

    const role = payload.role === 'DEFENDER' ? 'DEFENDER' : 'ATTACKER';
    // Старые письма не знают о ничьей: у них есть только победитель.
    const result = payload.result || payload.winner || 'DEFENDER';
    const loot = payload.plunder;

    return {
      title: 'Боевой отчет',
      place,
      date: message.createdAt,
      role,
      result,
      attacker: { name: payload.attackerName, losses: payload.attackerLosses },
      defender: { name: payload.defenderName, losses: payload.defenderLosses },
      debris: payload.debris,
      plunder: loot,
      plunderLabel: role === 'ATTACKER' ? 'Награблено' : 'Вывезено со склада',
      footer:
        (payload.rounds ? `Бой занял раундов: <b>${payload.rounds}</b>. ` : '') +
        // Про укрытое хранилищем есть смысл говорить, только если до склада
        // вообще дошли: у отбитой атаки эта цифра выглядит почти-добычей,
        // которой не было.
        (result === 'ATTACKER' && loot && loot.protectedAmount > 0
          ? `Хранилище защитника укрыло <b>${fmt(loot.protectedAmount)}</b>.`
          : ''),
    };
  }

  /** Результат симулятора → тот же отчет. */
  function battleReportFromSimulation(result) {
    const loot = result.plunder;

    const warning =
      loot && loot.cargoLimited
        ? `<span class="scan-warning">Трюмы уцелевших вмещают ${fmt(result.survivingCapacity)} — ` +
          `взять можно было ${fmt(loot.takeable)}. Добавь транспортов.</span><br>`
        : '';

    return {
      title: 'Прогноз боя',
      place: `огневая мощь ${fmt(result.attackerPower)} против ${fmt(result.defenderPower)}`,
      date: null,
      role: 'ATTACKER',
      result: result.result || (result.attackerWins ? 'ATTACKER' : 'DEFENDER'),
      statusLabel: result.attackerWins
        ? 'Атака проходит'
        : result.result === 'DRAW'
          ? 'Ничья: поле за защитником'
          : 'Атака захлебывается',
      attacker: { name: null, losses: result.attackerLosses },
      defender: { name: null, losses: result.defenderLosses },
      debris: result.debris,
      plunder: loot,
      plunderLabel: 'Трофеи',
      note:
        !loot && result.attackerWins
          ? 'Склад защитника не задан — заполни его, чтобы увидеть трофеи.'
          : '',
      footer:
        warning +
        (result.rounds ? `Бой занял раундов: <b>${result.rounds}</b>. ` : '') +
        'Это прогноз по тем же формулам, что и реальный бой, но с фиксированным ' +
        'броском кубика: состав противника к моменту атаки может измениться.',
    };
  }


  /* ---------- Центр связи ---------- */

  const MAIL_FILTERS = [
    { key: '', label: 'Все' },
    { key: 'PLAYER', label: 'Игроки' },
    { key: 'SYNDICATE', label: 'Синдикат' },
    { key: 'BATTLE_REPORT', label: 'Бои' },
    { key: 'SPY_REPORT', label: 'Разведка' },
    { key: 'EXPEDITION', label: 'Экспедиции' },
  ];

  const MAIL_KIND_LABELS = {
    PLAYER: 'личное',
    SYNDICATE: 'синдикат',
    BATTLE_REPORT: 'бой',
    SPY_REPORT: 'разведка',
    EXPEDITION: 'экспедиция',
  };

  const mail = { filter: '', data: null, expanded: new Set() };

  async function loadMail() {
    const query = mail.filter ? `?type=${mail.filter}` : '';
    try {
      const response = await fetch(`/api/mail${query}`, { headers: authHeaders() });
      if (!response.ok) return;
      mail.data = await response.json();
    } catch (error) {
      return;
    }
    renderMailFilters();
    renderMailList();
    setUnread(mail.data.unread);
  }

  /**
   * Бейдж непрочитанного. Значение приходит и от сокета, и после загрузки ящика,
   * поэтому отрисовка вынесена отдельно от самого ящика.
   */
  function setUnread(unread) {
    const value = Math.max(0, Number(unread) || 0);
    el.mailBadge.hidden = value === 0;
    el.mailBadge.textContent = value > 99 ? '99+' : String(value);
  }

  function renderMailFilters() {
    const counts = (mail.data && mail.data.unreadByType) || {};
    el.mailFilters.innerHTML = '';

    for (const item of MAIL_FILTERS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `mail-filter${mail.filter === item.key ? ' active' : ''}`;
      const unread = item.key ? counts[item.key] || 0 : mail.data ? mail.data.unread : 0;
      button.innerHTML = unread > 0 ? `${item.label}<span class="count">${unread}</span>` : item.label;
      button.addEventListener('click', () => {
        mail.filter = item.key;
        void loadMail();
      });
      el.mailFilters.appendChild(button);
    }
  }

  function renderMailList() {
    el.mailList.innerHTML = '';
    const messages = (mail.data && mail.data.messages) || [];
    el.mailSummary.textContent = mail.data
      ? `Писем в ящике: ${mail.data.total}, непрочитанных: ${mail.data.unread}`
      : '';

    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Писем нет';
      el.mailList.appendChild(empty);
      return;
    }

    for (const message of messages) {
      const item = document.createElement('div');
      item.className = `queue-item mail-item${message.isRead ? '' : ' unread'}`;

      const head = document.createElement('div');
      head.className = 'mail-head';
      head.innerHTML =
        `<span class="mail-subject">${escapeHtml(message.subject)}</span>` +
        `<span class="mail-meta">${new Date(message.createdAt).toLocaleString('ru-RU')}</span>`;

      const from = document.createElement('div');
      from.className = 'mail-from';
      // Метка прочтения словами: цветная полоса слева читается быстро, но
      // не отвечает на вопрос прямо — а список просматривают именно на предмет
      // «что я еще не открывал».
      from.innerHTML =
        `<span class="mail-kind ${message.type.toLowerCase()}">${MAIL_KIND_LABELS[message.type] || message.type}</span> ` +
        `<span class="mail-state${message.isRead ? '' : ' unread'}">` +
        `${message.isRead ? 'Прочитано' : 'Не прочитано'}</span> ` +
        `от ${message.from ? escapeHtml(message.from) : 'Центра связи'}`;

      item.append(head, from);

      // Тело письма разворачивается по клику: длинные боевые отчеты иначе
      // превращают ящик в простыню, по которой ничего не найти.
      const open = mail.expanded.has(message.id);
      if (open) {
        // Боевое письмо разворачивается в полноценный отчет, остальные — текстом.
        // Если нагрузки нет (старое письмо или другой тип), текст и остается:
        // отчет без данных нарисовать не из чего.
        const report = message.type === 'BATTLE_REPORT' ? battleReportFromMail(message) : null;
        if (report) {
          item.appendChild(renderBattleReport(report));
        } else {
          const body = document.createElement('div');
          body.className = 'mail-body';
          body.textContent = message.body;
          item.appendChild(body);
        }
      }

      const actions = document.createElement('div');
      actions.className = 'mail-actions';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'ghost';
      toggle.textContent = open ? 'Свернуть' : 'Читать';
      toggle.addEventListener('click', () => void openMessage(message));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost';
      remove.textContent = 'Удалить';
      remove.addEventListener('click', async () => {
        if (await send(`/api/mail/${message.id}`, undefined, 'DELETE')) {
          mail.expanded.delete(message.id);
          await loadMail();
        }
      });

      if (message.from) {
        const reply = document.createElement('button');
        reply.type = 'button';
        reply.className = 'ghost';
        reply.textContent = 'Ответить';
        reply.addEventListener('click', () => {
          el.mailTo.value = message.from;
          el.mailSubject.value = message.subject.startsWith('Re: ')
            ? message.subject
            : `Re: ${message.subject}`;
          el.mailBody.focus();
        });
        actions.appendChild(reply);
      }

      actions.append(toggle, remove);
      item.appendChild(actions);
      el.mailList.appendChild(item);
    }
  }

  /** Открытие письма помечает его прочитанным — отдельной кнопки для этого не нужно. */
  async function openMessage(message) {
    if (mail.expanded.has(message.id)) {
      mail.expanded.delete(message.id);
      renderMailList();
      return;
    }

    mail.expanded.add(message.id);
    if (!message.isRead) {
      await fetch(`/api/mail/${message.id}/read`, { method: 'POST', headers: authHeaders() }).catch(() => {});
      await loadMail();
      return;
    }
    renderMailList();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  el.mailButton.addEventListener('click', () => showPanel('mail'));
  el.mailReadAll.addEventListener('click', async () => {
    if (await send('/api/mail/read-all', {})) await loadMail();
  });
  el.mailSend.addEventListener('click', async () => {
    const ok = await send('/api/mail', {
      to: el.mailTo.value.trim(),
      subject: el.mailSubject.value.trim(),
      body: el.mailBody.value.trim(),
    });
    if (ok) {
      el.mailSubject.value = '';
      el.mailBody.value = '';
      await loadMail();
    }
  });
  el.broadcastSend.addEventListener('click', async () => {
    const ok = await send('/api/syndicates/broadcast', {
      subject: el.broadcastSubject.value.trim(),
      body: el.broadcastBody.value.trim(),
    });
    if (ok) {
      el.broadcastSubject.value = '';
      el.broadcastBody.value = '';
      await loadMail();
    }
  });


  /* ---------- Пульт гейм-мастера ---------- */

  const admin = { schema: null, list: [], selected: null, detail: null, searchTimer: null };

  const ADMIN_RESOURCE_LABELS = {
    ore: 'Руда',
    polymers: 'Полимеры',
    plasma: 'Плазма',
    antimatter: 'Антиматерия',
  };

  /**
   * Вкладка пульта появляется только у администратора.
   * Это исключительно удобство: доступ решает сервер, и запрос обычного игрока
   * к /api/admin/* получает 403 независимо от того, что показано в интерфейсе.
   */
  function syncAdminTab() {
    const isAdmin = Boolean(auth.account) && auth.account.role === 'ADMIN';
    el.adminTab.hidden = !isAdmin;
    if (isAdmin) return;

    // Смена аккаунта не должна оставлять на экране открытый пульт с чужими
    // данными: прятать одну вкладку мало, панель нужно закрыть и очистить.
    admin.list = [];
    admin.detail = null;
    admin.selected = null;
    el.adminRows.innerHTML = '';
    el.adminDetail.innerHTML =
      '<p class="storage-note">Выбери игрока в таблице, чтобы открыть его профиль.</p>';
    el.adminSearch.value = '';
    if (state.activeTab === 'admin') showPanel('buildings');
  }

  async function loadAdminList() {
    const search = el.adminSearch.value.trim();
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    try {
      const response = await fetch(`/api/admin/commanders${query}`, { headers: authHeaders() });
      if (!response.ok) return;
      admin.list = (await response.json()).commanders || [];
    } catch (error) {
      return;
    }
    renderAdminRows();
  }

  function renderAdminRows() {
    el.adminRows.innerHTML = '';
    if (!admin.list.length) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="5">Никого не найдено</td>';
      el.adminRows.appendChild(row);
      return;
    }

    for (const item of admin.list) {
      const row = document.createElement('tr');
      if (admin.selected === item.commanderId) row.className = 'selected';
      row.innerHTML =
        `<td>${escapeHtml(item.nickname)}` +
        `${item.role === 'ADMIN' ? ' <span class="admin-role">admin</span>' : ''}</td>` +
        `<td>${item.homePlanet ? escapeHtml(item.homePlanet) : '—'}</td>` +
        `<td>${fmt(item.credits)}</td>` +
        `<td>${item.syndicate ? `[${escapeHtml(item.syndicate.tag)}]` : '—'}</td>` +
        `<td>${item.battlesWon}/${item.battlesLost}</td>`;
      row.addEventListener('click', () => void openAdminCommander(item.commanderId));
      el.adminRows.appendChild(row);
    }
  }

  async function openAdminCommander(commanderId) {
    admin.selected = commanderId;
    renderAdminRows();

    try {
      const [detail, schema] = await Promise.all([
        fetch(`/api/admin/commanders/${commanderId}`, { headers: authHeaders() }).then((r) => r.json()),
        admin.schema
          ? Promise.resolve(admin.schema)
          : fetch('/api/admin/schema', { headers: authHeaders() }).then((r) => r.json()),
      ]);
      admin.schema = schema;
      admin.detail = detail;
    } catch (error) {
      showBuildMessage('Не удалось загрузить профиль игрока', false);
      return;
    }
    renderAdminDetail();
  }

  /** Инпуты формы: ключ поля → элемент, чтобы собрать патч одним проходом. */
  const adminInputs = { credits: null, technologies: {}, bases: {} };

  function adminField(label, value, step = '1') {
    const field = document.createElement('label');
    field.className = 'field';
    const caption = document.createElement('span');
    caption.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = step;
    input.value = String(value);
    field.append(caption, input);
    return { field, input };
  }

  function adminGroup(title) {
    const group = document.createElement('div');
    group.className = 'admin-group';
    const heading = document.createElement('h4');
    heading.textContent = title;
    const fields = document.createElement('div');
    fields.className = 'admin-fields';
    group.append(heading, fields);
    return { group, fields };
  }

  function renderAdminDetail() {
    const detail = admin.detail;
    el.adminDetail.innerHTML = '';
    adminInputs.technologies = {};
    adminInputs.bases = {};

    const title = document.createElement('div');
    title.className = 'admin-detail-title';
    title.innerHTML =
      `<h3>${escapeHtml(detail.nickname)}</h3>` +
      `<span>${escapeHtml(detail.email)} · ${detail.role}</span>`;
    el.adminDetail.appendChild(title);

    if (detail.fleetsInFlight > 0) {
      const note = document.createElement('p');
      note.className = 'storage-note';
      note.textContent = `Флотов в полете: ${detail.fleetsInFlight}. Их состав правится после возвращения.`;
      el.adminDetail.appendChild(note);
    }

    // Криптогривна
    const credits = adminGroup('Счет командира');
    const creditsField = adminField('Криптогривна', Math.round(detail.credits), '0.01');
    adminInputs.credits = creditsField.input;
    credits.fields.appendChild(creditsField.field);
    el.adminDetail.appendChild(credits.group);

    // Технологии
    const techs = adminGroup('Технологии');
    for (const tech of admin.schema.technologies) {
      const { field, input } = adminField(tech, detail.technologies[tech] ?? 0);
      adminInputs.technologies[tech] = input;
      techs.fields.appendChild(field);
    }
    el.adminDetail.appendChild(techs.group);

    // Базы
    for (const base of detail.bases) {
      adminInputs.bases[base.baseId] = { resources: {}, buildings: {}, ships: {}, defenses: {} };
      const store = adminInputs.bases[base.baseId];

      const heading = document.createElement('h4');
      heading.className = 'section-title';
      heading.style.marginTop = '18px';
      heading.textContent = `${base.name} · ${base.planetName} (${base.systemName})`;
      el.adminDetail.appendChild(heading);

      const resources = adminGroup('Склад');
      for (const key of admin.schema.resources) {
        const { field, input } = adminField(ADMIN_RESOURCE_LABELS[key] || key, Math.round(base.resources[key]), '0.01');
        store.resources[key] = input;
        resources.fields.appendChild(field);
      }
      el.adminDetail.appendChild(resources.group);

      const buildings = adminGroup('Постройки');
      for (const type of admin.schema.buildings) {
        const { field, input } = adminField(type, base.buildings[type] ?? 0);
        store.buildings[type] = input;
        buildings.fields.appendChild(field);
      }
      el.adminDetail.appendChild(buildings.group);

      const ships = adminGroup('Ангар');
      for (const type of admin.schema.ships) {
        const { field, input } = adminField(type, base.ships[type] ?? 0);
        store.ships[type] = input;
        ships.fields.appendChild(field);
      }
      el.adminDetail.appendChild(ships.group);

      const defenses = adminGroup('Оборона');
      for (const type of admin.schema.defenses) {
        const { field, input } = adminField(type, base.defenses[type] ?? 0);
        store.defenses[type] = input;
        defenses.fields.appendChild(field);
      }
      el.adminDetail.appendChild(defenses.group);
    }

    if (detail.hubStorages.length > 0) {
      const note = document.createElement('p');
      note.className = 'storage-note';
      note.style.marginTop = '14px';
      note.textContent =
        'Склады на хабах: ' +
        detail.hubStorages
          .map((s) => `${s.hubName} — ${fmt(s.ore)} Ti / ${fmt(s.polymers)} Si (ур. ${s.level})`)
          .join('; ');
      el.adminDetail.appendChild(note);
    }

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'primary';
    save.style.marginTop = '16px';
    save.style.width = '100%';
    save.textContent = 'Сохранить изменения';
    save.addEventListener('click', () => void saveAdminChanges());
    el.adminDetail.appendChild(save);
  }

  /**
   * Собираем только реально измененные поля.
   * Патч из одних текущих значений был бы бессмысленной записью в лог и лишним
   * поводом затереть то, что игрок успел изменить за время открытой формы.
   */
  function saveAdminChanges() {
    const detail = admin.detail;
    const patch = {};

    const credits = Number(adminInputs.credits.value);
    if (Number.isFinite(credits) && Math.round(credits) !== Math.round(detail.credits)) {
      patch.credits = credits;
    }

    const technologies = {};
    for (const [tech, input] of Object.entries(adminInputs.technologies)) {
      const value = Number(input.value);
      if (Number.isFinite(value) && value !== (detail.technologies[tech] ?? 0)) technologies[tech] = value;
    }
    if (Object.keys(technologies).length) patch.technologies = technologies;

    const bases = [];
    for (const base of detail.bases) {
      const store = adminInputs.bases[base.baseId];
      const entry = { baseId: base.baseId };
      let touched = false;

      for (const [group, current] of [
        ['resources', base.resources],
        ['buildings', base.buildings],
        ['ships', base.ships],
        ['defenses', base.defenses],
      ]) {
        const changed = {};
        for (const [key, input] of Object.entries(store[group])) {
          const value = Number(input.value);
          const before = group === 'resources' ? Math.round(current[key] ?? 0) : current[key] ?? 0;
          if (Number.isFinite(value) && value !== before) changed[key] = value;
        }
        if (Object.keys(changed).length) {
          entry[group] = changed;
          touched = true;
        }
      }
      if (touched) bases.push(entry);
    }
    if (bases.length) patch.bases = bases;

    if (Object.keys(patch).length === 0) {
      showBuildMessage('Ничего не изменилось', false);
      return Promise.resolve();
    }

    return send(`/api/admin/commanders/${detail.commanderId}`, patch, 'PATCH').then(async (ok) => {
      if (ok) {
        await openAdminCommander(detail.commanderId);
        await loadAdminList();
      }
    });
  }

  el.adminSearch.addEventListener('input', () => {
    clearTimeout(admin.searchTimer);
    admin.searchTimer = setTimeout(() => void loadAdminList(), 250);
  });

  /* ---------- Старт ---------- */



  el.logout.addEventListener('click', () => logout());

  if (state.token) {
    startSession().catch(() => showScreen('auth'));
  } else {
    showScreen('auth');
  }
})();

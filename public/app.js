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
    colonies: { used: 0, slots: 1 },
    activeBaseId: null,
    activeTab: 'overview',
    socket: null,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    dashboard: $('dashboard'),
    detailScrim: $('detail-scrim'),
    detailArt: $('detail-art'),
    detailTitle: $('detail-title'),
    detailLevel: $('detail-level'),
    detailDesc: $('detail-desc'),
    detailBody: $('detail-body'),
    detailClose: $('detail-close'),
    queueSummary: $('queue-summary'),
    energyStats: $('energy-stats'),
    overviewFleets: $('overview-fleets'),
    levelBuildings: $('level-buildings'),
    levelTechs: $('level-techs'),
    layout: document.querySelector('.layout'),
    sidebar: $('sidebar'),
    navToggle: $('nav-toggle'),
    navScrim: $('nav-scrim'),
    opsPanel: $('ops-panel'),
    resourceBar: $('resource-bar'),
    baseSwitch: $('base-switch'),
    baseTrigger: $('base-trigger'),
    baseSwitchName: $('base-switch-name'),
    baseSwitchCoords: $('base-switch-coords'),
    syndicateTag: $('syndicate-tag'),
    adminGroup: $('admin-group'),
    authTabs: document.querySelector('.auth-tabs'),
    authForm: $('auth-form'),
    authEmail: $('auth-email'),
    authPassword: $('auth-password'),
    authSubmit: $('auth-submit'),
    authMessage: $('auth-message'),
    forgotPassword: $('forgot-password'),
    googleButton: $('google-button'),
    googleNote: $('google-note'),
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
    colonyArt: $('colony-art'),
    garrisonFleet: $('garrison-fleet'),
    garrisonFleetTotal: $('garrison-fleet-total'),
    garrisonDefense: $('garrison-defense'),
    garrisonDefenseTotal: $('garrison-defense-total'),
    storage: $('storage'),
    storageRows: $('storage-rows'),
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
    missionMenu: $('mission-menu'),
    missionWarning: $('mission-warning'),
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
    oneWay: $('one-way'),
    oneWayRow: $('one-way-row'),
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
    orderMax: $('order-max'),
    orderMarket: $('order-market'),
    marketQuotes: $('market-quotes'),
    barterGiveRes: $('barter-give-res'),
    barterGiveQty: $('barter-give-qty'),
    barterWantRes: $('barter-want-res'),
    barterWantQty: $('barter-want-qty'),
    barterHint: $('barter-hint'),
    barterOffer: $('barter-offer'),
    barterList: $('barter-list'),
    placeOrderButton: $('place-order'),
    orderBook: $('order-book'),
    tradeLog: $('trade-log'),
    marketChart: $('market-chart'),
    marketChartSvg: $('market-chart-svg'),
    marketChartTitle: $('market-chart-title'),
    marketChartNote: $('market-chart-note'),
    bookTrader: $('book-trader'),
    tradesMore: $('trades-more'),
    cargoOreLabel: $('cargo-ore-label'),
    cargoPolymersLabel: $('cargo-polymers-label'),
    cargoPlasma: $('cargo-plasma'),
    cargoPlasmaField: $('cargo-plasma-field'),
    cargoInputs: $('cargo-inputs'),
    adminSearch: $('admin-search'),
    ratingNote: $('rating-note'),
    ratingMine: $('rating-mine'),
    ratingModes: document.querySelector('.rating-modes'),
    ratingHead: $('rating-head'),
    ratingRows: $('rating-rows'),
    adminDashboard: $('admin-dashboard'),
    adminRows: $('admin-rows'),
    botNickname: $('bot-nickname'),
    botCharacter: $('bot-character'),
    botSystem: $('bot-system'),
    botCreate: $('bot-create'),
    botCharacterHint: $('bot-character-hint'),
    botRows: $('bot-rows'),
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
    installGroup: $('install-group'),
    installNav: $('install-nav'),
    installCard: $('install-card'),
    installTitle: $('install-title'),
    installText: $('install-text'),
    installSteps: $('install-steps'),
    installGo: $('install-go'),
    installLater: $('install-later'),
    installClose: $('install-close'),
    mailCompose: $('mail-compose'),
    mailComposeToggle: $('mail-compose-toggle'),
    mailSend: $('mail-send'),
    mailBroadcast: $('mail-broadcast'),
    broadcastSubject: $('broadcast-subject'),
    broadcastBody: $('broadcast-body'),
    broadcastSend: $('broadcast-send'),
    presetSelect: $('preset-select'),
    presetRow: $('preset-row'),
    presetToggle: $('preset-toggle'),
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

  /*
   * Короткие подписи для полей состава и гарнизона: там нет места на позывное
   * из карточки верфи. Порядок тот же, что в `SHIP_TYPES` на сервере — по нему
   * строятся поля ввода, и переставлять его значит переставлять форму.
   */
  const SHIP_LABELS = {
    PROBE: 'Зонды',
    SMALL_CARGO: 'Малые транспорты',
    LARGE_CARGO: 'Большие транспорты',
    LIGHT_FIGHTER: 'Легкие истребители',
    HEAVY_FIGHTER: 'Тяжелые истребители',
    CRUISER: 'Крейсера',
    FRIGATE: 'Фрегаты',
    BOMBER: 'Бомбардировщики',
    BATTLESHIP: 'Линкоры',
    CARRIER: 'Авианосцы',
    RECYCLER: 'Переработчики',
    COLONY_SHIP: 'Колонизаторы',
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

  /**
   * Энергия печатается с десятыми, пока их видно.
   * Расход шахты первого уровня — 1.1, и округление до единицы стирало бы
   * разницу между первым и вторым уровнем целиком.
   */
  function fmtEnergy(value) {
    const number = Number(value) || 0;
    return Math.abs(number) < 10 ? number.toFixed(1).replace('.', ',') : fmt(Math.round(number));
  }

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
  const ART_FOLDERS = { building: 'buildings', ship: 'ships', defense: 'defense', tech: 'tech', planet: 'planets' };

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
    if (name === 'dashboard') {
      syncInstallOffer();
      offerInstallOnce();
    }
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

  /* --- вход через Google --- */

  /**
   * Подключение Google Identity Services.
   *
   * Скрипт грузится по требованию, а не тегом в разметке: без настроенного
   * client id он не нужен вовсе, и тянуть сторонний домен на каждый показ
   * экрана входа только ради несуществующей кнопки незачем.
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'yes') resolve();
        else existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('script')));
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'yes';
        resolve();
      });
      script.addEventListener('error', () => reject(new Error('script')));
      document.head.appendChild(script);
    });
  }

  async function initGoogleSignIn() {
    const config = await api('/api/auth/config');
    const clientId = config.ok ? config.data.googleClientId : null;
    if (!clientId) {
      el.googleNote.hidden = false;
      return;
    }

    try {
      await loadScript('https://accounts.google.com/gsi/client');
    } catch {
      // Сеть до Google не дошла — это не повод ронять экран входа:
      // вход по паролю рядом и работает.
      el.googleNote.textContent = 'Не удалось загрузить вход через Google.';
      el.googleNote.hidden = false;
      return;
    }

    window.google.accounts.id.initialize({ client_id: clientId, callback: onGoogleCredential });
    // Язык подписи выбирает сам Google по настройкам пользователя: параметр
    // locale он для отрисованной кнопки игнорирует, и держать его здесь значит
    // делать вид, что мы этим управляем.
    window.google.accounts.id.renderButton(el.googleButton, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
      width: 320,
    });
  }

  async function onGoogleCredential(response) {
    const result = await api('/api/auth/oauth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken: response.credential }),
    });

    if (!result.ok) {
      showAuthMessage(el.authMessage, result.data.error || 'Google не пустил', false);
      return;
    }

    state.token = result.data.token;
    localStorage.setItem(TOKEN_KEY, state.token);
    await startSession();
  }

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
    // Код приходит в ответе только на стенде с явно включенным флагом.
    // В обычном случае поля нет — и подставлять нечего, игрок вводит его сам.
    el.resetToken.value = result.data.devToken || '';
    showAuthMessage(
      el.resetMessage,
      result.data.devToken
        ? 'Код подставлен автоматически: это стенд разработки.'
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
    // Тег синдиката стоит в шапке и виден на любой вкладке, поэтому состав
    // подтягивается сразу, а не при первом заходе в раздел синдиката.
    await loadSyndicate();
    syncOpsPanel();
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
    syndicate.data = null;
    el.syndicateTag.hidden = true;
    closeBaseMenu();
    closeNav();
    syncAdminTab();
    cards.buildings.clear();
    cards.technologies.clear();
    cards.ships.clear();
    cards.defenses.clear();
    cardsBaseId = null;
    // Кэши перерисовки привязаны к содержимому, а не к аккаунту: без сброса
    // следующий игрок с таким же составом увидел бы чужие миниатюры.
    rosterKeys.fleet.value = null;
    rosterKeys.defense.value = null;
    colonyArtKey = '';
    baseListSignature = '';
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

  /*
   * Регистрация service worker'а. Он ничего не кеширует и нужен ровно затем,
   * чтобы Chrome счел страницу устанавливаемой и выдал `beforeinstallprompt`.
   * Не зарегистрировался — игра работает как работала, пропадает только
   * предложение установки одной кнопкой.
   */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* молча: без него теряется удобство, а не работоспособность */
      });
    });
  }

  /* ---------- Установка на домашний экран ---------- */

  /*
   * Две платформы решают это по-разному, и обойтись одной веткой нельзя.
   *
   * Chrome отдает событие `beforeinstallprompt`, которое можно придержать
   * и выстрелить им по кнопке — установка происходит в один клик. Safari
   * такого события не имеет вовсе и никогда не будет: на iPhone установка
   * делается руками через «Поделиться», и единственное, чем мы можем помочь, —
   * показать, куда нажимать.
   *
   * Отказ не закрывает дорогу насовсем: карточка больше не всплывает, но
   * пункт меню остается. Уже установленное приложение не предлагает
   * установиться повторно — там ни карточки, ни пункта.
   */
  const install = { prompt: null, shown: false };

  const INSTALL_DISMISSED = 'install-dismissed';

  function installed() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  /*
   * iPad с iPadOS 13+ представляется MacIntel, и по одному userAgent его
   * не отличить от настольного Safari — выдает только наличие касаний.
   */
  function isIOS() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  }

  /* Хранилище может быть недоступно (приватный режим) — это не повод падать. */
  function installDismissed() {
    try {
      return localStorage.getItem(INSTALL_DISMISSED) === '1';
    } catch {
      return false;
    }
  }

  function rememberInstallDismissed() {
    try {
      localStorage.setItem(INSTALL_DISMISSED, '1');
    } catch {
      /* нечего делать: в следующий раз просто спросим снова */
    }
  }

  /** Наполнение карточки зависит от того, чем платформа может помочь. */
  function fillInstallCard() {
    const steps = [];
    let text = '';

    if (install.prompt) {
      text = 'Игра встанет на рабочий стол своим значком и будет открываться на весь экран, без адресной строки.';
      el.installGo.hidden = false;
    } else if (isIOS()) {
      text = 'Safari ставит приложения вручную. Это три касания:';
      steps.push(
        'Нажмите «Поделиться» — квадрат со стрелкой вверх, внизу экрана.',
        'Пролистайте список и выберите «На экран «Домой»».',
        'Нажмите «Добавить» в правом верхнем углу.',
      );
      el.installGo.hidden = true;
    } else {
      // Chrome не дал события: страница уже установлена в другом профиле,
      // браузер другой или условия установки не выполнены. Остается меню.
      text = 'Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».';
      el.installGo.hidden = true;
    }

    el.installText.textContent = text;
    el.installSteps.innerHTML = '';
    for (const step of steps) {
      const li = document.createElement('li');
      li.textContent = step;
      el.installSteps.appendChild(li);
    }
    el.installSteps.hidden = steps.length === 0;
  }

  function showInstallCard() {
    if (installed()) return;
    fillInstallCard();
    el.installCard.hidden = false;
  }

  function hideInstallCard() {
    el.installCard.hidden = true;
  }

  /** Пункт меню есть всегда, пока игра не установлена. */
  function syncInstallOffer() {
    const hide = installed();
    el.installGroup.hidden = hide;
    if (hide) hideInstallCard();
  }

  /**
   * Первое предложение — с задержкой и только на рабочем экране.
   *
   * На экране логина оно ни к чему: игрок еще не решил, нужна ли ему игра.
   * Пауза дает Chrome время прислать `beforeinstallprompt`, иначе карточка
   * успела бы показать инструкцию для меню там, где возможна кнопка.
   */
  function offerInstallOnce() {
    if (install.shown || installed() || installDismissed()) return;
    install.shown = true;
    setTimeout(() => {
      if (!installed() && !installDismissed()) showInstallCard();
    }, 2500);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    // Свое предложение показывается в свой момент, поэтому браузерное гасим.
    event.preventDefault();
    install.prompt = event;
    syncInstallOffer();
    if (!el.installCard.hidden) fillInstallCard();
  });

  window.addEventListener('appinstalled', () => {
    install.prompt = null;
    hideInstallCard();
    syncInstallOffer();
  });

  el.installNav.addEventListener('click', () => {
    closeNav();
    showInstallCard();
  });

  el.installGo.addEventListener('click', async () => {
    if (!install.prompt) return;
    hideInstallCard();
    install.prompt.prompt();
    try {
      await install.prompt.userChoice;
    } finally {
      // Событие одноразовое: второй раз тем же объектом не выстрелить.
      install.prompt = null;
      syncInstallOffer();
    }
  });

  // Отказ прячет карточку навсегда, крестик — только до следующего захода.
  el.installLater.addEventListener('click', () => {
    rememberInstallDismissed();
    hideInstallCard();
  });
  el.installClose.addEventListener('click', hideInstallCard);

  /* ---------- Вкладки ---------- */

  /*
   * Обе карты живут в одной панели: SVG переключаются режимом, а не разделами.
   * В навигации их два пункта — искать галактику внутри «карты системы» игроку
   * неоткуда, — поэтому раздел `galaxy` отображается на панель `map`.
   */
  const TAB_PANEL = { galaxy: 'map' };
  /** Разделы, рядом с которыми имеет смысл правая сводка: цель выбирают на карте. */
  const MAP_TABS = new Set(['map', 'galaxy']);

  el.tabs.addEventListener('click', (event) => {
    const button = event.target.closest('.tab');
    if (button) showPanel(button.dataset.tab);
  });

  /** Подсветка активного пункта навигации. */
  function markActiveTab() {
    for (const tab of el.tabs.querySelectorAll('.tab')) {
      tab.classList.toggle('active', tab.dataset.tab === state.activeTab);
    }
  }

  /**
   * Правая колонка появляется только на картах — там же, где выбирают цель.
   * На вкладке шахт она отбирала бы ширину у карточек, ничего не показывая.
   */
  function syncOpsPanel() {
    const onMap = MAP_TABS.has(state.activeTab);
    el.opsPanel.hidden = !onMap;
    el.layout.classList.toggle('with-side', onMap);
  }

  /**
   * Переключение панели. Вынесено из обработчика вкладок, потому что панель
   * шаблонов открывается кнопкой из формы отправки, а вкладки для нее нет.
   */
  function showPanel(name) {
    state.activeTab = name;
    const panel = TAB_PANEL[name] || name;

    markActiveTab();
    for (const node of document.querySelectorAll('[data-panel]')) {
      node.hidden = node.dataset.panel !== panel;
    }
    syncOpsPanel();
    closeNav();

    if (name === 'map') {
      void loadMap();
      void loadGalaxy();
    }
    if (name === 'galaxy') {
      void loadGalaxy();
      setMapMode('galaxy');
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
    if (name === 'rating') void loadRating();
    if (name === 'admin') {
      void loadAdminList();
      void loadAdminDashboard();
      void loadBots();
    }
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
    // Отчет, отправленный до появления слотов, приходит без поля — читаем
    // защищенно и показываем хотя бы стартовую колонию.
    state.colonies = payload.colonies || { used: state.bases.length, slots: 1 };
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

  /**
   * Координаты базы в привычном виде X:Y:орбита.
   * Снимок базы координат системы не несет, зато их знает макро-карта, поэтому
   * система ищется в ней по id. Карта грузится асинхронно — пока ее нет,
   * показываем имя системы: это тот же адрес, просто словами.
   */
  function baseCoords(base) {
    const system = galaxy.data && galaxy.data.systems.find((item) => item.systemId === base.systemId);
    return system
      ? `${system.galaxyX}:${system.galaxyY}:${base.position}`
      : `${base.systemName} · орбита ${base.position}`;
  }

  /** Список баз перерисовывается только при изменении состава или выбора. */
  let baseListSignature = '';
  function renderBaseList() {
    // Подпись учитывает и загруженность макро-карты: до нее координаты
    // подставить неоткуда, и список, отрисованный раньше, так и остался бы
    // с запасным адресом словами.
    const signature =
      state.bases.map((base) => `${base.baseId}:${base.baseName}`).join('|') +
      `#${state.activeBaseId}#${galaxy.data ? 'xy' : 'names'}` +
      `#${state.colonies.used}/${state.colonies.slots}`;
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
      meta.textContent = baseCoords(base);
      button.appendChild(meta);
      button.addEventListener('click', () => {
        state.activeBaseId = base.baseId;
        closeBaseMenu();
        renderBaseList();
        renderActiveBase();
      });
      li.appendChild(button);
      el.baseList.appendChild(li);
    }

    // Предел расширения виден там же, где список колоний: иначе о нем узнают
    // только отказом на вылете колонизатора, уже построив его за десять тысяч.
    const foot = document.createElement('li');
    foot.className = 'base-list-foot';
    foot.textContent =
      `Колоний: ${state.colonies.used} из ${state.colonies.slots}` +
      (state.colonies.used >= state.colonies.slots ? ' · нужен уровень астрофизики' : '');
    el.baseList.appendChild(foot);
  }

  /* --- выпадающий список баз в шапке --- */
  function closeBaseMenu() {
    el.baseList.hidden = true;
    el.baseTrigger.setAttribute('aria-expanded', 'false');
  }

  el.baseTrigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = el.baseList.hidden;
    el.baseList.hidden = !open;
    el.baseTrigger.setAttribute('aria-expanded', String(open));
  });

  // Клик мимо закрывает список: отдельной кнопки «закрыть» у выпадашки нет.
  document.addEventListener('click', (event) => {
    if (!el.baseSwitch.contains(event.target)) closeBaseMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeBaseMenu();
      closeNav();
    }
  });

  /*
   * Реальная высота шапки уходит в CSS-переменную. Строка ресурсов переносится
   * на узком экране, и липкие колонки должны отступать на столько, сколько
   * шапка занимает сейчас, а не на число, записанное в стилях однажды:
   * иначе меню уезжает под нее и первый раздел оказывается не виден.
   */
  const topbar = document.querySelector('.topbar');
  if (topbar && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--header-h', `${topbar.offsetHeight}px`);
    }).observe(topbar);
  }

  /* --- боковое меню на узком экране --- */
  function closeNav() {
    el.sidebar.classList.remove('open');
    el.navScrim.hidden = true;
    el.navToggle.setAttribute('aria-expanded', 'false');
  }

  el.navToggle.addEventListener('click', () => {
    const open = !el.sidebar.classList.contains('open');
    el.sidebar.classList.toggle('open', open);
    el.navScrim.hidden = !open;
    el.navToggle.setAttribute('aria-expanded', String(open));
  });
  el.navScrim.addEventListener('click', () => closeNav());

  function renderActiveBase() {
    const base = activeBase();
    if (!base) return;

    el.resOre.textContent = fmt(base.resources.ore);
    el.resPolymers.textContent = fmt(base.resources.polymers);
    el.resPlasma.textContent = fmt(base.resources.plasma);
    // Показываем расход, а не остаток. Остаток вел себя наоборот интуиции:
    // новая шахта увеличивает потребление, а число на экране падало — и это
    // читалось как «шахты уменьшают расход». Расход растет вместе с базой,
    // и по нему сразу видно, когда пора ставить станцию.
    el.resEnergy.textContent = fmt(base.energy.usage);

    // На полном складе шахта стоит: показывать ее проектную скорость — значит
    // спорить с надписью «добыча остановлена». Склады раздельные, поэтому
    // и надпись адресная: встала руда — молчит только руда.
    for (const [node, rate, key] of [
      [el.rateOre, base.productionPerSecond.ore, 'ore'],
      [el.ratePolymers, base.productionPerSecond.polymers, 'polymers'],
      [el.ratePlasma, base.productionPerSecond.plasma, 'plasma'],
    ]) {
      const stopped = Boolean(base.storage && base.storage[key] && base.storage[key].full);
      node.textContent = stopped ? 'склад полон' : fmtRate(rate);
      node.style.color = stopped ? 'var(--err)' : '';
    }
    el.resAntimatter.textContent = fmt(base.resources.antimatter);
    el.rateAntimatter.textContent = `+${base.productionPerSecond.antimatter.toFixed(3)}/с`;
    el.rateEnergy.textContent = `из ${fmt(base.energy.output)}`;

    // Те же три состояния, что и у полосы склада: запас, впритык, дефицит.
    const load = base.energy.output > 0 ? base.energy.usage / base.energy.output : 0;
    el.resEnergy.style.color = load >= 1 ? 'var(--err)' : load >= 0.85 ? 'var(--warn)' : '';

    const efficiency = Math.round(base.energy.efficiency * 100);
    el.resEfficiency.textContent = `${efficiency}%`;
    el.resEfficiency.style.color = efficiency < 100 ? 'var(--warn)' : '';
    el.rateEfficiency.textContent = efficiency < 100 ? 'дефицит энергии' : 'мощность шахт';

    el.baseSwitchName.textContent = base.baseName;
    el.baseSwitchCoords.textContent = baseCoords(base);
    el.baseSwitch.classList.toggle('single', state.bases.length < 2);

    el.baseName.textContent = base.baseName;
    el.planetMeta.textContent =
      `${base.planetName} · ${PLANET_TYPES[base.planetType] || base.planetType} · ` +
      `система ${base.systemName} · орбита ${base.position} · слотов ${base.size}` +
      (base.anomaly === 'BLACK_HOLE' ? ' · черная дыра: искажение времени' : '');

    renderColonyArt(base);
    renderRichness(base);
    renderGarrison(base);
    renderStorage(base);
    renderOverview(base);

    renderJobBanner(el.buildJob, base.buildJob && {
      title: `${base.buildJob.label} → ур. ${base.buildJob.targetLevel}`,
      remainingSeconds: base.buildJob.remainingSeconds,
      totalSeconds: base.buildJob.totalSeconds,
      onRush: () => send(`/api/bases/${base.baseId}/rush`),
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
   * Портрет планеты в паспорте колонии. Тот же арт, что и на карте системы,
   * поэтому колония узнается в лицо и там, и тут. Пересобирается только при
   * смене базы или биома: каждую секунду создавать <img> заново значит
   * каждую секунду заново дергать загрузку картинки.
   */
  let colonyArtKey = '';
  function renderColonyArt(base) {
    const biome = PLANET_ART[base.planetType] || 'rocky';
    if (colonyArtKey === `${base.baseId}:${biome}`) return;
    colonyArtKey = `${base.baseId}:${biome}`;

    el.colonyArt.innerHTML = '';
    el.colonyArt.appendChild(artNode(biome, base.planetName, 'planet'));
  }

  /*
   * Богатство недр. Голое «×0.61» не отвечает на вопрос, много это или мало:
   * шкала не имеет ни нуля, ни потолка, и сравнивать не с чем. Поэтому рядом
   * с множителем стоит словесная оценка и полоса, где единица — середина:
   * так видно, что 0.61 — это бедная жила, а 1.39 — заметно выше обычного.
   */
  const RICHNESS_TIERS = [
    { upTo: 0.75, label: 'скудно', tone: 'poor' },
    { upTo: 0.95, label: 'бедно', tone: 'low' },
    { upTo: 1.1, label: 'обычно', tone: 'mid' },
    { upTo: 1.35, label: 'богато', tone: 'high' },
    { upTo: Infinity, label: 'изобилие', tone: 'top' },
  ];

  /** Строки паспорта: инсоляция — не ресурс на складе, но добычу она задает так же. */
  const RICHNESS_ROWS = [
    { key: 'ore', icon: 'ore', label: 'Руда' },
    { key: 'polymers', icon: 'polymers', label: 'Полимеры' },
    { key: 'plasma', icon: 'plasma', label: 'Плазма' },
    { key: 'energy', icon: 'energy', label: 'Инсоляция' },
    { key: 'antimatter', icon: 'antimatter', label: 'Антиматерия' },
  ];

  function richnessTier(value) {
    return RICHNESS_TIERS.find((tier) => value < tier.upTo) || RICHNESS_TIERS[RICHNESS_TIERS.length - 1];
  }

  function renderRichness(base) {
    el.richness.innerHTML = '';

    for (const row of RICHNESS_ROWS) {
      const value = Number(base.richness[row.key]) || 0;
      const tier = richnessTier(value);
      // Полоса упирается в потолок на удвоенной норме: множители выше двух
      // в генераторе не встречаются, а растягивать шкалу до бесконечности
      // значит сплющить весь рабочий диапазон в левую четверть.
      const fill = Math.max(4, Math.min(100, (value / 2) * 100));

      // Ячейки — прямые потомки строки, но раскладывает их сетка списка
      // (`.rich-row { display: contents }`): только так название, полоса,
      // множитель и оценка стоят в общих колонках. Своя сетка у каждой
      // строки давала бы столько же столбцов, сколько строк.
      const item = document.createElement('div');
      item.className = `rich-row ${tier.tone}`;
      item.innerHTML =
        `<span class="rich-name">${icon(row.icon)} ${row.label}</span>` +
        `<span class="rich-bar"><i style="width:${fill.toFixed(1)}%"></i></span>` +
        `<span class="rich-value">×${value}</span>` +
        `<span class="rich-tier">${tier.label}</span>`;
      el.richness.appendChild(item);
    }
  }

  /**
   * Гарнизон базы: что стоит на орбите и что вкопано в грунт. Пустые классы
   * не показываем — список из шести нулей ничего не сообщает, а место занимает.
   */
  function renderGarrison(base) {
    const fleetTotal = fillGarrison(el.garrisonFleet, base.fleet, SHIP_LABELS, 'ship', 'Кораблей на орбите нет');
    const defenseTotal = fillGarrison(el.garrisonDefense, base.defenses, DEFENSE_LABELS, 'defense', 'Планета не укреплена');
    el.garrisonFleetTotal.textContent = fmt(fleetTotal);
    el.garrisonDefenseTotal.textContent = fmt(defenseTotal);
  }

  function fillGarrison(node, counts, labels, kind, emptyText) {
    node.innerHTML = '';
    let total = 0;

    for (const [type, label] of Object.entries(labels)) {
      const count = Number(counts[type]) || 0;
      total += count;
      if (count === 0) continue;

      const unit = document.createElement('div');
      unit.className = 'garrison-unit';
      unit.title = label;

      const value = document.createElement('b');
      value.textContent = fmt(count);
      const name = document.createElement('small');
      name.textContent = label;

      unit.append(artNode(type, label, kind, 'art-chip'), value, name);
      node.appendChild(unit);
    }

    if (total === 0) {
      const empty = document.createElement('p');
      empty.className = 'garrison-empty';
      empty.textContent = emptyText;
      node.appendChild(empty);
    }
    return total;
  }

  /** Три склада: у каждого ресурса свой лимит и своя полоса. */
  const STORAGE_ROWS = [
    { key: 'ore', label: 'Руда' },
    { key: 'polymers', label: 'Полимеры' },
    { key: 'plasma', label: 'Плазма' },
  ];

  /**
   * Заполненность складов.
   *
   * Полный склад — не косметика: добыча этого ресурса встает. Раньше лимит был
   * общий, и одна полоса отвечала за все три ресурса разом — по ней нельзя было
   * понять, какой именно уперся в потолок. Теперь полоса на каждый.
   */
  /**
   * Три склада: сколько лежит, с какой скоростью прибывает и что уцелеет при набеге.
   *
   * Общей суммы по трем складам здесь нет намеренно. Лимиты поресурсные, и
   * «занято 38 030 из 43 311» не отвечает ни на один вопрос: руда может стоять
   * на полном складе с остановленной добычей, пока итог бодро показывает
   * свободное место.
   *
   * Полоса разбита на две части, потому что вопрос к складу не один. Первая —
   * несгораемый запас: его прячет само хранилище, и он остается при любом
   * исходе боя. Вторая — то, что вывезет победитель. Одной полосой это
   * не показать, а числом под ней видно, сколько именно бункеруется.
   */
  function renderStorage(base) {
    const storage = base.storage;
    if (!storage) return;

    if (!el.storageRows.firstChild) {
      el.storageRows.innerHTML = STORAGE_ROWS.map(
        (row) =>
          `<div class="storage-row" data-res="${row.key}">` +
          `<span class="storage-name">${icon(row.key, 'sm')} ${row.label}</span>` +
          '<b class="storage-amount"></b>' +
          '<span class="storage-rate"></span>' +
          '<div class="storage-bar"><i class="bar-safe"></i><i class="bar-risk"></i></div>' +
          '<small class="storage-split"></small>' +
          '</div>',
      ).join('');
    }

    let full = false;
    let near = false;

    for (const row of STORAGE_ROWS) {
      const one = storage[row.key];
      if (!one) continue;

      const node = el.storageRows.querySelector(`[data-res="${row.key}"]`);
      const capacity = one.capacity || 1;
      // Несгораемым может быть только то, что действительно лежит: на пустом
      // складе прятать нечего, хотя доля вместимости у него та же.
      const safe = Math.min(one.used, one.protectedAmount);
      const risk = Math.max(0, one.used - safe);

      node.querySelector('.bar-safe').style.width = `${((safe / capacity) * 100).toFixed(1)}%`;
      node.querySelector('.bar-risk').style.width = `${((risk / capacity) * 100).toFixed(1)}%`;
      node.querySelector('.storage-amount').textContent = `${fmt(one.used)} / ${fmt(one.capacity)}`;

      // На полном складе шахта стоит: показывать ее проектную скорость значит
      // спорить с полосой, которая уперлась в край.
      const rate = node.querySelector('.storage-rate');
      rate.textContent = one.full ? 'добыча стоит' : fmtRate(base.productionPerSecond[row.key]);
      rate.classList.toggle('stopped', Boolean(one.full));

      node.querySelector('.storage-split').textContent =
        risk > 0
          ? `в бункере ${fmt(safe)} · под грабеж ${fmt(risk)}`
          : `в бункере все ${fmt(safe)}`;

      const rowNear = !one.full && one.fill >= 0.85;
      node.classList.toggle('full', one.full);
      node.classList.toggle('near', rowNear);

      full = full || one.full;
      near = near || rowNear;

      // Та же метка уходит на строку ресурсов в шапке — адресно, на тот ресурс,
      // у которого кончилось место, а не на всю строку разом.
      const chip = el[`res${row.key[0].toUpperCase()}${row.key.slice(1)}`];
      const cell = chip ? chip.closest('.res') : null;
      if (cell) {
        cell.classList.toggle('full', one.full);
        cell.classList.toggle('near', rowNear);
      }
    }

    el.storage.classList.toggle('full', full);
    el.storage.classList.toggle('near', near);

    // Про грабеж теперь говорит каждая строка своими числами, поэтому общая
    // сноска осталась только на то, чего в строках нет, — на остановку добычи.
    const filled = STORAGE_ROWS.filter((row) => storage[row.key] && storage[row.key].full)
      .map((row) => row.label.toLowerCase());
    el.storageNote.textContent = filled.length
      ? `Склад заполнен: ${filled.join(', ')}. Добыча ${filled.length > 1 ? 'этих ресурсов остановлена' : 'этого ресурса остановлена'}.`
      : 'Место есть во всех трех хранилищах.';
  }


  /**
   * Центр управления: очереди и взятые уровни.
   *
   * Склад, недра и гарнизон показывает паспорт выше, поэтому здесь их нет —
   * список колоний повторял те же полосы теми же числами и отвечал на уже
   * отвеченный вопрос. Осталось то, чего в паспорте нет вовсе: что занято
   * работой прямо сейчас и до каких уровней доросли постройки с наукой.
   *
   * Скелеты строятся один раз на состав, значения обновляются на месте:
   * таймеры идут каждую секунду, а состав постройки и технологии не меняют.
   */
  let levelTableSignature = '';

  function renderOverview(base) {
    renderEnergyStats(base);
    renderQueueSummary(base);

    const signature =
      base.baseId +
      '#' + base.buildings.map((item) => item.type).join(',') +
      '#' + base.technologies.map((item) => item.tech).join(',');
    if (signature !== levelTableSignature) {
      levelTableSignature = signature;
      fillLevelTable(el.levelBuildings, base.buildings, (item) => item.type);
      fillLevelTable(el.levelTechs, base.technologies, (item) => item.tech);
    }

    const research = state.research && state.research.active;
    updateLevelTable(
      el.levelBuildings,
      base.buildings,
      (item) => item.type,
      base.buildJob ? base.buildJob.building : null,
      base.buildJob ? base.buildJob.targetLevel : null,
    );
    updateLevelTable(
      el.levelTechs,
      base.technologies,
      (item) => item.tech,
      research ? research.tech : null,
      research ? research.targetLevel : null,
    );
  }

  /**
   * Энергия: полоса баланса и кольцо мощности шахт.
   *
   * Четырьмя строками чисел это уже показывали, и числа были верные — только
   * читать их приходилось по очереди и складывать в голове. Вопросов к энергии
   * ровно два: хватает ли ее и не просела ли из-за нехватки добыча. Полоса
   * отвечает на первый одним взглядом, кольцо на второй.
   *
   * Выработка и потребление остались числами под полосой: полоса показывает
   * отношение, а планировать следующую шахту приходится в абсолютных величинах.
   *
   * Скелет строится один раз, значения обновляются на месте — блок
   * перерисовывается каждую секунду вместе со всем снимком.
   */
  function renderEnergyStats(base) {
    if (!el.energyStats) return;
    const energy = base.energy || { output: 0, usage: 0, efficiency: 1 };
    const free = Math.round(energy.output - energy.usage);
    const power = Math.round(energy.efficiency * 100);
    const lack = free < 0;

    if (!el.energyStats.firstChild) {
      el.energyStats.innerHTML =
        '<div class="nrg-top"><span class="nrg-label">Баланс энергии</span>' +
        '<b class="nrg-pill"></b></div>' +
        '<div class="nrg-bar"><i></i></div>' +
        '<div class="nrg-legend"><span>Потребление <b class="nrg-usage"></b></span>' +
        '<span>Выработка <b class="nrg-output"></b></span></div>' +
        '<div class="nrg-mine"><div class="nrg-ring"><span></span></div>' +
        '<div><div class="nrg-mine-title">Мощность шахт</div>' +
        '<div class="nrg-mine-note"></div></div></div>';
    }

    // Доля занятой мощности. При нулевой выработке любая нагрузка — это сто
    // процентов дефицита, иначе полоса осталась бы пустой на мертвой базе.
    const used = energy.output > 0
      ? Math.min(100, Math.round((energy.usage / energy.output) * 100))
      : energy.usage > 0 ? 100 : 0;

    el.energyStats.classList.toggle('is-lack', lack);
    el.energyStats.querySelector('.nrg-pill').textContent =
      lack ? `${free} дефицит` : `+${free} свободно`;
    el.energyStats.querySelector('.nrg-bar i').style.width = `${used}%`;
    el.energyStats.querySelector('.nrg-usage').textContent = fmt(Math.round(energy.usage));
    el.energyStats.querySelector('.nrg-output').textContent = fmt(Math.round(energy.output));

    const ring = el.energyStats.querySelector('.nrg-ring');
    ring.style.setProperty('--p', String(power));
    ring.classList.toggle('down', power < 100);
    ring.querySelector('span').textContent = `${power}%`;
    el.energyStats.querySelector('.nrg-mine-note').textContent =
      power < 100 ? 'Добыча снижена: энергии не хватает' : 'Добыча идет на полную';
  }

  function fillLevelTable(node, items, keyOf) {
    if (!node) return;
    node.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'level-row';
      row.dataset.key = keyOf(item);
      row.innerHTML = '<span class="level-name"></span><b class="level-value"></b>';
      row.querySelector('.level-name').textContent = item.label;
      node.appendChild(row);
    }
  }

  /**
   * Значения в таблице уровней.
   *
   * `busyKey` — то, над чем прямо сейчас идет работа. Отметка стоит здесь,
   * а не только в сводке очередей, потому что вопросы «до чего я дорос»
   * и «что строю» задают об одном и том же объекте: разводить их по разным
   * блокам значит заставлять сверять два списка глазами.
   */
  function updateLevelTable(node, items, keyOf, busyKey, busyTo) {
    if (!node) return;
    for (const item of items) {
      const key = keyOf(item);
      const row = node.querySelector('[data-key="' + key + '"]');
      if (!row) continue;

      const busy = Boolean(busyKey) && key === busyKey;
      const level = item.level > 0 ? String(item.level) : '—';
      row.querySelector('.level-value').textContent = busy ? level + ' → ' + busyTo : level;
      row.classList.toggle('busy', busy);
      // Не построенное показывается приглушенно, а не прячется: пустая строка
      // в списке и есть ответ на вопрос «что я еще не трогал».
      row.classList.toggle('empty', item.level === 0 && !busy);
    }
  }

  /**
   * Четыре очереди одной сводкой.
   *
   * Порознь они лежат по своим разделам, и чтобы понять, простаивает ли база,
   * приходилось обойти четыре вкладки. Свободная очередь — это не отсутствие
   * новости, а сама новость: она означает, что мощности стоят зря.
   */
  function renderQueueSummary(base) {
    if (!el.queueSummary) return;

    const research = state.research && state.research.active;
    const ship = base.shipQueue && base.shipQueue[0];
    const defense = base.defenseQueue && base.defenseQueue[0];

    const unitLeft = (job) =>
      job.nextUnitInSeconds + Math.max(0, job.remaining - 1) * job.unitSeconds;

    const rows = [
      {
        label: 'Стройка',
        text: base.buildJob
          ? base.buildJob.label + ' → ур. ' + base.buildJob.targetLevel
          : null,
        left: base.buildJob ? base.buildJob.remainingSeconds : 0,
      },
      {
        label: 'Исследование',
        text: research ? research.label + ' → ур. ' + research.targetLevel : null,
        left: research ? research.remainingSeconds : 0,
      },
      {
        label: 'Верфь',
        text: ship ? ship.label + ' · ' + ship.remaining + ' шт.' : null,
        left: ship ? unitLeft(ship) : 0,
        queued: base.shipQueue ? base.shipQueue.length - 1 : 0,
      },
      {
        label: 'Оборона',
        text: defense ? defense.label + ' · ' + defense.remaining + ' шт.' : null,
        left: defense ? unitLeft(defense) : 0,
        queued: base.defenseQueue ? base.defenseQueue.length - 1 : 0,
      },
    ];

    if (!el.queueSummary.firstChild) {
      el.queueSummary.innerHTML = rows
        .map(
          (row) =>
            '<div class="queue-line" data-queue="' + row.label + '">' +
            '<span class="queue-label">' + row.label + '</span>' +
            '<span class="queue-what"></span>' +
            '<b class="queue-left"></b></div>',
        )
        .join('');
    }

    for (const row of rows) {
      const node = el.queueSummary.querySelector('[data-queue="' + row.label + '"]');
      if (!node) continue;
      const tail = row.queued > 0 ? ' · в очереди еще ' + row.queued : '';
      node.querySelector('.queue-what').textContent = row.text ? row.text + tail : 'свободно';
      node.querySelector('.queue-left').textContent = row.text ? fmtTime(row.left) : '';
      node.classList.toggle('idle', !row.text);
    }
  }


  function renderJobBanner(node, job) {
    if (!job) {
      node.hidden = true;
      return;
    }
    node.hidden = false;

    if (!node.firstChild) {
      node.innerHTML =
        '<div class="job-title"><span></span><b></b></div>' +
        '<div class="bar"><i></i></div>' +
        '<div class="job-meta"><span></span><span></span><button type="button" class="job-rush" hidden>Ускорить</button></div>';
    }

    /*
     * Кнопка спешки живет только там, где спешка возможна. Полоса ожидания
     * одна на четыре очереди, а доделать за криптогривну пока можно лишь
     * стройку — поэтому кнопка не рисуется по умолчанию, а включается тем,
     * кто передал обработчик.
     *
     * Цену не показываем: ее считает сервер по нынешнему рынку, и между
     * показом и нажатием она успевает измениться. Отказ с точной суммой
     * придет в панель сообщений — это честнее, чем цифра, которой уже нет.
     */
    const rush = node.querySelector('.job-rush');
    rush.hidden = typeof job.onRush !== 'function';
    rush.onclick = job.onRush || null;
    const done = job.totalSeconds > 0 ? (job.totalSeconds - job.remainingSeconds) / job.totalSeconds : 1;
    const percent = Math.min(100, Math.max(0, done * 100));

    node.querySelector('.job-title span').textContent = job.title;
    node.querySelector('.job-title b').textContent = `осталось ${fmtTime(job.remainingSeconds)}`;
    node.querySelector('.bar > i').style.width = `${percent}%`;

    // Процент и полное время рядом с полосой: по одной только полосе нельзя
    // сказать, идет речь о десяти секундах или о четверти часа.
    const meta = node.querySelectorAll('.job-meta span');
    meta[0].textContent = `готово ${Math.round(percent)}%`;
    meta[1].textContent = `всего ${fmtTime(job.totalSeconds)}`;
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
        const card = createActionCard(el.buildings, building.label, '', () =>
          send(`/api/bases/${base.baseId}/build`, { type: building.type }), building.type, 'building');
        // Обложка открывает подробности, кнопка строит. Разные действия
        // на одной карточке, поэтому кликом различаются и зоны.
        card.article.classList.add('detailed');
        card.cover.tabIndex = 0;
        card.cover.setAttribute('role', 'button');
        card.cover.setAttribute('aria-label', `${building.label}: подробности`);
        const open = () => openBuildingDetail(base.baseId, building.type);
        card.cover.addEventListener('click', open);
        card.cover.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
        cards.buildings.set(building.type, card);
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

  /**
   * Строка характеристики: подпись слева, значение справа.
   *
   * Подпись — разметка, а не текст: у расхода в ней стоит значок молнии.
   * Голое «Расход» не отвечало, чего именно расход, а слово «энергии»
   * рядом не помещается — в узкой карточке под подпись отведено полсотни
   * пикселей. Подписи здесь свои, не пользовательские.
   */
  function specRow(labelHtml, value) {
    const row = document.createElement('div');
    row.className = 'spec-row';
    const term = document.createElement('dt');
    term.innerHTML = labelHtml;
    row.append(term, value);
    return row;
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

    // Строка эффекта идет без подписи: она у нее внутри — «добыча», «вместимость»,
    // «энергия». Подписывать ее второй раз значит написать слово дважды.
    const combat = document.createElement('div');
    combat.className = 'combat-line';

    /*
     * Остальные характеристики — подписанной сеткой, а не набором строк подряд.
     * Голый ряд «1 712 · 807» под иконками не говорит, цена это, запас или
     * прирост, а именно на него смотрят перед нажатием кнопки. Подпись слева,
     * значение справа, колонка подписей одной ширины у всех карточек —
     * поэтому соседние карточки сравниваются по горизонтали.
     */
    const spec = document.createElement('dl');
    spec.className = 'spec';

    const energy = document.createElement('dd');
    const energyRow = specRow(icon('energy', 'sm') + ' Расход', energy);
    energyRow.hidden = true;

    const cost = document.createElement('dd');
    cost.className = 'cost';
    const costOre = document.createElement('span');
    const costPolymers = document.createElement('span');
    const costPlasma = document.createElement('span');
    cost.append(costOre, costPolymers, costPlasma);

    const time = document.createElement('dd');
    time.className = 'time';

    // Цена — единственная строка с несколькими значениями сразу, и в узкую
    // колонку она не помещается: на телефоне «807» отрывалось на свою строку
    // и повисало без подписи. Метка помечает строку, стили разворачивают ее
    // на всю ширину там, где места мало.
    const costRow = specRow('Стоимость', cost);
    costRow.classList.add('spec-cost');
    spec.append(energyRow, costRow, specRow('Время', time));

    const reqs = document.createElement('div');
    reqs.className = 'reqs';

    article.append(header, desc, combat, spec, reqs);
    container.appendChild(article);

    return { article, cover: header, level, costOre, costPolymers, costPlasma, combat, energy, energyRow, time, reqs };
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
    // Текущий уровень и тот, что получится, — в одной метке. Раньше первый
    // стоял на обложке, второй в тексте кнопки, и связать их взглядом
    // приходилось самому.
    card.level.textContent = `Ур. ${building.level} → ${building.nextLevel}`;
    // Тем же местом, что и боевой профиль у кораблей: короткая строка эффекта.
    // Значок вместо существительного: «добыча» на карточке шахты повторяла
    // ее название и переносила строку, а чего именно столько-то — не говорила.
    const effect = building.effect;
    card.combat.innerHTML = effect
      ? (effect.icon ? icon(effect.icon, 'sm') + ' ' : '') + escapeHtml(effect.text)
      : '';

    /*
     * Расход энергии показываем всегда и у всех — даже там, где он нулевой,
     * и даже у станции, которая энергию только дает. Строка занимает место
     * в любом случае: если у одной карточки ее не будет, у нее уедут вверх
     * цена и время, и сравнивать соседние карточки станет нечем.
     *
     * Дефицит энергии режет добычу на всех шахтах разом, поэтому цена решения
     * должна быть видна до постройки, а не после того, как просел КПД.
     */
    if (card.energy) {
      const { usage, nextUsage } = building.energy;
      const grow = nextUsage - usage;
      // Оболочка карточки прячет строку по умолчанию: она есть только
      // у построек, у кораблей и техники своего расхода нет.
      card.energyRow.hidden = false;
      card.energy.innerHTML =
        nextUsage <= 0
          ? '<span class="muted">нет</span>'
          : `<span>${fmtEnergy(usage)} → ${fmtEnergy(nextUsage)}</span>` +
            (grow > 0 ? ` <span class="grow">+${fmtEnergy(grow)}</span>` : '');
    }
    fillCost(card, building.cost, base.resources);
    card.time.textContent = fmtTime(building.seconds);
    fillRequirements(card, building.requirements);

    const locked = building.requirements.length > 0;
    card.article.classList.toggle('locked', locked);
    card.article.classList.toggle('built', building.level > 0);
    card.button.disabled = locked || building.busy || !building.canAfford;
    // Целевой уровень уехал в метку на обложке, поэтому кнопка называет
    // только действие: на узкой карточке она иначе переносится в две строки.
    card.button.textContent = building.busy
      ? 'Идет стройка'
      : building.level === 0
        ? 'Построить'
        : 'Улучшить';
  }

  function updateTechCard(card, base, tech) {
    if (!card) return;
    card.level.textContent = `Ур. ${tech.level} → ${tech.nextLevel}`;
    fillCost(card, tech.cost, base.resources);
    card.time.textContent = fmtTime(tech.seconds);
    fillRequirements(card, tech.requirements);

    const locked = tech.requirements.length > 0;
    card.article.classList.toggle('locked', locked);
    card.button.disabled = locked || tech.busy || !tech.canAfford;
    card.button.textContent = tech.busy ? 'Лаборатория занята' : 'Изучить';
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
    card.time.textContent = `${fmtTime(ship.unitSeconds)} за штуку`;
    fillRequirements(card, ship.requirements);

    const locked = ship.requirements.length > 0;
    card.article.classList.toggle('locked', locked);
    card.button.disabled = locked || !ship.canAfford;
    card.quantity.disabled = locked;
  }

  /**
   * Ангар верфи и позиции обороны: что у нас есть и на что оно способно.
   *
   * Отличается от гарнизона в паспорте колонии намеренно. Паспорт отвечает
   * «сколько чего стоит на планете» и потому идет узкой ведомостью; здесь
   * игрок решает, что строить дальше, и ему нужны сами характеристики —
   * профиль единицы и то, что этот класс дает флоту в сумме.
   *
   * Перерисовывается только при изменении состава: пересобирать картинки
   * каждую секунду значит каждую секунду заново дергать их загрузку.
   */
  function renderRoster(node, cards, counts, keyRef, emptyText) {
    const signature = cards.map((card) => `${card.type}:${counts[card.type] || 0}`).join('|');
    if (keyRef.value === signature) return;
    keyRef.value = signature;

    node.innerHTML = '';
    const owned = cards.filter((card) => (counts[card.type] || 0) > 0);

    if (!owned.length) {
      const empty = document.createElement('p');
      empty.className = 'roster-empty';
      empty.textContent = emptyText;
      node.appendChild(empty);
      return;
    }

    for (const card of owned) {
      const count = counts[card.type] || 0;
      const combat = card.combat || { attack: 0, shield: 0, hull: 0, note: null };
      // Суммарные числа класса: одиночная атака 15 ничего не говорит, а «залп
      // 75 по всем пяти» сразу сравнимо с обороной цели в отчете разведки.
      const salvo = combat.attack * count;
      const endurance = (combat.shield + combat.hull) * count;

      const unit = document.createElement('article');
      unit.className = 'roster-unit';
      unit.appendChild(artNode(card.type, card.label, card.kind, 'art-tile'));

      const body = document.createElement('div');
      body.className = 'roster-body';
      body.innerHTML =
        `<span class="roster-head">${escapeHtml(card.label)}<b>×${fmt(count)}</b></span>` +
        '<span class="roster-stats">' +
        `<span><i>атака</i>${fmt(combat.attack)}</span>` +
        `<span><i>щит</i>${fmt(combat.shield)}</span>` +
        `<span><i>корпус</i>${fmt(combat.hull)}</span>` +
        '</span>' +
        `<span class="roster-total">залп <b>${fmt(salvo)}</b> · живучесть <b>${fmt(endurance)}</b></span>` +
        (combat.note ? `<span class="roster-note">${escapeHtml(combat.note)}</span>` : '');
      unit.appendChild(body);
      node.appendChild(unit);
    }
  }

  const rosterKeys = { fleet: { value: null }, defense: { value: null } };

  function renderFleet(base) {
    renderRoster(
      el.fleet,
      base.ships.map((ship) => ({ ...ship, kind: 'ship' })),
      base.fleet,
      rosterKeys.fleet,
      'В ангаре пусто. Построй первый корабль ниже.',
    );
  }

  /**
   * Очередь верфи или обороны. Раньше это была строка текста «осталось 1 из 1»,
   * и понять, сколько ждать, можно было только у первого заказа. Теперь у
   * каждого заказа полоса и полное время до конца — тот же вид, что у стройки
   * и исследования, чтобы четыре разных ожидания читались одинаково.
   *
   * Полоса первого заказа показывает текущую единицу, остальные ждут своей
   * очереди и стоят на нуле: верфь собирает заказы подряд, а не разом.
   */
  function renderUnitQueue(node, jobs, emptyText) {
    node.innerHTML = '';
    if (!jobs.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = emptyText;
      node.appendChild(empty);
      return;
    }

    let waitBefore = 0;
    jobs.forEach((job, index) => {
      const done = job.quantity - job.remaining;
      // Время до конца заказа: текущая единица плюс оставшиеся целиком.
      // Для заказов из хвоста очереди к этому добавляется ожидание предыдущих.
      const ownSeconds = index === 0
        ? job.nextUnitInSeconds + Math.max(0, job.remaining - 1) * job.unitSeconds
        : job.remaining * job.unitSeconds;
      const totalSeconds = waitBefore + ownSeconds;
      waitBefore = totalSeconds;

      const unitDone = index === 0 && job.unitSeconds > 0
        ? (job.unitSeconds - job.nextUnitInSeconds) / job.unitSeconds
        : 0;
      // Полоса меряет заказ целиком: собранные единицы плюс доля текущей.
      const progress = job.quantity > 0 ? (done + unitDone) / job.quantity : 0;

      const item = document.createElement('div');
      item.className = `job-banner${index === 0 ? '' : ' queued'}`;
      item.innerHTML =
        `<div class="job-title"><span>${escapeHtml(job.label)} · ${job.quantity} шт.</span>` +
        `<b>${index === 0 ? 'осталось ' : 'готово через '}${fmtTime(totalSeconds)}</b></div>` +
        '<div class="bar"><i></i></div>' +
        `<div class="job-meta"><span>собрано ${done} из ${job.quantity}</span>` +
        `<span>${index === 0 ? `выпуск через ${fmtTime(job.nextUnitInSeconds)}` : 'ждет очереди'} · по ${fmtTime(job.unitSeconds)} за штуку</span></div>`;
      item.querySelector('.bar > i').style.width = `${Math.min(100, Math.max(0, progress * 100)).toFixed(1)}%`;
      node.appendChild(item);
    });
  }

  function renderQueue(base) {
    renderUnitQueue(el.shipQueue, base.shipQueue, 'Очередь верфи пуста');
  }

  /* ------------------------- Подробности постройки ------------------------- */

  /*
   * Таблица на десять уровней вперед. Приросты в ней считаются от текущего
   * уровня, а не от предыдущей строки: игрок решает «стоит ли идти на три
   * уровня вверх», и ему нужен итог этого решения целиком, а не разница
   * между двумя одинаково гипотетическими будущими.
   *
   * Данные приходят отдельным запросом, а не в снимке: снимок уходит каждую
   * секунду, а таблица нужна, только пока карточка открыта.
   */
  async function openBuildingDetail(baseId, type) {
    el.detailScrim.hidden = false;
    el.detailBody.innerHTML = '<p class="detail-note">Считаю…</p>';
    el.detailTitle.textContent = '';
    el.detailLevel.textContent = '';
    el.detailDesc.textContent = '';
    el.detailArt.innerHTML = '';
    el.detailClose.focus();

    const { ok, data } = await api(`/api/bases/${baseId}/buildings/${type}`);
    // Панель могли закрыть, пока считался ответ, — тогда рисовать нечего.
    if (el.detailScrim.hidden) return;
    if (!ok) {
      el.detailBody.innerHTML = `<p class="detail-note">${data.error || 'Не удалось загрузить'}</p>`;
      return;
    }

    el.detailTitle.textContent = data.label;
    el.detailLevel.textContent =
      data.level > 0 ? `Сейчас уровень ${data.level}` : 'Еще не построено';
    el.detailDesc.textContent = data.description;
    el.detailArt.appendChild(artNode(data.type, data.label, 'building'));
    el.detailBody.innerHTML = detailTable(data);
  }

  function detailTable(data) {
    const showOutput = data.outputLabel !== null;
    const head =
      '<tr><th>Уровень</th>' +
      (showOutput ? `<th>${data.outputLabel}</th><th>прирост</th>` : '') +
      '<th>энергия</th><th>прирост</th><th>цена</th><th>время</th></tr>';

    const rows = data.rows
      .map((row, index) => {
        // У текущего уровня цены и срока нет: он уже построен и уже оплачен.
        const cost = row.cost
          ? [
              row.cost.ore ? `${icon('ore', 'sm')} ${fmt(row.cost.ore)}` : '',
              row.cost.polymers ? `${icon('polymers', 'sm')} ${fmt(row.cost.polymers)}` : '',
              row.cost.plasma ? `${icon('plasma', 'sm')} ${fmt(row.cost.plasma)}` : '',
            ]
              .filter(Boolean)
              .join(' ') || '—'
          : '—';

        const output = showOutput
          ? `<td>${fmt(row.output)}</td><td class="gain">${row.outputGain > 0 ? '+' + fmt(row.outputGain) : '—'}</td>`
          : '';

        // Текущий уровень помечен, следующий подсвечен: это две разные вещи —
        // «где я сейчас» и «что я строю кнопкой на карточке».
        const marks = [row.current ? 'current' : '', index === 1 ? 'next' : ''].filter(Boolean);
        const levelCell = row.current
          ? `${row.level} <span class="badge-now">сейчас</span>`
          : String(row.level);

        return (
          `<tr class="${marks.join(' ')}">` +
          `<td>${levelCell}</td>` +
          output +
          `<td>${fmtEnergy(row.energy)}</td>` +
          `<td class="drain">${row.energyGain > 0 ? '+' + fmtEnergy(row.energyGain) : '—'}</td>` +
          `<td>${cost}</td><td>${row.seconds === null ? '—' : fmtTime(row.seconds)}</td></tr>`
        );
      })
      .join('');

    return (
      `<div class="detail-scroll"><table class="detail-table"><thead>${head}</thead><tbody>${rows}</tbody></table></div>` +
      '<p class="detail-note">Приросты показаны относительно текущего уровня, а не предыдущей строки: ' +
      'так видно итог всего скачка, а не шаг между двумя будущими.</p>'
    );
  }

  function closeBuildingDetail() {
    el.detailScrim.hidden = true;
    el.detailBody.innerHTML = '';
  }

  el.detailClose.addEventListener('click', closeBuildingDetail);
  // Клик мимо панели закрывает ее — так же, как затемнение под меню на телефоне.
  el.detailScrim.addEventListener('click', (event) => {
    if (event.target === el.detailScrim) closeBuildingDetail();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.detailScrim.hidden) closeBuildingDetail();
  });

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

  /*
   * Видимый размер планеты по типу.
   *
   * Это не только украшение: газовый гигант дает больше всего ресурсов, скалистый
   * огрызок — меньше всего, и по карте это должно читаться до всякой разведки.
   * Множитель к базовому радиусу, а не абсолютный размер: геометрия карты
   * подстраивается под число орбит, и жесткие пиксели ее сломали бы.
   */
  const PLANET_BASE_RADIUS = 26;

  const PLANET_SCALE = {
    GAS_GIANT: 1.45,
    OCEANIC: 1.1,
    VOLCANIC: 1.0,
    ICE: 1.0,
    DESERT: 0.95,
    TOXIC: 0.85,
    ROCKY: 0.75,
  };

  /*
   * Насколько картинка крупнее круга обрезки — чтобы черный фон не давал каймы.
   *
   * Значения разные, потому что арт нарисован по-разному: у одних планет диск
   * доходит до края кадра, у других вокруг него остается черное поле, и общий
   * множитель либо оставил бы кайму, либо срезал планету. Числа сняты с самих
   * файлов перебором: для каждого арта взято увеличение, при котором по краю
   * круга остается меньше всего черного. Заменили арт — стоит перемерить.
   */
  const PLANET_ZOOM = {
    terran: 1.2,
    ice: 1.35,
    lava: 1.1,
    desert: 1.2,
    rocky: 1.2,
    gas_giant: 1.6,
    toxic: 1.25,
  };
  const PLANET_ZOOM_DEFAULT = 1.15;

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
    starRadius: 46,
    /** Первая орбита ложится сразу за разлетом короны. */
    firstOrbit: 122,
    /** Хаб висит на своем кольце между звездой и планетами. */
    hubOrbit: 104,
    /** Система с хабом отодвигает планеты, чтобы станция не села на орбиту. */
    hubClearance: 38,
    /** Дальше орбиты не уходят: снаружи подписи и точка глубокого космоса. */
    lastOrbit: 322,
    /** Желаемый зазор между орбитами; ужимается, когда планет много. */
    orbitStep: 62,
    deepOrbit: 356,
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
    /** Выбранное действие. Пустое, пока цель не выбрана и меню не собрано. */
    mission: '',
  };

  /* Меню действий пересобирается только при смене набора или выбора. */
  let missionMenuSignature = '';

  /*
   * Что можно сделать с целью. Планета дает три разных набора, и решает это
   * не наличие владельца, а поле `colonized`: у неразведанной планеты владелец
   * скрыт туманом войны, и пустой владелец там не значит «свободна».
   */
  const MISSION_OPTIONS = {
    /* Своя колония: атаковать себя нельзя, зато можно перебросить туда флот. */
    OWN_PLANET: [['TRANSPORT', 'Транспортировка'], ['DEPLOY', 'Дислокация']],
    /* Чужая колония. Порядок как у игрока в голове: напасть, помочь, посмотреть. */
    ENEMY_PLANET: [
      ['ATTACK', 'Атака'],
      ['TRANSPORT', 'Отправить груз или помощь'],
      ['SCAN', 'Шпионить зондом'],
    ],
    /*
     * Необитаемая планета. Ни транспорт, ни атака здесь невозможны — сервер
     * отвечает на них отказом, и держать в списке заведомо мертвые пункты
     * значит учить игрока, что интерфейс врет. Остается разведка, а к ней
     * ниже добавляется колонизация, если в составе есть основатель.
     */
    FREE_PLANET: [['SCAN', 'Разведка зондом']],
    /*
     * Планета не разведана: заселена она или нет — неизвестно. Здесь пункты
     * не мертвые, а именно неизвестные, и убирать их нельзя: игрок может знать
     * о планете от союзника. Сервер откажет, если догадка не подтвердится.
     */
    UNKNOWN_PLANET: [
      ['SCAN', 'Разведка зондом'],
      ['ATTACK', 'Атака'],
      ['TRANSPORT', 'Отправить груз или помощь'],
    ],
    HUB: [['HUB_DELIVERY', 'Доставка на хаб'], ['HUB_PICKUP', 'Вывоз с хаба']],
    DEEP_SPACE: [['EXPEDITION', 'Экспедиция']],
  };

  /*
   * Чем подставляется выбор, когда прежнее действие стало недоступно.
   * Не первым пунктом списка: у чужой колонии первая — атака, а она объявляет
   * войну, и подставлять ее молча нельзя. Разведка ничего не разрушает.
   */
  const SAFE_DEFAULT_MISSIONS = ['SCAN', 'TRANSPORT', 'HUB_DELIVERY', 'EXPEDITION'];

  /** Самая дальняя занятая орбита — по ней раскладываются остальные. */
  function maxPosition() {
    const positions = (map.data?.planets ?? []).map((planet) => planet.position);
    return positions.length ? Math.max(...positions) : 1;
  }

  /** Первая орбита: в системе с хабом она отодвинута за его кольцо. */
  function firstOrbit() {
    return MAP.firstOrbit + (map.data && map.data.hub ? MAP.hubClearance : 0);
  }

  /**
   * Зазор между орбитами.
   *
   * Раньше орбиты всегда растягивались до внешнего края, и система из трех планет
   * занимала столько же места, сколько из десяти. Теперь шаг фиксированный, пока
   * планеты помещаются, и ужимается, только когда их много: тесная система
   * выглядит тесной, просторная — просторной.
   */
  function orbitStep() {
    const last = maxPosition();
    if (last <= 1) return 0;
    const room = (MAP.lastOrbit - firstOrbit()) / (last - 1);
    return Math.min(MAP.orbitStep, room);
  }

  function orbitRadius(position) {
    return firstOrbit() + (position - 1) * orbitStep();
  }

  /**
   * Поправка к размеру планет при тесных орбитах.
   *
   * Соседние позиции разведены по углу, поэтому в системе из трех планет они
   * далеко друг от друга даже на соседних кольцах, а в системе из десяти —
   * рядом. Считаем реальное расстояние между центрами соседей и, если крупные
   * тела в него не влезают, ужимаем все планеты разом: пропорции типов
   * сохраняются, а слипаться им нечем.
   */
  function planetSquash() {
    const last = maxPosition();
    if (last <= 1) return 1;

    const first = firstOrbit();
    const step = orbitStep();
    const delta = (2 * Math.PI) / last;
    // Худший случай — самые внутренние кольца: там дуга между соседями короче.
    const near = Math.sqrt(
      first * first + (first + step) * (first + step) -
      2 * first * (first + step) * Math.cos(delta),
    );

    const biggest = PLANET_BASE_RADIUS * Math.max(...Object.values(PLANET_SCALE));
    const needed = biggest * 2 + 18;
    return Math.min(1, near / needed);
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
  /** Станция мельче планет: она висит в тесном кольце у самой звезды. */
  const HUB_RADIUS = 20;
  const DEEP_SPACE_ANGLE = (52 * Math.PI) / 180;

  function hubPoint() {
    return polar(MAP.hubOrbit, HUB_ANGLE);
  }

  function deepSpacePoint() {
    return polar(MAP.deepOrbit, DEEP_SPACE_ANGLE);
  }

  /*
    * Карта системы. Без аргумента — своя, с systemId — чужая: маршрут это умел
    * с самого начала, просто клиент никогда не спрашивал.
    *
    * Ответы нумеруются, потому что запросов бывает два разом. Переход к планете
    * из письма открывает раздел карты, а тот сам просит свою систему — и ее
    * ответ, придя вторым, затер бы уже показанную чужую.
    */
  let mapRequest = 0;

  async function loadMap(systemId) {
    const ticket = ++mapRequest;
    const url = systemId ? `/api/map?systemId=${encodeURIComponent(systemId)}` : '/api/map';
    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) return;
    const data = await response.json();
    if (ticket !== mapRequest) return;
    map.data = data;
    renderMap();
    renderPlanetInfo();
    updateMapCaption();
  }

  /**
   * Координаты планеты из нагрузки письма.
   *
   * Нагрузка — данные из прошлого (правило 9): у писем, отправленных до
   * появления координат, их нет вовсе, и форма у разных отчетов разная.
   * Боевой отчет кладет их в `location`, колонизация — прямо в корень.
   * Ничего не нашли — кнопки просто не будет.
   */
  function mailPlanetTarget(payload) {
    for (const source of [payload && payload.location, payload]) {
      if (!source) continue;
      const x = Number(source.galaxyX);
      const y = Number(source.galaxyY);
      const position = Number(source.position);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(position)) {
        return { galaxyX: x, galaxyY: y, position };
      }
    }
    return null;
  }

  /** Переход к планете из письма: открыть ее систему и навести на нее форму. */
  async function openPlanetFromMail(target) {
    el.coordInput.value = `${target.galaxyX}:${target.galaxyY}:${target.position}`;
    await lookupCoords();
    showPanel('map');
    const systemId = map.coordTarget && map.coordTarget.systemId;
    if (systemId) await loadMap(systemId);
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
   * Диск на арте не всегда дотягивается до края кадра, и тогда между ним и
   * линией обрезки остается черное кольцо. Поэтому картинка дается крупнее
   * круга (`zoom`): лишнее срезается, а фон уходит за границу целиком.
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
    const {
      fill, opacity = 1, src, clipId, kind = 'solid', spread = 1, zoom = 1, mask = 'glowFade',
    } = options;

    group.appendChild(svgEl('circle', {
      class: `body${kind === 'glow' ? ' glow-body' : ''}`, cx, cy, r: radius, fill, opacity,
    }));
    if (!src) return;

    const glow = kind === 'glow';
    const half = radius * (glow ? spread : zoom);

    const image = svgEl('image', {
      class: glow ? 'body-art glow' : 'body-art',
      x: cx - half,
      y: cy - half,
      width: half * 2,
      height: half * 2,
      preserveAspectRatio: 'xMidYMid slice',
    });

    if (glow) {
      image.setAttribute('mask', `url(#${mask})`);
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

  /**
   * Мягкий круглый спад по краю светящегося тела.
   *
   * Режим `screen` убирает черный фон картинки, но яркое содержимое, доходящее
   * до края кадра, все равно обрывалось бы прямой линией — маска растворяет его
   * вместо обрезки. Объявление отдается каждой карте свое: ссылка `url(#glowFade)`
   * ищется в том же SVG, и общая разметка соседней карты ей не видна.
   */
  function glowFadeDefs() {
    const defs = svgEl('defs');
    defs.innerHTML =
      '<radialGradient id="glowFadeGrad">' +
      '<stop offset="52%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/>' +
      '</radialGradient>' +
      '<mask id="glowFade" maskContentUnits="objectBoundingBox">' +
      '<rect width="1" height="1" fill="url(#glowFadeGrad)"/></mask>' +
      /*
       * Жесткий вариант для миниатюр галактик. У части арта содержимое доходит
       * до самых углов кадра, и мягкого спада по краю мало: под `screen`
       * светится вся картинка целиком, и от нее остается квадрат. Здесь маска
       * закрывает всё за серединой картинки, то есть наружная половина арта
       * не рисуется вовсе — видно только светлую сердцевину.
       */
      '<radialGradient id="glowCropGrad">' +
      '<stop offset="28%" stop-color="#fff"/><stop offset="53%" stop-color="#000"/>' +
      '</radialGradient>' +
      '<mask id="glowCrop" maskContentUnits="objectBoundingBox">' +
      '<rect width="1" height="1" fill="url(#glowCropGrad)"/></mask>';
    return defs;
  }

  function renderMap() {
    if (!map.data) return;
    const svg = el.systemMap;
    svg.innerHTML = '';

    svg.appendChild(glowFadeDefs());

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

      // Размер зависит от типа, а не от разведанности: величина планеты видна
      // в телескоп, для этого зонд не нужен. Туман войны гасит ее цветом.
      const radius = Math.round(
        PLANET_BASE_RADIUS * (PLANET_SCALE[planet.type] || 1) * planetSquash(),
      );

      // Пунктирное кольцо обломков — под телом планеты, чтобы не перекрывать его.
      if (planet.debris && planet.debris.ore + planet.debris.polymers > 0) {
        group.appendChild(svgEl('circle', {
          class: 'debris-ring', cx: x, cy: y, r: radius + 12,
        }));
      }

      // Картинка привязана к биому планеты, а не к номеру орбиты: ледяной мир
      // должен выглядеть ледяным в любой системе.
      const art = PLANET_ART[planet.type] || planet.type.toLowerCase();

      celestialBody(group, x, y, radius, {
        kind: 'solid',
        fill: planet.visibility === 'UNKNOWN' ? '#3a4360' : (PLANET_COLORS[planet.type] || '#7f8db5'),
        opacity: planet.visibility === 'UNKNOWN' ? 0.55 : 1,
        src: `/assets/planets/${art}.webp`,
        clipId: `clip-planet-${planet.planetId}`,
        zoom: PLANET_ZOOM[art] ?? PLANET_ZOOM_DEFAULT,
      });

      // Подпись строго под телом и по центру: арт остается чистым, а текст
      // не наезжает на соседей. «Вниз» здесь безопасно — первая орбита (168)
      // далеко от звезды (радиус 58), и подпись до нее не достает.
      const labelY = y + radius + 17;

      const label = svgEl('text', {
        x, y: labelY, class: `planet-label name${planet.isOwn ? ' own' : ''}`,
      });
      label.textContent = planet.name;
      group.appendChild(label);

      const status = svgEl('text', { x, y: labelY + 15, class: 'planet-label' });
      status.textContent = planet.visibility === 'UNKNOWN' ? 'нет данных' :
        planet.colonized ? (planet.isOwn ? 'ваша колония' : `колония: ${planet.owner}`) : 'необитаема';
      group.appendChild(status);

      /*
       * Маркер принадлежности — точка под подписью, а не кольцо вокруг планеты.
       * Кольцо спорило с самим артом и съедало место между орбитами; точка
       * читается так же однозначно и ничего не перекрывает.
       */
      if (planet.colonized) {
        group.appendChild(svgEl('circle', {
          class: `colony-dot${planet.isOwn ? ' own' : ''}`,
          cx: x, cy: labelY + 24, r: 3,
        }));
      }

      group.addEventListener('mouseenter', () => showTooltip(planet, x, y, radius));
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

    /*
     * Под картинкой пусто. Раньше здесь лежал нарисованный градиентом диск —
     * желтая корона у звезды и фиолетовый ореол у дыры, — и он просвечивал
     * из-под арта, споря с ним и цветом, и краем. Свечение целиком дает сама
     * картинка через `screen`.
     */
    celestialBody(group, MAP.center, MAP.center, MAP.starRadius, {
      kind: 'glow',
      fill: 'transparent',
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

    group.addEventListener('mouseenter', () => showStarTooltip(hole));
    group.addEventListener('mouseleave', hideTooltip);
    svg.appendChild(group);
  }

  /*
   * Температура по классу звезды. Значения — обычные для спектральных классов
   * порядки, они дают почувствовать разницу между тусклым красным карликом
   * и голубым гигантом. У черной дыры температуры нет: измерять нечего.
   */
  const STAR_TEMPERATURE = {
    BLUE: '~10 000 K',
    WHITE: '~7 500 K',
    YELLOW: '~5 700 K',
    ORANGE: '~4 500 K',
    RED: '~3 200 K',
  };

  const STAR_CLASS_LABELS = {
    BLUE: 'голубая',
    WHITE: 'белая',
    YELLOW: 'желтая',
    ORANGE: 'оранжевая',
    RED: 'красная',
  };

  function showStarTooltip(hole) {
    const data = map.data;
    const klass = hole
      ? 'черная дыра'
      : `${STAR_CLASS_LABELS[data.starClass] || ''} (${data.starClass})`.trim();

    tipContent(
      `<div class="pd-head"><b>${escapeHtml(data.systemName)}</b>` +
      `<span>центр системы</span></div>` +
      pdSection('светило', [
        pdCell('класс', escapeHtml(klass), 'wide'),
        pdCell('температура', hole ? 'неизвестна' : (STAR_TEMPERATURE[data.starClass] || 'неизвестна')),
        pdCell('планет', data.planets.length),
      ]) +
      (hole
        ? '<div class="pd-note unknown">Искажение времени: синтез антиматерии +50%, ' +
          'стройка и наука на 30% дольше.</div>'
        : ''),
    );
    anchorTooltip(el.systemMap, MAP.center, MAP.center, MAP.starRadius);
  }

  /** Точка выхода в глубокий космос: своя орбита за внешним кольцом системы. */
  function renderDeepSpace() {
    const svg = el.systemMap;
    const { x, y } = deepSpacePoint();

    const group = svgEl('g', {
      class: `planet-dot${map.selectedKind === 'DEEP_SPACE' ? ' selected' : ''}`,
    });
    // Пунктирного кольца нет намеренно: у туманности нет края, и рамка вокруг
    // свечения выглядела чертежом поверх картинки. Кликабельную площадь дает
    // прозрачный круг под ней.
    group.appendChild(svgEl('circle', {
      class: 'hit-area', cx: x, cy: y, r: DEEP_SPACE_RADIUS * DEEP_SPACE_SPREAD * 0.8,
    }));
    celestialBody(group, x, y, DEEP_SPACE_RADIUS, {
      kind: 'glow',
      fill: 'transparent',
      src: '/assets/planets/deep_space.webp',
      spread: DEEP_SPACE_SPREAD,
    });

    // Подпись под туманностью, но ниже ее разлета: свечение уходит далеко за
    // логический радиус, и текст вплотную к нему просто тонул бы в нем.
    const labelY = y + DEEP_SPACE_RADIUS * DEEP_SPACE_SPREAD * 0.75 + 16;

    const label = svgEl('text', { x, y: labelY, class: 'planet-label name' });
    label.textContent = 'Глубокий космос';
    group.appendChild(label);

    const position = svgEl('text', { x, y: labelY + 15, class: 'planet-label' });
    position.textContent = 'позиция 16';
    group.appendChild(position);

    group.addEventListener('mouseenter', () => {
      tipContent(
        '<div class="pd-head"><b>Глубокий космос</b>' +
        '<span>16-я позиция · точка экспедиций</span></div>' +
        '<div class="pd-note unknown">Что там — неизвестно до прилета.</div>',
      );
      anchorTooltip(el.systemMap, x, y, DEEP_SPACE_RADIUS);
    });
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
    /*
     * Станция — светящееся тело, как звезда и туманность: черный фон картинки
     * растворяется режимом `screen`, обрезки нет. Под картинкой остается
     * тусклый круг — он же заглушка, пока файла нет.
     */
    celestialBody(group, x, y, HUB_RADIUS, {
      kind: 'glow',
      fill: 'rgba(126, 231, 135, 0.14)',
      src: '/assets/planets/hub.webp',
      spread: 1.6,
    });

    // На карте оставлено только название: содержимое склада — длинная строка,
    // которая в тесном центре наезжала на сам хаб. Цифры и так есть в тултипе
    // и в панели справа, и там их можно показать с иконками, чего SVG-текст
    // не умеет в принципе.
    const label = svgEl('text', {
      x, y: y + HUB_RADIUS + 16, class: 'planet-label name hub-label',
    });
    label.textContent = hub.name;
    group.appendChild(label);

    group.addEventListener('mouseenter', () => showHubTooltip(hub, x, y));
    group.addEventListener('mouseleave', hideTooltip);
    group.addEventListener('click', () => selectHub(hub));
    svg.appendChild(group);
  }

  function showHubTooltip(hub, x, y) {
    const head =
      `<div class="pd-head"><b>${escapeHtml(hub.name)}</b>` +
      `<span>нейтральная станция · орбита ${hub.position}</span></div>`;

    tipContent(
      hub.storage
        ? head +
          pdSection('твой склад', [
            pdCell(icon('ore', 'sm'), fmt(hub.storage.ore)),
            pdCell(icon('polymers', 'sm'), fmt(hub.storage.polymers)),
            pdCell('занято', `${fmt(hub.storage.ore + hub.storage.polymers)} / ${fmt(hub.storage.capacity)}`, 'wide'),
          ])
        : head + '<div class="pd-note">склада на станции пока нет</div>',
    );
    anchorTooltip(el.systemMap, x, y, HUB_RADIUS);
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

  /** Длина линии HUD от тела до панели, экранные пиксели. */
  const TIP_LINE = 34;

  function tipContent(html) {
    el.mapTooltip.innerHTML = `<div class="tip-body">${html}</div>`;
  }

  function showTooltip(planet, x, y, radius) {
    map.hoverId = planet.planetId;
    tipContent(planetDetailsHtml(planet, true));
    anchorTooltip(el.systemMap, x, y, radius);
  }

  /**
   * Привязка тултипа к телу на карте системы.
   *
   * За курсором панель не следует намеренно: линия HUD должна выходить из самой
   * планеты, а не из случайной точки под мышью — иначе эффект разваливается,
   * стоит шевельнуть рукой. Координаты переводим матрицей самого SVG, поэтому
   * привязка не зависит от того, как карта отмасштабирована под ширину экрана.
   */
  function anchorTooltip(svg, svgX, svgY, svgRadius) {
    // Карта системы и карта галактики — разные SVG со своим масштабом,
    // поэтому матрицу берем у того, на котором висит тело.
    const ctm = svg.getScreenCTM();
    if (!ctm) return;

    const canvas = el.mapCanvas.getBoundingClientRect();
    const point = new DOMPoint(svgX, svgY).matrixTransform(ctm);
    const x = point.x - canvas.left;
    const y = point.y - canvas.top;
    const radius = svgRadius * ctm.a;

    const tip = el.mapTooltip;
    tip.classList.add('anchored');
    tip.classList.remove('flip');
    tip.hidden = false;

    // Размеры читаем уже показанной панели: у скрытой они нулевые.
    let left = x + radius + TIP_LINE;
    if (left + tip.offsetWidth > canvas.width - 8) {
      left = x - radius - TIP_LINE - tip.offsetWidth;
      tip.classList.add('flip');
    }

    const top = Math.min(
      Math.max(8, y - 28),
      Math.max(8, canvas.height - tip.offsetHeight - 8),
    );
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${top}px`;

    // Перезапуск анимации: без сброса класса повторное наведение на соседнее
    // тело показало бы панель без линии.
    tip.classList.remove('playing');
    void tip.offsetWidth;
    tip.classList.add('playing');
  }

  function hideTooltip() {
    map.hoverId = null;
    el.mapTooltip.hidden = true;
    el.mapTooltip.classList.remove('playing');
  }

  /* ---------- Карточка планеты ---------- */

  /** Ячейка сетки: подпись сверху, значение снизу. */
  function pdCell(key, value, extra = '') {
    return (
      `<div class="pd-cell${extra ? ' ' + extra : ''}">` +
      `<span class="k">${key}</span><span class="v">${value}</span></div>`
    );
  }

  function pdSection(title, cells) {
    if (!cells.length) return '';
    return `<div class="pd-section"><h5>${title}</h5><div class="pd-grid">${cells.join('')}</div></div>`;
  }

  /**
   * Карточка планеты для тултипа и боковой панели.
   *
   * Раньше это был длинный столбец строк: в тултипе он растягивался вниз на
   * пол-карты и переставал читаться. Теперь цифры разложены по сетке — колонки
   * подбирает CSS, поэтому одна и та же разметка works и в узкой панели справа,
   * и в широком тултипе.
   */
  function planetDetailsHtml(planet, short) {
    const type = PLANET_TYPES[planet.type] || planet.type;
    const head =
      `<div class="pd-head"><b>${escapeHtml(planet.name)}</b>` +
      `<span>орбита ${planet.position} · ${escapeHtml(type)} · слотов ${planet.size}</span></div>`;

    // Обломки светятся на радарах: их видно и по неразведанной планете,
    // поэтому строка идет до проверки на туман войны.
    const debris = debrisHtml(planet);

    if (planet.visibility === 'UNKNOWN') {
      return (
        head + debris +
        '<div class="pd-note unknown">Данных нет. Отправь зонд для сканирования.</div>'
      );
    }

    const owner = planet.colonized
      ? planet.isOwn
        ? '<div class="pd-owner own">ваша колония</div>'
        : `<div class="pd-owner foe">владелец: <b>${escapeHtml(planet.owner || 'неизвестен')}</b></div>`
      : '<div class="pd-owner">колонии нет</div>';

    const rich = planet.richness
      ? pdSection('богатство', [
          pdCell(icon('ore', 'sm'), `×${planet.richness.ore}`),
          pdCell(icon('polymers', 'sm'), `×${planet.richness.polymers}`),
          pdCell(icon('plasma', 'sm'), `×${planet.richness.plasma}`),
          pdCell(icon('antimatter', 'sm'), `×${planet.richness.antimatter}`),
        ])
      : '';

    // В тултипе постройки не показываем: это самая статичная часть карточки,
    // а высота панели при наведении — дефицит. Полный разбор ждет в панели справа.
    const buildings = planet.buildings && !short
      ? pdSection('постройки', [
          pdCell('шахты', `${planet.buildings.ORE_MINE}/${planet.buildings.POLYMER_PLANT}/${planet.buildings.PLASMA_REACTOR}`),
          pdCell('лаб', planet.buildings.SCIENCE_CENTER),
          pdCell('верфь', planet.buildings.SHIPYARD),
          pdCell('склад', planet.buildings.STORAGE),
        ])
      : '';

    // Флот и склад меняются быстро: после суток сервер их уже не отдает,
    // и показывать нечего — вместо цифр честные «???».
    const unknown = '<span class="unknown-value">???</span>';

    /*
     * Устаревший снимок прячет склад, флот и оборону разом. Раньше на это уходило
     * три блока с одинаковым «???» — почти двести пикселей, повторяющих то,
     * что и так написано строкой о возрасте разведки. Теперь строка одна.
     */
    const hidden = planet.colonized && planet.staleHidden;

    /*
     * Ступень «Шпионажа» решает, разбирать ли по типам или показывать числом.
     * Общее количество — не полуправда, а отдельный по смыслу ответ: «сорок
     * вымпелов, классы неизвестны» говорит о цели больше, чем пустое место,
     * и меньше, чем разбор по классам. Поэтому у него своя подпись.
     */
    const resources = planet.colonized && planet.resources
      ? pdSection('склад', [
          pdCell(icon('ore', 'sm'), fmt(planet.resources.ore)),
          pdCell(icon('polymers', 'sm'), fmt(planet.resources.polymers)),
          pdCell(icon('plasma', 'sm'), fmt(planet.resources.plasma)),
        ])
      : planet.colonized && planet.resourcesTotal !== null && planet.resourcesTotal !== undefined
        ? pdSection('склад', [pdCell('всего', fmt(planet.resourcesTotal))])
        : '';

    const fleet = planet.colonized && planet.fleet
      ? pdSection('флот', [
          pdCell('зонды', planet.fleet.PROBE),
          pdCell('трансп', planet.fleet.SMALL_CARGO),
          pdCell('истреб', planet.fleet.LIGHT_FIGHTER),
          pdCell('крейс', planet.fleet.CRUISER),
          pdCell('фрегат', planet.fleet.FRIGATE),
        ])
      : planet.colonized && planet.fleetTotal !== null && planet.fleetTotal !== undefined
        ? pdSection('флот', [pdCell('вымпелов', fmt(planet.fleetTotal))])
        : '';

    const defenses = planet.defenses
      ? pdSection('оборона', [
          pdCell('пушки', planet.defenses.CANNON),
          pdCell('лазеры', planet.defenses.LASER),
        ])
      : planet.defenceTotal !== null && planet.defenceTotal !== undefined
        ? pdSection('оборона', [pdCell('точек', fmt(planet.defenceTotal))])
        : '';

    const stale = hidden
      ? `<div class="pd-note stale-note">склад, флот и оборона скрыты: ${unknown}</div>`
      : '';

    /*
     * Почему поле пустое — вопрос, на который надо отвечать. «Данных нет»
     * сказало бы неправду: зонд там был, но не дотянулся, и лечится это
     * не новым вылетом, а уровнем «Шпионажа».
     */
    const shallow =
      !hidden && planet.visibility === 'SCANNED' && planet.detail && planet.detail !== 'TECHS'
        ? `<div class="pd-note stale-note">зонд дотянулся не до всего — нужен перевес в «Шпионаже»</div>`
        : '';

    const age = planet.visibility === 'SCANNED' ? `<div class="pd-note">${scanAgeHtml(planet)}</div>` : '';
    const more = short && planet.buildings ? '<div class="pd-note">постройки — в панели справа</div>' : '';

    return head + owner + debris + rich + buildings + resources + fleet + defenses + stale + shallow + age + more;
  }

  /** Поле обломков на орбите. Туман войны его не скрывает — гонка честная. */
  function debrisHtml(planet) {
    const debris = planet.debris;
    if (!debris || debris.ore + debris.polymers <= 0) return '';
    return (
      `<div class="pd-note debris">обломки: ${icon('ore', 'sm')} ${fmt(debris.ore)} · ` +
      `${icon('polymers', 'sm')} ${fmt(debris.polymers)}</div>`
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
      return `${badge}<br><span class="scan-hidden">Данные устарели: флот и склад скрыты. Отправь зонд заново.</span>`;
    }
    if (planet.freshness === 'STALE') {
      return `${badge}<br><span class="scan-warning">Данные могут быть неточны.</span>`;
    }
    return badge;
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
    const planet = Boolean(target) && target.kind === 'PLANET';
    const unknown = planet && !target.isOwn && target.colonized === null;
    const free = planet && !target.isOwn && target.colonized === false;

    const base = planet && target.isOwn
      ? MISSION_OPTIONS.OWN_PLANET
      : free
        ? MISSION_OPTIONS.FREE_PLANET
        : unknown
          ? MISSION_OPTIONS.UNKNOWN_PLANET
          : planet
            ? MISSION_OPTIONS.ENEMY_PLANET
            : MISSION_OPTIONS[kind] || MISSION_OPTIONS.UNKNOWN_PLANET;
    const options = [...base];

    /*
     * Колонизация — на планету, про которую не известно, что она занята.
     *
     * Раньше пункт требовал основателя уже в составе, и это стало ловушкой,
     * как только состав начал фильтроваться по миссии: поле колонизатора
     * не показано — значит его не ввести, значит пункт не появится, значит
     * поле не покажут. Выполнимость проверяет сервер, а форма отвечает
     * за то, что вообще бывает с этой целью.
     */
    if (free || unknown) options.push(['COLONIZE', 'Основать колонию']);

    // «Переработка» появляется только когда в составе есть переработчик и над
    // планетой действительно висит поле: пустой пункт меню сбивал бы с толку.
    if (!map.coordTarget && map.selectedKind === 'PLANET') {
      const planet = selectedPlanet();
      const hasDebris = planet && planet.debris && planet.debris.ore + planet.debris.polymers > 0;
      if (hasDebris) options.push(['HARVEST', 'Переработка обломков']);
    }

    // Выбор игрока сохраняется, пока он выполним: перерисовка меню на каждое
    // изменение состава иначе сбрасывала бы действие.
    if (!options.some(([value]) => value === map.mission)) {
      const safe = SAFE_DEFAULT_MISSIONS.find((value) => options.some(([option]) => option === value));
      map.mission = safe || (options.length ? options[0][0] : '');
    }

    const signature = options.map(([value, label]) => `${value}:${label}`).join('|') + `#${map.mission}`;
    if (missionMenuSignature !== signature) {
      missionMenuSignature = signature;
      el.missionMenu.innerHTML = '';
      for (const [value, label] of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `mission-option${value === map.mission ? ' active' : ''}`;
        button.dataset.mission = value;
        button.textContent = label;
        el.missionMenu.appendChild(button);
      }
    }

    syncFleetFields();

    const pickup = map.mission === 'HUB_PICKUP';
    // Подпись перерисовывается вместе с иконкой: textContent стер бы SVG из разметки.
    el.cargoOreLabel.innerHTML = `${icon('ore', 'sm')} ${pickup ? 'Забрать руды' : 'Руда'}`;
    el.cargoPolymersLabel.innerHTML = `${icon('polymers', 'sm')} ${pickup ? 'Забрать полимеров' : 'Полимеры'}`;

    // Хаб торгует только рудой и полимерами, плазму туда не возят.
    const hubRun = pickup || map.mission === 'HUB_DELIVERY';
    el.cargoPlasmaField.hidden = hubRun;
    if (hubRun) el.cargoPlasma.value = '0';

    // Выбор односторонности есть только у транспорта: дислокация и колонизация
    // односторонни всегда, остальные миссии всегда возвращаются.
    const canChooseOneWay = map.mission === 'TRANSPORT';
    el.oneWayRow.hidden = !canChooseOneWay;
    if (!canChooseOneWay) el.oneWay.checked = false;

    // Переработчики летят за обломками, а не с грузом: трюмы должны быть пусты.
    // Разведке трюмы тоже ни к чему — зонд везет данные, а не ресурсы.
    const harvest = map.mission === 'HARVEST' || map.mission === 'SCAN';
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
      /*
       * Цель, заданная координатами, живет отдельно от выбора на карте: она
       * может лежать в системе, которой на текущей карте просто нет. Панель
       * отправки при ней остается открытой — иначе игрок ввел координаты,
       * увидел «Цель: …» и не нашел, куда нажать. Особенно это мешало
       * колонизации: свободные планеты почти всегда в чужих системах.
       */
      const coord = map.coordTarget;
      el.planetInfo.innerHTML = coord
        ? `<b>${escapeHtml(coord.planetName)}</b><br>` +
          `система ${escapeHtml(coord.systemName)} · орбита ${coord.position} · ` +
          `${coord.galaxyX}:${coord.galaxyY}<br>` +
          'Цель задана координатами. Разведданных нет — отправь зонд.'
        : 'Наведи курсор или выбери планету на карте.';

      el.dispatch.hidden = !base || !coord;
      if (!el.dispatch.hidden) {
        syncMissionOptions();
        renderFleetInputs();
        renderDispatchTarget();
      }
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
        field.className = 'field field-with-max';
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
        // Кнопка «все» рядом с полем: набрать весь класс — самое частое
        // действие, а вводить трехзначное число с телефона неудобно.
        const max = document.createElement('button');
        max.type = 'button';
        max.className = 'field-max';
        max.textContent = 'все';
        max.addEventListener('click', (event) => {
          event.preventDefault();
          const current = activeBase();
          input.value = String((current && current.fleet[type]) || 0);
          syncMissionOptions();
          schedulePlan();
        });

        field.append(caption, input, max);
        el.fleetInputs.appendChild(field);
        fleetInputs[type] = { caption, input, field, max };
      }
    }

    for (const [type, label] of Object.entries(SHIP_LABELS)) {
      const owned = base.fleet[type];
      fleetInputs[type].caption.textContent = `${label} (${owned})`;
      fleetInputs[type].input.max = String(owned);
      fleetInputs[type].max.disabled = owned <= 0;
    }
    syncFleetFields();
  }

  const fleetInputs = {};

  /*
   * Какие классы имеют смысл в этой миссии.
   *
   * Урезаются только две, и обе — там, где лишний корабль не бесполезен,
   * а вреден. Разведке нужен зонд и только он: боя на разведке не бывает,
   * эскадра рядом с дроном просто жжет топливо и рискует собой впустую.
   * Сборке обломков — переработчик: обычные трюмы поле не берут, иначе
   * он был бы не нужен.
   *
   * Остальные рейсы показывают все классы, и это не лень. Односторонний
   * транспорт — способ передать имущество: им дарят союзнику и грузовик,
   * и переработчик, и зонд. Спрятать класс значит запретить такой подарок,
   * а выигрыш был бы только в опрятности списка.
   */
  function shipsForMission(mission) {
    if (mission === 'SCAN') return ['PROBE'];
    if (mission === 'HARVEST') return ['RECYCLER'];
    return Object.keys(SHIP_LABELS);
  }

  /**
   * Что показать в составе: пересечение «имеет смысл в миссии» и «есть в ангаре».
   *
   * Пустой класс — это строка, которая ничего не предлагает: ввести в нее
   * нечего, а места она занимает столько же, сколько полезная. Двенадцать
   * классов, из которых построены три, превращали шаг состава в список
   * преимущественно нулей.
   *
   * Скрытое поле обнуляется: иначе корабль улетел бы, не показавшись в форме.
   */
  function syncFleetFields() {
    const base = activeBase();
    const allowed = new Set(shipsForMission(map.mission));
    for (const [type, refs] of Object.entries(fleetInputs)) {
      const owned = base ? base.fleet[type] || 0 : 0;
      const off = !allowed.has(type) || owned <= 0;
      refs.field.hidden = off;
      if (off && refs.input.value !== '0') refs.input.value = '0';
    }
  }

  function readComposition() {
    const ships = { PROBE: 0, SMALL_CARGO: 0, LIGHT_FIGHTER: 0 };
    for (const [type, refs] of Object.entries(fleetInputs)) {
      ships[type] = Math.max(0, Number(refs.input.value) || 0);
    }
    return ships;
  }

  /** Предупреждение о последствиях вылета. Пустое — прячем целиком. */
  function showMissionWarning(text) {
    el.missionWarning.hidden = !text;
    el.missionWarning.textContent = text || '';
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
        // Поиск по координатам туманом войны не ограничен и отвечает
        // о заселенности прямо, поэтому здесь null невозможен.
        colonized: Boolean(map.coordTarget.owner),
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
        colonized: false,
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
        colonized: false,
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
        // На карте это три состояния, а не два: у неразведанной планеты
        // владелец скрыт туманом войны, и пустой владелец не значит «свободна».
        colonized: planet.colonized,
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
    // «Колонии нет» и «неизвестно» — разные вещи: у неразведанной планеты
    // владелец скрыт туманом войны, и выдавать это за пустую орбиту нельзя.
    const owner = target.isOwn
      ? '<span class="own">своя колония</span>'
      : target.owner
        ? `владелец: ${escapeHtml(target.owner)}`
        : target.kind !== 'PLANET'
          ? ''
          : target.colonized === false
            ? 'колонии нет'
            : '<span class="unknown">не разведана — что на ней, неизвестно</span>';
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
      showMissionWarning(null);
      return;
    }

    try {
      const response = await fetch(`/api/bases/${base.baseId}/fleets/preview`, {
        method: 'POST',
        headers: authHeaders(),
        // Миссию шлем в расчет: рейс в один конец не платит за обратный путь.
        body: JSON.stringify({ ...target, ships, mission: map.mission, oneWay: el.oneWay.checked }),
      });
      if (!response.ok) {
        map.plan = null;
        el.flightPlan.textContent = 'Не удалось рассчитать маршрут';
        showMissionWarning(null);
        return;
      }
      map.plan = await response.json();
      // Предупреждение считает сервер: только он знает, идет ли война
      // и состоит ли цель в синдикате.
      showMissionWarning(map.plan.warning);

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
      // Рейс без возврата не платит за обратный путь. У дислокации и колонизации
      // это свойство миссии, у транспорта — выбор игрока.
      const oneWay =
        map.mission === 'DEPLOY' ||
        map.mission === 'COLONIZE' ||
        (map.mission === 'TRANSPORT' && el.oneWay.checked);

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
    const pickup = map.mission === 'HUB_PICKUP';

    const ok = await send(`/api/bases/${base.baseId}/fleets`, {
      ...target,
      mission: map.mission,
      oneWay: el.oneWay.checked,
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
      el.oneWay.checked = false;
      map.plan = null;
      el.flightPlan.textContent = 'Выбери корабли, чтобы увидеть расчет.';
      showMissionWarning(null);
    }
    await loadMap();
    await loadGalaxy();
    await loadMarket();
    await loadWar();
  }

  /*
   * Очередь полетов живет в двух местах: в правой сводке у карты и в центре
   * управления. Это не дубль — панели никогда не видны одновременно, а вопрос
   * «когда вернется рейс» задают и не открывая карту.
   */
  function renderFleetList() {
    for (const node of [el.fleetList, el.overviewFleets]) fillFleetList(node);
  }

  function fillFleetList(node) {
    if (!node) return;
    node.innerHTML = '';
    if (!state.fleets.length) {
      const empty = document.createElement('div');
      empty.className = 'queue-item';
      empty.textContent = 'Флотов в полете нет';
      node.appendChild(empty);
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
      node.appendChild(item);
    }
  }

  /* Шаг 1: набрать весь доступный флот или очистить состав. */
  el.fleetAll.addEventListener('click', () => {
    const base = activeBase();
    if (!base) return;
    const allowed = new Set(shipsForMission(map.mission));
    for (const [type, refs] of Object.entries(fleetInputs)) {
      if (allowed.has(type)) refs.input.value = String(base.fleet[type] || 0);
    }
    syncMissionOptions();
    schedulePlan();
  });

  /* Список шаблонов разворачивается кнопкой и сам по себе места не занимает. */
  el.mailComposeToggle.addEventListener('click', () => {
    el.mailCompose.hidden = !el.mailCompose.hidden;
    el.mailComposeToggle.classList.toggle('active', !el.mailCompose.hidden);
  });

  el.presetToggle.addEventListener('click', () => {
    el.presetRow.hidden = !el.presetRow.hidden;
    el.presetToggle.classList.toggle('active', !el.presetRow.hidden);
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

      // Панель открывает renderPlanetInfo — правило видимости живет там одно
      // на все случаи, и дублировать его здесь значит развести их со временем.
      renderPlanetInfo();
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
  el.missionMenu.addEventListener('click', (event) => {
    const button = event.target.closest('.mission-option');
    if (!button || button.dataset.mission === map.mission) return;
    map.mission = button.dataset.mission;
    // Подпись выбранного меняется, поэтому подпись меню пересобирается целиком.
    missionMenuSignature = '';
    syncMissionOptions();
    schedulePlan();
  });
  el.cargoOre.addEventListener('input', schedulePlan);
  el.cargoPolymers.addEventListener('input', schedulePlan);
  el.cargoPlasma.addEventListener('input', schedulePlan);
  el.oneWay.addEventListener('change', schedulePlan);


  /* ---------- Хаб и биржа ---------- */

  /*
   * Панель разложена на три блока сверху вниз, и порядок в них — это порядок
   * решений: сперва понять, что с рынком, потом торговать, потом посмотреть,
   * что вышло. Цену, обороты и изменение за сутки считает сервер (правило 3);
   * клиент их только рисует.
   */
  const market = { data: null, timer: null };
  const RESOURCE_LABELS = { ORE: 'Руда', POLYMERS: 'Полимеры' };
  /** Биржа оперирует enum-ключами, иконки — именами ресурсов. */
  const RESOURCE_ICONS = { ORE: 'ore', POLYMERS: 'polymers' };
  const TRADED = ['ORE', 'POLYMERS'];

  /** Фильтры и сортировка живут в клиенте: стакан мал и весь уже здесь. */
  const bookView = { side: 'ALL', res: 'ALL', trader: '', sort: 'pricePerUnit', dir: 1 };
  /** История подкачивается с сервера, поэтому ее фильтры уходят в запрос. */
  const logView = { res: 'ALL', mine: false, rows: [], done: false, loading: false };
  /** Какой ресурс раскрыт графиком. null — график свернут. */
  let chartResource = null;

  async function loadMarket() {
    try {
      const response = await fetch('/api/market', { headers: authHeaders() });
      if (!response.ok) return;
      market.data = await response.json();
      // Первая страница журнала приходит вместе со сводкой: отдельный запрос
      // за ней был бы вторым походом на сервер ради того, что уже прислали.
      if (logView.rows.length === 0 && !logView.done) logView.rows = market.data.trades ?? [];
      renderMarket();
    } catch (error) {
      /* биржа подтянется на следующем обновлении */
    }
  }

  function renderMarket() {
    if (!market.data) return;
    renderHubStorage();
    renderQuotes();
    renderOrderBook();
    renderBarter();
    renderTradeLog();
    syncOrderForm();
  }

  const icoTag = (resource) =>
    `<svg class="ico ${RESOURCE_ICONS[resource]}" aria-hidden="true">` +
    `<use href="#ico-${RESOURCE_ICONS[resource]}"/></svg>`;

  const resCell = (resource) =>
    `<span class="mk-res">${icoTag(resource)}${RESOURCE_LABELS[resource]}</span>`;

  /* ---------- 1. Состояние рынка ---------- */

  function renderHubStorage() {
    const storage = market.data.storage;
    if (!storage) {
      el.hubStorage.innerHTML = '<span class="muted">Торгового хаба в этой системе нет.</span>';
      el.upgradeStorage.hidden = true;
      return;
    }
    const used = storage.ore + storage.polymers;
    const fill = storage.capacity > 0 ? Math.min(1, used / storage.capacity) : 0;
    el.hubStorage.innerHTML =
      `<span>${escapeHtml(market.data.hub?.name ?? 'Хаб')} · склад ур. ${storage.level}</span>` +
      `<span class="bar"><i style="width:${(fill * 100).toFixed(1)}%"></i></span>` +
      `<span><b>${fmt(used)}</b> / ${fmt(storage.capacity)}</span>` +
      `<span class="mk-res">${icoTag('ORE')}<b>${fmt(storage.ore)}</b></span>` +
      `<span class="mk-res">${icoTag('POLYMERS')}<b>${fmt(storage.polymers)}</b></span>` +
      `<span class="mk-res">${icon('credits', 'sm')}<b>${fmt(market.data.credits)}</b></span>`;

    // Расширение платится криптогривной, а не товаром со склада: товаром
    // платить приходилось ровно тогда, когда места нет, и нужного ресурса
    // в забитой куче могло не оказаться вовсе.
    const afford = market.data.credits >= storage.upgradeCost;
    el.upgradeStorage.hidden = false;
    el.upgradeStorage.disabled = !afford;
    el.upgradeStorage.textContent =
      `Расширить до ур. ${storage.nextLevel} → ${fmt(storage.nextCapacity)} · ${fmt(storage.upgradeCost)} ₴`;
  }

  /**
   * Сводка по рынку.
   *
   * Цена сама по себе ничего не значит: «14 за полимеры» — это дорого или
   * дешево? Поэтому рядом изменение за сутки, обороты и перекос стакана —
   * то, по чему видно, куда цена поедет дальше.
   */
  function renderQuotes() {
    const quotes = market.data.quotes || {};
    const stats = market.data.stats || {};
    const barter = market.data.barterStats;
    el.marketQuotes.innerHTML = '';

    for (const resource of TRADED) {
      const q = quotes[resource];
      const s = stats[resource];
      if (!q || !s) continue;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mk-stat';
      card.dataset.chart = resource;
      card.setAttribute('aria-expanded', String(chartResource === resource));

      const delta =
        s.change === null
          ? '<span class="mk-delta muted">сутки без сделок</span>'
          : `<span class="mk-delta ${s.change > 0 ? 'up' : s.change < 0 ? 'down' : ''}">` +
            `${s.change > 0 ? '+' : ''}${Math.round(s.change * 100)}% за сутки</span>`;

      card.innerHTML =
        `<span class="mk-stat-head">${icoTag(resource)} ${RESOURCE_LABELS[resource]} · ` +
        `${q.seeded ? 'оценочная' : 'рыночная'} цена</span>` +
        `<span class="mk-stat-price"><b>${q.reference.toFixed(2)}</b>${delta}</span>` +
        `<span class="mk-stat-foot">` +
        `<span>оборот <b>${fmt(s.volumeToday)}</b></span>` +
        `<span>сделок <b>${s.tradesToday}</b></span>` +
        `<span>заявок <b>${s.openOrders}</b></span>` +
        `</span>`;
      card.addEventListener('click', () => void toggleChart(resource));
      el.marketQuotes.appendChild(card);
    }

    // Перекос спроса: то, ради чего стакан вообще читают.
    const skew = document.createElement('div');
    skew.className = 'mk-stat mk-skew';
    skew.innerHTML =
      '<span class="mk-stat-head">Перекос спроса</span>' +
      TRADED.map((resource) => {
        const q = quotes[resource];
        if (!q || q.skew === null) {
          return `<div class="mk-skew-legend"><span class="mk-res">${icoTag(resource)}` +
            `${RESOURCE_LABELS[resource].toLowerCase()}</span><span>стакан пуст</span></div>`;
        }
        const both = q.demand + q.supply;
        const buyShare = both > 0 ? (q.demand / both) * 100 : 50;
        return (
          '<div>' +
          `<div class="mk-skew-bar"><i class="sell" style="left:0;width:${(100 - buyShare).toFixed(1)}%"></i>` +
          `<i class="buy" style="left:${(100 - buyShare).toFixed(1)}%;width:${buyShare.toFixed(1)}%"></i></div>` +
          `<div class="mk-skew-legend"><span>продают ${fmt(q.supply)}</span>` +
          `<span class="mk-res">${icoTag(resource)}${RESOURCE_LABELS[resource].toLowerCase()}</span>` +
          `<span>покупают ${fmt(q.demand)}</span></div>` +
          '</div>'
        );
      }).join('');
    el.marketQuotes.appendChild(skew);

    if (barter) {
      const card = document.createElement('div');
      card.className = 'mk-stat';
      card.innerHTML =
        '<span class="mk-stat-head">Бартер</span>' +
        `<span class="mk-stat-price"><b>${barter.open}</b>` +
        '<span class="mk-delta muted">предложений висит</span></span>' +
        `<span class="mk-stat-foot"><span>в залоге <b>${fmt(barter.unitsOffered)}</b> единиц</span></span>`;
      el.marketQuotes.appendChild(card);
    }
  }

  /**
   * Дневная динамика цены.
   *
   * Ленивый запрос по клику: график смотрят редко, а рынок опрашивается
   * постоянно, и возить тридцать точек в каждом ответе значило бы платить
   * за них всегда ради тех случаев, когда их читают.
   */
  async function toggleChart(resource) {
    if (chartResource === resource) {
      chartResource = null;
      el.marketChart.hidden = true;
      renderQuotes();
      return;
    }
    chartResource = resource;
    renderQuotes();
    el.marketChart.hidden = false;
    el.marketChartTitle.textContent = `${RESOURCE_LABELS[resource]} · средняя цена по дням`;
    el.marketChartNote.textContent = 'загрузка…';
    el.marketChartSvg.innerHTML = '';

    try {
      const response = await fetch(`/api/market/history/${resource}`, { headers: authHeaders() });
      if (!response.ok) throw new Error('нет данных');
      const { series } = await response.json();
      if (!series || series.length === 0) {
        el.marketChartNote.textContent = 'сделок пока не было';
        return;
      }
      el.marketChartNote.textContent =
        `${series.length} ${plural(series.length, 'день', 'дня', 'дней')} торгов · средневзвешенная по объему`;
      drawPriceChart(series, resource);
    } catch (error) {
      el.marketChartNote.textContent = 'историю получить не удалось';
    }
  }

  /** Склонение существительного при числе: «1 день», «2 дня», «5 дней». */
  function plural(count, one, few, many) {
    const mod100 = Math.abs(count) % 100;
    const mod10 = mod100 % 10;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  function drawPriceChart(series, resource) {
    const W = 900;
    const H = 120;
    const pad = 8;
    const prices = series.map((point) => point.price);
    const min = Math.min(...prices) * 0.92;
    const max = Math.max(...prices) * 1.04 || 1;
    const step = W / series.length;
    const y = (value) => H - pad - ((value - min) / (max - min || 1)) * (H - pad * 2);
    const color = resource === 'ORE' ? 'var(--ore)' : 'var(--polymers)';

    const bars = series
      .map((point, i) => {
        const top = y(point.price);
        const last = i === series.length - 1;
        return (
          `<rect x="${(i * step + step * 0.18).toFixed(1)}" y="${top.toFixed(1)}" ` +
          `width="${(step * 0.64).toFixed(1)}" height="${(H - pad - top).toFixed(1)}" rx="1.5" ` +
          `fill="${last ? color : 'rgba(120,160,255,0.28)'}"><title>${point.day}: ${point.price}</title></rect>`
        );
      })
      .join('');
    const line = series.map((point, i) => `${i * step + step / 2},${y(point.price)}`).join(' ');

    el.marketChartSvg.innerHTML =
      `<line x1="0" y1="${H - pad}" x2="${W}" y2="${H - pad}" stroke="rgba(120,160,255,0.2)"/>` +
      bars +
      `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.7"/>`;
  }

  /* ---------- 2. Стакан ---------- */

  /**
   * Заявки одним списком, отсортированным по цене.
   *
   * По цене, а не по времени: стакан затем и существует, чтобы лучшее
   * предложение было первым. Новая заявка встает по своей цене и там же
   * подсвечивается — появление видно, польза списка сохраняется.
   */
  function renderOrderBook() {
    const book = market.data.book || {};
    const all = [];
    for (const resource of TRADED) {
      const side = book[resource];
      if (!side) continue;
      for (const order of side.buy) all.push(order);
      for (const order of side.sell) all.push(order);
    }

    const rows = all.filter(
      (order) =>
        (bookView.side === 'ALL' || order.side === bookView.side) &&
        (bookView.res === 'ALL' || order.resource === bookView.res) &&
        (!bookView.trader || order.trader.toLowerCase().includes(bookView.trader)),
    );

    rows.sort((a, b) => {
      const key = bookView.sort;
      const va = key === 'total' ? a.remaining * a.pricePerUnit : a[key];
      const vb = key === 'total' ? b.remaining * b.pricePerUnit : b[key];
      if (va === vb) return 0;
      return (va > vb ? 1 : -1) * bookView.dir;
    });

    el.orderBook.innerHTML = '';
    if (rows.length === 0) {
      el.orderBook.innerHTML = '<tr><td colspan="7" class="mk-empty">По этим фильтрам заявок нет.</td></tr>';
      seenOrders = new Set(all.map((order) => order.id));
      bookDrawn = true;
      return;
    }

    for (const order of rows) {
      const tr = document.createElement('tr');
      if (order.mine) tr.className = 'mine';
      if (bookDrawn && !seenOrders.has(order.id)) tr.classList.add('arrived');
      const buy = order.side === 'BUY';
      tr.innerHTML =
        `<td><span class="mk-pill ${buy ? 'buy' : 'sell'}">` +
        `<span class="arw" aria-hidden="true">${buy ? '↓' : '↑'}</span>${buy ? 'покупка' : 'продажа'}</span></td>` +
        `<td>${resCell(order.resource)}</td>` +
        `<td class="num">${fmt(order.remaining)}</td>` +
        `<td class="num">${order.pricePerUnit.toFixed(2)}</td>` +
        `<td class="num">${fmt(order.remaining * order.pricePerUnit)} ₴</td>` +
        `<td>${escapeHtml(order.trader)}${order.mine ? ' <span class="muted">· моя</span>' : ''}</td>` +
        '<td class="num"></td>';

      const action = document.createElement('button');
      action.type = 'button';
      action.className = order.mine ? 'mk-act cancel' : 'mk-act';
      // На своей заявке — снятие: без него залог не вернуть, а выставленное
      // не отменить.
      action.textContent = order.mine ? 'Снять' : buy ? 'Продать ему' : 'Купить';
      action.addEventListener('click', () => void (order.mine ? cancelOrder(order.id) : fillOrder(order)));
      tr.lastElementChild.appendChild(action);
      el.orderBook.appendChild(tr);
    }

    seenOrders = new Set(all.map((order) => order.id));
    bookDrawn = true;
  }

  /*
   * Какие заявки уже показывали: по ним отличается новая от старой.
   *
   * Отдельный флаг «стакан уже рисовали», а не проверка на непустое
   * множество: на пустом стакане множество остается пустым навсегда,
   * и первая же появившаяся заявка не подсветилась бы. Флаг нужен затем,
   * чтобы при первой загрузке не вспыхнул весь список разом.
   */
  let seenOrders = new Set();
  let bookDrawn = false;

  async function fillOrder(order) {
    await send(`/api/market/orders/${order.id}/fill`, { quantity: order.remaining });
    await loadMarket();
  }

  async function cancelOrder(orderId) {
    await send(`/api/market/orders/${orderId}`, undefined, 'DELETE');
    await loadMarket();
  }

  /* ---------- Бартер ---------- */

  function renderBarter() {
    const offers = market.data.barters || [];
    el.barterList.innerHTML = '';
    if (offers.length === 0) {
      el.barterList.innerHTML = '<tr><td colspan="5" class="mk-empty">Предложений обмена нет.</td></tr>';
      return;
    }

    for (const offer of offers) {
      const tr = document.createElement('tr');
      if (offer.mine) tr.className = 'mine';
      const rate = offer.giveQuantity > 0 ? (offer.wantQuantity / offer.giveQuantity).toFixed(2) : '—';
      tr.innerHTML =
        `<td><span class="mk-res">${icoTag(offer.giveResource)}${fmt(offer.giveQuantity)} ` +
        `${RESOURCE_LABELS[offer.giveResource].toLowerCase()}</span></td>` +
        `<td><span class="mk-res">${icoTag(offer.wantResource)}${fmt(offer.wantQuantity)} ` +
        `${RESOURCE_LABELS[offer.wantResource].toLowerCase()}</span></td>` +
        `<td class="num">1 : ${rate}</td>` +
        `<td>${escapeHtml(offer.trader)}${offer.mine ? ' <span class="muted">· мое</span>' : ''}</td>` +
        '<td class="num"></td>';

      const action = document.createElement('button');
      action.type = 'button';
      action.className = offer.mine ? 'mk-act cancel' : 'mk-act';
      action.textContent = offer.mine ? 'Снять' : 'Обменять';
      action.addEventListener('click', async () => {
        if (offer.mine) await send(`/api/market/barter/${offer.id}`, undefined, 'DELETE');
        else await send(`/api/market/barter/${offer.id}/accept`, {});
        await loadMarket();
      });
      tr.lastElementChild.appendChild(action);
      el.barterList.appendChild(tr);
    }
  }

  /* ---------- 3. История ---------- */

  function renderTradeLog() {
    el.tradeLog.innerHTML = '';
    if (logView.rows.length === 0) {
      el.tradeLog.innerHTML = '<tr><td colspan="7" class="mk-empty">Сделок по этим фильтрам не было.</td></tr>';
      el.tradesMore.hidden = true;
      return;
    }

    for (const trade of logView.rows) {
      const tr = document.createElement('tr');
      if (trade.mine) tr.className = 'mine';
      tr.innerHTML =
        `<td>${resCell(trade.resource)}</td>` +
        `<td class="num">${fmt(trade.quantity)}</td>` +
        `<td class="num">${trade.pricePerUnit.toFixed(2)}</td>` +
        `<td class="num">${fmt(trade.total)} ₴</td>` +
        `<td>${escapeHtml(trade.seller)}</td>` +
        `<td>${escapeHtml(trade.buyer)}</td>` +
        `<td class="num mk-ts">${whenLabel(trade.createdAt)}</td>`;
      el.tradeLog.appendChild(tr);
    }

    el.tradesMore.hidden = logView.done;
    el.tradesMore.disabled = logView.loading;
    el.tradesMore.textContent = logView.loading ? 'загрузка…' : 'Показать еще';
  }

  function whenLabel(ts) {
    const date = new Date(ts);
    const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const today = new Date().toDateString() === date.toDateString();
    return today
      ? `сегодня ${time}`
      : `${date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${time}`;
  }

  /**
   * Подкачка журнала.
   *
   * Курсором по времени, а не смещением: пока игрок листает, приходят новые
   * сделки, и смещение сдвинуло бы ленту — одна строка показалась бы дважды,
   * а другая не показалась бы вовсе.
   */
  async function loadMoreTrades(reset = false) {
    if (logView.loading) return;
    logView.loading = true;
    if (reset) {
      logView.rows = [];
      logView.done = false;
    }
    renderTradeLog();

    const params = new URLSearchParams();
    if (logView.res !== 'ALL') params.set('resource', logView.res);
    if (logView.mine) params.set('mine', '1');
    const last = logView.rows[logView.rows.length - 1];
    if (last) params.set('before', String(last.createdAt));

    try {
      const response = await fetch(`/api/market/trades?${params.toString()}`, { headers: authHeaders() });
      if (response.ok) {
        const { trades } = await response.json();
        logView.rows = logView.rows.concat(trades ?? []);
        if (!trades || trades.length === 0) logView.done = true;
      }
    } catch (error) {
      /* следующая попытка по кнопке */
    } finally {
      logView.loading = false;
      renderTradeLog();
    }
  }

  /* ---------- Форма заявки ---------- */

  let orderSide = 'BUY';

  el.orderSide.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      orderSide = button.dataset.side;
      el.orderSide.querySelectorAll('button').forEach((other) => {
        other.setAttribute('aria-pressed', String(other === button));
      });
      el.placeOrderButton.textContent = orderSide === 'BUY' ? 'Выставить покупку' : 'Выставить продажу';
      syncOrderForm();
    });
  });

  /**
   * Подсказка под формой: что получится и во что упирается.
   *
   * Цена по умолчанию — рыночная, а не средняя по стакану. Средняя по заявкам
   * это среднее по тому, чего никто не купил, и опора на нее удерживала бы
   * цену там, где она уже есть.
   */
  function syncOrderForm() {
    if (!market.data) return;
    const resource = el.orderResource.value;
    const quote = market.data.quotes?.[resource];
    if (quote && !el.orderPrice.value) el.orderPrice.value = quote.reference.toFixed(2);

    const amount = parseAmount(el.orderQuantity.value);
    const price = parsePrice(el.orderPrice.value);
    if (!amount || !price) {
      el.orderHint.textContent = quote
        ? `Рынок оценивает в ${quote.reference.toFixed(2)} ₴ за единицу.`
        : '';
      return;
    }
    const total = amount * price;
    el.orderHint.textContent =
      orderSide === 'BUY'
        ? `Купить ${fmt(amount)} по ${price.toFixed(2)} — заложим ${fmt(total * 1.006)} ₴ вместе со сбором.`
        : `Продать ${fmt(amount)} по ${price.toFixed(2)} — выручка ${fmt(total * 0.995)} ₴ за вычетом сбора.`;
  }

  const parseAmount = (value) => {
    const digits = String(value ?? '').replace(/[^\d]/g, '');
    return digits ? Number.parseInt(digits, 10) : 0;
  };
  const parsePrice = (value) => {
    const normalized = String(value ?? '').replace(',', '.').replace(/[^\d.]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  /*
   * «Макс» значит разное на разных сторонах. Продажа упирается в остаток
   * ресурса на складе хаба. Покупка — сразу в две вещи: деньги и свободное
   * место, потому что купленное надо куда-то положить. Подсказка называет то,
   * что уперлось: без нее игрок видит число и не понимает, почему не больше.
   */
  el.orderMax.addEventListener('click', () => {
    if (!market.data?.storage) return;
    const resource = el.orderResource.value;
    const storage = market.data.storage;
    const price = parsePrice(el.orderPrice.value) || market.data.quotes?.[resource]?.reference || 1;

    if (orderSide === 'SELL') {
      const held = resource === 'ORE' ? storage.ore : storage.polymers;
      el.orderQuantity.value = String(Math.floor(held));
      el.orderHint.textContent = `Продать можно ${fmt(held)} — столько лежит на складе хаба.`;
      return;
    }
    const byMoney = Math.floor(market.data.credits / price);
    const byRoom = Math.floor(storage.free);
    el.orderQuantity.value = String(Math.max(0, Math.min(byMoney, byRoom)));
    el.orderHint.textContent =
      byMoney < byRoom
        ? `Упирается в кассу: на ${fmt(market.data.credits)} ₴ по этой цене берется ${fmt(byMoney)}.`
        : `Упирается в склад: свободно ${fmt(byRoom)}, купленное надо куда-то положить.`;
  });

  el.orderMarket.addEventListener('click', () => {
    if (!market.data) return;
    const quote = market.data.quotes?.[el.orderResource.value];
    if (!quote) return;
    // Продаем по лучшей цене покупки, покупаем по лучшей цене продажи — так
    // заявка исполняется сразу. Нет встречной стороны — берем рыночную.
    const target = orderSide === 'SELL' ? quote.bestBuy : quote.bestSell;
    el.orderPrice.value = (target ?? quote.reference).toFixed(2);
    syncOrderForm();
  });

  el.orderResource.addEventListener('change', () => {
    const quote = market.data?.quotes?.[el.orderResource.value];
    if (quote) el.orderPrice.value = quote.reference.toFixed(2);
    syncOrderForm();
  });
  el.orderQuantity.addEventListener('input', syncOrderForm);
  el.orderPrice.addEventListener('input', syncOrderForm);

  el.placeOrderButton.addEventListener('click', async () => {
    const amount = parseAmount(el.orderQuantity.value);
    const price = parsePrice(el.orderPrice.value);
    if (amount <= 0) {
      el.orderHint.textContent = 'Количество должно быть больше нуля.';
      return;
    }
    if (price <= 0) {
      el.orderHint.textContent = 'Цена должна быть больше нуля.';
      return;
    }
    const ok = await send('/api/market/orders', {
      side: orderSide,
      resource: el.orderResource.value,
      quantity: amount,
      pricePerUnit: price,
    });
    if (ok) el.orderQuantity.value = '';
    await loadMarket();
  });

  el.upgradeStorage.addEventListener('click', async () => {
    await send('/api/market/storage/upgrade', {});
    await loadMarket();
  });

  /* ---------- Форма бартера ---------- */

  el.barterOffer.addEventListener('click', async () => {
    const give = el.barterGiveRes.value;
    const want = el.barterWantRes.value;
    if (give === want) {
      el.barterHint.textContent = 'Менять ресурс на него же незачем — выберите разные.';
      return;
    }
    await send('/api/market/barter', {
      giveResource: give,
      giveQuantity: parseAmount(el.barterGiveQty.value),
      wantResource: want,
      wantQuantity: parseAmount(el.barterWantQty.value),
    });
    await loadMarket();
  });

  /* ---------- Вкладки, фильтры, сортировка ---------- */

  document.querySelectorAll('.mk-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mk-tab').forEach((other) => {
        other.setAttribute('aria-selected', String(other === tab));
      });
      $('pane-orders').hidden = tab.dataset.pane !== 'orders';
      $('pane-barter').hidden = tab.dataset.pane !== 'barter';
    });
  });

  document.querySelectorAll('[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const group = chip.dataset.filter;
      bookView[group] = chip.dataset.value;
      document.querySelectorAll(`[data-filter="${group}"]`).forEach((other) => {
        other.setAttribute('aria-pressed', String(other === chip));
      });
      renderOrderBook();
    });
  });

  el.bookTrader.addEventListener('input', () => {
    bookView.trader = el.bookTrader.value.trim().toLowerCase();
    renderOrderBook();
  });

  document.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      bookView.dir = bookView.sort === key ? -bookView.dir : 1;
      bookView.sort = key;
      document.querySelectorAll('[data-sort]').forEach((other) => {
        other.dataset.active = String(other === button);
        const arrow = other.querySelector('.arrow');
        if (arrow) arrow.textContent = other === button && bookView.dir < 0 ? '▲' : '▼';
      });
      renderOrderBook();
    });
  });

  document.querySelectorAll('[data-hfilter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (chip.dataset.hfilter === 'mine') {
        logView.mine = !logView.mine;
        chip.setAttribute('aria-pressed', String(logView.mine));
      } else {
        logView.res = chip.dataset.value;
        document.querySelectorAll('[data-hfilter="res"]').forEach((other) => {
          other.setAttribute('aria-pressed', String(other === chip));
        });
      }
      void loadMoreTrades(true);
    });
  });

  el.tradesMore.addEventListener('click', () => void loadMoreTrades());
  /* ---------- Оборона, бои, дипломатия ---------- */

  const DEFENSE_LABELS = {
    CANNON: 'Турели «Град»',
    LASER: 'Лазеры «Промінь»',
    GAUSS: 'Гаусс-пушки «Скіф»',
    PLASMA: 'Батареи «Сварог»',
    SUPER_WEAPON: 'Излучатели «Перун»',
  };
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
    renderRoster(
      el.defenseSummary,
      base.defenseCards.map((item) => ({ ...item, kind: 'defense' })),
      base.defenses,
      rosterKeys.defense,
      'Планета не укреплена. Турели строятся ниже.',
    );
    renderUnitQueue(el.defenseQueue, base.defenseQueue, 'Очередь обороны пуста');
  }


  /* ---------- Макро-карта галактики ---------- */

  /*
   * Геометрия макро-карты.
   *
   * Холст не фиксирован, а считается от разброса координат: шаг на одну единицу
   * координат одинаков по обеим осям. Раньше размер был жестко задан, и данные
   * растягивались под него — по X на координату приходился 41 пиксель, а по Y
   * всего 24 при иконке в 48, из-за чего соседние системы налезали друг на друга.
   */
  const GALAXY = { margin: 74, step: 74 };
  /**
   * Видимый размер миниатюры на макро-карте.
   *
   * Это размер того, что реально видно: картинка рисуется крупнее и обрезается
   * маской до светлой сердцевины, поэтому наружная половина арта — с рамками
   * и мусором по углам — не доезжает до экрана вовсе.
   */
  const SYSTEM_ICON = 56;
  /** Во сколько раз картинка крупнее видимого круга; обратное — доля арта, что видна. */
  const SYSTEM_ICON_SPREAD = 1.9;

  /*
   * Картинка системы выбирается по классу и координатам.
   *
   * Вариантов два на каждый вид, и берутся они по координатам, а не случайно:
   * система обязана выглядеть одинаково при каждой перерисовке карты, иначе
   * при обновлении она бы мигала другим артом.
   */
  /** Сколько вариантов миниатюр лежит в assets/systems/. */
  const GALAXY_ART_VARIANTS = 4;

  function systemArt(system) {
    const variant = (Math.abs(system.galaxyX * 31 + system.galaxyY * 17) % GALAXY_ART_VARIANTS) + 1;
    return `/assets/systems/galaxy_${variant}.webp`;
  }
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

  /**
   * Координаты сетки галактики переводим в координаты SVG.
   * Шаг одинаков по обеим осям, поэтому расстояние между системами на карте
   * соответствует расстоянию между ними в игре, а не форме холста.
   */
  function galaxyPoint(system, bounds) {
    return {
      x: GALAXY.margin + (system.galaxyX - bounds.minX) * GALAXY.step,
      y: GALAXY.margin + (system.galaxyY - bounds.minY) * GALAXY.step,
    };
  }

  /** Размер холста под разброс координат: карта растет вместе с галактикой. */
  function galaxyCanvas(bounds) {
    return {
      width: GALAXY.margin * 2 + (bounds.maxX - bounds.minX) * GALAXY.step,
      height: GALAXY.margin * 2 + (bounds.maxY - bounds.minY) * GALAXY.step,
    };
  }

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

    const canvas = galaxyCanvas(bounds);
    svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);

    // Маску краев миниатюры надо объявить в этом же SVG: ссылка на разметку
    // соседней карты не разрешается, и края обрезались бы квадратом.
    svg.appendChild(glowFadeDefs());

    // Сетка по координатам, чтобы карта читалась как координатное пространство.
    for (let gx = bounds.minX; gx <= bounds.maxX; gx += 1) {
      const x = GALAXY.margin + (gx - bounds.minX) * GALAXY.step;
      svg.appendChild(svgEl('line', {
        class: 'galaxy-grid', x1: x, y1: GALAXY.margin, x2: x, y2: canvas.height - GALAXY.margin,
      }));
    }
    for (let gy = bounds.minY; gy <= bounds.maxY; gy += 1) {
      const y = GALAXY.margin + (gy - bounds.minY) * GALAXY.step;
      svg.appendChild(svgEl('line', {
        class: 'galaxy-grid', x1: GALAXY.margin, y1: y, x2: canvas.width - GALAXY.margin, y2: y,
      }));
    }

    for (const system of systems) {
      const point = galaxyPoint(system, bounds);
      const blackHole = system.anomaly === 'BLACK_HOLE';

      const group = svgEl('g', {
        class: `system-node${system.isHome ? ' home' : ''}` +
          (map.data && map.data.systemId === system.systemId ? ' selected' : ''),
      });

      // Своя колония отмечается кольцом: миниатюры систем похожи между собой,
      // и без метки свою пришлось бы искать по названию.
      if (system.hasOwnColony) {
        group.appendChild(svgEl('circle', {
          class: 'home-ring', cx: point.x, cy: point.y, r: SYSTEM_ICON / 2 + 4,
        }));
      }

      celestialBody(group, point.x, point.y, SYSTEM_ICON / 2, {
        kind: 'glow',
        fill: blackHole ? 'rgba(157, 123, 255, 0.16)' : 'rgba(120, 160, 255, 0.16)',
        src: systemArt(system),
        spread: SYSTEM_ICON_SPREAD,
        mask: 'glowCrop',
      });

      const label = svgEl('text', { x: point.x, y: point.y + SYSTEM_ICON / 2 + 14, class: `system-label name${system.isHome ? ' home' : ''}` });
      label.textContent = system.name;
      group.appendChild(label);

      const coords = svgEl('text', { x: point.x, y: point.y + SYSTEM_ICON / 2 + 28, class: 'system-label' });
      coords.textContent = `${system.galaxyX}:${system.galaxyY}`;
      group.appendChild(coords);

      group.addEventListener('mouseenter', () => showSystemTooltip(system, point));
      group.addEventListener('mouseleave', hideTooltip);
      group.addEventListener('click', () => void openSystem(system.systemId));
      svg.appendChild(group);
    }
  }

  function showSystemTooltip(system, point) {
    const blackHole = system.anomaly === 'BLACK_HOLE';
    const klass = blackHole
      ? 'черная дыра'
      : `${STAR_CLASS_LABELS[system.starClass] || ''} (${system.starClass})`.trim();

    tipContent(
      `<div class="pd-head"><b>${escapeHtml(system.name)}</b>` +
      `<span>макро-карта галактики</span></div>` +
      (system.hasOwnColony
        ? '<div class="pd-owner own">здесь ваша колония</div>'
        : system.colonized
          ? '<div class="pd-owner foe">система заселена</div>'
          : '<div class="pd-owner">колоний нет</div>') +
      pdSection('система', [
        pdCell('координаты', `${system.galaxyX}:${system.galaxyY}`),
        pdCell('планет', system.planetCount),
        pdCell('разведано', system.scannedPlanets > 0 ? system.scannedPlanets : '—'),
      ]) +
      pdSection('светило', [
        pdCell('класс', escapeHtml(klass), 'wide'),
        pdCell(
          'температура',
          blackHole ? 'неизвестна' : (STAR_TEMPERATURE[system.starClass] || 'неизвестна'),
          'wide',
        ),
      ]) +
      (blackHole
        ? '<div class="pd-note unknown">Искажение времени: синтез антиматерии +50%, ' +
          'стройка и наука на 30% дольше.</div>'
        : ''),
    );
    anchorTooltip(el.galaxyMap, point.x, point.y, SYSTEM_ICON / 2);
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

    // Режим карты меняют и переключателем над холстом, и пунктом навигации:
    // подсветка в меню должна следовать за тем, что на экране, иначе игрок
    // видит «карту галактики» на подсвеченном пункте «карта системы».
    if (MAP_TABS.has(state.activeTab)) {
      state.activeTab = mode === 'galaxy' ? 'galaxy' : 'map';
      markActiveTab();
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
    renderSyndicateTag();
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

  /** Тег синдиката в шапке: у командира без синдиката метки просто нет. */
  function renderSyndicateTag() {
    const mine = syndicate.data && syndicate.data.mine;
    el.syndicateTag.hidden = !mine;
    if (mine) el.syndicateTag.textContent = `[${mine.tag}]`;
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

  const DEFENSE_SIM_LABELS = { CANNON: 'Пушечные турели', LASER: 'Лазерные турели' };

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
  /* ---------- Отчет разведки ---------- */

  /*
   * Порядок ступеней шпионажа — тот же, что на сервере (`game/espionage.ts`).
   * Держать его здесь копией приходится потому, что клиент не импортирует
   * игровые модули; расхождение поймает глаз на первом же отчете, зато
   * интерфейс не тянет за собой половину сервера.
   */
  const SPY_TIERS = ['NONE', 'BUILDINGS', 'FLEET_COUNT', 'DEFENCE_COUNT', 'DEFENCE_TYPES', 'FULL_FORCES', 'TECHS'];
  const spyReaches = (detail, floor) => SPY_TIERS.indexOf(detail) >= SPY_TIERS.indexOf(floor);

  const SPY_TIER_LABELS = {
    NONE: 'Дрон потерян',
    BUILDINGS: 'Только постройки',
    FLEET_COUNT: 'Флот числом',
    DEFENCE_COUNT: 'Флот и оборона числом',
    DEFENCE_TYPES: 'Оборона по типам',
    FULL_FORCES: 'Силы и склад по составу',
    TECHS: 'Полный доступ',
  };

  /*
   * Названия построек и технологий у клиента свои: с сервера они приходят
   * только в карточках своей базы, а отчет разведки говорит о чужой.
   * Расхождение с `rules.ts` и `techTree.ts` видно глазами на первом же
   * отчете — тащить ради подписей половину сервера незачем.
   */
  const BUILD_LABELS = {
    ORE_MINE: 'Рудная шахта',
    POLYMER_PLANT: 'Полимерный завод',
    PLASMA_REACTOR: 'Плазменный реактор',
    POWER_PLANT: 'Энергостанция',
    SCIENCE_CENTER: 'Научный центр',
    SHIPYARD: 'Верфь',
    ANTIMATTER_FACTORY: 'Фабрика антиматерии',
    CRYPTO_FARM: 'Крипто-ферма',
    ORE_STORAGE: 'Рудный склад',
    POLYMER_STORAGE: 'Склад полимеров',
    PLASMA_STORAGE: 'Плазмохранилище',
  };

  const TECH_LABELS = {
    ENERGY_TECH: 'Энергетика',
    COMPUTING_TECH: 'Вычислительная техника',
    WEAPONS_TECH: 'Оружейная',
    SHIELDS_TECH: 'Щитовая',
    ARMOR_TECH: 'Бронебойная',
    MINING_TECH: 'Горное дело',
    COMBUSTION_DRIVE: 'Реактивный двигатель',
    HYPERSPACE_PHYSICS: 'Гиперпространство',
    HYPERDRIVE: 'Гипердвигатель',
    ASTROPHYSICS: 'Астрофизика',
    ROBOTICS: 'Робототехника',
    CRYPTO_TECH: 'Криптоинженерия',
    VAULT_TECH: 'Бункерование',
    ESPIONAGE: 'Шпионаж',
    TIME_COMPRESSION: 'Сжатие времени',
  };

  /**
   * Письмо разведки — в отчет.
   *
   * Нагрузка письма лежит в базе и переживает изменения игры (правило 9):
   * отчет, снятый до появления ступеней шпионажа, приходит без `outcome`,
   * и читать его надо как полный доступ — тогда разведка показывала все.
   */
  function spyReportFromMail(message) {
    const p = message.payload;
    if (!p || !p.planetName) return null;
    const outcome = p.outcome ?? {};
    /*
     * У писем, отправленных до появления ступеней, отметки нет — ступень
     * выводится из того, что реально лежит в нагрузке. Считать их полным
     * доступом наотмашь неверно: сервер теперь кладет в письмо только то,
     * до чего дотянулся зонд, и отсутствие поля само по себе есть ответ.
     */
    const implied = p.techs
      ? 'TECHS'
      : p.fleet || p.resources
        ? 'FULL_FORCES'
        : p.defenses
          ? 'DEFENCE_TYPES'
          : typeof p.defenceTotal === 'number'
            ? 'DEFENCE_COUNT'
            : typeof p.fleetTotal === 'number'
              ? 'FLEET_COUNT'
              : 'BUILDINGS';
    return {
      planetName: p.planetName,
      systemName: p.systemName ?? null,
      planetType: p.planetType ?? null,
      owner: p.owner ?? null,
      colonized: p.colonized !== false,
      detail: outcome.detail ?? implied,
      resourcesSeen: outcome.resourcesSeen !== false,
      droneLost: outcome.droneLost === true || p.droneLost === true,
      richness: p.richness ?? null,
      buildings: p.buildings ?? null,
      // Сервер кладет в письмо только то, до чего дотянулся зонд: там, где
      // положено видеть одно число, приходит число, а не состав.
      resources: p.resources ?? null,
      resourcesTotal: typeof p.resourcesTotal === 'number' ? p.resourcesTotal : null,
      fleet: p.fleet ?? null,
      fleetTotal: typeof p.fleetTotal === 'number' ? p.fleetTotal : null,
      defenses: p.defenses ?? null,
      defenceTotal: typeof p.defenceTotal === 'number' ? p.defenceTotal : null,
      techs: p.techs ?? null,
      date: message.createdAt,
    };
  }

  const sumCounts = (counts) =>
    counts ? Object.values(counts).reduce((total, value) => total + Math.max(0, value || 0), 0) : 0;

  /** Плитка с картинкой и числом: ими показываются флот, оборона и постройки. */
  function spyTile(folder, type, label, value, caption) {
    const tile = document.createElement('div');
    tile.className = 'spy-tile';

    const art = document.createElement('div');
    art.className = 'spy-tile-art';
    const img = document.createElement('img');
    img.src = `/assets/${folder}/${type.toLowerCase()}.webp`;
    img.alt = '';
    img.loading = 'lazy';
    // Битую ссылку обязательно снимать обработчиком: без него браузер рисует
    // на месте картинки собственную иконку «сломано» поверх заглушки.
    img.addEventListener('error', () => {
      art.classList.add('art-missing');
      img.remove();
    });
    art.appendChild(img);

    const badge = document.createElement('span');
    badge.className = 'spy-tile-value';
    badge.textContent = value;
    art.appendChild(badge);

    const name = document.createElement('span');
    name.className = 'spy-tile-label';
    name.textContent = label;

    tile.append(art, name);
    if (caption) {
      const note = document.createElement('span');
      note.className = 'spy-tile-note';
      note.textContent = caption;
      tile.appendChild(note);
    }
    return tile;
  }

  /** Раздел отчета: заголовок и содержимое либо честная причина пустоты. */
  function spySection(title, node, blocked) {
    const section = document.createElement('section');
    section.className = 'spy-section';
    const head = document.createElement('h4');
    head.textContent = title;
    section.appendChild(head);
    if (node) {
      section.appendChild(node);
    } else {
      const empty = document.createElement('p');
      empty.className = 'spy-blocked';
      empty.textContent = blocked;
      section.appendChild(empty);
    }
    return section;
  }

  /**
   * Отчет разведки.
   *
   * Раньше это был текст в шесть строк, по которому нельзя было ни оценить
   * цель, ни понять, почему половина полей пуста. Теперь у каждой цифры своя
   * картинка, а причина пустоты названа: «зонд не дотянулся» — это не то же
   * самое, что «там ничего нет», и решают эти две новости разное.
   */
  function renderSpyReport(report) {
    const card = document.createElement('article');
    card.className = 'spy-report';
    if (report.droneLost) card.classList.add('lost');

    /* Шапка: портрет планеты, адрес, владелец и до чего дотянулся зонд. */
    const header = document.createElement('header');
    header.className = 'spy-head';

    const portrait = document.createElement('div');
    portrait.className = 'spy-portrait';
    const art = PLANET_ART[report.planetType] || 'rocky';
    const planetImg = document.createElement('img');
    planetImg.src = `/assets/planets/${art}.webp`;
    planetImg.alt = '';
    planetImg.addEventListener('error', () => {
      portrait.classList.add('art-missing');
      planetImg.remove();
    });
    portrait.appendChild(planetImg);

    const who = document.createElement('div');
    who.className = 'spy-who';
    who.innerHTML =
      `<b>${escapeHtml(report.planetName)}</b>` +
      (report.systemName ? `<span>система ${escapeHtml(report.systemName)}</span>` : '') +
      `<span>${report.owner ? `владелец <b>${escapeHtml(report.owner)}</b>` : 'колонии нет'}</span>`;

    const tier = document.createElement('span');
    tier.className = `spy-tier ${report.droneLost ? 'bad' : spyReaches(report.detail, 'FULL_FORCES') ? 'deep' : ''}`;
    tier.textContent = SPY_TIER_LABELS[report.detail] || report.detail;

    header.append(portrait, who, tier);
    if (report.date) {
      const date = document.createElement('span');
      date.className = 'spy-date';
      date.textContent = new Date(report.date).toLocaleString('ru-RU');
      header.appendChild(date);
    }
    card.appendChild(header);

    /* Сбитый дрон: докладывать нечего, и вся остальная разметка не нужна. */
    if (report.droneLost) {
      const lost = document.createElement('p');
      lost.className = 'spy-blocked';
      lost.textContent =
        'Зонд не вышел на связь: там знали, что он летит. Пока «Шпионаж» не подтянут, посылать туда нечего.';
      card.appendChild(lost);
      return card;
    }

    if (!report.colonized) {
      const empty = document.createElement('p');
      empty.className = 'spy-blocked';
      empty.textContent = 'Колонии нет, следов активности не обнаружено.';
      card.appendChild(empty);
      return card;
    }

    /* Недра: та же шкала, что в паспорте колонии — единица посередине. */
    if (report.richness) {
      const grid = document.createElement('div');
      grid.className = 'spy-richness';
      for (const [key, label] of [
        ['ore', 'Руда'],
        ['polymers', 'Полимеры'],
        ['plasma', 'Плазма'],
        ['energy', 'Инсоляция'],
        ['antimatter', 'Антиматерия'],
      ]) {
        const value = report.richness[key];
        if (typeof value !== 'number') continue;
        const row = document.createElement('div');
        row.className = 'spy-rich-row';
        row.innerHTML =
          `<span>${label}</span>` +
          `<span class="spy-bar"><i style="width:${Math.min(100, (value / 2) * 100).toFixed(0)}%"></i></span>` +
          `<b>×${value.toFixed(2)}</b>`;
        grid.appendChild(row);
      }
      card.appendChild(spySection('Богатство недр', grid, ''));
    }

    /* Склад. */
    const stock = report.resources;
    if (!report.resourcesSeen) {
      card.appendChild(spySection('Склад', null, 'К учету подобраться не вышло.'));
    } else if (spyReaches(report.detail, 'FULL_FORCES') && stock) {
      const row = document.createElement('div');
      row.className = 'spy-stock';
      for (const [key, name] of [['ore', 'ore'], ['polymers', 'polymers'], ['plasma', 'plasma']]) {
        const cell = document.createElement('span');
        cell.className = 'spy-stock-cell';
        cell.innerHTML = `${icon(name, 'sm')}<b>${fmt(stock[key] ?? 0)}</b>`;
        row.appendChild(cell);
      }
      card.appendChild(spySection('Склад', row, ''));
    } else if (spyReaches(report.detail, 'FLEET_COUNT') && report.resourcesTotal !== null) {
      const total = report.resourcesTotal;
      const row = document.createElement('div');
      row.className = 'spy-rough';
      row.innerHTML = `<b>${fmt(total)}</b><span>единиц всего — что именно лежит, различить не удалось</span>`;
      card.appendChild(spySection('Склад', row, ''));
    } else {
      card.appendChild(spySection('Склад', null, 'Зонд не дотянулся.'));
    }

    /* Флот. */
    if (spyReaches(report.detail, 'FULL_FORCES') && report.fleet) {
      const grid = document.createElement('div');
      grid.className = 'spy-grid';
      for (const [type, count] of Object.entries(report.fleet)) {
        if (!count) continue;
        grid.appendChild(spyTile('ships', type, SHIP_LABELS[type] || type, fmt(count)));
      }
      card.appendChild(
        spySection('Флот на орбите', grid.children.length ? grid : null, 'Орбита пуста.'),
      );
    } else if (spyReaches(report.detail, 'FLEET_COUNT')) {
      const rough = document.createElement('div');
      rough.className = 'spy-rough';
      rough.innerHTML =
        `<b>${fmt(report.fleetTotal ?? sumCounts(report.fleet))}</b>` +
        '<span>вымпелов на орбите — классы различить не удалось</span>';
      card.appendChild(spySection('Флот на орбите', rough, ''));
    } else {
      card.appendChild(spySection('Флот на орбите', null, 'Зонд не дотянулся.'));
    }

    /* Оборона. */
    if (spyReaches(report.detail, 'DEFENCE_TYPES') && report.defenses) {
      const grid = document.createElement('div');
      grid.className = 'spy-grid';
      for (const [type, count] of Object.entries(report.defenses)) {
        if (!count) continue;
        grid.appendChild(spyTile('defense', type, DEFENSE_LABELS[type] || type, fmt(count)));
      }
      card.appendChild(spySection('Оборона', grid.children.length ? grid : null, 'Планета не укреплена.'));
    } else if (spyReaches(report.detail, 'DEFENCE_COUNT')) {
      const rough = document.createElement('div');
      rough.className = 'spy-rough';
      rough.innerHTML =
        `<b>${fmt(report.defenceTotal ?? sumCounts(report.defenses))}</b>` +
        '<span>огневых точек — типы различить не удалось</span>';
      card.appendChild(spySection('Оборона', rough, ''));
    } else {
      card.appendChild(spySection('Оборона', null, 'Зонд не дотянулся.'));
    }

    /* Постройки: их видно на любой уцелевшей ступени. */
    if (report.buildings) {
      const grid = document.createElement('div');
      grid.className = 'spy-grid';
      for (const [type, level] of Object.entries(report.buildings)) {
        if (!level) continue;
        grid.appendChild(spyTile('buildings', type, BUILD_LABELS[type] || type, `ур. ${level}`));
      }
      card.appendChild(spySection('Инфраструктура', grid.children.length ? grid : null, 'Ничего не построено.'));
    }

    /* Технологии — только с верхней ступени. */
    if (spyReaches(report.detail, 'TECHS') && report.techs) {
      const list = document.createElement('div');
      list.className = 'spy-techs';
      for (const [tech, level] of Object.entries(report.techs)) {
        if (!level) continue;
        const chip = document.createElement('span');
        chip.className = 'spy-tech';
        chip.innerHTML = `${escapeHtml(TECH_LABELS[tech] || tech)}<b>${level}</b>`;
        list.appendChild(chip);
      }
      card.appendChild(spySection('Технологии', list.children.length ? list : null, 'Не изучено ничего.'));
    }

    return card;
  }

  /**
   * Письмо о чужом зонде над своей планетой.
   *
   * Отдельный вид: здесь нечего раскладывать по полкам, важно одно — кто
   * приходил и что успел прочесть. Подробность решает уровень контрразведки.
   */
  function renderIntrusion(message) {
    const p = message.payload;
    if (!p || !p.alert) return null;

    const card = document.createElement('article');
    card.className = 'spy-report intrusion';

    const header = document.createElement('header');
    header.className = 'spy-head';
    const mark = document.createElement('div');
    mark.className = 'spy-intruder';
    mark.textContent = p.spyName ? p.spyName.slice(0, 1).toUpperCase() : '?';

    const who = document.createElement('div');
    who.className = 'spy-who';
    who.innerHTML =
      `<b>${p.spyName ? escapeHtml(p.spyName) : 'Неизвестный'}</b>` +
      `<span>чужой зонд над ${escapeHtml(p.planetName ?? 'нашей колонией')}</span>` +
      (p.spyHome ? `<span>пришел с ${escapeHtml(p.spyHome)}</span>` : '');

    const tier = document.createElement('span');
    tier.className = `spy-tier ${p.droneLost ? 'deep' : 'bad'}`;
    tier.textContent = p.droneLost ? 'Дрон сбит' : 'Ушел безнаказанно';

    header.append(mark, who, tier);
    if (message.createdAt) {
      const date = document.createElement('span');
      date.className = 'spy-date';
      date.textContent = new Date(message.createdAt).toLocaleString('ru-RU');
      header.appendChild(date);
    }
    card.appendChild(header);

    const body = document.createElement('p');
    body.className = 'spy-blocked';
    body.textContent = message.body;
    card.appendChild(body);
    return card;
  }

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
    { key: 'FLEET', label: 'Логистика' },
    { key: 'ADMIN', label: 'Администрация' },
  ];

  const MAIL_KIND_LABELS = {
    PLAYER: 'личное',
    SYNDICATE: 'синдикат',
    BATTLE_REPORT: 'бой',
    SPY_REPORT: 'разведка',
    EXPEDITION: 'экспедиция',
    FLEET: 'логистика',
    ADMIN: 'администрация',
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
        // Разведка бывает двух видов: наш отчет о чужой планете и тревога
        // о чужом зонде над своей. Различает их наличие поля `alert`.
        const spy =
          message.type === 'SPY_REPORT'
            ? message.payload?.alert
              ? renderIntrusion(message)
              : (() => {
                  const scan = spyReportFromMail(message);
                  return scan ? renderSpyReport(scan) : null;
                })()
            : null;
        if (report) {
          item.appendChild(renderBattleReport(report));
        } else if (spy) {
          item.appendChild(spy);
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

      // Отчет заканчивался тупиком: «нашли планету, дальше ищи руками».
      // Кнопка открывает систему цели и наводит на нее форму отправки.
      const planetTarget = mailPlanetTarget(message.payload);
      if (planetTarget) {
        const goto = document.createElement('button');
        goto.type = 'button';
        goto.className = 'ghost';
        // В тревоге о чужом зонде координаты ведут не к своей планете,
        // а к дому нарушителя — и подпись должна говорить об этом прямо,
        // иначе кнопка выглядит предложением слетать к самому себе.
        goto.textContent = message.payload && message.payload.alert ? 'К нарушителю' : 'К планете';
        goto.addEventListener('click', () => void openPlanetFromMail(planetTarget));
        actions.appendChild(goto);
      }

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
          el.mailCompose.hidden = false;
          el.mailComposeToggle.classList.add('active');
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


  /* ---------- Рейтинг ---------- */

  const rating = { data: null, mode: 'players' };

  /*
   * Слагаемые счета. Порядок тот же, что в формуле: сперва то, что лежит,
   * потом то, во что вложено, — так строка читается как объяснение суммы.
   */
  const SCORE_PARTS = [
    { key: 'resources', label: 'ресурсы' },
    { key: 'fleet', label: 'флот' },
    { key: 'defense', label: 'оборона' },
    { key: 'buildings', label: 'постройки' },
    { key: 'research', label: 'технологии' },
  ];

  async function loadRating() {
    const result = await api('/api/leaderboard');
    if (!result.ok) return;
    rating.data = result.data;
    renderRating();
  }

  function renderRating() {
    const data = rating.data;
    if (!data) return;

    el.ratingNote.textContent =
      'Счет — это ресурсы на руках плюс стоимость всего, что построено и не потеряно: ' +
      'флот (включая тот, что в полете), оборона, здания и технологии. ' +
      'Все ресурсы считаются один к одному.';

    renderMyRank(data.me, data.players.length);

    for (const button of el.ratingModes.querySelectorAll('.mode')) {
      button.classList.toggle('active', button.dataset.rating === rating.mode);
    }

    if (rating.mode === 'syndicates') renderSyndicateRating(data.syndicates);
    else renderPlayerRating(data.players, data.me);
  }

  /** Своя строка отдельно: игрок может не попасть в показанную сотню. */
  function renderMyRank(me, shown) {
    if (!me) {
      el.ratingMine.hidden = true;
      return;
    }
    el.ratingMine.hidden = false;
    const parts = SCORE_PARTS.map(
      (part) => `<span><i>${part.label}</i>${fmt(me.score[part.key])}</span>`,
    ).join('');
    el.ratingMine.innerHTML =
      `<div class="rating-mine-head"><b>#${me.rank}</b> ${escapeHtml(me.nickname)}` +
      `<em>${fmt(me.score.total)}</em></div>` +
      `<div class="rating-parts">${parts}</div>` +
      (me.rank > shown ? '<p class="storage-note">В таблице ниже показана первая сотня.</p>' : '');
  }

  function renderPlayerRating(players, me) {
    el.ratingHead.innerHTML =
      '<tr><th>#</th><th>Командир</th><th>Счет</th><th>Ресурсы</th><th>Флот</th>' +
      '<th>Оборона</th><th>Постройки</th><th>Технологии</th><th>Колоний</th></tr>';

    el.ratingRows.innerHTML = '';
    for (const row of players) {
      const tr = document.createElement('tr');
      if (me && row.commanderId === me.commanderId) tr.className = 'rating-self';
      const tag = row.syndicate ? ` <span class="rating-tag">[${escapeHtml(row.syndicate.tag)}]</span>` : '';
      tr.innerHTML =
        `<td>${row.rank}</td><td>${escapeHtml(row.nickname)}${tag}</td>` +
        `<td><b>${fmt(row.score.total)}</b></td>` +
        SCORE_PARTS.map((part) => `<td>${fmt(row.score[part.key])}</td>`).join('') +
        `<td>${row.colonies}</td>`;
      el.ratingRows.appendChild(tr);
    }

    if (!players.length) {
      el.ratingRows.innerHTML = '<tr><td colspan="9">Пока никого нет</td></tr>';
    }
  }

  function renderSyndicateRating(syndicates) {
    el.ratingHead.innerHTML =
      '<tr><th>#</th><th>Синдикат</th><th>Счет</th><th>Состав</th><th>В среднем</th></tr>';

    el.ratingRows.innerHTML = '';
    for (const row of syndicates) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${row.rank}</td>` +
        `<td><span class="rating-tag">[${escapeHtml(row.tag)}]</span> ${escapeHtml(row.name)}</td>` +
        `<td><b>${fmt(row.total)}</b></td><td>${row.members}</td><td>${fmt(row.average)}</td>`;
      el.ratingRows.appendChild(tr);
    }

    if (!syndicates.length) {
      el.ratingRows.innerHTML = '<tr><td colspan="5">Синдикатов пока нет</td></tr>';
    }
  }

  el.ratingModes.addEventListener('click', (event) => {
    const button = event.target.closest('.mode');
    if (!button || button.dataset.rating === rating.mode) return;
    rating.mode = button.dataset.rating;
    renderRating();
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
    el.adminGroup.hidden = !isAdmin;
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

  /*
   * Сводка по серверу. Онлайн считает тик по живым сокетам, остальное —
   * запросы к БД, поэтому дашборд обновляется при открытии раздела,
   * а не каждую секунду: считать девять агрегатов на тик незачем.
   */
  const DASHBOARD_CELLS = [
    { key: 'online', label: 'сейчас в сети', tone: 'ok' },
    { key: 'activeToday', label: 'заходили сегодня' },
    { key: 'registeredToday', label: 'новых сегодня' },
    { key: 'activeWeek', label: 'заходили за неделю' },
    { key: 'commanders', label: 'командиров' },
    { key: 'accounts', label: 'учетных записей' },
    { key: 'blocked', label: 'заблокировано', tone: 'bad' },
    { key: 'colonies', label: 'колоний' },
    { key: 'fleetsInFlight', label: 'флотов в полете' },
    { key: 'syndicates', label: 'синдикатов' },
  ];

  /* ------------------------- Боты ------------------------- */

  const bots = { characters: [], systems: [] };

  /**
   * Список ботов и справочники к форме.
   *
   * Характеры приходят с сервера вместе с описаниями: клиент не должен знать,
   * чем агрессор отличается от торговца, — это игровое правило, а не верстка.
   */
  async function loadBots() {
    const result = await api('/api/admin/bots');
    if (!result.ok) return;

    bots.characters = result.data.characters || [];
    if (!el.botCharacter.options.length) {
      for (const item of bots.characters) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        el.botCharacter.appendChild(option);
      }
      syncBotHint();
    }

    // Системы берем с карты галактики: отдельного справочника для этого
    // заводить незачем, а координаты игроку нужны, чтобы поселить бота рядом.
    if (!bots.systems.length) {
      const galaxy = await api('/api/galaxy');
      if (galaxy.ok) {
        bots.systems = galaxy.data.systems || [];
        el.botSystem.innerHTML = '<option value="">Любая свободная планета</option>';
        for (const system of bots.systems) {
          const option = document.createElement('option');
          option.value = system.systemId;
          option.textContent =
            `${system.name} (${system.galaxyX}:${system.galaxyY})` + (system.isHome ? ' — твоя' : '');
          el.botSystem.appendChild(option);
        }
      }
    }

    renderBotRows(result.data.bots || []);
  }

  function syncBotHint() {
    const chosen = bots.characters.find((item) => item.id === el.botCharacter.value);
    el.botCharacterHint.textContent = chosen ? chosen.description : '';
  }

  function renderBotRows(list) {
    el.botRows.innerHTML = '';
    if (!list.length) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="6">Ботов пока нет</td>';
      el.botRows.appendChild(row);
      return;
    }

    for (const bot of list) {
      const row = document.createElement('tr');
      const when = bot.lastActionAt ? fmtTime(Math.round((Date.now() - bot.lastActionAt) / 1000)) : null;
      row.innerHTML =
        `<td>${escapeHtml(bot.nickname)}${bot.active ? '' : ' <span class="admin-role">пауза</span>'}</td>` +
        `<td>${escapeHtml(bot.characterLabel)}</td>` +
        `<td>${bot.colonies}</td>` +
        `<td>${fmt(bot.score)}</td>` +
        `<td>${bot.lastAction ? escapeHtml(bot.lastAction) + (when ? ` — ${when} назад` : '') : '—'}</td>`;

      const actions = document.createElement('td');
      actions.className = 'bot-actions';

      const nudge = document.createElement('button');
      nudge.type = 'button';
      nudge.className = 'ghost';
      nudge.textContent = 'Ход';
      nudge.title = 'Разбудить немедленно, не дожидаясь расписания';
      nudge.addEventListener('click', () => void botAction(`/api/admin/bots/${bot.id}/nudge`, {}));

      const pause = document.createElement('button');
      pause.type = 'button';
      pause.className = 'ghost';
      pause.textContent = bot.active ? 'Пауза' : 'Пуск';
      pause.addEventListener('click', () =>
        void botAction(`/api/admin/bots/${bot.id}/active`, { active: !bot.active }));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost danger';
      remove.textContent = 'Удалить';
      // Подтверждение встроенное: вторым кликом по той же кнопке.
      // Модальные окна браузера в клиенте запрещены.
      remove.addEventListener('click', () => {
        if (remove.dataset.armed !== 'yes') {
          remove.dataset.armed = 'yes';
          remove.textContent = 'Точно?';
          setTimeout(() => {
            remove.dataset.armed = '';
            remove.textContent = 'Удалить';
          }, 4000);
          return;
        }
        void botAction(`/api/admin/bots/${bot.id}`, undefined, 'DELETE');
      });

      actions.append(nudge, pause, remove);
      row.appendChild(actions);
      el.botRows.appendChild(row);
    }
  }

  async function botAction(url, body, method = 'POST') {
    await send(url, body, method);
    await loadBots();
  }

  el.botCharacter.addEventListener('change', syncBotHint);
  el.botCreate.addEventListener('click', async () => {
    await send('/api/admin/bots', {
      nickname: el.botNickname.value.trim(),
      character: el.botCharacter.value,
      systemId: el.botSystem.value || undefined,
    });
    el.botNickname.value = '';
    await loadBots();
  });

  async function loadAdminDashboard() {
    const result = await api('/api/admin/dashboard');
    if (!result.ok) return;

    el.adminDashboard.innerHTML = '';
    for (const cell of DASHBOARD_CELLS) {
      const value = Number(result.data[cell.key]) || 0;
      const node = document.createElement('div');
      // Нулевые «заблокировано» красным не красим: ноль здесь хорошая новость.
      node.className = `admin-stat${cell.tone && value > 0 ? ' ' + cell.tone : ''}`;
      node.innerHTML = `<b>${fmt(value)}</b><span>${cell.label}</span>`;
      el.adminDashboard.appendChild(node);
    }
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

  const PROVIDER_LABELS = { LOCAL: 'пароль', GOOGLE: 'Google', APPLE: 'Apple', FACEBOOK: 'Facebook' };

  const fmtDateTime = (value) => (value ? new Date(value).toLocaleString('ru-RU') : 'никогда');

  /**
   * Учетная запись игрока и действия над ней.
   *
   * Отделена от игровых чисел намеренно: правка ресурсов и закрытие доступа —
   * разные по последствиям вещи, и складывать их в одну форму «Сохранить»
   * значит однажды заблокировать игрока, поправляя ему руду.
   */
  function renderAdminAccount(detail) {
    const account = detail.account;
    const box = document.createElement('div');
    box.className = 'admin-group admin-account';

    const blocked = Boolean(account.blockedAt);
    box.innerHTML =
      '<h4>Учетная запись</h4>' +
      '<div class="admin-account-facts">' +
      `<div><span>Почта</span><b>${escapeHtml(account.email)}</b></div>` +
      `<div><span>Вход</span><b>${PROVIDER_LABELS[account.authProvider] || account.authProvider}</b></div>` +
      `<div><span>Зарегистрирован</span><b>${fmtDateTime(account.createdAt)}</b></div>` +
      `<div><span>Последний вход</span><b>${fmtDateTime(account.lastLoginAt)}</b></div>` +
      `<div><span>Права</span><b>${account.role}</b></div>` +
      `<div><span>Доступ</span><b class="${blocked ? 'bad' : 'ok'}">` +
      `${blocked ? 'заблокирован ' + fmtDateTime(account.blockedAt) : 'открыт'}</b></div>` +
      '</div>';

    const actions = document.createElement('div');
    actions.className = 'admin-account-actions';

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.className = 'ghost';
    resetButton.textContent = 'Выдать код смены пароля';
    resetButton.addEventListener('click', () => void issueReset(detail.commanderId));

    const blockButton = document.createElement('button');
    blockButton.type = 'button';
    blockButton.className = 'ghost';
    blockButton.textContent = blocked ? 'Разблокировать' : 'Заблокировать';
    blockButton.addEventListener('click', () => void toggleBlock(detail.commanderId, !blocked));

    actions.append(resetButton, blockButton);
    box.appendChild(actions);

    // Код смены пароля показывается здесь же: передать его игроку — забота
    // администратора, сервер писем пока не отправляет.
    const reset = document.createElement('p');
    reset.className = 'admin-reset';
    reset.hidden = true;
    adminInputs.resetNote = reset;
    box.appendChild(reset);

    box.appendChild(renderAdminMessageForm(detail));
    box.appendChild(renderAdminDangerZone(detail));
    return box;
  }

  /** Письмо игроку от гейм-мастера: уходит системным отправителем с типом ADMIN. */
  function renderAdminMessageForm(detail) {
    const form = document.createElement('div');
    form.className = 'admin-subform';
    form.innerHTML =
      '<h5>Написать игроку</h5>' +
      '<label class="field"><span>Тема</span><input type="text" maxlength="120"></label>' +
      '<label class="field"><span>Текст</span><textarea rows="3" maxlength="4000"></textarea></label>';

    const [subject] = form.getElementsByTagName('input');
    const [body] = form.getElementsByTagName('textarea');
    const sendButton = document.createElement('button');
    sendButton.type = 'button';
    sendButton.className = 'ghost';
    sendButton.textContent = 'Отправить';
    sendButton.addEventListener('click', async () => {
      const ok = await send(`/api/admin/commanders/${detail.commanderId}/message`, {
        subject: subject.value,
        body: body.value,
      });
      if (ok) {
        subject.value = '';
        body.value = '';
      }
    });
    form.appendChild(sendButton);
    return form;
  }

  /**
   * Удаление учетной записи. Отделено рамкой и требует ввести позывной:
   * каскад унесет колонии, флоты и синдикат, если игрок был лидером,
   * а отменить это нечем.
   */
  function renderAdminDangerZone(detail) {
    const zone = document.createElement('div');
    zone.className = 'admin-danger';
    zone.innerHTML =
      '<h5>Удаление учетной записи</h5>' +
      '<p>Необратимо. Вместе с аккаунтом исчезнут колонии (планеты освободятся), ' +
      'флоты и синдикат, если игрок им руководил.</p>' +
      `<label class="field"><span>Введи позывной «${escapeHtml(detail.nickname)}» для подтверждения</span>` +
      '<input type="text" autocomplete="off"></label>';

    const [confirm] = zone.getElementsByTagName('input');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Удалить навсегда';
    remove.addEventListener('click', async () => {
      const ok = await send(`/api/admin/commanders/${detail.commanderId}`, { confirm: confirm.value }, 'DELETE');
      if (ok) {
        admin.detail = null;
        admin.selected = null;
        el.adminDetail.innerHTML = '<p class="storage-note">Учетная запись удалена.</p>';
        await loadAdminList();
        await loadAdminDashboard();
      }
    });
    zone.appendChild(remove);
    return zone;
  }

  async function issueReset(commanderId) {
    const result = await api(`/api/admin/commanders/${commanderId}/password-reset`, { method: 'POST' });
    if (!result.ok) {
      showBuildMessage(result.data.error || 'Не удалось выдать код', false);
      return;
    }
    const note = adminInputs.resetNote;
    if (!note) return;
    note.hidden = false;
    note.innerHTML =
      `Код: <b>${escapeHtml(result.data.token)}</b><br>` +
      `Действует до ${fmtDateTime(result.data.expiresAt)}. Передай его игроку — ` +
      'пароль он задаст себе сам.';
    showBuildMessage(result.data.message, true);
  }

  async function toggleBlock(commanderId, blocked) {
    const ok = await send(`/api/admin/commanders/${commanderId}/block`, { blocked });
    if (ok) await openAdminCommander(commanderId);
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

    el.adminDetail.appendChild(renderAdminAccount(detail));

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

  void initGoogleSignIn();

  /*
   * Вход внутри Telegram.
   *
   * Мини-приложение открывается уже опознанным: Telegram кладет в initData
   * подписанные данные пользователя, и спрашивать пароль в этой обертке
   * незачем — там нет ни клавиатуры под почту, ни смысла заводить второй
   * способ входа. Подпись проверяет сервер (правило 3); клиент только
   * передает строку как есть.
   *
   * Сохраненный токен имеет приоритет: если игрок уже вошел, дергать
   * Telegram незачем.
   */
  async function signInWithTelegram() {
    const webApp = window.Telegram && window.Telegram.WebApp;
    if (!webApp || !webApp.initData) return false;

    // Разворачиваем окно и снимаем свайп-закрытие: иначе карту нельзя
    // потянуть пальцем — жест уходит Telegram и сворачивает приложение.
    if (typeof webApp.expand === 'function') webApp.expand();
    if (typeof webApp.disableVerticalSwipes === 'function') webApp.disableVerticalSwipes();
    if (typeof webApp.ready === 'function') webApp.ready();

    const result = await api('/api/auth/oauth/telegram', {
      method: 'POST',
      body: JSON.stringify({ idToken: webApp.initData }),
    });
    if (!result.ok) {
      showAuthMessage(el.authMessage, result.data.error || 'Telegram не пустил', false);
      return false;
    }

    state.token = result.data.token;
    localStorage.setItem(TOKEN_KEY, state.token);
    await startSession();
    return true;
  }

  if (state.token) {
    startSession().catch(() => showScreen('auth'));
  } else {
    signInWithTelegram()
      .catch(() => false)
      .then((entered) => {
        if (!entered) showScreen('auth');
      });
  }
})();

/**
 * Spider-Buddy — toolbar popup.
 * Reads state from the background, renders it, and sends user changes back.
 * Stays live via chrome.storage.onChanged.
 */

const Schema = globalThis.WeblingSchema;
const Progression = globalThis.WeblingProgression;
const Sprite = globalThis.WeblingSprite;
const Dialogue = globalThis.WeblingDialogue;

const CONTENT_FILES = ['shared/schema.js', 'shared/dialogue.js', 'shared/progression.js', 'shared/sprite-pixels.js', 'shared/sprite.js', 'content/content.js'];

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let state = Schema.sanitize({});
let tab = null;
let host = '';
let supported = false;
let selectedMinutes = 25;
let renderQueued = false;
let ticker = 0;

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err) {
    console.warn('[Spider-Buddy popup]', message.type, err);
    return null;
  }
}

const setSettings = (settings) => {
  Object.assign(state, settings);
  queueRender();
  return send({ type: 'UPDATE_SETTINGS', settings });
};

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------------------------------------------------------------------------
// Tabs (WAI-ARIA tabs pattern with arrow keys)
// ---------------------------------------------------------------------------

function selectTab(id, focus = false) {
  for (const t of $$('.tab')) {
    const on = t.id === id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
    if (on && focus) t.focus();
  }
  try { localStorage.setItem('webling.tab', id); } catch { /* ignore */ }
}

function setupTabs() {
  const tabs = $$('.tab');
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t.id));
    t.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[e.key];
      if (d === undefined) return;
      e.preventDefault();
      selectTab(tabs[(i + d + tabs.length) % tabs.length].id, true);
    });
  });
  let saved = null;
  try { saved = localStorage.getItem('webling.tab'); } catch { /* ignore */ }
  if (saved && $(saved)) selectTab(saved);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  renderHeader();
  renderSite();
  renderToday();
  renderFocus();
  renderProgress();
  renderStyle();
  renderSettings();
}

function lookNow() {
  return Progression.resolveEquipped(state.equippedCosmetics, state.cosmeticsUnlocked);
}

function renderHeader() {
  const l = lookNow();
  const key = `${l.theme}|${l.badge}`;
  const avatar = $('avatar');
  if (avatar.dataset.look !== key) {
    avatar.dataset.look = key;
    avatar.innerHTML = Sprite.frameSvg('idle', l.theme, { uid: 'pop-avatar', acc: l.badge, viewBox: '8 26 84 84' });
  }
  $('enabled').checked = state.enabled;
  const status = $('headerStatus');
  if (!state.enabled) status.textContent = 'Resting — switched off everywhere';
  else if (state.snoozeUntil > Date.now()) status.textContent = `Snoozing until ${new Date(state.snoozeUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  else if (state.focusStatus === 'running') status.textContent = 'Guarding your focus session';
  else if (state.focusStatus === 'break') status.textContent = 'Enjoying a break with you';
  else status.textContent = `${state.personality[0].toUpperCase()}${state.personality.slice(1)} mode · ${state.spiderScore} spiders saved`;
}

function renderSite() {
  const dot = $('siteDot');
  const note = $('siteNote');
  const toggle = $('siteToggle');
  const summon = $('summonBtn');
  const snoozed = state.snoozeUntil > Date.now();
  $('unsnoozeBtn').hidden = !snoozed;

  if (!supported) {
    $('siteHost').textContent = tab && tab.url ? 'Browser page' : 'No page';
    note.textContent = "Chrome doesn't let extensions run here";
    dot.className = 'dot off';
    toggle.hidden = true;
    summon.disabled = true;
    $('battleBtn').disabled = true;
    return;
  }
  toggle.hidden = !host;
  summon.disabled = false;
  $('battleBtn').disabled = false;
  $('siteHost').textContent = host || 'Local file';
  const entry = Schema.findDisablingEntry(host, state.disabledSites);

  if (!state.enabled) {
    dot.className = 'dot off';
    note.textContent = 'Spider-Buddy is switched off';
    $('summonLabel').textContent = 'Turn on & summon';
  } else if (snoozed) {
    dot.className = 'dot warn';
    note.textContent = 'Snoozing everywhere';
    $('summonLabel').textContent = 'Wake & summon';
  } else if (entry) {
    dot.className = 'dot warn';
    note.textContent = entry === Schema.normalizeHost(host) ? 'Hidden on this site' : `Hidden on all of ${entry}`;
    $('summonLabel').textContent = 'Show here & summon';
  } else {
    dot.className = 'dot';
    note.textContent = 'Patrolling this page';
    $('summonLabel').textContent = 'Summon Spider-Buddy';
  }
  toggle.textContent = entry ? 'Show here' : 'Hide here';
  toggle.disabled = !state.enabled;
}

const RING_SMALL = 2 * Math.PI * 15.5;
const RING_BIG = 2 * Math.PI * 52;

function renderToday() {
  // Focus mini card
  const st = state.focusStatus;
  const remaining = Schema.formatClock(Schema.focusRemainingMs(state));
  const btn = $('miniFocusBtn');
  const text = $('miniFocusText');
  if (st === 'running') { text.textContent = `${remaining} left`; btn.textContent = 'Pause'; btn.className = 'btn btn-secondary btn-sm'; }
  else if (st === 'paused') { text.textContent = `Paused · ${remaining} left`; btn.textContent = 'Resume'; btn.className = 'btn btn-primary btn-sm'; }
  else if (st === 'break') { text.textContent = `Break · ${remaining} left`; btn.textContent = 'Skip break'; btn.className = 'btn btn-secondary btn-sm'; }
  else { text.textContent = state.focusCurrentStreak > 0 ? `🔥 ${state.focusCurrentStreak}-day streak — keep it going` : 'Ready when you are'; btn.textContent = `Start ${state.focusDuration}m`; btn.className = 'btn btn-primary btn-sm'; }
  $('miniRing').style.strokeDashoffset = String(RING_SMALL * (1 - Schema.focusProgress(state)));

  // Water
  const count = Schema.effectiveHydration(state);
  const target = state.hydrationTarget;
  $('waterText').textContent = count >= target
    ? `Goal reached! ${count} glasses${state.hydrationCurrentStreak > 1 ? ` · 🔥 ${state.hydrationCurrentStreak} days` : ''}`
    : `${count} of ${target} glasses today`;
  const glasses = $('glasses');
  const shown = Math.max(target, count);
  if (glasses.childElementCount !== shown || glasses.dataset.count !== String(count)) {
    glasses.dataset.count = String(count);
    glasses.innerHTML = '';
    for (let i = 0; i < shown; i++) {
      const g = document.createElement('span');
      g.className = `glass${i < count ? ' full' : ''}${i >= target ? ' bonus' : ''}`;
      glasses.appendChild(g);
    }
  }
  $('waterSub').disabled = count === 0;

  // Week chart
  const days = Schema.recentDays(state.dailyLog, 7);
  const maxF = Math.max(30, ...days.map((d) => d.focus));
  const maxW = Math.max(target, ...days.map((d) => d.water));
  const today = Schema.todayKey();
  const chart = $('weekChart');
  chart.innerHTML = days.map((d) => {
    const label = new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: 'narrow' });
    const fh = Math.round((d.focus / maxF) * 100);
    const wh = Math.round((d.water / maxW) * 100);
    return `<div class="day${d.date === today ? ' today' : ''}" title="${d.date}: ${d.focus} focus min, ${d.water} glasses, ${d.rescues} rescues">
      <div class="bars"><span class="bar f" style="height:${fh}%"></span><span class="bar w" style="height:${wh}%"></span></div>
      <small>${label}</small></div>`;
  }).join('');
}

function renderFocus() {
  const st = state.focusStatus;
  const timer = document.querySelector('.timer');
  timer.className = `timer ${st}`;
  $('timerStatus').textContent = { idle: 'Ready', running: 'Focusing', paused: 'Paused', break: 'Break' }[st];
  $('timerDigits').textContent = st === 'idle' ? Schema.formatClock(selectedMinutes * 60000) : Schema.formatClock(Schema.focusRemainingMs(state));
  $('timerRing').style.strokeDashoffset = String(RING_BIG * (1 - Schema.focusProgress(state)));

  $('fStart').hidden = st !== 'idle';
  $('fPause').hidden = st !== 'running';
  $('fResume').hidden = st !== 'paused';
  $('fSkip').hidden = st !== 'break';
  $('fReset').hidden = st === 'idle';
  document.querySelector('.presets').classList.toggle('locked', st !== 'idle');

  for (const b of $$('.preset')) b.setAttribute('aria-checked', String(Number(b.dataset.min) === selectedMinutes));
  const custom = $('customMin');
  if (document.activeElement !== custom) custom.value = [15, 25, 45, 60].includes(selectedMinutes) ? '' : String(selectedMinutes);
}

function renderProgress() {
  const stats = [
    ['🕷️', state.spiderScore, 'spiders saved'],
    ['🎯', state.focusSessionsCompleted, 'focus sessions'],
    ['⏳', state.focusTotalMinutes, 'focus minutes'],
    ['🔥', `${state.focusCurrentStreak}/${state.focusBestStreak}`, 'focus streak / best'],
    ['💧', state.hydrationGoalsCompleted, 'water goals'],
    ['🌊', `${state.hydrationCurrentStreak}/${state.hydrationBestStreak}`, 'water streak / best'],
  ];
  $('stats').innerHTML = stats.map(([i, v, l]) => `<div class="stat"><span aria-hidden="true">${i}</span><strong>${v}</strong><small>${l}</small></div>`).join('');

  const list = $('achList');
  const items = Progression.ACHIEVEMENTS.map((a) => {
    const rec = state.achievements[a.id];
    const done = Boolean(rec && rec.unlocked);
    const p = Progression.progressOf(a, state);
    return { a, done, p, date: rec && rec.date };
  }).sort((x, y) => Number(y.done) - Number(x.done) || y.p.ratio - x.p.ratio);
  $('achCount').textContent = `${items.filter((i) => i.done).length}/${items.length}`;
  list.replaceChildren(...items.map(({ a, done, p, date }) => {
    const li = document.createElement('li');
    li.className = `ach ${done ? 'done' : 'locked'}`;
    li.innerHTML = `<span class="ach-icon" aria-hidden="true"></span>
      <div class="ach-body"><strong></strong><small></small>${done ? '' : `<div class="meter"><i style="width:${Math.round(p.ratio * 100)}%"></i></div>`}</div>
      <span class="ach-state"></span>`;
    li.querySelector('.ach-icon').textContent = a.icon;
    li.querySelector('strong').textContent = a.name;
    li.querySelector('small').textContent = a.description;
    li.querySelector('.ach-state').textContent = done ? (date ? fmtDate(date) : '✓') : `${p.current}/${p.goal}`;
    li.setAttribute('aria-label', `${a.name}: ${a.description}. ${done ? 'Unlocked' : `${p.current} of ${p.goal}`}`);
    return li;
  }));
}

function fmtDate(key) {
  const d = new Date(`${key}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '✓' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function cosmeticPreview(c, l) {
  switch (c.category) {
    case 'webline': return `<span class="line" style="background:${c.value}"></span>`;
    case 'theme': return Sprite.frameSvg('idle', c.value, { uid: `cos-${c.id}`, acc: l.badge, viewBox: '0 24 100 90' });
    case 'badge': return Sprite.frameSvg('idle', l.theme, { uid: `cos-${c.id}`, acc: c.value, viewBox: '0 24 100 90' });
    default: return `<span aria-hidden="true">${c.icon}</span>`;
  }
}

function renderStyle() {
  for (const b of $$('.persona')) b.setAttribute('aria-checked', String(b.dataset.p === state.personality));
  const sample = $('personaSample');
  if (sample.dataset.p !== state.personality) {
    sample.dataset.p = state.personality;
    sample.textContent = Dialogue.getLine(state.personality, 'greeting');
  }
  for (const b of $$('[data-seg="characterSize"] button')) b.setAttribute('aria-checked', String(b.dataset.v === state.characterSize));

  const l = lookNow();
  const unlocked = new Set(state.cosmeticsUnlocked);
  $('cosCount').textContent = `${Progression.COSMETICS.filter((c) => unlocked.has(c.id)).length}/${Progression.COSMETICS.length}`;
  const key = JSON.stringify([state.cosmeticsUnlocked, state.equippedCosmetics, l, state.spiderScore, state.focusSessionsCompleted, state.focusTotalMinutes, state.hydrationGoalsCompleted, state.hydrationBestStreak, state.focusBestStreak, state.summonCount]);
  const box = $('cosList');
  if (box.dataset.key === key) return;
  box.dataset.key = key;

  const groups = Schema.COSMETIC_CATEGORIES.map((cat) => {
    const items = Progression.COSMETICS.filter((c) => c.category === cat);
    const cards = items.map((c) => {
      const has = unlocked.has(c.id);
      const on = state.equippedCosmetics[cat] === c.id;
      const p = Progression.progressOf(c, state);
      return `<button type="button" class="cos ${has ? '' : 'locked'} ${on ? 'equipped' : ''}" data-cat="${cat}" data-id="${c.id}" ${has ? '' : 'disabled'}
          aria-pressed="${on}" title="${has ? (on ? 'Click to unequip' : 'Click to equip') : c.requirement}">
        <span class="prev">${cosmeticPreview(c, l)}</span>
        <b>${c.name}</b>
        <small>${has ? c.description : c.requirement}</small>
        ${has ? '' : `<span class="meter"><i style="width:${Math.round(p.ratio * 100)}%"></i></span>`}
      </button>`;
    }).join('');
    return `<div class="cos-group"><h3>${Progression.CATEGORY_LABELS[cat]}</h3><div class="cos-row">${cards}</div></div>`;
  });
  box.innerHTML = groups.join('');
}

function renderSettings() {
  for (const el of $$('[data-key]')) {
    if (document.activeElement === el) continue;
    const v = state[el.dataset.key];
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = String(v);
  }
  const remindersOn = state.hydrationRemindersEnabled;
  for (const k of ['hydrationReminderInterval', 'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd']) {
    const el = document.querySelector(`[data-key="${k}"]`);
    if (el) el.disabled = !remindersOn || ((k === 'quietHoursStart' || k === 'quietHoursEnd') && !state.quietHoursEnabled);
  }

  const list = $('sitesList');
  if (state.disabledSites.length === 0) {
    list.innerHTML = '<li class="empty">None — Spider-Buddy visits every site.</li>';
  } else {
    list.replaceChildren(...state.disabledSites.map((h) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = h;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '×';
      b.setAttribute('aria-label', `Show Spider-Buddy on ${h} again`);
      b.addEventListener('click', () => send({ type: 'REMOVE_SITE', hostname: h }));
      li.append(span, b);
      return li;
    }));
  }
}

// ---------------------------------------------------------------------------
// Page intel
// ---------------------------------------------------------------------------

async function loadIntel() {
  const ids = ['iWords', 'iRead', 'iLinks', 'iHeads', 'iImgs'];
  const setAll = (v) => ids.forEach((id) => { $(id).textContent = v; });
  const note = $('intelNote');
  note.textContent = '';
  if (!supported || !tab) { setAll('—'); note.textContent = 'Not available on browser pages.'; return; }
  let resp = null;
  try {
    resp = await chrome.tabs.sendMessage(tab.id, { type: 'WEBLING_STATS' });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
      resp = await chrome.tabs.sendMessage(tab.id, { type: 'WEBLING_STATS' });
    } catch {
      resp = null;
    }
  }
  if (!resp || !resp.intel) { setAll('—'); note.textContent = 'Reload the page to read it.'; return; }
  const i = resp.intel;
  const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString());
  $('iWords').textContent = fmt(i.words);
  $('iRead').textContent = String(i.minutes);
  $('iLinks').textContent = fmt(i.links);
  $('iHeads').textContent = fmt(i.headings);
  $('iImgs').textContent = fmt(i.images);
  if (i.links > 0) note.textContent = `${i.externalLinks} of ${i.links} links go to other sites.`;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function bind() {
  $('enabled').addEventListener('change', (e) => setSettings({ enabled: e.target.checked }));

  $('siteToggle').addEventListener('click', async () => {
    const hidden = Boolean(Schema.findDisablingEntry(host, state.disabledSites));
    const resp = await send({ type: 'TOGGLE_SITE', hostname: host, disabled: !hidden });
    if (resp && resp.success) toast(hidden ? `Spider-Buddy is back on ${host}` : `Hidden on ${host}`);
  });

  // Snooze menu
  const menu = $('snoozeMenu');
  const snoozeBtn = $('snoozeBtn');
  const closeMenu = () => { menu.hidden = true; snoozeBtn.setAttribute('aria-expanded', 'false'); };
  snoozeBtn.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    snoozeBtn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button:not([hidden])').focus();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeMenu(); });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); snoozeBtn.focus(); } });
  for (const b of $$('[data-snooze]', menu)) {
    b.addEventListener('click', async () => {
      let minutes = Number(b.dataset.snooze);
      if (b.dataset.snooze === 'tomorrow') {
        const t = new Date();
        t.setDate(t.getDate() + 1);
        t.setHours(8, 0, 0, 0);
        minutes = Math.ceil((t.getTime() - Date.now()) / 60000);
      }
      closeMenu();
      await send({ type: 'SNOOZE', minutes });
      toast(minutes ? 'Spider-Buddy is snoozing 💤' : 'Spider-Buddy is awake!');
    });
  }

  $('summonBtn').addEventListener('click', async () => {
    const resp = await send({ type: 'SUMMON_WEBLING' });
    if (resp && resp.success) window.close();
    else toast("Spider-Buddy can't visit this page");
  });
  $('battleBtn').addEventListener('click', async () => {
    const resp = await send({ type: 'START_BATTLE' });
    if (resp && resp.success) window.close();
    else toast("The heroes can't fight on this page");
  });

  // Today
  $('miniFocusBtn').addEventListener('click', focusPrimaryAction);
  $('waterAdd').addEventListener('click', async () => {
    const resp = await send({ type: 'HYDRATION_ADD' });
    if (resp && resp.reachedGoal) toast('Water goal reached! 💧');
  });
  $('waterSub').addEventListener('click', () => send({ type: 'HYDRATION_REMOVE' }));
  $('intelRefresh').addEventListener('click', loadIntel);

  // Focus
  for (const b of $$('.preset')) {
    b.addEventListener('click', () => chooseMinutes(Number(b.dataset.min)));
  }
  const custom = $('customMin');
  const applyCustom = () => {
    const v = Math.round(Number(custom.value));
    if (v >= 1 && v <= 180) chooseMinutes(v);
    else if (custom.value) { custom.value = ''; toast('Pick 1–180 minutes'); }
  };
  custom.addEventListener('change', applyCustom);
  custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyCustom(); $('fStart').focus(); } });
  $('fStart').addEventListener('click', () => send({ type: 'FOCUS_START', duration: selectedMinutes }));
  $('fPause').addEventListener('click', () => send({ type: 'FOCUS_PAUSE' }));
  $('fResume').addEventListener('click', () => send({ type: 'FOCUS_RESUME' }));
  $('fSkip').addEventListener('click', () => send({ type: 'FOCUS_SKIP_BREAK' }));
  $('fReset').addEventListener('click', () => send({ type: 'FOCUS_RESET' }));

  // Style
  for (const b of $$('.persona')) b.addEventListener('click', () => setSettings({ personality: b.dataset.p }));
  for (const b of $$('[data-seg="characterSize"] button')) b.addEventListener('click', () => setSettings({ characterSize: b.dataset.v }));
  $('cosList').addEventListener('click', async (e) => {
    const card = e.target.closest('.cos');
    if (!card || card.disabled) return;
    const on = state.equippedCosmetics[card.dataset.cat] === card.dataset.id;
    const resp = await send({ type: 'EQUIP_COSMETIC', category: card.dataset.cat, cosmeticId: on ? '' : card.dataset.id });
    if (resp && resp.success) {
      state.equippedCosmetics = resp.equippedCosmetics;
      queueRender();
    }
  });

  // Generic [data-key] controls
  for (const el of $$('[data-key]')) {
    const key = el.dataset.key;
    const evt = el.type === 'color' ? 'input' : 'change';
    let colorTimer = 0;
    el.addEventListener(evt, () => {
      let value;
      if (el.type === 'checkbox') value = el.checked;
      else if ('num' in el.dataset) value = Number(el.value);
      else value = el.value;
      if (el.type === 'color') {
        clearTimeout(colorTimer);
        colorTimer = setTimeout(() => setSettings({ [key]: value }), 120);
      } else {
        setSettings({ [key]: value });
      }
    });
  }

  // Sites
  $('addSiteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('addSiteInput');
    const h = Schema.normalizeHost(input.value);
    if (!h) { toast('That doesn\'t look like a website'); return; }
    await send({ type: 'TOGGLE_SITE', hostname: h, disabled: true });
    input.value = '';
    toast(`Hidden on ${h}`);
  });

  // Shortcuts, tour, data
  $('shortcutsBtn').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  $('tourBtn').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') }));
  $('exportBtn').addEventListener('click', exportData);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', importData);

  for (const b of $$('[data-reset]')) {
    b.addEventListener('click', async () => {
      if (!window.confirm(b.dataset.confirm)) return;
      const resp = await send({ type: b.dataset.reset });
      if (resp && resp.success) toast('Done');
    });
  }
}

function chooseMinutes(min) {
  selectedMinutes = min;
  if (state.focusDuration !== min) setSettings({ focusDuration: min });
  queueRender();
}

function focusPrimaryAction() {
  const st = state.focusStatus;
  if (st === 'running') send({ type: 'FOCUS_PAUSE' });
  else if (st === 'paused') send({ type: 'FOCUS_RESUME' });
  else if (st === 'break') send({ type: 'FOCUS_SKIP_BREAK' });
  else send({ type: 'FOCUS_START', duration: state.focusDuration });
}

async function exportData() {
  const resp = await send({ type: 'EXPORT_DATA' });
  if (!resp || !resp.success) { toast('Export failed'); return; }
  const blob = new Blob([JSON.stringify(resp.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `webling-backup-${Schema.todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Backup saved');
}

async function importData(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('That file is too big'); return; }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('Not a valid backup file');
    return;
  }
  if (!window.confirm('Replace all current Spider-Buddy data with this backup?')) return;
  const resp = await send({ type: 'IMPORT_DATA', data });
  toast(resp && resp.success ? 'Backup restored' : 'Not a Spider-Buddy backup');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function loadShortcuts() {
  try {
    const cmds = await chrome.commands.getAll();
    const map = Object.fromEntries(cmds.map((c) => [c.name, c.shortcut || '']));
    $('summonKey').textContent = map['summon-webling'] || '';
    for (const k of $$('[data-cmd]')) k.textContent = map[k.dataset.cmd] || 'Not set';
  } catch { /* ignore */ }
}

async function init() {
  setupTabs();
  bind();
  $('version').textContent = `Spider-Buddy ${chrome.runtime.getManifest().version}`;

  const resp = await send({ type: 'GET_STATE' });
  if (resp && resp.success) state = resp.data;
  selectedMinutes = state.focusDuration;

  try {
    // ?tabId= lets tests and store screenshots point the popup at a specific tab.
    const forced = Number(new URLSearchParams(location.search).get('tabId'));
    [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  } catch { tab = null; }
  if (tab && tab.url && /^(https?|file):/.test(tab.url)) {
    supported = true;
    try { host = new URL(tab.url).hostname; } catch { host = ''; }
  } else if (tab && !tab.url && new URLSearchParams(location.search).get('host')) {
    // Popup opened as a page by tests: no activeTab grant, so the URL is hidden.
    supported = true;
    host = Schema.normalizeHost(new URLSearchParams(location.search).get('host'));
  }

  render();
  loadShortcuts();
  loadIntel();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const merged = { ...state };
    for (const [k, c] of Object.entries(changes)) merged[k] = c.newValue;
    state = Schema.sanitize(merged);
    if (state.focusStatus === 'idle' && 'focusDuration' in changes) selectedMinutes = state.focusDuration;
    queueRender();
  });

  ticker = setInterval(() => {
    if (state.focusStatus === 'running' || state.focusStatus === 'break') {
      renderToday();
      renderFocus();
    }
    if (state.snoozeUntil && state.snoozeUntil <= Date.now()) renderSite();
  }, 1000);
  window.addEventListener('unload', () => clearInterval(ticker));
}

init();

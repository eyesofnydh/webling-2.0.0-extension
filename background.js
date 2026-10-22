/**
 * Spider-Buddy — background service worker (Manifest V3).
 *
 * Owns all writes to chrome.storage.local. Every mutation goes through
 * `update()`, which serialises read-modify-write cycles so rapid clicks
 * (water +1, rescues…) can never overwrite each other.
 *
 * Tabs and the popup stay in sync by listening to chrome.storage.onChanged;
 * messages to tabs are only used for one-off *events* (speech, celebrations).
 */
/**
 * Spider-Buddy — background service worker (Manifest V3).
 *
 * Owns all writes to chrome.storage.local. Every mutation goes through
 * `update()`, which serialises read-modify-write cycles so rapid clicks
 * (water +1, rescues…) can never overwrite each other.
 *
 * Tabs and the popup stay in sync by listening to chrome.storage.onChanged;
 * messages to tabs are only used for one-off *events* (speech, celebrations).
 */

import './shared/schema.js';
import './shared/progression.js';

const Schema = globalThis.WeblingSchema;
const Progression = globalThis.WeblingProgression;
const { todayKey, addDays, sanitize, sanitizePatch, migrate } = Schema;

const ALARM = Object.freeze({
  FOCUS: 'webling-focus',
  BREAK: 'webling-break',
  HYDRATION: 'webling-hydration',
  MIDNIGHT: 'webling-midnight',
  HOURLY: 'webling-hourly',
  BADGE: 'webling-badge',
  SNOOZE: 'webling-snooze',
});

const CONTENT_FILES = [
  'shared/schema.js',
  'shared/dialogue.js',
  'shared/progression.js',
  'shared/sprite-pixels.js',
  'shared/sprite.js',
  'content/content.js',
];

const PATROL_DEDUPE_MS = 24 * 60 * 60 * 1000;
const ICON_URL = 'assets/icons/icon-128.png';

// ---------------------------------------------------------------------------
// Storage layer
// ---------------------------------------------------------------------------

let lock = Promise.resolve();

/** Runs `fn` after every previously queued storage operation has finished. */
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

async function readState() {
  try {
    return sanitize(await chrome.storage.local.get(null));
  } catch {
    return sanitize({});
  }
}

/**
 * Atomic read → mutate → write. `mutator(state)` returns a patch (or nothing).
 * Resolves to the merged, validated state.
 */
function update(mutator) {
  return withLock(async () => {
    const state = await readState();
    const patch = (await mutator(state)) || {};
    const { clean } = sanitizePatch(patch);
    if (Object.keys(clean).length > 0) {
      await chrome.storage.local.set(clean);
    }
    return { ...state, ...clean };
  });
}

// ---------------------------------------------------------------------------
// Tab helpers
// ---------------------------------------------------------------------------

const isPageUrl = (url) => typeof url === 'string' && /^(https?|file):\/\//.test(url);

/** Sends an event to the active tab of every window (where the user will see it). */
async function notifyActiveTabs(message) {
  try {
    const tabs = await chrome.tabs.query({ active: true });
    await Promise.all(tabs.map((t) => (t.id ? chrome.tabs.sendMessage(t.id, message).catch(() => {}) : null)));
  } catch {
    /* no tabs / shutting down */
  }
}

/** Sends to every tab (used for resets so background tabs re-initialise). */
async function notifyAllTabs(message) {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((t) => (t.id ? chrome.tabs.sendMessage(t.id, message).catch(() => {}) : null)));
  } catch {
    /* ignore */
  }
}

async function sendToTabOrInject(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Tab was open before install/update, so the content script isn't there yet.
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

// ---------------------------------------------------------------------------
// Notifications & toolbar badge
// ---------------------------------------------------------------------------

function notify(state, id, title, message) {
  if (!state.notificationsEnabled || !chrome.notifications) return;
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL(ICON_URL),
    title,
    message,
    priority: 0,
    silent: false,
  }, () => void chrome.runtime.lastError);
}

const BADGE_COLORS = { running: '#5a4bd8', paused: '#6b7280', break: '#1fae8a' };

async function refreshBadge(state) {
  const s = state || (await readState());
  let text = '';
  if (s.toolbarBadge && s.focusStatus !== 'idle') {
    const mins = Math.ceil(Schema.focusRemainingMs(s) / 60000);
    text = s.focusStatus === 'paused' ? '❚❚' : `${mins}m`;
  }
  try {
    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[s.focusStatus] || BADGE_COLORS.running });
    if (text && chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    const title = s.focusStatus === 'idle'
      ? 'Spider-Buddy'
      : `Spider-Buddy — ${s.focusStatus === 'break' ? 'break' : 'focus'} ${Schema.formatClock(Schema.focusRemainingMs(s))}${s.focusStatus === 'paused' ? ' (paused)' : ''}`;
    await chrome.action.setTitle({ title });
  } catch {
    /* action API unavailable in tests */
  }
  // Keep a 30 s ticker alive only while a timer runs.
  if (s.focusStatus === 'running' || s.focusStatus === 'break') {
    const existing = await chrome.alarms.get(ALARM.BADGE);
    if (!existing) chrome.alarms.create(ALARM.BADGE, { periodInMinutes: 0.5 });
  } else {
    chrome.alarms.clear(ALARM.BADGE);
  }
}

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

/** Unlocks anything newly earned. Must be called *inside* an update() mutator. */
function progressionPatch(state) {
  const today = todayKey();
  const statsView = { ...state };
  const newAch = Progression.newAchievements(statsView, state.achievements);
  const newCos = Progression.newCosmetics(statsView, state.cosmeticsUnlocked);
  const patch = {};
  if (newAch.length) {
    patch.achievements = { ...state.achievements };
    for (const id of newAch) patch.achievements[id] = { unlocked: true, date: today };
  }
  if (newCos.length) patch.cosmeticsUnlocked = [...state.cosmeticsUnlocked, ...newCos];
  return { patch, newAch, newCos };
}

/** Announces unlocks to the user (call after the write succeeded). */
function announceUnlocks(state, newAch, newCos) {
  for (const id of newAch) {
    const def = Progression.getAchievement(id);
    if (!def) continue;
    notify(state, `ach-${id}`, `Achievement unlocked ${def.icon}`, `${def.name} — ${def.description}`);
    notifyActiveTabs({ type: 'WEBLING_EVENT', event: 'achievement', vars: { name: def.name } });
  }
  for (const id of newCos) {
    const def = Progression.getCosmetic(id);
    if (!def) continue;
    notifyActiveTabs({ type: 'WEBLING_EVENT', event: 'rewardUnlock', vars: { name: def.name } });
  }
}

/** Applies `mutator`, then evaluates progression on the result in the same lock. */
async function updateWithProgression(mutator) {
  let unlocked = { newAch: [], newCos: [] };
  const state = await update(async (s) => {
    const patch = (await mutator(s)) || {};
    const merged = { ...s, ...sanitizePatch(patch).clean };
    const prog = progressionPatch(merged);
    unlocked = prog;
    return { ...patch, ...prog.patch };
  });
  announceUnlocks(state, unlocked.newAch, unlocked.newCos);
  return state;
}

// ---------------------------------------------------------------------------
// Daily rollover
// ---------------------------------------------------------------------------

function nextMidnight() {
  const d = new Date();
  d.setHours(24, 0, 30, 0);
  return d.getTime();
}

async function scheduleMidnight() {
  await chrome.alarms.create(ALARM.MIDNIGHT, { when: nextMidnight() });
  const hourly = await chrome.alarms.get(ALARM.HOURLY);
  if (!hourly) await chrome.alarms.create(ALARM.HOURLY, { periodInMinutes: 60 });
}

function rollover() {
  return update((s) => {
    const today = todayKey();
    const patch = {};
    if (s.hydrationDate !== today) {
      patch.hydration = 0;
      patch.hydrationDate = today;
    }
    const yesterday = addDays(today, -1);
    if (s.hydrationCurrentStreak > 0 && !s.hydrationHistory.includes(yesterday) && !s.hydrationHistory.includes(today)) {
      patch.hydrationCurrentStreak = 0;
    }
    const focusLive = Schema.liveStreak(s.focusLastSessionDate, s.focusCurrentStreak, today);
    if (focusLive !== s.focusCurrentStreak) patch.focusCurrentStreak = focusLive;
    return patch;
  });
}

// ---------------------------------------------------------------------------
// Focus timer
// ---------------------------------------------------------------------------

async function startFocus(durationMinutes) {
  const minutes = Math.max(1, Math.min(180, Math.round(Number(durationMinutes) || 25)));
  const now = Date.now();
  const end = now + minutes * 60000;
  await chrome.alarms.clear(ALARM.BREAK);
  await chrome.alarms.create(ALARM.FOCUS, { when: end });
  const state = await update(() => ({
    focusStatus: 'running',
    focusDuration: minutes,
    focusEndTime: end,
    focusPhaseTotalMs: minutes * 60000,
    focusPausedRemaining: 0,
  }));
  notifyActiveTabs({ type: 'WEBLING_EVENT', event: 'focusStart' });
  await refreshBadge(state);
  return state;
}

async function pauseFocus() {
  await chrome.alarms.clear(ALARM.FOCUS);
  const state = await update((s) => {
    if (s.focusStatus !== 'running') return null;
    return { focusStatus: 'paused', focusPausedRemaining: Math.max(1000, s.focusEndTime - Date.now()), focusEndTime: 0 };
  });
  if (state.focusStatus === 'paused') notifyActiveTabs({ type: 'WEBLING_EVENT', event: 'focusPause' });
  await refreshBadge(state);
  return state;
}

async function resumeFocus() {
  const state = await update((s) => {
    if (s.focusStatus !== 'paused') return null;
    const remaining = s.focusPausedRemaining || s.focusDuration * 60000;
    return { focusStatus: 'running', focusEndTime: Date.now() + remaining, focusPausedRemaining: 0 };
  });
  if (state.focusStatus === 'running') {
    await chrome.alarms.create(ALARM.FOCUS, { when: state.focusEndTime });
    notifyActiveTabs({ type: 'WEBLING_EVENT', event: 'focusResume' });
  }
  await refreshBadge(state);
  return state;
}

async function resetFocus() {
  await chrome.alarms.clear(ALARM.FOCUS);
  await chrome.alarms.clear(ALARM.BREAK);
  const state = await update(() => ({ focusStatus: 'idle', focusEndTime: 0, focusPausedRemaining: 0, focusPhaseTotalMs: 0 }));
  await refreshBadge(state);
  return state;
}

async function completeFocus() {
  await chrome.alarms.clear(ALARM.FOCUS);
  let completed = false;
  let minutes = 0;
  const state = await updateWithProgression((s) => {
    if (s.focusStatus !== 'running') return null;
    completed = true;
    minutes = s.focusDuration;
    const today = todayKey();
    const streak = Schema.nextStreak(s.focusLastSessionDate, s.focusCurrentStreak, today);
    const patch = {
      focusSessionsCompleted: s.focusSessionsCompleted + 1,
      focusTotalMinutes: s.focusTotalMinutes + minutes,
      focusLongestSessionMinutes: Math.max(s.focusLongestSessionMinutes, minutes),
      focusCurrentStreak: streak,
      focusBestStreak: Math.max(s.focusBestStreak, streak),
      focusLastSessionDate: today,
      focusPausedRemaining: 0,
      dailyLog: Schema.bumpDailyLog(s.dailyLog, 'focus', minutes, today),
    };
    if (s.focusAutoBreak) {
      const ms = s.focusBreakDuration * 60000;
      Object.assign(patch, { focusStatus: 'break', focusEndTime: Date.now() + ms, focusPhaseTotalMs: ms });
    } else {
      Object.assign(patch, { focusStatus: 'idle', focusEndTime: 0, focusPhaseTotalMs: 0 });
    }
    return patch;
  });
  if (!completed) return state;
  if (state.focusStatus === 'break') await chrome.alarms.create(ALARM.BREAK, { when: state.focusEndTime });
  notifyActiveTabs({ type: 'WEBLING_EVENT', event: 'focusComplete', vars: { minutes } });
  notify(
    state,
    'focus-complete',
    'Focus session complete 🎯',
    state.focusStatus === 'break'
      ? `${minutes} minutes done. Enjoy a ${state.focusBreakDuration}-minute break!`
      : `${minutes} minutes of web-tastic focus. Nice work!`,
  );
  await refreshBadge(state);
  return state;
}

async function endBreak({ silent = false } = {}) {
  await chrome.alarms.clear(ALARM.BREAK);
  let ended = false;
  const state = await update((s) => {
    if (s.focusStatus !== 'break') return null;
    ended = true;
    return { focusStatus: 'idle', focusEndTime: 0, focusPhaseTotalMs: 0 };
  });
  if (ended && !silent) {
    notifyActiveTabs({ type: 'WEBLING_EVENT', event: 'breakOver' });
    notify(state, 'break-complete', 'Break over ⚡', 'Ready to swing into your next focus session?');
  }
  await refreshBadge(state);
  return state;
}

/** Brings timers back in line after the worker slept or the browser restarted. */
async function reconcileTimers() {
  const s = await readState();
  const now = Date.now();
  if (s.focusStatus === 'running') {
    if (s.focusEndTime <= now) return completeFocus();
    await chrome.alarms.create(ALARM.FOCUS, { when: s.focusEndTime });
  } else if (s.focusStatus === 'break') {
    if (s.focusEndTime <= now) return endBreak({ silent: true });
    await chrome.alarms.create(ALARM.BREAK, { when: s.focusEndTime });
  }
  await refreshBadge(s);
  return s;
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

async function syncHydrationAlarm(state) {
  const s = state || (await readState());
  if (s.hydrationRemindersEnabled) {
    const existing = await chrome.alarms.get(ALARM.HYDRATION);
    if (!existing || existing.periodInMinutes !== s.hydrationReminderInterval) {
      await chrome.alarms.create(ALARM.HYDRATION, {
        delayInMinutes: s.hydrationReminderInterval,
        periodInMinutes: s.hydrationReminderInterval,
      });
    }
  } else {
    await chrome.alarms.clear(ALARM.HYDRATION);
  }
}

async function hydrationReminder() {
  const s = await readState();
  if (!s.hydrationRemindersEnabled || !s.enabled) return;
  if (s.snoozeUntil > Date.now()) return;
  if (Schema.effectiveHydration(s) >= s.hydrationTarget) return;
  if (s.quietHoursEnabled && Schema.isInQuietHours(s.quietHoursStart, s.quietHoursEnd)) return;
  const current = Schema.effectiveHydration(s);
  notifyActiveTabs({ type: 'WEBLING_EVENT', event: 'hydrationReminder', vars: { count: current, target: s.hydrationTarget } });
  notify(s, 'hydration-reminder', 'Time for a sip 💧', `You've had ${current} of ${s.hydrationTarget} glasses today.`);
}

async function addWater(delta) {
  let reachedGoal = false;
  const state = await updateWithProgression((s) => {
    const today = todayKey();
    const current = Schema.effectiveHydration(s, today);
    const next = Math.max(0, Math.min(64, current + delta));
    if (next === current && s.hydrationDate === today) return null;
    const patch = {
      hydration: next,
      hydrationDate: today,
      dailyLog: Schema.bumpDailyLog(s.dailyLog, 'water', next - current, today),
    };
    if (delta > 0 && next >= s.hydrationTarget && !s.hydrationHistory.includes(today)) {
      reachedGoal = true;
      const yesterday = addDays(today, -1);
      const streak = s.hydrationHistory.includes(yesterday) ? s.hydrationCurrentStreak + 1 : 1;
      Object.assign(patch, {
        hydrationHistory: [...s.hydrationHistory, today],
        hydrationGoalsCompleted: s.hydrationGoalsCompleted + 1,
        hydrationCurrentStreak: streak,
        hydrationBestStreak: Math.max(s.hydrationBestStreak, streak),
      });
    }
    return patch;
  });
  if (reachedGoal) notify(state, 'hydration-goal', 'Water goal reached 💧', 'Awesome — you hit your water target today!');
  return { state, reachedGoal };
}

// ---------------------------------------------------------------------------
// Summon / snooze
// ---------------------------------------------------------------------------

async function summonInActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  // tab.url is visible thanks to activeTab (popup click / shortcut). If it's
  // unknown we still try — injection fails cleanly on restricted pages.
  if (!tab || !tab.id || (tab.url && !isPageUrl(tab.url))) return { success: false, reason: 'unsupported_page' };
  // Summoning is an explicit request: wake Spider-Buddy everywhere it's asleep for this tab.
  await update((s) => {
    const patch = {};
    if (!s.enabled) patch.enabled = true;
    if (s.snoozeUntil) patch.snoozeUntil = 0;
    if (tab.url) {
      let host = '';
      try { host = new URL(tab.url).hostname; } catch { /* ignore */ }
      const entry = Schema.findDisablingEntry(host, s.disabledSites);
      if (entry) patch.disabledSites = s.disabledSites.filter((h) => h !== entry);
    }
    return patch;
  });
  await chrome.alarms.clear(ALARM.SNOOZE);
  try {
    await sendToTabOrInject(tab.id, { type: 'WEBLING_SUMMON' });
    return { success: true };
  } catch (err) {
    return { success: false, reason: 'unsupported_page', error: String(err && err.message) };
  }
}

async function setSnooze(minutes) {
  const until = minutes > 0 ? Date.now() + minutes * 60000 : 0;
  await chrome.alarms.clear(ALARM.SNOOZE);
  if (until) await chrome.alarms.create(ALARM.SNOOZE, { when: until });
  return update(() => ({ snoozeUntil: until }));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function runMigration() {
  return withLock(async () => {
    const raw = await chrome.storage.local.get(null);
    const { data, removeKeys } = migrate(raw);
    const known = new Set(Object.keys(data));
    const stale = Object.keys(raw).filter((k) => !known.has(k));
    await chrome.storage.local.set(data);
    const toRemove = [...new Set([...removeKeys, ...stale])].filter((k) => k in raw);
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
    return data;
  });
}

async function bootstrap() {
  await rollover();
  await scheduleMidnight();
  const s = await reconcileTimers();
  await syncHydrationAlarm(s);
  const snooze = (await readState()).snoozeUntil;
  if (snooze && snooze <= Date.now()) await update(() => ({ snoozeUntil: 0 }));
  else if (snooze) await chrome.alarms.create(ALARM.SNOOZE, { when: snooze });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const data = await runMigration();
  await bootstrap();
  if (details.reason === 'install' && !data.onboardingComplete) {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  bootstrap();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case ALARM.FOCUS: await completeFocus(); break;
    case ALARM.BREAK: await endBreak(); break;
    case ALARM.HYDRATION: await hydrationReminder(); break;
    case ALARM.MIDNIGHT: await rollover(); await scheduleMidnight(); break;
    case ALARM.HOURLY: await rollover(); break;
    case ALARM.BADGE: await reconcileTimers(); break;
    case ALARM.SNOOZE: await update(() => ({ snoozeUntil: 0 })); break;
    default: break;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'summon-webling') {
    await updateWithProgression((s) => ({ summonCount: s.summonCount + 1 }));
    await summonInActiveTab();
  } else if (command === 'toggle-focus') {
    const s = await readState();
    if (s.focusStatus === 'running') await pauseFocus();
    else if (s.focusStatus === 'paused') await resumeFocus();
    else if (s.focusStatus === 'break') await endBreak({ silent: true });
    else await startFocus(s.focusDuration);
  }
});

chrome.notifications?.onClicked?.addListener((id) => chrome.notifications.clear(id));

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

/** Messages a content script (running inside a web page) may send. */
const CONTENT_ALLOWED = new Set([
  'GET_STATE', 'HYDRATION_ADD', 'HYDRATION_REMOVE', 'RECORD_RESCUE', 'RECORD_PATROL',
  'RECORD_SUMMON', 'SAVE_POSITION', 'FOCUS_PAUSE', 'FOCUS_RESUME', 'FOCUS_SKIP_BREAK', 'GREET_CHECK',
]);

const extensionOrigin = chrome.runtime.getURL('');
let lastGreetAt = 0;

const handlers = {
  async GET_STATE() {
    const s = await readState();
    if (s.focusStatus === 'running' && s.focusEndTime <= Date.now()) {
      return { success: true, data: await completeFocus() };
    }
    return { success: true, data: s };
  },

  async UPDATE_SETTINGS(msg) {
    const { clean, rejected } = sanitizePatch(msg.settings, Schema.USER_WRITABLE_KEYS);
    const state = await update(() => clean);
    if ('hydrationRemindersEnabled' in clean || 'hydrationReminderInterval' in clean) await syncHydrationAlarm(state);
    if ('toolbarBadge' in clean) await refreshBadge(state);
    return { success: true, rejected, data: state };
  },

  async TOGGLE_SITE(msg) {
    const host = Schema.normalizeHost(msg.hostname);
    if (!host) return { success: false, error: 'invalid_host' };
    const state = await update((s) => {
      if (msg.disabled) return { disabledSites: [...s.disabledSites, host] };
      const entry = Schema.findDisablingEntry(host, s.disabledSites);
      return { disabledSites: s.disabledSites.filter((h) => h !== entry && h !== host) };
    });
    return { success: true, disabledSites: state.disabledSites };
  },

  async REMOVE_SITE(msg) {
    const state = await update((s) => ({ disabledSites: s.disabledSites.filter((h) => h !== msg.hostname) }));
    return { success: true, disabledSites: state.disabledSites };
  },

  async FOCUS_START(msg) { return { success: true, data: await startFocus(msg.duration) }; },
  async FOCUS_PAUSE() { return { success: true, data: await pauseFocus() }; },
  async FOCUS_RESUME() { return { success: true, data: await resumeFocus() }; },
  async FOCUS_RESET() { return { success: true, data: await resetFocus() }; },
  async FOCUS_SKIP_BREAK() { return { success: true, data: await endBreak({ silent: true }) }; },

  async HYDRATION_ADD() {
    const { state, reachedGoal } = await addWater(1);
    return { success: true, hydration: state.hydration, target: state.hydrationTarget, reachedGoal };
  },
  async HYDRATION_REMOVE() {
    const { state } = await addWater(-1);
    return { success: true, hydration: state.hydration, target: state.hydrationTarget };
  },

  async RECORD_RESCUE() {
    const state = await updateWithProgression((s) => ({
      spiderScore: s.spiderScore + 1,
      dailyLog: Schema.bumpDailyLog(s.dailyLog, 'rescues', 1),
    }));
    return { success: true, spiderScore: state.spiderScore };
  },

  async RECORD_PATROL(_msg, sender) {
    const url = sender.tab ? sender.tab.url || sender.url : '';
    const key = Schema.pageKey(sender.url || url || '');
    if (!key) return { success: false };
    const state = await updateWithProgression((s) => {
      const last = s.patrolLog[key] || 0;
      if (Date.now() - last < PATROL_DEDUPE_MS) return null;
      return { patrolLog: { ...s.patrolLog, [key]: Date.now() }, pagesPatrolled: s.pagesPatrolled + 1 };
    });
    return { success: true, pagesPatrolled: state.pagesPatrolled };
  },

  async RECORD_SUMMON() {
    const state = await updateWithProgression((s) => ({ summonCount: s.summonCount + 1 }));
    return { success: true, summonCount: state.summonCount };
  },

  async SUMMON_WEBLING() {
    await updateWithProgression((s) => ({ summonCount: s.summonCount + 1 }));
    return summonInActiveTab();
  },

  async SAVE_POSITION(msg) {
    await update((s) => (s.rememberPosition ? { lastPosition: msg.position } : null));
    return { success: true };
  },

  /** Rate-limits page-load greetings to one every 20 minutes across all tabs. */
  async GREET_CHECK() {
    const now = Date.now();
    if (now - lastGreetAt < 20 * 60000) return { success: true, greet: false };
    lastGreetAt = now;
    return { success: true, greet: true };
  },

  async EQUIP_COSMETIC(msg) {
    const category = msg.category;
    if (!Schema.COSMETIC_CATEGORIES.includes(category)) return { success: false, error: 'invalid_category' };
    const state = await update((s) => {
      const equipped = { ...s.equippedCosmetics };
      if (!msg.cosmeticId) {
        delete equipped[category];
      } else {
        const def = Progression.getCosmetic(msg.cosmeticId);
        if (!def || def.category !== category || !s.cosmeticsUnlocked.includes(def.id)) return null;
        equipped[category] = def.id;
      }
      return { equippedCosmetics: equipped };
    });
    if (msg.cosmeticId) notifyActiveTabs({ type: 'WEBLING_EVENT', event: 'styleChange' });
    return { success: true, equippedCosmetics: state.equippedCosmetics };
  },

  async SNOOZE(msg) {
    const minutes = Math.max(0, Math.min(24 * 60, Number(msg.minutes) || 0));
    const state = await setSnooze(minutes);
    return { success: true, snoozeUntil: state.snoozeUntil };
  },

  async RESET_TODAY_HYDRATION() {
    await update(() => ({ hydration: 0, hydrationDate: todayKey() }));
    return { success: true };
  },

  async RESET_FOCUS_STATS() {
    await update(() => ({
      focusSessionsCompleted: 0, focusTotalMinutes: 0, focusLongestSessionMinutes: 0,
      focusCurrentStreak: 0, focusBestStreak: 0, focusLastSessionDate: '',
    }));
    return { success: true };
  },

  /** Resets stats *and* unlocks together (resetting only unlocks would instantly re-award them). */
  async RESET_PROGRESS() {
    const keep = new Set([...Schema.SETTING_KEYS, 'focusStatus', 'focusDuration', 'focusEndTime', 'focusPausedRemaining',
      'focusPhaseTotalMs', 'hydration', 'hydrationDate', 'snoozeUntil', 'lastPosition', 'onboardingComplete', 'installDate', 'schemaVersion']);
    await update(() => {
      const patch = {};
      for (const [k, v] of Object.entries(Schema.DEFAULTS)) if (!keep.has(k)) patch[k] = v;
      patch.installDate = todayKey();
      return patch;
    });
    return { success: true };
  },

  async RESET_SETTINGS() {
    const state = await update(() => Object.fromEntries(Schema.SETTING_KEYS.map((k) => [k, Schema.DEFAULTS[k]])));
    await syncHydrationAlarm(state);
    await refreshBadge(state);
    return { success: true, data: state };
  },

  async RESET_ALL() {
    await withLock(() => chrome.storage.local.clear());
    await chrome.alarms.clearAll();
    await runMigration();
    await update(() => ({ onboardingComplete: true }));
    await bootstrap();
    notifyAllTabs({ type: 'WEBLING_RESET' });
    return { success: true };
  },

  async EXPORT_DATA() {
    const s = await readState();
    return { success: true, data: { app: 'webling', exportedAt: new Date().toISOString(), version: chrome.runtime.getManifest().version, state: s } };
  },

  async IMPORT_DATA(msg) {
    const payload = msg.data && msg.data.app === 'webling' ? msg.data.state : null;
    if (!payload || typeof payload !== 'object') return { success: false, error: 'invalid_file' };
    const { data } = migrate(payload);
    await withLock(async () => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ ...data, onboardingComplete: true });
    });
    await chrome.alarms.clearAll();
    await bootstrap();
    notifyAllTabs({ type: 'WEBLING_RESET' });
    return { success: true };
  },

  async COMPLETE_ONBOARDING() {
    await update(() => ({ onboardingComplete: true }));
    return { success: true };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string' || sender.id !== chrome.runtime.id) return false;
  const handler = handlers[message.type];
  if (!handler) return false;

  const fromExtensionPage = typeof sender.url === 'string' && sender.url.startsWith(extensionOrigin);
  if (!fromExtensionPage && !CONTENT_ALLOWED.has(message.type)) {
    sendResponse({ success: false, error: 'forbidden' });
    return false;
  }

  handler(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[Spider-Buddy]', message.type, err);
      sendResponse({ success: false, error: String((err && err.message) || err) });
    });
  return true;
});

// Service workers can be woken by any event; make sure timers are consistent.
reconcileTimers().catch(() => {});

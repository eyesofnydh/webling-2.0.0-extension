/**
 * Webling — shared schema, defaults, validation, migrations and pure helpers.
 *
 * Written as a classic script that attaches `globalThis.WeblingSchema`, so the
 * exact same file can be:
 *   - listed in manifest `content_scripts` (classic scripts only),
 *   - imported for side effects by ES modules (service worker, popup, tests).
 *
 * Everything in here is pure (no chrome.* calls) so it is fully unit-testable.
 */
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 3;

  const PERSONALITIES = ['cheeky', 'brave', 'calm'];
  const CHARACTER_SIZES = ['small', 'medium', 'large'];
  const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const MISHAP_FREQS = ['off', 'rare', 'normal', 'frequent'];
  const WANDER_FREQS = ['off', 'calm', 'normal', 'hyper'];
  const FOCUS_STATUSES = ['idle', 'running', 'paused', 'break'];
  const HYDRATION_INTERVALS = [30, 45, 60, 90, 120];
  const BREAK_DURATIONS = [3, 5, 10, 15];
  const COSMETIC_CATEGORIES = ['webline', 'theme', 'bubble', 'badge', 'effect'];

  const DAILY_LOG_DAYS = 60;
  const HISTORY_MAX = 400;
  const PATROL_LOG_MAX = 250;

  /** Keys that are user preferences (reset by "Reset settings"). */
  const SETTING_KEYS = [
    'enabled', 'personality', 'characterSize', 'startPosition', 'rememberPosition',
    'swingToClicks', 'showFocusIndicator', 'showHydrationWidget', 'spidersEnabled',
    'showSpeechBubbles', 'quietMode', 'greetOnPageLoad', 'mishapFrequency', 'wanderFrequency', 'webZip',
    'webLineColor', 'reducedMotion', 'notificationsEnabled', 'toolbarBadge',
    'hydrationRemindersEnabled', 'hydrationReminderInterval', 'hydrationTarget',
    'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd', 'videoDimming',
    'disabledSites', 'focusBreakDuration', 'focusAutoBreak',
  ];

  /** Keys the popup / content scripts may change through UPDATE_SETTINGS. */
  const USER_WRITABLE_KEYS = new Set([...SETTING_KEYS, 'focusDuration', 'lastPosition']);

  const DEFAULTS = Object.freeze({
    // — Settings —
    enabled: true,
    personality: 'cheeky',
    characterSize: 'medium',
    startPosition: 'top-right',
    rememberPosition: true,
    swingToClicks: false,
    showFocusIndicator: true,
    showHydrationWidget: true,
    spidersEnabled: true,
    showSpeechBubbles: true,
    quietMode: false,
    greetOnPageLoad: true,
    mishapFrequency: 'rare',
    wanderFrequency: 'off',
    webZip: true,
    webLineColor: '#e9f2ff',
    reducedMotion: false,
    notificationsEnabled: true,
    toolbarBadge: true,
    hydrationRemindersEnabled: false,
    hydrationReminderInterval: 60,
    hydrationTarget: 8,
    quietHoursEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    videoDimming: false,
    disabledSites: Object.freeze([]),
    snoozeUntil: 0,

    // — Focus —
    focusStatus: 'idle',
    focusDuration: 25,
    focusEndTime: 0,
    focusPausedRemaining: 0,
    focusPhaseTotalMs: 0,
    focusBreakDuration: 5,
    focusAutoBreak: true,

    // — Hydration —
    hydration: 0,
    hydrationDate: '',
    hydrationHistory: Object.freeze([]),

    // — Statistics —
    spiderScore: 0,
    summonCount: 0,
    focusSessionsCompleted: 0,
    focusTotalMinutes: 0,
    focusLongestSessionMinutes: 0,
    focusCurrentStreak: 0,
    focusBestStreak: 0,
    focusLastSessionDate: '',
    hydrationCurrentStreak: 0,
    hydrationBestStreak: 0,
    hydrationGoalsCompleted: 0,
    pagesPatrolled: 0,
    patrolLog: Object.freeze({}),
    dailyLog: Object.freeze({}),
    installDate: '',

    // — Progression —
    achievements: Object.freeze({}),
    cosmeticsUnlocked: Object.freeze([]),
    equippedCosmetics: Object.freeze({}),

    // — Misc —
    lastPosition: null,
    onboardingComplete: false,
    schemaVersion: SCHEMA_VERSION,
  });

  // -------------------------------------------------------------------------
  // Date helpers (all local-time, YYYY-MM-DD)
  // -------------------------------------------------------------------------

  const pad2 = (n) => String(n).padStart(2, '0');

  function todayKey(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function isDateKey(str) {
    return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
  }

  function parseDateKey(key) {
    if (!isDateKey(key)) return null;
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function addDays(key, n) {
    const dt = parseDateKey(key);
    if (!dt) return '';
    dt.setDate(dt.getDate() + n);
    return todayKey(dt);
  }

  /** Whole calendar days from `fromKey` to `toKey` (DST-safe). */
  function daysBetween(fromKey, toKey) {
    const a = parseDateKey(fromKey);
    const b = parseDateKey(toKey);
    if (!a || !b) return 0;
    const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((utcB - utcA) / 86400000);
  }

  function timeToMinutes(str) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(str));
    if (!m) return -1;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return -1;
    return h * 60 + min;
  }

  /** True when `now` falls inside [start, end) — handles overnight ranges. */
  function isInQuietHours(startStr, endStr, now = new Date()) {
    const start = timeToMinutes(startStr);
    const end = timeToMinutes(endStr);
    if (start < 0 || end < 0 || start === end) return false;
    const cur = now.getHours() * 60 + now.getMinutes();
    return start < end ? cur >= start && cur < end : cur >= start || cur < end;
  }

  // -------------------------------------------------------------------------
  // Site matching
  // -------------------------------------------------------------------------

  /** Normalises user input like "https://www.Example.com/path" → "example.com". */
  function normalizeHost(input) {
    let s = String(input || '').trim().toLowerCase();
    if (!s) return '';
    s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
    s = s.replace(/^www\./, '').replace(/\.+$/, '');
    return /^[a-z0-9.-]+$/.test(s) ? s : '';
  }

  /** Returns the entry in `list` that disables `host` (exact or parent domain), or ''. */
  function findDisablingEntry(host, list) {
    const h = normalizeHost(host);
    if (!h || !Array.isArray(list)) return '';
    for (const raw of list) {
      const entry = normalizeHost(raw);
      if (entry && (h === entry || h.endsWith('.' + entry))) return raw;
    }
    return '';
  }

  function isHostDisabled(host, list) {
    return findDisablingEntry(host, list) !== '';
  }

  // -------------------------------------------------------------------------
  // Hashing (used so we never store raw URLs)
  // -------------------------------------------------------------------------

  /** Small, fast, non-cryptographic 53-bit hash (cyrb53). */
  function hashString(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  /** Page identity without query/hash, hashed. */
  function pageKey(url) {
    try {
      const u = new URL(url);
      return hashString(`${u.protocol}//${u.host}${u.pathname}`);
    } catch {
      return '';
    }
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  const V = {
    bool: () => (v) => (typeof v === 'boolean' ? { ok: true, v } : { ok: false }),
    str: (max = 200) => (v) => (typeof v === 'string' && v.length <= max ? { ok: true, v } : { ok: false }),
    date: () => (v) => (v === '' || isDateKey(v) ? { ok: true, v } : { ok: false }),
    oneOf: (list) => (v) => (list.includes(v) ? { ok: true, v } : { ok: false }),
    num: (min, max, int = true) => (v) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false };
      const n = clamp(int ? Math.round(v) : v, min, max);
      return { ok: true, v: n };
    },
    color: () => (v) => (typeof v === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? { ok: true, v: v.toLowerCase() } : { ok: false }),
    time: () => (v) => (timeToMinutes(v) >= 0 ? { ok: true, v } : { ok: false }),
    hosts: () => (v) => {
      if (!Array.isArray(v)) return { ok: false };
      const out = [];
      for (const item of v) {
        if (typeof item !== 'string') continue;
        const h = normalizeHost(item);
        if (h && !out.includes(h)) out.push(h);
      }
      return { ok: true, v: out.slice(0, 500) };
    },
    dates: (max) => (v) => {
      if (!Array.isArray(v)) return { ok: false };
      const uniq = [...new Set(v.filter(isDateKey))].sort();
      return { ok: true, v: uniq.slice(-max) };
    },
    strings: (max) => (v) => {
      if (!Array.isArray(v)) return { ok: false };
      return { ok: true, v: [...new Set(v.filter((s) => typeof s === 'string' && s.length < 80))].slice(0, max) };
    },
    achievements: () => (v) => {
      if (!isPlainObject(v)) return { ok: false };
      const out = {};
      for (const [id, rec] of Object.entries(v)) {
        if (typeof id !== 'string' || id.length > 60) continue;
        if (rec === true) out[id] = { unlocked: true, date: '' };
        else if (isPlainObject(rec) && rec.unlocked) {
          out[id] = { unlocked: true, date: isDateKey(rec.date) ? rec.date : '' };
        }
      }
      return { ok: true, v: out };
    },
    equipped: () => (v) => {
      if (!isPlainObject(v)) return { ok: false };
      const out = {};
      for (const cat of COSMETIC_CATEGORIES) {
        if (typeof v[cat] === 'string' && v[cat].length < 60) out[cat] = v[cat];
      }
      return { ok: true, v: out };
    },
    patrolLog: () => (v) => {
      if (!isPlainObject(v)) return { ok: false };
      const entries = Object.entries(v)
        .filter(([k, t]) => typeof k === 'string' && k.length < 20 && typeof t === 'number' && Number.isFinite(t))
        .sort((a, b) => b[1] - a[1])
        .slice(0, PATROL_LOG_MAX);
      return { ok: true, v: Object.fromEntries(entries) };
    },
    dailyLog: () => (v) => {
      if (!isPlainObject(v)) return { ok: false };
      const keys = Object.keys(v).filter(isDateKey).sort().slice(-DAILY_LOG_DAYS);
      const out = {};
      for (const k of keys) {
        const rec = isPlainObject(v[k]) ? v[k] : {};
        const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? clamp(Math.round(x), 0, 100000) : 0);
        out[k] = { focus: n(rec.focus), water: n(rec.water), rescues: n(rec.rescues) };
      }
      return { ok: true, v: out };
    },
    position: () => (v) => {
      if (v === null) return { ok: true, v: null };
      if (!isPlainObject(v) || typeof v.x !== 'number' || typeof v.y !== 'number') return { ok: false };
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return { ok: false };
      return { ok: true, v: { x: clamp(v.x, 0, 1), y: clamp(v.y, 0, 1) } };
    },
  };

  const BIG = Number.MAX_SAFE_INTEGER;

  const VALIDATORS = {
    enabled: V.bool(),
    personality: V.oneOf(PERSONALITIES),
    characterSize: V.oneOf(CHARACTER_SIZES),
    startPosition: V.oneOf(POSITIONS),
    rememberPosition: V.bool(),
    swingToClicks: V.bool(),
    showFocusIndicator: V.bool(),
    showHydrationWidget: V.bool(),
    spidersEnabled: V.bool(),
    showSpeechBubbles: V.bool(),
    quietMode: V.bool(),
    greetOnPageLoad: V.bool(),
    mishapFrequency: V.oneOf(MISHAP_FREQS),
    wanderFrequency: V.oneOf(WANDER_FREQS),
    webZip: V.bool(),
    webLineColor: V.color(),
    reducedMotion: V.bool(),
    notificationsEnabled: V.bool(),
    toolbarBadge: V.bool(),
    hydrationRemindersEnabled: V.bool(),
    hydrationReminderInterval: V.oneOf(HYDRATION_INTERVALS),
    hydrationTarget: V.num(4, 16),
    quietHoursEnabled: V.bool(),
    quietHoursStart: V.time(),
    quietHoursEnd: V.time(),
    videoDimming: V.bool(),
    disabledSites: V.hosts(),
    snoozeUntil: V.num(0, BIG),

    focusStatus: V.oneOf(FOCUS_STATUSES),
    focusDuration: V.num(1, 180),
    focusEndTime: V.num(0, BIG),
    focusPausedRemaining: V.num(0, 180 * 60000),
    focusPhaseTotalMs: V.num(0, 180 * 60000),
    focusBreakDuration: V.oneOf(BREAK_DURATIONS),
    focusAutoBreak: V.bool(),

    hydration: V.num(0, 64),
    hydrationDate: V.date(),
    hydrationHistory: V.dates(HISTORY_MAX),

    spiderScore: V.num(0, BIG),
    summonCount: V.num(0, BIG),
    focusSessionsCompleted: V.num(0, BIG),
    focusTotalMinutes: V.num(0, BIG),
    focusLongestSessionMinutes: V.num(0, 180),
    focusCurrentStreak: V.num(0, BIG),
    focusBestStreak: V.num(0, BIG),
    focusLastSessionDate: V.date(),
    hydrationCurrentStreak: V.num(0, BIG),
    hydrationBestStreak: V.num(0, BIG),
    hydrationGoalsCompleted: V.num(0, BIG),
    pagesPatrolled: V.num(0, BIG),
    patrolLog: V.patrolLog(),
    dailyLog: V.dailyLog(),
    installDate: V.date(),

    achievements: V.achievements(),
    cosmeticsUnlocked: V.strings(100),
    equippedCosmetics: V.equipped(),

    lastPosition: V.position(),
    onboardingComplete: V.bool(),
    schemaVersion: V.num(1, SCHEMA_VERSION),
  };

  const cloneDefault = (key) => {
    const d = DEFAULTS[key];
    if (Array.isArray(d)) return [...d];
    if (isPlainObject(d)) return { ...d };
    return d;
  };

  /** Full validation: every schema key present and valid. Never throws. */
  function sanitize(data) {
    const src = isPlainObject(data) ? data : {};
    const out = {};
    for (const key of Object.keys(VALIDATORS)) {
      const res = key in src ? VALIDATORS[key](src[key]) : { ok: false };
      out[key] = res.ok ? res.v : cloneDefault(key);
    }
    return out;
  }

  /**
   * Validates only the keys present in `patch`. Unknown or invalid keys are
   * dropped and reported in `rejected`.
   */
  function sanitizePatch(patch, allowed = null) {
    const clean = {};
    const rejected = [];
    if (!isPlainObject(patch)) return { clean, rejected };
    for (const [key, value] of Object.entries(patch)) {
      const validator = VALIDATORS[key];
      if (!validator || (allowed && !allowed.has(key))) {
        rejected.push(key);
        continue;
      }
      const res = validator(value);
      if (res.ok) clean[key] = res.v;
      else rejected.push(key);
    }
    return { clean, rejected };
  }

  // -------------------------------------------------------------------------
  // Migrations
  // -------------------------------------------------------------------------

  /**
   * Pure migration: takes the raw stored object and returns
   * `{ data, removeKeys }` at the current schema version.
   */
  function migrate(raw, today = todayKey()) {
    const src = isPlainObject(raw) ? { ...raw } : {};
    const removeKeys = [];
    const hasAnyData = Object.keys(src).length > 0;
    let version = typeof src.schemaVersion === 'number' ? src.schemaVersion : hasAnyData ? 1 : SCHEMA_VERSION;

    if (version < 2) {
      if ('mischiefEnabled' in src) src.mishapFrequency = src.mischiefEnabled ? 'normal' : 'off';
      if ('focusMode' in src) src.focusStatus = 'idle'; // v1 had no timer; never resume a ghost session
      if ('hydrationEnabled' in src) src.showHydrationWidget = Boolean(src.hydrationEnabled);
      removeKeys.push('mischiefEnabled', 'focusMode', 'hydrationEnabled');
      version = 2;
    }

    if (version < 3) {
      // v2 stored raw page URLs — drop them for privacy.
      if ('patrolledUrls' in src) removeKeys.push('patrolledUrls');
      delete src.patrolledUrls;
      // v2 had focusStartTime; v3 tracks phase length instead.
      if (src.focusStatus === 'running' || src.focusStatus === 'break') {
        const dur = typeof src.focusDuration === 'number' ? src.focusDuration : 25;
        src.focusPhaseTotalMs = (src.focusStatus === 'break' ? (src.focusBreakDuration || 5) : dur) * 60000;
      }
      if ('focusStartTime' in src) removeKeys.push('focusStartTime');
      delete src.focusStartTime;
      // "First Swing" now means summoning; keep it for anyone who already had it.
      if (!('summonCount' in src)) src.summonCount = src.achievements && src.achievements['first-swing'] ? 1 : 0;
      // v2 allowed any break length; snap to the nearest supported option.
      if (typeof src.focusBreakDuration === 'number' && !BREAK_DURATIONS.includes(src.focusBreakDuration)) {
        src.focusBreakDuration = BREAK_DURATIONS.reduce((a, b) =>
          Math.abs(b - src.focusBreakDuration) < Math.abs(a - src.focusBreakDuration) ? b : a);
      }
      version = 3;
    }

    src.schemaVersion = SCHEMA_VERSION;
    const data = sanitize(src);
    if (!data.installDate) data.installDate = today;
    if (!data.hydrationDate) data.hydrationDate = today;
    return { data, removeKeys: [...new Set(removeKeys)] };
  }

  // -------------------------------------------------------------------------
  // Domain logic (pure)
  // -------------------------------------------------------------------------

  /** Today's effective hydration count (0 if the stored day is stale). */
  function effectiveHydration(state, today = todayKey()) {
    return state.hydrationDate === today ? state.hydration : 0;
  }

  /** Remaining ms for the current focus phase. */
  function focusRemainingMs(state, now = Date.now()) {
    if (state.focusStatus === 'paused') return state.focusPausedRemaining || 0;
    if (state.focusStatus === 'running' || state.focusStatus === 'break') {
      return Math.max(0, (state.focusEndTime || 0) - now);
    }
    return 0;
  }

  /** 0..1 progress through the current focus phase. */
  function focusProgress(state, now = Date.now()) {
    const total = state.focusPhaseTotalMs || (state.focusDuration || 25) * 60000;
    if (state.focusStatus === 'idle' || total <= 0) return 0;
    return clamp(1 - focusRemainingMs(state, now) / total, 0, 1);
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  }

  /** Streak after an activity on `today`, given the last activity date. */
  function nextStreak(lastDate, current, today = todayKey()) {
    if (lastDate === today) return Math.max(1, current || 0);
    if (lastDate && addDays(lastDate, 1) === today) return (current || 0) + 1;
    return 1;
  }

  /** Streak value to show/keep on `today` (0 if it was broken). */
  function liveStreak(lastDate, current, today = todayKey()) {
    if (!lastDate) return 0;
    const gap = daysBetween(lastDate, today);
    return gap <= 1 ? current || 0 : 0;
  }

  /** Adds `delta` to a field of today's daily log entry (returns a new log). */
  function bumpDailyLog(log, field, delta, today = todayKey()) {
    const next = { ...(isPlainObject(log) ? log : {}) };
    const rec = { focus: 0, water: 0, rescues: 0, ...(next[today] || {}) };
    rec[field] = Math.max(0, (rec[field] || 0) + delta);
    next[today] = rec;
    return VALIDATORS.dailyLog(next).v;
  }

  /** Last `days` days of the log, oldest first, gaps filled with zeros. */
  function recentDays(log, days = 7, today = todayKey()) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = addDays(today, -i);
      const rec = (isPlainObject(log) && log[key]) || {};
      out.push({ date: key, focus: rec.focus || 0, water: rec.water || 0, rescues: rec.rescues || 0 });
    }
    return out;
  }

  /** Whether Webling should be visible right now on `host`. */
  function isActiveOn(state, host, now = Date.now()) {
    if (!state.enabled) return false;
    if (state.snoozeUntil && state.snoozeUntil > now) return false;
    return !isHostDisabled(host, state.disabledSites);
  }

  const api = Object.freeze({
    SCHEMA_VERSION,
    PERSONALITIES,
    CHARACTER_SIZES,
    POSITIONS,
    MISHAP_FREQS,
    WANDER_FREQS,
    FOCUS_STATUSES,
    HYDRATION_INTERVALS,
    BREAK_DURATIONS,
    COSMETIC_CATEGORIES,
    SETTING_KEYS,
    USER_WRITABLE_KEYS,
    DEFAULTS,
    todayKey,
    isDateKey,
    addDays,
    daysBetween,
    timeToMinutes,
    isInQuietHours,
    normalizeHost,
    findDisablingEntry,
    isHostDisabled,
    hashString,
    pageKey,
    sanitize,
    sanitizePatch,
    migrate,
    effectiveHydration,
    focusRemainingMs,
    focusProgress,
    formatClock,
    nextStreak,
    liveStreak,
    bumpDailyLog,
    recentDays,
    isActiveOn,
  });

  root.WeblingSchema = api;
})(globalThis);

/**
 * Webling — achievements & cosmetic rewards (pure data + checks).
 *
 * Classic script → exposes `globalThis.WeblingProgression`.
 * Depends on WeblingSchema being loaded first.
 */
(function (root) {
  'use strict';

  const Schema = root.WeblingSchema;

  const n = (stats, key) => {
    const v = stats ? stats[key] : 0;
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };

  const daysUsed = (stats) =>
    stats && stats.installDate ? Schema.daysBetween(stats.installDate, Schema.todayKey()) : 0;

  /** Each achievement has `progress(stats) → [current, goal]` so the UI can show bars. */
  const ACHIEVEMENTS = [
    { id: 'first-swing', name: 'First Swing', description: 'Summon Webling for the first time', icon: '🕸️', category: 'general', progress: (s) => [n(s, 'summonCount'), 1] },
    { id: 'summoner', name: 'Best Buddies', description: 'Summon Webling 25 times', icon: '🤗', category: 'general', progress: (s) => [n(s, 'summonCount'), 25] },
    { id: 'patrol-100', name: 'Web Patrol', description: 'Visit 100 pages with Webling', icon: '🧭', category: 'general', progress: (s) => [n(s, 'pagesPatrolled'), 100] },
    { id: 'veteran', name: 'Veteran Webling', description: 'Keep Webling around for 7 days', icon: '⭐', category: 'general', progress: (s) => [daysUsed(s), 7] },

    { id: 'first-rescue', name: 'First Rescue', description: 'Rescue your first tiny spider', icon: '🕷️', category: 'rescue', progress: (s) => [n(s, 'spiderScore'), 1] },
    { id: 'web-saver-10', name: 'Web Saver', description: 'Rescue 10 tiny spiders', icon: '🛟', category: 'rescue', progress: (s) => [n(s, 'spiderScore'), 10] },
    { id: 'web-saver-50', name: 'Arachnid Ally', description: 'Rescue 50 tiny spiders', icon: '🤝', category: 'rescue', progress: (s) => [n(s, 'spiderScore'), 50] },
    { id: 'centurion', name: 'Centurion', description: 'Rescue 100 tiny spiders', icon: '💯', category: 'rescue', progress: (s) => [n(s, 'spiderScore'), 100] },

    { id: 'first-focus', name: 'First Focus', description: 'Complete your first focus session', icon: '🎯', category: 'focus', progress: (s) => [n(s, 'focusSessionsCompleted'), 1] },
    { id: 'deep-focus', name: 'Deep Focus', description: 'Complete a 45-minute or longer session', icon: '🧘', category: 'focus', progress: (s) => [n(s, 'focusLongestSessionMinutes'), 45] },
    { id: 'focus-streak-3', name: 'Focus Streak', description: 'Focus 3 days in a row', icon: '🔥', category: 'focus', progress: (s) => [n(s, 'focusBestStreak'), 3] },
    { id: 'focus-500', name: 'Marathon Mind', description: 'Focus for 500 minutes in total', icon: '🏃', category: 'focus', progress: (s) => [n(s, 'focusTotalMinutes'), 500] },

    { id: 'hydration-hero', name: 'Hydration Hero', description: 'Complete your daily water goal', icon: '💧', category: 'hydration', progress: (s) => [n(s, 'hydrationGoalsCompleted'), 1] },
    { id: 'hydration-streak-3', name: 'Three-Day Streak', description: 'Meet your water goal 3 days in a row', icon: '🌊', category: 'hydration', progress: (s) => [n(s, 'hydrationBestStreak'), 3] },
    { id: 'hydration-streak-7', name: 'Week of Water', description: 'Meet your water goal 7 days in a row', icon: '🏆', category: 'hydration', progress: (s) => [n(s, 'hydrationBestStreak'), 7] },
    { id: 'hydration-30', name: 'Dew Collector', description: 'Meet your water goal on 30 days', icon: '🫧', category: 'hydration', progress: (s) => [n(s, 'hydrationGoalsCompleted'), 30] },
  ];

  /**
   * Cosmetics. `value` is consumed by the content script:
   *  - webline: CSS background for the strand
   *  - theme:   palette name in WeblingSprite.PALETTES
   *  - badge:   accessory name drawn on the sprite
   *  - bubble:  bubble style class
   *  - effect:  landing effect class
   * IDs from v1/v2 are preserved so existing unlocks carry over.
   */
  const COSMETICS = [
    { id: 'webline-red', name: 'Crimson Thread', description: 'A striking red web line', category: 'webline', icon: '🔴', requirement: 'Rescue 5 tiny spiders', value: '#ef4461', progress: (s) => [n(s, 'spiderScore'), 5] },
    { id: 'webline-gold', name: 'Golden Strand', description: 'A shimmering gold web line', category: 'webline', icon: '🟡', requirement: 'Rescue 25 tiny spiders', value: 'linear-gradient(180deg,#fff1b8,#f5b524)', progress: (s) => [n(s, 'spiderScore'), 25] },
    { id: 'webline-rainbow', name: 'Prismatic Web', description: 'A dazzling rainbow web line', category: 'webline', icon: '🌈', requirement: 'Rescue 50 tiny spiders', value: 'linear-gradient(180deg,#ff5d73,#ffb547,#5be38b,#4fb8ff,#a77bff)', progress: (s) => [n(s, 'spiderScore'), 50] },

    { id: 'theme-spidey', name: 'Spider-Man', description: 'Pixel-art Spider-Man that swings and hangs', category: 'theme', icon: '🕷️', requirement: 'Ready from the start', value: 'spidey', progress: () => [1, 1] },
    { id: 'theme-bolt', name: 'Boltling', description: 'An original armoured jet hero who rockets in and fires a repulsor beam', category: 'theme', icon: '🚀', requirement: 'Ready from the start', value: 'bolt', progress: () => [1, 1] },
    { id: 'theme-nova', name: 'Nova', description: 'An original winged flyer who dash-teleports and unleashes nova shockwaves', category: 'theme', icon: '⚡', requirement: 'Ready from the start', value: 'nova', progress: () => [1, 1] },
    { id: 'theme-smash', name: 'Rumble', description: 'An original rock brute who leaps in and ground-pounds', category: 'theme', icon: '🪨', requirement: 'Ready from the start', value: 'smash', progress: () => [1, 1] },

    { id: 'bubble-pixel', name: 'Pixel Talk', description: 'A retro pixel speech bubble', category: 'bubble', icon: '👾', requirement: 'Complete your first daily water goal', value: 'pixel', progress: (s) => [n(s, 'hydrationGoalsCompleted'), 1] },
    { id: 'bubble-night', name: 'Night Owl', description: 'A dark, glowing speech bubble', category: 'bubble', icon: '🦉', requirement: 'Summon Webling 10 times', value: 'night', progress: (s) => [n(s, 'summonCount'), 10] },

    { id: 'badge-star', name: 'Gold Star', description: 'A little gold star on the headband', category: 'badge', icon: '⭐', requirement: 'Focus 3 days in a row', value: 'star', progress: (s) => [n(s, 'focusBestStreak'), 3] },
    { id: 'badge-flower', name: 'Bloom', description: 'A pink flower tucked in the headband', category: 'badge', icon: '🌸', requirement: 'Rescue 15 tiny spiders', value: 'flower', progress: (s) => [n(s, 'spiderScore'), 15] },
    { id: 'badge-crown', name: 'Crown', description: 'A regal crown for a veteran', category: 'badge', icon: '👑', requirement: 'Keep Webling around for 7 days', value: 'crown', progress: (s) => [daysUsed(s), 7] },

    { id: 'effect-sparkle', name: 'Sparkle Landing', description: 'Sparkles burst when Webling lands', category: 'effect', icon: '✨', requirement: 'Rescue 100 tiny spiders', value: 'sparkle', progress: (s) => [n(s, 'spiderScore'), 100] },
    { id: 'effect-hearts', name: 'Heart Landing', description: 'Little hearts pop when Webling lands', category: 'effect', icon: '💖', requirement: 'Focus for 500 minutes in total', value: 'hearts', progress: (s) => [n(s, 'focusTotalMinutes'), 500] },
  ];

  const CATEGORY_LABELS = { webline: 'Web line', theme: 'Theme', bubble: 'Speech bubble', badge: 'Accessory', effect: 'Landing effect' };

  const achievementById = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
  const cosmeticById = new Map(COSMETICS.map((c) => [c.id, c]));

  function isDone(def, stats) {
    try {
      const [cur, goal] = def.progress(stats || {});
      return cur >= goal;
    } catch {
      return false;
    }
  }

  function progressOf(def, stats) {
    try {
      const [cur, goal] = def.progress(stats || {});
      return { current: Math.min(cur, goal), goal, ratio: goal > 0 ? Math.min(1, cur / goal) : 1 };
    } catch {
      return { current: 0, goal: 1, ratio: 0 };
    }
  }

  /** IDs of achievements newly earned (not yet recorded in `unlocked`). */
  function newAchievements(stats, unlocked) {
    const have = unlocked && typeof unlocked === 'object' ? unlocked : {};
    return ACHIEVEMENTS.filter((a) => !(have[a.id] && have[a.id].unlocked) && isDone(a, stats)).map((a) => a.id);
  }

  /** IDs of cosmetics newly earned (not in `unlockedList`). */
  function newCosmetics(stats, unlockedList) {
    const have = new Set(Array.isArray(unlockedList) ? unlockedList : []);
    return COSMETICS.filter((c) => !have.has(c.id) && isDone(c, stats)).map((c) => c.id);
  }

  /** Resolves equipped ids → concrete values, ignoring anything not unlocked. */
  function resolveEquipped(equipped, unlockedList) {
    const have = new Set(Array.isArray(unlockedList) ? unlockedList : []);
    const out = { webline: '', theme: 'classic', bubble: '', badge: '', effect: '' };
    for (const [cat, id] of Object.entries(equipped || {})) {
      const def = cosmeticById.get(id);
      if (def && def.category === cat && have.has(id)) out[cat] = def.value;
    }
    return out;
  }

  root.WeblingProgression = Object.freeze({
    ACHIEVEMENTS,
    COSMETICS,
    CATEGORY_LABELS,
    getAchievement: (id) => achievementById.get(id),
    getCosmetic: (id) => cosmeticById.get(id),
    progressOf,
    newAchievements,
    newCosmetics,
    resolveEquipped,
  });
})(globalThis);

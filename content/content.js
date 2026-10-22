/**
 * Spider-Buddy — on-page companion (content script, classic).
 *
 * Loaded after shared/schema.js, shared/dialogue.js, shared/progression.js
 * and shared/sprite.js (see manifest). Everything renders inside a closed
 * Shadow DOM so page styles and Spider-Buddy never affect each other.
 *
 * State flow: chrome.storage.local is the single source of truth. This
 * script reads it once, then applies chrome.storage.onChanged deltas.
 * The background only messages us for one-off events.
 */
(() => {
  'use strict';

  const Schema = globalThis.WeblingSchema;
  const Dialogue = globalThis.WeblingDialogue;
  const Progression = globalThis.WeblingProgression;
  const Sprite = globalThis.WeblingSprite;
  if (!Schema || !Dialogue || !Progression || !Sprite) return;

  // Tear down any instance left behind by a previous (now invalidated) extension context.
  if (typeof globalThis.__weblingTeardown === 'function') {
    try { globalThis.__weblingTeardown(); } catch { /* ignore */ }
  }
  document.querySelectorAll('webling-companion').forEach((el) => el.remove());

  const HOST_TAG = 'webling-companion';
  const SIZES = { small: 64, medium: 84, large: 108 };
  const GRIP = Sprite.GRIP_RATIO;

  const ICONS = {
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6v12l9-6zM16 6h3v12h-3z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v2H5z"/></svg>',
  };

  // ---------------------------------------------------------------------------
  // Runtime helpers (safe against "Extension context invalidated")
  // ---------------------------------------------------------------------------

  const cleanups = [];
  let alive = true;

  const contextValid = () => {
    try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; }
  };

  function send(message) {
    if (!contextValid()) {
      teardown();
      return Promise.resolve(null);
    }
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      teardown();
      return Promise.resolve(null);
    }
  }

  function listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  const timers = new Set();
  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      if (alive) fn();
    }, ms);
    timers.add(id);
    return id;
  }
  function cancel(id) {
    clearTimeout(id);
    timers.delete(id);
  }
  const wait = (ms) => new Promise((resolve) => later(resolve, ms));

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  const host = document.createElement(HOST_TAG);
  host.setAttribute('style', 'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; pointer-events: none !important; display: block !important;');
  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
    <style>${STYLES()}</style>
    <div class="stage hidden" part="stage">
      <div class="thread" aria-hidden="true"></div>
      <span class="web-tip" aria-hidden="true"></span>
      <svg class="web-splat" viewBox="-14 -14 28 28" aria-hidden="true"><path d="M0 0L13.0 0.0M0 0L9.2 9.2M0 0L0.0 13.0M0 0L-9.2 9.2M0 0L-13.0 0.0M0 0L-9.2 -9.2M0 0L-0.0 -13.0M0 0L9.2 -9.2M5.0 0.0 L3.5 3.5 L0.0 5.0 L-3.5 3.5 L-5.0 0.0 L-3.5 -3.5 L-0.0 -5.0 L3.5 -3.5ZM9.5 0.0 L6.7 6.7 L0.0 9.5 L-6.7 6.7 L-9.5 0.0 L-6.7 -6.7 L-0.0 -9.5 L6.7 -6.7Z"/></svg>

      <div class="focus-pill" role="status" aria-live="polite">
        <svg class="ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle class="ring-bg" cx="18" cy="18" r="15"/>
          <circle class="ring-fg" cx="18" cy="18" r="15"/>
        </svg>
        <span class="focus-label">Focus</span>
        <span class="focus-time">25:00</span>
        <button class="pill-btn focus-toggle" type="button" aria-label="Pause focus">${ICONS.pause}</button>
        <button class="pill-btn focus-hide" type="button" aria-label="Hide timer">${ICONS.close}</button>
      </div>

      <div class="water" role="group" aria-label="Water tracker">
        <button class="water-btn water-sub" type="button" aria-label="Remove a glass">${ICONS.minus}</button>
        <div class="water-meter" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="drop"><path d="M12 2.5c3.6 4.6 7 8.4 7 12a7 7 0 0 1-14 0c0-3.6 3.4-7.4 7-12z"/></svg>
          <span class="water-fill"></span>
        </div>
        <span class="water-count" aria-live="polite">0/8</span>
        <button class="water-btn water-add" type="button" aria-label="Add a glass of water">${ICONS.plus}</button>
      </div>

      <div class="buddy" role="button" tabindex="0" aria-label="Spider-Buddy, your tiny web hero. Press Enter to make him swing." data-pose="idle">
        <div class="bubble" role="status" aria-live="polite"></div>
        <div class="motion">
          <div class="sway">
            <div class="flip">
              <div class="frames"></div>
              <span class="grip" aria-hidden="true"></span>
            </div>
          </div>
        </div>
        <div class="fx" aria-hidden="true"></div>
      </div>
    </div>
  `;

  const $ = (sel) => shadow.querySelector(sel);
  const stage = $('.stage');
  const thread = $('.thread');
  const webTip = $('.web-tip');
  const webSplat = $('.web-splat');
  const buddy = $('.buddy');
  const motion = $('.motion');
  const flip = $('.flip');
  const frames = $('.frames');
  const grip = $('.grip');
  const bubble = $('.bubble');
  const fx = $('.fx');
  const focusPill = $('.focus-pill');
  const focusLabel = $('.focus-label');
  const focusTime = $('.focus-time');
  const focusToggle = $('.focus-toggle');
  const focusHide = $('.focus-hide');
  const ringFg = $('.ring-fg');
  const water = $('.water');
  const waterFill = $('.water-fill');
  const waterCount = $('.water-count');

  (document.documentElement || document.body).appendChild(host);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let state = Schema.sanitize({});
  let ready = false;
  let active = false;
  let pos = { x: 0, y: 0 };
  let anchor = { x: 0, y: 0 };
  let threadVisible = true;
  let threadShoot = 1; // 0..1 while a new strand is being fired
  let splatOn = false; // web splat shown where the last fired strand stuck
  let busy = 0; // swing generation counter
  let anim = null;
  let rafId = 0;
  let renderedLook = '';
  let focusHidden = false;
  let focusTicker = 0;
  let mishapTimer = 0;
  let wanderTimer = 0;
  let nudgeTimer = 0;
  let spiderTimer = 0;
  let bubbleTimer = 0;
  let activeSpider = null;
  let dimStyle = null;

  // ---------------------------------------------------------------------------
  // Sound effects — synthesised with the Web Audio API (no files, CSP-safe).
  // Gated by state.soundEnabled; the context is created/resumed on a user gesture.
  // ---------------------------------------------------------------------------

  const Sound = (() => {
    let ctx = null;
    let master = null;

    function ensure() {
      if (!state.soundEnabled) return null;
      try {
        if (!ctx) {
          const AC = window.AudioContext || window['webkitAudioContext'];
          if (!AC) return null;
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = 0.5;
          master.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      } catch {
        return null;
      }
    }

    function tone({ type = 'sine', from = 440, to = null, dur = 0.12, gain = 0.05, delay = 0 }) {
      const ac = ensure();
      if (!ac) return;
      const t0 = ac.currentTime + delay;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t0);
      if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    function noise({ dur = 0.3, gain = 0.05, from = 1200, to = 200, delay = 0, type = 'bandpass' }) {
      const ac = ensure();
      if (!ac) return;
      const t0 = ac.currentTime + delay;
      const n = Math.max(1, Math.floor(ac.sampleRate * dur));
      const buf = ac.createBuffer(1, n, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const filt = ac.createBiquadFilter();
      filt.type = type;
      filt.frequency.setValueAtTime(from, t0);
      filt.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
      filt.Q.value = 0.8;
      const g = ac.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filt).connect(g).connect(master);
      src.start(t0);
      src.stop(t0 + dur);
    }

    const fx = {
      thwip: () => tone({ type: 'square', from: 1150, to: 280, dur: 0.12, gain: 0.04 }),
      land: () => { tone({ type: 'sine', from: 210, to: 70, dur: 0.14, gain: 0.07 }); noise({ dur: 0.09, gain: 0.03, from: 500, to: 120 }); },
      jet: () => noise({ dur: 0.5, gain: 0.05, from: 280, to: 1700 }),
      step: () => tone({ type: 'triangle', from: 340, to: 170, dur: 0.05, gain: 0.03 }),
      climb: () => tone({ type: 'triangle', from: 520, to: 360, dur: 0.06, gain: 0.025 }),
      cheer: () => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.12, gain: 0.04, delay: i * 0.085 })),
      rescue: () => { tone({ type: 'sine', from: 784, dur: 0.1, gain: 0.05 }); tone({ type: 'sine', from: 1047, dur: 0.13, gain: 0.05, delay: 0.1 }); },
      water: () => tone({ type: 'sine', from: 920, to: 430, dur: 0.14, gain: 0.045 }),
      slip: () => tone({ type: 'sawtooth', from: 620, to: 130, dur: 0.3, gain: 0.04 }),
    };

    return {
      ensure,
      play(name) { try { if (state.soundEnabled && fx[name]) fx[name](); } catch { /* ignore */ } },
    };
  })();

  /** Plays `name` on a loop every `ms` while a motion runs; returns a stop fn. */
  function soundLoop(name, ms) {
    if (!state.soundEnabled) return () => {};
    let t = later(function tick() { Sound.play(name); t = later(tick, ms); }, ms * 0.5);
    return () => cancel(t);
  }

  const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => state.reducedMotion || reduceMotionQuery.matches;
  const look = () => Progression.resolveEquipped(state.equippedCosmetics, state.cosmeticsUnlocked);
  const pageHost = () => location.hostname || '';
  const vw = () => document.documentElement.clientWidth || window.innerWidth;
  const vh = () => document.documentElement.clientHeight || window.innerHeight;
  const charW = () => SIZES[state.characterSize] || SIZES.medium;
  const charH = () => Math.round(charW() * 1.25);

  // ---------------------------------------------------------------------------
  // Rendering: sprite + cosmetics
  // ---------------------------------------------------------------------------

  function renderSprite() {
    const l = look();
    const key = `${l.theme}|${l.badge}`;
    if (key === renderedLook) return;
    renderedLook = key;
    buddy.classList.toggle('pixel', isPixel());
    buddy.classList.toggle('bolt', isArticulated());
    frames.innerHTML = Sprite.FRAMES
      .map((f) => Sprite.frameSvg(f, l.theme, { uid: `pg-${f}`, acc: l.badge, className: `frame frame-${f}` }))
      .join('');
  }

  function applyLook() {
    renderSprite();
    const l = look();
    stage.style.setProperty('--thread', l.webline || state.webLineColor);
    bubble.classList.toggle('bubble-pixel', l.bubble === 'pixel');
    bubble.classList.toggle('bubble-night', l.bubble === 'night');
  }

  function setPose(name) {
    buddy.dataset.pose = name;
  }

  /** True when the equipped theme is drawn from pixel-art sprites rather than the vector character. */
  function isPixel() {
    const p = Sprite.PALETTES[look().theme];
    return !!(p && p.sprites);
  }

  /** True for the jointed hero ("Boltling"), whose limbs the CSS animates per pose. */
  function isArticulated() {
    const p = Sprite.PALETTES[look().theme];
    return !!(p && p.articulated);
  }

  /** Comic "THWIP!" popping off the side the strand is fired towards (pixel themes). */
  function thwip(toRight) {
    if (!isPixel() || reducedMotion()) return;
    const el = document.createElement('span');
    el.className = `thwip ${toRight ? 'to-right' : 'to-left'}`;
    el.textContent = 'THWIP!';
    buddy.appendChild(el);
    later(() => el.remove(), 650);
  }

  // ---------------------------------------------------------------------------
  // Position & thread
  // ---------------------------------------------------------------------------

  function clampPos(x, y) {
    const maxX = Math.max(0, vw() - charW());
    const maxY = Math.max(0, vh() - charH());
    return { x: Math.max(0, Math.min(maxX, x)), y: Math.max(0, Math.min(maxY, y)) };
  }

  function place(x, y) {
    pos = clampPos(x, y);
    buddy.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    placeBubble();
    drawThread();
  }

  function gripPoint() {
    const r = grip.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && r.left === 0 && r.top === 0) {
      return { x: pos.x + charW() / 2, y: pos.y + charH() * GRIP };
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function drawThread() {
    if (!threadVisible || !active) {
      thread.style.opacity = '0';
      webTip.style.opacity = '0';
      webSplat.classList.remove('show');
      return;
    }
    const g = gripPoint();
    const dx = anchor.x - g.x;
    const dy = anchor.y - g.y;
    const len = Math.max(0, Math.hypot(dx, dy) * threadShoot);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI) - 90;
    thread.style.opacity = '1';
    thread.style.height = `${len}px`;
    thread.style.transform = `translate3d(${g.x - 1}px, ${g.y}px, 0) rotate(${angle}deg)`;
    const shooting = threadShoot < 1;
    webTip.style.opacity = shooting ? '1' : '0';
    if (shooting) webTip.style.transform = `translate3d(${g.x + dx * threadShoot}px, ${g.y + dy * threadShoot}px, 0)`;
    const showSplat = splatOn && !shooting;
    // Only move the splat while it's shown, so the old one fades out where it was.
    if (showSplat) webSplat.style.transform = `translate3d(${anchor.x}px, ${anchor.y}px, 0)`;
    webSplat.classList.toggle('show', showSplat);
  }

  function trackThread(untilMs) {
    cancelAnimationFrame(rafId);
    const end = performance.now() + untilMs;
    const tick = () => {
      drawThread();
      if (performance.now() < end && alive) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function anchorAbove() {
    splatOn = false;
    anchor = { x: pos.x + charW() / 2, y: Math.max(0, Math.min(pos.y - 40, pos.y * 0.35)) };
  }

  function startCoords() {
    if (state.rememberPosition && state.lastPosition) {
      return { x: state.lastPosition.x * vw(), y: state.lastPosition.y * vh() };
    }
    const m = 28;
    const top = 72;
    const bottom = vh() - charH() - 90;
    switch (state.startPosition) {
      case 'top-left': return { x: m, y: top };
      case 'bottom-left': return { x: m, y: bottom };
      case 'bottom-right': return { x: vw() - charW() - m, y: bottom };
      default: return { x: vw() - charW() - m, y: top };
    }
  }

  // ---------------------------------------------------------------------------
  // Speech
  // ---------------------------------------------------------------------------

  function placeBubble() {
    const onRight = pos.x + charW() / 2 > vw() / 2;
    bubble.classList.toggle('side-left', onRight);
    bubble.classList.toggle('side-right', !onRight);
    bubble.classList.toggle('below', pos.y < 70);
  }

  function say(text, ms = 3200) {
    if (!text || !state.showSpeechBubbles || !active) return;
    cancel(bubbleTimer);
    placeBubble();
    bubble.textContent = text;
    bubble.classList.add('show');
    bubbleTimer = later(() => bubble.classList.remove('show'), Math.max(1800, Math.min(7000, ms + text.length * 25)));
  }

  function speak(category, vars, ms) {
    if (state.quietMode && !Dialogue.QUIET_ALLOWED.has(category)) return;
    say(Dialogue.getLine(state.personality, category, vars), ms);
  }

  // ---------------------------------------------------------------------------
  // Motion
  // ---------------------------------------------------------------------------

  function stopMotion() {
    busy++;
    if (anim) {
      try { anim.cancel(); } catch { /* ignore */ }
      anim = null;
    }
    buddy.classList.remove('flying', 'climbing', 'climb-left', 'climb-right', 'walking', 'running', 'skimming', 'boosting');
    threadShoot = 1;
    threadVisible = true; // crawling/walking/running turn the strand off; any new motion restores it
  }

  function landingEffect() {
    const effect = look().effect;
    if (!effect || reducedMotion()) return;
    fx.innerHTML = '';
    const glyph = effect === 'hearts' ? '❤' : '✦';
    for (let i = 0; i < 8; i++) {
      const s = document.createElement('span');
      s.className = `particle ${effect}`;
      s.textContent = glyph;
      s.style.setProperty('--a', `${i * 45 + Math.random() * 20}deg`);
      s.style.setProperty('--d', `${34 + Math.random() * 22}px`);
      fx.appendChild(s);
    }
    later(() => { fx.innerHTML = ''; }, 900);
  }

  /** Turns Spider-Buddy to face a horizontal travel distance (ignores tiny moves). */
  function face(dx) {
    if (Math.abs(dx) > 4) buddy.classList.toggle('facing-left', dx < 0);
  }

  /** Fires the strand from the grip to `nextAnchor`. Resolves false if interrupted. */
  async function shootStrand(nextAnchor, id) {
    anchor = nextAnchor;
    thwip(nextAnchor.x >= pos.x + charW() / 2);
    Sound.play('thwip');
    thread.classList.add('shooting');
    splatOn = false;
    threadShoot = 0;
    const shootStart = performance.now();
    await new Promise((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - shootStart) / 220);
        threadShoot = t === 1 ? 1 : 1 - (1 - t) ** 3; // ease-out: fast launch, slows as it reaches
        drawThread();
        if (threadShoot < 1 && id === busy) rafId = requestAnimationFrame(step);
        else resolve();
      };
      rafId = requestAnimationFrame(step);
    });
    thread.classList.remove('shooting');
    if (id !== busy) return false;
    splatOn = true;
    drawThread();
    return true;
  }

  /** Runs `keyframes` on the motion layer in flight pose, then lands at `target`. */
  async function travel(keyframes, options, target, id) {
    setPose('flight');
    buddy.classList.add('flying');
    anim = motion.animate(keyframes, { ...options, fill: 'forwards' });
    trackThread(options.duration + 80);
    try {
      await anim.finished;
    } catch {
      return false;
    }
    if (id !== busy) return false;
    anim.cancel();
    anim = null;
    buddy.classList.remove('flying');
    place(target.x, target.y);

    setPose('land');
    landingEffect();
    Sound.play('land');
    await wait(isPixel() ? 480 : 240); // pixel themes play a bounce on the thread
    if (id !== busy) return false;
    setPose('idle');
    drawThread();
    return true;
  }

  /**
   * Fires a new strand to (ax, ay) and swings to (tx, ty).
   * Returns false if another motion interrupted this one.
   */
  async function swingTo(ax, ay, tx, ty) {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const target = clampPos(tx, Math.max(44, ty));
    const nextAnchor = { x: Math.max(16, Math.min(vw() - 16, ax)), y: Math.max(0, Math.min(vh() * 0.45, ay)) };

    if (reducedMotion()) {
      anchor = nextAnchor;
      place(target.x, target.y);
      return true;
    }

    // 1. Anticipation, already facing the way we're heading
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    face(dx);
    setPose('anticipate');
    await wait(150);
    if (id !== busy) return false;

    // 2. Shoot the strand
    if (!(await shootStrand(nextAnchor, id))) return false;

    // 3. Swing along an arc under the anchor, then land
    const dip = Math.max(30, Math.min(110, Math.abs(dx) * 0.22));
    const tilt = dx >= 0 ? 1 : -1;
    const duration = Math.max(560, Math.min(1000, 420 + Math.hypot(dx, dy) * 0.9));
    return travel([
      { transform: 'translate(0,0) rotate(0deg)' },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.3 + dip}px) rotate(${-14 * tilt}deg)`, offset: 0.35 },
      { transform: `translate(${dx * 0.75}px, ${dy * 0.75 + dip * 0.55}px) rotate(${12 * tilt}deg)`, offset: 0.72 },
      { transform: `translate(${dx}px, ${dy}px) rotate(0deg)` },
    ], { duration, easing: 'cubic-bezier(.3,.7,.3,1)' }, target, id);
  }

  /**
   * Web-zip: fires a strand straight at (px, py) and gets reeled in along it,
   * ending up hanging just below that point.
   */
  async function zipTo(px, py) {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const point = { x: Math.max(16, Math.min(vw() - 16, px)), y: Math.max(0, Math.min(vh() - 16, py)) };
    const target = clampPos(point.x - charW() / 2, point.y - charH() * GRIP + 36);

    if (reducedMotion()) {
      anchor = point;
      place(target.x, target.y);
      return true;
    }

    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    face(dx);
    setPose('anticipate');
    await wait(110);
    if (id !== busy) return false;
    if (!(await shootStrand(point, id))) return false;

    // Reeled in: a short tug back, then accelerate along the strand and overshoot slightly.
    const dist = Math.hypot(dx, dy) || 1;
    const back = Math.min(14, dist * 0.08);
    const lean = Math.max(-24, Math.min(24, dx * 0.06));
    const duration = Math.max(280, Math.min(520, 200 + dist * 0.45));
    return travel([
      { transform: 'translate(0,0) rotate(0deg)' },
      { transform: `translate(${(-dx / dist) * back}px, ${(-dy / dist) * back}px) rotate(${-lean * 0.3}deg)`, offset: 0.18 },
      { transform: `translate(${dx * 1.04}px, ${dy * 1.04}px) rotate(${lean}deg)`, offset: 0.85 },
      { transform: `translate(${dx}px, ${dy}px) rotate(0deg)` },
    ], { duration, easing: 'cubic-bezier(.55,0,.75,.4)' }, target, id);
  }

  function randomSwing() {
    const fromRight = pos.x + charW() / 2 > vw() / 2;
    const minX = vw() * (fromRight ? 0.12 : 0.55);
    const maxX = vw() * (fromRight ? 0.45 : 0.88);
    const ax = minX + Math.random() * (maxX - minX);
    const ty = 70 + Math.random() * Math.min(160, vh() * 0.25);
    return swingTo(ax, Math.random() * 12, ax - charW() / 2, ty);
  }

  // ---------------------------------------------------------------------------
  // Wall-crawl & ground-walk (no web line — he clings to the surface instead)
  // ---------------------------------------------------------------------------

  /**
   * Clings sideways to the given edge ('left' | 'right') and scuttles up it in
   * surges (reach, pull, reach) instead of gliding. No web line while climbing.
   */
  async function crawlUp(side) {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const margin = 2;
    const x = side === 'left' ? margin : Math.max(0, vw() - charW() - margin);
    const topY = 46 + Math.random() * 44;
    const dist = Math.max(90, pos.y - topY);
    const startY = pos.y;
    place(x, startY);
    buddy.classList.remove('facing-left');
    buddy.classList.add('climbing', side === 'left' ? 'climb-left' : 'climb-right');
    threadVisible = false;
    setPose('crawl');
    drawThread();

    let stopClimb = () => {};
    const finish = (ny) => {
      stopClimb();
      place(x, ny);
      buddy.classList.remove('climbing', 'climb-left', 'climb-right');
      setPose('idle');
      threadVisible = true;
      anchorAbove();
      drawThread();
    };

    if (reducedMotion()) {
      finish(startY - dist);
      return true;
    }

    // Pull up in a handful of grabbing surges — each segment eases out like a lunge.
    const hops = Math.max(3, Math.round(dist / 38));
    const kf = [];
    for (let i = 0; i <= hops; i++) {
      kf.push({
        transform: `translateY(${(-dist * i / hops).toFixed(1)}px)`,
        offset: i / hops,
        easing: 'cubic-bezier(.3,.7,.2,1)',
      });
    }
    stopClimb = soundLoop('climb', Math.max(140, (dist * 7.5) / hops));
    try {
      anim = motion.animate(kf, { duration: Math.max(900, dist * 7.5), fill: 'forwards' });
      await anim.finished;
    } catch {
      stopClimb();
      return false;
    }
    if (id !== busy) { stopClimb(); return false; }
    anim.cancel();
    anim = null;
    finish(startY - dist);
    return true;
  }

  /** Walks along the bottom of the page to a random spot on the "floor". */
  async function walkAlong() {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const floorY = Math.max(0, vh() - charH() - 6);
    const fromRight = pos.x + charW() / 2 > vw() / 2;
    const span = Math.max(80, vw() - charW() - 40);
    const tx = clampPos(fromRight ? 20 + Math.random() * span * 0.4 : 20 + span * 0.55 + Math.random() * span * 0.4, floorY).x;
    place(pos.x, floorY);
    const dx = tx - pos.x;
    face(dx);
    buddy.classList.add('walking');
    threadVisible = false;
    setPose('walk');
    drawThread();

    if (reducedMotion()) {
      place(tx, floorY);
      buddy.classList.remove('walking');
      threadVisible = true;
      setPose('idle');
      anchorAbove();
      drawThread();
      return true;
    }

    try {
      anim = motion.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)` }],
        { duration: Math.max(1000, Math.abs(dx) * 6), easing: 'linear', fill: 'forwards' },
      );
      await anim.finished;
    } catch {
      return false;
    }
    if (id !== busy) return false;
    anim.cancel();
    anim = null;
    place(tx, floorY);
    buddy.classList.remove('walking');
    setPose('idle');
    threadVisible = true;
    anchorAbove();
    drawThread();
    return true;
  }

  /** Swings down to a side, then crawls up it. */
  async function roamCrawl() {
    const side = pos.x + charW() / 2 < vw() / 2 ? 'left' : 'right';
    const x = side === 'left' ? 30 : Math.max(0, vw() - charW() - 30);
    const landY = Math.max(80, vh() - charH() - (40 + Math.random() * 70));
    const ok = await swingTo(x + charW() / 2, Math.max(0, landY - 170), x, landY);
    if (!ok) return false;
    await wait(170);
    return crawlUp(side);
  }

  /** Swings down to the floor, then walks along it. */
  async function roamWalk() {
    const floorY = Math.max(0, vh() - charH() - 6);
    const sx = 40 + Math.random() * Math.max(1, vw() - charW() - 80);
    const ok = await swingTo(sx + charW() / 2, Math.max(0, floorY - 180), sx, floorY);
    if (!ok) return false;
    await wait(150);
    return walkAlong();
  }

  /** Dashes along the bottom of the page — same floor as the walk, much faster. */
  async function runAlong() {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const floorY = Math.max(0, vh() - charH() - 6);
    const fromRight = pos.x + charW() / 2 > vw() / 2;
    const span = Math.max(80, vw() - charW() - 40);
    const tx = clampPos(fromRight ? 20 + Math.random() * span * 0.45 : 20 + span * 0.5 + Math.random() * span * 0.45, floorY).x;
    place(pos.x, floorY);
    const dx = tx - pos.x;
    face(dx);
    buddy.classList.add('running');
    threadVisible = false;
    setPose('run');
    drawThread();

    let dust = null;
    let stopSteps = () => {};
    const finish = () => {
      stopSteps();
      if (dust) { dust.remove(); dust = null; }
      place(tx, floorY);
      buddy.classList.remove('running');
      setPose('idle');
      threadVisible = true;
      anchorAbove();
      drawThread();
    };

    if (reducedMotion()) {
      finish();
      return true;
    }

    // Puffs of dust kicked up at his heels sell the ground speed.
    dust = document.createElement('span');
    dust.className = 'run-dust';
    dust.innerHTML = '<i></i><i></i><i></i>';
    flip.appendChild(dust);
    stopSteps = soundLoop('step', 150);

    try {
      anim = motion.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)` }],
        { duration: Math.max(480, Math.abs(dx) * 2.4), easing: 'cubic-bezier(.25,.6,.3,1)', fill: 'forwards' },
      );
      await anim.finished;
    } catch {
      stopSteps();
      if (dust) { dust.remove(); dust = null; }
      return false;
    }
    if (id !== busy) { stopSteps(); if (dust) { dust.remove(); dust = null; } return false; }
    anim.cancel();
    anim = null;
    finish();
    return true;
  }

  /** Thruster-skims low along the bottom of the page (jet-dash on the "floor"). */
  async function jetSkim() {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const floorY = Math.max(0, vh() - charH() - 6);
    const fromRight = pos.x + charW() / 2 > vw() / 2;
    const span = Math.max(80, vw() - charW() - 40);
    const tx = clampPos(fromRight ? 20 + Math.random() * span * 0.5 : 20 + span * 0.45 + Math.random() * span * 0.5, floorY).x;
    place(pos.x, floorY);
    const dx = tx - pos.x;
    face(dx);
    buddy.classList.add('skimming');
    threadVisible = false;
    setPose('flight');
    drawThread();

    if (reducedMotion()) {
      place(tx, floorY);
      buddy.classList.remove('skimming');
      threadVisible = true;
      setPose('idle');
      anchorAbove();
      drawThread();
      return true;
    }

    const jet = document.createElement('span');
    jet.className = 'boost-jet skim-jet';
    buddy.appendChild(jet);
    Sound.play('jet');

    try {
      anim = motion.animate([
        { transform: 'translate(0,0) rotate(0deg)' },
        { transform: `translate(${dx * 0.5}px, -10px) rotate(0deg)`, offset: 0.5 },
        { transform: `translate(${dx}px, 0) rotate(0deg)` },
      ], { duration: Math.max(440, Math.abs(dx) * 2), easing: 'cubic-bezier(.3,.5,.2,1)', fill: 'forwards' });
      await anim.finished;
    } catch {
      jet.remove();
      return false;
    }
    jet.remove();
    if (id !== busy) return false;
    anim.cancel();
    anim = null;
    place(tx, floorY);
    buddy.classList.remove('skimming');
    setPose('land');
    await wait(160);
    if (id !== busy) return false;
    setPose('idle');
    threadVisible = true;
    anchorAbove();
    drawThread();
    return true;
  }

  /** Swings down to the floor, then runs along it. */
  async function roamRun() {
    const floorY = Math.max(0, vh() - charH() - 6);
    const sx = 40 + Math.random() * Math.max(1, vw() - charW() - 80);
    const ok = await swingTo(sx + charW() / 2, Math.max(0, floorY - 170), sx, floorY);
    if (!ok) return false;
    await wait(120);
    return runAlong();
  }

  /** Swings down to the floor, then jet-skims along it. */
  async function roamSkim() {
    const floorY = Math.max(0, vh() - charH() - 6);
    const sx = 40 + Math.random() * Math.max(1, vw() - charW() - 80);
    const ok = await swingTo(sx + charW() / 2, Math.max(0, floorY - 170), sx, floorY);
    if (!ok) return false;
    await wait(120);
    return jetSkim();
  }

  /** Thruster glide: lights a jet and flies straight to a point, no web line. */
  async function boostTo(tx, ty) {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const target = clampPos(tx, Math.max(40, ty));
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    face(dx);
    threadVisible = false;
    setPose('flight');
    buddy.classList.add('boosting');
    drawThread();

    if (reducedMotion()) {
      place(target.x, target.y);
      buddy.classList.remove('boosting');
      threadVisible = true;
      setPose('idle');
      anchorAbove();
      drawThread();
      return true;
    }

    // Exhaust flame under the feet while the thrusters are lit.
    const jet = document.createElement('span');
    jet.className = 'boost-jet';
    buddy.appendChild(jet);
    Sound.play('jet');

    const dist = Math.hypot(dx, dy) || 1;
    const tilt = Math.max(-18, Math.min(18, dx * 0.05));
    const duration = Math.max(520, Math.min(1100, 300 + dist * 0.8));
    try {
      anim = motion.animate([
        { transform: 'translate(0,0) rotate(0deg)' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 16}px) rotate(${tilt}deg)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg)` },
      ], { duration, easing: 'cubic-bezier(.4,.2,.2,1)', fill: 'forwards' });
      await anim.finished;
    } catch {
      jet.remove();
      return false;
    }
    jet.remove();
    if (id !== busy) return false;
    anim.cancel();
    anim = null;
    place(target.x, target.y);
    buddy.classList.remove('boosting');
    setPose('land');
    landingEffect();
    await wait(200);
    if (id !== busy) return false;
    setPose('idle');
    threadVisible = true;
    anchorAbove();
    drawThread();
    return true;
  }

  /** Picks a spot and thruster-glides there. */
  async function roamBoost() {
    const margin = 40;
    const tx = margin + Math.random() * Math.max(1, vw() - charW() - margin * 2);
    const ty = 60 + Math.random() * Math.max(0, vh() * 0.45 - 60);
    return boostTo(tx, ty);
  }

  async function celebrate() {
    if (!active) return;
    const id = ++busy;
    setPose('celebrate');
    Sound.play('cheer');
    if (!reducedMotion()) {
      try {
        anim = motion.animate(
          [{ transform: 'translateY(0)' }, { transform: 'translateY(-16px)' }, { transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }],
          { duration: 900, easing: 'ease-out' },
        );
        trackThread(950);
        await anim.finished;
      } catch { /* interrupted */ }
    } else {
      await wait(900);
    }
    if (id === busy) setPose('idle');
  }

  // ---------------------------------------------------------------------------
  // Roaming: swing to random spots on a timer
  // ---------------------------------------------------------------------------

  const WANDER_DELAY = { calm: [35, 30], normal: [14, 12], hyper: [5, 5] };

  function scheduleWander() {
    cancel(wanderTimer);
    const range = WANDER_DELAY[state.wanderFrequency];
    if (!range || !active) return;
    wanderTimer = later(runWander, (range[0] + Math.random() * range[1]) * 1000);
  }

  async function runWander() {
    const blocked = !active || document.hidden || anim || dragState || reducedMotion() || state.focusStatus === 'running';
    if (blocked) return scheduleWander();
    // Mix in a wall-crawl or a ground-walk now and then; otherwise swing.
    const style = Math.random();
    let ok;
    if (style < 0.18) {
      ok = await roamCrawl();
    } else if (style < 0.42) {
      ok = await roamRun();     // spider dash along the bottom
    } else if (style < 0.62) {
      ok = await roamSkim();    // jet-skim along the bottom
    } else if (style < 0.72) {
      ok = await roamWalk();
    } else if (style < 0.82) {
      ok = await roamBoost();
    } else {
      const margin = 24;
      const tx = margin + Math.random() * Math.max(0, vw() - charW() - margin * 2);
      const ty = 70 + Math.random() * Math.max(0, vh() * 0.55 - 70);
      // Anchor somewhere above the target, leaning towards the direction of travel.
      const lean = (tx - pos.x) * 0.25;
      const ax = tx + charW() / 2 + lean;
      ok = await swingTo(ax, Math.random() * 20, tx, ty);
    }
    if (ok && Math.random() < 0.15) speak('interact');
    scheduleWander();
  }

  // Occasional spoken "stay focused / keep going" nudge while you browse.
  function scheduleNudge() {
    cancel(nudgeTimer);
    if (!state.focusNudges || !active) return;
    nudgeTimer = later(runNudge, (240 + Math.random() * 300) * 1000); // every 4–9 min
  }

  function runNudge() {
    const blocked = !active || document.hidden || anim || dragState
      || state.quietMode || !state.showSpeechBubbles
      || state.focusStatus === 'running' || state.focusStatus === 'break';
    if (!blocked) speak('encouragement', null, 3600);
    scheduleNudge();
  }

  // ---------------------------------------------------------------------------
  // Mishaps
  // ---------------------------------------------------------------------------

  const MISHAP_DELAY = { rare: [150, 120], normal: [70, 60], frequent: [30, 25] };

  function scheduleMishap() {
    cancel(mishapTimer);
    const range = MISHAP_DELAY[state.mishapFrequency];
    if (!range || !active) return;
    mishapTimer = later(runMishap, (range[0] + Math.random() * range[1]) * 1000);
  }

  async function runMishap() {
    const blocked = !active || document.hidden || anim || dragState || reducedMotion() || state.focusStatus === 'running';
    if (blocked) return scheduleMishap();
    const id = ++busy;
    speak('slip', null, 1400);
    Sound.play('slip');
    setPose('slip');
    threadVisible = false;
    drawThread();
    const fall = Math.max(60, Math.min(200, vh() - pos.y - charH() - 20));
    try {
      anim = motion.animate(
        [{ transform: 'translateY(0) rotate(0deg)' }, { transform: `translateY(${fall}px) rotate(18deg)` }],
        { duration: 520, easing: 'cubic-bezier(.55,.05,.9,.45)', fill: 'forwards' },
      );
      await anim.finished;
    } catch {
      threadVisible = true;
      return scheduleMishap();
    }
    if (id !== busy) { threadVisible = true; return scheduleMishap(); }
    anim.cancel();
    anim = null;
    place(pos.x, pos.y + fall);
    threadVisible = true;
    const ax = Math.max(60, Math.min(vw() - 60, pos.x + charW() / 2 + (Math.random() > 0.5 ? -150 : 150)));
    const ok = await swingTo(ax, 0, ax - charW() / 2, 80 + Math.random() * 60);
    if (ok) speak('slipRecovery');
    scheduleMishap();
  }

  // ---------------------------------------------------------------------------
  // Tiny spider rescue
  // ---------------------------------------------------------------------------

  function scheduleSpider(initial = false) {
    cancel(spiderTimer);
    if (!active || !state.spidersEnabled) return;
    const delay = initial ? 25000 + Math.random() * 30000 : 50000 + Math.random() * 50000;
    spiderTimer = later(spawnSpider, delay);
  }

  function removeSpider() {
    if (activeSpider) {
      activeSpider.remove();
      activeSpider = null;
    }
  }

  function spawnSpider() {
    if (!active || !state.spidersEnabled || activeSpider || document.hidden || state.focusStatus === 'running') {
      return scheduleSpider();
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'baby';
    el.setAttribute('aria-label', 'A tiny spider is dangling here — click to rescue it');
    el.innerHTML = `<span class="baby-thread"></span><span class="baby-body">${Sprite.babySpiderSvg(30)}</span>`;
    const x = 60 + Math.random() * Math.max(40, vw() - 180);
    const drop = 120 + Math.random() * Math.max(60, vh() * 0.5);
    el.style.left = `${x}px`;
    el.style.setProperty('--drop', `${drop}px`);
    if (reducedMotion()) el.classList.add('still');

    let rescued = false;
    const rescue = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (rescued) return;
      rescued = true;
      el.classList.add('rescued');
      Sound.play('rescue');
      send({ type: 'RECORD_RESCUE' }).then((resp) => {
        if (resp && resp.success) speak('spiderRescue', { score: resp.spiderScore });
      });
      later(() => { if (activeSpider === el) removeSpider(); scheduleSpider(); }, 520);
    };
    el.addEventListener('click', rescue);
    stage.appendChild(el);
    activeSpider = el;

    // If not rescued, it climbs back up after a while — never clutters the page.
    later(() => {
      if (activeSpider !== el || rescued) return;
      el.classList.add('leaving');
      later(() => { if (activeSpider === el) removeSpider(); scheduleSpider(); }, 1200);
    }, 22000);
  }

  // ---------------------------------------------------------------------------
  // Focus pill
  // ---------------------------------------------------------------------------

  const RING_LEN = 2 * Math.PI * 15;

  function renderFocus() {
    clearInterval(focusTicker);
    const st = state.focusStatus;
    const show = active && st !== 'idle' && state.showFocusIndicator && !focusHidden;
    focusPill.classList.toggle('show', show);
    focusPill.classList.toggle('is-break', st === 'break');
    focusPill.classList.toggle('is-paused', st === 'paused');
    applyVideoDim();
    if (!show) return;

    focusLabel.textContent = st === 'break' ? 'Break' : st === 'paused' ? 'Paused' : 'Focus';
    focusToggle.innerHTML = st === 'running' ? ICONS.pause : st === 'paused' ? ICONS.play : ICONS.skip;
    focusToggle.setAttribute('aria-label', st === 'running' ? 'Pause focus' : st === 'paused' ? 'Resume focus' : 'Skip break');

    const tick = () => {
      focusTime.textContent = Schema.formatClock(Schema.focusRemainingMs(state));
      ringFg.style.strokeDashoffset = String(RING_LEN * (1 - Schema.focusProgress(state)));
    };
    tick();
    if (st !== 'paused') focusTicker = setInterval(tick, 1000);
  }

  function applyVideoDim() {
    const on = active && state.videoDimming && state.focusStatus === 'running';
    if (on && !dimStyle) {
      dimStyle = document.createElement('style');
      dimStyle.textContent = 'video{filter:grayscale(.7) brightness(.7) contrast(.9)!important;transition:filter .4s ease!important}';
      (document.head || document.documentElement).appendChild(dimStyle);
    } else if (!on && dimStyle) {
      dimStyle.remove();
      dimStyle = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Water widget
  // ---------------------------------------------------------------------------

  function renderWater() {
    const count = Schema.effectiveHydration(state);
    const target = state.hydrationTarget;
    water.classList.toggle('show', active && state.showHydrationWidget);
    water.classList.toggle('done', count >= target);
    waterCount.textContent = `${count}/${target}`;
    waterFill.style.height = `${Math.min(100, (count / target) * 100)}%`;
  }

  // ---------------------------------------------------------------------------
  // Apply state
  // ---------------------------------------------------------------------------

  function applyState(prev) {
    const wasActive = active;
    active = Schema.isActiveOn(state, pageHost());
    stage.classList.toggle('hidden', !active);
    stage.classList.toggle('reduced', reducedMotion());
    stage.dataset.size = state.characterSize;
    applyLook();
    renderWater();
    renderFocus();

    if (active && !wasActive) {
      place(pos.x, pos.y);
      scheduleMishap();
      scheduleWander();
      scheduleNudge();
      scheduleSpider(true);
    } else if (!active && wasActive) {
      stopMotion();
      cancel(mishapTimer);
      cancel(wanderTimer);
      cancel(nudgeTimer);
      cancel(spiderTimer);
      removeSpider();
      bubble.classList.remove('show');
    }

    if (prev && active) {
      if (prev.characterSize !== state.characterSize) place(pos.x, pos.y);
      if (prev.mishapFrequency !== state.mishapFrequency) scheduleMishap();
      if (prev.wanderFrequency !== state.wanderFrequency) scheduleWander();
      if (prev.focusNudges !== state.focusNudges) scheduleNudge();
      if (prev.spidersEnabled !== state.spidersEnabled) { removeSpider(); scheduleSpider(true); }
      if (prev.personality !== state.personality) speak('personalityChange');
      if (prev.focusStatus !== state.focusStatus) focusHidden = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer: drag & tap
  // ---------------------------------------------------------------------------

  let dragState = null;

  listen(buddy, 'pointerdown', (e) => {
    if (e.button !== 0) return;
    Sound.ensure(); // first gesture unlocks the audio context for later timer-driven sounds
    if (anim) {
      const r = motion.getBoundingClientRect();
      stopMotion();
      place(r.left, r.top);
    } else {
      stopMotion();
    }
    setPose('idle');
    dragState = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: e.clientX - pos.x, oy: e.clientY - pos.y, lastX: e.clientX, moved: false };
    buddy.setPointerCapture(e.pointerId);
  });

  listen(buddy, 'pointermove', (e) => {
    if (!dragState || e.pointerId !== dragState.id) return;
    if (!dragState.moved && Math.hypot(e.clientX - dragState.sx, e.clientY - dragState.sy) > 5) {
      dragState.moved = true;
      buddy.classList.add('dragging');
      bubble.classList.remove('show');
    }
    if (!dragState.moved) return;
    if (Math.abs(e.clientX - dragState.lastX) > 3) {
      buddy.classList.toggle('facing-left', e.clientX < dragState.lastX);
      dragState.lastX = e.clientX;
    }
    // While dragging, the strand stretches from where it was anchored.
    place(e.clientX - dragState.ox, e.clientY - dragState.oy);
  });

  const endDrag = (e, cancelled) => {
    if (!dragState || e.pointerId !== dragState.id) return;
    const { moved } = dragState;
    dragState = null;
    buddy.classList.remove('dragging');
    if (buddy.hasPointerCapture(e.pointerId)) buddy.releasePointerCapture(e.pointerId);
    if (cancelled) return;
    if (moved) {
      anchorAbove();
      drawThread();
      send({ type: 'SAVE_POSITION', position: { x: pos.x / vw(), y: pos.y / vh() } });
    } else {
      randomSwing().then((ok) => ok && speak('interact'));
    }
  };
  listen(buddy, 'pointerup', (e) => endDrag(e, false));
  listen(buddy, 'pointercancel', (e) => endDrag(e, true));
  listen(buddy, 'lostpointercapture', (e) => endDrag(e, true));

  listen(buddy, 'keydown', (e) => {
    const step = e.shiftKey ? 40 : 12;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      randomSwing().then((ok) => ok && speak('interact'));
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      stopMotion();
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d[0]) buddy.classList.toggle('facing-left', d[0] < 0);
      place(pos.x + d[0], pos.y + d[1]);
      anchorAbove();
      drawThread();
    }
  });

  // Focus pill & water controls
  listen(focusToggle, 'click', () => {
    const st = state.focusStatus;
    send({ type: st === 'running' ? 'FOCUS_PAUSE' : st === 'paused' ? 'FOCUS_RESUME' : 'FOCUS_SKIP_BREAK' });
  });
  listen(focusHide, 'click', () => {
    focusHidden = true;
    renderFocus();
  });
  listen($('.water-add'), 'click', async () => {
    const resp = await send({ type: 'HYDRATION_ADD' });
    if (!resp || !resp.success) return;
    Sound.play('water');
    if (resp.reachedGoal) {
      speak('hydrationComplete');
      celebrate();
    } else {
      speak('hydrationLogged', { count: resp.hydration, target: resp.target });
    }
  });
  listen($('.water-sub'), 'click', () => send({ type: 'HYDRATION_REMOVE' }));

  // Swing-to-click: ignore anything interactive or editable.
  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,details,video,audio,iframe,[role=button],[role=link],[role=menuitem],[role=tab],[contenteditable=""],[contenteditable=true]';
  listen(document, 'click', (e) => {
    Sound.ensure(); // any page click also unlocks audio
    if (!active || !state.swingToClicks || e.defaultPrevented || e.button !== 0) return;
    const path = e.composedPath();
    if (path.includes(host)) return;
    if (path.some((el) => el instanceof Element && el.matches(INTERACTIVE))) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length > 0) return;
    swingTo(e.clientX, Math.max(0, e.clientY - 220), e.clientX - charW() / 2, e.clientY - charH() * 0.5)
      .then((ok) => ok && Math.random() < 0.35 && speak('interact'));
  }, { passive: true, capture: false });

  // Web-zip: double-click empty page space (not text, links or controls).
  listen(document, 'dblclick', (e) => {
    if (!active || !state.webZip || e.defaultPrevented || e.button !== 0) return;
    const path = e.composedPath();
    if (path.includes(host)) return;
    if (path.some((el) => el instanceof Element && el.matches(INTERACTIVE))) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).trim().length > 0) return; // they were selecting a word
    zipTo(e.clientX, e.clientY).then((ok) => ok && Math.random() < 0.3 && speak('interact'));
  }, { passive: true });

  // Resize: keep Spider-Buddy and his anchor on screen.
  let resizeTimer = 0;
  listen(window, 'resize', () => {
    cancel(resizeTimer);
    resizeTimer = later(() => {
      place(pos.x, pos.y);
      anchor.x = Math.max(16, Math.min(vw() - 16, anchor.x));
      drawThread();
    }, 100);
  }, { passive: true });

  listen(document, 'visibilitychange', () => {
    if (!document.hidden && active) {
      if (!mishapTimer || !timers.has(mishapTimer)) scheduleMishap();
      if (!wanderTimer || !timers.has(wanderTimer)) scheduleWander();
      if (!nudgeTimer || !timers.has(nudgeTimer)) scheduleNudge();
      if (!activeSpider && (!spiderTimer || !timers.has(spiderTimer))) scheduleSpider();
      renderWater();
      renderFocus();
    }
  });

  listen(reduceMotionQuery, 'change', () => applyState(null));

  // ---------------------------------------------------------------------------
  // Page intel
  // ---------------------------------------------------------------------------

  function pageIntel() {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', HOST_TAG.toUpperCase()]);
    let words = 0;
    const body = document.body;
    if (body) {
      const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(document.documentElement.lang || undefined, { granularity: 'word' }) : null;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          for (let p = node.parentElement; p && p !== body; p = p.parentElement) {
            if (SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT;
            if (p.hidden || p.getAttribute('aria-hidden') === 'true') return NodeFilter.FILTER_REJECT;
          }
          return /\S/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      let budget = 20000; // keep huge pages fast
      for (let n = walker.nextNode(); n && budget > 0; n = walker.nextNode(), budget--) {
        const text = n.nodeValue;
        if (seg) {
          for (const s of seg.segment(text)) if (s.isWordLike) words++;
        } else {
          words += text.trim().split(/\s+/).filter(Boolean).length;
        }
      }
    }
    const links = [...document.links];
    const external = links.filter((a) => { try { return a.hostname && a.hostname !== location.hostname; } catch { return false; } }).length;
    return {
      words,
      minutes: words === 0 ? 0 : Math.max(1, Math.round(words / 230)),
      links: links.length,
      externalLinks: external,
      headings: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      images: document.images.length,
      title: document.title.slice(0, 120),
    };
  }

  // ---------------------------------------------------------------------------
  // Summon & events
  // ---------------------------------------------------------------------------

  async function summon() {
    // Background already woke Spider-Buddy in storage; make sure we're visible now.
    state = { ...state, enabled: true, snoozeUntil: 0 };
    applyState(null);
    if (!active) return;
    const onScreen = pos.x >= 0 && pos.y >= 0 && pos.x <= vw() - 10 && pos.y <= vh() - 10;
    if (!onScreen) {
      const s = startCoords();
      place(s.x, s.y);
      anchorAbove();
    }
    const ok = await randomSwing();
    if (ok) speak('summon');
  }

  function handleEvent(event, vars) {
    if (!active || document.hidden) return;
    switch (event) {
      case 'focusComplete':
      case 'achievement':
        speak(event, vars, 4200);
        celebrate();
        break;
      case 'rewardUnlock':
        speak(event, vars, 4200);
        break;
      case 'styleChange':
        speak(event);
        landingEffect();
        break;
      case 'hydrationReminder':
        speak(event, vars, 4500);
        break;
      default:
        speak(event, vars);
    }
  }

  function onMessage(msg, _sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string') return false;
    switch (msg.type) {
      case 'WEBLING_SUMMON':
        summon();
        sendResponse({ success: true });
        return false;
      case 'WEBLING_STATS':
        sendResponse({ success: true, intel: pageIntel() });
        return false;
      case 'WEBLING_EVENT':
        handleEvent(msg.event, msg.vars);
        sendResponse({ success: true });
        return false;
      case 'WEBLING_RESET':
        load().then(() => {
          const s = startCoords();
          place(s.x, s.y);
          anchorAbove();
          drawThread();
        });
        sendResponse({ success: true });
        return false;
      case 'WEBLING_PING':
        sendResponse({ success: true, active });
        return false;
      default:
        return false;
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local' || !ready) return;
    const prev = state;
    const merged = { ...state };
    for (const [k, c] of Object.entries(changes)) {
      if (k === 'lastPosition') continue; // don't teleport this tab when another tab moves Spider-Buddy
      merged[k] = c.newValue;
    }
    state = Schema.sanitize(merged);
    applyState(prev);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async function load() {
    try {
      state = Schema.sanitize(await chrome.storage.local.get(null));
    } catch {
      state = Schema.sanitize({});
    }
    renderedLook = '';
    active = false;
    applyState(null);
  }

  function teardown() {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(rafId);
    clearInterval(focusTicker);
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* ignore */ }
    try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch { /* ignore */ }
    if (dimStyle) dimStyle.remove();
    host.remove();
    if (globalThis.__weblingTeardown === teardown) delete globalThis.__weblingTeardown;
  }
  globalThis.__weblingTeardown = teardown;

  async function init() {
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.storage.onChanged.addListener(onStorageChanged);
    await load();
    const s = startCoords();
    place(s.x, s.y);
    anchorAbove();
    ready = true;
    drawThread();

    if (!/^(https?|file):/.test(location.protocol)) return;
    send({ type: 'RECORD_PATROL' });
    if (active && state.greetOnPageLoad && !state.quietMode) {
      const resp = await send({ type: 'GREET_CHECK' });
      if (resp && resp.greet) later(() => speak('greeting'), 900);
    }
  }

  init();

  // ---------------------------------------------------------------------------
  // Static assets (hoisted)
  // ---------------------------------------------------------------------------

  function STYLES() {
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      button { font: inherit; color: inherit; }

      .stage {
        --thread: #e9f2ff;
        --ink: #1d1650;
        --violet: #5a4bd8;
        --mint: #3fe0b6;
        --card: rgba(22, 18, 52, 0.92);
        --card-line: rgba(255, 255, 255, 0.12);
        position: fixed; inset: 0; pointer-events: none;
        font: 500 13px/1.35 ui-rounded, "SF Pro Rounded", "Nunito", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        color: #f4f2ff;
        -webkit-font-smoothing: antialiased;
      }
      .stage.hidden { display: none; }

      /* Thread */
      .thread {
        position: fixed; left: 0; top: 0; width: 2.5px; height: 0;
        background: var(--thread);
        transform-origin: 50% 0;
        border-radius: 2px;
        box-shadow: 0 0 0 1px rgba(29, 22, 80, 0.38), 0 0 4px rgba(29, 22, 80, 0.15);
        pointer-events: none; opacity: 0;
        will-change: transform, height;
      }
      .thread.shooting { filter: drop-shadow(0 0 3px #b8f5ff); }
      .web-tip {
        position: fixed; left: -5px; top: -5px; width: 10px; height: 10px; border-radius: 50%;
        background: radial-gradient(circle, #fff 35%, var(--thread) 60%, transparent 72%);
        box-shadow: 0 0 8px 2px rgba(184, 245, 255, .75);
        pointer-events: none; opacity: 0; will-change: transform;
      }
      .web-splat {
        position: fixed; left: -13px; top: -13px; width: 26px; height: 26px; overflow: visible;
        fill: none; stroke: var(--thread); stroke-width: 1.3; stroke-linejoin: round;
        filter: drop-shadow(0 0 1px rgba(29, 22, 80, .55));
        pointer-events: none; opacity: 0; transition: opacity .4s ease;
      }
      .web-splat.show { opacity: .95; transition: none; }
      .web-splat.show path { animation: splat .32s cubic-bezier(.2, 1.6, .4, 1) both; transform-origin: 0 0; }
      .stage.reduced .web-splat path { animation: none; }

      /* Buddy */
      .buddy {
        position: fixed; left: 0; top: 0;
        width: var(--w, 84px); height: calc(var(--w, 84px) * 1.25);
        pointer-events: auto; cursor: grab; touch-action: none; user-select: none;
        -webkit-tap-highlight-color: transparent; outline: none;
        will-change: transform;
      }
      .stage[data-size="small"] .buddy { --w: 64px; }
      .stage[data-size="medium"] .buddy { --w: 84px; }
      .stage[data-size="large"] .buddy { --w: 108px; }
      .buddy.dragging { cursor: grabbing; }
      .buddy:focus-visible .flip { outline: 3px solid var(--mint); outline-offset: 4px; border-radius: 50%; }
      .motion, .sway, .flip, .frames { position: absolute; inset: 0; }
      .sway { transform-origin: 50% 12%; animation: sway 3.4s ease-in-out infinite alternate; }
      .buddy.flying .sway, .buddy.dragging .sway { animation: none; }
      .flip { transition: transform .12s ease; filter: drop-shadow(0 6px 6px rgba(20, 14, 60, 0.28)); }
      .buddy:hover .flip { filter: drop-shadow(0 8px 10px rgba(20, 14, 60, 0.38)); }
      .buddy.facing-left .flip { transform: scaleX(-1); }
      .frame { position: absolute; inset: 0; width: 100%; height: 100%; display: none; overflow: visible; }
      .buddy[data-pose="idle"] .frame-idle,
      .buddy[data-pose="anticipate"] .frame-anticipate,
      .buddy[data-pose="flight"] .frame-flight,
      .buddy[data-pose="land"] .frame-land,
      .buddy[data-pose="slip"] .frame-slip,
      .buddy[data-pose="celebrate"] .frame-celebrate { display: block; }
      /* Crawl, walk & run reuse the crouched, action-ready frame. */
      .buddy[data-pose="crawl"] .frame-anticipate,
      .buddy[data-pose="walk"] .frame-anticipate,
      .buddy[data-pose="run"] .frame-anticipate { display: block; }
      .buddy.climbing .sway, .buddy.walking .sway,
      .buddy.running .sway, .buddy.boosting .sway, .buddy.skimming .sway { animation: none; }
      .buddy.boosting[data-pose="flight"] .frame-flight,
      .buddy.skimming[data-pose="flight"] .frame-flight { animation: none; }
      /* Wall-crawl: turn the whole body sideways so he clings to the edge, head up. */
      .buddy.climbing .sway { transform-origin: 50% 50%; }
      .buddy.climb-right .sway { transform: rotate(-90deg); }
      .buddy.climb-left .sway { transform: rotate(90deg); }
      .grip { position: absolute; left: 50%; top: ${(GRIP * 100).toFixed(2)}%; width: 2px; height: 2px; margin: -1px; }

      /* Pixel-art themes: per-pose animation (frames restart when they become visible) */
      .buddy.pixel .frame { transform-origin: 50% ${(GRIP * 100).toFixed(2)}%; }
      .buddy.pixel[data-pose="idle"] .frame-idle { animation: px-hang 2.6s ease-in-out infinite; }
      .buddy.pixel[data-pose="anticipate"] .frame-anticipate { animation: px-crouch .15s ease-out both; }
      .buddy.pixel[data-pose="flight"] .frame-flight {
        animation: px-swing .5s ease-in-out infinite alternate;
        filter: drop-shadow(-7px -3px 0 rgba(214, 32, 47, .28)) drop-shadow(-12px -5px 0 rgba(31, 79, 184, .16));
      }
      .buddy.pixel[data-pose="land"] .frame-land { animation: px-land .48s cubic-bezier(.3, 1.5, .5, 1) both; }
      .buddy.pixel[data-pose="slip"] .frame-slip { transform-origin: 50% 55%; animation: px-tumble .45s linear infinite; }
      .buddy.pixel[data-pose="celebrate"] .frame-celebrate { animation: px-cheer .22s steps(2, jump-none) infinite alternate; }
      .buddy.pixel[data-pose="crawl"] .frame-anticipate { transform-origin: 50% 50%; animation: px-climb .34s ease-in-out infinite; }
      .buddy.pixel[data-pose="walk"] .frame-anticipate { animation: px-walk .3s ease-in-out infinite alternate; }
      .buddy.pixel[data-pose="run"] .frame-anticipate {
        transform-origin: 50% 92%; animation: px-run .19s ease-in-out infinite;
        filter: drop-shadow(-9px 0 0 rgba(214, 32, 47, .26)) drop-shadow(-16px 0 0 rgba(31, 79, 184, .14));
      }
      .buddy.pixel .sway { animation-duration: 2.2s; }
      .stage.reduced .buddy.pixel .frame { animation: none !important; filter: none; }

      .thwip {
        position: absolute; top: -4%; z-index: 2; pointer-events: none;
        font: italic 900 15px/1 "Impact", "Arial Black", system-ui, sans-serif; letter-spacing: .5px;
        color: #fff; -webkit-text-stroke: 1.2px #b3121f;
        text-shadow: 2px 2px 0 #1a0507, 0 0 8px rgba(255, 255, 255, .6);
        animation: thwip .6s cubic-bezier(.2, 1.4, .4, 1) forwards;
      }
      .thwip.to-right { left: 62%; --r: -10deg; }
      .thwip.to-left { right: 62%; --r: 10deg; }

      /* Thruster exhaust while boosting */
      .boost-jet {
        position: absolute; left: 50%; bottom: 1%;
        width: 16px; height: 32px; margin-left: -8px;
        background: radial-gradient(ellipse at 50% 18%, #fff 0%, #ffe07a 26%, #ff8a3c 54%, rgba(255,70,40,0) 86%);
        border-radius: 50% 50% 46% 46% / 28% 28% 72% 72%;
        transform-origin: 50% 0; opacity: .92; pointer-events: none; z-index: 1;
        filter: drop-shadow(0 0 6px rgba(255,150,60,.7));
        animation: jet .12s steps(2) infinite;
      }
      @keyframes jet {
        from { transform: scaleY(1) scaleX(1); opacity: .92; }
        to { transform: scaleY(1.35) scaleX(.78); opacity: .62; }
      }
      /* Low, wide exhaust for the floor-skim dash */
      .boost-jet.skim-jet {
        left: 50%; bottom: 8%; width: 34px; height: 15px; margin-left: -24px;
        background: radial-gradient(ellipse at 80% 50%, #fff 0%, #ffe07a 26%, #ff8a3c 55%, rgba(255,70,40,0) 88%);
        border-radius: 46% 50% 50% 46% / 50% 60% 40% 50%;
        animation: skim-jet .1s steps(2) infinite;
      }
      @keyframes skim-jet {
        from { transform: scaleX(1) scaleY(1); opacity: .9; }
        to { transform: scaleX(1.3) scaleY(.75); opacity: .6; }
      }
      .stage.reduced .boost-jet { animation: none; }

      /* Landing particles */
      .fx { position: absolute; left: 50%; top: 70%; width: 0; height: 0; }
      .particle {
        position: absolute; left: -6px; top: -8px; font-size: 13px; line-height: 1;
        color: #ffd23f; text-shadow: 0 0 6px rgba(255, 210, 63, .8);
        animation: burst .8s ease-out forwards;
      }
      .particle.hearts { color: #ff6f9c; text-shadow: 0 0 6px rgba(255, 111, 156, .7); }

      /* Speech bubble */
      .bubble {
        position: absolute; top: 34%;
        width: max-content; max-width: 230px;
        padding: 9px 13px;
        background: #ffffff; color: #1d1650;
        border: 2px solid #1d1650; border-radius: 16px;
        box-shadow: 0 10px 24px rgba(20, 14, 60, 0.22);
        font-weight: 700; font-size: 12.5px; line-height: 1.35;
        opacity: 0; transform: translateY(6px) scale(.96);
        transition: opacity .18s ease, transform .22s cubic-bezier(.2,.9,.3,1.3);
        pointer-events: none; z-index: 3;
      }
      .bubble.show { opacity: 1; transform: none; }
      .bubble.side-left { right: calc(100% + 10px); border-bottom-right-radius: 4px; }
      .bubble.side-right { left: calc(100% + 10px); border-bottom-left-radius: 4px; }
      .bubble.below { top: 100%; }
      .bubble.bubble-pixel {
        border-radius: 0; border-width: 3px;
        box-shadow: 4px 4px 0 #1d1650;
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 11.5px;
      }
      .bubble.bubble-night {
        background: #1d1650; color: #e9e4ff; border-color: #7b6cf0;
        box-shadow: 0 0 18px rgba(123, 108, 240, .55);
      }

      /* Focus pill */
      .focus-pill {
        position: fixed; top: 12px; left: 50%;
        display: flex; align-items: center; gap: 8px;
        padding: 5px 6px 5px 6px;
        background: var(--card); color: #fff;
        border: 1px solid var(--card-line); border-radius: 999px;
        box-shadow: 0 10px 30px rgba(10, 8, 30, .35);
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        transform: translate(-50%, -140%); opacity: 0;
        transition: transform .3s cubic-bezier(.2,.9,.3,1.2), opacity .2s ease;
        pointer-events: none;
      }
      .focus-pill.show { transform: translate(-50%, 0); opacity: 1; pointer-events: auto; }
      .ring { width: 26px; height: 26px; transform: rotate(-90deg); }
      .ring circle { fill: none; stroke-width: 4; }
      .ring-bg { stroke: rgba(255,255,255,.14); }
      .ring-fg { stroke: #8b7df5; stroke-linecap: round; stroke-dasharray: ${(2 * Math.PI * 15).toFixed(2)}; transition: stroke-dashoffset .9s linear; }
      .focus-pill.is-break .ring-fg { stroke: var(--mint); }
      .focus-pill.is-paused .ring-fg { stroke: #9ca3af; }
      .focus-label { font-weight: 700; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; opacity: .75; }
      .focus-time { font: 800 14px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; min-width: 46px; }
      .pill-btn {
        display: grid; place-items: center; width: 26px; height: 26px; padding: 0;
        border: 0; border-radius: 50%; background: rgba(255,255,255,.1); cursor: pointer;
      }
      .pill-btn:hover { background: rgba(255,255,255,.2); }
      .pill-btn:focus-visible { outline: 2px solid var(--mint); outline-offset: 1px; }
      .pill-btn svg { width: 14px; height: 14px; fill: currentColor; }
      .focus-hide { background: transparent; opacity: .6; }

      /* Water widget */
      .water {
        position: fixed; right: 14px; bottom: 14px;
        display: none; align-items: center; gap: 6px;
        padding: 5px;
        background: var(--card);
        border: 1px solid var(--card-line); border-radius: 999px;
        box-shadow: 0 10px 28px rgba(10, 8, 30, .3);
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        pointer-events: auto;
        opacity: .82; transition: opacity .2s ease, transform .2s ease;
      }
      .water.show { display: flex; }
      .water:hover, .water:focus-within { opacity: 1; }
      .water-meter { position: relative; width: 22px; height: 26px; overflow: hidden; }
      .water-meter .drop { position: absolute; inset: 0; width: 100%; height: 100%; fill: rgba(143, 216, 255, .18); stroke: #8fd8ff; stroke-width: 1.6; }
      .water-fill {
        position: absolute; left: 0; right: 0; bottom: 0; height: 0%;
        background: linear-gradient(180deg, #7fe3ff, #3a9cff);
        clip-path: path("M11 2.5c3.3 4.2 6.4 7.7 6.4 11a6.4 6.4 0 0 1-12.8 0c0-3.3 3.1-6.8 6.4-11z");
        transition: height .35s cubic-bezier(.2,.8,.3,1);
      }
      .water-count { font: 800 12px/1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; min-width: 30px; text-align: center; color: #bfeaff; }
      .water.done .water-count { color: var(--mint); }
      .water-btn {
        display: grid; place-items: center; width: 26px; height: 26px; padding: 0;
        border: 0; border-radius: 50%; background: rgba(255,255,255,.1); color: #fff; cursor: pointer;
      }
      .water-btn:hover { background: rgba(255,255,255,.22); }
      .water-btn:active { transform: scale(.92); }
      .water-btn:focus-visible { outline: 2px solid var(--mint); outline-offset: 1px; }
      .water-btn svg { width: 14px; height: 14px; fill: currentColor; }
      .water-add { background: #3a9cff; }
      .water-add:hover { background: #5aafff; }

      /* Baby spiders */
      .baby {
        position: fixed; top: 0; width: 34px; height: var(--drop);
        padding: 0; border: 0; background: transparent; cursor: pointer;
        pointer-events: auto; transform-origin: 50% 0;
        animation: descend 1.6s cubic-bezier(.3,.8,.4,1) both, dangle 2.6s ease-in-out 1.6s infinite alternate;
      }
      .baby.still { animation: none; }
      .baby-thread { position: absolute; left: 50%; top: 0; bottom: 24px; width: 1.5px; margin-left: -.75px; background: rgba(255,255,255,.85); box-shadow: 0 0 0 .5px rgba(29,22,80,.4); }
      .baby-body { position: absolute; left: 2px; bottom: 0; width: 30px; height: 30px; filter: drop-shadow(0 3px 3px rgba(20,14,60,.3)); transition: transform .15s ease; }
      .baby:hover .baby-body { transform: scale(1.15); }
      .baby:focus-visible .baby-body { outline: 2px dashed var(--mint); outline-offset: 2px; border-radius: 50%; }
      .baby.rescued { animation: rescued .5s cubic-bezier(.2,.9,.3,1) forwards; pointer-events: none; }
      .baby.leaving { animation: climb 1.2s ease-in forwards; pointer-events: none; }

      @keyframes sway { from { transform: rotate(-3deg); } to { transform: rotate(3deg); } }
      @keyframes splat { from { transform: scale(.2) rotate(-25deg); } to { transform: none; } }
      @keyframes px-hang { 0%, 100% { transform: translateY(0) scaleY(1); } 50% { transform: translateY(3px) scaleY(1.035); } }
      @keyframes px-crouch { from { transform: scale(1, 1); } to { transform: scale(1.07, .9); } }
      @keyframes px-swing { from { transform: rotate(-6deg); } to { transform: rotate(6deg); } }
      @keyframes px-land {
        0% { transform: scale(.88, 1.2); }
        40% { transform: scale(1.08, .88); }
        70% { transform: scale(.97, 1.05); }
        100% { transform: none; }
      }
      @keyframes px-tumble { to { transform: rotate(360deg); } }
      @keyframes px-climb {
        0% { transform: rotate(-5deg) scale(1, 1); }
        50% { transform: rotate(5deg) scale(1.03, .97); }
        100% { transform: rotate(-5deg) scale(1, 1); }
      }
      @keyframes px-walk { from { transform: translateY(0) scaleY(1); } to { transform: translateY(-1.5px) scaleY(.97); } }
      @keyframes px-run {
        0%   { transform: rotate(18deg) translateY(1px) scaleY(.95); }
        30%  { transform: rotate(11deg) translateY(-6px) scaleY(1.04); }
        50%  { transform: rotate(15deg) translateY(-2px) scaleY(1); }
        80%  { transform: rotate(11deg) translateY(-6px) scaleY(1.04); }
        100% { transform: rotate(18deg) translateY(1px) scaleY(.95); }
      }
      .run-dust { position: absolute; left: 46%; bottom: 5%; width: 0; height: 0; pointer-events: none; z-index: 0; }
      .run-dust i {
        position: absolute; bottom: 0; left: 0; width: 10px; height: 10px; border-radius: 50%;
        background: radial-gradient(circle, rgba(226,226,236,.8), rgba(205,205,215,0) 70%);
        animation: puff .42s linear infinite;
      }
      .run-dust i:nth-child(2) { animation-delay: .14s; }
      .run-dust i:nth-child(3) { animation-delay: .28s; }
      @keyframes puff {
        from { transform: translate(0, 0) scale(.5); opacity: .85; }
        to { transform: translate(-24px, -7px) scale(1.5); opacity: 0; }
      }
      .stage.reduced .run-dust { display: none; }

      /* --- Boltling: jointed original hero, limbs animated per pose --- */
      .buddy.bolt .bolt-arm, .buddy.bolt .bolt-leg, .buddy.bolt .bolt-jet { transform-box: fill-box; transform-origin: 50% 0; }
      .buddy.bolt .bolt-head { transform-box: fill-box; transform-origin: 50% 100%; }
      .buddy.bolt .bolt-jet { opacity: 0; }

      .buddy.bolt[data-pose="idle"] .bolt-arm-l, .buddy.bolt[data-pose="idle"] .bolt-leg-r { animation: bolt-dangle-a 3s ease-in-out infinite; }
      .buddy.bolt[data-pose="idle"] .bolt-arm-r, .buddy.bolt[data-pose="idle"] .bolt-leg-l { animation: bolt-dangle-b 3s ease-in-out infinite; }

      .buddy.bolt[data-pose="run"] .frame-anticipate { animation: bolt-run-bob .3s ease-in-out infinite; }
      .buddy.bolt[data-pose="run"] .bolt-leg-l { animation: bolt-stride .3s ease-in-out infinite; }
      .buddy.bolt[data-pose="run"] .bolt-leg-r { animation: bolt-stride .3s ease-in-out infinite; animation-delay: -.15s; }
      .buddy.bolt[data-pose="run"] .bolt-arm-l { animation: bolt-pump .3s ease-in-out infinite; animation-delay: -.15s; }
      .buddy.bolt[data-pose="run"] .bolt-arm-r { animation: bolt-pump .3s ease-in-out infinite; }

      .buddy.bolt[data-pose="walk"] .bolt-leg-l, .buddy.bolt[data-pose="walk"] .bolt-arm-r { animation: bolt-step .52s ease-in-out infinite; }
      .buddy.bolt[data-pose="walk"] .bolt-leg-r, .buddy.bolt[data-pose="walk"] .bolt-arm-l { animation: bolt-step .52s ease-in-out infinite; animation-delay: -.26s; }

      .buddy.bolt[data-pose="crawl"] .bolt-leg-l, .buddy.bolt[data-pose="crawl"] .bolt-arm-r { animation: bolt-reach .44s ease-in-out infinite; }
      .buddy.bolt[data-pose="crawl"] .bolt-leg-r, .buddy.bolt[data-pose="crawl"] .bolt-arm-l { animation: bolt-reach .44s ease-in-out infinite; animation-delay: -.22s; }

      .buddy.bolt[data-pose="flight"] .bolt-leg-l, .buddy.bolt[data-pose="flight"] .bolt-leg-r { transform: rotate(38deg); }
      .buddy.bolt[data-pose="flight"] .bolt-arm-l, .buddy.bolt[data-pose="flight"] .bolt-arm-r { transform: rotate(-26deg); }
      .buddy.bolt.boosting .bolt-jet, .buddy.bolt.skimming .bolt-jet { opacity: 1; animation: bolt-flame .09s steps(2) infinite; }

      .buddy.bolt[data-pose="land"] .bolt-leg-l { transform: rotate(13deg); }
      .buddy.bolt[data-pose="land"] .bolt-leg-r { transform: rotate(-13deg); }

      .buddy.bolt[data-pose="celebrate"] .bolt-arm-l { animation: bolt-cheer-l .26s ease-in-out infinite alternate; }
      .buddy.bolt[data-pose="celebrate"] .bolt-arm-r { animation: bolt-cheer-r .26s ease-in-out infinite alternate; }

      .stage.reduced .buddy.bolt .bolt-arm,
      .stage.reduced .buddy.bolt .bolt-leg,
      .stage.reduced .buddy.bolt .bolt-jet,
      .stage.reduced .buddy.bolt .frame-anticipate { animation: none !important; }

      @keyframes bolt-stride { 0% { transform: rotate(32deg); } 50% { transform: rotate(-32deg); } 100% { transform: rotate(32deg); } }
      @keyframes bolt-pump { 0% { transform: rotate(-26deg); } 50% { transform: rotate(26deg); } 100% { transform: rotate(-26deg); } }
      @keyframes bolt-step { 0% { transform: rotate(16deg); } 50% { transform: rotate(-16deg); } 100% { transform: rotate(16deg); } }
      @keyframes bolt-reach { 0% { transform: rotate(26deg); } 50% { transform: rotate(-20deg); } 100% { transform: rotate(26deg); } }
      @keyframes bolt-run-bob { 0% { transform: rotate(7deg) translateY(1px); } 25% { transform: rotate(7deg) translateY(-4px); } 50% { transform: rotate(7deg) translateY(1px); } 75% { transform: rotate(7deg) translateY(-4px); } 100% { transform: rotate(7deg) translateY(1px); } }
      @keyframes bolt-dangle-a { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
      @keyframes bolt-dangle-b { 0%, 100% { transform: rotate(4deg); } 50% { transform: rotate(-4deg); } }
      @keyframes bolt-flame { from { transform: scaleY(1); } to { transform: scaleY(1.45); } }
      @keyframes bolt-cheer-l { from { transform: rotate(-150deg); } to { transform: rotate(-118deg); } }
      @keyframes bolt-cheer-r { from { transform: rotate(150deg); } to { transform: rotate(118deg); } }
      @keyframes px-cheer { from { transform: rotate(-5deg) translateY(0); } to { transform: rotate(5deg) translateY(-3px); } }
      @keyframes thwip {
        0% { transform: rotate(var(--r)) scale(.3); opacity: 0; }
        25% { transform: rotate(var(--r)) scale(1.25); opacity: 1; }
        70% { transform: rotate(var(--r)) scale(1) translateY(-4px); opacity: 1; }
        100% { transform: rotate(var(--r)) scale(.9) translateY(-10px); opacity: 0; }
      }
      @keyframes burst {
        from { transform: rotate(var(--a)) translateY(0) scale(.6); opacity: 1; }
        to { transform: rotate(var(--a)) translateY(calc(var(--d) * -1)) scale(1); opacity: 0; }
      }
      @keyframes descend { from { clip-path: inset(0 0 100% 0); transform: translateY(-30px); } to { clip-path: inset(0 0 0 0); transform: none; } }
      @keyframes dangle { from { transform: rotate(-4deg); } to { transform: rotate(4deg); } }
      @keyframes climb { to { transform: translateY(calc(var(--drop) * -1)); opacity: 0; } }
      @keyframes rescued {
        0% { transform: scale(1); opacity: 1; }
        40% { transform: scale(1.35) translateY(-10px); }
        100% { transform: scale(0) translateY(-40px); opacity: 0; }
      }

      .stage.reduced .sway, .stage.reduced .baby { animation: none !important; }
      .stage.reduced .bubble, .stage.reduced .focus-pill { transition: none; }
      @media print { .stage { display: none !important; } }
      @media (forced-colors: active) {
        .bubble { border-color: CanvasText; }
        .focus-pill, .water { border-color: CanvasText; }
      }
    `;
  }
})();

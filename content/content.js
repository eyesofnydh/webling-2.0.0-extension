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
  let activeBeam = null;
  let battle = null; // Hero Battle in progress: { fighters, banner, token }
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

    function noise({ dur = 0.3, gain = 0.05, from = 1200, to = 200, delay = 0, type = 'bandpass', attack = 0 }) {
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
      if (attack > 0) {
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
      } else {
        g.gain.setValueAtTime(gain, t0);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filt).connect(g).connect(master);
      src.start(t0);
      src.stop(t0 + dur);
    }

    const fx = {
      thwip: () => tone({ type: 'square', from: 1150, to: 280, dur: 0.12, gain: 0.04 }),
      land: () => { tone({ type: 'sine', from: 210, to: 70, dur: 0.14, gain: 0.07 }); noise({ dur: 0.09, gain: 0.03, from: 500, to: 120 }); },
      // A thruster swell: airy high-passed hiss rising in pitch over a soft, slow-attack rumble.
      jet: () => {
        noise({ dur: 0.75, gain: 0.04, from: 1400, to: 3600, type: 'highpass', attack: 0.12 });
        noise({ dur: 0.6, gain: 0.03, from: 160, to: 110, type: 'lowpass', attack: 0.09 });
      },
      step: () => tone({ type: 'triangle', from: 340, to: 170, dur: 0.05, gain: 0.03 }),
      climb: () => tone({ type: 'triangle', from: 520, to: 360, dur: 0.06, gain: 0.025 }),
      cheer: () => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.12, gain: 0.04, delay: i * 0.085 })),
      rescue: () => { tone({ type: 'sine', from: 784, dur: 0.1, gain: 0.05 }); tone({ type: 'sine', from: 1047, dur: 0.13, gain: 0.05, delay: 0.1 }); },
      water: () => tone({ type: 'sine', from: 920, to: 430, dur: 0.14, gain: 0.045 }),
      slip: () => tone({ type: 'sawtooth', from: 620, to: 130, dur: 0.3, gain: 0.04 }),
      charge: () => tone({ type: 'sine', from: 260, to: 1500, dur: 0.26, gain: 0.03 }),
      beam: () => { tone({ type: 'sawtooth', from: 1500, to: 480, dur: 0.3, gain: 0.05 }); noise({ dur: 0.3, gain: 0.04, from: 3200, to: 600, type: 'highpass' }); },
      pound: () => { tone({ type: 'sine', from: 150, to: 42, dur: 0.3, gain: 0.09 }); noise({ dur: 0.2, gain: 0.07, from: 320, to: 60, type: 'lowpass' }); },
      nova: () => { tone({ type: 'sine', from: 320, to: 1200, dur: 0.42, gain: 0.05 }); tone({ type: 'triangle', from: 900, to: 280, dur: 0.42, gain: 0.03, delay: 0.05 }); noise({ dur: 0.42, gain: 0.05, from: 2000, to: 300 }); },
      throw: () => { tone({ type: 'sawtooth', from: 220, to: 520, dur: 0.22, gain: 0.03 }); noise({ dur: 0.18, gain: 0.03, from: 900, to: 300 }); },
      warp: () => { tone({ type: 'sine', from: 1700, to: 220, dur: 0.18, gain: 0.04 }); tone({ type: 'square', from: 300, to: 1500, dur: 0.16, gain: 0.025, delay: 0.12 }); },
      hit: () => { noise({ dur: 0.08, gain: 0.06, from: 1400, to: 300 }); tone({ type: 'square', from: 240, to: 110, dur: 0.08, gain: 0.03 }); },
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
    buddy.classList.toggle('flyer', charKind() === 'flyer');
    buddy.classList.toggle('brute', charKind() === 'brute');
    // Jointed heroes are one persistent rig whose joints blend between poses;
    // the other themes swap between pre-drawn frames.
    frames.innerHTML = isArticulated()
      ? Sprite.frameSvg('idle', l.theme, { uid: 'pg-rig', acc: l.badge, className: 'frame frame-rig' })
      : Sprite.FRAMES
        .map((f) => Sprite.frameSvg(f, l.theme, { uid: `pg-${f}`, acc: l.badge, className: `frame frame-${f}` }))
        .join('');
  }

  function applyLook() {
    renderSprite();
    const l = look();
    stage.style.setProperty('--thread', l.webline || state.webLineColor);
    bubble.classList.toggle('bubble-pixel', l.bubble === 'pixel');
    bubble.classList.toggle('bubble-night', l.bubble === 'night');
    drawThread(); // clears the web line immediately when switching to a web-less character
  }

  function setPose(name) {
    buddy.dataset.pose = name;
  }

  /** True when the equipped theme is drawn from pixel-art sprites rather than the vector character. */
  function isPixel() {
    const p = Sprite.PALETTES[look().theme];
    return !!(p && p.sprites);
  }

  /** True for a jointed hero (Boltling / Nova / Rumble), whose limbs the CSS animates per pose. */
  function isArticulated() {
    const p = Sprite.PALETTES[look().theme];
    return !!(p && p.articulated);
  }

  /** 'flyer' (beam + jets), 'brute' (ground-pound), or '' for spidey/vector. */
  function charKind() {
    const p = Sprite.PALETTES[look().theme];
    return (p && p.kind) || '';
  }

  /** Each character's signature power: 'beam' | 'nova' | 'pound' | ''. */
  function charPower() {
    const p = Sprite.PALETTES[look().theme];
    return (p && p.power) || '';
  }

  /** Only Spider-Man / the vector character travel on a web line. Flyers & the brute never do. */
  function usesWeb() {
    return !isArticulated();
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
    if (!threadVisible || !active || !usesWeb()) {
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
    const floor = Math.max(0, vh() - charH() - 6);
    if (state.rememberPosition && state.lastPosition) {
      const x = state.lastPosition.x * vw();
      return { x, y: charKind() === 'brute' ? floor : state.lastPosition.y * vh() };
    }
    const m = 28;
    const left = state.startPosition === 'top-left' || state.startPosition === 'bottom-left';
    const x = left ? m : vw() - charW() - m;
    if (charKind() === 'brute') return { x, y: floor }; // the brute always stands on the floor
    const bottomStart = state.startPosition === 'bottom-left' || state.startPosition === 'bottom-right';
    return { x, y: bottomStart ? vh() - charH() - 90 : 72 };
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
    buddy.classList.remove('flying', 'climbing', 'climb-left', 'climb-right', 'walking', 'running', 'skimming', 'boosting', 'braking', 'aiming', 'flare', 'nova-charge');
    if (activeBeam) { activeBeam.remove(); activeBeam = null; }
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

  /** A leap (no web line): parabolic jump to a target, used by the brute. */
  async function leapTo(tx, ty) {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const target = clampPos(tx, Math.max(44, ty));
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    face(dx);
    threadVisible = false;
    setPose('anticipate');
    drawThread();
    await wait(reducedMotion() ? 0 : 140);
    if (id !== busy) return false;

    if (reducedMotion()) {
      place(target.x, target.y);
      setPose('idle');
      drawThread();
      return true;
    }

    setPose('flight');
    const peak = Math.min(100, 44 + Math.abs(dx) * 0.2);
    const dur = Math.max(420, Math.min(900, 300 + Math.hypot(dx, dy) * 0.7));
    try {
      anim = motion.animate([
        { transform: 'translate(0,0)' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - peak}px)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px)` },
      ], { duration: dur, easing: 'cubic-bezier(.3,.1,.5,1)', fill: 'forwards' });
      await anim.finished;
    } catch {
      return false;
    }
    if (id !== busy) return false;
    anim.cancel();
    anim = null;
    place(target.x, target.y);
    setPose('land');
    Sound.play('land');
    await wait(200);
    if (id !== busy) return false;
    setPose('idle');
    drawThread();
    return true;
  }

  /** The brute has no web or jets: when let go in mid-air he drops to the floor and lands heavily. */
  async function fallToFloor() {
    stopMotion();
    const id = busy;
    const floorY = Math.max(0, vh() - charH() - 6);
    const dy = floorY - pos.y;
    if (dy < 4) return;
    if (reducedMotion()) {
      place(pos.x, floorY);
      return;
    }
    setPose('flight');
    anim = motion.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(${dy}px)` }],
      { duration: Math.min(700, 180 + Math.sqrt(dy) * 22), easing: 'cubic-bezier(.55, 0, 1, .45)', fill: 'forwards' },
    );
    try { await anim.finished; } catch { return; }
    if (id !== busy) return;
    place(pos.x, floorY);
    anim.cancel();
    anim = null;
    send({ type: 'SAVE_POSITION', position: { x: pos.x / vw(), y: pos.y / vh() } });
    setPose('land');
    Sound.play('land');
    stage.classList.add('quake');
    later(() => stage.classList.remove('quake'), 300);
    await wait(260);
    if (id === busy) setPose('idle');
  }

  /** Move to (tx, ty) by the character's own means: web-swing / jet-glide / leap. */
  async function descendTo(tx, ty) {
    if (charKind() === 'brute') return leapTo(tx, ty);
    if (isArticulated()) return boostTo(tx, ty);
    const ax = tx + charW() / 2 + (tx - pos.x) * 0.2;
    return swingTo(ax, Math.max(0, ty - 170), tx, ty);
  }

  /** Travel toward a clicked point, by the character's own means (the brute can't fly — he lands on the floor below it). */
  function travelTo(px, py) {
    const ty = py - charH() * 0.5;
    if (charKind() === 'brute') return leapTo(px - charW() / 2, Math.max(0, vh() - charH() - 6));
    if (isArticulated()) return boostTo(px - charW() / 2, ty);
    return swingTo(px, Math.max(0, py - 220), px - charW() / 2, ty);
  }

  /** The "tap me" action: each character does its own thing instead of swinging. */
  function randomMove() {
    const power = charPower();
    if (power === 'beam') return roamBeam();
    if (power === 'nova') return roamNova();
    if (power === 'pound') return Math.random() < 0.5 ? roamPound() : roamThrow();
    return randomSwing();
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

    let dust = null;
    const finish = () => {
      if (dust) { dust.remove(); dust = null; }
      place(tx, floorY);
      buddy.classList.remove('walking');
      setPose('idle');
      threadVisible = true;
      anchorAbove();
      drawThread();
    };

    if (reducedMotion()) {
      finish();
      return true;
    }

    dust = document.createElement('span');
    dust.className = 'run-dust walk-dust';
    dust.innerHTML = '<i></i><i></i>';
    flip.appendChild(dust);

    try {
      anim = motion.animate(
        [{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)` }],
        { duration: Math.max(1000, Math.abs(dx) * 6), easing: 'linear', fill: 'forwards' },
      );
      await anim.finished;
    } catch {
      if (dust) { dust.remove(); dust = null; }
      return false;
    }
    if (id !== busy) { if (dust) { dust.remove(); dust = null; } return false; }
    anim.cancel();
    anim = null;
    finish();
    return true;
  }

  /** Swings down to a side, then crawls up it. */
  async function roamCrawl() {
    const side = pos.x + charW() / 2 < vw() / 2 ? 'left' : 'right';
    const x = side === 'left' ? 30 : Math.max(0, vw() - charW() - 30);
    const landY = Math.max(80, vh() - charH() - (40 + Math.random() * 70));
    const ok = await descendTo(x, landY);
    if (!ok) return false;
    await wait(170);
    return crawlUp(side);
  }

  /** Swings down to the floor, then walks along it. */
  async function roamWalk() {
    const floorY = Math.max(0, vh() - charH() - 6);
    const sx = 40 + Math.random() * Math.max(1, vw() - charW() - 80);
    const ok = await descendTo(sx, floorY);
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
    threadVisible = false;
    drawThread();
    if (reducedMotion()) {
      place(tx, floorY);
      setPose('idle');
      return true;
    }
    // Same launch → cruise → brake sequence as boostTo, kept low and fast along the floor.
    return thrust(id, dx, 0, { x: tx, y: floorY }, {
      arc: 12,
      duration: Math.max(480, Math.min(1000, 300 + Math.abs(dx) * 1.6)),
      maxPitch: 66,
      cls: 'skimming',
    });
  }

  /** Swings down to the floor, then runs along it. */
  async function roamRun() {
    const floorY = Math.max(0, vh() - charH() - 6);
    const sx = 40 + Math.random() * Math.max(1, vw() - charW() - 80);
    const ok = await descendTo(sx, floorY);
    if (!ok) return false;
    await wait(120);
    return runAlong();
  }

  /** Swings down to the floor, then jet-skims along it. */
  async function roamSkim() {
    const floorY = Math.max(0, vh() - charH() - 6);
    const sx = 40 + Math.random() * Math.max(1, vw() - charW() - 80);
    const ok = await descendTo(sx, floorY);
    if (!ok) return false;
    await wait(120);
    return jetSkim();
  }

  /**
   * Charges and fires an energy beam from the hand across the page.
   * `dir` is +1 (fire right) or -1 (fire left). Original repulsor-style FX.
   */
  async function fireBeam(dir, { shots = 1, thick = false } = {}) {
    const id = ++busy;
    bubble.classList.remove('show');
    // The fist of the braced aim pose (see .aiming in rigCss) sits at about (86, 50) of the 100×125 frame.
    const handY = pos.y + charH() * 0.4;
    const handX = dir > 0 ? pos.x + charW() * 0.86 : pos.x + charW() * 0.14;
    const len = dir > 0 ? Math.max(40, vw() - handX) : Math.max(40, handX);

    // 1. Square up: turn to the target and lock the arm out (the pose blends in).
    buddy.classList.toggle('facing-left', dir < 0);
    setPose('idle');
    buddy.classList.add('aiming');
    threadVisible = false;
    drawThread();

    const beam = document.createElement('span');
    beam.className = `beam${dir < 0 ? ' beam-left' : ''}${thick ? ' beam-big' : ''}`;
    beam.style.left = `${handX}px`;
    beam.style.top = `${handY}px`;
    beam.style.width = `${len}px`;
    beam.innerHTML = '<span class="beam-core"></span><span class="beam-muzzle"></span><span class="beam-hit"></span>';

    const done = (ok) => {
      if (anim) { try { anim.cancel(); } catch { /* ignore */ } anim = null; }
      if (activeBeam === beam) { beam.remove(); activeBeam = null; }
      buddy.classList.remove('aiming');
      if (id === busy) {
        setPose('idle');
        threadVisible = true;
        anchorAbove();
        drawThread();
      }
      return ok;
    };

    // Recoil: the body is shoved back on release and recovers — no wobble.
    const kick = () => {
      Sound.play('beam');
      try {
        anim = motion.animate(
          [{ transform: `translateX(${dir * -7}px)` }, { transform: 'translateX(0)' }],
          { duration: 260, easing: 'cubic-bezier(.2, .7, .3, 1)' },
        );
      } catch { /* ignore */ }
    };

    stage.appendChild(beam);
    activeBeam = beam;
    if (reducedMotion()) {
      beam.classList.add('charge', 'fire');
      kick();
      await wait(240);
      return done(id === busy);
    }

    await wait(200);
    if (id !== busy) return done(false);
    // 2. Charge at the fist, then a short beat before the release.
    Sound.play('charge');
    requestAnimationFrame(() => beam.classList.add('charge'));
    await wait(260);
    if (id !== busy) return done(false);
    await wait(70);
    if (id !== busy) return done(false);

    const n = Math.max(1, shots);
    for (let i = 0; i < n; i++) {
      beam.classList.add('fire');
      kick();
      await wait(n > 1 ? 180 : 620);
      if (id !== busy) return done(false);
      if (n > 1 && i < n - 1) {
        beam.classList.remove('fire'); // retract between rapid shots
        await wait(110);
        if (id !== busy) return done(false);
      }
    }
    beam.classList.add('out');
    await wait(300);
    return done(id === busy);
  }

  /** Thrusts to one side, then fires — either a big single blast or a rapid 3-shot. */
  async function roamBeam() {
    const fromLeft = pos.x + charW() / 2 < vw() / 2;
    const tx = fromLeft ? vw() * 0.18 : vw() * 0.82 - charW();
    const ty = 60 + Math.random() * Math.max(0, vh() * 0.35 - 60);
    const ok = await boostTo(tx, ty);
    if (!ok) return false;
    await wait(140);
    return fireBeam(fromLeft ? 1 : -1, Math.random() < 0.4 ? { shots: 3 } : { thick: true });
  }

  /** Grand entrance: thrusts in from the edge, then fires a beam. */
  async function makeEntrance() {
    const fromLeft = Math.random() < 0.5;
    const ty = 70 + Math.random() * 60;
    place(fromLeft ? 0 : Math.max(0, vw() - charW()), ty);
    const tx = fromLeft ? vw() * 0.22 : vw() * 0.78 - charW();
    const ok = await boostTo(tx, ty);
    if (!ok) return false;
    await wait(140);
    return fireBeam(fromLeft ? 1 : -1, { thick: true });
  }

  // ---------------------------------------------------------------------------
  // Nova: hovers, charges, then detonates an expanding radial shockwave
  // ---------------------------------------------------------------------------

  async function novaBurst() {
    stopMotion();
    const id = ++busy;
    bubble.classList.remove('show');
    threadVisible = false;
    drawThread();
    const cx = pos.x + charW() / 2;
    const cy = pos.y + charH() * 0.5;

    const finish = (ok) => {
      if (anim) { try { anim.cancel(); } catch { /* ignore */ } anim = null; }
      if (activeBeam) { activeBeam.remove(); activeBeam = null; }
      buddy.classList.remove('flare', 'nova-charge');
      if (id === busy) { setPose('idle'); threadVisible = true; anchorAbove(); drawThread(); }
      return ok;
    };

    // 1. Gather: crouch in while an energy arc spirals in and tightens around her.
    setPose('anticipate');
    buddy.classList.add('nova-charge');
    Sound.play('charge');
    chargeSpiral(cx, cy);
    await wait(reducedMotion() ? 0 : 480);
    if (id !== busy) return finish(false);
    await wait(reducedMotion() ? 0 : 60); // the beat before release
    if (id !== busy) return finish(false);

    // 2. Release: fling open as the shockwave rings out.
    const burst = document.createElement('span');
    burst.className = 'nova';
    burst.style.left = `${cx}px`;
    burst.style.top = `${cy}px`;
    burst.innerHTML = '<span class="nova-flash"></span><i class="nova-ring"></i><i class="nova-ring"></i><i class="nova-ring"></i><span class="nova-star"></span>';
    stage.appendChild(burst);
    activeBeam = burst;
    buddy.classList.remove('nova-charge');
    setPose('idle');
    buddy.classList.add('flare');
    Sound.play('nova');
    requestAnimationFrame(() => burst.classList.add('go'));
    if (!reducedMotion()) {
      anim = motion.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)', offset: 0.25 }, { transform: 'translateY(0)' }], { duration: 420, easing: 'cubic-bezier(.2, .7, .3, 1)' });
    }
    // 3. Hold the pose while the rings decay.
    await wait(720);
    return finish(id === busy);
  }

  /** Flies to a hover spot, then detonates a nova burst. */
  async function roamNova() {
    const tx = clampPos(vw() * 0.3 + Math.random() * vw() * 0.4, 70 + Math.random() * 60).x;
    const ty = 60 + Math.random() * Math.max(0, vh() * 0.35 - 60);
    const ok = await boostTo(tx, ty);
    if (!ok) return false;
    await wait(120);
    return novaBurst();
  }

  /** Nova entrance: thrusts in from the edge, then detonates. */
  async function novaEntrance() {
    const fromLeft = Math.random() < 0.5;
    const ty = 70 + Math.random() * 60;
    place(fromLeft ? 0 : Math.max(0, vw() - charW()), ty);
    const tx = fromLeft ? vw() * 0.3 : vw() * 0.7 - charW();
    const ok = await boostTo(tx, ty);
    if (!ok) return false;
    await wait(120);
    return novaBurst();
  }

  // ---------------------------------------------------------------------------
  // Brute: leap + ground-pound (rubble burst + screen shake)
  // ---------------------------------------------------------------------------

  /** Throws a ring of rubble out from (cx near feet) and shakes the stage. */
  function poundImpact(x, floorY) {
    stage.classList.add('quake');
    later(() => stage.classList.remove('quake'), 380);
    if (reducedMotion()) return;
    const cx = x + charW() / 2;
    const cy = floorY + charH() - 8;
    const chunks = 10;
    for (let i = 0; i < chunks; i++) {
      const r = document.createElement('span');
      r.className = 'rubble';
      const side = i < chunks / 2 ? -1 : 1;
      const dx = side * (14 + Math.random() * 74);
      const dy = -(26 + Math.random() * 54);
      const sz = 5 + Math.random() * 7;
      r.style.left = `${cx}px`;
      r.style.top = `${cy}px`;
      r.style.width = `${sz}px`;
      r.style.height = `${sz}px`;
      r.style.setProperty('--dx', `${dx.toFixed(0)}px`);
      r.style.setProperty('--dy', `${dy.toFixed(0)}px`);
      r.style.setProperty('--s', (0.5 + Math.random() * 0.9).toFixed(2));
      stage.appendChild(r);
      later(() => r.remove(), 780);
    }
  }

  /** Crouch, leap up, then slam down at `targetX` for a shockwave. */
  async function groundPound(targetX) {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const floorY = Math.max(0, vh() - charH() - 6);
    const x = targetX == null ? pos.x : clampPos(targetX, floorY).x;
    place(x, floorY);
    threadVisible = false;
    drawThread();
    setPose('anticipate');
    await wait(180);
    if (id !== busy) return false;

    if (reducedMotion()) {
      setPose('land');
      poundImpact(x, floorY);
      Sound.play('pound');
      await wait(220);
      if (id !== busy) return false;
      setPose('idle');
      threadVisible = true;
      anchorAbove();
      drawThread();
      return true;
    }

    const up = 80;
    setPose('flight');
    try {
      anim = motion.animate(
        [{ transform: 'translateY(0)' }, { transform: `translateY(${-up}px)` }],
        { duration: 300, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
      );
      await anim.finished;
    } catch {
      return false;
    }
    if (id !== busy) return false;
    await wait(80);
    if (id !== busy) return false;
    setPose('anticipate'); // tuck
    try {
      anim = motion.animate(
        [{ transform: `translateY(${-up}px)` }, { transform: 'translateY(0)' }],
        { duration: 150, easing: 'cubic-bezier(.7,0,.9,.35)', fill: 'forwards' },
      );
      await anim.finished;
    } catch {
      return false;
    }
    if (id !== busy) return false;
    anim.cancel();
    anim = null;
    setPose('land');
    poundImpact(x, floorY);
    Sound.play('pound');
    await wait(400);
    if (id !== busy) return false;
    setPose('idle');
    threadVisible = true;
    anchorAbove();
    drawThread();
    return true;
  }

  /** Stomps along the floor, then ground-pounds where he lands. */
  async function roamPound() {
    const ok = await runAlong();
    if (!ok) return false;
    await wait(120);
    return groundPound(pos.x);
  }

  /** Brute entrance: lands with a ground-pound. */
  async function poundEntrance() {
    const x = vw() * 0.3 + Math.random() * vw() * 0.4;
    return groundPound(x);
  }

  /** Hurls a boulder in an arc; it bursts into rubble where it lands. */
  async function throwRock() {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const floorY = Math.max(0, vh() - charH() - 6);
    place(pos.x, floorY);
    const dir = pos.x + charW() / 2 < vw() / 2 ? 1 : -1;
    face(dir * 10);
    threadVisible = false;
    drawThread();
    setPose('anticipate');
    await wait(reducedMotion() ? 0 : 260); // wind up
    if (id !== busy) return false;

    const fromX = pos.x + charW() * (dir > 0 ? 0.8 : 0.2);
    const fromY = pos.y + charH() * 0.3;
    const landX = Math.max(30, Math.min(vw() - 30, fromX + dir * (vw() * 0.3 + Math.random() * vw() * 0.2)));
    const landY = floorY + charH() - 10;
    setPose('celebrate'); // arm-up throw frame
    Sound.play('throw');

    if (!reducedMotion()) {
      const rock = document.createElement('span');
      rock.className = 'boulder';
      rock.style.left = `${fromX}px`;
      rock.style.top = `${fromY}px`;
      stage.appendChild(rock);
      const dx = landX - fromX;
      const dy = landY - fromY;
      try {
        rock.animate([
          { transform: 'translate(0,0) rotate(0deg)' },
          { transform: `translate(${dx * 0.5}px, ${dy - 90}px) rotate(${dir * 180}deg)`, offset: 0.5 },
          { transform: `translate(${dx}px, ${dy}px) rotate(${dir * 360}deg)` },
        ], { duration: 520, easing: 'cubic-bezier(.3,0,.7,1)', fill: 'forwards' });
      } catch { /* ignore */ }
      await wait(520);
      rock.remove();
    }
    if (id !== busy) return false;
    // impact where it lands
    poundImpact(landX - charW() / 2, floorY);
    Sound.play('pound');
    setPose('idle');
    threadVisible = true;
    anchorAbove();
    drawThread();
    return true;
  }

  /** Walks to the floor, then hurls a boulder across. */
  async function roamThrow() {
    const floorY = Math.max(0, vh() - charH() - 6);
    const sx = 40 + Math.random() * Math.max(1, vw() - charW() - 80);
    const ok = await descendTo(sx, floorY);
    if (!ok) return false;
    await wait(120);
    return throwRock();
  }

  /**
   * Heat streaks from the boot nozzles while a flyer is under thrust. Each streak is
   * emitted at a nozzle's real on-screen position and shoots out opposite the
   * direction of travel, so the trail traces the actual flight path. Returns a stop fn.
   */
  function jetTrail(root) {
    if (reducedMotion()) return () => {};
    let t = 0;
    let last = null;
    const tick = () => {
      const pts = [...root.querySelectorAll('.jet-nz')]
        .map((n) => n.getBoundingClientRect())
        .filter((r) => r.width || r.height)
        .map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
      if (pts.length) {
        const c = { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };
        if (last && Math.hypot(c.x - last.x, c.y - last.y) > 1.5) {
          const a = Math.atan2(last.y - c.y, last.x - c.x);
          for (const p of pts) {
            const s = document.createElement('span');
            s.className = 'spark';
            s.style.left = `${p.x}px`;
            s.style.top = `${p.y}px`;
            s.style.setProperty('--a', `${a}rad`);
            stage.appendChild(s);
            later(() => s.remove(), 320);
          }
        }
        last = c;
      }
      t = later(tick, 40);
    };
    t = later(tick, 0);
    return () => cancel(t);
  }

  /**
   * Flight along a shallow arc from rest to (dx, dy). The body turns to point along
   * the path — easing into the lean after launch and back upright while braking —
   * with a hint of stretch at top speed. Returns the Animation (fill: forwards).
   */
  function flyPath(layer, dx, dy, { arc = 0, duration = 700, maxPitch = 75 } = {}) {
    const N = 14;
    const kf = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const ty = dy - arc * 4 * (1 - 2 * t); // vertical component of the path tangent
      // Lean toward the horizontal direction of travel; rising or falling straight keeps the body upright.
      const ang = Math.max(-maxPitch, Math.min(maxPitch, (Math.atan2(dx, Math.abs(ty)) * 180) / Math.PI));
      const w = Math.min(1, t / 0.22, (1 - t) / 0.28);
      const lean = ang * w * w * (3 - 2 * w);
      const st = 1 + 0.035 * Math.sin(Math.PI * t);
      kf.push({
        offset: t,
        transform: `translate(${(dx * t).toFixed(1)}px, ${(dy * t - arc * 4 * t * (1 - t)).toFixed(1)}px) rotate(${lean.toFixed(1)}deg) scale(${(2 - st).toFixed(3)}, ${st.toFixed(3)})`,
      });
    }
    return layer.animate(kf, { duration, easing: 'cubic-bezier(.55, 0, .25, 1)', fill: 'forwards' });
  }

  /** Shared jet sequence for boostTo / jetSkim: crouch & spool up → launch → cruise → brake → settle. */
  async function thrust(id, dx, dy, target, { arc, duration, maxPitch, cls }) {
    // 1. Anticipation: sink into a crouch while the jets spool up.
    setPose('anticipate');
    const crouch = motion.animate(
      [{ transform: 'translate(0, 0) scale(1, 1)' }, { transform: 'translate(0, 4px) scale(1.03, .96)' }],
      { duration: 210, easing: 'cubic-bezier(.3, .7, .4, 1)', fill: 'forwards' },
    );
    anim = crouch;
    try { await crouch.finished; } catch { return false; }
    if (id !== busy) return false;

    // 2. Launch and cruise: full thrust, the body leans to lead along the path.
    setPose('flight');
    buddy.classList.add(cls);
    Sound.play('jet');
    const stopTrail = jetTrail(buddy);
    const flight = flyPath(motion, dx, dy, { arc, duration, maxPitch });
    crouch.cancel();
    anim = flight;
    // 3. Brake over the last fifth: throttle back, swing the legs under.
    const brake = later(() => {
      if (id !== busy) return;
      buddy.classList.remove(cls);
      buddy.classList.add('braking');
      setPose('land');
    }, duration * 0.8);
    const done = () => {
      cancel(brake);
      stopTrail();
      buddy.classList.remove(cls, 'braking');
    };
    try { await flight.finished; } catch { done(); return false; }
    done();
    if (id !== busy) return false;
    place(target.x, target.y);
    flight.cancel();

    // 4. Settle: one soft dip as the weight arrives, then hover.
    landingEffect();
    anim = motion.animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(3px)', offset: 0.4 }, { transform: 'translateY(0)' }],
      { duration: 300, easing: 'ease-out' },
    );
    try { await anim.finished; } catch { return false; }
    anim = null;
    if (id !== busy) return false;
    setPose('idle');
    threadVisible = true;
    anchorAbove();
    drawThread();
    return true;
  }

  /** A dash streak that crosses from (x1, y1) to (x2, y2) and collapses into the arrival point. */
  function dashStreak(x1, y1, x2, y2, tone) {
    if (reducedMotion()) return;
    const el = document.createElement('span');
    el.className = `dash tone-${tone || 'beam'}`;
    el.style.left = `${x1}px`;
    el.style.top = `${y1}px`;
    el.style.width = `${Math.hypot(x2 - x1, y2 - y1)}px`;
    el.style.transform = `rotate(${Math.atan2(y2 - y1, x2 - x1)}rad)`;
    stage.appendChild(el);
    later(() => el.remove(), 560);
  }

  /** Nova's wind-up: an energy arc that spirals in and tightens around (x, y). */
  function chargeSpiral(x, y) {
    if (reducedMotion()) return;
    const el = document.createElement('span');
    el.className = 'charge-spiral';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    stage.appendChild(el);
    later(() => el.remove(), 560);
  }

  /** Dash-teleport: plant, vanish into a streak that crosses the gap, reappear braced, settle. */
  async function teleportTo(tx, ty) {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const target = clampPos(tx, Math.max(40, ty));
    threadVisible = false;
    drawThread();
    if (reducedMotion()) {
      place(target.x, target.y);
      setPose('idle');
      return true;
    }
    face(target.x - pos.x);
    setPose('anticipate');
    await wait(150);
    if (id !== busy) return false;

    Sound.play('warp');
    dashStreak(pos.x + charW() / 2, pos.y + charH() * 0.55, target.x + charW() / 2, target.y + charH() * 0.55, charPower());
    const out = motion.animate([{ opacity: 1, transform: 'scale(1, 1)' }, { opacity: 0, transform: 'scale(1.3, .7)' }], { duration: 70, easing: 'ease-in', fill: 'forwards' });
    anim = out;
    try { await out.finished; } catch { return false; }
    if (id !== busy) return false;
    await wait(80); // the streak crosses the gap
    if (id !== busy) return false;

    place(target.x, target.y);
    setPose('land');
    const inn = motion.animate([{ opacity: 0, transform: 'scale(1.3, .7)' }, { opacity: 1, transform: 'scale(1, 1)' }], { duration: 170, easing: 'cubic-bezier(.2, .8, .3, 1)' });
    out.cancel(); // the arrival animation takes over; nothing stays filled at opacity 0
    anim = inn;
    try { await inn.finished; } catch { return false; }
    anim = null;
    if (id !== busy) return false;
    await wait(160);
    if (id !== busy) return false;
    setPose('idle');
    threadVisible = true;
    anchorAbove();
    drawThread();
    return true;
  }

  /** Teleports to a random spot (the brute keeps his feet on the floor). */
  function roamTeleport() {
    const margin = 40;
    const tx = margin + Math.random() * Math.max(1, vw() - charW() - margin * 2);
    const ty = charKind() === 'brute'
      ? Math.max(0, vh() - charH() - 6)
      : 60 + Math.random() * Math.max(0, vh() * 0.5 - 60);
    return teleportTo(tx, ty);
  }

  /** Thruster flight to (tx, ty) — the flyers' way of getting around. No web line. */
  async function boostTo(tx, ty) {
    stopMotion();
    const id = busy;
    bubble.classList.remove('show');
    const target = clampPos(tx, Math.max(40, ty));
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    face(dx);
    threadVisible = false;
    drawThread();
    if (reducedMotion()) {
      place(target.x, target.y);
      setPose('idle');
      return true;
    }
    const dist = Math.hypot(dx, dy) || 1;
    return thrust(id, dx, dy, target, {
      arc: Math.min(60, 14 + dist * 0.09),
      duration: Math.max(620, Math.min(1150, 420 + dist * 0.65)),
      maxPitch: 75,
      cls: 'boosting',
    });
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
        // One clean hop: dip, spring up, land soft.
        anim = motion.animate(
          [
            { transform: 'translateY(0)' },
            { transform: 'translateY(3px)', offset: 0.14 },
            { transform: 'translateY(-15px)', offset: 0.46 },
            { transform: 'translateY(0)', offset: 0.82 },
            { transform: 'translateY(0)' },
          ],
          { duration: 900, easing: 'cubic-bezier(.3, .6, .4, 1)' },
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
    const blocked = !active || document.hidden || anim || dragState || battle || reducedMotion() || state.focusStatus === 'running';
    if (blocked) return scheduleWander();
    const kind = charKind();
    const power = charPower();
    let ok;
    if (kind === 'brute') {
      // Rock brute: stomps, ground-pounds and hurls boulders — no web, no jets.
      const s = Math.random();
      if (s < 0.28) ok = await roamPound();
      else if (s < 0.5) ok = await roamThrow();
      else if (s < 0.62) ok = await roamTeleport();
      else if (s < 0.84) ok = await roamRun();
      else ok = await roamWalk();
    } else if (kind === 'flyer') {
      // Flyers: jets, teleports, wall-climbs and each one's signature power — no web.
      const s = Math.random();
      if (s < 0.18) ok = power === 'nova' ? await roamNova() : await roamBeam();
      else if (s < 0.3) ok = await roamTeleport();
      else if (s < 0.4) ok = await roamCrawl();
      else if (s < 0.52) ok = await roamRun();
      else if (s < 0.68) ok = await roamSkim();
      else if (s < 0.8) ok = await roamWalk();
      else ok = await roamBoost();
    } else {
      // Spider-Man / vector: webs and acrobatics only — no jets, no beam.
      const s = Math.random();
      if (s < 0.22) ok = await roamCrawl();
      else if (s < 0.44) ok = await roamRun();
      else if (s < 0.6) ok = await roamWalk();
      else {
        const margin = 24;
        const tx = margin + Math.random() * Math.max(0, vw() - charW() - margin * 2);
        const ty = 70 + Math.random() * Math.max(0, vh() * 0.55 - 70);
        // Anchor somewhere above the target, leaning towards the direction of travel.
        const lean = (tx - pos.x) * 0.25;
        const ax = tx + charW() / 2 + lean;
        ok = await swingTo(ax, Math.random() * 20, tx, ty);
      }
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
    const blocked = !active || document.hidden || anim || dragState || battle || reducedMotion() || state.focusStatus === 'running';
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
      endBattle();
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
      const prevTheme = Progression.resolveEquipped(prev.equippedCosmetics, prev.cosmeticsUnlocked).theme;
      if (prevTheme !== look().theme && charKind() === 'brute' && !battle) fallToFloor();
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
      if (charKind() === 'brute') fallToFloor();
      send({ type: 'SAVE_POSITION', position: { x: pos.x / vw(), y: pos.y / vh() } });
    } else {
      randomMove().then((ok) => ok && speak('interact'));
    }
  };
  listen(buddy, 'pointerup', (e) => endDrag(e, false));
  listen(buddy, 'pointercancel', (e) => endDrag(e, true));
  listen(buddy, 'lostpointercapture', (e) => endDrag(e, true));

  listen(buddy, 'keydown', (e) => {
    const step = e.shiftKey ? 40 : 12;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      randomMove().then((ok) => ok && speak('interact'));
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
    if (!active || battle || !state.swingToClicks || e.defaultPrevented || e.button !== 0) return;
    const path = e.composedPath();
    if (path.includes(host)) return;
    if (path.some((el) => el instanceof Element && el.matches(INTERACTIVE))) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length > 0) return;
    travelTo(e.clientX, e.clientY)
      .then((ok) => ok && Math.random() < 0.35 && speak('interact'));
  }, { passive: true, capture: false });

  // Web-zip: double-click empty page space (not text, links or controls).
  listen(document, 'dblclick', (e) => {
    if (!active || battle || !state.webZip || e.defaultPrevented || e.button !== 0) return;
    const path = e.composedPath();
    if (path.includes(host)) return;
    if (path.some((el) => el instanceof Element && el.matches(INTERACTIVE))) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).trim().length > 0) return; // they were selecting a word
    (usesWeb() ? zipTo(e.clientX, e.clientY) : travelTo(e.clientX, e.clientY))
      .then((ok) => ok && Math.random() < 0.3 && speak('interact'));
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

  // Esc ends a Hero Battle early.
  listen(document, 'keydown', (e) => {
    if (battle && e.key === 'Escape') endBattle();
  });

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
  // Hero Battle: every hero on the page at once, fighting it out
  // ---------------------------------------------------------------------------

  const ROSTER = [
    { theme: 'spidey', name: 'Spider-Man', attack: 'web' },
    { theme: 'bolt', name: 'Boltling', attack: 'beam' },
    { theme: 'nova', name: 'Nova', attack: 'nova' },
    { theme: 'smash', name: 'Rumble', attack: 'pound' },
  ];

  const floorTop = () => Math.max(0, vh() - charH() - 6);
  const fc = (f) => ({ x: f.x + charW() / 2, y: f.y + charH() * 0.42 }); // fighters are drawn 1.3× from the feet up

  function makeFighter(def, x, y) {
    const p = Sprite.PALETTES[def.theme];
    if (!p || (p.sprites && !globalThis.WeblingPixels)) return null;
    const el = document.createElement('div');
    el.className = ['buddy', 'fighter', p.sprites ? 'pixel' : '', p.articulated ? 'bolt' : '', p.kind || ''].filter(Boolean).join(' ');
    const frames = p.articulated
      ? Sprite.frameSvg('idle', def.theme, { uid: `bt-${def.theme}`, className: 'frame frame-rig' })
      : Sprite.FRAMES
        .map((fr) => Sprite.frameSvg(fr, def.theme, { uid: `bt-${def.theme}-${fr}`, className: `frame frame-${fr}` }))
        .join('');
    el.innerHTML = `<div class="motion"><div class="hp"><span class="hp-name">${def.name}</span><span class="hp-bar"><i></i></span></div>`
      + `<div class="sway"><div class="flip"><div class="frames">${frames}</div></div></div></div>`;
    stage.appendChild(el);
    // Spider-Man's resting sprite is a hanging pose, so on the floor he rests in his crouch.
    const f = { ...def, el, motion: el.querySelector('.motion'), kind: p.kind || '', rest: p.sprites ? 'anticipate' : 'idle', hp: 100, alive: true, x: 0, y: 0 };
    fPlace(f, x, y);
    fPose(f, 'idle');
    return f;
  }

  /** Like clampPos, but fighters are drawn 1.3× from the feet up, so keep that overflow on screen too. */
  function fClamp(x, y) {
    const c = clampPos(x, y);
    const pad = charW() * 0.16;
    c.x = Math.max(pad, Math.min(vw() - charW() - pad, c.x));
    c.y = Math.max(charH() * 0.32, c.y);
    return c;
  }

  function fPlace(f, x, y) {
    const c = fClamp(x, y);
    f.x = c.x;
    f.y = c.y;
    f.el.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
  }

  function fPose(f, name) {
    f.el.dataset.pose = name === 'idle' ? f.rest : name;
  }

  function fFace(f, x) {
    if (Math.abs(x - fc(f).x) > 4) f.el.classList.toggle('facing-left', x < fc(f).x);
  }

  /** Moves a fighter along an arc (a leap for walkers, a jet glide for flyers). */
  /**
   * Moves a fighter by their own means: flyers launch on their jets and lean along
   * the path (same flyPath as the companion), everyone else leaps in an arc.
   * Knockbacks pass turn: false so a hit fighter keeps facing their attacker.
   */
  async function fMove(f, x, y, { dur = 500, arc = 0, pose = 'flight', turn = true } = {}) {
    const c = spaced(f, x, y);
    if (turn) fFace(f, c.x + charW() / 2);
    const dx = c.x - f.x;
    const dy = c.y - f.y;
    if (reducedMotion()) {
      fPose(f, pose);
      fPlace(f, c.x, c.y);
      return;
    }
    const jets = f.kind === 'flyer' && pose === 'flight';
    if (jets) {
      fPose(f, 'anticipate');
      await wait(140);
      f.el.classList.add('boosting');
    }
    fPose(f, pose);
    const stopTrail = jets ? jetTrail(f.el) : () => {};
    const a = jets
      ? flyPath(f.motion, dx, dy, { arc: Math.max(arc, 14), duration: dur, maxPitch: 70 })
      : f.motion.animate([
        { transform: 'translate(0, 0)' },
        { transform: `translate(${dx / 2}px, ${dy / 2 - arc}px)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px)` },
      ], { duration: dur, easing: 'cubic-bezier(.4, .1, .3, 1)', fill: 'forwards' });
    try { await a.finished; } catch { /* ended */ }
    stopTrail();
    fPlace(f, c.x, c.y);
    a.cancel();
    f.el.classList.remove('boosting');
  }

  /** Nudges a destination sideways so a fighter never ends up stacked on top of another. */
  function spaced(f, x, y) {
    const gap = charW() * 0.9;
    let nx = x;
    for (let pass = 0; pass < 3; pass++) {
      for (const o of battle ? battle.fighters : []) {
        if (o === f || !o.alive) continue;
        if (Math.abs(nx - o.x) < gap && Math.abs(y - o.y) < charH() * 0.7) nx = o.x + (nx >= o.x ? 1 : -1) * gap;
      }
    }
    return fClamp(nx, y);
  }

  /** Battle dash-teleport, same streak as the companion's. */
  async function fTeleport(f, x, y) {
    const c = spaced(f, x, y);
    fPose(f, 'anticipate');
    await wait(reducedMotion() ? 0 : 120);
    Sound.play('warp');
    const from = fc(f);
    let out = null;
    if (!reducedMotion()) {
      out = f.motion.animate([{ opacity: 1, transform: 'scale(1, 1)' }, { opacity: 0, transform: 'scale(1.3, .7)' }], { duration: 70, easing: 'ease-in', fill: 'forwards' });
      dashStreak(from.x, from.y, c.x + charW() / 2, c.y + charH() * 0.42, f.attack);
      try { await out.finished; } catch { /* ended */ }
      await wait(80);
    }
    fPlace(f, c.x, c.y);
    fPose(f, 'land');
    if (out) {
      const inn = f.motion.animate([{ opacity: 0, transform: 'scale(1.3, .7)' }, { opacity: 1, transform: 'scale(1, 1)' }], { duration: 170, easing: 'cubic-bezier(.2, .8, .3, 1)' });
      out.cancel();
      try { await inn.finished; } catch { /* ended */ }
    }
    fPose(f, 'idle');
  }

  /** Comic text that pops and floats away ("ZAP!", "-18", "K.O.!"). */
  function popText(x, y, text, cls = 'pow') {
    if (!battle) return; // an attack resuming after Esc / ✕ leaves nothing behind
    const el = document.createElement('span');
    el.className = `bt-pop ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    stage.appendChild(el);
    later(() => el.remove(), 1700);
  }

  /** A web line or energy beam drawn from attacker's hand to the target. */
  function shotFx(a, b, cls, ms) {
    if (!battle) return Promise.resolve();
    const toRight = fc(b).x >= fc(a).x;
    const from = { x: fc(a).x + (toRight ? 1 : -1) * charW() * 0.45, y: fc(a).y };
    const to = fc(b);
    const el = document.createElement('span');
    el.className = `bt-shot ${cls}`;
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    el.style.width = `${Math.hypot(to.x - from.x, to.y - from.y)}px`;
    el.style.transform = `rotate(${Math.atan2(to.y - from.y, to.x - from.x)}rad)`;
    stage.appendChild(el);
    later(() => el.remove(), ms + 300);
    return wait(reducedMotion() ? 60 : ms);
  }

  function novaFx(x, y) {
    if (!battle) return;
    const el = document.createElement('span');
    el.className = 'nova';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.innerHTML = '<span class="nova-flash"></span><i class="nova-ring"></i><i class="nova-ring"></i><i class="nova-ring"></i><span class="nova-star"></span>';
    stage.appendChild(el);
    requestAnimationFrame(() => el.classList.add('go'));
    later(() => el.remove(), 900);
  }

  async function boulderFx(from, to) {
    if (reducedMotion() || !battle) return;
    const rock = document.createElement('span');
    rock.className = 'boulder';
    rock.style.left = `${from.x}px`;
    rock.style.top = `${from.y}px`;
    stage.appendChild(rock);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const spin = dx >= 0 ? 1 : -1;
    try {
      await rock.animate([
        { transform: 'translate(0, 0) rotate(0deg)' },
        { transform: `translate(${dx / 2}px, ${Math.min(dy, 0) / 2 - 110}px) rotate(${spin * 180}deg)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin * 360}deg)` },
      ], { duration: 560, easing: 'cubic-bezier(.3,0,.7,1)', fill: 'forwards' }).finished;
    } catch { /* ended */ }
    rock.remove();
  }

  async function fHit(f, dmg, fromX) {
    if (!f.alive || !battle) return;
    f.hp = Math.max(0, f.hp - dmg);
    f.el.querySelector('.hp-bar i').style.width = `${f.hp}%`;
    f.el.classList.toggle('hp-low', f.hp <= 30);
    Sound.play('hit');
    popText(fc(f).x, f.y + 4, `-${dmg}`, 'dmg');
    f.el.classList.add('hit');
    later(() => f.el.classList.remove('hit'), 280);
    const dir = fc(f).x >= fromX ? 1 : -1;
    await fMove(f, f.x + dir * 46, f.y, { dur: 260, arc: 18, pose: 'slip', turn: false });
    if (f.hp <= 0) {
      f.alive = false;
      popText(fc(f).x, f.y - 6, 'K.O.!', 'ko');
      Sound.play('slip');
      if (!reducedMotion()) {
        try {
          await f.motion.animate(
            [{ transform: 'translate(0, 0) rotate(0deg)', opacity: 1 }, { transform: 'translate(0, 40px) rotate(90deg)', opacity: 0 }],
            { duration: 700, easing: 'ease-in', fill: 'forwards' },
          ).finished;
        } catch { /* ended */ }
      }
      f.el.style.visibility = 'hidden';
      return;
    }
    fPose(f, 'idle');
  }

  /** One attacker's turn: get in range by their own means, then use their power. */
  async function fAttack(a, b) {
    const floorY = floorTop();
    const side = fc(b).x > fc(a).x ? -1 : 1; // approach from the attacker's side
    // Everyone still standing except the attacker — empty once the battle is ended mid-attack (Esc / ✕).
    const rivals = () => (battle ? battle.fighters.filter((f) => f.alive && f !== a) : []);
    switch (a.attack) {
      case 'web': {
        await fMove(a, b.x + side * 220, Math.random() < 0.5 ? floorY : floorY - 90, { dur: 480, arc: 80 });
        fFace(a, fc(b).x);
        fPose(a, 'anticipate');
        await wait(120);
        Sound.play('thwip');
        popText(fc(a).x, a.y, 'THWIP!');
        await shotFx(a, b, 'web-shot', 200);
        b.el.classList.add('webbed');
        later(() => b.el.classList.remove('webbed'), 1000);
        await fHit(b, 14, fc(a).x);
        break;
      }
      case 'beam': {
        if (Math.random() < 0.35) await fTeleport(a, b.x + side * 200, b.y - 10);
        else await fMove(a, b.x + side * 240, Math.min(b.y, floorY - 40), { dur: 520, arc: 30 });
        // Square up and lock the arm out, charge, beat, release.
        fFace(a, fc(b).x);
        fPose(a, 'idle');
        a.el.classList.add('aiming');
        await wait(200);
        Sound.play('charge');
        await wait(240);
        await wait(70);
        Sound.play('beam');
        popText(fc(b).x, b.y, 'ZAP!');
        if (!reducedMotion()) {
          const dir = fc(b).x >= fc(a).x ? 1 : -1;
          a.motion.animate([{ transform: `translateX(${dir * -7}px)` }, { transform: 'translateX(0)' }], { duration: 260, easing: 'cubic-bezier(.2, .7, .3, 1)' });
        }
        await shotFx(a, b, 'bt-beam', 320);
        a.el.classList.remove('aiming');
        await fHit(b, 18, fc(a).x);
        break;
      }
      case 'nova': {
        if (Math.random() < 0.4) await fTeleport(a, b.x + side * 120, b.y - 20);
        else await fMove(a, b.x + side * 140, Math.min(b.y - 20, floorY - 40), { dur: 520, arc: 40 });
        // Gather while the arc spirals in, beat, then fling open as the shockwave releases.
        fPose(a, 'anticipate');
        a.el.classList.add('nova-charge');
        Sound.play('charge');
        chargeSpiral(fc(a).x, fc(a).y);
        await wait(480);
        await wait(60);
        a.el.classList.remove('nova-charge');
        fPose(a, 'idle');
        a.el.classList.add('flare');
        novaFx(fc(a).x, fc(a).y);
        Sound.play('nova');
        popText(fc(a).x, a.y - 10, 'NOVA!');
        later(() => a.el.classList.remove('flare'), 700);
        await wait(200);
        // The shockwave hits everyone nearby, not just the target.
        const caught = rivals().filter((f) => Math.hypot(fc(f).x - fc(a).x, fc(f).y - fc(a).y) < 260);
        await Promise.all(caught.map((f) => fHit(f, 16, fc(a).x)));
        break;
      }
      case 'pound': {
        if (Math.random() < 0.5) {
          // Leap in and slam — anyone close on the ground gets hit; high flyers dodge it.
          await fMove(a, b.x + side * 60, floorY, { dur: 560, arc: 130 });
          fPose(a, 'land');
          poundImpact(a.x, floorY);
          Sound.play('pound');
          popText(fc(a).x, a.y - 6, 'SMASH!');
          const caught = rivals().filter((f) => Math.abs(fc(f).x - fc(a).x) < 170 && f.y > floorY - 130);
          if (!caught.length) popText(fc(b).x, b.y, 'MISS', 'dmg');
          await Promise.all(caught.map((f) => fHit(f, 22, fc(a).x)));
        } else {
          fFace(a, fc(b).x);
          fPose(a, 'anticipate');
          await wait(240);
          fPose(a, 'celebrate');
          Sound.play('throw');
          await boulderFx({ x: fc(a).x, y: a.y + charH() * 0.3 }, fc(b));
          poundImpact(b.x, b.y);
          Sound.play('pound');
          popText(fc(b).x, b.y, 'BAM!');
          await fHit(b, 18, fc(a).x);
        }
        break;
      }
      default:
        break;
    }
    if (a.alive) fPose(a, 'idle');
  }

  async function startBattle() {
    if (battle || !active) return;
    stopMotion();
    cancel(wanderTimer);
    cancel(mishapTimer);
    bubble.classList.remove('show');
    buddy.classList.add('benched');
    stage.classList.add('battling');
    drawThread();

    const token = {};
    const banner = document.createElement('div');
    banner.className = 'bt-banner';
    banner.innerHTML = '<span>⚔ HERO BATTLE</span><button type="button" class="bt-stop" aria-label="Stop the battle">✕</button>';
    stage.appendChild(banner);
    banner.querySelector('.bt-stop').addEventListener('click', () => endBattle());
    battle = { fighters: [], banner, token };
    const live = () => battle && battle.token === token;

    // Line everyone up — flyers hover, the rest stand on the floor.
    const floorY = floorTop();
    const n = ROSTER.length;
    const span = Math.max(0, vw() - charW() - 80);
    ROSTER.forEach((d, i) => {
      const p = Sprite.PALETTES[d.theme];
      const x = 40 + (n === 1 ? span / 2 : (span * i) / (n - 1));
      const y = p && p.kind === 'flyer' ? floorY - 90 - Math.random() * 70 : floorY;
      const f = makeFighter(d, x, y);
      if (f) battle.fighters.push(f);
    });

    // Entrance: each hero drops in, staggered.
    await Promise.all(battle.fighters.map(async (f, i) => {
      if (reducedMotion()) return;
      f.el.style.visibility = 'hidden';
      await wait(i * 200);
      if (!live()) return;
      f.el.style.visibility = '';
      f.el.classList.toggle('facing-left', fc(f).x > vw() / 2);
      fPose(f, 'flight');
      try {
        await f.motion.animate([{ transform: `translateY(${-(f.y + charH() + 40)}px)` }, { transform: 'translateY(0)' }], { duration: 520, easing: 'cubic-bezier(.5,0,.8,.5)' }).finished;
      } catch { /* ended */ }
      fPose(f, 'land');
      Sound.play(f.kind === 'brute' ? 'pound' : 'land');
      if (f.kind === 'brute') poundImpact(f.x, f.y);
      await wait(260);
      fPose(f, 'idle');
    }));
    if (!live()) return;
    popText(vw() / 2, vh() * 0.38, 'FIGHT!', 'ko big');
    Sound.play('cheer');
    await wait(700);

    // Rounds: a random hero attacks a random rival until one is left standing.
    for (let round = 0; round < 24 && live(); round++) {
      const alive = battle.fighters.filter((f) => f.alive);
      if (alive.length < 2) break;
      const a = alive[Math.floor(Math.random() * alive.length)];
      const rivals = alive.filter((f) => f !== a);
      await fAttack(a, rivals[Math.floor(Math.random() * rivals.length)]);
      if (!live()) return;
      await wait(reducedMotion() ? 200 : 380);
    }
    if (!live()) return;

    const winner = battle.fighters.filter((f) => f.alive).sort((p, q) => q.hp - p.hp)[0];
    if (winner) {
      fPose(winner, 'celebrate');
      popText(fc(winner).x, winner.y - 24, `${winner.name} WINS!`, 'ko big');
      Sound.play('cheer');
    }
    await wait(2800);
    if (live()) endBattle();
  }

  function endBattle() {
    if (!battle) return;
    const b = battle;
    battle = null;
    b.fighters.forEach((f) => f.el.remove());
    b.banner.remove();
    stage.querySelectorAll('.bt-shot, .bt-pop, .dash, .charge-spiral, .nova, .boulder, .rubble, .spark').forEach((el) => el.remove());
    stage.classList.remove('quake', 'battling');
    buddy.classList.remove('benched');
    setPose('idle');
    threadVisible = true;
    anchorAbove();
    drawThread();
    scheduleWander();
    scheduleMishap();
  }

  // ---------------------------------------------------------------------------
  // Summon & events
  // ---------------------------------------------------------------------------

  async function summon() {
    // Background already woke Spider-Buddy in storage; make sure we're visible now.
    endBattle();
    state = { ...state, enabled: true, snoozeUntil: 0 };
    applyState(null);
    if (!active) return;
    const onScreen = pos.x >= 0 && pos.y >= 0 && pos.x <= vw() - 10 && pos.y <= vh() - 10;
    if (!onScreen) {
      const s = startCoords();
      place(s.x, s.y);
      anchorAbove();
    }
    const power = charPower();
    const ok = power === 'pound' ? await poundEntrance()
      : power === 'nova' ? await novaEntrance()
      : power === 'beam' ? await makeEntrance()
      : await randomSwing();
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
      case 'WEBLING_BATTLE':
        state = { ...state, enabled: true, snoozeUntil: 0 };
        applyState(null);
        startBattle();
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

  /**
   * Pose library for the jointed heroes (see the rig in shared/sprite.js), emitted
   * as CSS. Every pose sets every joint and joints transition between poses, so a
   * hero blends from key pose to key pose (anticipation → action → settle)
   * instead of snapping. Gait cycles (run / walk / climb) keyframe the same joints.
   */
  function rigCss() {
    const JOINTS = ['body', 'head', 'hip-l', 'knee-l', 'hip-r', 'knee-r', 'sho-l', 'elb-l', 'sho-r', 'elb-r', 'wing-l', 'wing-r'];
    // Degrees, clockwise. The rig faces right, so + swings a limb backward and − swings it forward/up.
    const FLYER = {
      '[data-pose="idle"]': { 'hip-l': 4, 'knee-l': 14, 'hip-r': -6, 'knee-r': 24, 'sho-l': 8, 'elb-l': -16, 'sho-r': -4, 'elb-r': -22 },
      '[data-pose="anticipate"]': { body: 12, head: -10, 'hip-l': -40, 'knee-l': 74, 'hip-r': -30, 'knee-r': 66, 'sho-l': 36, 'elb-l': -34, 'sho-r': 28, 'elb-r': -46, 'wing-l': 14, 'wing-r': 18 },
      '[data-pose="flight"]': { body: -2, head: -30, 'hip-l': 10, 'knee-l': 16, 'hip-r': 2, 'knee-r': 6, 'sho-l': 14, 'elb-l': -8, 'sho-r': -168, 'elb-r': -4, 'wing-l': -24, 'wing-r': -30 },
      '[data-pose="land"]': { body: -8, head: 2, 'hip-l': -26, 'knee-l': 42, 'hip-r': -16, 'knee-r': 32, 'sho-l': -30, 'elb-l': -24, 'sho-r': -46, 'elb-r': -26, 'wing-l': 8, 'wing-r': 10 },
      '[data-pose="celebrate"]': { body: -4, head: -10, 'hip-l': 6, 'knee-l': 12, 'hip-r': -10, 'knee-r': 18, 'sho-l': 22, 'elb-l': -30, 'sho-r': -160, 'elb-r': -24, 'wing-l': 16, 'wing-r': 20 },
      '[data-pose="slip"]': { body: 14, head: 16, 'hip-l': -34, 'knee-l': 46, 'hip-r': 24, 'knee-r': 30, 'sho-l': -124, 'elb-l': -30, 'sho-r': -62, 'elb-r': -40, 'wing-l': 20, 'wing-r': 24 },
      '[data-pose="run"]': { body: 10, head: -6 },
      '[data-pose="walk"]': { body: 3 },
      '[data-pose="crawl"]': {},
      // Braced to fire: arm locked out at the target, support hand at the elbow, split stance.
      '.aiming': { body: -5, head: -3, 'hip-l': 18, 'knee-l': 14, 'hip-r': -16, 'knee-r': 18, 'sho-l': -50, 'elb-l': -58, 'sho-r': -90, 'elb-r': 0, 'wing-l': 6, 'wing-r': 8 },
      // Nova's release: arms and wings flung open.
      '.flare': { body: -8, head: -12, 'hip-l': 14, 'knee-l': 10, 'hip-r': -14, 'knee-r': 14, 'sho-l': 112, 'elb-l': 10, 'sho-r': -118, 'elb-r': -8, 'wing-l': 26, 'wing-r': 30 },
    };
    const BRUTE = {
      '[data-pose="idle"]': { body: 5, 'hip-l': -8, 'knee-l': 16, 'hip-r': -4, 'knee-r': 14, 'sho-l': -4, 'elb-l': -12, 'sho-r': -8, 'elb-r': -16 },
      '[data-pose="anticipate"]': { body: 16, head: -6, 'hip-l': -34, 'knee-l': 58, 'hip-r': -28, 'knee-r': 52, 'sho-l': 30, 'elb-l': -20, 'sho-r': 24, 'elb-r': -24 },
      '[data-pose="flight"]': { body: -6, head: -8, 'hip-l': -30, 'knee-l': 54, 'hip-r': -18, 'knee-r': 46, 'sho-l': -148, 'elb-l': -22, 'sho-r': -160, 'elb-r': -26 },
      '[data-pose="land"]': { body: 20, head: 4, 'hip-l': -42, 'knee-l': 66, 'hip-r': -36, 'knee-r': 62, 'sho-l': 6, 'elb-l': -4, 'sho-r': -2, 'elb-r': -6 },
      '[data-pose="celebrate"]': { body: -4, head: -8, 'hip-l': -6, 'knee-l': 12, 'hip-r': -4, 'knee-r': 10, 'sho-l': -150, 'elb-l': -30, 'sho-r': -156, 'elb-r': -34 },
      '[data-pose="run"]': { body: 12, head: -4 },
    };
    const rules = (scope, poses) => Object.entries(poses)
      .map(([sel, pose]) => JOINTS.map((j) => `.buddy.bolt${scope}${sel} .j-${j} { transform: rotate(${pose[j] || 0}deg); }`).join('\n'))
      .join('\n');
    const cycle = (pose, name, period, lagging) => `
      .buddy.bolt[data-pose="${pose}"] :is(.j-hip-l, .j-hip-r) { animation: rig-${name}-hip ${period}s ease-in-out infinite; }
      .buddy.bolt[data-pose="${pose}"] :is(.j-knee-l, .j-knee-r) { animation: rig-${name}-knee ${period}s linear infinite; }
      .buddy.bolt[data-pose="${pose}"] :is(.j-sho-l, .j-sho-r) { animation: rig-${name}-sho ${period}s ease-in-out infinite; }
      .buddy.bolt[data-pose="${pose}"] :is(.j-elb-l, .j-elb-r) { animation: rig-${name}-elb ${period}s ease-in-out infinite; }
      .buddy.bolt[data-pose="${pose}"] :is(${lagging}) { animation-delay: -${period / 2}s; }`;

    return `
      /* --- Jointed heroes: rig, pose library, gait cycles, jets --- */
      .buddy.bolt .frame { display: none; }
      .buddy.bolt .frame-rig { display: block; }
      .buddy.bolt .motion { transform-origin: 50% 62%; }
      .buddy.bolt .j { transform-box: view-box; transition: transform .2s cubic-bezier(.25, .8, .3, 1); }
      .buddy.bolt:is([data-pose="anticipate"], [data-pose="flight"]) .j { transition-duration: .14s; }
      .buddy.bolt[data-pose="land"] .j { transition: transform .24s cubic-bezier(.2, .9, .3, 1); }
${rules('', FLYER)}
${rules('.brute', BRUTE)}

      /* Idle: flyers hold a gentle hover on a whisper of thrust; everyone breathes. */
      .buddy.bolt .sway { transform-origin: 50% 62%; animation: rig-hover 3.6s ease-in-out infinite; }
      .buddy.bolt.brute .sway, .buddy.bolt:not([data-pose="idle"]) .sway { animation: none; }
      .buddy.bolt[data-pose="idle"] .chest { transform-box: fill-box; transform-origin: 50% 100%; animation: rig-breathe 3.2s ease-in-out infinite; }
      .buddy.bolt[data-pose="idle"] .j-wing-l { animation: rig-wing 3.2s ease-in-out infinite; }
      .buddy.bolt[data-pose="idle"] .j-wing-r { animation: rig-wing 3.2s ease-in-out -.4s infinite; }

      /* Gaits: opposite arm and leg swing together; knees fold on the recovery stroke. */
${cycle('run', 'run', 0.44, '.j-hip-r, .j-knee-r, .j-sho-r, .j-elb-r')}
${cycle('walk', 'walk', 0.9, '.j-hip-r, .j-knee-r, .j-sho-r, .j-elb-r')}
${cycle('crawl', 'climb', 0.62, '.j-hip-r, .j-knee-r, .j-sho-l, .j-elb-l')}
      .buddy.bolt[data-pose="run"] .frame-rig { animation: rig-bob .11s ease-in-out infinite alternate; }
      .buddy.bolt[data-pose="walk"] .frame-rig { animation: rig-bob-soft .225s ease-in-out infinite alternate; }
      .buddy.bolt.brute[data-pose="run"] :is(.j-hip-l, .j-hip-r, .j-knee-l, .j-knee-r, .j-sho-l, .j-sho-r, .j-elb-l, .j-elb-r) { animation-duration: .62s; }
      .buddy.bolt.brute[data-pose="run"] :is(.j-hip-r, .j-knee-r, .j-sho-r, .j-elb-r) { animation-delay: -.31s; }
      .buddy.bolt.brute[data-pose="run"] .frame-rig { animation-duration: .155s; }

      /* Jets: a steady cone locked to each boot nozzle, sized by --thrust per phase.
         No on/off flicker — only a slight shimmer in the white-hot core. */
      .buddy.bolt { --thrust: 0; }
      .buddy.bolt.flyer[data-pose="idle"] { --thrust: .22; }
      .buddy.bolt.flyer[data-pose="anticipate"] { --thrust: .42; }
      .buddy.bolt.flyer[data-pose="land"] { --thrust: .5; }
      .buddy.bolt.flyer:is(.boosting, .skimming) { --thrust: 1; }
      .buddy.bolt.flyer.braking { --thrust: .6; }
      .buddy.bolt.flyer.aiming { --thrust: .32; }
      .buddy.bolt .jet { opacity: 1; transform-box: view-box; transform: scaleY(var(--thrust)); transition: transform .16s cubic-bezier(.3, .7, .3, 1); }
      .buddy.bolt .flame-core { transform-box: fill-box; transform-origin: 50% 0; animation: rig-flame .14s ease-in-out infinite alternate; }

      .stage.reduced .buddy.bolt :is(.j, .frame-rig, .chest, .sway, .flame-core) { animation: none !important; transition: none !important; }

      @keyframes rig-hover { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      @keyframes rig-breathe { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.012, 1.024); } }
      @keyframes rig-wing { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(5deg); } }
      @keyframes rig-flame { from { transform: scaleY(1); opacity: .9; } to { transform: scaleY(1.07); opacity: 1; } }
      @keyframes rig-bob { from { transform: translateY(0); } to { transform: translateY(-2.5px); } }
      @keyframes rig-bob-soft { from { transform: translateY(0); } to { transform: translateY(-1.4px); } }
      @keyframes rig-run-hip { 0%, 100% { transform: rotate(-36deg); } 50% { transform: rotate(30deg); } }
      @keyframes rig-run-knee { 0%, 100% { transform: rotate(14deg); } 20% { transform: rotate(26deg); } 50% { transform: rotate(18deg); } 66% { transform: rotate(96deg); } 84% { transform: rotate(64deg); } }
      @keyframes rig-run-sho { 0%, 100% { transform: rotate(36deg); } 50% { transform: rotate(-42deg); } }
      @keyframes rig-run-elb { 0%, 100% { transform: rotate(-64deg); } 50% { transform: rotate(-96deg); } }
      @keyframes rig-walk-hip { 0%, 100% { transform: rotate(-20deg); } 50% { transform: rotate(18deg); } }
      @keyframes rig-walk-knee { 0%, 100% { transform: rotate(6deg); } 25% { transform: rotate(12deg); } 62% { transform: rotate(46deg); } 80% { transform: rotate(18deg); } }
      @keyframes rig-walk-sho { 0%, 100% { transform: rotate(16deg); } 50% { transform: rotate(-18deg); } }
      @keyframes rig-walk-elb { 0%, 100% { transform: rotate(-14deg); } 50% { transform: rotate(-26deg); } }
      @keyframes rig-climb-hip { 0%, 100% { transform: rotate(-58deg); } 50% { transform: rotate(-8deg); } }
      @keyframes rig-climb-knee { 0%, 100% { transform: rotate(82deg); } 50% { transform: rotate(22deg); } }
      @keyframes rig-climb-sho { 0%, 100% { transform: rotate(-150deg); } 50% { transform: rotate(-84deg); } }
      @keyframes rig-climb-elb { 0%, 100% { transform: rotate(-36deg); } 50% { transform: rotate(-8deg); } }
`;
  }

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
      .buddy.pixel[data-pose="land"] .frame-land { animation: px-land .38s cubic-bezier(.25, .8, .35, 1) both; }
      .buddy.pixel[data-pose="slip"] .frame-slip { transform-origin: 50% 55%; animation: px-tumble .45s linear infinite; }
      .buddy.pixel[data-pose="celebrate"] .frame-celebrate { animation: px-cheer .22s steps(2, jump-none) infinite alternate; }
      .buddy.pixel[data-pose="crawl"] .frame-anticipate { transform-origin: 50% 50%; animation: px-climb .34s ease-in-out infinite; }
      .buddy.pixel[data-pose="walk"] .frame-anticipate { transform-origin: 50% 92%; animation: px-walk .36s ease-in-out infinite; }
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
        0% { transform: scale(.95, 1.07); }
        40% { transform: scale(1.04, .95); }
        100% { transform: none; }
      }
      @keyframes px-tumble { to { transform: rotate(360deg); } }
      @keyframes px-climb {
        0% { transform: rotate(-5deg) scale(1, 1); }
        50% { transform: rotate(5deg) scale(1.03, .97); }
        100% { transform: rotate(-5deg) scale(1, 1); }
      }
      @keyframes px-walk {
        0% { transform: rotate(6deg) translateY(0) scaleY(.99); }
        50% { transform: rotate(6deg) translateY(-4px) scaleY(1.03); }
        100% { transform: rotate(6deg) translateY(0) scaleY(.99); }
      }
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
      .walk-dust i { animation-duration: .6s; width: 7px; height: 7px; opacity: .7; }
      @keyframes puff-soft { from { transform: translate(0, 0) scale(.4); opacity: .6; } to { transform: translate(-14px, -4px) scale(1.1); opacity: 0; } }
      .walk-dust i { animation-name: puff-soft; }
      .stage.reduced .run-dust { display: none; }

${rigCss()}

      /* --- Energy beam --- */
      .beam {
        position: fixed; left: 0; top: 0; height: 9px; margin-top: -4.5px;
        transform-origin: left center; pointer-events: none; z-index: 2;
        opacity: 0; transition: opacity .12s ease;
      }
      .beam.beam-left { transform: scaleX(-1); }
      .beam.charge { opacity: 1; }
      .beam.out { opacity: 0; transition: opacity .3s ease; }
      .beam-core {
        position: absolute; inset: 0; border-radius: 5px;
        transform-origin: left center; transform: scaleX(0.05);
        transition: transform .5s cubic-bezier(.2,.85,.2,1), filter .1s ease;
        background: linear-gradient(90deg, rgba(255,255,255,.98), #b6f2ff 12%, #45c8ff 55%, rgba(69,200,255,0) 100%);
        box-shadow: 0 0 10px 3px rgba(130,232,255,.8), 0 0 26px 9px rgba(60,170,255,.45);
      }
      .beam.fire .beam-core { transform: scaleX(1); filter: brightness(1.25); }
      .beam-muzzle {
        position: absolute; left: -12px; top: 50%; width: 28px; height: 28px; margin-top: -14px;
        border-radius: 50%; background: radial-gradient(circle, #fff 0%, #b6f2ff 42%, rgba(130,232,255,0) 72%);
        transform: scale(.6); transition: transform .12s ease;
      }
      .beam.charge .beam-muzzle { transform: scale(1); }
      .beam.fire .beam-muzzle { transform: scale(1.35); }
      .beam-hit {
        position: absolute; right: -8px; top: 50%; width: 24px; height: 24px; margin-top: -12px;
        border-radius: 50%; background: radial-gradient(circle, #fff 0%, #b6f2ff 46%, rgba(130,232,255,0) 76%);
        opacity: 0; transform: scale(.5); transition: opacity .18s ease .12s, transform .4s ease .12s;
      }
      .beam.fire .beam-hit { opacity: 1; transform: scale(1.1); }
      .stage.reduced .beam-core, .stage.reduced .beam-muzzle, .stage.reduced .beam-hit { transition: none; }
      .beam-big { height: 15px; margin-top: -7.5px; }
      .beam-big .beam-muzzle { width: 36px; height: 36px; margin-top: -18px; left: -16px; }

      /* Ground-pound rubble + screen shake */
      .rubble {
        position: fixed; border-radius: 2px; margin: -4px 0 0 -4px; z-index: 1; pointer-events: none;
        background: #8a7a62; box-shadow: inset -1px -1px 0 rgba(0,0,0,.35), 0 1px 1px rgba(0,0,0,.25);
        animation: rubble .76s ease-out forwards;
      }
      @keyframes rubble {
        0% { transform: translate(0, 0) scale(var(--s)); opacity: 1; }
        55% { transform: translate(calc(var(--dx) * .9), var(--dy)) scale(var(--s)); opacity: 1; }
        100% { transform: translate(var(--dx), 16px) scale(var(--s)); opacity: 0; }
      }
      /* One sharp jolt that settles — reads as weight, not as the page vibrating. */
      .stage.quake { animation: quake .3s cubic-bezier(.2,.7,.3,1); }
      @keyframes quake {
        0%, 100% { transform: translate(0, 0); }
        15% { transform: translate(0, 3px); }
        45% { transform: translate(-1.5px, -1px); }
        75% { transform: translate(1px, .5px); }
      }
      .stage.reduced.quake { animation: none; }
      .stage.reduced .rubble { display: none; }

      /* Nova: charge glow + radial shockwave burst */
      .buddy.nova-charge .frame-rig { filter: drop-shadow(0 0 5px rgba(215,160,255,.9)); transition: filter .3s ease; }
      .nova { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 2; }
      .nova-flash {
        position: absolute; left: 0; top: 0; width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 50%;
        background: radial-gradient(circle, #fff 0%, #e2c4ff 40%, rgba(205,150,255,0) 72%); transform: scale(0); opacity: 0;
      }
      .nova.go .nova-flash { animation: nova-flash .4s cubic-bezier(.2, .7, .3, 1) forwards; }
      /* Rings grow in size (not scale) so the stroke stays crisp as they travel. */
      .nova-ring {
        position: absolute; left: 0; top: 0; width: 24px; height: 24px; border-radius: 50%;
        transform: translate(-50%, -50%); border: 3px solid #b57bff;
        box-shadow: 0 0 0 1px rgba(60, 20, 120, .28), 0 0 10px rgba(181, 123, 255, .65), inset 0 0 6px rgba(181, 123, 255, .4);
        opacity: 0;
      }
      .nova.go .nova-ring { animation: nova-ring .7s cubic-bezier(.15, .7, .3, 1) forwards; }
      .nova.go .nova-ring:nth-child(3) { animation-delay: .08s; border-color: #ffffff; }
      .nova.go .nova-ring:nth-child(4) { animation-delay: .16s; border-color: #8f4fe6; }
      .nova-star {
        position: absolute; left: 0; top: 0; width: 220px; height: 220px; margin: -110px 0 0 -110px; border-radius: 50%;
        background: repeating-conic-gradient(rgba(226,196,255,0) 0 16deg, rgba(226,196,255,.45) 16deg 17.5deg);
        -webkit-mask: radial-gradient(circle, #000 0%, rgba(0,0,0,.55) 42%, transparent 70%);
        mask: radial-gradient(circle, #000 0%, rgba(0,0,0,.55) 42%, transparent 70%);
        transform: scale(0); opacity: 0;
      }
      .nova.go .nova-star { animation: nova-star .5s cubic-bezier(.2, .7, .3, 1) forwards; }
      @keyframes nova-flash { 0% { transform: scale(0); opacity: 1; } 55% { transform: scale(1.35); opacity: .9; } 100% { transform: scale(1.7); opacity: 0; } }
      @keyframes nova-ring { 0% { width: 24px; height: 24px; opacity: 1; } 45% { opacity: .95; } 100% { width: 440px; height: 440px; opacity: 0; } }
      @keyframes nova-star { 0% { transform: scale(0) rotate(0deg); opacity: .85; } 100% { transform: scale(1) rotate(24deg); opacity: 0; } }
      .stage.reduced .nova-ring, .stage.reduced .nova-star, .stage.reduced .nova-flash { animation: none !important; }

      /* Rumble: thrown boulder */
      .boulder {
        position: fixed; left: 0; top: 0; width: 16px; height: 16px; margin: -8px 0 0 -8px;
        border-radius: 46% 54% 48% 50%; pointer-events: none; z-index: 1;
        background: radial-gradient(circle at 35% 30%, #a6906f, #564a3c 90%);
        box-shadow: inset -2px -2px 0 rgba(0,0,0,.3), 0 2px 3px rgba(0,0,0,.3);
      }

      /* Jet trail: thin heat streaks from each nozzle, shot out opposite the direction of travel. */
      .spark {
        position: fixed; left: 0; top: 0; width: 15px; height: 2.5px; margin-top: -1.25px; border-radius: 2px;
        transform-origin: 0 50%; transform: rotate(var(--a)); pointer-events: none; z-index: 0;
        background: linear-gradient(90deg, rgba(255,251,234,.95), rgba(255,176,72,.7) 45%, rgba(255,90,40,0));
        animation: spark .3s cubic-bezier(.2, .6, .3, 1) forwards;
      }
      @keyframes spark {
        from { transform: rotate(var(--a)) translateX(0) scaleX(1); opacity: .95; }
        to { transform: rotate(var(--a)) translateX(16px) scaleX(.35); opacity: 0; }
      }

      /* Dash-teleport streak: draws across the gap, then its tail collapses into the arrival point. */
      .dash {
        --fx: 140, 228, 255;
        position: fixed; left: 0; top: 0; height: 12px; margin-top: -6px; border-radius: 6px;
        transform-origin: 0 50%; pointer-events: none; z-index: 2;
        background: linear-gradient(90deg, rgba(var(--fx), 0), rgba(var(--fx), .5) 40%, rgba(255,255,255,.95) 92%, rgba(255,255,255,0));
        box-shadow: 0 0 12px 1px rgba(var(--fx), .35);
        animation: dash .52s cubic-bezier(.2, .8, .2, 1) forwards;
      }
      .dash.tone-nova { --fx: 205, 150, 255; }
      .dash.tone-pound { --fx: 255, 176, 92; }
      @keyframes dash {
        0% { clip-path: inset(0 100% 0 0); opacity: 1; }
        20% { clip-path: inset(0 0 0 0); opacity: 1; }
        100% { clip-path: inset(0 0 0 100%); opacity: .3; }
      }

      /* Nova's wind-up: an arc that spirals in and tightens before the release. */
      .charge-spiral { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 2; }
      .charge-spiral::before {
        content: ''; position: absolute; left: -64px; top: -64px; width: 128px; height: 128px; border-radius: 50%;
        background: conic-gradient(rgba(169,112,255,0) 0deg 200deg, rgba(169,112,255,.95) 318deg, #fff 356deg, rgba(255,255,255,0) 360deg);
        -webkit-mask: radial-gradient(circle, transparent 58%, #000 62%, #000 70%, transparent 74%);
        mask: radial-gradient(circle, transparent 58%, #000 62%, #000 70%, transparent 74%);
        filter: drop-shadow(0 0 1px rgba(60, 20, 120, .7)) drop-shadow(0 0 6px rgba(169, 112, 255, .7));
        animation: charge-spiral .5s cubic-bezier(.55, 0, .8, .5) forwards;
      }
      @keyframes charge-spiral {
        0% { transform: rotate(0deg) scale(1.15); opacity: 0; }
        18% { opacity: 1; }
        100% { transform: rotate(600deg) scale(.22); opacity: 1; }
      }

      /* --- Hero Battle --- */
      .buddy.benched { visibility: hidden; pointer-events: none; }
      .stage.battling .water, .stage.battling .focus-pill, .stage.battling .baby { visibility: hidden; pointer-events: none; }
      .buddy.fighter { pointer-events: none; }
      .buddy.fighter .frames { transform: scale(1.3); transform-origin: 50% 100%; }
      .buddy.fighter.pixel .sway { animation: none; }
      .buddy.fighter .hp {
        position: absolute; left: 50%; top: -14%; transform: translate(-50%, -100%);
        display: flex; flex-direction: column; align-items: center; gap: 2px; white-space: nowrap; z-index: 2;
      }
      .hp-name { font: 800 10px/1 system-ui, sans-serif; letter-spacing: .03em; color: #fff; text-shadow: 0 1px 2px #000, 0 0 2px #000; }
      .hp-bar { width: 58px; height: 6px; border-radius: 4px; overflow: hidden; background: rgba(0,0,0,.55); box-shadow: 0 0 0 1px rgba(255,255,255,.55); }
      .hp-bar i { display: block; width: 100%; height: 100%; background: linear-gradient(90deg, #3fe07a, #c6f55b); transition: width .3s ease; }
      .buddy.fighter.hp-low .hp-bar i { background: linear-gradient(90deg, #ff4d4d, #ffb03b); }
      .buddy.fighter.hit .frames { filter: brightness(2.3) drop-shadow(0 0 6px #fff); }
      .buddy.fighter.webbed .flip::after {
        content: ''; position: absolute; inset: 18% 8% 6%; border-radius: 50%; pointer-events: none;
        background: repeating-conic-gradient(rgba(255,255,255,.95) 0 2.5deg, transparent 2.5deg 30deg);
        -webkit-mask: radial-gradient(circle, #000 55%, transparent 72%); mask: radial-gradient(circle, #000 55%, transparent 72%);
        opacity: .85;
      }

      .bt-shot { position: fixed; transform-origin: 0 50%; pointer-events: none; z-index: 3; animation: bt-shot .5s ease-out forwards; }
      @keyframes bt-shot {
        0% { clip-path: inset(0 100% 0 0); opacity: 1; }
        35% { clip-path: inset(0 0 0 0); opacity: 1; }
        100% { clip-path: inset(0 0 0 0); opacity: 0; }
      }
      .web-shot { height: 2px; margin-top: -1px; background: #f4f8ff; box-shadow: 0 0 0 1px rgba(29,22,80,.35), 0 0 4px rgba(255,255,255,.8); }
      .bt-beam {
        height: 10px; margin-top: -5px; border-radius: 6px;
        background: linear-gradient(90deg, #fff, #b6f2ff 20%, #45c8ff 70%, #fff);
        box-shadow: 0 0 12px 4px rgba(120,230,255,.75), 0 0 28px 10px rgba(60,170,255,.4);
      }

      .bt-pop {
        position: fixed; z-index: 4; pointer-events: none; white-space: nowrap;
        transform: translate(-50%, -50%);
        font: italic 900 16px/1 Impact, "Arial Black", system-ui, sans-serif; letter-spacing: .5px;
        color: #ffe14d; -webkit-text-stroke: 1.2px #7a1d00; text-shadow: 2px 2px 0 #1a0507;
        animation: bt-pop .9s cubic-bezier(.2,1.4,.4,1) forwards;
      }
      .bt-pop.dmg { color: #ff6b6b; font-size: 14px; -webkit-text-stroke: 1px #3a0000; }
      .bt-pop.ko { color: #fff; font-size: 20px; -webkit-text-stroke: 1.4px #b3121f; }
      .bt-pop.big { font-size: 34px; animation-duration: 1.6s; }
      @keyframes bt-pop {
        0% { transform: translate(-50%, -50%) scale(.3); opacity: 0; }
        20% { transform: translate(-50%, -50%) scale(1.25); opacity: 1; }
        70% { transform: translate(-50%, -85%) scale(1); opacity: 1; }
        100% { transform: translate(-50%, -125%) scale(.9); opacity: 0; }
      }

      .bt-banner {
        position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 5; pointer-events: auto;
        display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 14px; border-radius: 999px;
        background: linear-gradient(135deg, #e0412f, #f59e0b); color: #fff;
        font: italic 900 14px/1 Impact, "Arial Black", system-ui, sans-serif; letter-spacing: .06em;
        box-shadow: 0 8px 24px rgba(0,0,0,.3);
      }
      .bt-stop {
        width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; cursor: pointer;
        background: rgba(0,0,0,.28); color: #fff; font: 700 12px/1 system-ui, sans-serif;
      }
      .bt-stop:hover { background: rgba(0,0,0,.45); }
      .bt-stop:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
      .stage.reduced .bt-pop, .stage.reduced .bt-shot { animation: none; }
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

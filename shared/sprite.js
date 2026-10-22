/**
 * Webling — character art.
 *
 * The whole visual identity is generated from code so that the on-page
 * companion, popup, onboarding, toolbar icons and store artwork all come
 * from one source and stay consistent. Themes are just palettes.
 *
 * Every frame uses the same 100×125 viewBox. The web thread attaches at
 * (50, GRIP_Y) so the content script can align the strand with
 * `rect.top + rect.height * GRIP_Y / 125`.
 *
 * Classic script → exposes `globalThis.WeblingSprite`.
 */
(function (root) {
  'use strict';

  const PALETTES = Object.freeze({
    classic: {
      body: '#5a4bd8', light: '#8b7df5', shade: '#3e31b0', outline: '#1d1650',
      legs: '#3f33aa', band: '#3fe0b6', bandShade: '#1fae8a', cheek: '#ff8fb5',
      eye: '#ffffff', pupil: '#16112f', sock: '#3fe0b6',
    },
    midnight: {
      body: '#2b3a78', light: '#4b62b8', shade: '#1b2556', outline: '#090d26',
      legs: '#202c62', band: '#ffd166', bandShade: '#d9a63a', cheek: '#ff9ec7',
      eye: '#ffffff', pupil: '#0b0f22', sock: '#ffd166',
    },
    sunset: {
      body: '#ff7759', light: '#ffa98a', shade: '#e0553b', outline: '#5f1a10',
      legs: '#e2573c', band: '#ffe08a', bandShade: '#f0b84a', cheek: '#ff4f86',
      eye: '#ffffff', pupil: '#2b0d08', sock: '#ffe08a',
    },
    forest: {
      body: '#2fa36f', light: '#5fd197', shade: '#1f7d53', outline: '#0b3322',
      legs: '#237f55', band: '#ffb347', bandShade: '#e08b1f', cheek: '#ff9aa8',
      eye: '#ffffff', pupil: '#0b2016', sock: '#ffb347',
    },
    // `sprites` replaces the drawn character with pixel art from shared/sprite-pixels.js:
    // frame -> [sprite name, x of the thread grip as a fraction of sprite width, mirror?].
    // Frames face right like the vector character; the crouch and swing art faces left, so it is mirrored.
    spidey: {
      body: '#d6202f', light: '#ff5a5f', shade: '#9e1220', outline: '#1a0507',
      legs: '#1f4fb8', band: '#1f4fb8', bandShade: '#163a8a', cheek: '#ff8fb5',
      eye: '#ffffff', pupil: '#111111', sock: '#d6202f',
      sprites: {
        idle: ['hang', 0.49],
        anticipate: ['crouch', 0.56, true],
        flight: ['swing', 0.09, true],
        land: ['hang', 0.49],
        slip: ['swing', 0.09, true],
        celebrate: ['cheer', 0.47],
      },
    },
    // `articulated` replaces the drawn blob with a jointed original hero ("Boltling").
    // Its limbs are separate <g> groups the content script animates per pose (run, climb, boost…).
    // An original design — steel-blue armour, amber trim, a cyan visor and jet boots.
    bolt: {
      articulated: true,
      steel: '#44588a', steelLight: '#6f88bf', steelShade: '#2b3a63', outline: '#101a2e',
      amber: '#ffb63d', amberShade: '#d98a24', visor: '#78e8ff', visorDark: '#0c3a4b',
      metal: '#9aa7c4', core: '#ffe08a',
    },
  });

  /** Y coordinate (in the 125-high viewBox) where Webling grips the thread. */
  const GRIP_Y = 15;

  const FRAMES = ['idle', 'anticipate', 'flight', 'land', 'slip', 'celebrate'];

  // ---------------------------------------------------------------------------
  // Small SVG helpers
  // ---------------------------------------------------------------------------

  const leg = (d, p, w = 5.5) =>
    `<path d="${d}" fill="none" stroke="${p.outline}" stroke-width="${w + 3}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${p.legs}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

  const sock = (x, y, p, r = 3.4) =>
    `<circle cx="${x}" cy="${y}" r="${r + 1.5}" fill="${p.outline}"/><circle cx="${x}" cy="${y}" r="${r}" fill="${p.sock}"/>`;

  /** Mirrors an "M x y Q x y x y" leg path across x = 50. */
  const mirror = (d) => d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${100 - Number(x)} ${y}`);

  /** Last point of a path string. */
  const endPoint = (d) => {
    const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    return [nums[nums.length - 2], nums[nums.length - 1]];
  };

  function legPair(d, p, withSock = true) {
    const right = mirror(d);
    let out = leg(d, p) + leg(right, p);
    if (withSock) {
      const [lx, ly] = endPoint(d);
      const [rx, ry] = endPoint(right);
      out += sock(lx, ly, p) + sock(rx, ry, p);
    }
    return out;
  }

  function oneLeg(d, p, withSock = true) {
    let out = leg(d, p);
    if (withSock) {
      const [x, y] = endPoint(d);
      out += sock(x, y, p);
    }
    return out;
  }

  /** The left front leg holding the thread at the grip point, plus a free right arm. */
  function holdAndArm(hold, arm, p) {
    return oneLeg(hold, p, false) + oneLeg(arm, p);
  }

  function defs(p, uid) {
    return `<defs>
      <radialGradient id="wb-body-${uid}" cx="38%" cy="30%" r="75%">
        <stop offset="0" stop-color="${p.light}"/>
        <stop offset="0.55" stop-color="${p.body}"/>
        <stop offset="1" stop-color="${p.shade}"/>
      </radialGradient>
    </defs>`;
  }

  function body(p, uid, { cx = 50, cy = 66, rx = 30, ry = 29 } = {}) {
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx + 2}" ry="${ry + 2}" fill="${p.outline}"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#wb-body-${uid})"/>
      <ellipse cx="${cx - rx * 0.38}" cy="${cy - ry * 0.55}" rx="${rx * 0.22}" ry="${ry * 0.12}" fill="#ffffff" opacity="0.35" transform="rotate(-25 ${cx - rx * 0.38} ${cy - ry * 0.55})"/>`;
  }

  /** Headband with knot + two tails on the right (the "facing" side). */
  function band(p, { cy = 66, ry = 29, rx = 30, flutter = 0 } = {}) {
    const top = cy - ry;
    const y1 = top + 9;
    const y2 = top + 16;
    const xl = 50 - rx * 0.86;
    const xr = 50 + rx * 0.86;
    const knotX = 50 + rx * 0.78;
    const knotY = top + 12.5;
    const t1 = `M${knotX} ${knotY} q ${10 + flutter} ${-6 - flutter * 0.4} ${18 + flutter * 1.6} ${-3 - flutter * 0.8} q -4 6 -14 8 z`;
    const t2 = `M${knotX} ${knotY + 1} q ${12 + flutter} ${4 - flutter * 0.2} ${17 + flutter * 1.5} ${10 - flutter * 0.4} q -8 1 -15 -5 z`;
    return `<path d="${t2}" fill="${p.bandShade}" stroke="${p.outline}" stroke-width="2" stroke-linejoin="round"/>
      <path d="${t1}" fill="${p.band}" stroke="${p.outline}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M${xl} ${y1} Q50 ${y1 - 7} ${xr} ${y1} L${xr} ${y2} Q50 ${y2 - 7} ${xl} ${y2} Z" fill="${p.band}" stroke="${p.outline}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M${xl + 4} ${y1 + 2.2} Q50 ${y1 - 4.2} ${xr - 4} ${y1 + 2.2}" fill="none" stroke="#ffffff" stroke-width="1.4" opacity="0.55" stroke-linecap="round"/>
      <circle cx="${knotX}" cy="${knotY}" r="4.6" fill="${p.bandShade}" stroke="${p.outline}" stroke-width="2"/>`;
  }

  function eyes(p, mood, cy) {
    const L = 39.5;
    const R = 60.5;
    if (mood === 'happy') {
      // ^ ^ closed happy eyes
      return `<path d="M${L - 7} ${cy + 2} Q${L} ${cy - 7} ${L + 7} ${cy + 2}" fill="none" stroke="${p.pupil}" stroke-width="3.6" stroke-linecap="round"/>
        <path d="M${R - 7} ${cy + 2} Q${R} ${cy - 7} ${R + 7} ${cy + 2}" fill="none" stroke="${p.pupil}" stroke-width="3.6" stroke-linecap="round"/>`;
    }
    const r = mood === 'shock' ? 10.5 : 9.5;
    const pr = mood === 'shock' ? 3.4 : mood === 'focus' ? 5 : 5.8;
    const dx = mood === 'focus' ? 2.2 : 1.4;
    const dy = mood === 'focus' ? -1.2 : 0.6;
    const eye = (x) => `<circle cx="${x}" cy="${cy}" r="${r + 1.6}" fill="${p.outline}"/>
      <circle cx="${x}" cy="${cy}" r="${r}" fill="${p.eye}"/>
      <circle cx="${x + dx}" cy="${cy + dy}" r="${pr}" fill="${p.pupil}"/>
      <circle cx="${x + dx - pr * 0.42}" cy="${cy + dy - pr * 0.45}" r="${pr * 0.42}" fill="#ffffff"/>
      <circle cx="${x + dx + pr * 0.4}" cy="${cy + dy + pr * 0.45}" r="${pr * 0.18}" fill="#ffffff"/>`;
    let out = eye(L) + eye(R);
    if (mood === 'focus') {
      out += `<path d="M${L - 8} ${cy - 12} L${L + 6} ${cy - 9.5}" stroke="${p.outline}" stroke-width="3" stroke-linecap="round"/>
        <path d="M${R + 8} ${cy - 12} L${R - 6} ${cy - 9.5}" stroke="${p.outline}" stroke-width="3" stroke-linecap="round"/>`;
    }
    return out;
  }

  function cheeks(p, cy) {
    return `<ellipse cx="29" cy="${cy}" rx="5.5" ry="3.4" fill="${p.cheek}" opacity="0.8"/>
      <ellipse cx="71" cy="${cy}" rx="5.5" ry="3.4" fill="${p.cheek}" opacity="0.8"/>`;
  }

  function mouth(p, kind, cy) {
    switch (kind) {
      case 'open':
        return `<path d="M43 ${cy - 1} Q50 ${cy + 10} 57 ${cy - 1} Z" fill="${p.pupil}" stroke="${p.pupil}" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M46 ${cy + 3.2} Q50 ${cy + 1} 54 ${cy + 3.2} Q50 ${cy + 7.5} 46 ${cy + 3.2} Z" fill="#ff6f91"/>`;
      case 'o':
        return `<ellipse cx="50" cy="${cy + 2}" rx="3.6" ry="4.4" fill="${p.pupil}"/>`;
      case 'grit':
        return `<path d="M45 ${cy + 1} Q50 ${cy + 4} 55 ${cy + 1}" fill="none" stroke="${p.pupil}" stroke-width="2.8" stroke-linecap="round"/>`;
      default:
        return `<path d="M44.5 ${cy} Q50 ${cy + 6} 55.5 ${cy}" fill="none" stroke="${p.pupil}" stroke-width="2.8" stroke-linecap="round"/>`;
    }
  }

  // ---------------------------------------------------------------------------
  // Accessories (cosmetic badges)
  // ---------------------------------------------------------------------------

  function accessory(kind, top) {
    const y = top;
    switch (kind) {
      case 'crown':
        return `<g transform="translate(50 ${y - 3})">
          <path d="M-12 2 L-12 -9 L-6 -3 L0 -12 L6 -3 L12 -9 L12 2 Z" fill="#ffc83d" stroke="#6b4300" stroke-width="2" stroke-linejoin="round"/>
          <circle cx="0" cy="-3" r="2" fill="#ff5d73"/><circle cx="-7" cy="-1" r="1.4" fill="#4fd1ff"/><circle cx="7" cy="-1" r="1.4" fill="#4fd1ff"/>
        </g>`;
      case 'star':
        return `<g transform="translate(29 ${y + 10}) rotate(-14)">
          <path d="M0 -9 L2.6 -2.8 L9.2 -2.8 L3.9 1.2 L5.8 7.8 L0 3.9 L-5.8 7.8 L-3.9 1.2 L-9.2 -2.8 L-2.6 -2.8 Z" fill="#ffd23f" stroke="#6b4300" stroke-width="1.8" stroke-linejoin="round"/>
        </g>`;
      case 'flower':
        return `<g transform="translate(30 ${y + 10})">
          ${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-5" rx="3.6" ry="5" fill="#ffb3d1" stroke="#7a2a4f" stroke-width="1.4" transform="rotate(${a})"/>`).join('')}
          <circle r="3.2" fill="#ffd23f" stroke="#7a2a4f" stroke-width="1.4"/>
        </g>`;
      default:
        return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Frames
  // ---------------------------------------------------------------------------

  /**
   * Returns the inner SVG markup (no <svg> wrapper) for one frame.
   * @param {string} name  one of FRAMES
   * @param {object} p     palette
   * @param {string} uid   unique id suffix for gradients
   * @param {string} acc   accessory: '', 'crown', 'star', 'flower'
   */
  function frameMarkup(name, p, uid, acc = '') {
    if (p.sprites) return spriteMarkup(name, p);
    if (p.articulated) return boltMarkup(p, uid);
    let s = defs(p, uid);
    switch (name) {
      case 'anticipate': {
        const g = { cy: 71, rx: 33, ry: 25 };
        s += legPair('M28 60 Q12 60 10 72', p) + legPair('M27 72 Q12 78 14 90', p) + legPair('M32 86 Q24 96 28 104', p);
        s += holdAndArm('M39 50 Q32 30 48 15', 'M63 51 Q78 46 81 57', p);
        s += body(p, uid, g) + band(p, g) + eyes(p, 'focus', 69) + cheeks(p, 79) + mouth(p, 'grit', 83);
        s += accessory(acc, g.cy - g.ry);
        break;
      }
      case 'flight': {
        const g = { cy: 64, rx: 29, ry: 30 };
        s += legPair('M24 56 Q8 46 3 54', p) + legPair('M22 68 Q4 70 2 80', p) + legPair('M27 83 Q12 96 10 106', p);
        s += holdAndArm('M38 40 Q31 22 48 14', 'M64 42 Q82 28 92 34', p);
        s += body(p, uid, g) + band(p, { ...g, flutter: 6 }) + eyes(p, 'open', 61) + cheeks(p, 72) + mouth(p, 'open', 75);
        s += accessory(acc, g.cy - g.ry);
        break;
      }
      case 'land': {
        const g = { cy: 74, rx: 34, ry: 24 };
        s += legPair('M26 66 Q10 62 6 76', p) + legPair('M26 78 Q10 86 8 98', p) + legPair('M34 90 Q26 100 22 108', p);
        s += holdAndArm('M40 54 Q33 33 48 15', 'M62 55 Q78 50 85 60', p);
        s += body(p, uid, g) + band(p, g) + eyes(p, 'happy', 72) + cheeks(p, 81) + mouth(p, 'smile', 84);
        s += accessory(acc, g.cy - g.ry);
        break;
      }
      case 'slip': {
        const g = { cy: 68, rx: 30, ry: 29 };
        s += legPair('M24 58 Q8 44 12 32', p) + legPair('M23 70 Q4 64 4 50', p) + legPair('M28 84 Q12 92 6 86', p);
        s += legPair('M36 44 Q26 26 30 14', p);
        s += body(p, uid, g) + band(p, { ...g, flutter: 3 }) + eyes(p, 'shock', 65) + cheeks(p, 77) + mouth(p, 'o', 80);
        s += `<path d="M80 40 q4 6 0 9 q-4 -3 0 -9 z" fill="#8fd8ff" stroke="#1d5f86" stroke-width="1.4"/>`;
        s += accessory(acc, g.cy - g.ry);
        break;
      }
      case 'celebrate': {
        const g = { cy: 68, rx: 30, ry: 29 };
        s += legPair('M24 60 Q10 62 8 74', p) + legPair('M24 72 Q8 80 10 92', p) + legPair('M29 86 Q18 96 22 106', p);
        s += legPair('M34 46 Q18 30 14 14', p);
        s += body(p, uid, g) + band(p, { ...g, flutter: 2 }) + eyes(p, 'happy', 65) + cheeks(p, 76) + mouth(p, 'open', 78);
        s += `<g fill="#ffd23f" stroke="#6b4300" stroke-width="1.2">
          <path d="M50 14 l2 5 5 0 -4 3 1.6 5 -4.6 -3 -4.6 3 1.6 -5 -4 -3 5 0z"/>
          <path d="M30 30 l1.3 3 3 0 -2.4 1.8 1 3 -2.9 -1.8 -2.9 1.8 1 -3 -2.4 -1.8 3 0z"/>
          <path d="M70 30 l1.3 3 3 0 -2.4 1.8 1 3 -2.9 -1.8 -2.9 1.8 1 -3 -2.4 -1.8 3 0z"/>
        </g>`;
        s += accessory(acc, g.cy - g.ry);
        break;
      }
      case 'idle':
      default: {
        const g = { cy: 66, rx: 30, ry: 29 };
        s += legPair('M24 58 Q8 56 6 70', p) + legPair('M23 70 Q6 74 8 88', p) + legPair('M28 84 Q16 94 20 106', p);
        s += holdAndArm('M38 43 Q31 25 48 15', 'M64 44 Q80 36 84 46', p);
        s += body(p, uid, g) + band(p, g) + eyes(p, 'open', 63) + cheeks(p, 74) + mouth(p, 'smile', 77);
        s += accessory(acc, g.cy - g.ry);
      }
    }
    // Grip blob where the front legs hold the thread (except when slipping/celebrating).
    if (name !== 'slip' && name !== 'celebrate') {
      s += `<circle cx="50" cy="${GRIP_Y}" r="5.2" fill="${p.outline}"/><circle cx="50" cy="${GRIP_Y}" r="3.6" fill="${p.sock}"/>`;
    }
    return s;
  }

  /**
   * Original jointed hero ("Boltling"). Pose-agnostic: returns one upright figure
   * with each limb in its own <g> so the content script animates the run/climb/boost
   * cycles in CSS. The thread attaches to the hook on his helmet at (50, GRIP_Y).
   */
  function boltMarkup(p, uid) {
    const O = p.outline;
    // Underlaid outline + coloured stroke, the look used for the vector character's legs.
    const limb = (d, col, w) =>
      `<path d="${d}" fill="none" stroke="${O}" stroke-width="${w + 3}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
    const boot = (x, y) =>
      `<ellipse cx="${x}" cy="${y}" rx="5.4" ry="4.2" fill="${O}"/>` +
      `<ellipse cx="${x}" cy="${y - 0.4}" rx="4" ry="3" fill="${p.amber}"/>`;
    const hand = (x, y) =>
      `<circle cx="${x}" cy="${y}" r="4.3" fill="${O}"/><circle cx="${x}" cy="${y}" r="3" fill="${p.metal}"/>`;
    const flame = (x, y) =>
      `<path d="M${x - 4} ${y} Q${x} ${y + 3} ${x} ${y + 15} Q${x} ${y + 3} ${x + 4} ${y} Q${x} ${y + 6} ${x - 4} ${y} z" fill="${p.amber}"/>` +
      `<path d="M${x - 2.2} ${y + 1} Q${x} ${y + 4} ${x} ${y + 9} Q${x} ${y + 4} ${x + 2.2} ${y + 1} Q${x} ${y + 5} ${x - 2.2} ${y + 1} z" fill="#fff6d0"/>`;

    return `<defs>
        <radialGradient id="wb-torso-${uid}" cx="40%" cy="28%" r="80%">
          <stop offset="0" stop-color="${p.steelLight}"/><stop offset="0.6" stop-color="${p.steel}"/><stop offset="1" stop-color="${p.steelShade}"/>
        </radialGradient>
        <radialGradient id="wb-core-${uid}" cx="50%" cy="50%" r="60%">
          <stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="${p.core}"/><stop offset="1" stop-color="${p.amberShade}"/>
        </radialGradient>
      </defs>
      <!-- thread hook on top of the helmet -->
      <path d="M50 ${GRIP_Y} V22" stroke="${p.metal}" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="50" cy="${GRIP_Y + 1}" r="3.2" fill="none" stroke="${p.metal}" stroke-width="2.2"/>

      <!-- jet exhaust (hidden until boosting) -->
      <g class="bolt-jet bolt-jet-l">${flame(42, 106)}</g>
      <g class="bolt-jet bolt-jet-r">${flame(58, 106)}</g>

      <!-- back arm -->
      <g class="bolt-arm bolt-arm-l">${limb('M37 57 Q31 67 31 77', p.steelShade, 5)}${hand(31, 77)}</g>

      <!-- legs -->
      <g class="bolt-leg bolt-leg-l">${limb('M45 82 Q43 93 42 102', p.steel, 6)}${boot(42, 104)}</g>
      <g class="bolt-leg bolt-leg-r">${limb('M55 82 Q57 93 58 102', p.steel, 6)}${boot(58, 104)}</g>

      <!-- torso -->
      <g class="bolt-torso">
        <ellipse cx="50" cy="70" rx="19" ry="20.5" fill="${O}"/>
        <ellipse cx="50" cy="70" rx="17" ry="18.5" fill="url(#wb-torso-${uid})"/>
        <path d="M50 53 V88" stroke="${p.steelShade}" stroke-width="1.4" opacity="0.5"/>
        <path d="M33 66 Q50 60 67 66" fill="none" stroke="${p.amber}" stroke-width="3" stroke-linecap="round"/>
        <circle cx="50" cy="72" r="6.4" fill="${O}"/>
        <circle cx="50" cy="72" r="4.8" fill="url(#wb-core-${uid})"/>
        <ellipse cx="44" cy="62" rx="4" ry="2.4" fill="#ffffff" opacity="0.3" transform="rotate(-24 44 62)"/>
      </g>

      <!-- front arm -->
      <g class="bolt-arm bolt-arm-r">${limb('M63 57 Q69 67 69 77', p.steel, 5)}${hand(69, 77)}</g>

      <!-- head / helmet -->
      <g class="bolt-head">
        <path d="M50 22 Q46 24 47 30 L53 30 Q54 24 50 22 z" fill="${p.amber}" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"/>
        <ellipse cx="50" cy="40" rx="16.5" ry="15.5" fill="${O}"/>
        <ellipse cx="50" cy="40" rx="14.8" ry="13.8" fill="url(#wb-torso-${uid})"/>
        <path d="M37 40 Q50 33 63 40 Q50 36 37 40 z" fill="${p.steelLight}" opacity="0.6"/>
        <path d="M39 42 Q50 38 61 42 L60 47 Q50 52 40 47 z" fill="${p.visorDark}" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M41 43.4 Q50 40.4 59 43.4 L58.4 45.6 Q50 43 41.6 45.6 z" fill="${p.visor}"/>
        <path d="M43 44 Q50 42 57 44" stroke="#ffffff" stroke-width="1" opacity="0.8" stroke-linecap="round" fill="none"/>
        <circle cx="34.5" cy="40" r="2.6" fill="${p.metal}" stroke="${O}" stroke-width="1.2"/>
        <circle cx="65.5" cy="40" r="2.6" fill="${p.metal}" stroke="${O}" stroke-width="1.2"/>
      </g>`;
  }

  /** Pixel-art frame: the sprite hangs from the grip point, its grip column on x = 50. */
  function spriteMarkup(name, p) {
    const [key, gripX, mirror] = p.sprites[name] || p.sprites.idle;
    const art = (root.WeblingPixels || {})[key];
    if (!art) return '';
    const scale = (125 - GRIP_Y) / 144; // tallest sprite fills grip → bottom; same scale for every pose
    const w = art.w * scale;
    // Mirroring flips the art around its own grip column, which stays on x = 50.
    const x = mirror ? 50 + gripX * w : 50 - gripX * w;
    const paths = art.paths.map(([c, d]) => `<path fill="#${c}" d="${d}"/>`).join('');
    return `<g transform="translate(${x.toFixed(2)} ${GRIP_Y}) scale(${(mirror ? -scale : scale).toFixed(4)} ${scale.toFixed(4)})" shape-rendering="crispEdges">${paths}</g>`;
  }

  function frameSvg(name, paletteName = 'classic', { uid = '', acc = '', className = '', size = null, viewBox = '0 0 100 125' } = {}) {
    const p = PALETTES[paletteName] || PALETTES.classic;
    const id = uid || `${paletteName}-${name}`;
    const dims = size ? ` width="${size}" height="${Math.round(size * 1.25)}"` : '';
    const cls = className ? ` class="${className}"` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${dims}${cls} aria-hidden="true" focusable="false">${frameMarkup(name, p, id, acc)}</svg>`;
  }

  /** Horizontal strip of all frames (for previews / store art). */
  function stripSvg(paletteName = 'classic', acc = '') {
    const p = PALETTES[paletteName] || PALETTES.classic;
    const parts = FRAMES.map((f, i) => `<g transform="translate(${i * 100} 0)">${frameMarkup(f, p, `${paletteName}-s${i}`, acc)}</g>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAMES.length * 100} 125" width="${FRAMES.length * 200}" height="250">${parts.join('')}</svg>`;
  }

  // ---------------------------------------------------------------------------
  // Toolbar / store icon
  // ---------------------------------------------------------------------------

  /**
   * App icon. Sizes ≤ 32 use a simplified, high-contrast face so the
   * character still reads at 16px.
   */
  function iconSvg(size = 128, paletteName = 'classic') {
    const p = PALETTES[paletteName] || PALETTES.classic;
    if (size <= 48) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">
        <defs><radialGradient id="ib" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="${p.light}"/><stop offset="1" stop-color="${p.body}"/></radialGradient></defs>
        <path d="M16 0 V7" stroke="${p.outline}" stroke-width="2"/>
        <circle cx="16" cy="18.5" r="13" fill="${p.outline}"/>
        <circle cx="16" cy="18.5" r="11.4" fill="url(#ib)"/>
        <path d="M5.6 13.4 Q16 9 26.4 13.4 L26.4 16.4 Q16 12 5.6 16.4 Z" fill="${p.band}"/>
        <circle cx="11.6" cy="20.6" r="4" fill="#fff"/><circle cx="20.4" cy="20.6" r="4" fill="#fff"/>
        <circle cx="12.3" cy="21" r="2.3" fill="${p.pupil}"/><circle cx="21.1" cy="21" r="2.3" fill="${p.pupil}"/>
        <circle cx="11.6" cy="20" r=".9" fill="#fff"/><circle cx="20.4" cy="20" r=".9" fill="#fff"/>
      </svg>`;
    }
    // Full character, centred with ~12% padding as recommended for store icons.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -8 128 128" width="${size}" height="${size}">
      <path d="M50 -8 V15" stroke="${p.outline}" stroke-width="3" stroke-linecap="round"/>
      ${frameMarkup('idle', p, `icon-${size}`)}
    </svg>`;
  }

  // ---------------------------------------------------------------------------
  // Baby spider (rescue mini-game)
  // ---------------------------------------------------------------------------

  function babySpiderSvg(size = 30) {
    const o = '#2e1f4f';
    const legs = [
      'M10 13 Q4 9 2 13', 'M10 16 Q3 16 2 20', 'M11 19 Q5 23 4 27', 'M12 21 Q9 26 9 29',
    ];
    const legPaths = legs.map((d) => `<path d="${d}" fill="none" stroke="${o}" stroke-width="1.8" stroke-linecap="round"/>` +
      `<path d="${mirrorSmall(d)}" fill="none" stroke="${o}" stroke-width="1.8" stroke-linecap="round"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" width="${size}" height="${size}" aria-hidden="true" focusable="false">
      <path d="M15 0 V8" stroke="#ffffff" stroke-width="1.4" opacity="0.9"/>
      ${legPaths}
      <ellipse cx="15" cy="17" rx="8" ry="7.4" fill="${o}"/>
      <ellipse cx="15" cy="17" rx="6.6" ry="6" fill="#c7a8ff"/>
      <circle cx="12.4" cy="17" r="2.2" fill="#fff"/><circle cx="17.6" cy="17" r="2.2" fill="#fff"/>
      <circle cx="12.6" cy="17.4" r="1.2" fill="${o}"/><circle cx="17.8" cy="17.4" r="1.2" fill="${o}"/>
      <path d="M13.2 20.6 Q15 19.6 16.8 20.6" fill="none" stroke="${o}" stroke-width="1" stroke-linecap="round"/>
      <path d="M20.6 14.4 q1.4 2 0 3 q-1.4 -1 0 -3z" fill="#8fd8ff"/>
    </svg>`;
  }

  function mirrorSmall(d) {
    return d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${30 - Number(x)} ${y}`);
  }

  root.WeblingSprite = Object.freeze({
    PALETTES,
    FRAMES,
    GRIP_Y,
    GRIP_RATIO: GRIP_Y / 125,
    frameMarkup,
    frameSvg,
    stripSvg,
    iconSvg,
    babySpiderSvg,
  });
})(globalThis);

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
      articulated: true, kind: 'flyer', power: 'beam',
      steel: '#c7312f', steelLight: '#f36a52', steelShade: '#8e1a1f', outline: '#2a0708',
      amber: '#ffcf4d', amberShade: '#d99f26', visor: '#aef2ff', visorDark: '#0c3a4b',
      metal: '#e8b84a', core: '#ffe08a', suit: '#24262e', suitLight: '#3c414e',
    },
    // Second flyer — crimson/white winged hero, same jointed rig as Boltling.
    nova: {
      articulated: true, kind: 'flyer', power: 'nova', wings: true,
      steel: '#7b3fd0', steelLight: '#a978f0', steelShade: '#521f99', outline: '#1c0a38',
      amber: '#ffd24a', amberShade: '#d9a62a', visor: '#8ef0ff', visorDark: '#0c3a4b',
      metal: '#e4d8f7', core: '#d7a0ff', suit: '#22192f', suitLight: '#3d2f55',
    },
    // Brute — an original rock golem with glowing lava cracks. Leaps and ground-pounds.
    smash: {
      articulated: true, kind: 'brute', power: 'pound',
      rock: '#4e8f4a', rockLight: '#7cc471', rockShade: '#356336', outline: '#122a12',
      crack: '#ff7a2c', crackLight: '#ffd36b', metal: '#9ab98c',
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
    if (p.articulated) return p.kind === 'brute' ? bruteMarkup(p, uid) : heroMarkup(p, uid);
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

  // ---------------------------------------------------------------------------
  // Jointed heroes (Boltling / Nova / Rumble)
  // ---------------------------------------------------------------------------
  //
  // Every jointed hero shares one rig, so a single pose library animates them all:
  //   .j-body (waist) → .j-head (neck), .j-sho-* (shoulder) → .j-elb-* (elbow)
  //   .j-hip-* (hip) → .j-knee-* (knee) → .jet (boot nozzle, flyers only)
  // Each joint is a <g> whose transform-origin is its pivot in viewBox units; the
  // content script rotates joints per pose. The rest pose faces right; "-l" limbs
  // are the far side (drawn first and darker), "-r" the near side.
  // The thread grip is unused: only Spider-Man travels on a web line.

  const r2 = (n) => Math.round(n * 100) / 100;

  /** Tapered capsule from (x1, y1) to (x2, y2), width w1 → w2. */
  function seg(x1, y1, x2, y2, w1, w2) {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    const pt = (x, y, w, s) => `${r2(x + (nx * w * s) / 2)} ${r2(y + (ny * w * s) / 2)}`;
    return `M${pt(x1, y1, w1, 1)} L${pt(x2, y2, w2, 1)} A${r2(w2 / 2)} ${r2(w2 / 2)} 0 0 0 ${pt(x2, y2, w2, -1)}`
      + ` L${pt(x1, y1, w1, -1)} A${r2(w1 / 2)} ${r2(w1 / 2)} 0 0 0 ${pt(x1, y1, w1, 1)} Z`;
  }

  /**
   * A joint: rotates its contents about (x, y). `rest` is the relaxed angle used
   * wherever no pose styles are loaded (popup, onboarding, icons); the content
   * script's pose CSS overrides it on the page.
   */
  const joint = (name, x, y, inner, rest = 0) =>
    `<g class="j j-${name}" style="transform-origin:${x}px ${y}px"${rest ? ` transform="rotate(${rest})"` : ''}>${inner}</g>`;

  /** Relaxed standing angles (degrees, clockwise) for each rig. */
  const REST = {
    flyer: { 'hip-l': 4, 'knee-l': 14, 'hip-r': -6, 'knee-r': 24, 'sho-l': 8, 'elb-l': -16, 'sho-r': -4, 'elb-r': -22 },
    brute: { body: 5, 'hip-l': -8, 'knee-l': 16, 'hip-r': -4, 'knee-r': 14, 'sho-l': -4, 'elb-l': -12, 'sho-r': -8, 'elb-r': -16 },
  };

  /** Filled, outlined path in the rig's line style. */
  const part = (O, d, fill, w = 1.4) => `<path d="${d}" fill="${fill}" stroke="${O}" stroke-width="${w}" stroke-linejoin="round"/>`;

  const lin = (id, stops, vertical = false) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">`
    + stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')
    + '</linearGradient>';
  const rad = (id, stops) =>
    `<radialGradient id="${id}" cx="36%" cy="26%" r="88%">`
    + stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')
    + '</radialGradient>';

  /**
   * Armoured flyer — Boltling (red/gold, swept crest, lightning emblem) and Nova
   * (purple, temple fins, star emblem, swept wings). Dark undersuit under armour
   * plates, light from the upper left with a rim light on the right edge, steady
   * jet cones at the boot nozzles (scaled by the content script's --thrust).
   */
  function heroMarkup(p, uid) {
    const O = p.outline;
    const nova = p.power === 'nova';
    const A = `url(#a-${uid})`;
    const AF = `url(#af-${uid})`;
    const S = `url(#s-${uid})`;
    const SF = `url(#sf-${uid})`;
    const T = `url(#t-${uid})`;
    const C = `url(#c-${uid})`;
    const J = (n, x, y, inner) => joint(n, x, y, inner, REST.flyer[n]);

    const leg = (side, x) => {
      const far = side === 'l';
      const armor = far ? AF : A;
      const knee = 98;
      const sole = 119.6;
      const flame = `<g class="jet" style="transform-origin:${x}px ${sole}px" opacity="0">`
        + `<path d="M${x - 3.4} ${sole} C${x - 3.9} 126 ${x - 1.3} 134 ${x} 141 C${x + 1.3} 134 ${x + 3.9} 126 ${x + 3.4} ${sole} Z" fill="url(#fl-${uid})"/>`
        + `<path class="flame-core" d="M${x - 1.7} ${sole} C${x - 1.9} 124 ${x - 0.6} 128.5 ${x} 132 C${x + 0.6} 128.5 ${x + 1.9} 124 ${x + 1.7} ${sole} Z" fill="#f2fcff"/>`
        + '</g>';
      const boot = part(O, `M${x - 4.4} 107.6 L${x + 4.6} 107.6 L${x + 5.6} 116 C${x + 5.8} 118.6 ${x + 4.8} ${sole} ${x + 3} ${sole} L${x - 3.4} ${sole} C${x - 5} ${sole} ${x - 5.6} 118.4 ${x - 5.2} 116.6 Z`, armor)
        + `<path d="M${x - 5.2} 116.2 H${x + 5.6}" stroke="${p.amber}" stroke-width="1.5"/>`
        + `<ellipse cx="${x}" cy="${sole}" rx="2.9" ry="1.1" fill="${p.metal}" stroke="${O}" stroke-width=".8"/>`;
      const shin = part(O, seg(x, knee, x, 109.5, 6.8, 5.8), armor) + boot
        + part(O, `M${x - 2.4} ${knee - 2.8} L${x + 3.4} ${knee - 3.2} L${x + 4.2} ${knee + 1.4} L${x + 0.4} ${knee + 3.4} L${x - 2.2} ${knee + 1.8} Z`, T, 1)
        + `<circle class="jet-nz" cx="${x}" cy="124" r=".6" fill="none"/>`;
      const thigh = part(O, seg(x, 84, x, knee, 8.6, 6.8), far ? SF : S)
        + part(O, seg(x + 0.9, 86.6, x + 0.7, 95, 5.6, 4.6), armor, 1.1);
      return J(`hip-${side}`, x, 84, thigh + J(`knee-${side}`, x, knee, flame + shin));
    };

    const arm = (side, x) => {
      const far = side === 'l';
      const armor = far ? AF : A;
      const sy = 52;
      const ex = x + (far ? -1 : 1);
      const ey = 64.5;
      const hy = 77.6;
      const fist = part(O, `M${ex - 3.9} ${hy - 3} Q${ex - 4.3} ${hy + 3.6} ${ex} ${hy + 4} Q${ex + 4.4} ${hy + 3.8} ${ex + 4} ${hy - 2.6} Q${ex} ${hy - 4.6} ${ex - 3.9} ${hy - 3} Z`, armor)
        + `<path d="M${ex - 2.6} ${hy + 0.4} Q${ex} ${hy + 1.4} ${ex + 2.8} ${hy + 0.6}" stroke="${O}" stroke-width=".7" fill="none" opacity=".6"/>`;
      const fore = part(O, seg(ex, ey, ex, hy - 3, 5.6, 6.6), armor)
        + `<path d="M${ex - 3.3} ${hy - 5} H${ex + 3.3}" stroke="${p.amber}" stroke-width="1.5" stroke-linecap="round"/>` + fist;
      const upper = part(O, seg(x, sy + 1, ex, ey, 6.2, 5.4), far ? SF : S);
      const pauldron = part(O, `M${x - 6} ${sy + 2.5} C${x - 6.4} ${sy - 4} ${x - 2} ${sy - 6} ${x + 1} ${sy - 5.6} C${x + 5} ${sy - 5} ${x + 6.6} ${sy - 1.6} ${x + 5.6} ${sy + 3} C${x + 2} ${sy + 4.6} ${x - 3} ${sy + 4.8} ${x - 6} ${sy + 2.5} Z`, armor)
        + `<path d="M${x - 5} ${sy + 2.2} C${x - 1} ${sy + 3.6} ${x + 2.5} ${sy + 3.4} ${x + 5.2} ${sy + 2.4}" stroke="${p.amber}" stroke-width="1.3" fill="none"/>`;
      return J(`sho-${side}`, x, sy, upper + J(`elb-${side}`, ex, ey, fore) + pauldron);
    };

    // Swept wings grow from the back (left, since he faces right); the near wing is larger and lighter.
    const wing = (side, px, py, k, fill) => {
      const X = (d) => r2(px - d * k);
      const Y = (d) => r2(py + d * k);
      return J(`wing-${side}`, px, py,
        part(O, `M${X(0)} ${Y(0)} L${X(27)} ${Y(-13)} L${X(21)} ${Y(-3.5)} L${X(31)} ${Y(1)} L${X(19)} ${Y(5.5)} L${X(24)} ${Y(13)} L${X(2)} ${Y(9)} Z`, fill)
        + `<path d="M${X(2)} ${Y(2)} L${X(22)} ${Y(-7)}" stroke="${p.amber}" stroke-width="1.2" stroke-linecap="round"/>`);
    };

    const emblem = nova
      ? `<path d="M50 51.2 L51.6 55.6 L56 57.2 L51.6 58.8 L50 63.2 L48.4 58.8 L44 57.2 L48.4 55.6 Z" fill="${T}" stroke="${O}" stroke-width=".9" stroke-linejoin="round"/>`
      : `<path d="M52.4 50.8 L46.4 58.6 L50.2 58.6 L47.8 64.6 L54.4 55.8 L50.6 55.8 L53.2 50.8 Z" fill="${T}" stroke="${O}" stroke-width=".9" stroke-linejoin="round"/>`;

    const chest = '<g class="chest">'
      + part(O, 'M42.6 75.5 L57.4 75.5 L57 82.6 L43 82.6 Z', S)
      + `<path d="M44.4 78.6 H55.6" stroke="${p.suitLight}" stroke-width=".8" opacity=".7"/>`
      + part(O, 'M33.6 49.4 C40 46.4 60 46.4 66.4 49.4 L65 60.2 C63 69 58.8 74.6 55.6 77 L44.4 77 C41.2 74.6 37 69 35 60.2 Z', C)
      + `<path d="M39.6 58.6 C45 61.6 55 61.6 60.4 58.6" stroke="${p.steelShade}" stroke-width="1" fill="none" opacity=".6"/>`
      + `<path d="M44.6 70.4 L50 72.6 L55.4 70.4" stroke="${p.steelShade}" stroke-width=".9" fill="none" opacity=".5"/>`
      + `<path d="M64.6 51.4 L63.4 60.6 C62 67 59.6 71.6 57.4 74.2" stroke="${p.steelLight}" stroke-width="1.1" fill="none" opacity=".55" stroke-linecap="round"/>`
      + '<ellipse cx="41.4" cy="53.4" rx="3.6" ry="1.7" fill="#fff" opacity=".28" transform="rotate(-18 41.4 53.4)"/>'
      + emblem
      + part(O, 'M41.8 80.6 L58.2 80.6 L58.6 84.4 L41.4 84.4 Z', T, 1)
      + `<rect x="48" y="80.4" width="4" height="4.2" rx=".8" fill="${p.amberShade}" stroke="${O}" stroke-width=".8"/>`
      + '</g>';

    const crest = nova
      ? part(O, 'M43.6 24.6 L33.4 17.4 L36.2 21.8 L31.6 21.6 L41.6 29.4 Z', T, 1.1)
      : part(O, 'M47 17.6 L36.4 10.8 L40.2 20.6 Z', T, 1.1);
    const head = J('head', 50, 46,
      crest
      + part(O, 'M37.6 31 C37.6 21.4 43 16.6 50.6 16.6 C58.6 16.6 63.6 22 63.6 30 L62.7 37.6 C61.7 42 57.6 45 52.6 45 L46 45 C40.6 44.6 37.6 40.2 37.6 34.2 Z', C)
      + `<path d="M60 19.6 C62.8 22.2 63.6 26 63.4 30" stroke="${p.steelLight}" stroke-width="1.2" fill="none" opacity=".6" stroke-linecap="round"/>`
      + `<path d="M47.2 37.8 L62.2 36.4 L61.6 39.8 C59.2 43 55.4 44.2 52.4 44.2 L48.2 43.8 Z" fill="${p.steelShade}" opacity=".45"/>`
      + `<circle cx="43.8" cy="31.8" r="2.9" fill="${p.metal}" stroke="${O}" stroke-width="1"/><circle cx="43.8" cy="31.8" r="1.1" fill="${p.amberShade}"/>`
      + part(O, 'M48.4 26.4 L63.4 25.4 L63 32.6 C58.4 34 52.4 34.3 49 33.5 Z', `url(#v-${uid})`, 1.1)
      + '<path d="M50.2 27.6 L61.8 26.9" stroke="#fff" stroke-width=".9" opacity=".85" stroke-linecap="round"/>');

    const defs = '<defs>'
      + lin(`a-${uid}`, [[0, p.steelLight], [0.45, p.steel], [1, p.steelShade]])
      + lin(`af-${uid}`, [[0, p.steel], [0.55, p.steelShade], [1, p.steelShade]])
      + lin(`s-${uid}`, [[0, p.suitLight], [0.5, p.suit], [1, p.suit]])
      + lin(`sf-${uid}`, [[0, p.suit], [1, p.suit]])
      + lin(`t-${uid}`, [[0, '#fff4c8'], [0.3, p.amber], [1, p.amberShade]], true)
      + lin(`v-${uid}`, [[0, '#ffffff'], [0.35, p.visor], [1, p.visorDark]], true)
      + lin(`fl-${uid}`, [[0, '#fffbea'], [0.22, '#ffe08a'], [0.55, '#ff9a3c'], [1, '#ff5028', 0]], true)
      + lin(`w-${uid}`, [[0, p.metal], [0.6, p.steelLight], [1, p.steel]])
      + lin(`wf-${uid}`, [[0, p.steelLight], [1, p.steelShade]])
      + rad(`c-${uid}`, [[0, p.steelLight], [0.55, p.steel], [1, p.steelShade]])
      + '</defs>';

    const body = J('body', 50, 82,
      (nova ? wing('l', 45, 56, 0.86, `url(#wf-${uid})`) + wing('r', 46, 53, 1, `url(#w-${uid})`) : '')
      + arm('l', 36)
      + `<rect x="46.2" y="42.5" width="7.6" height="6.5" rx="2" fill="${S}" stroke="${O}" stroke-width="1.4"/>`
      + chest
      + head
      + arm('r', 64));

    return defs
      + leg('l', 45)
      + leg('r', 55)
      + part(O, 'M42 82.5 L58 82.5 L59.4 88 C55 90.6 45 90.6 40.6 88 Z', S)
      + body;
  }

  /**
   * Rock-golem brute — Rumble. Same rig as the flyers, built heavy: a hunched
   * slab torso, boulder shoulders, long arms with oversized fists, short thick
   * legs, a small sunken head with glowing eyes, and lava cracks. No jets.
   */
  function bruteMarkup(p, uid) {
    const O = p.outline;
    const R = `url(#r-${uid})`;
    const RF = `url(#rf-${uid})`;
    const RC = `url(#rc-${uid})`;
    const J = (n, x, y, inner) => joint(n, x, y, inner, REST.brute[n]);
    const crack = (d) =>
      `<path d="${d}" stroke="${p.crack}" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<path d="${d}" stroke="${p.crackLight}" stroke-width=".7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

    const leg = (side, x) => {
      const rock = side === 'l' ? RF : R;
      const foot = part(O, `M${x - 8} 109.6 L${x + 7} 109.4 L${x + 8.6} 116.4 C${x + 8.8} 118.8 ${x + 7.4} 119.8 ${x + 5} 119.8 L${x - 6.4} 119.8 C${x - 8.4} 119.8 ${x - 9.2} 118.4 ${x - 8.8} 116.6 Z`, rock)
        + `<path d="M${x - 3} 116 L${x - 2.4} 119.6 M${x + 2.6} 116 L${x + 3} 119.6" stroke="${O}" stroke-width=".8" opacity=".6"/>`;
      const shin = part(O, seg(x, 100, x, 110, 10.6, 11.6), rock) + foot;
      const thigh = part(O, seg(x, 89, x, 100, 12.4, 10.6), rock);
      return J(`hip-${side}`, x, 89, thigh + J(`knee-${side}`, x, 100, shin));
    };

    const arm = (side, x) => {
      const far = side === 'l';
      const rock = far ? RF : R;
      const s = far ? -1 : 1;
      const sy = 53;
      const ex = x + s * 2;
      const ey = 69;
      const hx = x + s * 1.5;
      const hy = 88;
      const fist = part(O, `M${hx - 7.6} ${hy - 4.4} C${hx - 8.6} ${hy + 4} ${hx - 4} ${hy + 8.2} ${hx + 1} ${hy + 8} C${hx + 6.6} ${hy + 7.6} ${hx + 8.6} ${hy + 2.6} ${hx + 7.6} ${hy - 4.2} C${hx + 3} ${hy - 7.4} ${hx - 3.6} ${hy - 7.6} ${hx - 7.6} ${hy - 4.4} Z`, rock)
        + `<path d="M${hx - 5} ${hy + 1.2} Q${hx} ${hy + 2.8} ${hx + 5} ${hy + 1.4}" stroke="${O}" stroke-width=".9" fill="none" opacity=".55"/>`;
      const fore = part(O, seg(ex, ey, hx, hy - 5, 10, 12.4), rock)
        + crack(`M${ex - s} ${ey + 4} L${ex + s * 1.4} ${ey + 8} L${ex - s * 0.6} ${ey + 12}`) + fist;
      const upper = part(O, seg(x, sy + 2, ex, ey, 11.4, 9.8), rock);
      const boulder = part(O, `M${x - 9.6} ${sy + 3} C${x - 10.4} ${sy - 5} ${x - 4} ${sy - 9.6} ${x + 1.4} ${sy - 9.2} C${x + 7.6} ${sy - 8.6} ${x + 10.4} ${sy - 3.4} ${x + 9.2} ${sy + 3.6} C${x + 4} ${sy + 6.6} ${x - 4} ${sy + 6.8} ${x - 9.6} ${sy + 3} Z`, rock)
        + `<path d="M${x - 6} ${sy - 3} L${x - 1} ${sy - 5.4} L${x + 4} ${sy - 3.6}" stroke="${p.rockShade}" stroke-width=".9" fill="none" opacity=".7"/>`;
      return J(`sho-${side}`, x, sy, upper + J(`elb-${side}`, ex, ey, fore) + boulder);
    };

    const chest = '<g class="chest">'
      + part(O, 'M23 51 C30 42.4 70 42.4 77 51 L79.4 64.4 C78 78.4 67.6 88.6 50 89.4 C32.4 88.6 22 78.4 20.6 64.4 Z', RC)
      + `<path d="M33 52.6 L50 57.4 L67 52.6 M50 57.4 L50 72 M36 72 H64" stroke="${p.rockShade}" stroke-width="1" fill="none" opacity=".6"/>`
      + crack('M40.6 59.4 L44.2 65.6 L41.4 71.4 L45.4 78')
      + crack('M59.6 58 L56.2 64.6 L60 69.8')
      + `<path d="M76.6 52.6 L78.6 64.4 C77.6 74 72.8 81.4 66 85.6" stroke="${p.rockLight}" stroke-width="1.2" fill="none" opacity=".5" stroke-linecap="round"/>`
      + '<ellipse cx="36" cy="54.6" rx="4.6" ry="2" fill="#fff" opacity=".2" transform="rotate(-16 36 54.6)"/>'
      + '</g>';

    const head = J('head', 50, 46,
      part(O, 'M39.6 37 C39.6 27.4 44.6 23 50.6 23 C57 23 61.4 27.8 61.4 35 L60.6 40.6 C59 44.6 55 46.6 50.4 46.6 C45.4 46.6 41.4 44 40 40 Z', RC)
      + part(O, 'M41.6 31.6 L59.6 30.6 L59 34 C55 33.6 46 34.2 42.4 35 Z', p.rockShade, 1)
      + `<ellipse cx="47.6" cy="35.8" rx="3" ry="1.8" fill="${p.crack}" opacity=".4"/><ellipse cx="55.4" cy="35.4" rx="3" ry="1.8" fill="${p.crack}" opacity=".4"/>`
      + `<path d="M45.6 35.6 L49.6 35.2 L49.4 36.6 L45.8 37 Z M53.4 35 L57.6 34.6 L57.4 36 L53.6 36.4 Z" fill="${p.crackLight}"/>`
      + `<path d="M44.4 42 Q50.6 43.8 57 41.6" stroke="${p.rockShade}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`
      + crack('M58.4 37.6 L56.6 40.4'));

    const defs = '<defs>'
      + lin(`r-${uid}`, [[0, p.rockLight], [0.5, p.rock], [1, p.rockShade]])
      + lin(`rf-${uid}`, [[0, p.rock], [1, p.rockShade]])
      + rad(`rc-${uid}`, [[0, p.rockLight], [0.55, p.rock], [1, p.rockShade]])
      + '</defs>';

    return defs
      + leg('l', 42)
      + leg('r', 58)
      + part(O, 'M37 85 L63 85 L65 92.4 C58.4 95.6 41.6 95.6 35 92.4 Z', RF)
      + J('body', 50, 86, arm('l', 27) + chest + head + arm('r', 73));
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

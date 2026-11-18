// Hand-inked poker elements — parametric, deterministic SVG string generators.
// No dependencies. Every generator is pure: same input => byte-identical SVG.
//
// Usage:
//   document.body.insertAdjacentHTML('afterbegin', sharedDefsSVG()); // once per page
//   el.innerHTML = cardSVG({ rank: 'Q', suit: 'H' });
//   el.innerHTML = chipSVG({ value: 25 });
//   el.innerHTML = chipStackSVG({ values: [5, 5, 25, 100] });
//
// Generated SVGs reference patterns/symbols from sharedDefsSVG() by id
// (pk-*). Pass { standalone: true } to embed the defs inside a single SVG
// (e.g. for <img src="data:..."> or exporting); otherwise mount the shared
// defs once and keep per-element markup small.

// ---------------------------------------------------------------- palette
export const INK = '#231a13';
const PAPER = '#fbf5e6';
const RED = '#c2342a';
const BLACK = '#1f1a16';
const GOLD = '#e2ad3b';
const BLUE = '#2f5b98';
const SKIN = '#f4dcb9';
const STEEL = '#dde1e3';
const WOOD = '#8a5a32';
const INDEX_FONT = "'Baskerville','Hoefler Text','Georgia',serif";
const CHIP_FONT = "'Marker Felt','Chalkboard SE','Comic Sans MS',cursive";

export const CHIP_COLORS = {
  1: { body: '#efe8d8', spot: '#2f5b98', text: '#2f5b98', spots: 6 },
  5: { body: '#c2342a', spot: '#f6f0e2', text: '#a3261e', spots: 6 },
  10: { body: '#2f5b98', spot: '#f6f0e2', text: '#24497d', spots: 6 },
  25: { body: '#2e8049', spot: '#f6f0e2', text: '#226a3a', spots: 8 },
  100: { body: '#25211d', spot: '#f6f0e2', text: '#25211d', spots: 8 },
  500: { body: '#6c3f99', spot: '#f6f0e2', text: '#5a3283', spots: 8 },
  1000: { body: '#eaa42a', spot: '#2a211a', text: '#7a4a10', spots: 8 },
};

// ---------------------------------------------------------------- utils
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// mulberry32 — tiny seeded PRNG
function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashStr(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n) => (Math.round(n * 10) / 10).toString();
const rad = (deg) => (deg * Math.PI) / 180;

function shade(hex, k) { // k<1 darker, k>1 lighter
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(k < 1 ? c * k : c + (255 - c) * (k - 1)))));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

// closed Catmull-Rom spline -> cubic bezier path
function closedSpline(pts) {
  const n = pts.length;
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + 'Z';
}

// hand-drawn ellipse: low-frequency radial wobble + tiny per-point tremor
function wobblyEllipse(cx, cy, rx, ry, R, amp = 0.6, n = 26) {
  const p1 = R() * 6.283, p2 = R() * 6.283, a1 = amp * (0.5 + R() * 0.5);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = a1 * Math.sin(a * 2 + p1) + amp * 0.5 * Math.sin(a * 3 + p2) + (R() - 0.5) * amp * 0.5;
    pts.push([cx + (rx + w) * Math.cos(a), cy + (ry + w * (ry / rx)) * Math.sin(a)]);
  }
  return closedSpline(pts);
}
const wobblyCircle = (cx, cy, r, R, amp, n) => wobblyEllipse(cx, cy, r, r, R, amp, n);

function wobblyRRect(x, y, w, h, r, R, amp = 0.7, step = 26) {
  const pts = [];
  const edge = (x0, y0, x1, y1) => {
    const k = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let i = 0; i < k; i++) pts.push([x0 + ((x1 - x0) * i) / k, y0 + ((y1 - y0) * i) / k, 1]);
  };
  const corner = (cx, cy, a0) => {
    for (let i = 0; i < 3; i++) { const a = a0 + (i * Math.PI) / 6; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), 0.4]); }
  };
  edge(x + r, y, x + w - r, y); corner(x + w - r, y + r, -Math.PI / 2);
  edge(x + w, y + r, x + w, y + h - r); corner(x + w - r, y + h - r, 0);
  edge(x + w - r, y + h, x + r, y + h); corner(x + r, y + h - r, Math.PI / 2);
  edge(x, y + h - r, x, y + r); corner(x + r, y + r, Math.PI);
  return closedSpline(pts.map(([px, py, k]) => [px + (R() - 0.5) * 2 * amp * k, py + (R() - 0.5) * 2 * amp * k]));
}

// jitter every coordinate of an absolute path (M/L/C/Q/Z only) — bakes a hand wobble
const jit = (d, R, amt) => d.replace(/-?\d*\.?\d+/g, (m) => f(parseFloat(m) + (R() - 0.5) * 2 * amt));

const circ = (cx, cy, r) => `M${f(cx - r)},${f(cy)}A${r},${r} 0 1 0 ${f(cx + r)},${f(cy)}A${r},${r} 0 1 0 ${f(cx - r)},${f(cy)}Z`;
const ink = (d, w = 1.6, extra = '') =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
// outline + second, lighter "sketch pass" offset slightly — the inked look
const sketchOutline = (d1, d2, w = 2) => ink(d1, w) + ink(d2, w * 0.45, ' opacity=".45"');

function memo(fn) {
  const cache = new Map();
  return (opts = {}) => {
    const key = JSON.stringify(opts);
    let v = cache.get(key);
    if (v === undefined) { v = fn(opts); cache.set(key, v); }
    return v;
  };
}

// ---------------------------------------------------------------- suits (100x100 box)
const SUIT_PATHS = {
  H: 'M50,88 C41,77 8,59 8,34 C8,18 20,9 32,9 C41,9 47,15 50,24 C53,15 59,9 68,9 C80,9 92,18 92,34 C92,59 59,77 50,88 Z',
  D: 'M50,4 C59,21 71,37 85,50 C71,63 59,79 50,96 C41,79 29,63 15,50 C29,37 41,21 50,4 Z',
  S: 'M50,5 C61,22 92,37 92,60 C92,74 81,82 70,82 C62,82 56,78 53,72 C54,82 58,90 67,95 L33,95 C42,90 46,82 47,72 C44,78 38,82 30,82 C19,82 8,74 8,60 C8,37 39,22 50,5 Z',
  C: circ(50, 27, 19) + circ(28, 57, 19) + circ(72, 57, 19) + circ(50, 50, 10) +
    'M45,60 C45,78 41,88 32,95 L68,95 C59,88 55,78 55,60 Z',
};
const SUIT_HI = { // gouache highlight stroke
  H: 'M18,30 C19,22 25,17 32,17', D: 'M44,20 C40,30 34,38 26,46', S: 'M40,26 C32,34 20,44 17,56', C: 'M41,20 C43,15 48,13 53,14',
};
const isRed = (s) => s === 'H' || s === 'D';

function suitDefs() {
  let out = '';
  for (const s of 'SHDC') {
    const red = isRed(s);
    out += `<clipPath id="pk-sc-${s}"><path d="${SUIT_PATHS[s]}"/></clipPath>` +
      `<symbol id="pk-s-${s}" viewBox="-6 -6 112 112">` +
      `<path d="${SUIT_PATHS[s]}" fill="${red ? RED : BLACK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/>` +
      `<g clip-path="url(#pk-sc-${s})">` +
      (red
        ? `<ellipse cx="82" cy="84" rx="52" ry="50" fill="url(#pk-hatch)" opacity=".7"/>`
        : `<ellipse cx="18" cy="22" rx="40" ry="38" fill="url(#pk-hatch-l)" opacity=".55"/>`) +
      `</g><path d="${SUIT_HI[s]}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="${red ? 0.45 : 0.3}"/>` +
      `</symbol>`;
  }
  return out;
}

// ---------------------------------------------------------------- shared defs
let DEFS = null;
function defsInner() {
  if (DEFS) return DEFS;
  const R = rng('paper-grain');
  let grain = '';
  for (let i = 0; i < 90; i++) {
    const dark = R() < 0.72;
    grain += `<circle cx="${f(R() * 48)}" cy="${f(R() * 48)}" r="${f(0.25 + R() * 0.65)}" fill="${dark ? '#6b5434' : '#fff'}" fill-opacity="${f(0.06 + R() * 0.12).padEnd(3, '0')}"/>`;
  }
  for (let i = 0; i < 10; i++) {
    const x = R() * 48, y = R() * 48, a = R() * 6.28, l = 3 + R() * 5;
    grain += `<path d="M${f(x)},${f(y)} q${f(Math.cos(a) * l * 0.5)},${f(Math.sin(a) * l * 0.5 + 1)} ${f(Math.cos(a) * l)},${f(Math.sin(a) * l)}" stroke="#7a6440" stroke-opacity=".12" stroke-width=".4" fill="none"/>`;
  }
  DEFS =
    `<pattern id="pk-grain" width="48" height="48" patternUnits="userSpaceOnUse">${grain}</pattern>` +
    `<pattern id="pk-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)"><path d="M1.2,0V5" stroke="#1d130c" stroke-width="1.15" stroke-opacity=".55"/></pattern>` +
    `<pattern id="pk-hatch-l" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)"><path d="M1.2,0V5" stroke="#fff" stroke-width="1.1" stroke-opacity=".6"/></pattern>` +
    `<pattern id="pk-xhatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M1.5,0V6M0,1.5H6" stroke="#1d130c" stroke-width=".9" stroke-opacity=".45"/></pattern>` +
    `<radialGradient id="pk-shadow"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset=".55" stop-color="#000" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="pk-cyl"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".22" stop-color="#000" stop-opacity=".08"/><stop offset=".38" stop-color="#fff" stop-opacity=".18"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>` +
    `<radialGradient id="pk-tone" cx=".38" cy=".3" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#8a6a3a" stop-opacity=".16"/></radialGradient>` +
    `<clipPath id="pk-chip-clip"><circle r="44.5"/></clipPath>` +
    `<clipPath id="pk-back-clip"><rect x="16" y="16" width="220" height="318" rx="9"/></clipPath>` +
    suitDefs();
  return DEFS;
}

/** Hidden <svg> holding all shared patterns/symbols. Mount once per document. */
export function sharedDefsSVG() {
  return `<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"><defs>${defsInner()}</defs></svg>`;
}
const wrap = (viewBox, body, cls, label, standalone) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" class="${cls}" role="img" aria-label="${label}">` +
  (standalone ? `<defs>${defsInner()}</defs>` : '') + body + `</svg>`;

// ================================================================ CHIPS
const chipStyle = (value) => CHIP_COLORS[value] ||
  { body: '#8a8f94', spot: '#f6f0e2', text: '#3d4247', spots: 8 };

function sector(cx, cy, r1, r2, a0, a1, R) {
  const p = (r, a) => `${f(cx + r * Math.cos(rad(a)) + (R() - 0.5) * 0.6)},${f(cy + r * Math.sin(rad(a)) + (R() - 0.5) * 0.6)}`;
  return `M${p(r2, a0)}A${r2},${r2} 0 0 1 ${p(r2, a1)}L${p(r1, a1)}A${r1},${r1} 0 0 0 ${p(r1, a0)}Z`;
}

// Top face of a chip in local coords: centre (0,0), radius 44.
function chipFace(value, rot, R) {
  const c = chipStyle(value);
  const n = c.spots, hw = n === 6 ? 13 : 10.5;
  const face = wobblyCircle(0, 0, 44, R, 0.45);
  let spots = '';
  for (let k = 0; k < n; k++) { const a = rot + (k * 360) / n; spots += sector(0, 0, 31, 44.6, a - hw, a + hw, R); }
  const label = String(value);
  const fs = label.length >= 4 ? 17 : label.length === 3 ? 19 : 23;
  const fit = label.length >= 3 ? ` textLength="${label.length >= 4 ? 35 : 31}" lengthAdjust="spacingAndGlyphs"` : '';
  const inlay = wobblyCircle(0, 0, 23.5, R, 0.35, 20);
  return (
    `<path d="${face}" fill="${c.body}"/>` +
    `<path d="${spots}" fill="${c.spot}" stroke="${INK}" stroke-width=".7" stroke-opacity=".55"/>` +
    `<g clip-path="url(#pk-chip-clip)"><path d="${circ(0, 0, 46)}${circ(-6, -7, 43)}" fill-rule="evenodd" fill="url(#pk-hatch)" opacity=".75"/></g>` +
    ink(wobblyCircle(0, 0, 30.2, R, 0.35, 22), 1.1, ' opacity=".85"') +
    `<circle r="27.2" fill="none" stroke="${c.spot}" stroke-width="2.2" stroke-dasharray="3.2 2.6" opacity=".9"/>` +
    `<path d="${inlay}" fill="#f8f1df"/><path d="${inlay}" fill="url(#pk-grain)"/>` +
    `<path d="${circ(4, 4, 21)}${circ(1, 1, 21)}" fill-rule="evenodd" fill="url(#pk-hatch)" opacity=".22"/>` +
    ink(inlay, 1.1) +
    `<text y="${f(fs * 0.36)}" text-anchor="middle" font-family="${CHIP_FONT}" font-size="${fs}" font-weight="700" fill="${c.text}"${fit}>${label}</text>` +
    `<path d="M-35,-17 C-30,-29 -20,-36 -8,-39" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".38"/>` +
    sketchOutline(face, wobblyCircle(0, 0, 44.3, R, 0.8), 1.8)
  );
}

/** Top-down casino chip with visible edge thickness and baked contact shadow. */
export const chipSVG = memo(({ value = 1, rotation, standalone = false } = {}) => {
  const R = rng(`chip-${value}`);
  const c = chipStyle(value);
  const rot = rotation ?? R() * 40;
  const n = c.spots, hw = n === 6 ? 13 : 10.5;
  const lip = wobblyCircle(0, 5.5, 44, R, 0.45);
  let lipSpots = '';
  for (let k = 0; k < n; k++) { const a = rot + (k * 360) / n; lipSpots += sector(0, 5.5, 31, 44.6, a - hw, a + hw, R); }
  const body =
    `<ellipse cx="4" cy="10" rx="49" ry="47" fill="url(#pk-shadow)"/>` +
    `<path d="${lip}" fill="${shade(c.body, 0.72)}"/>` +
    `<path d="${lipSpots}" fill="${shade(c.spot, 0.82)}"/>` +
    ink(lip, 1.8) +
    chipFace(value, rot, R);
  return wrap('-50 -49 106 108', body, 'pk-chip', `${value} chip`, standalone);
});

/** A stack of chips seen at an angle. values[0] is the bottom chip. */
export const chipStackSVG = memo(({ values = [5, 5, 5, 5, 5], seed = 0, standalone = false } = {}) => {
  const R = rng(`stack-${values.join(',')}-${seed}`);
  const r = 44, ry = 18.5, t = 7.5, n = values.length;
  const pt = (cx, cy, a) => `${f(cx + r * Math.cos(rad(a)))},${f(cy + ry * Math.sin(rad(a)))}`;
  let out = `<ellipse cx="10" cy="${f((n - 1) * t + t + 6)}" rx="58" ry="25" fill="url(#pk-shadow)"/>`;
  values.forEach((v, i) => {
    const c = chipStyle(v);
    const cx = (R() - 0.5) * 3.2, cy = (n - 1 - i) * t;
    const rot = R() * 360;
    const side = `M${f(cx - r)},${f(cy)}L${f(cx - r)},${f(cy + t)}A${r},${ry} 0 0 0 ${f(cx + r)},${f(cy + t)}` +
      `L${f(cx + r)},${f(cy)}A${r},${ry} 0 0 1 ${f(cx - r)},${f(cy)}Z`;
    let stripes = '';
    const hw = c.spots === 6 ? 13 : 10.5;
    for (let k = 0; k < c.spots; k++) {
      const a = ((rot + (k * 360) / c.spots) % 360 + 360) % 360;
      const lo = Math.max(0, a - hw), hi = Math.min(180, a + hw);
      if (hi <= lo) continue;
      const top = [0, 1, 2, 3].map((j) => pt(cx, cy, lo + ((hi - lo) * j) / 3));
      const bot = [3, 2, 1, 0].map((j) => pt(cx, cy + t, lo + ((hi - lo) * j) / 3));
      stripes += `M${top.join('L')}L${bot.join('L')}Z`;
    }
    out += `<path d="${side}" fill="${shade(c.body, 0.85)}"/>` +
      (stripes ? `<path d="${stripes}" fill="${shade(c.spot, 0.9)}"/>` : '') +
      `<path d="${side}" fill="url(#pk-cyl)"/>` + ink(side, 1.3);
    if (i === n - 1) {
      out += `<g transform="translate(${f(cx)},${f(cy)}) scale(1,${f(ry / r * 100) / 100})">${chipFace(v, rot, R)}</g>`;
    } else {
      const e = wobblyEllipse(cx, cy, r, ry, R, 0.3);
      out += `<path d="${e}" fill="${c.body}"/>` + ink(e, 1.2);
    }
  });
  const h = (n - 1) * t + t + ry + 34;
  return wrap(`-56 ${f(-ry - 3)} 124 ${f(h)}`, out, 'pk-stack', `stack of ${n} chips`, standalone);
});

// ================================================================ CARDS
// viewBox 0 0 252 352: face is 246x346 (2.5:3.5) at (2,2); a 3-unit "slab" peeks out
// bottom-right as card thickness. Face centre is (125,175).
const CX = 125, CY = 175;

function normRank(r) {
  const s = String(r).toUpperCase();
  const map = { 1: 'A', 14: 'A', 11: 'J', 12: 'Q', 13: 'K', T: '10', ACE: 'A', JACK: 'J', QUEEN: 'Q', KING: 'K' };
  return map[s] || s;
}
function normSuit(s) {
  const k = String(s);
  const map = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C', s: 'S', h: 'H', d: 'D', c: 'C', spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
  return map[k] || map[k.toLowerCase()] || k.toUpperCase();
}

const pip = (s, cx, cy, size, flip = false) => {
  const b = (size * 112) / 100;
  return `<use href="#pk-s-${s}" x="${f(cx - b / 2)}" y="${f(cy - b / 2)}" width="${f(b)}" height="${f(b)}"${flip ? ` transform="rotate(180 ${f(cx)} ${f(cy)})"` : ''}/>`;
};

// [column, rowFraction] — standard (Anglo-American) pip layouts
const L = 0, C = 1, Rt = 2;
const LAYOUT = {
  2: [[C, 0], [C, 1]],
  3: [[C, 0], [C, 0.5], [C, 1]],
  4: [[L, 0], [Rt, 0], [L, 1], [Rt, 1]],
  5: [[L, 0], [Rt, 0], [C, 0.5], [L, 1], [Rt, 1]],
  6: [[L, 0], [Rt, 0], [L, 0.5], [Rt, 0.5], [L, 1], [Rt, 1]],
  7: [[L, 0], [Rt, 0], [C, 0.25], [L, 0.5], [Rt, 0.5], [L, 1], [Rt, 1]],
  8: [[L, 0], [Rt, 0], [C, 0.25], [L, 0.5], [Rt, 0.5], [C, 0.75], [L, 1], [Rt, 1]],
  9: [[L, 0], [Rt, 0], [L, 1 / 3], [Rt, 1 / 3], [C, 0.5], [L, 2 / 3], [Rt, 2 / 3], [L, 1], [Rt, 1]],
  10: [[L, 0], [Rt, 0], [C, 1 / 6], [L, 1 / 3], [Rt, 1 / 3], [L, 2 / 3], [Rt, 2 / 3], [C, 5 / 6], [L, 1], [Rt, 1]],
};
const COLX = [74, CX, 176], Y0 = 76, Y1 = 274;

function pips(rank, s) {
  return LAYOUT[rank].map(([col, fr]) => pip(s, COLX[col], Y0 + fr * (Y1 - Y0), 46, fr > 0.5)).join('');
}

function aceArt(s, R) {
  if (s !== 'S') return pip(s, CX, CY, 104);
  // ornate Ace of Spades
  const k1 = 1.5, k2 = 0.98, k3 = 0.6;
  const tf = (k, dy = 0) => `transform="translate(${CX},${CY + dy}) scale(${k}) translate(-50,-50)"`;
  let dots = '';
  for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; dots += circ(CX + 96 * Math.cos(a), CY + 96 * Math.sin(a) * 1.08, i % 2 ? 1.1 : 1.9); }
  const scroll = jit('M125,262 C110,262 98,270 90,280 C82,290 70,290 66,282 C62,274 70,266 78,272 M125,262 C140,262 152,270 160,280 C168,290 180,290 184,282 C188,274 180,266 172,272', R, 0.3);
  const crown = jit('M106,86 L104,70 L114,78 L125,62 L136,78 L146,70 L144,86 Z', R, 0.3);
  return (
    `<path d="${dots}" fill="${INK}" opacity=".75"/>` +
    ink(wobblyEllipse(CX, CY, 88, 95, R, 0.7), 1.2, ' opacity=".7"') +
    `<path d="${scroll}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>` +
    pip('S', CX, CY + 4, 100 * k1) +
    `<path d="${SUIT_PATHS.S}" fill="none" stroke="${PAPER}" stroke-width="${f(2.4 / k2)}" ${tf(k2, 4)} opacity=".9"/>` +
    `<path d="${SUIT_PATHS.S}" fill="none" stroke="${GOLD}" stroke-width="${f(1.8 / k3)}" stroke-dasharray="${f(3 / k3)} ${f(2.5 / k3)}" ${tf(k3, 4)}/>` +
    `<circle cx="${CX}" cy="${CY + 10}" r="7" fill="${GOLD}" stroke="${PAPER}" stroke-width="1.6"/>` +
    `<path d="${crown}" fill="${GOLD}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="${circ(125, 60, 2.6)}${circ(104, 68, 2)}${circ(146, 68, 2)}" fill="${GOLD}" stroke="${INK}" stroke-width="1"/>`
  );
}

// Court figure — top half only (mirrored for the bottom half). Coordinates in card space.
function courtHalf(rank, s, R) {
  const sh = (d, fill, { hatch = false, w = 1.5 } = {}) => {
    const dj = jit(d, R, 0.45);
    return `<path d="${dj}" fill="${fill}"/>` + (hatch ? `<path d="${dj}" fill="url(#pk-hatch)" opacity=".5"/>` : '') +
      ink(dj, w);
  };
  const dot = (x, y, r, fill, w = 1) => `<path d="${circ(x, y, r)}" fill="${fill}" stroke="${INK}" stroke-width="${w}"/>`;
  const pal = {
    K: { robe: RED, panel: BLUE, band: GOLD, collar: '#f6f0e2', hair: '#7b4b28' },
    Q: { robe: BLUE, panel: RED, band: GOLD, collar: GOLD, hair: '#8c4a26' },
    J: { robe: GOLD, panel: RED, band: BLUE, collar: '#f6f0e2', hair: '#5e3a1e' },
  }[rank];
  let back = '', front = '', hairBack = '', top = '';
  if (rank === 'K') {
    back = sh('M77,150 L85,150 L84,62 L81,48 L78,62 Z', STEEL) + ink('M81,60 L81,140', 0.8, ' opacity=".5"');
    front = sh('M67,147 L95,147 L95,154 L67,154 Z', GOLD) + sh('M78,154 L84,154 L84,166 L78,166 Z', WOOD) +
      dot(81, 169, 3, GOLD) + dot(81, 159, 6, SKIN, 1.3);
    top = sh('M106,96 C105,116 115,128 125,130 C135,128 145,116 144,96 C140,105 134,109 125,109 C116,109 110,105 106,96 Z', pal.hair, { hatch: true }) +
      sh('M114,101 C119,97 123,99 125,101 C127,99 131,97 136,101 C131,105 127,104 125,103 C123,104 119,105 114,101 Z', pal.hair) +
      sh('M107,77 C101,87 101,99 106,107 L110,95 Z', pal.hair) + sh('M143,77 C149,87 149,99 144,107 L140,95 Z', pal.hair) +
      sh('M101,72 L100,51 L112,61 L125,40 L138,61 L150,51 L149,72 Z', GOLD, { hatch: true }) +
      sh('M99,66 L151,66 L151,74 L99,74 Z', GOLD) +
      dot(125, 57, 3.4, RED) + dot(111, 70, 2.1, BLUE) + dot(125, 70, 2.1, RED) + dot(139, 70, 2.1, BLUE) +
      dot(100, 49, 2.6, GOLD) + dot(125, 38, 2.8, GOLD) + dot(150, 49, 2.6, GOLD);
  } else if (rank === 'Q') {
    hairBack = sh('M104,78 C94,96 97,124 88,143 C102,143 110,133 112,120 C107,106 106,92 110,80 Z', pal.hair, { hatch: true }) +
      sh('M146,78 C156,96 153,124 162,143 C148,143 140,133 138,120 C143,106 144,92 140,80 Z', pal.hair, { hatch: true });
    front = `<path d="${jit('M168,172 C166,152 162,134 160,116', R, 0.4)}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>` +
      `<path d="${jit('M168,172 C166,152 162,134 160,116', R, 0.1)}" fill="none" stroke="#5d8a3f" stroke-width="2"/>` +
      sh('M163,142 C171,133 180,134 183,139 C175,143 169,144 163,142 Z', '#5d8a3f') +
      dot(160, 108, 10, RED, 1.4) + ink(jit('M160,108 C163,105 166,110 162,113 C156,115 153,108 157,103 C162,99 169,103 169,109', R, 0.3), 1.1) +
      dot(167, 158, 6, SKIN, 1.3);
    top = sh('M107,80 C110,67 140,67 143,80 C134,74 116,74 107,80 Z', pal.hair) +
      sh('M106,72 L106,58 C110,52 116,52 118,58 C120,47 130,47 132,58 C134,52 140,52 144,58 L144,72 Z', GOLD, { hatch: true }) +
      sh('M105,66 L145,66 L145,73 L105,73 Z', GOLD) +
      dot(125, 61, 3, RED) + dot(125, 46, 2.6, '#fff') + dot(112, 52, 2.1, '#fff') + dot(138, 52, 2.1, '#fff') +
      dot(113, 130, 1.7, '#fff', 0.8) + dot(119, 133, 1.7, '#fff', 0.8) + dot(125, 134, 1.7, '#fff', 0.8) + dot(131, 133, 1.7, '#fff', 0.8) + dot(137, 130, 1.7, '#fff', 0.8);
  } else {
    back = sh('M174,174 L178,174 L178,52 L174,52 Z', WOOD) +
      sh('M178,58 L194,50 C198,60 198,72 194,80 L178,72 Z', STEEL, { hatch: true }) + sh('M174,54 L176,43 L178,54 Z', STEEL);
    front = dot(176, 158, 6, SKIN, 1.3);
    hairBack = dot(107, 90, 6, pal.hair) + dot(106, 101, 5, pal.hair) + dot(143, 90, 6, pal.hair) + dot(144, 101, 5, pal.hair);
    top = ink(jit('M118,101 C121,99 124,100 125,101 C126,100 129,99 132,101', R, 0.2), 1.5) +
      sh('M146,62 C154,48 170,42 186,47 C176,50 164,56 152,68 Z', BLUE, { hatch: true }) + ink(jit('M150,64 C160,54 170,49 182,48', R, 0.3), 0.9) +
      sh('M100,74 C96,58 112,49 128,51 C146,53 158,62 152,74 Z', RED, { hatch: true }) +
      sh('M98,67 L154,67 L154,75 L98,75 Z', GOLD) + dot(126, 71, 2.2, BLUE);
  }
  const face = jit('M125,64 C137,64 143,75 143,88 C143,102 135,111 125,111 C115,111 107,102 107,88 C107,75 113,64 125,64 Z', R, 0.35);
  const pipX = rank === 'K' ? 186 : 64;
  return (
    back +
    sh('M46,175 L46,141 C52,131 76,127 102,124 L148,124 C174,127 198,131 204,141 L204,175 Z', pal.robe, { hatch: true }) +
    ink(jit('M72,175 C72,158 76,144 84,136 M178,175 C178,158 174,144 166,136', R, 0.4), 1.2, ' opacity=".7"') +
    sh('M108,126 L142,126 L150,175 L100,175 Z', pal.panel) +
    dot(125, 141, 2.6, GOLD, 0.9) + dot(125, 153, 2.6, GOLD, 0.9) +
    sh('M46,158 C90,150 160,150 204,158 L204,166 C160,158 90,158 46,166 Z', pal.band) +
    sh('M117,103 L133,103 L134,124 L116,124 Z', SKIN) +
    sh('M99,124 C108,135 142,135 151,124 C144,118 106,118 99,124 Z', pal.collar) +
    (pal.collar !== GOLD ? `<path d="${circ(110, 125, 1.2)}${circ(125, 129, 1.2)}${circ(140, 125, 1.2)}" fill="${INK}"/>` : '') +
    hairBack +
    `<path d="${face}" fill="${SKIN}"/>` + `<path d="${circ(130, 93, 15)}" fill="url(#pk-hatch)" opacity=".12"/>` + ink(face, 1.6) +
    ink(jit('M112,80 Q117,77 121,79 M129,79 Q133,77 138,80', R, 0.3), 1.4) +
    ink(jit('M113,86 Q117,83 121,86 M129,86 Q133,83 137,86', R, 0.2), 1.1) +
    `<path d="${circ(117, 87.6, 1.6)}${circ(133, 87.6, 1.6)}" fill="${INK}"/>` +
    ink(jit('M125,88 Q122,96 127,97', R, 0.3), 1.2) +
    ink(jit('M120,103 Q125,105.5 130,103', R, 0.2), 1.3) +
    `<path d="${circ(114, 96, 3.5)}${circ(136, 96, 3.5)}" fill="${RED}" opacity=".22"/>` +
    top + front +
    pip(s, pipX, 58, 22)
  );
}

function index(rank, s) {
  const red = isRed(s);
  const col = red ? RED : BLACK;
  const fit = rank === '10' ? ' textLength="34" lengthAdjust="spacingAndGlyphs"' : '';
  return `<text x="23" y="48" text-anchor="middle" font-family="${INDEX_FONT}" font-size="40" font-weight="700" fill="${col}" stroke="${col}" stroke-width=".8" stroke-linejoin="round"${fit}>${rank}</text>` +
    pip(s, 23, 70, 24);
}

function cardShell(R, inner) {
  const body = wobblyRRect(2, 2, 246, 346, 13, R, 0.55);
  const slab = wobblyRRect(5, 5.5, 246, 346, 13, R, 0.4);
  return (
    `<path d="${slab}" fill="#d6c9ab"/>` + ink(slab, 1.4) +
    `<path d="${body}" fill="${PAPER}"/><path d="${body}" fill="url(#pk-grain)"/><path d="${body}" fill="url(#pk-tone)"/>` +
    inner +
    sketchOutline(body, wobblyRRect(2, 2, 246, 346, 13, R, 1.1), 2.2)
  );
}

/** Standard poker-size playing card (2.5 x 3.5). rank: A,2..10,J,Q,K ; suit: S,H,D,C (or ♠♥♦♣). */
export const cardSVG = memo(({ rank = 'A', suit = 'S', standalone = false } = {}) => {
  const rk = normRank(rank), s = normSuit(suit);
  const R = rng(`card-${rk}${s}`);
  let art;
  if (rk === 'A') art = aceArt(s, R);
  else if (LAYOUT[rk]) art = pips(rk, s);
  else {
    const frame = wobblyRRect(44, 40, 162, 270, 6, R, 0.5);
    const half = courtHalf(rk, s, R);
    art = `<path d="${frame}" fill="#efe1bf" opacity=".55"/>` +
      half + `<g transform="rotate(180 ${CX} ${CY})">${half}</g>` +
      ink(jit('M45,175 L205,175', R, 0.6), 1.6) + ink(frame, 1.8);
  }
  const idx = index(rk, s);
  const inner = art + idx + `<g transform="rotate(180 ${CX} ${CY})">${idx}</g>`;
  const names = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
  return wrap('0 0 252 352', cardShell(R, inner), 'pk-card', `${rk} of ${names[s] || s}`, standalone);
});

/** Card back: lattice-and-medallion design. */
export const cardBackSVG = memo(({ color = '#9c2b25', standalone = false } = {}) => {
  const R = rng(`back-${color}`);
  let lat = '';
  for (let k = -340; k <= 260; k += 17) {
    const j = () => f((R() - 0.5) * 1.6);
    lat += `M${k},0 Q${f(k + 175 + +j())},${f(175 + +j())} ${k + 350},350 `;
    lat += `M${k + 350},0 Q${f(k + 175 + +j())},${f(175 + +j())} ${k},350 `;
  }
  const panel = wobblyRRect(16, 16, 220, 318, 9, R, 0.5);
  const innerB = wobblyRRect(25, 25, 202, 300, 6, R, 0.5);
  const med = wobblyEllipse(CX, CY, 52, 68, R, 0.6);
  let corners = '';
  for (const [x, y] of [[40, 40], [210, 40], [40, 310], [210, 310]]) corners += circ(x, y, 5) + circ(x, y, 2);
  const inner =
    `<path d="${panel}" fill="${color}"/>` +
    `<g clip-path="url(#pk-back-clip)"><path d="${lat}" fill="none" stroke="#f3e4c4" stroke-width="1.3" opacity=".5"/>` +
    `<rect x="16" y="16" width="220" height="318" fill="url(#pk-hatch)" opacity=".25"/></g>` +
    ink(innerB, 1.6, ` stroke="#f3e4c4" opacity=".8"`).replace(`stroke="${INK}" `, '') +
    `<path d="${corners}" fill="${GOLD}" fill-rule="evenodd" stroke="${INK}" stroke-width="1"/>` +
    `<path d="${med}" fill="${PAPER}"/><path d="${med}" fill="url(#pk-grain)"/>` +
    `<ellipse cx="${CX}" cy="${CY}" rx="44" ry="60" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"/>` +
    sketchOutline(med, wobblyEllipse(CX, CY, 52, 68, R, 1.1), 2) +
    pip('S', CX, CY - 32, 26) + pip('H', CX + 25, CY, 26) + pip('C', CX, CY + 32, 26) + pip('D', CX - 25, CY, 26) +
    `<path d="${jit('M125,165 L128,172 L135,175 L128,178 L125,185 L122,178 L115,175 L122,172 Z', R, 0.2)}" fill="${GOLD}" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>` +
    ink(panel, 1.8);
  return wrap('0 0 252 352', cardShell(R, inner), 'pk-card pk-card-back', 'card back', standalone);
});

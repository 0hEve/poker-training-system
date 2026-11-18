// Shared primitives for the hand-inked art set: seeded PRNG, wobbly path
// builders, palette, per-SVG defs and the standalone SVG -> data URL wrapper.
// Everything here is pure and deterministic (same input => same string).

export type Rand = () => number;
export type Pt = [number, number];

// ---------------------------------------------------------------- palette
// Warm, muted "printed deck" palette (council polish #1).
export const INK = '#2a1d14';
export const PAPER = '#f4e9d0'; // cream card stock
export const PAPER_SLAB = '#c9b994';
export const SUIT_RED = '#b0372d';
export const SUIT_BLACK = '#221a15';
export const COURT_RED = '#a24a3c';
export const COURT_BLUE = '#3f5b80';
export const GOLD = '#d2a54f';
export const CREAM = '#f1e6cc';
export const SKIN = '#efd6b1';
export const STEEL = '#d5d6d0';
export const WOOD = '#7d5739';
export const LEAF = '#62804a';
export const OXBLOOD = '#6e1f2a';
export const INDEX_FONT = "'Baskerville','Hoefler Text','Libre Baskerville','Georgia',serif";
export const CHIP_FONT = "'Marker Felt','Chalkboard SE','Comic Sans MS',cursive";

// ---------------------------------------------------------------- PRNG
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 seeded from a number or an FNV-1a hash of a string. */
export function rng(seed: string | number): Rand {
  let a = typeof seed === 'number' ? seed >>> 0 : hashStr(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Format to 1 decimal, never "-0". */
export const f = (n: number): string => {
  const v = Math.round(n * 10) / 10;
  return (v === 0 ? 0 : v).toString();
};
export const rad = (deg: number): number => (deg * Math.PI) / 180;

/** k < 1 darkens towards black, k > 1 lightens towards white. */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.max(0, Math.min(255, Math.round(k < 1 ? c * k : c + (255 - c) * (k - 1)))),
  );
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- paths
/** Closed Catmull-Rom spline through pts -> cubic bezier path. */
export function closedSpline(pts: Pt[]): string {
  const n = pts.length;
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d +=
      `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + 'Z';
}

/** Hand-drawn ellipse: low-frequency radial wobble plus a small per-point tremor. */
export function wobblyEllipse(cx: number, cy: number, rx: number, ry: number, R: Rand, amp = 0.6, n = 26): string {
  const p1 = R() * 6.283, p2 = R() * 6.283, a1 = amp * (0.5 + R() * 0.5);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = a1 * Math.sin(a * 2 + p1) + amp * 0.5 * Math.sin(a * 3 + p2) + (R() - 0.5) * amp * 0.5;
    pts.push([cx + (rx + w) * Math.cos(a), cy + (ry + w * (ry / rx)) * Math.sin(a)]);
  }
  return closedSpline(pts);
}
export const wobblyCircle = (cx: number, cy: number, r: number, R: Rand, amp?: number, n?: number): string =>
  wobblyEllipse(cx, cy, r, r, R, amp, n);

export function wobblyRRect(x: number, y: number, w: number, h: number, r: number, R: Rand, amp = 0.7, step = 26): string {
  const pts: [number, number, number][] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const k = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let i = 0; i < k; i++) pts.push([x0 + ((x1 - x0) * i) / k, y0 + ((y1 - y0) * i) / k, 1]);
  };
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i < 3; i++) {
      const a = a0 + (i * Math.PI) / 6;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), 0.4]);
    }
  };
  edge(x + r, y, x + w - r, y); corner(x + w - r, y + r, -Math.PI / 2);
  edge(x + w, y + r, x + w, y + h - r); corner(x + w - r, y + h - r, 0);
  edge(x + w - r, y + h, x + r, y + h); corner(x + r, y + h - r, Math.PI / 2);
  edge(x, y + h - r, x, y + r); corner(x + r, y + r, Math.PI);
  return closedSpline(pts.map(([px, py, k]) => [px + (R() - 0.5) * 2 * amp * k, py + (R() - 0.5) * 2 * amp * k]));
}

/** Jitter every coordinate of an absolute M/L/C/Q/Z path: bakes in a hand wobble. */
export const jit = (d: string, R: Rand, amt: number): string =>
  d.replace(/-?\d*\.?\d+/g, (m) => f(parseFloat(m) + (R() - 0.5) * 2 * amt));

/** Bounding box of an absolute M/L/C/Q/Z path (coordinate pairs only). */
export function bbox(d: string): { x0: number; y0: number; x1: number; y1: number } {
  const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    x0 = Math.min(x0, nums[i]); x1 = Math.max(x1, nums[i]);
    y0 = Math.min(y0, nums[i + 1]); y1 = Math.max(y1, nums[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

export const circ = (cx: number, cy: number, r: number): string =>
  `M${f(cx - r)},${f(cy)}A${r},${r} 0 1 0 ${f(cx + r)},${f(cy)}A${r},${r} 0 1 0 ${f(cx - r)},${f(cy)}Z`;

export const ink = (d: string, w = 1.6, extra = '', color = INK): string =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${Math.round(w * 100) / 100}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;

/**
 * Main outline plus a second, lighter "sketch pass" from another seed.
 * strength 0 = subtle (small chips), 1 = strong (cards at large sizes).
 */
export const sketchOutline = (d1: string, d2: string, w = 2, strength = 1): string =>
  ink(d1, w) + ink(d2, w * (0.42 + 0.2 * strength), ` opacity="${(0.42 + 0.22 * strength).toFixed(2)}"`);

// ---------------------------------------------------------------- shared defs
// Defs are written with a "§" placeholder namespace. wrapSVG() embeds only the
// defs a given SVG actually references and replaces "§" with a per-SVG prefix,
// so each data URL is standalone and IDs never collide.

export const SUIT_PATHS: Record<SuitKey, string> = {
  H: 'M50,88 C41,77 8,59 8,34 C8,18 20,9 32,9 C41,9 47,15 50,24 C53,15 59,9 68,9 C80,9 92,18 92,34 C92,59 59,77 50,88 Z',
  D: 'M50,4 C59,21 71,37 85,50 C71,63 59,79 50,96 C41,79 29,63 15,50 C29,37 41,21 50,4 Z',
  S: 'M50,5 C61,22 92,37 92,60 C92,74 81,82 70,82 C62,82 56,78 53,72 C54,82 58,90 67,95 L33,95 C42,90 46,82 47,72 C44,78 38,82 30,82 C19,82 8,74 8,60 C8,37 39,22 50,5 Z',
  C:
    circ(50, 27, 19) + circ(28, 57, 19) + circ(72, 57, 19) + circ(50, 50, 10) +
    'M45,60 C45,78 41,88 32,95 L68,95 C59,88 55,78 55,60 Z',
};
export type SuitKey = 'S' | 'H' | 'D' | 'C';
export const isRedSuit = (s: SuitKey): boolean => s === 'H' || s === 'D';
const SUIT_HI: Record<SuitKey, string> = {
  H: 'M18,30 C19,22 25,17 32,17',
  D: 'M44,20 C40,30 34,38 26,46',
  S: 'M40,26 C32,34 20,44 17,56',
  C: 'M41,20 C43,15 48,13 53,14',
};

function grainPattern(): string {
  const R = rng('paper-grain');
  const buckets: Record<string, string> = {};
  for (let i = 0; i < 70; i++) {
    const dark = R() < 0.72;
    const x = R() * 48, y = R() * 48, r = 0.25 + R() * 0.65;
    const key = `${dark ? '#6b5434' : '#fff'}|${R() < 0.5 ? '.09' : '.16'}`;
    buckets[key] = (buckets[key] ?? '') + circ(x, y, Math.round(r * 10) / 10);
  }
  let out = '';
  for (const k of Object.keys(buckets).sort()) {
    const [fill, op] = k.split('|');
    out += `<path d="${buckets[k]}" fill="${fill}" fill-opacity="${op}"/>`;
  }
  let fib = '';
  for (let i = 0; i < 9; i++) {
    const x = R() * 48, y = R() * 48, a = R() * 6.28, l = 3 + R() * 5;
    fib += `M${f(x)},${f(y)}q${f(Math.cos(a) * l * 0.5)},${f(Math.sin(a) * l * 0.5 + 1)} ${f(Math.cos(a) * l)},${f(Math.sin(a) * l)}`;
  }
  out += `<path d="${fib}" stroke="#7a6440" stroke-opacity=".14" stroke-width=".45" fill="none"/>`;
  return `<pattern id="§grain" width="48" height="48" patternUnits="userSpaceOnUse">${out}</pattern>`;
}

function suitDef(s: SuitKey): string {
  const red = isRedSuit(s);
  return (
    `<clipPath id="§sc-${s}"><path d="${SUIT_PATHS[s]}"/></clipPath>` +
    `<symbol id="§s-${s}" viewBox="-6 -6 112 112">` +
    `<path d="${SUIT_PATHS[s]}" fill="${red ? SUIT_RED : SUIT_BLACK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/>` +
    `<g clip-path="url(#§sc-${s})">` +
    (red
      ? `<ellipse cx="82" cy="84" rx="52" ry="50" fill="url(#§hatch)" opacity=".6"/>`
      : `<ellipse cx="18" cy="22" rx="40" ry="38" fill="url(#§hatch-l)" opacity=".5"/>`) +
    `</g><path d="${SUIT_HI[s]}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="${red ? 0.4 : 0.28}"/>` +
    `</symbol>`
  );
}

const hatchPat = (id: string, size: number, w: number, color: string, op: number, angle: number) =>
  `<pattern id="§${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})">` +
  `<path d="M${f(size / 4)},0V${size}" stroke="${color}" stroke-width="${w}" stroke-opacity="${op}"/></pattern>`;

let DEFS: Record<string, string> | null = null;
function defs(): Record<string, string> {
  if (DEFS) return DEFS;
  DEFS = {
    grain: grainPattern(),
    hatch: hatchPat('hatch', 5, 1.15, '#1d130c', 0.55, -38),
    'hatch-l': hatchPat('hatch-l', 5, 1.1, '#fff', 0.6, -38),
    // fine engraved line work (council polish #4)
    eng: hatchPat('eng', 2.8, 0.55, '#1d130c', 0.62, -52),
    eng2: hatchPat('eng2', 2.8, 0.5, '#1d130c', 0.5, 38),
    'eng-l': hatchPat('eng-l', 2.6, 0.5, '#fff', 0.75, -52),
    shadow:
      `<radialGradient id="§shadow"><stop offset="0" stop-color="#000" stop-opacity=".5"/>` +
      `<stop offset=".55" stop-color="#000" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`,
    cyl:
      `<linearGradient id="§cyl"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".22" stop-color="#000" stop-opacity=".08"/>` +
      `<stop offset=".38" stop-color="#fff" stop-opacity=".18"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>`,
    tone:
      `<radialGradient id="§tone" cx=".38" cy=".3" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".32"/>` +
      `<stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#7d5c30" stop-opacity=".18"/></radialGradient>`,
    'chip-clip': `<clipPath id="§chip-clip"><circle r="44.5"/></clipPath>`,
    'back-clip': `<clipPath id="§back-clip"><rect x="16" y="16" width="220" height="318" rx="9"/></clipPath>`,
  };
  for (const s of ['S', 'H', 'D', 'C'] as SuitKey[]) {
    // symbol + its clip share one entry; both ids resolve to the same markup
    DEFS[`s-${s}`] = suitDef(s);
    DEFS[`sc-${s}`] = '';
  }
  return DEFS;
}

const REF_RE = /(?:url\(#|href="#)§([\w-]+)/g;

/**
 * Wrap body markup into a standalone SVG string. Only referenced shared defs are
 * embedded; "§" is replaced by `${ns}-` so every id is namespaced per SVG.
 */
export function wrapSVG(
  ns: string,
  viewBox: string,
  body: string,
  label: string,
  opts: { extraDefs?: string; width?: number; height?: number } = {},
): string {
  const table = defs();
  const used = new Set<string>();
  let out = '';
  const queue = [body, opts.extraDefs ?? ''];
  while (queue.length) {
    const s = queue.shift()!;
    for (const m of s.matchAll(REF_RE)) {
      const id = m[1];
      if (used.has(id) || !(id in table)) continue;
      used.add(id);
      out += table[id];
      queue.push(table[id]);
    }
  }
  const size = opts.width ? ` width="${opts.width}" height="${opts.height}"` : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${size} role="img" aria-label="${label}">` +
    (out || opts.extraDefs ? `<defs>${out}${opts.extraDefs ?? ''}</defs>` : '') +
    body +
    `</svg>`;
  return svg.replaceAll('§', `${ns}-`);
}

export const toDataURL = (svg: string): string => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

/** Memoise a single-key generator in a Map. */
export function memo<K, V>(fn: (k: K) => V): (k: K) => V {
  const cache = new Map<K, V>();
  return (k: K) => {
    let v = cache.get(k);
    if (v === undefined) {
      v = fn(k);
      cache.set(k, v);
    }
    return v;
  };
}

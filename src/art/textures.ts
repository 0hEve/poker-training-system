// Tileable, filter-free textures for CSS backgrounds. Every mark that crosses
// a tile edge is also drawn on the opposite edge, so the tile wraps seamlessly.
import { circ, f, rng, wrapSVG, type Rand } from './core';

/** Suggested table colours to sit under the felt overlay and around the rail. */
export const TABLE_COLORS = {
  feltLight: '#33805a',
  feltMid: '#276843',
  feltDark: '#1c4f33',
  rail: '#5a301d',
  railDark: '#351a0e',
  stitch: 'rgba(242,205,160,.38)',
} as const;

/** Draw fn(x, y) at every wrapped copy needed for an item of radius `e`. */
function wrapped(S: number, x: number, y: number, e: number, fn: (x: number, y: number) => string): string {
  let out = '';
  const xs = [x], ys = [y];
  if (x < e) xs.push(x + S);
  if (x > S - e) xs.push(x - S);
  if (y < e) ys.push(y + S);
  if (y > S - e) ys.push(y - S);
  for (const xx of xs) for (const yy of ys) out += fn(xx, yy);
  return out;
}

function speckles(S: number, R: Rand, count: number, rMin: number, rMax: number, buckets: string[]): string[] {
  const out = buckets.map(() => '');
  for (let i = 0; i < count; i++) {
    const x = R() * S, y = R() * S, r = Math.round((rMin + R() * (rMax - rMin)) * 10) / 10;
    const b = Math.floor(R() * buckets.length);
    out[b] += wrapped(S, x, y, r, (xx, yy) => circ(xx, yy, r));
  }
  return out;
}

function fibres(S: number, R: Rand, count: number, lMin: number, lMax: number): string {
  let d = '';
  for (let i = 0; i < count; i++) {
    const x = R() * S, y = R() * S, a = R() * Math.PI * 2, l = lMin + R() * (lMax - lMin), bend = (R() - 0.5) * l * 0.6;
    const dx = Math.cos(a) * l, dy = Math.sin(a) * l;
    d += wrapped(S, x, y, l, (xx, yy) => `M${f(xx)},${f(yy)}q${f(dx / 2 - dy * bend / l)},${f(dy / 2 + dx * bend / l)} ${f(dx)},${f(dy)}`);
  }
  return d;
}

/**
 * Felt nap: a TRANSPARENT overlay of fine dark/light specks and short fibres
 * (160px tile). Layer it over the felt colour, e.g.
 * `background: url(felt) , radial-gradient(#33805a, #1c4f33)`.
 */
export function feltSVG(): string {
  const S = 160;
  const R = rng('felt-nap');
  const fills = [
    ['#04140b', '.24'],
    ['#04140b', '.14'],
    ['#d9f2df', '.1'],
    ['#d9f2df', '.17'],
  ];
  const sp = speckles(S, R, 520, 0.3, 0.85, fills.map((x) => x[0]));
  let body = sp.map((d, i) => (d ? `<path d="${d}" fill="${fills[i][0]}" fill-opacity="${fills[i][1]}"/>` : '')).join('');
  body += `<path d="${fibres(S, R, 70, 2.5, 6)}" fill="none" stroke="#04140b" stroke-opacity=".22" stroke-width=".5" stroke-linecap="round"/>`;
  body += `<path d="${fibres(S, R, 60, 2.5, 6)}" fill="none" stroke="#e4f5e8" stroke-opacity=".16" stroke-width=".45" stroke-linecap="round"/>`;
  return wrapSVG('pkfelt', `0 0 ${S} ${S}`, body, 'felt texture', { width: S, height: S });
}

/** Opaque pebbled leather for the table rail (128px tile). */
export function railSVG(): string {
  const S = 128;
  const R = rng('rail-leather');
  // pebble grain: small irregular cells, dark in the pores, light on the tops
  let pores = '', tops = '';
  for (let i = 0; i < 360; i++) {
    const x = R() * S, y = R() * S, rx = 1 + R() * 1.6, ry = 0.7 + R() * 1.2, a = R() * 180;
    const cell = (xx: number, yy: number) =>
      `<ellipse cx="${f(xx)}" cy="${f(yy)}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${f(a)} ${f(xx)} ${f(yy)})"/>`;
    if (R() < 0.6) pores += wrapped(S, x, y, rx + 0.5, cell);
    else tops += wrapped(S, x, y, rx + 0.5, cell);
  }
  // a few long soft creases
  let creases = '';
  for (let i = 0; i < 7; i++) {
    const x = R() * S, y = R() * S, l = 14 + R() * 26, a = (R() - 0.5) * 0.9;
    const dx = Math.cos(a) * l, dy = Math.sin(a) * l, b = (R() - 0.5) * 6;
    creases += wrapped(S, x, y, l, (xx, yy) => `M${f(xx)},${f(yy)}q${f(dx / 2)},${f(dy / 2 + b)} ${f(dx)},${f(dy)}`);
  }
  const body =
    `<rect width="${S}" height="${S}" fill="${TABLE_COLORS.rail}"/>` +
    `<g fill="#2a1409" fill-opacity=".28">${pores}</g>` +
    `<g fill="#f0c49a" fill-opacity=".07">${tops}</g>` +
    `<path d="${creases}" fill="none" stroke="#1f0e06" stroke-opacity=".25" stroke-width=".9" stroke-linecap="round"/>` +
    `<path d="${fibres(S, R, 40, 1.5, 4)}" fill="none" stroke="#f6d2ad" stroke-opacity=".08" stroke-width=".5"/>`;
  return wrapSVG('pkrail', `0 0 ${S} ${S}`, body, 'leather rail texture', { width: S, height: S });
}

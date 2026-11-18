// Casino chips, angled chip stacks and the dealer button.
import {
  CHIP_FONT, INDEX_FONT, INK, SUIT_RED,
  circ, f, ink, rad, rng, shade, sketchOutline, wobblyCircle, wobblyEllipse, wrapSVG,
  type Rand,
} from './core';

export interface ChipStyle {
  body: string; // chip body colour
  spot: string; // edge-spot colour
  text: string; // value colour on the cream inlay
  spots: number; // number of edge spots
  hw: number; // half-width of each edge spot in degrees
  lip: string; // colour of the visible chip edge
  shadow: number; // opacity of the inked crescent shadow on the face
}

// Muted casino set. The 1 is clearly WHITE with narrow dark-navy spots so it
// never reads as the blue 10 at 40px (polish #3).
export const CHIP_STYLES: Record<number, ChipStyle> = {
  1: { body: '#f3eee2', spot: '#1f3864', text: '#1f3864', spots: 8, hw: 5.5, lip: '#cfc7b4', shadow: 0.35 },
  5: { body: '#b23b30', spot: '#f3ecdc', text: '#9a2f25', spots: 6, hw: 13, lip: '', shadow: 0.7 },
  10: { body: '#2f5689', spot: '#f3ecdc', text: '#25466f', spots: 6, hw: 13, lip: '', shadow: 0.7 },
  25: { body: '#3a7a4d', spot: '#f3ecdc', text: '#2b633c', spots: 8, hw: 10.5, lip: '', shadow: 0.7 },
  100: { body: '#26211d', spot: '#f3ecdc', text: '#26211d', spots: 8, hw: 10.5, lip: '', shadow: 0.7 },
  500: { body: '#5f3f86', spot: '#f3ecdc', text: '#4f3373', spots: 8, hw: 10.5, lip: '', shadow: 0.7 },
  1000: { body: '#d69a36', spot: '#2a211a', text: '#7a4a12', spots: 8, hw: 10.5, lip: '', shadow: 0.6 },
};
export const DENOMINATIONS = [1, 5, 10, 25, 100, 500, 1000] as const;

/** Style of the nearest lower standard denomination (values < 1 use the 1). */
export function chipStyle(value: number): ChipStyle {
  let d: number = DENOMINATIONS[0];
  for (const x of DENOMINATIONS) if (value >= x) d = x;
  return CHIP_STYLES[d];
}
const lipColor = (c: ChipStyle) => c.lip || shade(c.body, 0.72);

/** Text printed on the inlay. Very large values are abbreviated (12500 -> 12.5K). */
export function chipLabel(value: number): string {
  if (value >= 10000) return `${Math.round(value / 100) / 10}K`;
  return String(value);
}

function sector(cx: number, cy: number, r1: number, r2: number, a0: number, a1: number, R: Rand): string {
  const p = (r: number, a: number) =>
    `${f(cx + r * Math.cos(rad(a)) + (R() - 0.5) * 0.5)},${f(cy + r * Math.sin(rad(a)) + (R() - 0.5) * 0.5)}`;
  return `M${p(r2, a0)}A${r2},${r2} 0 0 1 ${p(r2, a1)}L${p(r1, a1)}A${r1},${r1} 0 0 0 ${p(r1, a0)}Z`;
}

// Top face of a chip in local coords: centre (0,0), radius 44. Wobble is kept
// low here so 40px chips stay crisp.
function chipFace(value: number, rot: number, R: Rand): string {
  const c = chipStyle(value);
  const face = wobblyCircle(0, 0, 44, R, 0.45);
  let spots = '';
  for (let k = 0; k < c.spots; k++) {
    const a = rot + (k * 360) / c.spots;
    spots += sector(0, 0, 31, 44.6, a - c.hw, a + c.hw, R);
  }
  const label = chipLabel(value);
  const n = label.length;
  // Larger numerals on the big denominations (polish #3).
  const fs = n >= 5 ? 17 : n === 4 ? 20 : n === 3 ? 23 : 25;
  const fit = n >= 3 ? ` textLength="${n >= 4 ? 41 : 37}" lengthAdjust="spacingAndGlyphs"` : '';
  const inlay = wobblyCircle(0, 0, 25, R, 0.35, 20);
  return (
    `<path d="${face}" fill="${c.body}"/>` +
    `<path d="${spots}" fill="${c.spot}" stroke="${INK}" stroke-width=".7" stroke-opacity=".5"/>` +
    `<g clip-path="url(#§chip-clip)"><path d="${circ(0, 0, 46)}${circ(-6, -7, 43)}" fill-rule="evenodd" fill="url(#§hatch)" opacity="${c.shadow}"/></g>` +
    ink(wobblyCircle(0, 0, 30.6, R, 0.35, 22), 1.1, ' opacity=".85"') +
    `<circle r="28" fill="none" stroke="${c.spot}" stroke-width="1.8" stroke-dasharray="3.2 2.6" opacity=".85"/>` +
    `<path d="${inlay}" fill="#f8f1df"/><path d="${inlay}" fill="url(#§grain)"/>` +
    `<path d="${circ(4, 4, 22.5)}${circ(1, 1, 22.5)}" fill-rule="evenodd" fill="url(#§hatch)" opacity=".2"/>` +
    ink(inlay, 1.1) +
    `<text y="${f(fs * 0.36)}" text-anchor="middle" font-family="${CHIP_FONT}" font-size="${fs}" font-weight="700" fill="${c.text}"${fit}>${label}</text>` +
    `<path d="M-35,-17 C-30,-29 -20,-36 -8,-39" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".38"/>` +
    sketchOutline(face, wobblyCircle(0, 0, 44.3, R, 0.8), 1.8, 0.3)
  );
}

export const CHIP_VIEW = { x: -50, y: -49, w: 106, h: 108 };

/** Top-down chip with a visible edge lip and a baked contact shadow. */
export function chipSVG(value: number): string {
  const R = rng(`chip-${value}`);
  const c = chipStyle(value);
  const rot = R() * 40;
  const lip = wobblyCircle(0, 5.5, 44, R, 0.45);
  let lipSpots = '';
  for (let k = 0; k < c.spots; k++) {
    const a = rot + (k * 360) / c.spots;
    lipSpots += sector(0, 5.5, 31, 44.6, a - c.hw, a + c.hw, R);
  }
  const body =
    `<ellipse cx="4" cy="10" rx="49" ry="47" fill="url(#§shadow)"/>` +
    `<path d="${lip}" fill="${lipColor(c)}"/>` +
    `<path d="${lipSpots}" fill="${shade(c.spot, 0.82)}"/>` +
    ink(lip, 1.8) +
    chipFace(value, rot, R);
  const v = CHIP_VIEW;
  return wrapSVG(`pkchip${value}`.replace('.', '_'), `${v.x} ${v.y} ${v.w} ${v.h}`, body, `${value} chip`);
}

// ---------------------------------------------------------------- stacks
const SR = 44, SRY = 18.5, ST = 7.5;
const stackHeight = (n: number) => (n - 1) * ST + ST + SRY + 34;
export const STACK_W = 124;
export const stackAspect = (count: number): number => STACK_W / stackHeight(Math.max(1, Math.floor(count)));

/** A stack of chips seen at an angle. values[0] is the bottom chip. */
export function chipStackSVG(values: number[], key: string): string {
  const R = rng(`stack-${key}`);
  const n = values.length;
  if (n === 0) return wrapSVG('pkst0', `0 0 ${STACK_W} ${stackHeight(1)}`, '', 'empty stack');
  const pt = (cx: number, cy: number, a: number) => `${f(cx + SR * Math.cos(rad(a)))},${f(cy + SRY * Math.sin(rad(a)))}`;
  let out = `<ellipse cx="10" cy="${f((n - 1) * ST + ST + 6)}" rx="58" ry="25" fill="url(#§shadow)"/>`;
  values.forEach((v, i) => {
    const c = chipStyle(v);
    const cx = (R() - 0.5) * 3.2, cy = (n - 1 - i) * ST;
    const rot = R() * 360;
    const side =
      `M${f(cx - SR)},${f(cy)}L${f(cx - SR)},${f(cy + ST)}A${SR},${SRY} 0 0 0 ${f(cx + SR)},${f(cy + ST)}` +
      `L${f(cx + SR)},${f(cy)}A${SR},${SRY} 0 0 1 ${f(cx - SR)},${f(cy)}Z`;
    let stripes = '';
    for (let k = 0; k < c.spots; k++) {
      const a = (((rot + (k * 360) / c.spots) % 360) + 360) % 360;
      const lo = Math.max(0, a - c.hw), hi = Math.min(180, a + c.hw);
      if (hi <= lo) continue;
      const top = [0, 1, 2, 3].map((j) => pt(cx, cy, lo + ((hi - lo) * j) / 3));
      const bot = [3, 2, 1, 0].map((j) => pt(cx, cy + ST, lo + ((hi - lo) * j) / 3));
      stripes += `M${top.join('L')}L${bot.join('L')}Z`;
    }
    out +=
      `<path d="${side}" fill="${c.lip ? c.lip : shade(c.body, 0.85)}"/>` +
      (stripes ? `<path d="${stripes}" fill="${shade(c.spot, 0.9)}"/>` : '') +
      `<path d="${side}" fill="url(#§cyl)"/>` + ink(side, 1.3);
    if (i === n - 1) {
      out += `<g transform="translate(${f(cx)},${f(cy)}) scale(1,${Math.round((SRY / SR) * 1000) / 1000})">${chipFace(v, rot, R)}</g>`;
    } else {
      const e = wobblyEllipse(cx, cy, SR, SRY, R, 0.3);
      out += `<path d="${e}" fill="${c.body}"/>` + ink(e, 1.2);
    }
  });
  return wrapSVG(`pkst${n}`, `-56 ${f(-SRY - 3)} ${STACK_W} ${f(stackHeight(n))}`, out, `stack of ${n} chips`);
}

// ---------------------------------------------------------------- dealer button
export const DEALER_VIEW = { x: -50, y: -49, w: 106, h: 112 };

/** White "DEALER" puck in the hand-inked style, with visible edge thickness. */
export function dealerButtonSVG(): string {
  const R = rng('dealer-button');
  const T = 8; // edge thickness
  const lip = wobblyCircle(0, T, 44, R, 0.5);
  const face = wobblyCircle(0, 0, 44, R, 0.5);
  // side band between the face and the offset lip
  const band = `M-44,0L-44,${T}A44,44 0 0 0 44,${T}L44,0A44,44 0 0 1 -44,0Z`;
  let ticks = '';
  for (let i = 0; i < 24; i++) {
    const a = rad(i * 15 + 3);
    const x = 44 * Math.cos(a);
    if (Math.sin(a) <= 0.05) continue;
    const y = 44 * Math.sin(a);
    ticks += `M${f(x)},${f(y + 1.5)}L${f(x)},${f(y + T - 1.2)}`;
  }
  const star = (x: number, y: number, r: number) =>
    `M${f(x)},${f(y - r)}L${f(x + r * 0.32)},${f(y - r * 0.32)}L${f(x + r)},${f(y)}L${f(x + r * 0.32)},${f(y + r * 0.32)}` +
    `L${f(x)},${f(y + r)}L${f(x - r * 0.32)},${f(y + r * 0.32)}L${f(x - r)},${f(y)}L${f(x - r * 0.32)},${f(y - r * 0.32)}Z`;
  const body =
    `<ellipse cx="4" cy="${T + 5}" rx="50" ry="47" fill="url(#§shadow)"/>` +
    `<path d="${lip}" fill="#cbc2ae"/>` +
    `<path d="${band}" fill="#ddd5c2"/><path d="${band}" fill="url(#§cyl)" opacity=".7"/>` +
    `<path d="${ticks}" stroke="${INK}" stroke-width=".8" opacity=".35"/>` +
    ink(lip, 1.8) +
    `<path d="${face}" fill="#f8f3e6"/><path d="${face}" fill="url(#§grain)"/><path d="${face}" fill="url(#§tone)"/>` +
    `<clipPath id="§dclip"><path d="${face}"/></clipPath>` +
    `<g clip-path="url(#§dclip)"><path d="${circ(0, 0, 46)}${circ(-6, -7, 43)}" fill-rule="evenodd" fill="url(#§hatch)" opacity=".35"/></g>` +
    ink(wobblyCircle(0, 0, 37.5, R, 0.4, 24), 1.4) +
    ink(wobblyCircle(0, 0, 34, R, 0.3, 24), 0.7, ' opacity=".6"') +
    `<text y="6.3" text-anchor="middle" font-family="${INDEX_FONT}" font-size="17.5" font-weight="700" fill="${INK}" ` +
    `textLength="56" lengthAdjust="spacingAndGlyphs">DEALER</text>` +
    `<path d="${star(0, -21, 5.5)}" fill="${SUIT_RED}" stroke="${INK}" stroke-width=".8"/>` +
    `<path d="${star(0, 21, 5.5)}" fill="${SUIT_RED}" stroke="${INK}" stroke-width=".8"/>` +
    `<path d="M-35,-17 C-30,-29 -20,-36 -8,-39" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>` +
    sketchOutline(face, wobblyCircle(0, 0, 44.3, R, 0.9), 1.9, 0.5);
  const v = DEALER_VIEW;
  return wrapSVG('pkdealer', `${v.x} ${v.y} ${v.w} ${v.h}`, body, 'dealer button');
}

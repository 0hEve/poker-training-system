// Playing cards: faces (52) and the oxblood back. viewBox 0 0 252 352 — the
// face is 246x346 (2.5:3.5) at (2,2) and a 3-unit slab peeks out bottom-right
// as card thickness. Face centre is (125,175).
import {
  COURT_BLUE, COURT_RED, CREAM, GOLD, INDEX_FONT, INK, LEAF, OXBLOOD, PAPER, PAPER_SLAB, SKIN, STEEL,
  SUIT_BLACK, SUIT_PATHS, SUIT_RED, WOOD,
  bbox, circ, f, ink, isRedSuit, jit, rng, shade, sketchOutline, wobblyEllipse, wobblyRRect, wrapSVG,
  type Rand, type SuitKey,
} from './core';

export const CARD_W = 252;
export const CARD_H = 352;
const CX = 125, CY = 175;
const ROT = `rotate(180 ${CX} ${CY})`;

const SUITS: SuitKey[] = ['S', 'H', 'D', 'C'];
const SUIT_NAMES: Record<SuitKey, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
type Rank = (typeof RANKS)[number];
type Court = 'J' | 'Q' | 'K';

const pip = (s: SuitKey, cx: number, cy: number, size: number, flip = false): string => {
  const b = (size * 112) / 100;
  return (
    `<use href="#§s-${s}" x="${f(cx - b / 2)}" y="${f(cy - b / 2)}" width="${f(b)}" height="${f(b)}"` +
    (flip ? ` transform="rotate(180 ${f(cx)} ${f(cy)})"` : '') + `/>`
  );
};

// [column, rowFraction] — standard (Anglo-American) pip layouts
const L = 0, C = 1, Rt = 2;
const LAYOUT: Record<string, [number, number][]> = {
  '2': [[C, 0], [C, 1]],
  '3': [[C, 0], [C, 0.5], [C, 1]],
  '4': [[L, 0], [Rt, 0], [L, 1], [Rt, 1]],
  '5': [[L, 0], [Rt, 0], [C, 0.5], [L, 1], [Rt, 1]],
  '6': [[L, 0], [Rt, 0], [L, 0.5], [Rt, 0.5], [L, 1], [Rt, 1]],
  '7': [[L, 0], [Rt, 0], [C, 0.25], [L, 0.5], [Rt, 0.5], [L, 1], [Rt, 1]],
  '8': [[L, 0], [Rt, 0], [C, 0.25], [L, 0.5], [Rt, 0.5], [C, 0.75], [L, 1], [Rt, 1]],
  '9': [[L, 0], [Rt, 0], [L, 1 / 3], [Rt, 1 / 3], [C, 0.5], [L, 2 / 3], [Rt, 2 / 3], [L, 1], [Rt, 1]],
  '10': [[L, 0], [Rt, 0], [C, 1 / 6], [L, 1 / 3], [Rt, 1 / 3], [L, 2 / 3], [Rt, 2 / 3], [C, 5 / 6], [L, 1], [Rt, 1]],
};
// Pip field pulled in from the corner indices for clear spacing (polish #5).
const COLX = [79, CX, 171], Y0 = 80, Y1 = 270, PIP = 43;

const pips = (rank: string, s: SuitKey): string =>
  LAYOUT[rank].map(([col, fr]) => pip(s, COLX[col], Y0 + fr * (Y1 - Y0), PIP, fr > 0.5)).join('');

// ---------------------------------------------------------------- aces
function aceArt(s: SuitKey, R: Rand): { art: string; defs: string } {
  if (s !== 'S') return { art: pip(s, CX, CY, 100), defs: '' };
  // Ornate Ace of Spades with engraved line work (polish #4).
  const tf = (k: number, dy = 0) => `transform="translate(${CX},${CY + dy}) scale(${k}) translate(-50,-50)"`;
  let dots = '';
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    dots += circ(CX + 96 * Math.cos(a), CY + 96 * Math.sin(a) * 1.08, i % 2 ? 1.1 : 1.9);
  }
  const outer = wobblyEllipse(CX, CY, 88, 95, R, 0.9);
  const scroll = jit(
    'M125,262 C110,262 98,270 90,280 C82,290 70,290 66,282 C62,274 70,266 78,272 M125,262 C140,262 152,270 160,280 C168,290 180,290 184,282 C188,274 180,266 172,272',
    R, 0.4,
  );
  const crown = jit('M104,88 L101,68 L113,78 L125,58 L137,78 L149,68 L146,88 Z', R, 0.35);
  const defsMk =
    `<clipPath id="§ace-sp"><path d="${SUIT_PATHS.S}" ${tf(1.5, 4)}/></clipPath>` +
    `<clipPath id="§ace-crown"><path d="${crown}"/></clipPath>`;
  const art =
    `<path d="${dots}" fill="${INK}" opacity=".7"/>` +
    // engraved band inside the cartouche (between two ellipses)
    `<path d="M${CX - 88},${CY}a88,95 0 1 0 176,0a88,95 0 1 0 -176,0ZM${CX - 79},${CY}a79,86 0 1 0 158,0a79,86 0 1 0 -158,0Z" fill="url(#§eng)" fill-rule="evenodd" opacity=".55"/>` +
    ink(outer, 1.3, ' opacity=".8"') +
    ink(wobblyEllipse(CX, CY, 79, 86, R, 0.7), 0.9, ' opacity=".6"') +
    `<path d="${scroll}" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>` +
    pip('S', CX, CY + 4, 150) +
    `<g clip-path="url(#§ace-sp)">` +
    `<ellipse cx="96" cy="150" rx="46" ry="56" fill="url(#§eng-l)" opacity=".5"/>` +
    `<ellipse cx="166" cy="232" rx="30" ry="22" fill="url(#§eng-l)" opacity=".25"/>` +
    `</g>` +
    `<path d="${SUIT_PATHS.S}" fill="none" stroke="${PAPER}" stroke-width="${f(1.4 / 1.25)}" ${tf(1.25, 4)} opacity=".45"/>` +
    `<path d="${SUIT_PATHS.S}" fill="none" stroke="${PAPER}" stroke-width="${f(2.4 / 0.98)}" ${tf(0.98, 4)} opacity=".9"/>` +
    `<path d="${SUIT_PATHS.S}" fill="none" stroke="${GOLD}" stroke-width="${f(1.8 / 0.6)}" stroke-dasharray="${f(3 / 0.6)} ${f(2.5 / 0.6)}" ${tf(0.6, 4)}/>` +
    `<circle cx="${CX}" cy="${CY + 10}" r="7" fill="${GOLD}" stroke="${PAPER}" stroke-width="1.6"/>` +
    `<path d="${crown}" fill="${GOLD}"/>` +
    `<g clip-path="url(#§ace-crown)"><ellipse cx="146" cy="86" rx="26" ry="18" fill="url(#§eng)"/></g>` +
    ink(crown, 1.6) +
    `<path d="${circ(125, 56, 3)}${circ(101, 66, 2.3)}${circ(149, 66, 2.3)}" fill="${GOLD}" stroke="${INK}" stroke-width="1.1"/>`;
  return { art, defs: defsMk };
}

// ---------------------------------------------------------------- courts
// Muted court palette (polish #1).
const COURT_PAL: Record<Court, { robe: string; panel: string; band: string; collar: string; hair: string }> = {
  K: { robe: COURT_RED, panel: COURT_BLUE, band: GOLD, collar: CREAM, hair: '#6e4a2d' },
  Q: { robe: COURT_BLUE, panel: COURT_RED, band: GOLD, collar: GOLD, hair: '#7b4a2b' },
  J: { robe: GOLD, panel: COURT_RED, band: COURT_BLUE, collar: CREAM, hair: '#5a3a21' },
};

/**
 * Top half of a double-headed court figure (bottom half is the same group
 * rotated 180°). Silhouettes are kept bold — crown, rose, plumed cap, sword,
 * halberd — so they still read at 70px wide (polish #5). Shading uses fine
 * engraved hatching clipped to each shape (polish #4).
 */
function courtHalf(rank: Court, s: SuitKey, R: Rand): { half: string; clips: string } {
  const pal = COURT_PAL[rank];
  let clips = '';
  let clipN = 0;
  type Sh = { shadeR?: boolean; shadeL?: boolean; w?: number; cross?: boolean };
  const sh = (d: string, fill: string, { shadeR = false, shadeL = false, w = 1.9, cross = false }: Sh = {}): string => {
    const dj = jit(d, R, 0.6);
    if (!(shadeR || shadeL)) return `<path d="${dj}" fill="${fill}"/>` + ink(dj, w);
    // shaded shapes: define the path once, reuse it for fill, clip and outline
    const id = `cc${clipN++}`;
    clips += `<path id="§p${id}" d="${dj}"/><clipPath id="§${id}"><use href="#§p${id}"/></clipPath>`;
    let out = `<use href="#§p${id}" fill="${fill}"/>`;
    {
      const b = bbox(dj), w2 = b.x1 - b.x0, h2 = b.y1 - b.y0;
      let g = '';
      if (shadeR) g += `<ellipse cx="${f(b.x1 + w2 * 0.08)}" cy="${f(b.y1)}" rx="${f(w2 * 0.5)}" ry="${f(h2 * 0.95)}" fill="url(#§eng)"/>`;
      if (shadeL) g += `<ellipse cx="${f(b.x0 - w2 * 0.02)}" cy="${f(b.y1)}" rx="${f(w2 * 0.2)}" ry="${f(h2 * 0.9)}" fill="url(#§eng)"/>`;
      if (cross) g += `<ellipse cx="${f(b.x1)}" cy="${f(b.y1)}" rx="${f(w2 * 0.22)}" ry="${f(h2 * 0.55)}" fill="url(#§eng2)"/>`;
      out += `<g clip-path="url(#§${id})">${g}</g>`;
    }
    return out + `<use href="#§p${id}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"/>`;
  };
  const dot = (x: number, y: number, r: number, fill: string, w = 1.2) =>
    `<path d="${circ(x, y, r)}" fill="${fill}" stroke="${INK}" stroke-width="${w}"/>`;

  let back = '', front = '', hairBack = '', top = '';
  if (rank === 'K') {
    // broad sword behind the shoulder, gold cross-guard in the fist
    back = sh('M76,150 L86,150 L86,60 L81,44 L76,60 Z', STEEL, { shadeR: true }) + ink('M81,58 L81,142', 0.9, ' opacity=".5"');
    front =
      sh('M64,146 L98,146 L98,155 L64,155 Z', GOLD, { shadeR: true }) +
      sh('M77,155 L85,155 L85,168 L77,168 Z', WOOD) +
      dot(81, 172, 3.6, GOLD) + dot(81, 160, 6.5, SKIN, 1.5);
    top =
      sh('M106,96 C105,118 115,130 125,132 C135,130 145,118 144,96 C140,105 134,109 125,109 C116,109 110,105 106,96 Z', pal.hair, { shadeR: true }) +
      sh('M114,101 C119,97 123,99 125,101 C127,99 131,97 136,101 C131,105 127,104 125,103 C123,104 119,105 114,101 Z', pal.hair) +
      sh('M107,77 C101,87 101,99 106,107 L110,95 Z', pal.hair) + sh('M143,77 C149,87 149,99 144,107 L140,95 Z', pal.hair) +
      // tall five-point crown: the K silhouette
      sh('M99,72 L97,46 L111,59 L125,34 L139,59 L153,46 L151,72 Z', GOLD, { shadeR: true }) +
      sh('M97,65 L153,65 L153,75 L97,75 Z', GOLD, { shadeR: true }) +
      dot(125, 55, 4, SUIT_RED) + dot(125, 70, 2.6, COURT_BLUE) +
      dot(97, 44, 3.2, GOLD) + dot(125, 32, 3.4, GOLD) + dot(153, 44, 3.2, GOLD);
  } else if (rank === 'Q') {
    hairBack =
      sh('M104,78 C94,96 97,124 88,143 C102,143 110,133 112,120 C107,106 106,92 110,80 Z', pal.hair, { shadeL: true }) +
      sh('M146,78 C156,96 153,124 162,143 C148,143 140,133 138,120 C143,106 144,92 140,80 Z', pal.hair, { shadeR: true });
    // the rose: big bloom, bold stem and two leaves
    const stem = 'M168,174 C166,152 162,134 160,118';
    front =
      `<path d="${jit(stem, R, 0.4)}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` +
      `<path d="${jit(stem, R, 0.1)}" fill="none" stroke="${LEAF}" stroke-width="2.6"/>` +
      sh('M163,144 C172,133 183,134 187,140 C178,145 170,146 163,144 Z', LEAF) +
      sh('M161,132 C152,124 143,127 141,132 C149,135 155,135 161,132 Z', LEAF) +
      dot(160, 106, 13, SUIT_RED, 1.8) +
      ink(jit('M160,106 C164,102 168,108 163,112 C155,115 151,106 156,100 C162,94 172,99 172,107', R, 0.3), 1.4) +
      dot(167, 160, 6.5, SKIN, 1.5);
    top =
      sh('M107,80 C110,67 140,67 143,80 C134,74 116,74 107,80 Z', pal.hair) +
      // arched coronet with three orbs
      sh('M104,74 L104,56 C109,48 117,48 119,57 C120,43 130,43 131,57 C133,48 141,48 146,56 L146,74 Z', GOLD, { shadeR: true }) +
      sh('M103,66 L147,66 L147,75 L103,75 Z', GOLD, { shadeR: true }) +
      dot(125, 61, 3.4, SUIT_RED) + dot(125, 40, 3.2, CREAM) + dot(110, 48, 2.6, CREAM) + dot(140, 48, 2.6, CREAM);
  } else {
    // halberd: long shaft, broad axe blade, spear point and back spike
    back =
      sh('M173,175 L179,175 L179,52 L173,52 Z', WOOD) +
      sh('M179,56 L199,44 C206,60 206,78 199,90 L179,76 Z', STEEL, { shadeR: true }) +
      sh('M173,62 L161,67 L173,72 Z', STEEL) +
      sh('M172,54 L176,34 L180,54 Z', STEEL);
    front = dot(176, 158, 6.5, SKIN, 1.5);
    hairBack = dot(107, 90, 6.5, pal.hair) + dot(106, 102, 5.5, pal.hair) + dot(143, 90, 6.5, pal.hair) + dot(144, 102, 5.5, pal.hair);
    top =
      ink(jit('M118,101 C121,99 124,100 125,101 C126,100 129,99 132,101', R, 0.2), 1.5) +
      // big sweeping plume on the cap
      sh('M144,64 C150,42 172,32 196,40 C184,44 170,52 156,70 Z', COURT_BLUE, { shadeR: true }) +
      ink(jit('M149,64 C158,50 172,42 190,41', R, 0.3), 1.1) +
      sh('M99,75 C94,57 111,47 128,49 C147,51 160,61 153,75 Z', COURT_RED, { shadeR: true }) +
      sh('M97,67 L155,67 L155,76 L97,76 Z', GOLD, { shadeR: true }) + dot(126, 71.5, 2.6, COURT_BLUE);
  }
  const face = jit('M125,64 C137,64 143,75 143,88 C143,102 135,111 125,111 C115,111 107,102 107,88 C107,75 113,64 125,64 Z', R, 0.4);
  clips += `<clipPath id="§face"><path d="${face}"/></clipPath>`;
  const pipX = rank === 'K' ? 186 : 64;
  const half =
    back +
    sh('M46,175 L46,141 C52,131 76,127 102,124 L148,124 C174,127 198,131 204,141 L204,175 Z', pal.robe, { shadeR: true, shadeL: true, cross: true }) +
    ink(jit('M72,175 C72,158 76,144 84,136 M178,175 C178,158 174,144 166,136', R, 0.5), 1.3, ' opacity=".7"') +
    sh('M108,126 L142,126 L150,175 L100,175 Z', pal.panel, { shadeR: true }) +
    sh('M46,158 C90,150 160,150 204,158 L204,167 C160,159 90,159 46,167 Z', pal.band) +
    sh('M117,103 L133,103 L134,124 L116,124 Z', SKIN, { shadeR: true }) +
    sh('M99,124 C108,136 142,136 151,124 C144,118 106,118 99,124 Z', pal.collar) +
    hairBack +
    `<path d="${face}" fill="${SKIN}"/>` +
    `<g clip-path="url(#§face)"><ellipse cx="146" cy="104" rx="15" ry="30" fill="url(#§eng)" opacity=".55"/></g>` +
    ink(face, 1.8) +
    ink(jit('M112,80 Q117,77 121,79 M129,79 Q133,77 138,80', R, 0.3), 1.5) +
    `<path d="${circ(117, 87.6, 1.9)}${circ(133, 87.6, 1.9)}" fill="${INK}"/>` +
    ink(jit('M125,88 Q122,96 127,97', R, 0.3), 1.3) +
    ink(jit('M120,103 Q125,105.5 130,103', R, 0.2), 1.4) +
    `<path d="${circ(114, 96, 3.5)}${circ(136, 96, 3.5)}" fill="${SUIT_RED}" opacity=".2"/>` +
    top + front +
    pip(s, pipX, 56, 24);
  return { half, clips };
}

// ---------------------------------------------------------------- frame
function index(rank: Rank, s: SuitKey): string {
  const col = isRedSuit(s) ? SUIT_RED : SUIT_BLACK;
  // Larger indices (polish #5); "10" is condensed to fit the same column.
  const ten = rank === '10';
  const fit = ten ? ' textLength="41" lengthAdjust="spacingAndGlyphs"' : '';
  return (
    `<text x="26" y="53" text-anchor="middle" font-family="${INDEX_FONT}" font-size="${ten ? 44 : 46}" font-weight="700" ` +
    `fill="${col}" stroke="${col}" stroke-width=".9" stroke-linejoin="round"${fit}>${rank}</text>` +
    pip(s, 26, 79, 27)
  );
}

function cardShell(R: Rand, inner: string): string {
  // More wobble + stronger second sketch line than the sample (polish #2).
  const body = wobblyRRect(2, 2, 246, 346, 13, R, 0.85);
  const slab = wobblyRRect(5, 5.5, 246, 346, 13, R, 0.6);
  const sketch = wobblyRRect(2.4, 2.2, 245.4, 345.6, 13, R, 1.7);
  const stroke = (id: string, w: number, extra = '') =>
    `<use href="#§${id}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"${extra}/>`;
  return (
    `<defs><path id="§bd" d="${body}"/><path id="§sl" d="${slab}"/></defs>` +
    `<use href="#§sl" fill="${PAPER_SLAB}"/>` + stroke('sl', 1.5) +
    `<use href="#§bd" fill="${PAPER}"/><use href="#§bd" fill="url(#§grain)"/><use href="#§bd" fill="url(#§tone)"/>` +
    inner +
    stroke('bd', 2.3) + ink(sketch, 2.3 * 0.62, ' opacity=".64"')
  );
}

/** Standalone SVG for card int 0..51 (rank = card >> 2, suit = card & 3). */
export function cardFaceSVG(card: number): string {
  const rk = RANKS[card >> 2];
  const s = SUITS[card & 3];
  const R = rng(`card-${rk}${s}`);
  let art: string;
  let extraDefs = '';
  if (rk === 'A') {
    const a = aceArt(s, R);
    art = a.art;
    extraDefs = a.defs;
  } else if (LAYOUT[rk]) {
    art = pips(rk, s);
  } else {
    const frame = wobblyRRect(44, 40, 162, 270, 6, R, 0.6);
    const { half, clips } = courtHalf(rk as Court, s, R);
    extraDefs = clips + `<g id="§half">${half}</g>`;
    // Court art is scaled to 90% about the centre so the larger indices clear it.
    art =
      `<g transform="translate(${CX} ${CY}) scale(.9) translate(${-CX} ${-CY})">` +
      `<path d="${frame}" fill="#ecdcb6" opacity=".6"/>` +
      `<use href="#§half"/><use href="#§half" transform="${ROT}"/>` +
      ink(jit('M45,175 L205,175', R, 0.7), 1.8) + ink(frame, 2) +
      `</g>`;
  }
  const idx = index(rk, s);
  const inner = art + idx + `<g transform="${ROT}">${idx}</g>`;
  const label = `${RANK_NAMES[card >> 2]} of ${SUIT_NAMES[s]}`;
  return wrapSVG(`pkc${card}`, `0 0 ${CARD_W} ${CARD_H}`, cardShell(R, inner), label, { extraDefs });
}

/** Deep oxblood back with a fine double lattice and a cream medallion. */
export function cardBackSVG(): string {
  const R = rng('back-oxblood');
  const color = OXBLOOD;
  const gilt = '#e2c58c';
  let lat = '', lat2 = '';
  for (let k = -340; k <= 240; k += 13) {
    const j = () => (R() - 0.5) * 1.2;
    lat += `M${k},0Q${f(k + 175 + j())},${f(175 + j())} ${k + 350},350`;
    lat += `M${k + 350},0Q${f(k + 175 + j())},${f(175 + j())} ${k},350`;
    lat2 += `M${f(k + 2.6)},0L${f(k + 352.6)},350M${f(k + 347.4)},0L${f(k - 2.6)},350`;
  }
  const panel = wobblyRRect(16, 16, 220, 318, 9, R, 0.6);
  const innerB = wobblyRRect(25, 25, 202, 300, 6, R, 0.6);
  const innerB2 = wobblyRRect(29, 29, 194, 292, 5, R, 0.5);
  const med = wobblyEllipse(CX, CY, 54, 72, R, 0.8);
  let beads = '';
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    beads += circ(CX + 62 * Math.cos(a), CY + 80 * Math.sin(a), i % 3 === 0 ? 1.9 : 1.1);
  }
  let corners = '';
  for (const [x, y] of [[42, 42], [208, 42], [42, 308], [208, 308]]) {
    corners += `M${x},${y - 8}L${x + 6},${y}L${x},${y + 8}L${x - 6},${y}Z`;
  }
  const inner =
    `<path d="${panel}" fill="${color}"/>` +
    `<g clip-path="url(#§back-clip)">` +
    `<path d="${lat}" fill="none" stroke="${gilt}" stroke-width=".95" opacity=".42"/>` +
    `<path d="${lat2}" fill="none" stroke="${gilt}" stroke-width=".45" opacity=".26"/>` +
    `<rect x="16" y="16" width="220" height="318" fill="url(#§studs)" opacity=".5"/>` +
    `<rect x="16" y="16" width="220" height="318" fill="url(#§hatch)" opacity=".18"/>` +
    `<ellipse cx="200" cy="300" rx="150" ry="170" fill="url(#§eng)" opacity=".35"/>` +
    `</g>` +
    `<path d="${innerB}" fill="none" stroke="${gilt}" stroke-width="1.7" opacity=".85"/>` +
    `<path d="${innerB2}" fill="none" stroke="${gilt}" stroke-width=".7" stroke-dasharray="3 2.4" opacity=".7"/>` +
    `<path d="${corners}" fill="${GOLD}" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>` +
    `<ellipse cx="${CX}" cy="${CY}" rx="62" ry="80" fill="${shade(color, 0.78)}" opacity=".7"/>` +
    `<path d="${beads}" fill="${gilt}" opacity=".85"/>` +
    `<path d="${med}" fill="${PAPER}"/><path d="${med}" fill="url(#§grain)"/>` +
    `<ellipse cx="${CX}" cy="${CY}" rx="45" ry="62" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="4 3"/>` +
    `<ellipse cx="${CX}" cy="${CY}" rx="40.5" ry="57" fill="none" stroke="${GOLD}" stroke-width="1"/>` +
    sketchOutline(med, wobblyEllipse(CX, CY, 54, 72, R, 1.5), 2.1, 1) +
    pip('S', CX, CY - 33, 25) + pip('H', CX + 24, CY, 25) + pip('C', CX, CY + 33, 25) + pip('D', CX - 24, CY, 25) +
    `<path d="${jit('M125,164 L128.5,171.5 L136,175 L128.5,178.5 L125,186 L121.5,178.5 L114,175 L121.5,171.5 Z', R, 0.2)}" fill="${GOLD}" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>` +
    ink(panel, 1.9);
  // tiny gilt studs on the lattice crossings (crossings fall every 6.5 units, alternating)
  const studs =
    `<pattern id="§studs" width="13" height="13" patternUnits="userSpaceOnUse" x="10.5" y="-0.5">` +
    `<circle cx="0" cy="0" r=".8" fill="${gilt}"/><circle cx="13" cy="0" r=".8" fill="${gilt}"/>` +
    `<circle cx="0" cy="13" r=".8" fill="${gilt}"/><circle cx="13" cy="13" r=".8" fill="${gilt}"/>` +
    `<circle cx="6.5" cy="6.5" r=".8" fill="${gilt}"/></pattern>`;
  return wrapSVG('pkback', `0 0 ${CARD_W} ${CARD_H}`, cardShell(R, inner), 'card back', { extraDefs: studs });
}

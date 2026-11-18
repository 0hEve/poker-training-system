/**
 * Combo and hand-class tables.
 * - 1326 two-card combos, index `comboIndex(a, b)`; COMBO_A/COMBO_B hold the cards (a < b).
 * - 169 starting-hand classes on a 13x13 grid: pairs on the diagonal (r*13+r),
 *   suited hi*13+lo (above), offsuit lo*13+hi (below), ranks 0 = deuce .. 12 = ace.
 */

export const NCOMBO = 1326;
export const COMBO_A = new Uint8Array(NCOMBO);
export const COMBO_B = new Uint8Array(NCOMBO);
/** comboIndex lookup for an ordered pair: PAIR_INDEX[a * 52 + b]. */
export const PAIR_INDEX = new Int16Array(52 * 52).fill(-1);
export const COMBO_CLASS = new Uint8Array(NCOMBO);
/** Bitmask of the two cards per combo, split into two 26-bit halves for collision checks. */
export const COMBO_LO = new Int32Array(NCOMBO);
export const COMBO_HI = new Int32Array(NCOMBO);

export function classOf(a: number, b: number): number {
  const ra = a >> 2;
  const rb = b >> 2;
  const hi = ra > rb ? ra : rb;
  const lo = ra > rb ? rb : ra;
  if (hi === lo) return hi * 13 + hi;
  return (a & 3) === (b & 3) ? hi * 13 + lo : lo * 13 + hi;
}

export const classIsPair = (c: number) => ((c / 13) | 0) === c % 13;
export const classIsSuited = (c: number) => ((c / 13) | 0) > c % 13;
export const classHi = (c: number) => Math.max((c / 13) | 0, c % 13);
export const classLo = (c: number) => Math.min((c / 13) | 0, c % 13);
/** Number of combos in a class (6 pair, 4 suited, 12 offsuit). */
export const classCombos = (c: number) => (classIsPair(c) ? 6 : classIsSuited(c) ? 4 : 12);

{
  let k = 0;
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++) {
      COMBO_A[k] = a;
      COMBO_B[k] = b;
      PAIR_INDEX[a * 52 + b] = k;
      PAIR_INDEX[b * 52 + a] = k;
      COMBO_CLASS[k] = classOf(a, b);
      for (const c of [a, b]) {
        if (c < 26) COMBO_LO[k] |= 1 << c;
        else COMBO_HI[k] |= 1 << (c - 26);
      }
      k++;
    }
}

export const comboIndex = (a: number, b: number) => PAIR_INDEX[a * 52 + b];

const R = '23456789TJQKA';
export function className(c: number): string {
  const hi = classHi(c);
  const lo = classLo(c);
  if (hi === lo) return R[hi] + R[lo];
  return R[hi] + R[lo] + (classIsSuited(c) ? 's' : 'o');
}

/** Parse "AKs", "77", "T9o" to a class index. */
export function parseClass(s: string): number {
  const a = R.indexOf(s[0]);
  const b = R.indexOf(s[1]);
  if (a < 0 || b < 0) throw new Error(`bad class ${s}`);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === lo) return hi * 13 + hi;
  return s[2] === 's' ? hi * 13 + lo : lo * 13 + hi;
}

/** Card set masks for fast "is this card dead" checks. */
export interface DeadSet {
  lo: number;
  hi: number;
}
export function deadAdd(d: DeadSet, c: number) {
  if (c < 26) d.lo |= 1 << c;
  else d.hi |= 1 << (c - 26);
}
export const deadHas = (d: DeadSet, c: number) => (c < 26 ? (d.lo >>> c) & 1 : (d.hi >>> (c - 26)) & 1) === 1;
export const comboBlocked = (d: DeadSet, k: number) => (d.lo & COMBO_LO[k]) !== 0 || (d.hi & COMBO_HI[k]) !== 0;

/** CARD_COMBOS[c * 51 + i]: the 51 combos that contain card c. */
export const CARD_COMBOS = new Int16Array(52 * 51);
{
  const fill = new Uint8Array(52);
  for (let k = 0; k < NCOMBO; k++) {
    const a = COMBO_A[k];
    const b = COMBO_B[k];
    CARD_COMBOS[a * 51 + fill[a]++] = k;
    CARD_COMBOS[b * 51 + fill[b]++] = k;
  }
}

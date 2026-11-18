import { newAcc, resetAcc, addCard, type CardAcc } from '../../../sim/eval';

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const classOf = (a: number, b: number) => {
  const high = Math.max(a >> 2, b >> 2);
  const low = Math.min(a >> 2, b >> 2);
  return ((a ^ b) & 3) === 0 ? high * 13 + low : low * 13 + high;
};

export const COMBOS = 1326;
export const FIRST = new Uint8Array(COMBOS);
export const SECOND = new Uint8Array(COMBOS);
export const CLASS = new Uint8Array(COMBOS);
export const CLASSES = Array.from({ length: 169 }, () => [] as number[]);
export const MASK_LO = new Int32Array(52);
export const MASK_HI = new Int32Array(52);
for (let a = 0, i = 0; a < 52; a++) {
  MASK_LO[a] = a < 32 ? 1 << a : 0;
  MASK_HI[a] = a >= 32 ? 1 << (a - 32) : 0;
  for (let b = a + 1; b < 52; b++, i++) {
    FIRST[i] = a;
    SECOND[i] = b;
    const id = classOf(a, b);
    CLASS[i] = id;
    CLASSES[id].push(i);
  }
}

export const HIGH = new Uint8Array(169);
export const LOW = new Uint8Array(169);
export const SUITED = new Uint8Array(169);
export const RATING = new Float32Array(169);
for (let id = 0; id < 169; id++) {
  const a = id % 13;
  const b = (id / 13) | 0;
  const hi = HIGH[id] = Math.max(a, b);
  const lo = LOW[id] = Math.min(a, b);
  const suited = SUITED[id] = Number(b > a);
  // Smooth continuation ordering. Nut potential and domination matter more than raw rank.
  RATING[id] = hi === lo
    ? 45 + hi * 4.15
    : hi * 3.35 + lo * 1.95 + suited * 8.2 + (hi === 12 ? 6 : 0)
      + Math.max(0, 4 - (hi - lo)) * (suited ? 1.5 : 0.65);
}

const WINDOWS = [0x100f, ...Array.from({ length: 9 }, (_, i) => 31 << i)];
const STRAIGHT_OUTS = new Uint16Array(8192);
const COUNT = new Uint8Array(8192);
for (let mask = 0; mask < 8192; mask++) {
  COUNT[mask] = (mask & 1) + COUNT[mask >> 1];
  let outs = 0;
  for (const window of WINDOWS) {
    const missing = window & ~mask;
    if ((missing & (missing - 1)) === 0) outs |= missing;
  }
  STRAIGHT_OUTS[mask] = outs;
}

export interface Texture {
  acc: CardAcc;
  length: number;
  ranks: number;
  high: number;
  second: number;
  paired: number;
  suit: number;
  suitCount: number;
  wet: number;
  boardStraight: boolean;
}

export function newTexture(): Texture {
  return { acc: newAcc(), length: 0, ranks: 0, high: 0, second: 0, paired: 0, suit: 0, suitCount: 0, wet: 0, boardStraight: false };
}

export function readTexture(t: Texture, board: readonly number[], length: number) {
  const acc = resetAcc(t.acc);
  let ranks = 0;
  let paired = 0;
  for (let i = 0; i < length; i++) {
    const card = board[i];
    const bit = 1 << (card >> 2);
    paired |= ranks & bit;
    ranks |= bit;
    addCard(acc, card);
  }
  t.length = length;
  t.ranks = ranks;
  t.high = 31 - Math.clz32(ranks);
  t.second = 31 - Math.clz32(ranks ^ (1 << t.high));
  t.paired = paired;
  t.suitCount = 0;
  for (let suit = 0; suit < 4; suit++) {
    const count = (acc.suitKey >> (4 * suit)) & 15;
    if (count > t.suitCount) {
      t.suit = suit;
      t.suitCount = count;
    }
  }
  let connected = 0;
  t.boardStraight = false;
  for (const window of WINDOWS) {
    const n = COUNT[window & ranks];
    if (n > connected) connected = n;
    if (n === 5) t.boardStraight = true;
  }
  t.wet = (connected >= 3 ? 0.38 + 0.22 * (connected - 3) : 0)
    + (t.suitCount === 2 ? 0.24 : t.suitCount >= 3 ? 0.56 : 0);
}

// Made-hand tiers. A pair or two pair already present on the board is discounted.
// Scores encode the actual ranks used, which matters when a board pair counterfeits a hand.
export function tierOf(t: Texture, a: number, b: number, score: number): number {
  const ra = a >> 2;
  const rb = b >> 2;
  const cat = score >> 20;
  const top = (score >> 16) & 15;
  const next = (score >> 12) & 15;
  if (cat >= 6) {
    if (cat === 6 && ra !== top && rb !== top && ra !== next && rb !== next) return 2;
    if (cat === 7 && ra !== top && rb !== top) return Math.max(ra, rb) === 12 ? 8 : 3;
    return 10;
  }
  if (cat === 5) {
    if (t.suitCount < 4) return 9;
    const suitRank = Math.max((a & 3) === t.suit ? ra : -1, (b & 3) === t.suit ? rb : -1);
    return suitRank >= 10 ? 9 : suitRank >= 6 ? 7 : t.suitCount === 5 ? 3 : 6;
  }
  if (cat === 4) return t.boardStraight ? (top > (t.ranks === 0x100f ? 3 : t.high) ? 9 : 2) : 8;
  if (cat === 3) {
    if (ra === top || rb === top) return 8;
    return next >= 11 ? 4 : 2;
  }
  if (cat === 2) {
    const usesTop = ra === top || rb === top;
    const usesNext = ra === next || rb === next;
    if (usesTop && usesNext) return 7;
    const improved = usesTop ? top : usesNext ? next : -1;
    if (improved < 0) return Math.max(ra, rb) >= 11 ? 2 : 1;
    if (ra === rb && ra > t.high) return 6;
    const boardHigh = 31 - Math.clz32(t.ranks & ~t.paired);
    return improved >= boardHigh ? 6 : improved >= t.second ? 5 : 4;
  }
  if (cat === 1) {
    if (ra !== top && rb !== top) return next >= 12 ? 2 : 1;
    if (top > t.high) return 6;
    if (top === t.high) return next >= 9 ? 6 : 5;
    if (top >= t.second) return 4;
    return 3;
  }
  return top === 12 && (ra === 12 || rb === 12) ? 2 : Math.max(ra, rb) >= 10 ? 1 : 0;
}

// 0: no immediate draw, 1: gutter, 2: open-ended/double gutter, 3: flush,
// 4: combination draw. Board-only draws carry no private-card premium.
export function drawOf(t: Texture, a: number, b: number, score: number): number {
  if (t.length === 5 || (score >> 20) >= 4) return 0;
  const acc = t.acc;
  const suitA = a & 3;
  const suitB = b & 3;
  const suitAOnBoard = (acc.suitKey >> (4 * suitA)) & 15;
  const flush = suitA === suitB ? suitAOnBoard === 2
    : suitAOnBoard === 3 || ((acc.suitKey >> (4 * suitB)) & 15) === 3;
  const ranks = t.ranks | (1 << (a >> 2)) | (1 << (b >> 2));
  const outs = COUNT[STRAIGHT_OUTS[ranks] & ~STRAIGHT_OUTS[t.ranks]];
  if (flush) return outs > 0 ? 4 : 3;
  return Math.min(2, outs);
}

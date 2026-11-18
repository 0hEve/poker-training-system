/**
 * Fast, allocation-free 5–7 card evaluator for simulations and bots.
 *
 * Scores are identical to `engine/evaluator.ts` (`category << 20 | tie-break nibbles`),
 * so results can be compared directly with the reference evaluator.
 *
 * How it works
 * - Every card contributes `POW5[rank]` to a rank key. With at most four cards per
 *   rank the key is a base-5 number below 5^13 (< 2^31), unique per rank multiset.
 *   Keys are additive, so a board key can be computed once and hole cards added later.
 * - Suit counts live in 4-bit nibbles of a suit key; `(suitKey + 0x3333) & 0x8888`
 *   is non-zero exactly when some suit has five or more cards.
 * - Non-flush hands: open-addressing table keyed by the rank key (all 5/6/7-card
 *   rank multisets, ~74k entries, built at module load in a few ms).
 * - Flush hands: an 8192-entry table indexed by the flush suit's 13-bit rank mask.
 *
 * Card encoding is the engine's: rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3.
 */

export const POW5 = new Int32Array(13);
for (let r = 0, p = 1; r < 13; r++, p *= 5) POW5[r] = p;

/** Per-card rank key, suit key and suit bit, indexed by card 0..51. */
export const CARD_RANK_KEY = new Int32Array(52);
export const CARD_SUIT_KEY = new Int32Array(52);
export const CARD_BIT = new Int32Array(52);
for (let c = 0; c < 52; c++) {
  CARD_RANK_KEY[c] = POW5[c >> 2];
  CARD_SUIT_KEY[c] = 1 << (4 * (c & 3));
  CARD_BIT[c] = 1 << (c >> 2);
}

const pack5 = (cat: number, a: number, b: number, c: number, d: number, e: number) =>
  (cat << 20) | (a << 16) | (b << 12) | (c << 8) | (d << 4) | e;

/** Highest straight in a 13-bit rank mask (3 = wheel) or -1. Same as the engine's. */
function straightHigh(mask: number): number {
  const m = (mask << 1) | ((mask >> 12) & 1);
  const run = m & (m << 1) & (m << 2) & (m << 3) & (m << 4);
  if (run === 0) return -1;
  return 31 - Math.clz32(run) - 1;
}

/** Top `n` set ranks of a mask packed into nibbles, highest first, left-aligned to `n` slots. */
function topRanks(mask: number, n: number, out: number[]): void {
  let k = 0;
  for (let r = 12; r >= 0 && k < n; r--) if (mask & (1 << r)) out[k++] = r;
  while (k < 5) out[k++] = 0;
}

const scratch = [0, 0, 0, 0, 0];

/** Score of a non-flush hand given rank counts (sum 5..7). */
function scoreFromCounts(counts: ArrayLike<number>): number {
  let rankMask = 0;
  let quad = -1;
  let trip1 = -1;
  let trip2 = -1;
  let pair1 = -1;
  let pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = counts[r];
    if (n === 0) continue;
    rankMask |= 1 << r;
    if (n === 4) quad = r;
    else if (n === 3) {
      if (trip1 < 0) trip1 = r;
      else if (trip2 < 0) trip2 = r;
    } else if (n === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
    }
  }
  if (quad >= 0) {
    topRanks(rankMask & ~(1 << quad), 1, scratch);
    return pack5(7, quad, scratch[0], 0, 0, 0);
  }
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) return pack5(6, trip1, Math.max(trip2, pair1), 0, 0, 0);
  const sh = straightHigh(rankMask);
  if (sh >= 0) return pack5(4, sh, 0, 0, 0, 0);
  if (trip1 >= 0) {
    topRanks(rankMask & ~(1 << trip1), 2, scratch);
    return pack5(3, trip1, scratch[0], scratch[1], 0, 0);
  }
  if (pair2 >= 0) {
    topRanks(rankMask & ~(1 << pair1) & ~(1 << pair2), 1, scratch);
    return pack5(2, pair1, pair2, scratch[0], 0, 0);
  }
  if (pair1 >= 0) {
    topRanks(rankMask & ~(1 << pair1), 3, scratch);
    return pack5(1, pair1, scratch[0], scratch[1], scratch[2], 0);
  }
  topRanks(rankMask, 5, scratch);
  return pack5(0, scratch[0], scratch[1], scratch[2], scratch[3], scratch[4]);
}

/** Flush / straight-flush score for a suit mask with >= 5 ranks. */
function flushScore(mask: number): number {
  const sh = straightHigh(mask);
  if (sh >= 0) return pack5(8, sh, 0, 0, 0, 0);
  topRanks(mask, 5, scratch);
  return pack5(5, scratch[0], scratch[1], scratch[2], scratch[3], scratch[4]);
}

/* ---------------------------------------------------------------- tables */

const FLUSH = new Int32Array(8192);
for (let m = 0; m < 8192; m++) {
  let bits = 0;
  for (let x = m; x; x &= x - 1) bits++;
  if (bits >= 5) FLUSH[m] = flushScore(m);
}

const HASH_BITS = 18;
const HASH_SIZE = 1 << HASH_BITS;
const HASH_MASK = HASH_SIZE - 1;
const HKEYS = new Int32Array(HASH_SIZE).fill(-1);
const HVALS = new Int32Array(HASH_SIZE);
const slot = (key: number) => Math.imul(key, 0x9e3779b1) >>> (32 - HASH_BITS);

{
  // Enumerate every rank multiset of 5..7 cards (max four per rank).
  const counts = new Int32Array(13);
  const fill = (rank: number, used: number, key: number): void => {
    if (rank < 0) {
      if (used < 5) return;
      let i = slot(key);
      while (HKEYS[i] !== -1) i = (i + 1) & HASH_MASK;
      HKEYS[i] = key;
      HVALS[i] = scoreFromCounts(counts);
      return;
    }
    for (let n = 0; n <= 4 && used + n <= 7; n++) {
      counts[rank] = n;
      fill(rank - 1, used + n, key + n * POW5[rank]);
    }
    counts[rank] = 0;
  };
  fill(12, 0, 0);
}

/** Look up the non-flush score for a rank key. */
export function rankKeyScore(key: number): number {
  let i = slot(key);
  for (;;) {
    const k = HKEYS[i];
    if (k === key) return HVALS[i];
    if (k === -1) return -1;
    i = (i + 1) & HASH_MASK;
  }
}

/* ------------------------------------------------------------------- API */

/**
 * Accumulated card set. Build one for the board, then `evalWith2` adds two hole cards
 * without touching the board accumulator. Use `addCard` to extend it street by street.
 */
export interface CardAcc {
  rankKey: number;
  suitKey: number;
  /** Per-suit 13-bit rank masks. */
  m0: number;
  m1: number;
  m2: number;
  m3: number;
}

export const newAcc = (): CardAcc => ({ rankKey: 0, suitKey: 0, m0: 0, m1: 0, m2: 0, m3: 0 });

export function resetAcc(a: CardAcc): CardAcc {
  a.rankKey = 0;
  a.suitKey = 0;
  a.m0 = a.m1 = a.m2 = a.m3 = 0;
  return a;
}

export function addCard(a: CardAcc, c: number): void {
  a.rankKey += CARD_RANK_KEY[c];
  a.suitKey += CARD_SUIT_KEY[c];
  const b = CARD_BIT[c];
  switch (c & 3) {
    case 0: a.m0 |= b; break;
    case 1: a.m1 |= b; break;
    case 2: a.m2 |= b; break;
    default: a.m3 |= b;
  }
}

export function accFrom(cards: ArrayLike<number>, n = cards.length): CardAcc {
  const a = newAcc();
  for (let i = 0; i < n; i++) addCard(a, cards[i]);
  return a;
}

/** Score of the accumulated set (5..7 cards). */
export function evalAcc(a: CardAcc): number {
  const f = (a.suitKey + 0x3333) & 0x8888;
  if (f !== 0) {
    const m = f & 0x0008 ? a.m0 : f & 0x0080 ? a.m1 : f & 0x0800 ? a.m2 : a.m3;
    return FLUSH[m];
  }
  return rankKeyScore(a.rankKey);
}

/** Score of `board` accumulator plus hole cards `c1`, `c2` (board must hold 3..5 cards). */
export function evalWith2(board: CardAcc, c1: number, c2: number): number {
  const suitKey = board.suitKey + CARD_SUIT_KEY[c1] + CARD_SUIT_KEY[c2];
  const f = (suitKey + 0x3333) & 0x8888;
  if (f !== 0) {
    const s = f & 0x0008 ? 0 : f & 0x0080 ? 1 : f & 0x0800 ? 2 : 3;
    let m = s === 0 ? board.m0 : s === 1 ? board.m1 : s === 2 ? board.m2 : board.m3;
    if ((c1 & 3) === s) m |= CARD_BIT[c1];
    if ((c2 & 3) === s) m |= CARD_BIT[c2];
    return FLUSH[m];
  }
  return rankKeyScore(board.rankKey + CARD_RANK_KEY[c1] + CARD_RANK_KEY[c2]);
}

/** Score of 5..7 cards held in an array (slower convenience path). */
export function eval7(cards: ArrayLike<number>, n = cards.length): number {
  let rankKey = 0;
  let suitKey = 0;
  let m0 = 0, m1 = 0, m2 = 0, m3 = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    rankKey += CARD_RANK_KEY[c];
    suitKey += CARD_SUIT_KEY[c];
    const b = CARD_BIT[c];
    const s = c & 3;
    if (s === 0) m0 |= b;
    else if (s === 1) m1 |= b;
    else if (s === 2) m2 |= b;
    else m3 |= b;
  }
  const f = (suitKey + 0x3333) & 0x8888;
  if (f !== 0) return FLUSH[f & 0x0008 ? m0 : f & 0x0080 ? m1 : f & 0x0800 ? m2 : m3];
  return rankKeyScore(rankKey);
}

/** Hand category (0 high card .. 8 straight flush) from a score. */
export const categoryOf = (score: number) => score >> 20;

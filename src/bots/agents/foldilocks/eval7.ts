/**
 * Hand scores identical to eval7's `evaluate` (the library fullhouse-bot was trained with):
 *   type << 24 | up to five 4-bit rank nibbles from bit 16 down
 * types 0 high card, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush, 6 full house,
 * 7 quads, 8 straight flush. Ranks 0 = deuce .. 12 = ace. A wheel straight's top card is 5.
 * Best five of the 5–7 cards given as (rank, suit) pairs.
 */

const TYPE = 1 << 24;

function nib(ranks: number[]): number {
  let v = 0;
  for (let i = 0; i < ranks.length; i++) v |= ranks[i] << (16 - 4 * i);
  return v;
}

/** Highest straight in a 13-bit rank mask: its top rank, or -1. */
function straightTop(mask: number): number {
  for (let top = 12; top >= 4; top--) {
    const need = 0b11111 << (top - 4);
    if ((mask & need) === need) return top;
  }
  // Wheel: A 2 3 4 5
  if ((mask & 0b1000000001111) === 0b1000000001111) return 3;
  return -1;
}

function topRanks(mask: number, n: number, skip = 0): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r) && !(skip & (1 << r))) out.push(r);
  return out;
}

export function evaluate7(ranks: readonly number[], suits: readonly number[]): number {
  const counts = new Array<number>(13).fill(0);
  const suitMask = [0, 0, 0, 0];
  const suitCount = [0, 0, 0, 0];
  let mask = 0;
  for (let i = 0; i < ranks.length; i++) {
    counts[ranks[i]]++;
    suitMask[suits[i]] |= 1 << ranks[i];
    suitCount[suits[i]]++;
    mask |= 1 << ranks[i];
  }
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const sf = straightTop(suitMask[flushSuit]);
    if (sf >= 0) return 8 * TYPE + (sf << 16);
  }
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }
  if (quads.length) {
    const q = quads[0];
    return 7 * TYPE + (q << 16) + (topRanks(mask, 1, 1 << q)[0] << 12);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0];
    const p = Math.max(trips.length > 1 ? trips[1] : -1, pairs.length ? pairs[0] : -1);
    return 6 * TYPE + (t << 16) + (p << 12);
  }
  if (flushSuit >= 0) return 5 * TYPE + nib(topRanks(suitMask[flushSuit], 5));
  const st = straightTop(mask);
  if (st >= 0) return 4 * TYPE + (st << 16);
  if (trips.length) {
    const t = trips[0];
    return 3 * TYPE + nib([t, ...topRanks(mask, 2, 1 << t)]);
  }
  if (pairs.length >= 2) {
    const [a, b] = pairs;
    return 2 * TYPE + nib([a, b, ...topRanks(mask, 1, (1 << a) | (1 << b))]);
  }
  if (pairs.length === 1) {
    const p = pairs[0];
    return 1 * TYPE + nib([p, ...topRanks(mask, 3, 1 << p)]);
  }
  return nib(topRanks(mask, 5));
}

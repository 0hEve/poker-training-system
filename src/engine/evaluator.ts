import { type Card, rankOf, suitOf, RANK_NAMES } from './cards';

/**
 * Bitmask 5–7 card evaluator. No lookup tables are shipped.
 *
 * score = category << 20 | r1 << 16 | r2 << 12 | r3 << 8 | r4 << 4 | r5
 * where r1..r5 are the ranks (0..12) that decide ties, most significant first.
 * Higher score wins; equal score is a split.
 */
export const Category = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;
export type Category = (typeof Category)[keyof typeof Category];

export const CATEGORY_NAMES = [
  'High Card',
  'One Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
];

export interface HandValue {
  category: Category;
  score: number;
  /** The five cards that make the hand, ordered by importance. */
  bestFive: Card[];
  /** Human readable, e.g. "Full House, Kings over Sevens". */
  description: string;
}

const pack = (cat: number, r: number[]): number =>
  (cat << 20) | ((r[0] ?? 0) << 16) | ((r[1] ?? 0) << 12) | ((r[2] ?? 0) << 8) | ((r[3] ?? 0) << 4) | (r[4] ?? 0);

/** Highest straight in a 13-bit rank mask; returns top rank (3 = five-high wheel) or -1. */
export function straightHigh(mask: number): number {
  // Add ace as a low card at bit -1 by shifting everything up one.
  const m = (mask << 1) | ((mask >> 12) & 1);
  const run = m & (m << 1) & (m << 2) & (m << 3) & (m << 4);
  if (run === 0) return -1;
  return 31 - Math.clz32(run) - 1; // undo the shift
}

/** Ranks present in mask, descending. */
function ranksDesc(mask: number, limit: number): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < limit; r--) if (mask & (1 << r)) out.push(r);
  return out;
}

function straightRanks(high: number): number[] {
  // Five-high wheel: 5 4 3 2 A
  if (high === 3) return [3, 2, 1, 0, 12];
  return [high, high - 1, high - 2, high - 3, high - 4];
}

const plural = (r: number) => (r === 4 ? 'Sixes' : RANK_NAMES[r] + 's');

export function evaluate(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) throw new Error('evaluate needs 5–7 cards');

  const counts = new Array<number>(13).fill(0);
  const suitMask = [0, 0, 0, 0];
  const suitCount = [0, 0, 0, 0];
  let rankMask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    counts[r]++;
    suitMask[s] |= 1 << r;
    suitCount[s]++;
    rankMask |= 1 << r;
  }

  // Picks cards of the given ranks (in order) from the hand, optionally restricted to a suit.
  const pick = (ranks: number[], suit = -1): Card[] => {
    const used = new Set<Card>();
    const out: Card[] = [];
    for (const r of ranks) {
      const c = cards.find((x) => rankOf(x) === r && (suit < 0 || suitOf(x) === suit) && !used.has(x));
      if (c === undefined) throw new Error('internal: card not found');
      used.add(c);
      out.push(c);
    }
    return out;
  };

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) flushSuit = s;

  // Straight flush
  if (flushSuit >= 0) {
    const sh = straightHigh(suitMask[flushSuit]);
    if (sh >= 0) {
      const rs = straightRanks(sh);
      const name = sh === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[sh]} high`;
      return { category: Category.StraightFlush, score: pack(8, [sh]), bestFive: pick(rs, flushSuit), description: name };
    }
  }

  // Group ranks by multiplicity, highest rank first.
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
    const kicker = ranksDesc(rankMask & ~(1 << q), 1)[0];
    return {
      category: Category.Quads,
      score: pack(7, [q, kicker]),
      bestFive: pick([q, q, q, q, kicker]),
      description: `Four of a Kind, ${plural(q)}`,
    };
  }

  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0];
    const p = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return {
      category: Category.FullHouse,
      score: pack(6, [t, p]),
      bestFive: pick([t, t, t, p, p]),
      description: `Full House, ${plural(t)} over ${plural(p)}`,
    };
  }

  if (flushSuit >= 0) {
    const rs = ranksDesc(suitMask[flushSuit], 5);
    return {
      category: Category.Flush,
      score: pack(5, rs),
      bestFive: pick(rs, flushSuit),
      description: `Flush, ${RANK_NAMES[rs[0]]} high`,
    };
  }

  const sh = straightHigh(rankMask);
  if (sh >= 0) {
    return {
      category: Category.Straight,
      score: pack(4, [sh]),
      bestFive: pick(straightRanks(sh)),
      description: `Straight, ${RANK_NAMES[sh]} high`,
    };
  }

  if (trips.length) {
    const t = trips[0];
    const k = ranksDesc(rankMask & ~(1 << t), 2);
    return {
      category: Category.Trips,
      score: pack(3, [t, ...k]),
      bestFive: pick([t, t, t, ...k]),
      description: `Three of a Kind, ${plural(t)}`,
    };
  }

  if (pairs.length >= 2) {
    const [hi, lo] = pairs;
    const k = ranksDesc(rankMask & ~(1 << hi) & ~(1 << lo), 1);
    return {
      category: Category.TwoPair,
      score: pack(2, [hi, lo, ...k]),
      bestFive: pick([hi, hi, lo, lo, ...k]),
      description: `Two Pair, ${plural(hi)} and ${plural(lo)}`,
    };
  }

  if (pairs.length === 1) {
    const p = pairs[0];
    const k = ranksDesc(rankMask & ~(1 << p), 3);
    return {
      category: Category.Pair,
      score: pack(1, [p, ...k]),
      bestFive: pick([p, p, ...k]),
      description: `Pair of ${plural(p)}`,
    };
  }

  const hs = ranksDesc(rankMask, 5);
  return {
    category: Category.HighCard,
    score: pack(0, hs),
    bestFive: pick(hs),
    description: `${RANK_NAMES[hs[0]]} high`,
  };
}

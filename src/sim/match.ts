import type { BotSpec, PokerBot } from '../bots/types';
import { hash32, rngFor, shuffleDeck } from './rng';
import { FastTable } from './table';

/**
 * Bot-vs-bot match runner.
 *
 * - Fixed seating around the table; the button moves one seat every hand.
 * - Stacks reset to `stack` every hand (standard for bot evaluation: every hand is
 *   played 100bb deep, nobody busts, results are in big blinds per 100 hands).
 * - Duplicate mode (two distinct bots): the same deck sequence is also played on a
 *   mirror table where the two bots swap seats. Card luck largely cancels, which cuts
 *   the variance of the result several-fold.
 * - Each table keeps the same bot instances for the whole run, so bots can model
 *   their opponents across hands.
 * - Deck `h` depends only on (seed, h), so a match can be split across workers by
 *   hand ranges and merged without changing which cards are dealt.
 */

export interface MatchConfig {
  /** Bot id per physical seat, e.g. ['opus', 'gpt', 'opus', 'gpt', 'opus', 'gpt']. */
  seats: string[];
  /** Number of decks (hands per table). */
  hands: number;
  seed: number;
  /** Index of the first deck (for splitting a match across workers). */
  firstHand?: number;
  smallBlind?: number;
  bigBlind?: number;
  ante?: number;
  /** Starting stack, restored every hand. */
  stack?: number;
  /** Also play a mirror table with the two bots' seats swapped (2 distinct bots only). */
  duplicate?: boolean;
}

export interface BotTotals {
  id: string;
  /** Seat-hands played. */
  seatHands: number;
  /** Net chips won by all seats of this bot. */
  net: number;
  decisions: number;
  thinkMs: number;
  invalid: number;
  errors: number;
  /** Seat-hands where the bot voluntarily put chips in preflop. */
  vpip: number;
  /** Seat-hands where the bot bet or raised preflop. */
  pfr: number;
  /** Seat-hands that reached showdown with this bot still in. */
  showdowns: number;
  /** Showdowns with a positive result. */
  showdownWins: number;
}

export interface MatchResult {
  seats: string[];
  bigBlind: number;
  /** Decks played. */
  hands: number;
  /** Tables per deck (2 with duplicate). */
  tables: number;
  totals: Record<string, BotTotals>;
  /** Per-deck net of `ids[0]` summed over tables, for confidence intervals. */
  deck: { id: string; n: number; sum: number; sumSq: number };
  elapsedMs: number;
}

export type BotResolver = (id: string) => BotSpec;

const distinct = (xs: string[]) => [...new Set(xs)];

export function mirrorSeats(seats: string[]): string[] | null {
  const ids = distinct(seats);
  if (ids.length !== 2) return null;
  return seats.map((s) => (s === ids[0] ? ids[1] : ids[0]));
}

function emptyTotals(id: string): BotTotals {
  return { id, seatHands: 0, net: 0, decisions: 0, thinkMs: 0, invalid: 0, errors: 0, vpip: 0, pfr: 0, showdowns: 0, showdownWins: 0 };
}

export function runMatch(cfg: MatchConfig, resolve: BotResolver, onProgress?: (handsDone: number) => void): MatchResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const N = cfg.seats.length;
  if (N < 2 || N > 10) throw new Error('A table needs 2..10 seats');
  const sb = cfg.smallBlind ?? 5;
  const bb = cfg.bigBlind ?? 10;
  const ante = cfg.ante ?? 0;
  const stack = cfg.stack ?? 100 * bb;
  const first = cfg.firstHand ?? 0;
  const mirror = cfg.duplicate !== false ? mirrorSeats(cfg.seats) : null;
  const layouts = mirror ? [cfg.seats, mirror] : [cfg.seats];
  const ids = distinct(cfg.seats);

  const playerIds = Array.from({ length: N }, (_, i) => `P${i + 1}`);
  const instances: PokerBot[][] = layouts.map((layout, t) =>
    layout.map((id, phys) => resolve(id).create({ seed: hash32(cfg.seed * 31 + t * 1009 + phys * 7919 + 1), playerId: playerIds[phys] })),
  );
  const totals: Record<string, BotTotals> = {};
  for (const id of ids) totals[id] = emptyTotals(id);

  const table = new FastTable({ smallBlind: sb, bigBlind: bb, ante });
  const deck = new Int8Array(52);
  const bots: PokerBot[] = new Array(N);
  const seatIds: string[] = new Array(N);
  const stacks: number[] = new Array(N).fill(stack);
  const seatTotals: BotTotals[] = new Array(N);
  const deckStat = { id: ids[0], n: 0, sum: 0, sumSq: 0 };

  for (let h = first; h < first + cfg.hands; h++) {
    shuffleDeck(deck, rngFor(cfg.seed, h));
    const button = h % N;
    let deckNet = 0;
    for (let t = 0; t < layouts.length; t++) {
      const layout = layouts[t];
      for (let k = 0; k < N; k++) {
        const phys = (button + k) % N;
        bots[k] = instances[t][phys];
        seatIds[k] = playerIds[phys];
        seatTotals[k] = totals[layout[phys]];
      }
      const net = table.playHand(bots, seatIds, stacks, deck, h);
      const actions = table.handActions;
      const reachedShowdown = table.wentToShowdown;
      for (let k = 0; k < N; k++) {
        const tot = seatTotals[k];
        const st = table.stats[k];
        tot.seatHands++;
        tot.net += net[k];
        tot.decisions += st.decisions;
        tot.thinkMs += st.thinkMs;
        tot.invalid += st.invalid;
        tot.errors += st.errors;
        if (reachedShowdown && !table.hasFolded(k)) {
          tot.showdowns++;
          if (net[k] > 0) tot.showdownWins++;
        }
        if (tot.id === ids[0]) deckNet += net[k];
      }
      let vp = 0;
      let pf = 0;
      for (const a of actions) {
        if (a.street !== 0) break;
        if (a.kind === 'call') vp |= 1 << a.seat;
        else if (a.kind === 'bet' || a.kind === 'raise') {
          vp |= 1 << a.seat;
          pf |= 1 << a.seat;
        }
      }
      for (let k = 0; k < N; k++) {
        if (vp & (1 << k)) seatTotals[k].vpip++;
        if (pf & (1 << k)) seatTotals[k].pfr++;
      }
    }
    deckStat.n++;
    deckStat.sum += deckNet;
    deckStat.sumSq += deckNet * deckNet;
    if (onProgress && (h - first + 1) % 500 === 0) onProgress(h - first + 1);
  }
  onProgress?.(cfg.hands);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { seats: cfg.seats, bigBlind: bb, hands: cfg.hands, tables: layouts.length, totals, deck: deckStat, elapsedMs: t1 - t0 };
}

/** Merge results of the same match run in pieces (e.g. one per worker). */
export function mergeResults(parts: MatchResult[]): MatchResult {
  if (!parts.length) throw new Error('nothing to merge');
  const out: MatchResult = structuredClone(parts[0]);
  for (const p of parts.slice(1)) {
    out.hands += p.hands;
    out.elapsedMs = Math.max(out.elapsedMs, p.elapsedMs);
    out.deck.n += p.deck.n;
    out.deck.sum += p.deck.sum;
    out.deck.sumSq += p.deck.sumSq;
    for (const [id, t] of Object.entries(p.totals)) {
      const o = (out.totals[id] ??= emptyTotals(id));
      for (const k of Object.keys(t) as (keyof BotTotals)[]) if (k !== 'id') (o[k] as number) += t[k] as number;
    }
  }
  return out;
}

export interface BotReport {
  id: string;
  seatHands: number;
  /** Big blinds won per 100 hands, per seat. */
  bb100: number;
  /** 95% confidence half-width of bb100 (two-bot matches only, else NaN). */
  ci95: number;
  netChips: number;
  decisions: number;
  decisionsPerSec: number;
  usPerDecision: number;
  vpipPct: number;
  pfrPct: number;
  wsdPct: number;
  invalid: number;
  errors: number;
}

export function summarize(r: MatchResult): BotReport[] {
  const ids = Object.keys(r.totals);
  const d = r.deck;
  const mean = d.n ? d.sum / d.n : 0;
  const variance = d.n > 1 ? (d.sumSq - d.n * mean * mean) / (d.n - 1) : 0;
  const seDeck = d.n > 1 ? Math.sqrt(Math.max(0, variance) / d.n) : NaN;
  return ids.map((id) => {
    const t = r.totals[id];
    const seatHandsPerDeck = t.seatHands / Math.max(1, r.hands);
    const scale = 100 / (r.bigBlind * seatHandsPerDeck);
    const twoBots = ids.length === 2;
    return {
      id,
      seatHands: t.seatHands,
      bb100: (t.net / r.bigBlind / t.seatHands) * 100,
      ci95: twoBots ? 1.96 * seDeck * scale : NaN,
      netChips: t.net,
      decisions: t.decisions,
      decisionsPerSec: t.thinkMs > 0 ? t.decisions / (t.thinkMs / 1000) : Infinity,
      usPerDecision: t.decisions ? (t.thinkMs * 1000) / t.decisions : 0,
      vpipPct: (100 * t.vpip) / t.seatHands,
      pfrPct: (100 * t.pfr) / t.seatHands,
      wsdPct: t.showdowns ? (100 * t.showdownWins) / t.showdowns : 0,
      invalid: t.invalid,
      errors: t.errors,
    };
  });
}

/** Split `hands` into `parts` contiguous ranges. */
export function splitHands(hands: number, parts: number): { firstHand: number; hands: number }[] {
  const out: { firstHand: number; hands: number }[] = [];
  const base = Math.floor(hands / parts);
  let extra = hands % parts;
  let at = 0;
  for (let i = 0; i < parts; i++) {
    const n = base + (extra-- > 0 ? 1 : 0);
    if (n > 0) out.push({ firstHand: at, hands: n });
    at += n;
  }
  return out;
}

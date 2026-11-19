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
  /** Record a winnings-curve point every this many decks (default: about 400 points per run). */
  curveEvery?: number;
}

/** Action kinds counted per street in `BotTotals.acts` (index = street * 5 + kind). */
export const ACT_KINDS = ['fold', 'check', 'call', 'bet', 'raise'] as const;

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
  /** Net chips won in hands that went to showdown with this bot in (the rest is won without showdown). */
  sdNet: number;
  /** Seat-hands where the bot saw the flop. */
  sawFlop: number;
  /** Net chips and seat-hands per position, indexed from the button (0 = button, 1 = small blind, ...). */
  posNet: number[];
  posHands: number[];
  /** Action counts, index street * 5 + ACT_KINDS index. */
  acts: number[];
}

/** Cumulative result of the first bot (`deck.id`) over the decks of a run, in deck order. */
export interface Curve {
  /** Absolute deck index after which the point was taken (exclusive end). */
  x: number[];
  /** Cumulative net chips (all of the bot's seats, all tables) since the first deck of the run. */
  net: number[];
  /** The part of `net` won in hands that reached showdown. */
  sd: number[];
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
  deck: DeckStat;
  /** First deck index of this (possibly partial) result. */
  firstHand: number;
  curve: Curve;
  elapsedMs: number;
}

export interface DeckStat {
  id: string;
  n: number;
  sum: number;
  sumSq: number;
}

export type BotResolver = (id: string) => BotSpec;

const distinct = (xs: string[]) => [...new Set(xs)];

export function mirrorSeats(seats: string[]): string[] | null {
  const ids = distinct(seats);
  if (ids.length !== 2) return null;
  return seats.map((s) => (s === ids[0] ? ids[1] : ids[0]));
}

function emptyTotals(id: string, n: number): BotTotals {
  return {
    id,
    seatHands: 0,
    net: 0,
    decisions: 0,
    thinkMs: 0,
    invalid: 0,
    errors: 0,
    vpip: 0,
    pfr: 0,
    showdowns: 0,
    showdownWins: 0,
    sdNet: 0,
    sawFlop: 0,
    posNet: new Array(n).fill(0),
    posHands: new Array(n).fill(0),
    acts: new Array(4 * ACT_KINDS.length).fill(0),
  };
}

const ACT_INDEX: Record<string, number> = { fold: 0, check: 1, call: 2, bet: 3, raise: 4 };

type Progress = (handsDone: number, deck: DeckStat) => void;

export function runMatch(cfg: MatchConfig, resolve: BotResolver, onProgress?: Progress): MatchResult {
  const result = matchSteps(cfg, resolve, onProgress).next();
  if (!result.done) throw new Error('Synchronous match unexpectedly yielded a decision');
  return result.value;
}

export async function runMatchAsync(cfg: MatchConfig, resolve: BotResolver, onProgress: Progress, signal: AbortSignal): Promise<MatchResult> {
  const steps = matchSteps(cfg, resolve, onProgress, signal);
  let step = steps.next();
  while (!step.done) {
    step = steps.next(await step.value);
  }
  return step.value;
}

function* matchSteps(cfg: MatchConfig, resolve: BotResolver, onProgress?: Progress, signal?: AbortSignal): Generator<Promise<number[]>, MatchResult, number[]> {
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
  for (const id of ids) totals[id] = emptyTotals(id, N);
  const curveEvery = Math.max(1, Math.floor(cfg.curveEvery ?? Math.ceil(cfg.hands / 400)));
  const curve: Curve = { x: [], net: [], sd: [] };
  let curveNet = 0;
  let curveSd = 0;

  const table = new FastTable({ smallBlind: sb, bigBlind: bb, ante });
  const deck = new Int8Array(52);
  const bots: PokerBot[] = new Array(N);
  const seatIds: string[] = new Array(N);
  const stacks: number[] = new Array(N).fill(stack);
  const seatTotals: BotTotals[] = new Array(N);
  const deckStat = { id: ids[0], n: 0, sum: 0, sumSq: 0 };
  let lastProgress = t0;

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
      const net = signal
        ? yield table.playHandAsync(bots, seatIds, stacks, deck, h, signal)
        : table.playHand(bots, seatIds, stacks, deck, h);
      const actions = table.handActions;
      const reachedShowdown = table.wentToShowdown;
      let foldedPre = 0;
      let flop = reachedShowdown;
      for (const a of actions) {
        if (a.kind === 'post') continue;
        const ai = ACT_INDEX[a.kind];
        seatTotals[a.seat].acts[a.street * 5 + ai]++;
        if (a.street === 0 && a.kind === 'fold') foldedPre |= 1 << a.seat;
        if (a.street > 0) flop = true;
      }
      for (let k = 0; k < N; k++) {
        const tot = seatTotals[k];
        const st = table.stats[k];
        tot.seatHands++;
        tot.net += net[k];
        tot.posNet[k] += net[k];
        tot.posHands[k]++;
        if (flop && !(foldedPre & (1 << k))) tot.sawFlop++;
        tot.decisions += st.decisions;
        tot.thinkMs += st.thinkMs;
        tot.invalid += st.invalid;
        tot.errors += st.errors;
        if (reachedShowdown && !table.hasFolded(k)) {
          tot.showdowns++;
          if (net[k] > 0) tot.showdownWins++;
          tot.sdNet += net[k];
          if (tot.id === ids[0]) curveSd += net[k];
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
    curveNet += deckNet;
    const doneHere = h - first + 1;
    if (doneHere % curveEvery === 0 || doneHere === cfg.hands) {
      curve.x.push(h + 1);
      curve.net.push(curveNet);
      curve.sd.push(curveSd);
    }
    if (onProgress && (signal || doneHere % 250 === 0 || doneHere === 1)) {
      const now = performance.now();
      if (doneHere === 1 || now - lastProgress >= 100) {
        lastProgress = now;
        onProgress(doneHere, deckStat);
      }
    }
  }
  onProgress?.(cfg.hands, deckStat);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { seats: cfg.seats, bigBlind: bb, hands: cfg.hands, tables: layouts.length, totals, deck: deckStat, firstHand: first, curve, elapsedMs: t1 - t0 };
}

/** Merge results of the same match run in pieces (e.g. one per worker). */
export function mergeResults(parts: MatchResult[]): MatchResult {
  if (!parts.length) throw new Error('nothing to merge');
  const sorted = [...parts].sort((a, b) => a.firstHand - b.firstHand);
  const out: MatchResult = structuredClone(sorted[0]);
  for (const p of sorted.slice(1)) {
    out.hands += p.hands;
    out.elapsedMs = Math.max(out.elapsedMs, p.elapsedMs);
    out.deck.n += p.deck.n;
    out.deck.sum += p.deck.sum;
    out.deck.sumSq += p.deck.sumSq;
    // Curves continue from where the previous range ended.
    const baseNet = out.curve.net.length ? out.curve.net[out.curve.net.length - 1] : 0;
    const baseSd = out.curve.sd.length ? out.curve.sd[out.curve.sd.length - 1] : 0;
    for (let i = 0; i < p.curve.x.length; i++) {
      out.curve.x.push(p.curve.x[i]);
      out.curve.net.push(baseNet + p.curve.net[i]);
      out.curve.sd.push(baseSd + p.curve.sd[i]);
    }
    for (const [id, t] of Object.entries(p.totals)) {
      const o = (out.totals[id] ??= emptyTotals(id, t.posNet.length));
      for (const k of Object.keys(t) as (keyof BotTotals)[]) {
        const v = t[k];
        if (k === 'id') continue;
        if (Array.isArray(v)) (o[k] as number[]).forEach((_, i, arr) => (arr[i] += v[i]));
        else (o[k] as number) += v as number;
      }
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
  /** Went to showdown, % of flops seen. */
  wtsdPct: number;
  /** bb/100 won at showdown and without showdown (they add up to bb100). */
  sdBb100: number;
  nonSdBb100: number;
  /** Postflop aggression factor: (bets + raises) / calls. */
  af: number;
  /** bb/100 by position (index from the button). */
  posBb100: number[];
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
      wtsdPct: t.sawFlop ? (100 * t.showdowns) / t.sawFlop : 0,
      sdBb100: (t.sdNet / r.bigBlind / t.seatHands) * 100,
      nonSdBb100: ((t.net - t.sdNet) / r.bigBlind / t.seatHands) * 100,
      af: afOf(t.acts),
      posBb100: t.posNet.map((x, i) => (t.posHands[i] ? (x / r.bigBlind / t.posHands[i]) * 100 : 0)),
      invalid: t.invalid,
      errors: t.errors,
    };
  });
}

function afOf(acts: number[]): number {
  let aggressive = 0;
  let calls = 0;
  for (let st = 1; st < 4; st++) {
    aggressive += acts[st * 5 + 3] + acts[st * 5 + 4];
    calls += acts[st * 5 + 2];
  }
  return calls ? aggressive / calls : aggressive ? Infinity : 0;
}

/** Position names by index from the button for an `n`-handed table. */
export function positionNames(n: number): string[] {
  if (n === 2) return ['BTN/SB', 'BB'];
  const lateCount = Math.min(2, Math.max(0, n - 3));
  const late = ['HJ', 'CO'].slice(2 - lateCount);
  const middle = ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ'].slice(0, Math.max(0, n - 3 - lateCount));
  return ['BTN', 'SB', 'BB', ...middle, ...late];
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

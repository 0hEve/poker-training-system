import type { HandSummary } from '../../types';
import { positionOf, type Position } from './position';
import { comboIndex } from './cards';
import type { BoardStrength } from './strength';

/**
 * Per-opponent statistics, counted per *opportunity* and shrunk toward population
 * priors (Beta smoothing), so a handful of hands never swings the model.
 * Updated from complete hand histories in `handEnd`, including showdown
 * calibration: how strong a player's bets and calls really were.
 */

export class Stat {
  n = 0;
  k = 0;
  /** Population-level stat: its estimate replaces the fixed prior (hierarchical shrinkage). */
  parent: Stat | null = null;
  constructor(
    public prior: number,
    public weight: number,
  ) {}
  add(hit: boolean) {
    this.n++;
    if (hit) this.k++;
    if (this.parent) {
      this.parent.n++;
      if (hit) this.parent.k++;
    }
  }
  /** Posterior mean. */
  get p(): number {
    const prior = this.parent ? this.parent.p : this.prior;
    return (this.k + prior * this.weight) / (this.n + this.weight);
  }
  /** Observations (for confidence gating). */
  get count(): number {
    return this.n;
  }
}

/** Running mean with a prior. */
export class Mean {
  n = 0;
  sum = 0;
  parent: Mean | null = null;
  constructor(
    public prior: number,
    public weight: number,
  ) {}
  add(x: number) {
    this.n++;
    this.sum += x;
    if (this.parent) {
      this.parent.n++;
      this.parent.sum += x;
    }
  }
  get v(): number {
    const prior = this.parent ? this.parent.v : this.prior;
    return (this.sum + prior * this.weight) / (this.n + this.weight);
  }
}

/** Point every Stat/Mean in `m` at the matching one in `pop` (same shape). */
export function linkToPopulation(m: object, pop: object) {
  const walk = (a: unknown, b: unknown) => {
    if (a instanceof Stat && b instanceof Stat) a.parent = b;
    else if (a instanceof Mean && b instanceof Mean) a.parent = b;
    else if (a && b && typeof a === 'object') for (const key of Object.keys(a)) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
  };
  walk(m, pop);
}

/** Model registry with a pooled population model as every player's prior. */
export class Models extends Map<string, PlayerModel> {
  readonly population = new PlayerModel();
  getOrCreate(id: string): PlayerModel {
    let m = this.get(id);
    if (!m) {
      m = new PlayerModel();
      linkToPopulation(m, this.population);
      this.set(id, m);
    }
    return m;
  }
}

const RFI_PRIOR: Record<Position, number> = { UTG: 0.19, HJ: 0.25, CO: 0.32, BTN: 0.48, SB: 0.45, BB: 0 };

export class PlayerModel {
  hands = 0;
  vpip = new Stat(0.25, 30);
  pfr = new Stat(0.19, 30);
  /** Raise-first-in rate by position. */
  rfi: Record<Position, Stat> = {
    UTG: new Stat(RFI_PRIOR.UTG, 25),
    HJ: new Stat(RFI_PRIOR.HJ, 25),
    CO: new Stat(RFI_PRIOR.CO, 25),
    BTN: new Stat(RFI_PRIOR.BTN, 25),
    SB: new Stat(RFI_PRIOR.SB, 25),
    BB: new Stat(0, 25),
  };
  /** Facing a single open: 3-bet / call / fold rates. */
  threeBet = new Stat(0.09, 30);
  callOpen = new Stat(0.16, 30);
  /** Opener facing a 3-bet: fold / 4-bet rates. */
  foldTo3bet = new Stat(0.5, 20);
  fourBet = new Stat(0.12, 20);
  /** Facing a 4-bet+: fold rate. */
  foldTo4bet = new Stat(0.5, 15);
  /** Limps when unopened (outside the BB). */
  limp = new Stat(0.02, 30);

  /** Postflop, per street 1..3 (index 0 unused). */
  aggr = [0, 0.38, 0.33, 0.3].map((p) => new Stat(p, 25)); // bet when checked to
  cbet = [0, 0.6, 0.5, 0.45].map((p) => new Stat(p, 20)); // bet as the previous street's aggressor
  foldToBet = [0, 0.42, 0.45, 0.5].map((p) => new Stat(p, 25));
  raiseVsBet = [0, 0.1, 0.08, 0.06].map((p) => new Stat(p, 25));
  /**
   * Fold rate facing a bet by size bucket of the caller's price alpha = toCall / (pot + toCall):
   * 0: < 0.22 (up to ~40% pot), 1: 0.22–0.3 (~40–75% pot), 2: >= 0.3 (75% pot and bigger).
   */
  foldBySize = [
    [0, 0, 0],
    [0.3, 0.42, 0.52],
    [0.33, 0.45, 0.56],
    [0.38, 0.5, 0.6],
  ].map((row) => row.map((p) => new Stat(p, 14)));

  /** Fold probability facing a bet at price `alpha` (interpolated across size buckets). */
  foldAt(street: number, alpha: number): number {
    const row = this.foldBySize[street];
    const centers = [0.18, 0.26, 0.36];
    if (alpha <= centers[0]) return row[0].p * Math.max(0.5, alpha / centers[0]);
    if (alpha >= centers[2]) return Math.min(0.97, row[2].p * (1 + (alpha - centers[2]) * 1.5));
    const j = alpha < centers[1] ? 0 : 1;
    const t = (alpha - centers[j]) / (centers[j + 1] - centers[j]);
    return row[j].p * (1 - t) + row[j + 1].p * t;
  }

  /** Bettor facing a raise on the same street: fold rate. */
  foldToRaise = [0, 0.38, 0.32, 0.3].map((p) => new Stat(p, 15));

  /** Showdown calibration: strength percentile (0..1) of hands that bet/raised or called, per street. */
  betStrength = [0, 0.72, 0.75, 0.78].map((p) => new Mean(p, 8));
  callStrength = [0, 0.6, 0.65, 0.7].map((p) => new Mean(p, 8));
  /** Share of bets/raises made with weak hands (percentile < 0.5), from showdowns. */
  bluffShare = [0, 0.3, 0.27, 0.25].map((p) => new Stat(p, 12));

  /** Overall: went to showdown when seeing a flop. */
  wtsd = new Stat(0.3, 20);
}

/** Walks a hand history and updates every opponent's model. */
export function learnFromHand(
  models: Map<string, PlayerModel>,
  s: HandSummary,
  heroSeat: number,
  /** Board strength table for street 1..3 of this hand's board (shared with the hand tracker). */
  strengthFor: (street: number) => BoardStrength,
) {
  const n = s.numSeats;
  const bb = s.bigBlind;
  const get = (seat: number) => {
    const id = s.playerIds[seat];
    if (models instanceof Models) return models.getOrCreate(id);
    let m = models.get(id);
    if (!m) models.set(id, (m = new PlayerModel()));
    return m;
  };
  const vp = new Array<boolean>(n).fill(false);
  const pr = new Array<boolean>(n).fill(false);
  let raises = 0; // bets above the big blind, preflop
  let opener = -1;
  let threeBettor = -1;
  let currentBet = bb;
  const actedPre = new Array<boolean>(n).fill(false);
  let lastAggressor = -1;
  let prevStreetAggressor = -1;
  let street = 0;
  let betOnStreet = false;
  const aggressedOnStreet = new Array<boolean>(n).fill(false);
  const streetBet = new Array<number>(n).fill(0);
  let pot = 0;
  let curBet = 0;
  const sawFlop = new Array<boolean>(n).fill(false);
  // Actions per seat per street, for showdown calibration.
  const kinds: string[][][] = Array.from({ length: n }, () => [[], [], [], []]);

  for (const a of s.actions) {
    if (a.kind === 'post') {
      pot += a.amount;
      streetBet[a.seat] += a.amount;
      if (streetBet[a.seat] > curBet) curBet = streetBet[a.seat];
      continue;
    }
    if (a.street !== street) {
      streetBet.fill(0);
      curBet = 0;
      prevStreetAggressor = lastAggressor;
      lastAggressor = -1;
      street = a.street;
      betOnStreet = false;
      aggressedOnStreet.fill(false);
    }
    kinds[a.seat][street].push(a.kind);
    const isHero = a.seat === heroSeat;
    const m = isHero ? null : get(a.seat);
    const aggressive = a.kind === 'bet' || a.kind === 'raise';

    if (street === 0) {
      const pos = positionOf(a.seat, n);
      if (m && !actedPre[a.seat]) {
        if (raises === 0 && pos !== 'BB') {
          m.rfi[pos].add(aggressive);
          if (pos !== 'SB' || true) m.limp.add(a.kind === 'call');
        }
        if (raises === 1) {
          m.threeBet.add(aggressive);
          m.callOpen.add(a.kind === 'call');
        }
      }
      if (m && a.seat === opener && raises === 2) {
        m.foldTo3bet.add(a.kind === 'fold');
        m.fourBet.add(aggressive);
      }
      if (m && raises >= 3 && a.seat === threeBettor) m.foldTo4bet.add(a.kind === 'fold');
      if (a.kind === 'call' || aggressive) vp[a.seat] = true;
      if (aggressive) {
        pr[a.seat] = true;
        if (a.amount > currentBet) {
          raises++;
          currentBet = a.amount;
          if (raises === 1) opener = a.seat;
          if (raises === 2) threeBettor = a.seat;
        }
        lastAggressor = a.seat;
      }
      actedPre[a.seat] = true;
    } else {
      sawFlop[a.seat] = true;
      if (m) {
        if (!betOnStreet) {
          if (a.kind === 'check' || a.kind === 'bet') {
            if (a.seat === prevStreetAggressor) m.cbet[street].add(a.kind === 'bet');
            else m.aggr[street].add(a.kind === 'bet');
          }
        } else if (a.kind === 'fold' || a.kind === 'call' || a.kind === 'raise') {
          if (aggressedOnStreet[a.seat]) m.foldToRaise[street].add(a.kind === 'fold');
          else {
            const toCall = curBet - streetBet[a.seat];
            const alpha = toCall / Math.max(1, pot + toCall);
            m.foldBySize[street][alpha < 0.22 ? 0 : alpha < 0.3 ? 1 : 2].add(a.kind === 'fold');
            m.foldToBet[street].add(a.kind === 'fold');
            m.raiseVsBet[street].add(a.kind === 'raise');
          }
        }
      }
      if (aggressive) {
        betOnStreet = true;
        lastAggressor = a.seat;
        aggressedOnStreet[a.seat] = true;
      }
    }
    // Chip bookkeeping for pot-size tracking.
    if (a.kind === 'call') {
      pot += a.amount;
      streetBet[a.seat] += a.amount;
    } else if (aggressive) {
      pot += a.amount - streetBet[a.seat];
      streetBet[a.seat] = a.amount;
      if (a.amount > curBet) curBet = a.amount;
    }
  }

  for (let i = 0; i < n; i++) {
    if (i === heroSeat) continue;
    const m = get(i);
    m.hands++;
    m.vpip.add(vp[i]);
    m.pfr.add(pr[i]);
    if (sawFlop[i] || (s.board.length >= 3 && !foldedPreflop(s, i))) m.wtsd.add(s.shown[i] !== null);
    const shown = s.shown[i];
    if (!shown) continue;
    for (let st = 1; st <= 3 && st + 2 <= s.board.length; st++) {
      const ks = kinds[i][st];
      if (!ks.length) continue;
      const pct = strengthFor(st).pct[comboIndex(shown[0], shown[1])];
      if (ks.includes('bet') || ks.includes('raise')) {
        m.betStrength[st].add(pct);
        m.bluffShare[st].add(pct < 0.5);
      } else if (ks.includes('call')) m.callStrength[st].add(pct);
    }
  }
}

function foldedPreflop(s: HandSummary, seat: number) {
  return s.actions.some((a) => a.seat === seat && a.street === 0 && a.kind === 'fold');
}

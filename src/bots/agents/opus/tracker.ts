import type { BotView } from '../../types';
import { CARD_COMBOS, COMBO_A, COMBO_B, COMBO_CLASS, NCOMBO, classCombos } from './cards';
import { Models, PlayerModel } from './model';
import { positionOf } from './position';
import { computeBoardStrength, type BoardStrength } from './strength';
import { CLASS_ORDER, PCT_TOP } from './tables';

/**
 * Tracks every opponent's range through the current hand.
 * Preflop: 169 class weights. From the flop on: 1326 combo weights (expanded lazily).
 * Each opponent action multiplies the range by a likelihood: "keep the top q of the
 * current range" for raises, a middle band for calls, plus a bluff share drawn from the
 * bottom of the range; q comes from that opponent's modelled frequencies.
 */

const SIG = new Float32Array(2049);
for (let i = 0; i <= 2048; i++) SIG[i] = 1 / (1 + Math.exp(-((i - 1024) / 128)));
/** Logistic with a lookup table (input clamped to [-8, 8]). */
export function sig(x: number): number {
  const i = (x * 128 + 1024) | 0;
  return SIG[i < 0 ? 0 : i > 2048 ? 2048 : i];
}

const BINS = 64;

export interface SeatRange {
  pf: Float32Array; // 169
  w: Float32Array; // 1326 (valid once expanded)
  expanded: boolean;
  /** Board cards already removed from `w`. */
  prunedLen: number;
  /** Live combos (w > 0) and their count. */
  idx: Int16Array;
  cnt: number;
  /** Rank of each combo within this range (0 weakest .. 1 strongest), for the current street. */
  rr: Float32Array;
  rrStreet: number;
  rrVersion: number;
  version: number;
}

const newSeatRange = (): SeatRange => ({
  pf: new Float32Array(169).fill(1),
  w: new Float32Array(NCOMBO),
  expanded: false,
  prunedLen: 0,
  idx: new Int16Array(NCOMBO),
  cnt: 0,
  rr: new Float32Array(NCOMBO),
  rrStreet: -1,
  rrVersion: -1,
  version: 0,
});

export class HandTracker {
  handId = -1;
  n = 0;
  hero = 0;
  seats: SeatRange[] = [];
  processed = 0;
  // Betting reconstruction
  street = 0;
  currentBet = 0;
  raises = 0; // preflop raises above the big blind
  betOnStreet = false;
  lastAggressor = -1;
  prevStreetAggressor = -1;
  preflopAggressor = -1;
  opener = -1;
  limpers = 0;
  /** Number of bets/raises on the current street. */
  streetRaises = 0;
  /** All chips committed so far, and per-seat chips this street (reconstructed from actions). */
  pot = 0;
  streetBet: number[] = [];
  strengths: (BoardStrength | null)[] = [null, null, null, null];
  private strengthBuf: BoardStrength[] = [];
  private binMass = new Float32Array(BINS);

  reset(v: BotView) {
    this.handId = v.handId;
    this.n = v.numSeats;
    this.hero = v.seat;
    while (this.seats.length < this.n) this.seats.push(newSeatRange());
    for (let i = 0; i < this.n; i++) {
      const s = this.seats[i];
      s.pf.fill(1);
      s.expanded = false;
      s.prunedLen = 0;
      s.rrStreet = -1;
      s.version++;
    }
    this.processed = 0;
    this.street = 0;
    this.currentBet = v.bigBlind;
    this.raises = 0;
    this.betOnStreet = true; // the big blind counts as a bet preflop
    this.lastAggressor = -1;
    this.prevStreetAggressor = -1;
    this.preflopAggressor = -1;
    this.opener = -1;
    this.limpers = 0;
    this.streetRaises = 0;
    this.pot = 0;
    this.streetBet = new Array(this.n).fill(0);
    this.strengths[1] = this.strengths[2] = this.strengths[3] = null;
  }

  /** Forget cached board tables (used when learning from a hand this tracker didn't follow). */
  resetForBoard(handId: number) {
    this.handId = handId;
    this.processed = Number.MAX_SAFE_INTEGER;
    this.strengths[1] = this.strengths[2] = this.strengths[3] = null;
  }

  /** Board strength table for a street (1 flop, 2 turn, 3 river), computed once per hand. */
  strengthFor(street: number, board: readonly number[]): BoardStrength {
    let s = this.strengths[street];
    if (!s) {
      const buf = (this.strengthBuf[street] ??= { key: '', pct: new Float32Array(NCOMBO), eff: new Float32Array(NCOMBO), score: new Int32Array(NCOMBO) });
      s = computeBoardStrength(board, street + 2, buf);
      this.strengths[street] = s;
    }
    return s;
  }

  /** Process all new actions in the view, updating opponents' ranges. */
  update(v: BotView, models: Map<string, PlayerModel>) {
    if (v.handId !== this.handId) this.reset(v);
    const acts = v.actions;
    for (; this.processed < acts.length; this.processed++) {
      const a = acts[this.processed];
      if (a.kind === 'post') {
        this.pot += a.amount;
        this.streetBet[a.seat] += a.amount;
        continue;
      }
      if (a.street !== this.street) {
        this.streetBet.fill(0);
        this.prevStreetAggressor = this.lastAggressor;
        this.lastAggressor = -1;
        this.street = a.street;
        this.betOnStreet = false;
        this.currentBet = 0;
        this.streetRaises = 0;
      }
      const aggressive = a.kind === 'bet' || a.kind === 'raise';
      if (a.seat !== this.hero && a.kind !== 'fold') {
        const id = v.playerIds[a.seat];
        const m = models instanceof Models ? models.getOrCreate(id) : (models.get(id) ?? DEFAULT_MODEL);
        if (a.street === 0) this.preflopUpdate(a.seat, a.kind, m, v);
        else this.postflopUpdate(a.seat, a.kind, m, v);
      }
      if (a.street === 0) {
        if (aggressive && a.amount > this.currentBet) {
          this.raises++;
          if (this.raises === 1) this.opener = a.seat;
          this.preflopAggressor = a.seat;
        } else if (a.kind === 'call' && this.raises === 0) this.limpers++;
      }
      if (aggressive) {
        this.betOnStreet = true;
        this.lastAggressor = a.seat;
        this.streetRaises++;
        if (a.amount > this.currentBet) this.currentBet = a.amount;
        this.pot += a.amount - this.streetBet[a.seat];
        this.streetBet[a.seat] = a.amount;
      } else if (a.kind === 'call') {
        this.pot += a.amount;
        this.streetBet[a.seat] += a.amount;
      }
    }
  }

  /* ------------------------------------------------------------- preflop */

  /** Class-strength threshold (PCT_TOP units) that keeps the top `q` of the seat's current range. */
  private pfThreshold(pf: Float32Array, q: number): number {
    let total = 0;
    for (let c = 0; c < 169; c++) total += pf[c] * classCombos(c);
    const target = total * Math.max(0.001, Math.min(1, q));
    let acc = 0;
    for (const c of CLASS_ORDER) {
      acc += pf[c] * classCombos(c);
      if (acc >= target) return PCT_TOP[c];
    }
    return 1;
  }

  private preflopUpdate(seat: number, kind: string, m: PlayerModel, v: BotView) {
    const pf = this.seats[seat].pf;
    const pos = positionOf(seat, v.numSeats);
    const aggressive = kind === 'bet' || kind === 'raise';
    let lo = 0; // keep band [lo, hi] of the current range (top fraction units)
    let hi = 1;
    let floor = 0.01;
    if (this.raises === 0) {
      if (kind === 'check') {
        // BB checking its option: strong hands would usually raise.
        lo = pos === 'BB' ? 0.1 : 0;
        hi = 1;
        floor = 0.15;
      } else if (aggressive) {
        hi = this.limpers > 0 ? 0.15 : m.rfi[pos].p;
        floor = 0.005;
      } else {
        // limp / complete
        lo = Math.min(0.5, m.rfi[pos === 'BB' ? 'SB' : pos].p * 0.6);
        hi = Math.min(1, lo + Math.max(0.05, m.vpip.p - m.pfr.p) * (pos === 'SB' ? 2.5 : 1.5));
        floor = 0.03;
      }
    } else if (this.raises === 1) {
      const tb = m.threeBet.p;
      if (aggressive) {
        hi = tb;
        floor = 0.004;
      } else {
        const call = m.callOpen.p * (pos === 'BB' ? 2.2 : pos === 'SB' ? 0.8 : 1);
        lo = tb * 0.5;
        hi = Math.min(1, tb + call);
      }
    } else if (this.raises === 2) {
      const fb = m.fourBet.p;
      if (aggressive) {
        hi = fb;
        floor = 0.002;
      } else {
        lo = fb * 0.4;
        hi = Math.min(1, fb + Math.max(0.05, 1 - m.foldTo3bet.p - fb));
      }
    } else {
      if (aggressive) hi = 0.45;
      else {
        lo = 0.15;
        hi = Math.min(1, Math.max(0.2, 1 - m.foldTo4bet.p));
      }
      floor = 0.002;
    }
    const tHi = this.pfThreshold(pf, hi);
    const tLo = lo > 0 ? this.pfThreshold(pf, lo) : -1;
    const tau = 0.012 + 0.04 * hi;
    for (let c = 0; c < 169; c++) {
      if (pf[c] === 0) continue;
      const pt = PCT_TOP[c];
      let l = sig((tHi - pt) / tau);
      if (tLo >= 0) l *= 1 - 0.85 * sig((tLo - pt) / 0.015);
      pf[c] *= l + floor;
    }
    this.seats[seat].version++;
  }

  /* ------------------------------------------------------------ postflop */

  /** Expand class weights to combos (card removal: hero's hole cards and the board). */
  expand(seat: number, v: BotView) {
    const s = this.seats[seat];
    if (s.expanded) return;
    const h0 = v.hole[0];
    const h1 = v.hole[1];
    const b = v.board;
    let cnt = 0;
    s.w.fill(0);
    for (let k = 0; k < NCOMBO; k++) {
      const x = s.pf[COMBO_CLASS[k]];
      if (x < 1e-4) continue;
      const a = COMBO_A[k];
      const c = COMBO_B[k];
      let dead = a === h0 || a === h1 || c === h0 || c === h1;
      for (let i = 0; i < b.length && !dead; i++) if (a === b[i] || c === b[i]) dead = true;
      if (dead) continue;
      s.w[k] = x;
      s.idx[cnt++] = k;
    }
    s.cnt = cnt;
    s.expanded = true;
    s.prunedLen = b.length;
    s.version++;
  }

  /** Remove combos that use board cards not yet removed. */
  private prune(seat: number, v: BotView) {
    const s = this.seats[seat];
    const b = v.board;
    if (s.prunedLen >= b.length) return;
    for (let i = s.prunedLen; i < b.length; i++) {
      const base = b[i] * 51;
      for (let j = 0; j < 51; j++) s.w[CARD_COMBOS[base + j]] = 0;
    }
    s.prunedLen = b.length;
    this.compact(s);
  }

  /** Drop combos with negligible weight from the live list (zeroing them). */
  private compact(s: SeatRange) {
    const w = s.w;
    const idx = s.idx;
    let max = 0;
    for (let j = 0; j < s.cnt; j++) if (w[idx[j]] > max) max = w[idx[j]];
    const cut = max * 2e-3;
    let n = 0;
    for (let j = 0; j < s.cnt; j++) {
      const k = idx[j];
      if (w[k] > cut) idx[n++] = k;
      else w[k] = 0;
    }
    s.cnt = n;
    s.version++;
  }

  /**
   * Rank of each live combo within the range the seat entered `street` with (bucketed by
   * effective strength). Computed once per street: "bets with the top x of its range" refers
   * to that range, and equity bins are cut by remaining mass, so later narrowing is fine.
   */
  rankInRange(seat: number, street: number, v: BotView): Float32Array {
    const s = this.seats[seat];
    if (s.rrStreet === street) return s.rr;
    const eff = this.strengthFor(street, v.board).eff;
    const mass = this.binMass.fill(0);
    const idx = s.idx;
    const w = s.w;
    let total = 0;
    for (let j = 0; j < s.cnt; j++) {
      const k = idx[j];
      const b = (eff[k] * BINS) | 0;
      const x = w[k];
      mass[b >= BINS ? BINS - 1 : b] += x;
      total += x;
    }
    let acc = 0;
    const cum = CUM;
    const inv = total > 0 ? 1 / total : 0;
    for (let b = 0; b < BINS; b++) {
      cum[b] = (acc + mass[b] * 0.5) * inv;
      acc += mass[b];
    }
    for (let j = 0; j < s.cnt; j++) {
      const k = idx[j];
      const b = (eff[k] * BINS) | 0;
      s.rr[k] = cum[b >= BINS ? BINS - 1 : b];
    }
    s.rrStreet = street;
    s.rrVersion = s.version;
    return s.rr;
  }

  private postflopUpdate(seat: number, kind: string, m: PlayerModel, v: BotView) {
    const street = this.street;
    const s = this.seats[seat];
    this.expand(seat, v);
    this.prune(seat, v);
    const rr = this.rankInRange(seat, street, v);
    const w = s.w;
    const idx = s.idx;
    const cnt = s.cnt;
    if (!this.betOnStreet) {
      const a = seat === this.prevStreetAggressor ? m.cbet[street].p : m.aggr[street].p;
      const b = m.bluffShare[street].p;
      const value = a * (1 - b);
      if (kind === 'bet') {
        const t = 1 - value;
        const bl = (a * b) / 0.5;
        for (let j = 0; j < cnt; j++) {
          const k = idx[j];
          w[k] *= sig((rr[k] - t) / 0.05) + (rr[k] < 0.5 ? bl : 0) + 0.01;
        }
      } else {
        // check: mostly not the top; keep some slow-plays
        const t = 1 - value * 0.85;
        for (let j = 0; j < cnt; j++) {
          const k = idx[j];
          w[k] *= 1 - 0.75 * sig((rr[k] - t) / 0.05);
        }
      }
    } else {
      const r = m.raiseVsBet[street].p * (this.streetRaises > 1 ? 0.6 : 1);
      const b = m.bluffShare[street].p;
      if (kind === 'raise') {
        const t = 1 - r * (1 - b) * 1.5;
        const bl = (r * b) / 0.5;
        for (let j = 0; j < cnt; j++) {
          const k = idx[j];
          w[k] *= sig((rr[k] - t) / 0.04) + (rr[k] < 0.5 ? bl : 0) + 0.005;
        }
      } else {
        // call: the folded share depends on the price they were offered
        const toCall = this.currentBet - this.streetBet[seat];
        const alpha = toCall / Math.max(1, this.pot + toCall);
        const tf = Math.min(0.9, this.streetRaises > 1 ? m.foldToRaise[street].p : m.foldAt(street, alpha));
        const tr = 1 - r * 0.7;
        for (let j = 0; j < cnt; j++) {
          const k = idx[j];
          w[k] *= sig((rr[k] - tf) / 0.06) * (1 - 0.6 * sig((rr[k] - tr) / 0.03)) + 0.01;
        }
      }
    }
    this.compact(s);
  }

  /** Make sure an opponent's combo range exists and reflects the current board. */
  ensurePostflop(seat: number, v: BotView) {
    const s = this.seats[seat];
    if (!s.expanded) this.expand(seat, v);
    else this.prune(seat, v);
  }
}

const CUM = new Float32Array(BINS);
const DEFAULT_MODEL = new PlayerModel();
export { DEFAULT_MODEL };

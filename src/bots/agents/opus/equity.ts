import { accFrom, evalWith2, addCard, resetAcc, newAcc, type CardAcc } from '../../../sim/eval';
import { COMBO_A, COMBO_B, NCOMBO, comboIndex } from './cards';
import type { BoardStrength } from './strength';

/**
 * Hero equity against weighted opponent ranges.
 * Besides the overall share, it records, per opponent, a histogram over that opponent's
 * rank-in-range (0 = bottom of their range, 1 = top) with hero's heads-up result in
 * each bin. "Opponent folds the bottom f of their range" then gives, from one pass,
 * both the fold probability (f) and hero's equity when called (top 1 - f bins).
 */

export const EQ_BINS = 20;

export interface Opp {
  w: Float32Array;
  rr: Float32Array;
  /** Live combo list (w > 0) and its length. */
  idx: Int16Array;
  cnt: number;
}

export interface EquityResult {
  eq: number;
  nOpp: number;
  /** mass[i * EQ_BINS + b], win[i * EQ_BINS + b]: samples and hero heads-up wins vs opponent i. */
  mass: Float64Array;
  win: Float64Array;
}

const MAX_OPP = 9;
const cdfs = Array.from({ length: MAX_OPP }, () => new Float64Array(NCOMBO));
const lists = Array.from({ length: MAX_OPP }, () => new Int16Array(NCOMBO));
const lens = new Int32Array(MAX_OPP);
const totals = new Float64Array(MAX_OPP);
const res: EquityResult = { eq: 0, nOpp: 0, mass: new Float64Array(MAX_OPP * EQ_BINS), win: new Float64Array(MAX_OPP * EQ_BINS) };
const stampArr = new Uint32Array(52);
let stamp = 1;
const picks = new Int32Array(MAX_OPP);
const oppScore = new Int32Array(MAX_OPP);
const full: CardAcc = newAcc();
const runout = new Int32Array(5);

function sampleCombo(cdf: Float64Array, list: Int16Array, len: number, total: number, u: number): number {
  const x = u * total;
  let lo = 0;
  let hi = len - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return list[lo];
}

const binOf = (r: number) => {
  const b = (r * EQ_BINS) | 0;
  return b < 0 ? 0 : b >= EQ_BINS ? EQ_BINS - 1 : b;
};

export function equityVsRanges(
  hole: readonly number[],
  board: readonly number[],
  opps: Opp[],
  samples: number,
  rnd: () => number,
  river: BoardStrength | null,
): EquityResult {
  const n = Math.min(opps.length, MAX_OPP);
  res.nOpp = n;
  res.mass.fill(0, 0, n * EQ_BINS);
  res.win.fill(0, 0, n * EQ_BINS);
  const h0 = hole[0];
  const h1 = hole[1];
  // Build CDFs, removing combos blocked by hero / board.
  stamp++;
  stampArr[h0] = stamp;
  stampArr[h1] = stamp;
  for (let i = 0; i < board.length; i++) stampArr[board[i]] = stamp;
  for (let i = 0; i < n; i++) {
    const o = opps[i];
    const w = o.w;
    const cdf = cdfs[i];
    const list = lists[i];
    let acc = 0;
    let len = 0;
    for (let j = 0; j < o.cnt; j++) {
      const k = o.idx[j];
      const x = w[k];
      if (x > 0 && stampArr[COMBO_A[k]] !== stamp && stampArr[COMBO_B[k]] !== stamp) {
        acc += x;
        cdf[len] = acc;
        list[len++] = k;
      }
    }
    lens[i] = len;
    totals[i] = acc;
  }
  for (let i = 0; i < n; i++) if (!(totals[i] > 0)) return fallback(n);

  // Exact heads-up river.
  if (n === 1 && board.length === 5 && river) {
    const me = river.score[comboIndex(h0, h1)];
    const w = opps[0].w;
    const rr = opps[0].rr;
    const list = lists[0];
    let tot = 0;
    let won = 0;
    for (let j = 0; j < lens[0]; j++) {
      const k = list[j];
      const x = w[k];
      const s = river.score[k];
      const r = me > s ? 1 : me === s ? 0.5 : 0;
      const b = binOf(rr[k]);
      res.mass[b] += x;
      res.win[b] += x * r;
      tot += x;
      won += x * r;
    }
    res.eq = tot > 0 ? won / tot : 0.5;
    return res;
  }

  const baseStamp = stamp;
  const need = 5 - board.length;
  const boardAcc = accFrom(board, board.length);
  let eqSum = 0;
  let done = 0;
  for (let t = 0; t < samples; t++) {
    stamp++;
    // Re-mark hero + board for this sample.
    stampArr[h0] = stamp;
    stampArr[h1] = stamp;
    for (let i = 0; i < board.length; i++) stampArr[board[i]] = stamp;
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      let k = -1;
      for (let tries = 0; tries < 12; tries++) {
        const c = sampleCombo(cdfs[i], lists[i], lens[i], totals[i], rnd());
        if (stampArr[COMBO_A[c]] !== stamp && stampArr[COMBO_B[c]] !== stamp) {
          k = c;
          break;
        }
      }
      if (k < 0) ok = false;
      else {
        picks[i] = k;
        stampArr[COMBO_A[k]] = stamp;
        stampArr[COMBO_B[k]] = stamp;
      }
    }
    if (!ok) continue;
    for (let j = 0; j < need; j++) {
      let c: number;
      do c = (rnd() * 52) | 0;
      while (stampArr[c] === stamp);
      stampArr[c] = stamp;
      runout[j] = c;
    }
    let me: number;
    if (need === 0 && river) {
      me = river.score[comboIndex(h0, h1)];
      for (let i = 0; i < n; i++) oppScore[i] = river.score[picks[i]];
    } else {
      full.rankKey = boardAcc.rankKey;
      full.suitKey = boardAcc.suitKey;
      full.m0 = boardAcc.m0;
      full.m1 = boardAcc.m1;
      full.m2 = boardAcc.m2;
      full.m3 = boardAcc.m3;
      for (let j = 0; j < need; j++) addCard(full, runout[j]);
      me = evalWith2(full, h0, h1);
      for (let i = 0; i < n; i++) oppScore[i] = evalWith2(full, COMBO_A[picks[i]], COMBO_B[picks[i]]);
    }
    let best = 0;
    let ties = 0;
    for (let i = 0; i < n; i++) {
      const s = oppScore[i];
      const r = me > s ? 1 : me === s ? 0.5 : 0;
      const b = i * EQ_BINS + binOf(opps[i].rr[picks[i]]);
      res.mass[b] += 1;
      res.win[b] += r;
      if (s > best) {
        best = s;
        ties = 0;
      }
      if (s === best) ties++;
    }
    eqSum += me > best ? 1 : me === best ? 1 / (ties + 1) : 0;
    done++;
  }
  void baseStamp;
  resetAcc(full);
  res.eq = done ? eqSum / done : 0.5;
  return res;
}

function fallback(n: number): EquityResult {
  res.eq = 1 / (n + 1);
  for (let i = 0; i < n; i++) {
    res.mass[i * EQ_BINS] = 1;
    res.win[i * EQ_BINS] = res.eq;
  }
  return res;
}

/**
 * Hero heads-up equity vs opponent i over the strongest (1 - foldFrac) of their current range
 * (cut by sampled mass, bins ordered by rank-in-range), plus overall heads-up equity.
 */
export function calledEquity(r: EquityResult, i: number, foldFrac: number): { eqCalled: number; eqAll: number; calledMass: number } {
  const base = i * EQ_BINS;
  let mAll = 0;
  let wAll = 0;
  for (let b = 0; b < EQ_BINS; b++) {
    mAll += r.mass[base + b];
    wAll += r.win[base + b];
  }
  if (mAll <= 0) return { eqCalled: 0, eqAll: 0.5, calledMass: 0 };
  let skip = foldFrac * mAll; // mass that folds, taken from the bottom
  let mC = 0;
  let wC = 0;
  for (let b = 0; b < EQ_BINS; b++) {
    const m = r.mass[base + b];
    if (m <= 0) continue;
    const w = r.win[base + b];
    if (skip >= m) {
      skip -= m;
      continue;
    }
    const keep = (m - skip) / m;
    skip = 0;
    mC += m * keep;
    wC += w * keep;
  }
  return { eqCalled: mC > 0 ? wC / mC : 0, eqAll: wAll / mAll, calledMass: mC / mAll };
}

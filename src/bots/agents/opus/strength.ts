import { CARD_BIT, accFrom, evalWith2, type CardAcc } from '../../../sim/eval';
import { COMBO_A, COMBO_B, NCOMBO } from './cards';

/**
 * Board-relative hand strength for every combo.
 * - `pct[k]`: share of all live combos that combo k beats right now (ties count half), 0..1.
 * - `eff[k]`: pct boosted for draws on the flop/turn, a cheap proxy for "how much the
 *   hand likes to continue", used for range modelling and for fold/call thresholds.
 */

/** Ranks that complete a straight for a 13-bit rank mask that has none yet. */
const STRAIGHT_OUTS = new Uint8Array(8192);
const hasStraight = (m: number) => {
  const x = (m << 1) | ((m >> 12) & 1);
  return (x & (x << 1) & (x << 2) & (x << 3) & (x << 4)) !== 0;
};
for (let m = 0; m < 8192; m++) {
  if (hasStraight(m)) continue;
  let outs = 0;
  for (let r = 0; r < 13; r++) if (!(m & (1 << r)) && hasStraight(m | (1 << r))) outs++;
  STRAIGHT_OUTS[m] = outs;
}

export interface BoardStrength {
  key: string;
  pct: Float32Array;
  eff: Float32Array;
  score: Int32Array;
}

const valid = new Int16Array(NCOMBO);
const tmp = new Int16Array(NCOMBO);
const order = new Int16Array(NCOMBO);
const cnt = new Int32Array(4096);

export function computeBoardStrength(board: readonly number[], len: number, out?: BoardStrength): BoardStrength {
  const res = out ?? { key: '', pct: new Float32Array(NCOMBO), eff: new Float32Array(NCOMBO), score: new Int32Array(NCOMBO) };
  const acc: CardAcc = accFrom(board, len);
  let dlo = 0;
  let dhi = 0;
  let boardRanks = 0;
  const suitCount = [0, 0, 0, 0];
  for (let i = 0; i < len; i++) {
    const c = board[i];
    if (c < 26) dlo |= 1 << c;
    else dhi |= 1 << (c - 26);
    boardRanks |= CARD_BIT[c];
    suitCount[c & 3]++;
  }
  let nValid = 0;
  for (let k = 0; k < NCOMBO; k++) {
    const a = COMBO_A[k];
    const b = COMBO_B[k];
    const blocked = (a < 26 ? (dlo >>> a) & 1 : (dhi >>> (a - 26)) & 1) | (b < 26 ? (dlo >>> b) & 1 : (dhi >>> (b - 26)) & 1);
    if (blocked) {
      res.score[k] = -1;
      continue;
    }
    res.score[k] = evalWith2(acc, a, b);
    valid[nValid++] = k;
  }
  // Radix-sort valid combos by score (two 12-bit passes), then one linear pass for percentiles.
  cnt.fill(0);
  for (let j = 0; j < nValid; j++) cnt[res.score[valid[j]] & 4095]++;
  for (let i = 1; i < 4096; i++) cnt[i] += cnt[i - 1];
  for (let j = nValid - 1; j >= 0; j--) {
    const k = valid[j];
    tmp[--cnt[res.score[k] & 4095]] = k;
  }
  cnt.fill(0);
  for (let j = 0; j < nValid; j++) cnt[(res.score[tmp[j]] >> 12) & 4095]++;
  for (let i = 1; i < 4096; i++) cnt[i] += cnt[i - 1];
  for (let j = nValid - 1; j >= 0; j--) {
    const k = tmp[j];
    order[--cnt[(res.score[k] >> 12) & 4095]] = k;
  }
  res.pct.fill(0);
  res.eff.fill(0);
  for (let j = 0; j < nValid; ) {
    const sc = res.score[order[j]];
    let e = j;
    while (e < nValid && res.score[order[e]] === sc) e++;
    const p = (j + (e - j) * 0.5) / nValid;
    for (let x = j; x < e; x++) res.pct[order[x]] = p;
    j = e;
  }
  const boardOuts = STRAIGHT_OUTS[boardRanks];
  for (let j = 0; j < nValid; j++) {
    const k = valid[j];
    const p = res.pct[k];
    let e = p;
    if (len < 5) {
      const a = COMBO_A[k];
      const b = COMBO_B[k];
      // Flush draw: four of a suit with at least one hole card in it.
      let fd = false;
      for (let su = 0; su < 4; su++) {
        const n = suitCount[su] + ((a & 3) === su ? 1 : 0) + ((b & 3) === su ? 1 : 0);
        if (n === 4 && ((a & 3) === su || (b & 3) === su)) fd = true;
      }
      const ranks = boardRanks | CARD_BIT[a] | CARD_BIT[b];
      const outs = hasStraight(ranks) ? 0 : STRAIGHT_OUTS[ranks];
      const sd = outs > boardOuts ? outs : 0; // only draws the hole cards contribute to
      const flop = len === 3;
      let d = 0;
      if (fd && sd >= 2) d = flop ? 0.8 : 0.66;
      else if (fd && sd === 1) d = flop ? 0.72 : 0.6;
      else if (fd) d = flop ? 0.64 : 0.55;
      else if (sd >= 2) d = flop ? 0.6 : 0.5;
      else if (sd === 1) d = flop ? 0.46 : 0.4;
      if (d > e) e = d * 0.85 + e * 0.15;
    }
    res.eff[k] = e;
  }
  return res;
}

/** Percentile of one specific hand on a board (used for showdown calibration). */
export function strengthPercentile(a: number, b: number, board: readonly number[], len: number): number {
  const acc = accFrom(board, len);
  const mine = evalWith2(acc, a, b);
  const dead = new Uint8Array(52);
  for (let i = 0; i < len; i++) dead[board[i]] = 1;
  dead[a] = dead[b] = 1;
  let below = 0;
  let ties = 0;
  let total = 0;
  for (let k = 0; k < NCOMBO; k++) {
    const x = COMBO_A[k];
    const y = COMBO_B[k];
    if (dead[x] || dead[y]) continue;
    const s = evalWith2(acc, x, y);
    total++;
    if (s < mine) below++;
    else if (s === mine) ties++;
  }
  return total ? (below + ties * 0.5) / total : 0.5;
}

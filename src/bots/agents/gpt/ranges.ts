import type { BotView } from '../../types';
import { addCard, evalWith2, newAcc } from '../../../sim/eval';
import { CLASS, COMBOS, FIRST, SECOND, MASK_LO, MASK_HI, HIGH, LOW, SUITED, RATING, clamp, drawOf, newTexture, readTexture, tierOf } from './cards';
import { EQUITY_PROFILES } from './charts';
import { BET, BET_CALLED_RAISE, CHECKED, SIZE_BANDS, type History } from './history';
import type { Profile } from './model';

const STRIDE = 55; // 11 made-hand tiers × 5 draw tiers
const TABLE_SIZE = STRIDE * 3; // hero loses, ties, wins
const CDF_BINS = 64;

// Action likelihood conditional on made-hand tier. Draws get a separate uplift.
const REACH = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0.78, 0.73, 0.81, 0.78, 0.74, 0.66, 0.57, 0.48, 0.45, 0.45, 0.49],
  [0.05, 0.15, 0.38, 0.66, 0.78, 0.83, 0.84, 0.68, 0.64, 0.66, 0.65],
  [0.025, 0.06, 0.19, 0.39, 0.59, 0.75, 0.81, 0.75, 0.70, 0.71, 0.71],
  [0.013, 0.027, 0.075, 0.18, 0.35, 0.58, 0.71, 0.79, 0.77, 0.8, 0.82],
  [0.24, 0.28, 0.24, 0.25, 0.32, 0.54, 0.70, 0.69, 0.68, 0.67, 0.65],
  [0.135, 0.145, 0.11, 0.12, 0.19, 0.37, 0.58, 0.73, 0.76, 0.78, 0.82],
  [0.078, 0.080, 0.053, 0.055, 0.086, 0.16, 0.33, 0.62, 0.78, 0.82, 0.86],
  [0.028, 0.024, 0.013, 0.018, 0.028, 0.065, 0.16, 0.52, 0.69, 0.78, 0.86],
  [0.012, 0.011, 0.008, 0.010, 0.015, 0.031, 0.10, 0.40, 0.63, 0.78, 0.91],
  [0.036, 0.028, 0.014, 0.018, 0.024, 0.053, 0.15, 0.41, 0.67, 0.81, 0.92],
  [0.009, 0.017, 0.038, 0.079, 0.17, 0.36, 0.58, 0.72, 0.73, 0.76, 0.79],
  [0.005, 0.007, 0.013, 0.026, 0.066, 0.16, 0.32, 0.64, 0.73, 0.78, 0.84],
];
const DRAW = [0, 0.11, 0.29, 0.39, 0.55];
const PREFLOP_CONTINUE = [
  new Float32Array(169).fill(1),
  Float32Array.from(RATING, (rating, id) => {
    const extra = HIGH[id] === LOW[id] ? 3.5 : SUITED[id] ? 2.5 : -3;
    return clamp((rating + extra - 45) / 27, 0.043, 0.91);
  }),
  Float32Array.from(RATING, (rating, id) => {
    const extra = HIGH[id] === LOW[id] ? 2 : SUITED[id] ? 4.5 : 0;
    return clamp((rating + extra - 62) / 20, 0.018, 0.93);
  }),
];

function reachRow(out: Float32Array, offset: number, action: number, street: number, p: Profile, players: number, band: number) {
  for (let tier = 0; tier <= 10; tier++) {
    for (let draw = 0; draw <= 4; draw++) {
      let weight = REACH[action][tier];
      if (action === CHECKED) {
        weight += 0.22 * clamp(-p.looseBet[street] * 3, -0.6, 1) - DRAW[draw] * 0.15;
        // A routine first-to-act check discloses little of the hand.
        weight = 0.64 + 0.36 * weight;
      } else if ((action > CHECKED && action < BET) || action >= BET_CALLED_RAISE) {
        const potential = DRAW[draw] * (street === 1 ? 1.18 : 0.80) * (action >= BET_CALLED_RAISE ? 0.70 : 1);
        weight = weight + (1 - weight) * (potential + Math.max(0, p.sticky[street]) * 0.97)
          + Math.min(0, p.sticky[street]) * ((10 - tier) / 10) * 0.42;
        if (players > 2 && tier < 5) weight *= 0.88;
      } else if (action >= BET) {
        const polar = action >= BET + 1;
        const potential = DRAW[draw] * (action >= BET + 2 ? 0.69 : 0.79);
        const shape = p.sizeSignal[(street - 1) * SIZE_BANDS + band];
        const loose = p.looseBet[street] + shape + (polar ? p.largeBluff[street] * (action <= BET + 2 ? 0.71 : 0.39) : 0);
        const isWeak = tier <= 3;
        weight += (1 - weight) * potential;
        if (street === 3 && isWeak && polar) weight *= 1.36;
        if (isWeak) {
          weight += (1 - weight) * Math.max(0, loose) * (tier <= 2 ? 0.85 : 0.55);
          weight *= 1 + Math.min(0, loose) * (action >= BET + 2 ? 4.4 : 3.5);
          if (players > 2) weight *= street === 3 ? 0.52 : 0.73;
        }
        if (action >= BET + 2 && p.wild > 0) weight = weight * (1 - p.wild * 0.45) + 0.49 * p.wild;
      }
      out[offset + tier * 5 + draw] = clamp(weight, 0.003, 1);
    }
  }
}

export class Ranges {
  readonly textures = [newTexture(), newTexture(), newTexture()];
  readonly countBySeat = new Uint8Array(10);
  readonly opponents = new Uint8Array(9);
  readonly hist = new Float64Array(9 * TABLE_SIZE);
  readonly strength = new Float64Array(9);
  readonly sampled = new Float64Array(9);
  readonly mass = new Float64Array(9);
  private readonly historyRows = new Float32Array(9 * 3 * STRIDE);
  private readonly cdf = new Float64Array(9 * COMBOS);
  private readonly cdfBins = new Uint16Array(9 * (CDF_BINS + 1));
  private readonly comboIds = new Uint16Array(COMBOS);
  private readonly features = new Uint8Array(3 * COMBOS);
  private readonly scores = new Int32Array(COMBOS);
  private readonly drawn = new Uint16Array(9);
  private readonly trialScores = new Int32Array(9);
  private readonly marginal = new Float64Array(9);
  private readonly levelPots = new Float64Array(10);
  private readonly levelEligible = new Uint16Array(10);
  private readonly simBoard = newAcc();
  private blockedLo = 0;
  private blockedHi = 0;
  private comboCount = 0;
  private prevHand = -1;
  private prevStreet = -1;
  private prevA = -1;
  private prevB = -1;
  private boardKey = -1;
  heroScore = 0;
  heroTier = 0;
  heroDraw = 0;
  count = 0;
  effective = 0;
  active = 0;
  share = 0;
  sideShare = 0;

  private prepare(v: BotView, a: number, b: number) {
    // Compare scalar board identity so caches also work when a live view is recycled.
    let key = 0;
    let prefix = 0;
    for (let i = 0; i < v.board.length; i++) {
      key = key * 53 + v.board[i] + 1;
      if (i === this.prevStreet + 1) prefix = key;
    }
    const samePrefix = v.handId === this.prevHand && prefix === this.boardKey && a === this.prevA && b === this.prevB;
    if (samePrefix && v.street === this.prevStreet) return;
    const cachedStreets = samePrefix ? this.prevStreet : 0;
    this.prevHand = v.handId;
    this.prevStreet = v.street;
    this.prevA = a;
    this.prevB = b;
    this.boardKey = key;
    let blockedLo = MASK_LO[a] | MASK_LO[b];
    let blockedHi = MASK_HI[a] | MASK_HI[b];
    for (let i = 0; i < v.board.length; i++) {
      blockedLo |= MASK_LO[v.board[i]];
      blockedHi |= MASK_HI[v.board[i]];
    }
    this.blockedLo = blockedLo;
    this.blockedHi = blockedHi;
    const street = v.street;
    for (let s = cachedStreets; s < street; s++) readTexture(this.textures[s], v.board, s + 3);
    const texture = this.textures[street - 1];
    this.heroScore = evalWith2(texture.acc, a, b);
    this.heroTier = tierOf(texture, a, b, this.heroScore);
    this.heroDraw = drawOf(texture, a, b, this.heroScore);
    let n = 0;
    for (let combo = 0; combo < COMBOS; combo++) {
      const x = FIRST[combo];
      const y = SECOND[combo];
      if ((blockedLo & (MASK_LO[x] | MASK_LO[y])) || (blockedHi & (MASK_HI[x] | MASK_HI[y]))) continue;
      this.comboIds[n] = combo;
      for (let s = cachedStreets; s < street; s++) {
        const t = this.textures[s];
        const score = evalWith2(t.acc, x, y);
        if (s === street - 1) this.scores[n] = score;
        this.features[s * COMBOS + combo] = 5 * tierOf(t, x, y, score) + drawOf(t, x, y, score);
      }
      n++;
    }
    this.comboCount = n;
  }

  read(v: BotView, h: History, model: readonly Profile[], rnd: () => number) {
    const a = v.hole[0];
    const b = v.hole[1];
    this.prepare(v, a, b);
    const street = v.street;
    this.count = this.active = this.effective = 0;
    this.countBySeat.fill(255);
    for (let seat = 0; seat < v.numSeats; seat++) {
      if (seat === v.seat || v.folded[seat]) continue;
      this.countBySeat[seat] = this.count;
      this.opponents[this.count++] = seat;
      if (!v.allIn[seat]) this.active++;
      this.effective = Math.max(this.effective, v.stacks[seat]);
    }
    this.effective = Math.min(this.effective, v.stacks[v.seat]);
    this.hist.fill(0, 0, this.count * TABLE_SIZE);
    const rows = this.historyRows;
    const heroScore = this.heroScore;
    const n = this.comboCount;
    const currentOffset = (street - 1) * COMBOS;
    const features = this.features;
    const scanRunouts = street < 3 || this.count > 1;
    for (let o = 0; o < this.count; o++) {
      const seat = this.opponents[o];
      const p = model[seat];
      let prior = h.preProfile[seat];
      if (h.preRaises[seat] > 0 && h.preOpenTo > 7 && h.raises[0] === 1) prior = h.preOpenTo > 16 ? 11 : 8;
      const priorRow = EQUITY_PROFILES[prior];
      const wideCalls = EQUITY_PROFILES[6];
      const blindDefense = seat === v.bbSeat && prior === 7 && h.raises[0] === 1
        ? clamp((2.9 - h.preOpenTo) * 0.22, 0, 0.23) : 0;
      const wide = prior === 0 ? 0 : clamp(p.wild * (h.preRaises[seat] > 0 ? 0.75 : 0.45)
        + Math.max(0, h.preRaises[seat] > 0 ? p.light * 0.20 : p.loose * 1.09), 0, 0.87);
      const power = prior > 0 ? 1 - wide : 1;
      const broad = wide * (prior === 6 ? 0.66 : prior === 7 ? 0.32 : 0.22);
      const narrowed = h.preContinues[seat];
      const retention = PREFLOP_CONTINUE[narrowed];
      const narrowing = 0.58 * (1 - p.wild * 0.60 - Math.max(0, p.loose) * 0.32);
      const row = o * 3 * STRIDE;
      const cdfBase = o * COMBOS;
      const histBase = o * TABLE_SIZE;
      const l1 = h.line[10 + seat];
      const l2 = street >= 2 ? h.line[20 + seat] : 0;
      const l3 = street === 3 ? h.line[30 + seat] : 0;
      if (l1) reachRow(rows, row, l1, 1, p, this.count + 1, h.sizes[10 + seat]);
      if (l2) reachRow(rows, row + STRIDE, l2, 2, p, this.count + 1, h.sizes[20 + seat]);
      if (l3) reachRow(rows, row + 2 * STRIDE, l3, 3, p, this.count + 1, h.sizes[30 + seat]);
      let mass = 0;
      let ahead = 0;
      for (let i = 0; i < n; i++) {
        const combo = this.comboIds[i];
        const id = CLASS[combo];
        let weight = (priorRow[id] + blindDefense * wideCalls[id]) * power + broad;
        if (narrowed) weight *= 1 - (1 - retention[id]) * narrowing;
        if (l1) weight *= rows[row + features[combo]];
        if (l2) weight *= rows[row + STRIDE + features[COMBOS + combo]];
        if (l3) weight *= rows[row + 2 * STRIDE + features[2 * COMBOS + combo]];
        mass += weight;
        this.cdf[cdfBase + i] = mass;
        const score = this.scores[i];
        const comparison = score > heroScore ? 0 : score === heroScore ? 1 : 2;
        this.hist[histBase + comparison * STRIDE + features[currentOffset + combo]] += weight;
        ahead += weight * (comparison * 0.5);
      }
      if (scanRunouts) {
        const bins = o * (CDF_BINS + 1);
        const step = mass / CDF_BINS;
        let i = 0;
        for (let j = 0; j < CDF_BINS; j++) {
          const mark = j * step;
          while (i + 1 < n && this.cdf[cdfBase + i] <= mark) i++;
          this.cdfBins[bins + j] = i;
        }
        this.cdfBins[bins + CDF_BINS] = n - 1;
      }
      this.mass[o] = mass;
      this.strength[o] = ahead / mass;
      this.sampled[o] = this.strength[o];
    }
    this.share = 1;
    this.sideShare = 1;
    if (street === 3 && this.count === 1) {
      this.share = this.sideShare = this.strength[0];
    } else if (this.count > 0) {
      this.runouts(v, a, b, rnd);
    }
  }

  private runouts(v: BotView, a: number, b: number, rnd: () => number) {
    const base = this.textures[v.street - 1].acc;
    const cdf = this.cdf;
    const river = v.street === 3;
    const values = this.simBoard;
    const total = this.count;
    const horizon = v.committed[v.seat] + v.toCall;
    const finalAllIn = v.toCall > 0 && (v.stacks[v.seat] <= v.toCall || this.active === 0);
    let levels = 0;
    let pot = 0;
    if (finalAllIn && total > 1) {
      let previous = 0;
      while (previous < horizon) {
        let end = horizon;
        let contributors = 1;
        let eligible = 0;
        for (let i = 0; i < v.numSeats; i++) {
          if (i === v.seat || v.committed[i] <= previous) continue;
          contributors++;
          end = Math.min(end, v.committed[i]);
          if (!v.folded[i]) eligible |= 1 << this.countBySeat[i];
        }
        this.levelPots[levels] = (end - previous) * contributors;
        this.levelEligible[levels++] = eligible;
        pot += (end - previous) * contributors;
        previous = end;
      }
    }
    this.marginal.fill(0);
    let share = 0;
    let sideShare = 0;
    let accepted = 0;
    const target = total === 1 ? 128 : total <= 3 ? 136 : 84;
    // Reject entire conflicting assignments, so multiway samples condition the
    // product of the marginal ranges on valid joint deals.
    for (let trial = 0; trial < target * 2 && accepted < target; trial++) {
      let usedLo = this.blockedLo;
      let usedHi = this.blockedHi;
      let valid = true;
      for (let o = 0; o < total; o++) {
        const offset = o * COMBOS;
        const fraction = rnd();
        const mark = fraction * this.mass[o];
        const bin = o * (CDF_BINS + 1) + ((fraction * CDF_BINS) | 0);
        let lo = this.cdfBins[bin];
        let hi = this.cdfBins[bin + 1];
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cdf[offset + mid] > mark) hi = mid;
          else lo = mid + 1;
        }
        this.drawn[o] = lo;
        const combo = this.comboIds[lo];
        const x = FIRST[combo];
        const y = SECOND[combo];
        const maskLo = MASK_LO[x] | MASK_LO[y];
        const maskHi = MASK_HI[x] | MASK_HI[y];
        if ((usedLo & maskLo) || (usedHi & maskHi)) {
          valid = false;
          break;
        }
        usedLo |= maskLo;
        usedHi |= maskHi;
      }
      if (!valid) continue;

      if (!river) {
        values.rankKey = base.rankKey;
        values.suitKey = base.suitKey;
        values.m0 = base.m0;
        values.m1 = base.m1;
        values.m2 = base.m2;
        values.m3 = base.m3;
        // Select an unoccupied card by indexed scan after bounded rejection.
        for (let k = v.board.length; k < 5; k++) {
          let card = -1;
          for (let attempt = 0; attempt < 12; attempt++) {
            const candidate = (rnd() * 52) | 0;
            if (!(MASK_LO[candidate] & usedLo) && !(MASK_HI[candidate] & usedHi)) {
              card = candidate;
              break;
            }
          }
          if (card < 0) {
            let pick = (rnd() * (52 - 2 - 2 * total - k)) | 0;
            for (let c = 0; c < 52; c++) {
              if (!(MASK_LO[c] & usedLo) && !(MASK_HI[c] & usedHi) && pick-- === 0) {
                card = c;
                break;
              }
            }
          }
          addCard(values, card);
          usedLo |= MASK_LO[card];
          usedHi |= MASK_HI[card];
        }
      }
      const score = river ? this.heroScore : evalWith2(values, a, b);
      let beats = 0;
      let ties = 0;
      for (let o = 0; o < total; o++) {
        const index = this.drawn[o];
        const combo = this.comboIds[index];
        const other = river ? this.scores[index] : evalWith2(values, FIRST[combo], SECOND[combo]);
        const comparison = score > other ? 1 : score === other ? 0.5 : 0;
        this.marginal[o] += comparison;
        if (comparison === 0) beats |= 1 << o;
        else if (comparison === 0.5) ties++;
        this.trialScores[o] = other;
      }
      if (!beats) share += 1 / (1 + ties);
      if (levels) {
        for (let l = 0; l < levels; l++) {
          const eligible = this.levelEligible[l];
          if (eligible & beats) continue;
          let equal = 1;
          for (let o = 0; o < total; o++) {
            if ((eligible & (1 << o)) && this.trialScores[o] === score) equal++;
          }
          sideShare += this.levelPots[l] / equal;
        }
      }
      accepted++;
    }
    let fallback = 1;
    for (let o = 0; o < total; o++) {
      const prior = this.strength[o];
      // Shrink multiway marginals toward the exact unconditioned scan.
      this.sampled[o] = river ? prior : (this.marginal[o] + prior * 12) / (accepted + 12);
      fallback *= this.sampled[o];
    }
    const pseudoWorlds = river && accepted >= 48 ? 0 : 12;
    this.share = (share + fallback * pseudoWorlds) / (accepted + pseudoWorlds);
    this.sideShare = pot > 0 && accepted >= 32 ? sideShare / (pot * accepted) : this.share;
  }

  // Approximate the stronger portion of our own reached range. Combo
  // removal uses the same compact board scan as the opponent posterior.
  strongerFraction(v: BotView, h: History): number {
    const seat = v.seat;
    const street = v.street;
    const prior = EQUITY_PROFILES[h.preProfile[seat]];
    const retention = PREFLOP_CONTINUE[h.preContinues[seat]];
    const rows = this.features;
    const l1 = h.line[10 + seat];
    const l2 = street >= 2 ? h.line[20 + seat] : 0;
    const l3 = street === 3 ? h.line[30 + seat] : 0;
    let total = 0;
    let stronger = 0;
    const heroQuality = this.heroTier * 5 + this.heroDraw * (street === 1 ? 3.8 : 2.5);
    for (let i = 0; i < this.comboCount; i++) {
      const combo = this.comboIds[i];
      const id = CLASS[combo];
      let weight = prior[id] * retention[id];
      if (l1) weight *= REACH[l1][(rows[combo] / 5) | 0];
      if (l2) weight *= REACH[l2][(rows[COMBOS + combo] / 5) | 0];
      if (l3) weight *= REACH[l3][(rows[2 * COMBOS + combo] / 5) | 0];
      total += weight;
      if (street === 3) {
        stronger += weight * (this.scores[i] > this.heroScore ? 1 : this.scores[i] === this.heroScore ? 0.5 : 0);
      } else {
        const f = rows[(street - 1) * COMBOS + combo];
        const tier = (f / 5) | 0;
        const quality = tier * 5 + (f - tier * 5) * (street === 1 ? 3.8 : 2.5);
        if (quality > heroQuality || quality === heroQuality && this.scores[i] > this.heroScore) stronger += weight;
      }
    }
    return stronger / total;
  }

  // Fold-or-call model for a new sizing. Use exact blocker-aware current
  // strength in each response bucket, then apply sampled runout adjustments.
  estimate(
    v: BotView, h: History, model: readonly Profile[], to: number, raising: boolean,
  ): { ev: number; folds: number; called: number } {
    const basePot = v.pot;
    const cost = to - v.bets[v.seat];
    const street = v.street;
    const players = this.count;
    const fraction = (cost - v.toCall) / Math.max(v.bigBlind, basePot + v.toCall);
    let win = 1;
    let folds = 1;
    let chips = 0;
    for (let o = 0; o < players; o++) {
      const seat = this.opponents[o];
      const p = model[seat];
      const additional = Math.min(v.stacks[seat], Math.max(0, to - v.bets[seat]));
      if (v.allIn[seat]) {
        win *= this.sampled[o];
        folds = 0;
        continue;
      }
      const size = Math.min(fraction, additional / Math.max(basePot, v.bigBlind));
      const price = additional / (basePot + cost + additional);
      const isRaise = Number(raising && h.lastAggressor[street] === seat);
      const priorDiscount = players > 1 ? 0.075 + 0.045 * (players - 2) : 0;
      const cut = 3.7 + 7.6 * price + 1.20 * isRaise + priorDiscount * 8
        + Math.max(0, size - 1) * 0.38
        + (street === 3 ? -0.22 : street === 1 ? 0.14 : 0);
      const offset = o * TABLE_SIZE;
      const sticky = p.sticky[street];
      let calls = 0;
      let strong = 0;
      let allWeak = 0;
      let allStrong = 0;
      for (let f = 0; f < STRIDE; f++) {
        const tier = (f / 5) | 0;
        const draw = f - tier * 5;
        const whenAhead = this.hist[offset + 2 * STRIDE + f];
        const tied = this.hist[offset + STRIDE + f];
        const whenBehind = this.hist[offset + f];
        const mass = whenBehind + tied + whenAhead;
        if (!mass) continue;
        const drawBonus = draw * (street === 1 ? 0.77 : 0.57);
        const continueBase = clamp((tier + drawBonus - cut + 1.67) * 0.29, 0.016, 0.985);
        const keep = continueBase + (sticky >= 0 ? (1 - continueBase) * sticky : continueBase * sticky * (1 - tier / 10));
        calls += mass * keep;
        strong += (whenAhead + 0.5 * tied) * keep;
        if (tier >= 6) allStrong += mass;
        if (tier <= 2) allWeak += mass;
      }
      // For small bets, the observed response is useful even when a stylized
      // range thinks everyone missed. Preserve stronger hands when applying it.
      const mass = this.mass[o];
      const profileFold = p.folds[2 * street - (size > 0.51 ? 0 : 1)];
      const typical = 0.42 + 0.05 * (street - 1);
      const dev = Math.max(0, profileFold - typical - 0.09);
      let callRate = calls / mass;
      if (!raising) {
        const soft = 1 - allStrong / mass;
        const pressure = (dev + p.overfold[street] * (size > 0.32 ? 0.53 : 0.29))
          * Math.min(0.94, 0.19 + allWeak / mass);
        callRate = clamp(callRate - Math.min(soft * 0.45, pressure), 0.015, 0.994);
      }
      const now = strong / Math.max(0.0001, calls);
      const runoutDelta = this.sampled[o] - this.strength[o];
      const current = clamp(now + runoutDelta * (now < this.strength[o] - 0.12 ? 0.66 : 0.88),
        0, street === 3 ? 1 : 0.995);
      // Protect checking value by charging vulnerable made hands for the chance
      // that a call model is actually a raise, including when the price is small.
      const raiseRisk = Math.min(0.075, 0.015 + allStrong / mass * (street === 3 ? 0.087 : 0.13));
      const afterContinue = clamp(current - (this.heroTier < 7 ? raiseRisk : 0), 0, 1);
      const fold = 1 - callRate;
      const factor = fold + callRate * afterContinue;
      folds *= fold;
      win *= factor;
      chips += callRate * afterContinue * additional / Math.max(0.0001, factor);
    }
    const called = clamp((win - folds) / Math.max(0.0001, 1 - folds));
    return { ev: win * (basePot + chips) - (1 - win) * cost, folds, called };
  }
}

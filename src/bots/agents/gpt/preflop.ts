import type { BotView, Decision } from '../../types';
import { HIGH, LOW, RATING, SUITED, classOf, clamp } from './cards';
import { OPEN, position, postOrder, threeBetValue } from './charts';
import { BLINDS_BASE64, EQUITY_BASE64, EQUITY_COLUMNS, MAX_DEPTH, MIN_DEPTH } from './equity-data';
import type { History } from './history';
import type { Profile } from './model';

const bytes = atob(EQUITY_BASE64);
const blinds = atob(BLINDS_BASE64);
const EQUITY = Float32Array.from({ length: bytes.length / 2 }, (_, i) =>
  (bytes.charCodeAt(2 * i) + 256 * bytes.charCodeAt(2 * i + 1)) / 65535);
const equity = (id: number, profile: number) => EQUITY[id * EQUITY_COLUMNS + profile];
const blindFrequency = (id: number, depth: number, calling: boolean) => {
  const row = Math.round(clamp(depth, MIN_DEPTH, MAX_DEPTH)) - MIN_DEPTH;
  return blinds.charCodeAt((row * 2 + Number(calling)) * 169 + id) / 255;
};

export const FOLD: Decision = { type: 'fold' };
export const CHECK: Decision = { type: 'check' };
export const CALL: Decision = { type: 'call' };
const JAM: Decision = { type: 'allIn' };

export const passive = (v: BotView) => v.toCall ? CALL : CHECK;
export const abandon = (v: BotView) => v.toCall ? FOLD : CHECK;

export function raiseTo(v: BotView, to: number): Decision {
  if (!v.canRaise) return passive(v);
  const target = Math.max(v.minRaiseTo, Math.min(v.maxRaiseTo, Math.round(to)));
  return target === v.maxRaiseTo ? JAM : { type: 'raise', to: target };
}

function preOrder(v: BotView, seat: number) {
  return (v.numSeats + seat - v.bbSeat - 1) % v.numSeats;
}

export function collectible(v: BotView, afterCall: boolean): number {
  const amount = v.committed[v.seat] + (afterCall ? v.toCall : v.stacks[v.seat]);
  let total = 0;
  for (let i = 0; i < v.numSeats; i++) total += Math.min(amount, v.committed[i]);
  return total;
}

export function preflop(v: BotView, h: History, model: readonly Profile[], rnd: number): Decision {
  const { seat, bbSeat, bigBlind: bb, currentBet, canRaise, toCall, numSeats } = v;
  const id = classOf(v.hole[0], v.hole[1]);
  const hi = HIGH[id];
  const lo = LOW[id];
  const pair = hi === lo;
  const suited = !!SUITED[id];
  const wheel = suited && hi === 12 && lo <= 3;
  const connected = suited && hi - lo <= 2;
  const pos = position(seat, numSeats, v.sbSeat, bbSeat);
  const odds = toCall / (collectible(v, true) + toCall);
  let behind = 0;
  let effective = 0;
  let loose = 0;
  let opponents = 0;
  let tightestDefender = 1;
  let widestDefender = 0;
  for (let i = 0; i < numSeats; i++) {
    if (i === seat || v.folded[i]) continue;
    const p = model[i];
    loose += p.loose;
    opponents++;
    effective = Math.max(effective, v.startStacks[i]);
    if (!v.allIn[i] && preOrder(v, i) > preOrder(v, seat)) {
      behind++;
      tightestDefender = Math.min(tightestDefender, p.foldPre);
      widestDefender = Math.max(widestDefender, p.loose);
    }
  }
  effective = Math.min(effective, v.startStacks[seat]) / bb;
  const rating = RATING[id];
  const raises = h.raises[0];
  const blindOnly = h.live === 2 && !v.ante && 2 * v.smallBlind === bb && effective <= MAX_DEPTH
    && !v.folded[v.sbSeat] && !v.folded[bbSeat];
  if (raises === 0) {
    if (!canRaise) return odds < 0.14 || equity(id, 0) - 0.045 * (opponents - 1) > odds ? passive(v) : abandon(v);
    if (h.limpers > 0) {
      const sbOnly = h.limpers === 1 && seat === bbSeat && !v.folded[v.sbSeat];
      const avgLoose = loose / Math.max(1, opponents);
      const cutoff = (sbOnly ? 46 : 57) + 2.0 * (h.limpers - 1) + 1.6 * behind - 5 * avgLoose;
      const iso = clamp((rating - cutoff + 3) / 7);
      const size = (sbOnly ? 3.6 : 3.8 + Number(pos >= 4) * 0.8 + h.limpers - 1) * bb;
      if (rnd < iso) {
        if (effective <= 10 && rating > (sbOnly ? 50 : 63)) return raiseTo(v, v.maxRaiseTo);
        return raiseTo(v, size);
      }
      const playable = pair || (suited && (hi >= 9 || hi - lo <= 3));
      if (playable && (pos >= 3 || behind <= 1) && odds < (effective >= 14 ? 0.2 : 0.13)) return passive(v);
      return abandon(v);
    }
    if (pos === 5) return CHECK;
    const frequency = OPEN[pos][id];
    if (blindOnly && pos === 4) {
      return rnd < blindFrequency(id, effective, false) ? raiseTo(v, v.maxRaiseTo) : abandon(v);
    }
    if (effective <= 11 && behind > 0) {
      const adjusted = rating + (hi === 12 ? 4 : 0) + (pair ? 4 : 0);
      const threshold = (pos === 4 ? 37 : pos === 3 ? 47 : 52 + 2.7 * behind) + 0.95 * (effective - 8);
      if (rnd < clamp((adjusted - threshold + 2.5) / 6)) return raiseTo(v, v.maxRaiseTo);
      return abandon(v);
    }
    let open = frequency;
    if (pos >= 2 && tightestDefender > 0.56 && widestDefender < 0.10) {
      open += (1 - open) * clamp((rating - 30) / 18) * clamp((tightestDefender - 0.56) * 1.4, 0, 0.25);
    }
    if (pos >= 3 && widestDefender > 0.24 && rating < 42) open *= 0.87;
    if (rnd < open) {
      const size = numSeats === 2 ? 2.15 : pos === 4 ? 2.8 : 2.2;
      return raiseTo(v, bb * (effective <= 23 ? Math.min(2.15, size) : size));
    }
    return abandon(v);
  }

  const opener = h.firstAggressor[0];
  const villain = h.lastAggressor[0];
  const p = model[villain];
  const vp = h.pos(opener);
  const ip = postOrder(seat, numSeats) > postOrder(villain, numSeats);
  const width = clamp((vp - 0.65) * 0.24 + p.light * 1.65 + Number(numSeats === 2) * 0.19);
  const size = currentBet / bb;
  const depth = Math.min(v.startStacks[seat], v.startStacks[villain]) / bb;
  const squeeze = h.callers;
  const ownRaise = h.preRaises[seat] > 0;
  let profile = h.preProfile[villain];
  if (raises === 1 && h.preOpenTo > 6.5) profile = h.preOpenTo >= 16 && depth >= 35 ? 11 : 8;
  if (raises === 2 && size > 18 && depth >= 50) profile = 10;
  if (raises === 3 && p.light < -0.07 && vp <= 1) profile = 11;
  const wide = p.wild * (profile >= 8 ? 0.86 : 0.65) + Math.max(0, p.light) * 0.19;
  let raw = equity(id, profile) * (1 - wide) + equity(id, 0) * wide;
  if (raises === 1 && depth < 25 && h.preOpenTo > 4) {
    raw = Math.max(raw, equity(id, depth <= 12 ? 6 : vp >= 3 ? 7 : 9) - 0.022);
  }
  if (p.light < -0.08 && raises <= 2 && size < 12) raw += p.light * 0.17;
  const liveCallers = Math.max(squeeze, h.live - 1 - behind - Number(!v.allIn[villain]) - Number(!v.allIn[seat]));
  const adjusted = raw * Math.pow(0.74 + 0.13 * raw, Math.max(0, liveCallers));
  const allIn = v.stacks[seat] <= toCall || v.allIn[villain];
  if (allIn) {
    if (blindOnly && seat === bbSeat && raises === 1 && villain === v.sbSeat && h.limpers === 0 && p.wild < 0.24) {
      const base = blindFrequency(id, effective, true);
      const tighter = clamp((-p.light - 0.065) * 1.5, 0, 0.40);
      const call = adjusted >= odds + 0.09 ? Math.max(base, 0.94) : base * (1 - tighter);
      return rnd < call ? passive(v) : abandon(v);
    }
    const futureTax = h.live > 2 ? 0.021 * Math.min(3, behind + liveCallers) : 0;
    return adjusted >= odds + futureTax - 0.004 ? passive(v) : abandon(v);
  }

  if (raises === 1) {
    let three = threeBetValue(id, width);
    if (pos === 5 && vp <= 1 && !pair && lo < 11) three *= 0.72;
    const bluff = wheel ? 0.22 + 0.20 * width
      : suited && (hi === 12 || (hi >= 8 && lo >= 6 && connected)) ? 0.07 + 0.12 * width : 0;
    three = Math.max(three, bluff * (1 + Math.max(0, p.foldThree - 0.53)) / (1 + squeeze * 0.85));
    if (squeeze > 0 && !pair && !suited && lo < 10) three *= 0.8;
    if (size > 4) three *= clamp((raw - 0.43) * 5 + Number(pair && hi >= 11) * 0.5);
    const playShort = depth <= 25 && size >= 1.8;
    if (playShort) {
      const threshold = 0.50 + clamp((depth - 13) / 140, -0.04, 0.085) - 0.04 * width;
      if (raw >= threshold && (three > 0.28 || adjusted > 0.54) && adjusted > odds + 0.025 && canRaise) {
        return raiseTo(v, v.maxRaiseTo);
      }
      three *= 0.25;
    }
    const multiplier = ip ? 3.35 : 4.15;
    const target = currentBet * (multiplier + squeeze * 0.8);
    const raiseFrequency = canRaise && (target < 0.44 * depth * bb || raw > 0.62) ? three : 0;
    if (rnd < raiseFrequency) return raiseTo(v, target);

    let realization = pos === 5 ? (ip ? 0.94 : 0.80) : (ip ? 0.85 : 0.77);
    realization += pair ? 0.063 : suited ? 0.065 + (connected || hi === 12 ? 0.025 : 0) : -0.09;
    if (!suited && !pair && hi === 12 && lo < 9 && vp <= 2) realization -= 0.055;
    if (depth < 24 && (pair && hi < 7 || connected)) realization -= 0.075;
    if (size >= 5) realization -= 0.055;
    const margin = pos === 5 ? 0.043 : 0.052 + 0.019 * behind + (pos === 4 ? 0.036 : 0);
    const ev = adjusted * realization - odds - margin;
    const threshold = pos === 5 ? 0.043 : 0.026;
    const call = clamp(0.5 + ev / threshold);
    const candidate = pos === 5 || pair || suited || rating > 64 || (ip && behind <= 1 && raw > 0.47);
    if (candidate && rnd < raiseFrequency + (1 - raiseFrequency) * call) return passive(v);
    return abandon(v);
  }

  const haveAces = pair && hi === 12;
  const haveKings = pair && hi === 11;
  const haveQueens = pair && hi === 10;
  const bigAce = hi === 12 && lo === 11;
  const premium = haveAces || haveKings || haveQueens || bigAce;
  const ownEarly = ownRaise && h.pos(seat) <= 1;
  const late = !ownEarly && (vp >= 2 || p.light > 0.12 || numSeats <= 3);
  if (raises === 2) {
    let four = haveAces ? 0.91 : haveKings ? 0.82 : haveQueens ? (late ? 0.58 : 0.22)
      : bigAce ? (suited ? 0.71 : late ? 0.52 : 0.27)
      : pair && hi === 9 && late ? 0.16 : wheel && ownRaise ? 0.12 + width * 0.11 : 0;
    if (!ownRaise && !premium) four = 0;
    if (!ownRaise && (haveQueens || bigAce)) four *= late ? 0.55 : 0.27;
    if (size > 13 && !premium) four *= 0.3;
    const target = currentBet * (ip ? 2.18 : 2.48);
    const jam = depth <= 42 || target >= v.maxRaiseTo * 0.62;
    const raiseFrequency = canRaise && (size < depth * 0.27 || premium) && (!jam || premium || raw >= 0.54) ? four : 0;
    if (rnd < raiseFrequency) return raiseTo(v, jam ? v.maxRaiseTo : target);
    const playable = ownRaise || premium;
    const realization = (ip ? 0.92 : 0.85) + (suited || pair ? 0.06 : -0.04);
    const margin = 0.038 + (ownRaise ? 0 : 0.057) + 0.017 * squeeze;
    const call = clamp(0.5 + (adjusted * realization - odds - margin) / 0.062);
    if (playable && rnd < raiseFrequency + (1 - raiseFrequency) * call) return passive(v);
    return abandon(v);
  }
  const canJam = haveAces || (haveKings && (late || depth <= 110 || raw > 0.50))
    || (premium && late && raw > 0.40 && depth <= 115) || (p.wild > 0.35 && raw > 0.56);
  if (canRaise && canJam && rnd < (haveAces ? 0.9 : haveKings ? 0.77 : 0.57)) return raiseTo(v, v.maxRaiseTo);
  const realized = adjusted * (ip ? 0.98 : 0.94);
  return realized > odds + (premium ? 0.025 : 0.064) && (ownRaise || premium) ? passive(v) : abandon(v);
}

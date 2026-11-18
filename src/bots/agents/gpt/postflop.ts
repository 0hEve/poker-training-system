import type { BotView, Decision } from '../../types';
import { clamp } from './cards';
import { postOrder } from './charts';
import { type History, SIZE_BANDS, liveAfter } from './history';
import type { Profile } from './model';
import { abandon, collectible, passive, raiseTo } from './preflop';
import type { Ranges } from './ranges';

function target(v: BotView, fraction: number, effectiveTo: number) {
  const ideal = v.currentBet + fraction * (v.pot + v.toCall);
  const bounded = Math.min(v.maxRaiseTo, effectiveTo, Math.round(ideal));
  return Math.max(v.minRaiseTo, bounded);
}

export function postflop(
  v: BotView, h: History, model: readonly Profile[], r: Ranges, actionRng: number, rnd: () => number,
): Decision {
  r.read(v, h, model, rnd);
  const { seat, street, pot, toCall, canRaise, numSeats } = v;
  const t = r.textures[street - 1];
  const tier = r.heroTier;
  const draw = r.heroDraw;
  const count = r.count;
  const multi = count > 1;
  const showdown = r.share;
  const eligible = toCall ? collectible(v, true) : pot;
  const price = toCall / Math.max(1, eligible + toCall);
  const sidePot = eligible < pot;
  const order = postOrder(seat, numSeats);
  const spr = r.effective / (pot + toCall);
  const nowRaises = h.raises[street];
  const previousAggressor = h.lastAggressor[street - 1];
  const initiativeSeat = previousAggressor < 0 ? h.lastAggressor[0] : previousAggressor;
  const initiative = initiativeSeat === seat;
  const after = liveAfter(v, seat);
  const ip = after === 0;
  let effectiveTo = 0;
  let sticky = 0;
  let folding = 0;
  let overfold = 1;
  let lastOrder = -1;
  let pendingInitiative = false;
  for (let i = 0; i < count; i++) {
    const other = r.opponents[i];
    if (v.allIn[other]) continue;
    effectiveTo = Math.max(effectiveTo, v.bets[other] + v.stacks[other]);
    const position = postOrder(other, numSeats);
    lastOrder = Math.max(lastOrder, position);
    if (other === previousAggressor && position > order) pendingInitiative = true;
    sticky += model[other].sticky[street];
    folding += model[other].folds[2 * street - 1];
    overfold *= model[other].overfold[street];
  }
  sticky /= Math.max(1, r.active);
  folding /= Math.max(1, r.active);
  const blocker = t.suitCount >= 3 && (((v.hole[0] & 3) === t.suit && v.hole[0] >= 44)
    || ((v.hole[1] & 3) === t.suit && v.hole[1] >= 44));
  const flop = street === 1;
  const river = street === 3;
  const overcards = Number((v.hole[0] >> 2) > t.high) + Number((v.hole[1] >> 2) > t.high);
  const flopBackdoor = flop && ((v.hole[0] ^ v.hole[1]) & 3) === 0
    && ((t.acc.suitKey >> ((v.hole[0] & 3) * 4)) & 15) === 1;
  const wet = clamp(t.wet);
  const cap = nowRaises > 1 ? 1 : 0;
  const short = r.effective <= pot * 0.77;
  const noFuture = river || r.active === 0 || (v.stacks[seat] <= toCall && !canRaise);
  const betFrac = (pot > toCall ? toCall / (pot - toCall) : 1);

  if (toCall > 0) {
    let realized = noFuture ? r.sideShare : showdown;
    if (!noFuture) {
      // Charge for future barrels, especially weak made hands out of position.
      // Clean draws regain some of that cost through implied value on later streets.
      const weak = tier <= 4 && draw < 2;
      const exposure = multi ? 0.025 + 0.015 * after : ip ? 0.015 : 0.030;
      const tax = (weak ? 1.48 : draw >= 2 ? 0.48 : 0.78) * exposure * clamp(spr, 0.28, 1.4);
      realized -= tax + (cap && tier < 7 ? 0.019 : 0);
      if (draw >= 2 && tier < 6 && (ip || draw >= 3) && spr > 1.3) {
        const benefit = Math.min(0.043, 0.011 * spr + 0.012) * (multi ? 0.71 : 1);
        realized += benefit * (draw >= 3 ? 1 : 0.69);
      }
      if (multi && lastOrder > order) realized -= 0.011;
    }
    // MDF influences close heads-up catches. It is a range-level reference,
    // so multiway and large-reraise calls use the estimated price directly.
    const mdf = clamp((pot - toCall) / Math.max(1, pot));
    const margin = noFuture ? 0 : (multi ? 0.008 : 0.014 * (0.55 - mdf));
    const noiseBand = river && !multi ? 0.012 : 0.039;
    const callEV = (realized - price) * (eligible + toCall);
    let callFrequency = clamp(0.5 + (realized - price - margin) / noiseBand);
    if (!multi && cap === 0 && nowRaises === 1 && callFrequency < 0.9 && realized > price * 0.47) {
      const last = h.lastAggressor[street];
      const p = model[last];
      const shape = p.sizeSignal[(street - 1) * SIZE_BANDS + h.sizes[10 * street + last]];
      const pressure = p.looseBet[street] + shape + p.largeBluff[street] * 0.55;
      const floor = price * clamp(0.68 - pressure * 0.58, 0.46, 0.90);
      const stronger = r.strongerFraction(v, h);
      const rangeThreshold = mdf * (street === 1 ? 0.92 : 0.80) + clamp(pressure * 0.22, -0.09, 0.10);
      const coverage = clamp((rangeThreshold - stronger) * 4.1);
      const equitySupport = clamp((realized - floor) / (0.045 + price * 0.20));
      callFrequency = Math.max(callFrequency, coverage * equitySupport * clamp(0.52 + pressure, 0.26, 0.86));
    }
    const couldRaise = canRaise && r.active > 0 && !sidePot && (cap === 0 || tier >= 7);
    if (couldRaise) {
      const valueCandidate = tier >= 6 || showdown > (multi ? 0.64 : 0.76);
      const bluffCandidate = cap === 0 && !multi && (street < 3 ? draw >= 2 || (flop && flopBackdoor && overcards >= 1) : blocker && tier <= 2);
      if (valueCandidate || bluffCandidate) {
        let size = betFrac < 0.40 ? 0.86 : 0.78;
        if (tier >= 8 && wet >= 0.71 && !river) size += 0.09;
        if (river && showdown > 0.92 && spr > 1.3) size += 0.19;
        if (short || spr < 1.28 && valueCandidate && showdown > 0.68) size = 3;
        const to = target(v, size, effectiveTo);
        const e = r.estimate(v, h, model, to, true);
        const edge = (e.ev - Math.max(0, callEV)) / pot;
        const strongValue = e.called > (river ? 0.56 : 0.52) && realized > (multi ? 0.51 : 0.54);
        const support = Math.min(0.55, 0.10 + 0.55 * draw / 4 + Number(blocker) * 0.12);
        const threshold = 1 - (to - v.bets[seat] - toCall) / (pot + to - v.bets[seat] - toCall);
        let raise = 0;
        if (valueCandidate && strongValue) {
          raise = clamp(0.33 + 2.9 * (edge - 0.025), 0.06, 0.96);
          if (!river && tier >= 8 && e.called > 0.66) raise = Math.max(raise, 0.68 + 0.20 * wet);
          if (nowRaises >= 2) raise *= tier >= 8 ? 0.91 : 0.42;
        } else if (bluffCandidate && edge > -0.018 && showdown < 0.57 && sticky < 0.19) {
          const bluffShare = (1 - threshold) / (2 - threshold);
          raise = clamp((edge + 0.025) * 2.0 + 0.08, 0.04, 0.61) * support
            * (river ? bluffShare : 1.14);
        }
        if (actionRng < raise) return raiseTo(v, to);
        if ((actionRng - raise) < (1 - raise) * callFrequency) return passive(v);
        return abandon(v);
      }
    }
    return actionRng < callFrequency ? passive(v) : abandon(v);
  }

  if (!canRaise || r.active === 0) return passive(v);
  const protectedCheck = !ip && (pendingInitiative || (flop && !initiative && initiativeSeat >= 0));
  const advantageFlop = flop && initiative && (t.high >= 10 || h.raises[0] >= 2) && wet < 0.79;
  const medium = tier >= 3 && tier <= 6;
  const nutted = tier >= 7 && showdown >= (multi ? 0.64 : 0.79);
  const durable = tier >= 7 || (tier === 6 && wet < 0.5);
  const goodDraw = draw >= 2;
  const weak = tier <= 2;
  const checkEV = pot * showdown * (river ? 1 : ip ? 0.98 : 0.93);
  // Small c-bets and probes preserve range coverage. Fit the bigger size
  // to the effective stack and remaining streets when the hand can play for stacks.
  const small = flop ? advantageFlop ? 0.28 : 0.37 : river ? 0.39 : 0.43;
  const geometric = river ? spr : street === 2 ? (Math.sqrt(1 + 2 * spr) - 1) * 0.5
    : (Math.cbrt(1 + 2 * spr) - 1) * 0.5;
  let big = flop ? (wet >= 0.65 ? 0.76 : 0.66) : 0.78;
  if (nutted || weak && river) big = clamp(geometric, river ? 0.71 : 0.58, river ? 1.55 : 1.07);
  if (sticky > 0.43 && (nutted || showdown >= (multi ? 0.69 : 0.86))) {
    big = clamp(geometric, 0.82, river ? 3 : 1.55);
  }
  if (short && (nutted || street >= 2 && showdown > 0.66)) big = Math.max(big, spr + 0.01);
  const smallTo = target(v, small, effectiveTo);
  const bigTo = target(v, big, effectiveTo);
  const smallEV = r.estimate(v, h, model, smallTo, false);
  const bigEV = bigTo === smallTo ? smallEV : r.estimate(v, h, model, bigTo, false);
  const smallEdge = (smallEV.ev - checkEV) / pot;
  const bigEdge = (bigEV.ev - checkEV) / pot;
  const density = multi ? 0.77 : 1;
  let smallFrequency = 0;
  let bigFrequency = 0;

  const valueSmall = smallEV.called >= (multi ? 0.53 : 0.51) && (!weak || showdown > 0.71);
  const valueBig = bigEV.called >= (multi ? 0.59 : 0.56) && (durable || showdown > 0.79);
  if (valueSmall || valueBig) {
    const denial = flop && !durable && showdown > 0.54 ? 0.03 * wet : 0;
    const advantage = Math.max(smallEdge, bigEdge) + denial;
    const base = clamp(0.51 + 2.60 * advantage + (nutted ? 0.15 : 0), 0.07, 0.99);
    const frequency = base * (protectedCheck && !nutted ? 0.53 : protectedCheck ? 0.78 : 1)
      * (multi && !nutted ? 0.83 : 1);
    const largeMix = valueBig ? clamp(0.36 + 3.3 * (bigEdge - smallEdge) + (nutted ? 0.21 : 0), 0.10, 0.97) : 0.0;
    smallFrequency = frequency * (valueSmall ? 1 - largeMix : 0);
    bigFrequency = frequency * (valueSmall ? largeMix : 1);
  } else if (medium) {
    // Thin denial on favorable high-card boards, with checks for medium pairs.
    const denial = flop ? 0.105 : river ? 0.018 : 0.044;
    if (smallEdge > -denial && showdown > 0.32 && (!protectedCheck || goodDraw)) {
      smallFrequency = density * clamp((smallEdge + denial) * 2.4 + Number(advantageFlop) * 0.18, 0, 0.52);
    }
  } else {
    const credible = !protectedCheck || overfold > 0.16 || (flop && t.high <= 8 && wet >= 0.59 && goodDraw) || (!flop && previousAggressor < 0);
    const alpha = (bigTo - v.bets[seat]) / (pot + bigTo - v.bets[seat]);
    const terminalBluffFraction = alpha / (1 + alpha);
    const favorable = advantageFlop || !flop && previousAggressor < 0 && ip;
    const equityBonus = (goodDraw ? 0.16 + 0.045 * draw : draw === 1 ? 0.12 : 0)
      + (flopBackdoor ? 0.09 : 0) + 0.065 * overcards + (blocker ? 0.18 : 0);
    const cappedShowdown = river ? 0.32 : 0.44;
    if (credible && showdown < cappedShowdown && (sticky < 0.37 || goodDraw)) {
      if (river) {
        const selection = blocker ? 0.93 : tier <= 1 ? 0.73 : 0.36;
        const observedFolds = clamp((folding - 0.57) * 1.5 + 1.1 * overfold, 0, 0.55);
        const gain = Math.max(smallEdge, bigEdge);
        // Low showdown value and value blockers supply the bluffs. Use
        // the larger sizing only when this line plausibly retains a nut edge.
        const bluff = clamp((gain + 0.035) * 2.05, 0, 0.63) * selection * (multi ? 0.27 : 1);
        const polar = initiative || blocker ? 0.67 : 0.23;
        bigFrequency = (bluff + observedFolds * selection) * polar * terminalBluffFraction;
        smallFrequency = (bluff + observedFolds * selection) * (1 - polar) * 0.63;
      } else {
        const evFloor = (favorable ? -0.083 : goodDraw ? -0.035 : 0.008) - overfold * 0.08;
        const select = clamp((smallEdge - evFloor) * 1.95 + equityBonus + (favorable ? 0.24 : 0.03) + overfold * 0.52, 0, 0.92);
        if (smallEdge > evFloor) smallFrequency = select * (multi ? 0.42 : 1);
        if ((goodDraw || favorable && flopBackdoor) && bigEdge > Math.max(-0.025, smallEdge - 0.035)) {
          bigFrequency = smallFrequency * (goodDraw ? 0.43 : 0.20);
          smallFrequency -= bigFrequency * 0.8;
        }
      }
    }
  }
  if (actionRng < bigFrequency) return raiseTo(v, bigTo);
  if (actionRng < smallFrequency + bigFrequency) return raiseTo(v, smallTo);
  return passive(v);
}

import type { BotView, Decision } from '../../types';
import { classCombos, classIsPair, classIsSuited, classOf } from './cards';
import { calledEquity, equityVsRanges, type Opp } from './equity';
import { Models, PlayerModel } from './model';
import { positionOf, postflopOrder, type Position } from './position';
import { HU, PCT_TOP, RFI, VSN } from './tables';
import { DEFAULT_MODEL, type HandTracker } from './tracker';
import type { Params } from './params';

/**
 * Action selection. Every option gets an EV estimate in chips; the bot then samples
 * from a softmax over those EVs. Clear decisions stay deterministic, while near-equal
 * options are mixed, which keeps the strategy hard to exploit.
 */

export interface Ctx {
  v: BotView;
  tracker: HandTracker;
  models: Map<string, PlayerModel>;
  rnd: () => number;
  p: Params;
  /** Optional debug sink (tools only). */
  debug?: (info: Record<string, unknown>) => void;
}

interface Option {
  d: Decision;
  ev: number;
}

const model = (c: Ctx, seat: number) => {
  const id = c.v.playerIds[seat];
  return c.models instanceof Models ? c.models.getOrCreate(id) : (c.models.get(id) ?? DEFAULT_MODEL);
};
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

function choose(c: Ctx, opts: Option[], temp: number): Decision {
  let best = -Infinity;
  for (const o of opts) if (o.ev > best) best = o.ev;
  let total = 0;
  const ws = new Array<number>(opts.length);
  for (let i = 0; i < opts.length; i++) {
    const w = Math.exp((opts[i].ev - best) / temp);
    ws[i] = w;
    total += w;
  }
  let u = c.rnd() * total;
  for (let i = 0; i < opts.length; i++) {
    u -= ws[i];
    if (u <= 0) return opts[i].d;
  }
  return opts[opts.length - 1].d;
}

const passive = (v: BotView): Decision => (v.toCall === 0 ? { type: 'check' } : { type: 'fold' });

function legalRaise(v: BotView, to: number): number {
  return Math.round(clamp(to, v.minRaiseTo, v.maxRaiseTo));
}

/* =============================================================== preflop */

/** Equity of hero class vs a class-weighted range restricted to its top `top` fraction. */
function eqVsRange(hero: number, pf: Float32Array, top = 1): number {
  let num = 0;
  let den = 0;
  const row = hero * 169;
  for (let c = 0; c < 169; c++) {
    const w = pf[c];
    if (w === 0) continue;
    if (top < 1 && PCT_TOP[c] > top) continue;
    const m = w * classCombos(c);
    num += m * HU[row + c];
    den += m;
  }
  return den > 0 ? num / den : 0.5;
}

/** Fraction of all hands that would take the line the range describes (weights start at 1). */
function rangeWidth(pf: Float32Array): number {
  let s = 0;
  for (let c = 0; c < 169; c++) s += pf[c] * classCombos(c);
  return s / 1326;
}

/** PCT_TOP threshold for the top fraction q of a class-weighted range. */
function topCut(pf: Float32Array, q: number): number {
  let total = 0;
  for (let c = 0; c < 169; c++) total += pf[c] * classCombos(c);
  const order = SORTED;
  const target = total * clamp(q, 0.001, 1);
  let acc = 0;
  for (const c of order) {
    acc += pf[c] * classCombos(c);
    if (acc >= target) return PCT_TOP[c];
  }
  return 1;
}
const SORTED: number[] = Array.from({ length: 169 }, (_, i) => i).sort((a, b) => PCT_TOP[a] - PCT_TOP[b]);

/** Combined equity vs several ranges (independence approximation). */
function multiEq(eqs: number[]): number {
  if (eqs.length === 1) return eqs[0];
  let p = 1;
  for (const e of eqs) p *= e;
  // Independent pairwise wins understate multiway equity a little; soften.
  return Math.pow(p, 0.85);
}

export function decidePreflop(c: Ctx): Decision {
  const v = c.v;
  const t = c.tracker;
  const n = v.numSeats;
  const me = v.seat;
  const bb = v.bigBlind;
  const hero = classOf(v.hole[0], v.hole[1]);
  const pos = positionOf(me, n);
  const stack = v.stacks[me];
  const start = v.startStacks[me];
  const P = v.pot;
  const pairOrSuited = classIsPair(hero) || classIsSuited(hero);

  // Live opponents and who still acts after us this round.
  const live: number[] = [];
  for (let i = 0; i < n; i++) if (i !== me && !v.folded[i]) live.push(i);
  const behind = live.filter((i) => !v.allIn[i] && v.bets[i] < v.currentBet && i !== t.preflopAggressor);

  // Effective stack vs the biggest live opponent stack.
  let eff = 0;
  for (const i of live) eff = Math.max(eff, Math.min(start, v.startStacks[i]));
  const deep = eff / bb;

  /* ---- Short stacks: shove/fold by equity vs a calling range. */
  if (deep <= 13 && v.canRaise) {
    const callers = live.filter((i) => !v.allIn[i]);
    const eqs = callers.map((i) => eqVsRange(hero, t.seats[i].pf, 0.25));
    const eq = multiEq(eqs.length ? eqs : [0.5]);
    const fold = Math.pow(0.75, callers.length);
    const evJam = fold * P + (1 - fold) * (eq * (P + 2 * stack) - stack);
    const evPass = v.toCall === 0 ? 0 : -0; // folding/checking loses nothing more
    const evCall = v.toCall > 0 ? eq * (P + v.toCall) - v.toCall : -Infinity;
    const opts: Option[] = [{ d: passive(v), ev: evPass }, { d: { type: 'allIn' }, ev: evJam }];
    if (v.toCall > 0) opts.push({ d: { type: 'call' }, ev: evCall });
    return choose(c, opts, bb * 0.3);
  }

  /* ---- Unopened pot. */
  if (t.raises === 0) {
    if (t.limpers === 0 && pos !== 'BB') {
      let freq = RFI[pos][hero];
      // Exploit tight / loose blinds and players behind: estimate steal equity.
      let foldAll = 1;
      for (const i of behind) {
        const m = model(c, i);
        const p = positionOf(i, n);
        const defend = clamp(m.threeBet.p + m.callOpen.p * (p === 'BB' ? 2.2 : p === 'SB' ? 0.8 : 1), 0.02, 0.9);
        foldAll *= 1 - defend;
      }
      const size = pos === 'SB' ? c.p.sbOpenBB * bb : n <= 3 ? Math.min(2.3, c.p.openBB) * bb : c.p.openBB * bb;
      const eqDef = VSN[hero] * (pos === 'SB' ? 0.92 : 1) - 0.06;
      const evOpen = foldAll * P + (1 - foldAll) * (eqDef * (P + 2 * size) * (pos === 'SB' ? 0.8 : 0.92) - size);
      if (freq === 0 && evOpen > 0.6 * bb && PCT_TOP[hero] < 0.75) freq = clamp(evOpen / (2 * bb), 0, 0.8);
      else if (freq > 0 && freq < 1 && evOpen < -0.5 * bb) freq *= 0.5;
      if (c.rnd() < freq) return { type: 'raise', to: legalRaise(v, size) };
      return passive(v);
    }
    // Limpers in front, or BB with the option.
    const iso = (pos === 'BB' ? 4.5 : 4) * bb + t.limpers * bb;
    const pt = PCT_TOP[hero];
    if (pt < (pos === 'BB' ? 0.12 : 0.16) + 0.01 * t.limpers) return { type: 'raise', to: legalRaise(v, iso) };
    if (v.toCall === 0) return { type: 'check' };
    const price = v.toCall / (P + v.toCall);
    if ((pairOrSuited && pt < 0.45 && price < 0.3) || (pos === 'SB' && pt < 0.6 && price < 0.25)) return { type: 'call' };
    return { type: 'fold' };
  }

  /* ---- Facing a raise (open, 3-bet, 4-bet, ...). */
  const aggr = t.preflopAggressor >= 0 ? t.preflopAggressor : live[0];
  const am = model(c, aggr);
  const aggrRange = t.seats[aggr].pf;
  const others = live.filter((i) => i !== aggr);
  const eqA = eqVsRange(hero, aggrRange);
  const othersEq = others.map((i) => eqVsRange(hero, t.seats[i].pf));
  const eqNow = multiEq([eqA, ...othersEq]);
  const heroIP = pos === 'BTN' || (pos === 'CO' && !others.some((i) => positionOf(i, n) === 'BTN'));
  const closing = behind.length === 0;
  const realize = (heroIP ? 0.92 : pos === 'BB' ? 0.8 : 0.72) + (pairOrSuited ? 0.06 : -0.04) - 0.04 * others.length;

  const opts: Option[] = [{ d: { type: 'fold' }, ev: 0 }];
  const toCall = v.toCall;
  const level = t.raises; // 1 = open, 2 = 3-bet, 3 = 4-bet...
  const callAllIn = toCall >= stack;

  // Call
  if (toCall > 0) {
    let evCall: number;
    if (callAllIn || level >= 4) evCall = eqNow * (P + toCall) - toCall;
    else {
      const squeezeTax = closing ? 0 : 0.35 * bb * behind.length;
      evCall = realize * eqNow * (P + toCall) - toCall - squeezeTax;
      // Facing further raises after calling a 3-bet+ is costly for weak hands.
      if (level >= 2) evCall -= 0.03 * P * (1 - eqNow);
    }
    opts.push({ d: { type: 'call' }, ev: evCall });
  }

  // Raise
  if (v.canRaise) {
    const facing = v.currentBet;
    let to: number;
    if (level === 1) to = facing * (heroIP ? 3 : 4) + others.length * facing;
    else if (level === 2) to = facing * (heroIP ? 2.25 : 2.5);
    else to = v.maxRaiseTo;
    if (to > 0.4 * start) to = v.maxRaiseTo; // would commit 40%+ of the stack: just jam
    to = legalRaise(v, to);
    const add = to - v.bets[me];
    const jam = to >= v.maxRaiseTo;
    // Fold probabilities: aggressor by level, others mostly fold.
    // Aggressor's fold rate to our re-raise. A narrow range can't fold much: they continue with
    // roughly a fixed absolute top of all hands, so derive a range-based estimate and blend it
    // with the observed stat as evidence accumulates.
    const width = rangeWidth(aggrRange);
    const contAbs = level === 1 ? 0.04 + 0.2 * width : level === 2 ? 0.025 + 0.15 * width : 0.02 + 0.3 * width;
    const foldRange = clamp(1 - contAbs / Math.max(width, 1e-3), 0, 0.9);
    const stat = level === 1 ? am.foldTo3bet : level === 2 ? am.foldTo4bet : null;
    const ws = stat ? stat.count / (stat.count + 12) : 0;
    const foldA = clamp(stat ? ws * stat.p + (1 - ws) * foldRange : foldRange, 0.01, 0.9);
    let foldOthers = 1;
    for (const i of others) foldOthers *= v.bets[i] > 0 ? 0.85 : 0.94;
    for (const i of behind) if (!others.includes(i)) foldOthers *= 0.94;
    const F = foldA * foldOthers;
    const contTop = topCut(aggrRange, 1 - foldA);
    const eqC = eqVsRange(hero, aggrRange, contTop);
    // When continued: either a call (we play a raised pot) or a re-raise we may have to answer.
    const reraise = level === 1 ? clamp(am.fourBet.p, 0.03, 0.6) : level === 2 ? 0.45 : 0;
    const villainAdd = to - v.bets[aggr];
    const potCalled = P + add + Math.min(villainAdd, v.stacks[aggr]);
    const evCalled = jam ? eqC * (P + add + Math.min(villainAdd, v.stacks[aggr])) - add : (heroIP ? 0.9 : 0.8) * eqC * potCalled - add;
    const eqTop = eqVsRange(hero, aggrRange, topCut(aggrRange, (1 - foldA) * reraise + 0.001));
    const evReraised = Math.max(-add, eqTop * (2 * start) - start);
    const evRaise = F * P + (1 - F) * ((1 - reraise) * evCalled + reraise * evReraised);
    opts.push({ d: jam ? { type: 'allIn' } : { type: 'raise', to }, ev: evRaise });
  }
  return choose(c, opts, Math.max(c.p.preTempBB * bb, c.p.preTempPot * P));
}

/* ============================================================== postflop */

export function decidePostflop(c: Ctx): Decision {
  const v = c.v;
  const t = c.tracker;
  const n = v.numSeats;
  const me = v.seat;
  const street = v.street;
  const P = v.pot;
  const toCall = v.toCall;
  const bb = v.bigBlind;
  const stack = v.stacks[me];

  const oppSeats: number[] = [];
  for (let i = 0; i < n; i++) if (i !== me && !v.folded[i]) oppSeats.push(i);
  const opps: Opp[] = [];
  for (const i of oppSeats) {
    t.ensurePostflop(i, v);
    const sr = t.seats[i];
    opps.push({ w: sr.w, rr: t.rankInRange(i, street, v), idx: sr.idx, cnt: sr.cnt });
  }
  const river = street === 3 ? t.strengthFor(3, v.board) : null;
  // Spend samples where they matter: big pots get more, multiway gets fewer per opponent.
  const potBB = P / bb;
  const budget = c.p.mcBudget[potBB < 8 ? 0 : potBB < 30 ? 1 : 2];
  const samples = clamp(Math.round(budget / (opps.length + 1)), opps.length >= 3 ? 48 : 70, 280);
  const r = equityVsRanges(v.hole, v.board, opps, samples, c.rnd, river);
  const eq = r.eq;

  // Position: are we last to act among players who can still bet?
  const myOrd = postflopOrder(me, n);
  let ip = true;
  for (const i of oppSeats) if (!v.allIn[i] && postflopOrder(i, n) > myOrd) ip = false;
  const realize = street === 3 ? 1 : street === 2 ? c.p.realizeTurn[ip ? 1 : 0] : c.p.realizeFlop[ip ? 1 : 0];

  const opts: Option[] = [];
  if (toCall === 0) opts.push({ d: { type: 'check' }, ev: realize * eq * P });
  else {
    opts.push({ d: { type: 'fold' }, ev: 0 });
    const allInCall = toCall >= stack;
    opts.push({ d: { type: 'call' }, ev: (allInCall ? 1 : realize) * eq * (P + toCall) - toCall });
  }

  if (v.canRaise) {
    const responders = oppSeats.filter((i) => !v.allIn[i]);
    const base = toCall > 0 ? P + toCall : P;
    const fracs = street === 1 ? [0.33, 0.66, 1.0] : street === 2 ? [0.5, 0.75, 1.25] : [0.33, 0.66, 1.0, 1.5];
    const sizes = new Set<number>();
    for (const f of fracs) {
      const to = legalRaise(v, v.currentBet + f * base);
      sizes.add(to >= v.maxRaiseTo * 0.75 ? v.maxRaiseTo : to);
    }
    sizes.add(v.maxRaiseTo);
    // Shove only when stacks are shallow relative to the pot, or as a raise.
    const spr = stack / Math.max(1, P);
    const facingRaiseLevel = t.streetRaises; // bets/raises already made this street
    for (const to of sizes) {
      const add = to - v.bets[me];
      const jam = to >= v.maxRaiseTo;
      if (jam && spr > 3 && toCall === 0 && street < 3) continue;
      let F = 1;
      let eqRatio = 1;
      let potCalled = P + add;
      let raiseBack = 0;
      let eqTopSum = 0;
      for (const i of responders) {
        const m = model(c, i);
        const ci = Math.min(to - v.bets[i], v.stacks[i]);
        const alpha = ci / (P + add + ci);
        const facing = facingRaiseLevel > 0;
        // A player who already bet this street is raised, not bet into: use their fold-to-raise rate.
        const wasAggressor = facing && v.bets[i] > 0 && v.bets[i] === v.currentBet;
        const f = clamp(c.p.foldScale * (wasAggressor ? m.foldToRaise[street].p * Math.pow(alpha / 0.3, 0.5) : m.foldAt(street, alpha) * (facing ? 0.85 : 1)), 0.02, 0.95);
        const idx = oppSeats.indexOf(i);
        const ce = calledEquity(r, idx, f);
        F *= f;
        eqRatio *= ce.eqAll > 0.001 ? clamp(ce.eqCalled / ce.eqAll, 0, 3) : 1;
        potCalled += ci * (1 - f);
        if (!jam) {
          const rv = clamp(m.raiseVsBet[street].p * (facing ? 0.7 : 1), 0, 0.5);
          raiseBack += rv;
          eqTopSum += calledEquity(r, idx, 0.85).eqCalled;
        }
      }
      const eqC = clamp(eq * eqRatio, 0, 1);
      // Guarantee at least one caller's chips in the called branch.
      if (F < 1) potCalled = Math.max(potCalled, P + add + Math.min(add - toCall, stack) * 0.9);
      const rb = clamp(raiseBack, 0, 0.6);
      const eqTop = responders.length ? eqTopSum / responders.length : 0;
      const evRaised = Math.max(-add, eqTop * (P + 6 * add) - 3 * add);
      const realizeCalled = jam ? 1 : realize;
      const evCalledBranch = (1 - rb) * (realizeCalled * eqC * potCalled - add) + rb * evRaised;
      const evBet = F * P + (1 - F) * evCalledBranch;
      opts.push({ d: jam ? { type: 'allIn' } : { type: 'raise', to }, ev: evBet });
    }
  }
  const pick = choose(c, opts, Math.max(c.p.postTempBB * bb, c.p.postTempPot * P));
  c.debug?.({ street, hole: v.hole.slice(), board: v.board.slice(), pot: P, toCall, eq, nOpp: opps.length, opts: opts.map((o) => `${o.d.type}${'to' in o.d ? o.d.to : ''}:${o.ev.toFixed(0)}`).join(' '), pick: pick.type });
  return pick;
}

export type { Position };

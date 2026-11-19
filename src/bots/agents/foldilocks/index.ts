/**
 * Foldilocks: fullhouse-bot (advitrocks9/fullhouse-bot, MIT) ported from Python to TypeScript so
 * it runs in-process on every surface, with no gateway round trip.
 *
 * - features.ts ports bot/features.py, eval7.ts reproduces eval7's hand scores, this file ports
 *   bot/deep_cfr_lookup.py (dueling advantage network) and bot/bot.py (push/fold chart, legal
 *   masking, sampling, bet sizing). data.ts holds the unchanged weights and tables.
 * - The app's view is turned into the Fullhouse engine's `action_request` with chips scaled to
 *   its 50/100 training blinds, exactly like scripts/ports/python_reference.py does for the Python
 *   original.
 * - tests/foldilocks-parity.test.ts checks features, strategies and chart decisions against the
 *   Python on recorded game states.
 */
import type { BotSpec, BotView, Decision, PokerBot } from '../../types';
import { rngFor } from '../../../sim/rng';
import { RANGES, WEIGHTS } from './data';
import { KERNEL_WASM } from './kernel';
import { computeLegalMask, currentStreetAggression, encodeStateDict, inferDealer, N_ACTIONS, pyRound, type FhLog, type FhPlayer, type FhState } from './features';

const TRAINED_BB = 100;
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
const FOLD = 0;
const CHECK_CALL = 1;
const BET_50 = 2;
const BET_POT = 3;
const ALL_IN = 4;

// ---------------------------------------------------------------- network (deep_cfr_lookup.py)
function f64(b64: string): Float64Array {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return Float64Array.from(new Float32Array(bytes.buffer));
}
interface Dense {
  w: Float64Array;
  b: Float64Array;
  out: number;
  in: number;
  y: Float64Array;
}
const dense = (name: string, bias: string): Dense => ({
  w: f64(WEIGHTS[name].data),
  b: f64(WEIGHTS[bias].data),
  out: WEIGHTS[name].shape[0],
  in: WEIGHTS[name].shape[1],
  y: new Float64Array(WEIGHTS[name].shape[0]),
});
const M = {
  t0: dense('trunk_w0', 'trunk_b0'),
  t1: dense('trunk_w1', 'trunk_b1'),
  ln0g: f64(WEIGHTS.trunk_ln0_g.data),
  ln0b: f64(WEIGHTS.trunk_ln0_b.data),
  ln1g: f64(WEIGHTS.trunk_ln1_g.data),
  ln1b: f64(WEIGHTS.trunk_ln1_b.data),
  v0: dense('val_w0', 'val_b0'),
  v1: dense('val_w1', 'val_b1'),
  a0: dense('adv_w0', 'adv_b0'),
  a1: dense('adv_w1', 'adv_b1'),
};
const X = new Float64Array(64);

/**
 * x @ W.T + b into the layer's own buffer. Weights are the float32 values widened to float64 and
 * sums use four accumulators; results differ from NumPy's float32 only in the last bits
 * (parity test: within 1e-4 on every recorded state).
 */
function linear(x: Float64Array, l: Dense): Float64Array {
  const { w, b, y } = l;
  const n = l.in;
  const n4 = n - (n % 4);
  for (let o = 0, row = 0; o < l.out; o++, row += n) {
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    let i = 0;
    for (; i < n4; i += 4) {
      s0 += x[i] * w[row + i];
      s1 += x[i + 1] * w[row + i + 1];
      s2 += x[i + 2] * w[row + i + 2];
      s3 += x[i + 3] * w[row + i + 3];
    }
    for (; i < n; i++) s0 += x[i] * w[row + i];
    y[o] = s0 + s1 + s2 + s3 + b[o];
  }
  return y;
}
function layerNorm(x: Float64Array, g: Float64Array, b: Float64Array): Float64Array {
  const n = x.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (x[i] - mean) * (x[i] - mean);
  const denom = Math.sqrt(v / n + 1e-5);
  for (let i = 0; i < n; i++) x[i] = (g[i] * (x[i] - mean)) / denom + b[i];
  return x;
}
function leaky(x: Float64Array): Float64Array {
  for (let i = 0; i < x.length; i++) if (!(x[i] > 0)) x[i] = 0.01 * x[i];
  return x;
}

/**
 * SIMD path: native/foldilocks-wasm multiplies in 4-wide float32 (like NumPy's float32 BLAS);
 * layer norm and activations run here on the same memory. Used when the runtime has WebAssembly
 * SIMD; otherwise `strategyJS` below does the same in plain JavaScript.
 */
interface Kernel {
  linear: (w: number, x: number, b: number, y: number, out: number, n: number) => void;
  mem: Float32Array;
  at: Record<string, number>;
}
const LAYERS = ['trunk_w0', 'trunk_b0', 'trunk_w1', 'trunk_b1', 'val_w0', 'val_b0', 'val_w1', 'val_b1', 'adv_w0', 'adv_b0', 'adv_w1', 'adv_b1'];
const BUFS: [string, number][] = [['x', 64], ['h0', 256], ['h1', 256], ['v0', 128], ['a0', 128], ['v1', 4], ['a1', 8]];
function loadKernel(): Kernel | null {
  try {
    if (typeof WebAssembly === 'undefined') return null;
    const bin = typeof atob === 'function' ? atob(KERNEL_WASM) : Buffer.from(KERNEL_WASM, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (!WebAssembly.validate(bytes)) return null; // no SIMD support
    const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
    const ex = inst.exports as { memory: WebAssembly.Memory; arena: () => number; linear: Kernel['linear'] };
    const base = ex.arena() / 4;
    const mem = new Float32Array(ex.memory.buffer);
    const at: Record<string, number> = {};
    let off = base;
    for (const name of LAYERS) {
      const w = f64(WEIGHTS[name].data);
      at[name] = off;
      mem.set(w, off);
      off += (w.length + 3) & ~3;
    }
    for (const [name, n] of BUFS) {
      at[name] = off;
      off += n;
    }
    // `at` holds indices into `mem` (the whole wasm memory); the kernel takes indices into ARENA.
    const lin = ex.linear;
    return { linear: (w, x, b, y, out, n) => lin(w - base, x - base, b - base, y - base, out, n), mem, at };
  } catch {
    return null;
  }
}
const K = loadKernel();

function lnLeakyF32(mem: Float32Array, off: number, n: number, g: Float64Array, b: Float64Array) {
  let mean = 0;
  for (let i = 0; i < n; i++) mean += mem[off + i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (mem[off + i] - mean) * (mem[off + i] - mean);
  const denom = Math.sqrt(v / n + 1e-5);
  for (let i = 0; i < n; i++) {
    const y = (g[i] * (mem[off + i] - mean)) / denom + b[i];
    mem[off + i] = y > 0 ? y : 0.01 * y;
  }
}
function leakyF32(mem: Float32Array, off: number, n: number) {
  for (let i = 0; i < n; i++) if (!(mem[off + i] > 0)) mem[off + i] = 0.01 * mem[off + i];
}

function headsSIMD(features: Float32Array): [number, Float64Array] {
  const { linear: lin, mem, at } = K!;
  mem.set(features, at.x);
  lin(at.trunk_w0, at.x, at.trunk_b0, at.h0, M.t0.out, M.t0.in);
  lnLeakyF32(mem, at.h0, M.t0.out, M.ln0g, M.ln0b);
  lin(at.trunk_w1, at.h0, at.trunk_b1, at.h1, M.t1.out, M.t1.in);
  lnLeakyF32(mem, at.h1, M.t1.out, M.ln1g, M.ln1b);
  lin(at.val_w0, at.h1, at.val_b0, at.v0, M.v0.out, M.v0.in);
  leakyF32(mem, at.v0, M.v0.out);
  lin(at.val_w1, at.v0, at.val_b1, at.v1, M.v1.out, M.v1.in);
  lin(at.adv_w0, at.h1, at.adv_b0, at.a0, M.a0.out, M.a0.in);
  leakyF32(mem, at.a0, M.a0.out);
  lin(at.adv_w1, at.a0, at.adv_b1, at.a1, M.a1.out, M.a1.in);
  return [mem[at.v1], Float64Array.from(mem.subarray(at.a1, at.a1 + N_ACTIONS))];
}

function headsJS(features: Float32Array): [number, Float64Array] {
  for (let i = 0; i < features.length; i++) X[i] = features[i];
  const x = X.subarray(0, features.length);
  let h = leaky(layerNorm(linear(x, M.t0), M.ln0g, M.ln0b));
  h = leaky(layerNorm(linear(h, M.t1), M.ln1g, M.ln1b));
  const v = linear(leaky(linear(h, M.v0)), M.v1)[0];
  return [v, Float64Array.from(linear(leaky(linear(h, M.a0)), M.a1))];
}

/** Which network path this runtime uses ('simd' or 'js'). */
export const networkPath = K ? 'simd' : 'js';

/** DeepCFRLookup.get_strategy for the single advantage model fullhouse ships. */
export function strategy(features: Float32Array, legal: boolean[], forceJS = false): Float32Array {
  const lf = legal.map((l) => (l ? 1 : 0));
  const nLegal = lf.reduce((a: number, b) => a + b, 0);
  const [v, a] = K && !forceJS ? headsSIMD(features) : headsJS(features);
  let aSum = 0;
  for (let i = 0; i < N_ACTIONS; i++) aSum += a[i] * lf[i];
  const aMean = aSum / nLegal;
  const adv = new Float64Array(N_ACTIONS);
  let total = 0;
  for (let i = 0; i < N_ACTIONS; i++) {
    const out = (v + a[i] * lf[i] - aMean * lf[i]) * lf[i];
    adv[i] = Math.max(out, 0) * lf[i];
    total += adv[i];
  }
  const p = new Float32Array(N_ACTIONS);
  for (let i = 0; i < N_ACTIONS; i++) p[i] = total > 0 ? adv[i] / total : lf[i] / nLegal;
  return p;
}

// ---------------------------------------------------------------- decisions (bot.py)
const SETS = Object.fromEntries(Object.entries(RANGES).map(([k, v]) => [k, new Set(v)]));
const RANK_VAL = (r: string) => RANKS.indexOf(r);

function handClass(cards: string[]): string {
  let [r0, s0] = [cards[0][0], cards[0][1]];
  let [r1, s1] = [cards[1][0], cards[1][1]];
  if (RANK_VAL(r0) < RANK_VAL(r1)) [r0, r1, s0, s1] = [r1, r0, s1, s0];
  if (r0 === r1) return r0 + r1;
  return r0 + r1 + (s0 === s1 ? 's' : 'o');
}

function position(state: FhState): string {
  const n = state.players.length;
  const seat = state.seat_to_act;
  const dealer = inferDealer(state, Math.max(n, 2));
  const off = (((seat - dealer) % n) + n) % n;
  if (n === 2) return seat === dealer ? 'BTN' : 'BB';
  if (n === 3) return ['BTN', 'SB', 'BB'][off];
  if (n === 4) return ['BTN', 'SB', 'BB', 'CO'][off];
  if (n === 5) return ['BTN', 'SB', 'BB', 'HJ', 'CO'][off];
  if (n >= 6) {
    // POSITIONS_6MAX[offset] raises IndexError past six seats; bot.decide then plays its safe default.
    if (off >= 6) throw new Error('position index out of range');
    return ['BTN', 'SB', 'BB', 'LJ', 'HJ', 'CO'][off];
  }
  return 'CO';
}

type FhAction = { action: 'fold' | 'check' | 'call' | 'all_in' } | { action: 'raise'; amount: number };

/** _push_fold: the hand-coded chart at 12 BB effective or less (null = let the network play). */
export function pushFold(state: FhState): FhAction | null {
  const stack = state.your_stack;
  const opp = state.players.filter((p) => p.seat !== state.seat_to_act && !p.is_folded).map((p) => p.stack || 0);
  const maxOpp = opp.length ? Math.max(...opp) : stack;
  const effBB = Math.min(stack, maxOpp) / TRAINED_BB;
  if (effBB > 12) return null;
  const hc = handClass(state.your_cards);
  const pos = position(state);
  const owed = state.amount_owed ?? 0;
  if (owed > 0) {
    const potOdds = state.pot + owed > 0 ? owed / (state.pot + owed) : 1;
    if (SETS._PF_TIER1.has(hc)) return { action: 'all_in' };
    const range =
      effBB <= 6 ? (potOdds < 0.35 ? SETS._PF_CALL_MEDIUM : SETS._PF_CALL_TIGHT) : effBB <= 10 ? (potOdds < 0.35 ? SETS._PF_CALL_WIDE : SETS._PF_CALL_MEDIUM) : SETS._PF_CALL_WIDE;
    return range.has(hc) ? { action: 'call' } : { action: 'fold' };
  }
  const push = pos === 'LJ' || pos === 'HJ' ? SETS._PF_TIER1 : pos === 'CO' ? SETS._PF_TIER2 : pos === 'BTN' || pos === 'SB' ? SETS._PF_TIER3 : SETS._PF_CALL_WIDE;
  if (push.has(hc)) return { action: 'all_in' };
  return state.can_check ? { action: 'check' } : { action: 'fold' };
}

/** get_strategy followed by _apply_legal_mask. */
export function maskedStrategy(state: FhState): Float32Array {
  const { features, legal } = encodeStateDict(state);
  const s = strategy(features, legal);
  const agg = currentStreetAggression(state.action_log ?? [], state.players ?? [], state.current_bet ?? 0, state.street ?? 'preflop');
  const lm = computeLegalMask(state, agg.nRaises, agg.lastFullRaise);
  let total = 0;
  for (let i = 0; i < N_ACTIONS; i++) {
    s[i] *= lm[i] ? 1 : 0;
    total += s[i];
  }
  if (total > 0) for (let i = 0; i < N_ACTIONS; i++) s[i] /= total;
  else if (lm.filter(Boolean).length === 1) for (let i = 0; i < N_ACTIONS; i++) s[i] = lm[i] ? 1 : 0;
  else throw new Error('legal masking removed all probability mass');
  return s;
}

function toEngineAction(id: number, state: FhState): FhAction {
  if (id === FOLD) return state.can_check ? { action: 'check' } : { action: 'fold' };
  if (id === CHECK_CALL) return state.can_check ? { action: 'check' } : { action: 'call' };
  if (id === ALL_IN) return { action: 'all_in' };
  if (id !== BET_50 && id !== BET_POT) throw new Error(`unknown action id ${id}`);
  const frac = id === BET_50 ? 0.5 : 1.0;
  const myBet = state.your_bet_this_street ?? 0;
  const toCall = state.amount_owed ?? 0;
  const potAfterCall = (state.pot ?? 0) + toCall;
  let raiseTo = myBet + toCall + pyRound(frac * potAfterCall);
  const maxRaise = myBet + (state.your_stack ?? 0);
  raiseTo = Math.max(state.min_raise_to ?? 0, Math.min(raiseTo, maxRaise));
  if (raiseTo >= maxRaise) return { action: 'all_in' };
  if (raiseTo <= myBet + toCall) return toCall > 0 ? { action: 'call' } : { action: 'check' };
  return { action: 'raise', amount: raiseTo };
}

/** bot.decide(state) with our own seeded RNG for the sampling step. */
export function fhDecide(state: FhState, rnd: () => number): FhAction {
  try {
    if (state.street === 'preflop') {
      const pf = pushFold(state);
      if (pf) return pf;
    }
    const p = maskedStrategy(state);
    const r = rnd();
    let cum = 0;
    let id = N_ACTIONS - 1;
    for (let i = 0; i < N_ACTIONS; i++) {
      cum += p[i];
      if (r < cum) {
        id = i;
        break;
      }
    }
    return toEngineAction(id, state);
  } catch {
    if (state.can_check) return { action: 'check' };
    return state.amount_owed > 0 && state.your_stack > 0 ? { action: 'call' } : { action: 'fold' };
  }
}

// ---------------------------------------------------------------- app view -> engine state
const card = (c: number) => RANKS[c >> 2] + SUITS[c & 3];

/** The same `action_request` scripts/ports/python_reference.py builds for the Python original. */
export function fullhouseState(v: BotView): FhState {
  const k = TRAINED_BB / v.bigBlind;
  const s = (x: number) => pyRound(x * k);
  const log: FhLog[] = [];
  let street = 0;
  let sbPosted = false;
  for (const a of v.actions) {
    while (a.street > street) {
      street++;
      log.push({ action: 'deal' });
    }
    if (a.kind === 'post') {
      if (a.seat === v.sbSeat && !sbPosted) {
        sbPosted = true;
        log.push({ seat: a.seat, action: 'small_blind', amount: s(a.amount) });
      } else if (a.seat === v.bbSeat) log.push({ seat: a.seat, action: 'big_blind', amount: s(a.amount) });
      continue;
    }
    if (a.kind === 'bet' || a.kind === 'raise') log.push({ seat: a.seat, action: a.allIn ? 'all_in' : 'raise', amount: s(a.amount) });
    else if (a.kind === 'call') log.push({ seat: a.seat, action: 'call', amount: s(a.amount) });
    else log.push({ seat: a.seat, action: a.kind, amount: 0 });
  }
  while (v.street > street) {
    street++;
    log.push({ action: 'deal' });
  }
  const players: FhPlayer[] = [];
  for (let i = 0; i < v.numSeats; i++) {
    const folded = v.folded[i];
    const allIn = v.allIn[i];
    players.push({
      seat: i,
      bot_id: v.playerIds[i] ?? `p${i}`,
      stack: s(v.stacks[i]),
      state: folded ? 'folded' : allIn ? 'all_in' : v.stacks[i] === 0 ? 'busted' : 'active',
      is_folded: folded,
      is_all_in: allIn,
      bet_this_street: s(v.bets[i]),
      hole_cards: null,
    });
  }
  const me = v.seat;
  return {
    type: 'action_request',
    hand_id: v.handId,
    street: STREETS[v.street],
    seat_to_act: me,
    pot: s(v.pot),
    community_cards: v.board.map(card),
    current_bet: s(v.currentBet),
    min_raise_to: s(v.canRaise ? v.minRaiseTo : v.currentBet + v.bigBlind),
    amount_owed: s(v.toCall),
    can_check: v.toCall === 0,
    your_cards: v.hole.map(card),
    your_stack: s(v.stacks[me]),
    your_bet_this_street: s(v.bets[me]),
    players,
    action_log: log,
  };
}

export function toDecision(a: FhAction, v: BotView): Decision {
  switch (a.action) {
    case 'raise':
      return { type: 'raise', to: pyRound((a.amount * v.bigBlind) / TRAINED_BB) };
    case 'all_in':
      return { type: 'allIn' };
    case 'call':
      return { type: 'call' };
    case 'check':
      return { type: 'check' };
    default:
      return { type: 'fold' };
  }
}

const foldilocks: BotSpec = {
  id: 'fullhouse',
  name: 'Foldilocks (fullhouse)',
  description: 'Deep CFR advantage network from the Fullhouse Hackathon 2026 final (15th of 64), ported to TypeScript; push/fold chart at 12 BB or less.',
  create({ seed }): PokerBot {
    const rnd = rngFor(seed, 0xc0ffee);
    return { decide: (v: BotView) => toDecision(fhDecide(fullhouseState(v), rnd), v) };
  },
};

export default foldilocks;

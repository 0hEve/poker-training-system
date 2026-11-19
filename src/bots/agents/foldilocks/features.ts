/**
 * TypeScript port of external/fullhouse-bot/bot/features.py (runtime path), function for
 * function, so it reads the same Fullhouse-engine state dict and produces the same 51 float32
 * features and legal mask. Parity with the Python is checked in tests/foldilocks-parity.test.ts.
 */
import { EQUITY } from './data';
import { evaluate7 } from './eval7';

export const FEATURE_DIM = 51;
export const N_ACTIONS = 5;
export const STARTING_STACK = 10_000;
export const BIG_BLIND = 100;
const LEGAL_MASK_OFFSET = 46;
const MAX_EVAL7_SCORE = 135004160.0;
const RANK_ORDER = '23456789TJQKA';
const SUIT_ORDER = 'cdhs';

/** The Fullhouse engine's `action_request` (only the fields the bot reads). */
export interface FhPlayer {
  seat: number;
  bot_id: string;
  stack: number;
  state: string;
  is_folded: boolean;
  is_all_in: boolean;
  bet_this_street: number;
  hole_cards: null;
}
export interface FhLog {
  seat?: number;
  action: string;
  amount?: number;
}
export interface FhState {
  type: 'action_request';
  hand_id: number;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  seat_to_act: number;
  pot: number;
  community_cards: string[];
  current_bet: number;
  min_raise_to: number;
  amount_owed: number;
  can_check: boolean;
  your_cards: string[];
  your_stack: number;
  your_bet_this_street: number;
  players: FhPlayer[];
  action_log: FhLog[];
  dealer?: number;
}

function f32(b64: string): Float32Array {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

const EQ_PAIRED = f32(EQUITY.paired.data);
const EQ_SUITED = f32(EQUITY.suited.data); // 13 x 13, [hi, lo]
const EQ_OFFSUIT = f32(EQUITY.offsuit.data);

/** Python's round(): halves go to the even integer. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

const safeInt = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};

export function cardToIdx(c: string): number {
  return SUIT_ORDER.indexOf(c[1]) * 13 + RANK_ORDER.indexOf(c[0]);
}

export function inferDealer(state: FhState, nPlayers?: number): number {
  let n = nPlayers ?? (state.players.length || 2);
  n = Math.max(Math.trunc(n), 2);
  if (state.dealer != null) return ((state.dealer % n) + n) % n;
  let sb: number | null = null;
  let bb: number | null = null;
  for (const e of state.action_log ?? []) {
    if (e.action === 'small_blind' && e.seat != null) sb = Math.trunc(e.seat);
    else if (e.action === 'big_blind' && e.seat != null) bb = Math.trunc(e.seat);
    if (sb !== null && bb !== null) break;
  }
  const mod = (x: number) => ((x % n) + n) % n;
  if (sb !== null) return n === 2 ? mod(sb) : mod(sb - 1);
  if (bb !== null) return n === 2 ? mod(bb - 1) : mod(bb - 2);
  return 0;
}

function streetSegment(log: FhLog[]): FhLog[] {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].action === 'deal') return log.slice(i + 1);
  return log;
}

const streetIndex = (s: string) => ({ preflop: 0, flop: 1, turn: 2, river: 3 })[s] ?? 0;

function replayBettingRounds(log: FhLog[], players: FhPlayer[], currentStreet: string) {
  const target = streetIndex(currentStreet);
  const seats = new Set<number>(players.map((p, idx) => Math.trunc(p.seat ?? idx)));
  if (!seats.size) for (const e of log) if (e.seat != null) seats.add(Math.trunc(e.seat));
  let street = 0;
  let currentBet = 0;
  let lastFullRaise = BIG_BLIND;
  let streetBets = new Map<number, number>();
  const invested = new Map<number, number>();
  const folded = new Set<number>();
  const allIn = new Set<number>();
  let pending = new Set<number>(seats);
  let nRaises = 0;
  let lastRaiser: number | null = null;
  const active = () => new Set([...seats].filter((s) => !folded.has(s) && !allIn.has(s)));
  const advance = () => {
    street = Math.min(street + 1, 3);
    currentBet = 0;
    lastFullRaise = BIG_BLIND;
    streetBets = new Map();
    pending = active();
  };
  for (const e of log) {
    const action = e.action;
    if (action === 'deal') {
      advance();
      continue;
    }
    if (e.seat == null) continue;
    const seat = Math.trunc(e.seat);
    seats.add(seat);
    const amount = Math.max(safeInt(e.amount ?? 0), 0);
    if (action !== 'small_blind' && action !== 'big_blind' && pending.size === 0 && street < target) advance();
    let inc = 0;
    if (action === 'small_blind' || action === 'big_blind') {
      inc = amount;
      streetBets.set(seat, (streetBets.get(seat) ?? 0) + inc);
      currentBet = Math.max(currentBet, streetBets.get(seat)!);
    } else if (action === 'fold') {
      folded.add(seat);
      pending.delete(seat);
    } else if (action === 'check') {
      pending.delete(seat);
    } else if (action === 'call') {
      inc = amount;
      streetBets.set(seat, (streetBets.get(seat) ?? 0) + inc);
      pending.delete(seat);
    } else if (action === 'raise' || action === 'all_in') {
      const prevBet = currentBet;
      const prevSeatBet = streetBets.get(seat) ?? 0;
      inc = Math.max(0, amount - prevSeatBet);
      streetBets.set(seat, Math.max(prevSeatBet, amount));
      currentBet = Math.max(currentBet, streetBets.get(seat)!);
      pending.delete(seat);
      if (action === 'all_in') allIn.add(seat);
      const raiseSize = Math.max(0, currentBet - prevBet);
      if (raiseSize > 0 && raiseSize >= lastFullRaise) {
        lastFullRaise = raiseSize;
        pending = new Set([...active()].filter((s) => s !== seat));
        if (street === target) {
          nRaises++;
          lastRaiser = seat;
        }
      }
    } else {
      pending.delete(seat);
    }
    if (inc) invested.set(seat, (invested.get(seat) ?? 0) + inc);
  }
  if (target === 0 && currentBet <= BIG_BLIND) {
    nRaises = 0;
    lastRaiser = null;
  }
  return { invested, nRaises: Math.min(nRaises, 4), lastRaiser, lastFullRaise };
}

export function currentStreetAggression(log: FhLog[], players: FhPlayer[], currentBet: number, streetName: string) {
  const blindOnly = streetName === 'preflop' && currentBet <= 100;
  if (currentBet <= 0 || blindOnly) return { nRaises: 0, lastRaiser: null as number | null, lastFullRaise: BIG_BLIND };
  if (log.some((e) => e.action === 'deal')) {
    let nRaises = 0;
    let lastRaiser: number | null = null;
    let streetCurrentBet = 0;
    let lastFullRaise = BIG_BLIND;
    for (const e of streetSegment(log)) {
      if (e.seat == null) continue;
      const amount = safeInt(e.amount ?? 0);
      if (e.action === 'small_blind' || e.action === 'big_blind' || e.action === 'call') {
        streetCurrentBet = Math.max(streetCurrentBet, amount);
        continue;
      }
      if (e.action !== 'raise' && e.action !== 'all_in') continue;
      const raiseSize = Math.max(0, amount - streetCurrentBet);
      streetCurrentBet = Math.max(streetCurrentBet, amount);
      if (raiseSize >= lastFullRaise) {
        lastFullRaise = raiseSize;
        nRaises++;
        lastRaiser = Math.trunc(e.seat);
      }
    }
    if (nRaises) return { nRaises: Math.min(nRaises, 4), lastRaiser, lastFullRaise };
    return { nRaises: 1, lastRaiser: null, lastFullRaise: BIG_BLIND };
  }
  const r = replayBettingRounds(log, players, streetName);
  if (r.nRaises) return { nRaises: r.nRaises, lastRaiser: r.lastRaiser, lastFullRaise: r.lastFullRaise };
  return { nRaises: 1, lastRaiser: null, lastFullRaise: BIG_BLIND };
}

function handInvestedFromLog(log: FhLog[], players: FhPlayer[] | null, streetName: string): Map<number, number> {
  if (players !== null && !log.some((e) => e.action === 'deal')) return replayBettingRounds(log, players, streetName).invested;
  const invested = new Map<number, number>();
  const streetBets = new Map<number, number>();
  for (const e of log) {
    if (e.action === 'deal') {
      streetBets.clear();
      continue;
    }
    if (e.seat == null) continue;
    const seat = Math.trunc(e.seat);
    const amount = Math.max(safeInt(e.amount ?? 0), 0);
    let inc = 0;
    if (e.action === 'small_blind' || e.action === 'big_blind' || e.action === 'call') {
      inc = amount;
      streetBets.set(seat, (streetBets.get(seat) ?? 0) + inc);
    } else if (e.action === 'raise' || e.action === 'all_in') {
      inc = Math.max(0, amount - (streetBets.get(seat) ?? 0));
      streetBets.set(seat, Math.max(streetBets.get(seat) ?? 0, amount));
    }
    if (inc) invested.set(seat, (invested.get(seat) ?? 0) + inc);
  }
  return invested;
}

function countStraightOutRanks(present: boolean[]): number {
  const out = new Set<number>();
  for (let start = 0; start < 9; start++) {
    let c = 0;
    const missing: number[] = [];
    for (let r = start; r < start + 5; r++) (present[r] ? c++ : missing.push(r));
    if (c === 4) missing.forEach((m) => out.add(m));
  }
  const wheel = [12, 0, 1, 2, 3];
  if (wheel.filter((r) => present[r]).length === 4) for (const r of wheel) if (!present[r]) out.add(r);
  return out.size;
}

function detectDraws(hole: number[], board: number[], street: number) {
  if (street >= 3 || !board.length) return { fd: false, oesd: false, gs: false, outs: 0, nfd: false };
  const all = [...hole, ...board];
  const sc = [0, 0, 0, 0];
  for (const c of all) sc[Math.floor(c / 13)]++;
  const maxS = Math.max(...sc);
  const fd = maxS === 4;
  const flushSuit = fd ? sc.indexOf(maxS) : -1;
  let nfd = false;
  if (fd) {
    const onBoard = board.filter((c) => Math.floor(c / 13) === flushSuit).map((c) => c % 13);
    const hero = hole.filter((c) => Math.floor(c / 13) === flushSuit).map((c) => c % 13);
    if (hero.length) nfd = Math.max(...hero) === Math.max(...onBoard, ...hero);
  }
  const present = new Array<boolean>(13).fill(false);
  for (const c of all) present[c % 13] = true;
  const sor = countStraightOutRanks(present);
  const overlap = fd && sor > 0 ? Math.min(sor, 2) : 0;
  return { fd, oesd: sor >= 2, gs: sor === 1, outs: (fd ? 9 : 0) + sor * 4 - overlap, nfd };
}

function boardTexture(board: number[]) {
  const ranks = board.map((c) => c % 13);
  const suits = board.map((c) => Math.floor(c / 13));
  const paired = new Set(ranks).size < ranks.length;
  const monotone = new Set(suits).size === 1;
  let wet = 0;
  if (ranks.length >= 2) {
    let close = 0;
    let total = 0;
    for (let i = 0; i < ranks.length; i++)
      for (let j = i + 1; j < ranks.length; j++) {
        total++;
        if (Math.abs(ranks[i] - ranks[j]) <= 2) close++;
      }
    wet = close / total;
  }
  const present = new Array<boolean>(13).fill(false);
  for (const r of ranks) present[r] = true;
  let sp = false;
  for (let s = 0; s < 9 && !sp; s++) {
    let c = 0;
    for (let r = s; r < s + 5; r++) if (present[r]) c++;
    if (c >= 3) sp = true;
  }
  if (!sp && [12, 0, 1, 2, 3].filter((r) => present[r]).length >= 3) sp = true;
  return { paired, monotone, wet, sp };
}

export function computeLegalMask(state: FhState, _nRaises = 0, lastFullRaiseIn = BIG_BLIND): boolean[] {
  const legal = [false, false, false, false, false];
  const owed = state.amount_owed ?? 0;
  const stack = state.your_stack ?? 0;
  const pot = state.pot ?? 0;
  const minRaise = state.min_raise_to ?? 0;
  const lastFullRaise = Math.max(safeInt(lastFullRaiseIn, BIG_BLIND), BIG_BLIND);
  if (owed > 0) legal[0] = true;
  legal[1] = true;
  if (stack > owed && minRaise > 0) {
    const potAfterCall = pot + owed;
    const betRoom = stack - owed;
    const bet50 = pyRound(0.5 * potAfterCall);
    if (bet50 >= lastFullRaise && betRoom > bet50) legal[2] = true;
    if (potAfterCall >= lastFullRaise && betRoom > potAfterCall) legal[3] = true;
    const opp = state.players.filter((p) => p.seat !== state.seat_to_act && !p.is_folded).map((p) => p.stack ?? 0);
    const maxOpp = opp.length ? Math.max(...opp) : 0;
    const eff = maxOpp > 0 ? Math.min(stack, maxOpp) : stack;
    if (eff / Math.max(pot, 1) < 4) legal[4] = true;
  }
  return legal;
}

/** encode_state_dict: 51 float32 features and the legal mask. */
export function encodeStateDict(state: FhState): { features: Float32Array; legal: boolean[] } {
  const x = new Float32Array(FEATURE_DIM);
  const players = state.players ?? [];
  const mySeat = state.seat_to_act;
  const n = players.length;
  const dealer = inferDealer(state, n);
  const streetName = state.street ?? 'preflop';
  const street = streetIndex(streetName);
  const pot = state.pot ?? 0;
  const myStack = state.your_stack ?? STARTING_STACK;
  const toCall = state.amount_owed ?? 0;
  const currentBet = state.current_bet ?? 0;

  const c0 = cardToIdx(state.your_cards[0]);
  const c1 = cardToIdx(state.your_cards[1]);
  const r0 = c0 % 13;
  const r1 = c1 % 13;
  const s0 = Math.floor(c0 / 13);
  const s1 = Math.floor(c1 / 13);
  const hi = Math.max(r0, r1);
  const lo = Math.min(r0, r1);
  const board = (state.community_cards ?? []).map(cardToIdx);

  x[0] = r0 === r1 ? EQ_PAIRED[r0] : s0 === s1 ? EQ_SUITED[hi * 13 + lo] : EQ_OFFSUIT[hi * 13 + lo];
  if (street > 0 && board.length) {
    const cs = [c0, c1, ...board];
    x[1] = evaluate7(cs.map((c) => c % 13), cs.map((c) => Math.floor(c / 13))) / MAX_EVAL7_SCORE;
  }
  const d = detectDraws([c0, c1], board, street);
  x[2] = d.fd ? 1 : 0;
  x[3] = d.oesd ? 1 : 0;
  x[4] = d.gs ? 1 : 0;
  x[5] = d.outs / 20;
  x[6] = d.nfd ? 1 : 0;
  x[7] = hi / 12;
  x[8] = lo / 12;
  x[9] = s0 === s1 ? 1 : 0;
  x[10] = r0 === r1 ? 1 : 0;
  x[11] = hi !== lo ? (hi - lo - 1) / 12 : 0;
  if (board.length) {
    const t = boardTexture(board);
    x[12] = t.paired ? 1 : 0;
    x[13] = t.monotone ? 1 : 0;
    x[14] = board.filter((b) => b % 13 > hi).length / 5;
    x[15] = t.wet;
    x[16] = t.sp ? 1 : 0;
  }
  x[17 + street] = 1;
  const pos = (((mySeat - dealer) % Math.max(n, 2)) + Math.max(n, 2)) % Math.max(n, 2);
  x[21 + Math.min(pos, 5)] = 1;
  x[27] = pot / STARTING_STACK;
  x[28] = myStack / STARTING_STACK;
  const activeStacks = players.filter((p) => !p.is_folded).map((p) => p.stack ?? 0);
  const minStack = activeStacks.length ? Math.min(...activeStacks) : 0;
  const spr = minStack / Math.max(pot, 1);
  x[29] = Math.min(Math.max(spr, 0), 10) / 10;
  x[30] = toCall > 0 && pot + toCall > 0 ? toCall / (pot + toCall) : 0;
  const opp = players
    .filter((p) => p.seat !== mySeat && !p.is_folded)
    .map((p) => p.stack ?? 0)
    .sort((a, b) => b - a);
  for (let i = 0; i < Math.min(opp.length, 5); i++) x[31 + i] = opp[i] / STARTING_STACK;

  const log = state.action_log ?? [];
  const agg = currentStreetAggression(log, players, currentBet, streetName);
  const hasAggressor = agg.lastRaiser !== null || (currentBet > 0 && !(streetName === 'preflop' && currentBet <= 100));
  x[36] = Math.min(agg.nRaises, 4) / 4;
  x[37] = hasAggressor ? 1 : 0;
  x[38] = agg.lastRaiser === mySeat ? 1 : 0;
  x[39] = (state.your_bet_this_street ?? 0) / STARTING_STACK;
  const inv = handInvestedFromLog(log, players, streetName);
  x[40] = (inv.size ? (inv.get(mySeat) ?? 0) : STARTING_STACK - myStack) / STARTING_STACK;
  x[41] = currentBet / Math.max(pot, 1);
  x[42] = toCall / Math.max(myStack, 1);
  let maxVillBets = 0;
  let maxVillInv = 0;
  for (const p of players) {
    if (p.seat === mySeat || p.is_folded) continue;
    maxVillBets = Math.max(maxVillBets, safeInt(p.bet_this_street ?? 0));
    const seat = safeInt(p.seat ?? -1, -1);
    const vi = inv.size ? (inv.get(seat) ?? 0) : STARTING_STACK - (p.stack ?? STARTING_STACK);
    if (vi > maxVillInv) maxVillInv = vi;
  }
  x[43] = maxVillBets / STARTING_STACK;
  x[44] = maxVillInv / STARTING_STACK;
  x[45] = players.filter((p) => !p.is_folded).length / 6;
  const legal = computeLegalMask(state, agg.nRaises, agg.lastFullRaise);
  for (let a = 0; a < N_ACTIONS; a++) x[LEGAL_MASK_OFFSET + a] = legal[a] ? 1 : 0;
  return { features: x, legal };
}

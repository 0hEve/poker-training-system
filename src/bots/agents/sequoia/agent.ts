/**
 * TypeScript port of external/poker-sequoia/bots/gto_upload/agent.py (betting logic, opponent
 * counters, memory record), function for function. The variant's three-card select phase is not
 * ported: standard hold'em never reaches it. Preflop uses the same two-card shim as
 * scripts/ports/python_reference.py. Parity: tests/sequoia-parity.test.ts.
 */
import { DRAW_EQ, EQ_F, EQ_R, EQ_T, K, NC, NSEATS, OPEN_W, POS_SHOVE, PRE, PRIOR_W, RANGE_EQ, RANGE_PCTS, SCORE_QUANTILES } from './data';
import { evaluate7 } from '../foldilocks/eval7';
import { crc32, PyRandom } from './pyrandom';

// ------------------------------------------------------------------ protocol types (kit SDK)
export interface SqEvent {
  kind: string;
  seat: number | null;
  amount: number;
  cards: string[];
}
export interface SqSeat {
  seat: number;
  stack: number;
  bet: number;
  status: string;
  shown_cards: string[];
}
export interface SqLegal {
  kind: string;
  min_amount: number;
  max_amount: number;
}
export interface SqState {
  events: SqEvent[];
  hand_number: number;
  seat: number;
  cards: string[];
  board: string[];
  pot: number;
  to_call: number;
  legal_actions: SqLegal[];
  history: SqEvent[];
  seats: SqSeat[];
  button: number;
  blinds: { small_blind: number; big_blind: number; ante: number };
  players_remaining: number;
  config: { table_id: string; payouts: number[]; hand_cap: number };
  phase: string;
}
export interface SqAction {
  kind: string;
  amount: number;
}

// ------------------------------------------------------------------ tables
const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
const RANK_IDX = (r: string) => RANKS.indexOf(r);
const NOCARD = 255;
const CODE = (c: string) => (c.length === 2 && RANK_IDX(c[0]) >= 0 && SUITS.includes(c[1]) ? RANK_IDX(c[0]) * 4 + SUITS.indexOf(c[1]) : NOCARD);
type Cls = keyof typeof PRE;
const P = PRE as unknown as Record<string, readonly [number, number, number]>;
const R = RANGE_EQ as unknown as Record<string, readonly [number, number, number, number]>;
const Kn = K as unknown as Record<string, number>;

export function cls2(a: string, b: string): string {
  const ra = RANK_IDX(a[0]);
  const rb = RANK_IDX(b[0]);
  if (ra === rb) return a[0] + a[0];
  const [hi, lo] = ra > rb ? [a, b] : [b, a];
  return hi[0] + lo[0] + (a[1] === b[1] ? 's' : 'o');
}

function preEquity(cls: string, nOpp: number): number {
  const [e1, e7] = P[cls];
  if (nOpp <= 1) return e1 / 1000;
  if (nOpp >= 7) return e7 / 1000;
  return (e1 + ((e7 - e1) * (nOpp - 1)) / 6) / 1000;
}

function rangeEquity(cls: string, width: number): number {
  if (width >= 0.99) return P[cls][0] / 1000;
  const row = R[cls];
  if (width <= RANGE_PCTS[0]) return row[0] / 1000;
  for (let i = 1; i < RANGE_PCTS.length; i++) {
    if (width <= RANGE_PCTS[i]) {
      const lo = RANGE_PCTS[i - 1];
      const hi = RANGE_PCTS[i];
      const t = (width - lo) / (hi - lo);
      return (row[i - 1] + (row[i] - row[i - 1]) * t) / 1000;
    }
  }
  const t = (width - 0.35) / 0.65;
  return (row[3] + (P[cls][0] - row[3]) * t) / 1000;
}

/** Upstream score_percentile (three-card quantiles). */
function quantilePercentile(score: number): number {
  const q = SCORE_QUANTILES;
  let lo = 0;
  let hi = q.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (q[mid] < score) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, 1 - lo / (q.length - 1));
}

// Two-card shim (same as scripts/ports/python_reference.py): score = the class's equity vs one random hand;
// percentile = that class's heads-up percentile (the smallest one among classes with equal equity).
const EQ_TO_PCT = Object.values(P)
  .map((v) => [v[0] / 1000, v[2] / 1000] as const)
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
function scorePercentile(sc: number): number {
  if (sc > 0.9 || sc < EQ_TO_PCT[0][0] - 1e-9) return quantilePercentile(sc);
  let best = EQ_TO_PCT[0];
  for (const t of EQ_TO_PCT) if (Math.abs(t[0] - sc) < Math.abs(best[0] - sc)) best = t;
  return Math.abs(best[0] - sc) < 1e-9 ? best[1] : quantilePercentile(sc);
}
function threeCardScore(cards: string[]): [number, [number, number]] {
  if (cards.length === 2) return [P[cls2(cards[0], cards[1])][0] / 1000, [0, 1]];
  throw new Error('three-card hands are not part of standard hold’em');
}

// ------------------------------------------------------------------ memory record
const [HANDS, VPIP, PFR, LIMP, ALLIN_PRE, FTO_CH, FTO, THREEBET, PBETS, PCALLS, PFOLDS, CBET_CH, CBET, SHOWDOWNS, BLUFFS, EXP_LOW, EXP_HIGH, EXP_PAIRB, RRAISE, WINS_NOSD] = Array.from(
  { length: 20 },
  (_, i) => i,
);
const F_STREET_BET = 1;
const F_CBET_PENDING = 2;

export interface Rec {
  hand: number;
  street: number;
  pre_raises: number;
  aggressor: number;
  m_vpip: number;
  m_pfr: number;
  m_allin: number;
  m_ftoch: number;
  m_limp: number;
  m_river: number;
  flags: number;
  nraisers_street: number;
  board: number[];
  exposed: number[];
  stacks: number[];
  counters: number[][];
}

export function freshRecord(): Rec {
  return {
    hand: 0,
    street: 0,
    pre_raises: 0,
    aggressor: -1,
    m_vpip: 0,
    m_pfr: 0,
    m_allin: 0,
    m_ftoch: 0,
    m_limp: 0,
    m_river: 0,
    flags: 0,
    nraisers_street: 0,
    board: new Array(5).fill(NOCARD),
    exposed: new Array(NSEATS).fill(NOCARD),
    stacks: new Array(NSEATS).fill(0),
    counters: Array.from({ length: NSEATS }, () => new Array(NC).fill(0)),
  };
}

/** pack_record -> unpack_record: the field widths of the upstream struct, applied in place. */
export function roundTrip(r: Rec): Rec {
  return {
    hand: r.hand & 0xffff,
    street: r.street & 0xff,
    pre_raises: Math.min(255, r.pre_raises),
    aggressor: Math.max(-128, Math.min(127, r.aggressor)),
    m_vpip: r.m_vpip & 0xffff,
    m_pfr: r.m_pfr & 0xffff,
    m_allin: r.m_allin & 0xffff,
    m_ftoch: r.m_ftoch & 0xffff,
    m_limp: r.m_limp & 0xffff,
    m_river: r.m_river & 0xffff,
    flags: r.flags & 0xff,
    nraisers_street: Math.min(255, r.nraisers_street),
    board: [...r.board],
    exposed: [...r.exposed],
    stacks: r.stacks.map((s) => Math.min(65535, Math.max(0, Math.trunc(s)))),
    counters: r.counters.map((row) => row.map((v) => (v < 65535 ? v : 65535))),
  };
}

const rate = (count: number, chances: number, prior: number) => (count + prior * PRIOR_W) / (chances + PRIOR_W);

function evalCat(cards: string[]): number {
  const codes = cards.map(CODE);
  return evaluate7(codes.map((c) => c >> 2), codes.map((c) => c & 3)) >> 24;
}

export function feed(rec: Rec, state: SqState): void {
  const counters = rec.counters;
  const seatsNow = state.seats;
  const nseats = Math.min(seatsNow.length, NSEATS);
  const boardCards = rec.board;
  for (const ev of state.events) {
    const k = ev.kind;
    const s = ev.seat;
    if (k === 'hand') {
      rec.hand = ev.amount;
      rec.street = 0;
      rec.pre_raises = 0;
      rec.aggressor = -1;
      rec.m_vpip = rec.m_pfr = rec.m_allin = rec.m_ftoch = rec.m_limp = rec.m_river = 0;
      rec.flags = 0;
      rec.nraisers_street = 0;
      for (let i = 0; i < 5; i++) boardCards[i] = NOCARD;
      for (let i = 0; i < NSEATS; i++) rec.exposed[i] = NOCARD;
      if (ev.amount === state.hand_number) for (let i = 0; i < nseats; i++) rec.stacks[i] = seatsNow[i].stack + seatsNow[i].bet;
      for (let i = 0; i < nseats; i++) if (rec.stacks[i] > 0) counters[i][HANDS]++;
      continue;
    }
    if (s === null) {
      if (k === 'board') {
        let n = boardCards.filter((c) => c !== NOCARD).length;
        for (const c of ev.cards)
          if (n < 5) {
            boardCards[n] = CODE(c);
            n++;
          }
        rec.street = n <= 3 ? 1 : n === 4 ? 2 : 3;
        rec.nraisers_street = 0;
        rec.flags &= ~F_STREET_BET;
        if (n === 3 && rec.aggressor >= 0) {
          counters[rec.aggressor][CBET_CH]++;
          rec.flags |= F_CBET_PENDING;
        }
      }
      continue;
    }
    if (s >= NSEATS) continue;
    const c = counters[s];
    const st = rec.street;
    const bit = 1 << s;
    if (k === 'raise') {
      if (st === 0) {
        if (!(rec.m_vpip & bit)) {
          c[VPIP]++;
          rec.m_vpip |= bit;
        }
        if (!(rec.m_pfr & bit)) {
          c[PFR]++;
          rec.m_pfr |= bit;
        }
        if (rec.pre_raises >= 1 && !(rec.m_ftoch & bit)) {
          c[FTO_CH]++;
          c[THREEBET]++;
          rec.m_ftoch |= bit;
        }
        rec.pre_raises++;
        rec.aggressor = s;
        const sb = rec.stacks[s];
        if (sb > 0 && ev.amount >= 0.9 * sb && !(rec.m_allin & bit)) {
          c[ALLIN_PRE]++;
          rec.m_allin |= bit;
        }
      } else {
        c[PBETS]++;
        if (rec.flags & F_STREET_BET) c[RRAISE]++;
        if (st === 1 && rec.flags & F_CBET_PENDING && s === rec.aggressor && !(rec.flags & F_STREET_BET)) {
          c[CBET]++;
          rec.flags &= ~F_CBET_PENDING;
        }
        if (st === 3) rec.m_river |= bit;
        rec.flags |= F_STREET_BET;
        rec.nraisers_street++;
      }
    } else if (k === 'call') {
      if (st === 0) {
        if (!(rec.m_vpip & bit)) {
          c[VPIP]++;
          rec.m_vpip |= bit;
        }
        if (rec.pre_raises === 0) {
          if (!(rec.m_limp & bit)) {
            c[LIMP]++;
            rec.m_limp |= bit;
          }
        } else if (!(rec.m_ftoch & bit)) {
          c[FTO_CH]++;
          rec.m_ftoch |= bit;
        }
      } else c[PCALLS]++;
    } else if (k === 'check') {
      if (st === 1 && rec.flags & F_CBET_PENDING && s === rec.aggressor) rec.flags &= ~F_CBET_PENDING;
    } else if (k === 'fold') {
      if (st === 0) {
        if (rec.pre_raises >= 1 && !(rec.m_ftoch & bit)) {
          c[FTO_CH]++;
          c[FTO]++;
          rec.m_ftoch |= bit;
        }
      } else if (rec.flags & F_STREET_BET) c[PFOLDS]++;
    } else if (k === 'reveal') {
      if (ev.cards.length) {
        const code = CODE(ev.cards[0]);
        rec.exposed[s] = code;
        if (code !== NOCARD && boardCards.slice(0, 3).some((rc) => rc !== NOCARD && rc >> 2 === code >> 2)) c[EXP_PAIRB]++;
      }
    } else if (k === 'show') {
      if (ev.cards.length === 2) {
        c[SHOWDOWNS]++;
        const exp = rec.exposed[s];
        const codes = ev.cards.map(CODE);
        if (exp !== NOCARD && codes.includes(exp)) {
          const hidden = codes[1] === exp ? codes[0] : codes[1];
          if (hidden >> 2 > exp >> 2) c[EXP_LOW]++;
          else if (hidden >> 2 < exp >> 2) c[EXP_HIGH]++;
        }
        if (rec.m_river & bit) {
          const full = [...codes.filter((x) => x !== NOCARD), ...boardCards.filter((b) => b !== NOCARD)];
          if (full.length >= 5 && evaluate7(full.map((x) => x >> 2), full.map((x) => x & 3)) >> 24 === 0) c[BLUFFS]++;
        }
      }
    } else if (k === 'win') {
      const otherShown = Array.from({ length: nseats }, (_, i) => i).some((i) => i !== s && seatsNow[i].shown_cards.length > 0);
      if (rec.street >= 1 && !otherShown && ev.amount) c[WINS_NOSD]++;
    } else if (k === 'stack') {
      rec.stacks[s] = ev.amount;
    }
  }
}

function labelsFor(c: number[]): Set<string> {
  const out = new Set<string>();
  const hands = c[HANDS];
  if (hands >= 4 && c[ALLIN_PRE] >= 0.5 * hands && c[ALLIN_PRE] >= 3) out.add('SHOVER');
  if (hands >= 10 && c[VPIP] <= 0.02 * hands && c[FTO] >= 4) out.add('FOLDBOT');
  if (hands >= 15 && rate(c[VPIP], hands, 0.25) <= 0.14) out.add('NIT');
  if (hands >= 12 && rate(c[LIMP], hands, 0.02) >= 0.1) out.add('LIMPER');
  if (hands >= 8 && rate(c[PFR], hands, 0.18) >= 0.42) out.add('MANIAC');
  const pc = c[PCALLS] + c[PFOLDS];
  if (pc >= 6 && c[PCALLS] / pc >= 0.65) out.add('STATION');
  if (pc >= 6 && c[PFOLDS] / pc >= 0.75) out.add('FOLDER');
  if (c[CBET_CH] >= 4 && c[CBET] / c[CBET_CH] >= 0.75) out.add('AUTO_CBET');
  if (c[SHOWDOWNS] >= 4 && c[BLUFFS] === 0) out.add('NO_BLUFF');
  if (c[SHOWDOWNS] >= 3 && c[BLUFFS] / c[SHOWDOWNS] >= 0.4) out.add('OVERBLUFF');
  if (c[EXP_LOW] + c[EXP_HIGH] >= 2) {
    if (c[EXP_HIGH] === 0) out.add('EXPOSE_LOW');
    else if (c[EXP_LOW] === 0) out.add('EXPOSE_HIGH');
  }
  return out;
}

// ------------------------------------------------------------------ hand strength
function hasStraight(mask: number): boolean {
  const low = ((mask >> 12) & 1) | (mask << 1);
  for (let start = 0; start < 10; start++) {
    const w = 0b11111 << start;
    if ((low & w) === w) return true;
  }
  return false;
}

function straightOuts(mask: number): number {
  const low = ((mask >> 12) & 1) | (mask << 1);
  let outs = 0;
  for (let r = 0; r < 13; r++) {
    if ((low >> r) & 1) continue;
    const test = low | (1 << r);
    for (let start = 0; start < 10; start++) {
      const w = 0b11111 << start;
      if ((test & w) === w) {
        outs++;
        break;
      }
    }
  }
  return outs;
}

/** Python dict counting with insertion order (for max(d, key=d.get)). */
function countBy<T>(xs: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
function maxKey<T>(m: Map<T, number>): T {
  let best: T | undefined;
  let bv = -Infinity;
  for (const [k, v] of m) if (v > bv) [best, bv] = [k, v];
  return best!;
}
const maxVal = (m: Map<unknown, number>) => Math.max(...m.values());

type Draw = 'gut' | 'oesd' | 'fd' | 'fd_oesd' | 'fd_gut' | 'over2' | 'over1' | null;

export function analyze(hole: string[], board: string[], deadCodes: number[] = []) {
  const value = evalCat([...hole, ...board]);
  const cat = value;
  const hr = hole.map((c) => RANK_IDX(c[0]));
  const br = board.map((c) => RANK_IDX(c[0]));
  const btop = Math.max(...br);
  const bcount = countBy(br);
  const boardPairs = [...bcount.values()].filter((v) => v >= 2).length;
  const boardTrips = [...bcount.values()].some((v) => v >= 3);
  const pocket = hr[0] === hr[1];
  const hits = hr.filter((r) => bcount.has(r));
  const street = board.length;
  const bsuits = countBy(board.map((c) => c[1]));
  let cls: number;
  if (cat >= 6) {
    cls = 8;
    if (boardTrips && !pocket && !hits.length) cls = 4;
  } else if (cat === 5) {
    cls = 7;
    const suit = maxKey(bsuits);
    const ours = hole.filter((c) => c[1] === suit);
    if (bsuits.get(suit)! >= 4 && (!ours.length || RANK_IDX(ours[0][0]) < RANK_IDX('T'))) cls = 4;
    else if (bsuits.get(suit)! >= 4 && Math.max(...ours.map((c) => RANK_IDX(c[0]))) < RANK_IDX('K')) cls = 6;
  } else if (cat === 4) {
    cls = 6;
    let bmask = 0;
    for (const r of br) bmask |= 1 << r;
    if (street === 5 && hasStraight(bmask)) cls = 2;
  } else if (cat === 3) {
    if (pocket && bcount.has(hr[0])) cls = 5;
    else if (hits.length && (bcount.get(hits[0]) ?? 0) >= 2) cls = Math.max(...hr) >= RANK_IDX('T') || pocket ? 5 : 4;
    else cls = !hits.length ? 0 : 1;
  } else if (cat === 2) {
    if (pocket) {
      const topPair = Math.max(...[...bcount].filter(([, v]) => v >= 2).map(([k2]) => k2));
      cls = hr[0] > btop ? 3 : hr[0] < topPair ? 1 : 2;
      if (hr[0] > btop) cls = 3;
    } else if (hits.length === 2) cls = 4;
    else if (hits.length === 1 && boardPairs >= 1) {
      const distinct = [...new Set(br)].sort((a, b) => a - b);
      cls = hits[0] >= distinct[distinct.length - 2] ? 4 : 1;
    } else cls = Math.max(...hr) < btop ? 0 : 1;
  } else if (cat === 1) {
    if (pocket) cls = hr[0] > btop ? 3 : 1;
    else if (hits.length) {
      const top = hits[0] === btop;
      const kicker = Math.max(...hr);
      cls = kicker >= RANK_IDX('Q') && top ? 3 : top ? 2 : 1;
    } else cls = 0;
  } else cls = 0;
  const table = street === 3 ? EQ_F : street === 4 ? EQ_T : EQ_R;
  let eq: number = table[cls];
  if (cls === 0) eq += 0.02 * Number(Math.max(...hr) >= RANK_IDX('Q')) + 0.02 * Number(Math.min(...hr) > btop);
  let draw: Draw = null;
  if (street < 5) {
    const suits = new Map(bsuits);
    for (const c of hole) suits.set(c[1], (suits.get(c[1]) ?? 0) + 1);
    let fsuit: string | null = null;
    for (const [s_, n_] of suits) if (n_ === 4 && hole.some((h) => h[1] === s_)) fsuit = s_;
    const fd = fsuit !== null && hole.filter((h) => h[1] === fsuit).length >= 1;
    let mask = 0;
    for (const r of [...hr, ...br]) mask |= 1 << r;
    let bmask = 0;
    for (const r of br) bmask |= 1 << r;
    let so = 0;
    if (!hasStraight(mask)) {
      so = straightOuts(mask);
      if (straightOuts(bmask) >= so) so = 0;
    }
    if (fd && so >= 2) draw = 'fd_oesd';
    else if (fd && so === 1) draw = 'fd_gut';
    else if (fd) draw = 'fd';
    else if (so >= 2) draw = 'oesd';
    else if (so === 1) draw = 'gut';
    else if (cls === 0 && Math.min(...hr) > btop) draw = 'over2';
    else if (cls === 0 && Math.max(...hr) > btop) draw = 'over1';
    if (draw && cls <= 3) {
      let add: number = (DRAW_EQ as Record<string, readonly number[]>)[draw][street === 3 ? 0 : 1];
      if (fd) {
        const dead = deadCodes.filter((dc) => dc !== NOCARD && SUITS[dc % 4] === fsuit).length;
        add -= 0.035 * dead;
        const fh = hole.filter((h) => h[1] === fsuit);
        if (fh.length === 1 && RANK_IDX(fh[0][0]) < RANK_IDX('J')) add -= 0.06;
      }
      eq = Math.min(0.95, eq + Math.max(0, add) * (cls === 0 ? 1 : 0.3));
    }
  }
  return { cls, draw, eq };
}

const multiway = (eq: number, nOpp: number) => (nOpp <= 1 ? eq : eq ** (1 + 0.9 * (nOpp - 1)));

// ------------------------------------------------------------------ helpers
const can = (state: SqState, kind: string) => state.legal_actions.find((l) => l.kind === kind) ?? null;

export function choose(state: SqState, kind: string, total = 0): SqAction {
  const kinds = new Map(state.legal_actions.map((a) => [a.kind, a]));
  if (kind === 'raise' && kinds.has('raise')) {
    const r = kinds.get('raise')!;
    let amt = Math.trunc(total);
    if (amt < r.min_amount) amt = r.min_amount;
    if (amt > r.max_amount) amt = r.max_amount;
    return { kind: 'raise', amount: amt };
  }
  if ((kind === 'raise' || kind === 'call') && kinds.has('call')) return { kind: 'call', amount: 0 };
  if (kinds.has('check')) return { kind: 'check', amount: 0 };
  if (kinds.has('fold')) return { kind: 'fold', amount: 0 };
  if (state.legal_actions.length) return { kind: state.legal_actions[0].kind, amount: state.legal_actions[0].min_amount };
  return { kind: 'fold', amount: 0 };
}

function positionOf(state: SqState, live: number[], seat: number): string {
  const n = live.length;
  const total = state.seats.length;
  const order: number[] = [];
  let s = state.button;
  for (let i = 0; i < total; i++) {
    if (live.includes(s)) order.push(s);
    s = (((s - 1) % total) + total) % total;
  }
  const d = order.indexOf(seat);
  if (d < 0) return 'ep';
  if (n === 2) return seat === state.button ? 'sb' : 'bb';
  if (d === n - 1) return 'sb';
  if (d === n - 2) return 'bb';
  if (d === 0) return 'btn';
  if (d === 1) return 'co';
  if (d <= 3) return 'mp';
  return 'ep';
}

function shoveWidth(depth: number): number {
  if (depth <= 6) return 0.7;
  if (depth <= 12) return 0.55;
  if (depth <= 16) return 0.45;
  if (depth <= 20) return 0.22;
  return 0.08;
}

export function rngFor(state: SqState): PyRandom {
  const n = crc32(state.config.table_id) * 1000003 + state.hand_number * 7919 + state.history.length;
  return new PyRandom(n % 4294967296);
}

function shoveRangeWidth(stackBB: number, nPrior: number, label: Set<string>): number {
  if (label.has('SHOVER')) return 1.0;
  let w: number;
  if (nPrior === 0) w = stackBB <= 7 ? 0.55 : stackBB <= 12 ? 0.38 : stackBB <= 20 ? 0.24 : 0.14;
  else if (nPrior === 1) w = stackBB <= 14 ? 0.24 : stackBB <= 25 ? 0.14 : 0.08;
  else w = stackBB <= 30 ? 0.06 : 0.03;
  if (label.has('MANIAC')) w = Math.min(1.0, w * 1.7);
  if (label.has('NIT')) w *= 0.6;
  return w;
}

// ------------------------------------------------------------------ agent
export function act(state: SqState, rec: Rec): SqAction {
  try {
    feed(rec, state);
  } catch {
    /* upstream swallows feed errors */
  }
  try {
    return decide(state, rec);
  } catch {
    return choose(state, 'check');
  }
}

function decide(state: SqState, rec: Rec): SqAction {
  if (state.phase !== 'betting') {
    const first = state.legal_actions[0];
    return { kind: first.kind, amount: first.min_amount };
  }
  const me = state.seat;
  const seats = state.seats;
  const my = seats[me];
  const myTotal = my.stack + my.bet;
  const live = seats.filter((s) => s.status !== 'busted').map((s) => s.seat);
  const oppLive = live.filter((s) => s !== me);
  const active = seats.filter((s) => (s.status === 'active' || s.status === 'all_in') && s.seat !== me).map((s) => s.seat);
  const nOpp = Math.max(1, active.length);
  const counters = rec.counters;
  const labels = new Map<number, Set<string>>(oppLive.map((s) => [s, s < NSEATS ? labelsFor(counters[s]) : new Set<string>()]));
  const rnd = rngFor(state);
  const paid = state.config.payouts.filter((p) => p > 0).length;
  const playersLeft = state.players_remaining;
  const handsToCap = state.config.hand_cap - state.hand_number;
  const alive = seats
    .filter((s) => s.status !== 'busted')
    .map((s) => s.stack + s.bet)
    .sort((a, b) => b - a);
  const myRank = alive.includes(myTotal) ? alive.indexOf(myTotal) + 1 : alive.length;
  let lam: number;
  if (playersLeft <= 2) lam = 0;
  else {
    lam = Kn.lam;
    if (playersLeft === paid + 1) lam += 0.3;
    if (handsToCap <= 25 && myRank <= paid) lam += 0.3;
    if (myRank === 1 && playersLeft >= 4) lam += 0.1;
    if (oppLive.some((s) => labels.get(s)!.has('FOLDBOT') || labels.get(s)!.has('NIT')) && state.hand_number < 110) lam += 0.15;
    lam = Math.min(lam, 0.65);
  }
  if (state.board.length === 0) return preflop(state, rec, labels, live, nOpp, myTotal, lam);
  return postflop(state, rec, labels, live, nOpp, myTotal, lam, rnd);
}

function preflop(state: SqState, rec: Rec, labels: Map<number, Set<string>>, live: number[], nOpp: number, myTotal: number, lamIn: number): SqAction {
  const me = state.seat;
  const bb = state.blinds.big_blind || 1;
  const cards = state.cards;
  const [score, bestPair] = threeCardScore(cards);
  const p = scorePercentile(score);
  const bestCls = cls2(cards[bestPair[0]], cards[bestPair[1]]) as Cls;
  const eq1 = P[bestCls][0] / 1000 - 0.07;
  const pos = positionOf(state, live, me);
  const pot = state.pot;
  const toCall = state.to_call;
  const canRaise = can(state, 'raise');
  const seats = state.seats;
  let oppStacks = live.filter((s) => s !== me && seats[s].status !== 'folded').map((s) => seats[s].stack + seats[s].bet);
  if (!oppStacks.length) oppStacks = [myTotal];
  const eff = Math.min(myTotal, oppStacks.length ? Math.max(...oppStacks) : myTotal) / bb;
  const myBB = myTotal / bb;
  const hist = state.history;
  const raises = hist.filter((e) => e.kind === 'raise');
  const nraises = raises.length;
  const limpers = nraises === 0 ? hist.filter((e) => e.kind === 'call').length : 0;
  const raiser = raises.length ? raises[raises.length - 1].seat! : null;
  const raiserTotal = raiser !== null ? seats[raiser].stack + seats[raiser].bet : 0;
  const acted = new Set(hist.filter((e) => ['fold', 'call', 'raise', 'check'].includes(e.kind)).map((e) => e.seat));
  const lab = (s: number) => labels.get(s) ?? new Set<string>();
  const shoversBehind = live.filter((s) => s !== me && lab(s).has('SHOVER') && !acted.has(s) && seats[s].status === 'active');
  const inPot = live.filter((s) => s !== me && seats[s].bet > 0 && (seats[s].status === 'active' || seats[s].status === 'all_in'));
  const lam = myTotal ? lamIn * Math.min(1.0, (2.0 * toCall) / myTotal) : lamIn;
  let totCh = 0;
  let totF = 0;
  for (const s of live)
    if (s !== me && s < NSEATS) {
      totCh += rec.counters[s][FTO_CH];
      totF += rec.counters[s][FTO];
    }
  const tableFold = rate(totF, totCh, 0.75);
  let stealMult = 1.0;
  if (totCh >= 8 && tableFold >= 0.78) stealMult = 1.25;
  if (totCh >= 10 && tableFold >= 0.85) stealMult = 1.35;
  if (nOpp >= 2) {
    const blindSeats = live.filter((s) => s !== me && ['sb', 'bb'].includes(positionOf(state, live, s)));
    if (blindSeats.length && blindSeats.every((s) => labels.get(s)!.has('NIT') || labels.get(s)!.has('FOLDBOT'))) stealMult = Math.max(stealMult, 1.6);
  }
  const OW = OPEN_W as Record<string, number>;
  const PS = POS_SHOVE as Record<string, number>;

  if (nraises === 0) {
    if (can(state, 'check')) {
      if (p <= 0.14 && canRaise) return choose(state, 'raise', bb * (3 + limpers));
      return choose(state, 'check');
    }
    const behind = live.filter((s) => s !== me && !acted.has(s) && seats[s].status === 'active');
    if (behind.length && behind.every((s) => lab(s).has('FOLDBOT')) && canRaise && !limpers) return choose(state, 'raise', 2 * bb);
    if (shoversBehind.length) {
      const thr = 0.62 + 0.15 * Math.min(1.0, Math.max(0.0, (eff - 10) / 40.0));
      if (eq1 >= thr && canRaise) return choose(state, 'raise', canRaise.max_amount);
      return choose(state, 'fold');
    }
    const width = Math.min(Kn.steal_cap, OW[pos] * stealMult * Kn.open_mult);
    const depth = Math.min(myBB, eff);
    if (depth <= 30) {
      let sw = Math.min(0.9, shoveWidth(depth) * PS[pos] * stealMult * Kn.shove_w_mult);
      if (limpers) sw *= 0.7;
      if (p <= sw && canRaise) return choose(state, 'raise', canRaise.max_amount);
      if (depth <= 16) return choose(state, 'fold');
    }
    const openBB = depth > 40 ? Kn.open_bb : depth > 30 ? 2.5 : 2.3;
    if (limpers) {
      if (p <= width * 0.8 && canRaise) return choose(state, 'raise', Math.trunc(bb * (openBB + 2 * limpers)));
      return choose(state, 'fold');
    }
    if (p <= width && canRaise) return choose(state, 'raise', Math.trunc(openBB * bb));
    return choose(state, 'fold');
  }

  const price = pot + toCall > 0 ? toCall / (pot + toCall) : 1.0;
  const openedByMe = hist.some((e) => e.kind === 'raise' && e.seat === me);
  const raiserLabel = raiser !== null ? lab(raiser) : new Set<string>();
  const facingAllin = raiser !== null && (seats[raiser].status === 'all_in' || toCall >= 0.5 * myTotal);
  if (facingAllin || raiserLabel.has('SHOVER')) {
    const prior = nraises - 1;
    const width = shoveRangeWidth(raiserTotal / bb, prior, raiserLabel);
    let eq = rangeEquity(bestCls, width) - 0.06;
    const others = inPot.filter((s) => s !== raiser);
    if (others.length) {
      eq *= (preEquity(bestCls, 1 + others.length) / preEquity(bestCls, 1)) ** 0.9;
      eq -= 0.02 * others.length;
    }
    let need = price * (1.0 + lam) + 0.05;
    if (eff > 40 && prior >= 1) need += 0.05;
    if (state.hand_number <= 40 && myBB >= 60) need += 0.06;
    let ok: boolean;
    if (raiserLabel.has('SHOVER')) {
      let thr = 0.62 + 0.15 * Math.min(1.0, Math.max(0.0, (eff - 10) / 40.0));
      if (others.length) thr += 0.08;
      ok = eq1 >= thr && eq >= need;
    } else ok = eq >= need;
    if (myBB <= 6 && state.players_remaining > 2 && eq >= need - 0.06) ok = true;
    if (!ok) return choose(state, 'fold');
    if (can(state, 'call') && (toCall >= 0.5 * myTotal || seats[raiser!].status === 'all_in')) return choose(state, 'call');
    return choose(state, 'raise', canRaise ? canRaise.max_amount : 0);
  }
  if (openedByMe) {
    if (p <= 0.045 && canRaise) {
      if (eff <= 45) return choose(state, 'raise', canRaise.max_amount);
      if (p <= 0.012) return choose(state, 'raise', Math.trunc(2.6 * raises[raises.length - 1].amount));
      return choose(state, 'call');
    }
    if (p <= 0.16 && toCall <= 0.14 * myTotal && eff > 25) return choose(state, 'call');
    if (p <= 0.09 && eff <= 45 && canRaise) return choose(state, 'raise', canRaise.max_amount);
    return choose(state, 'fold');
  }
  if (nraises >= 2) {
    if (p <= (eff <= 50 ? 0.03 : 0.012) && canRaise) return choose(state, 'raise', canRaise.max_amount);
    if (p <= 0.06 && toCall <= 0.1 * myTotal) return choose(state, 'call');
    return choose(state, 'fold');
  }
  const maniac = raiserLabel.has('MANIAC');
  const nit = raiserLabel.has('NIT');
  const v3 = Kn.three_bet * (maniac ? 1.6 : 1.0) * (nit ? 0.6 : 1.0);
  if (p <= v3 && canRaise) {
    if (eff <= 25) return choose(state, 'raise', canRaise.max_amount);
    return choose(state, 'raise', 3 * raises[raises.length - 1].amount + (pos === 'sb' || pos === 'bb' ? bb : 0));
  }
  if (Math.min(myBB, raiserTotal / bb) <= 32) {
    const w = 0.22 * (maniac ? 1.4 : 1.0) * (nit ? 0.55 : 1.0);
    if (p <= w && canRaise) return choose(state, 'raise', canRaise.max_amount);
    if (myBB <= 15) return choose(state, 'fold');
  }
  let callW = 0.05 * (maniac ? 1.5 : 1.0) * (nit ? 0.6 : 1.0);
  if (pos === 'bb') {
    if (toCall <= 1.5 * bb) callW = Math.max(callW, 0.3);
    else if (toCall <= 2.5 * bb) callW = Math.max(callW, 0.18);
    else callW = Math.max(callW, 0.1);
  } else if (pos === 'btn' || pos === 'co') callW = Math.max(callW, 0.09);
  if (p <= callW && toCall <= 0.15 * myTotal) return choose(state, 'call');
  return choose(state, 'fold');
}

function postflop(state: SqState, rec: Rec, labels: Map<number, Set<string>>, live: number[], nOpp: number, myTotal: number, lam: number, rnd: PyRandom): SqAction {
  const me = state.seat;
  const seats = state.seats;
  const cards = state.cards;
  const board = state.board;
  const pot = state.pot;
  const toCall = state.to_call;
  const canRaise = can(state, 'raise');
  const bb = state.blinds.big_blind || 1;
  if (cards.length !== 2) return toCall === 0 ? choose(state, 'check') : choose(state, 'fold');
  const dead = live.filter((s) => s !== me && s < NSEATS).map((s) => rec.exposed[s]);
  const a = analyze(cards, board, dead);
  let eq1 = a.eq;
  const cls = a.cls;
  const br = board.map((c) => RANK_IDX(c[0]));
  const btop = Math.max(...br);
  const bsuits = countBy(board.map((c) => c[1]));
  let threat = 0;
  for (const s of live) {
    if (s === me || s >= NSEATS || seats[s].status === 'folded') continue;
    const ec = rec.exposed[s];
    if (ec === NOCARD) continue;
    const er = ec >> 2;
    const es = SUITS[ec % 4];
    const lab = labels.get(s) ?? new Set<string>();
    if (er === btop) threat += 0.14;
    else if (br.includes(er)) threat += 0.07;
    else if (er > btop) threat += 0.03;
    if ((bsuits.get(es) ?? 0) >= 2 && board.length < 5) threat += 0.04;
    const lowW = lab.has('EXPOSE_LOW') ? 1.0 : lab.has('EXPOSE_HIGH') ? 0.0 : 0.6;
    if (lowW && er >= RANK_IDX('T')) {
      if (er === RANK_IDX('A')) threat += 0.3 * lowW;
      else if (er >= RANK_IDX('Q')) threat += 0.16 * lowW;
      else threat += 0.07 * lowW;
    }
    if (lab.has('EXPOSE_HIGH') && er <= RANK_IDX('9') && !br.includes(er)) threat -= 0.08;
  }
  if (cls <= 3) eq1 = Math.max(0.03, eq1 - Math.min(0.22, threat));
  let eq = multiway(eq1, nOpp);
  const street = board.length;
  const hist = state.history;
  let preAggr = -1;
  let streetBets = 0;
  let lastBettor = -1;
  let seenBoard = 0;
  for (const e of hist) {
    if (e.kind === 'board') {
      seenBoard++;
      streetBets = 0;
      continue;
    }
    if (e.kind === 'raise') {
      if (seenBoard === 0) preAggr = e.seat!;
      else {
        streetBets++;
        lastBettor = e.seat!;
      }
    }
  }
  const aggressor = preAggr === me;
  let weBetFlop = false;
  let nb = 0;
  for (const e of hist) {
    if (e.kind === 'board') nb++;
    else if (e.kind === 'raise' && nb === 1 && e.seat === me) weBetFlop = true;
  }
  let oppAggrStreets = 0;
  seenBoard = 0;
  let streetHad = false;
  for (const e of hist) {
    if (e.kind === 'board') {
      if (streetHad) oppAggrStreets++;
      streetHad = false;
      seenBoard++;
    } else if (e.kind === 'raise' && seenBoard >= 1 && e.seat !== me) streetHad = true;
  }
  if (streetHad) oppAggrStreets++;
  let bmask = 0;
  for (const r of br) bmask |= 1 << r;
  const fourFlush = maxVal(bsuits) >= 4;
  const fourStraight = straightOuts(bmask) >= 1 && new Set(br).size >= 4 && !hasStraight(bmask);
  const scary = fourFlush || fourStraight;
  if (scary && cls <= 4) {
    eq1 = Math.max(0.03, eq1 - 0.15);
    eq = multiway(eq1, nOpp);
  }
  const oppLabels = new Set<string>();
  for (const s of live) if (s !== me && seats[s].status !== 'folded') for (const l of labels.get(s) ?? []) oppLabels.add(l);
  const station = oppLabels.has('STATION');
  const folder = oppLabels.has('FOLDER') && nOpp === 1;
  const foldbot = nOpp === 1 && oppLabels.has('FOLDBOT');
  const nobluff = oppLabels.has('NO_BLUFF');
  const bettorLabel = lastBettor >= 0 ? (labels.get(lastBettor) ?? new Set<string>()) : new Set<string>();
  const rs = [...br].sort((x, y) => x - y);
  const dry =
    new Set(br).size === br.length &&
    maxVal(bsuits) <= 2 &&
    (rs[rs.length - 1] - rs[0] >= 5 || (board.length === 3 && rs[1] - rs[0] >= 2 && rs[2] - rs[1] >= 2));

  const bet = (frac: number, bluff = false): SqAction => {
    const size = Math.max(Math.trunc(pot * frac), bb);
    let target = seats[me].bet + toCall + size;
    if (target - seats[me].bet >= 0.62 * seats[me].stack) {
      if (bluff || (scary && cls <= 4 && street >= 4)) return toCall ? choose(state, 'call') : choose(state, 'check');
      target = canRaise ? canRaise.max_amount : target;
    }
    return choose(state, 'raise', target);
  };

  if (toCall === 0) {
    if ((foldbot || folder) && canRaise) return bet(0.5);
    const strong = !station ? Kn.strong : Kn.strong - 0.06;
    if (eq >= strong && canRaise) {
      if (cls >= 5 && nOpp <= 2 && street >= 4) return bet(1.5);
      if (cls >= 4) return bet(station ? 1.1 : 1.0);
      return bet(station ? 1.0 : 0.85);
    }
    if (canRaise && !station && nOpp <= 2) {
      if (street === 3 && aggressor) {
        if (nOpp === 1) {
          if (eq1 >= 0.3 || rnd.random() < Kn.cbet_hu) return bet(0.8, eq1 < 0.3);
        } else if (eq1 >= 0.3 || (dry && rnd.random() < 0.5)) return bet(0.75, eq1 < 0.3);
      }
      if (street === 4 && aggressor && weBetFlop && streetBets === 0 && nOpp === 1) {
        if (['fd', 'oesd', 'fd_oesd', 'fd_gut'].includes(a.draw ?? '') || (!scary && rnd.random() < Kn.barrel)) return bet(0.85, cls <= 1);
      }
      if (street === 5 && nOpp === 1 && cls === 0 && !nobluff && rnd.random() < Kn.bluff_river && !oppLabels.has('STATION')) return bet(1.0, true);
    }
    return choose(state, 'check');
  }

  const price = toCall / (pot + toCall);
  const big = toCall >= 0.4 * myTotal;
  const small = toCall <= 0.4 * (pot - toCall);
  let need = price + Kn.call_margin + (street === 3 ? 0.0 : street === 4 ? 0.02 : 0.05);
  if (streetBets >= 2) need += 0.1;
  if (nobluff && cls <= 3) need += 0.08;
  if (oppAggrStreets >= 2 && cls <= 3 && !small) need += cls <= 1 ? 0.1 : 0.04;
  if (street === 3 && cls <= 1 && a.draw === null && !small) need += cls === 1 ? 0.06 : 0.1;
  if (cls <= 1 && !small && street >= 4 && a.draw === null) need += 0.1;
  if (bettorLabel.has('MANIAC') || bettorLabel.has('OVERBLUFF') || (bettorLabel.has('AUTO_CBET') && street === 3)) need -= 0.06;
  if (big) {
    need = price * (1.0 + lam * Math.min(1.0, (2.0 * toCall) / myTotal)) + 0.04 + (streetBets >= 2 && cls <= 4 ? 0.08 : 0.0);
    if (oppAggrStreets >= 2 && cls <= 3) need += cls <= 1 ? 0.12 : 0.06;
    if (bettorLabel.has('MANIAC') || bettorLabel.has('OVERBLUFF')) need -= 0.07;
    if (eq >= need) {
      if (canRaise && cls >= 5 && eq >= 0.72) return choose(state, 'raise', canRaise.max_amount);
      return choose(state, 'call');
    }
    return choose(state, 'fold');
  }
  if (canRaise && ((cls >= 5 && eq >= 0.72 && streetBets === 1) || (cls >= 7 && eq >= 0.8))) return bet(1.0);
  if (canRaise && cls === 4 && eq >= 0.66 && streetBets === 1 && street <= 4 && rnd.random() < 0.7) return bet(0.9);
  if (
    canRaise &&
    street === 3 &&
    nOpp === 1 &&
    streetBets === 1 &&
    !station &&
    ['fd_oesd', 'fd', 'oesd', 'fd_gut'].includes(a.draw ?? '') &&
    toCall <= 0.2 * myTotal &&
    rnd.random() < Kn.semi_raise
  )
    return bet(1.0, true);
  if (['fd', 'oesd', 'fd_oesd', 'fd_gut'].includes(a.draw ?? '') && street < 5 && toCall <= 0.15 * myTotal) need -= 0.05;
  if (small && street < 5 && (cls >= 1 || a.draw !== null)) need -= 0.04;
  if (eq >= need) {
    if (canRaise && cls >= 3 && streetBets === 1 && street <= 4 && !scary && toCall <= 0.25 * myTotal && rnd.random() < Kn.value_raise) return bet(1.0);
    return choose(state, 'call');
  }
  if (canRaise && street === 3 && nOpp === 1 && small && dry && cls === 0 && !station && rnd.random() < Kn.raise_bluff) return bet(1.0, true);
  return choose(state, 'fold');
}

/**
 * Sequoia: poker_sequoia's uploaded `gto_upload` agent (nnicholas-c/poker_sequoia), ported from
 * Python to TypeScript so it runs in-process on every surface.
 *
 * agent.ts ports the agent; this file ports the adapter in scripts/ports/python_reference.py that turns the
 * app's view into the kit's GameState: stable table seats per player id (clockwise order kept as
 * the button moves), incremental public events including finished hands' showdowns, and the
 * per-table memory record (kept as an object, truncated to the upstream struct's field widths
 * after every action).
 * Parity: tests/sequoia-parity.test.ts.
 */
import type { BotSpec, BotView, Decision, HandSummary, PokerBot } from '../../types';
import { act, freshRecord, roundTrip, type Rec, type SqEvent, type SqLegal, type SqSeat, type SqState } from './agent';

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const card = (c: number) => RANKS[c >> 2] + SUITS[c & 3];

interface ActionLike {
  seat: number;
  street: number;
  kind: string;
  amount: number;
}

/** Per-instance table memory (python_reference.py's `Table`). */
export class SequoiaTable {
  ids: string[] = [];
  rec: Rec = freshRecord();
  hand: number | null = null;
  fed = 0;
  hands = 0;

  seat(pid: string): number {
    if (!this.ids.includes(pid)) this.ids.push(pid);
    return this.ids.indexOf(pid);
  }

  handEvents(handId: number, n: number, ids: readonly string[], startStacks: readonly number[], actions: readonly ActionLike[], board: readonly number[], shown?: readonly (readonly number[] | null)[], net?: readonly number[]): SqEvent[] {
    const seatOf = Array.from({ length: n }, (_, i) => this.seat(ids[i]));
    const evs: SqEvent[] = [{ kind: 'hand', seat: null, amount: handId, cards: [] }];
    let street = 0;
    for (const a of actions) {
      while (a.street > street) {
        street++;
        const cards = street === 1 ? board.slice(0, 3) : board.slice(street + 1, street + 2);
        evs.push({ kind: 'board', seat: null, amount: 0, cards: cards.map(card) });
      }
      const s = seatOf[a.seat];
      if (a.kind === 'post') evs.push({ kind: 'blind', seat: s, amount: a.amount, cards: [] });
      else if (a.kind === 'bet' || a.kind === 'raise') evs.push({ kind: 'raise', seat: s, amount: a.amount, cards: [] });
      else if (a.kind === 'call') evs.push({ kind: 'call', seat: s, amount: a.amount, cards: [] });
      else evs.push({ kind: a.kind, seat: s, amount: 0, cards: [] });
    }
    if (shown && net) {
      for (let i = 0; i < n; i++) if (shown[i]) evs.push({ kind: 'show', seat: seatOf[i], amount: 0, cards: shown[i]!.map(card) });
      for (let i = 0; i < n; i++) if (net[i] > 0) evs.push({ kind: 'win', seat: seatOf[i], amount: net[i], cards: [] });
      for (let i = 0; i < n; i++) evs.push({ kind: 'stack', seat: seatOf[i], amount: startStacks[i] + net[i], cards: [] });
    }
    return evs;
  }

  /** python_reference.py Sequoia.decide up to the agent call: the GameState for this view. */
  state(v: BotView, summaries: readonly HandSummary[], instance: string): SqState {
    const n = v.numSeats;
    const ids = v.playerIds.length ? v.playerIds : Array.from({ length: n }, (_, i) => `p${i}`);
    for (const pid of ids) this.seat(pid);
    let newEvents: SqEvent[] = [];
    for (const s of summaries) {
      if (s.handId === v.handId) continue;
      const evs = this.handEvents(s.handId, s.numSeats, s.playerIds, s.startStacks, s.actions, s.board, s.shown, s.net);
      newEvents = newEvents.concat(this.hand === s.handId ? evs.slice(this.fed) : evs);
      this.hand = s.handId;
      this.fed = evs.length;
    }
    const cur = this.handEvents(v.handId, n, ids, v.startStacks, v.actions, v.board);
    const lastActed = Math.max(0, ...v.actions.map((a) => a.street));
    for (let st = lastActed + 1; st <= v.street; st++) {
      const cards = st === 1 ? v.board.slice(0, 3) : v.board.slice(st + 1, st + 2);
      cur.push({ kind: 'board', seat: null, amount: 0, cards: cards.map(card) });
    }
    if (this.hand === v.handId) newEvents = newEvents.concat(cur.slice(this.fed));
    else {
      newEvents = newEvents.concat(cur);
      this.hands++;
    }
    this.hand = v.handId;
    this.fed = cur.length;

    const seatOf = Array.from({ length: n }, (_, i) => this.seat(ids[i]));
    const seats: SqSeat[] = [];
    for (let s = 0; s < this.ids.length; s++) {
      const i = seatOf.indexOf(s);
      if (i >= 0) seats.push({ seat: s, stack: v.stacks[i], bet: v.bets[i], status: v.folded[i] ? 'folded' : v.allIn[i] ? 'all_in' : 'active', shown_cards: [] });
      else seats.push({ seat: s, stack: 0, bet: 0, status: 'busted', shown_cards: [] });
    }
    const la: SqLegal[] = [];
    if (v.toCall !== 0) la.push({ kind: 'fold', min_amount: 0, max_amount: 0 }, { kind: 'call', min_amount: 0, max_amount: 0 });
    else la.push({ kind: 'check', min_amount: 0, max_amount: 0 });
    if (v.canRaise) la.push({ kind: 'raise', min_amount: v.minRaiseTo, max_amount: v.maxRaiseTo });
    return {
      events: newEvents.map((e) => (e.kind === 'hand' && e.amount === v.handId ? { ...e, amount: this.hands } : e)),
      hand_number: this.hands,
      seat: seatOf[v.seat],
      cards: v.hole.map(card),
      board: v.board.map(card),
      pot: v.pot,
      to_call: v.toCall,
      legal_actions: la,
      history: cur.filter((e) => e.kind !== 'hand'),
      seats,
      button: seatOf[0],
      blinds: { small_blind: v.smallBlind, big_blind: v.bigBlind, ante: v.ante },
      players_remaining: n,
      config: { table_id: instance, payouts: [100], hand_cap: 10 ** 9 },
      phase: 'betting',
    };
  }

  /** Agent.act with the memory round trip. */
  decide(v: BotView, summaries: readonly HandSummary[], instance: string): Decision {
    const state = this.state(v, summaries, instance);
    const a = act(state, this.rec);
    this.rec = roundTrip(this.rec);
    if (a.kind === 'raise') return { type: 'raise', to: Math.trunc(a.amount) };
    return { type: a.kind === 'fold' || a.kind === 'call' || a.kind === 'check' ? a.kind : 'check' };
  }
}

let counter = 0;

const sequoia: BotSpec = {
  id: 'sequoia',
  name: 'Sequoia (gto_upload)',
  description: 'No Limit 2026 team bot, ported to TypeScript: calibrated preflop tables, eval7 postflop classes, per-opponent counters. 2–10 players.',
  create({ seed, playerId }): PokerBot {
    const table = new SequoiaTable();
    const instance = `sequoia:${playerId}:${seed}:${++counter}`;
    let pending: HandSummary[] = [];
    return {
      decide(v: BotView): Decision {
        const d = table.decide(v, pending, instance);
        pending = [];
        return d;
      },
      handEnd(s: HandSummary) {
        pending.push({
          ...s,
          playerIds: [...s.playerIds],
          startStacks: [...s.startStacks],
          board: [...s.board],
          actions: s.actions.map((a) => ({ ...a })),
          shown: s.shown.map((h) => (h ? [...h] : null)),
          net: [...s.net],
        });
        if (pending.length > 50) pending.shift();
      },
    };
  },
};

export default sequoia;

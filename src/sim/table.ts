import type { ActionEvent, ActionKind, BotView, Decision, HandSummary, PokerBot, Street } from '../bots/types';
import { eval7 } from './eval';

/**
 * Headless No-Limit Hold'em hand runner for bot simulations.
 *
 * Rules mirror `engine/game.ts` exactly (blinds/antes, heads-up order, min-raise,
 * short all-ins that don't reopen, uncalled-bet returns, side pots, odd chips),
 * which `tests/sim-table.test.ts` checks by replaying random hands through both.
 *
 * Unlike the reducer it mutates one set of arrays in place and shares them with
 * the bots' `BotView`, so a hand costs a few microseconds plus bot thinking time.
 */

export interface TableConfig {
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export interface SeatStats {
  decisions: number;
  /** Milliseconds spent inside `decide`. */
  thinkMs: number;
  /** Decisions that were illegal and had to be corrected. */
  invalid: number;
  /** `decide` / `handEnd` threw. */
  errors: number;
}

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now();

export class FastTable {
  readonly cfg: TableConfig;
  /** Net result per seat of the last hand. */
  readonly net: number[] = [];
  /** Per-seat counters for the last hand (accumulate them yourself). */
  readonly stats: SeatStats[] = [];
  /** Record every applied (normalised) decision; used by tests. */
  recordDecisions = false;
  readonly applied: Decision[] = [];
  /** Measure time spent in `decide` (adds ~50 ns per decision). */
  timeBots = true;

  private n = 0;
  private bots: PokerBot[] = [];
  private stacks: number[] = [];
  private startStacks: number[] = [];
  private bets: number[] = [];
  private committed: number[] = [];
  private folded: boolean[] = [];
  private allIn: boolean[] = [];
  private hasActed: boolean[] = [];
  private betFaced: number[] = [];
  private holes: number[][] = [];
  private scores: number[] = [];
  private board: number[] = [];
  private actions: ActionEvent[] = [];
  private deck: ArrayLike<number> = [];
  private deckPos = 0;
  private street: Street = 0;
  private currentBet = 0;
  private minRaise = 0;
  private toAct = -1;
  private sbSeat = 0;
  private bbSeat = 1;
  private done = false;
  private showdownReached = false;
  private view: BotView;
  private seven = new Int32Array(7);

  constructor(cfg: TableConfig) {
    this.cfg = { ...cfg };
    this.view = {
      handId: 0,
      numSeats: 0,
      seat: 0,
      sbSeat: 0,
      bbSeat: 1,
      smallBlind: cfg.smallBlind,
      bigBlind: cfg.bigBlind,
      ante: cfg.ante,
      playerIds: [],
      street: 0,
      hole: [],
      board: this.board,
      stacks: this.stacks,
      startStacks: this.startStacks,
      bets: this.bets,
      committed: this.committed,
      folded: this.folded,
      allIn: this.allIn,
      pot: 0,
      currentBet: 0,
      toCall: 0,
      canRaise: false,
      minRaiseTo: 0,
      maxRaiseTo: 0,
      actions: this.actions,
    };
  }

  /**
   * Play one hand. Arrays are in seat order starting at the button (seat 0).
   * `deck` must hold at least 2 * players + 8 distinct cards in dealing order.
   */
  playHand(bots: PokerBot[], playerIds: readonly string[], stacks: readonly number[], deck: ArrayLike<number>, handId: number): number[] {
    this.startHand(bots, playerIds, stacks, deck, handId);
    while (!this.done) this.askAndApply(this.toAct);
    return this.finishHand(handId, playerIds);
  }

  /** Browser workers can be stopped while a remote bot is waiting on the gateway. */
  async playHandAsync(bots: PokerBot[], playerIds: readonly string[], stacks: readonly number[], deck: ArrayLike<number>, handId: number, signal: AbortSignal): Promise<number[]> {
    this.startHand(bots, playerIds, stacks, deck, handId);
    while (!this.done) {
      const i = this.toAct;
      const bot = this.bots[i];
      if (!bot.decideAsync) {
        this.askAndApply(i);
        continue;
      }
      const v = this.fillView(i);
      const st = this.stats[i];
      const t0 = this.timeBots ? now() : 0;
      let d: Decision;
      try {
        d = await bot.decideAsync(v, signal);
      } catch {
        signal.throwIfAborted();
        st.errors++;
        d = { type: v.toCall === 0 ? 'check' : 'fold' };
      }
      signal.throwIfAborted();
      if (this.timeBots) st.thinkMs += now() - t0;
      st.decisions++;
      this.apply(i, v, d, st);
    }
    return this.finishHand(handId, playerIds);
  }

  private startHand(bots: PokerBot[], playerIds: readonly string[], stacks: readonly number[], deck: ArrayLike<number>, handId: number) {
    const n = bots.length;
    if (n < 2) throw new Error('Need at least two players');
    this.n = n;
    this.bots = bots;
    this.deck = deck;
    this.deckPos = 0;
    this.done = false;
    this.showdownReached = false;
    this.street = 0;
    this.board.length = 0;
    this.actions.length = 0;
    for (const arr of [this.stacks, this.startStacks, this.bets, this.committed, this.folded, this.allIn, this.hasActed, this.betFaced, this.net, this.scores] as unknown[][]) arr.length = n;
    while (this.holes.length < n) this.holes.push([0, 0]);
    while (this.stats.length < n) this.stats.push({ decisions: 0, thinkMs: 0, invalid: 0, errors: 0 });
    for (let i = 0; i < n; i++) {
      if (!(stacks[i] > 0)) throw new Error('Every dealt-in player needs chips');
      this.stacks[i] = stacks[i];
      this.startStacks[i] = stacks[i];
      this.bets[i] = 0;
      this.committed[i] = 0;
      this.folded[i] = false;
      this.allIn[i] = false;
      this.hasActed[i] = false;
      this.betFaced[i] = 0;
      this.net[i] = 0;
      const st = this.stats[i];
      st.decisions = 0;
      st.thinkMs = 0;
      st.invalid = 0;
      st.errors = 0;
    }
    this.applied.length = 0;

    const v = this.view;
    v.handId = handId;
    v.numSeats = n;
    v.playerIds = playerIds;
    v.smallBlind = this.cfg.smallBlind;
    v.bigBlind = this.cfg.bigBlind;
    v.ante = this.cfg.ante;

    const headsUp = n === 2;
    this.sbSeat = headsUp ? 0 : 1;
    this.bbSeat = headsUp ? 1 : 2 % n;
    v.sbSeat = this.sbSeat;
    v.bbSeat = this.bbSeat;

    if (this.cfg.ante > 0) for (let i = 0; i < n; i++) this.post(i, this.cfg.ante, false);
    this.post(this.sbSeat, this.cfg.smallBlind, true);
    this.post(this.bbSeat, this.cfg.bigBlind, true);
    this.currentBet = this.cfg.bigBlind;
    this.minRaise = this.cfg.bigBlind;

    for (let round = 0; round < 2; round++) for (let k = 1; k <= n; k++) this.holes[k % n][round] = this.draw();

    this.toAct = this.nextToAct(this.bbSeat);
    if (this.toAct < 0) this.advanceStreet();
  }

  private finishHand(handId: number, playerIds: readonly string[]): number[] {
    for (let i = 0; i < this.n; i++) this.net[i] = this.stacks[i] - this.startStacks[i];
    this.notifyHandEnd(handId, playerIds);
    return this.net;
  }

  /** Actions of the last hand (reused; copy if you need to keep them). */
  get handActions(): readonly ActionEvent[] {
    return this.actions;
  }

  /** The last hand reached a showdown. */
  get wentToShowdown(): boolean {
    return this.showdownReached;
  }

  /** Seat `i` folded in the last hand. */
  hasFolded(i: number): boolean {
    return this.folded[i];
  }

  /* ------------------------------------------------------------ internals */

  private draw(): number {
    return this.deck[this.deckPos++];
  }

  private commit(i: number, amount: number, isBet: boolean): number {
    const amt = amount < this.stacks[i] ? amount : this.stacks[i];
    this.stacks[i] -= amt;
    this.committed[i] += amt;
    if (isBet) this.bets[i] += amt;
    if (this.stacks[i] === 0) this.allIn[i] = true;
    return amt;
  }

  private post(i: number, amount: number, isBet: boolean) {
    const amt = this.commit(i, amount, isBet);
    this.event(i, 'post', amt);
  }

  private event(seat: number, kind: ActionKind, amount: number) {
    this.actions.push({ seat, street: this.street, kind, amount, allIn: this.allIn[seat] });
  }

  private callTarget(i: number): number {
    let anyActive = false;
    let maxBet = 0;
    for (let j = 0; j < this.n; j++) {
      if (j === i || this.folded[j]) continue;
      if (!this.allIn[j]) anyActive = true;
      if (this.bets[j] > maxBet) maxBet = this.bets[j];
    }
    return anyActive ? this.currentBet : maxBet;
  }

  private nextToAct(from: number): number {
    const n = this.n;
    let actors = 0;
    for (let j = 0; j < n; j++) if (!this.folded[j] && !this.allIn[j]) actors++;
    if (actors === 0) return -1;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (this.folded[i] || this.allIn[i]) continue;
      if (actors === 1 ? this.bets[i] < this.callTarget(i) : !this.hasActed[i] || this.bets[i] < this.currentBet) return i;
    }
    return -1;
  }

  /** Fill the shared view for seat `i` (legal actions included). */
  private fillView(i: number): BotView {
    const v = this.view;
    const n = this.n;
    v.seat = i;
    v.street = this.street;
    v.hole = this.holes[i];
    let pot = 0;
    for (let j = 0; j < n; j++) pot += this.committed[j];
    v.pot = pot;
    v.currentBet = this.currentBet;
    const stack = this.stacks[i];
    const toCall = Math.max(0, this.callTarget(i) - this.bets[i]);
    v.toCall = toCall < stack ? toCall : stack;
    const maxTo = this.bets[i] + stack;
    let othersCanAct = false;
    for (let j = 0; j < n; j++) if (j !== i && !this.folded[j] && !this.allIn[j]) othersCanAct = true;
    const reopened = !this.hasActed[i] || this.currentBet - this.betFaced[i] >= this.minRaise;
    if (othersCanAct && reopened && maxTo > this.currentBet) {
      const minTo = this.currentBet === 0 ? this.cfg.bigBlind : this.currentBet + this.minRaise;
      v.canRaise = true;
      v.minRaiseTo = minTo < maxTo ? minTo : maxTo;
      v.maxRaiseTo = maxTo;
    } else {
      v.canRaise = false;
      v.minRaiseTo = 0;
      v.maxRaiseTo = 0;
    }
    return v;
  }

  private askAndApply(i: number) {
    const v = this.fillView(i);
    const st = this.stats[i];
    let d: Decision;
    const t0 = this.timeBots ? now() : 0;
    try {
      d = this.bots[i].decide(v);
    } catch {
      st.errors++;
      d = { type: v.toCall === 0 ? 'check' : 'fold' };
    }
    if (this.timeBots) st.thinkMs += now() - t0;
    st.decisions++;
    this.apply(i, v, d, st);
  }

  /** Normalise the decision against the legal actions in `v`, then apply it. */
  private apply(i: number, v: BotView, d: Decision, st: SeatStats) {
    const toCall = v.toCall;
    let kind: 'fold' | 'check' | 'call' | 'raise' = 'fold';
    let to = 0;
    switch (d?.type) {
      case 'fold':
        kind = 'fold';
        break;
      case 'check':
        if (toCall === 0) kind = 'check';
        else {
          st.invalid++;
          kind = 'fold';
        }
        break;
      case 'call':
        kind = toCall > 0 ? 'call' : 'check';
        break;
      case 'raise': {
        if (!v.canRaise) {
          st.invalid++;
          kind = toCall > 0 ? 'call' : 'check';
          break;
        }
        to = Math.floor(d.to);
        if (!(to >= v.minRaiseTo)) {
          if (!(to >= 0)) st.invalid++;
          to = v.minRaiseTo;
        } else if (to > v.maxRaiseTo) to = v.maxRaiseTo;
        kind = 'raise';
        break;
      }
      case 'allIn':
        if (v.canRaise) {
          kind = 'raise';
          to = v.maxRaiseTo;
        } else kind = toCall > 0 ? 'call' : 'check';
        break;
      default:
        st.invalid++;
        kind = toCall === 0 ? 'check' : 'fold';
    }
    if (this.recordDecisions) this.applied.push(kind === 'raise' ? { type: 'raise', to } : { type: kind });

    switch (kind) {
      case 'fold':
        this.folded[i] = true;
        this.event(i, 'fold', 0);
        break;
      case 'check':
        this.event(i, 'check', 0);
        break;
      case 'call': {
        const amt = this.commit(i, toCall, true);
        this.event(i, 'call', amt);
        break;
      }
      case 'raise': {
        const prevBet = this.currentBet;
        const increment = to - prevBet;
        this.commit(i, to - this.bets[i], true);
        if (increment >= this.minRaise) this.minRaise = increment;
        this.currentBet = to;
        this.event(i, prevBet === 0 ? 'bet' : 'raise', to);
        break;
      }
    }
    this.hasActed[i] = true;
    this.betFaced[i] = this.currentBet;

    let live = 0;
    let last = -1;
    for (let j = 0; j < this.n; j++)
      if (!this.folded[j]) {
        live++;
        last = j;
      }
    if (live === 1) {
      this.finishUncontested(last);
      return;
    }
    const next = this.nextToAct(i);
    if (next >= 0) this.toAct = next;
    else this.advanceStreet();
  }

  private returnUncalled() {
    let top = -1;
    let first = 0;
    let second = 0;
    for (let i = 0; i < this.n; i++) {
      const b = this.bets[i];
      if (b > first) {
        second = first;
        first = b;
        top = i;
      } else if (b > second) second = b;
    }
    const extra = first - second;
    if (top < 0 || extra <= 0) return;
    this.bets[top] -= extra;
    this.committed[top] -= extra;
    this.stacks[top] += extra;
    if (this.stacks[top] > 0) this.allIn[top] = false;
  }

  private advanceStreet() {
    for (;;) {
      this.returnUncalled();
      for (let i = 0; i < this.n; i++) {
        this.bets[i] = 0;
        this.hasActed[i] = false;
        this.betFaced[i] = 0;
      }
      this.currentBet = 0;
      this.minRaise = this.cfg.bigBlind;
      this.toAct = -1;
      if (this.street === 3) {
        this.showdown();
        return;
      }
      this.draw(); // burn
      if (this.street === 0) {
        this.board.push(this.draw(), this.draw(), this.draw());
      } else this.board.push(this.draw());
      this.street = (this.street + 1) as Street;
      const next = this.nextToAct(0);
      if (next >= 0) {
        this.toAct = next;
        return;
      }
    }
  }

  private finishUncontested(winner: number) {
    this.returnUncalled();
    let total = 0;
    for (let i = 0; i < this.n; i++) total += this.committed[i];
    this.stacks[winner] += total;
    this.done = true;
  }

  private showdown() {
    const n = this.n;
    this.showdownReached = true;
    const s7 = this.seven;
    for (let k = 0; k < 5; k++) s7[k] = this.board[k];
    let maxLive = 0;
    for (let i = 0; i < n; i++) {
      if (this.folded[i]) {
        this.scores[i] = -1;
        continue;
      }
      s7[5] = this.holes[i][0];
      s7[6] = this.holes[i][1];
      this.scores[i] = eval7(s7, 7);
      if (this.committed[i] > maxLive) maxLive = this.committed[i];
    }
    // Dead money above every live contribution joins the last pot (matches engine/pots.ts).
    let leftover = 0;
    for (let i = 0; i < n; i++) if (this.committed[i] > maxLive) leftover += this.committed[i] - maxLive;

    let prev = 0;
    for (;;) {
      let level = Infinity;
      for (let i = 0; i < n; i++) if (!this.folded[i] && this.committed[i] > prev && this.committed[i] < level) level = this.committed[i];
      if (level === Infinity) break;
      let amount = 0;
      for (let i = 0; i < n; i++) {
        const c = this.committed[i];
        if (c > prev) amount += (c < level ? c : level) - prev;
      }
      if (level === maxLive) amount += leftover;
      let best = -1;
      let winners = 0;
      for (let i = 0; i < n; i++) {
        if (this.folded[i] || this.committed[i] < level) continue;
        if (this.scores[i] > best) {
          best = this.scores[i];
          winners = 1;
        } else if (this.scores[i] === best) winners++;
      }
      const share = Math.floor(amount / winners);
      let odd = amount - share * winners;
      // Odd chips go clockwise starting left of the button.
      for (let k = 1; k <= n; k++) {
        const i = k % n;
        if (this.folded[i] || this.committed[i] < level || this.scores[i] !== best) continue;
        this.stacks[i] += share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
      }
      prev = level;
    }
    this.done = true;
  }

  private notifyHandEnd(handId: number, playerIds: readonly string[]) {
    const n = this.n;
    const shown: (readonly number[] | null)[] = new Array(n);
    for (let i = 0; i < n; i++) shown[i] = this.showdownReached && !this.folded[i] ? this.holes[i].slice() : null;
    const board = this.board.slice();
    const actions = this.actions.slice();
    const startStacks = this.startStacks.slice();
    const net = this.net.slice();
    const ids = playerIds.slice(); // callers may reuse their array for the next hand
    for (let i = 0; i < n; i++) {
      const bot = this.bots[i];
      if (!bot.handEnd) continue;
      const summary: HandSummary = {
        handId,
        numSeats: n,
        seat: i,
        playerIds: ids,
        bigBlind: this.cfg.bigBlind,
        startStacks,
        board,
        actions,
        shown,
        net,
        showdown: this.showdownReached,
      };
      try {
        bot.handEnd(summary);
      } catch {
        this.stats[i].errors++;
      }
    }
  }
}

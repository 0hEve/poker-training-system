/**
 * Bot API. A bot controls exactly one seat. The same interface drives the live
 * table (UI) and the headless simulator, so a bot written once runs in both.
 *
 * Conventions
 * - Cards are integers 0..51: rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3.
 * - Seats are numbered clockwise from the button: seat 0 is the button. Heads-up the
 *   button is also the small blind. `view.seat` is the bot's own seat.
 * - All chip amounts are integers.
 * - Streets: 0 preflop, 1 flop, 2 turn, 3 river.
 *
 * Performance contract (simulator)
 * - `decide` must be synchronous and should take well under 100 µs (>= 10,000 decisions/s).
 * - The simulator REUSES the view object and its arrays between calls. Read what you
 *   need; never keep references to the view or its arrays after `decide` returns,
 *   and never mutate them.
 */

export type Street = 0 | 1 | 2 | 3;

export type ActionKind = 'post' | 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface ActionEvent {
  seat: number;
  street: Street;
  kind: ActionKind;
  /**
   * 'post' / 'call': chips added. 'bet' / 'raise': the new street total ("raise to").
   * 'fold' / 'check': 0.
   */
  amount: number;
  /** True when this action put the player all-in. */
  allIn: boolean;
}

export interface BotView {
  /** Increments every hand within one table/match. */
  handId: number;
  /** Players dealt into this hand (2..10). */
  numSeats: number;
  /** This bot's seat (0 = button). */
  seat: number;
  sbSeat: number;
  bbSeat: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  /** Stable player ids per seat; the same opponent keeps its id for the whole match. */
  playerIds: readonly string[];

  street: Street;
  /** Two hole cards. */
  hole: readonly number[];
  /** 0, 3, 4 or 5 cards. */
  board: readonly number[];

  /** Chips behind, per seat (after what is already committed). */
  stacks: readonly number[];
  /** Stacks at the start of the hand, before blinds and antes. */
  startStacks: readonly number[];
  /** Chips put in on the current street, per seat. */
  bets: readonly number[];
  /** Chips put in during the whole hand (incl. antes), per seat. */
  committed: readonly number[];
  folded: readonly boolean[];
  allIn: readonly boolean[];

  /** Sum of `committed` (everything in the middle, including current street bets). */
  pot: number;
  /** Highest street bet so far. */
  currentBet: number;
  /** Chips needed to call (0 = check is legal). Already capped at the stack. */
  toCall: number;
  /** Raising is legal (if false, `minRaiseTo` / `maxRaiseTo` are 0). */
  canRaise: boolean;
  /** Smallest legal "raise to" street total (may equal max when only an all-in remains). */
  minRaiseTo: number;
  /** Largest legal "raise to" street total (= all-in). */
  maxRaiseTo: number;

  /** Every action this hand in order, including blind/ante posts. */
  actions: readonly ActionEvent[];
}

export type Decision =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** Bet or raise so the bot's total bet on this street equals `to`. Clamped to the legal range. */
  | { type: 'raise'; to: number }
  | { type: 'allIn' };

/** Sent to every bot at the table after each hand. */
export interface HandSummary {
  handId: number;
  numSeats: number;
  /** The receiving bot's seat in this hand. */
  seat: number;
  playerIds: readonly string[];
  bigBlind: number;
  startStacks: readonly number[];
  board: readonly number[];
  actions: readonly ActionEvent[];
  /** Hole cards revealed at showdown (null for folded / uncontested). */
  shown: readonly (readonly number[] | null)[];
  /** Net chips won (+) or lost (-) per seat this hand. */
  net: readonly number[];
  /** True if the hand reached a showdown. */
  showdown: boolean;
}

export interface PokerBot {
  decide(view: BotView): Decision;
  /** Optional: learn from the finished hand (opponent modelling). */
  handEnd?(summary: HandSummary): void;
}

export interface BotCreateOptions {
  /** Deterministic seed for the bot's own randomness. */
  seed: number;
  /** This bot's stable player id. */
  playerId: string;
}

export interface BotSpec {
  /** Short id used on the command line and in saved settings, e.g. "tag". */
  id: string;
  name: string;
  description: string;
  create(opts: BotCreateOptions): PokerBot;
}

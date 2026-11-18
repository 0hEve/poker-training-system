import { type Card, cardLabel } from './cards';
import { evaluate, type HandValue } from './evaluator';
import { buildPots, splitPot } from './pots';
import { shuffledDeck } from './shuffle';

/* ------------------------------------------------------------------ types */

export interface Player {
  id: string;
  name: string;
  stack: number;
  /** Colour tag used by the UI. */
  color: string;
  sittingOut: boolean;
}

export interface Settings {
  smallBlind: number;
  bigBlind: number;
  ante: number;
  startingStack: number;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface SeatState {
  playerId: string;
  hole: Card[];
  /** Chips put in during the current street. */
  bet: number;
  /** Chips put in during the whole hand (incl. antes). */
  total: number;
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
  /** currentBet at the moment this seat last acted (for the re-open rule). */
  betFacedWhenActed: number;
  lastAction: string | null;
}

export interface PotResult {
  amount: number;
  eligible: string[];
  winners: string[];
  /** true if this "pot" was an uncalled bet returned to its owner. */
  returned: boolean;
}

export interface HandResult {
  pots: PotResult[];
  hands: Record<string, HandValue | undefined>;
  /** Net amount each player collected from the pots. */
  payouts: Record<string, number>;
  /** Hand ended because everyone else folded. */
  uncontested: boolean;
}

export interface HandState {
  number: number;
  deck: Card[];
  deckPos: number;
  board: Card[];
  burned: Card[];
  street: Street;
  /** Seats in clockwise order starting with the button. */
  seats: SeatState[];
  buttonSeat: number;
  sbSeat: number;
  bbSeat: number;
  /** Index into seats of the player to act, null when no action is pending. */
  toAct: number | null;
  currentBet: number;
  /** Size of the last full bet/raise on this street (the min-raise increment). */
  minRaise: number;
  result: HandResult | null;
}

export interface GameState {
  players: Player[];
  settings: Settings;
  /** id of the player who had the button last hand. */
  buttonPlayerId: string | null;
  handCounter: number;
  hand: HandState | null;
  log: string[];
}

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** Bet or raise so the player's total bet on this street equals `to`. */
  | { type: 'raise'; to: number }
  | { type: 'allIn' };

export type Command =
  | { type: 'startHand'; deck?: Card[] }
  | { type: 'act'; action: Action }
  | { type: 'abortHand' }
  | { type: 'addPlayer'; name: string; color?: string }
  | { type: 'removePlayer'; id: string }
  | { type: 'renamePlayer'; id: string; name: string }
  | { type: 'setStack'; id: string; stack: number }
  | { type: 'adjustStack'; id: string; delta: number }
  | { type: 'toggleSitOut'; id: string }
  | { type: 'resetChips' }
  | { type: 'updateSettings'; settings: Partial<Settings> }
  | { type: 'moveButton'; id: string };

export const MAX_PLAYERS = 10;
export const PLAYER_COLORS = ['#c0392b', '#2471a3', '#d68910', '#7d3c98', '#17a589', '#cb4335', '#2e4053', '#b9770e', '#1e8449', '#a93226'];

/* --------------------------------------------------------------- creation */

let idCounter = 0;
const newId = () => `p${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function createGame(names: string[] = ['Alice', 'Bob', 'Carol', 'Dave'], settings?: Partial<Settings>): GameState {
  const s: Settings = { smallBlind: 5, bigBlind: 10, ante: 0, startingStack: 1000, ...settings };
  return {
    players: names.map((name, i) => ({ id: newId(), name, stack: s.startingStack, color: PLAYER_COLORS[i % PLAYER_COLORS.length], sittingOut: false })),
    settings: s,
    buttonPlayerId: null,
    handCounter: 0,
    hand: null,
    log: [],
  };
}

/* ---------------------------------------------------------------- queries */

export const handInProgress = (g: GameState) => !!g.hand && !g.hand.result;

export function playerById(g: GameState, id: string): Player | undefined {
  return g.players.find((p) => p.id === id);
}

/** Chips in the middle (all contributions this hand not yet paid out). */
export function potTotal(h: HandState): number {
  return h.result ? 0 : h.seats.reduce((a, s) => a + s.total, 0);
}

/** Chips from previous streets only (what sits in the centre; current bets sit in front of players). */
export function collectedPot(h: HandState): number {
  return h.result ? 0 : h.seats.reduce((a, s) => a + s.total - s.bet, 0);
}

export interface LegalActions {
  fold: boolean;
  check: boolean;
  call: number; // 0 if no call possible
  /** Minimum and maximum "raise to" totals; null if raising is not allowed. */
  raise: { min: number; max: number; isBet: boolean } | null;
  allIn: number; // amount of chips the all-in would add
}

/**
 * Amount a seat must match. Normally the current bet; but when this seat is
 * the only one left with chips, only real wagers by live opponents count
 * (a short all-in big blind does not have to be called in full).
 */
function callTarget(h: HandState, i: number): number {
  const others = h.seats.filter((s, j) => j !== i && !s.folded);
  if (others.some((s) => !s.allIn)) return h.currentBet;
  return Math.max(0, ...others.map((s) => s.bet));
}

export function legalActions(g: GameState): LegalActions | null {
  const h = g.hand;
  if (!h || h.result || h.toAct === null) return null;
  const seat = h.seats[h.toAct];
  const stack = playerById(g, seat.playerId)!.stack;
  const toCall = Math.max(0, callTarget(h, h.toAct) - seat.bet);
  const maxTo = seat.bet + stack;
  const othersCanAct = h.seats.some((s, i) => i !== h.toAct && !s.folded && !s.allIn);
  const reopened = !seat.hasActed || h.currentBet - seat.betFacedWhenActed >= h.minRaise;
  let raise: LegalActions['raise'] = null;
  if (othersCanAct && reopened && maxTo > h.currentBet) {
    const minTo = h.currentBet === 0 ? Math.min(g.settings.bigBlind, maxTo) : Math.min(h.currentBet + h.minRaise, maxTo);
    raise = { min: minTo, max: maxTo, isBet: h.currentBet === 0 };
  }
  return {
    fold: true,
    check: toCall === 0,
    call: toCall > 0 ? Math.min(toCall, stack) : 0,
    raise,
    allIn: stack > 0 && (raise !== null || toCall > 0) ? stack : 0,
  };
}

/* ---------------------------------------------------------------- reducer */

export function reduce(state: GameState, cmd: Command): GameState {
  const g: GameState = structuredClone(state);
  switch (cmd.type) {
    case 'startHand':
      startHand(g, cmd.deck);
      break;
    case 'act':
      act(g, cmd.action);
      break;
    case 'abortHand':
      abortHand(g);
      break;
    case 'addPlayer': {
      if (g.players.length >= MAX_PLAYERS) throw new Error('Table is full');
      const used = new Set(g.players.map((p) => p.color));
      const color = cmd.color ?? PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
      g.players.push({ id: newId(), name: cmd.name.trim() || `Player ${g.players.length + 1}`, stack: g.settings.startingStack, color, sittingOut: false });
      log(g, `${cmd.name} joins with ${g.settings.startingStack}.`);
      break;
    }
    case 'removePlayer': {
      if (inHand(g, cmd.id)) throw new Error('Cannot remove a player during their hand');
      g.players = g.players.filter((p) => p.id !== cmd.id);
      if (g.buttonPlayerId === cmd.id) g.buttonPlayerId = null;
      break;
    }
    case 'renamePlayer': {
      const p = playerById(g, cmd.id);
      if (p) p.name = cmd.name;
      break;
    }
    case 'setStack':
    case 'adjustStack': {
      if (inHand(g, cmd.id)) throw new Error('Edit chips between hands');
      const p = playerById(g, cmd.id);
      if (!p) break;
      const next = cmd.type === 'setStack' ? cmd.stack : p.stack + cmd.delta;
      p.stack = Math.max(0, Math.floor(next));
      log(g, `${p.name}'s stack set to ${p.stack}.`);
      break;
    }
    case 'toggleSitOut': {
      const p = playerById(g, cmd.id);
      if (p) p.sittingOut = !p.sittingOut;
      break;
    }
    case 'resetChips': {
      g.hand = null;
      for (const p of g.players) p.stack = g.settings.startingStack;
      log(g, `All stacks reset to ${g.settings.startingStack}.`);
      break;
    }
    case 'updateSettings': {
      const locksBlinds = (['smallBlind', 'bigBlind', 'ante'] as const).some((k) => k in cmd.settings && cmd.settings[k] !== g.settings[k]);
      if (locksBlinds && handInProgress(g)) throw new Error('Change blinds between hands');
      const s = { ...g.settings, ...cmd.settings };
      for (const k of ['smallBlind', 'bigBlind', 'ante', 'startingStack'] as const) s[k] = Math.max(0, Math.floor(Number(s[k]) || 0));
      if (s.bigBlind < 1) s.bigBlind = 1;
      if (s.smallBlind > s.bigBlind) s.smallBlind = s.bigBlind;
      g.settings = s;
      break;
    }
    case 'moveButton':
      if (handInProgress(g)) throw new Error('Move the button between hands');
      // Store the player *before* the chosen one so the next hand puts the button on `id`.
      g.buttonPlayerId = previousEligible(g, cmd.id);
      break;
  }
  return g;
}

/* --------------------------------------------------------------- internals */

function log(g: GameState, line: string) {
  g.log.push(line);
  if (g.log.length > 200) g.log.splice(0, g.log.length - 200);
}

const inHand = (g: GameState, id: string) => handInProgress(g) && g.hand!.seats.some((s) => s.playerId === id);

const eligibleToPlay = (p: Player) => !p.sittingOut && p.stack > 0;

function previousEligible(g: GameState, id: string): string | null {
  const idx = g.players.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  for (let k = 1; k <= g.players.length; k++) {
    const p = g.players[(idx - k + g.players.length) % g.players.length];
    if (eligibleToPlay(p)) return p.id;
  }
  return null;
}

function startHand(g: GameState, deck?: Card[]) {
  if (handInProgress(g)) throw new Error('A hand is already in progress');
  const n = g.players.length;
  const lastIdx = g.buttonPlayerId ? g.players.findIndex((p) => p.id === g.buttonPlayerId) : -1;

  // Moving button: next eligible player clockwise from last hand's button.
  let buttonIdx = -1;
  for (let k = 1; k <= n; k++) {
    const i = (lastIdx + k + n) % n;
    if (eligibleToPlay(g.players[i])) {
      buttonIdx = i;
      break;
    }
  }
  const order: Player[] = [];
  if (buttonIdx >= 0) for (let k = 0; k < n; k++) {
    const p = g.players[(buttonIdx + k) % n];
    if (eligibleToPlay(p)) order.push(p);
  }
  if (order.length < 2) throw new Error('Need at least two players with chips');

  g.buttonPlayerId = order[0].id;
  g.handCounter++;
  const seats: SeatState[] = order.map((p) => ({
    playerId: p.id,
    hole: [],
    bet: 0,
    total: 0,
    folded: false,
    allIn: false,
    hasActed: false,
    betFacedWhenActed: 0,
    lastAction: null,
  }));
  const m = seats.length;
  const headsUp = m === 2;
  const sbSeat = headsUp ? 0 : 1;
  const bbSeat = headsUp ? 1 : 2 % m;

  const h: HandState = {
    number: g.handCounter,
    deck: deck ? [...deck] : shuffledDeck(),
    deckPos: 0,
    board: [],
    burned: [],
    street: 'preflop',
    seats,
    buttonSeat: 0,
    sbSeat,
    bbSeat,
    toAct: null,
    currentBet: 0,
    minRaise: g.settings.bigBlind,
    result: null,
  };
  g.hand = h;
  log(g, `— Hand #${h.number} — button: ${order[0].name}`);

  // Antes (dead money, not part of the street bet).
  if (g.settings.ante > 0) {
    for (const s of seats) {
      const amt = commit(g, s, g.settings.ante, false);
      if (amt) log(g, `${nameOf(g, s)} antes ${amt}.`);
    }
  }
  const sbAmt = commit(g, seats[sbSeat], g.settings.smallBlind, true);
  log(g, `${nameOf(g, seats[sbSeat])} posts small blind ${sbAmt}.`);
  const bbAmt = commit(g, seats[bbSeat], g.settings.bigBlind, true);
  log(g, `${nameOf(g, seats[bbSeat])} posts big blind ${bbAmt}.`);
  seats[sbSeat].lastAction = `SB ${sbAmt}`;
  seats[bbSeat].lastAction = `BB ${bbAmt}`;
  // Players must call the full big blind even if the BB is short.
  h.currentBet = g.settings.bigBlind;
  h.minRaise = g.settings.bigBlind;

  // Deal two cards each, one at a time, starting left of the button.
  for (let round = 0; round < 2; round++) {
    for (let k = 1; k <= m; k++) seats[k % m].hole.push(draw(h));
  }

  // First to act preflop: left of the big blind (heads-up: the button/SB).
  h.toAct = nextToAct(h, bbSeat);
  if (h.toAct === null) runOutAndShowdown(g);
}

function nameOf(g: GameState, s: SeatState) {
  return playerById(g, s.playerId)?.name ?? '?';
}

/** Moves up to `amount` chips from the player's stack into the pot. Returns chips moved. */
function commit(g: GameState, s: SeatState, amount: number, isBet: boolean): number {
  const p = playerById(g, s.playerId)!;
  const amt = Math.min(amount, p.stack);
  p.stack -= amt;
  s.total += amt;
  if (isBet) s.bet += amt;
  if (p.stack === 0) s.allIn = true;
  return amt;
}

function draw(h: HandState): Card {
  if (h.deckPos >= h.deck.length) throw new Error('Deck exhausted');
  return h.deck[h.deckPos++];
}

const canAct = (s: SeatState) => !s.folded && !s.allIn;

/** Next seat after `from` (clockwise) that still needs to act on this street. */
function nextToAct(h: HandState, from: number): number | null {
  const m = h.seats.length;
  const actors = h.seats.filter(canAct).length;
  if (actors === 0) return null;
  for (let k = 1; k <= m; k++) {
    const i = (from + k) % m;
    const s = h.seats[i];
    if (!canAct(s)) continue;
    // A lone player with chips only acts if facing a real wager.
    if (actors === 1 ? s.bet < callTarget(h, i) : !s.hasActed || s.bet < h.currentBet) return i;
  }
  return null;
}

/** Return the unmatched part of the largest bet on this street to its owner. */
function returnUncalled(g: GameState) {
  const h = g.hand!;
  let top = -1;
  let first = 0;
  let second = 0;
  h.seats.forEach((s, i) => {
    if (s.bet > first) {
      second = first;
      first = s.bet;
      top = i;
    } else if (s.bet > second) second = s.bet;
  });
  const extra = first - second;
  if (top < 0 || extra <= 0) return;
  const s = h.seats[top];
  const p = playerById(g, s.playerId)!;
  s.bet -= extra;
  s.total -= extra;
  p.stack += extra;
  if (p.stack > 0) s.allIn = false;
  log(g, `Uncalled ${extra} returned to ${p.name}.`);
}

function act(g: GameState, action: Action) {
  const h = g.hand;
  if (!h || h.result || h.toAct === null) throw new Error('No action pending');
  const legal = legalActions(g)!;
  const i = h.toAct;
  const s = h.seats[i];
  const p = playerById(g, s.playerId)!;
  const prevBet = h.currentBet;

  switch (action.type) {
    case 'fold':
      s.folded = true;
      s.lastAction = 'Fold';
      log(g, `${p.name} folds.`);
      break;
    case 'check':
      if (!legal.check) throw new Error('Cannot check facing a bet');
      s.lastAction = 'Check';
      log(g, `${p.name} checks.`);
      break;
    case 'call': {
      if (!legal.call) throw new Error('Nothing to call');
      const amt = commit(g, s, legal.call, true);
      s.lastAction = s.allIn ? `Call ${amt} (all-in)` : `Call ${amt}`;
      log(g, `${p.name} calls ${amt}${s.allIn ? ' and is all-in' : ''}.`);
      break;
    }
    case 'raise':
    case 'allIn': {
      const to = action.type === 'allIn' ? s.bet + p.stack : Math.floor(action.to);
      if (action.type === 'allIn') {
        if (!legal.allIn) throw new Error('All-in not allowed');
        // An all-in that only calls (or is less than a call) is a call.
        // An all-in that cannot raise (not enough chips, or action not re-opened) is a call.
        if (to <= h.currentBet || !legal.raise) {
          const amt = commit(g, s, Math.min(p.stack, h.currentBet - s.bet), true);
          s.lastAction = s.allIn ? `Call ${amt} (all-in)` : `Call ${amt}`;
          log(g, `${p.name} calls ${amt}${s.allIn ? ' and is all-in' : ''}.`);
          break;
        }
      } else {
        if (!legal.raise) throw new Error('Raising is not allowed');
        if (to > legal.raise.max) throw new Error('Not enough chips');
        if (to < legal.raise.min) throw new Error(`Minimum ${legal.raise.isBet ? 'bet' : 'raise to'} is ${legal.raise.min}`);
      }
      const increment = to - h.currentBet;
      commit(g, s, to - s.bet, true);
      const word = h.currentBet === 0 ? 'bets' : 'raises to';
      if (increment >= h.minRaise) {
        h.minRaise = increment; // full bet/raise: sets new minimum and re-opens action
      }
      h.currentBet = to;
      s.lastAction = `${prevBet === 0 ? 'Bet' : 'Raise to'} ${to}${s.allIn ? ' (all-in)' : ''}`;
      log(g, `${p.name} ${word} ${to}${s.allIn ? ' and is all-in' : ''}.`);
      break;
    }
  }
  s.hasActed = true;
  s.betFacedWhenActed = h.currentBet;

  // Hand over if only one player hasn't folded.
  const live = h.seats.filter((x) => !x.folded);
  if (live.length === 1) {
    finishUncontested(g, live[0]);
    return;
  }

  const next = nextToAct(h, i);
  if (next !== null) {
    h.toAct = next;
    return;
  }
  // Street complete.
  advanceStreet(g);
}

function advanceStreet(g: GameState) {
  const h = g.hand!;
  for (;;) {
    returnUncalled(g);
    for (const s of h.seats) {
      s.bet = 0;
      s.hasActed = false;
      s.betFacedWhenActed = 0;
      if (!s.folded && !s.allIn) s.lastAction = null;
    }
    h.currentBet = 0;
    h.minRaise = g.settings.bigBlind;
    h.toAct = null;

    if (h.street === 'river') {
      showdown(g);
      return;
    }
    h.burned.push(draw(h));
    if (h.street === 'preflop') {
      h.board.push(draw(h), draw(h), draw(h));
      h.street = 'flop';
    } else if (h.street === 'flop') {
      h.board.push(draw(h));
      h.street = 'turn';
    } else {
      h.board.push(draw(h));
      h.street = 'river';
    }
    log(g, `${h.street[0].toUpperCase() + h.street.slice(1)}: ${h.board.map(cardLabel).join(' ')}`);

    // First to act postflop: first live seat left of the button.
    const next = nextToAct(h, h.buttonSeat);
    if (next !== null) {
      h.toAct = next;
      return;
    }
    // Nobody can bet (all-in) — keep dealing.
  }
}

function runOutAndShowdown(g: GameState) {
  advanceStreet(g);
}

function seatOrderFromButton(h: HandState): number[] {
  // Clockwise starting left of the button: 1, 2, ..., 0
  const m = h.seats.length;
  return Array.from({ length: m }, (_, k) => (h.buttonSeat + 1 + k) % m);
}

function finishUncontested(g: GameState, winner: SeatState) {
  const h = g.hand!;
  returnUncalled(g);
  const total = h.seats.reduce((a, s) => a + s.total, 0);
  const p = playerById(g, winner.playerId)!;
  p.stack += total;
  h.toAct = null;
  h.result = {
    pots: [{ amount: total, eligible: [winner.playerId], winners: [winner.playerId], returned: false }],
    hands: {},
    payouts: { [winner.playerId]: total },
    uncontested: true,
  };
  log(g, `${p.name} wins ${total} uncontested.`);
}

function showdown(g: GameState) {
  const h = g.hand!;
  h.street = 'showdown';
  h.toAct = null;
  const hands: Record<string, HandValue> = {};
  for (const s of h.seats) if (!s.folded) hands[s.playerId] = evaluate([...s.hole, ...h.board]);

  const pots = buildPots(h.seats.map((s, i) => ({ seat: i, amount: s.total, folded: s.folded })));
  const order = seatOrderFromButton(h);
  const payouts: Record<string, number> = {};
  const potResults: PotResult[] = [];

  for (const pot of pots) {
    let best = -1;
    for (const i of pot.eligible) best = Math.max(best, hands[h.seats[i].playerId].score);
    const winners = order.filter((i) => pot.eligible.includes(i) && hands[h.seats[i].playerId].score === best);
    const split = splitPot(pot.amount, winners);
    for (const [i, amt] of split) {
      const id = h.seats[i].playerId;
      payouts[id] = (payouts[id] ?? 0) + amt;
      playerById(g, id)!.stack += amt;
    }
    potResults.push({
      amount: pot.amount,
      eligible: pot.eligible.map((i) => h.seats[i].playerId),
      winners: winners.map((i) => h.seats[i].playerId),
      returned: pot.eligible.length === 1,
    });
  }

  h.result = { pots: potResults, hands, payouts, uncontested: false };
  for (const s of h.seats) {
    if (s.folded) continue;
    log(g, `${nameOf(g, s)} shows ${s.hole.map(cardLabel).join(' ')} — ${hands[s.playerId].description}.`);
  }
  potResults.forEach((pr, idx) => {
    const names = pr.winners.map((id) => playerById(g, id)!.name).join(' & ');
    if (pr.returned) log(g, `Uncalled ${pr.amount} returned to ${names}.`);
    else log(g, `${names} ${pr.winners.length > 1 ? 'split' : 'wins'} ${idx === 0 ? 'the main pot' : `side pot ${idx}`} (${pr.amount}).`);
  });
}

function abortHand(g: GameState) {
  const h = g.hand;
  if (!h) return;
  if (!h.result) {
    // Refund every contribution.
    for (const s of h.seats) {
      const p = playerById(g, s.playerId);
      if (p) p.stack += s.total;
    }
    log(g, `Hand #${h.number} cancelled; all bets refunded.`);
  }
  g.hand = null;
}

/** Sum of all chips on the table: stacks + current hand contributions. Useful invariant. */
export function totalChips(g: GameState): number {
  return g.players.reduce((a, p) => a + p.stack, 0) + (g.hand ? potTotal(g.hand) : 0);
}

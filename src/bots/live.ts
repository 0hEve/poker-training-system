import { legalActions, playerById, type Action, type GameState } from '../engine/game';
import type { BotView, Decision, HandSummary, Street } from './types';

/**
 * Bridges the live table (engine/game.ts) and the bot API, so the same bots that
 * run in the simulator can take seats at the table.
 */

const STREET: Record<string, Street> = { preflop: 0, flop: 1, turn: 2, river: 3, showdown: 3 };

/** View for the player to act, or null when no action is pending. */
export function viewForToAct(g: GameState): BotView | null {
  const h = g.hand;
  const legal = legalActions(g);
  if (!h || !legal || h.toAct === null) return null;
  const seat = h.toAct;
  const stacks = h.seats.map((s) => playerById(g, s.playerId)?.stack ?? 0);
  return {
    handId: h.number,
    numSeats: h.seats.length,
    seat,
    sbSeat: h.sbSeat,
    bbSeat: h.bbSeat,
    smallBlind: g.settings.smallBlind,
    bigBlind: g.settings.bigBlind,
    ante: g.settings.ante,
    playerIds: h.seats.map((s) => s.playerId),
    street: STREET[h.street],
    hole: h.seats[seat].hole,
    board: h.board,
    stacks,
    startStacks: h.seats.map((s, i) => stacks[i] + s.total),
    bets: h.seats.map((s) => s.bet),
    committed: h.seats.map((s) => s.total),
    folded: h.seats.map((s) => s.folded),
    allIn: h.seats.map((s) => s.allIn),
    pot: h.seats.reduce((a, s) => a + s.total, 0),
    currentBet: h.currentBet,
    toCall: legal.call,
    canRaise: !!legal.raise,
    minRaiseTo: legal.raise?.min ?? 0,
    maxRaiseTo: legal.raise?.max ?? 0,
    actions: h.actions ?? [],
  };
}

/** Turn a bot decision into an action the engine accepts (illegal choices are corrected). */
export function toEngineAction(g: GameState, d: Decision | undefined): Action {
  const legal = legalActions(g);
  if (!legal) throw new Error('No action pending');
  const passive: Action = legal.check ? { type: 'check' } : { type: 'fold' };
  switch (d?.type) {
    case 'fold':
      return { type: 'fold' };
    case 'check':
      return passive;
    case 'call':
      return legal.call > 0 ? { type: 'call' } : passive;
    case 'raise': {
      if (!legal.raise) return legal.call > 0 ? { type: 'call' } : passive;
      const to = Math.max(legal.raise.min, Math.min(legal.raise.max, Math.floor(Number(d.to) || 0)));
      return to === legal.raise.max ? { type: 'allIn' } : { type: 'raise', to };
    }
    case 'allIn':
      return legal.allIn ? { type: 'allIn' } : passive;
    default:
      return passive;
  }
}

/** Summary of a finished hand from `seat`'s point of view (for `PokerBot.handEnd`). */
export function summaryForSeat(g: GameState, seat: number): HandSummary | null {
  const h = g.hand;
  if (!h?.result) return null;
  const net = h.seats.map((s) => (h.result!.payouts[s.playerId] ?? 0) - s.total);
  const showdown = !h.result.uncontested;
  return {
    handId: h.number,
    numSeats: h.seats.length,
    seat,
    playerIds: h.seats.map((s) => s.playerId),
    bigBlind: g.settings.bigBlind,
    startStacks: h.seats.map((s) => (playerById(g, s.playerId)?.stack ?? 0) - (h.result!.payouts[s.playerId] ?? 0) + s.total),
    board: h.board,
    actions: h.actions ?? [],
    shown: h.seats.map((s) => (showdown && !s.folded ? s.hole : null)),
    net,
    showdown,
  };
}

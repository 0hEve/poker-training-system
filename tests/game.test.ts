import { describe, expect, it } from 'vitest';
import { parseCards, type Card } from '../src/engine/cards';
import { createGame, reduce, legalActions, totalChips, type GameState, type Action } from '../src/engine/game';

/** Build a deck where the given cards come first (in dealing order) and the rest follow. */
function stacked(first: string): Card[] {
  const f = parseCards(first);
  return [...f, ...Array.from({ length: 52 }, (_, i) => i).filter((c) => !f.includes(c))];
}

const act = (g: GameState, a: Action) => reduce(g, { type: 'act', action: a });
const toActName = (g: GameState) => g.players.find((p) => p.id === g.hand!.seats[g.hand!.toAct!].playerId)!.name;

describe('game flow', () => {
  it('posts blinds and orders action for 4 players', () => {
    let g = createGame(['A', 'B', 'C', 'D']);
    g = reduce(g, { type: 'startHand' });
    const h = g.hand!;
    expect(g.players.map((p) => p.stack)).toEqual([1000, 995, 990, 1000]);
    expect(toActName(g)).toBe('D'); // UTG
    expect(h.seats.every((s) => s.hole.length === 2)).toBe(true);
    // Everyone calls, BB has option.
    g = act(g, { type: 'call' });
    g = act(g, { type: 'call' });
    g = act(g, { type: 'call' });
    expect(toActName(g)).toBe('C');
    expect(legalActions(g)!.check).toBe(true);
    expect(legalActions(g)!.raise).not.toBeNull();
    g = act(g, { type: 'check' });
    expect(g.hand!.street).toBe('flop');
    expect(g.hand!.board).toHaveLength(3);
    expect(toActName(g)).toBe('B'); // first left of button
    expect(totalChips(g)).toBe(4000);
  });

  it('heads-up: button posts SB and acts first preflop, last postflop', () => {
    let g = createGame(['A', 'B']);
    g = reduce(g, { type: 'startHand' });
    expect(g.players.map((p) => p.stack)).toEqual([995, 990]);
    expect(toActName(g)).toBe('A');
    g = act(g, { type: 'call' });
    expect(toActName(g)).toBe('B');
    g = act(g, { type: 'check' });
    expect(g.hand!.street).toBe('flop');
    expect(toActName(g)).toBe('B');
  });

  it('button moves each hand', () => {
    let g = createGame(['A', 'B', 'C']);
    g = reduce(g, { type: 'startHand' });
    expect(g.buttonPlayerId).toBe(g.players[0].id);
    g = act(g, { type: 'fold' });
    g = act(g, { type: 'fold' });
    expect(g.hand!.result!.uncontested).toBe(true);
    expect(g.players.map((p) => p.stack)).toEqual([1000, 995, 1005]);
    g = reduce(g, { type: 'startHand' });
    expect(g.buttonPlayerId).toBe(g.players[1].id);
  });

  it('enforces min-raise and incomplete all-in does not reopen', () => {
    let g = createGame(['A', 'B', 'C']);
    g.players[2].stack = 1000;
    g = reduce(g, { type: 'startHand' });
    // A (button) to act. raise to 30 (increment 20 over BB=10).
    expect(() => act(g, { type: 'raise', to: 15 })).toThrow();
    g = act(g, { type: 'raise', to: 30 });
    expect(legalActions(g)!.raise!.min).toBe(50);
    // B (SB) folds, C (BB) calls -> flop
    g = act(g, { type: 'fold' });
    g = act(g, { type: 'call' });
    expect(g.hand!.street).toBe('flop');
    // Postflop: C first. C bets 100, A calls... set up a short all-in instead:
    g = act(g, { type: 'raise', to: 100 }); // C bets 100
    g = act(g, { type: 'call' }); // A calls
    expect(g.hand!.street).toBe('turn');
  });

  it('short all-in raise does not reopen betting for a player who already acted', () => {
    let g = createGame(['A', 'B', 'C']);
    g = reduce(g, { type: 'setStack', id: g.players[1].id, stack: 125 }); // B short
    g = reduce(g, { type: 'startHand' });
    // A raises to 100 (full raise of 90).
    g = act(g, { type: 'raise', to: 100 });
    // B (SB, 120 behind after posting 5) goes all-in to 125 total: increment 25 < 90 -> incomplete.
    g = act(g, { type: 'allIn' });
    expect(g.hand!.currentBet).toBe(125);
    // C (BB) has not acted: may raise.
    expect(legalActions(g)!.raise).not.toBeNull();
    g = act(g, { type: 'call' });
    // Back to A: facing only 25 more (< 90), may call or fold but not raise.
    expect(toActName(g)).toBe('A');
    const la = legalActions(g)!;
    expect(la.raise).toBeNull();
    expect(la.call).toBe(25);
  });

  it('side pots at showdown with all-ins', () => {
    // 3 players; deal order starts left of button: B, C, A, B, C, A
    // B: Ah Ad, C: Kh Kd, A: 2c 7d ; burn, flop 3s 8h 9c, burn, turn Jd, burn, river 4s
    const deck = stacked('Ah Kh 2c Ad Kd 7d 5c 3s 8h 9c 6c Jd 6d 4s');
    let g = createGame(['A', 'B', 'C']);
    g = reduce(g, { type: 'setStack', id: g.players[1].id, stack: 100 });
    g = reduce(g, { type: 'setStack', id: g.players[2].id, stack: 300 });
    g = reduce(g, { type: 'startHand', deck });
    g = act(g, { type: 'raise', to: 500 }); // A
    g = act(g, { type: 'allIn' }); // B 100
    g = act(g, { type: 'allIn' }); // C 300
    const r = g.hand!.result!;
    expect(r).not.toBeNull();
    expect(g.hand!.board).toHaveLength(5);
    const [A, B, C] = g.players;
    // Main 300 -> B (aces), side 400 (A,C) -> C (kings), uncalled 200 back to A.
    expect(B.stack).toBe(300);
    expect(C.stack).toBe(400);
    expect(A.stack).toBe(1000 - 300);
    // The uncalled 200 is refunded when betting closes, before pots are built.
    expect(r.pots.map((p) => p.amount)).toEqual([300, 400]);
    expect(g.log.some((l) => l.includes('Uncalled 200 returned to A'))).toBe(true);
    expect(totalChips(g)).toBe(1400);
  });

  it('split pot with odd chip goes left of button', () => {
    // Board plays: royal flush on board. 3 players, SB=5 BB=10, A folds -> B,C split 20.
    const deck = stacked('2c 3c 4c 2d 3d 4d 5c Ts Js Qs 6c Ks 7c As');
    let g = createGame(['A', 'B', 'C'], { smallBlind: 5, bigBlind: 10, ante: 1 });
    g = reduce(g, { type: 'startHand', deck });
    g = act(g, { type: 'fold' }); // A
    g = act(g, { type: 'call' }); // B
    g = act(g, { type: 'check' }); // C
    for (let i = 0; i < 3; i++) {
      g = act(g, { type: 'check' });
      g = act(g, { type: 'check' });
    }
    const r = g.hand!.result!;
    expect(r.pots[0].amount).toBe(23); // 3 antes + 10 + 10
    expect(r.payouts[g.players[1].id]).toBe(12);
    expect(r.payouts[g.players[2].id]).toBe(11);
    expect(totalChips(g)).toBe(3000);
  });

  it('short all-in big blind need not be called in full by the last player with chips', () => {
    let g = createGame(['A', 'B']);
    g = reduce(g, { type: 'setStack', id: g.players[1].id, stack: 3 });
    g = reduce(g, { type: 'startHand' });
    // A (button/SB) posted 5, B (BB) is all-in for 3: no action needed, run it out.
    expect(g.hand!.result).not.toBeNull();
    expect(g.hand!.board).toHaveLength(5);
    expect(totalChips(g)).toBe(1003);
  });

  it('blinds cannot change mid-hand but starting stack can', () => {
    let g = createGame(['A', 'B']);
    g = reduce(g, { type: 'startHand' });
    expect(() => reduce(g, { type: 'updateSettings', settings: { bigBlind: 50 } })).toThrow();
    g = reduce(g, { type: 'updateSettings', settings: { startingStack: 2000 } });
    expect(g.settings.startingStack).toBe(2000);
  });

  it('reset chips restores starting stacks and cancels the hand', () => {
    let g = createGame(['A', 'B']);
    g = reduce(g, { type: 'startHand' });
    g = reduce(g, { type: 'resetChips' });
    expect(g.hand).toBeNull();
    expect(g.players.every((p) => p.stack === 1000)).toBe(true);
  });

  it('abort refunds contributions', () => {
    let g = createGame(['A', 'B', 'C']);
    g = reduce(g, { type: 'startHand' });
    g = act(g, { type: 'raise', to: 40 });
    g = reduce(g, { type: 'abortHand' });
    expect(g.players.map((p) => p.stack)).toEqual([1000, 1000, 1000]);
  });

  it('random hands conserve chips', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let g = createGame(['A', 'B', 'C', 'D', 'E', 'F']);
    for (let hand = 0; hand < 300; hand++) {
      if (g.players.filter((p) => p.stack > 0).length < 2) g = reduce(g, { type: 'resetChips' });
      g = reduce(g, { type: 'startHand' });
      let guard = 0;
      while (!g.hand!.result && guard++ < 200) {
        const la = legalActions(g)!;
        const x = rnd();
        let a: Action;
        if (x < 0.15) a = { type: 'fold' };
        else if (x < 0.3 && la.allIn) a = { type: 'allIn' };
        else if (x < 0.5 && la.raise) a = { type: 'raise', to: la.raise.min + Math.floor(rnd() * (la.raise.max - la.raise.min)) };
        else a = la.check ? { type: 'check' } : { type: 'call' };
        g = act(g, a);
        expect(totalChips(g)).toBe(6000);
      }
      expect(g.hand!.result).not.toBeNull();
      expect(g.players.every((p) => p.stack >= 0 && Number.isInteger(p.stack))).toBe(true);
    }
  });
});

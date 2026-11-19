import { describe, expect, it } from 'vitest';
import { createGame, reduce, type GameState } from '../src/engine/game';
import { getBenchmarkBot as getBot } from '../src/bots/builtin';
import { summaryForSeat, toEngineAction, viewForToAct } from '../src/bots/live';
import { FastTable } from '../src/sim/table';
import { rngFor, shuffleDeck } from '../src/sim/rng';

/**
 * Playing against bots at the live table must follow the same rules (and give the bots
 * the same information) as the simulator. Seat 0 stands in for the human.
 */
describe('human vs bots at the live table', () => {
  for (const opp of ['opus', 'gpt']) {
    it(`${opp}: same decisions as the simulator, button rotates, human not always first`, () => {
      const kinds = ['tag', opp, opp, opp, opp, opp];
      let g: GameState = createGame(['You', 'B1', 'B2', 'B3', 'B4', 'B5']);
      const live = new Map(g.players.map((p, i) => [p.id, getBot(kinds[i]).create({ seed: 50 + i, playerId: p.id })]));
      const sim = new Map(g.players.map((p, i) => [p.id, getBot(kinds[i]).create({ seed: 50 + i, playerId: p.id })]));
      const table = new FastTable({ smallBlind: 5, bigBlind: 10, ante: 0 });
      const deck = new Int8Array(52);
      const you = g.players[0].id;
      const HANDS = 300;
      const seatCount = new Array(6).fill(0);
      let youFirstPreflop = 0;
      let botsOpened = 0;
      for (let n = 0; n < HANDS; n++) {
        for (const p of g.players) if (p.stack < 200) p.stack = 1000;
        shuffleDeck(deck, rngFor(9, n));
        const start = new Map(g.players.map((p) => [p.id, p.stack]));
        g = reduce(g, { type: 'startHand', deck: Array.from(deck) });
        const ids = g.hand!.seats.map((s) => s.playerId);
        table.playHand(ids.map((id) => sim.get(id)!), ids, ids.map((id) => start.get(id)!), deck, g.hand!.number);
        const simActions = table.handActions.map((a) => ({ ...a }));
        while (!g.hand!.result) {
          const v = viewForToAct(g)!;
          g = reduce(g, { type: 'act', action: toEngineAction(g, live.get(v.playerIds[v.seat])!.decide(v)) });
        }
        const h = g.hand!;
        expect(h.actions).toEqual(simActions);
        h.seats.forEach((s, i) => live.get(s.playerId)!.handEnd?.(summaryForSeat(g, i)!));
        const seat = h.seats.findIndex((s) => s.playerId === you);
        seatCount[seat]++;
        const acts = h.actions!.filter((a) => a.kind !== 'post');
        if (acts[0].seat === seat) {
          youFirstPreflop++;
          expect(seat).toBe(3); // first to act preflop = UTG, left of the big blind
        }
        const open = acts.find((a) => a.kind === 'raise' || a.kind === 'bet');
        if (open && open.seat !== seat) botsOpened++;
      }
      expect(seatCount).toEqual(new Array(6).fill(HANDS / 6)); // the button moves every hand
      expect(youFirstPreflop).toBe(HANDS / 6);
      expect(botsOpened).toBeGreaterThan(HANDS / 2);
    });
  }
});

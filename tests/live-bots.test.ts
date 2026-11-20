import { describe, expect, it } from 'vitest';
import { createGame, reduce, totalChips } from '../src/engine/game';
import { getBenchmarkBot as getBot } from '../src/bots/builtin';
import { summaryForSeat, toEngineAction, viewForToAct } from '../src/bots/live';

describe('bots at the live table', () => {
  it('play 400 hands through the reducer without errors and with correct summaries', () => {
    let g = createGame(['A', 'B', 'C', 'D', 'E']);
    const ids = ['tag', 'random', 'station', 'tag', 'random'];
    ids.forEach((bot, i) => (g = reduce(g, { type: 'setBot', id: g.players[i].id, bot })));
    const bots = new Map(g.players.map((p, i) => [p.id, getBot(p.bot!).create({ seed: i + 1, playerId: p.id })]));
    const chips = totalChips(g);
    let hands = 0;
    while (hands < 400 && g.players.filter((p) => p.stack > 0).length >= 2) {
      const before = new Map(g.players.map((p) => [p.id, p.stack]));
      g = reduce(g, { type: 'startHand' });
      for (let guard = 0; !g.hand!.result; guard++) {
        expect(guard).toBeLessThan(200);
        const v = viewForToAct(g)!;
        const bot = bots.get(v.playerIds[v.seat])!;
        g = reduce(g, { type: 'act', action: toEngineAction(g, bot.decide(v)) });
      }
      const h = g.hand!;
      // Short stacks can be all-in from the blinds, with no decision to record.
      expect(h.actions!.length).toBeGreaterThanOrEqual(2);
      h.seats.forEach((s, i) => {
        const sum = summaryForSeat(g, i)!;
        const p = g.players.find((x) => x.id === s.playerId)!;
        expect(sum.net[i]).toBe(p.stack - before.get(p.id)!);
        expect(sum.startStacks[i]).toBe(before.get(p.id));
        bots.get(s.playerId)!.handEnd?.(sum);
      });
      expect(totalChips(g)).toBe(chips);
      hands++;
    }
    expect(hands).toBeGreaterThan(20);
  });
});

import { describe, expect, it } from 'vitest';
import { createGame, reduce, type GameState } from '../src/engine/game';
import type { BotView, Decision, PokerBot } from '../src/bots/types';
import { FastTable } from '../src/sim/table';
import { rngFor, shuffleDeck } from '../src/sim/rng';
import { runMatch, splitHands, mergeResults, summarize } from '../src/sim/match';
import { getBot } from '../src/bots/registry';

/** Random bot that likes all-ins and odd raise sizes to hit edge cases. */
function chaos(rnd: () => number): PokerBot {
  return {
    decide(v: BotView): Decision {
      const x = rnd();
      if (x < 0.15) return { type: 'fold' };
      if (x < 0.25) return { type: 'allIn' };
      if (x < 0.45 && v.canRaise) return { type: 'raise', to: v.minRaiseTo + Math.floor(rnd() * (v.maxRaiseTo - v.minRaiseTo + 1)) };
      if (x < 0.5) return { type: 'check' }; // sometimes illegal -> fold
      return { type: 'call' };
    },
  };
}

describe('FastTable matches the reference engine', () => {
  it('replays 3000 random hands with identical final stacks', () => {
    const rnd = rngFor(7, 0);
    const deck = new Int8Array(52);
    for (let hand = 0; hand < 3000; hand++) {
      const n = 2 + Math.floor(rnd() * 9);
      const sb = 1 + Math.floor(rnd() * 5);
      const bb = sb * 2;
      const ante = rnd() < 0.3 ? Math.floor(rnd() * 3) : 0;
      const stacks = Array.from({ length: n }, () => (rnd() < 0.3 ? 1 + Math.floor(rnd() * 30) : 50 + Math.floor(rnd() * 2000)));
      shuffleDeck(deck, rnd);
      const bots = Array.from({ length: n }, () => chaos(rnd));
      const table = new FastTable({ smallBlind: sb, bigBlind: bb, ante });
      table.recordDecisions = true;
      table.timeBots = false;
      const ids = stacks.map((_, i) => `p${i}`);
      const net = table.playHand(bots, ids, stacks, deck, hand);

      let g: GameState = createGame(ids, { smallBlind: sb, bigBlind: bb, ante });
      g.players.forEach((p, i) => (p.stack = stacks[i]));
      g = reduce(g, { type: 'startHand', deck: Array.from(deck) });
      for (const d of table.applied) g = reduce(g, { type: 'act', action: d });
      expect(g.hand!.result, `hand ${hand} unfinished`).not.toBeNull();
      expect(g.players.map((p, i) => p.stack - stacks[i])).toEqual(net.slice());
      expect(net.reduce((a, b) => a + b, 0)).toBe(0);
    }
  });
});

describe('match runner', () => {
  it('is zero-sum and deterministic, and merges worker chunks', () => {
    const cfg = { seats: ['tag', 'station', 'tag', 'station', 'tag', 'station'], hands: 400, seed: 3 };
    const whole = runMatch(cfg, getBot);
    expect(runMatch(cfg, getBot).deck.sum).toBe(whole.deck.sum);
    expect(whole.totals.tag.net + whole.totals.station.net).toBe(0);
    // Stateless, deterministic bots give identical results however the hands are split.
    const plain = { ...cfg, seats: ['station', 'random', 'station', 'random'], duplicate: false };
    const ref = runMatch({ ...plain, seats: ['station', 'station', 'station', 'station'] }, getBot);
    const parts = splitHands(400, 3).map((p) => runMatch({ ...plain, seats: ['station', 'station', 'station', 'station'], ...p }, getBot));
    const merged = mergeResults(parts);
    expect(merged.hands).toBe(400);
    expect(merged.totals.station.seatHands).toBe(ref.totals.station.seatHands);
    expect(whole.tables).toBe(2);
    const rep = summarize(whole);
    expect(rep[0].bb100).toBeCloseTo(-rep[1].bb100, 6);
  });
});

describe('hand summaries', () => {
  it('keep their player ids after the caller reuses its array', () => {
    const kept: { ids: readonly string[]; seat: number }[] = [];
    const bot: PokerBot = { decide: (v) => (v.toCall ? { type: 'fold' } : { type: 'check' }), handEnd: (s) => kept.push({ ids: s.playerIds, seat: s.seat }) };
    const table = new FastTable({ smallBlind: 5, bigBlind: 10, ante: 0 });
    const deck = new Int8Array(52);
    shuffleDeck(deck, rngFor(1, 1));
    const ids = ['a', 'b'];
    table.playHand([bot, bot], ids, [1000, 1000], deck, 0);
    ids[0] = 'b';
    ids[1] = 'a';
    table.playHand([bot, bot], ids, [1000, 1000], deck, 1);
    expect(kept[0].ids).toEqual(['a', 'b']);
  });
});

import { describe, expect, it } from 'vitest';
import { getBot } from '../src/bots/registry';
import { BankrollSession } from '../src/sim/bankroll';

describe('bankroll session', () => {
  it('carries stacks over, conserves chips and removes busted players', () => {
    const s = new BankrollSession({ players: ['random', 'station', 'tag', 'random'], stack: 300, smallBlind: 5, bigBlind: 10, seed: 3, rebuy: false, maxHands: Infinity }, getBot);
    let guard = 0;
    while (!s.done && guard++ < 20000) {
      s.play(1);
      const snap = s.snapshot();
      expect(snap.players.reduce((a, p) => a + p.stack, 0)).toBe(1200);
      for (const p of snap.players) expect(p.net).toBe(p.stack - 300);
    }
    const end = s.snapshot();
    expect(end.done).toBe(true);
    expect(end.players.filter((p) => p.stack > 0)).toHaveLength(1);
    for (const p of end.players) if (p.stack === 0) expect(p.bustedAt).toBeGreaterThan(0);
  });

  it('rebuys busted players and stops at the hand limit', () => {
    const s = new BankrollSession({ players: ['station', 'random', 'tag'], stack: 100, smallBlind: 5, bigBlind: 10, seed: 1, rebuy: true, maxHands: 2000 }, getBot);
    s.play(5000);
    const snap = s.snapshot();
    expect(snap.hand).toBe(2000);
    expect(snap.done).toBe(true);
    const rebuys = snap.players.reduce((a, p) => a + p.rebuys, 0);
    expect(rebuys).toBeGreaterThan(0);
    expect(snap.players.reduce((a, p) => a + p.stack, 0)).toBe(300 + rebuys * 100);
    for (const p of snap.players) expect(p.net).toBe(p.stack - 100 - p.rebuys * 100);
  });
});

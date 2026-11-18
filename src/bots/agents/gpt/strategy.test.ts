import { describe, expect, it } from 'vitest';
import type { BotView } from '../../types';
import { rngFor } from '../../../sim/rng';
import { CLASS, CLASSES } from './cards';
import { BLINDS_BASE64, EQUITY_BASE64, EQUITY_COLUMNS, MAX_DEPTH, MIN_DEPTH } from './equity-data';
import { History, BET_CALLED_RAISE } from './history';
import { Profile } from './model';
import { Ranges } from './ranges';
import { createGpt } from './index';

const model = new Array<Profile>(3).fill(new Profile());

function view(overrides: Partial<BotView>): BotView {
  return {
    handId: 1, numSeats: 3, seat: 0, sbSeat: 1, bbSeat: 2, smallBlind: 5, bigBlind: 10, ante: 0,
    playerIds: ['A', 'B', 'C'], street: 3, hole: [0, 7], board: [32, 36, 40, 44, 48],
    stacks: [100, 0, 0], startStacks: [400, 500, 100], bets: [200, 300, 0], committed: [300, 500, 100],
    folded: [false, false, false], allIn: [false, true, true], pot: 900, currentBet: 300, toCall: 100,
    canRaise: false, minRaiseTo: 0, maxRaiseTo: 0, actions: [],
    ...overrides,
  };
}

describe('GPT strategy', () => {
  it('uses all physical combos and ships correctly sized tables', () => {
    expect(CLASS.length).toBe(1326);
    expect(CLASSES.map((combos) => combos.length).filter((size) => size === 4)).toHaveLength(78);
    expect(CLASSES.map((combos) => combos.length).filter((size) => size === 6)).toHaveLength(13);
    expect(CLASSES.map((combos) => combos.length).filter((size) => size === 12)).toHaveLength(78);
    expect(atob(EQUITY_BASE64)).toHaveLength(169 * EQUITY_COLUMNS * 2);
    expect(atob(BLINDS_BASE64)).toHaveLength(169 * 2 * (MAX_DEPTH - MIN_DEPTH + 1));
  });

  it('prices all-in board chops using collectible side pots', () => {
    const current = view({});
    const h = new History();
    h.read(current);
    const r = new Ranges();
    r.read(current, h, model, rngFor(1, 1));
    // Main pot: 300 / 3. Side pot: 600 / 2. The other 100 is uncalled.
    expect(r.sideShare).toBeCloseTo(400 / 900, 12);
    expect(createGpt(1).decide(current)).toEqual({ type: 'call' });
  });

  it('keeps multi-action street evidence and reuses only compatible board prefixes', () => {
    const current = view({
      street: 1, board: [3, 19, 45], hole: [24, 25],
      stacks: [900, 900, 900], startStacks: [1000, 1000, 1000], allIn: [false, false, false],
      actions: [
        { seat: 1, street: 1, kind: 'bet', amount: 20, allIn: false },
        { seat: 2, street: 1, kind: 'raise', amount: 80, allIn: false },
        { seat: 1, street: 1, kind: 'call', amount: 60, allIn: false },
      ],
    });
    const h = new History();
    h.read(current);
    expect(h.line[11]).toBe(BET_CALLED_RAISE);
    const reused = new Ranges();
    reused.read(current, h, model, rngFor(1, 2));
    for (const board of [[3, 19, 45, 21], [8, 18, 48, 21], [8, 18, 48, 21, 4]]) {
      current.board = board;
      current.street = board.length === 4 ? 2 : 3;
      h.read(current);
      const fresh = new Ranges();
      reused.read(current, h, model, rngFor(1, 3));
      fresh.read(current, h, model, rngFor(1, 3));
      expect(reused.share).toBe(fresh.share);
      expect(reused.hist).toEqual(fresh.hist);
    }
  });

  it('recognizes a straight improvement on a wheel board', () => {
    const current = view({ hole: [16, 32], board: [48, 1, 6, 11, 13] });
    const h = new History();
    h.read(current);
    const r = new Ranges();
    r.read(current, h, model, rngFor(1, 4));
    expect(r.heroTier).toBe(9);
  });
});

import { describe, expect, it } from 'vitest';
import { buildPots, splitPot } from '../src/engine/pots';

describe('pots', () => {
  it('builds main and side pots with dead money', () => {
    const pots = buildPots([
      { seat: 0, amount: 100, folded: false }, // all-in short
      { seat: 1, amount: 300, folded: false },
      { seat: 2, amount: 300, folded: false },
      { seat: 3, amount: 50, folded: true },
    ]);
    expect(pots).toEqual([
      { amount: 350, eligible: [0, 1, 2] },
      { amount: 400, eligible: [1, 2] },
    ]);
  });

  it('isolates uncalled excess as a single-eligible pot', () => {
    const pots = buildPots([
      { seat: 0, amount: 500, folded: false },
      { seat: 1, amount: 200, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 400, eligible: [0, 1] },
      { amount: 300, eligible: [0] },
    ]);
  });

  it('splits with odd chips to first winner', () => {
    expect([...splitPot(101, [2, 0])]).toEqual([[2, 51], [0, 50]]);
    expect([...splitPot(100, [1, 2, 3])]).toEqual([[1, 34], [2, 33], [3, 33]]);
  });
});

import { describe, expect, it } from 'vitest';
import hands from './fixtures/eval7-hands.json';
import { evaluate7 } from '../src/bots/agents/foldilocks/eval7';

describe('eval7-compatible evaluator', () => {
  it('matches eval7.evaluate on 20,000 random 5-7 card hands and every hand class', () => {
    const bad = (hands as [number[], number[], number][]).filter(([r, s, v]) => evaluate7(r, s) !== v);
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

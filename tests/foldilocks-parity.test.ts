import { describe, expect, it } from 'vitest';
import cases from './fixtures/foldilocks-parity.json';
import { encodeStateDict, type FhState } from '../src/bots/agents/foldilocks/features';
import { maskedStrategy, networkPath, pushFold, strategy } from '../src/bots/agents/foldilocks';

/**
 * The TypeScript Foldilocks against the original Python (external/fullhouse-bot) on 907 engine
 * states recorded from real matches (2, 3, 4 and 6 players, deep and short stacks). Expected values
 * come from scripts/ports/fullhouse_expected.py.
 */
type Case = { state: FhState; features: number[]; legal: boolean[]; strategy: number[] | null; pushFold: unknown };
const all = cases as unknown as Case[];

describe('Foldilocks TypeScript port = Python original', () => {
  it('encodes the same 51 features and legal mask', () => {
    let worst = 0;
    for (const c of all) {
      const { features, legal } = encodeStateDict(c.state);
      expect(legal).toEqual(c.legal);
      for (let i = 0; i < 51; i++) worst = Math.max(worst, Math.abs(features[i] - c.features[i]));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('produces the same strategy from the network', () => {
    let worst = 0;
    for (const c of all) {
      const s = maskedStrategy(c.state);
      for (let i = 0; i < 5; i++) worst = Math.max(worst, Math.abs(s[i] - c.strategy![i]));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it(`uses the SIMD network here (${networkPath}) and the JavaScript fallback agrees with Python too`, () => {
    expect(networkPath).toBe('simd');
    let worst = 0;
    for (const c of all) {
      const { features, legal } = encodeStateDict(c.state);
      const js = strategy(features, legal, true);
      const simd = strategy(features, legal);
      for (let i = 0; i < 5; i++) worst = Math.max(worst, Math.abs(js[i] - simd[i]));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('makes the same push/fold chart decisions', () => {
    for (const c of all) if (c.state.street === 'preflop') expect(pushFold(c.state)).toEqual(c.pushFold);
  });
});

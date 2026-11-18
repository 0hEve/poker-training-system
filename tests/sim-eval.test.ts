import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/engine/evaluator';
import { accFrom, eval7, evalWith2 } from '../src/sim/eval';
import { rngFor, shuffleDeck } from '../src/sim/rng';

describe('fast evaluator', () => {
  it('matches the reference evaluator on random 5, 6 and 7 card hands', () => {
    const deck = new Int8Array(52);
    const rnd = rngFor(1, 1);
    for (let t = 0; t < 30000; t++) {
      shuffleDeck(deck, rnd);
      const n = 5 + (t % 3);
      const cards = Array.from(deck.slice(0, n));
      const ref = evaluate(cards).score;
      expect(eval7(cards)).toBe(ref);
      expect(evalWith2(accFrom(cards.slice(2)), cards[0], cards[1])).toBe(ref);
    }
  });

  it('handles flush, straight flush, wheel and full house edge cases', () => {
    const cases = ['As Ks Qs Js Ts 2h 3d', 'Ah 2h 3h 4h 5h Kd Kc', 'As 2d 3c 4h 5s 9d 9c', 'Ks Kd Kh 7c 7d 7s 2h', 'As Ad Ah Ac Kd Kc Ks', '2s 4s 6s 8s Ts Js Qs'];
    const RANK = '23456789TJQKA';
    const SUIT = 'shdc';
    for (const c of cases) {
      const cards = c.split(' ').map((s) => (RANK.indexOf(s[0]) << 2) | SUIT.indexOf(s[1]));
      expect(eval7(cards)).toBe(evaluate(cards).score);
    }
  });
});

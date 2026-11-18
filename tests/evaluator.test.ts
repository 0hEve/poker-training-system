import { describe, expect, it } from 'vitest';
import { parseCards, cardToString } from '../src/engine/cards';
import { evaluate, Category, straightHigh } from '../src/engine/evaluator';

const ev = (s: string) => evaluate(parseCards(s));

describe('evaluator', () => {
  it('detects categories', () => {
    expect(ev('As Ks Qs Js Ts 2d 3c').category).toBe(Category.StraightFlush);
    expect(ev('As Ks Qs Js Ts 2d 3c').description).toBe('Royal Flush');
    expect(ev('9h 9d 9s 9c Kd 2c 3h').category).toBe(Category.Quads);
    expect(ev('9h 9d 9s Kc Kd 2c 3h').category).toBe(Category.FullHouse);
    expect(ev('2h 7h 9h Jh Ah 3c 4d').category).toBe(Category.Flush);
    expect(ev('5h 6d 7s 8c 9d Kc Kh').category).toBe(Category.Straight);
    expect(ev('5h 5d 5s 8c 9d Kc 2h').category).toBe(Category.Trips);
    expect(ev('5h 5d 8s 8c 9d Kc 2h').category).toBe(Category.TwoPair);
    expect(ev('5h 5d 8s Tc 9d Kc 2h').category).toBe(Category.Pair);
    expect(ev('5h 3d 8s Tc 9d Kc 2h').category).toBe(Category.HighCard);
  });

  it('handles the wheel and steel wheel', () => {
    const wheel = ev('Ah 2d 3s 4c 5d Kc Kh');
    expect(wheel.category).toBe(Category.Straight);
    expect(wheel.bestFive.map(cardToString)).toEqual(['5d', '4c', '3s', '2d', 'Ah']);
    expect(ev('6h 2d 3s 4c 5d').score).toBeGreaterThan(wheel.score);
    expect(ev('Ad 2d 3d 4d 5d Kc Kh').category).toBe(Category.StraightFlush);
    expect(straightHigh(0b1_0000_0000_1111)).toBe(3);
    expect(straightHigh(0b1_1111_0000_0000)).toBe(12);
    expect(straightHigh(0b1_0000_0000_0111)).toBe(-1);
  });

  it('prefers the higher straight and not a wrap-around', () => {
    expect(ev('Ah 2d 3s 4c 5d 6c 7h').description).toBe('Straight, Seven high');
    expect(ev('Qh Kd As 2c 3d 8c 9h').category).toBe(Category.HighCard);
  });

  it('full house from two trips takes the best pair', () => {
    const v = ev('9h 9d 9s Kc Kd Ks 2h');
    expect(v.description).toBe('Full House, Kings over Nines');
  });

  it('compares kickers', () => {
    expect(ev('Ah Ad Kc 7s 4d 3c 2h').score).toBeGreaterThan(ev('Ah Ad Qc Js 9d 3c 2h').score);
    expect(ev('Ah Ad Kc Ks 4d 3c 2h').score).toBeGreaterThan(ev('Ah Ad Kc Ks 3d 2c 2h').score - 0); // two pair 4 kicker vs two pair + 3 kicker -> AAKK4 vs AAKK3
    expect(ev('Ah Ad Kc Ks 4d 3c 2h').score).toBeGreaterThan(ev('Ah Ad Kc Ks 3d 2c 2s').score);
  });

  it('board plays → equal scores', () => {
    const board = 'Ts Js Qs Ks As';
    expect(ev(`${board} 2h 3h`).score).toBe(ev(`${board} 4c 5c`).score);
    expect(ev('5h 5d 9c 9s Kd 2c 3h').score).toBe(ev('5c 5s 9h 9d Kh 2d 3s').score);
  });

  it('flush uses top five suited ranks', () => {
    const v = ev('2h 4h 6h 8h Th Qh 3c');
    expect(v.bestFive.map(cardToString)).toEqual(['Qh', 'Th', '8h', '6h', '4h']);
  });
});

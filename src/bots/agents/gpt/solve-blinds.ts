// Offline regret matching for anteless .5/1 blind-versus-blind push/fold.
import { addCard, evalWith2, newAcc, resetAcc } from '../../../sim/eval';
import { rngFor } from '../../../sim/rng';
import { CLASSES, FIRST, MASK_HI, MASK_LO, SECOND } from './cards';

const CLASSES_COUNT = 169;
const DEALS = 4096;
const SEED = 62341;
export const MIN_DEPTH = 2;
export const MAX_DEPTH = 11;

export function solveBlinds() {
  const size = CLASSES_COUNT * CLASSES_COUNT;
  const reach = new Float64Array(size);
  const equity = new Float64Array(size);
  const board = newAcc();
  for (let i = 0; i < CLASSES_COUNT; i++) {
    const a = FIRST[CLASSES[i][0]];
    const b = SECOND[CLASSES[i][0]];
    const heroLo = MASK_LO[a] | MASK_LO[b];
    const heroHi = MASK_HI[a] | MASK_HI[b];
    for (let j = 0; j < CLASSES_COUNT; j++) {
      const available = CLASSES[j].filter((id) => {
        const x = FIRST[id];
        const y = SECOND[id];
        return !((MASK_LO[x] | MASK_LO[y]) & heroLo) && !((MASK_HI[x] | MASK_HI[y]) & heroHi);
      });
      const index = i * CLASSES_COUNT + j;
      reach[index] = available.length / 1225;
      if (!available.length) continue;
      const rnd = rngFor(SEED, index);
      let halfWins = 0;
      for (let trial = 0; trial < DEALS; trial++) {
        const id = available[Math.floor(rnd() * available.length)];
        const x = FIRST[id];
        const y = SECOND[id];
        let lo = heroLo | MASK_LO[x] | MASK_LO[y];
        let hi = heroHi | MASK_HI[x] | MASK_HI[y];
        resetAcc(board);
        for (let k = 0; k < 5; k++) {
          let c: number;
          do c = (rnd() * 52) | 0;
          while ((lo & MASK_LO[c]) || (hi & MASK_HI[c]));
          lo |= MASK_LO[c];
          hi |= MASK_HI[c];
          addCard(board, c);
        }
        const hero = evalWith2(board, a, b);
        const opponent = evalWith2(board, x, y);
        halfWins += hero > opponent ? 2 : hero === opponent ? 1 : 0;
      }
      equity[index] = halfWins / (2 * DEALS);
    }
  }
  // The two orientations represent the same joint suit distribution.
  for (let i = 0; i < CLASSES_COUNT; i++) {
    equity[i * CLASSES_COUNT + i] = 0.5;
    for (let j = 0; j < i; j++) {
      const x = i * CLASSES_COUNT + j;
      const y = j * CLASSES_COUNT + i;
      equity[x] = (equity[x] + 1 - equity[y]) * 0.5;
      equity[y] = 1 - equity[x];
    }
  }

  const result = new Uint8Array((MAX_DEPTH - MIN_DEPTH + 1) * 2 * CLASSES_COUNT);
  const payoff = new Float64Array(size);
  const iterations = 1250;
  for (let depth = MIN_DEPTH; depth <= MAX_DEPTH; depth++) {
    const shoveRegret = new Float64Array(2 * CLASSES_COUNT);
    const callRegret = new Float64Array(2 * CLASSES_COUNT);
    const shove = new Float64Array(CLASSES_COUNT).fill(0.5);
    const call = new Float64Array(CLASSES_COUNT).fill(0.5);
    const sumShove = new Float64Array(CLASSES_COUNT);
    const sumCall = new Float64Array(CLASSES_COUNT);
    for (let i = 0; i < size; i++) payoff[i] = reach[i] * (equity[i] * 2 * depth - depth - 1);
    let mass = 0;
    for (let iter = 1; iter <= iterations; iter++) {
      const weight = iter > 180 ? iter : 0;
      mass += weight;
      for (let i = 0; i < CLASSES_COUNT; i++) {
        const row = i * CLASSES_COUNT;
        let wager = 1.5;
        for (let j = 0; j < CLASSES_COUNT; j++) wager += call[j] * payoff[row + j];
        const active = 2 * i;
        const stay = active + 1;
        shoveRegret[active] = Math.max(0, shoveRegret[active] + (1 - shove[i]) * wager);
        shoveRegret[stay] = Math.max(0, shoveRegret[stay] - shove[i] * wager);
        const den = shoveRegret[active] + shoveRegret[stay];
        shove[i] = den ? shoveRegret[active] / den : 0.5;
      }
      for (let i = 0; i < CLASSES_COUNT; i++) {
        const row = i * CLASSES_COUNT;
        let wager = 0;
        for (let j = 0; j < CLASSES_COUNT; j++) wager += shove[j] * (payoff[row + j] + 2 * reach[row + j]);
        const active = 2 * i;
        const stay = active + 1;
        callRegret[active] = Math.max(0, callRegret[active] + (1 - call[i]) * wager);
        callRegret[stay] = Math.max(0, callRegret[stay] - call[i] * wager);
        const den = callRegret[active] + callRegret[stay];
        call[i] = den ? callRegret[active] / den : 0.5;
        sumShove[i] += weight * shove[i];
        sumCall[i] += weight * call[i];
      }
    }
    const row = (depth - MIN_DEPTH) * 2 * CLASSES_COUNT;
    for (let i = 0; i < CLASSES_COUNT; i++) {
      result[row + i] = Math.round(255 * sumShove[i] / mass);
      result[row + CLASSES_COUNT + i] = Math.round(255 * sumCall[i] / mass);
    }
  }
  return result;
}

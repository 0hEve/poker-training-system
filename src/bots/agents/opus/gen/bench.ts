/// <reference types="node" />
import { computeBoardStrength } from '../strength';
import { HandTracker } from '../tracker';
import { equityVsRanges } from '../equity';
import { NCOMBO } from '../cards';
import { rngFor } from '../../../../sim/rng';

const rnd = rngFor(1, 1);
const board = [0, 17, 33, 45, 50];
const time = (label: string, reps: number, f: () => void) => {
  for (let i = 0; i < 50; i++) f();
  const t = performance.now();
  for (let i = 0; i < reps; i++) f();
  console.log(label.padEnd(30), (((performance.now() - t) * 1000) / reps).toFixed(2), 'µs');
};
time('strength flop', 2000, () => computeBoardStrength(board, 3));
time('strength river', 2000, () => computeBoardStrength(board, 5));
const tr = new HandTracker();
const w = new Float32Array(NCOMBO).fill(1);
const rr = new Float32Array(NCOMBO).map(() => rnd());
for (const n of [1, 2, 3, 5]) {
  const idx = Int16Array.from({ length: NCOMBO }, (_, k) => k);
  const opps = Array.from({ length: n }, () => ({ w, rr, idx, cnt: NCOMBO }));
  const samples = Math.max(120, Math.min(360, Math.round(700 / (n + 1))));
  time(`equity flop ${n} opp (${samples})`, 2000, () => equityVsRanges([4, 9], board.slice(0, 3), opps, samples, rnd, null));
}
void tr;

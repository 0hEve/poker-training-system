/// <reference types="node" />
import { accFrom, evalWith2 } from '../../../../sim/eval';
import { COMBO_A, COMBO_B, NCOMBO } from '../cards';
const board = [0, 17, 33, 45, 50];
const scores = new Int32Array(NCOMBO);
const keys = new Float64Array(NCOMBO);
const ints = new Int32Array(NCOMBO);
const time = (label: string, reps: number, f: () => void) => {
  for (let i = 0; i < 200; i++) f();
  const t = performance.now();
  for (let i = 0; i < reps; i++) f();
  console.log(label.padEnd(24), (((performance.now() - t) * 1000) / reps).toFixed(2), 'µs');
};
const acc = accFrom(board, 3);
time('1326 evals', 5000, () => { for (let k = 0; k < NCOMBO; k++) scores[k] = evalWith2(acc, COMBO_A[k], COMBO_B[k]); });
time('int32 sort', 5000, () => { ints.set(scores); ints.sort(); });
time('f64 key sort', 5000, () => { for (let k = 0; k < NCOMBO; k++) keys[k] = scores[k] * 2048 + k; keys.sort(); });
const cnt = new Int32Array(1 << 12);
const tmp = new Int32Array(NCOMBO);
time('radix 2x12 (keys)', 5000, () => {
  // sort combo indices by score with two counting passes (low 12 bits, then high 12 bits)
  cnt.fill(0);
  for (let k = 0; k < NCOMBO; k++) cnt[scores[k] & 4095]++;
  for (let i = 1; i < 4096; i++) cnt[i] += cnt[i - 1];
  for (let k = NCOMBO - 1; k >= 0; k--) tmp[--cnt[scores[k] & 4095]] = k;
  cnt.fill(0);
  for (let k = 0; k < NCOMBO; k++) cnt[(scores[k] >> 12) & 4095]++;
  for (let i = 1; i < 4096; i++) cnt[i] += cnt[i - 1];
  for (let j = NCOMBO - 1; j >= 0; j--) { const k = tmp[j]; ints[--cnt[(scores[k] >> 12) & 4095]] = k; }
});

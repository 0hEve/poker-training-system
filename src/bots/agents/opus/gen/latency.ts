/// <reference types="node" />
/** Decision latency distribution: node src/bots/agents/opus/gen/run.mjs latency.ts  (env HERO, OPP, HANDS) */
import { getBenchmarkBot as getBot } from '../../../builtin';
import { FastTable } from '../../../../sim/table';
import { rngFor, shuffleDeck } from '../../../../sim/rng';
import type { PokerBot } from '../../../types';
const hero = process.env.HERO ?? 'opus';
const opp = process.env.OPP ?? 'station';
const N = 6;
const times: number[] = [];
const seats = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? hero : opp));
const bots: PokerBot[] = seats.map((id, i) => {
  const b = getBot(id).create({ seed: 1000 + i, playerId: `P${i + 1}` });
  if (id !== hero) return b;
  return { decide: (v) => { const t = performance.now(); const d = b.decide(v); times.push(performance.now() - t); return d; }, handEnd: b.handEnd?.bind(b) };
});
const ids = seats.map((_, i) => `P${i + 1}`);
const table = new FastTable({ smallBlind: 5, bigBlind: 10, ante: 0 });
table.timeBots = false;
const deck = new Int8Array(52);
for (let h = 0; h < Number(process.env.HANDS ?? 5000); h++) {
  shuffleDeck(deck, rngFor(9, h));
  const order = Array.from({ length: N }, (_, k) => (h % N + k) % N);
  table.playHand(order.map((p) => bots[p]), order.map((p) => ids[p]), new Array(N).fill(1000), deck, h);
}
times.sort((a, b) => a - b);
const q = (p: number) => (times[Math.min(times.length - 1, Math.floor(p * times.length))] * 1000).toFixed(1);
const mean = (times.reduce((a, b) => a + b, 0) / times.length) * 1000;
console.log(`${hero} vs ${opp}: n=${times.length} mean=${mean.toFixed(1)}µs p50=${q(0.5)} p90=${q(0.9)} p99=${q(0.99)} p99.9=${q(0.999)} max=${q(1)}µs  over100µs=${((100 * times.filter((t) => t > 0.1).length) / times.length).toFixed(2)}%`);

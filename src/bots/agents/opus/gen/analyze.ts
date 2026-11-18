/// <reference types="node" />
/** Leak finder: node src/bots/agents/opus/gen/run.mjs analyze.ts  (env: OPP=tag HANDS=20000 HERO=opus) */
import { getBot } from '../../../registry';
import { FastTable } from '../../../../sim/table';
import { rngFor, shuffleDeck } from '../../../../sim/rng';
import { positionOf } from '../position';

const hero = process.env.HERO ?? 'opus';
const opp = process.env.OPP ?? 'tag';
const hands = Number(process.env.HANDS ?? 20000);
const N = 6;
const seats = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? hero : opp));
const bots = seats.map((id, i) => getBot(id).create({ seed: 1000 + i, playerId: `P${i + 1}` }));
const ids = seats.map((_, i) => `P${i + 1}`);
const table = new FastTable({ smallBlind: 5, bigBlind: 10, ante: 0 });
const deck = new Int8Array(52);
const stats = new Map<string, { n: number; net: number }>();
const add = (k: string, net: number) => {
  const s = stats.get(k) ?? { n: 0, net: 0 };
  s.n++;
  s.net += net;
  stats.set(k, s);
};
for (let h = 0; h < hands; h++) {
  shuffleDeck(deck, rngFor(9, h));
  const button = h % N;
  const order = Array.from({ length: N }, (_, k) => (button + k) % N);
  const net = table.playHand(order.map((p) => bots[p]), order.map((p) => ids[p]), new Array(N).fill(1000), deck, h);
  const acts = table.handActions;
  for (let k = 0; k < N; k++) {
    if (seats[order[k]] !== hero) continue;
    const pos = positionOf(k, N);
    const mine = acts.filter((a) => a.seat === k && a.kind !== 'post');
    const pre = mine.filter((a) => a.street === 0).map((a) => a.kind[0]).join('');
    const lastStreet = acts.length ? acts[acts.length - 1].street : 0;
    const foldStreet = mine.find((a) => a.kind === 'fold')?.street;
    const end = foldStreet !== undefined ? `fold@${foldStreet}` : table.wentToShowdown ? 'showdown' : `won@${lastStreet}`;
    add(`pos ${pos}`, net[k]);
    add(`pre ${pre || '-'}`, net[k]);
    add(`end ${end}`, net[k]);
    add('ALL', net[k]);
    // Line: per street, hero's actions with the action they faced, e.g. "1:cb>f" = checked, bet... 
    const line: string[] = [];
    for (let st = 1; st <= 3; st++) {
      const sa = acts.filter((a) => a.street === st);
      if (!sa.length) break;
      const seq = sa.map((a) => (a.seat === k ? a.kind[0].toUpperCase() : a.kind === 'fold' ? '' : a.kind[0])).join('');
      line.push(`${st}:${seq}`);
    }
    if (line.length) add(`L ${pre} ${line.slice(0, 2).join(' ')}`, net[k]);
  }
}
const rows = [...stats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [k, s] of rows) console.log(`${k.padEnd(16)} n=${String(s.n).padStart(7)}  net/hand=${(s.net / s.n / 10).toFixed(3).padStart(8)}bb  total=${(s.net / 10).toFixed(0).padStart(9)}bb`);

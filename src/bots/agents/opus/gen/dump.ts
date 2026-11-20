/// <reference types="node" />
import { getBenchmarkBot as getBot } from '../../../builtin';
import { FastTable } from '../../../../sim/table';
import { rngFor, shuffleDeck } from '../../../../sim/rng';
const opp = process.env.OPP ?? 'tag';
const N = 6;
const seats = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 'opus' : opp));
const bots = seats.map((id, i) => getBot(id).create({ seed: 1000 + i, playerId: `P${i + 1}` }));
const ids = seats.map((_, i) => `P${i + 1}`);
const table = new FastTable({ smallBlind: 5, bigBlind: 10, ante: 0 });
const deck = new Int8Array(52);
for (let h = 0; h < Number(process.env.HANDS ?? 8000); h++) {
  shuffleDeck(deck, rngFor(9, h));
  const order = Array.from({ length: N }, (_, k) => (h % N + k) % N);
  table.playHand(order.map((p) => bots[p]), order.map((p) => ids[p]), new Array(N).fill(1000), deck, h);
}
const m = (bots[0] as any).models.get('P2');
const st = (x: any) => `${x.p.toFixed(2)}(${x.n})`;
console.log('vpip', st(m.vpip), 'pfr', st(m.pfr), '3b', st(m.threeBet), 'callOpen', st(m.callOpen), 'f3b', st(m.foldTo3bet), 'f4b', st(m.foldTo4bet));
console.log('rfi', Object.entries(m.rfi).map(([k, v]: any) => `${k}:${st(v)}`).join(' '));
for (let s = 1; s <= 3; s++) console.log(`st${s} aggr ${st(m.aggr[s])} cbet ${st(m.cbet[s])} fold ${st(m.foldToBet[s])} bySize ${m.foldBySize[s].map(st).join(' ')} raise ${st(m.raiseVsBet[s])} f2r ${st(m.foldToRaise[s])} betStr ${m.betStrength[s].v.toFixed(2)} bluff ${st(m.bluffShare[s])}`);

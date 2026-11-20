/// <reference types="node" />
import { getBenchmarkBot as getBot } from '../../../builtin';
import { FastTable } from '../../../../sim/table';
import { rngFor, shuffleDeck } from '../../../../sim/rng';
import { createDebugBot } from '../index';

const R = '23456789TJQKA', S = 'shdc';
const cs = (c: number) => R[c >> 2] + S[c & 3];
const opp = process.env.OPP ?? 'tag';
const lines: string[] = [];
const hero = createDebugBot(5, (i) => lines.push(`  st${i.street} ${(i.hole as number[]).map(cs).join('')} | ${(i.board as number[]).map(cs).join(' ')} pot=${i.pot} call=${i.toCall} eq=${(i.eq as number).toFixed(2)} n=${i.nOpp} [${i.opts}] -> ${i.pick}`));
const bots = [hero, getBot(opp).create({ seed: 2, playerId: 'P2' })];
const table = new FastTable({ smallBlind: 5, bigBlind: 10, ante: 0 });
const deck = new Int8Array(52);
const warm = Number(process.env.WARM ?? 3000);
for (let h = 0; h < warm + 40; h++) {
  shuffleDeck(deck, rngFor(4, h));
  const order = h % 2 ? [bots[1], bots[0]] : [bots[0], bots[1]];
  const ids = h % 2 ? ['P2', 'P1'] : ['P1', 'P2'];
  lines.length = 0;
  const net = table.playHand(order, ids, [1000, 1000], deck, h);
  if (h >= warm && lines.length) {
    const heroSeat = h % 2 ? 1 : 0;
    console.log(`hand ${h} net=${net[heroSeat]} acts=${table.handActions.filter((a) => a.kind !== 'post').map((a) => (a.seat === heroSeat ? 'H' : 'V') + a.kind[0] + (a.amount ? a.amount : '')).join(' ')}`);
    for (const l of lines) console.log(l);
  }
}

import { getBot } from './registry';
import type { BotSpec, BotView, Decision, PokerBot } from './types';
import { rngFor } from '../sim/rng';
import { evalWith2, accFrom, categoryOf } from '../sim/eval';

/**
 * Simple reference opponents. They exist to exercise the simulator and give new
 * bots something to beat; none of them is meant to be strong.
 */

const checkOrCall = (v: BotView): Decision => (v.toCall === 0 ? { type: 'check' } : { type: 'call' });
const checkOrFold = (v: BotView): Decision => (v.toCall === 0 ? { type: 'check' } : { type: 'fold' });
const raiseTo = (v: BotView, to: number): Decision =>
  v.canRaise ? { type: 'raise', to: Math.max(v.minRaiseTo, Math.min(v.maxRaiseTo, Math.round(to))) } : checkOrCall(v);

/** Chen formula score for two hole cards (roughly -1 .. 20). */
export function chenScore(c1: number, c2: number): number {
  const r1 = c1 >> 2;
  const r2 = c2 >> 2;
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const base = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10][hi];
  if (r1 === r2) return Math.max(5, base * 2);
  let s = base;
  if ((c1 & 3) === (c2 & 3)) s += 2;
  const gap = hi - lo - 1;
  s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 10) s += 1;
  return s;
}

const random: BotSpec = {
  id: 'random',
  name: 'Random',
  description: 'Picks a legal action at random (fold/check 30%, call 45%, raise 25%).',
  create({ seed }) {
    const rnd = rngFor(seed, 1);
    return {
      decide(v) {
        const x = rnd();
        if (x < 0.3) return checkOrFold(v);
        if (x < 0.75 || !v.canRaise) return checkOrCall(v);
        return raiseTo(v, v.minRaiseTo + rnd() * (v.maxRaiseTo - v.minRaiseTo) * 0.3);
      },
    };
  },
};

const station: BotSpec = {
  id: 'station',
  name: 'Calling station',
  description: 'Never folds, never raises.',
  create: () => ({ decide: checkOrCall }),
};

const tag: BotSpec = {
  id: 'tag',
  name: 'Basic TAG',
  description: 'Tight-aggressive rules: Chen-formula preflop, made-hand strength postflop, pot-sized value bets.',
  create({ seed }): PokerBot {
    const rnd = rngFor(seed, 2);
    return {
      decide(v) {
        const [c1, c2] = v.hole;
        const bb = v.bigBlind;
        if (v.street === 0) {
          const chen = chenScore(c1, c2);
          const facingRaise = v.currentBet > bb;
          if (chen >= 10) return raiseTo(v, facingRaise ? v.currentBet * 3 : 3 * bb);
          if (chen >= 8 && !facingRaise) return raiseTo(v, 2.5 * bb);
          if (chen >= 7 && v.toCall <= 3 * bb) return checkOrCall(v);
          if (v.toCall === 0) return { type: 'check' };
          return { type: 'fold' };
        }
        const score = evalWith2(accFrom(v.board), c1, c2);
        const boardCat = v.board.length >= 5 ? categoryOf(accScore(v.board)) : 0;
        const cat = categoryOf(score);
        const strong = cat >= 3 || (cat === 2 && boardCat < 2);
        const medium = cat === 1 && boardCat === 0;
        if (strong) return raiseTo(v, v.currentBet + Math.max(v.pot * 0.75, bb));
        if (medium) {
          if (v.toCall === 0) return rnd() < 0.5 ? raiseTo(v, v.pot * 0.5) : { type: 'check' };
          return v.toCall <= v.pot * 0.5 ? { type: 'call' } : { type: 'fold' };
        }
        if (v.toCall === 0) return rnd() < 0.15 ? raiseTo(v, v.pot * 0.5) : { type: 'check' };
        return { type: 'fold' };
      },
    };
  },
};

function accScore(board: readonly number[]): number {
  return evalWith2(accFrom(board, 3), board[3], board[4]);
}

export const builtinBots: BotSpec[] = [tag, station, random];

/** Baselines for engine tests and bot research. */
export function getBenchmarkBot(id: string): BotSpec {
  return builtinBots.find((bot) => bot.id === id) ?? getBot(id);
}

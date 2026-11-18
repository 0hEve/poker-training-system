import type { BotSpec, BotView, Decision, PokerBot } from '../../types';
import { rngFor } from '../../../sim/rng';
import { History } from './history';
import { Opponents } from './model';
import { postflop } from './postflop';
import { preflop } from './preflop';
import { Ranges } from './ranges';

export function createGpt(seed: number, adaptation = true): PokerBot {
  const policyRng = rngFor(seed, 417);
  const equityRng = rngFor(seed, 418);
  const history = new History();
  const opponents = new Opponents(adaptation);
  const ranges = new Ranges();
  return {
    decide(v: BotView): Decision {
      history.read(v);
      opponents.read(v);
      const mix = policyRng();
      if (!v.street) return preflop(v, history, opponents.seats, mix);
      return postflop(v, history, opponents.seats, ranges, mix, equityRng);
    },
    handEnd(summary) {
      opponents.observe(summary);
    },
  };
}

const gpt: BotSpec = {
  id: 'gpt',
  name: 'GPT 6.2 Sol',
  description: 'Mixed six-max ranges, blocker-aware equity and adaptive opponent modelling.',
  create: ({ seed }) => createGpt(seed),
};

export default gpt;

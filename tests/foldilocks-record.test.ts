/**
 * Fixture recorder (skipped unless RECORD_PARITY=1): plays matches with the Foldilocks port and
 * saves the engine states it saw to tests/fixtures/foldilocks-states.json. Then
 * scripts/ports/fullhouse_expected.py adds the Python original's answers (parity fixture).
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { getBot } from '../src/bots/registry';
import { runMatch } from '../src/sim/match';
import type { BotSpec } from '../src/bots/types';
import { fullhouseState, type FhState } from '../src/bots/agents/foldilocks';
import foldilocks from '../src/bots/agents/foldilocks';

describe.skipIf(!process.env.RECORD_PARITY)('record Foldilocks states', () => {
  it('records', () => {
    const states: FhState[] = [];
    const rec: BotSpec = {
      ...foldilocks,
      id: 'rec',
      create(o) {
        const b = foldilocks.create(o);
        return { decide: (v) => (states.push(JSON.parse(JSON.stringify(fullhouseState(v)))), b.decide(v)) };
      },
    };
    const resolve = (id: string) => (id === 'rec' ? rec : getBot(id));
    const runs: [string[], number, number][] = [
      [['rec', 'tag'], 1000, 120],
      [['rec', 'random'], 100, 120],
      [['rec', 'station', 'tag'], 1000, 80],
      [['rec', 'tag', 'random', 'station', 'opus', 'gpt'], 1000, 60],
      [['rec', 'random', 'tag', 'random', 'station', 'tag'], 120, 60],
      [['rec', 'opus', 'gpt', 'tag'], 400, 60],
    ];
    runs.forEach(([seats, stack, hands], i) => runMatch({ seats, hands, seed: 11 + i, stack, duplicate: false }, resolve));
    writeFileSync('tests/fixtures/foldilocks-states.json', JSON.stringify(states));
    console.log('states', states.length);
  }, 600_000);
});

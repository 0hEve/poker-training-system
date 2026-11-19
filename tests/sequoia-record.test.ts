/**
 * Fixture recorder (skipped unless RECORD_PARITY=1): plays matches with the Sequoia port and saves
 * every request (view, pending hand summaries, instance) with the port's decision to
 * tests/fixtures/sequoia-requests.json; scripts/ports/sequoia_expected.py replays them through the
 * Python original (scripts/ports/python_reference.py + gto_upload) to build the parity fixture.
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { getBot } from '../src/bots/registry';
import { runMatch } from '../src/sim/match';
import type { BotSpec, Decision, HandSummary } from '../src/bots/types';
import { SequoiaTable } from '../src/bots/agents/sequoia';

describe.skipIf(!process.env.RECORD_PARITY)('record Sequoia requests', () => {
  it('records', () => {
    const reqs: { instance: string; view: unknown; events: unknown[]; decision: Decision }[] = [];
    let k = 0;
    const rec: BotSpec = {
      id: 'rec',
      name: 'rec',
      description: '',
      create() {
        const table = new SequoiaTable();
        const instance = `rec-${++k}`;
        let pending: HandSummary[] = [];
        return {
          decide(v) {
            const view = JSON.parse(JSON.stringify(v));
            const events = JSON.parse(JSON.stringify(pending));
            const decision = table.decide(v, pending, instance);
            pending = [];
            reqs.push({ instance, view, events, decision });
            return decision;
          },
          handEnd(s) {
            pending.push(JSON.parse(JSON.stringify(s)));
            if (pending.length > 50) pending.shift();
          },
        };
      },
    };
    const resolve = (id: string) => (id === 'rec' ? rec : getBot(id));
    const runs: [string[], number, number][] = [
      [['rec', 'tag'], 1000, 150],
      [['rec', 'station'], 300, 120],
      [['rec', 'random', 'tag'], 1000, 120],
      [['rec', 'tag', 'random', 'station', 'opus', 'gpt'], 1000, 80],
      [['rec', 'random', 'rec', 'station', 'rec', 'tag'], 150, 80],
      [['rec', 'opus', 'gpt', 'tag', 'random', 'station', 'tag', 'random'], 1000, 60],
    ];
    runs.forEach(([seats, stack, hands], i) => runMatch({ seats, hands, seed: 21 + i, stack, duplicate: false, workers: 1 } as never, resolve));
    writeFileSync('tests/fixtures/sequoia-requests.json', JSON.stringify(reqs));
    console.log('requests', reqs.length);
  }, 600_000);
});

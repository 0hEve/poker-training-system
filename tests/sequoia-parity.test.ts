import { expect, it } from 'vitest';
import cases from './fixtures/sequoia-parity.json';
import { SequoiaTable } from '../src/bots/agents/sequoia';
import type { BotView, HandSummary } from '../src/bots/types';

/**
 * The TypeScript Sequoia against the Python original (scripts/ports/python_reference.py adapter +
 * poker_sequoia's gto_upload agent) on 1,162 requests recorded from real matches (2, 3, 6 and 8
 * players, every street, opponent counters fed by 485 showdowns). Requests replay in order per
 * table, so memory and per-decision RNG must match too. Built by scripts/ports/sequoia_expected.py.
 */
type Case = { instance: string; view: BotView; events: HandSummary[]; expected: unknown };

it('Sequoia TypeScript port makes the same decision as the Python original, every time', () => {
  const tables = new Map<string, SequoiaTable>();
  const diffs: unknown[] = [];
  (cases as unknown as Case[]).forEach((c, i) => {
    const t = tables.get(c.instance) ?? new SequoiaTable();
    tables.set(c.instance, t);
    const d = t.decide(c.view, c.events, c.instance);
    if (JSON.stringify(d) !== JSON.stringify(c.expected)) diffs.push({ i, got: d, expected: c.expected });
  });
  expect(diffs.slice(0, 5)).toEqual([]);
});

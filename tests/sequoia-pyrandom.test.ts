import { expect, it } from 'vitest';
import fx from './fixtures/pyrandom.json';
import { crc32, PyRandom } from '../src/bots/agents/sequoia/pyrandom';

it("reproduces Python's random.Random and zlib.crc32", () => {
  for (const [seed, vals] of fx.rand as [number, number[]][]) {
    const r = new PyRandom(seed);
    expect(vals.map(() => r.random())).toEqual(vals);
  }
  for (const [s, v] of fx.crc as [string, number][]) expect(crc32(s)).toBe(v);
});

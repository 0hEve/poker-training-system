import { describe, expect, it } from 'vitest';
import { getBenchmarkBot as getBot } from '../src/bots/builtin';
import { mergeResults, positionNames, runMatch, splitHands, summarize } from '../src/sim/match';

describe('match statistics for the simulator dashboard', () => {
  it('names positions from the button', () => {
    expect(positionNames(2)).toEqual(['BTN/SB', 'BB']);
    expect(positionNames(3)).toEqual(['BTN', 'SB', 'BB']);
    expect(positionNames(6)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']);
    for (let n = 2; n <= 10; n++) expect(new Set(positionNames(n)).size).toBe(n);
  });

  it('splits winnings into showdown / non-showdown and by position consistently', () => {
    const r = runMatch({ seats: ['tag', 'station', 'tag', 'station', 'tag', 'station'], hands: 600, seed: 7, duplicate: true, curveEvery: 50 }, getBot);
    for (const t of Object.values(r.totals)) {
      expect(t.posNet.reduce((a, b) => a + b, 0)).toBe(t.net);
      expect(t.posHands.reduce((a, b) => a + b, 0)).toBe(t.seatHands);
      expect(t.acts.reduce((a, b) => a + b, 0)).toBe(t.decisions);
    }
    for (const rep of summarize(r)) expect(rep.sdBb100 + rep.nonSdBb100).toBeCloseTo(rep.bb100, 9);
    expect(r.curve.x.at(-1)).toBe(600);
    expect(r.curve.net.at(-1)).toBe(r.deck.sum);
  });

  it('merges per-worker curves into one continuous curve', () => {
    const cfg = { seats: ['station', 'station', 'station', 'station'], hands: 300, seed: 3, curveEvery: 25 };
    const whole = runMatch(cfg, getBot);
    const parts = splitHands(300, 4).map((p) => runMatch({ ...cfg, ...p }, getBot));
    const merged = mergeResults(parts.reverse());
    expect(merged.curve.x).toEqual(whole.curve.x.filter((x) => merged.curve.x.includes(x)));
    expect(merged.curve.net.at(-1)).toBe(whole.curve.net.at(-1));
    expect(merged.totals.station.posNet).toEqual(whole.totals.station.posNet);
  });
});

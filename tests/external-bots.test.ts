import { describe, expect, it } from 'vitest';
import { allBots, getBot } from '../src/bots/registry';
import { runMatch } from '../src/sim/match';
import { gatewayUrl } from '../src/bots/remote/transport';

/**
 * End-to-end through the local bot gateway (`npm run gateway`). Each external bot that the
 * gateway reports ready plays a short duplicate match against the built-in TAG at every table
 * size it supports among 2, 3 and 6; it must answer every decision (no fallbacks).
 * Skipped when no gateway is running, so `npm test` stays self-contained.
 */
interface GatewayBot {
  id: string;
  seats: [number, number];
  status: { state: string; detail: string };
}

async function gatewayBots(): Promise<GatewayBot[] | null> {
  try {
    const r = await fetch(`${gatewayUrl()}/v1/bots`, { signal: AbortSignal.timeout(1000) });
    return (await r.json()) as GatewayBot[];
  } catch {
    return null;
  }
}

const list = await gatewayBots();

describe.skipIf(!list)('external bots via the gateway', () => {
  const ready = (list ?? []).filter((b) => b.status.state === 'ready');

  const appId = (gid: string) => allBots.find((s) => (s as { remote?: unknown }).remote && s.id === gid)?.id;

  it('registers every gateway bot in the app registry', () => {
    for (const b of list ?? []) expect(appId(b.id)).toBeTruthy();
  });

  for (const b of ready) {
    for (const size of [2, 3, 6].filter((n) => n >= b.seats[0] && n <= b.seats[1])) {
      it(`${b.id} answers every decision ${size}-handed`, () => {
        const id = appId(b.id)!;
        const seats = Array.from({ length: size }, (_, i) => (i % 2 === 0 ? id : 'tag'));
        const r = runMatch({ seats, hands: 12, seed: 5 }, getBot);
        const t = r.totals[id];
        expect(t.decisions).toBeGreaterThan(0);
        expect(t.errors).toBe(0);
        expect(t.invalid).toBe(0);
      }, 120_000);
    }
  }
});

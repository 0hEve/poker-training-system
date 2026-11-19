import { useEffect, useState } from 'react';
import { findBot } from '../registry';
import type { RemoteBotSpec } from '../agents/external';
import { gatewayUrl } from './transport';

/** One bot as the gateway reports it (GET /v1/bots). */
export interface GatewayBot {
  id: string;
  name: string;
  description: string;
  source: string;
  seats: [number, number];
  status: { state: 'loading' | 'ready' | 'missing' | 'unavailable' | 'failed'; detail: string };
  decisions: number;
  errors: number;
  mean_ms: number;
}

export type GatewayStatus = { reachable: boolean; bots: Map<string, GatewayBot> };

let current: GatewayStatus = { reachable: false, bots: new Map() };
const listeners = new Set<(s: GatewayStatus) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function poll() {
  try {
    const r = await fetch(`${gatewayUrl()}/v1/bots`, { cache: 'no-store' });
    const list = (await r.json()) as GatewayBot[];
    current = { reachable: true, bots: new Map(list.map((b) => [b.id, b])) };
  } catch {
    current = { reachable: false, bots: new Map() };
  }
  listeners.forEach((l) => l(current));
  const settling = !current.reachable || [...current.bots.values()].some((b) => b.status.state === 'loading');
  timer = setTimeout(poll, settling ? 3000 : 15000);
}

/** Live gateway status, shared by every component (polled while anything is subscribed). */
export function useGatewayStatus(): GatewayStatus {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    if (!timer) void poll();
    return () => {
      listeners.delete(setS);
      if (!listeners.size && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }, []);
  return s;
}

const isRemote = (id: string) => !!(findBot(id) as { remote?: unknown } | undefined)?.remote;

/** "" for local bots and ready remote bots; otherwise a short note for option labels. */
export function statusNote(id: string, s: GatewayStatus): string {
  if (!isRemote(id)) return '';
  if (!s.reachable) return ' · gateway offline';
  const b = s.bots.get(id);
  if (!b) return ' · not in gateway';
  switch (b.status.state) {
    case 'ready':
      return '';
    case 'loading':
      return ' · loading…';
    case 'missing':
      return ' · not installed';
    case 'unavailable':
      return ' · unavailable';
    default:
      return ' · failed';
  }
}

/** Unavailable bots can't be picked; loading / missing ones can (they fall back to check/fold until ready). */
export function selectable(id: string, s: GatewayStatus): boolean {
  return !isRemote(id) || s.bots.get(id)?.status.state !== 'unavailable';
}

/** Tooltip: description plus the gateway's detail line. */
export function statusTitle(id: string, s: GatewayStatus): string {
  const spec = findBot(id);
  const b = s.bots.get(id);
  const parts = [spec?.description ?? id];
  if (isRemote(id)) {
    const seats = (spec as { remote?: { seats: [number, number] } }).remote?.seats;
    if (seats) parts.push(`Plays ${seats[0] === seats[1] ? `${seats[0]}` : `${seats[0]}–${seats[1]}`} players.`);
    parts.push(b ? `${b.status.state}: ${b.status.detail}` : s.reachable ? 'not in gateway' : 'bot gateway is not running (npm run gateway)');
  }
  return parts.join('\n');
}

/** Players a bot can play: the gateway's live range (it narrows when a model didn't load), else the spec's. */
export function seatRange(id: string, s: GatewayStatus): [number, number] {
  const live = isRemote(id) ? s.bots.get(id)?.seats : undefined;
  if (live) return live;
  const spec = findBot(id) as Partial<RemoteBotSpec> | undefined;
  return spec?.remote?.seats ?? spec?.seats ?? [2, 10];
}

/** Why `id` can't play an `n`-handed table, or null when it can. */
export function seatProblem(id: string, n: number, s: GatewayStatus): string | null {
  const [lo, hi] = seatRange(id, s);
  if (n >= lo && n <= hi) return null;
  const name = findBot(id)?.name ?? id;
  return `${name} plays ${lo === hi ? (lo === 2 ? 'heads-up only' : `${lo} players only`) : `${lo}–${hi} players`}; at ${n} players it would only check/fold.`;
}

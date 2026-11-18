import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeResults, mirrorSeats, splitHands, type DeckStat, type MatchConfig, type MatchResult } from '../../sim/match';

/** Seat layouts offered in the simulator. A / B are the two bots. */
export const FORMATS = {
  '3v3': { label: '3 v 3', detail: '6-max, seats alternate A B A B A B', seats: 'ABABAB' },
  '3v3-blocks': { label: '3 v 3 blocks', detail: '6-max, A A A B B B', seats: 'AAABBB' },
  hu: { label: 'Heads-up', detail: '1 v 1', seats: 'AB' },
  '2v2': { label: '2 v 2', detail: '4-max, A B A B', seats: 'ABAB' },
  '1v5': { label: '1 v 5', detail: '6-max, one A against five B', seats: 'ABBBBB' },
} as const;
export type FormatId = keyof typeof FORMATS;

export interface SimConfig {
  a: string;
  b: string;
  format: FormatId;
  /** Decks; with duplicate each deck is played twice. */
  hands: number;
  duplicate: boolean;
  workers: number;
  /** Fixed seed, or null for a fresh random one. */
  seed: number | null;
}

export interface SimRun {
  id: string;
  /** Epoch ms when the run finished. */
  at: number;
  config: SimConfig;
  seed: number;
  result: MatchResult;
  wallMs: number;
}

/** Live estimate of the first bot's bb/100 while a run is in flight. */
export interface LivePoint {
  decks: number;
  bb100: number;
  ci95: number;
}

export interface SimState {
  status: 'idle' | 'running' | 'done' | 'error';
  config: SimConfig | null;
  progress: number;
  /** Decks done per second so far. */
  rate: number;
  live: LivePoint[];
  run: SimRun | null;
  error: string | null;
  history: SimRun[];
}

const HISTORY_KEY = 'poker-table/sim-runs/v1';
const HISTORY_LIMIT = 12;

function loadHistory(): SimRun[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const runs = raw ? (JSON.parse(raw) as SimRun[]) : [];
    return Array.isArray(runs) ? runs.filter((r) => r?.result?.curve) : [];
  } catch {
    return [];
  }
}

export function seatsFor(c: Pick<SimConfig, 'a' | 'b' | 'format'>): string[] {
  return [...FORMATS[c.format].seats].map((x) => (x === 'A' ? c.a : c.b));
}

/** Seat-hands the first bot plays per deck (both tables in duplicate mode). */
export function seatsPerDeck(seats: string[], duplicate: boolean): number {
  const id = seats[0];
  const mirror = duplicate ? mirrorSeats(seats) : null;
  return seats.filter((s) => s === id).length + (mirror ? mirror.filter((s) => s === id).length : 0);
}

/** bb/100 and 95% half-width for the first bot from per-deck stats. */
export function estimate(d: Pick<DeckStat, 'n' | 'sum' | 'sumSq'>, bigBlind: number, perDeck: number): { bb100: number; ci95: number } {
  if (!d.n) return { bb100: 0, ci95: NaN };
  const mean = d.sum / d.n;
  const variance = d.n > 1 ? Math.max(0, (d.sumSq - d.n * mean * mean) / (d.n - 1)) : NaN;
  const scale = 100 / (bigBlind * perDeck);
  return { bb100: mean * scale, ci95: 1.96 * Math.sqrt(variance / d.n) * scale };
}

export function defaultWorkers() {
  return Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 4) - 1));
}

/** Runs bot-vs-bot matches across Web Workers and keeps a short history of finished runs. */
export function useSimulation() {
  const [state, setState] = useState<SimState>(() => ({
    status: 'idle',
    config: null,
    progress: 0,
    rate: 0,
    live: [],
    run: null,
    error: null,
    history: loadHistory(),
  }));
  const workers = useRef<Worker[]>([]);

  const terminate = () => {
    workers.current.forEach((w) => w.terminate());
    workers.current = [];
  };
  useEffect(() => terminate, []);

  const stop = useCallback(() => {
    terminate();
    setState((s) => (s.status === 'running' ? { ...s, status: s.run ? 'done' : 'idle', progress: 0, live: [] } : s));
  }, []);

  const start = useCallback((config: SimConfig) => {
    terminate();
    const seats = seatsFor(config);
    const seed = config.seed ?? (Math.random() * 2 ** 31) >>> 0;
    const bigBlind = 10;
    const perDeck = seatsPerDeck(seats, config.duplicate);
    const cfg: MatchConfig = { seats, hands: config.hands, seed, duplicate: config.duplicate, bigBlind, smallBlind: 5, curveEvery: Math.max(1, Math.ceil(config.hands / 400)) };
    const ranges = splitHands(config.hands, Math.max(1, Math.min(config.workers, config.hands)));
    const done = new Array<number>(ranges.length).fill(0);
    const decks = ranges.map(() => ({ n: 0, sum: 0, sumSq: 0 }));
    const parts: MatchResult[] = [];
    const t0 = performance.now();
    let lastPush = 0;
    setState((s) => ({ ...s, status: 'running', config, progress: 0, rate: 0, live: [], error: null }));

    const fail = (msg: string) => {
      terminate();
      setState((s) => ({ ...s, status: 'error', error: msg, progress: 0 }));
    };

    workers.current = ranges.map((r, i) => {
      const w = new Worker(new URL('../../sim/arena.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ progress?: number; deck?: DeckStat; result?: MatchResult; error?: string }>) => {
        const m = e.data;
        if (m.error) return fail(m.error);
        if (m.progress !== undefined && m.deck) {
          done[i] = m.progress;
          decks[i] = m.deck;
          const now = performance.now();
          const total = done.reduce((x, y) => x + y, 0);
          if (now - lastPush < 50 && total < config.hands) return;
          lastPush = now;
          const agg = decks.reduce((x, d) => ({ n: x.n + d.n, sum: x.sum + d.sum, sumSq: x.sumSq + d.sumSq }), { n: 0, sum: 0, sumSq: 0 });
          const est = estimate(agg, bigBlind, perDeck);
          setState((s) => ({
            ...s,
            progress: total / config.hands,
            rate: total / Math.max(0.001, (now - t0) / 1000),
            // The first few hundred decks swing wildly; start the live chart once the estimate settles a little.
            live: agg.n >= Math.min(1000, config.hands * 0.02) ? [...s.live, { decks: agg.n, ...est }] : s.live,
          }));
        }
        if (m.result) {
          parts.push(m.result);
          w.terminate();
          if (parts.length === ranges.length) {
            workers.current = [];
            const result = mergeResults(parts);
            const run: SimRun = { id: `${Date.now().toString(36)}-${seed}`, at: Date.now(), config, seed, result, wallMs: performance.now() - t0 };
            setState((s) => {
              const history = [run, ...s.history].slice(0, HISTORY_LIMIT);
              try {
                localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
              } catch {
                /* storage full: keep in memory */
              }
              return { ...s, status: 'done', progress: 1, run, history };
            });
          }
        }
      };
      w.onerror = (e) => fail(e.message || 'A simulation worker crashed');
      w.postMessage({ ...cfg, ...r });
      return w;
    });
  }, []);

  const show = useCallback((run: SimRun) => setState((s) => (s.status === 'running' ? s : { ...s, status: 'done', run, config: run.config, error: null })), []);

  const forget = useCallback((id: string) => {
    setState((s) => {
      const history = s.history.filter((r) => r.id !== id);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch {
        /* ignore */
      }
      return { ...s, history, run: s.run?.id === id ? null : s.run, status: s.run?.id === id && s.status === 'done' ? 'idle' : s.status };
    });
  }, []);

  return { state, start, stop, show, forget };
}

export type Simulation = ReturnType<typeof useSimulation>;

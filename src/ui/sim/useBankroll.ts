import { useCallback, useEffect, useRef, useState } from 'react';
import type { BankrollConfig, BankrollSnapshot } from '../../sim/bankroll';

/** One point of the stack chart: every player's stack after `hand` hands. */
export interface StackPoint {
  hand: number;
  stacks: number[];
}

export interface BankrollState {
  status: 'idle' | 'running' | 'paused' | 'done' | 'error';
  cfg: BankrollConfig | null;
  snapshot: BankrollSnapshot | null;
  history: StackPoint[];
  /** Hands per second requested (0 = max). */
  speed: number;
  /** Hands actually played per second, measured. */
  rate: number;
  error: string | null;
}

const MAX_POINTS = 800;

/** Drives a bankroll session in a Web Worker and keeps a down-sampled history of every stack. */
export function useBankroll() {
  const [state, setState] = useState<BankrollState>({ status: 'idle', cfg: null, snapshot: null, history: [], speed: 20, rate: 0, error: null });
  const worker = useRef<Worker | null>(null);
  const stride = useRef(1);
  const rateRef = useRef({ t: 0, hand: 0 });

  const kill = () => {
    worker.current?.terminate();
    worker.current = null;
  };
  useEffect(() => kill, []);

  const start = useCallback((cfg: BankrollConfig, speed: number) => {
    kill();
    stride.current = 1;
    rateRef.current = { t: performance.now(), hand: 0 };
    const w = new Worker(new URL('../../sim/bankroll.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setState({ status: 'running', cfg, snapshot: null, history: [{ hand: 0, stacks: cfg.players.map(() => cfg.stack) }], speed, rate: 0, error: null });
    w.onmessage = (e: MessageEvent<{ snapshot?: BankrollSnapshot; error?: string }>) => {
      if (e.data.error) {
        kill();
        setState((s) => ({ ...s, status: 'error', error: e.data.error! }));
        return;
      }
      const snap = e.data.snapshot!;
      const now = performance.now();
      const r = rateRef.current;
      let rate: number | null = null;
      if (now - r.t > 500) {
        rate = ((snap.hand - r.hand) * 1000) / (now - r.t);
        rateRef.current = { t: now, hand: snap.hand };
      }
      setState((s) => {
        let history = s.history;
        const lastHand = history.length ? history[history.length - 1].hand : -1;
        if (snap.hand >= lastHand + stride.current || (snap.done && snap.hand !== lastHand)) {
          history = [...history, { hand: snap.hand, stacks: snap.players.map((p) => p.stack) }];
          if (history.length > MAX_POINTS) {
            history = history.filter((_, i) => i % 2 === 0 || i === history.length - 1);
            stride.current *= 2;
          }
        }
        return {
          ...s,
          snapshot: snap,
          history,
          rate: rate ?? s.rate,
          status: snap.done ? 'done' : s.status === 'paused' ? 'paused' : 'running',
        };
      });
      if (snap.done) kill();
    };
    w.onerror = (e) => {
      kill();
      setState((s) => ({ ...s, status: 'error', error: e.message || 'The session crashed' }));
    };
    w.postMessage({ type: 'start', cfg, speed });
  }, []);

  const setSpeed = useCallback((speed: number) => {
    worker.current?.postMessage({ type: 'speed', speed });
    setState((s) => ({ ...s, speed }));
  }, []);
  const pause = useCallback(() => {
    worker.current?.postMessage({ type: 'pause' });
    setState((s) => (s.status === 'running' ? { ...s, status: 'paused' } : s));
  }, []);
  const resume = useCallback(() => {
    rateRef.current = { t: performance.now(), hand: rateRef.current.hand };
    worker.current?.postMessage({ type: 'resume' });
    setState((s) => (s.status === 'paused' ? { ...s, status: 'running' } : s));
  }, []);
  const reset = useCallback(() => {
    kill();
    setState((s) => ({ ...s, status: 'idle', snapshot: null, history: [], rate: 0, error: null }));
  }, []);

  return { state, start, setSpeed, pause, resume, reset };
}

export type Bankroll = ReturnType<typeof useBankroll>;

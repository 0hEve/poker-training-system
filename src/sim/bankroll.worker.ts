/// <reference lib="webworker" />
import { getBot } from '../bots/registry';
import { BankrollSession, type BankrollConfig } from './bankroll';

/**
 * Runs a bankroll session off the UI thread at a chosen pace.
 * In:  { type: 'start', cfg, speed } | { type: 'speed', speed } | { type: 'pause' } | { type: 'resume' }
 *      speed = hands per second (0 = as fast as possible).
 * Out: { snapshot } about 20 times a second, { error } on failure.
 */
type Msg =
  | { type: 'start'; cfg: BankrollConfig; speed: number }
  | { type: 'speed'; speed: number }
  | { type: 'pause' }
  | { type: 'resume' };

let session: BankrollSession | null = null;
let speed = 10;
let paused = false;
let owed = 0;
let last = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const TICK_MS = 50;

function tick() {
  timer = null;
  if (!session || paused) return;
  const now = performance.now();
  const dt = Math.min(250, now - last);
  last = now;
  try {
    if (speed <= 0) {
      // Flat out: play in small batches for ~40 ms, then report.
      const until = now + 40;
      do session.play(25);
      while (performance.now() < until && !session.done);
    } else {
      owed += (speed * dt) / 1000;
      const n = Math.floor(owed);
      if (n > 0) {
        owed -= n;
        session.play(n);
      }
    }
    self.postMessage({ snapshot: session.snapshot() });
    if (!session.done) timer = setTimeout(tick, TICK_MS);
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.type === 'start') {
      session = new BankrollSession(m.cfg, getBot);
      speed = m.speed;
      paused = false;
      owed = 0;
      self.postMessage({ snapshot: session.snapshot() });
    } else if (m.type === 'speed') {
      speed = m.speed;
      owed = 0;
    } else if (m.type === 'pause') {
      paused = true;
    } else if (m.type === 'resume') {
      paused = false;
    }
    if (session && !paused && !timer && !session.done) {
      last = performance.now();
      timer = setTimeout(tick, speed > 0 && speed < 20 ? 1000 / speed : 0);
    }
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};

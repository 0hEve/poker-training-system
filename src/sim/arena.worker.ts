/// <reference lib="webworker" />
import { getBot } from '../bots/registry';
import { runMatch, type MatchConfig } from './match';

/**
 * Runs one chunk of a match off the UI thread.
 * In: MatchConfig. Out: `{ progress, deck }` snapshots (running per-deck stats), then `{ result }`.
 */
self.onmessage = (e: MessageEvent<MatchConfig>) => {
  try {
    const result = runMatch(e.data, getBot, (done, deck) => self.postMessage({ progress: done, deck: { ...deck } }));
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};

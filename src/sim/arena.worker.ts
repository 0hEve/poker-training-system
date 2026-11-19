/// <reference lib="webworker" />
import { getBot } from '../bots/registry';
import { runMatch, runMatchAsync, type DeckStat, type MatchConfig } from './match';

/**
 * Runs one chunk of a match off the UI thread.
 * In: MatchConfig. Out: `{ progress, deck }` snapshots (running per-deck stats), then `{ result }`.
 */
self.onmessage = async (e: MessageEvent<MatchConfig>) => {
  try {
    const cfg = e.data;
    const progress = (done: number, deck: DeckStat) => self.postMessage({ progress: done, deck: { ...deck } });
    const remote = cfg.seats.some((id) => 'remote' in getBot(id));
    const result = remote
      ? await runMatchAsync(cfg, getBot, progress, new AbortController().signal)
      : runMatch(cfg, getBot, progress);
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};

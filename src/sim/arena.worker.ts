/// <reference lib="webworker" />
import { getBot } from '../bots/registry';
import { runMatch, type MatchConfig } from './match';

/** Runs one chunk of a match off the UI thread. Message in: MatchConfig. Out: progress, then result. */
self.onmessage = (e: MessageEvent<MatchConfig>) => {
  try {
    const result = runMatch(e.data, getBot, (done) => self.postMessage({ progress: done }));
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};

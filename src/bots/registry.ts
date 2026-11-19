import type { BotSpec } from './types';
import gpt from './agents/gpt';
import opus from './agents/opus';

/** Playable bots for the live table, simulator and CLI. */
export const allBots: readonly BotSpec[] = [...opus, gpt];

export function findBot(id: string): BotSpec | undefined {
  return allBots.find((b) => b.id === id);
}

export function getBot(id: string): BotSpec {
  const b = findBot(id);
  if (!b) throw new Error(`Unknown bot "${id}". Available: ${allBots.map((x) => x.id).join(', ')}`);
  return b;
}

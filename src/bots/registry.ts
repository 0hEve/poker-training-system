import type { BotSpec } from './types';
import { builtinBots } from './builtin';

/**
 * All bots available to the table and the simulator.
 *
 * - `builtin.ts`: simple baselines (TAG, calling station, random).
 * - `agents/<name>/index.ts`: the full bots shipped with the app (Opus 5.5, GPT 6.2 Sol).
 * - `local/<name>/index.ts`: private bots, git-ignored so experiments stay on your machine.
 *
 * Folders are discovered automatically; the default export is a `BotSpec` or an array of them.
 */
type BotModule = { default?: BotSpec | BotSpec[] };
const localModules = {
  ...import.meta.glob<BotModule>('./agents/*/index.ts', { eager: true }),
  ...import.meta.glob<BotModule>('./local/*/index.ts', { eager: true }),
};

function collect(): BotSpec[] {
  const out = [...builtinBots];
  for (const path of Object.keys(localModules).sort()) {
    const exp = localModules[path].default;
    for (const spec of Array.isArray(exp) ? exp : exp ? [exp] : []) {
      if (out.some((b) => b.id === spec.id)) {
        console.warn(`Duplicate bot id "${spec.id}" in ${path}; skipped.`);
        continue;
      }
      out.push(spec);
    }
  }
  return out;
}

export const allBots: readonly BotSpec[] = collect();

export function findBot(id: string): BotSpec | undefined {
  return allBots.find((b) => b.id === id);
}

export function getBot(id: string): BotSpec {
  const b = findBot(id);
  if (!b) throw new Error(`Unknown bot "${id}". Available: ${allBots.map((x) => x.id).join(', ')}`);
  return b;
}

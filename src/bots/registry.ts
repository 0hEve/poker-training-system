import type { BotSpec } from './types';
import { builtinBots } from './builtin';

/**
 * All bots available to the table and the simulator.
 *
 * Built-in bots live in `builtin.ts`. Private bots are discovered automatically from
 * `src/bots/local/<name>/index.ts` (default export: a `BotSpec` or an array of them).
 * `src/bots/local/` is git-ignored, so experimental bots stay on your machine.
 */
type LocalModule = { default?: BotSpec | BotSpec[] };
const localModules = import.meta.glob<LocalModule>('./local/*/index.ts', { eager: true });

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

// Bundles the simulator (src/sim/cli.ts + every registered bot, including the
// git-ignored src/bots/local/*) with Vite into .cache/sim/cli.mjs, then runs it.
// Usage: npm run sim -- --a tag --b station --hands 50000
import { build } from 'vite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.cache', 'sim');

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: path.join(root, 'src/sim/cli.ts'),
    outDir,
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rollupOptions: { output: { entryFileNames: 'cli.mjs', format: 'es' } },
  },
});

await import(pathToFileURL(path.join(outDir, 'cli.mjs')).href);

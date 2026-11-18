// From the repository root:
// node src/bots/agents/gpt/offline.mjs generate
// node src/bots/agents/gpt/offline.mjs [verify|adaptation|latency|match|compare] [decks] [seed] [opponent]
import { build } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const generating = args[0] === 'generate';
const outDir = await mkdtemp(join(tmpdir(), 'gpt-offline-'));
try {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      ssr: join(here, generating ? 'generate-equity.ts' : 'validate.ts'),
      emptyOutDir: true,
      outDir,
      rollupOptions: { output: { entryFileNames: 'runner.mjs' } },
    },
  });
  const runner = await import(pathToFileURL(join(outDir, 'runner.mjs')).href);
  if (generating) await runner.generate(join(here, 'equity-data.ts'));
  else await runner.validate(args);
} finally {
  await rm(outDir, { recursive: true, force: true });
}

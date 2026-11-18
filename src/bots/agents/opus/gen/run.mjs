// Bundles and runs a TypeScript entry from this folder: node src/bots/agents/opus/gen/run.mjs [entry.ts]
import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const entry = path.resolve(here, process.argv[2] ?? 'gen-tables.ts');
const outDir = path.join(root, '.cache', 'opus-gen');
await build({ root, configFile: false, logLevel: 'warn', build: { ssr: entry, outDir, emptyOutDir: true, target: 'node22', minify: false, rollupOptions: { output: { entryFileNames: 'entry.mjs' } } } });
process.env.OPUS_ROOT = root;
await import(pathToFileURL(path.join(outDir, 'entry.mjs')).href);

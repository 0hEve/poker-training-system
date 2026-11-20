// Launches the desktop app.
//   node scripts/electron.mjs         -> Vite dev server + Electron with hot reload
//   node scripts/electron.mjs --prod  -> Electron on the built dist/ (run `vite build` first)
// Replaces concurrently + wait-on + cross-env with zero extra dependencies.
import { spawn } from 'node:child_process';
import electron from 'electron';

const prod = process.argv.includes('--prod');
// Some Electron-based terminals export ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;

let server = null;
if (!prod) {
  const { createServer } = await import('vite');
  server = await createServer({ server: { port: 5174, strictPort: true } });
  await server.listen();
  server.printUrls();
  env.VITE_DEV_SERVER_URL = 'http://localhost:5174';
}

const app = spawn(electron, ['.'], { stdio: 'inherit', env });
app.on('exit', async (code) => {
  await server?.close();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => app.kill());
process.on('SIGTERM', () => app.kill());

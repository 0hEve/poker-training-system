// Starts the Vite dev server, then launches Electron pointed at it.
// Replaces concurrently + wait-on + cross-env with ~20 lines and zero deps.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

const server = await createServer({ server: { port: 5174, strictPort: true } });
await server.listen();
server.printUrls();

const app = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5174' },
});

const stop = async (code = 0) => {
  await server.close();
  process.exit(code);
};
app.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => app.kill());
process.on('SIGTERM', () => app.kill());

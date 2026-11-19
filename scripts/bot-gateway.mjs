// Starts the local bot gateway (native/bot-gateway) that runs the external bots.
//   node scripts/bot-gateway.mjs            run in the foreground (npm run gateway)
//   import { ensureGateway } from './bot-gateway.mjs'   start it unless one is already up
// The binary is built with cargo on first use. Assets live in <repo>/bot-assets (POKER_BOTS_HOME);
// `npm run bots:setup` installs them.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crate = path.join(root, 'native', 'bot-gateway');
export const binary = path.join(crate, 'target', 'release', 'bot-gateway');
export const port = Number(process.env.BOT_GATEWAY_PORT || 7878);
const url = `http://127.0.0.1:${port}`;

function cargo() {
  const candidates = [process.env.CARGO, path.join(os.homedir(), '.cargo/bin/cargo'), '/opt/homebrew/opt/rustup/bin/cargo', 'cargo'];
  return candidates.find((c) => c && (c === 'cargo' || existsSync(c)));
}

export async function healthy() {
  try {
    const r = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

export function build() {
  if (existsSync(binary)) return true;
  const c = cargo();
  console.log('[gateway] building native/bot-gateway (first run)…');
  const r = spawnSync(c, ['build', '--release', '--manifest-path', path.join(crate, 'Cargo.toml')], { stdio: 'inherit' });
  return r.status === 0;
}

/**
 * Start the gateway unless one already answers. Returns a stop() for the process we started
 * (a no-op when another gateway was already running).
 */
export async function ensureGateway({ quiet = false } = {}) {
  if (await healthy()) return { started: false, stop() {} };
  if (!build()) {
    console.warn('[gateway] could not build the bot gateway; external bots will play check/fold. Install Rust or run npm run bots:setup.');
    return { started: false, stop() {} };
  }
  const child = spawn(binary, ['--repo', root, '--port', String(port)], {
    stdio: quiet ? ['ignore', 'ignore', 'pipe'] : ['ignore', 'inherit', 'inherit'],
  });
  if (quiet) child.stderr.on('data', (d) => /error|fail|missing/i.test(String(d)) && process.stderr.write(d));
  for (let i = 0; i < 50 && !(await healthy()); i++) await new Promise((r) => setTimeout(r, 100));
  const stop = () => {
    if (child.exitCode === null) child.kill('SIGTERM');
  };
  process.once('exit', stop);
  return { started: true, stop, child };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (await healthy()) {
    console.log(`[gateway] already running at ${url}`);
    process.exit(0);
  }
  if (!build()) process.exit(1);
  const child = spawn(binary, ['--repo', root, '--port', String(port), ...process.argv.slice(2)], { stdio: 'inherit' });
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill('SIGTERM'));
  child.on('exit', (code) => process.exit(code ?? 0));
}

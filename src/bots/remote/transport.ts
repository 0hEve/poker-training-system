/**
 * Synchronous calls to the local bot gateway (native/bot-gateway).
 *
 * The live table uses asynchronous fetch. Simulator workers use synchronous XMLHttpRequest,
 * and the Node CLI uses a helper thread with a keep-alive socket and Atomics.
 * Bodies go as text/plain so cross-origin requests need no CORS preflight.
 */

export const DEFAULT_GATEWAY = 'http://127.0.0.1:7878';

export function gatewayUrl(): string {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
    localStorage?: Storage;
  };
  try {
    const fromStorage = g.localStorage?.getItem('botGatewayUrl');
    if (fromStorage) return fromStorage.replace(/\/$/, '');
  } catch {
    /* storage unavailable (workers) */
  }
  return (g.process?.env?.BOT_GATEWAY_URL ?? import.meta.env?.VITE_BOT_GATEWAY_URL ?? DEFAULT_GATEWAY).replace(/\/$/, '');
}

export async function requestAsync<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(gatewayUrl() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  });
  if (!response.ok) throw new Error(`Bot gateway returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

type NodeSync = (url: string, body: string, timeoutMs: number) => string;
let nodeSync: NodeSync | null = null;

/** Builds the Node fallback lazily, without static Node imports (this file is also bundled for browsers). */
function nodeTransport(): NodeSync {
  if (nodeSync) return nodeSync;
  const proc = (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown } }).process;
  const wt = proc?.getBuiltinModule?.('node:worker_threads') as typeof import('node:worker_threads') | undefined;
  if (!wt) throw new Error('No synchronous HTTP transport available in this runtime');
  const MAX = 1 << 22;
  const shared = new SharedArrayBuffer(8 + MAX);
  const flag = new Int32Array(shared, 0, 2);
  const bytes = new Uint8Array(shared, 8);
  // The helper keeps one keep-alive socket to the gateway and speaks just enough HTTP/1.1
  // (Content-Length bodies, which is all the gateway sends). Cheaper than fetch per request.
  const worker = new wt.Worker(
    `const { parentPort, workerData } = require('node:worker_threads');
     const net = require('node:net');
     const flag = new Int32Array(workerData, 0, 2), bytes = new Uint8Array(workerData, 8);
     let sock = null, key = '', buf = Buffer.alloc(0), pending = null, timer = null;
     function finish(text) {
       clearTimeout(timer); pending = null;
       const enc = Buffer.from(text);
       const n = Math.min(enc.length, bytes.length);
       bytes.set(enc.subarray(0, n));
       Atomics.store(flag, 1, n); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0);
     }
     function fail(e) { if (sock) sock.destroy(); sock = null; if (pending) finish(JSON.stringify({ ok: false, error: 'gateway unreachable: ' + (e && e.message || e) })); }
     function parse() {
       const end = buf.indexOf('\\r\\n\\r\\n');
       if (end < 0) return;
       const head = buf.subarray(0, end).toString('latin1');
       const m = /content-length:\\s*(\\d+)/i.exec(head);
       const len = m ? +m[1] : 0;
       if (buf.length < end + 4 + len) return;
       const body = buf.subarray(end + 4, end + 4 + len).toString('utf8');
       buf = buf.subarray(end + 4 + len);
       if (/connection:\\s*close/i.test(head)) { sock.destroy(); sock = null; }
       if (pending) finish(body);
     }
     function connect(host, port) {
       sock = net.connect({ host, port, noDelay: true });
       key = host + ':' + port; buf = Buffer.alloc(0);
       sock.on('data', (d) => { buf = buf.length ? Buffer.concat([buf, d]) : d; parse(); });
       sock.on('error', fail);
       sock.on('close', () => { if (pending) fail(new Error('connection closed')); sock = null; });
     }
     parentPort.on('message', ({ url, body, timeoutMs }) => {
       const u = new URL(url);
       const port = +(u.port || 80), host = u.hostname;
       if (!sock || key !== host + ':' + port) connect(host, port);
       pending = true;
       timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);
       const payload = body == null ? '' : body;
       const len = Buffer.byteLength(payload);
       sock.write((body == null ? 'GET ' : 'POST ') + u.pathname + ' HTTP/1.1\\r\\nHost: ' + u.host + '\\r\\nContent-Type: text/plain\\r\\nContent-Length: ' + len + '\\r\\n\\r\\n' + payload);
     });`,
    { eval: true, workerData: shared },
  );
  worker.unref();
  nodeSync = (url, body, timeoutMs) => {
    Atomics.store(flag, 0, 0);
    worker.postMessage({ url, body, timeoutMs });
    Atomics.wait(flag, 0, 0, timeoutMs + 1000);
    if (Atomics.load(flag, 0) !== 1) return JSON.stringify({ ok: false, error: 'gateway timeout' });
    return new TextDecoder().decode(bytes.slice(0, Atomics.load(flag, 1)));
  };
  return nodeSync;
}

/** POST (or GET when `body` is null) and parse JSON, synchronously. Never throws on HTTP errors. */
export function requestSync<T = unknown>(path: string, body: unknown | null, timeoutMs = 60_000): T {
  const url = gatewayUrl() + path;
  const payload = body == null ? null : JSON.stringify(body);
  if (typeof XMLHttpRequest !== 'undefined') {
    const xhr = new XMLHttpRequest();
    try {
      xhr.open(payload == null ? 'GET' : 'POST', url, false);
      if (payload != null) xhr.setRequestHeader('Content-Type', 'text/plain');
      xhr.send(payload);
      return JSON.parse(xhr.responseText) as T;
    } catch (e) {
      return { ok: false, error: `gateway unreachable at ${gatewayUrl()}: ${(e as Error).message ?? e}` } as T;
    }
  }
  const text = nodeTransport()(url, payload as string, timeoutMs);
  try {
    return JSON.parse(text) as T;
  } catch {
    return { ok: false, error: `bad gateway reply: ${text.slice(0, 200)}` } as T;
  }
}

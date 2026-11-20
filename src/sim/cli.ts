/**
 * Bot-vs-bot simulator CLI. Run through `npm run sim -- <options>` (see scripts/sim.mjs).
 *
 *   npm run sim -- --a opus --b gpt                 3v3, 50,000 duplicate hands, all cores
 *   npm run sim -- --seats opus,opus-static,gpt --hands 20000
 *   npm run sim -- --a opus --b gpt --workers 1        one continuous session (max adaptation)
 *   npm run sim -- --bench opus                        decision-speed benchmark
 *   npm run sim -- --list                              list available bots
 */
import { isMainThread, parentPort, workerData, Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { allBots, getBot } from '../bots/registry';
import { mergeResults, runMatch, splitHands, summarize, type MatchConfig, type MatchResult } from './match';

interface WorkerJob {
  cfg: MatchConfig;
}

if (!isMainThread && workerData?.simJob) {
  const job = workerData.simJob as WorkerJob;
  const result = runMatch(job.cfg, getBot, (done) => parentPort!.postMessage({ progress: done }));
  parentPort!.postMessage({ result });
} else if (isMainThread) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, inline] = a.slice(2).split('=', 2);
    if (inline !== undefined) out[k] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

const HELP = `Usage: npm run sim -- [options]
  --a <bot> --b <bot>     Two bots, alternating seats (default 3v3: --size 6)
  --seats a,b,c,...       Explicit bot per seat (2..10 seats)
  --size <n>              Table size for --a/--b (default 6)
  --hands <n>             Decks to play (default 50000; x2 hands with duplicate)
  --no-duplicate          Don't replay each deck with the seats swapped
  --workers <n>           Parallel workers (default: all cores, max 16). Each worker
                          has its own bot instances, so use 1 to let bots adapt over
                          the whole match.
  --seed <n>              Deck seed (default 1)
  --sb/--bb/--ante/--stack  Blinds, ante and per-hand stack (default 5/10/0/1000)
  --json                  Print the raw result as JSON
  --bench <bot>           Measure decisions/second of a bot (vs copies of itself)
  --list                  List bots`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) return console.log(HELP);
  if (args.list) {
    for (const b of allBots) console.log(`${b.id.padEnd(12)} ${b.name} — ${b.description}`);
    return;
  }
  const num = (k: string, d: number) => (args[k] === undefined ? d : Number(args[k]));

  let seats: string[];
  if (typeof args.bench === 'string') {
    seats = Array(num('size', 6)).fill(args.bench);
  } else if (typeof args.seats === 'string') seats = args.seats.split(',').map((s) => s.trim());
  else if (typeof args.a === 'string' && typeof args.b === 'string') {
    const size = num('size', 6);
    seats = Array.from({ length: size }, (_, i) => (i % 2 === 0 ? (args.a as string) : (args.b as string)));
  } else return console.log(HELP);
  for (const s of seats) getBot(s); // validate early

  const hands = num('hands', typeof args.bench === 'string' ? 5000 : 50000);
  const cfg: MatchConfig = {
    seats,
    hands,
    seed: num('seed', 1),
    smallBlind: num('sb', 5),
    bigBlind: num('bb', 10),
    ante: num('ante', 0),
    stack: num('stack', 1000),
    duplicate: !args['no-duplicate'],
  };
  const workers = Math.max(1, Math.min(num('workers', Math.min(16, availableParallelism())), hands));
  const t0 = performance.now();
  const result = workers === 1 ? runMatch(cfg, getBot, progress(hands)) : await runParallel(cfg, workers);
  const wall = performance.now() - t0;
  process.stderr.write('\r\x1b[K');
  if (args.json) return console.log(JSON.stringify({ ...result, wallMs: wall }, null, 2));
  report(result, wall, workers);
}

function progress(total: number) {
  let last = 0;
  return (done: number) => {
    const t = performance.now();
    if (t - last < 200 && done < total) return;
    last = t;
    process.stderr.write(`\r\x1b[K  ${((100 * done) / total).toFixed(0)}%  ${done}/${total} decks`);
  };
}

function runParallel(cfg: MatchConfig, workers: number): Promise<MatchResult> {
  const ranges = splitHands(cfg.hands, workers);
  const done = new Array(ranges.length).fill(0);
  const tick = progress(cfg.hands);
  return Promise.all(
    ranges.map(
      (r, i) =>
        new Promise<MatchResult>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), { workerData: { simJob: { cfg: { ...cfg, ...r, seed: cfg.seed } } satisfies WorkerJob } });
          w.on('message', (m: { progress?: number; result?: MatchResult }) => {
            if (m.progress !== undefined) {
              done[i] = m.progress;
              tick(done.reduce((a, b) => a + b, 0));
            }
            if (m.result) {
              resolve(m.result);
              void w.terminate();
            }
          });
          w.on('error', reject);
        }),
    ),
  ).then(mergeResults);
}

function report(r: MatchResult, wallMs: number, workers: number) {
  const rows = summarize(r);
  const totalHands = r.hands * r.tables;
  console.log(`\n${r.seats.length}-max · seats ${r.seats.join(', ')}`);
  console.log(
    `${r.hands.toLocaleString()} decks × ${r.tables} table${r.tables > 1 ? 's (duplicate)' : ''} = ${totalHands.toLocaleString()} hands in ${(wallMs / 1000).toFixed(1)}s on ${workers} worker${workers > 1 ? 's' : ''} (${Math.round(totalHands / (wallMs / 1000)).toLocaleString()} hands/s)\n`,
  );
  const head = ['bot', 'bb/100', '±95%', 'net chips', 'VPIP', 'PFR', 'W$SD', 'decisions', 'µs/dec', 'dec/s', 'invalid', 'errors'];
  const lines = rows
    .sort((a, b) => b.bb100 - a.bb100)
    .map((x) => [
      x.id,
      x.bb100.toFixed(2),
      Number.isNaN(x.ci95) ? '—' : x.ci95.toFixed(2),
      x.netChips.toLocaleString(),
      x.vpipPct.toFixed(1) + '%',
      x.pfrPct.toFixed(1) + '%',
      x.wsdPct.toFixed(1) + '%',
      x.decisions.toLocaleString(),
      x.usPerDecision.toFixed(2),
      Number.isFinite(x.decisionsPerSec) ? Math.round(x.decisionsPerSec).toLocaleString() : '∞',
      String(x.invalid),
      String(x.errors),
    ]);
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  console.log(fmt(head));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const l of lines) console.log(fmt(l));
  const slow = rows.filter((x) => x.decisionsPerSec < 10000);
  if (slow.length) console.log(`\n⚠ Below 10,000 decisions/s: ${slow.map((x) => x.id).join(', ')}`);
  if (rows.length === 2 && !Number.isNaN(rows[0].ci95)) {
    const [w] = rows;
    const sig = Math.abs(w.bb100) > w.ci95;
    console.log(`\n${sig ? `${w.id} wins (significant at 95%)` : 'No significant difference at 95% — play more hands'}.`);
  }
}

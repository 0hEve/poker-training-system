import { useEffect, useRef, useState } from 'react';
import { allBots } from '../bots/registry';
import { mergeResults, splitHands, summarize, type BotReport, type MatchConfig, type MatchResult } from '../sim/match';

/**
 * Bot arena: plays two bots against each other headlessly (default 3v3 at a 6-max
 * table, 50,000 duplicate decks) across several Web Workers and reports bb/100.
 */
export function Arena() {
  const ids = allBots.map((b) => b.id);
  const [a, setA] = useState(ids[0] ?? '');
  const [b, setB] = useState(ids[1] ?? ids[0] ?? '');
  const [size, setSize] = useState(6);
  const [hands, setHands] = useState(50000);
  const [duplicate, setDuplicate] = useState(true);
  const [workers, setWorkers] = useState(Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 4) - 1)));
  const [progress, setProgress] = useState<number | null>(null);
  const [report, setReport] = useState<{ rows: BotReport[]; result: MatchResult; wallMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<Worker[]>([]);

  const stop = () => {
    running.current.forEach((w) => w.terminate());
    running.current = [];
    setProgress(null);
  };
  useEffect(() => stop, []);

  const start = () => {
    stop();
    setReport(null);
    setError(null);
    const seats = Array.from({ length: size }, (_, i) => (i % 2 === 0 ? a : b));
    const cfg: MatchConfig = { seats, hands, seed: (Math.random() * 1e9) | 0, duplicate };
    const ranges = splitHands(hands, Math.min(workers, hands));
    const done = new Array(ranges.length).fill(0);
    const parts: MatchResult[] = [];
    const t0 = performance.now();
    setProgress(0);
    running.current = ranges.map((r, i) => {
      const w = new Worker(new URL('../sim/arena.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ progress?: number; result?: MatchResult; error?: string }>) => {
        if (e.data.error) {
          setError(e.data.error);
          stop();
          return;
        }
        if (e.data.progress !== undefined) {
          done[i] = e.data.progress;
          setProgress(done.reduce((x, y) => x + y, 0) / hands);
        }
        if (e.data.result) {
          parts.push(e.data.result);
          w.terminate();
          if (parts.length === ranges.length) {
            const result = mergeResults(parts);
            running.current = [];
            setProgress(null);
            setReport({ rows: summarize(result).sort((x, y) => y.bb100 - x.bb100), result, wallMs: performance.now() - t0 });
          }
        }
      };
      w.onerror = (e) => {
        setError(e.message || 'Worker failed');
        stop();
      };
      w.postMessage({ ...cfg, ...r });
      return w;
    });
  };

  const botSelect = (value: string, set: (v: string) => void, label: string) => (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)} disabled={progress !== null}>
        {allBots.map((bot) => (
          <option key={bot.id} value={bot.id}>
            {bot.name} ({bot.id})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="arena">
      <p className="hint">Pit two bots against each other at full speed. Seats alternate A, B, A, B…; with duplicate on, every deck is replayed with the bots' seats swapped.</p>
      {botSelect(a, setA, 'Bot A')}
      {botSelect(b, setB, 'Bot B')}
      <label className="field">
        <span>Seats</span>
        <input className="num" type="number" min={2} max={10} value={size} onChange={(e) => setSize(Math.max(2, Math.min(10, Number(e.target.value) || 6)))} />
      </label>
      <label className="field">
        <span>Decks</span>
        <input className="num" type="number" min={100} step={1000} value={hands} onChange={(e) => setHands(Math.max(1, Math.floor(Number(e.target.value) || 0)))} />
      </label>
      <label className="field">
        <span>Workers</span>
        <input className="num" type="number" min={1} max={32} value={workers} onChange={(e) => setWorkers(Math.max(1, Math.min(32, Number(e.target.value) || 1)))} />
      </label>
      <label className="check">
        <input type="checkbox" checked={duplicate} onChange={(e) => setDuplicate(e.target.checked)} /> Duplicate (swap seats, same cards)
      </label>
      <div className="arena-actions">
        {progress === null ? (
          <button className="btn btn-primary" onClick={start} disabled={!a || !b}>
            Run {(hands * (duplicate && a !== b ? 2 : 1)).toLocaleString()} hands
          </button>
        ) : (
          <>
            <div className="progress">
              <div style={{ width: `${(progress * 100).toFixed(1)}%` }} />
            </div>
            <button className="btn small ghost" onClick={stop}>
              Stop
            </button>
          </>
        )}
      </div>
      {error && <p className="arena-error">{error}</p>}
      {report && <ArenaReport {...report} />}
    </div>
  );
}

function ArenaReport({ rows, result, wallMs }: { rows: BotReport[]; result: MatchResult; wallMs: number }) {
  const total = result.hands * result.tables;
  const [w] = rows;
  const significant = rows.length === 2 && !Number.isNaN(w.ci95) && Math.abs(w.bb100) > w.ci95;
  return (
    <div className="arena-report">
      <p className="muted">
        {total.toLocaleString()} hands in {(wallMs / 1000).toFixed(1)}s ({Math.round(total / (wallMs / 1000)).toLocaleString()} hands/s)
      </p>
      <table>
        <thead>
          <tr>
            <th>Bot</th>
            <th>bb/100</th>
            <th>±95%</th>
            <th>VPIP</th>
            <th>PFR</th>
            <th>µs/dec</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td className={r.bb100 >= 0 ? 'pos' : 'neg'}>{r.bb100.toFixed(2)}</td>
              <td>{Number.isNaN(r.ci95) ? '—' : r.ci95.toFixed(2)}</td>
              <td>{r.vpipPct.toFixed(0)}%</td>
              <td>{r.pfrPct.toFixed(0)}%</td>
              <td className={r.decisionsPerSec < 10000 ? 'neg' : ''}>{r.usPerDecision.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 2 && <p className="hint">{significant ? `${w.id} wins (significant at 95%).` : 'No significant difference yet — run more hands.'}</p>}
      {rows.some((r) => r.invalid || r.errors) && (
        <p className="arena-error">Illegal actions / errors: {rows.map((r) => `${r.id} ${r.invalid}/${r.errors}`).join(', ')}</p>
      )}
    </div>
  );
}

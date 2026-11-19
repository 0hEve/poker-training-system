import { useMemo, useState } from 'react';
import { allBots, findBot } from '../../bots/registry';
import { seatProblem, selectable, statusNote, statusTitle, useGatewayStatus } from '../../bots/remote/status';
import type { BankrollConfig, BankrollPlayer } from '../../sim/bankroll';
import { DealerButton } from '../Chips';
import { chipStackAspect, chipStackURL } from '../../art';
import { LineChart, Legend, compact, signed } from './charts';
import type { Bankroll as BankrollHook } from './useBankroll';

/** Categorical player colours (validated on the paper surface); seats 9-10 reuse 1-2 with dashed lines. */
export const PLAYER_SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const colorOf = (i: number) => PLAYER_SERIES[i % PLAYER_SERIES.length];
const dashedOf = (i: number) => i >= PLAYER_SERIES.length;

const SPEEDS = [
  { v: 2, label: '🐢 2/s' },
  { v: 20, label: '20/s' },
  { v: 200, label: '200/s' },
  { v: 2000, label: '2,000/s' },
  { v: 0, label: '⚡ Max' },
];
const LENGTHS = [
  { v: 1000, label: '1K hands' },
  { v: 10000, label: '10K' },
  { v: 100000, label: '100K' },
  { v: Infinity, label: 'Until one is left' },
];
/** New seats cycle through these bots. */
const DEFAULT_LINEUP = ['opus', 'gpt', 'tag', 'station', 'random', 'opus', 'gpt', 'tag', 'station', 'random'];

const botName = (id: string) => (findBot(id)?.name ?? id).replace(/\s*\(.*\)$/, '');

interface Seat {
  bot: string;
  name: string;
}

function autoNames(bots: string[]): string[] {
  const total = new Map<string, number>();
  bots.forEach((b) => total.set(b, (total.get(b) ?? 0) + 1));
  const seen = new Map<string, number>();
  return bots.map((b) => {
    const k = (seen.get(b) ?? 0) + 1;
    seen.set(b, k);
    return total.get(b)! > 1 ? `${botName(b)} #${k}` : botName(b);
  });
}

const available = (id: string) => (allBots.some((b) => b.id === id) ? id : (allBots[0]?.id ?? id));

export function Bankroll({ bank }: { bank: BankrollHook }) {
  const { state } = bank;
  const gw = useGatewayStatus();
  const live = state.status === 'running' || state.status === 'paused';
  const [count, setCount] = useState(6);
  const [bots, setBots] = useState<string[]>(() => DEFAULT_LINEUP.map(available));
  const [customNames, setCustomNames] = useState<(string | null)[]>(() => new Array(10).fill(null));
  const [stack, setStack] = useState(1000);
  const [sb, setSb] = useState(5);
  const [bb, setBb] = useState(10);
  const [rebuy, setRebuy] = useState(false);
  const [length, setLength] = useState<number>(Infinity);
  const [seed, setSeed] = useState<number | null>(null);

  const seatBots = bots.slice(0, count);
  const names = autoNames(seatBots).map((n, i) => customNames[i]?.trim() || n);
  const seats: Seat[] = seatBots.map((bot, i) => ({ bot, name: names[i] }));
  const seatIssues = [...new Set(seatBots)].map((b) => seatProblem(b, count, gw)).filter((x): x is string => !!x);
  const valid = bb > 0 && sb >= 0 && sb <= bb && stack >= bb && seatIssues.length === 0;
  const maxHands = !rebuy || Number.isFinite(length) ? length : 10000;

  const begin = () => {
    const cfg: BankrollConfig = {
      players: seats.map((s) => s.bot),
      names: seats.map((s) => s.name),
      stack,
      smallBlind: sb,
      bigBlind: bb,
      seed: seed ?? (Math.random() * 2 ** 31) >>> 0,
      rebuy,
      maxHands,
    };
    bank.start(cfg, state.speed);
  };

  return (
    <div className="sim">
      <aside className="sim-setup sketch-panel">
        <h2 className="sim-h2">Bankroll session</h2>
        <p className="hint">Everyone starts with the same stack. Stacks carry over from hand to hand and the blinds never change, so you can watch the money move.</p>

        <div className="sim-field">
          <span className="sim-label">Players</span>
          <div className="chip-row">
            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button key={n} className={`mini ${count === n ? 'on' : ''}`} disabled={live} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <ol className="seat-list">
          {seats.map((s, i) => (
            <li key={i}>
              <span className={`viz-swatch big ${dashedOf(i) ? 'ring' : ''}`} style={{ background: colorOf(i) }} />
              <input
                className="seat-name"
                value={customNames[i] ?? s.name}
                disabled={live}
                onChange={(e) => setCustomNames((c) => c.map((x, j) => (j === i ? e.target.value : x)))}
                aria-label={`Seat ${i + 1} name`}
              />
              <select
                value={s.bot}
                disabled={live}
                onChange={(e) => {
                  const v = e.target.value;
                  setBots((b) => b.map((x, j) => (j === i ? v : x)));
                  setCustomNames((c) => c.map((x, j) => (j === i ? null : x)));
                }}
                aria-label={`Seat ${i + 1} bot`}
              >
                {allBots.map((b) => (
                  <option key={b.id} value={b.id} title={statusTitle(b.id, gw)} disabled={!selectable(b.id, gw)}>
                    {b.name}
                    {statusNote(b.id, gw)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ol>
        {seatIssues.map((m) => (
          <p key={m} className="hint seat-warning">
            ⚠ {m} Pick another bot or change the number of players.
          </p>
        ))}

        <div className="sim-field sim-three">
          <label>
            <span className="sim-label">Starting stack</span>
            <input className="num sim-num" type="number" min={1} value={stack} disabled={live} onChange={(e) => setStack(Math.max(1, Math.floor(Number(e.target.value) || 0)))} />
          </label>
          <label>
            <span className="sim-label">Small blind</span>
            <input className="num sim-num" type="number" min={0} value={sb} disabled={live} onChange={(e) => setSb(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
          </label>
          <label>
            <span className="sim-label">Big blind</span>
            <input className="num sim-num" type="number" min={1} value={bb} disabled={live} onChange={(e) => setBb(Math.max(1, Math.floor(Number(e.target.value) || 0)))} />
          </label>
        </div>
        <p className="hint">
          {valid || seatIssues.length
            ? `= ${+(stack / bb).toFixed(1)} big blinds each. Blinds stay ${sb}/${bb} for the whole session.`
            : 'The small blind must not exceed the big blind, and the stack must cover the big blind.'}
        </p>

        <div className="sim-field">
          <span className="sim-label">When a player goes broke</span>
          <div className="chip-row">
            <button className={`mini ${!rebuy ? 'on' : ''}`} disabled={live} onClick={() => setRebuy(false)}>
              They're out
            </button>
            <button className={`mini ${rebuy ? 'on' : ''}`} disabled={live} onClick={() => setRebuy(true)}>
              They rebuy
            </button>
          </div>
        </div>

        <div className="sim-field">
          <span className="sim-label">Length</span>
          <div className="chip-row">
            {LENGTHS.filter((l) => !rebuy || Number.isFinite(l.v)).map((l) => (
              <button key={l.label} className={`mini ${maxHands === l.v ? 'on' : ''}`} disabled={live} onClick={() => setLength(l.v)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <label className="sim-field">
          <span className="sim-label">Seed</span>
          <input
            className="num sim-num"
            type="number"
            placeholder="random"
            value={seed ?? ''}
            disabled={live}
            onChange={(e) => setSeed(e.target.value === '' ? null : Math.abs(Math.floor(Number(e.target.value))))}
          />
        </label>

        <SpeedControl speed={state.speed} onChange={bank.setSpeed} />

        <div className="bank-actions">
          {state.status === 'running' && (
            <button className="btn sim-run" onClick={bank.pause}>
              ❚❚ Pause
            </button>
          )}
          {state.status === 'paused' && (
            <button className="btn btn-primary sim-run" onClick={bank.resume}>
              ▶ Resume
            </button>
          )}
          {live ? (
            <button className="btn ghost" onClick={bank.reset}>
              ■ Stop
            </button>
          ) : (
            <button className="btn btn-primary sim-run" disabled={!valid} onClick={begin}>
              ▶ Start session
            </button>
          )}
        </div>
      </aside>

      <section className="sim-board">
        {state.status === 'error' && <div className="sketch-panel sim-card sim-error">The session failed: {state.error}</div>}
        {state.snapshot ? <BankrollBoard bank={bank} /> : state.status !== 'error' && <BankrollEmpty seats={seats} stack={stack} onStart={begin} valid={valid} />}
      </section>
    </div>
  );
}

function SpeedControl({ speed, onChange }: { speed: number; onChange: (v: number) => void }) {
  return (
    <div className="sim-field">
      <span className="sim-label">Speed (change any time)</span>
      <div className="chip-row">
        {SPEEDS.map((s) => (
          <button key={s.v} className={`mini ${speed === s.v ? 'on' : ''}`} onClick={() => onChange(s.v)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function BankrollEmpty({ seats, stack, onStart, valid }: { seats: Seat[]; stack: number; onStart: () => void; valid: boolean }) {
  return (
    <div className="sketch-panel sim-card sim-empty">
      <h2>Watch the money move</h2>
      <p>
        {seats.length} players sit down with {stack.toLocaleString()} chips each and play hand after hand. You'll see every stack as a chip pile, a chart of each stack over
        time, and a leaderboard. Slow it down to follow single hands or go to max speed for thousands of hands.
      </p>
      <div className="bank-preview">
        {seats.map((s, i) => (
          <span key={i} className="bank-chip-name">
            <span className="viz-swatch" style={{ background: colorOf(i) }} /> {s.name}
          </span>
        ))}
      </div>
      <button className="btn btn-primary" disabled={!valid} onClick={onStart}>
        ▶ Start session
      </button>
    </div>
  );
}

function BankrollBoard({ bank }: { bank: BankrollHook }) {
  const { state } = bank;
  const snap = state.snapshot!;
  const cfg = state.cfg!;
  const total = cfg.stack * cfg.players.length;
  const alive = snap.players.filter((p) => p.stack > 0).length;
  const leader = snap.players.reduce((best, p, i) => (p.stack > snap.players[best].stack ? i : best), 0);
  const finite = Number.isFinite(cfg.maxHands);
  const unit = pileUnit(cfg.stack, Math.max(...snap.players.map((p) => p.stack)));
  const winner = snap.done && !cfg.rebuy && alive === 1 ? snap.players.find((p) => p.stack > 0) : null;

  const series = useMemo(
    () =>
      snap.players.map((p, i) => ({
        label: p.name,
        color: colorOf(i),
        dashed: dashedOf(i),
        points: state.history.map((h): [number, number] => [h.hand, h.stacks[i]]),
      })),
    [state.history, snap.players],
  );

  const status =
    state.status === 'done'
      ? winner
        ? `${winner.name} won every chip after ${snap.hand.toLocaleString()} hands`
        : `Finished: ${snap.hand.toLocaleString()} hands`
      : state.status === 'paused'
        ? 'Paused'
        : `Playing · ${state.speed === 0 ? 'max speed' : `${state.speed.toLocaleString()} hands/s`}${state.rate ? ` (${compact(state.rate)}/s actual)` : ''}`;

  return (
    <div className="report">
      <div className="sketch-panel sim-card bank-head">
        <div>
          <h2 className="sim-h2">
            Hand {snap.hand.toLocaleString()}
            {finite ? <span className="muted"> / {cfg.maxHands.toLocaleString()}</span> : null}
          </h2>
          <p className="muted bank-sub">
            {status} · {cfg.rebuy ? 'busted players rebuy' : `${alive} of ${cfg.players.length} players left`} · blinds {cfg.smallBlind}/{cfg.bigBlind} · seed {cfg.seed}
          </p>
        </div>
        {finite && (
          <div className="progress bank-progress">
            <div style={{ width: `${Math.min(100, (100 * snap.hand) / cfg.maxHands).toFixed(1)}%` }} />
          </div>
        )}
      </div>

      <div className="bank-piles">
        {snap.players.map((p, i) => (
          <PileCard
            key={i}
            p={p}
            i={i}
            start={cfg.stack}
            bb={cfg.bigBlind}
            total={total}
            unit={unit}
            leader={i === leader && p.stack > 0}
            button={i === snap.button && !snap.done}
          />
        ))}
      </div>

      <div className="sketch-panel sim-card">
        <h3 className="sim-h3">Stacks over the session (chips)</h3>
        <Legend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
        <LineChart height={300} xTitle="Hands played" formatY={compact} tooltipTitle={(x) => `After hand ${x.toLocaleString()}`} series={series} sortTooltip />
        <p className="hint chart-note">
          Everyone starts at {cfg.stack.toLocaleString()}.{cfg.rebuy ? ' A rebuy shows as a jump back up to the starting stack.' : ' A line that hits zero is a player going broke.'}
        </p>
      </div>

      <div className="sketch-panel sim-card">
        <h3 className="sim-h3">Leaderboard</h3>
        <Leaderboard players={snap.players} bb={cfg.bigBlind} rebuy={cfg.rebuy} />
      </div>
    </div>
  );
}

function PileCard({
  p,
  i,
  start,
  bb,
  total,
  leader,
  button,
  unit,
}: {
  p: BankrollPlayer;
  i: number;
  start: number;
  bb: number;
  total: number;
  leader: boolean;
  button: boolean;
  unit: number;
}) {
  const delta = p.net;
  const out = p.bustedAt !== null;
  return (
    <div className={`sketch-panel pile-card ${out ? 'out' : ''}`}>
      <div className="pile-head">
        <span className={`viz-swatch big ${dashedOf(i) ? 'ring' : ''}`} style={{ background: colorOf(i) }} />
        <span className="pile-name" title={findBot(p.bot)?.name}>
          {p.name}
        </span>
        {leader && <span title="Chip leader">👑</span>}
        {button && (
          <span className="pile-dealer" title="Dealer button">
            <DealerButton size={18} />
          </span>
        )}
      </div>
      <div className="pile-chips">{p.stack > 0 ? <GrowPile stack={p.stack} unit={unit} start={start} /> : <span className="pile-empty">no chips</span>}</div>
      <div className="pile-stack num">{p.stack.toLocaleString()}</div>
      <div className={`pile-delta num ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}`}>
        {delta === 0 ? 'even' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString()} (${signed(delta / bb, 0)} bb)`}
      </div>
      <div className="pile-share" title="Share of all chips at the table">
        <div style={{ width: `${Math.min(100, (100 * p.stack) / Math.max(1, total + p.rebuys * start)).toFixed(1)}%`, background: colorOf(i) }} />
      </div>
      <div className="pile-foot muted">
        {out ? `out after hand ${p.bustedAt!.toLocaleString()}` : p.rebuys ? `${p.rebuys} rebuy${p.rebuys > 1 ? 's' : ''}` : `${p.handsPlayed.toLocaleString()} hands`}
      </div>
    </div>
  );
}

function Leaderboard({ players, bb, rebuy }: { players: BankrollPlayer[]; bb: number; rebuy: boolean }) {
  const rows = players.map((p, i) => ({ p, i })).sort((a, b) => b.p.net - a.p.net || (b.p.bustedAt ?? Infinity) - (a.p.bustedAt ?? Infinity));
  return (
    <table className="stats-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>Bot</th>
          <th>Stack</th>
          <th>Won / lost</th>
          <th title="Big blinds won per 100 hands played">bb/100</th>
          <th>Hands won</th>
          <th>Biggest pot</th>
          <th>{rebuy ? 'Rebuys' : 'Status'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ p, i }, rank) => (
          <tr key={i}>
            <td>{rank + 1}</td>
            <td>
              <span className="viz-swatch" style={{ background: colorOf(i) }} /> {p.name}
            </td>
            <td className="muted">{botName(p.bot)}</td>
            <td className="num">{p.stack.toLocaleString()}</td>
            <td className={`num ${p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : ''}`}>{p.net > 0 ? '+' : ''}{p.net.toLocaleString()}</td>
            <td className="num">{p.handsPlayed ? signed((p.net / bb / p.handsPlayed) * 100, 1) : '—'}</td>
            <td className="num">{p.handsPlayed ? `${((100 * p.handsWon) / p.handsPlayed).toFixed(1)}%` : '—'}</td>
            <td className="num">{p.biggestPot.toLocaleString()}</td>
            <td>{rebuy ? p.rebuys : p.bustedAt !== null ? `out at hand ${p.bustedAt.toLocaleString()}` : p.stack > 0 ? 'playing' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const COLUMN_COLORS = [100, 25, 500, 5, 1000, 1];
const PER_COLUMN = 10;
const MAX_COLUMNS = 6;
const columnURL = new Map<string, string>();
function column(value: number, n: number) {
  const k = `${value}x${n}`;
  let u = columnURL.get(k);
  if (!u) columnURL.set(k, (u = chipStackURL(new Array(n).fill(value))));
  return u;
}

/**
 * A pile whose size tracks the stack. Every pile at the table uses the same chip value
 * (a tenth of the starting stack, doubled while the biggest stack wouldn't fit), so piles
 * can be compared at a glance.
 */
export function pileUnit(start: number, biggest: number): number {
  let unit = start / PER_COLUMN;
  while (biggest / unit > PER_COLUMN * MAX_COLUMNS) unit *= 2;
  return unit;
}

function GrowPile({ stack, unit, start }: { stack: number; unit: number; start: number }) {
  const chips = Math.max(1, Math.round(stack / unit));
  const scale = unit / (start / PER_COLUMN);
  const cols: number[] = [];
  for (let left = chips; left > 0; left -= PER_COLUMN) cols.push(Math.min(PER_COLUMN, left));
  const w = 22;
  return (
    <div className="grow-pile" title={`1 chip = ${Math.round(unit).toLocaleString()}`}>
      <div className="grow-cols">
        {cols.map((n, i) => (
          <img key={i} src={column(COLUMN_COLORS[i % COLUMN_COLORS.length], n)} style={{ width: w, height: w / chipStackAspect(n) }} alt="" draggable={false} />
        ))}
      </div>
      {scale > 1 && <span className="grow-scale">1 chip = {Math.round(unit).toLocaleString()}</span>}
    </div>
  );
}

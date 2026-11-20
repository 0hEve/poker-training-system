import { useMemo, useState } from 'react';
import { allBots, findBot } from '../../bots/registry';
import { ACT_KINDS, positionNames, summarize, type BotReport } from '../../sim/match';
import { ACTION_COLORS, ACTION_LABELS, GroupedBars, Legend, LineChart, SERIES, StackedRows, compact, signed } from './charts';
import { Bankroll } from './Bankroll';
import type { Bankroll as BankrollHook } from './useBankroll';
import { FORMATS, canRun, defaultWorkers, seatsFor, seatsPerDeck, type FormatId, type SimConfig, type SimRun, type Simulation } from './useSimulation';

const botName = (id: string) => findBot(id)?.name ?? id;
const DECK_PRESETS = [5000, 20000, 50000, 200000];
const STREETS = ['Preflop', 'Flop', 'Turn', 'River'];
const CURVE_COLORS = { total: SERIES[0], sd: '#1baf7a', nonSd: '#e34948' };
const REQUIRED_DPS = 10000;

export function Simulator({
  sim,
  bank,
  tab,
  onPlay,
}: {
  sim: Simulation;
  bank: BankrollHook;
  tab: 'match' | 'bankroll';
  onTab: (t: 'match' | 'bankroll') => void;
  onPlay: (botIds: string[]) => void;
}) {
  if (tab === 'bankroll') return <Bankroll bank={bank} />;
  return <HeadToHead sim={sim} onPlay={onPlay} />;
}

function HeadToHead({ sim, onPlay }: { sim: Simulation; onPlay: (botIds: string[]) => void }) {
  const { state } = sim;
  const running = state.status === 'running';
  const [cfg, setCfg] = useState<SimConfig>(
    () => state.config ?? { a: 'opus', b: 'gpt', format: '3v3', hands: 50000, duplicate: true, workers: defaultWorkers(), seed: null },
  );
  const set = (patch: Partial<SimConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const twoBots = cfg.a !== cfg.b;
  const totalHands = cfg.hands * (cfg.duplicate && twoBots ? 2 : 1);

  return (
    <div className="sim">
      <aside className="sim-setup sketch-panel">
        <h2 className="sim-h2">Match setup</h2>
        <div className="sim-versus">
          <BotPicker label="Bot A" color={SERIES[0]} value={cfg.a} onChange={(a) => set({ a })} disabled={running} />
          <div className="sim-vs">vs</div>
          <BotPicker label="Bot B" color={SERIES[1]} value={cfg.b} onChange={(b) => set({ b })} disabled={running} />
        </div>

        <div className="sim-field">
          <span className="sim-label">Format</span>
          <div className="chip-row">
            {(Object.keys(FORMATS) as FormatId[]).map((f) => (
              <button key={f} className={`mini ${cfg.format === f ? 'on' : ''}`} disabled={running} onClick={() => set({ format: f })} title={FORMATS[f].detail}>
                {FORMATS[f].label}
              </button>
            ))}
          </div>
          <SeatStrip seats={seatsFor(cfg)} a={cfg.a} />
        </div>

        <div className="sim-field">
          <span className="sim-label">Decks</span>
          <div className="chip-row">
            {DECK_PRESETS.map((n) => (
              <button key={n} className={`mini ${cfg.hands === n ? 'on' : ''}`} disabled={running} onClick={() => set({ hands: n })}>
                {compact(n)}
              </button>
            ))}
            <input
              className="num sim-num"
              type="number"
              min={100}
              step={1000}
              value={cfg.hands}
              disabled={running}
              onChange={(e) => set({ hands: Math.max(100, Math.min(5_000_000, Math.floor(Number(e.target.value) || 0))) })}
              aria-label="Number of decks"
            />
          </div>
        </div>

        <label className="sim-check">
          <input type="checkbox" checked={cfg.duplicate} disabled={running} onChange={(e) => set({ duplicate: e.target.checked })} />
          <span>
            <b>Duplicate</b> — replay every deck with the bots' seats swapped, so card luck cancels out
          </span>
        </label>

        <div className="sim-field sim-two">
          <label>
            <span className="sim-label">Workers</span>
            <input
              className="num sim-num"
              type="number"
              min={1}
              max={32}
              value={cfg.workers}
              disabled={running}
              onChange={(e) => set({ workers: Math.max(1, Math.min(32, Number(e.target.value) || 1)) })}
            />
          </label>
          <label>
            <span className="sim-label">Seed</span>
            <input
              className="num sim-num"
              type="number"
              placeholder="random"
              value={cfg.seed ?? ''}
              disabled={running}
              onChange={(e) => set({ seed: e.target.value === '' ? null : Math.abs(Math.floor(Number(e.target.value))) })}
            />
          </label>
        </div>
        <p className="hint">
          More workers finish faster; with 1 worker every bot plays one long session and can adapt to its opponents across all hands. Leave the seed empty for new cards
          each run.
        </p>

        {running ? (
          <button className="btn sim-run" onClick={sim.stop}>
            ■ Stop
          </button>
        ) : (
          <button className="btn btn-primary sim-run" disabled={!cfg.a || !cfg.b} onClick={() => sim.start(cfg)}>
            ▶ Run {totalHands.toLocaleString()} hands
          </button>
        )}

        <History runs={state.history} current={state.run?.id ?? null} onShow={sim.show} onForget={sim.forget} disabled={running} />
      </aside>

      <section className="sim-board">
        {state.status === 'error' && <div className="sketch-panel sim-card sim-error">Simulation failed: {state.error}</div>}
        {running && state.config && <LiveRun sim={sim} />}
        {!running && state.run && <Report run={state.run} onPlay={onPlay} onRerun={() => sim.start({ ...state.run!.config, seed: null })} />}
        {!running && !state.run && state.status !== 'error' && <EmptyBoard onRun={() => sim.start(cfg)} cfg={cfg} totalHands={totalHands} />}
      </section>
    </div>
  );
}

function BotPicker({ label, color, value, onChange, disabled }: { label: string; color: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const spec = findBot(value);
  return (
    <div className="bot-pick">
      <div className="bot-pick-head">
        <span className="viz-swatch big" style={{ background: color }} />
        <span className="sim-label">{label}</span>
      </div>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {allBots.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <p className="bot-desc">{spec?.description ?? 'Bot not found'}</p>
    </div>
  );
}

/** The seat layout, button first. */
function SeatStrip({ seats, a }: { seats: string[]; a: string }) {
  return (
    <div className="seat-strip" aria-label="Seat layout">
      {seats.map((s, i) => (
        <span key={i} className="seat-dot" style={{ background: s === a ? SERIES[0] : SERIES[1] }} title={`Seat ${i + 1}: ${botName(s)}`}>
          {s === a ? 'A' : 'B'}
        </span>
      ))}
      <span className="muted seat-note">{seats.length}-handed · button rotates every hand</span>
    </div>
  );
}

function History({ runs, current, onShow, onForget, disabled }: { runs: SimRun[]; current: string | null; onShow: (r: SimRun) => void; onForget: (id: string) => void; disabled: boolean }) {
  if (!runs.length) return null;
  return (
    <div className="sim-history">
      <span className="sim-label">Past runs</span>
      <ul>
        {runs.map((r) => {
          const rep = headline(r);
          return (
            <li key={r.id} className={r.id === current ? 'on' : ''}>
              <button className="hist-main" disabled={disabled} onClick={() => onShow(r)}>
                <span className="hist-title">
                  {botName(r.config.a)} vs {botName(r.config.b)}
                </span>
                <span className="hist-meta">
                  {FORMATS[r.config.format].label} · {compact(r.result.hands * r.result.tables)} hands · {timeAgo(r.at)}
                </span>
              </button>
              <span className={`hist-score ${rep.a.bb100 >= 0 ? 'pos' : 'neg'}`}>{signed(rep.a.bb100)}</span>
              <button className="hist-x" title="Delete this run" onClick={() => onForget(r.id)}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

function EmptyBoard({ onRun, cfg, totalHands }: { onRun: () => void; cfg: SimConfig; totalHands: number }) {
  return (
    <div className="sketch-panel sim-card sim-empty">
      <h2>Bot vs bot simulator</h2>
      <p>
        Pick two bots on the left and run a match. Hands are played headlessly at full speed across your CPU cores; the results land here with the winner, the margin and how
        sure we are of it, how each bot plays, and how fast each one decides.
      </p>
      <ul className="sim-empty-list">
        <li>
          <b>Winnings over time</b> — total, at showdown and without showdown
        </li>
        <li>
          <b>How sure the result is</b> — the estimate and its 95% range as hands pile up
        </li>
        <li>
          <b>Profit by seat position</b> and <b>action mix by street</b>
        </li>
        <li>
          <b>Speed check</b> — decisions per second against the 10,000/s requirement
        </li>
      </ul>
      <button className="btn btn-primary" onClick={onRun}>
        ▶ Run {botName(cfg.a)} vs {botName(cfg.b)} · {FORMATS[cfg.format].label} · {totalHands.toLocaleString()} hands
      </button>
    </div>
  );
}

function LiveRun({ sim }: { sim: Simulation }) {
  const { state } = sim;
  const c = state.config!;
  const last = state.live[state.live.length - 1];
  const decksDone = Math.round(state.progress * c.hands);
  const eta = state.rate > 0 ? (c.hands - decksDone) / state.rate : NaN;
  const twoBots = c.a !== c.b;
  return (
    <div className="sketch-panel sim-card">
      <div className="live-head">
        <div>
          <h2 className="sim-h2">
            Running {botName(c.a)} vs {botName(c.b)}
          </h2>
          <p className="muted">
            {decksDone.toLocaleString()} / {c.hands.toLocaleString()} decks · {compact(state.rate * (c.duplicate && twoBots ? 2 : 1))} hands/s
            {Number.isFinite(eta) ? ` · about ${Math.max(0, eta).toFixed(eta < 10 ? 1 : 0)}s left` : ''}
          </p>
        </div>
        {last && twoBots && (
          <div className="live-est">
            <span className="tile-label">{botName(c.a)} so far</span>
            <span className={`tile-value ${last.bb100 >= 0 ? 'pos' : 'neg'}`}>{signed(last.bb100)}</span>
            <span className="tile-sub">bb/100 {Number.isFinite(last.ci95) ? `± ${last.ci95.toFixed(1)}` : ''}</span>
          </div>
        )}
      </div>
      <div className="progress big">
        <div style={{ width: `${(state.progress * 100).toFixed(1)}%` }} />
      </div>
      {twoBots && state.live.length > 1 && (
        <>
          <h3 className="sim-h3">Estimate as hands come in</h3>
          <LineChart
            height={260}
            xTitle="Decks played"
            formatY={(v) => signed(v, 0)}
            series={[{ label: `${botName(c.a)} bb/100`, color: SERIES[0], points: state.live.map((p) => [p.decks, p.bb100]) }]}
            band={{ label: '95% range', color: SERIES[0], points: state.live.filter((p) => Number.isFinite(p.ci95)).map((p) => [p.decks, p.bb100 - p.ci95, p.bb100 + p.ci95]) }}
            tooltipTitle={(x) => `${x.toLocaleString()} decks`}
          />
        </>
      )}
    </div>
  );
}

function headline(run: SimRun) {
  const rows = summarize(run.result);
  const a = rows.find((r) => r.id === run.config.a) ?? rows[0];
  const b = rows.find((r) => r.id === run.config.b && r !== a) ?? null;
  return { rows, a, b };
}

function Report({ run, onPlay, onRerun }: { run: SimRun; onPlay: (ids: string[]) => void; onRerun: () => void }) {
  const r = run.result;
  const { a, b } = useMemo(() => headline(run), [run]);
  const bots = b ? [a, b] : [a];
  const color = (id: string) => (id === a.id ? SERIES[0] : SERIES[1]);
  const totalHands = r.hands * r.tables;
  const bb = r.bigBlind;
  const perDeck = seatsPerDeck(r.seats, r.tables === 2);
  const sig = b && Number.isFinite(a.ci95) && Math.abs(a.bb100) > a.ci95;
  const winner = b ? (a.bb100 >= 0 ? a : b) : null;
  const loser = winner && b ? (winner === a ? b : a) : null;

  // Convergence of the first bot's estimate, in deck order; band from the final per-deck spread.
  const deckSd = (() => {
    const d = r.deck;
    const mean = d.sum / Math.max(1, d.n);
    return Math.sqrt(Math.max(0, (d.sumSq - d.n * mean * mean) / Math.max(1, d.n - 1)));
  })();
  const scale = 100 / (bb * perDeck);
  // Skip the first ~2% of decks: a handful of hands gives a huge range that would flatten the rest.
  const minDecks = Math.max(100, r.hands * 0.02);
  const conv = r.curve.x
    .map((x, i): [number, number, number, number] => {
      const n = x - (r.firstHand ?? 0);
      const est = (r.curve.net[i] / n) * scale;
      const ci = (1.96 * deckSd * scale) / Math.sqrt(n);
      return [n, est, est - ci, est + ci];
    })
    .filter((p, i, all) => p[0] >= minDecks || i === all.length - 1);
  const cum = r.curve.x.map((x, i) => ({ n: x - (r.firstHand ?? 0), net: r.curve.net[i] / bb, sd: r.curve.sd[i] / bb }));
  const posNames = positionNames(r.seats.length);

  return (
    <div className="report">
      <div className="sketch-panel sim-card report-head">
        <div className="report-title">
          {winner && loser ? (
            <>
              <h2>
                <span className="viz-swatch big" style={{ background: color(winner.id) }} /> {botName(winner.id)} {sig ? 'beat' : 'edged'} {botName(loser.id)}
              </h2>
              <p className="report-sub">
                <b className={winner.bb100 >= 0 ? 'pos' : 'neg'}>{signed(Math.abs(winner.bb100), 1)} bb/100</b>
                {Number.isFinite(winner.ci95) && <> ± {winner.ci95.toFixed(1)} (95% range)</>} over {totalHands.toLocaleString()} hands —{' '}
                {sig ? <span className="pill good">✓ clear result</span> : <span className="pill warn">⚠ too close to call, run more hands</span>}
              </p>
            </>
          ) : (
            <>
              <h2>{botName(a.id)} self-play</h2>
              <p className="report-sub">Both sides run the same bot, so the expected result is zero; use it to check speed and behaviour.</p>
            </>
          )}
          <p className="muted report-meta">
            {FORMATS[run.config.format].label} · {r.hands.toLocaleString()} decks{r.tables === 2 ? ' × 2 (duplicate)' : ''} · seed {run.seed} · {run.config.workers} worker
            {run.config.workers === 1 ? '' : 's'} · {(run.wallMs / 1000).toFixed(1)}s ({compact(totalHands / (run.wallMs / 1000))} hands/s)
          </p>
        </div>
        <div className="report-actions">
          {bots.filter((x) => findBot(x.id)).map((x) => (
            <button key={x.id} className="btn small" onClick={() => onPlay([x.id])}>
              Play vs {botName(x.id)}
            </button>
          ))}
          {b && canRun(run.config) && (
            <button className="btn small" onClick={() => onPlay([a.id, b.id])}>
              Play vs both
            </button>
          )}
          {canRun(run.config) && (
            <button className="btn small ghost" onClick={onRerun}>
              ↻ Run again, new cards
            </button>
          )}
        </div>
      </div>

      <div className="tiles">
        {bots.map((x) => (
          <div key={x.id} className="sketch-panel tile">
            <span className="tile-label">
              <span className="viz-swatch" style={{ background: color(x.id) }} /> {botName(x.id)}
            </span>
            <span className={`tile-value ${x.bb100 >= 0 ? 'pos' : 'neg'}`}>{signed(x.bb100)}</span>
            <span className="tile-sub">bb/100{Number.isFinite(x.ci95) ? ` · ± ${x.ci95.toFixed(1)}` : ''}</span>
          </div>
        ))}
        {bots.map((x) => (
          <div key={`${x.id}-speed`} className="sketch-panel tile">
            <span className="tile-label">
              <span className="viz-swatch" style={{ background: color(x.id) }} /> {botName(x.id)} speed
            </span>
            <span className="tile-value">{compact(x.decisionsPerSec)}</span>
            <span className="tile-sub">
              {Number.isFinite(x.decisionsPerSec) ? (
                <>
                  decisions/s · {x.usPerDecision.toFixed(1)} µs each{' '}
                  {x.decisionsPerSec >= REQUIRED_DPS ? <span className="pill good">✓ ≥ 10K/s</span> : <span className="pill bad">✕ below 10K/s</span>}
                </>
              ) : 'Timing below measurement resolution'}
            </span>
          </div>
        ))}
        <div className="sketch-panel tile">
          <span className="tile-label">Illegal actions · errors</span>
          <span className="tile-value">{bots.reduce((s, x) => s + x.invalid + x.errors, 0).toLocaleString()}</span>
          <span className="tile-sub">
            {bots.every((x) => !x.invalid && !x.errors) ? (
              <span className="pill good">✓ every move was legal</span>
            ) : (
              bots.map((x) => `${botName(x.id)}: ${x.invalid} illegal, ${x.errors} errors`).join(' · ')
            )}
          </span>
        </div>
      </div>

      <div className="sketch-panel sim-card">
        <h3 className="sim-h3">{botName(a.id)}'s winnings over the match (big blinds)</h3>
        <Legend
          items={[
            { label: 'Total', color: CURVE_COLORS.total },
            { label: 'Won at showdown', color: CURVE_COLORS.sd },
            { label: 'Won without showdown', color: CURVE_COLORS.nonSd, dashed: true },
          ]}
        />
        <LineChart
          height={280}
          xTitle="Decks played"
          formatY={(v) => compact(v)}
          tooltipTitle={(x) => `After ${x.toLocaleString()} decks`}
          series={[
            { label: 'Total', color: CURVE_COLORS.total, points: cum.map((p) => [p.n, p.net]) },
            { label: 'At showdown', color: CURVE_COLORS.sd, points: cum.map((p) => [p.n, p.sd]) },
            { label: 'Without showdown', color: CURVE_COLORS.nonSd, dashed: true, points: cum.map((p) => [p.n, p.net - p.sd]) },
          ]}
        />
        <p className="hint chart-note">
          {b
            ? `${botName(b.id)}'s line is the mirror image: in a two-bot match every chip one bot wins, the other loses.`
            : 'Sum of all seats played by this bot.'}{' '}
          Winning without showdown means the opponents folded.
        </p>
      </div>

      {b && (
        <div className="sketch-panel sim-card">
          <h3 className="sim-h3">How sure is the result? {botName(a.id)}'s bb/100 as hands accumulate</h3>
          <Legend
            items={[
              { label: 'Estimate', color: SERIES[0] },
              { label: '95% range', color: SERIES[0], band: true },
            ]}
          />
          <LineChart
            height={240}
            xTitle="Decks played"
            formatY={(v) => signed(v, 0)}
            tooltipTitle={(x) => `After ${x.toLocaleString()} decks`}
            series={[{ label: 'Estimate', color: SERIES[0], points: conv.map((p) => [p[0], p[1]]) }]}
            band={{ label: '95% range', color: SERIES[0], points: conv.map((p) => [p[0], p[2], p[3]]) }}
          />
          <p className="hint chart-note">When the shaded range no longer crosses zero, the winner is clear.</p>
        </div>
      )}

      <div className="report-grid">
        <div className="sketch-panel sim-card">
          <h3 className="sim-h3">Profit by position (bb/100)</h3>
          <Legend items={bots.map((x) => ({ label: botName(x.id), color: color(x.id) }))} />
          <GroupedBars unit="bb/100" categories={posNames} series={bots.map((x) => ({ label: botName(x.id), color: color(x.id), values: x.posBb100 }))} />
          <p className="hint chart-note">Per seat, counted from the button. In normal play the blinds lose money and the button wins the most.</p>
        </div>
        <div className="sketch-panel sim-card">
          <h3 className="sim-h3">Action mix by street</h3>
          <div className="viz-legend">
            {ACTION_LABELS.map((l, k) => (
              <span key={l} className="viz-legend-item">
                <span className="viz-swatch sq" style={{ background: ACTION_COLORS[k] }} />
                {l}
              </span>
            ))}
          </div>
          <StackedRows
            rows={STREETS.flatMap((st, s) =>
              bots.map((x, i) => ({
                group: i === 0 ? st : undefined,
                label: botName(x.id),
                swatch: color(x.id),
                counts: ACT_KINDS.map((_, k) => r.totals[x.id].acts[s * 5 + k]),
              })),
            )}
          />
          <p className="hint chart-note">Share of each bot's own decisions on that street. Darker = more aggressive.</p>
        </div>
      </div>

      <div className="sketch-panel sim-card">
        <h3 className="sim-h3">Side-by-side stats</h3>
        <StatsTable bots={bots} color={color} />
      </div>
    </div>
  );
}

const STAT_ROWS: { label: string; hint: string; get: (r: BotReport) => string }[] = [
  { label: 'Win rate', hint: 'Big blinds won per 100 hands, per seat', get: (r) => `${signed(r.bb100, 2)} bb/100` },
  { label: '± 95% range', hint: 'Half-width of the 95% confidence interval', get: (r) => (Number.isFinite(r.ci95) ? r.ci95.toFixed(2) : '—') },
  { label: 'Won at showdown', hint: 'bb/100 from hands that reached showdown', get: (r) => signed(r.sdBb100, 1) },
  { label: 'Won without showdown', hint: 'bb/100 from hands where everyone else folded (or this bot folded)', get: (r) => signed(r.nonSdBb100, 1) },
  { label: 'VPIP', hint: 'Voluntarily put chips in preflop', get: (r) => `${r.vpipPct.toFixed(1)}%` },
  { label: 'PFR', hint: 'Raised preflop', get: (r) => `${r.pfrPct.toFixed(1)}%` },
  { label: 'Aggression factor', hint: 'Postflop (bets + raises) ÷ calls', get: (r) => (Number.isFinite(r.af) ? r.af.toFixed(2) : '∞') },
  { label: 'Went to showdown', hint: 'Share of flops seen that reached showdown', get: (r) => `${r.wtsdPct.toFixed(1)}%` },
  { label: 'Won at showdown %', hint: 'Showdowns that made money', get: (r) => `${r.wsdPct.toFixed(1)}%` },
  { label: 'Decisions', hint: 'Total decisions made', get: (r) => r.decisions.toLocaleString() },
  { label: 'Time per decision', hint: 'Mean time inside the bot', get: (r) => `${r.usPerDecision.toFixed(1)} µs` },
  { label: 'Decisions per second', hint: 'Requirement: at least 10,000', get: (r) => compact(r.decisionsPerSec) },
  { label: 'Illegal actions / errors', hint: 'Moves the table had to correct / exceptions', get: (r) => `${r.invalid} / ${r.errors}` },
];

function StatsTable({ bots, color }: { bots: BotReport[]; color: (id: string) => string }) {
  return (
    <table className="stats-table">
      <thead>
        <tr>
          <th />
          {bots.map((x) => (
            <th key={x.id}>
              <span className="viz-swatch" style={{ background: color(x.id) }} /> {botName(x.id)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {STAT_ROWS.map((row) => (
          <tr key={row.label}>
            <td title={row.hint}>
              {row.label}
              <span className="stat-hint">{row.hint}</span>
            </td>
            {bots.map((x) => (
              <td key={x.id} className="num">
                {row.get(x)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

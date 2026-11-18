import { useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../store';
import { handInProgress, playerById, type GameState } from '../engine/game';
import { evaluate } from '../engine/evaluator';
import { formatChips } from '../engine/chips';
import { feltPatternURL, woodRailPatternURL } from '../art';
import { Table } from './Table';
import { ActionBar } from './ActionBar';
import { SidePanel } from './SidePanel';
import { PlayingCard } from './Card';
import { useBots } from './useBots';
import { PlayVsBots, playSeats } from './PlayVsBots';
import { Simulator } from './sim/Simulator';
import { useSimulation } from './sim/useSimulation';
import { useBankroll } from './sim/useBankroll';
import type { PlaySeat } from '../store';

export function App() {
  const { state, dispatch, run } = useAppStore();
  const { game, view, error } = state;
  const h = game.hand;
  const busy = handInProgress(game);
  useBots(game, view, run);
  const sim = useSimulation();
  const bank = useBankroll();
  const simTab = view.simTab ?? 'match';
  const mode = view.mode ?? 'table';
  const setMode = (m: 'table' | 'sim') => dispatch({ kind: 'view', patch: { mode: m } });
  const startPlay = useCallback((seats: PlaySeat[]) => dispatch({ kind: 'setupPlay', seats }), [dispatch]);
  const playAgainst = useCallback((botIds: string[]) => startPlay(playSeats('You', botIds, 6)), [startPlay]);

  const pickViewer = useCallback((id: string) => dispatch({ kind: 'view', patch: { viewerId: id, followAction: false } }), [dispatch]);

  // Keyboard shortcuts: N = next hand, ⌘Z / Ctrl+Z = undo, F = fold, C = check/call.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select') || mode !== 'table') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ kind: 'undo' });
      } else if (e.key.toLowerCase() === 'n' && !busy) run({ type: 'startHand' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, dispatch, run, mode]);

  // Clear errors after a moment.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => dispatch({ kind: 'clearError' }), 3500);
    return () => clearTimeout(t);
  }, [error, dispatch]);

  const textures = useMemo(
    () => ({ ['--felt-tex' as string]: `url("${feltPatternURL()}")`, ['--rail-tex' as string]: `url("${woodRailPatternURL()}")` }),
    [],
  );

  const viewer = view.viewerId ? playerById(game, view.viewerId) : undefined;
  const needsConfirm = !!viewer && view.privacy && view.confirmedViewerId !== viewer.id && busy;

  return (
    <div className="app" style={textures}>
      <header className="top-bar">
        <div className="brand">
          <span className="brand-suits">♠♥</span> Poker Table <span className="brand-suits">♦♣</span>
        </div>
        <nav className="mode-switch" aria-label="Screen">
          <button className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')}>
            🃏 Table
          </button>
          <button className={mode === 'sim' ? 'on' : ''} onClick={() => setMode('sim')}>
            📊 Simulator
            {sim.state.status === 'running' && <span className="mode-badge">{Math.round(sim.state.progress * 100)}%</span>}
            {bank.state.status === 'running' && sim.state.status !== 'running' && <span className="mode-badge">live</span>}
            {sim.state.status === 'done' && mode !== 'sim' && <span className="mode-badge done">new</span>}
          </button>
        </nav>
        {mode === 'table' ? (
          <>
            <div className="top-info">
              {h ? <span>Hand #{h.number}</span> : <span>No hand yet</span>}
              <span>
                Blinds {formatChips(game.settings.smallBlind)}/{formatChips(game.settings.bigBlind)}
                {game.settings.ante ? ` · ante ${game.settings.ante}` : ''}
              </span>
              <SessionScore game={game} viewerId={view.viewerId} />
            </div>
            <div className="top-actions">
          <ViewerSelect game={game} viewerId={view.viewerId} onPick={pickViewer} />
          <button className="btn ghost" disabled={!state.history.length} onClick={() => dispatch({ kind: 'undo' })} title="Undo (⌘Z)">
            ↶ Undo
          </button>
          {busy ? (
            <button className="btn ghost" onClick={() => run({ type: 'abortHand' })} title="Cancel this hand and refund all bets">
              Cancel hand
            </button>
          ) : null}
          <button className="btn btn-primary" disabled={busy} onClick={() => run({ type: 'startHand' })} title="Deal (N)">
            {h ? 'Next hand' : 'Deal'}
          </button>
            </div>
          </>
        ) : (
          <nav className="sim-tabs" aria-label="Simulator mode">
            <button className={simTab === 'match' ? 'on' : ''} onClick={() => dispatch({ kind: 'view', patch: { simTab: 'match' } })}>
              Head-to-head (bb/100)
            </button>
            <button className={simTab === 'bankroll' ? 'on' : ''} onClick={() => dispatch({ kind: 'view', patch: { simTab: 'bankroll' } })}>
              💰 Bankroll session
              {bank.state.status === 'running' && <span className="mode-badge">live</span>}
            </button>
          </nav>
        )}
      </header>

      {mode === 'sim' ? (
        <main className="main main-sim">
          <Simulator sim={sim} bank={bank} tab={simTab} onTab={(t) => dispatch({ kind: 'view', patch: { simTab: t } })} onPlay={playAgainst} />
        </main>
      ) : (
      <main className="main">
        <section className="table-area">
          <Table game={game} view={view} onPickViewer={pickViewer} />
          {!h && <EmptyHint onStart={startPlay} onSim={() => setMode('sim')} />}
          <div className="bottom-dock">
            <ViewerTray game={game} viewerId={view.viewerId} hidden={needsConfirm} />
            <ActionBar game={game} run={run} />
            {h?.result && <ResultBanner game={game} viewerId={view.viewerId} autoDeal={view.autoDeal && !view.botsPaused} onNext={() => run({ type: 'startHand' })} onRebuy={(id) => run({ type: 'adjustStack', id, delta: game.settings.startingStack })} />}
          </div>
          {needsConfirm && (
            <div className="privacy-cover" onClick={() => dispatch({ kind: 'view', patch: { confirmedViewerId: viewer!.id } })}>
              <div className="sketch-panel privacy-card">
                <div className="avatar big" style={{ background: viewer!.color }}>{viewer!.name[0]}</div>
                <h2>Pass to {viewer!.name}</h2>
                <p>Tap anywhere to reveal {viewer!.name}'s cards.</p>
              </div>
            </div>
          )}
        </section>
        <SidePanel game={game} view={view} run={run} dispatch={dispatch} onStartPlay={startPlay} />
      </main>
      )}

      {error && (
        <div className="toast" role="alert" onClick={() => dispatch({ kind: 'clearError' })}>
          {error}
        </div>
      )}
    </div>
  );
}

function ViewerSelect({ game, viewerId, onPick }: { game: GameState; viewerId: string | null; onPick: (id: string) => void }) {
  return (
    <label className="viewer-select">
      <span>Active player</span>
      <select value={viewerId ?? ''} onChange={(e) => e.target.value && onPick(e.target.value)}>
        <option value="">— nobody —</option>
        {game.players.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The active player's own hand, large, with their current best hand. */
function ViewerTray({ game, viewerId, hidden }: { game: GameState; viewerId: string | null; hidden: boolean }) {
  const h = game.hand;
  const seat = h?.seats.find((s) => s.playerId === viewerId);
  const p = viewerId ? playerById(game, viewerId) : undefined;
  if (!p) return null;
  let desc = '';
  if (seat && !hidden && h && h.board.length >= 3) desc = evaluate([...seat.hole, ...h.board]).description;
  return (
    <div className="viewer-tray sketch-panel">
      <div className="tray-title">
        <span className="dot" style={{ background: p.color }} /> {/^you$/i.test(p.name) ? 'Your hand' : `${p.name}'s hand`}
      </div>
      <div className="tray-cards">
        {seat ? (
          <>
            <PlayingCard key={`${h!.number}-ta`} card={seat.hole[0]} faceUp={!hidden} width={78} className="tray-card deal-in" />
            <PlayingCard key={`${h!.number}-tb`} card={seat.hole[1]} faceUp={!hidden} width={78} className="tray-card deal-in" />
          </>
        ) : (
          <span className="muted">Not in this hand</span>
        )}
      </div>
      <div className="tray-desc">{seat?.folded ? 'Folded' : desc || ' '}</div>
    </div>
  );
}

/** The viewing human's result since the table was set up, in big blinds. */
function SessionScore({ game, viewerId }: { game: GameState; viewerId: string | null }) {
  const p = viewerId ? playerById(game, viewerId) : undefined;
  if (!p || p.bot || !game.players.some((x) => x.bot)) return null;
  const bb = (p.stack + (handInProgress(game) ? game.hand!.seats.find((s) => s.playerId === p.id)?.total ?? 0 : 0) - game.settings.startingStack) / game.settings.bigBlind;
  return (
    <span className={`session-score ${bb > 0 ? 'pos' : bb < 0 ? 'neg' : ''}`} title="Your chips compared with the starting stack (rebuys count as losses)">
      {p.name}: {Math.abs(bb) < 0.05 ? 'even' : `${bb > 0 ? '+' : ''}${bb.toFixed(1)} bb`}
    </span>
  );
}

function ResultBanner({
  game,
  viewerId,
  autoDeal,
  onNext,
  onRebuy,
}: {
  game: GameState;
  viewerId: string | null;
  autoDeal: boolean;
  onNext: () => void;
  onRebuy: (id: string) => void;
}) {
  const r = game.hand!.result!;
  const name = (id: string) => playerById(game, id)?.name ?? '?';
  const me = viewerId ? playerById(game, viewerId) : undefined;
  const busted = !!me && !me.bot && me.stack === 0;
  const hasBots = game.players.some((p) => p.bot);
  return (
    <div className="result-banner sketch-panel">
      {r.pots.map((pot, i) => (
        <div key={i} className="result-line">
          <b>{pot.winners.map(name).join(' & ')}</b> {pot.winners.length > 1 || /^you$/i.test(name(pot.winners[0])) ? (pot.winners.length > 1 ? 'split' : 'win') : 'wins'}
          {r.pots.length > 1 ? (i === 0 ? ' the main pot' : ` side pot ${i}`) : ' the pot'} · {formatChips(pot.amount)}
          {!r.uncontested && pot.winners[0] && r.hands[pot.winners[0]] && <span className="muted"> — {r.hands[pot.winners[0]]!.description}</span>}
        </div>
      ))}
      {busted ? (
        <button className="btn btn-primary" onClick={() => onRebuy(me!.id)}>
          Rebuy {formatChips(game.settings.startingStack)}
        </button>
      ) : (
        <button className="btn btn-primary" onClick={onNext}>
          Next hand
        </button>
      )}
      {autoDeal && hasBots && !busted && <span className="muted auto-note">next hand deals automatically</span>}
    </div>
  );
}

function EmptyHint({ onStart, onSim }: { onStart: (seats: PlaySeat[]) => void; onSim: () => void }) {
  return (
    <div className="empty-hint sketch-panel welcome">
      <h2>Welcome to the table</h2>
      <div className="welcome-cols">
        <section>
          <h3>Play against the bots</h3>
          <PlayVsBots onStart={onStart} compact />
        </section>
        <section>
          <h3>Or…</h3>
          <p>
            <b>Watch bots fight:</b> run thousands of hands in seconds and see who wins.
          </p>
          <button className="btn" onClick={onSim}>
            📊 Open the simulator
          </button>
          <p className="muted welcome-manual">
            <b>Play with friends:</b> edit players on the right, then press <b>Deal</b>. Click a seat to see that player's cards.
          </p>
        </section>
      </div>
    </div>
  );
}

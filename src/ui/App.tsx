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

export function App() {
  const { state, dispatch, run } = useAppStore();
  const { game, view, error } = state;
  const h = game.hand;
  const busy = handInProgress(game);
  useBots(game, view, run);

  const pickViewer = useCallback((id: string) => dispatch({ kind: 'view', patch: { viewerId: id, followAction: false } }), [dispatch]);

  // Keyboard shortcuts: N = next hand, ⌘Z / Ctrl+Z = undo, F = fold, C = check/call.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ kind: 'undo' });
      } else if (e.key.toLowerCase() === 'n' && !busy) run({ type: 'startHand' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, dispatch, run]);

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
        <div className="top-info">
          {h ? <span>Hand #{h.number}</span> : <span>No hand yet</span>}
          <span>
            Blinds {formatChips(game.settings.smallBlind)}/{formatChips(game.settings.bigBlind)}
            {game.settings.ante ? ` · ante ${game.settings.ante}` : ''}
          </span>
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
      </header>

      <main className="main">
        <section className="table-area">
          <Table game={game} view={view} onPickViewer={pickViewer} />
          {!h && <EmptyHint />}
          <div className="bottom-dock">
            <ViewerTray game={game} viewerId={view.viewerId} hidden={needsConfirm} />
            <ActionBar game={game} run={run} />
            {h?.result && <ResultBanner game={game} onNext={() => run({ type: 'startHand' })} />}
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
        <SidePanel game={game} view={view} run={run} dispatch={dispatch} />
      </main>

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
        <span className="dot" style={{ background: p.color }} /> {p.name}'s hand
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

function ResultBanner({ game, onNext }: { game: GameState; onNext: () => void }) {
  const r = game.hand!.result!;
  const name = (id: string) => playerById(game, id)?.name ?? '?';
  return (
    <div className="result-banner sketch-panel">
      {r.pots.map((pot, i) => (
        <div key={i} className="result-line">
          <b>{pot.winners.map(name).join(' & ')}</b> {pot.winners.length > 1 ? 'split' : 'wins'}
          {r.pots.length > 1 ? (i === 0 ? ' the main pot' : ` side pot ${i}`) : ' the pot'} · {formatChips(pot.amount)}
          {!r.uncontested && pot.winners[0] && r.hands[pot.winners[0]] && <span className="muted"> — {r.hands[pot.winners[0]]!.description}</span>}
        </div>
      ))}
      <button className="btn btn-primary" onClick={onNext}>
        Next hand
      </button>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="empty-hint sketch-panel">
      <h2>Welcome to the table</h2>
      <p>Add or rename players on the right, set the blinds in Settings, then press <b>Deal</b>.</p>
      <p className="muted">Click any seat to switch the active player and see that player's cards.</p>
    </div>
  );
}

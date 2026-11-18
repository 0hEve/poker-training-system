import { memo, useEffect, useRef, useState } from 'react';
import { handInProgress, MAX_PLAYERS, type Command, type GameState, type Settings } from '../engine/game';
import { formatChips } from '../engine/chips';
import type { AppAction, ViewState } from '../store';

interface Props {
  game: GameState;
  view: ViewState;
  run: (cmd: Command) => void;
  dispatch: (a: AppAction) => void;
}

export const SidePanel = memo(function SidePanel({ game, view, run, dispatch }: Props) {
  const [tab, setTab] = useState<'players' | 'settings' | 'log'>('players');
  return (
    <aside className="side-panel sketch-panel">
      <nav className="tabs">
        {(['players', 'settings', 'log'] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      {tab === 'players' && <Players game={game} view={view} run={run} dispatch={dispatch} />}
      {tab === 'settings' && <SettingsForm game={game} view={view} run={run} dispatch={dispatch} />}
      {tab === 'log' && <Log lines={game.log} />}
    </aside>
  );
});

function Players({ game, view, run, dispatch }: Props) {
  const busy = handInProgress(game);
  const inHand = new Set(busy ? game.hand!.seats.map((s) => s.playerId) : []);
  const [newName, setNewName] = useState('');
  return (
    <div className="players">
      <p className="hint">Click a name or a seat to view that player's cards.</p>
      <ul>
        {game.players.map((p) => {
          const locked = inHand.has(p.id);
          return (
            <li key={p.id} className={`player-row ${view.viewerId === p.id ? 'viewing' : ''}`}>
              <button
                className="viewer-pick"
                title="View this player's cards"
                onClick={() => dispatch({ kind: 'view', patch: { viewerId: p.id, followAction: false } })}
              >
                <span className="dot" style={{ background: p.color }} />
              </button>
              <input
                className="name-input"
                value={p.name}
                onChange={(e) => run({ type: 'renamePlayer', id: p.id, name: e.target.value })}
                aria-label="Player name"
              />
              <StackEditor value={p.stack} disabled={locked} onSet={(v) => run({ type: 'setStack', id: p.id, stack: v })} />
              <div className="row-actions">
                <button className="mini" disabled={locked} title="Add a big blind × 10" onClick={() => run({ type: 'adjustStack', id: p.id, delta: game.settings.bigBlind * 10 })}>
                  +{formatChips(game.settings.bigBlind * 10)}
                </button>
                <button className="mini" title={p.sittingOut ? 'Sit in' : 'Sit out'} onClick={() => run({ type: 'toggleSitOut', id: p.id })}>
                  {p.sittingOut ? 'Sit in' : 'Sit out'}
                </button>
                <button className="mini" disabled={busy} title="Give this player the button next hand" onClick={() => run({ type: 'moveButton', id: p.id })}>
                  Ⓓ
                </button>
                <button className="mini danger" disabled={locked} title="Remove player" onClick={() => run({ type: 'removePlayer', id: p.id })}>
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {game.players.length < MAX_PLAYERS && (
        <form
          className="add-player"
          onSubmit={(e) => {
            e.preventDefault();
            run({ type: 'addPlayer', name: newName || `Player ${game.players.length + 1}` });
            setNewName('');
          }}
        >
          <input value={newName} placeholder="New player name" onChange={(e) => setNewName(e.target.value)} />
          <button className="btn small">Add</button>
        </form>
      )}
      <div className="viewer-opts">
        <label>
          <input type="checkbox" checked={view.followAction} onChange={(e) => dispatch({ kind: 'view', patch: { followAction: e.target.checked } })} />
          Auto-switch to the player to act
        </label>
        <label>
          <input type="checkbox" checked={view.revealAll} onChange={(e) => dispatch({ kind: 'view', patch: { revealAll: e.target.checked } })} />
          Dealer view (show every hand)
        </label>
        <label>
          <input type="checkbox" checked={view.privacy} onChange={(e) => dispatch({ kind: 'view', patch: { privacy: e.target.checked } })} />
          Pass-the-device screen between players
        </label>
        <button className="btn small ghost" onClick={() => dispatch({ kind: 'view', patch: { viewerId: null, followAction: false } })}>
          Hide all cards
        </button>
      </div>
    </div>
  );
}

function StackEditor({ value, disabled, onSet }: { value: number; disabled: boolean; onSet: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      className="stack-input num"
      type="number"
      min={0}
      disabled={disabled}
      value={draft}
      title={disabled ? 'Stacks can be edited between hands' : 'Edit stack'}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = Math.max(0, Math.floor(Number(draft) || 0));
        if (v !== value) onSet(v);
        else setDraft(String(value));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label="Stack"
    />
  );
}

function SettingsForm({ game, run, dispatch }: Props) {
  const s = game.settings;
  const busy = handInProgress(game);
  const field = (k: keyof Settings, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        className="num"
        type="number"
        min={0}
        disabled={busy && k !== 'startingStack'}
        defaultValue={s[k]}
        key={`${k}-${s[k]}`}
        onBlur={(e) => run({ type: 'updateSettings', settings: { [k]: Number(e.target.value) } })}
      />
    </label>
  );
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="settings">
      {field('smallBlind', 'Small blind')}
      {field('bigBlind', 'Big blind')}
      {field('ante', 'Ante')}
      {field('startingStack', 'Starting stack')}
      <p className="hint">Blinds can be changed between hands. Chip counts persist until you reset them.</p>
      <div className="danger-zone">
        {confirmReset ? (
          <>
            <span>Reset every player to {formatChips(s.startingStack)}?</span>
            <button className="btn small danger" onClick={() => { run({ type: 'resetChips' }); setConfirmReset(false); }}>Yes, reset</button>
            <button className="btn small ghost" onClick={() => setConfirmReset(false)}>Cancel</button>
          </>
        ) : (
          <button className="btn danger" onClick={() => setConfirmReset(true)}>Reset all chips</button>
        )}
        <button className="btn ghost" onClick={() => dispatch({ kind: 'newTable' })}>New table (default players)</button>
      </div>
    </div>
  );
}

function Log({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [lines.length]);
  return (
    <ol className="log" ref={ref}>
      {lines.map((l, i) => (
        <li key={i} className={l.startsWith('—') ? 'log-hand' : ''}>
          {l}
        </li>
      ))}
    </ol>
  );
}

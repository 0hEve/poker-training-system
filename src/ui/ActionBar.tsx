import { memo, useEffect, useState } from 'react';
import { legalActions, playerById, potTotal, type Command, type GameState } from '../engine/game';
import { formatChips } from '../engine/chips';

interface Props {
  game: GameState;
  run: (cmd: Command) => void;
}

/** Bet/raise controls for the player whose turn it is. */
export const ActionBar = memo(function ActionBar({ game, run }: Props) {
  const h = game.hand;
  const la = legalActions(game);
  const seat = h && h.toAct !== null ? h.seats[h.toAct] : null;
  const player = seat ? playerById(game, seat.playerId) : null;
  const [amount, setAmount] = useState(0);

  // Reset the slider to the minimum whenever the decision changes.
  const key = `${h?.number}-${h?.street}-${h?.toAct}-${h?.currentBet}`;
  useEffect(() => {
    if (la?.raise) setAmount(la.raise.min);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!h || !la || !seat || !player) return null;
  if (player.bot)
    return (
      <div className="action-bar sketch-panel" role="status">
        <div className="action-who">
          <span className="dot" style={{ background: player.color }} />
          🤖 <b>{player.name}</b> is thinking…
          <span className="muted"> · stack {formatChips(player.stack)}</span>
        </div>
      </div>
    );

  const pot = potTotal(h);
  const toCall = la.call;
  const r = la.raise;
  const clamp = (v: number) => (r ? Math.max(r.min, Math.min(r.max, Math.round(v))) : 0);
  // Pot-sized raise: call first, then raise by the resulting pot.
  const potRaiseTo = (frac: number) => clamp(h.currentBet + (pot + toCall) * frac);

  return (
    <div className="action-bar sketch-panel" role="group" aria-label={`${player.name} to act`}>
      <div className="action-who">
        <span className="dot" style={{ background: player.color }} />
        <b>{player.name}</b> to act
        <span className="muted"> · stack {formatChips(player.stack)}</span>
      </div>
      <StreetActions game={game} />
      <div className="action-buttons">
        <button className="btn btn-fold" onClick={() => run({ type: 'act', action: { type: 'fold' } })}>
          Fold
        </button>
        {la.check ? (
          <button className="btn btn-check" onClick={() => run({ type: 'act', action: { type: 'check' } })}>
            Check
          </button>
        ) : (
          <button className="btn btn-call" onClick={() => run({ type: 'act', action: { type: 'call' } })}>
            Call {formatChips(toCall)}
            {toCall >= player.stack ? ' (all-in)' : ''}
          </button>
        )}
        {r && (
          <button className="btn btn-raise" onClick={() => run({ type: 'act', action: { type: 'raise', to: clamp(amount) } })}>
            {r.isBet ? 'Bet' : 'Raise to'} {formatChips(clamp(amount))}
          </button>
        )}
        {r && la.allIn > 0 && (
          <button className="btn btn-allin" onClick={() => run({ type: 'act', action: { type: 'allIn' } })}>
            All-in {formatChips(la.allIn)}
          </button>
        )}
      </div>
      {r && r.max > r.min && (
        <div className="action-sizing">
          <input
            type="range"
            min={r.min}
            max={r.max}
            step={Math.max(1, Math.floor(game.settings.smallBlind) || 1)}
            value={clamp(amount)}
            onChange={(e) => setAmount(Number(e.target.value))}
            aria-label="Bet size"
          />
          <input
            type="number"
            className="num"
            min={r.min}
            max={r.max}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            onBlur={() => setAmount(clamp(amount))}
            aria-label="Bet amount"
          />
          <div className="presets">
            <button className="chip-btn" onClick={() => setAmount(r.min)}>Min</button>
            <button className="chip-btn" onClick={() => setAmount(potRaiseTo(0.5))}>½ pot</button>
            <button className="chip-btn" onClick={() => setAmount(potRaiseTo(0.75))}>¾ pot</button>
            <button className="chip-btn" onClick={() => setAmount(potRaiseTo(1))}>Pot</button>
            <button className="chip-btn" onClick={() => setAmount(r.max)}>Max</button>
          </div>
        </div>
      )}
    </div>
  );
});

const STREET_NO: Record<string, number> = { preflop: 0, flop: 1, turn: 2, river: 3, showdown: 3 };
const KIND_WORD: Record<string, string> = { fold: 'folds', check: 'checks', call: 'calls', bet: 'bets', raise: 'raises to' };

/** What everyone has done so far on this street, in order, so it's clear who acted before you. */
function StreetActions({ game }: { game: GameState }) {
  const h = game.hand!;
  const street = STREET_NO[h.street];
  const acts = (h.actions ?? []).filter((a) => a.street === street && a.kind !== 'post');
  const name = (seat: number) => playerById(game, h.seats[seat].playerId)?.name ?? '?';
  return (
    <div className="street-actions" aria-label="Action on this street">
      <span className="street-label">{h.street}</span>
      {acts.length === 0 ? (
        <span className="muted">{street === 0 ? 'blinds posted, nobody has acted yet' : 'first to act on this street'}</span>
      ) : (
        acts.map((a, i) => (
          <span key={i} className={`street-act ${a.kind}`}>
            {name(a.seat)} {KIND_WORD[a.kind]}
            {a.kind === 'call' || a.kind === 'bet' || a.kind === 'raise' ? ` ${formatChips(a.amount)}` : ''}
          </span>
        ))
      )}
    </div>
  );
}

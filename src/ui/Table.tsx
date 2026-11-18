import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { collectedPot, type GameState } from '../engine/game';
import { formatChips } from '../engine/chips';
import type { Card } from '../engine/cards';
import type { ViewState } from '../store';
import { PlayingCard } from './Card';
import { ChipPile, DealerButton } from './Chips';

interface Props {
  game: GameState;
  view: ViewState;
  onPickViewer: (id: string) => void;
}

/** Table tilt in degrees — the plates counter-rotate by the same amount to face the camera. */
export const TILT = 24;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(1000);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Seat anchor on an ellipse; i = 0 is bottom centre, then clockwise. */
function seatGeometry(i: number, n: number) {
  const a = ((90 + (i * 360) / n) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const at = (rx: number, ry: number) => ({ left: `${50 + rx * cos}%`, top: `${50 + ry * sin}%` });
  return {
    plate: at(45.5, 46),
    cards: at(31, 30),
    bet: at(21, 19),
    // Dealer button sits beside the cards, offset tangentially.
    button: { left: `${50 + 29 * cos + 7.5 * -sin}%`, top: `${50 + 24 * sin + 11 * cos}%` },
  };
}

export const Table = memo(function Table({ game, view, onPickViewer }: Props) {
  const [ref, width] = useSize<HTMLDivElement>();
  const h = game.hand;
  const n = game.players.length;
  const cardW = Math.round(Math.max(40, Math.min(86, width * 0.058)));
  const boardW = Math.round(Math.max(52, Math.min(110, width * 0.072)));
  const chipW = Math.round(Math.max(26, Math.min(46, width * 0.036)));

  const result = h?.result ?? null;
  // Highlight the winning five at showdown (only for a single main-pot winner to keep it readable).
  const winningCards = useMemo(() => {
    if (!result || result.uncontested) return new Set<Card>();
    const mainWinner = result.pots[0]?.winners[0];
    const hv = mainWinner ? result.hands[mainWinner] : undefined;
    return new Set<Card>(hv?.bestFive ?? []);
  }, [result]);

  const geometry = useMemo(() => Array.from({ length: n }, (_, i) => seatGeometry(i, n)), [n]);

  return (
    <div className="table-scene" ref={ref}>
      <div className="table-surface" style={{ transform: `rotateX(${TILT}deg)` }}>
        <div className="table-rail" />
        <div className="table-felt">
          <div className="felt-line" />
        </div>

        {/* Centre: pot + board */}
        <div className="table-center">
          {h && !result && collectedPot(h) > 0 && (
            <div className="pot">
              <ChipPile amount={collectedPot(h)} chipWidth={Math.round(chipW * 1.25)} maxColumns={5} label={false} />
              <div className="pot-label">Pot {formatChips(collectedPot(h))}</div>
            </div>
          )}
          <div className="board" style={{ gap: boardW * 0.12 }}>
            {[0, 1, 2, 3, 4].map((i) => {
              const c = h?.board[i];
              return c === undefined ? (
                <div key={i} className="board-slot" style={{ width: boardW, height: boardW * 1.4 }} />
              ) : (
                <PlayingCard
                  key={`${h!.number}-${i}`}
                  card={c}
                  faceUp
                  width={boardW}
                  className="deal-in board-card"
                  style={{ animationDelay: `${(i < 3 ? i : 0) * 90}ms` }}
                  highlight={winningCards.has(c)}
                />
              );
            })}
          </div>
          {h && <div className="street-label">{result ? (result.uncontested ? 'Hand over' : 'Showdown') : h.street}</div>}
        </div>

        {game.players.map((p, i) => {
          const g = geometry[i];
          const seatIdx = h ? h.seats.findIndex((s) => s.playerId === p.id) : -1;
          const seat = seatIdx >= 0 ? h!.seats[seatIdx] : null;
          const isViewer = view.viewerId === p.id;
          const viewerConfirmed = !view.privacy || view.confirmedViewerId === p.id;
          const showdownReveal = !!result && !result.uncontested && !!seat && !seat.folded;
          const faceUp = !!seat && (view.revealAll || showdownReveal || (isViewer && viewerConfirmed));
          const payout = result?.payouts[p.id] ?? 0;
          const handDesc = result && !result.uncontested && seat && !seat.folded ? result.hands[p.id]?.description : undefined;
          return (
            <SeatView
              key={p.id}
              id={p.id}
              name={p.name}
              color={p.color}
              stack={p.stack}
              sittingOut={p.sittingOut}
              inHand={!!seat}
              hole0={seat?.hole[0] ?? null}
              hole1={seat?.hole[1] ?? null}
              handNo={h?.number ?? 0}
              faceUp={faceUp}
              folded={!!seat?.folded}
              allIn={!!seat?.allIn}
              bet={seat && !result ? seat.bet : 0}
              lastAction={seat?.lastAction ?? null}
              toAct={!!h && !result && h.toAct === seatIdx}
              isViewer={isViewer}
              isButton={!!h && seatIdx === h.buttonSeat}
              blind={h && seatIdx === h.sbSeat ? 'SB' : h && seatIdx === h.bbSeat ? 'BB' : null}
              winnings={payout}
              handDesc={handDesc}
              winA={seat ? winningCards.has(seat.hole[0]) : false}
              winB={seat ? winningCards.has(seat.hole[1]) : false}
              g={g}
              cardW={cardW}
              chipW={chipW}
              onPick={onPickViewer}
            />
          );
        })}
      </div>
    </div>
  );
});

interface SeatProps {
  id: string;
  name: string;
  color: string;
  stack: number;
  sittingOut: boolean;
  inHand: boolean;
  hole0: Card | null;
  hole1: Card | null;
  handNo: number;
  faceUp: boolean;
  folded: boolean;
  allIn: boolean;
  bet: number;
  lastAction: string | null;
  toAct: boolean;
  isViewer: boolean;
  isButton: boolean;
  blind: 'SB' | 'BB' | null;
  winnings: number;
  handDesc?: string;
  winA: boolean;
  winB: boolean;
  g: ReturnType<typeof seatGeometry>;
  cardW: number;
  chipW: number;
  onPick: (id: string) => void;
}

/** One seat. Props are primitives so memo skips seats that didn't change. */
const SeatView = memo(function SeatView(p: SeatProps) {
  const cls = [
    'seat-plate',
    p.toAct && 'to-act',
    p.isViewer && 'viewing',
    p.folded && 'folded',
    (!p.inHand || p.sittingOut) && 'idle',
    p.winnings > 0 && 'winner',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      {p.inHand && p.hole0 !== null && (
        <div className={`seat-cards ${p.folded ? 'mucked' : ''}`} style={p.g.cards} onClick={() => p.onPick(p.id)}>
          <PlayingCard key={`${p.handNo}-a`} card={p.hole0} faceUp={p.faceUp} width={p.cardW} className="deal-in hole-a" highlight={p.winA} />
          <PlayingCard key={`${p.handNo}-b`} card={p.hole1} faceUp={p.faceUp} width={p.cardW} className="deal-in hole-b" highlight={p.winB} />
        </div>
      )}
      {p.bet > 0 && (
        <div className="seat-bet" style={p.g.bet}>
          <ChipPile amount={p.bet} chipWidth={p.chipW} maxColumns={3} />
        </div>
      )}
      {p.isButton && (
        <div className="seat-dealer" style={p.g.button}>
          <DealerButton size={Math.max(48, p.chipW * 1.5)} />
        </div>
      )}
      <div className="seat-anchor" style={p.g.plate}>
        <button
          className={cls}
          style={{ transform: `translate(-50%, -78%) translateZ(2px) rotateX(${-TILT}deg)`, ['--seat' as string]: p.color }}
          onClick={() => p.onPick(p.id)}
          title={`View ${p.name}'s cards`}
        >
          <span className="avatar" style={{ background: p.color }}>
            {p.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="plate-text">
            <span className="plate-name">
              {p.name}
              {p.isViewer && <span className="eye" title="Viewing"> 👁</span>}
            </span>
            <span className="plate-stack">{p.sittingOut ? 'sitting out' : p.stack === 0 && !p.inHand ? 'busted' : formatChips(p.stack)}</span>
          </span>
          {p.blind && <span className="badge blind">{p.blind}</span>}
          {p.allIn && !p.folded && <span className="badge allin">ALL-IN</span>}
          {p.winnings > 0 ? (
            <span className="action-bubble win">
              +{formatChips(p.winnings)}
              {p.handDesc ? ` · ${p.handDesc}` : ''}
            </span>
          ) : p.handDesc ? (
            <span className="action-bubble">{p.handDesc}</span>
          ) : (
            p.lastAction && <span className="action-bubble">{p.lastAction}</span>
          )}
        </button>
      </div>
    </>
  );
});

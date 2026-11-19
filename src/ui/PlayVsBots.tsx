import { useState } from 'react';
import { allBots } from '../bots/registry';
import { seatProblem, selectable, statusNote, statusTitle, useGatewayStatus } from '../bots/remote/status';
import type { PlaySeat } from '../store';

const SIZES = [
  { n: 2, label: 'Heads-up' },
  { n: 3, label: '3 players' },
  { n: 6, label: '6-max' },
];

/** Short display name for a bot seat ("Opus 5.5 (no adaptation)" -> "Opus 5.5"). */
const shortName = (id: string) => (allBots.find((b) => b.id === id)?.name ?? id).replace(/\s*\(.*\)$/, '');

/** Seats for "you vs these bots": bots fill the other seats in turn. */
export function playSeats(you: string, botIds: string[], size: number): PlaySeat[] {
  const others = Array.from({ length: size - 1 }, (_, i) => botIds[i % botIds.length]);
  const counts = new Map<string, number>();
  const totals = new Map<string, number>();
  others.forEach((b) => totals.set(b, (totals.get(b) ?? 0) + 1));
  return [
    { name: you, bot: null },
    ...others.map((b) => {
      const k = (counts.get(b) ?? 0) + 1;
      counts.set(b, k);
      return { name: totals.get(b)! > 1 ? `${shortName(b)} #${k}` : shortName(b), bot: b };
    }),
  ];
}

const BUILTIN = new Set(['tag', 'station', 'random']);
/** Experiment-only variants (still available in the simulator). */
const isVariant = (name: string) => /no adaptation|variant/i.test(name);
/** External bots that can never run on this machine (listed, but not offered here). */
const NEVER = new Set(['decisionholdem']);

/** The strongest bots available: local research bots, else the built-in TAG. */
export function strongBots(): string[] {
  const local = allBots
    .filter((b) => !BUILTIN.has(b.id) && !isVariant(b.name) && !NEVER.has(b.id))
    // In-process bots first (always ready); external ones depend on the gateway.
    .sort((a, b) => Number('remote' in a) - Number('remote' in b))
    .map((b) => b.id);
  return local.length ? local : ['tag'];
}

const practiceBots = () => allBots.filter((b) => BUILTIN.has(b.id)).map((b) => b.id);

/** One-click setup for playing against bots at the live table. */
export function PlayVsBots({ onStart, compact = false }: { onStart: (seats: PlaySeat[]) => void; compact?: boolean }) {
  const [picked, setPicked] = useState<string[]>(() => strongBots().slice(0, 1));
  const [size, setSize] = useState(6);
  const [you, setYou] = useState('You');
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? (p.length > 1 ? p.filter((x) => x !== id) : p) : [...p, id]));
  const gw = useGatewayStatus();
  const seats = playSeats(you.trim() || 'You', picked, size);
  const strong = strongBots();
  const chip = (id: string) => {
    const b = allBots.find((x) => x.id === id)!;
    return (
      <button
        key={id}
        className={`mini ${picked.includes(id) ? 'on' : ''}`}
        title={statusTitle(id, gw)}
        disabled={!selectable(id, gw)}
        onClick={() => toggle(id)}
        aria-pressed={picked.includes(id)}
      >
        {b.name}
        {statusNote(id, gw) && <span className="muted">{statusNote(id, gw)}</span>}
      </button>
    );
  };
  const seatIssues = picked.map((b) => seatProblem(b, size, gw)).filter((x): x is string => !!x);
  const tally = new Map<string, number>();
  seats.slice(1).forEach((s) => tally.set(s.bot!, (tally.get(s.bot!) ?? 0) + 1));
  return (
    <div className={`play-vs ${compact ? 'compact' : ''}`}>
      <div className="play-row">
        <span className="sim-label">Opponents</span>
        <div className="chip-col">
          <div className="chip-row">{strong.filter((id) => !BUILTIN.has(id)).map(chip)}</div>
          <div className="chip-row practice">
            <span className="muted">practice:</span>
            {practiceBots().map(chip)}
          </div>
        </div>
      </div>
      <div className="play-row">
        <span className="sim-label">Table</span>
        <div className="chip-row">
          {SIZES.map((s) => (
            <button key={s.n} className={`mini ${size === s.n ? 'on' : ''}`} onClick={() => setSize(s.n)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="play-row">
        <span className="sim-label">Your name</span>
        <input value={you} onChange={(e) => setYou(e.target.value)} maxLength={16} aria-label="Your name" />
      </div>
      <p className="play-seats muted">
        🙂 {seats[0].name} vs{' '}
        {[...tally].map(([id, n]) => `🤖 ${n > 1 ? `${n} × ` : ''}${shortName(id)}`).join(' + ')}
        {picked.length > 1 ? ' (seated alternately)' : ''} · pick several opponents to mix them
      </p>
      {seatIssues.map((m) => (
        <p key={m} className="hint seat-warning">
          ⚠ {m}
        </p>
      ))}
      <button className="btn btn-primary" disabled={seatIssues.length > 0} onClick={() => onStart(seats)}>
        ▶ Sit down and deal
      </button>
      {!compact && <p className="hint">This replaces the current table. Bots act on their own after a short pause and the next hand deals itself.</p>}
    </div>
  );
}

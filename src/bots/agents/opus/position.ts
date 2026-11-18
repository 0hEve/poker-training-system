export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

/** Position name for a seat (0 = button) at a table of n players. Heads-up the button counts as BTN. */
export function positionOf(seat: number, n: number): Position {
  if (n === 2) return seat === 0 ? 'BTN' : 'BB';
  if (seat === 0) return 'BTN';
  if (seat === 1) return 'SB';
  if (seat === 2) return 'BB';
  const fromBtn = n - seat;
  return fromBtn === 1 ? 'CO' : fromBtn === 2 ? 'HJ' : 'UTG';
}

/** Postflop acting order index: seat 1 acts first, the button (seat 0) last. */
export const postflopOrder = (seat: number, n: number) => (seat === 0 ? n : seat);

/**
 * Pot construction from total per-player contributions (integer chips only).
 * Folded players' chips count as dead money in every layer they reached but
 * they are never eligible to win.
 */
export interface Contribution {
  seat: number;
  amount: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Seats that can win this pot. A pot with exactly one eligible seat is an uncalled bet return. */
  eligible: number[];
}

export function buildPots(contribs: readonly Contribution[]): Pot[] {
  const remaining = new Map<number, number>();
  for (const c of contribs) remaining.set(c.seat, c.amount);
  const live = contribs.filter((c) => !c.folded);
  const pots: Pot[] = [];

  for (;;) {
    const liveLeft = live.filter((c) => remaining.get(c.seat)! > 0);
    if (liveLeft.length === 0) break;
    const level = Math.min(...liveLeft.map((c) => remaining.get(c.seat)!));
    let amount = 0;
    for (const c of contribs) {
      const r = remaining.get(c.seat)!;
      const take = Math.min(r, level);
      amount += take;
      remaining.set(c.seat, r - take);
    }
    const eligible = liveLeft.map((c) => c.seat);
    const prev = pots[pots.length - 1];
    // Merge layers with identical eligibility (e.g. created by folded players' partial amounts).
    if (prev && prev.eligible.length === eligible.length && prev.eligible.every((s, i) => s === eligible[i])) {
      prev.amount += amount;
    } else {
      pots.push({ amount, eligible });
    }
  }

  // Dead money above every live player's contribution (rare) goes to the last pot.
  let leftover = 0;
  for (const v of remaining.values()) leftover += v;
  if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
  return pots;
}

/**
 * Split `amount` among `winners` (already ordered clockwise starting left of
 * the button). Odd chips go one at a time starting from the first winner.
 */
export function splitPot(amount: number, winners: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  const share = Math.floor(amount / winners.length);
  let odd = amount - share * winners.length;
  for (const w of winners) {
    out.set(w, share + (odd > 0 ? 1 : 0));
    if (odd > 0) odd--;
  }
  return out;
}

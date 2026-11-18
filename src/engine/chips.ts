/** Standard casino chip colour conventions. */
export const CHIP_DENOMINATIONS = [1000, 500, 100, 25, 5, 1] as const;
export type Denomination = (typeof CHIP_DENOMINATIONS)[number];

/** Greedy breakdown of a stack into chip denominations (largest first). */
export function breakdown(amount: number, denoms: readonly number[] = CHIP_DENOMINATIONS): { value: number; count: number }[] {
  const out: { value: number; count: number }[] = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const d of denoms) {
    const n = Math.floor(rest / d);
    if (n > 0) {
      out.push({ value: d, count: n });
      rest -= n * d;
    }
  }
  return out;
}

/**
 * Columns of chips for display, capped so huge stacks don't render hundreds
 * of DOM nodes. Each column is one denomination; `count` is the true count,
 * `shown` is how many discs are drawn.
 */
export function chipColumns(amount: number, maxPerColumn = 10, maxColumns = 5) {
  return breakdown(amount)
    .slice(0, maxColumns)
    .map((b) => ({ ...b, shown: Math.min(b.count, maxPerColumn) }));
}

export function formatChips(n: number): string {
  return n.toLocaleString('en-US');
}

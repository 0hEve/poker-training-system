import { memo } from 'react';
import { chipStackAspect, chipStackURL, dealerButtonURL } from '../art';
import { chipColumns, formatChips } from '../engine/chips';

interface Props {
  amount: number;
  /** Width of one chip column in px. */
  chipWidth?: number;
  label?: boolean;
  className?: string;
  maxColumns?: number;
}

const stackCache = new Map<string, number[]>();
function stackValues(value: number, n: number): number[] {
  const k = `${value}x${n}`;
  let v = stackCache.get(k);
  if (!v) stackCache.set(k, (v = Array(n).fill(value)));
  return v;
}

/** Chips broken into denomination columns, drawn as angled stacks. */
export const ChipPile = memo(function ChipPile({ amount, chipWidth = 34, label = true, className = '', maxColumns = 4 }: Props) {
  if (amount <= 0) return null;
  const cols = chipColumns(amount, 12, maxColumns);
  return (
    <div className={`chip-pile ${className}`} title={formatChips(amount)}>
      <div className="chip-cols">
        {cols.map((c) => (
          <img
            key={c.value}
            className="chip-col"
            src={chipStackURL(stackValues(c.value, c.shown))}
            style={{ width: chipWidth, height: chipWidth / chipStackAspect(c.shown) }}
            alt=""
            draggable={false}
          />
        ))}
      </div>
      {label && <span className="chip-amount">{formatChips(amount)}</span>}
    </div>
  );
});

export const DealerButton = memo(function DealerButton({ size = 30 }: { size?: number }) {
  return <img className="dealer-btn" src={dealerButtonURL()} style={{ width: size, height: "auto" }} alt="Dealer button" draggable={false} />;
});

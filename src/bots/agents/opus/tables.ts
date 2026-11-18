import { HU_B64, VSN_B64 } from './tables.data';
import { classCombos, parseClass } from './cards';
import type { Position } from './position';

function decode(b64: string): Float32Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) / 65535;
  return out;
}

/** HU[i * 169 + j]: equity of class i vs class j. */
export const HU = decode(HU_B64);
/** VSN[(n - 1) * 169 + i]: equity of class i vs n random hands. */
export const VSN = decode(VSN_B64);

/** Preflop strength used to order ranges (blend of heads-up and 3-way equity vs random). */
export const PF_STRENGTH = new Float32Array(169);
for (let c = 0; c < 169; c++) PF_STRENGTH[c] = 0.6 * VSN[c] + 0.4 * VSN[2 * 169 + c];

/** PCT_TOP[c]: position of the class in a best-first range, as a fraction of all 1326 combos (midpoint). */
export const PCT_TOP = new Float32Array(169);
export const CLASS_ORDER: number[] = Array.from({ length: 169 }, (_, i) => i).sort((a, b) => PF_STRENGTH[b] - PF_STRENGTH[a]);
{
  let acc = 0;
  for (const c of CLASS_ORDER) {
    const w = classCombos(c);
    PCT_TOP[c] = (acc + w / 2) / 1326;
    acc += w;
  }
}

/* ------------------------------------------------------------ RFI charts */

/**
 * Raise-first-in starter rows from docs/research/bots/03-strategy-and-adaptation.md.
 * "77+" pairs up to AA; "A2s+" kicker up to one below the high card; "66:75" = 75% mix.
 */
const RFI_ROWS: Record<Exclude<Position, 'BB'>, string> = {
  UTG: '77+ A2s+ ATo+ K9s+ KJo+ Q9s+ QJo J9s+ T9s 66:75 55:50 44:10 33:10 22:10 KTo:75 K8s:75 K7s:50 Q8s:50 98s:25 87s:25 76s:25 65s:25 54s:25',
  HJ: '55+ A2s+ A9o+ K6s+ KTo+ Q9s+ QJo J8s+ T8s+ 98s 44:75 33:25 22:25 A8o:25 K5s:75 K4s:50 K3s:25 K2s:25 QTo:75 Q8s:75 Q7s:50 Q6s:25 JTo:50 87s:75 76s:50 65s:50 54s:50',
  CO: '55+ A2s+ A8o+ K2s+ KTo+ Q6s+ QTo+ J7s+ T7s+ 97s+ 87s 76s 65s 54s 44:50 33:50 22:50 A7o:50 K9o:50 K8o:50 Q5s:50 Q4s:50 Q9o:50 J6s:50 JTo:75 T6s:50 96s:50 86s:50 75s:50 64s:50 53s:50',
  BTN: '22+ A2s+ A3o+ K2s+ K7o+ Q2s+ Q9o+ J3s+ J9o+ T5s+ T8o+ 95s+ 98o 85s+ 75s+ 64s+ 54s A2o:50 K6o:50 Q8o:50 J8o:50 J2s:50 T4s:50 T7o:25 94s:25 97o:25 84s:25 87o:25 74s:25 76o:25 63s:25 53s:50 43s:25',
  SB: '22+ A2s+ A2o+ K2s+ K7o+ Q2s+ Q9o+ J4s+ J9o+ T6s+ T9o 96s+ 86s+ 76s 65s 54s K6o:50 Q8o:50 J3s:50 J8o:50 T5s:50 T8o:50 95s:50 98o:50 85s:50 75s:50 64s:50 53s:50',
};

const R = '23456789TJQKA';
function expand(token: string): number[] {
  const plus = token.endsWith('+');
  const t = plus ? token.slice(0, -1) : token;
  const hi = R.indexOf(t[0]);
  const lo = R.indexOf(t[1]);
  const suf = t[2] ?? '';
  if (!plus) return [parseClass(t)];
  const out: number[] = [];
  if (hi === lo) for (let r = hi; r <= 12; r++) out.push(parseClass(R[r] + R[r]));
  else for (let k = lo; k < hi; k++) out.push(parseClass(R[hi] + R[k] + suf));
  return out;
}

export const RFI: Record<Exclude<Position, 'BB'>, Float32Array> = {} as never;
for (const [pos, row] of Object.entries(RFI_ROWS)) {
  const f = new Float32Array(169);
  for (const tok of row.split(/\s+/)) {
    const [hand, mix] = tok.split(':');
    for (const c of expand(hand)) f[c] = mix ? Number(mix) / 100 : 1;
  }
  RFI[pos as Exclude<Position, 'BB'>] = f;
}

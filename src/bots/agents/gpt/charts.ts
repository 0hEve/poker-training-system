import { HIGH, LOW, RATING, SUITED, clamp } from './cards';

const ranks = '23456789TJQKA';

function chart(pure: string, mixed: string): Float32Array {
  const row = new Float32Array(169);
  for (const token of `${pure} ${mixed}`.trim().split(/\s+/)) {
    const high = ranks.indexOf(token[0]);
    const low = ranks.indexOf(token[1]);
    const frequency = token.includes(':') ? Number(token.split(':')[1]) * 0.01 : 1;
    if (high === low) {
      for (let rank = high; rank <= (token.includes('+') ? 12 : high); rank++) row[rank * 14] = frequency;
    } else {
      for (let kicker = low; kicker <= (token.includes('+') ? high - 1 : low); kicker++) {
        row[token[2] === 's' ? high * 13 + kicker : kicker * 13 + high] = frequency;
      }
    }
  }
  return row;
}

// Opening seeds from the repository's no-rake strategy research.
export const OPEN = [
  chart('77+ A2s+ ATo+ K9s+ KJo+ Q9s+ QJo J9s+ T9s',
    '66:75 55:50 44:10 33:10 22:10 KTo:75 K8s:75 K7s:50 Q8s:50 98s:25 87s:25 76s:25 65s:25 54s:25'),
  chart('55+ A2s+ A9o+ K6s+ KTo+ Q9s+ QJo J8s+ T8s+ 98s',
    '44:75 33:25 22:25 A8o:25 K5s:75 K4s:50 K3s:25 K2s:25 QTo:75 Q8s:75 Q7s:50 Q6s:25 JTo:50 87s:75 76s:50 65s:50 54s:50'),
  chart('55+ A2s+ A8o+ K2s+ KTo+ Q6s+ QTo+ J7s+ T7s+ 97s+ 87s 76s 65s 54s',
    '44:50 33:50 22:50 A7o:50 K9o:50 K8o:50 Q5s:50 Q4s:50 Q9o:50 J6s:50 JTo:75 T6s:50 96s:50 86s:50 75s:50 64s:50 53s:50'),
  chart('22+ A2s+ A3o+ K2s+ K7o+ Q2s+ Q9o+ J3s+ J9o+ T5s+ T8o+ 95s+ 98o 85s+ 75s+ 64s+ 54s',
    'A2o:50 K6o:50 Q8o:50 J8o:50 J2s:50 T4s:50 T7o:25 94s:25 97o:25 84s:25 87o:25 74s:25 76o:25 63s:25 53s:50 43s:25'),
  chart('22+ A2s+ A2o+ K2s+ K7o+ Q2s+ Q9o+ J4s+ J9o+ T6s+ T9o 96s+ 86s+ 76s 65s 54s',
    'K6o:50 Q8o:50 J3s:50 J8o:50 T5s:50 T8o:50 95s:50 98o:50 85s:50 75s:50 64s:50 53s:50'),
];

export const position = (seat: number, count: number, sb: number, bb: number) =>
  seat === sb ? 4 : seat === bb ? 5 : seat === 0 ? 3 : Math.max(0, 3 - (count - seat));

export const postOrder = (seat: number, count: number) => seat === 0 ? count - 1 : seat - 1;

export function threeBetValue(id: number, width: number): number {
  const high = HIGH[id];
  const low = LOW[id];
  if (high === low) return clamp(0.30 + (high - 9) * 0.46 + width * 0.57);
  if (high === 12) {
    if (low === 11) return 0.97;
    if (low === 10) return clamp((SUITED[id] ? 0.61 : 0.13) + width * 0.81);
    if (low === 9) return clamp((SUITED[id] ? 0.12 : 0) + width * (SUITED[id] ? 0.65 : 0.26));
    if (low === 8 && SUITED[id]) return clamp(width * 0.43);
  }
  if (high === 11 && low === 10 && SUITED[id]) return clamp(0.20 + width * 0.52);
  return 0;
}

// The equity generator and the live range model share these opponent-range priors.
export const EQUITY_PROFILES = Array.from({ length: 14 }, (_, p) =>
  Float32Array.from({ length: 169 }, (_, id) => {
    if (p === 0) return 1;
    if (p <= 5) return 0.012 + 0.988 * OPEN[p - 1][id];
    if (p === 6) return 0.02 + clamp((RATING[id] - 37) / 14);
    if (p === 7) return 0.007 + clamp((RATING[id] - 53) / 18);
    if (p === 8 || p === 9) {
      const wheel = HIGH[id] === 12 && LOW[id] <= 3 && SUITED[id];
      return 0.006 + 0.90 * threeBetValue(id, p === 8 ? 0.05 : 0.85)
        + (wheel ? (p === 8 ? 0.13 : 0.31) : 0);
    }
    if (p === 10) {
      if (HIGH[id] === LOW[id]) return [0.16, 0.64, 1, 1][HIGH[id] - 9] ?? 0.004;
      return HIGH[id] === 12 && LOW[id] === 11 ? 0.82 : HIGH[id] === 12 && LOW[id] === 10 ? 0.06 : 0.004;
    }
    if (p === 11) {
      if (HIGH[id] === LOW[id]) return HIGH[id] >= 11 ? 1 : HIGH[id] === 10 ? 0.43 : 0.003;
      return HIGH[id] === 12 && LOW[id] === 11 ? (SUITED[id] ? 0.78 : 0.40) : 0.003;
    }
    if (p === 12) return 0.004 + clamp((RATING[id] - 62) / 17);
    return HIGH[id] === LOW[id] && HIGH[id] >= 11 ? 1 : 0.0015;
  }),
);

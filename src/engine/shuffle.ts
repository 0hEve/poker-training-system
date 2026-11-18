import type { Card } from './cards';

/** Uniform random integer in [0, n) using crypto with rejection sampling (no modulo bias). */
export function randomInt(n: number, rng: () => number = cryptoUint32): number {
  if (n <= 0 || n > 2 ** 32) throw new RangeError('n out of range');
  const limit = Math.floor(2 ** 32 / n) * n;
  let x: number;
  do x = rng(); while (x >= limit);
  return x % n;
}

const buf = new Uint32Array(64);
let bufPos = buf.length;
function cryptoUint32(): number {
  if (bufPos >= buf.length) {
    globalThis.crypto.getRandomValues(buf);
    bufPos = 0;
  }
  return buf[bufPos++];
}

/** In-place Fisher–Yates shuffle. Returns the same array. */
export function shuffle<T>(arr: T[], rng?: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export function shuffledDeck(rng?: () => number): Card[] {
  return shuffle(Array.from({ length: 52 }, (_, i) => i), rng);
}

/** Deterministic PRNG (mulberry32) returning uint32 — for tests and seeded art. */
export function seededUint32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

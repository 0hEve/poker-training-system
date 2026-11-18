/** Small, fast, seedable PRNGs for simulations and bots. */

/** sfc32 generator returning floats in [0, 1). Seed with any 32-bit integers. */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** 32-bit integer hash (lowbias32), handy for deriving independent seeds. */
export function hash32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Deterministic generator for (seed, stream) pairs. */
export function rngFor(seed: number, stream: number): () => number {
  const s = hash32(seed ^ hash32(stream + 0x9e3779b9));
  const rnd = sfc32(s, hash32(s + 1), hash32(s + 2), hash32(s + 3));
  for (let i = 0; i < 12; i++) rnd();
  return rnd;
}

/** Fill `deck` (length 52) with a uniformly shuffled deck. */
export function shuffleDeck(deck: Int8Array | number[], rnd: () => number): void {
  for (let i = 0; i < 52; i++) deck[i] = i;
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
  }
}

/** Tunable knobs (defaults are the tuned values). Variant bots override some for A/B tests. */
export interface Params {
  /** Softmax temperature: max(tempBB * bb, tempPot * pot). */
  postTempBB: number;
  postTempPot: number;
  preTempBB: number;
  preTempPot: number;
  /** Postflop equity realisation when checking/calling: [street][ip ? 1 : 0]. */
  realizeFlop: [number, number];
  realizeTurn: [number, number];
  /** Monte Carlo budget (samples x (opponents + 1)) by pot size: small / medium / big. */
  mcBudget: [number, number, number];
  /** Open size in big blinds (non-SB), SB open size. */
  openBB: number;
  sbOpenBB: number;
  /** Multiplier on modelled opponent fold rates (exploit aggressiveness). */
  foldScale: number;
  /** Shrink each opponent toward the pooled population model instead of fixed priors. */
  pooledPrior: boolean;
}

export const DEFAULT_PARAMS: Params = {
  postTempBB: 0.2,
  postTempPot: 0.017,
  preTempBB: 0.25,
  preTempPot: 0.02,
  realizeFlop: [0.83, 0.95],
  realizeTurn: [0.92, 0.98],
  mcBudget: [300, 420, 560],
  openBB: 2.5,
  sbOpenBB: 3,
  foldScale: 1,
  pooledPrior: false,
};

export function paramsFrom(overrides: string | undefined): Params {
  if (!overrides) return DEFAULT_PARAMS;
  return { ...DEFAULT_PARAMS, ...JSON.parse(overrides) };
}

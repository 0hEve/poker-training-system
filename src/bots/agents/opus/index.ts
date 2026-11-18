import type { BotSpec, BotView, Decision, HandSummary, PokerBot } from '../../types';
import { rngFor } from '../../../sim/rng';
import { decidePostflop, decidePreflop, type Ctx } from './decide';
import { learnFromHand, Models, PlayerModel } from './model';
import { HandTracker } from './tracker';
import { DEFAULT_PARAMS, paramsFrom, type Params } from './params';

/**
 * Opus bot — Bayesian range tracking + EV-maximising action selection.
 *
 * - Preflop: research-based opening charts, then EV against each opponent's modelled
 *   range (precomputed 169x169 equity matrix) for calls, 3-bets, 4-bets and jams.
 * - Postflop: every opponent's 1326-combo range is narrowed by each action using that
 *   player's own modelled frequencies; Monte Carlo equity vs those ranges (exact on
 *   heads-up rivers) gives fold equity and equity-when-called for each bet size.
 * - Opponent models: per-opportunity stats with Beta priors, calibrated by showdowns.
 * - Mixed strategy: softmax over option EVs.
 */
class OpusBot implements PokerBot {
  private models: Map<string, PlayerModel>;
  private tracker = new HandTracker();
  private ctx: Ctx;

  learn = true;

  constructor(seed: number, debug?: Ctx['debug'], p: Params = DEFAULT_PARAMS) {
    this.models = p.pooledPrior ? new Models() : new Map();
    this.ctx = { v: null as unknown as BotView, tracker: this.tracker, models: this.models, rnd: rngFor(seed, 77), p, debug };
  }

  decide(v: BotView): Decision {
    this.ctx.v = v;
    this.tracker.update(v, this.models);
    return v.street === 0 ? decidePreflop(this.ctx) : decidePostflop(this.ctx);
  }

  handEnd(s: HandSummary): void {
    if (!this.learn) return;
    // Reuse the tracker's board tables when it followed this hand; otherwise build them for this board.
    const t = this.tracker;
    if (t.handId !== s.handId) t.resetForBoard(s.handId);
    learnFromHand(this.models, s, s.seat, (street) => t.strengthFor(street, s.board));
  }
}

const spec: BotSpec = {
  id: 'opus',
  name: 'Opus 5.5',
  description: 'Bayesian range tracking, opponent modelling and EV-based mixed strategy.',
  create: ({ seed }) => new OpusBot(seed),
};

/** Same bot with opponent modelling switched off (priors only) — a control for experiments. */
const staticSpec: BotSpec = {
  id: 'opus-static',
  name: 'Opus 5.5 (no adaptation)',
  description: 'Opus without opponent modelling; control for adaptation experiments.',
  create: ({ seed }) => {
    const b = new OpusBot(seed);
    b.learn = false;
    return b;
  },
};

/** A/B variant: parameters from the OPUS_B environment variable (JSON), tools only. */
const variantSpec: BotSpec = {
  id: 'opus-b',
  name: 'Opus 5.5 (variant B)',
  description: 'Opus with parameter overrides from OPUS_B (for tuning).',
  create: ({ seed }) => new OpusBot(seed, undefined, paramsFrom((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.OPUS_B)),
};

export default [spec, staticSpec, variantSpec];

/** For tools: a bot instance that reports its postflop reasoning. */
export const createDebugBot = (seed: number, debug: Ctx['debug']) => new OpusBot(seed, debug);

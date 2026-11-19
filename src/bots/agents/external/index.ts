import type { BotSpec, BotView, Decision, HandSummary, PokerBot } from '../../types';
import { requestAsync, requestSync } from '../../remote/transport';

/**
 * External bots, run from their upstream repositories (external/*) by the local bot gateway
 * (native/bot-gateway). Every surface uses them the same way: the live table, the simulator and
 * bankroll workers, and the CLI. See docs/external-bots.md.
 *
 * When the gateway is down, a bot is still loading, or a spot is outside what it was trained
 * for (e.g. Slumbot at a 6-max table), the seat plays a passive fallback (check, else fold) and
 * the miss is counted; the UI shows each bot's live status from the gateway.
 */

export interface RemoteInfo {
  /** Dealt players the bot supports: [min, max]. */
  seats: [number, number];
  source: string;
}

export interface RemoteBotSpec extends BotSpec {
  remote: RemoteInfo;
}

interface DecideReply {
  ok: boolean;
  decision?: Decision;
  source?: string;
  error?: string;
  ms?: number;
}

/** Counts per bot id, readable by the UI (`remoteStats`). */
export const remoteStats = new Map<string, { answered: number; fallbacks: number; lastError?: string }>();

let instanceCounter = 0;
/** Set false to get a silent check/fold instead of an exception when the gateway can't answer. */
export let throwOnFallback = true;
export const setThrowOnFallback = (on: boolean) => {
  throwOnFallback = on;
};

function passive(v: BotView): Decision {
  return v.toCall === 0 ? { type: 'check' } : { type: 'fold' };
}

/** Plain copy of a view (the simulator reuses view arrays between calls). */
function snapshot(v: BotView) {
  return {
    handId: v.handId,
    numSeats: v.numSeats,
    seat: v.seat,
    sbSeat: v.sbSeat,
    bbSeat: v.bbSeat,
    smallBlind: v.smallBlind,
    bigBlind: v.bigBlind,
    ante: v.ante,
    playerIds: [...v.playerIds],
    street: v.street,
    hole: [...v.hole],
    board: [...v.board],
    stacks: [...v.stacks],
    startStacks: [...v.startStacks],
    bets: [...v.bets],
    committed: [...v.committed],
    folded: [...v.folded],
    allIn: [...v.allIn],
    pot: v.pot,
    currentBet: v.currentBet,
    toCall: v.toCall,
    canRaise: v.canRaise,
    minRaiseTo: v.minRaiseTo,
    maxRaiseTo: v.maxRaiseTo,
    actions: v.actions.map((a) => ({ ...a })),
  };
}

function remote(id: string, name: string, description: string, info: RemoteInfo): RemoteBotSpec {
  return {
    id,
    name,
    description,
    remote: info,
    create({ seed, playerId }): PokerBot {
      const instance = `${id}:${playerId}:${seed}:${++instanceCounter}`;
      let pending: unknown[] = [];
      const stats = remoteStats.get(id) ?? { answered: 0, fallbacks: 0 };
      remoteStats.set(id, stats);
      let warned = false;
      function request(v: BotView) {
        const events = pending;
        pending = [];
        return { bot: id, instance, seed: (seed + v.handId * 7919) >>> 0, view: snapshot(v), events };
      }
      function decideFromReply(v: BotView, r: DecideReply): Decision {
        if (r.ok && r.decision) {
          stats.answered++;
          return r.decision;
        }
        stats.fallbacks++;
        stats.lastError = r.error;
        if (!warned) {
          warned = true;
          console.warn(`[${name}] passive fallback: ${r.error ?? 'no answer'}`);
        }
        // Throwing lets the caller count the miss and apply its own check/fold fallback.
        if (throwOnFallback) throw new Error(`${name}: ${r.error ?? 'no answer from bot gateway'}`);
        return passive(v);
      }
      return {
        decide(v) {
          return decideFromReply(v, requestSync<DecideReply>('/v1/decide', request(v)));
        },
        async decideAsync(v, signal) {
          let reply: DecideReply;
          try {
            reply = await requestAsync<DecideReply>('/v1/decide', request(v), signal);
          } catch (e) {
            if (signal.aborted) throw e;
            reply = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          signal.throwIfAborted();
          return decideFromReply(v, reply);
        },
        handEnd(s: HandSummary) {
          pending.push(JSON.parse(JSON.stringify(s)));
          if (pending.length > 50) pending.shift();
        },
      };
    },
  };
}

const bots: RemoteBotSpec[] = [
  remote('sharingan', 'Sharingan', 'Open Pluribus reproduction (Rust): MCCFR blueprint only, as on its public benchmark track (~1–2 ms a decision). 2–6 players.', {
    seats: [2, 6],
    source: 'https://github.com/markokraemer/poker-sharingan',
  }),
  remote('sharingan-search', 'Sharingan + search', 'Sharingan at full strength: blueprint plus turn/river real-time search (often seconds per search). 2–6 players.', {
    seats: [2, 6],
    source: 'https://github.com/markokraemer/poker-sharingan',
  }),
  remote('cfr-nlhe', 'CFR-NLHE', 'Tabular opponent-sampled CFR averages with K50 buckets: HU20/HU100/HU200 heads-up by depth, v0.6.0 blueprint 3-handed.', {
    seats: [2, 3],
    source: 'https://github.com/dberweger2017/CFR-NLHE-6max',
  }),
  remote('slumbot', 'Slumbot 2019', 'ACPC-champion CFR framework, locally trained MCCFR blueprint (heads-up 100 BB) with upstream bet translation.', {
    seats: [2, 2],
    source: 'https://github.com/ericgjackson/slumbot2019',
  }),
  remote('decisionholdem', 'DecisionHoldem', 'Heads-up blueprint + depth-limited search. Not runnable here: closed Linux binaries, Baidu-only data, ~100 GB RAM.', {
    seats: [2, 2],
    source: 'https://github.com/AI-Decision/DecisionHoldem',
  }),
];

export default bots;

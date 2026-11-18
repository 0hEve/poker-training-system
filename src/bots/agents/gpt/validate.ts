/// <reference types="node" />

import type { BotSpec, BotView, Decision, PokerBot } from '../../types';
import { builtinBots } from '../../builtin';
import { evalWith2 } from '../../../sim/eval';
import { runMatch, summarize, type MatchConfig, type MatchResult } from '../../../sim/match';
import { rngFor } from '../../../sim/rng';
import gpt, { createGpt } from './index';
import { drawOf, newTexture, readTexture, tierOf } from './cards';
import { abandon, passive, raiseTo } from './preflop';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const frozen: BotSpec = { ...gpt, id: 'frozen', create: ({ seed }) => createGpt(seed, false) };
const leaky: BotSpec = {
  ...frozen,
  id: 'overfolder',
  create(opts): PokerBot {
    const base = frozen.create(opts);
    const texture = newTexture();
    const rng = rngFor(opts.seed, 900);
    return {
      decide(v) {
        if (v.street && v.toCall > v.pot * 0.14) {
          readTexture(texture, v.board, v.board.length);
          const [a, b] = v.hole;
          const value = tierOf(texture, a, b, evalWith2(texture.acc, a, b));
          if (value <= 5 && rng() < 0.88) return abandon(v);
        }
        return base.decide(v);
      },
    };
  },
};

const overbluffer: BotSpec = {
  ...frozen,
  id: 'overbluffer',
  create(opts): PokerBot {
    const base = frozen.create(opts);
    const texture = newTexture();
    const rng = rngFor(opts.seed, 917);
    return {
      decide(v) {
        if (v.street && v.canRaise && v.currentBet === 0) {
          const [a, b] = v.hole;
          readTexture(texture, v.board, v.board.length);
          const value = tierOf(texture, a, b, evalWith2(texture.acc, a, b));
          const freq = v.street === 3 ? 0.83 : 0.49;
          if (value <= 2 && rng() < freq) return raiseTo(v, v.pot * (v.street === 3 ? 1.25 : 0.60));
        }
        return base.decide(v);
      },
    };
  },
};

const pressure: BotSpec = {
  ...frozen,
  id: 'pressure',
  create(opts): PokerBot {
    const base = frozen.create(opts);
    const texture = newTexture();
    const rng = rngFor(opts.seed, 934);
    return {
      decide(v) {
        const baseAction = base.decide(v);
        if (!v.street || !v.canRaise) return baseAction;
        const [a, b] = v.hole;
        readTexture(texture, v.board, v.board.length);
        const score = evalWith2(texture.acc, a, b);
        const tier = tierOf(texture, a, b, score);
        const draw = drawOf(texture, a, b, score);
        const size = v.currentBet + (v.pot + v.toCall) * 1.20;
        if (v.toCall === 0 && (tier >= 8 || tier >= 7 && rng() < 0.75)) return raiseTo(v, size);
        if (v.toCall === 0 && draw >= 2 && (v.street === 2 || v.seat === 0) && rng() < 0.53) {
          return raiseTo(v, size);
        }
        if (v.street === 3 && v.toCall > 0 && tier === 6 && v.toCall < v.pot * 0.45 && rng() < 0.77) {
          return passive(v);
        }
        return baseAction;
      },
    };
  },
};

const control = { ...frozen, id: 'control' };
const specs = new Map([...builtinBots, gpt, frozen, control, leaky, overbluffer, pressure].map((spec) => [spec.id, spec]));
const resolver = (id: string) => specs.get(id)!;
const lineup = (a: string, b: string, hands: number, seed: number): MatchConfig =>
  ({ seats: [a, b, a, b, a, b], hands, seed });

function run(a: string, b: string, hands: number, seed: number) {
  const result = runMatch(lineup(a, b, hands, seed), resolver);
  const report = summarize(result)[0];
  console.log(`${a} vs ${b}, seed ${seed}, ${hands} decks: ${report.bb100.toFixed(2)} ± ${report.ci95.toFixed(2)} bb/100, ${report.usPerDecision.toFixed(2)} µs, ${report.invalid} invalid, ${report.errors} errors`);
  return result;
}

function adaptation(hands: number, seed: number) {
  for (const opponent of ['overfolder', 'overbluffer', 'pressure', 'frozen']) {
    const adaptive = run('gpt', opponent, hands, seed);
    const baseline = run('control', opponent, hands, seed);
    const delta = summarize(adaptive)[0].bb100 - summarize(baseline)[0].bb100;
    console.log(`Adaptation lift vs ${opponent}: ${delta.toFixed(2)} bb/100 on the same decks`);
  }
}

function latency(hands: number, opponent: string, seed: number) {
  const times: number[][] = [[], [], [], []];
  let record = false;
  const resolve = (id: string) => {
    if (id !== 'gpt') return resolver(id);
    return {
      ...gpt,
      create(opts: Parameters<BotSpec['create']>[0]) {
        const bot = gpt.create(opts);
        return {
          decide(v: BotView): Decision {
            const start = performance.now();
            const result = bot.decide(v);
            if (record) times[v.street].push(1000 * (performance.now() - start));
            return result;
          },
          handEnd: bot.handEnd,
        };
      },
    };
  };
  runMatch(lineup('gpt', opponent, 5000, seed), resolve);
  record = true;
  const result = runMatch(lineup('gpt', opponent, hands, seed + 1), resolve);
  const report = summarize(result)[0];
  console.log(`gpt vs ${opponent}, ${hands} decks: ${report.invalid} invalid, ${report.errors} errors`);
  for (const [name, values] of [
    ['all', times.flat()], ['preflop', times[0]], ['flop', times[1]], ['turn', times[2]], ['river', times[3]],
  ] as const) {
    values.sort((a, b) => a - b);
    const mean = values.reduce((sum, us) => sum + us, 0) / values.length;
    const pct = (q: number) => values[Math.ceil(values.length * q) - 1]?.toFixed(2);
    console.log(`${name.padEnd(8)} ${values.length} decisions, mean ${mean.toFixed(2)} µs (${(1e6 / mean).toFixed(0)}/s), p50 ${pct(0.50)}, p95 ${pct(0.95)}, p99 ${pct(0.99)}, max ${pct(1)}, >100µs ${values.filter((x) => x > 100).length}`);
  }
}

function fingerprint(result: MatchResult) {
  return Object.values(result.totals).map(({ id, net, decisions, invalid, errors, vpip, pfr }) =>
    [id, net, decisions, invalid, errors, vpip, pfr].join(':')).join('/');
}

function verify(seed: number) {
  for (const size of [2, 3, 6, 10]) {
    for (const stack of [45, 100, 260, 1000]) {
      const cfg: MatchConfig = {
        seats: Array.from({ length: size }, (_, seat) => seat % 2 ? 'random' : 'gpt'),
        hands: 750, seed, stack, ante: stack === 260 ? 2 : 0,
      };
      const a = runMatch(cfg, resolver);
      const b = runMatch(cfg, resolver);
      if (fingerprint(a) !== fingerprint(b)) throw new Error(`Non-deterministic play at size ${size}, stack ${stack}`);
      for (const row of Object.values(a.totals)) {
        if (row.invalid || row.errors) throw new Error(`Invalid play at size ${size}, stack ${stack}: ${fingerprint(a)}`);
      }
    }
  }
  console.log('Deterministic, zero errors and invalid actions over 48,000 replayed table hands (2–10 seats, 4.5–100bb).');
}

export async function validate(args: string[]) {
  const [mode = 'verify', hands = '50000', seed = '13091', opponent = 'gpt'] = args;
  if (mode === 'adaptation') adaptation(Number(hands), Number(seed));
  else if (mode === 'latency') latency(Number(hands), opponent, Number(seed));
  else if (mode === 'verify') verify(Number(seed));
  else if (mode === 'match' && specs.has(opponent)) run('gpt', opponent, Number(hands), Number(seed));
  else if (mode === 'compare') {
    const { default: snapshot }: { default: BotSpec } = await import(pathToFileURL(resolve(opponent)).href);
    specs.set('snapshot', { ...snapshot, id: 'snapshot' });
    run('gpt', 'snapshot', Number(hands), Number(seed));
  } else throw new Error(`Unknown validation mode or opponent: ${mode}, ${opponent}`);
}

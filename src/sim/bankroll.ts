import type { BotResolver } from './match';
import type { PokerBot } from '../bots/types';
import { hash32, rngFor, shuffleDeck } from './rng';
import { FastTable } from './table';

/**
 * Bankroll session: a fixed group of bots at one table, stacks carried over from hand
 * to hand (no reset), blinds constant, the button moving every hand. Shows how each
 * player's money grows or shrinks over a long session.
 */

export interface BankrollConfig {
  /** Bot id per player, in seating order (2..10 players). */
  players: string[];
  /** Display name per player (defaults to the bot id). */
  names?: string[];
  /** Starting stack for everyone, in chips. */
  stack: number;
  smallBlind: number;
  bigBlind: number;
  seed: number;
  /** Busted players rebuy for `stack` (counted in `rebuys`) instead of leaving the table. */
  rebuy: boolean;
  /** Stop after this many hands (Infinity = until one player is left). */
  maxHands: number;
}

export interface BankrollPlayer {
  name: string;
  bot: string;
  stack: number;
  /** Chips won minus chips lost (stack - stack at start - rebuys). */
  net: number;
  rebuys: number;
  handsPlayed: number;
  handsWon: number;
  biggestPot: number;
  /** Hand number in which the player went broke (no-rebuy mode), else null. */
  bustedAt: number | null;
}

export interface BankrollSnapshot {
  hand: number;
  players: BankrollPlayer[];
  /** Index of the player on the button for the last hand. */
  button: number;
  done: boolean;
  /** Bot decisions per second over the session so far. */
  decisionsPerSec: number;
}

export class BankrollSession {
  readonly cfg: BankrollConfig;
  readonly players: BankrollPlayer[];
  private bots: PokerBot[];
  private ids: string[];
  private table: FastTable;
  private deck = new Int8Array(52);
  private hand = 0;
  private button = -1;
  private decisions = 0;
  private thinkMs = 0;

  constructor(cfg: BankrollConfig, resolve: BotResolver) {
    if (cfg.players.length < 2 || cfg.players.length > 10) throw new Error('A table needs 2..10 players');
    if (!(cfg.bigBlind > 0) || cfg.smallBlind < 0 || cfg.stack < cfg.bigBlind) throw new Error('Stack must be at least one big blind');
    this.cfg = cfg;
    this.ids = cfg.players.map((_, i) => `S${i + 1}`);
    this.bots = cfg.players.map((id, i) => resolve(id).create({ seed: hash32(cfg.seed * 7919 + i * 104729 + 17), playerId: this.ids[i] }));
    this.players = cfg.players.map((bot, i) => ({
      name: cfg.names?.[i] ?? bot,
      bot,
      stack: cfg.stack,
      net: 0,
      rebuys: 0,
      handsPlayed: 0,
      handsWon: 0,
      biggestPot: 0,
      bustedAt: null,
    }));
    this.table = new FastTable({ smallBlind: cfg.smallBlind, bigBlind: cfg.bigBlind, ante: 0 });
  }

  get handsPlayed() {
    return this.hand;
  }

  get done(): boolean {
    if (this.hand >= this.cfg.maxHands) return true;
    return !this.cfg.rebuy && this.players.filter((p) => p.stack > 0).length < 2;
  }

  /** Play up to `n` hands (fewer if the session ends). Returns the number played. */
  play(n: number): number {
    let played = 0;
    while (played < n && !this.done) {
      this.playOne();
      played++;
    }
    return played;
  }

  private playOne() {
    const P = this.players;
    if (this.cfg.rebuy)
      for (const p of P)
        if (p.stack === 0) {
          p.stack = this.cfg.stack;
          p.rebuys++;
        }
    const N = P.length;
    // Next player with chips clockwise gets the button.
    let b = this.button;
    for (let k = 1; k <= N; k++) {
      const i = (b + k + N) % N;
      if (P[i].stack > 0) {
        b = i;
        break;
      }
    }
    this.button = b;
    const order: number[] = [];
    for (let k = 0; k < N; k++) {
      const i = (b + k) % N;
      if (P[i].stack > 0) order.push(i);
    }
    shuffleDeck(this.deck, rngFor(this.cfg.seed, this.hand));
    const net = this.table.playHand(
      order.map((i) => this.bots[i]),
      order.map((i) => this.ids[i]),
      order.map((i) => P[i].stack),
      this.deck,
      this.hand,
    );
    this.hand++;
    let pot = 0;
    for (let k = 0; k < order.length; k++) if (net[k] > 0) pot += net[k];
    for (let k = 0; k < order.length; k++) {
      const p = P[order[k]];
      const st = this.table.stats[k];
      this.decisions += st.decisions;
      this.thinkMs += st.thinkMs;
      p.stack += net[k];
      p.net += net[k];
      p.handsPlayed++;
      if (net[k] > 0) {
        p.handsWon++;
        if (pot > p.biggestPot) p.biggestPot = pot;
      }
      if (p.stack === 0 && !this.cfg.rebuy) p.bustedAt = this.hand;
    }
  }

  snapshot(): BankrollSnapshot {
    return {
      hand: this.hand,
      players: this.players.map((p) => ({ ...p })),
      button: this.button,
      done: this.done,
      decisionsPerSec: this.thinkMs > 0 ? this.decisions / (this.thinkMs / 1000) : 0,
    };
  }
}

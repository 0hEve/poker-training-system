import type { HandSummary, BotView } from '../../types';
import { evalWith2 } from '../../../sim/eval';
import { classOf, clamp, newTexture, readTexture, tierOf } from './cards';
import { EQUITY_PROFILES } from './charts';
import { History, SIZE_BANDS, sizeBand } from './history';

const ENTER = 0;
const RFI = 1;
const THREE_BET = 2;
const PREFLOP_FOLD = 3;
const SHOWN_RAISE = 4;
const SHOWN_HUGE = 5;
const BET_RATE = 6;
const BET_FOLD = 12;
const AGGRO = 24;
const SHOWN_WEAK = 30;
const BIG_BET = 36;
const FOLD_TO_THREE = 42;
const SIZE_SHOWDOWN = 43;
const CELLS = SIZE_SHOWDOWN + 3 * SIZE_BANDS;
const RFI_BASE = [0.19, 0.25, 0.32, 0.48, 0.46, 0.34];

export class Profile {
  readonly events = new Float32Array(CELLS);
  readonly yes = new Float32Array(CELLS);
  readonly expected = new Float32Array(4);
  loose = 0;
  light = 0;
  wild = 0;
  foldPre = 0.48;
  foldThree = 0.48;
  readonly sticky = new Float32Array(4);
  readonly looseBet = new Float32Array(4);
  readonly largeBluff = new Float32Array(4);
  readonly sizeSignal = new Float32Array(3 * SIZE_BANDS);
  readonly overfold = new Float32Array(4);
  readonly folds = new Float32Array([0, 0.37, 0.49, 0.43, 0.55, 0.46, 0.59]);

  record(cell: number, success: boolean) {
    this.events[cell]++;
    this.yes[cell] += Number(success);
  }

  compare(cell: number, success: boolean, expected: number) {
    this.record(cell, success);
    this.expected[cell] += expected;
  }

  refresh(decay: number) {
    const events = this.events;
    const yes = this.yes;
    for (let i = 0; i < CELLS; i++) {
      events[i] *= decay;
      yes[i] *= decay;
    }
    const expected = this.expected;
    for (let i = 0; i < expected.length; i++) expected[i] *= decay;
    const vpip = (yes[ENTER] + 48 * 0.26) / (events[ENTER] + 48);
    const rfi = (yes[RFI] - expected[RFI]) / (events[RFI] + 64);
    this.loose = clamp(vpip - 0.27, -0.19, 0.66);
    this.foldPre = clamp(0.48 + (yes[PREFLOP_FOLD] - expected[PREFLOP_FOLD]) / (events[PREFLOP_FOLD] + 64));
    this.foldThree = (yes[FOLD_TO_THREE] + 68 * 0.48) / (events[FOLD_TO_THREE] + 68);
    const light = yes[SHOWN_RAISE] / (events[SHOWN_RAISE] + 36);
    const huge = yes[SHOWN_HUGE] / (events[SHOWN_HUGE] + 18);
    const threeBet = (yes[THREE_BET] - expected[THREE_BET]) / (events[THREE_BET] + 80);
    // Showdowns are selected. They give weight to a wide-range hypothesis only
    // after seeing enough outliers, particularly large raises with weak hands.
    this.wild = clamp((huge - 0.05) * 2.2 + (light - 0.13) * 1.3, 0, 0.86);
    this.light = clamp(rfi + threeBet * 1.8 + this.wild * 0.32, -0.26, 0.55);
    for (let street = 1; street <= 3; street++) {
      const s = street - 1;
      const small = BET_FOLD + s * 4;
      const large = small + 1;
      const otherSmall = small + 2;
      const otherLarge = small + 3;
      const n = events[small] + events[large] + events[otherSmall] + events[otherLarge];
      const y = yes[small] + yes[large] + yes[otherSmall] + yes[otherLarge];
      const base = 0.42 + 0.05 * s;
      const fold = (y + 60 * base) / (n + 60);
      this.sticky[street] = clamp((base - fold) * 1.9, -0.32, 0.86);
      this.folds[2 * street - 1] = (yes[small] + yes[otherSmall] + 66 * (base - 0.05)) /
        (events[small] + events[otherSmall] + 66);
      this.folds[2 * street] = (yes[large] + yes[otherLarge] + 66 * (base + 0.07)) /
        (events[large] + events[otherLarge] + 66);
      const first = BET_RATE + 2 * s;
      const aggro = AGGRO + 2 * s;
      const weak = SHOWN_WEAK + 2 * s;
      const bigBet = BIG_BET + 2 * s;
      const baseBet = street === 1 ? 0.42 : street === 2 ? 0.33 : 0.31;
      const checkBet = (yes[first] + yes[first + 1] + 84 * baseBet) / (events[first] + events[first + 1] + 84);
      const raises = (yes[aggro] + yes[aggro + 1] + 85 * 0.085) / (events[aggro] + events[aggro + 1] + 85);
      const nExposed = events[weak] + events[weak + 1];
      const weakBase = street === 1 ? 0.25 : street === 2 ? 0.21 : 0.23;
      const exposed = (yes[weak] + yes[weak + 1] + 46 * weakBase) / (nExposed + 46);
      const bigBase = street === 1 ? 0.105 : street === 2 ? 0.12 : 0.13;
      const bigRate = (yes[bigBet] + yes[bigBet + 1] + 72 * bigBase) / (events[bigBet] + events[bigBet + 1] + 72);
      const bigExposed = (yes[weak + 1] + 32 * weakBase) / (events[weak + 1] + 32);
      const bigEvidence = 0.025 + 0.78 / Math.sqrt(events[weak + 1] + 32);
      const excess = exposed - weakBase;
      const shownSignal = Math.max(0, excess - 0.045) * 1.65 + Math.min(0, excess + 0.075) * 0.6;
      this.looseBet[street] = clamp((checkBet - baseBet) * 0.55 + (raises - 0.085) * 0.7
        + shownSignal + this.wild * 0.57, -0.13, 0.60);
      this.largeBluff[street] = clamp(Math.max(0, bigRate - bigBase - 0.052) * 1.27
        + Math.max(0, bigExposed - weakBase - bigEvidence) * 1.85, 0, 0.52);
      const foldEvidence = 0.046 + 0.81 / Math.sqrt(n + 30);
      this.overfold[street] = clamp((fold - base - foldEvidence) * 2.6, 0, 0.53);
      for (let band = 0; band < SIZE_BANDS; band++) {
        const at = s * SIZE_BANDS + band;
        const n = events[SIZE_SHOWDOWN + at];
        const baseWeak = band <= 2 ? weakBase + 0.02 : weakBase - 0.025;
        const shape = (yes[SIZE_SHOWDOWN + at] - baseWeak * n) / (n + 18);
        this.sizeSignal[at] = clamp(Math.max(0, shape - 0.061) * 2.2 + Math.min(0, shape + 0.095) * 0.65, -0.12, 0.53);
      }
    }
  }
}

export class Opponents {
  private readonly players = new Map<string, Profile>();
  private readonly neutral = new Profile();
  private readonly history = new History();
  private readonly textures = [newTexture(), newTexture(), newTexture()];
  private readonly tracked = new Array<Profile>(10);
  private readonly entered = new Uint8Array(10);
  private readonly preShown = new Int16Array(10);
  private hands = 0;
  readonly seats = new Array<Profile>(10);

  constructor(private readonly enabled: boolean) {}

  read(v: BotView) {
    for (let i = 0; i < v.numSeats; i++) this.seats[i] = this.players.get(v.playerIds[i]) ?? this.neutral;
  }

  observe(s: HandSummary) {
    if (!this.enabled) return;
    const { numSeats: n, actions, bigBlind, shown } = s;
    const h = this.history;
    // In six-max the last two posts are SB/BB, even when antes are enabled.
    let posts = 0;
    while (posts < actions.length && actions[posts].kind === 'post') posts++;
    const sb = posts >= 2 ? actions[posts - 2].seat : n === 2 ? 0 : 1;
    const bb = posts >= 1 ? actions[posts - 1].seat : n === 2 ? 1 : 2;
    h.reset(n, bigBlind, sb, bb, 0);
    for (let i = 0; i < n; i++) {
      const id = s.playerIds[i];
      let p = this.players.get(id);
      if (!p) this.players.set(id, p = new Profile());
      this.tracked[i] = p;
      const hole = shown[i];
      this.preShown[i] = hole ? classOf(hole[0], hole[1]) : -1;
    }
    this.entered.fill(0);
    for (let i = 0; i < 3 && i + 3 <= s.board.length; i++) readTexture(this.textures[i], s.board, i + 3);
    for (let j = 0; j < actions.length; j++) {
      const a = actions[j];
      if (j < posts - 2) {
        h.pot += a.amount;
        continue;
      }
      h.advance(a.street);
      const { seat, street, kind, amount } = a;
      if (seat !== s.seat && kind !== 'post') {
        const p = this.tracked[seat];
        const aggressive = kind === 'bet' || kind === 'raise';
        const faces = h.price > h.streetPutIn[seat];
        if (street === 0) {
          if (!this.entered[seat] && (faces || h.raises[0] > 0)) {
            p.record(ENTER, aggressive || kind === 'call');
            this.entered[seat] = 1;
          }
          const raises = h.raises[0];
          const pos = h.pos(seat);
          if (raises === 0 && h.limpers === 0 && faces) p.compare(RFI, aggressive, RFI_BASE[pos]);
          if (raises === 1 && faces) {
            const opener = h.pos(h.firstAggressor[0]);
            p.compare(THREE_BET, aggressive, (pos >= 4 ? 0.051 : 0.047) + 0.011 * opener);
            if (h.price <= 4 * bigBlind && h.callers === 0) {
              const baseline = pos === 5 ? 0.62 - 0.043 * opener + 0.095 * (h.price / bigBlind - 2.2)
                : pos === 4 ? 0.91 - 0.015 * opener : 0.94 - 0.017 * opener;
              p.compare(PREFLOP_FOLD, kind === 'fold', baseline);
            }
          }
          if (raises === 2 && h.preRaises[seat] && faces && h.price <= 16 * bigBlind) {
            p.record(FOLD_TO_THREE, kind === 'fold');
          }
          const id = this.preShown[seat];
          if (aggressive && id >= 0) {
            const prior = raises === 0 ? Math.min(5, h.pos(seat) + 1) : raises === 1 ? 9 : 10;
            p.record(SHOWN_RAISE, EQUITY_PROFILES[prior][id] < 0.09);
            if (amount >= 11 * bigBlind && (raises === 0 || amount >= 2.8 * h.price)) {
              p.record(SHOWN_HUGE, EQUITY_PROFILES[7][id] < 0.13);
            }
          }
        } else {
          const offset = 2 * (street - 1);
          const multi = Number(h.live > 2);
          const size = aggressive ? (amount - h.price) / Math.max(bigBlind, h.pot + h.price - h.streetPutIn[seat]) : 0;
          if (faces) {
            p.record(AGGRO + offset + multi, aggressive);
            if (!a.allIn && h.raises[street] === 1) {
              const size = Number(h.lastBetSize > 0.51);
              const other = h.lastAggressor[street] === s.seat ? 0 : 2;
              p.record(BET_FOLD + offset * 2 + other + size, kind === 'fold');
            }
          } else if (h.price === 0) {
            p.record(BET_RATE + offset + multi, aggressive);
            p.record(BIG_BET + offset + multi, aggressive && size > 0.51);
          }
          const hole = shown[seat];
          if (aggressive && hole) {
            const t = this.textures[street - 1];
            const tier = tierOf(t, hole[0], hole[1], evalWith2(t.acc, hole[0], hole[1]));
            const weak = tier <= (street === 3 ? 3 : 2);
            p.record(SHOWN_WEAK + offset + Number(size > 0.51), weak);
            p.record(SIZE_SHOWDOWN + (street - 1) * SIZE_BANDS + sizeBand(size), weak);
          }
        }
      }
      h.apply(a);
    }
    if ((++this.hands & 63) === 0) {
      for (const p of this.players.values()) p.refresh(0.982);
    }
  }
}

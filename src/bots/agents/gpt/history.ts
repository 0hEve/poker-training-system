import type { ActionEvent, BotView } from '../../types';
import { position, postOrder } from './charts';

export const CHECKED = 1;
export const CALLED = 2;
export const BET = 5;
export const RAISED = 8;
export const RERAISED = 9;
export const OVERBET = 10;
export const BET_CALLED_RAISE = 11;
export const RAISE_CALLED_RERAISE = 12;
export const SIZE_BANDS = 8;
export const sizeBand = (size: number) => size < 0.34 ? 0 : size < 0.50 ? 1 : size < 0.67 ? 2
  : size < 0.94 ? 3 : size < 1.12 ? 4 : size < 1.37 ? 5 : size < 1.65 ? 6 : 7;

export class History {
  readonly line = new Uint8Array(40);
  readonly sizes = new Uint8Array(40);
  readonly streetPutIn = new Float64Array(10);
  readonly preProfile = new Uint8Array(10);
  readonly preRaises = new Uint8Array(10);
  readonly preContinues = new Uint8Array(10);
  readonly lastAggressor = new Int8Array(4);
  readonly firstAggressor = new Int8Array(4);
  readonly raises = new Uint8Array(4);
  callers = 0;
  limpers = 0;
  pot = 0;
  price = 0;
  street = 0;
  live = 0;
  preOpenTo = 0;
  seats = 0;
  sb = 0;
  bb = 0;
  blind = 0;
  lastBetSize = 0;

  reset(seats: number, blind: number, sb: number, bb: number, ante: number) {
    this.seats = this.live = seats;
    this.sb = sb;
    this.bb = bb;
    this.blind = blind;
    this.line.fill(0);
    this.preProfile.fill(0);
    this.preRaises.fill(0);
    this.preContinues.fill(0);
    this.streetPutIn.fill(0);
    this.firstAggressor.fill(-1);
    this.lastAggressor.fill(-1);
    this.raises.fill(0);
    this.callers = this.limpers = this.price = this.street = this.preOpenTo = this.lastBetSize = 0;
    this.pot = ante * seats;
  }

  advance(street: number) {
    if (street !== this.street) {
      this.street = street;
      this.price = this.lastBetSize = 0;
      this.streetPutIn.fill(0);
    }
  }

  pos(seat: number) {
    return position(seat, this.seats, this.sb, this.bb);
  }

  apply(a: ActionEvent) {
    const { seat, street, kind, amount } = a;
    this.advance(street);
    const index = street * 10 + seat;
    if (kind === 'fold') {
      this.live--;
    } else if (kind === 'check') {
      this.line[index] ||= CHECKED;
    } else if (kind === 'post') {
      // Antes also appear as posts, ahead of the two blind posts. The caller
      // parses those separately to keep them out of the street's betting totals.
      this.streetPutIn[seat] += amount;
      this.pot += amount;
      this.price = Math.max(this.price, this.streetPutIn[seat]);
    } else if (kind === 'call') {
      const odds = amount / Math.max(this.blind, this.pot + amount);
      if (street === 0) {
        if (this.raises[0]) {
          this.callers++;
          if (this.raises[0] >= 2 && this.preProfile[seat] !== 0) {
            this.preContinues[seat] = this.raises[0] >= 3 ? 2 : 1;
          } else if (!this.preRaises[seat]) {
            this.preProfile[seat] = this.raises[0] > 1 ? 12 : 7;
          }
        } else {
          this.limpers++;
          this.preProfile[seat] = 6;
        }
      }
      if (this.line[index] < BET) {
        this.line[index] = CALLED + (odds > 0.29 ? 2 : odds > 0.16 ? 1 : 0);
      } else if (this.raises[street] > 1) {
        this.line[index] = this.raises[street] > 2 ? RAISE_CALLED_RERAISE : BET_CALLED_RAISE;
      }
      this.streetPutIn[seat] += amount;
      this.pot += amount;
    } else {
      const cost = amount - this.streetPutIn[seat];
      const call = this.price - this.streetPutIn[seat];
      const fraction = (amount - this.price) / Math.max(this.blind, this.pot + call);
      const r = ++this.raises[street];
      if (r === 1) this.firstAggressor[street] = seat;
      this.lastAggressor[street] = seat;
      if (street === 0) {
        this.preRaises[seat]++;
        this.preContinues[seat] = 0;
        if (r === 1) {
          this.preOpenTo = amount / this.blind;
          this.preProfile[seat] = this.limpers > 0 ? 7 : Math.min(5, this.pos(seat) + 1);
        } else if (r === 2) {
          const opener = this.pos(this.firstAggressor[0]);
          this.preProfile[seat] = opener >= 2 ? 9 : 8;
        } else {
          this.preProfile[seat] = r === 3 ? 10 : this.pos(this.firstAggressor[0]) <= 1 ? 13 : 11;
        }
        this.callers = 0;
      }
      this.line[index] = fraction > 1.62 && (r === 1 || fraction > 2.25) ? OVERBET
        : r >= 3 ? RERAISED : r === 2 ? RAISED : BET + (fraction > 0.87 ? 2 : fraction > 0.44 ? 1 : 0);
      this.sizes[index] = sizeBand(fraction);
      this.lastBetSize = fraction;
      this.streetPutIn[seat] = amount;
      this.pot += cost;
      this.price = amount;
    }
  }

  read(v: BotView) {
    this.reset(v.numSeats, v.bigBlind, v.sbSeat, v.bbSeat, v.ante);
    // The simulator posts antes first. Only the two subsequent posts are blinds.
    const offset = v.ante > 0 ? v.numSeats : 0;
    for (let i = offset; i < v.actions.length; i++) this.apply(v.actions[i]);
    this.advance(v.street);
  }
}

export function liveAfter(v: BotView, seat: number): number {
  let behind = 0;
  const order = postOrder(seat, v.numSeats);
  for (let i = 0; i < v.numSeats; i++) {
    if (!v.folded[i] && !v.allIn[i] && postOrder(i, v.numSeats) > order) behind++;
  }
  return behind;
}

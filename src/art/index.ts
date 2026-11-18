// Public art API: hand-inked poker sprites as standalone SVG data URLs.
//
// Every function is deterministic and memoised, so repeated calls return the
// identical string. That lets the browser rasterise each sprite once and reuse
// it for every <img> that shows it. No SVG filters and no page-level <defs>.
import { memo, toDataURL } from './core';
import { CARD_H, CARD_W, cardBackSVG, cardFaceSVG } from './cards';
import { CHIP_VIEW, DEALER_VIEW, chipLabel, chipSVG, chipStackSVG, dealerButtonSVG, stackAspect } from './chips';
import { feltSVG, railSVG } from './textures';

export { CHIP_STYLES, DENOMINATIONS, chipStyle } from './chips';
export { TABLE_COLORS } from './textures';
export { chipLabel };

/** width / height of a card image, including the thickness slab (252/352). */
export const CARD_ASPECT: number = CARD_W / CARD_H;
/** width / height of a single chip image (106/108). */
export const CHIP_ASPECT: number = CHIP_VIEW.w / CHIP_VIEW.h;
/** width / height of the dealer button image (106/112). */
export const DEALER_ASPECT: number = DEALER_VIEW.w / DEALER_VIEW.h;
/** Most chips per stack column the art is tuned for. */
export const MAX_STACK = 12;

const faceURL = memo((card: number) => toDataURL(cardFaceSVG(card)));

/** Card int 0..51: rank = card >> 2 (0 = '2' .. 12 = 'A'), suit = card & 3 (0 ♠, 1 ♥, 2 ♦, 3 ♣). */
export function cardFaceURL(card: number): string {
  if (!Number.isInteger(card) || card < 0 || card > 51) throw new RangeError(`cardFaceURL: bad card ${card}`);
  return faceURL(card);
}

const backURL = memo((_: 0) => toDataURL(cardBackSVG()));
/** Deep oxblood lattice back with a cream medallion. */
export const cardBackURL = (): string => backURL(0);

const chipMemo = memo((value: number) => toDataURL(chipSVG(value)));
/**
 * Single chip, top-down with a slight angle. Standard values: 1, 5, 10, 25, 100,
 * 500, 1000. Other values use the colours of the nearest lower denomination and
 * print their own value (10000 and above are abbreviated, for example "25K").
 */
export const chipURL = (value: number): string => chipMemo(value);

const stackMemo = memo((key: string) => chipStackSVG(key ? key.split(',').map(Number) : [], key));
const stackURLMemo = memo((key: string) => toDataURL(stackMemo(key)));
/** Angled stack, values bottom → top. Tuned for 1..12 chips. */
export const chipStackURL = (values: number[]): string => stackURLMemo(values.join(','));
/** width / height of chipStackURL output for `count` chips. */
export const chipStackAspect = (count: number): number => stackAspect(count);

const dealerMemo = memo((_: 0) => toDataURL(dealerButtonSVG()));
/** White "DEALER" puck with edge thickness. Aspect: DEALER_ASPECT. */
export const dealerButtonURL = (): string => dealerMemo(0);

const feltMemo = memo((_: 0) => toDataURL(feltSVG()));
/**
 * 160px tileable felt nap. It is a TRANSPARENT overlay (specks and fibres
 * only), so layer it above the felt colour or gradient, for example
 * `background: url(...) , radial-gradient(#33805a, #1c4f33)`.
 */
export const feltPatternURL = (): string => feltMemo(0);

const railMemo = memo((_: 0) => toDataURL(railSVG()));
/** 128px tileable, opaque pebbled-leather texture for the table rim. */
export const woodRailPatternURL = (): string => railMemo(0);

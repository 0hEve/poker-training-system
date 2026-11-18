/**
 * Card encoding: integer 0..51.  rank = card >> 2 (0 = deuce .. 12 = ace),
 * suit = card & 3 (0 spades, 1 hearts, 2 diamonds, 3 clubs).
 * Small integers keep state serialisable and make bitmask evaluation cheap.
 */
export type Card = number;
export type Suit = 0 | 1 | 2 | 3;

export const RANK_CHARS = '23456789TJQKA';
export const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
export const SUIT_CHARS = 'shdc';
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
export const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];

export const rankOf = (c: Card): number => c >> 2;
export const suitOf = (c: Card): Suit => (c & 3) as Suit;
export const makeCard = (rank: number, suit: number): Card => (rank << 2) | suit;
export const isRed = (c: Card): boolean => suitOf(c) === 1 || suitOf(c) === 2;

/** "As", "Td", "7h" */
export function cardToString(c: Card): string {
  return RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)];
}

export function parseCard(s: string): Card {
  const r = RANK_CHARS.indexOf(s[0].toUpperCase());
  const su = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0 || s.length !== 2) throw new Error(`Bad card: ${s}`);
  return makeCard(r, su);
}

export const parseCards = (s: string): Card[] => s.trim().split(/\s+/).filter(Boolean).map(parseCard);

export function cardLabel(c: Card): string {
  return RANK_LABELS[rankOf(c)] + SUIT_SYMBOLS[suitOf(c)];
}

export function freshDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

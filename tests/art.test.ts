import { describe, expect, it } from 'vitest';
import {
  CARD_ASPECT, CHIP_ASPECT, cardBackURL, cardFaceURL, chipStackAspect, chipStackURL, chipURL,
  dealerButtonURL, feltPatternURL, woodRailPatternURL,
} from '../src/art';
import { cardFaceSVG } from '../src/art/cards';
import { chipSVG } from '../src/art/chips';

const PREFIX = 'data:image/svg+xml;charset=utf-8,';

function decode(url: string): string {
  expect(url.startsWith(PREFIX)).toBe(true);
  const svg = decodeURIComponent(url.slice(PREFIX.length));
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg.endsWith('</svg>')).toBe(true);
  return svg;
}

/** Every local url(#id) / href="#id" reference must resolve inside the same SVG. */
function expectStandalone(svg: string) {
  expect(svg).not.toContain('§');
  expect(svg).not.toContain('<filter');
  expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of svg.matchAll(/(?:url\(#|href="#)([^)"]+)/g)) expect(ids.has(m[1]), `missing #${m[1]}`).toBe(true);
}

describe('art', () => {
  it('exposes sane aspect ratios', () => {
    expect(CARD_ASPECT).toBeCloseTo(252 / 352);
    expect(CHIP_ASPECT).toBeGreaterThan(0.9);
    expect(CHIP_ASPECT).toBeLessThan(1.1);
    for (let n = 1; n <= 12; n++) {
      expect(chipStackAspect(n)).toBeGreaterThan(0);
      if (n > 1) expect(chipStackAspect(n)).toBeLessThan(chipStackAspect(n - 1));
    }
  });

  it('generates all 52 faces as valid, standalone, distinct data URLs', () => {
    const seen = new Set<string>();
    for (let c = 0; c < 52; c++) {
      const url = cardFaceURL(c);
      const svg = decode(url);
      expectStandalone(svg);
      expect(svg.length).toBeLessThan(25_000);
      seen.add(url);
    }
    expect(seen.size).toBe(52);
  });

  it('labels cards by rank/suit encoding', () => {
    expect(decode(cardFaceURL(51))).toContain('aria-label="Ace of clubs"');
    expect(decode(cardFaceURL(0))).toContain('aria-label="Two of spades"');
    expect(decode(cardFaceURL((8 << 2) | 1))).toContain('aria-label="Ten of hearts"');
  });

  it('rejects out-of-range cards', () => {
    expect(() => cardFaceURL(52)).toThrow(RangeError);
    expect(() => cardFaceURL(-1)).toThrow(RangeError);
    expect(() => cardFaceURL(1.5)).toThrow(RangeError);
  });

  it('is deterministic (regenerating from scratch yields the same markup)', () => {
    for (const c of [0, 12, 36, 40, 44, 48, 51]) expect(cardFaceSVG(c)).toBe(cardFaceSVG(c));
    for (const v of [1, 25, 1000, 7]) expect(chipSVG(v)).toBe(chipSVG(v));
    expect(cardFaceURL(48)).toBe(`${PREFIX}${encodeURIComponent(cardFaceSVG(48))}`);
  });

  it('caches: repeated calls return the identical string', () => {
    expect(cardFaceURL(17)).toBe(cardFaceURL(17));
    expect(cardBackURL()).toBe(cardBackURL());
    expect(chipURL(25)).toBe(chipURL(25));
    expect(chipStackURL([5, 5, 25])).toBe(chipStackURL([5, 5, 25]));
    expect(dealerButtonURL()).toBe(dealerButtonURL());
    expect(feltPatternURL()).toBe(feltPatternURL());
    expect(woodRailPatternURL()).toBe(woodRailPatternURL());
  });

  it('builds chips, stacks, button and textures as standalone SVGs', () => {
    for (const v of [1, 5, 10, 25, 100, 500, 1000, 2, 250, 5000, 25000]) expectStandalone(decode(chipURL(v)));
    expect(decode(chipURL(250))).toContain('>250</text>');
    expect(decode(chipURL(25000))).toContain('>25K</text>');
    for (let n = 1; n <= 12; n++) {
      const svg = decode(chipStackURL(Array.from({ length: n }, (_, i) => [1, 5, 25, 100][i % 4])));
      expectStandalone(svg);
      const vb = svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number);
      expect(vb[2] / vb[3]).toBeCloseTo(chipStackAspect(n), 5);
    }
    const back = decode(cardBackURL());
    expectStandalone(back);
    expect(back.toLowerCase()).toContain('#6e1f2a');
    expectStandalone(decode(dealerButtonURL()));
    for (const t of [feltPatternURL(), woodRailPatternURL()]) {
      const svg = decode(t);
      expectStandalone(svg);
      const w = Number(svg.match(/width="(\d+)"/)![1]);
      expect(w).toBeLessThanOrEqual(256);
    }
  });
});

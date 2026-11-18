# Hand-inked poker elements — notes

## Direction
An illustrated board-game look: cream paper, sepia ink outlines, flat gouache colour,
diagonal ink hatching for shade, and a white highlight stroke on each shape. Colours
follow a classic deck and casino set (vermilion, ink black, court gold/blue). Bold
serif indices and standard pip layouts keep the cards readable at 70px.

## How the style is achieved
- **Wobble baked into paths.** A seeded PRNG (mulberry32 over an FNV hash) adds
  low-frequency noise to circles, ellipses and rounded rectangles, smoothed with
  Catmull-Rom splines. Hand-authored court and crown paths get a small coordinate jitter.
- **Sketch pass.** Each main outline is drawn twice: solid ink plus a thin, lighter
  second line from another seed. No filters.
- **Shared texture.** One paper-grain pattern, ink and white hatch patterns, and
  cylinder and shadow gradients.
- **Depth.** Chips have an offset lip showing their edge spots, plus a baked contact shadow.
  `chipStackSVG` draws real elliptical side bands with the edge stripes projected onto
  the front arc, cylinder shading, and per-chip offset and rotation. Cards have a thickness slab.
  CSS adds `box-shadow`, a `perspective`/`rotateX` table tilt and a hover lift.

## Correctness
- Pips use standard rows: 7 = 3-1-3 with the extra pip at the ¼ row, 8 = 3-2-3, and
  the 9 and 10 have four rows per side with centre pips at ½ (9) and ⅙ / ⅚ (10).
  Lower-half pips and the bottom-right index are rotated 180°.
- Aces have one large pip. The Ace of Spades is ornate (cartouche, gilt outline, crown, scrollwork).
- J/Q/K are mirrored, double-headed court figures. K: crown, beard, sword.
  Q: arched crown, long hair, rose. J: plumed cap, halberd.
- Chips: 1 white/blue, 5 red, 10 blue, 25 green, 100 black, 500 purple, 1000 yellow-orange.
  Each has 6 or 8 edge spots, an inked inner ring, a dashed print ring and a cream inlay.

## Performance
- No SVG filters on elements. The felt noise is one CSS background image, rasterised once.
- Patterns, gradients and the four suit `<symbol>`s live in `sharedDefsSVG()`, mounted
  once. Pips are `<use>` references, so each card is about 13–30 KB of markup.
- Generators are pure and memoised (Map cache). Same options give the same string.
- Hover and tilt use only `transform` and `box-shadow`. `{ standalone: true }` embeds the
  defs for single-SVG export (for example an `<img>` data URL or a texture cache).
- `sample.html` includes an inlined copy of `elements.js` so it opens from `file://`.

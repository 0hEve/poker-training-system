# Texas Hold’em performance and implementation notes

The table advances on human input. Evaluate showdowns synchronously, run optional equity in a worker, and keep animations independent of reducer updates.

## 1. Card encoding

| Encoding | Layout and trade-off |
| --- | --- |
| Integer ID, 0–51 | `id = 13 * suit + rank`, with ranks 2 through ace mapped to 0–12 and suits clubs, diamonds, hearts, spades mapped to 0–3. One byte per card in a typed array. Compact logs, deck permutations, worker messages, and asset lookup. |
| Cactus Kev 32-bit word | Packs a rank prime, rank index, one-hot suit, and one-hot rank into one word. For five cards, suit intersections find flushes and rank masks or prime-product lookup identify hand strength. The original five-card method evaluates 21 subsets when used to score seven. It makes a good reference, but adds tables and repeated work to this app's hot path. [Kevin Suffecool’s original evaluator](https://suffe.cool/poker/evaluator.html) |
| Four 13-bit suit masks | Each suit mask holds one bit per rank. Suit population detects flushes, and intersections across suits detect repeated ranks. Each mask fits JS's 32-bit bitwise operators, and a worker can OR the common board masks with each player's hole masks. Four masks represent a set and discard draw order. |

**Use integer IDs across the app, suit masks inside the evaluator.** Keep IDs in the reducer, deck, event log, and persistence. Avoid packing the entire deck into one JS bitwise operand, which would truncate it to 32 bits. A [compact perfect-hash evaluator](https://github.com/HenryRLee/PokerHandEvaluator) is an alternative if profiling later shows the evaluator dominates.

## 2. Direct best-five evaluator

`evaluate()` accepts five to seven distinct cards. At showdown pass the five board cards followed by the two hole cards. Category and five rank fields fit in 24 bits. Compare `score` numerically, with larger scores winning and equal scores splitting. Every rank field occupies one nibble in descending tie-break priority. Suits never break ties. The first matching card in input order is used when several suits are equivalent, so passing the board first makes `bestFive` use the board whenever it plays.

For straights, shift and intersect the union of rank bits to find five consecutive ranks. Temporarily move a copy of ace below deuce for the wheel. For straight flushes, apply the same check to the flush suit itself. Five distinct ranks in one suit leave at most two cards outside that suit in a seven-card hand. Quads and full houses each require at least three duplicate-rank cards, so once a flush suit is found the evaluator can return immediately.

```ts
export const CATEGORIES = [
  'high card', 'one pair', 'two pair', 'three of a kind', 'straight',
  'flush', 'full house', 'four of a kind', 'straight flush',
] as const;

export type Category = (typeof CATEGORIES)[number];
export type HandResult = { category: Category; score: number; bestFive: number[] };
export type SuitMasks = [number, number, number, number];

export function toSuitMasks(cards: ArrayLike<number>): SuitMasks {
  const masks: SuitMasks = [0, 0, 0, 0];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!Number.isInteger(card) || card < 0 || card >= 52) {
      throw new RangeError('Card IDs must be integers from 0 to 51');
    }
    const suit = Math.floor(card / 13);
    const bit = 1 << (card % 13);
    if ((masks[suit] & bit) !== 0) throw new RangeError('Duplicate card');
    masks[suit] |= bit;
  }
  return masks;
}

function highBit(mask: number): number {
  return 31 - Math.clz32(mask); // -1 for zero
}

function straightHigh(mask: number): number {
  // Bit 0 is a low ace. Normal ranks move one position left.
  const withLowAce = (mask << 1) | (mask >>> 12);
  const starts = withLowAce & (withLowAce >>> 1) & (withLowAce >>> 2)
    & (withLowAce >>> 3) & (withLowAce >>> 4);
  return starts === 0 ? -1 : highBit(starts) + 3; // wheel high = 3 (five)
}

function hasFive(mask: number): boolean {
  // Clear four set bits. Any bit left means there were at least five.
  for (let i = 0; i < 4; i++) mask &= mask - 1;
  return mask !== 0;
}

function flushSuit(a: number, b: number, c: number, d: number): number {
  if (hasFive(a)) return 0;
  if (hasFive(b)) return 1;
  if (hasFive(c)) return 2;
  if (hasFive(d)) return 3;
  return -1;
}

function topRanks(mask: number, count: number): number {
  let packed = 0;
  for (let shift = 16; count > 0; count--, shift -= 4) {
    const rank = highBit(mask);
    packed |= rank << shift;
    mask ^= 1 << rank;
  }
  return packed;
}

/** Hot path. Four valid suit masks with 5–7 cards total. */
export function scoreMasks(a: number, b: number, c: number, d: number): number {
  const suit = flushSuit(a, b, c, d);
  if (suit >= 0) {
    const suited = suit === 0 ? a : suit === 1 ? b : suit === 2 ? c : d;
    const straight = straightHigh(suited);
    return straight >= 0 ? (8 << 20) | (straight << 16) : (5 << 20) | topRanks(suited, 5);
  }

  const ab = a | b;
  const cd = c | d;
  const ranks = ab | cd;
  const bothAB = a & b;
  const bothCD = c & d;
  const pairs = bothAB | bothCD | (ab & cd); // at least two suits
  const trips = (bothAB & cd) | (bothCD & ab); // at least three suits
  const quads = bothAB & bothCD;

  if (quads !== 0) {
    const four = highBit(quads);
    const kicker = highBit(ranks & ~(1 << four));
    return (7 << 20) | (four << 16) | (kicker << 12);
  }

  const three = highBit(trips);
  if (three >= 0) {
    // A second triplet can supply the pair.
    const fullPair = highBit(pairs & ~(1 << three));
    if (fullPair >= 0) return (6 << 20) | (three << 16) | (fullPair << 12);
  }

  const straight = straightHigh(ranks);
  if (straight >= 0) return (4 << 20) | (straight << 16);

  if (three >= 0) {
    const kickers = topRanks(ranks & ~(1 << three), 2) >>> 4;
    return (3 << 20) | (three << 16) | kickers;
  }
  if (pairs !== 0) {
    const pair = highBit(pairs);
    const lowPair = highBit(pairs & ~(1 << pair));
    if (lowPair >= 0) {
      const kicker = highBit(ranks & ~((1 << pair) | (1 << lowPair)));
      return (2 << 20) | (pair << 16) | (lowPair << 12) | (kicker << 8);
    }
    const kickers = topRanks(ranks & ~(1 << pair), 3) >>> 4;
    return (1 << 20) | (pair << 16) | kickers;
  }
  return topRanks(ranks, 5);
}

export function evaluate(cards: ArrayLike<number>): HandResult {
  if (cards.length < 5 || cards.length > 7) throw new RangeError('Expected 5–7 cards');
  const masks = toSuitMasks(cards);
  const score = scoreMasks(...masks);
  const categoryIndex = score >>> 20;
  const [a, b, c, d, e] = [16, 12, 8, 4, 0].map(shift => (score >>> shift) & 15);
  let wanted: number[];
  switch (categoryIndex) {
    case 8:
    case 4:
      wanted = a === 3 ? [3, 2, 1, 0, 12] : [a, a - 1, a - 2, a - 3, a - 4];
      break;
    case 7: wanted = [a, a, a, a, b]; break;
    case 6: wanted = [a, a, a, b, b]; break;
    case 3: wanted = [a, a, a, b, c]; break;
    case 2: wanted = [a, a, b, b, c]; break;
    case 1: wanted = [a, a, b, c, d]; break;
    default: wanted = [a, b, c, d, e]; break;
  }

  const suit = categoryIndex === 5 || categoryIndex === 8 ? flushSuit(...masks) : -1;
  const bestFive: number[] = [];
  let used = 0; // one bit per input position
  for (const rank of wanted) {
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if ((used & (1 << i)) !== 0 || card % 13 !== rank) continue;
      if (suit >= 0 && Math.floor(card / 13) !== suit) continue;
      bestFive.push(card);
      used |= 1 << i;
      break;
    }
  }
  return { category: CATEGORIES[categoryIndex], score, bestFive };
}
```

| Vector (board first when separated by `/`) | Expected |
| --- | --- |
| A♣ 2♦ 3♠ 4♣ 5♥ K♠ Q♦ | Five-high straight, best five ordered 5–4–3–2–A |
| A♠ 2♠ 3♠ 4♠ 5♠ 6♦ K♥ | Five-high straight flush (steel wheel), off-suit six excluded |
| A♠ 2♠ 3♠ 4♠ 5♠ 6♠ K♥ | Six-high straight flush beats the steel wheel |
| A♣ K♦ Q♠ J♥ T♣ / 2♣ 2♥ vs. 3♥ 4♦ | Both scores match, same five board cards |
| A♣ A♦ K♣ Q♦ 7♣ / J♥ 2♥ vs. J♠ 3♦ vs. T♥ 3♣ | First two tie with K–Q–J kickers, both beat K–Q–T |
| K♣ K♦ K♥ Q♣ Q♦ Q♥ A♠ | Kings full of queens |
| A♣ A♦ K♣ K♦ Q♣ Q♦ 2♥ | Aces and kings with queen kicker |

For regression coverage, check every five-card category count against [Suffecool’s frequencies](https://suffe.cool/poker/evaluator.html), then compare sampled seven-card scores against all 21 subsets scored by an independent count-and-sort reference. Assert that `bestFive` consists of five distinct input cards and that re-evaluating it gives the same score.

The snippets passed that comparison for all 2,598,960 five-card hands and 100,000 seeded seven-card samples. The listed vectors, shuffle permutation and rejection checks, and side-pot and odd-chip examples also passed.

## 3. Unbiased shuffle

Use Fisher–Yates from the end of the deck. At each position `i`, choose uniformly from `0..i`. Drop the tail of the 32-bit random range beyond its largest multiple of the requested bound. Each accepted remainder then has the same number of preimages. Pool random words to avoid a crypto call per draw. Web Crypto limits each request to 65,536 bytes. [Web Cryptography specification](https://www.w3.org/TR/webcrypto/#Crypto-method-getRandomValues)

```ts
export function makeRandomBelow(): (bound: number) => number {
  const range = 2 ** 32;
  const words = new Uint32Array(256);
  let cursor = words.length;

  return (bound: number): number => {
    if (!Number.isInteger(bound) || bound < 1 || bound > range) {
      throw new RangeError('Random bound must be an integer in 1..2^32');
    }
    const limit = range - (range % bound);
    while (true) {
      if (cursor === words.length) {
        globalThis.crypto.getRandomValues(words);
        cursor = 0;
      }
      const value = words[cursor++];
      if (value < limit) return value % bound;
    }
  };
}

export function shuffledDeck(randomBelow = makeRandomBelow()): Uint8Array {
  const deck = Uint8Array.from({ length: 52 }, (_, card) => card);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    const card = deck[i];
    deck[i] = deck[j];
    deck[j] = card;
  }
  return deck;
}
```

Keep a production sampler per table instance to reuse the pool. Inject a deterministic sampler to test shuffle bounds and permutation invariants. Generate the deck before dispatch and record the actual permutation in the start-hand event so replay deals the same cards.

## 4. Optional equity for known hole cards

Given `N` players, `b` known board cards and `d` additional known dead cards, remove those cards and all `2N` hole cards from the candidate deck. Validate uniqueness across the entire request. With `U = 52 - 2N - b - d` unseen cards and `k = 5 - b` cards to come, there are `C(U,k)` final boards. Order of the missing cards is immaterial for showdown equity. For two players and zero extra dead cards the counts are 1,712,304 preflop, 990 on the flop, 44 on the turn, and one on the river.

- **Exhaustive.** Enumerate combinations of increasing indices and score each exactly once. Start with exact on the flop, turn, and river. Use measured latency to choose whether to enumerate preflop, for example when `C(U,k) * N` fits the worker's time budget.
- **Monte Carlo.** Use the first `k` steps of forward Fisher–Yates over the unseen deck. Sample uniformly without replacement within each board, and independently between boards. Reuse the mutable candidate array. Starting from any permutation still gives a uniform next board. For each board, tied winners receive `1 / winnerCount` equity credit each. The per-player mean credit estimates pot share. Report sole-win rate separately if needed. All figures describe one shared pot. For payout equity with side pots, apply each pot's eligibility and amount per runout.
- **Worker.** Build the four board masks once per trial and precompute each player's two-card masks once per request. OR masks and call `scoreMasks` directly. Reuse buffers, track the max score and tied seats in one pass, and skip allocations of hands and `bestFive`. Send only hole cards the session is allowed to reveal. Measure throughput in **completed boards per second**, including sampling and `N` scores.
- **Early exit.** Return immediately for one eligible player, or evaluate once for a complete board. Stop a score scan early only if every remaining contender is provably below the leader. Process 8–16 ms batches, yield to the worker event loop between batches, throttle progress to about 5–10 Hz, and discard responses with a stale request ID. Use a fixed simulation budget (e.g. 20,000 boards, conservative pointwise 95% normal-approximation margin about ±0.7 percentage points near 50%) or stop at a time budget and display sample count. For confidence-based stopping across repeated looks, use a sequential confidence bound. Equity math may use fractional numbers. Chip accounting uses whole units.

For scale, a warmed single JS loop on an Apple M5 Pro (Node 24.22.2) reached **3.53–3.55 million boards/s heads-up** and **2.85–2.88 million boards/s at six seats**. Each timing covered one million preflop boards with fixed known hands, pooled Web Crypto sampling, masks, and split credit. Use **100k boards/s** as a conservative initial budgeting assumption until measurements in the target browser and Electron include worker messaging, cancellation checks, and slower devices.

```ts
// Renderer entry point. Literal URL lets Vite bundle the worker.
const equityWorker = new Worker(new URL('./equity.worker.ts', import.meta.url), {
  type: 'module',
});
equityWorker.postMessage({ id: 1, holes: [[12, 25], [11, 24]], board: [], trials: 20_000 });
```

The worker should echo the request ID with progress and results. On a new job, send cancellation and yield between worker batches, or terminate the worker for immediate cancellation. [Vite worker imports](https://vite.dev/guide/features.html#web-workers)

## 5. Integer chip accounting and side pots

Represent balances, blinds, and hand/street commitments as integer units of the smallest chip. Use JS `number` for exact safe integers with a validated table-wide cap at or below `Number.MAX_SAFE_INTEGER`. Validate inputs as nonnegative safe integers and validate the aggregate bankroll at buy-in, import, and restore. Precheck additions with `b <= cap - a`. Parse user entries as whole units before dispatch. During play, conserve `sum(stacks) + sum(handCommitted)` across bets, refunds, and awards. Keep both street and hand commitments, but count the hand commitments only once in totals.

Below, `committed` is each seat's total matched or potentially matchable contribution across the hand. Folded chips fund pots, but folded seats are ineligible. Forced dead money that uses different eligibility (for example a house-specific big-blind ante) needs its own rule before applying these thresholds. With a single live hand, return any uncalled wager, then award the remaining pot without scoring.

```ts
type Contribution = { seat: number; committed: number; folded: boolean };
type Pot = { amount: number; eligible: number[] };

// Use once betting is closed. Amounts and unique seat IDs are validated upstream.
function makePots(seats: readonly Contribution[]) {
  const levels = [...new Set(seats.map(s => s.committed).filter(n => n > 0))]
    .sort((a, b) => a - b);
  const pots: Pot[] = [];
  const refunds: { seat: number; amount: number }[] = [];
  let prior = 0;

  for (const level of levels) {
    const contributors = seats.filter(s => s.committed >= level);
    const width = level - prior;
    prior = level;
    if (contributors.length === 1) {
      if (contributors[0].folded) throw new Error('Folded seat has unreturned excess');
      refunds.push({ seat: contributors[0].seat, amount: width });
      continue;
    }
    const eligible = contributors.filter(s => !s.folded).map(s => s.seat);
    if (eligible.length === 0) throw new Error('Pot has no eligible seat');
    pots.push({ amount: width * contributors.length, eligible });
  }
  return { pots, refunds };
}

// Compute tied winners within each pot first, in clockwise order from the button's left.
function splitPot(amount: number, winnersClockwise: readonly number[]) {
  const count = winnersClockwise.length;
  if (count === 0) throw new Error('Pot has no winner');
  const remainder = amount % count;
  const share = (amount - remainder) / count; // exact integer quotient
  return winnersClockwise.map((seat, i) => ({
    seat, amount: share + (i < remainder ? 1 : 0),
  }));
}
```

At `N` seats and `L ≤ N` distinct positive levels, this costs `O(N log N + NL)` time and up to `O(NL)` output space. Materializing every eligibility list can itself cost `O(N²)`. For commitments of 50, 120, 200, and 50 folded, the layers are 200 for three live seats, 140 for two, and an 80 refund to the deepest seat. Award each pot independently using its eligible seats and the configured odd-chip order. [Poker TDA rules on odd chips and side pots](https://www.pokertda.com/view-poker-tda-rules/)

## 6. Keep the table responsive

- **Reducer and undo.** Use a pure immutable reducer with `seatsById`, stable `seatOrder`, `actorId`, board, deck cursor, and hand commitments. Keep an event log plus cursor and initial snapshot. Advance live state by applying the next event to the current state. On undo, rebuild from the snapshot or nearest periodic checkpoint and replay to the cursor. On a new action after undo, truncate the redo tail. Log all inputs needed for deterministic replay, including the deck. Keep transient hover, drag, and animation state local to the UI.
- **Seat renders.** Copy only seat records that change. Use a memoized `Seat` with a stable seat record, primitive flags such as `isActing`, and stable dispatch. Keep selector results and props stable, including derived arrays. Pass each seat the dispatch function and let the seat supply its own ID on click. Avoid subscribing all seats to changing table-state context because context updates bypass prop memoization. Check a routine action in React Profiler. Typically the acting seat, next actor, and pot display change. [React reducer](https://react.dev/reference/react/useReducer) · [React memo and context](https://react.dev/reference/react/memo)
- **Motion.** Use a single table perspective and shallow 3D subtrees, such as the two faces of a flipping card. Animate deal, flip, and chip movement with `transform` and `opacity`. Deep `preserve-3d` trees can add compositing work. Filters, opacity below 1, and some overflow modes can flatten the node that establishes the 3D subtree, so place those effects on a separate layer. Apply `will-change` sparingly to a few moving elements, then remove it. Honor reduced motion. Use a trace of a full deal and payout on a slower device and check against the 16.7 ms frame budget at 60 Hz. [Chromium animation guide](https://web.dev/articles/animations-guide) · [CSS Transforms Level 2](https://www.w3.org/TR/css-transforms-2/#grouping-property-values)
- **Hand-drawn textures.** `feTurbulence` generates a noise image and `feDisplacementMap` resamples pixels using it. Repeating or animating these over many cards or chips increases filter work. Bake the look into static art or apply one tightly bounded filter to a static felt or ornament layer. Keep moving cards and chips outside that filtered subtree, and profile paint with effects toggled. [SVG filter primitives](https://www.w3.org/TR/filter-effects-1/#FilterPrimitives)
- **Sprites and stacks.** Reuse pre-rendered card faces, backs, and chip sprites (small shared data URLs or bundled atlas assets such as PNG/WebP). Keep image URLs constant and preload or decode the first deal's assets. Set an initial cap of about 8–12 chip discs per visible stack and bundle larger stacks into a single sprite or number badge. Display the exact chip total independently of sprite count. If profiling points to chip DOM/paint costs, move decorative felt and chips to a canvas layer and keep action controls, labels, and accessible cards in React.

## 7. Persisted stacks in browser and Electron

Use a shared asynchronous interface around versioned state and platform-specific storage.

```ts
type SavedTable = {
  version: 1;
  revision: number;
  stacksBySeat: Record<string, number>;
};

interface TableStorage {
  load(): Promise<SavedTable | null>;
  save(snapshot: SavedTable): Promise<void>;
}
```

- **Web.** Use a single `localStorage` key per table for a small JSON snapshot. Storage is synchronous and scoped to the page's origin. Resolve writes at a hand boundary or buy-in/cash-out, with no frame-by-frame writes. Catch quota or availability errors. If resuming an in-progress hand becomes a requirement, persist a consistent full snapshot including commitments, event cursor, and deck, and move to IndexedDB if it grows. [HTML Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html)
- **Electron.** Keep the same schema and put `electron-store` in the main process under the app's user data directory. Expose narrow async `loadTable` and `saveTable` IPC calls through a context-isolated preload. Validate inputs in main and serialize writes per table. Use the same commit points as web since the store rewrites its JSON file on each change. Packaged desktop data and browser-origin data are independent. Sharing state between them requires an explicit import/export or sync feature. [electron-store](https://github.com/sindresorhus/electron-store) · [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation/)

Treat stack-only snapshots as settled-table balances. Validate the version, revision, seats, balances, and aggregate chip cap on load. Save the whole snapshot in one operation so balances restore together. Queue saves in revision order and surface save errors while retaining the latest in-memory state for retry. Keep one writer per table if multiple tabs or windows can open the same table.

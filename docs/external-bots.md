# External bots

The arena integrates six external poker bots. The upstream repositories are pinned as Git
submodules in `external/`. Build patches live in `native/patches/`, and the in-process ports
live in `src/bots/agents/`.

| Bot (id) | Upstream | Plays | How it runs here |
|---|---|---|---|
| Sharingan (`sharingan`) | markokraemer/poker-sharingan | 2–6 players | The project's own Rust `sharingan-serve` (memory-mapped MCCFR blueprint, turn/river search) on a private loopback port. Default weights: `B-local-2e10` (28 GB, "the light option for normal machines"). SHARINGAN-1/2 (125–170 GB) are used automatically when present in `bot-assets/sharingan/`. |
| CFR-NLHE (`cfr-nlhe`) | dberweger2017/CFR-NLHE-6max | 2–3 players | Heads-up: upstream Python runtime (`native/pybots/cfr_hu.py`) with the released averages, chosen by effective stack. HU20 v0.4.2 below 35 BB, HU100 v0.5.3 up to 150 BB, HU200 v0.5.5 above. 3-handed: upstream Rust `nplayer_serve` with the v0.6.0 NP3 100 BB blueprint. |
| Slumbot 2019 (`slumbot`) | ericgjackson/slumbot2019 | heads-up | The repository ships code only. Setup builds a 100 BB card and betting abstraction (`native/slumbot/*_params`) and trains an external-sampling MCCFR blueprint in 10M-iteration batches. Upstream's own ACPC agent (`run_bot`, unchanged translation) connects to the gateway, which acts as the ACPC dealer. |
| Foldilocks (`fullhouse`) | advitrocks9/fullhouse-bot | 2–6 players | **Ported to TypeScript, runs in-app** (`src/bots/agents/foldilocks`, ~13 µs a decision). Features, eval7 scores, push/fold chart and sizing are line-for-line ports; the network's matrix multiplies run in a 1.3 KB WebAssembly SIMD kernel (`native/foldilocks-wasm`), with a plain-JS fallback. Weights are extracted unchanged. |
| Sequoia (`sequoia`) | nnicholas-c/poker_sequoia | 2–10 players | **Ported to TypeScript, runs in-app** (`src/bots/agents/sequoia`, ~12 µs a decision), including Python's Mersenne Twister and crc32 so its per-decision randomness matches. The bot was written for a 3-hole-card variant: postflop it already plays two cards; preflop a shim scores two-card hands with the agent's own 169-class table. |
| DecisionHoldem (`decisionholdem`) | AI-Decision/DecisionHoldem | — | Listed as **unavailable**: search and blueprint play are closed-source Linux x86 `.so` files. The blueprint and cluster tables exist only on Baidu Netdisk. The engine loads ~34 GB of river clusters twice (built for a 512 GB workstation). |

## Architecture

```
live table / simulator workers / bankroll workers / CLI
        │  (Foldilocks, Sequoia, Opus, GPT run in-process; the bots below go through the gateway)
        │  BotSpec (src/bots/agents/external)
        │  async fetch (live table and browser workers), keep-alive socket (Node CLI)
        ▼
native/bot-gateway (Rust, 127.0.0.1:7878)   GET /v1/bots · POST /v1/decide
   ├─ sharingan-serve        (HTTP, Rust)
   ├─ nplayer_serve          (JSON lines, Rust)       CFR 3-handed
   ├─ cfr_hu.py              (JSON lines, Python 3.11) CFR heads-up
   └─ run_bot × 8            (ACPC over TCP, C++)      Slumbot
```

The heavy work already runs natively upstream: Rust for Sharingan and CFR-NLHE, C++ for Slumbot.
The gateway is Rust as well. A decision costs about 0.2–0.6 ms of gateway time plus the bot's
own thinking. Decisions route to the same process for each bot instance, so per-table memory
stays put.

Head-to-head matches with Sharingan + search use one worker to limit concurrent searches and
default to 100 decks when selected from the default match setup. Pick Sharingan for larger
blueprint-only benchmarks.

When the gateway is down, a bot is still loading, or a spot is outside what it was trained for
(for example Slumbot at a 6-max table), `decide` throws. Every surface then plays check, else
fold, and counts the miss: the simulator's *errors* column and the live table's console. Bot
pickers show each bot's live status (loading, not installed, unavailable) and how many players
it can play.

## Install

```bash
npm run bots:setup              # submodules, patches, builds, Python envs; starts downloads + training
npm run bots:setup -- status    # what is installed
npm run bots:setup -- assemble  # verify checksums and assemble once downloads finish
npm run gateway                 # run the gateway by itself (npm run dev / electron / sim start it too)
```

Assets go to `bot-assets/` in the project (git-ignored; override with `POKER_BOTS_HOME`). Downloads resume and re-request fresh signed
URLs. Plan on about 80 GB:

- Sharingan B-local: 28 GB plus 0.3 GB of buckets.
- CFR-NLHE: 0.25 GB (HU20), 4.6 GB (HU100), 7.7 GB (HU200) and 15.5 GB (3-player), plus 1.4 GB of K50 tables. HU200 builds a 9 GB cache on first start, which takes about 20 minutes.
- Slumbot: 11 GB of abstraction files and about 3 GB per checkpoint.

## Ports and parity

The two Python bots were ported because a gateway round trip (~0.2–0.5 ms) costs far more than
their own thinking. Parity fixtures are recorded from real matches and answered by the Python
originals:

| Check | Fixture | Result |
|---|---|---|
| eval7 hand scores | 20,009 random 5–7 card hands + every hand class | identical |
| Foldilocks features / legal mask | 907 recorded states (2–6 players, deep and short) | bit-identical |
| Foldilocks strategy | same states | within 3e-6 (float32 rounding), SIMD and JS paths |
| Foldilocks push/fold chart | 166 short-stack spots | identical |
| Sequoia decisions | 1,162 requests replayed in order (2–8 players, 485 showdowns feeding its counters) | identical, including random choices |
| Python RNG / crc32 | 700 draws per seed, 6 seeds | identical |

Regenerate: `scripts/ports/gen_*_data.py` (tables and weights), `RECORD_PARITY=1 npx vitest run
tests/*-record.test.ts` then `scripts/ports/*_expected.py` (expected answers from Python),
`node scripts/ports/build_foldilocks_wasm.mjs` (kernel).

## Tests

`tests/external-bots.test.ts` plays every ready external bot against TAG at each table size it
supports and requires zero fallbacks. It is skipped when no gateway is running.
`cargo test --manifest-path native/bot-gateway/Cargo.toml` checks the ACPC and native-deck
translations.

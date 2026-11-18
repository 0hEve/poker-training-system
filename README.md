# Poker Training System

A hand-drawn, 3D-style **No-Limit Texas Hold'em table** for playing by hand on one screen.
It runs as a **macOS desktop app** (Electron) and in **any browser** (Vite build).
There are no bots: every action is entered manually, and the engine handles blinds,
turn order, min-raises, side pots, showdown and chip counts.

![Poker table mid-hand](docs/screenshot.jpg)

## Features

- **Active player switching.** Click a seat or a name, or use the *Active player* menu, to see that
  player's own hole cards. Every other hand stays face-down. Optional modes:
  - *Auto-switch* follows whoever is to act.
  - *Dealer view* shows every hand.
  - *Pass-the-device* covers the screen between players.
- **Live chip counting.** Each player's stack, the bets in front of them and the pot are drawn as real
  chip stacks (1 / 5 / 25 / 100 / 500 / 1000). Chips **persist across hands and restarts** until you
  press **Settings → Reset all chips**.
- **Full rules.**
  - Blinds and antes, the heads-up blind order, and the BB option.
  - Min-raise; short all-ins don't reopen the betting.
  - Uncalled-bet refunds and automatic run-outs.
  - Side pots with odd-chip handling, and a best-five-of-seven evaluator.
- **Manual control.** Add, remove or rename players, edit stacks between hands, sit out, move the
  button, cancel a hand (everything refunded), and **undo** (⌘Z).

## Run it

```bash
npm install
npm run dev            # browser: http://localhost:5173
npm run electron:dev   # desktop app with hot reload
npm run electron       # build, then open the desktop app
npm run dist:mac       # package a .dmg/.zip into release/ (fetches electron-builder via npx)
npm test               # engine tests
```

Keyboard: **N** deals the next hand, **⌘Z / Ctrl+Z** undoes.

## Layout

| Path | What |
| --- | --- |
| `src/engine/` | Pure TypeScript rules engine (reducer, evaluator, pots, shuffle). No UI. |
| `src/art/` | Deterministic hand-inked SVG art (cards, chips, stacks, dealer button, textures), served as cached data-URL sprites. |
| `src/ui/` | React table, seats, action bar and side panel. |
| `src/store.ts` | App state, undo history and localStorage persistence. |
| `electron/` | Desktop shell. |
| `docs/research/` | Rules and performance research the engine is based on. |
| `design-samples/` | The blind art-direction bake-off and its council review. |

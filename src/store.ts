import { useCallback, useEffect, useReducer } from 'react';
import { createGame, reduce, type Command, type GameState } from './engine/game';

/**
 * App-level state: the game (persisted) plus view state (who is looking at
 * the screen) and an undo history (in memory only).
 */
export interface ViewState {
  /** Player whose hole cards are face-up on screen. null = nobody (privacy screen). */
  viewerId: string | null;
  /** Automatically switch the viewer to whoever must act. */
  followAction: boolean;
  /** Dealer / training mode: show everyone's cards. */
  revealAll: boolean;
  /** Cover the screen when the viewer changes so the next player can take the device. */
  privacy: boolean;
  /** Viewer who has confirmed they are looking (privacy mode). */
  confirmedViewerId: string | null;
  /** Delay before a bot acts, in ms (0 = instant). */
  botDelayMs: number;
  /** Deal the next hand automatically when the previous one ends. */
  autoDeal: boolean;
  /** Stop bots from acting (e.g. to undo or inspect a spot). */
  botsPaused: boolean;
  /** Which screen is shown: the live table or the bot-vs-bot simulator. */
  mode: 'table' | 'sim';
  /** Simulator tab: head-to-head match or bankroll session. */
  simTab?: 'match' | 'bankroll';
}

/** One seat of a quick "play against bots" table. */
export interface PlaySeat {
  name: string;
  /** Bot id, or null for the human. */
  bot: string | null;
}

export interface AppState {
  game: GameState;
  view: ViewState;
  history: GameState[];
  error: string | null;
}

export type AppAction =
  | { kind: 'cmd'; cmd: Command; expectedGame?: GameState }
  | { kind: 'undo' }
  | { kind: 'view'; patch: Partial<ViewState> }
  | { kind: 'clearError' }
  | { kind: 'newTable' }
  /** Replace the table with `seats` (the first human becomes the viewer) and deal the first hand. */
  | { kind: 'setupPlay'; seats: PlaySeat[] };

const STORAGE_KEY = 'poker-table/v1';
const HISTORY_LIMIT = 60;

function migrateControllers(game: GameState): GameState {
  return {
    ...game,
    players: game.players.map((p) => {
      if (p.bot === 'fullhouse-py') return { ...p, bot: 'fullhouse' };
      if (p.bot === 'sequoia-py') return { ...p, bot: 'sequoia' };
      return p;
    }),
  };
}

function load(): AppState {
  let game: GameState | null = null;
  let view: ViewState = { viewerId: null, followAction: true, revealAll: false, privacy: false, confirmedViewerId: null, botDelayMs: 600, autoDeal: false, botsPaused: false, mode: 'table' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.game?.players) game = migrateControllers(parsed.game);
      if (parsed?.view) view = { ...view, ...parsed.view };
    }
  } catch {
    /* corrupted storage — start fresh */
  }
  return { game: game ?? createGame(), view, history: [], error: null };
}

/** Viewer follows the action when enabled; a new viewer must re-confirm in privacy mode. */
function syncViewer(game: GameState, view: ViewState, prevViewerId: string | null = view.viewerId): ViewState {
  let next = view;
  const h = game.hand;
  if (view.followAction && h && !h.result && h.toAct !== null) {
    const id = h.seats[h.toAct].playerId;
    // Only follow humans: a bot's cards stay hidden unless someone picks that seat.
    const isBot = !!game.players.find((p) => p.id === id)?.bot;
    if (id !== view.viewerId && !isBot) next = { ...view, viewerId: id };
  }
  if (next.viewerId !== prevViewerId && next.confirmedViewerId !== null && next.confirmedViewerId !== next.viewerId) {
    next = { ...next, confirmedViewerId: null };
  }
  return next;
}

function appReducer(state: AppState, a: AppAction): AppState {
  switch (a.kind) {
    case 'cmd':
      // An asynchronous bot answer is only valid for the table state it saw.
      if (a.expectedGame && (state.game !== a.expectedGame || state.view.botsPaused)) return state;
      try {
        const game = reduce(state.game, a.cmd);
        const history = [...state.history, state.game].slice(-HISTORY_LIMIT);
        return { ...state, game, history, view: syncViewer(game, state.view), error: null };
      } catch (e) {
        return { ...state, error: e instanceof Error ? e.message : String(e) };
      }
    case 'undo': {
      const prev = state.history[state.history.length - 1];
      if (!prev) return state;
      return { ...state, game: prev, history: state.history.slice(0, -1), view: syncViewer(prev, state.view), error: null };
    }
    case 'view':
      return { ...state, view: syncViewer(state.game, { ...state.view, ...a.patch }, state.view.viewerId) };
    case 'clearError':
      return { ...state, error: null };
    case 'setupPlay': {
      try {
        let game = createGame(
          a.seats.map((s) => s.name),
          state.game.settings,
        );
        a.seats.forEach((s, i) => {
          if (s.bot) game = reduce(game, { type: 'setBot', id: game.players[i].id, bot: s.bot });
        });
        game = reduce(game, { type: 'startHand' });
        const humanIdx = a.seats.findIndex((s) => !s.bot);
        const view: ViewState = {
          ...state.view,
          viewerId: humanIdx >= 0 ? game.players[humanIdx].id : null,
          followAction: false,
          revealAll: false,
          privacy: false,
          confirmedViewerId: null,
          botDelayMs: state.view.botDelayMs || 600,
          autoDeal: true,
          botsPaused: false,
          mode: 'table',
        };
        return { game, view, history: [...state.history, state.game].slice(-HISTORY_LIMIT), error: null };
      } catch (e) {
        return { ...state, error: e instanceof Error ? e.message : String(e) };
      }
    }
    case 'newTable': {
      const game = createGame();
      return { game, view: { ...state.view, viewerId: null }, history: [...state.history, state.game].slice(-HISTORY_LIMIT), error: null };
    }
  }
}

export function useAppStore() {
  const [state, dispatch] = useReducer(appReducer, undefined, load);

  // Persist game + view (chips persist until an explicit reset). Debounced via rAF.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ game: state.game, view: state.view }));
      } catch {
        /* storage full / unavailable */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [state.game, state.view]);

  const run = useCallback((cmd: Command, expectedGame?: GameState) => dispatch({ kind: 'cmd', cmd, expectedGame }), []);
  return { state, dispatch, run };
}

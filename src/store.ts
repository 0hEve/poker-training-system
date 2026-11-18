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
}

export interface AppState {
  game: GameState;
  view: ViewState;
  history: GameState[];
  error: string | null;
}

export type AppAction =
  | { kind: 'cmd'; cmd: Command }
  | { kind: 'undo' }
  | { kind: 'view'; patch: Partial<ViewState> }
  | { kind: 'clearError' }
  | { kind: 'newTable' };

const STORAGE_KEY = 'poker-table/v1';
const HISTORY_LIMIT = 60;

function load(): AppState {
  let game: GameState | null = null;
  let view: ViewState = { viewerId: null, followAction: true, revealAll: false, privacy: false, confirmedViewerId: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.game?.players) game = parsed.game;
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
    if (id !== view.viewerId) next = { ...view, viewerId: id };
  }
  if (next.viewerId !== prevViewerId && next.confirmedViewerId !== null && next.confirmedViewerId !== next.viewerId) {
    next = { ...next, confirmedViewerId: null };
  }
  return next;
}

function appReducer(state: AppState, a: AppAction): AppState {
  switch (a.kind) {
    case 'cmd':
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

  const run = useCallback((cmd: Command) => dispatch({ kind: 'cmd', cmd }), []);
  return { state, dispatch, run };
}

import { useEffect, useRef } from 'react';
import { handInProgress, playerById, type Command, type GameState } from '../engine/game';
import { findBot } from '../bots/registry';
import { summaryForSeat, toEngineAction, viewForToAct } from '../bots/live';
import type { PokerBot } from '../bots/types';
import type { ViewState } from '../store';

interface Instance {
  botId: string;
  bot: PokerBot;
}

/**
 * Drives bot-controlled seats at the live table: acts for them after `botDelayMs`,
 * tells them how each hand ended, and optionally deals the next hand automatically.
 * Each player keeps one bot instance (its memory) until its bot is changed.
 */
export function useBots(game: GameState, view: ViewState, run: (cmd: Command) => void) {
  const instances = useRef(new Map<string, Instance>());
  const notifiedHand = useRef<number | null>(null);

  const instanceFor = (playerId: string, botId: string): PokerBot | null => {
    const cur = instances.current.get(playerId);
    if (cur?.botId === botId) return cur.bot;
    const spec = findBot(botId);
    if (!spec) return null;
    const bot = spec.create({ seed: (Math.random() * 2 ** 32) >>> 0, playerId });
    instances.current.set(playerId, { botId, bot });
    return bot;
  };

  // Act for a bot whose turn it is.
  useEffect(() => {
    const h = game.hand;
    if (view.botsPaused || !h || h.result || h.toAct === null) return;
    const p = playerById(game, h.seats[h.toAct].playerId);
    if (!p?.bot) return;
    const t = setTimeout(() => {
      const bot = instanceFor(p.id, p.bot!);
      const v = viewForToAct(game);
      if (!bot || !v) return;
      let decision;
      try {
        decision = bot.decide(v);
      } catch (e) {
        console.error(`Bot ${p.bot} failed`, e);
      }
      run({ type: 'act', action: toEngineAction(game, decision) });
    }, view.botDelayMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, view.botDelayMs, view.botsPaused, run]);

  // Report finished hands to every bot that played them.
  useEffect(() => {
    const h = game.hand;
    if (!h?.result || notifiedHand.current === h.number) return;
    notifiedHand.current = h.number;
    h.seats.forEach((s, i) => {
      const p = playerById(game, s.playerId);
      if (!p?.bot) return;
      // Create the instance if this bot never had to act this hand (e.g. a walk in the big blind).
      const bot = instanceFor(p.id, p.bot);
      if (!bot?.handEnd) return;
      const summary = summaryForSeat(game, i);
      try {
        if (summary) bot.handEnd(summary);
      } catch (e) {
        console.error(`Bot ${p.bot} handEnd failed`, e);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  // Auto-deal the next hand. Busted bots rebuy so a game against them keeps going;
  // when a human is seated, leave time to read the result first.
  useEffect(() => {
    if (!view.autoDeal || view.botsPaused || handInProgress(game)) return;
    const busted = game.players.find((p) => p.bot && !p.sittingOut && p.stack === 0);
    if (busted) {
      run({ type: 'adjustStack', id: busted.id, delta: game.settings.startingStack });
      return;
    }
    const active = game.players.filter((p) => !p.sittingOut && p.stack > 0);
    if (active.length < 2) return;
    const humanSeated = game.players.some((p) => !p.bot && !p.sittingOut);
    const humanBusted = game.players.some((p) => !p.bot && !p.sittingOut && p.stack === 0);
    if (humanBusted) return; // wait for the rebuy
    const delay = humanSeated && game.hand ? Math.max(2500, view.botDelayMs * 3) : Math.max(150, view.botDelayMs * 3);
    const t = setTimeout(() => run({ type: 'startHand' }), delay);
    return () => clearTimeout(t);
  }, [game, view.autoDeal, view.botsPaused, view.botDelayMs, run]);
}

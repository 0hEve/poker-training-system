"""Reference adapters for the Python originals of Foldilocks and Sequoia, used only to build the
parity fixtures of their TypeScript ports (scripts/ports/sequoia_expected.py). The app never runs
them; this was the gateway's Python sidecar before the ports replaced it.

One JSON request per stdin line, one JSON reply per stdout line:
  -> {"op":"decide","instance":ID,"seed":N,"view":<BotView>,"events":[<HandSummary>...]}
  <- {"ok":true,"decision":{"type":"fold|check|call|raise|allIn","to":N},"source":"..."}

Bots
- fullhouse: advitrocks9/fullhouse-bot `bot/bot.py::decide(state)`, fed the Fullhouse engine's
  `action_request` dict (chips scaled to its 50/100 training blinds).
- sequoia:   nnicholas-c/poker_sequoia `bots/gto_upload/agent.py::Agent.act(state, memory)`, fed the
  kit's `GameState` with per-table memory bytes and incremental events. Its preflop scorer is
  written for three hole cards; `two_card_shim` scores two-card hands from the agent's own
  169-class table so standard hold'em reaches its real decision code.

App conventions: cards 0..51 (rank = c >> 2, suit = c & 3 in "shdc"), seat 0 = button.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import traceback
from pathlib import Path

RANKS, SUITS = "23456789TJQKA", "shdc"
STREETS = ("preflop", "flop", "turn", "river")


def card(c: int) -> str:
    return RANKS[c >> 2] + SUITS[c & 3]


def reply(obj) -> None:
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def legal(v: dict):
    """(can_check, to_call, can_raise, min_to, max_to)."""
    return v["toCall"] == 0, v["toCall"], v["canRaise"], v["minRaiseTo"], v["maxRaiseTo"]


# ------------------------------------------------------------------------------------------------
# fullhouse
# ------------------------------------------------------------------------------------------------
class Fullhouse:
    TRAINED_BB = 100

    def __init__(self, external: Path):
        root = external / "fullhouse-bot"
        sys.path.insert(0, str(root))
        os.environ.setdefault("BOT_DATA_DIR", str(root / "data"))
        from bot import bot as fh  # noqa: E402  (upstream module, unchanged)

        self.fh = fh
        fh._warm_runtime()

    def decide(self, req: dict) -> dict:
        v = req["view"]
        k = self.TRAINED_BB / v["bigBlind"]
        s = lambda x: int(round(x * k))  # noqa: E731
        n = v["numSeats"]
        log = []
        street = 0
        for a in v["actions"]:
            while a["street"] > street:
                street += 1
                log.append({"action": "deal"})
            kind = a["kind"]
            if kind == "post":
                if a["seat"] == v["sbSeat"] and not any(e.get("action") == "small_blind" for e in log):
                    log.append({"seat": a["seat"], "action": "small_blind", "amount": s(a["amount"])})
                elif a["seat"] == v["bbSeat"]:
                    log.append({"seat": a["seat"], "action": "big_blind", "amount": s(a["amount"])})
                continue
            if kind in ("bet", "raise"):
                log.append({"seat": a["seat"], "action": "all_in" if a["allIn"] else "raise", "amount": s(a["amount"])})
            elif kind == "call":
                log.append({"seat": a["seat"], "action": "call", "amount": s(a["amount"])})
            else:
                log.append({"seat": a["seat"], "action": kind, "amount": 0})
        while v["street"] > street:
            street += 1
            log.append({"action": "deal"})
        me = v["seat"]
        players = []
        for i in range(n):
            folded, allin = v["folded"][i], v["allIn"][i]
            st = "folded" if folded else "all_in" if allin else "busted" if v["stacks"][i] == 0 else "active"
            players.append({"seat": i, "bot_id": v["playerIds"][i] if i < len(v.get("playerIds") or []) else f"p{i}",
                            "stack": s(v["stacks"][i]), "state": st, "is_folded": folded, "is_all_in": allin,
                            "bet_this_street": s(v["bets"][i]), "hole_cards": None})
        can_check, to_call, can_raise, min_to, _ = legal(v)
        state = {
            "type": "action_request", "hand_id": v["handId"], "street": STREETS[v["street"]],
            "seat_to_act": me, "pot": s(v["pot"]), "community_cards": [card(c) for c in v["board"]],
            "current_bet": s(v["currentBet"]),
            "min_raise_to": s(min_to if can_raise else v["currentBet"] + v["bigBlind"]),
            "amount_owed": s(to_call), "can_check": can_check, "your_cards": [card(c) for c in v["hole"]],
            "your_stack": s(v["stacks"][me]), "your_bet_this_street": s(v["bets"][me]),
            "players": players, "action_log": log,
        }
        self.fh._RNG.seed(req.get("seed", 0) ^ (v["handId"] * 7919) ^ len(log))
        out = self.fh.decide(state)
        act = out.get("action")
        if act == "raise":
            return {"type": "raise", "to": int(round(out["amount"] / k))}
        if act == "all_in":
            return {"type": "allIn"}
        return {"type": act if act in ("fold", "check", "call") else "check"}


# ------------------------------------------------------------------------------------------------
# poker_sequoia
# ------------------------------------------------------------------------------------------------
class Table:
    """Per-instance memory: stable table seats per player id, memory bytes, events already fed."""

    def __init__(self):
        self.ids: list[str] = []
        self.memory = b""
        self.hand = None
        self.fed = 0
        self.hands = 0


class Sequoia:
    def __init__(self, external: Path):
        path = external / "poker-sequoia" / "bots" / "gto_upload" / "agent.py"
        spec = importlib.util.spec_from_file_location("sequoia_gto_upload", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.m = mod
        self.two_card_shim()
        from poker_agent_protocol.game import BlindLevel, Event, GameState, LegalAction, Seat, TableConfig

        self.T = (BlindLevel, Event, GameState, LegalAction, Seat, TableConfig)
        self.agent = mod.Agent()
        self.tables: dict[str, Table] = {}

    def two_card_shim(self):
        """Standard hold'em deals two cards; score them as the agent scores its best pair."""
        m = self.m
        three, pct = m.three_card_score, m.score_percentile

        def score(cards):
            if len(cards) == 2:
                return m.PRE[m.cls2(cards[0], cards[1])][0] / 1000.0, (0, 1)
            return three(cards)

        def percentile(sc, _cards=None):
            return pct(sc)

        m.three_card_score = score
        # Two-card scores sit on the agent's own equity scale; map them to a hand-rank percentile
        # through the 169-class HU percentile column instead of the three-card quantiles.
        eq_to_pct = sorted((v[0] / 1000.0, v[2] / 1000.0) for v in m.PRE.values())

        def score_percentile(sc):
            if sc > 0.9 or sc < eq_to_pct[0][0] - 1e-9:
                return pct(sc)
            best = min(eq_to_pct, key=lambda t: abs(t[0] - sc))
            return best[1] if abs(best[0] - sc) < 1e-9 else pct(sc)

        m.score_percentile = score_percentile

    def _hand_events(self, t: Table, hand_id, n, ids, start_stacks, actions, board, shown=None, net=None):
        """Every public event of one hand, in table seats."""
        _, Event, *_ = self.T
        seat_of = [self._seat(t, ids[i]) for i in range(n)]
        evs = [Event("hand", amount=hand_id)]
        street = 0
        for a in actions:
            while a["street"] > street:
                street += 1
                cards = board[:3] if street == 1 else board[street + 1:street + 2]
                evs.append(Event("board", cards=tuple(card(c) for c in cards)))
            s = seat_of[a["seat"]]
            kind = a["kind"]
            if kind == "post":
                evs.append(Event("blind", s, a["amount"]))
            elif kind in ("bet", "raise"):
                evs.append(Event("raise", s, a["amount"]))
            elif kind == "call":
                evs.append(Event("call", s, a["amount"]))
            else:
                evs.append(Event(kind, s))
        if shown is not None:
            for i in range(n):
                if shown[i]:
                    evs.append(Event("show", seat_of[i], cards=tuple(card(c) for c in shown[i])))
            for i in range(n):
                if net[i] > 0:
                    evs.append(Event("win", seat_of[i], net[i] + 0))
            for i in range(n):
                evs.append(Event("stack", seat_of[i], start_stacks[i] + net[i]))
        return evs

    def _seat(self, t: Table, pid: str) -> int:
        if pid not in t.ids:
            t.ids.append(pid)
        return t.ids.index(pid)

    def decide(self, req: dict) -> dict:
        BlindLevel, Event, GameState, LegalAction, Seat, TableConfig = self.T
        inst = req.get("instance") or "default"
        t = self.tables.setdefault(inst, Table())
        v = req["view"]
        n = v["numSeats"]
        ids = v.get("playerIds") or [f"p{i}" for i in range(n)]
        for pid in ids:
            self._seat(t, pid)
        new_events = []
        # Finish earlier hands from their summaries (showdowns, wins, final stacks).
        for s in req.get("events") or []:
            if s.get("handId") == v["handId"]:
                continue
            evs = self._hand_events(t, s["handId"], s["numSeats"], s["playerIds"], s["startStacks"], s["actions"],
                                    s["board"], s["shown"], s["net"])
            new_events += evs[t.fed:] if t.hand == s["handId"] else evs
            t.hand, t.fed = s["handId"], len(evs)
        cur = self._hand_events(t, v["handId"], n, ids, v["startStacks"], v["actions"], v["board"])
        # The board for the current street must already be public.
        if v["street"] > max([a["street"] for a in v["actions"]] + [0]):
            for st in range(max([a["street"] for a in v["actions"]] + [0]) + 1, v["street"] + 1):
                cards = v["board"][:3] if st == 1 else v["board"][st + 1:st + 2]
                cur.append(Event("board", cards=tuple(card(c) for c in cards)))
        if t.hand == v["handId"]:
            new_events += cur[t.fed:]
        else:
            new_events += cur
            t.hands += 1
        t.hand, t.fed = v["handId"], len(cur)

        seat_of = [self._seat(t, ids[i]) for i in range(n)]
        nt = len(t.ids)
        seats = []
        for s in range(nt):
            if s in seat_of:
                i = seat_of.index(s)
                status = "folded" if v["folded"][i] else "all_in" if v["allIn"][i] else "active"
                seats.append(Seat(s, v["stacks"][i], v["bets"][i], status))
            else:
                seats.append(Seat(s, 0, 0, "busted"))
        can_check, to_call, can_raise, min_to, max_to = legal(v)
        la = []
        if not can_check:
            la.append(LegalAction("fold"))
            la.append(LegalAction("call"))
        else:
            la.append(LegalAction("check"))
        if can_raise:
            la.append(LegalAction("raise", min_to, max_to))
        me = seat_of[v["seat"]]
        blinds = BlindLevel(v["smallBlind"], v["bigBlind"], v["ante"])
        config = TableConfig(table_id=inst, seat=me, players=nt, variant="holdem", starting_stack=max(v["startStacks"]),
                             blinds=(blinds,), hands_per_level=10**9, hand_cap=10**9, payouts=(100,),
                             decision_ms=1000, memory_bytes=4096)
        history = tuple(e for e in cur if e.kind != "hand")
        state = GameState(
            events=tuple(new_events), hand_number=t.hands, seat=me, cards=tuple(card(c) for c in v["hole"]),
            board=tuple(card(c) for c in v["board"]), pot=v["pot"], to_call=to_call, legal_actions=tuple(la),
            history=history, seats=tuple(seats), button=seat_of[0], blind_level=0, blinds=blinds,
            hands_until_next_level=10**9, players_remaining=n, bust_order=(), config=config, phase="betting",
        )
        # The agent's `hand` events carry the table's running hand number.
        state = state.__class__(**{**{f: getattr(state, f) for f in state.__dataclass_fields__},
                                   "events": tuple(Event("hand", amount=t.hands) if e.kind == "hand" and e.amount == v["handId"] else e
                                                   for e in new_events)})
        action, t.memory = self.agent.act(state, t.memory)
        if action.kind == "raise":
            return {"type": "raise", "to": int(action.amount)}
        return {"type": action.kind if action.kind in ("fold", "check", "call") else "check"}


BOTS = {"fullhouse": Fullhouse, "sequoia": Sequoia}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--bot", required=True, choices=sorted(BOTS))
    p.add_argument("--external", required=True, type=Path)
    args = p.parse_args()
    # Upstream code may print; keep stdout for the protocol only.
    proto = sys.stdout
    sys.stdout = sys.stderr
    global reply

    def reply(obj):  # noqa: F811
        proto.write(json.dumps(obj, separators=(",", ":")) + "\n")
        proto.flush()

    try:
        bot = BOTS[args.bot](args.external)
    except Exception as e:  # noqa: BLE001
        reply({"ok": False, "error": f"{type(e).__name__}: {e}"})
        return
    reply({"ok": True, "bot": args.bot})
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            req = json.loads(line)
            reply({"ok": True, "decision": bot.decide(req), "source": args.bot})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            reply({"ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()

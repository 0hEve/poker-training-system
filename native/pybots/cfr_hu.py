"""CFR-NLHE heads-up policies, served unchanged through the project's own Python runtime.

Started by native/bot-gateway with `--repo external/cfr-nlhe-6max --models bot-assets/cfr`.
Loads every released heads-up average whose bundle is present (each is verified by upstream's
loader) and routes each hand by effective stack, like the project's Open Poker client:
  < 35 BB  -> v0.4.2 HU20 O10B         (trained at 20 BB)
  <= 150 BB -> v0.5.3 HU100 O5B menu-v2 (trained at 100 BB)
  > 150 BB  -> v0.5.5 HU200 three-seed blend (trained at 200 BB)
Chips are scaled to the trained 50/100 blinds and the hand is replayed in upstream's engine
(`src.game.hand.Hand`) at the model's trained depth; the policy sees only the hero's observation.

Protocol: one JSON object per line.
  -> {"op":"decide","seed":N,"view":{seat,sb,bb,hole,board,startStacks,street,actions,...}}
  <- {"ok":true,"model":"hu100","action":["raise",TO]}   (TO in the app's chips, street total)
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

RANKS, APP_SUITS = "23456789TJQKA", "shdc"


def card(c: int) -> str:
    return RANKS[c >> 2] + APP_SUITS[c & 3]


DECK = [r + s for r in RANKS for s in "cdhs"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--repo", type=Path, required=True)
    p.add_argument("--models", type=Path, required=True)
    args = p.parse_args()
    proto = sys.stdout
    sys.stdout = sys.stderr

    def reply(obj):
        proto.write(json.dumps(obj, separators=(",", ":")) + "\n")
        proto.flush()

    sys.path.insert(0, str(args.repo))
    try:
        from src.game.hand import Hand, Table
        from src.game.types import Action, ActionKind
    except Exception as e:  # noqa: BLE001
        reply({"ok": False, "error": f"CFR runtime import failed: {e}"})
        return

    models = {}  # name -> (policy, trained stack in chips, max depth bb)
    loaders = []
    v042 = args.models / "v042" / "O10B-HU20-opponent-sampled-average-seed-2026100601.jsonl.gz"
    if v042.is_file():
        loaders.append(("hu20", 2000, 35, lambda: __import__("src.policies.v042", fromlist=["x"]).load_policy(v042)))
    if (args.models / "v053").is_dir():
        loaders.append(("hu100", 10000, 150, lambda: __import__("src.policies.hu100_release", fromlist=["x"]).load_policy(args.models / "v053")[1]))
    if (args.models / "v055").is_dir():
        loaders.append(("hu200", 20000, 10**9, lambda: __import__("src.policies.hu200_release", fromlist=["x"]).load_policy(args.models / "v055")[1]))
    errors = []
    for name, stack, top, load in loaders:
        try:
            models[name] = (load(), stack, top)
            print(f"[cfr_hu] loaded {name}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")
            print(f"[cfr_hu] {name} not loaded: {e}", file=sys.stderr)
    if not models:
        reply({"ok": False, "error": "; ".join(errors) or "no heads-up CFR model downloaded"})
        return
    reply({"ok": True, "models": sorted(models), "errors": errors})

    order = [n for n in ("hu20", "hu100", "hu200") if n in models]

    def route(depth_bb: float) -> str:
        for name in order:
            if depth_bb <= models[name][2]:
                return name
        return order[-1]

    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            req = json.loads(line)
            v = req["view"]
            k = 100 / v["bb"]
            eff = min(v["startStacks"]) / v["bb"]
            name = route(eff)
            policy, stack, _ = models[name]
            me = v["seat"]
            # App seat 0 is the button/small blind; upstream HU uses button = small blind too.
            table = Table(("p0", "p1"), (stack, stack), button=0)
            hole = {me: [card(c) for c in v["hole"]]}
            used = set(hole[me]) | {card(c) for c in v["board"]}
            spare = iter(c for c in DECK if c not in used)
            hole[1 - me] = [next(spare), next(spare)]
            order_seats = (1, 0)  # dealing starts left of the button
            dealt = tuple(hole[s][r] for r in range(2) for s in order_seats)
            board = [card(c) for c in v["board"]]
            board += [next(spare) for _ in range(5 - len(board))]
            rest = [c for c in DECK if c not in set(dealt) | set(board)]
            hand = Hand.from_deck(table, hand_id=f"h{req.get('seed', 0)}", deck=(*dealt, *board, *rest))
            before = [0, 0]
            committed = [0, 0]
            street = 0
            for a in v["actions"]:
                if a["kind"] == "post":
                    committed[a["seat"]] += a["amount"]
                    continue
                if a["street"] != street:
                    street = a["street"]
                    before = committed[:]
                kind = a["kind"]
                if kind in ("bet", "raise"):
                    committed[a["seat"]] = before[a["seat"]] + a["amount"]
                    legal = hand.observe(hand.actor).legal_actions
                    to = int(round(a["amount"] * k))
                    if ActionKind.RAISE in legal.kinds:
                        to = max(legal.min_raise_to, min(legal.max_raise_to, to))
                        act = Action(ActionKind.RAISE, to)
                    else:
                        act = Action(ActionKind.CALL)
                elif kind == "call":
                    committed[a["seat"]] += a["amount"]
                    legal = hand.observe(hand.actor).legal_actions
                    act = Action(ActionKind.CALL) if ActionKind.CALL in legal.kinds else Action(ActionKind.CHECK)
                elif kind == "check":
                    act = Action(ActionKind.CHECK)
                else:
                    act = Action(ActionKind.FOLD)
                hand = hand.apply(act)
                if hand.finished:
                    break
            if hand.finished or hand.actor != me:
                raise ValueError("replayed hand is not at the hero's decision (stacks beyond the trained depth?)")
            choice = policy.policy(int(req.get("seed", 0)) & 0x7FFFFFFF).choose_action(hand.observe(me))
            if choice.kind == ActionKind.RAISE:
                # raise_to is a street total in trained chips
                reply({"ok": True, "model": name, "action": ["raise", int(round(choice.raise_to / k))]})
            else:
                reply({"ok": True, "model": name, "action": [choice.kind.value, 0]})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            reply({"ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()

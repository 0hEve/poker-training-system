"""Adds the Python fullhouse-bot's answers to recorded engine states (parity fixture).
Usage: bot-assets/venv/bin/python -I scripts/ports/fullhouse_expected.py <external/fullhouse-bot> <states.json> <out.json>"""
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, sys.argv[1])
from bot import bot as fh  # noqa: E402
from bot.features import encode_state_dict, load_preflop_equity  # noqa: E402

states = json.load(open(sys.argv[2]))
eq = load_preflop_equity()
out = []
for st in states:
    feats, legal = encode_state_dict(st, eq)
    pf = fh._push_fold(st) if st["street"] == "preflop" else None
    try:
        strat = fh._apply_legal_mask(fh._DEEP_CFR.get_strategy(st), st).tolist()
    except Exception as e:  # noqa: BLE001
        strat = None
    out.append({"state": st, "features": feats.tolist(), "legal": legal.tolist(), "strategy": strat, "pushFold": pf})
json.dump(out, open(sys.argv[3], "w"))
print(len(out), "states;", sum(1 for o in out if o["pushFold"]), "push/fold;", sum(1 for o in out if o["strategy"] is None), "without strategy")

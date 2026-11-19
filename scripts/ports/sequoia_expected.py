"""Replays recorded Sequoia requests through the Python original (scripts/ports/python_reference.py
adapter + poker_sequoia's gto_upload agent), in order, and stores its decisions next to them.
Usage: bot-assets/venv/bin/python -I scripts/ports/sequoia_expected.py <repo root> <requests.json> <out.json>"""
import json, sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts" / "ports"))
import python_reference  # noqa: E402
bot = python_reference.Sequoia(root / "external")
reqs = json.load(open(sys.argv[2]))
out = []
for r in reqs:
    d = bot.decide({"op": "decide", "instance": r["instance"], "seed": 0, "view": r["view"], "events": r["events"]})
    out.append({**r, "expected": d})
json.dump(out, open(sys.argv[3], "w"))
same = sum(1 for o in out if o["expected"] == o["decision"])
print(len(out), "requests;", same, "identical decisions")

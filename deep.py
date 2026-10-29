#!/usr/bin/env python3
"""Trimmed deep pass: unconfirmed highways (all families) + L/R strings <= 9 still chaotic/stalled."""
import json, sys
from search import run_batch
steps = int(sys.argv[1]) if len(sys.argv) > 1 else 20_000_000
for fam in ["strings_LRNU_8", "turmites_2s2c", "strings_LR_12"]:
    rows = [json.loads(l) for l in open(f"results/{fam}.jsonl")]
    rules = [r["rule"] for r in rows if (r["class"] == "highway" and r["stop"] == "maxsteps")
             or (fam == "strings_LR_12" and len(r["rule"]) <= 9 and r["class"] in ("chaotic", "stalled"))]
    run_batch(rules, steps, f"results/{fam}.deep.jsonl", chunk=8)

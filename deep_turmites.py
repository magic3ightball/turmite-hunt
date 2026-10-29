#!/usr/bin/env python3
"""Deep pass for turmites still chaotic (inside the grid) after the first pass: look for late highways.

  python3 deep_turmites.py [family] [steps] [workers]   # default turmites_2s2c, 200M steps, 4 workers, 8192² grid
Reads results/<family>.jsonl, appends to results/<family>.deep.jsonl (resumable; build.py lets deep rows override the first pass).
"""
import json, sys
from search import run_batch
from build import signature

fam = sys.argv[1] if len(sys.argv) > 1 else "turmites_2s2c"
steps = int(sys.argv[2]) if len(sys.argv) > 2 else 200_000_000
workers = int(sys.argv[3]) if len(sys.argv) > 3 else 4      # each tsim holds steps bytes of log + grid²
rows = [json.loads(l) for l in open(f"results/{fam}.jsonl")]
# 3-state rules that never reach their third state behave exactly like a 2s2c rule, which turmites_2s2c already covers
seen = set() if fam == "turmites_2s2c" else {signature(json.loads(l)) for l in open("results/turmites_2s2c.jsonl")}
cand = []
for r in sorted(rows, key=lambda r: -r["w"] * r["h"]):          # biggest blobs first
    unconfirmed = r["class"] == "highway" and r["stop"] == "maxsteps"
    if not unconfirmed and (r["class"] != "chaotic" or r["stop"] != "maxsteps" or r["w"] * r["h"] < 64):
        continue
    k = signature(r)
    if k not in seen:
        seen.add(k); cand.append(r["rule"])
run_batch(cand, steps, f"results/{fam}.deep.jsonl", grid=8192, chunk=1, workers=workers)

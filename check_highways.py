#!/usr/bin/env python3
"""Sort the highways of the deep re-runs (results/*.deep.jsonl) into real ones and false ones.

Two ways a "highway" can be false:
  edge artifact  (deep_turmites.py 200M passes on 8192² only) the pattern had already filled the 8192² grid when the repetition started, so the "highway"
                 is the ant walking straight across a filled grid to the edge in its last steps.
  broken         tsim stops early once a tail has repeated ~20k steps (stop "highway"). Some of those tails
                 break again later, so follow_hw.mjs (gallery/engine.js) follows them period by period to the edge.
Highways that ran into the grid edge in tsim (stop "border") repeat from onset to the edge by construction.
Writes results/highway_check.json: {family: {rule: {"bbox_at_onset": [w, h]|None, "followed": bool|None, "real": bool}}}.
"""
import glob, json, os, subprocess
from concurrent.futures import ThreadPoolExecutor
from search import TSIM

GRID, INSIDE = 8192, 0.8          # bbox at onset must stay under 80% of the grid on both axes
out = "results/highway_check.json"


def bbox(r):
    p = subprocess.run([TSIM, "run", r["rule"], str(r["onset"]), "-g", str(GRID)], capture_output=True, text=True, check=True)
    q = json.loads(p.stdout)
    return [q["w"], q["h"]]


allres = {}
for f in sorted(glob.glob("results/*.deep.jsonl")):
    fam = os.path.basename(f)[:-len(".deep.jsonl")]
    todo = [r for r in map(json.loads, open(f)) if r["class"] == "highway"]
    grid8k = fam in ("turmites_2s2c", "random_3s2c")     # deep_turmites.py passes: 8192², long enough to fill the grid
    with ThreadPoolExecutor(4) as ex:
        boxes = list(ex.map(bbox, todo)) if grid8k else [None] * len(todo)
    res = {r["rule"]: dict(bbox_at_onset=b, followed=None, real=b is None or max(b) < INSIDE * GRID) for r, b in zip(todo, boxes)}
    follow = [r for r in todo if r["stop"] != "border" and res[r["rule"]]["real"]]
    if follow:
        p = subprocess.run(["node", "follow_hw.mjs"], input="".join(f"{r['rule']} {r['onset']} {r['period']}\n" for r in follow),
                           capture_output=True, text=True, check=True)
        for l in p.stdout.splitlines():
            x = json.loads(l)
            res[x["rule"]].update(followed=x["confirmed"], real=x["confirmed"])
    allres[fam] = res
    print(f"{fam}: {len(todo)} highways, {sum(d['real'] for d in res.values())} real, "
          f"{sum(not d['real'] and d['followed'] is None for d in res.values())} edge artifacts, "
          f"{sum(d['followed'] is False for d in res.values())} broken")
json.dump(allres, open(out, "w"), indent=0)

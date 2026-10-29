#!/usr/bin/env python3
"""Exhaustive / random search driver around bin/tsim.

  python3 search.py strings   --maxlen 8 --steps 2000000      # all L/R/N/U ant strings
  python3 search.py turmites  --steps 2000000                   # all 2-state 2-colour turmites
  python3 search.py random    --states 3 --colors 2 --count 20000 --steps 2000000
  python3 search.py rerun     --src results/strings.jsonl --classes chaotic,ordered --steps 50000000 --out ...

Writes JSON lines to results/<name>.jsonl (one per rule, from tsim batch).
"""
import argparse, itertools, json, os, random, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.abspath(__file__))
TSIM = os.path.join(ROOT, "bin", "tsim")
GOLLY_TURN = {"N": 1, "R": 2, "U": 4, "L": 8}
MIRROR = str.maketrans("LR", "RL")


def is_power(s):
    n = len(s)
    return any(n % k == 0 and s[:k] * (n // k) == s for k in range(1, n))


def ant_strings(maxlen, alphabet):
    for n in range(2, maxlen + 1):
        for t in itertools.product(alphabet, repeat=n):
            s = "".join(t)
            if is_power(s) or s.translate(MIRROR) < s:   # skip repeats and L/R mirror images
                continue
            yield s


def golly(table):
    """table[state][colour] = (write, turn letter, next)."""
    return "{" + ",".join("{" + ",".join("{%d,%d,%d}" % (w, GOLLY_TURN[t], n) for (w, t, n) in st) + "}"
                          for st in table) + "}"


def mirror_table(table):
    return [[(w, t.translate(MIRROR), n) for (w, t, n) in st] for st in table]


def all_turmites(S, C):
    cells = [(w, t, n) for w in range(C) for t in "NRUL" for n in range(S)]
    seen = set()
    for combo in itertools.product(cells, repeat=S * C):
        table = [list(combo[s * C:(s + 1) * C]) for s in range(S)]
        g, m = golly(table), golly(mirror_table(table))
        key = min(g, m)
        if key in seen:
            continue
        seen.add(key)
        yield key


def random_turmites(S, C, count, seed):
    rng = random.Random(seed)
    seen = set()
    while len(seen) < count:
        table = [[(rng.randrange(C), rng.choice("NRUL"), rng.randrange(S)) for _ in range(C)] for _ in range(S)]
        g = min(golly(table), golly(mirror_table(table)))
        if g not in seen:
            seen.add(g)
            yield g


def run_batch(rules, steps, out, grid=4096, chunk=64, workers=None):
    workers = workers or os.cpu_count()
    rules = list(rules)
    done = set()
    if os.path.exists(out):                      # resumable
        with open(out) as f:
            done = {json.loads(l)["rule"] for l in f if l.strip()}
    todo = [r for r in rules if r not in done]
    print(f"{len(rules)} rules, {len(todo)} to run at {steps:,} steps -> {out}", flush=True)
    chunks = [todo[i:i + chunk] for i in range(0, len(todo), chunk)]
    t0, n = time.time(), 0

    def work(c):
        p = subprocess.run([TSIM, "batch", str(steps), "-g", str(grid)], input="\n".join(c) + "\n",
                           capture_output=True, text=True, check=True)
        return p.stdout

    with open(out, "a") as f, ThreadPoolExecutor(workers) as ex:
        for res in ex.map(work, chunks):
            f.write(res); f.flush()
            n += res.count("\n")
            if n % (chunk * workers * 4) < chunk:
                print(f"  {n}/{len(todo)}  {time.time() - t0:.0f}s", flush=True)
    print(f"done in {time.time() - t0:.0f}s", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["strings", "turmites", "random", "rerun"])
    ap.add_argument("--maxlen", type=int, default=8)
    ap.add_argument("--alphabet", default="LRNU")
    ap.add_argument("--states", type=int, default=2)
    ap.add_argument("--colors", type=int, default=2)
    ap.add_argument("--count", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--steps", type=int, default=2_000_000)
    ap.add_argument("--grid", type=int, default=4096)
    ap.add_argument("--src")
    ap.add_argument("--classes", default="chaotic,ordered,symmetric")
    ap.add_argument("--out")
    a = ap.parse_args()
    os.makedirs(os.path.join(ROOT, "results"), exist_ok=True)
    if a.mode == "strings":
        rules = ant_strings(a.maxlen, a.alphabet)
        out = a.out or f"results/strings_{a.alphabet}_{a.maxlen}.jsonl"
    elif a.mode == "turmites":
        rules = all_turmites(a.states, a.colors)
        out = a.out or f"results/turmites_{a.states}s{a.colors}c.jsonl"
    elif a.mode == "random":
        rules = random_turmites(a.states, a.colors, a.count, a.seed)
        out = a.out or f"results/random_{a.states}s{a.colors}c.jsonl"
    else:
        want = set(a.classes.split(","))
        # "unconfirmed" = highway found only in the last part of the budget (never reached the border)
        rules = [r["rule"] for r in map(json.loads, open(a.src)) if r.get("class") in want
                 or ("unconfirmed" in want and r.get("class") == "highway" and r.get("stop") == "maxsteps")]
        out = a.out
    run_batch(rules, a.steps, os.path.join(ROOT, out), grid=a.grid)


if __name__ == "__main__":
    main()

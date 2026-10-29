# Turmite Hunt

Searches multi-colour Langton's ants (L/R/N/U rule strings) and small turmites for long
transients, large-period highways, and unusual growth shapes. The results are shown in a browser
gallery with live replays.

```
cc -O3 -march=native -o bin/tsim src/tsim.c -lm      # build the simulator
bin/tsim run RL 20000000                              # one rule -> JSON line
python3 search.py strings --maxlen 8                  # all L/R/N/U strings of length 2..8
python3 search.py strings --alphabet LR --maxlen 16   # all L/R strings of length 2..16
python3 search.py turmites                            # all 2-state 2-colour turmites
python3 search.py random --states 3 --colors 2 --count 20000
python3 search.py rerun --src results/X.jsonl --classes chaotic,unconfirmed --steps 20000000 --out results/X.deep.jsonl
python3 build.py                                      # gallery/data.json + gallery/img
python3 -m http.server 8975 --directory gallery       # open http://localhost:8975
```

See `docs/codex/handoff.md` for the method, the verified results, and the next steps.

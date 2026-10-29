# Turmite Hunt — handoff

## Objective
Search multi-colour Langton's ants and small turmites for patterns that are not well catalogued:
very long chaos before a highway, large highway periods, odd growth shapes. Show the results in a
browser gallery with replays. This is a sibling of life-hunt (Life soups), the Lenia explorer, and the
Busy Beaver explorer.

## Layout
- `src/tsim.c` → `bin/tsim`: the C simulator and classifier. Build it with `cc -O3 -march=native -o bin/tsim src/tsim.c -lm`.
- `search.py`: enumerates rule families and runs `tsim batch` in parallel (10 workers). It is resumable and appends to `results/<family>.jsonl`.
- `deep_2s2c.py`: the 200M-step pass over 2s2c turmites still chaotic inside the grid at 2M (846 distinct behaviours, 8192² grid, 4 workers because each tsim holds a steps-sized log). It appends to `results/turmites_2s2c.deep.jsonl`.
- `check_highways.py` (+ `follow_hw.mjs`): sorts deep-pass highways into real and false ones and writes `results/highway_check.json`. False means either an **edge artifact** (2s2c only: the pattern was already ≥80% of the 8192 grid wide at the onset, so the ant was just walking straight across a filled grid) or **broken** (tsim stopped early on a ~20k-step repetition; `follow_hw.mjs` runs gallery/engine.js from the onset period by period to the grid edge and the repetition broke). `build.py` reclassifies false highways as chaotic.
- `build.py`: reads `results/*.jsonl` (rows in `*.deep.jsonl` override the first pass). It writes the card data inline into `gallery/index.html` (between the `<script id="cards-data">` tags), `gallery/table.json` (compact column arrays), `gallery/img/*.webp` (240 px, q80) and `results/all.csv`. It deletes thumbnails nothing references and the old `data.json`. The page text is Korean (`FAMILY_KO`, section titles/notes in build.py); all.csv keeps the English family names.
- `gallery/`: a static site (`index.html`, `app.js`, `engine.js`). `engine.js` is a JS port of the engine. Its grid is bit-identical to the C engine at 300k steps for RL, LUNRL and the Fibonacci turmite.
- Preview: `.claude/launch.json` entry `turmite-hunt` (port 8975) serves `gallery/`.

## Deploy
- Live at https://turmite-hunt.vercel.app (Vercel project `turmite-hunt`, scope magic3ightballs-projects). It is listed in the user's "배포 링크 모음" hub Artifact.
- Redeploy: `cd gallery && npx vercel@latest deploy --prod --yes --scope magic3ightballs-projects --project turmite-hunt`. `gallery/.vercelignore` excludes `.env*` and `.vercel`.
- The page is in plain Korean (rewritten 2026-10-20 after the user said it was slow and hard to follow). Order: header + family summary → "개미가 뭔가요?" intro with a live RL animation (engine.js, 512² grid, 0→14,000 steps on a loop) → 6 outcome tiles (고속도로/혼돈/질서/대칭/정체/덫, images taken from the cards) → gallery sections → "규칙 하나를 나누는 순서" click-to-expand vertical timeline (5 steps; each has a diagram and a muted "자세히" technical note) + 3 short cards with collapsed 자세히 → table.
- Load speed (2026-10-20). Before: the page waited on HTML → app.js → engine.js → data.json (1.37 MB raw, 132 KB brotli), with 205 PNGs (5.5 MB, 320 px). Cold headless-Chrome loads put the first card at 0.91–13.6 s. After: card data is inlined (index.html 17.7 KB br), engine.js and app.js are modulepreloaded, `table.json` (458 KB raw, 97 KB br, 6,582 rows) is fetched only when the table section comes within 600 px of the viewport, and there are 144 WebP thumbnails (1.5 MB). Cold loads put the first card at 0.31–1.03 s, with 128 KB transferred by then. Vercel TTFB varies a lot (0.1–3.2 s on the first hit after a deploy).
- `index.html` is hand-written except the `cards-data` script block, which build.py overwrites. Keep that empty `<script id="cards-data" type="application/json"></script>` tag when you edit the page.
- Measure: a CDP script that launches the Playwright Chromium with `--remote-debugging-port`, disables the cache, and polls for `.card img` (it was kept in the session scratchpad, not the repo). For screenshots, use headless Chrome `--screenshot` or CDP `captureScreenshot`; open every `<details>` first to check the timeline.

## Rule maker (make.html, 2026-10-28)
- https://turmite-hunt.vercel.app/make.html. It is linked from the gallery header and from every replay dialog ("이 규칙 고쳐 보기 →" opens `make.html#r=<rule>`). It is also its own row in the 배포 링크 모음 hub.
- `gallery/make.html` + `gallery/make.js`, a static page that imports only `parseRule`/`PALETTE`/`DX`/`DY` from engine.js. engine.js is unchanged.
  - Two editors. 개미: one chip per colour, click to cycle L→R→N→U, 2–16 colours. 턴마이트: a 기분 × 색 table with three buttons per cell (write colour, turn, next state), up to 4 states and 8 colours. You can also type or paste the ant string or the Golly notation.
  - Extras: 🎲 random, ✏️ change one entry, presets (slow ones raise the speed), and a share link (`#r=`, kept current with replaceState). Saved rules live in localStorage only (`turmite-make-saved-v1`).
- **Current UI = Scratch-style blocks (2026-10-28, v4).** The user asked for it after the v2 guide and the v3 3-card loop both left them unsure what to do ("버튼 몇개만 누르면 어떤 규칙으로 돌아가는지 알 수 있었으면", "스크래치처럼 색깔도 바꾸고 방향도 바꾸고").
  - ① 개미의 코드: the rule is rendered as blocks, `🏁 출발을 누르면 → 🔁 계속 반복하기 → 만약 [기분이 A 이고] 발밑 색이 [■] 이면 { [방향 ▾] / 칸을 [색 ▾]으로 칠하기 / [기분을 [B ▾]로 바꾸기] / 한 칸 앞으로 가기 }`. White slots open a popover picker (direction 4, paint colour among the C colours, mood).
  - "+ 색 블록 추가" stays ant-like (paint = next colour) when the rule is an ant. "+ 기분 추가" turns it into a turmite. One block per (mood, colour); blocks support up to 8 colours.
  - ② 무대: 🏁 출발 (edits reset the stage and the flag pulses: Scratch model, no auto-run), ⏸, 👣 한 걸음 (a step log sentence describes what happened), ⏩. Auto speed: the first 30 steps at 1 step per 8 frames with the running block glowing (`.ifb.run`), then 2/frame to step 400, then max(12, t/120) up to 1M per frame. ⏩ = 2M per frame.
  - ③ 결과 (inside the stage card): `finish()` is called on a confirmed highway, a confirmed trap, stalled at ≥2M steps, edge, or wander at ≥50M steps ("계속 헤맴"). It shows plain text plus log-scale bars (랭턴 9,977 / 내 개미 / 내 최고 / 갤러리 최고 14,973,493). One `.go` button: 💾 for a new record, else ✏️ 하나만 바꿔서 다시 (mutates and auto-starts).
  - Mobile: a fixed `#mbar` "🏁 출발 · 무대 보기" shows while the stage is off screen. The old guide and 3-card files are in the session scratchpad only, not the repo.
  - Test: the headless CDP script drives `window.make` (openText/start/run/check/phase): pickers, add colour or mood, step, mutate, save. Verdicts are identical to tsim (RL, LLRRRLRLRLLR, trap 2s2c, LLRRRR, LRRLRLLLR).
- **UI pass v5 (2026-10-28, deployed):** the user liked v4 ("짱 재밌다") and asked for a UI-only improvement, keeping the features as they were. The plan is in `docs/codex/make-ui-plan.md`. What changed:
  - The header lede is replaced by 3 step chips (`#steps`: 🏁 출발 누르기 → 개미 구경하기 → ▾ 바꿔서 다시). `setPhase` lights the current one; this is the only JS change.
  - The workspace has a dotted background, and the code/stage split is 5:6.
  - A "블록 서랍" toolbar: ＋ 색 블록 is the main button; 빼기 and 기분 are small ghost buttons.
  - 🏁 is big, and ⏸/👣/⏩ form one segmented control.
  - The step count is a badge on the canvas, and the status and step log sit in a speech bubble.
  - The result is a card with its buttons above the bars. While a result is showing (CSS `:has`), the canvas shrinks and the bubble hides so the next button fits on a 768 px-tall screen.
  - The extras are a 2-column grid of cards, with reduced-motion support.
  - IDs are unchanged, so the block test passes on local and live with the same verdicts. The v4 files are backed up in the session scratchpad only.
- **Speeds + no auto-stop (2026-10-29, deployed):** at the user's request, the v3 speed bar is back. `#speeds` is 보통 / ⏩ 빠르게 / 🚀 초고속, which is `SPEEDS=[100, 20000, 2000000]` steps per frame. 보통 still runs the first 30 steps slowly with the glowing block, then 2 per frame until step 400. The choice stays across runs. ⏩ 빨리 (`#fast`) is gone.
  - `finish()` no longer stops the ant. The result card appears and the ant keeps walking; phase becomes `done` only when the ant reaches the grid edge.
  - `maybeFinish` re-runs `finish` if a later outcome differs from `resultKind` (for example, stalled turning into a highway).
  - The test script is `blocktest2.mjs` in the session scratchpad. It waits for `#result` and checks that the ant keeps walking and that the speed buttons work. It passes on local and live.
- Earlier "doesn't open" report: the user uses Aside (Chromium 154, `at.studio.AsideBrowser`). Aside's binary running headless with a fresh profile opened every page with no errors, so I couldn't reproduce it. `gallery/vercel.json` rewrites `/make` → `/make.html`, and make.html prints startup errors on the page.
- "Doesn't open": both URLs returned 200 from here and Chromium rendered them with no errors. The user's browser is unknown (Safari access was declined). Fixes: `gallery/vercel.json` rewrites `/make` → `/make.html`; make.html has an inline error handler + `nomodule` fallback that prints the failure on the page instead of showing a blank screen. The canvas repaints only when the step count changes.
- Simulation: the 4096² grid matches tsim, and it writes a 1-byte log (colour read | state | new heading) into a 2M ring buffer. The canvas samples the grid at canvas resolution, so it doesn't build a full bbox image. That keeps big patterns cheap.
- Live verdict, every 0.4 s:
  - Prefix function over the reversed log tail (≤2M steps). The longest tail m ≥ 2000 with m ≥ 6p is periodic.
  - Drift ≠ 0 → 고속도로, which is only "확정" once the ant reaches the grid edge. Drift 0 → 덫; at ≥50 reps and ≥20k steps it is "확정" and the run auto-pauses.
  - Otherwise 정체 if the bbox area equals what it was at t/2 (t ≥ 100k), else 헤매는 중. A highway that disappears shows "깨졌어요".
- Verified headless (the CDP test drives `window.make.run/check`) on local and deployed: RL onset 9,977 p104 (±2,±2); LLRRRLRLRLLR 29,898 p1,968; trap 2s2c 1,131,886 p512; LLRRRR stalled; LRRLRLLLR 14,973,493 p578, edge at 15,191,425 (same as tsim), 0.23 s of compute. UI edits, bad-input error, save: no console errors. Screenshots at 1280 px and 390 px (no horizontal scroll).

## Method
- Conventions: the ant starts heading north in state 0 on an all-0 grid (4096², stops at the edge). A string ant turns by char i on colour i, then writes (i+1) mod n. Turmites use Golly notation `{{{write,turn,next},...}}` with turn 1=N, 2=R, 4=U, 8=L.
- Each step logs one byte: (colour read, state, new heading).
- **Highway / cycle detection:** take the prefix function of the reversed log tail (up to 4M steps) and keep the longest tail with smallest period p that repeats at least 6 times and is at least 20k steps long. The onset is extended backwards exactly. A non-zero net displacement over p makes it a highway; zero makes it a cycle (trap). This runs every 2M steps (stopping early once a highway is clear) and again at the end.
- **Symmetric:** on returns to the start cell (when the bbox has grown at least 30%), mirror tests run about the bbox centre (vertical, horizontal, two diagonals). Three or more hits classify the rule as symmetric.
- **ordered / chaotic:** H(cell | left, up, up-left) / H(cell) over the bbox. Below 0.5 is ordered. Calibration: RLR 0.68, LLRR 0.73, LRRRRRLLR 0.29, RRLLLRLLLRRR 0.02.
- **stalled:** the bbox did not grow during the second half of the run. Pure L/R ants are unbounded, so for them this means ultra-slow growth. For example, LLRRRR is 30×32 at 2M steps and 46×48 at 200M steps.

## Verified against the literature (tsim, 20M steps)
| rule | catalogued claim | tsim |
|---|---|---|
| RL | highway after 9,977 steps, period 104 (Wikipedia) | highway, onset 9,977, period 104, drift (±2,±2) ✔ |
| RLR | chaotic, highway unknown | chaotic ✔ |
| LLRR, LRRL | symmetric growth (Wikipedia; Gale–Propp 1995) | symmetric (17/17, 21/21 mirror checks) ✔ |
| LRRRRRLLR | fills a square | ordered (0.29), square bbox ✔ |
| LLRRRLRLRLLR | convoluted highway | highway, onset 29,898, period 1,968 |
| RRLLLRLLLRRR | triangle that grows and moves | ordered (0.02), bbox drifts off-centre ✔ |
| Fibonacci turmite | spiral | ordered (0.39) ✔ |

Sources: https://en.wikipedia.org/wiki/Langton%27s_ant · https://en.wikipedia.org/wiki/Turmite ·
https://arxiv.org/abs/math/9501233 · https://conwaylife.com/forums/viewtopic.php?p=7560 (Pegg's
2-state 2-colour challenge; 240M was Gochev's 2013 record, the current 2s2c record is 9.53 trillion steps, see "Catalogue check") · https://arxiv.org/abs/2506.10482.

## Search results (2026-10-20, 2M steps first pass; deep rows at 20M)
| family | rules | highway | chaotic | ordered | symmetric | stalled | cycle |
|---|---|---|---|---|---|---|---|
| strings L/R/N/U ≤8 (all, mirror/repeat-reduced) | 43,741 | 5,624 | 35,822 | 2,013 | 9 | 177 | 96 |
| strings L/R ≤12 (all; ≤9 deep at 20M) | 4,015 | 452 | 2,740 | 713 | 42 | 68 | 0 |
| 2-state 2-colour turmites (all; 846 chaotic deep at 200M) | 34,816 | 1,289 | 10,972 | 1,947 | 1,257 | 0 | 19,351 |
| 3-state 2-colour (random 5k) | 5,000 | 225 | 1,486 | 528 | 132 | 0 | 2,629 |
| 2-state 3-colour (random 5k) | 5,000 | 285 | 1,631 | 576 | 164 | 5 | 2,339 |

Notable finds (checked against the catalogues on 2026-10-20; see "Catalogue check" below for which are already known):
- **Pure L/R ants with very long transients.** LRRLRLLLR: chaos for 14,973,493 steps, then a period-578 highway with drift (−5,5).
  LLRRLRLRL: 11,916,160 steps, period 268. LLRLRRLRL: 10,850,523 steps, period 776. LLLLLRRRL: 8,744,719 steps, period 664.
  LLLRRRLLL: 6.77M. LLRLRRL: 5.02M. LLRRRLLL: 1.54M (period 248). For comparison, RL takes 9,977 steps.
- **Large L/R highway periods.** LLLRRRLLRR: period 3,596, drift (−12,−12), onset 876k. LLRRRLRLLLR: period 3,178.
- **With U/N turns.** ULUULUNU has a period-165,761 highway. LULLULR has period 108,534. UUUULRLU has period 67,339.
  All 33 highways first seen at the 2M budget edge were re-confirmed at 20M with identical onset and period.
- **2s2c turmites.** {{{1,4,0},{1,1,1}},{{1,2,1},{0,4,0}}} has a period-53,076 highway. {{{1,2,0},{0,8,1}},{{1,8,0},{0,4,1}}}
  has period 41,407 with drift (−25,138). (Correction 2026-10-20: {{{0,2,1},{0,8,0}},{{1,8,1},{0,2,0}}}, earlier listed as
  "highway after 1.95M steps", is a period-820 repetition that **breaks** later. `follow_hw.mjs` caught it.)
- **2s2c late highways from the 200M pass (2026-10-20).** 846 distinct 2s2c behaviours that were still chaotic inside the grid at 2M
  were re-run to 200M on 8192². Results: 688 still chaotic inside the grid, 55 chaotic up to the edge (fast space-fillers), 77 highway
  rows, of which 54 are real, 16 edge artifacts and 7 broken. Real ones with onset > 20M (mirror/rotated copies merged):
  171,998,534 (period 434, drift (7,−1), `{{{0,1,1},{0,2,1}},{{1,2,1},{0,8,0}}}`; also re-checked independently in engine.js) ·
  153,836,144 (p140) · 153,650,611 (p85) · 150,674,042 (p49) · 121,389,232 (p234) · 119,003,913 (p100) · 101,604,356 (p401) ·
  99,559,237 (p250) · 97,411,645 (p365) · 90,560,202 (p216) · 86,141,256 (p424) · 79,960,796 (p81) · 75.45M · 75.17M · 73.54M ·
  63,278,446 (p87,512) · 57.64M · 38,075,235 (p53,076) · 35.60M · 27.97M (p1,001) · 26.61M · 26.37M (p667) · 23.66M.
  Pegg's challenge list puts the 2s2c record at 9,533,133,147,000 steps (Mark Jeronimus), so these are far from a record.
  None of them is listed individually there (see "Catalogue check"). The 63M p87,512 one is Ed Pegg's.
  False highways worth remembering: 58,618,356 p875, 178,141,358 p178 and 199.92M/217.99M p288 all repeat for 100k+ steps,
  then break.
  Traps: {{{1,2,0},{1,1,1}},{{1,2,0},{0,8,0}}} wanders for 1.13M steps, then enters a zero-drift period-512 orbit.
- **Ultra-slow L/R growers.** LLRRRR, LRRRRL, LLRRRRR, LLLLRRLL and others stay inside about 20–50 cells for 10⁸ steps.

## Catalogue check (2026-10-20)
**Method.** I collected every 2s2c rule named on the challenge pages: 506 rules from the 2016 Google Code copy and 95 from the
GitHub copy, in `{{{...}}}` or `t22r...` form. I ran each one through `tsim run <rule> 2000000`. A rule matches one of ours if the
non-zero cell count is within 2 and the sorted bbox is within 1 cell at 2M steps. This catches mirror, rotated-start, state-relabelled
and unreachable-entry forms. Every match was then confirmed with a full run. The check only covers rules that a source names.
The scripts were kept in the session scratchpad, not the repo.

**Sources read.**
- Ed Pegg's challenge results list: [EdPeggsBusyBeaverTurmiteChallenge](https://github.com/GollyGang/ruletablerepository/wiki/EdPeggsBusyBeaverTurmiteChallenge)
  (GollyGang ruletablerepository wiki, last edited 2025-03-12) and
  [UnresolvedTurmites2States2Colors](https://github.com/GollyGang/ruletablerepository/wiki/UnresolvedTurmites2States2Colors).
  On that page Mark Jeronimus ran **all 65,536** 2s2c rules and lists the unresolved ones (450–570, all run to 1.6B–10B). It gives
  per-decade counts of resolved rules: for example, 28 distinct highways start between 10^8 and 10^9 steps, but it does not name them.
  Also the 2016 Google Code copy (`google-code-archive-source/v2/code.google.com/ruletablerepository/source-archive.zip`, `wiki/`).
- [TwoDimensionalTuringMachines](https://github.com/GollyGang/ruletablerepository/wiki/TwoDimensionalTuringMachines) timeline: Gochev reported
  the 240M 2s2c machine on 8 Feb 2013 and beat it with 7.735B on 10 Feb 2013. So "about 240M" was never the standing record.
- The conwaylife thread (p=7560, topic t=1029) is behind a Cloudflare "verify you are human" check, and the Internet Archive was offline,
  so I did not read the posts themselves. The wiki page above is that challenge's results table.
- Golly `Patterns/Turmites` (11 files, AlephAlpha/golly mirror): Worm Trails, Fibonacci Spiral, Computer Art, Perfectionist and others. None of ours.
- Wikipedia [Turmite](https://en.wikipedia.org/wiki/Turmite) and [Langton's ant](https://en.wikipedia.org/wiki/Langton%27s_ant): none of ours.
- Stony Brook generalized-ant pages (Gale–Propp supplement): pictures of ants 2, 9 and 51 only.
- Full text of arXiv math/9501233, 2409.10124, 2505.05426 and 2506.10482, plus web searches for the exact strings and their mirrors: no hits.

| our rule | our result | verdict |
|---|---|---|
| `{{{0,1,1},{0,2,1}},{{1,2,1},{0,8,0}}}` | highway at 171,998,534, p434 | **not found**: not in the resolved list, and no unresolved-list rule matches it |
| 153,836,144 p140 `{{{1,4,1},{0,1,0}},{{0,2,1},{1,1,0}}}` · 153,650,611 p85 `{{{1,2,0},{0,2,1}},{{1,4,0},{1,8,0}}}` · 150,674,042 p49 `{{{0,2,1},{1,1,1}},{{1,8,1},{0,1,0}}}` | late highways | **not found** |
| `{{{1,1,1},{0,4,0}},{{1,2,1},{1,4,0}}}` | highway at 63,278,446, p87,512 | **known**: Ed Pegg Jr, listed as `{{{1,2,0},{1,4,1}},{{1,1,0},{0,4,1}}}` "Highway at gen 63,278,000 +1000 (Period = 87512)". tsim on the listed form gives the same onset, period and non-zero count (332,579), with the drift turned 90°. |
| `{{{0,1,1},{1,1,1}},{{1,2,1},{0,4,0}}}` | highway at 38,075,235, p53,076 | **not found**. Jeronimus's page used to call p41,407 the "highest period highway", so p53,076 seems not to have been noted. |
| `{{{1,2,0},{0,8,1}},{{1,8,0},{0,4,1}}}` | highway at 60,520, p41,407 | **known**: Jeronimus `t22r120081180041`, "Highest period highway" (GitHub copy: "Period-41407 highway") |
| LRRLRLLLR (14,973,493, p578) | 1-state 9-colour | **not found**, mirror RLLRLRRRL included. The challenge lists 1-state ants only up to 7 colours, and those use U turns. |
| LLRRLRLRL (11,916,160, p268) | 1-state 9-colour | **not found**, mirror RRLLRLRLR included |
| LLRLRRLRL (10,850,523, p776) | 1-state 9-colour | **not found**, mirror RRLRLLRLR included |

**Reading the verdicts.** "Not found" means no named entry in these sources, not proof that nobody has seen it. Jeronimus's exhaustive
2s2c census (to 10^10) must have run the 2s2c rules, since it counts the highways starting between 10^7 and 10^9 without naming them.
So the 2s2c late highways are "unpublished as individual rules", not "never seen". The 9-colour L/R ants are outside every list found.
Cross-check: none of our 54 real 2s2c highways matched a rule that the wiki lists as unresolved (still chaotic at 1.6B–10B), so nothing contradicts them.
Gallery: the two known rules now have a note on their cards (`KNOWN_NOTES` in build.py), and the "240M record" sentence was corrected in build.py and the footer.

## Commands that worked
```
python3 search.py strings --maxlen 8 --steps 2000000                 # 43,741 rules (mirror + repeat reduced)
python3 search.py turmites --steps 2000000                             # 34,816 2s2c turmites (all, mirror-reduced)
python3 search.py random --states 3 --colors 2 --count 5000
python3 search.py random --states 2 --colors 3 --count 5000
python3 search.py strings --alphabet LR --maxlen 12
python3 deep.py 20000000        # unconfirmed highways + L/R ≤9 chaotic/stalled -> results/*.deep.jsonl
python3 deep_2s2c.py 200000000 4   # 846 rules, 30 min under load ~150-220
python3 check_highways.py         # ~1.5 min; needs node (follow_hw.mjs imports gallery/engine.js)
python3 build.py                 # slow under load: renders ~100 thumbnails with tsim
```

## Risks / caveats
- "Highway" at a budget edge (`stop: maxsteps`) is **unconfirmed**. The gallery flags these, and the
  "longest chaos" section only uses highways that carried the ant off the 4096² grid.
- tsim's early "highway" stop (`stop: highway`, used on runs longer than 2M) only needs a ~20k-step, 6-rep tail. In the 200M
  2s2c pass 7 of those broke later, so treat `stop: highway` as unconfirmed until `check_highways.py` follows it to the edge.
  The 2M first passes never stop early (they only check at the end), so their highways are `border` or `maxsteps`.
- Periods above roughly 600k steps cannot be detected (the window is 4M steps with 6 reps).
- Novelty is only checked against the named rules in the sources under "Catalogue check". There is no machine-readable catalogue of ant/turmite transients to compare
  against. The Pegg challenge thread and Golly's turmite collection are the closest.
- The 2s2c turmite space contains duplicates (unreachable table entries). `build.py` dedups by behaviour signature.
- On 2026-10-20 the machine was heavily oversubscribed (load ~650, 28 GB swap) by other apps. The search ran
  about 50–100× slower than tsim's normal ~44M steps/s per core, so the deep re-runs were trimmed.

## Next steps
1. Done 2026-10-20 (200M, see above). Next: the 688 still chaotic at 200M could go to 1B steps, but that needs a bigger grid
   (or a sparse/hashed grid) and ~1 GB of log per process, so run it when the machine is idle.
2. Confirm unconfirmed highways and re-run the stalled L/R ants at 1B steps to measure their growth rate.
3. Done 2026-10-20 (see "Catalogue check"). Still open: read the conwaylife thread itself (Cloudflare human check blocked automated reading)
   in case a post names one of the unlisted rules.

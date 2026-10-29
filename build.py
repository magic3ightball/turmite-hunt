#!/usr/bin/env python3
"""Build the gallery from results/*.jsonl:
  gallery/index.html   card data inlined between the cards-data <script> tags (first screen needs no fetch)
  gallery/table.json   compact table rows, fetched only when the table scrolls into view
  gallery/img/*.webp   240 px thumbnails; files nothing references are deleted

results/<family>.jsonl        first pass
results/<family>.deep.jsonl   optional re-runs at more steps; rows here override the first pass
"""
import csv, glob, hashlib, json, os, re, subprocess, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
TSIM = os.path.join(ROOT, "bin", "tsim")
IMG = os.path.join(ROOT, "gallery", "img")
TMP = os.path.join(ROOT, "results", "_raw")
PALETTE = [
    (14, 16, 22), (242, 196, 92), (96, 178, 232), (232, 98, 98), (130, 210, 140), (190, 140, 230),
    (250, 140, 60), (80, 220, 210), (240, 120, 190), (200, 200, 210), (150, 120, 70), (70, 120, 200),
    (180, 230, 80), (230, 70, 140), (110, 90, 200), (255, 240, 180),
]
# Korean labels for the page only (results/all.csv keeps the English family names).
FAMILY_KO = {
    "ant strings L/R/N/U ≤8": "개미 L/R/N/U 8글자 이하 (전부)",
    "ant strings L/R ≤12": "개미 L/R 12글자 이하 (전부)",
    "turmites 2-state 2-colour (all)": "턴마이트 2상태 2색 (전부)",
    "turmites 3-state 2-colour (random)": "턴마이트 3상태 2색 (무작위 20만)",
    "turmites 2-state 3-colour (random)": "턴마이트 2상태 3색 (무작위 5천)",
    "classic": "알려진 규칙",
}
FAMILY_NAMES = {
    "strings_LRNU_8": "ant strings L/R/N/U ≤8",
    "strings_LR_12": "ant strings L/R ≤12",
    "turmites_2s2c": "turmites 2-state 2-colour (all)",
    "random_3s2c": "turmites 3-state 2-colour (random)",
    "random_2s3c": "turmites 2-state 3-colour (random)",
}
# Catalogued behaviour (Wikipedia "Langton's ant" / "Turmite"; Gale & Propp 1995).
CLASSICS = [
    ("RL", "랭턴 개미. 기록: 9,977걸음 뒤 고속도로, 반복 104걸음 (위키백과)"),
    ("RLR", "기록: 계속 어지럽게 자람. 고속도로가 생기는지는 아무도 모름 (위키백과)"),
    ("LLRR", "기록: 좌우 대칭으로 자람 (위키백과, Propp)"),
    ("LRRL", "기록: 좌우 대칭으로 자람. Propp가 '정말 놀랍다'고 함 (Gale 외 1995)"),
    ("LRRRRRLLR", "기록: 자기 주변을 정사각형으로 채움 (위키백과)"),
    ("LLRRRLRLRLLR", "기록: 꼬불꼬불한 고속도로를 만듦 (위키백과)"),
    ("RRLLLRLLLRRR", "기록: 꽉 찬 삼각형이 자라면서 이동 (위키백과)"),
    ("{{{1,8,1},{1,8,1}},{{1,2,1},{0,1,0}}}", "기록: 피보나치 나선을 그리는 턴마이트 (위키백과)"),
]


# Deep re-run budgets (steps) per family; default 20M (deep.py). deep_turmites.py runs these at 200M on 8192².
DEEP_STEPS = {"turmites_2s2c": 200_000_000, "random_3s2c": 200_000_000}
# check_highways.py: deep-pass highways that are false (edge artifact on a filled grid, or a repetition that broke later).
CHECK = os.path.join(ROOT, "results", "highway_check.json")


def fix(r):
    if r["class"] == "bounded":       # older tsim label
        r["class"] = "stalled"
    return r


def load():
    fams = {}
    for f in sorted(glob.glob(os.path.join(ROOT, "results", "*.jsonl"))):
        base = os.path.basename(f)[:-6]
        if base.endswith(".deep"):
            continue
        rows = {}
        for l in open(f):
            r = json.loads(l)
            if "error" not in r:
                fix(r); r["family"] = FAMILY_NAMES.get(base, base); rows[r["rule"]] = r
        steps = max(r["steps"] for r in rows.values())
        deep = f[:-6] + ".deep.jsonl"
        rerun = None
        if os.path.exists(deep):
            for l in open(deep):
                r = json.loads(l)
                if "error" not in r:
                    fix(r); r["family"] = FAMILY_NAMES.get(base, base); rows[r["rule"]] = r
                    rerun = (rerun or 0) + 1
        if os.path.exists(CHECK):
            for rule, d in json.load(open(CHECK)).get(base, {}).items():
                r = rows.get(rule)
                if r and r["class"] == "highway":
                    if d["bbox_at_onset"]:
                        r["bbox_at_onset"] = d["bbox_at_onset"]
                    if not d["real"]:      # no lasting highway: chaotic until the grid filled, or the repetition broke
                        r.update({"class": "chaotic", "period": 0, "onset": 0, "hdx": 0, "hdy": 0,
                                  "false_highway": "broken" if d["followed"] is False else "edge"})
        fams[base] = dict(name=FAMILY_NAMES.get(base, base), rows=list(rows.values()), steps=steps, rerun=rerun,
                          rerun_steps=DEEP_STEPS.get(base, 20_000_000))
    return fams


def signature(r):
    return (r["class"], r["onset"], r["period"], abs(r["hdx"]) + abs(r["hdy"]), r["nonzero"], r["w"] * r["h"])


def dedup(rows):
    """Distinct behaviours only (turmites with unreachable entries duplicate each other)."""
    seen, out = set(), []
    for r in rows:
        k = signature(r)
        if k not in seen:
            seen.add(k); out.append(r)
    return out


def render(r, steps=None, size=240):
    rule = r["rule"]
    if steps is None:
        if r["class"] == "highway":
            steps = r["onset"] + max(8 * r["period"], 4000)
        else:
            steps = r["steps"]
    name = hashlib.md5(f"{rule}@{steps}".encode()).hexdigest()[:12] + ".webp"
    out = os.path.join(IMG, name)
    if not os.path.exists(out):
        raw = os.path.join(TMP, name + ".raw")
        # 8192² so deep rows that ran on the bigger grid render to the same step; smaller runs are unaffected
        subprocess.run([TSIM, "run", rule, str(steps), "-g", "8192", "-d", raw], check=True, capture_output=True)
        b = open(raw, "rb").read()
        w, h = np.frombuffer(b[:8], np.int32)
        a = np.frombuffer(b[8:], np.uint8).reshape(h, w)
        m = max(w, h, 40)
        canvas = np.zeros((m, m), np.uint8)
        canvas[(m - h) // 2:(m - h) // 2 + h, (m - w) // 2:(m - w) // 2 + w] = a
        rgb = np.array(PALETTE, np.uint8)[canvas]
        im = Image.fromarray(rgb)
        im = im.resize((size, size), Image.NEAREST if m <= size else Image.LANCZOS)
        im.save(out, "WEBP", quality=80, method=6)
        os.remove(raw)
    return "img/" + name


# Finds already in Ed Pegg's Busy Beaver Turmite Challenge list (GollyGang ruletablerepository wiki), matched by
# running the listed rule in tsim. See "Catalogue check" in docs/codex/handoff.md.
KNOWN_NOTES = {
    "{{{1,1,1},{0,4,0}},{{1,2,1},{1,4,0}}}": "이미 알려진 규칙: Ed Pegg Jr가 먼저 찾음 (6,327만 걸음 뒤 주기 87,512 고속도로, 90° 돌린 꼴)",
    "{{{1,2,0},{0,8,1}},{{1,8,0},{0,4,1}}}": "이미 알려진 규칙: Mark Jeronimus의 2상태 2색 전수 조사에서 '주기가 가장 긴 고속도로'로 기록됨",
    "{{{1,2,1},{0,4,0}},{{1,8,1},{0,2,0}}}": "이미 알려진 규칙: Mark Jeronimus의 2상태 2색 전수 조사에서 '주기가 가장 긴 고속도로'로 기록됨 (같은 규칙의 다른 꼴)",
}


def item(r, note=None, known=None):
    keep = ("rule", "family", "class", "steps", "stop", "period", "onset", "hdx", "hdy", "w", "h", "order", "nonzero")
    d = {k: r.get(k) for k in keep}
    d["family"] = FAMILY_KO.get(d["family"], d["family"])
    if r["rule"] in KNOWN_NOTES:
        note = (note + " · " if note else "") + KNOWN_NOTES[r["rule"]]
    if r["class"] == "highway" and r.get("stop") == "maxsteps":
        note = (note + " · " if note else "") + f"미확인: 정해 둔 걸음의 마지막 {r['steps'] - r['onset']:,}걸음 동안만 반복이 보임"
    d["img"] = render(r)
    if note: d["note"] = note
    if known: d["known"] = known
    return d


def main():
    os.makedirs(IMG, exist_ok=True); os.makedirs(TMP, exist_ok=True)
    fams = load()
    allrows = [r for f in fams.values() for r in f["rows"]]
    sections = []

    # 1. classics, run fresh at 20M steps
    cl = []
    for rule, note in CLASSICS:
        p = subprocess.run([TSIM, "run", rule, "20000000"], capture_output=True, text=True, check=True)
        r = json.loads(p.stdout); r["family"] = "classic"
        cl.append(item(r, note=note, known="catalogued"))
    sections.append(dict(title="이미 알려진 규칙, 다시 돌려 보기", desc="위키백과와 논문에 기록된 규칙을 이 시뮬레이터로 다시 돌렸습니다. 카드 아래 '기록'과 결과가 맞는지 비교해 보세요.", items=cl))

    hw = [r for r in allrows if r["class"] == "highway" and r.get("stop") != "maxsteps"]   # confirmed: ran off the grid
    per_fam = lambda key, n, rows: [x for f in fams.values()
                                    for x in dedup(sorted([r for r in rows if r["family"] == f["name"]], key=key))[:n]]

    first_pass = [r for r in hw if r["onset"] <= 20_000_000]          # the 200M 2s2c finds get their own section below
    long_t = sorted(per_fam(lambda r: -r["onset"], 6, first_pass), key=lambda r: -r["onset"])
    sections.append(dict(title="가장 오래 헤맨 뒤 고속도로를 낸 개미", desc="한참 어지럽게 헤매다가, 어느 순간 같은 동작을 반복하며 한쪽으로 길을 내고 떠나는 규칙입니다. 랭턴 개미는 약 1만 걸음 헤매지만, 여기 있는 개미는 수십만에서 수백만 걸음을 헤맵니다. 실제로 격자 끝까지 길을 낸 것만 골랐습니다.",
                         items=[item(r, note=f"랭턴 개미보다 {r['onset'] / 9977:,.0f}배 오래 헤맴") for r in long_t]))

    # late highways from the 200M 2s2c pass: started while the pattern was still well inside the grid
    late = [r for r in allrows if r["family"] == FAMILY_NAMES["turmites_2s2c"] and r["class"] == "highway"
            and r["onset"] > 20_000_000 and "bbox_at_onset" in r]
    seen, late_u = set(), []
    for r in sorted(late, key=lambda r: -r["onset"]):
        k = (r["period"], abs(r["hdx"]) + abs(r["hdy"]), r["onset"] // 1000)      # mirror/rotated copies differ by a step
        if k not in seen:
            seen.add(k); late_u.append(r)
    if late_u:
        sections.append(dict(title="2억 걸음까지 다시 돌려서 찾은 늦은 고속도로",
                             desc="200만 걸음이 지나도 계속 헤매던 2상태 2색 턴마이트 가운데, 행동이 서로 다른 것을 모두 2억 걸음까지 다시 돌렸습니다. 수천만에서 1억 걸음 넘게 헤매다가 고속도로를 내는 턴마이트가 나왔습니다. 가짜는 뺐습니다. 무늬가 격자(8192칸)를 거의 다 채운 뒤 가장자리에서 잠깐 생긴 것, 그리고 잠깐 반복하다 다시 깨진 것입니다. 남은 것은 모두 격자 끝까지 고속도로를 따라간 것을 확인했습니다. 비교하자면, Ed Pegg 챌린지 목록에 있는 2상태 2색 최장 기록은 약 9조 5천억 걸음입니다(2억 4천만 걸음은 2013년의 옛 기록). 여기 나온 늦은 고속도로는 그 목록에 따로 실려 있지 않습니다. 다만 Mark Jeronimus가 2상태 2색 규칙을 모두 100억 걸음까지 돌려 본 적이 있어서, 아무도 본 적 없는 것이라고 하기는 어렵습니다.",
                             items=[item(r, note=f"랭턴 개미보다 {r['onset'] / 9977:,.0f}배 오래 헤맴 · 고속도로가 시작될 때 무늬 {r['bbox_at_onset'][0]:,}×{r['bbox_at_onset'][1]:,}칸")
                                    for r in late_u[:12]]))

    big_p = sorted(per_fam(lambda r: -r["period"], 6, hw), key=lambda r: -r["period"])
    sections.append(dict(title="반복 한 마디가 가장 긴 고속도로", desc="고속도로는 같은 동작 묶음을 되풀이합니다. 그 한 묶음이 아주 긴 규칙들입니다. 대개 길이 넓고 무늬가 복잡합니다.",
                         items=[item(r) for r in big_p]))

    ordered = [r for r in allrows if r["class"] == "ordered"]
    # most crystalline first, but spread over families and shapes
    od = per_fam(lambda r: r["order"], 6, ordered)
    sections.append(dict(title="반듯하게 자라는 이상한 모양", desc="고속도로는 안 생기지만 정사각형, 삼각형, 움직이는 쐐기처럼 반듯한 무늬를 만들며 자랍니다. 가장 반듯한 것부터 놓았습니다.",
                         items=[item(r) for r in sorted(od, key=lambda r: r["order"])]))

    sym = dedup([r for r in allrows if r["class"] == "symmetric"])
    sections.append(dict(title="대칭으로 자라는 개미", desc="개미가 출발한 칸에 돌아올 때마다 무늬가 거울에 비춘 듯 대칭입니다. Propp가 LLRR에서 처음 본 현상입니다.",
                         items=[item(r) for r in sorted(sym, key=lambda r: -r["w"] * r["h"])[:12]]))

    lr_chaos = [r for r in allrows if r["class"] == "chaotic" and r["rule"][0] != "{" and set(r["rule"]) <= set("LR")]
    sections.append(dict(title="끝까지 헤매는 L/R 개미", desc="L과 R만 쓰는데, 정해 둔 걸음 안에 고속도로가 안 나온 규칙입니다(RLR처럼). 아주 늦게 고속도로가 나올지도 모르는 후보입니다.",
                         items=[item(r) for r in sorted(lr_chaos, key=lambda r: (len(r["rule"]), r["rule"]))[:12]]))

    slow = [r for r in allrows if r["class"] == "stalled" and r["rule"][0] != "{" and set(r["rule"]) <= set("LR")]
    sections.append(dict(title="거의 안 자라는 L/R 개미", desc="뒤쪽 절반 동안 무늬가 한 칸도 안 커졌습니다. L과 R이 둘 다 들어간 개미는 결국 끝없이 커진다고 증명돼 있어서, 멈춘 게 아니라 아주아주 느리게 자라는 것입니다. 크기는 마지막 걸음 기준입니다.",
                         items=[item(r) for r in sorted(slow, key=lambda r: r["w"] * r["h"])[:12]]))

    bnd = dedup([r for r in allrows if r["class"] in ("stalled", "cycle") and r not in slow])
    sections.append(dict(title="멈추거나 덫에 걸린 규칙 (U/N 회전, 턴마이트)", desc="무늬가 더 안 커지거나, 개미가 닫힌 고리를 영원히 맴도는 '덫'에 걸린 규칙입니다. 덫에 걸리기 전에 오래 헤맨 것부터 놓았습니다. 유턴(U)·직진(N)이나 기분(상태)이 섞이면 진짜로 갇힐 수 있습니다.",
                         items=[item(r, note=f"{r['onset']:,}걸음 뒤 덫에 걸림" if r["class"] == "cycle" else None)
                                for r in sorted(bnd, key=lambda r: -r["onset"])[:12]]))

    table = [r for r in allrows if (r["class"] == "highway" and (r["onset"] >= 50000 or r["period"] >= 1000))
             or r["class"] in ("ordered", "symmetric", "stalled", "cycle")]
    table = dedup(table)

    families = []
    for f in fams.values():
        counts = {}
        for r in f["rows"]:
            counts[r["class"]] = counts.get(r["class"], 0) + 1
        families.append(dict(name=FAMILY_KO.get(f["name"], f["name"]), total=len(f["rows"]), steps=f["steps"], rerun=f["rerun"], rerun_steps=f["rerun_steps"], counts=counts))

    # cards + summary: inlined into index.html so the first screen needs no extra request
    cards = json.dumps(dict(families=families, sections=sections, tablerows=len(table)), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = os.path.join(ROOT, "gallery", "index.html")
    html, n = re.subn(r'(<script id="cards-data" type="application/json">).*?(</script>)',
                      lambda m: m.group(1) + cards + m.group(2), open(page).read(), flags=re.S)
    assert n == 1, "cards-data <script> not found in index.html"
    open(page, "w").write(html)
    # table: column arrays, family/class as indexes, loaded lazily by app.js
    fam_names = [FAMILY_KO.get(f["name"], f["name"]) for f in fams.values()]
    classes = ["highway", "chaotic", "ordered", "symmetric", "stalled", "cycle"]
    cols = ["rule", "fam", "cls", "steps", "unconfirmed", "period", "onset", "hdx", "hdy", "w", "h", "order"]
    trows = [[r["rule"], fam_names.index(FAMILY_KO[r["family"]]), classes.index(r["class"]), r["steps"],
              1 if r.get("stop") == "maxsteps" else 0, r["period"], r["onset"], r["hdx"], r["hdy"], r["w"], r["h"],
              round(r["order"], 2) if r.get("order", -1) >= 0 else -1] for r in table]
    json.dump(dict(fams=fam_names, classes=classes, cols=cols, rows=trows),
              open(os.path.join(ROOT, "gallery", "table.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    # drop thumbnails (old renders, old formats) that nothing references any more
    used = {it["img"][4:] for s in sections for it in s["items"]}
    stale = [f for f in os.listdir(IMG) if f not in used]
    for f in stale:
        os.remove(os.path.join(IMG, f))
    old = os.path.join(ROOT, "gallery", "data.json")
    if os.path.exists(old):
        os.remove(old)
    with open(os.path.join(ROOT, "results", "all.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["family", "rule", "class", "steps", "stop", "onset", "period", "hdx", "hdy", "w", "h", "nonzero", "order", "sym_hits", "sym_checks"], extrasaction="ignore")
        w.writeheader(); w.writerows(allrows)
    print(f"{sum(len(s['items']) for s in sections)} cards, {len(table)} table rows, {len(stale)} stale thumbnails removed")


if __name__ == "__main__":
    main()

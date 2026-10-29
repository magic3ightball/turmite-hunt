import { Ant, PALETTE } from './engine.js';

const $ = s => document.querySelector(s);
const fmt = n => n == null ? '' : Number(n).toLocaleString('en-US');
const PAL32 = new Uint32Array(PALETTE.map(([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r));

const CLASS_KO = { highway: '고속도로', chaotic: '혼돈', ordered: '질서', symmetric: '대칭', stalled: '정체', cycle: '덫' };
const CLASS_INFO = {
  highway: '같은 동작 묶음을 되풀이하며 한쪽으로 끝없이 길을 냄',
  chaotic: '되풀이가 안 보이고 무늬가 어지러움',
  ordered: '되풀이는 없지만 반듯한 무늬로 자람',
  symmetric: '출발 칸에 돌아올 때마다 무늬가 거울 대칭',
  stalled: '뒤쪽 절반 동안 무늬가 안 커짐 (갇혔거나 아주 느리게 자람)',
  cycle: '닫힌 고리를 영원히 맴돎',
};
const badge = c => `<span class="b ${c}">${CLASS_KO[c] || c}</span>`;

function shortRule(r) {
  if (r[0] !== '{') return r;
  // {{{1,2,0},{0,8,0}}} -> compact "1R0 0L0 | ..."
  const T = { 1: 'N', 2: 'R', 4: 'U', 8: 'L' };
  return r.slice(1, -1).match(/\{\{.*?\}\}/g).map(st =>
    [...st.matchAll(/\{(\d+),(\d+),(\d+)\}/g)].map(m => m[1] + T[m[2]] + m[3]).join(' ')).join(' | ');
}

function card(it) {
  const el = document.createElement('button');
  el.className = 'card';
  el.innerHTML = `
    <div class="thumb"><img loading="lazy" decoding="async" width="240" height="240" src="${it.img}" alt=""></div>
    <div class="meta">
      <div class="rule" title="${it.rule}">${shortRule(it.rule)}</div>
      <div class="badges">${badge(it.class)}</div>
      <div class="nums">${it.class === 'highway'
        ? `<b>${fmt(it.onset)}</b>걸음 헤맨 뒤 고속도로 · 반복 ${fmt(it.period)}걸음`
        : `${fmt(it.steps)}걸음 · ${it.w}×${it.h}칸`}</div>
      ${it.note ? `<div class="note">${it.note}</div>` : ''}
    </div>`;
  el.onclick = () => openReplay(it);
  return el;
}

// Draws the ant's pattern (fitted to its bounding box, or following the ant) onto a canvas.
function paint(cv, ctx, off, octx, ant, follow) {
  let x0, y0, w, h;
  if (follow) { const R = 80; x0 = ant.x - R; y0 = ant.y - R; w = h = 2 * R + 1; }
  else {
    x0 = ant.xmin - 2; y0 = ant.ymin - 2; w = ant.xmax - ant.xmin + 5; h = ant.ymax - ant.ymin + 5;
    const m = Math.max(w, h, 48); x0 -= (m - w) >> 1; y0 -= (m - h) >> 1; w = h = m;
  }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); w = Math.min(w, ant.G - x0); h = Math.min(h, ant.G - y0);
  if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
  const img = octx.createImageData(w, h), px = new Uint32Array(img.data.buffer), g = ant.grid, G = ant.G;
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * G + x0, o = y * w;
    for (let x = 0; x < w; x++) px[o + x] = PAL32[g[row + x]];
  }
  octx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = w > cv.width;
  ctx.fillStyle = '#0e1016'; ctx.fillRect(0, 0, cv.width, cv.height);
  const sc = cv.width / w;
  ctx.drawImage(off, 0, 0, w * sc, h * sc);
  ctx.fillStyle = '#ff3355';
  ctx.beginPath(); ctx.arc((ant.x - x0 + 0.5) * sc, (ant.y - y0 + 0.5) * sc, Math.max(2.5, sc * 0.6), 0, 7); ctx.fill();
}

// ---------- replay ----------
let ant = null, item = null, playing = false, speed = 200, follow = false, raf = 0;
const cv = $('#cv'), ctx = cv.getContext('2d');
const off = document.createElement('canvas'), octx = off.getContext('2d');

function openReplay(it) {
  item = it;
  ant = new Ant(it.rule, 2048);
  $('#r-title').textContent = shortRule(it.rule);
  $('#r-golly').textContent = it.rule === shortRule(it.rule) ? '' : it.rule;
  $('#r-info').innerHTML = it.class === 'highway'
    ? `${badge('highway')} <b>${fmt(it.onset)}</b>걸음 헤맨 뒤, ${fmt(it.period)}걸음짜리 묶음을 되풀이하며 길을 냅니다 (한 묶음에 (${it.hdx}, ${it.hdy})칸 이동).`
    : `${badge(it.class)} ${CLASS_INFO[it.class] || ''}. ${fmt(it.steps)}걸음까지 돌려 봤습니다.`;
  $('#jump-onset').style.display = it.class === 'highway' ? '' : 'none';
  $('#r-edit').href = 'make.html#r=' + encodeURIComponent(it.rule);
  $('#replay').showModal();
  playing = true; $('#play').textContent = '멈춤';
  draw(); loop();
}

function jump(target) {
  target = Math.max(0, Math.floor(target));
  if (target < ant.t) ant.reset();
  const t0 = performance.now();
  while (ant.t < target && !ant.dead && performance.now() - t0 < 8000) ant.run(Math.min(1 << 22, target - ant.t));
  draw();
}

function draw() {
  paint(cv, ctx, off, octx, ant, follow);
  $('#r-step').textContent = `${fmt(ant.t)}걸음${ant.dead ? ' — 2048² 격자 끝에 닿음' : ''} · ${ant.xmax - ant.xmin + 1}×${ant.ymax - ant.ymin + 1}칸`;
}

function loop() {
  cancelAnimationFrame(raf);
  const tick = () => {
    if (!$('#replay').open) return;
    if (playing && !ant.dead) { ant.run(speed); draw(); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

$('#play').onclick = () => { playing = !playing; $('#play').textContent = playing ? '멈춤' : '재생'; };
$('#restart').onclick = () => { ant.reset(); draw(); };
$('#speed').oninput = e => { speed = Math.round(10 ** +e.target.value); $('#speed-v').textContent = `한 번에 ${fmt(speed)}걸음`; };
$('#jump-onset').onclick = () => jump(item.onset - 3000);
$('#jump-go').onclick = () => jump(+$('#jump-n').value.replace(/[, _]/g, ''));
$('#follow').onchange = e => { follow = e.target.checked; draw(); };
$('#close').onclick = () => $('#replay').close();
$('#speed').dispatchEvent(new Event('input'));

// ---------- intro: live Langton's ant (RL) ----------
{
  const c = $('#rl'), cx = c.getContext('2d'), o = document.createElement('canvas'), ox = o.getContext('2d');
  const rl = new Ant('RL', 512), END = 14000, ONSET = 9977;
  let hold = 0, visible = true;
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(c);
  const tick = () => {
    if (visible) {
      if (rl.t >= END || rl.dead) { if (++hold > 90) { rl.reset(); hold = 0; } }
      else rl.run(rl.t < 9000 ? 60 : rl.t < 10600 ? 10 : 40);
      paint(c, cx, o, ox, rl, false);
      const hw = rl.t >= ONSET;
      $('#rl-step').textContent = fmt(rl.t);
      $('#rl-phase').textContent = hw ? '고속도로! 같은 104걸음을 되풀이하며 떠남' : '어지럽게 헤매는 중…';
      $('#rl-phase').className = hw ? 'hw' : 'ch';
      $('#rl-bar').style.width = (100 * Math.min(rl.t, END) / END) + '%';
    }
    requestAnimationFrame(tick);
  };
  $('#rl-mark').style.left = (100 * ONSET / END) + '%';
  requestAnimationFrame(tick);
}

// ---------- page ----------
const data = JSON.parse($('#cards-data').textContent);
const allItems = data.sections.flatMap(s => s.items);

$('#summary').innerHTML = data.families.map(f => `
  <div class="fam"><h3>${f.name}</h3><div class="fam-n">${fmt(f.total)}개 규칙 · 규칙마다 ${fmt(f.steps)}걸음${f.rerun ? ` · ${fmt(f.rerun)}개는 ${f.rerun_steps >= 1e8 ? fmt(f.rerun_steps / 1e8) + '억' : fmt(f.rerun_steps / 1e4) + '만'} 걸음까지 다시` : ''}</div>
  <div class="bars">${Object.entries(f.counts).sort((a, b) => b[1] - a[1]).map(([c, n]) =>
    `<span class="b ${c}">${CLASS_KO[c] || c} ${fmt(n)}</span>`).join('')}</div></div>`).join('');

// outcome tiles: picture from the matching card (by rule, else first card of that class)
document.querySelectorAll('.oc[data-cls]').forEach(el => {
  const it = allItems.find(i => i.rule === el.dataset.rule) || allItems.find(i => i.class === el.dataset.cls);
  if (!it) return;
  el.querySelector('img').src = it.img;
  el.querySelector('.oc-rule').textContent = shortRule(it.rule).length > 14 ? '턴마이트' : shortRule(it.rule);
  el.onclick = () => openReplay(it);
});

for (const sec of data.sections) {
  const s = document.createElement('section');
  s.innerHTML = `<h2>${sec.title}</h2><p class="desc">${sec.desc}</p><div class="cards"></div>`;
  const cards = s.querySelector('.cards');
  sec.items.forEach(it => cards.appendChild(card(it)));
  $('#sections').appendChild(s);
}

// ---------- table (table.json is fetched only when the table comes near the screen) ----------
let rows = [];
let sortKey = 'onset', sortDir = -1;
function renderTable() {
  const q = $('#q').value.trim().toUpperCase(), fam = $('#fam').value, cls = $('#cls').value;
  const list = rows.filter(r => (!q || r.rule.toUpperCase().includes(q) || shortRule(r.rule).includes(q))
    && (!fam || r.family === fam) && (!cls || r.class === cls))
    .sort((a, b) => sortDir * ((a[sortKey] ?? -1) > (b[sortKey] ?? -1) ? 1 : (a[sortKey] ?? -1) < (b[sortKey] ?? -1) ? -1 : 0))
    .slice(0, 400);
  $('#tbody').innerHTML = list.map(r => `<tr data-i="${r.i}">
    <td class="mono">${shortRule(r.rule)}</td><td>${r.family}</td><td>${badge(r.class)}${r.class === 'highway' && r.stop === 'maxsteps' ? ' <span class="dim">미확인</span>' : ''}</td>
    <td class="n">${r.class === 'highway' ? fmt(r.onset) : ''}</td><td class="n">${r.class === 'highway' ? fmt(r.period) : ''}</td>
    <td class="n">${r.class === 'highway' ? `(${r.hdx},${r.hdy})` : ''}</td><td class="n">${fmt(r.steps)}</td><td class="n">${r.w}×${r.h}</td>
    <td class="n">${r.order >= 0 ? r.order.toFixed(2) : ''}</td></tr>`).join('');
  $('#count').textContent = `${fmt(list.length)}줄 표시 (최대 400줄, 전체 ${fmt(rows.length)}줄)`;
}
let tableLoading = null;
function loadTable() {
  tableLoading ??= fetch('table.json').then(r => r.json()).then(t => {
    rows = t.rows.map((a, i) => {
      const r = Object.fromEntries(t.cols.map((k, j) => [k, a[j]]));
      return { ...r, i, family: t.fams[r.fam], class: t.classes[r.cls], stop: r.unconfirmed ? 'maxsteps' : 'edge' };
    });
    renderTable();
  });
}
$('#count').textContent = `표 불러오는 중… (${fmt(data.tablerows)}줄)`;
new IntersectionObserver((es, ob) => { if (es[0].isIntersecting) { ob.disconnect(); loadTable(); } }, { rootMargin: '600px' })
  .observe($('#tablesec'));
$('#tbody').onclick = e => { const tr = e.target.closest('tr'); if (tr) openReplay(rows[+tr.dataset.i]); };
document.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => {
  sortDir = sortKey === th.dataset.k ? -sortDir : -1; sortKey = th.dataset.k; renderTable();
});
['#q', '#fam', '#cls'].forEach(s => { $(s).oninput = renderTable; $(s).onfocus = loadTable; });
$('#fam').innerHTML = '<option value="">모든 묶음</option>' + data.families.map(f => `<option>${f.name}</option>`).join('');
$('#cls').innerHTML = '<option value="">모든 결과</option>' + Object.keys(CLASS_INFO).map(c => `<option value="${c}">${CLASS_KO[c]}</option>`).join('');
$('#classdefs').innerHTML = Object.entries(CLASS_INFO).map(([c, d]) => `<li>${badge(c)} ${d}</li>`).join('');

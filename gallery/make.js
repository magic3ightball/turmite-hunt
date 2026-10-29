// "나만의 개미 만들기": edit an ant / turmite rule, watch it run, and get a live verdict.
// Rule model is engine.js's: { S, C, tab[s][c] = { w: colour to write, t: turn 0=N 1=R 2=U 3=L, n: next state } }.
import { parseRule, PALETTE, DX, DY } from './engine.js';

const $ = s => document.querySelector(s);
const fmt = n => Number(n).toLocaleString('en-US');
const TURN = 'NRUL', TURN_KO = { L: '왼쪽', R: '오른쪽', N: '직진', U: '유턴' }, CYCLE = 'LRNU';
const STATE = 'ABCD';
const PAL32 = new Uint32Array(PALETTE.map(([r, g, b]) => (255 << 24) | (b << 16) | (g << 8) | r));
const hex = i => '#' + PALETTE[i].map(v => v.toString(16).padStart(2, '0')).join('');
const MAX_ANT_C = 16, MAX_TUR_C = 8, MAX_S = 4;


// ---------- rule helpers ----------
const clone = r => ({ S: r.S, C: r.C, tab: r.tab.map(st => st.map(e => ({ ...e }))) });
const isAnt = r => r.S === 1 && r.tab[0].every((e, i) => e.w === (i + 1) % r.C && e.n === 0);
const antOf = letters => parseRule(letters);
function toText(r) {
  if (isAnt(r)) return r.tab[0].map(e => TURN[e.t]).join('');
  return '{' + r.tab.map(st => '{' + st.map(e => `{${e.w},${1 << e.t},${e.n}}`).join(',') + '}').join(',') + '}';
}
function fromText(text) {
  text = text.replace(/\s+/g, '').toUpperCase();
  if (!text) throw new Error('규칙이 비어 있어요.');
  if (text[0] !== '{') {
    if (!/^[LRNU]+$/.test(text)) throw new Error('개미 규칙은 L, R, N, U 글자만 쓸 수 있어요.');
    if (text.length < 2 || text.length > MAX_ANT_C) throw new Error(`개미 규칙은 2~${MAX_ANT_C}글자예요.`);
    return antOf(text);
  }
  const r = parseRule(text);
  const okTurn = r.tab.every(st => st.every(e => e.t !== undefined));
  if (!okTurn) throw new Error('회전 값은 1(직진), 2(오른쪽), 4(유턴), 8(왼쪽)만 돼요.');
  if (r.S < 1 || r.S > MAX_S) throw new Error(`기분은 1~${MAX_S}개까지예요.`);
  if (r.C < 2 || r.C > 16 || r.tab.some(st => st.length !== r.C)) throw new Error('기분마다 색 개수(2~16)가 같아야 해요.');
  if (r.tab.some(st => st.some(e => e.w >= r.C || e.n >= r.S))) throw new Error('없는 색이나 없는 기분을 가리키는 칸이 있어요.');
  return r;
}

// ---------- simulation (engine.js semantics, plus a 1-byte-per-step log for period detection) ----------
const G = 4096, LOG = 1 << 21, MASK = LOG - 1;
const grid = new Uint8Array(G * G), log = new Uint8Array(LOG);
const rev = new Uint8Array(LOG), pi = new Int32Array(LOG);
const ant = { lut: new Uint8Array(64) };

function load(r) {
  ant.lut.fill(0);
  for (let s = 0; s < r.S; s++) for (let c = 0; c < r.C; c++) { const e = r.tab[s][c]; ant.lut[s * 16 + c] = e.w | (e.t << 4) | (e.n << 6); }
  grid.fill(0);
  Object.assign(ant, { x: G >> 1, y: G >> 1, dir: 0, s: 0, t: 0, dead: false, xmin: G >> 1, xmax: G >> 1, ymin: G >> 1, ymax: G >> 1 });
  samples = []; verdict = { kind: 'wander' }; lastCheck = 0; everPeriodic = false;
}
function run(n) {
  const lut = ant.lut;
  let { x, y, dir, s, t, xmin, xmax, ymin, ymax } = ant;
  const end = t + n;
  while (t < end) {
    const i = y * G + x, c = grid[i], e = lut[s * 16 + c];
    grid[i] = e & 15;
    dir = (dir + ((e >> 4) & 3)) & 3;
    log[t & MASK] = c | (s << 4) | (dir << 6);
    s = e >> 6;
    x += DX[dir]; y += DY[dir]; t++;
    if (x < xmin) xmin = x; else if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; else if (y > ymax) ymax = y;
    if (x <= 1 || y <= 1 || x >= G - 2 || y >= G - 2) { ant.dead = true; break; }
  }
  Object.assign(ant, { x, y, dir, s, t, xmin, xmax, ymin, ymax });
}

// Longest periodic tail of the log: read it backwards, prefix function, largest m with ≥ 6 repeats of period p.
function findPeriod() {
  const L = Math.min(ant.t, LOG);
  if (L < 2000) return null;
  for (let k = 0; k < L; k++) rev[k] = log[(ant.t - 1 - k) & MASK];
  pi[0] = 0;
  for (let i = 1, k = 0; i < L; i++) {
    while (k > 0 && rev[i] !== rev[k]) k = pi[k - 1];
    if (rev[i] === rev[k]) k++;
    pi[i] = k;
  }
  for (let m = L; m >= 2000; m--) {
    const p = m - pi[m - 1];
    if (m >= 6 * p) {
      let dx = 0, dy = 0;
      for (let k = 0; k < p; k++) { const d = rev[k] >> 6; dx += DX[d]; dy += DY[d]; }
      return { m, p, dx, dy, onset: ant.t - m, atLeast: m === L && ant.t > LOG };
    }
  }
  return null;
}


// ---------- verdict ----------
let samples = [], verdict = { kind: 'wander' }, lastCheck = 0, everPeriodic = false;
function check() {
  const w = ant.xmax - ant.xmin + 1, h = ant.ymax - ant.ymin + 1;
  samples.push([ant.t, w * h]);
  const per = findPeriod();
  if (per && (per.dx || per.dy)) { everPeriodic = true; verdict = { kind: 'highway', ...per, sure: ant.dead }; }
  else if (per) { everPeriodic = true; verdict = { kind: 'cycle', ...per, sure: per.m >= 50 * per.p && per.m >= 20000 }; }
  else {
    const half = samples.filter(s => s[0] <= ant.t / 2).pop();
    if (ant.t >= 100000 && half && half[1] === w * h) verdict = { kind: 'stalled', since: half[0], w, h };
    else verdict = { kind: ant.dead ? 'edge' : 'wander', broke: everPeriodic };
  }
  showStatus();
  maybeFinish();
}

// ---------- words ----------
const COLOR_KO = ['검정', '노랑', '파랑', '빨강', '초록', '보라', '주황', '청록', '분홍', '회색', '갈색', '남색', '연두', '자홍', '남보라', '크림'];
const TURN_PHRASE = { L: '⬅️ 왼쪽으로 돌기', R: '➡️ 오른쪽으로 돌기', N: '⬆️ 그대로 가기', U: '⬇️ 뒤로 돌기' };
const TURN_SHORT = { L: '왼쪽으로 돌고', R: '오른쪽으로 돌고', N: '그대로 가고', U: '뒤로 돌고' };
const ro = w => { const ch = w.charCodeAt(w.length - 1); if (ch < 0xAC00 || ch > 0xD7A3) return '(으)로'; const j = (ch - 0xAC00) % 28; return j === 0 || j === 8 ? '로' : '으로'; };
const swatch = c => `<i class="sw" style="background:${hex(c)}"></i>`;
const MAX_BLOCK_C = 8;

// ---------- blocks ----------
let rule = antOf('RL');
function renderBlocks() {
  const multi = rule.S > 1;
  let ifs = '';
  for (let s = 0; s < rule.S; s++) for (let c = 0; c < rule.C; c++) {
    const e = rule.tab[s][c], t = TURN[e.t];
    ifs += `<div class="cw ifb" data-s="${s}" data-c="${c}">
      <div class="ch">만약 ${multi ? `<span class="sense">기분이 <span class="pick lock">${STATE[s]}</span></span> 이고` : ''}
        <span class="sense">발밑 색이 <span class="pick lock">${swatch(c)}${COLOR_KO[c]}</span></span> 이면</div>
      <div class="cb">
        <div class="blk motion"><button class="pick" data-k="t" data-s="${s}" data-c="${c}">${TURN_PHRASE[t]}</button></div>
        <div class="blk pen">칸을 <button class="pick" data-k="w" data-s="${s}" data-c="${c}">${swatch(e.w)}${COLOR_KO[e.w]}</button>${ro(COLOR_KO[e.w])} 칠하기</div>
        ${multi ? `<div class="blk var">기분을 <button class="pick" data-k="n" data-s="${s}" data-c="${c}">${STATE[e.n]}</button>로 바꾸기</div>` : ''}
        <div class="blk motion fixed">한 칸 앞으로 가기</div>
      </div><div class="cf"></div></div>`;
  }
  $('#code').innerHTML = `<div class="script"><div class="blk hat">🏁 출발을 누르면</div>
    <div class="cw loop"><div class="ch">🔁 계속 반복하기</div><div class="cb">${ifs}</div><div class="cf">↺</div></div></div>`;
  $('#c-add').disabled = rule.C >= MAX_BLOCK_C; $('#c-del').disabled = rule.C <= 2;
  $('#s-del').hidden = rule.S <= 1; $('#s-add').textContent = rule.S > 1 ? '+ 기분 추가' : '+ 기분 추가 (고급)';
  $('#codehint').textContent = `색 ${rule.C}개${multi ? ` · 기분 ${rule.S}개` : ''} · 블록 ${rule.S * rule.C}개`;
  highlightRun();
}

// picker popover
const picker = $('#picker');
let pickFor = null;
$('#code').addEventListener('click', e => {
  const b = e.target.closest('.pick:not(.lock)'); if (!b) return;
  e.stopPropagation();
  const s = +b.dataset.s, c = +b.dataset.c, k = b.dataset.k, cur = rule.tab[s][c];
  pickFor = { s, c, k };
  let opts;
  if (k === 't') opts = 'LRNU'.split('').map(t => [TURN.indexOf(t), TURN_PHRASE[t], TURN.indexOf(t) === cur.t]);
  else if (k === 'w') opts = Array.from({ length: rule.C }, (_, i) => [i, swatch(i) + COLOR_KO[i], i === cur.w]);
  else opts = Array.from({ length: rule.S }, (_, i) => [i, '기분 ' + STATE[i], i === cur.n]);
  picker.innerHTML = opts.map(([v, label, on]) => `<button data-v="${v}" class="${on ? 'cur' : ''}">${label}</button>`).join('')
    + (k === 'w' && rule.C < MAX_BLOCK_C ? `<div class="pnote">다른 색을 쓰려면 아래 <b>+ 색 블록 추가</b>를 누르세요.</div>` : '')
    + (k === 'n' ? `<div class="pnote">다음 걸음부터 이 기분의 블록을 따라요.</div>` : '');
  picker.hidden = false;
  const r = b.getBoundingClientRect();
  picker.style.left = Math.max(8, Math.min(r.left + scrollX, scrollX + innerWidth - picker.offsetWidth - 8)) + 'px';
  picker.style.top = (r.bottom + scrollY + 6) + 'px';
});
picker.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || !pickFor) return;
  const r = clone(rule), cell = r.tab[pickFor.s][pickFor.c], v = +b.dataset.v;
  if (pickFor.k === 't') cell.t = v; else if (pickFor.k === 'w') cell.w = v; else cell.n = v;
  picker.hidden = true; pickFor = null;
  edited(); setRule(r);
});
document.addEventListener('click', e => { if (!picker.hidden && !picker.contains(e.target)) { picker.hidden = true; pickFor = null; } });

function resize(S, C) {
  const r = { S, C, tab: [] };
  for (let s = 0; s < S; s++) {
    r.tab.push([]);
    for (let c = 0; c < C; c++) {
      const old = rule.tab[s]?.[c];
      r.tab[s].push(old ? { w: old.w % C, t: old.t, n: old.n % S } : { w: (c + 1) % C, t: 1, n: s });
    }
  }
  return r;
}
$('#c-add').onclick = () => {
  if (rule.C >= MAX_BLOCK_C) return;
  edited();
  if (isAnt(rule)) setRule(antOf(toText(rule) + 'L'));
  else { const r = resize(rule.S, rule.C + 1); setRule(r); }
  toast(`${COLOR_KO[rule.C - 1]} 블록이 생겼어요`);
};
$('#c-del').onclick = () => {
  if (rule.C <= 2) return;
  edited();
  setRule(isAnt(rule) ? antOf(toText(rule).slice(0, -1)) : resize(rule.S, rule.C - 1));
};
$('#s-add').onclick = () => {
  if (rule.S >= MAX_S) return toast(`기분은 ${MAX_S}개까지예요`);
  edited(); setRule(resize(rule.S + 1, rule.C));
  toast(`기분 ${STATE[rule.S - 1]}가 생겼어요. '기분을 바꾸기' 블록에서 골라야 개미가 그 기분이 돼요`);
};
$('#s-del').onclick = () => { if (rule.S > 1) { edited(); setRule(resize(rule.S - 1, rule.C)); } };

// ---------- stage ----------
const cv = $('#cv'), ctx = cv.getContext('2d'), W = cv.width;
const img = ctx.createImageData(W, W), px = new Uint32Array(img.data.buffer), col = new Int32Array(W);
let paintedT = -1;
function paint() {
  if (ant.t === paintedT) return;
  paintedT = ant.t;
  const bw = ant.xmax - ant.xmin + 5, bh = ant.ymax - ant.ymin + 5;
  const w = Math.max(bw, bh, 24), x0 = ant.xmin - 2 - ((w - bw) >> 1), y0 = ant.ymin - 2 - ((w - bh) >> 1);
  const sc = w / W, bg = PAL32[0];
  for (let X = 0; X < W; X++) { const gx = x0 + Math.floor((X + 0.5) * sc); col[X] = gx >= 0 && gx < G ? gx : -1; }
  for (let Y = 0; Y < W; Y++) {
    const gy = y0 + Math.floor((Y + 0.5) * sc), o = Y * W;
    if (gy < 0 || gy >= G) { px.fill(bg, o, o + W); continue; }
    const row = gy * G;
    for (let X = 0; X < W; X++) { const gx = col[X]; px[o + X] = gx < 0 ? bg : PAL32[grid[row + gx]]; }
  }
  ctx.putImageData(img, 0, 0);
  const k = W / w, ax = (ant.x - x0 + 0.5) * k, ay = (ant.y - y0 + 0.5) * k, rr = Math.max(5, k * 0.42);
  if (k >= 10) {   // big cells: faint grid + an arrow showing where the ant faces
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i <= w; i++) { ctx.moveTo(i * k, 0); ctx.lineTo(i * k, W); ctx.moveTo(0, i * k); ctx.lineTo(W, i * k); }
    ctx.stroke();
  }
  ctx.fillStyle = '#ff3355';
  ctx.beginPath(); ctx.arc(ax, ay, rr, 0, 7); ctx.fill();
  if (k >= 10) {
    const dx = DX[ant.dir], dy = DY[ant.dir];
    ctx.beginPath(); ctx.moveTo(ax + dx * rr * 1.9, ay + dy * rr * 1.9);
    ctx.lineTo(ax - dy * rr * 0.8 + dx * rr * 0.9, ay + dx * rr * 0.8 + dy * rr * 0.9);
    ctx.lineTo(ax + dy * rr * 0.8 + dx * rr * 0.9, ay - dx * rr * 0.8 + dy * rr * 0.9); ctx.fill();
  }
  $('#st-t').textContent = fmt(ant.t);
}
// the block that will run next = (mood, colour under the ant)
function highlightRun(on = phase !== 'running' || slowNow) {
  document.querySelectorAll('.ifb.run').forEach(el => el.classList.remove('run'));
  if (!on || ant.dead) return;
  const c = grid[ant.y * G + ant.x];
  document.querySelector(`.ifb[data-s="${ant.s}"][data-c="${c}"]`)?.classList.add('run');
}
function stepOnce() {
  const c = grid[ant.y * G + ant.x], s = ant.s, e = rule.tab[s]?.[c];
  run(1);
  if (e) $('#steplog').innerHTML = `${fmt(ant.t)}걸음째: ${rule.S > 1 ? `기분 ${STATE[s]}, ` : ''}발밑이 ${swatch(c)}${COLOR_KO[c]} → ${TURN_SHORT[TURN[e.t]]}, ${swatch(e.w)}${COLOR_KO[e.w]}${ro(COLOR_KO[e.w])} 칠하고${rule.S > 1 ? ` 기분 ${STATE[e.n]}가 되고` : ''}, 한 칸 앞으로`;
}

// phases: ready (press 🏁) → running ⇄ paused → done (result shown)
// speeds as in the earlier version: steps per frame (보통 keeps the slow, glowing first steps)
const SPEEDS = [100, 20000, 2000000];
let phase = 'ready', speedIdx = 0, slowNow = false, slowTick = 0, finished = false;
function setSpeed(i) {
  speedIdx = i;
  document.querySelectorAll('#speeds button').forEach((b, j) => b.classList.toggle('on', j === i));
}
function setPhase(p) {
  phase = p;
  $('#play').textContent = p === 'paused' ? '▶ 계속' : '⏸ 멈춤';
  $('#play').disabled = p === 'ready' || p === 'done';
  $('#flag').textContent = p === 'ready' ? '🏁 출발' : '🏁 처음부터';
  $('#flag').classList.toggle('go', p === 'ready');
  document.querySelectorAll('#steps li').forEach(li => li.classList.toggle('on', li.dataset.p === (finished ? 'done' : p === 'paused' ? 'running' : p)));
  showStatus();
}
function start() {
  load(rule); paintedT = -1; finished = false; resultKind = null; slowTick = 0;
  $('#result').hidden = true; $('#steplog').innerHTML = '';
  setPhase('running');
  if (innerWidth <= 860) $('#stagecard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function stepsThisFrame() {
  if (speedIdx > 0) return SPEEDS[speedIdx];
  const t = ant.t;
  if (t < 30) { slowTick = (slowTick + 1) % 8; return slowTick === 0 ? 1 : 0; }   // first steps: slow enough to read the glowing block
  if (t < 400) return 2;
  return SPEEDS[0];
}
function frame(now) {
  if (phase === 'running' && !ant.dead) {
    const n = stepsThisFrame();
    slowNow = n <= 1 && speedIdx === 0 && ant.t < 30;
    if (n === 1) stepOnce(); else if (n) { run(n); if (ant.t > 30) $('#steplog').innerHTML = ''; }
    if (n) highlightRun();
    if (ant.dead || now - lastCheck > 400) { lastCheck = now; check(); }
    if (ant.dead && phase === 'running') setPhase('done');   // only the grid edge stops the ant
  }
  paint();
  requestAnimationFrame(frame);
}
$('#flag').onclick = start;
$('#play').onclick = () => { if (phase === 'running') setPhase('paused'); else if (phase === 'paused') setPhase('running'); highlightRun(); };
$('#step').onclick = () => {
  if (phase === 'done' || ant.dead) return;
  if (phase === 'running') setPhase('paused');
  if (phase === 'ready') { load(rule); paintedT = -1; $('#result').hidden = true; setPhase('paused'); }
  stepOnce(); highlightRun(true); if (ant.t % 50 === 0 || ant.dead) check(); else showStatus();
};
$('#speeds').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  setSpeed(+b.dataset.i);
  if (phase === 'ready' || phase === 'done') start(); else if (phase === 'paused') setPhase('running');
};

function showStatus() {
  const v = verdict;
  let icon, text;
  if (phase === 'ready') { icon = '🏁'; text = hasEdited || !firstVisit ? '<b>🏁 출발</b>을 누르면 이 코드대로 개미가 걸어요.' : '먼저 <b>🏁 출발</b>을 눌러 보세요. 그다음 블록의 하얀 칸 ▾을 바꿔 보세요.'; }
  else if (phase === 'done') { icon = '🧱'; text = '격자 끝(4096칸)에 닿아서 멈췄어요.'; }
  else if (v.kind === 'highway') { icon = '🛣️'; text = '고속도로가 생기는 것 같아요! 끝까지 가 보는 중…'; }
  else if (v.kind === 'stalled') { icon = '🐢'; text = '거의 안 커지는 중… 200만 걸음까지 지켜봐요.'; }
  else if (v.kind === 'cycle') { icon = '🌀'; text = '같은 자리를 맴도는 것 같아요…'; }
  else if (ant.t < 30) { icon = '👀'; text = '빛나는 블록이 지금 개미가 따르는 규칙이에요.'; }
  else { icon = '🚶'; text = v.broke ? '고속도로가 깨졌어요! 다시 헤매는 중…' : ant.t > 2e6 && speedIdx < 2 ? '오래 헤매네요. <b>🚀 초고속</b>을 눌러 보세요.' : '헤매는 중…'; }
  if (finished && phase === 'running') text += ' <small>(결과는 아래에, 개미는 계속 걸어요)</small>';
  if (phase === 'paused') { icon = '⏸'; text = '멈춤. <b>👣 한 걸음</b>으로 한 칸씩 볼 수 있어요.'; }
  $('#s-icon').textContent = icon; $('#s-text').innerHTML = text;
}

// ---------- result ----------
function maybeFinish() {
  const v = verdict;
  let kind = null;
  if (v.kind === 'highway' && v.sure) kind = 'highway';
  else if (v.kind === 'cycle' && v.sure) kind = 'cycle';
  else if (v.kind === 'stalled' && ant.t >= 2e6) kind = 'stalled';
  else if (v.kind === 'edge') kind = 'edge';
  else if (v.kind === 'wander' && ant.t >= 5e7) kind = 'endless';
  if (kind && kind !== resultKind) finish(kind);   // the ant keeps walking; a later, different outcome replaces the result
}
let resultKind = null;
function finish(kind) {
  finished = true; resultKind = kind;
  setPhase(ant.dead ? 'done' : phase);
  const v = verdict, best = bestOnset();
  let title, text;
  if (kind === 'highway') {
    title = '🛣️ 고속도로를 냈어요!';
    text = `<b>${v.atLeast ? '최소 ' : ''}${fmt(v.onset)}걸음</b> 헤매다가, ${fmt(v.p)}걸음짜리 동작을 끝없이 되풀이하며 한쪽으로 길을 냈어요. `
      + (v.onset > 9977 ? `랭턴 개미보다 <b>${(v.onset / 9977).toFixed(v.onset > 99770 ? 0 : 1)}배</b> 오래 헤맸어요!` : v.onset === 9977 && toText(rule) === 'RL' ? '바로 그 유명한 랭턴 개미예요.' : '랭턴 개미(9,977걸음)보다 빨리 길을 찾았어요.')
      + (v.onset > best ? ' 🏆 <b>내 최고 기록이에요!</b>' : '');
  } else if (kind === 'cycle') { title = '🌀 덫에 걸렸어요'; text = `${fmt(v.onset)}걸음부터 ${fmt(v.p)}걸음짜리 고리를 같은 자리에서 영원히 돌아요.`; }
  else if (kind === 'stalled') { title = '🐢 거의 안 커져요'; text = `200만 걸음을 걸어도 ${v.w}×${v.h}칸 안에서만 맴돌아요.`; }
  else if (kind === 'edge') { title = '🧱 너무 빨리 퍼졌어요'; text = '같은 동작의 반복을 찾기 전에 격자 끝(4096칸)에 닿았어요.'; }
  else { title = '🚶 5천만 걸음째 계속 헤매요'; text = '끝없이 헤매는 개미일 수도 있어요. 유명한 RLR 개미도 끝이 있는지 아직 아무도 몰라요.'; }
  $('#r-title').className = 'rtitle ' + kind; $('#r-title').textContent = title; $('#r-text').innerHTML = text;
  const pct = n => Math.max(3, Math.min(100, (Math.log10(Math.max(n, 1000)) - 3) / 5 * 100));
  const bar = (name, n, me) => `<div class="bar ${me ? 'me' : ''}"><span>${name}</span><div class="tr"><div class="fill" style="width:${pct(n)}%"></div><span>${fmt(n)}걸음</span></div></div>`;
  $('#cmp').innerHTML = kind === 'highway'
    ? `<div class="hint" style="margin:0">고속도로가 생기기 전까지 헤맨 걸음</div>${bar('랭턴 개미', 9977)}${bar('내 개미', v.onset, true)}${bestOf() ? bar('내 최고 기록', bestOf().onset) : ''}${bar('갤러리 최고', 14973493)}` : '';
  const record = kind === 'highway' && v.onset > best;
  $('#save').classList.toggle('go', record); $('#mutate').classList.toggle('go', !record);
  if (!hasEdited) { $('#code').classList.add('go-edit'); $('#r-text').innerHTML += '<br><b>이제 ① 코드의 하얀 칸 ▾을 눌러 방향이나 색을 바꿔 보세요.</b>'; }
  $('#result').hidden = false;
}

// ---------- rule changes ----------
let hasEdited = false;
const FKEY = 'turmite-make-visited-v2';
let firstVisit = (() => { try { return localStorage.getItem(FKEY) !== '1'; } catch { return true; } })();
function edited() { hasEdited = true; $('#code').classList.remove('go-edit'); if (firstVisit) { firstVisit = false; try { localStorage.setItem(FKEY, '1'); } catch {} } }
function setRule(r, { fromInput = false, autostart = false } = {}) {
  rule = r;
  if (!fromInput) $('#ruletext').value = toText(r);
  $('#err').textContent = '';
  try { history.replaceState(null, '', '#r=' + encodeURIComponent(toText(r))); } catch {}
  load(r); paintedT = -1; finished = false; resultKind = null; $('#result').hidden = true; $('#steplog').innerHTML = '';
  renderBlocks();
  if (autostart) start(); else setPhase('ready');
  highlightRun();
}
const rnd = n => Math.floor(Math.random() * n);
function randomAnt() {
  let s;
  do { s = Array.from({ length: 2 + rnd(5) }, () => 'LR'[rnd(2)]).join(''); } while (new Set(s).size < 2);
  return antOf(s);
}
$('#dice').onclick = () => { edited(); setRule(randomAnt()); toast('새 개미를 만들었어요. 🏁 출발을 눌러 보세요'); };
$('#dice2').onclick = () => { edited(); setRule(randomAnt(), { autostart: true }); };
$('#mutate').onclick = () => {
  const r = clone(rule), s = rnd(r.S), c = rnd(r.C), e = r.tab[s][c];
  let what;
  if (r.C > 2 && Math.random() < 0.25) { e.w = (e.w + 1 + rnd(r.C - 1)) % r.C; what = `칸을 ${COLOR_KO[e.w]}${ro(COLOR_KO[e.w])} 칠하기`; }
  else { const opts = [3, 1].filter(t => t !== e.t); e.t = opts[rnd(opts.length)]; what = TURN_PHRASE[TURN[e.t]]; }
  edited(); setRule(r, { autostart: true });
  toast(`'${COLOR_KO[c]}' 블록을 바꿨어요 → ${what}`);
};
$('#ruletext').oninput = e => {
  try {
    const r = fromText(e.target.value);
    if (r.C > MAX_BLOCK_C && !isAnt(r)) throw new Error(`블록으로는 색 ${MAX_BLOCK_C}개까지 보여 줄 수 있어요.`);
    edited(); setRule(r, { fromInput: true });
  } catch (err) { $('#err').textContent = err.message; }
};
$('#copy').onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); toast('링크를 복사했어요. 이 링크를 열면 같은 개미가 나와요'); }
  catch { toast('복사하지 못했어요. 주소창의 주소를 쓰세요'); }
};

// presets
const PRESETS = [
  ['랭턴 개미', 'RL'], ['끝없는 혼돈', 'RLR'], ['좌우 대칭', 'LLRR'], ['정사각형 채우기', 'LRRRRRLLR'],
  ['꼬불꼬불 고속도로', 'LLRRRLRLRLLR'], ['1,500만 걸음 헤매기 (갤러리 최고 기록)', 'LRRLRLLLR'],
  ['피보나치 나선 (기분 2개)', '{{{1,8,1},{1,8,1}},{{1,2,1},{0,1,0}}}'],
  ['113만 걸음 뒤 덫 (기분 2개)', '{{{1,2,0},{1,1,1}},{{1,2,0},{0,8,0}}}'],
];
$('#presets').innerHTML = PRESETS.map(([name], i) => `<button class="btn" data-i="${i}">${name}</button>`).join('');
$('#presets').onclick = e => { const b = e.target.closest('button'); if (!b) return; edited(); openText(PRESETS[+b.dataset.i][1]); window.scrollTo({ top: 0, behavior: 'smooth' }); };
function openText(text, opts) { setRule(fromText(text), opts); }

// saved rules + best record (per-browser convenience only)
const KEY = 'turmite-make-saved-v1';
function readSaved() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
const writeSaved = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} };
const KIND_KO = { highway: '고속도로', cycle: '덫', stalled: '거의 안 커짐', wander: '헤매는 중', endless: '계속 헤맴', edge: '끝에 닿음' };
const bestOf = () => readSaved().filter(s => s.kind === 'highway' && s.onset != null).sort((a, b) => b.onset - a.onset)[0];
const bestOnset = () => bestOf()?.onset ?? 9977;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderSaved() {
  const list = readSaved(), best = bestOf();
  $('#sv-empty').hidden = list.length > 0; $('#sv-count').textContent = list.length ? `(${list.length})` : '';
  $('#saved').innerHTML = list.map((s, i) => `<span class="sv"><button class="nm" data-i="${i}" title="${esc(s.rule)}">${esc(s.name)}</button>
    <span class="b ${s.kind}">${KIND_KO[s.kind] || ''}${s.onset != null ? ' · ' + fmt(s.onset) + '걸음' : ''}</span><button class="x" data-x="${i}" title="지우기" aria-label="지우기">✕</button></span>`).join('');
  $('#record').innerHTML = best ? `🏆 내 최고 기록: <b>${esc(best.name)}</b> — ${fmt(best.onset)}걸음 헤맨 뒤 고속도로` : '🏆 아직 기록이 없어요. 랭턴 개미(9,977걸음)보다 오래 헤매는 개미를 만들어 보세요.';
}
$('#saved').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const list = readSaved();
  if (b.dataset.x != null) { list.splice(+b.dataset.x, 1); writeSaved(list); renderSaved(); }
  else { openText(list[+b.dataset.i].rule); window.scrollTo({ top: 0, behavior: 'smooth' }); }
};
$('#save').onclick = () => {
  const text = toText(rule), list = readSaved().filter(s => s.rule !== text);
  const name = text.length > 16 ? '기분 개미 ' + (list.filter(s => s.rule.length > 16).length + 1) : text;
  const v = verdict, entry = { name, rule: text, kind: resultKind || (v.kind === 'highway' ? 'wander' : v.kind) };
  if (resultKind === 'highway') entry.onset = v.onset;
  const record = entry.onset != null && entry.onset > bestOnset();
  list.unshift(entry); writeSaved(list.slice(0, 40)); renderSaved();
  $('#save').classList.remove('go'); $('#mutate').classList.add('go');
  toast(record ? '🏆 새 기록으로 저장했어요!' : '저장했어요. 아래 🏆 내 개미 모음에 있어요');
};

let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); }
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); $('#play').click(); }
});

// start: rule from the link (#r=...) runs at once; otherwise Langton's ant waits for 🏁
function fromHash() {
  const m = location.hash.match(/^#r=(.+)$/);
  if (!m) return false;
  try { openText(decodeURIComponent(m[1]), { autostart: true }); return true; } catch (err) { $('#err').textContent = err.message; return false; }
}
renderSaved();
if (!fromHash()) setRule(antOf('RL'));
window.addEventListener('hashchange', () => { if (location.hash.slice(3) !== encodeURIComponent(toText(rule))) fromHash(); });
// mobile: the stage is below the code, so keep a 🏁 bar on screen while the stage is out of view
new IntersectionObserver(es => { $('#mbar').hidden = es[0].isIntersecting; }, { threshold: 0.25 }).observe($('#stagecard'));
$('#mflag').onclick = () => { if (phase === 'ready' || phase === 'done') start(); else $('#stagecard').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
window.make = { run, check, openText, start, get ant() { return ant; }, get verdict() { return verdict; }, get phase() { return phase; }, get rule() { return rule; } };   // for headless tests
requestAnimationFrame(frame);

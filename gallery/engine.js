// Turmite engine — same semantics as src/tsim.c (start heading north, state 0, colour 0 grid).
// Turn codes: N=0, R=+1, U=+2, L=+3 (quarter turns clockwise).
export const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

export function parseRule(text) {
  if (text[0] !== '{') {
    const n = text.length, tab = [];
    for (let i = 0; i < n; i++) tab.push({ w: (i + 1) % n, t: 'NRUL'.indexOf(text[i]), n: 0 });
    return { S: 1, C: n, tab: [tab] };
  }
  const code = { 1: 0, 2: 1, 4: 2, 8: 3 };
  const states = [];
  // split into states: {{{a,b,c},{...}},{{...}}}
  const inner = text.slice(1, -1);
  let depth = 0, cur = '';
  for (const ch of inner) {
    if (ch === '{') depth++;
    if (depth > 0) cur += ch;
    if (ch === '}') { depth--; if (depth === 0) { states.push(cur); cur = ''; } }
  }
  const tab = states.map(st => [...st.matchAll(/\{(\d+),(\d+),(\d+)\}/g)]
    .map(m => ({ w: +m[1], t: code[+m[2]], n: +m[3] })));
  return { S: tab.length, C: tab[0].length, tab };
}

export class Ant {
  constructor(rule, G = 2048) {
    this.rule = typeof rule === 'string' ? parseRule(rule) : rule;
    this.G = G;
    this.grid = new Uint8Array(G * G);
    const { S, C, tab } = this.rule;
    // flat lookup: index s*16+c -> packed (w | t<<4 | n<<6)
    this.lut = new Uint8Array(4 * 16);
    for (let s = 0; s < S; s++) for (let c = 0; c < C; c++) {
      const e = tab[s][c]; this.lut[s * 16 + c] = e.w | (e.t << 4) | (e.n << 6);
    }
    this.reset();
  }
  reset() {
    const G = this.G;
    this.grid.fill(0);
    this.x = this.y = G >> 1; this.dir = 0; this.s = 0; this.t = 0; this.dead = false;
    this.xmin = this.xmax = this.x; this.ymin = this.ymax = this.y;
  }
  // Runs n steps; calls onWrite(index, colour) per write if given (for incremental drawing).
  run(n, onWrite) {
    const G = this.G, grid = this.grid, lut = this.lut;
    let { x, y, dir, s, t, xmin, xmax, ymin, ymax } = this;
    const end = t + n;
    while (t < end) {
      const i = y * G + x, e = lut[s * 16 + grid[i]], w = e & 15;
      grid[i] = w;
      if (onWrite) onWrite(i, w);
      dir = (dir + ((e >> 4) & 3)) & 3; s = e >> 6;
      x += DX[dir]; y += DY[dir]; t++;
      if (x < xmin) xmin = x; else if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; else if (y > ymax) ymax = y;
      if (x <= 1 || y <= 1 || x >= G - 2 || y >= G - 2) { this.dead = true; break; }
    }
    Object.assign(this, { x, y, dir, s, t, xmin, xmax, ymin, ymax });
  }
}

// Shared palette (also used by build.py for thumbnails): colour 0 = background.
export const PALETTE = [
  [14, 16, 22], [242, 196, 92], [96, 178, 232], [232, 98, 98], [130, 210, 140], [190, 140, 230],
  [250, 140, 60], [80, 220, 210], [240, 120, 190], [200, 200, 210], [150, 120, 70], [70, 120, 200],
  [180, 230, 80], [230, 70, 140], [110, 90, 200], [255, 240, 180],
];

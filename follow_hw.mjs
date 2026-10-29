// Follow a highway from its onset to the 8192² grid edge with gallery/engine.js; every period must repeat
// the same (dir, state) and displacement. Prints one JSON line per rule given as "rule onset period" on stdin.
import { Ant } from './gallery/engine.js';
import { createInterface } from 'readline';
for await (const line of createInterface({ input: process.stdin })) {
  const [rule, onset, period] = line.trim().split(/\s+/); if (!rule) continue;
  const a = new Ant(rule, 8192), p = +period;
  a.run(+onset);
  let d0 = null, n = 0, ok = true;
  while (!a.dead && n < 1e6) {
    const [x, y, dir, s] = [a.x, a.y, a.dir, a.s];
    a.run(p); if (a.dead) break;
    const d = [a.x - x, a.y - y];
    if (a.dir !== dir || a.s !== s || (d0 && (d[0] !== d0[0] || d[1] !== d0[1]))) { ok = false; break; }
    d0 = d0 || d; n++;
  }
  console.log(JSON.stringify({ rule, onset: +onset, period: p, periods: n, drift: d0, reached_edge: a.dead, confirmed: ok && a.dead, t: a.t }));
}

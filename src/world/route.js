// Road graph (crossings of interstates / highways / gravel grid) + A* routing. No three.js.
import { RGX, RGZ } from './sampler.js';
const COST = [1, 1.15, 1.6, 1.5];
export function makeRouter(s) {
  const D = s.data, roads = D.roads, seg = D.seg, S = seg.S, off = D.segIdx.off, ref = D.segIdx.ref;
  const nodes = [], nodeAt = new Map(), roadNodes = roads.map(() => []);
  const addNode = (x, z) => { const key = Math.round(x / 6) + ',' + Math.round(z / 6); let n = nodeAt.get(key); if (n === undefined) { n = nodes.length; nodes.push({ x, z, e: [] }); nodeAt.set(key, n); } return n; };
  const attach = (r, sv, n) => { roadNodes[r].push([sv, n]); };
  for (const r of roads) { if (r.k === 2) continue; const p = r.pts, m = p.length / 2; attach(r.id, 0, addNode(p[0], p[1])); attach(r.id, r.len, addNode(p[m * 2 - 2], p[m * 2 - 1])); }
  // segment crossings
  for (let c = 0; c < RGX * RGZ; c++) {
    const a0 = off[c], a1 = off[c + 1]; if (a1 - a0 < 2) continue;
    for (let i = a0; i < a1; i++) { const si = ref[i], ri = seg.R[si]; if (roads[ri].k === 2) continue; for (let j = i + 1; j < a1; j++) {
      const sj = ref[j], rj = seg.R[sj]; if (rj === ri || roads[rj].k === 2) continue; const ax = S[si * 6], az = S[si * 6 + 1], bx = S[si * 6 + 2], bz = S[si * 6 + 3], cx = S[sj * 6], cz = S[sj * 6 + 1], dx = S[sj * 6 + 2], dz = S[sj * 6 + 3];
      const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx); if (Math.abs(den) < 1e-9) continue; const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den; if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t; if (Math.floor((x + 51200) / 128) + Math.floor((z + 32768) / 128) * RGX !== c) continue; const n = addNode(x, z), Ri = roads[ri], Rj = roads[rj];
      attach(ri, Ri.s[seg.I[si]] + Math.hypot(bx - ax, bz - az) * t, n); attach(rj, Rj.s[seg.I[sj]] + Math.hypot(dx - cx, dz - cz) * u, n);
    } }
  }
  // near-miss road ends -> connect to nearest other road
  for (const r of roads) { if (r.k === 2) continue; for (const [sv] of [[0], [r.len]]) { const p = r.pts, m = p.length / 2, x = sv ? p[m * 2 - 2] : p[0], z = sv ? p[m * 2 - 1] : p[1]; const nn = s.nearest(x + .01, z + .01, 3, true); if (nn.road >= 0 && nn.road !== r.id && nn.dist < 400 && nn.dist > 2) { const n = addNode(nn.x, nn.z), a = roadNodes[r.id].find((q) => q[0] === sv)[1]; attach(nn.road, nn.s, n); nodes[a].e.push([n, nn.dist * 2, -1, 0, 0]); nodes[n].e.push([a, nn.dist * 2, -1, 0, 0]); } } }
  for (const r of roads) { const a = roadNodes[r.id]; a.sort((p, q) => p[0] - q[0]); for (let i = 1; i < a.length; i++) { const [s0, n0] = a[i - 1], [s1, n1] = a[i]; if (n0 === n1) continue; const c = (s1 - s0) * COST[r.k]; nodes[n0].e.push([n1, c, r.id, s0, s1]); nodes[n1].e.push([n0, c, r.id, s1, s0]); } }
  // binary heap A*
  function route(x0, z0, x1, z1) {
    const a = { ...s.nearest(x0, z0, 3, true) }, b = { ...s.nearest(x1, z1, 3, true) }; if (a.road < 0 || b.road < 0) return new Float32Array([x0, z0, x1, z1]);
    const N = nodes.length, START = N, END = N + 1, g = new Float64Array(N + 2).fill(Infinity), from = new Int32Array(N + 2).fill(-1), via = new Array(N + 2), done = new Uint8Array(N + 2);
    const bracket = (q) => { const L = roadNodes[q.road]; let lo = null, hi = null; for (const p of L) { if (p[0] <= q.s) lo = p; else if (!hi) hi = p; } return [lo, hi]; };
    const [al, ah] = bracket(a), [bl, bh] = bracket(b), k = COST[roads[a.road].k], kb = COST[roads[b.road].k];
    const extra = new Map(); const ext = (n, e) => { let l = extra.get(n); if (!l) extra.set(n, l = []); l.push(e); };
    if (al) ext(START, [al[1], (a.s - al[0]) * k, a.road, a.s, al[0]]); if (ah) ext(START, [ah[1], (ah[0] - a.s) * k, a.road, a.s, ah[0]]);
    if (bl) ext(bl[1], [END, (b.s - bl[0]) * kb, b.road, bl[0], b.s]); if (bh) ext(bh[1], [END, (bh[0] - b.s) * kb, b.road, bh[0], b.s]);
    if (a.road === b.road) ext(START, [END, Math.abs(b.s - a.s) * k, a.road, a.s, b.s]);
    const pos = (n) => (n === START ? a : n === END ? b : nodes[n]); const h = (n) => { const p = pos(n); return Math.hypot(p.x - b.x, p.z - b.z) * .95; };
    const heap = [], push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } }, pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { const L = i * 2 + 1, R = L + 1; let m = i; if (L < heap.length && heap[L][0] < heap[m][0]) m = L; if (R < heap.length && heap[R][0] < heap[m][0]) m = R; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
    g[START] = 0; push(START, h(START)); let it = 0;
    while (heap.length && it++ < 400000) { const [, n] = pop(); if (done[n]) continue; done[n] = 1; if (n === END) break; const es = n < N ? nodes[n].e : []; const ex = extra.get(n); for (const list of ex ? [es, ex] : [es]) for (const e of list) { const ng = g[n] + e[1]; if (ng < g[e[0]]) { g[e[0]] = ng; from[e[0]] = n; via[e[0]] = e; push(e[0], ng + h(e[0])); } } }
    if (from[END] < 0) return new Float32Array([a.x, a.z, b.x, b.z]);
    const chain = []; for (let n = END; n !== START && n >= 0; n = from[n]) chain.push(via[n]); chain.reverse(); const out = [];
    for (const e of chain) { if (e[2] < 0) { const p = pos(e[0]); out.push(p.x, p.z); continue; } const r = roads[e[2]], s0 = e[3], s1 = e[4], p = r.pts, dir = s1 >= s0 ? 1 : -1; const pt = (sv) => { let i = 0; while (i < r.s.length - 2 && r.s[i + 1] < sv) i++; const f = (sv - r.s[i]) / Math.max(1e-6, r.s[i + 1] - r.s[i]); out.push(p[i * 2] + (p[i * 2 + 2] - p[i * 2]) * f, p[i * 2 + 1] + (p[i * 2 + 3] - p[i * 2 + 1]) * f); };
      pt(s0); if (dir > 0) { for (let i = 0; i < r.s.length; i++) if (r.s[i] > s0 && r.s[i] < s1) out.push(p[i * 2], p[i * 2 + 1]); } else { for (let i = r.s.length - 1; i >= 0; i--) if (r.s[i] < s0 && r.s[i] > s1) out.push(p[i * 2], p[i * 2 + 1]); } pt(s1); }
    return new Float32Array(out);
  }
  return { route, nodes: nodes.length };
}

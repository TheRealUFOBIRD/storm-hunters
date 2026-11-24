// Road quality metrics (no three.js): profile smoothness along every road, road ribbon vs terrain (fine + coarse LOD grids),
// junction coverage. node tools/roadmetrics.mjs [--json]
import { buildWorldData } from '../src/world/build.js';
import { makeSampler } from '../src/world/sampler.js';
import { XS, YS, CROWN } from '../src/world/sampler.js';

export function roadMetrics(data, S, { stride = 1, lods = [1, 4, 8, 16] } = {}) {
  const roads = data.roads, out = { smooth: {}, poke: {}, worst: {} };
  const at = (r, sv, o) => { const p = r.pts, n = p.length / 2; let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.s[m] <= sv) lo = m; else hi = m; } const f = (sv - r.s[lo]) / Math.max(1e-6, r.s[hi] - r.s[lo]); o.x = p[lo * 2] + (p[hi * 2] - p[lo * 2]) * f; o.z = p[lo * 2 + 1] + (p[hi * 2 + 1] - p[lo * 2 + 1]) * f; return o; };
  const o = { x: 0, z: 0 };
  // 1) driven surface smoothness: second derivative of heightAt along the lane centre, 4 m baseline
  for (const r of roads) {
    if (r.id % stride) continue; const K = r.kind, st = out.smooth[K] ||= { n: 0, max: 0, over: 0, grade: 0 }; const lane = r.k === 0 ? 5.6 : r.k === 3 ? 1.4 : 1.9;
    const hs = []; for (let sv = 0; sv <= r.len; sv += 2) { at(r, sv, o); hs.push(S.heightAt(o.x, o.z)); }
    for (let i = 2; i + 2 < hs.length; i++) { const d2 = Math.abs(hs[i + 2] - 2 * hs[i] + hs[i - 2]) / 16, g = Math.abs(hs[i + 1] - hs[i - 1]) / 4; st.n++; if (d2 > .02) st.over++; if (g > st.grade) st.grade = g; if (d2 > st.max) { st.max = d2; at(r, i * 2, o); out.worst['smooth_' + K] = { road: r.id, name: r.name, s: i * 2, x: Math.round(o.x), z: Math.round(o.z) }; } }
    void lane;
  }
  // 2) ribbon vs terrain. Mesh vertex height = lerp(y) - CROWN*min(|u|,hw) + YS; only surface columns (|u| <= hw).
  const tri = (x, z, sp) => { // CDLOD leaf grid interpolation of terrainAt, chunk-aligned grid of spacing sp, diagonal b-c
    const gi = Math.floor(x / sp), gj = Math.floor(z / sp), fx = x / sp - gi, fz = z / sp - gj, x0 = gi * sp, z0 = gj * sp;
    const a = S.terrainAt(x0, z0), b = S.terrainAt(x0 + sp, z0), c = S.terrainAt(x0, z0 + sp), d = S.terrainAt(x0 + sp, z0 + sp);
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  };
  for (const r of roads) {
    if (r.k > 2 || r.id % stride) continue; const p = r.pts, n = p.length / 2, xs = XS[r.k], ys = YS[r.k];
    for (let q = 0; q + 1 < n; q++) {
      if (r.br[q] | r.br[q + 1]) continue;
      const ax = p[q * 2], az = p[q * 2 + 1], bx = p[q * 2 + 2], bz = p[q * 2 + 3], L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
      for (let f = .25; f < 1; f += .5) {
        const x = ax + (bx - ax) * f, z = az + (bz - az) * f, y = r.y[q] + (r.y[q + 1] - r.y[q]) * f;
        for (let c = 0; c < xs.length; c++) {
          const u = xs[c]; if (Math.abs(u) > r.hw + .01) continue; const X = x - tz * u, Z = z + tx * u;
          if (S.otherEdge(X, Z, r.id) < (r.k === 2 ? .15 : -.6)) continue; // fragment discarded: another road owns it
          const my = y - CROWN * Math.min(Math.abs(u), r.hw) + ys[c];
          for (const sp of lods) {
            const key = r.kind + '@' + sp, st = out.poke[key] ||= { n: 0, over5: 0, over20: 0, max: 0 };
            const t = sp === 1 ? S.terrainAt(X, Z) : tri(X, Z, sp); const e = t - my; st.n++;
            if (e > .05) st.over5++; if (e > .2) st.over20++; if (e > st.max) { st.max = e; out.worst['poke_' + key] = { road: r.id, name: r.name, x: Math.round(X), z: Math.round(Z), e: +e.toFixed(2) }; }
          }
        }
      }
    }
  }
  return out;
}

if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const t0 = performance.now(), data = buildWorldData(), S = makeSampler(data);
  const m = roadMetrics(data, S, { stride: +(process.argv[2] || 3) });
  for (const [k, v] of Object.entries(m.smooth)) console.log(`smooth ${k.padEnd(10)} max d2 ${v.max.toFixed(4)}  >0.02: ${(v.over / v.n * 100).toFixed(3)}%  max grade ${(v.grade * 100).toFixed(1)}%`);
  for (const [k, v] of Object.entries(m.poke)) console.log(`poke ${k.padEnd(14)} >5cm ${(v.over5 / v.n * 100).toFixed(3)}%  >20cm ${(v.over20 / v.n * 100).toFixed(3)}%  max ${v.max.toFixed(2)} m`);
  console.log(JSON.stringify(m.worst)); console.log(`${Math.round(performance.now() - t0)} ms`);
}

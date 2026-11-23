import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldData } from '../src/world/build.js';
import { makeSampler } from '../src/world/sampler.js';
import { makeRouter } from '../src/world/route.js';
import { makeLayout } from '../src/world/layout.js';
import { toWorld } from '../src/core/geo.js';

const data = buildWorldData(), S = makeSampler(data);
const pts = []; for (let i = 0; i < 4000; i++) pts.push([-49000 + ((i * 7919) % 98000), -31000 + ((i * 104729) % 62000)]);

test('heightAt is deterministic across independent bakes', () => {
  const S2 = makeSampler(buildWorldData());
  for (const [x, z] of pts) assert.equal(S.heightAt(x, z), S2.heightAt(x, z));
});
test('heightAt is fast and finite', () => {
  let s = 0; const t0 = performance.now(); for (let k = 0; k < 250; k++) for (const [x, z] of pts) s += S.heightAt(x + k * .37, z - k * .21); const us = (performance.now() - t0) * 1000 / (250 * pts.length);
  assert.ok(Number.isFinite(s)); assert.ok(us < 2, `heightAt ${us.toFixed(3)} us`); console.log(`heightAt ${us.toFixed(3)} us/call`);
});
test('geography sanity', () => {
  const den = data.cities.find((c) => c.name === 'Denver'), okc = data.cities.find((c) => c.name === 'Oklahoma City');
  assert.ok(S.heightAt(den.x, den.z) > S.heightAt(okc.x, okc.z) + 100, 'Denver higher than OKC');
  const atl = toWorld(35, -70); assert.equal(S.waterLevelAt(atl.x, atl.z), 0, 'Atlantic is ocean');
  assert.equal(S.stateAt(okc.x, okc.z), 'Oklahoma'); const w = toWorld(37.7, -97.3); assert.equal(S.stateAt(w.x, w.z), 'Kansas');
  const k = toWorld(39.5, -98.5); assert.equal(S.waterLevelAt(k.x, k.z), -Infinity);
});
test('roads.nearest matches brute force', () => {
  const { S: A, n } = data.seg; for (let i = 0; i < 60; i++) {
    const [x, z] = pts[i * 37]; const r = S.nearest(x, z); let best = 1e18;
    for (let s = 0; s < n; s++) { const a = s * 6, dx = A[a + 2] - A[a], dz = A[a + 3] - A[a + 1]; let t = ((x - A[a]) * dx + (z - A[a + 1]) * dz) / (dx * dx + dz * dz); t = Math.max(0, Math.min(1, t)); const ex = x - A[a] - dx * t, ez = z - A[a + 1] - dz * t; best = Math.min(best, ex * ex + ez * ez); }
    assert.ok(Math.abs(r.dist - Math.sqrt(best)) < 1e-3 || r.dist < Math.sqrt(best) + 1e-3, `nearest ${r.dist} vs ${Math.sqrt(best)}`);
  }
  const ok = data.cities.find((c) => c.name === 'Wichita'); const t0 = performance.now(); for (let i = 0; i < 20000; i++) S.nearest(ok.x + (i % 200) * 20 - 2000, ok.z + Math.floor(i / 200) * 40 - 2000); const us = (performance.now() - t0) * 1000 / 20000; console.log(`nearest (plains) ${us.toFixed(2)} us/call`); assert.ok(us < 50);
});
test('route connects OKC to Wichita along roads', () => {
  const R = makeRouter(S), a = data.cities.find((c) => c.name === 'Oklahoma City'), b = data.cities.find((c) => c.name === 'Wichita');
  const t0 = performance.now(), p = R.route(a.x + 300, a.z + 200, b.x - 200, b.z + 100), ms = performance.now() - t0;
  assert.ok(p.length > 20); let L = 0; for (let i = 2; i < p.length; i += 2) { const d = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); assert.ok(d < 450, `gap ${d}`); L += d; }
  const straight = Math.hypot(a.x - b.x, a.z - b.z); assert.ok(L > straight * .9 && L < straight * 1.8, `len ${L} vs ${straight}`); console.log(`route ${ms.toFixed(0)} ms, ${(L / 1000).toFixed(1)} km`);
});
test('layout is deterministic', () => {
  const L1 = makeLayout(S), L2 = makeLayout(makeSampler(buildWorldData())); const a = L1.sector(95, 67), b = L2.sector(95, 67);
  assert.ok(a.items.length > 0); assert.deepEqual(Array.from(a.items), Array.from(b.items));
});

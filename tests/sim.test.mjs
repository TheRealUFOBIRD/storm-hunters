// node --test tests/sim.test.mjs
import test from 'node:test'; import assert from 'node:assert/strict';
import { create } from '../src/sim/index.js';
import { Events } from '../src/core/events.js';
import { fbm } from '../src/core/noise.js';
import { axisAt, funnelRadius, coreRadius, swirl } from '../src/sim/tornadoAxis.js';
import { BOUNDS } from '../src/core/geo.js';

const world = { bounds: BOUNDS, heightAt: (x, z) => fbm(x / 900, z / 900, 3, 7) * 18, biomeAt: () => ({ id: 'plains', dustColor: [0.4, 0.3, 0.2], humidity: 0.6, tornadoProb: 1 }), waterLevelAt: () => -Infinity, isLand: () => true, stateAt: () => 'Oklahoma', nearestCity: () => ({ name: 'Norman', x: 0, z: 0 }) };
const mk = (seed = 7, role = 'solo') => { const c = { events: new Events(), time: { now: 0, hour: 17 }, world, net: { role, peers: new Map() }, player: { pos: { x: 0, y: 0, z: 0 } }, stormSeed: seed, ev: [] }; for (const k of ['tornado:spawn', 'tornado:stage', 'tornado:end', 'lightning', 'warning', 'storm:spawn', 'storm:end']) c.events.on(k, (d) => c.ev.push([k, c.time.now, d])); return c; };
const run = (c, sec, dt = 0.1, f) => { for (let i = 0, n = Math.round(sec / dt); i < n; i++) { c.time.now += dt; c.storms.update(dt); f?.(); } };
const start = async (seed, role) => { const c = mk(seed, role); c.storms = await create(c); return c; };

test('vortex peaks at rCore, pressure matches wind', async () => {
  const c = await start(1); c.storms.director = false; const t = c.storms.spawnAt(0, 0, { ef: 3, stage: 'mature', hold: true, still: true, shape: 'cone', swirl: 0.3 });
  run(c, 1); const o = {}, a = {}; let best = 0, bestR = 0; const h = 30; c.storms.axisAt(t, h, a);
  for (let r = 4; r < 900; r += 2) { let m = 0; for (let k = 0; k < 24; k++) { const an = k / 24 * 6.283, dx = Math.cos(an), dz = Math.sin(an); c.storms.windAt(a.x + dx * r, t.y0 + h, a.z + dz * r, o); m += (o.x * dz - o.z * dx) / 24; } if (m > best) { best = m; bestR = r; } }
  const rc = coreRadius(t, h); assert.ok(Math.abs(bestR - rc) < rc * 0.15, `peak r ${bestR} vs rc ${rc}`); assert.ok(Math.abs(best - t.vmax) < t.vmax * 0.15, `peak ${best} vs ${t.vmax}`);
  // cyclostrophic balance: dp/dr = rho v^2 / r, integrated
  const x0 = a.x, z0 = a.z; let dp = 0; for (let r = 0.5; r < rc * 40; r += 1) { const v = t.vmax * swirl(r / rc); dp += 1.12 * v * v / r; }
  const meas = c.storms.pressureAt(x0 + rc * 40, t.y0 + h, z0) - c.storms.pressureAt(x0, t.y0 + h, z0);
  assert.ok(Math.abs(meas * 100 - dp) < dp * 0.08, `dp ${meas * 100} vs ${dp}`); assert.ok(Math.abs(t.dp * 100 - dp) < dp * 0.1);
  c.storms.windAt(a.x + rc, t.y0 + 3, a.z, o); assert.ok(o.x < -5 && o.y > 2 && o.z < -20, 'inflow, updraft, cyclonic on the east side (toward north): ' + JSON.stringify(o));
  console.log('peak', best.toFixed(1), '@', bestR, 'rc', rc.toFixed(1), 'dp hPa', meas.toFixed(1), 'funnel r ground/mid/top', [0, 0.5, 0.95].map((k) => funnelRadius(t, t.lcl * k).toFixed(0)).join(' '));
});
test('funnel radius is monotone and finite for all stages', async () => {
  const c = await start(2); c.storms.director = false;
  for (const ef of [0, 2, 4, 5]) for (const stage of ['funnel', 'touchdown', 'mature', 'shrinking', 'rope']) { const t = c.storms.spawnAt(0, 0, { ef, stage, hold: true, still: true }); run(c, 0.2); let p = 0, s = []; for (let h = 0; h <= t.lcl; h += t.lcl / 20) { const r = funnelRadius(t, h); assert.ok(Number.isFinite(r) && r >= 0 && r < 900); assert.ok(r >= p - 12, `${ef} ${stage}`); p = r; s.push(r | 0); } console.log(ef, stage, t.shape, 'v', t.vmax | 0, 'rc', t.rCore | 0, 'ratio', t.condRatio.toFixed(2), 'lcl', t.lcl | 0, s.filter((_, i) => i % 4 === 0).join(',')); c.storms.clear(); }
});
test('determinism', async () => {
  const A = await start(42), B = await start(42); run(A, 900); run(B, 900); assert.equal(JSON.stringify(A.storms.snapshot()), JSON.stringify(B.storms.snapshot())); assert.ok(A.storms.list.length >= 3);
});
test('snapshot roundtrip + client extrapolation', async () => {
  const H = await start(11); let g = 0; while (!H.storms.tornadoes.some((t) => t.onGround) && g++ < 100) run(H, 10);
  const C = await start(99, 'client'); C.time.now = H.time.now; C.storms.applySnapshot(JSON.parse(JSON.stringify(H.storms.snapshot()))); C.storms.update(0.001);
  assert.equal(C.storms.list.length, H.storms.list.length); assert.equal(C.storms.tornadoes.length, H.storms.tornadoes.length);
  console.log('snapshot bytes', JSON.stringify(H.storms.snapshot()).length);
  for (let i = 0; i < 100; i++) { run(H, 0.1); run(C, 0.1); }
  for (const t of H.storms.tornadoes) { const u = C.storms.tornadoes.find((q) => q.id === t.id); if (!u) continue; assert.ok(Math.hypot(u.x - t.x, u.z - t.z) < 3, `${Math.hypot(u.x - t.x, u.z - t.z)}`); assert.ok(Math.abs(u.vmax - t.vmax) < 1 && Math.abs(u.rCore - t.rCore) < 2); }
  for (const s of H.storms.list) { const u = C.storms.list.find((q) => q.id === s.id); assert.ok(Math.hypot(u.x - s.x, u.z - s.z) < 5); assert.ok(Math.abs(u.intensity - s.intensity) < 0.02); }
});
test('director: tornado soon, never on top of the player, plausible EF distribution', async () => {
  const efs = [0, 0, 0, 0, 0, 0], shapes = {}; let worst = 0, sum = 0, n = 0, count = 0, dists = [];
  for (let seed = 1; seed <= 25; seed++) {
    const c = await start(seed); let first = -1, d0 = 0; run(c, 2400, 0.25, () => { if (first < 0) for (const t of c.storms.tornadoes) if (t.onGround && Math.hypot(t.x, t.z) < 16000) { first = c.time.now; d0 = Math.hypot(t.x, t.z); } });
    for (const [k, , t] of c.ev) if (k === 'tornado:spawn') { count++; } for (const [k, , t] of c.ev) if (k === 'tornado:end') { efs[t.efMax]++; shapes[t.shape] = (shapes[t.shape] || 0) + 1; assert.ok(!Number.isNaN(t.x)); }
    for (const [k, , t] of c.ev) if (k === 'tornado:spawn') assert.ok(Math.hypot(t.x, t.z) > 0);
    assert.ok(first > 0, 'no tornado for seed ' + seed); worst = Math.max(worst, first); sum += first; n++; dists.push(d0 | 0); assert.ok(c.storms.list.length >= 3 && c.storms.list.length <= 10, 'storms ' + c.storms.list.length);
  }
  console.log('first tornado mean s', sum / n, 'worst', worst, 'EF', efs, shapes, 'per 40 min', count / 25, 'first dist', dists.join(' ')); assert.ok(worst < 420);
});
test('weather fields sane + hook echo', async () => {
  const c = await start(5); c.storms.director = false; const st = c.storms.spawnAt(0, 0, { type: 'supercell', noTornado: true, hold: true, still: true, peak: 1, vx: 10, vz: 0 }); st.next = st.age; run(c, 1);
  let rows = ''; for (let z = -9000; z <= 6000; z += 500) { let l = ''; for (let x = -5000; x <= 11000; x += 250) { const e = c.storms.reflectivity(x, z); l += ' .:-=+*#%@'[Math.min(9, Math.floor(e / 7))]; } rows += l + '\n'; } console.log(rows);
  const w = c.storms.weatherAt(st.rain.x, st.rain.z); console.log(w.rain, w.hail, w.temp, w.dewpoint, w.visibility, w.windSpeed, c.storms.cape(0, 0)); assert.ok(w.rain > 0.5 && w.visibility < 2500 && w.temp > w.dewpoint);
  const far = c.storms.weatherAt(-40000, 20000); assert.ok(far.rain === 0 && far.visibility > 8000);
});
test('windAt perf', async () => {
  const c = await start(3); run(c, 400); const o = {}; let s = 0; const N = 300000, t0 = performance.now(); for (let i = 0; i < N; i++) { c.storms.windAt((i * 37 % 4000) - 2000, 10 + (i % 50), (i * 91 % 4000) - 2000, o); s += o.x; } const us = (performance.now() - t0) / N * 1000; console.log('windAt us', us.toFixed(2), 'storms', c.storms.list.length, 'tornadoes', c.storms.tornadoes.length, s > 1e9); assert.ok(us < 6);
  c.storms.spawnAt(0, 0, { ef: 4, stage: 'mature' }); const t1 = performance.now(); for (let i = 0; i < 60; i++) { c.time.now += 1 / 60; c.storms.update(1 / 60); } console.log('update ms', (performance.now() - t1) / 60);
});

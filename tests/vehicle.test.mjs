import test from 'node:test';
import assert from 'node:assert/strict';
import { VehicleBody, STEP } from '../src/vehicles/physics.js';
import { SPECS, TYPE_IDS } from '../src/vehicles/specs.js';

let T = 0;
const A = { type: 'asphalt', grip: 1, wetGrip: 0.7, rollRes: 0.012, bump: 0, dust: 0 };
export function env({ wind = [0, 0, 0], slope = 0, surf = A, colliders = [], bump = null } = {}) {
  const hits = [];
  const k = slope;
  return {
    hits, world: {
      heightAt: (x, z) => -z * k + (bump ? bump(x, z) : 0), normalAt: (x, z, o) => o.set(0, 1, k).normalize(), surfaceAt: () => surf, waterLevelAt: () => -Infinity,
      queryColliders: (x, z, r, out) => { for (const c of colliders) if (!c.broken && Math.hypot(c.x - x, c.z - z) < r + (c.r || Math.hypot(c.hx, c.hz))) out.push(c); }, hitCollider: (id, j) => { hits.push(id); for (const c of colliders) if (c.id === id) c.broken = true; void j; },
    }, storms: { windAt: (x, y, z, o) => (typeof wind === 'function' ? wind(x, y, z, o) : o.set(...wind)) }, wetness: () => 0, time: () => (T += 1 / 180),
  };
}
export const run = (b, sec, f) => { const dt = 1 / 60; for (let t = 0; t < sec; t += dt) { f?.(b, t); b.update(dt); } };
const mk = (type, e) => { const b = new VehicleBody(type, e); b.occupied = true; b.place(0, 0, 0); return b; };

for (const id of TYPE_IDS) test(`${id}: rests still at ride height`, () => {
  const b = mk(id, env()); run(b, 4);
  const p0 = b.p.clone(); run(b, 4);
  console.log(id, 'ride y', b.p.y.toFixed(3), 'cg', SPECS[id].cgY, 'drift', p0.distanceTo(b.p).toExponential(2));
  assert.ok(Math.abs(b.p.y - SPECS[id].cgY) < 0.04); assert.ok(p0.distanceTo(b.p) < 0.02); assert.ok(b.v.length() < 0.02);
});
test('holds on 15% slope', () => { const b = mk('prairie', env({ slope: 0.15 })); run(b, 3); const p = b.p.clone(); run(b, 5); console.log('slope creep', p.distanceTo(b.p)); assert.ok(p.distanceTo(b.p) < 0.05); });

const EXP = { prairie: [6.5, 11], scout: [5.5, 9], longhorn: [5, 10], bastion: [9, 24], doppler: [13, 40], devil: [3.6, 6] };
for (const id of TYPE_IDS) test(`${id}: 0-100 / brake / top`, () => {
  const b = mk(id, env()); run(b, 1); let t100 = 0, t = 0;
  const p0 = b.p.clone();
  while (t < 60 && b.speed < 27.78) { b.input.throttle = 1; b.update(1 / 60); t += 1 / 60; } t100 = t; const drift = Math.abs(b.p.x - p0.x);
  const z0 = b.p.z; b.input.throttle = 0; b.input.brake = 1; let tb = 0; while (b.speed > 0.3 && tb < 20) { b.update(1 / 60); tb += 1 / 60; } const dist = Math.abs(b.p.z - z0);
  b.input.brake = 0; b.input.throttle = 1; run(b, 70); const top = b.speed * 3.6;
  console.log(`${id}: 0-100 ${t100.toFixed(2)} s, 100-0 ${dist.toFixed(1)} m, top ${top.toFixed(0)} km/h gear ${b.gear} rpm ${b.rpm.toFixed(0)}, x-drift ${drift.toFixed(2)}`);
  assert.ok(t100 > EXP[id][0] && t100 < EXP[id][1]); assert.ok(dist > 30 && dist < 75); assert.ok(Math.abs(top - SPECS[id].topSpeed) < SPECS[id].topSpeed * 0.2); assert.ok(drift < 1);
});
for (const id of TYPE_IDS) test(`${id}: skidpad and reverse`, () => {
  const b = mk(id, env()); run(b, 4, (o) => { o.input.throttle = o.speed < 20 ? 1 : 0.2; }); let roll = 0, ay = 0;
  run(b, 5, (o) => { o.input.steer = 1; o.input.throttle = o.speed < 18 ? 0.6 : 0.1; roll = Math.max(roll, Math.abs(Math.asin(o.M[3]))); ay = Math.max(ay, Math.abs(o.accLocal.x)); });
  console.log(`${id} lat accel ${(ay / 9.81).toFixed(2)} g, roll ${(roll * 57.3).toFixed(1)} deg, upY ${b.upY.toFixed(2)} speed ${b.speed.toFixed(1)} beta ${Math.atan2(b.vLat, b.vLong).toFixed(2)}`);
  assert.ok(b.upY > 0.9, 'did not roll over'); assert.ok(ay / 9.81 > 0.45 && ay / 9.81 < 1.35);
  b.input.steer = 0; b.input.throttle = 0; run(b, 8, (o) => { o.input.brake = 1; }); assert.ok(b.speed < -2, 'reverses ' + b.speed);
});
const WIND = (v) => env({ wind: [v, 0, 0] });
test('crosswind rolls sedan at 80, anchored bastion holds', () => {
  for (const id of TYPE_IDS) { const r = []; for (let v = 20; v <= 110; v += 10) { const b = mk(id, WIND(v)); run(b, 6); r.push(`${v}:${b.p.x.toFixed(1)}/${b.upY.toFixed(2)}`); } console.log(id, r.join(' ')); }
  const s = mk('prairie', WIND(80)); let mn = 1; run(s, 8, (b) => { mn = Math.min(mn, b.upY); }); assert.ok(mn < 0.2, 'sedan rolls ' + mn);
  const calm = mk('prairie', WIND(25)); run(calm, 8); assert.ok(calm.upY > 0.98 && Math.abs(calm.p.x) < 0.6);
  const b = mk('bastion', WIND(0)); run(b, 1); assert.ok(b.setAnchored(true)); run(b, 4); assert.ok(b.anchorK > 0.9); b.env.storms.windAt = (x, y, z, o) => o.set(80, 0, 0); run(b, 8); console.log('bastion', b.p.x, b.upY, b.anchored, b.windLoad, b.anchorStress); assert.ok(b.anchored && b.upY > 0.97 && Math.abs(b.p.x) < 0.3);
});
test('strong vortex lofts the sedan', () => {
  const w = (x, y, z, o) => { const cx = 60, dx = x - cx, dz = z, r = Math.hypot(dx, dz) + 0.01, v = 95 * 2 * r * 60 / (r * r + 3600); return o.set(dz / r * v - dx / r * v * 0.3, v * 0.42, -dx / r * v - dz / r * v * 0.3); };
  const b = mk('prairie', env({ wind: w })); let hi = 0, sp = 0; run(b, 14, (o) => { hi = Math.max(hi, o.p.y); sp = Math.max(sp, o.v.length()); }); console.log('loft height', hi.toFixed(1), 'max speed', sp.toFixed(1), 'damage', b.damage.toFixed(2)); assert.ok(hi > 4 && Number.isFinite(b.p.x)); assert.ok(sp < 120);
});
test('no NaN for wild inputs & terrain', () => {
  for (const id of TYPE_IDS) { const b = mk(id, env({ bump: (x, z) => Math.sin(x * 0.4) * 1.5 + Math.cos(z * 0.3) * 2 })); let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    run(b, 25, (o, t) => { if (r() < 0.2) { o.input.steer = r() * 6 - 3; o.input.throttle = r() * 2; o.input.brake = r() < 0.2 ? NaN || r() : 0; o.input.handbrake = r() < 0.1 ? 1 : 0; } if (r() < 0.01) o.addImpulse((r() - 0.5) * 30000, r() * 9000, (r() - 0.5) * 60000, o.p.x + r(), o.p.y + r(), o.p.z); void t; });
    assert.ok(Number.isFinite(b.p.x + b.p.y + b.p.z + b.v.length() + b.w.length() + b.rpm)); assert.ok(b.p.y > -20 && b.p.y < 400, 'y ' + b.p.y); }
});
test('collisions: wall stops, pole breaks', () => {
  const wall = { id: 1, kind: 'building', shape: 'box', x: 0, y: 2, z: -40, hx: 8, hy: 3, hz: 2, rotY: 0, mass: 1e9, breakSpeed: Infinity };
  const b = mk('prairie', env({ colliders: [wall] })); let imp = 0; b.onImpact = (s) => { imp = Math.max(imp, s); }; run(b, 8, (o) => { o.input.throttle = 1; }); console.log('wall stop z', b.p.z.toFixed(2), 'impact', imp.toFixed(1), 'dmg', b.damage.toFixed(2)); assert.ok(b.p.z > -38 && imp > 5 && b.damage > 0.05);
  const pole = { id: 2, kind: 'pole', shape: 'cyl', x: 0.2, y: 0, z: -40, r: 0.12, h: 6, mass: 120, breakSpeed: 8 }; const e = env({ colliders: [pole] }), c = mk('scout', e); run(c, 6, (o) => { o.input.throttle = 1; }); console.log('pole', e.hits, c.p.z.toFixed(1)); assert.ok(e.hits.length === 1 && c.p.z < -60);
  const tree = { id: 3, kind: 'tree', shape: 'cyl', x: 0.5, y: 0, z: -40, r: 0.4, h: 9, mass: 4000, breakSpeed: Infinity }; const d = mk('longhorn', env({ colliders: [tree] })); run(d, 6, (o) => { o.input.throttle = 1; }); console.log('tree z', d.p.z.toFixed(1)); assert.ok(d.p.z > -60);
});
test('perf', () => { const b = mk('scout', env()); const t = performance.now(); let n = 0; run(b, 20, (o) => { o.input.throttle = 1; o.input.steer = Math.sin(n++ * 0.02); }); const ms = (performance.now() - t) / n; console.log('ms/frame', ms.toFixed(3)); assert.ok(ms < 2); void STEP; });

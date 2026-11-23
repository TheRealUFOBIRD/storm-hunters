// Parent storm life cycle: derived from (seed, age); position integrated.
import { rng } from '../core/rng.js';
import { gnoise } from '../core/noise.js';
import { clamp, lerp, smoothstep, dirToHeading } from '../core/math.js';

export const TYPES = ['supercell', 'squall', 'shower'];
/** o: {vx,vz,potential,hold,still,name,next,cloudBase,peak,life} (serialised) */
export function makeStorm(id, type, seed, x, z, o = {}) {
  const r = rng(seed), p = {}, a0 = r(), a1 = r(), a2 = r(), a3 = r(), a4 = r(), sc = type === 'supercell', sq = type === 'squall';
  p.peak = o.peak ?? (sc ? lerp(0.78, 1, a0) : sq ? lerp(0.65, 0.95, a0) : lerp(0.3, 0.6, a0));
  p.life = o.life ?? (sc ? lerp(1900, 3200, a1) : sq ? lerp(1500, 2600, a1) : lerp(700, 1300, a1));
  p.radius = sc ? lerp(4300, 6400, r()) : sq ? lerp(3200, 4200, r()) : lerp(1800, 2900, r());
  p.rainR = sc ? lerp(1900, 2900, r()) : sq ? lerp(1500, 2000, r()) : lerp(900, 1500, r());
  p.base = o.cloudBase ?? lerp(640, 1150, a2); p.top = sc ? lerp(12500, 15500, r()) : sq ? lerp(10500, 13000, r()) : lerp(6000, 8500, r());
  p.hail = sc ? 2 + 9 * r() * r() : sq ? 1.6 * r() : 0.8 * r(); p.mesoR = lerp(850, 1400, r()); p.pot = o.potential ?? lerp(0.35, 1, a3); p.turn = r(); p.len = sq ? lerp(4500, 9000, r()) : 0;
  const st = {
    id, type, seed, x, z, vx: o.vx ?? 11, vz: o.vz ?? -5, heading: 0, fx: 1, fz: 0, age: 0, born: 0, life: p.life, intensity: 0, peak: p.peak, radius: p.radius, rainR: p.rainR, cloudBase: p.base, cloudTop: 5000, rotation: 0, mature: 0,
    meso: { x, z, r: p.mesoR }, rain: { x, z, ox: 0, oz: 0, r: p.rainR, rate: 0 }, hail: 0, hailPeak: p.hail, lightning: 0, potential: p.pot, warned: false, warnKind: null, name: o.name || '', y0: 0, len: p.len, cycles: 0, next: o.next ?? (sc ? lerp(360, 560, a4) : 1e9),
    nTor: 0, tornado: null, phase: 'growing', fade: 1, ex: 0, ez: 0, o, p, done: false,
  };
  return st;
}

export function stepStorm(st, dt, now, world, bounds) {
  const p = st.p, ss = smoothstep; if (!st.o.hold) st.age += dt;
  const a = st.age, sc = st.type === 'supercell', L = p.life;
  // dissipate early when leaving the map
  if (bounds && !st.o.hold) { const m = 4000; if (st.x < bounds.minX - m || st.x > bounds.maxX + m || st.z < bounds.minZ - m || st.z > bounds.maxZ + m) st.age = Math.max(st.age, L - 120); }
  const G = sc ? 300 : st.type === 'squall' ? 260 : 160, up = ss(0, G, a), down = 1 - ss(L - 420, L, a);
  st.fade = st.o.noFade ? 1 : ss(0, 45, now - st.born);
  st.intensity = p.peak * up * down * st.fade * (1 + 0.05 * gnoise(now / 50, st.seed % 79, 71)); st.mature = ss(G * 0.6, G * 2, a);
  st.phase = a < G * 0.6 ? 'towering' : a > L - 420 ? 'dissipating' : 'mature';
  st.cloudTop = lerp(4200, p.top, ss(0, G * 1.1, a)) * lerp(0.75, 1, down);
  let near = 0; if (sc) { const d = st.next - a; near = d > 0 ? ss(260, 30, d) : 1; if (st.tornado) near = 1; }
  st.rotation = sc ? clamp(ss(G * 0.5, G * 1.25, a) * (0.5 + 0.4 * near + 0.1 * gnoise(now / 70, st.seed % 73, 72)) * down * Math.min(1, st.intensity * 1.6)) : 0;
  st.hail = st.hailPeak * ss(0.35, 0.8, st.intensity) * (0.8 + 0.2 * gnoise(now / 90, st.seed % 71, 73));
  st.lightning = (sc ? 0.55 : st.type === 'squall' ? 0.4 : 0.07) * Math.pow(st.intensity, 1.4);
  // motion: mature supercells deviate to the right
  if (sc && !st.o.hold && !st.o.still) { const w = 0.00032 * p.turn * ss(G, G * 2, a) * dt, c = Math.cos(w), s = Math.sin(w), vx = st.vx; st.vx = vx * c - st.vz * s; st.vz = vx * s + st.vz * c; }
  const sp = Math.hypot(st.vx, st.vz) || 1; st.fx = st.vx / sp; st.fz = st.vz / sp; st.heading = dirToHeading(st.fx, st.fz);
  if (!st.o.still) { st.x += st.vx * dt; st.z += st.vz * dt; }
  if (st.ex || st.ez) { const q = 1 - Math.exp(-dt * 1.2); st.x += st.ex * q; st.z += st.ez * q; st.ex *= 1 - q; st.ez *= 1 - q; }
  // geometry (right of motion = (-fz, fx))
  const R = st.rainR, fx = st.fx, fz = st.fz, m = st.meso;
  m.x = st.x - fx * st.radius * 0.06 - fz * st.radius * 0.07; m.z = st.z - fz * st.radius * 0.06 + fx * st.radius * 0.07;
  const u = sc ? 0.95 : st.type === 'squall' ? -0.25 : 0, v = sc ? -0.62 : 0;
  st.rain.x = m.x + R * (fx * u - fz * v); st.rain.z = m.z + R * (fz * u + fx * v); st.rain.ox = st.rain.x - st.x; st.rain.oz = st.rain.z - st.z; st.rain.r = R * (sc ? 0.85 : 1); st.rain.rate = clamp(st.intensity * 1.05 * ss(G * 0.35, G, a));
  if (world && (!st._gt || now - st._gt > 2)) { st._gt = now; st.y0 = world.heightAt(m.x, m.z); }
  st.done = a >= L;
}

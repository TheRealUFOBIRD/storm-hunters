// Tornado life cycle. Everything is derived from (seed, age) so host and clients agree; only position is integrated.
import { rng } from '../core/rng.js';
import { gnoise } from '../core/noise.js';
import { clamp, lerp, smoothstep, efFromWind } from '../core/math.js';

export const RHO = 1.12, G = 9.81, HALF_PI = Math.PI / 2;
export const EF_RANGE = [[29, 38.4], [38.4, 49.6], [49.6, 60.8], [60.8, 74.2], [74.2, 89.4], [89.4, 122]];
export const SHAPES = ['rope', 'cone', 'stovepipe', 'wedge'];
// fraction of life at which each stage begins
const STAGE_AT = { funnel: 0, touchdown: 0.1, mature: 0.27, shrinking: 0.7, rope: 0.86, dead: 1 };
const STAGE_MID = { funnel: 0.06, touchdown: 0.18, mature: 0.48, shrinking: 0.8, rope: 0.92, dead: 1 };
export const stageTau = (s) => STAGE_MID[s] ?? STAGE_MID.mature;
const stageOf = (k) => (k >= 1 ? 'dead' : k >= 0.86 ? 'rope' : k >= 0.7 ? 'shrinking' : k >= 0.27 ? 'mature' : k >= 0.1 ? 'touchdown' : 'funnel');

// potential 0..1 -> EF. At 1: 27 % EF0, 28 % EF1, 20 % EF2, 13 % EF3, 9 % EF4, 3 % EF5
export function drawEF(r, potential) {
  const u = r() * (0.35 + 0.65 * clamp(potential));
  return u < 0.27 ? 0 : u < 0.55 ? 1 : u < 0.75 ? 2 : u < 0.88 ? 3 : u < 0.968 ? 4 : 5;
}

/** o: {ef, vPeak, shape, life, spin, swirl, hold, parent, rCore, tau} (all optional, serialised in snapshots) */
export function makeTornado(id, storm, seed, x, z, o = {}) {
  const r = rng(seed), p = {};
  const ef = o.ef ?? drawEF(r, storm ? storm.potential : 0.7); r();
  const E = EF_RANGE[clamp(ef | 0, 0, 5)], bell = (r() + r()) / 2;
  p.vPeak = o.vPeak ?? lerp(E[0], E[1], ef === 5 ? r() * r() : 0.12 + 0.76 * bell);
  const s = r(), wide = r();
  p.shape = o.shape ?? (ef >= 4 ? (s < 0.5 ? 'wedge' : s < 0.8 ? 'stovepipe' : 'cone') : ef >= 2 ? (s < 0.14 ? 'wedge' : s < 0.42 ? 'stovepipe' : s < 0.85 ? 'cone' : 'rope') : (s < 0.5 ? 'rope' : 'cone'));
  const monster = p.shape === 'wedge' && ef >= 4 && wide > 0.75;
  p.rPeak = Math.min(450, o.rCore ?? (p.shape === 'rope' ? lerp(14, 34, wide) : p.shape === 'cone' ? lerp(34, 88, wide) : p.shape === 'stovepipe' ? lerp(52, 120, wide) : monster ? lerp(330, 450, r()) : lerp(170, 310, wide)));
  p.topK = { rope: lerp(2.2, 3.6, r()), cone: lerp(3.2, 4.8, r()), stovepipe: lerp(1.7, 2.3, r()), wedge: lerp(1.5, 2.1, r()) }[p.shape];
  p.life = o.life ?? lerp(200, 460, r()) * (1 + 0.16 * ef) * (p.shape === 'rope' ? 0.7 : 1);
  p.swirl = o.swirl ?? clamp(0.25 + r() * 0.7 + (p.shape === 'wedge' ? 0.5 : 0) + ef * 0.05, 0.2, 1.6);
  p.condBias = lerp(0.62, 1.12, r());
  p.leanA = r() * 0.9 - 0.45; p.leanK = lerp(0.1, 0.24, r()); p.ropeLean = lerp(0.5, 1.05, r());
  p.snake = lerp(0.7, 1.3, r()); p.left = lerp(1.5, 6.5, r()) * (1 + (p.shape === 'wedge' ? 0.3 : 0)); p.meander = r() * 100; p.slow = r() < 0.12 ? lerp(0.15, 0.5, r()) : 0;
  p.nSub = 2 + Math.floor(r() * 3.2); p.subPh = r() * 100;
  const t = {
    id, storm, seed, x, z, y0: 0, vx: storm ? storm.vx : 0, vz: storm ? storm.vz : 0, age: 0, life: p.life, stage: 'funnel', strength: 0, ef: 0, efMax: 0, efPeak: ef, vmax: 0, rCore: p.rPeak * 0.35,
    dp: 0, lcl: 800, condense: 0, pc: 10, rTop: 60, dustR: 0, dust: 0, dustColor: [0.42, 0.32, 0.22], spin: o.spin ?? (r() < 0.03 ? -1 : 1), sub: [], lean: { x: 0, z: 0 }, snake: 0, corner: 0.25,
    wobbleSeed: r() * 100, shape: p.shape, swirl: p.swirl, humidity: 0.6, onGround: false, parent: o.parent ?? 0, width: 0, pathLen: 0, o, p, ex: 0, ez: 0, _subs: [], _warned: 0,
  };
  for (let i = 0; i < 5; i++) t._subs.push({ a: r() * 6.283, r: 0, s: 0, rc: 5, ph: r() * 100 });
  t.age = (o.tau ?? 0) * p.life;
  return t;
}

/** advance age/position and recompute all derived values. env: {now, world, stormOf} */
export function stepTornado(t, dt, now, world, parent) {
  const p = t.p, st = t.storm;
  if (!t.o.hold) t.age += dt;
  const k = clamp(t.age / p.life), ss = smoothstep;
  // ---- intensity
  const grow = ss(0.015, 0.31, k), decay = 1 - 0.5 * ss(0.7, 0.9, k), end = 1 - ss(0.955, 1, k);
  const fluct = 1 + 0.075 * gnoise(now / 9, t.wobbleSeed, 3) + 0.045 * gnoise(now / 2.6, t.wobbleSeed, 4);
  const s = grow * decay * end;
  t.strength = s; t.vmax = (9 + (p.vPeak - 9) * s) * lerp(1, fluct, grow);
  t.ef = efFromWind(t.vmax); t.stage = stageOf(k); t.onGround = k >= 0.1 && k < 0.985;
  if (t.onGround && t.ef > t.efMax) t.efMax = t.ef;
  t.dp = HALF_PI * RHO * t.vmax * t.vmax / 100;                                   // consistent with the Vatistas n=2 vortex
  // ---- size
  const shrink = 1 - 0.8 * ss(0.68, 0.93, k);
  t.rCore = Math.max(7, p.rPeak * (0.32 + 0.68 * ss(0.06, 0.38, k)) * shrink * (1 + 0.05 * gnoise(now / 17, t.wobbleSeed, 5)));
  t.lcl = (st ? st.cloudBase : 850) * (parent ? 0.9 : 1);
  const topGrow = 0.55 + 0.45 * ss(0, 0.2, k);
  t.rTop = clamp(t.rCore * p.topK * topGrow + 45 * topGrow + p.rPeak * 0.5 * ss(0.68, 0.9, k) * 0.35, 35, 760);
  // ---- condensation: ratio of core pressure drop to the drop needed at the ground (humid inflow needs much less than dry LCL)
  const need = RHO * G * t.lcl * lerp(0.86, 0.42, clamp(t.humidity)), phys = HALF_PI * RHO * t.vmax * t.vmax / need;
  let ratio = Math.max(phys, p.condBias * ss(-0.02, 0.2, k) * (0.55 + 0.45 * ss(26, 46, t.vmax)));
  ratio = Math.max(ratio, 1.06 * ss(0.8, 0.88, k)) * Math.max(0.02, 1 - ss(0.945, 1, k)) * (0.35 + 0.65 * ss(0, 0.06, k));
  ratio = Math.min(ratio, 2.9) * (1 + 0.06 * gnoise(now / 5, t.wobbleSeed, 6));
  t.condRatio = ratio; t.pc = HALF_PI / Math.max(0.03, ratio); t.condense = clamp(ratio); t.corner = 0.18 + 0.2 * clamp(1.2 - p.swirl);
  // ---- dust / debris
  const bio = t.dustiness ?? 0.6;
  t.dust = (t.onGround ? ss(19, 46, t.vmax) : 0) * ss(0.08, 0.2, k) * lerp(0.55, 1, bio);
  t.dustR = t.rCore * 1.55 + t.vmax * 1.1 + 12;
  t.width = 2 * (t.rCore * 1.4 + 10);
  // ---- shape
  const rope = ss(0.72, 0.95, k);
  t.snake = t.lcl * p.snake * lerp(p.shape === 'wedge' ? 0.01 : p.shape === 'rope' ? 0.055 : 0.022, 0.13, rope);
  const la = (st ? st.heading : 1) + p.leanA + 0.35 * rope, lk = t.lcl * lerp(p.leanK * ss(0, 0.3, k) * (p.shape === 'wedge' ? 0.55 : 1), p.ropeLean, rope);
  t.lean.x = Math.sin(la) * lk; t.lean.z = -Math.cos(la) * lk;
  // ---- motion: with the storm, later left turn (occlusion) and meander
  if (parent) {                                                                    // satellite orbiting its parent
    const a = t.o.orbA - t.age * 0.5 * parent.vmax * 0.35 / t.o.orbR * parent.spin; t.vx = parent.vx; t.vz = parent.vz;
    t.x = parent.x + Math.cos(a) * t.o.orbR; t.z = parent.z + Math.sin(a) * t.o.orbR;
  } else {
    const svx = st ? st.vx : 0, svz = st ? st.vz : 0, sp = Math.hypot(svx, svz) || 1, fx = svx / sp, fz = svz / sp;
    const occ = ss(0.3, 0.85, k), lat = -p.left * occ + 2.6 * gnoise(now / 60, p.meander, 7) * ss(0.1, 0.3, k), bk = -(p.left * 0.75 * occ + sp * p.slow * ss(0.15, 0.4, k)) + 1.5 * gnoise(now / 45, p.meander, 8);
    const mov = t.o.still ? 0 : 1;
    t.vx = (svx + fx * bk - fz * lat) * mov; t.vz = (svz + fz * bk + fx * lat) * mov;                  // right of motion = (-fz, fx)
    t.x += t.vx * dt; t.z += t.vz * dt; if (t.onGround) t.pathLen += Math.hypot(t.vx, t.vz) * dt;
    if (t.ex || t.ez) { const q = 1 - Math.exp(-dt * 1.6); t.x += t.ex * q; t.z += t.ez * q; t.ex *= 1 - q; t.ez *= 1 - q; } // network correction
  }
  if (world) {
    const g = world.heightAt?.(t.x, t.z) ?? 0; t.y0 = t.age <= dt * 1.5 || Math.abs(g - t.y0) > 400 ? g : t.y0 + (g - t.y0) * (1 - Math.exp(-dt * 1.2));
    if (!t._bioT || now - t._bioT > 1.5) {
      t._bioT = now; const b = world.biomeAt?.(t.x, t.z), wet = world.waterLevelAt?.(t.x, t.z) > g;
      t.humidity = b?.humidity ?? 0.6; t.overWater = wet; t.biome = b?.id;
      t.dustiness = wet ? 0.25 : b?.id === "forest" ? 0.5 : b?.id === "swamp" || b?.id === "coast" ? 0.35 : b?.id === "urban" ? 0.9 : 0.8;
      const c = wet ? [0.62, 0.66, 0.68] : b?.dustColor || [0.42, 0.32, 0.22]; t._dc = c; if (t.age < 2) for (let i = 0; i < 3; i++) t.dustColor[i] = c[i];
    }
    if (t._dc) for (let i = 0; i < 3; i++) t.dustColor[i] += (t._dc[i] - t.dustColor[i]) * Math.min(1, dt * 0.25);
  }
  // ---- sub-vortices
  const S = p.swirl * (0.55 + 0.6 * s), multi = ss(0.72, 0.95, S) * ss(0.16, 0.34, k) * (1 - ss(0.74, 0.86, k)), n = multi > 0.02 ? p.nSub : 0;
  t.swirl = S;
  if (t.sub.length !== n) { t.sub.length = 0; for (let i = 0; i < n; i++) t.sub.push(t._subs[i]); }
  for (let i = 0; i < n; i++) {
    const v = t._subs[i], w = 0.5 + 0.5 * gnoise(now / 7, v.ph, 9);
    v.r = t.rCore * (0.82 + 0.22 * gnoise(now / 11, v.ph, 10)); v.rc = Math.max(6, t.rCore * lerp(0.16, 0.27, w)); v.s = multi * clamp(0.15 + 1.1 * w) * 0.62;
    v.a -= t.spin * t.vmax * 0.52 / Math.max(10, t.rCore) * (1 + 0.15 * Math.sin(v.ph)) * dt;
  }
  return k >= 1;
}

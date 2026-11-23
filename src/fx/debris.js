// CPU simulated large debris: drag in the real wind field, tumbling, ground contact, hits on the player.
import * as THREE from 'three';
import { GEO } from './debrisGeo.js';
import { clamp, smoothstep } from '../core/math.js';

// vt = terminal velocity (m/s): aerodynamic drag acceleration = g (u/vt)^2
const KIND = {
  plank: { cap: 90, vt: 15, mass: 9, r: 1.0, scale: [0.5, 1.15], col: 1 }, beam: { cap: 24, vt: 23, mass: 45, r: 1.5, scale: [0.6, 1.1], col: 1 }, sheet: { cap: 60, vt: 11.5, mass: 16, r: 1.1, scale: [0.6, 1.4], col: 2 }, branch: { cap: 60, vt: 13, mass: 14, r: 1.2, scale: [0.5, 1.3] },
  tree: { cap: 12, vt: 31, mass: 900, r: 3.2, scale: [0.6, 1.2] }, roof: { cap: 16, vt: 21, mass: 260, r: 2, scale: [0.6, 1.3] }, wall: { cap: 20, vt: 19, mass: 120, r: 1.4, scale: [0.6, 1.2], col: 3 }, fence: { cap: 22, vt: 18, mass: 40, r: 1.2, scale: [0.7, 1.1] }, bale: { cap: 12, vt: 29, mass: 380, r: 0.8, scale: [0.9, 1.15] }, car: { cap: 7, vt: 43, mass: 1350, r: 2, scale: [0.95, 1.05], col: 4 },
};
const TINT = { 1: [[1, 1, 1], [0.8, 0.75, 0.7], [1.25, 1.2, 1.1], [0.6, 0.6, 0.62]], 2: [[1, 1, 1], [0.9, 0.55, 0.45], [0.6, 0.75, 0.65], [1.3, 1.3, 1.3]], 3: [[1.2, 1.2, 1.2], [0.9, 0.85, 0.65], [0.65, 0.8, 0.95], [1, 0.6, 0.5]], 4: [[1, 1, 1], [1.9, 0.35, 0.3], [0.4, 0.6, 1.3], [2.2, 2.2, 2.2], [0.3, 0.3, 0.32]] };
const BY_BIOME = { plains: ['plank', 'sheet', 'fence', 'bale', 'branch', 'plank'], wheat: ['plank', 'bale', 'sheet', 'fence', 'plank'], cornbelt: ['plank', 'sheet', 'branch', 'beam', 'fence', 'bale'], desert: ['branch', 'sheet', 'plank', 'fence'], mountain: ['branch', 'branch', 'tree', 'plank'], forest: ['branch', 'tree', 'branch', 'branch', 'plank'], swamp: ['branch', 'branch', 'plank', 'sheet'], coast: ['plank', 'sheet', 'branch', 'roof'], urban: ['plank', 'sheet', 'roof', 'wall', 'beam', 'car', 'plank', 'sheet'] };
export const breakSet = (k = '') => { // world break kind -> [[kind, count]...]
  k = String(k).toLowerCase();
  if (/tree|pine|oak|palm|cypress/.test(k)) return [['tree', 1], ['branch', 4]]; if (/branch|shrub|bush|corn/.test(k)) return [['branch', 2]]; if (/fence|rail/.test(k)) return [['fence', 1], ['plank', 1]]; if (/pole|tower|windmill|turbine/.test(k)) return [['beam', 2], ['sheet', 1]]; if (/sign|billboard/.test(k)) return [['sheet', 1], ['beam', 1]];
  if (/bale|hay/.test(k)) return [['bale', 1]]; if (/car|truck|vehicle/.test(k)) return [['car', 1]]; if (/silo|tank|hangar|warehouse|gas|store|office/.test(k)) return [['sheet', 8], ['beam', 2], ['wall', 2]]; if (/barn|shed/.test(k)) return [['plank', 10], ['sheet', 5], ['beam', 3], ['roof', 1]]; if (/house|home|build|church|motel|trailer/.test(k)) return [['roof', 2], ['wall', 3], ['plank', 9], ['beam', 3], ['sheet', 2]];
  return KIND[k] ? [[k, 1]] : [['plank', 2]];
};

export function createDebris(ctx, particles) {
  const q = Math.max(0.35, Math.min(1.3, ctx.quality.particles)), pools = {}, all = [], mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.02, side: THREE.DoubleSide }), metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.55, side: THREE.DoubleSide }); mat.fog = metal.fog = false;
  const m4 = new THREE.Matrix4(), P = new THREE.Vector3(), SC = new THREE.Vector3(), dq = new THREE.Quaternion(), ax = new THREE.Vector3(), w = new THREE.Vector3(), col = new THREE.Color();
  for (const k in KIND) {
    const c = Math.max(4, Math.round(KIND[k].cap * q)), mesh = new THREE.InstancedMesh(GEO[k](), k === 'sheet' || k === 'car' ? metal : mat, c); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.count = 0; mesh.visible = false; mesh.name = 'debris-' + k;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(c * 3).fill(1), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); ctx.scene.add(mesh); const pl = (pools[k] = { mesh, cap: c, items: [], K: KIND[k], k, next: 0 });
    for (let i = 0; i < c; i++) { const d = { on: false, pool: pl, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), av: new THREE.Vector3(), s: 1, rest: 0, age: 0, auto: false, hit: 0, air: true, col: [1, 1, 1], vt: 15, gT: 0, gy: 0, far: false }; pl.items.push(d); all.push(d); }
  }
  let autoN = 0, spT = 0;
  function spawn(kind, pos, vel, auto) {
    const pl = pools[kind]; if (!pl) return null; let d = null; for (let i = 0; i < pl.cap; i++) { const e = pl.items[(pl.next + i) % pl.cap]; if (!e.on) { d = e; pl.next = (pl.next + i + 1) % pl.cap; break; } }
    if (!d) { if (auto) return null; let best = -1; for (const e of pl.items) { const sc = e.rest * 2 + (e.auto ? 4 : 0) + e.age * 0.05; if (sc > best) { best = sc; d = e; } } }
    const K = pl.K; d.on = true; d.p.set(pos.x, pos.y, pos.z); d.v.set(vel?.x || 0, vel?.y || 0, vel?.z || 0); d.q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(); const t = 7 / (0.6 + K.r); d.av.set((Math.random() - 0.5) * t, (Math.random() - 0.5) * t, (Math.random() - 0.5) * t);
    d.s = K.scale[0] + (K.scale[1] - K.scale[0]) * Math.random(); d.rest = 0; d.age = 0; d.auto = !!auto; d.hit = 0; d.air = true; d.vt = K.vt * (0.8 + 0.4 * Math.random()); d.gT = 0; const T = K.col ? TINT[K.col][(Math.random() * TINT[K.col].length) | 0] : null, kk = 0.75 + 0.5 * Math.random(); d.col = T ? [T[0] * kk, T[1] * kk, T[2] * kk] : [kk, kk, kk]; return d;
  }
  function burst(kind, pos, vel) { const set = breakSet(kind); for (const [k, n] of set) for (let i = 0; i < Math.max(1, Math.round(n * q)); i++) { P.set(pos.x + (Math.random() - 0.5) * 3, pos.y + 0.6 + Math.random() * 2.5, pos.z + (Math.random() - 0.5) * 3); ctx.storms?.windAt?.(P.x, P.y + 4, P.z, w); const f = 0.25 + 0.4 * Math.random(); w.multiplyScalar(f); w.y += 2 + Math.random() * 5; if (vel) { w.x += (vel.x || 0) * 0.5; w.y += (vel.y || 0) * 0.5; w.z += (vel.z || 0) * 0.5; } w.x += (Math.random() - 0.5) * 5; w.z += (Math.random() - 0.5) * 5; spawn(k, P, w, false); } }
  function loft(dt, cam) { // keep the near tornado carrying debris
    const ts = ctx.storms?.tornadoes; if (!ts) return; let t = null, bd = 4200; for (const a of ts) { const d = Math.hypot(a.x - cam.x, a.z - cam.z); if (a.onGround !== false && a.vmax > 33 && d < bd) { bd = d; t = a; } }
    if (!t) return; const want = clamp((t.vmax - 30) * 2.2, 0, 150) * q * (t.overWater ? 0.1 : 1); if (autoN >= want) return; spT += dt * (6 + t.vmax * 0.35); const list = BY_BIOME[t.biome] || BY_BIOME.plains;
    while (spT > 1) { spT--; const a = Math.random() * 6.283, r = t.rCore * (0.75 + 0.7 * Math.random()), x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r, k = list[(Math.random() * list.length) | 0]; if (KIND[k].vt * 1.55 > t.vmax) continue; P.set(x, ctx.world.heightAt(x, z) + 2 + 40 * Math.random() ** 2, z); ctx.storms.windAt(P.x, P.y, P.z, w); w.multiplyScalar(0.65); w.y = Math.max(w.y, 3) + 5 * Math.random(); spawn(k, P, w, true); }
  }
  const hitEv = { speed: 0, mass: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), kind: '', vehicle: null };
  return {
    spawn, burst, pools,
    get count() { let n = 0; for (const d of all) if (d.on) n++; return n; },
    update(dt, cam) {
      loft(dt, cam); autoN = 0; const W = ctx.world, pp = ctx.player?.pos, veh = ctx.player?.vehicle, pv = veh?.vel, hr = veh ? 2.1 : 0.7, h = Math.min(dt, 0.05);
      for (const k in pools) pools[k].n = 0;
      for (let i = 0; i < all.length; i++) {
        const d = all[i]; if (!d.on) continue; const K = d.pool.K; d.age += dt; if (d.auto) autoN++; if (d.hit > 0) d.hit -= dt;
        const dc = Math.hypot(d.p.x - cam.x, d.p.z - cam.z);
        if (d.rest > 0) { d.rest += dt; if (d.rest > (d.auto ? 14 : 75) || (d.auto && d.rest > 2 && dc > 260) || dc > 1500) d.on = false; else if (((i + ctx.time.frame) & 15) === 0) { ctx.storms.windAt(d.p.x, d.p.y + 1, d.p.z, w); if (w.length() > d.vt * 1.9) { d.rest = 0; d.air = true; d.v.y += 3; } } }
        else {
          ctx.storms.windAt(d.p.x, d.p.y, d.p.z, w); const ux = w.x - d.v.x, uy = w.y - d.v.y, uz = w.z - d.v.z, um = Math.sqrt(ux * ux + uy * uy + uz * uz), k = 9.81 * um / (d.vt * d.vt) * (0.75 + 0.5 * Math.abs(Math.sin(d.age * 2.3 + i)));
          const kk = Math.min(k * h, 0.9); d.v.x += ux * kk; d.v.y += uy * kk - 9.81 * h; d.v.z += uz * kk; d.p.addScaledVector(d.v, h); const tq = um * 0.5 / (0.5 + K.r); d.av.x += (Math.sin(d.age * 1.7 + i) * tq - d.av.x * 0.5) * h; d.av.y += (Math.cos(d.age * 1.3 + i * 2) * tq - d.av.y * 0.5) * h; d.av.z += (Math.sin(d.age * 2.1 + i * 3) * tq - d.av.z * 0.5) * h;
          const an = d.av.length(); if (an > 1e-3) { dq.setFromAxisAngle(ax.copy(d.av).multiplyScalar(1 / an), an * h); d.q.premultiply(dq).normalize(); }
          if ((d.gT -= dt) < 0) { d.gy = W ? W.heightAt(d.p.x, d.p.z) : 0; d.gT = d.p.y - d.gy > 30 ? 0.4 : d.p.y - d.gy > 8 ? 0.12 : 0; }
          const low = d.gy + K.r * d.s * 0.32; if (d.p.y < low) {
            if (W && d.gT > 0) d.gy = W.heightAt(d.p.x, d.p.z); d.p.y = low; const vy = -d.v.y; if (vy > 4 && dc < 220) { const b = ctx.storms ? W.biomeAt?.(d.p.x, d.p.z)?.dustColor || [0.4, 0.3, 0.2] : [0.4, 0.3, 0.2]; for (let j = 0; j < 3; j++) particles.emit(0, d.p.x, d.gy + 0.4, d.p.z, d.v.x * 0.3 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, d.v.z * 0.3 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 1.5, 0.5 * K.r, 2.2 * K.r, b[0], b[1], b[2], 0.4, 1.4, w.x * 0.5, 0, w.z * 0.5); if (vy > 8 && dc < 120) ctx.events.emit('fx:debris-ground', { pos: d.p, kind: d.pool.k, speed: vy, mass: K.mass }); }
            d.v.y = Math.max(0, vy * 0.32); const fr = Math.exp(-h * 3.2); d.v.x *= fr; d.v.z *= fr; d.av.multiplyScalar(Math.exp(-h * 2)); if (d.v.lengthSq() < 1.2 && um < d.vt * 1.6) { d.rest = 0.01; d.v.set(0, 0, 0); }
          }
          if (d.p.y - d.gy > 1200 || dc > 5200 || d.age > 150) d.on = false;
          // ---- player / vehicle hit
          if (pp && d.hit <= 0 && dc < 60) { const dx = d.p.x - pp.x, dy = d.p.y - (pp.y + 0.8), dz = d.p.z - pp.z, rr = hr + K.r * d.s * 0.6; if (dx * dx + dy * dy + dz * dz < rr * rr) { const vx = d.v.x - (pv?.x || 0), vy = d.v.y - (pv?.y || 0), vz = d.v.z - (pv?.z || 0), sp = Math.sqrt(vx * vx + vy * vy + vz * vz); if (sp > 3.5) { d.hit = 1; hitEv.speed = sp; hitEv.mass = K.mass * d.s; hitEv.pos.copy(d.p); hitEv.vel.set(vx, vy, vz); hitEv.kind = d.pool.k; hitEv.vehicle = veh || null; ctx.events.emit('fx:debris-hit', hitEv); if (K.mass > 12 && (d.pool.k === 'sheet' || veh)) api_spark(d.p, 14); d.v.multiplyScalar(-0.2); d.v.y += 2; } } }
        }
        if (!d.on) continue; const pl = d.pool, n = pl.n++; m4.compose(d.p, d.q, SC.setScalar(d.s)); pl.mesh.setMatrixAt(n, m4); const c = pl.mesh.instanceColor.array; c[n * 3] = d.col[0]; c[n * 3 + 1] = d.col[1]; c[n * 3 + 2] = d.col[2];
      }
      for (const k in pools) { const pl = pools[k]; pl.mesh.count = pl.n; pl.mesh.visible = pl.n > 0; if (pl.n) { pl.mesh.instanceMatrix.needsUpdate = true; pl.mesh.instanceColor.needsUpdate = true; } }
    },
    clear() { for (const d of all) d.on = false; },
  };
  function api_spark(p, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, s = 2 + Math.random() * 7; particles.emit(1, p.x, p.y, p.z, Math.cos(a) * s, Math.random() * 6, Math.sin(a) * s, 0.25 + Math.random() * 0.4, 0.012, 0.006, 14, 10, 6, 1, 1); } }
}

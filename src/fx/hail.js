// Hail: CPU bouncing stones near the camera, GPU streak layer further out, accumulating stones on the ground.
import * as THREE from 'three';
import { streakLayer } from './rain.js';
import { clamp } from '../core/math.js';

function stoneGeo(seed, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = Math.sin(v.x * 4.1 + seed) * Math.sin(v.y * 3.7 + seed * 2) * Math.sin(v.z * 4.4 - seed); v.multiplyScalar(1 + 0.16 * n); v.y *= 0.86; p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
export function createHail(ctx, soft, particles) {
  const q = Math.max(0.3, ctx.quality.particles), N = Math.round(320 * q), M = Math.round(2600 * q);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xdfe8ee, roughness: 0.28, metalness: 0, transmission: 0, clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 1.15 }); mat.fog = false;
  const fall = new THREE.InstancedMesh(stoneGeo(1.3), mat, N); fall.frustumCulled = false; fall.castShadow = false; fall.receiveShadow = true; fall.instanceMatrix.setUsage(THREE.DynamicDrawUsage); fall.count = 0; ctx.scene.add(fall);
  const lie = new THREE.InstancedMesh(stoneGeo(2.1, 0), mat, M); lie.frustumCulled = false; lie.receiveShadow = true; lie.instanceMatrix.setUsage(THREE.DynamicDrawUsage); lie.count = 0; lie.visible = false; ctx.scene.add(lie);
  const layer = streakLayer(ctx, soft, { n: Math.round(1500 * q), box: [46, 24, 46], w: 0.007, alpha: 2.2, near: 7, fade: 6, shutter: 1 / 75, seed: 61, minPx: 0.7, solid: 1, tint: [0.95, 0.98, 1.02], curtain: 0.3, order: 19 });
  const S = []; for (let i = 0; i < N; i++) S.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0.01, b: 0, gy: 0, rx: Math.random() * 6, ry: Math.random() * 6, wx: 0, wy: 0, rest: 0 });
  const L = { born: new Float32Array(M).fill(-1e6), life: new Float32Array(M), x: new Float32Array(M), y: new Float32Array(M), z: new Float32Array(M), r: new Float32Array(M), n: 0, head: 0 };
  const m4 = new THREE.Matrix4(), e = new THREE.Euler(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(); let acc = 0, lieAcc = 0, meltT = 0, now = 0, cm = 1; const vel = new THREE.Vector3(); let hitT = 0;
  const settle = (x, y, z, r) => { const i = L.head; L.head = (L.head + 1) % M; L.n = Math.max(L.n, i + 1); L.born[i] = now; L.life[i] = 90 + Math.random() * 120; L.x[i] = x; L.y[i] = y; L.z[i] = z; L.r[i] = r; Q.setFromEuler(e.set(Math.random() * 6, Math.random() * 6, 0)); m4.compose(P.set(x, y, z), Q, Sc.setScalar(r)); lie.setMatrixAt(i, m4); lie.count = L.n; lie.visible = true; lie.instanceMatrix.needsUpdate = true; };
  return {
    update(dt, hail, hailCm, wind, camVel, cam, px) {
      now += dt; const w = ctx.world; if (hailCm > 0) cm += (hailCm - cm) * Math.min(1, dt); const vt = 7.5 + 3.6 * Math.sqrt(cm);                 // ~11 m/s at 1 cm, ~19 at 10 cm
      vel.set(wind.x * 0.55, -vt, wind.z * 0.55); layer.u.uW.value = 0.0028 + 0.0016 * cm; layer.update(dt, hail * 0.85, vel, camVel, cam, px, wind);
      // ---- near stones
      acc += dt * hail * N * 1.25; let spawn = Math.min(8, Math.floor(acc)); acc -= spawn; let shown = 0;
      for (let i = 0; i < N; i++) {
        const s = S[i];
        if (!s.on) { if (spawn > 0 && w) { spawn--; const a = Math.random() * 6.283, d = 14 * Math.sqrt(Math.random()), h = 6 + Math.random() * 5, tf = h / vt; s.on = true; s.x = cam.x + camVel.x * tf + Math.cos(a) * d - vel.x * tf; s.z = cam.z + camVel.z * tf + Math.sin(a) * d - vel.z * tf; s.gy = w.heightAt(s.x + vel.x * tf, s.z + vel.z * tf); s.y = s.gy + h; s.vx = vel.x; s.vy = -vt; s.vz = vel.z; s.r = 0.005 * cm * (0.35 + 0.65 * Math.random()); s.b = 0; s.rest = 0; s.wx = (Math.random() - 0.5) * 30; s.wy = (Math.random() - 0.5) * 30; } else continue; }
        if (s.rest > 0) { s.rest -= dt; if (s.rest <= 0) { s.on = false; settle(s.x, s.y, s.z, s.r); continue; } }
        else {
          s.vy -= 9.81 * dt * (s.b ? 1 : 0.1); s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.rx += s.wx * dt; s.ry += s.wy * dt;
          if (s.y < s.gy + s.r * 0.7) {
            s.y = s.gy + s.r * 0.7; const sp = -s.vy; s.b++; const soft1 = 0.2 + 0.25 * Math.random(); s.vy = sp * soft1; s.vx = s.vx * 0.45 + (Math.random() - 0.5) * sp * 0.28; s.vz = s.vz * 0.45 + (Math.random() - 0.5) * sp * 0.28; s.wx *= 0.6; s.wy *= 0.6;
            if (s.b === 1 && particles && Math.random() < 0.35) particles.emit(2, s.x, s.y + 0.01, s.z, s.vx * 0.2, 0.7 + Math.random(), s.vz * 0.2, 0.3, 0.02, 0.07, 0.9, 0.95, 1, 0.22, 2);
            if (s.vy < 0.5 || s.b > 5) { s.rest = 0.2; s.vy = 0; } else { s.gy = w.heightAt(s.x + s.vx * 0.15, s.z + s.vz * 0.15); }
          }
        }
        e.set(s.rx, s.ry, 0); Q.setFromEuler(e); m4.compose(P.set(s.x, s.y, s.z), Q, Sc.setScalar(Math.max(s.r, 0.003))); fall.setMatrixAt(shown++, m4);
      }
      fall.count = shown; fall.visible = shown > 0; if (shown) fall.instanceMatrix.needsUpdate = true;
      // ---- ground accumulation around the camera
      if (hail > 0.05 && w) { lieAcc += dt * hail * 34; while (lieAcc > 1) { lieAcc--; const a = Math.random() * 6.283, d = 3 + 30 * Math.sqrt(Math.random()), x = cam.x + Math.cos(a) * d + camVel.x * 1.5, z = cam.z + Math.sin(a) * d + camVel.z * 1.5, r = 0.005 * cm * (0.3 + 0.7 * Math.random()); settle(x, w.heightAt(x, z) + r * 0.6, z, Math.max(r, 0.004)); } }
      if ((meltT -= dt) < 0 && L.n) { meltT = 0.5; let live = 0; const step = Math.ceil(L.n / 1); for (let i = 0; i < step; i++) { const a = now - L.born[i]; if (a < L.life[i]) { live++; if (a > L.life[i] * 0.6) { const k = 1 - (a / L.life[i] - 0.6) / 0.4; m4.makeScale(L.r[i] * k, L.r[i] * k, L.r[i] * k); m4.setPosition(L.x[i], L.y[i], L.z[i]); lie.setMatrixAt(i, m4); } } else if (L.life[i] > 0) { m4.makeScale(0, 0, 0); lie.setMatrixAt(i, m4); L.life[i] = 0; } } lie.instanceMatrix.needsUpdate = true; lie.visible = live > 0; }
      // ---- big hail hurts
      if (hail > 0.15 && cm > 2 && (hitT -= dt) < 0) { hitT = 0.12 + Math.random() * 0.5 / hail; const p = ctx.player?.pos; if (p) ctx.events.emit('fx:hail-hit', { speed: vt, mass: 480 * Math.PI * Math.pow(cm * 0.01, 3), cm, pos: p }); }
    },
  };
}

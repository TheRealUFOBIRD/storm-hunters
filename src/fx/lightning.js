// Branching lightning channels: recursive midpoint displacement, camera-facing HDR ribbons, stepped leader + return strokes.
import * as THREE from 'three';
import { rng } from '../core/rng.js';
import { noCull } from './common.js';

const MAXSEG = 2200;
const VS = /* glsl */`
attribute vec3 aNext; attribute vec4 aD; // side, width, brightness, t(0..1 along leader time)
uniform float uPx, uGrow, uWScale; varying float vS, vB, vTm, vCore; varying vec3 vW;
void main(){
  vec4 a = viewMatrix * vec4(position, 1.0), b = viewMatrix * vec4(aNext, 1.0); a.xyz += vec3(0.0); vec3 d = b.xyz - a.xyz; vec2 n = normalize(vec2(-d.y, d.x) + vec2(1e-5)); float dist = max(-a.z, 1.0);
  float core = aD.y * uWScale, w = max(core, dist * uPx * .9) ; float halo = 7.0; vCore = min(1.0, core / (dist * uPx * .9) + .25);
  a.xy += n * aD.x * w * halo; vS = aD.x * halo; vB = aD.z; vTm = aD.w; vW = position; gl_Position = projectionMatrix * a;
}`;
const FS = /* glsl */`
uniform float uI, uLeader, uGrow, uTrans; uniform vec3 uCloud; varying float vS, vB, vTm, vCore; varying vec3 vW;
void main(){
  float x = abs(vS), core = exp(-x * x * 2.2), halo = .045 * exp(-x * .62) * (1.0 - smoothstep(5.0, 7.0, x)); float vis = step(vTm, uGrow);
  float tip = uLeader * exp(-max(uGrow - vTm, 0.0) * 22.0) * vis; float i = uI * vB + (tip * .55 + uLeader * .03) * vis;
  float cl = 1.0 - smoothstep(uCloud.x, uCloud.y, vW.y); cl = mix(1.0, max(cl, .0), uCloud.z);
  vec3 c = mix(vec3(.55, .62, 1.0), vec3(1.0, .97, .95), core); gl_FragColor = vec4(c * (core * vCore + halo) * i * cl * uTrans, 0.0);
}`;

export function createLightning(ctx, particles) {
  const pool = [], R = new THREE.Vector3(), T = new THREE.Vector3(); const prm = Math.max(0.4, Math.min(1, ctx.quality.particles));
  for (let i = 0; i < 7; i++) {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(MAXSEG * 12), nxt = new Float32Array(MAXSEG * 12), d = new Float32Array(MAXSEG * 16), idx = new Uint16Array(MAXSEG * 6);
    for (let k = 0; k < MAXSEG; k++) idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 2, k * 4 + 1, k * 4 + 3], k * 6);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aNext', new THREE.BufferAttribute(nxt, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aD', new THREE.BufferAttribute(d, 4).setUsage(THREE.DynamicDrawUsage)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
    const u = { uPx: { value: 0.001 }, uI: { value: 0 }, uLeader: { value: 0 }, uGrow: { value: 0 }, uWScale: { value: 1 }, uTrans: { value: 1 }, uCloud: { value: new THREE.Vector3(0, 1, 1) } };
    const m = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: u, transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
    const mesh = noCull(new THREE.Mesh(g, m), 30); mesh.visible = false; ctx.fxScene.add(mesh); pool.push({ mesh, g, u, pos, nxt, d, n: 0, t: -1, strokes: [], leader: 0, ev: null, fired: 0, dur: 0 });
  }
  let B = null, ml = 1;
  const seg = (ax, ay, az, bx, by, bz, w, b, t0, t1) => {
    if (B.n >= MAXSEG) return; const k = B.n++, p = B.pos, n = B.nxt, d = B.d; let o = k * 12, q = k * 16; const ex = bx + (bx - ax), ey = by + (by - ay), ez = bz + (bz - az);
    for (let v = 0; v < 4; v++) { const end = v > 1; p[o] = end ? bx : ax; p[o + 1] = end ? by : ay; p[o + 2] = end ? bz : az; n[o] = end ? ex : bx; n[o + 1] = end ? ey : by; n[o + 2] = end ? ez : bz; o += 3; d[q] = v & 1 ? 1 : -1; d[q + 1] = w; d[q + 2] = b; d[q + 3] = end ? t1 : t0; q += 4; }
  };
  function channel(r, a, b, rough, depth, w, br, t0, t1, branchP, down) {
    // midpoint displacement into a point list
    let pts = [a, b]; const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); let amp = len * rough;
    for (let i = 0; i < depth; i++) { const o = [pts[0]]; for (let k = 1; k < pts.length; k++) { const p = pts[k - 1], q = pts[k]; o.push([(p[0] + q[0]) / 2 + (r() - 0.5) * amp, (p[1] + q[1]) / 2 + (r() - 0.5) * amp * 0.55, (p[2] + q[2]) / 2 + (r() - 0.5) * amp], q); } pts = o; amp *= 0.53; }
    const N = pts.length - 1;
    for (let k = 0; k < N; k++) { const f0 = k / N, f1 = (k + 1) / N, j = 1 - 0.25 * r(); seg(...pts[k], ...pts[k + 1], w * (branchP ? 1 : 1 - 0.7 * f0), br * j * (down ? 1 - 0.85 * f0 : 1), t0 + (t1 - t0) * f0, t0 + (t1 - t0) * f1);
      if (branchP && k > N * 0.06 && r() < branchP * (1 - f0 * 0.65)) {
        const p = pts[k], L = len * (0.1 + 0.28 * r()) * (1 - f0 * 0.6), dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len, dz = (b[2] - a[2]) / len, s = 1.7;
        const q = [p[0] + (dx + (r() - 0.5) * 2 * s) * L, p[1] + (dy * 0.55 + (r() - 0.5) * 0.45) * L, p[2] + (dz + (r() - 0.5) * 2 * s) * L]; const tb = t0 + (t1 - t0) * f0;
        channel(r, p, q, 0.3, Math.max(2, depth - 2), w * 0.45, br * (0.2 + 0.25 * r()), tb, Math.min(1, tb + 0.35), depth > 5 && depth < 8 && r() < 0.55 ? 0.05 : 0, true);
      } }
  }
  const trans = (x, y, z) => { try { const v = ctx.gfx?.visibilityAlong?.(x, y, z); if (Number.isFinite(v)) return v; } catch { /* not ready */ } const d = ctx.camera.position.distanceTo(T.set(x, y, z)); return Math.exp(-d / 26000); };
  function strike(e) {
    const c = ctx.camera.position, dist = Math.hypot(e.x - c.x, e.z - c.z); const vis = e.kind === 'cg' ? dist < 26000 : e.anvil ? dist < 16000 : dist < 9000 && e.seed % 4 === 0;
    const r = rng(e.seed >>> 0), nS = e.kind === 'cg' ? 1 + Math.floor(r() * 4.2) : 2 + Math.floor(r() * 4), leader = e.strokes ? e.strokes[0][0] : e.kind === 'cg' ? 0.05 + r() * 0.09 : 0.25 + r() * 0.5; const st = []; let t = leader;
    if (e.strokes) { for (const q of e.strokes) st.push({ t: q[0], e: q[1] * e.energy, tau: q[2] }); t = st[st.length - 1].t; } else
    for (let i = 0; i < nS; i++) { st.push({ t, e: (i ? 0.35 + 0.6 * r() : 1) * e.energy, tau: 0.045 + 0.05 * r() + (i === nS - 1 ? 0.08 * r() : 0) }); t += 0.045 + r() * 0.12; }
    let b = null; if (vis) { for (const p of pool) if (p.t < 0) { b = p; break; } }
    const job = b || { mesh: null }; job.strokes = st; job.leader = leader; job.ev = e; job.fired = 0; job.t = 0; job.dur = t + 0.35; job.hitDone = false;
    if (!b) { hidden.push(job); return; }
    B = b; b.n = 0; const a = [e.x, e.y, e.z], z = [e.tx, e.ty, e.tz], cg = e.kind === 'cg';
    if (cg) channel(r, a, z, 0.34, prm > 0.7 ? 8 : 6, 0.75, 1, 0, 1, prm > 0.7 ? 0.055 : 0.1, false);
    else if (e.anvil) { const k = 3 + Math.floor(r() * 3); for (let i = 0; i < k; i++) { const an = (i / k + r() * 0.2) * 1.6 - 0.8, dx = z[0] - a[0], dz = z[2] - a[2], cs = Math.cos(an), sn = Math.sin(an), f = 0.5 + 0.6 * r(); channel(r, a, [a[0] + (dx * cs - dz * sn) * f, z[1] + (r() - 0.5) * 300, a[2] + (dx * sn + dz * cs) * f], 0.2, 6, 0.7, 0.5, 0, 0.7 + 0.3 * r(), 0.09, false); } }
    else channel(r, a, z, 0.3, 6, 0.8, 0.5, 0, 1, 0.08, false);
    b.g.setDrawRange(0, b.n * 6); for (const k of ['position', 'aNext', 'aD']) b.g.attributes[k].needsUpdate = true; b.mesh.visible = true;
    const base = e.y - (cg ? 260 : 0); b.u.uCloud.value.set(cg ? base - 60 : 1e6, cg ? base + 200 : 1e6 + 1, cg ? 1 : 0); b.u.uTrans.value = (cg ? Math.max(0.12, trans(e.tx * 0.6 + e.x * 0.4, e.ty + 400, e.tz * 0.6 + e.z * 0.4)) : 0.16 * Math.max(0.2, trans(e.x, e.y, e.z)));
    b.u.uWScale.value = 1.1 + r() * 0.8;
  }
  const hidden = [];
  function advance(j, dt) {
    j.t += dt; let I = 0; for (let i = 0; i < j.strokes.length; i++) { const s = j.strokes[i], a = j.t - s.t; if (a >= 0) { I += s.e * Math.exp(-a / s.tau) * Math.min(1, a / 0.004 + 0.4); if (i >= j.fired) { j.fired = i + 1; const e = j.ev, m = 0.45; if (ctx.gfx?.fake) ctx.gfx.flash(e.x * (1 - m) + e.tx * m, e.kind === 'cg' ? e.y * 0.8 + e.ty * 0.2 : e.y, e.z * (1 - m) + e.tz * m, s.e); } } }
    if (j.ev.kind === 'cg' && !j.hitDone && j.t >= j.leader) { j.hitDone = true; const e = j.ev; if (Math.hypot(e.tx - ctx.camera.position.x, e.tz - ctx.camera.position.z) < 1500) impact(e); }
    return I;
  }
  function impact(e) { // sparks, soil puff and glow at the strike point
    if (!particles) return; particles.emit(5, e.tx, e.ty + 2, e.tz, 0, 0, 0, 0.35, 16, 22, 14, 16, 22, 1, 1);
    for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, s = 4 + Math.random() * 16; particles.emit(1, e.tx, e.ty + 0.3, e.tz, Math.cos(a) * s, 4 + Math.random() * 14, Math.sin(a) * s, 0.5 + Math.random() * 0.8, 0.03, 0.01, 9, 9, 9, 1, 0.6); }
    for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28, s = 1 + Math.random() * 4; particles.emit(0, e.tx, e.ty + 0.6, e.tz, Math.cos(a) * s, 2 + Math.random() * 5, Math.sin(a) * s, 2 + Math.random() * 2.5, 0.6, 3 + Math.random() * 3, 0.3, 0.25, 0.2, 0.5, 1.6); }
  }
  const off = ctx.events.on('lightning', strike);
  return {
    strike,
    update(dt, px) {
      for (const b of pool) { if (b.t < 0) continue; const I = advance(b, dt); b.u.uPx.value = px; b.u.uGrow.value = Math.min(1, b.t / b.leader); b.u.uLeader.value = b.t < b.leader ? 2.2 : 0; b.u.uI.value = I * 42; if (b.t > b.dur) { b.t = -1; b.mesh.visible = false; } }
      for (let i = hidden.length - 1; i >= 0; i--) { advance(hidden[i], dt); if (hidden[i].t > hidden[i].dur) hidden.splice(i, 1); }
    },
    dispose() { off(); },
  };
}

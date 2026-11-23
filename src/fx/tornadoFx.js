// GPU tornado debris (instanced shards on analytic helical orbits), lit dust puffs at the base, inflow streamers, power flashes.
import * as THREE from 'three';
import { AXIS_GLSL, FUNNEL_GLSL, packTornado } from '../sim/tornadoAxis.js';
import { LIGHT_GLSL, SOFT_GLSL, PUFF_GLSL, quad, seeds, fxMat, lightUniforms, noCull, puffAtlas } from './common.js';
import { clamp, smoothstep, damp } from '../core/math.js';

const COMMON = /* glsl */`
${AXIS_GLSL}${FUNNEL_GLSL}
uniform vec4 uA, uB, uC, uT; // uT: swirl phase, life phase, dustR, dust
uniform vec4 uSub[5]; uniform float uSubN, uSpin, uTime, uVmax, uAmt; uniform float uRing[8]; uniform vec3 uDustCol;
float tfGround(float ang, float r){ float a = fract(ang / 6.2831853) * 8.0; int i = int(a) % 8, j = (i + 1) % 8; return mix(uA.z, mix(uRing[i], uRing[j], fract(a)), min(r / (uT.z * 1.1), 1.4)); }
// optical depth of the dust skirt between camera and p (vertical cylinder, exponentially thinning)
float tfTau(vec3 p){
  vec2 a = tornadoAxis(uA, uB, max(p.y - uA.z, 0.0), uTime); float R = uT.z * 1.05; vec2 o = cameraPosition.xz - a, d = p.xz - cameraPosition.xz; float L = length(d); d /= max(L, .01);
  float b = dot(o, d), c = dot(o, o) - R * R, q = b * b - c; if (q <= 0.0) return 0.0; float t0 = max(-b - sqrt(q), 0.0), t1 = min(-b + sqrt(q), L); float path = max(t1 - t0, 0.0);
  return path * uT.w * .016 * exp(-max(p.y - uA.z, 0.0) / (18.0 + .55 * uT.z));
}
vec3 tfDustLight(vec3 p){ return uDustCol * .75 * (uAmbient * .8 + uSunColor * fxSunVis() * .3 + fxLightning(p) * .5); }
`;
const SHARD_VS = /* glsl */`
${LIGHT_GLSL}${COMMON}
attribute vec4 aS; attribute vec4 aR; attribute vec3 aN; uniform float uPx; varying vec3 vCol; varying float vA;
void main(){
  float T = mix(4.5, 15.0, aS.x), kt = uT.y / T + aS.y, k = fract(kt), cyc = mod(floor(kt), 61.0); vec3 rr = fxH3(cyc * 7.0 + aS.w * 331.0);
  float big = step(.9, aR.x), mid = step(.45, aR.x) * (1.0 - big); float heavy = big * .75 + mid * .35;
  float Hm = min((10.0 + 420.0 * pow(aS.z, 2.4)) * (uVmax / 75.0) * (1.0 - heavy * .55), uA.w * .85);
  float h = Hm * sin(3.14159 * pow(k, .72)) + .4; float rc = tornadoCoreRadius(uA, uC, h);
  float x = mix(1.75, .85 + .35 * rr.x, smoothstep(0.0, .22, k)) + smoothstep(.3, 1.0, k) * (.35 + 2.6 * rr.y * rr.y);
  float om = mix(.36, .74, aR.y), ang = aS.w * 6.2831 + cyc * 2.39996 - uSpin * uT.x * om; vec2 ax = tornadoAxis(uA, uB, h, uTime); float r = rc * x;
  // a share of the pieces rides the sub-vortices
  if (uSubN > .5 && aR.z < .4) { int i = int(floor(aR.w * uSubN)); vec4 s = uSub[i]; if (s.w > .05) { ax += vec2(cos(s.x), sin(s.x)) * s.y; float f = .6 + 1.7 * aR.z * 2.5; r = s.z * f * (1.0 + .8 * smoothstep(.5, 1.0, k)); ang = aS.w * 6.2831 - uSpin * uT.x * (2.0 + 1.5 * aR.y); h *= .55; } }
  vec2 dr = vec2(cos(ang), sin(ang)); vec3 c = vec3(ax.x + dr.x * r, 0.0, ax.y + dr.y * r); c.y = tfGround(ang, r) + h; c.xz += (rr.xz - .5) * r * .25 * sin(uTime * (1.0 + aR.y) + aS.x * 30.0); c.y += 2.5 * sin(uTime * 1.7 + aS.y * 40.0) * min(h * .1, 1.0);
  float dist = distance(c, cameraPosition);
  vec3 sz = big > .5 ? vec3(.55 + .75 * aR.y, .25 * aR.z, .2 + .5 * aR.w) : mid > .5 ? vec3(.4 + .75 * aR.y, .06, .05 + .07 * aR.w) : vec3(.06 + .16 * aR.y, .04, .04 + .1 * aR.w);
  sz *= 1.45; float px = dist * uPx; float mx = max(sz.x, sz.z), g = max(1.0, px * .85 / mx); float vis = min(1.0, (mx * mx) / (px * px * .18)); sz = max(sz * g, vec3(px * .22, 0.0, px * .22)); vec3 lp = position; lp.xz *= .62 + .38 * sin(vec2(position.x * 3.0 + position.z * 5.0) + vec2(aR.x * 90.0, aR.w * 70.0));
  float ta = uTime * (2.0 + 7.0 * aR.w) + aS.x * 60.0, tb = uTime * (1.5 + 5.0 * aR.z) + aS.y * 60.0; mat3 ry = mat3(cos(ta), 0.0, -sin(ta), 0.0, 1.0, 0.0, sin(ta), 0.0, cos(ta)), rx = mat3(1.0, 0.0, 0.0, 0.0, cos(tb), sin(tb), 0.0, -sin(tb), cos(tb)); mat3 M = ry * rx;
  vec3 p = c + M * (lp * sz); vec3 N = M * aN; vec3 V = normalize(cameraPosition - c);
  vec3 base = aR.x < .28 ? vec3(.09, .075, .055) : aR.x < .45 ? vec3(.16, .2, .07) : aR.x < .72 ? vec3(.34, .27, .18) * (.5 + .8 * rr.z) : aR.x < .86 ? vec3(.4, .42, .44) * (.4 + .9 * rr.z) : aR.x < .94 ? vec3(.55, .53, .5) : vec3(.12, .11, .11);
  float nl = abs(dot(N, uSunDir)); vec3 L = uAmbient * (.6 + .4 * abs(N.y)) + uSunColor * fxSunVis() * (nl * .75 + .05) + fxLightning(c); vec3 col = base * L;
  float tau = tfTau(c); col = mix(tfDustLight(c), col, exp(-tau * .45)); vCol = col;
  float amt = step(fract(aS.x * 71.3 + aS.z * 13.7), uAmt); vA = amt * smoothstep(0.0, .06, k) * (1.0 - smoothstep(.93, 1.0, k)) * vis * exp(-tau * .22) * smoothstep(2.0, 5.0, dist) * exp(-dist / 5200.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); if (vA < .02) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const SHARD_FS = /* glsl */`varying vec3 vCol; varying float vA; void main(){ gl_FragColor = vec4(vCol * vA, vA); }`;

const PUFF_VS = /* glsl */`
${LIGHT_GLSL}${COMMON}
attribute vec4 aS; attribute vec4 aR; uniform float uPx; varying vec2 vUv; varying float vA, vZ, vT, vAO, vGy; varying vec3 vP, vR, vU, vF, vC;
void main(){
  float T = mix(3.0, 7.0, aS.y), kt = uT.y * 1.1 / T + aS.w, k = fract(kt), cyc = mod(floor(kt), 61.0); vec3 rr = fxH3(cyc * 5.0 + aS.x * 211.0);
  float xs = pow(aS.x, 1.5), xM = clamp(uT.z * 1.5 / uC.x, 2.1, 5.2), x0 = mix(.75, 5.2, xs), om = min(.8, 1.4142 * .8 / sqrt(1.0 + pow(x0, 4.0)) * 1.0 + .05); float rc = uC.x;
  float x = mix(.75, xM, xs) * mix(1.3, .86, k); float r = x * rc + rr.x * 8.0; float ang = aS.w * 6.2831 + cyc * 2.39996 - uSpin * uT.x * om; vec2 dr = vec2(cos(ang), sin(ang));
  float hs = (12.0 + .62 * uT.z) * pow(aS.z, 1.8) * exp(-.22 * max(x - 1.0, 0.0)); float h = hs * (.15 + .95 * k); float size = (3.5 + .2 * uT.z) * (.5 + .7 * aR.x) * (.65 + .55 * k); size = min(size, 38.0 + .09 * uT.z);
  vec2 ax = tornadoAxis(uA, uB, h, uTime);
  if (uSubN > .5 && aR.z < .3) { int i = int(floor(aR.w * uSubN)); vec4 s = uSub[i]; if (s.w > .05) { ax += vec2(cos(s.x), sin(s.x)) * s.y; r = s.z * (.5 + 1.3 * aR.z * 3.3); ang = aS.w * 6.2831 - uSpin * uT.x * 2.2; dr = vec2(cos(ang), sin(ang)); size *= .55; h *= .8; } }
  vec3 c = vec3(ax.x + dr.x * r, 0.0, ax.y + dr.y * r); float gy = tfGround(ang, r); c.y = gy + h * .85 + size * .06; vec3 D = c - cameraPosition; float d = length(D); vec3 V = D / max(d, .01); vec3 R = normalize(cross(V, vec3(0, 1, 0))), U = cross(R, V);
  // stretch along the flow
  vec3 fl = uSpin * vec3(dr.y, 0.0, -dr.x); float st = dot(fl, R); float an = aR.y * 6.28 + k * (1.0 + aR.x); float ca = cos(an), sa = sin(an); vec2 q = position.xy; vec2 q2 = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y); vec3 p = c + R * q2.x * size * (1.0 + .55 * abs(st)) + U * q2.y * size * .82;
  vUv = position.xy * .5 + .5; vT = aR.w; vP = c; vR = R * ca + U * sa; vU = U * ca - R * sa; vF = -V; vGy = (p.y - gy) / (size * .55); vAO = mix(.55, 1.0, smoothstep(0.0, 1.0, h / (hs + 6.0)));
  float lim = 1.0 - smoothstep(uT.z * 1.15, uT.z * 1.75, r); vA = uT.w * lim * smoothstep(0.0, .18, k) * (1.0 - smoothstep(.55, 1.0, k)) * mix(.62, .3, smoothstep(1.0, 4.5, x)) * smoothstep(size * .3, size * 1.5, d) * (1.0 - smoothstep(2200.0, 4500.0, d)) * exp(-d / 5200.0); vA *= 1.0 - smoothstep(0.1, .9, size * 2.2 / max(d, 1.0)) * .75;
  vec3 dc = mix(uDustCol, vec3(dot(uDustCol, vec3(.33))), .18); vC = dc * (.62 + .34 * rr.z) * mix(.8, 1.0, smoothstep(0.0, .5, h / (hs + 6.0))); vec4 mv = viewMatrix * vec4(p, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; if (vA < .004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const PUFF_FS = /* glsl */`
${LIGHT_GLSL}${SOFT_GLSL}${PUFF_GLSL}
varying vec2 vUv; varying float vA, vZ, vT, vAO, vGy; varying vec3 vP, vR, vU, vF, vC;
void main(){ vec4 s = puffSample(vUv, vT); float a = vA * s.r * (.72 + .28 * s.b) * smoothstep(-.25, .18, vGy) * fxSoft(vZ, 6.0); if (a < .003) discard; gl_FragColor = vec4(vC * puffLight(vUv, vT, vR, vU, vF, vP, vAO) * a, a); }`;

export function createTornadoFx(ctx, soft, particles) {
  const q = Math.max(0.25, ctx.quality.particles), G = ctx.globals, rigs = [];
  const shardGeo = () => { // irregular bent flake, 7-vertex fan
    const pts = [[0, 0, 0]], idx = []; for (let k = 0; k < 7; k++) { const a = k / 7 * 6.2831853, r = [1, 0.72, 1.05, 0.8, 1, 0.66, 0.95][k]; pts.push([Math.cos(a) * r, [0.5, -0.4, 0.2, -0.7, 0.6, 0.1, -0.5][k], Math.sin(a) * r]); idx.push(0, 1 + k, 1 + (k + 1) % 7); }
    const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); b.setIndex(idx); b.computeVertexNormals(); const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', b.attributes.position); g.setAttribute('aN', b.attributes.normal); g.setIndex(b.index); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9); return g; };
  for (let i = 0; i < 2; i++) {
    const u = { ...lightUniforms(G), uPx: { value: 0.001 }, uA: { value: new THREE.Vector4(0, 0, 0, 800) }, uB: { value: new THREE.Vector4() }, uC: { value: new THREE.Vector4(50, 100, 1, 0.2) }, uT: { value: new THREE.Vector4() }, uSub: { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector4()) }, uSubN: { value: 0 }, uSpin: { value: 1 }, uVmax: { value: 0 }, uAmt: { value: 0 }, uRing: { value: new Array(8).fill(0) }, uDustCol: { value: new THREE.Color(0.4, 0.3, 0.2) }, uAtlas: { value: puffAtlas() } };
    const nS = Math.round((i ? 1100 : 4200) * q), nP = Math.round((i ? 110 : 420) * q);
    const gs = shardGeo(); gs.setAttribute('aS', new THREE.InstancedBufferAttribute(seeds(nS, 4, 71 + i), 4)); gs.setAttribute('aR', new THREE.InstancedBufferAttribute(seeds(nS, 4, 83 + i), 4)); gs.instanceCount = nS; const ms = fxMat({ vertexShader: SHARD_VS, fragmentShader: SHARD_FS, uniforms: u }); const shards = noCull(new THREE.Mesh(gs, ms), 5);
    const gp = quad(); gp.setAttribute('aS', new THREE.InstancedBufferAttribute(seeds(nP, 4, 91 + i), 4)); gp.setAttribute('aR', new THREE.InstancedBufferAttribute(seeds(nP, 4, 97 + i), 4)); gp.instanceCount = nP; const mp = fxMat({ vertexShader: PUFF_VS, fragmentShader: PUFF_FS, uniforms: u }); soft.register(mp); const puffs = noCull(new THREE.Mesh(gp, mp), 4);
    shards.visible = puffs.visible = false; ctx.fxScene.add(shards, puffs); rigs.push({ u, shards, puffs, t: null, ph: 0, lf: 0, ringT: 0, fade: 0, pfT: 1 });
  }
  const w = new THREE.Vector3(), ax = { x: 0, z: 0 }; let emitAcc = 0, inAcc = 0, hitT = 0, cityT = 0, near = false;
  function powerFlash(x, y, z, k = 1) {
    const c = Math.random() < 0.7 ? [0.35, 1.0, 0.85] : [0.5, 0.75, 1.0], I = 26 * k; const n = 2 + ((Math.random() * 3) | 0); let d = 0;
    for (let i = 0; i < n; i++) { const e = 0.5 + Math.random(); particles.emit(5, x, y + 5, z, 0, 0, 0, 0.12 + 0.25 * Math.random(), 70 * k, 95 * k, c[0] * I * e, c[1] * I * e, c[2] * I * e, 0.28, 1, 0, 0, 0, d); particles.emit(5, x, y + 5, z, 0, 0, 0, 0.18, 9, 14, c[0] * I * 4 * e, c[1] * I * 4 * e, c[2] * I * 4 * e, 1, 1, 0, 0, 0, d); d += 0.06 + Math.random() * 0.22; }
    for (let i = 0; i < 24; i++) { const a = Math.random() * 6.28, s = 3 + Math.random() * 9; particles.emit(1, x, y + 7, z, Math.cos(a) * s, 2 + Math.random() * 8, Math.sin(a) * s, 0.6 + Math.random(), 0.05, 0.02, 10, 12, 12, 1, 0.5, 0, 0, 0, Math.random() * d); }
    ctx.events.emit('fx:powerflash', { x, y: y + 6, z });
  }
  function electrify(r, t, dt) { // grid faults under the tornado in towns / along roads
    if ((r.pfT -= dt) > 0 || t.vmax < 36 || !t.onGround) return; r.pfT = 0.5 + Math.random() * 2.2; const W = ctx.world; if (!W) return; const c = W.nearestCity?.(t.x, t.z), town = c && Math.hypot(c.x - t.x, c.z - t.z) < (c.radius || 500) * 1.25 + t.dustR, rd = W.roads?.nearest?.(t.x, t.z), road = rd && rd.dist < t.dustR * 1.3 && rd.kind !== 'track' && rd.kind !== 'dirt';
    if (!town && !(road && Math.random() < 0.35)) { r.pfT = 1.5; return; } let x, z; if (town) { const a = Math.random() * 6.28, d = t.rCore * (0.5 + Math.random() * 1.1) + 12; x = t.x + Math.cos(a) * d; z = t.z + Math.sin(a) * d; } else { x = rd.x + (Math.random() - 0.5) * 40; z = rd.z + (Math.random() - 0.5) * 40; } powerFlash(x, W.heightAt(x, z), z, 0.7 + 0.7 * Math.random());
  }
  return {
    powerFlash, rigs,
    update(dt, cam, px) {
      const ts = ctx.storms?.tornadoes || []; let a = null, b = null, da = 7500, db = 7500; for (const t of ts) { const d = Math.hypot(t.x - cam.x, t.z - cam.z); if (d < da) { b = a; db = da; a = t; da = d; } else if (d < db) { b = t; db = d; } }
      for (let i = 0; i < 2; i++) {
        const r = rigs[i], t = i ? b : a, u = r.u; r.shards.visible = r.puffs.visible = false; if (!t) { r.t = null; continue; }
        if (r.t !== t) { r.t = t; r.ringT = 0; u.uAmt.value = 0; u.uT.value.w = 0; u.uDustCol.value.setRGB(t.dustColor[0], t.dustColor[1], t.dustColor[2]); }
        packTornado(t, u.uA.value, u.uB.value, u.uC.value); r.ph += dt * t.vmax / Math.max(8, t.rCore); r.lf += dt * (0.25 + t.vmax / 60); u.uSpin.value = t.spin; u.uVmax.value = t.vmax; u.uPx.value = px;
        const T = u.uT.value; T.x = r.ph; T.y = r.lf; T.z = t.dustR; T.w = damp(T.w, t.dust * (t.onGround === false ? 0 : 1), 1.5, dt); u.uAmt.value = damp(u.uAmt.value, t.onGround === false || t.overWater ? 0 : smoothstep(26, 88, t.vmax) * clamp(0.55 + 0.5 * (t.dustiness ?? 0.7)), 0.8, dt);
        const n = Math.min(5, t.sub?.length || 0); u.uSubN.value = n; for (let k = 0; k < n; k++) { const s = t.sub[k]; u.uSub.value[k].set(s.a, s.r, s.rc, s.s); } const c = u.uDustCol.value; c.r = damp(c.r, t.dustColor[0], 0.5, dt); c.g = damp(c.g, t.dustColor[1], 0.5, dt); c.b = damp(c.b, t.dustColor[2], 0.5, dt);
        if ((r.ringT -= dt) < 0 && ctx.world) { r.ringT = 0.2; for (let k = 0; k < 8; k++) { const an = k / 8 * 6.2831853; u.uRing.value[k] = ctx.world.heightAt(t.x + Math.cos(an) * t.dustR * 1.1, t.z + Math.sin(an) * t.dustR * 1.1); } }
        r.shards.visible = u.uAmt.value > 0.01; r.puffs.visible = T.w > 0.015; electrify(r, t, dt);
      }
      // ---- inflow streamers (CPU emitted, real wind)
      if (a && a.dust > 0.05 && da < 1600 + a.dustR * 2 && ctx.world) {
        const W = ctx.world, dust = a.dust * clamp(a.dustiness ?? 0.7) * (1 - 0.6 * G.uWetness.value); emitAcc += dt * 46 * q * dust; const dc = a.dustColor;
        while (emitAcc > 1) {
          emitAcc--; const an = Math.random() * 6.283, rr = a.rCore * 1.5 + a.dustR * (0.7 + 2.2 * Math.random()), x = a.x + Math.cos(an) * rr, z = a.z + Math.sin(an) * rr, y = W.heightAt(x, z); ctx.storms.windAt(x, y + 3, z, w); const sp = Math.hypot(w.x, w.z); if (sp < 12) continue; const s = 2.5 + Math.random() * 5 + sp * 0.06;
          particles.emit(4, x, y + s * 0.32, z, w.x * 0.8, 0.4, w.z * 0.8, 1.2 + Math.random() * 1.2, s * 0.6, s * 1.25, dc[0], dc[1], dc[2], 0.16 + 0.22 * smoothstep(12, 45, sp) * dust, 0.3, w.x, 0.5, w.z);
        }
      }
      // ---- inside the dust: blowing dirt and flakes rushing past the camera
      if (a && a.onGround && a.dust > 0.1 && da < a.dustR * 1.5 && ctx.world) {
        const k = smoothstep(a.dustR * 1.5, a.dustR * 0.8, da) * a.dust, dc = a.dustColor; inAcc += dt * 70 * k * q; ctx.storms.windAt(cam.x, cam.y + 2, cam.z, w); const sp = w.length() + 1;
        while (inAcc > 1) {
          inAcc--; const rx = (Math.random() - 0.5) * 52, rz = (Math.random() - 0.5) * 52, tb = 0.35, x = cam.x + rx - w.x * tb, z = cam.z + rz - w.z * tb, g = ctx.world.heightAt(x, z), y = g + 0.5 + 11 * Math.random() ** 1.6;
          if (Math.random() < 0.55) particles.emit(4, x, y, z, w.x, w.y * 0.25, w.z, 0.8 + Math.random() * 0.5, 1.6 + Math.random() * 2, 3 + Math.random() * 3.5, dc[0] * 0.78, dc[1] * 0.78, dc[2] * 0.78, 0.26 * k, 0.2, w.x, w.y * 0.25, w.z);
          else particles.emit(6, x, y, z, w.x * 0.9, w.y * 0.3 + Math.random() * 3, w.z * 0.9, 0.7 + Math.random() * 0.5, 0.015 + 0.06 * Math.random() ** 3, 0.04, 0.17, 0.14, 0.09, 1, 0.3, w.x, w.y * 0.4, w.z);
        }
      }
      // ---- unresolved small debris striking the player inside the debris field
      if (a && a.onGround && a.vmax > 38 && da < a.dustR * 1.2 && (hitT -= dt) < 0) {
        const p = ctx.player?.pos; hitT = 0.15 + Math.random() * 0.9 * (1 + da / a.dustR) * 60 / a.vmax; if (p) { ctx.storms.windAt(p.x, p.y + 1.5, p.z, w); const sp = w.length(); if (sp > 24) ctx.events.emit('fx:debris-hit', { speed: sp * (0.4 + 0.5 * Math.random()), mass: 0.05 + 1.6 * Math.random() ** 3, pos: p, kind: 'small', vehicle: ctx.player?.vehicle || null }); }
      }
    },
  };
}

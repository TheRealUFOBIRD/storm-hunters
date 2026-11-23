// Rain: camera-centred wrapping streak layers, blowing sheets, splashes, ground mist.
import * as THREE from 'three';
import { LIGHT_GLSL, SOFT_GLSL, GROUND_GLSL, PUFF_GLSL, quad, seeds, fxMat, lightUniforms, noCull, puffAtlas } from './common.js';

const STREAK_VS = /* glsl */`
attribute vec4 aS; uniform vec3 uBox, uShift, uVel, uCamVel; uniform float uShutter, uW, uDens, uPx, uNear, uFade, uTime, uCurtain, uAlpha, uMinPx; uniform vec2 uWindXZ;
varying vec2 vQ; varying float vA, vZ, vBr; varying vec3 vP, vV;
void main(){
  vBr = .6 + .85 * fract(aS.w * 23.7); vec3 rel = mod(aS.xyz * uBox + uShift, uBox) - uBox * .5; vec3 wp = cameraPosition + rel;
  float dist = length(rel);
  vec3 v = uVel * (.86 + .28 * aS.w) - uCamVel; v.xz += (fract(aS.xy * 57.3) - .5) * 1.3; float sp = length(v) + 1e-4; vec3 dir = v / sp;
  float len = max(sp * uShutter * (.7 + .6 * fract(aS.w * 13.7)), uW * 2.0);
  vec3 V = rel / max(dist, 1e-3); vec3 side = cross(dir, V); side /= max(length(side), 1e-3);
  float w = uW * (.6 + .8 * fract(aS.w * 7.31)), mw = dist * uPx * uMinPx, ww = max(w, mw);
  // curtains: density waves carried by the wind
  vec2 cp = wp.xz - uWindXZ * uTime * .8; float cur = .5 + .28 * sin(cp.x * .047 + 2.0 * sin(cp.y * .021)) + .22 * sin(cp.y * .071 + cp.x * .03 + 1.3 * sin(cp.x * .027));
  float keep = step(fract(aS.w * 91.7 + aS.x * 37.3), uDens * mix(1.0, .35 + 1.1 * cur, uCurtain));
  float edge = 1.0 - smoothstep(.78, 1.0, max(max(abs(rel.x) / (uBox.x * .5), abs(rel.z) / (uBox.z * .5)), abs(rel.y) / (uBox.y * .5)));
  vA = uAlpha * keep * edge * smoothstep(uNear, uNear + uFade, dist) * pow(w / ww, .5);
  // exposure: the longer the streak, the thinner its coverage
  vA *= clamp(.24 / len, .35, 1.0);
  vec3 p = wp + dir * len * .5 * position.y + side * ww * position.x;
  vQ = position.xy; vP = wp; vV = V; vec4 mv = viewMatrix * vec4(p, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; if (vA < .003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const STREAK_FS = /* glsl */`
${LIGHT_GLSL}${SOFT_GLSL}
uniform float uSolid; uniform vec3 uTint; varying vec2 vQ; varying float vA, vZ, vBr; varying vec3 vP, vV;
void main(){
  float x = abs(vQ.x), y = vQ.y, body = exp(-x * x * 2.6) * (1.0 - smoothstep(.35, 1.0, abs(y)));
  float rim = smoothstep(.25, .6, x) * (1.0 - smoothstep(.6, 1.0, x));               // refracted bright edges
  vec3 sky = fxScatter(vP, vV, 2.2) * uTint;
  // drops image the hemisphere behind the viewer direction: brighter when looking up, darker toward the ground
  float up = clamp(vV.y * .6 + .55, .25, 1.1); vec3 c = sky * mix(up * (.8 + .8 * rim) * vBr, 1.0, uSolid);
  float a = vA * body * mix(.75 + .6 * rim, 1.0, uSolid) * fxSoft(vZ, .25);
  gl_FragColor = vec4(c * a, a * mix(.8, 1.0, uSolid));
}`;

export function streakLayer(ctx, soft, o) {
  const g = quad(); g.setAttribute('aS', new THREE.InstancedBufferAttribute(seeds(o.n, 4, o.seed || 1), 4)); g.instanceCount = o.n;
  const u = { ...lightUniforms(ctx.globals), uBox: { value: new THREE.Vector3(...o.box) }, uShift: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(0, -8, 0) }, uCamVel: { value: new THREE.Vector3() }, uShutter: { value: o.shutter ?? 1 / 55 }, uW: { value: o.w }, uDens: { value: 0 }, uPx: { value: 0.001 }, uNear: { value: o.near ?? 0.3 }, uFade: { value: o.fade ?? 1 }, uCurtain: { value: o.curtain ?? 0 }, uAlpha: { value: o.alpha }, uMinPx: { value: o.minPx ?? 0.55 }, uWindXZ: { value: new THREE.Vector2() }, uSolid: { value: o.solid ?? 0 }, uTint: { value: new THREE.Color(...(o.tint || [1, 1, 1])) } };
  const m = fxMat({ vertexShader: STREAK_VS, fragmentShader: STREAK_FS, uniforms: u }); soft.register(m); const mesh = noCull(new THREE.Mesh(g, m), o.order ?? 20); ctx.fxScene.add(mesh);
  const off = new THREE.Vector3(), B = u.uBox.value, md = (a, b) => ((a % b) + b) % b;
  return {
    mesh, u, n: o.n,
    update(dt, dens, vel, camVel, cam, px, wind, near) {
      off.addScaledVector(vel, dt); off.x = md(off.x, B.x); off.y = md(off.y, B.y); off.z = md(off.z, B.z);
      mesh.visible = dens > 0.004; if (!mesh.visible) return; u.uDens.value = dens; u.uVel.value.copy(vel); u.uCamVel.value.copy(camVel); u.uPx.value = px; u.uWindXZ.value.set(wind.x, wind.z); if (near !== undefined) u.uNear.value = near;
      u.uShift.value.set(md(off.x - cam.x, B.x), md(off.y - cam.y, B.y), md(off.z - cam.z, B.z)); g.instanceCount = Math.ceil(o.n * Math.min(1, dens * 1.5 + 0.02));
    },
  };
}

function streakTexture() {
  const W = 256, H = 256, d = new Uint8Array(W * H), f = new Float32Array(W * H), s = seeds(420 * 4, 1, 77);
  for (let i = 0; i < 420; i++) {
    const x = s[i * 4] * W, y = s[i * 4 + 1] * H, l = 14 + 46 * s[i * 4 + 2], b = 0.25 + 0.75 * s[i * 4 + 3] ** 2;
    for (let k = -l; k < l; k++) { const q = 1 - Math.abs(k) / l, yy = ((y + k) % H + H) % H | 0; for (let dx = -2; dx <= 2; dx++) { const xx = ((x + dx) % W + W) % W | 0, e = dx + Math.floor(x) - x + 0.5; f[yy * W + xx] += b * q * Math.exp(-e * e * 1.6); } }
  }
  for (let i = 0; i < W * H; i++) d[i] = Math.min(255, f[i] * 190); const t = new THREE.DataTexture(d, W, H, THREE.RedFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.unpackAlignment = 1; t.needsUpdate = true; return t;
}
const SHEET_VS = /* glsl */`
${GROUND_GLSL}
attribute vec4 aS; uniform vec3 uBox, uShift, uVel; uniform float uDens, uTime, uAlpha; uniform vec2 uWindXZ; varying vec2 vUv; varying float vA, vZ, vG; varying vec3 vP, vV; varying float vS;
void main(){
  vec3 rel = mod(aS.xyz * uBox + uShift, uBox) - uBox * .5; vec3 wp = cameraPosition + rel; float dist = length(rel);
  vec3 dir = normalize(uVel), V = rel / max(dist, .01), side = normalize(cross(dir, V)); vec2 sz = vec2(9.0 + 9.0 * aS.w, 10.0 + 8.0 * fract(aS.w * 5.7));
  vec2 cp = wp.xz - uWindXZ * uTime * .8; float cur = .5 + .28 * sin(cp.x * .047 + 2.0 * sin(cp.y * .021)) + .22 * sin(cp.y * .071 + cp.x * .03);
  vec3 p = wp + dir * sz.y * position.y + side * sz.x * position.x; float eh = 1.0 - smoothstep(.7, 1.0, max(abs(rel.x) / (uBox.x * .5), abs(rel.z) / (uBox.z * .5)));
  vG = p.y - fxGround(clamp(p.xz, cameraPosition.xz - 72.0, cameraPosition.xz + 72.0)); vA = uAlpha * uDens * (.3 + 1.2 * cur) * eh * smoothstep(10.0, 22.0, dist); vUv = position.xy; vS = aS.w; vP = wp; vV = V; vec4 mv = viewMatrix * vec4(p, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv;
}`;
const SHEET_FS = /* glsl */`
${LIGHT_GLSL}${SOFT_GLSL}
uniform sampler2D uTex; uniform float uTime; varying vec2 vUv; varying float vA, vZ, vG; varying vec3 vP, vV; varying float vS;
void main(){ vec2 e = 1.0 - vUv * vUv; float m = e.x * e.x * e.y; float s = texture2D(uTex, vUv * vec2(1.15, .62) + vec2(vS * 7.3, vS * 3.1 + uTime * 1.1)).r; float s2 = texture2D(uTex, vUv * vec2(.5, .23) + vec2(vS * 2.3, uTime * .55)).r;
  float a = vA * m * (s * .8 + s2 * .35 + .05) * smoothstep(-.2, 5.0, vG) * fxSoft(vZ, 4.0); vec3 c = fxScatter(vP, vV, 1.6) * .95; gl_FragColor = vec4(c * a, a); }`;

const SPLASH_VS = /* glsl */`
${GROUND_GLSL}
attribute vec4 aS; uniform float uTime, uDens, uR, uAlpha, uPx; varying vec2 vQ; varying float vA, vAge, vZ, vK; varying vec3 vP, vV;
float h1(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main(){
  float rate = 5.5 + 3.5 * aS.z, tt = uTime * rate + aS.w * 91.0, cy = floor(tt); vAge = fract(tt); cy = mod(cy, 997.0);
  vec2 q = vec2(h1(vec2(aS.x * 311.0, cy)), h1(vec2(aS.y * 173.0 + 5.0, cy * 1.7)));
  vec2 rel = mod(q * uR * 2.0 - cameraPosition.xz, uR * 2.0) - uR; vec2 w = cameraPosition.xz + rel; float y = fxGround(w);
  vec3 c = vec3(w.x, y, w.y); float d = distance(c, cameraPosition); float sz = (.010 + .022 * aS.z * aS.z * aS.z) * (.6 + 1.2 * sqrt(vAge));
  vec3 V = normalize(c - cameraPosition); vec3 side = normalize(cross(vec3(0, 1, 0), V)); vK = fract(aS.z * 17.0);
  float sz0 = sz; sz = max(sz, d * uPx * .9); vec3 p = c + side * position.x * sz + vec3(0, 1, 0) * (position.y * .5 + .5) * sz * 1.5;
  vA = uAlpha * pow(sz0 / sz, .8) * step(aS.w, uDens) * (1.0 - smoothstep(uR * .55, uR, length(rel))) * (1.0 - vAge) * (1.0 - smoothstep(6.0, 24.0, d) * .55); vQ = position.xy; vP = c; vV = V; vec4 mv = viewMatrix * vec4(p, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; if (vA < .003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const SPLASH_FS = /* glsl */`
${LIGHT_GLSL}
varying vec2 vQ; varying float vA, vAge, vZ, vK; varying vec3 vP, vV;
void main(){
  vec2 q = vec2(vQ.x, vQ.y * .5 + .5); float up = vAge * (1.6 - vAge) * 1.4;
  // blurred crown: thin flared sheet + two ejected droplets
  float w = .16 + .55 * q.y * vAge; float sheet = exp(-pow(abs(abs(q.x) - w) / .13, 2.0)) * smoothstep(up, up * .35, q.y) * .55; float core = exp(-dot(q * vec2(2.6, 3.2), q * vec2(2.6, 3.2))) * (1.0 - vAge);
  vec2 d0 = q - vec2((vK - .5) * 1.5 * vAge, up * .95); vec2 d1 = q - vec2((.5 - fract(vK * 5.0)) * 1.7 * vAge, up * .7); float dr = exp(-dot(d0, d0) * 90.0) + .8 * exp(-dot(d1, d1) * 120.0);
  float s = min(sheet * .45 + core * .9 + dr * .8, 1.0); vec3 c = fxScatter(vP, vV, 2.0); float a = vA * s; gl_FragColor = vec4(c * a, a * .8); }`;
// water rings on hard wet ground
const RING_VS = /* glsl */`
${GROUND_GLSL}
attribute vec4 aS; uniform float uTime, uDens, uR, uAlpha; varying vec2 vQ; varying float vA, vAge; varying vec3 vP, vV;
float h1(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main(){ float tt = uTime * (2.2 + aS.z) + aS.w * 57.0, cy = mod(floor(tt), 997.0); vAge = fract(tt); vec2 q = vec2(h1(vec2(aS.x * 211.0, cy)), h1(vec2(aS.y * 133.0 + 5.0, cy * 1.3)));
  vec2 rel = mod(q * uR * 2.0 - cameraPosition.xz, uR * 2.0) - uR, w = cameraPosition.xz + rel + position.xy * (.03 + .13 * aS.z) * vAge; float e = .25; float y = fxGround(w); vec3 c = vec3(w.x, y + .012, w.y);
  vA = uAlpha * step(aS.w, uDens) * (1.0 - smoothstep(uR * .6, uR, length(rel))) * (1.0 - vAge); vQ = position.xy; vP = c; vV = normalize(c - cameraPosition); gl_Position = projectionMatrix * viewMatrix * vec4(c, 1.0); if (vA < .003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
const RING_FS = /* glsl */`
${LIGHT_GLSL}
varying vec2 vQ; varying float vA, vAge; varying vec3 vP, vV;
void main(){ float r = length(vQ), k = smoothstep(.16, .0, abs(r - .8)); float gl = vQ.y * .5 + .5; vec3 c = uAmbient * (.5 + .9 * gl) + fxLightning(vP); float a = vA * k * .55; gl_FragColor = vec4(c * a, a * .6); }`;
// low drifting spray
const MIST_VS = /* glsl */`
${GROUND_GLSL}
attribute vec4 aS; uniform vec3 uBox, uShift; uniform float uDens, uAlpha, uTime; varying vec2 vUv; varying float vA, vZ, vT, vB; varying vec3 vP, vR, vU, vF;
void main(){ vec3 rel = mod(aS.xyz * uBox + uShift, uBox) - uBox * .5; vec2 w = cameraPosition.xz + rel.xz; float y = fxGround(w), sz = 3.0 + 4.0 * aS.w; vec3 c = vec3(w.x, y + sz * (.15 + .35 * aS.y), w.y), V = c - cameraPosition; float d = length(V); V /= max(d, .01);
  vR = normalize(cross(V, vec3(0, 1, 0))); vU = cross(vR, V); vF = -V; vec3 p = c + vR * position.x * sz * 1.7 + vU * position.y * sz * .75; vUv = position.xy * .5 + .5; vT = aS.w; vP = c; vB = (p.y - y) / sz;
  vA = uAlpha * uDens * (1.0 - smoothstep(.6, 1.0, length(rel.xz) / (uBox.x * .5))) * smoothstep(3.0, 14.0, d); vec4 mv = viewMatrix * vec4(p, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`;
const MIST_FS = /* glsl */`
${LIGHT_GLSL}${SOFT_GLSL}${PUFF_GLSL}
varying vec2 vUv; varying float vA, vZ, vT, vB; varying vec3 vP, vR, vU, vF;
void main(){ vec4 s = puffSample(vUv, vT); float a = vA * s.r * smoothstep(-.05, .35, vB) * fxSoft(vZ, 3.0); if (a < .002) discard; gl_FragColor = vec4(fxScatter(vP, -vF, .8) * .95 * a, a); }`;

export function createRain(ctx, soft, ground) {
  const q = Math.max(0.25, ctx.quality.particles), G = ctx.globals, n = (k) => Math.round(k * q);
  const near = streakLayer(ctx, soft, { n: n(3600), box: [14, 10, 14], w: 0.0011, alpha: 0.62, near: 0.25, fade: 1.2, shutter: 1 / 55, seed: 3, minPx: 0.5, curtain: 0.4 });
  const mid = streakLayer(ctx, soft, { n: n(15000), box: [42, 22, 42], w: 0.0022, alpha: 1.7, near: 3, fade: 4, shutter: 1 / 42, seed: 9, minPx: 0.55, curtain: 1 });
  const mk = (cnt, vs, fs, u, order, sd) => { const g = quad(); g.setAttribute('aS', new THREE.InstancedBufferAttribute(seeds(cnt, 4, sd), 4)); g.instanceCount = cnt; const m = fxMat({ vertexShader: vs, fragmentShader: fs, uniforms: { ...lightUniforms(G), ...ground.uniforms, ...u } }); soft.register(m); const me = noCull(new THREE.Mesh(g, m), order); ctx.fxScene.add(me); return { mesh: me, u: m.uniforms, n: cnt, g }; };
  const sheets = mk(n(170), SHEET_VS, SHEET_FS, { uTex: { value: streakTexture() }, uBox: { value: new THREE.Vector3(120, 34, 120) }, uShift: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(0, -9, 0) }, uDens: { value: 0 }, uAlpha: { value: 0.3 }, uWindXZ: { value: new THREE.Vector2() } }, 18, 21);
  const splash = mk(n(4200), SPLASH_VS, SPLASH_FS, { uDens: { value: 0 }, uR: { value: 18 }, uAlpha: { value: 0.5 }, uPx: { value: 0.001 } }, 16, 31);
  const ring = mk(n(700), RING_VS, RING_FS, { uDens: { value: 0 }, uR: { value: 10 }, uAlpha: { value: 0.5 } }, 15, 37);
  const mist = mk(n(70), MIST_VS, MIST_FS, { uAtlas: { value: puffAtlas() }, uBox: { value: new THREE.Vector3(110, 10, 110) }, uShift: { value: new THREE.Vector3() }, uDens: { value: 0 }, uAlpha: { value: 0.16 } }, 17, 41);
  for (const s of [splash, ring]) s.mesh.material.depthWrite = false;
  const vel = new THREE.Vector3(), vM = new THREE.Vector3(), off = new THREE.Vector3(), mOff = new THREE.Vector3(), md = (a, b) => ((a % b) + b) % b; let hard = 0.4, hT = 0;
  return {
    update(dt, rain, wind, camVel, cam, px, inside) {
      const dens = Math.pow(rain, 0.8); vel.set(wind.x * 0.92, -(6.2 + 2.6 * rain) + wind.y * 0.5, wind.z * 0.92); vM.set(vel.x, vel.y * 1.08, vel.z);
      near.update(dt, dens, vel, camVel, cam, px, wind, inside ? 1.9 : 0.25); mid.update(dt, dens, vM, camVel, cam, px, wind);
      const on = rain > 0.02; sheets.mesh.visible = rain > 0.15; splash.mesh.visible = ring.mesh.visible = on; mist.mesh.visible = rain > 0.3; if (!on) return;
      const step = (o, v, u, k) => { o.addScaledVector(v, dt * k); const B = u.uBox.value; o.x = md(o.x, B.x); o.y = md(o.y, B.y); o.z = md(o.z, B.z); u.uShift.value.set(md(o.x - cam.x, B.x), md(o.y - cam.y, B.y), md(o.z - cam.z, B.z)); };
      step(off, vel, sheets.u, 0.8); sheets.u.uVel.value.copy(vel).addScaledVector(camVel, -0.25); sheets.u.uDens.value = Math.max(0, rain - 0.12); sheets.u.uWindXZ.value.set(wind.x, wind.z);
      step(mOff, wind, mist.u, 0.6); mist.u.uDens.value = Math.max(0, rain - 0.3) * (1 + Math.min(1, Math.hypot(wind.x, wind.z) / 25));
      if ((hT -= dt) < 0) { hT = 0.3; const t = ctx.world?.surfaceAt?.(cam.x, cam.z)?.type; hard = t === 'asphalt' || t === 'water' || t === 'rock' ? 1 : t === 'gravel' || t === 'mud' || t === 'dirt' ? 0.6 : 0.3; }
      splash.u.uDens.value = Math.min(1, dens * 1.1); splash.u.uAlpha.value = 0.1 + 0.42 * hard; splash.u.uPx.value = px; ring.u.uDens.value = dens; ring.u.uAlpha.value = 0.5 * Math.max(0, hard - 0.3) * Math.min(1, G.uWetness.value * 2 + 0.2);
    },
  };
}

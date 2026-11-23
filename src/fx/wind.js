// Wind-blown litter (grass, leaves, chaff) and ground-hugging dust ribbons around the camera.
import * as THREE from 'three';
import { LIGHT_GLSL, SOFT_GLSL, GROUND_GLSL, PUFF_GLSL, quad, seeds, fxMat, lightUniforms, noCull, puffAtlas } from './common.js';
import { clamp, smoothstep } from '../core/math.js';

const BIT_VS = /* glsl */`
${GROUND_GLSL}
attribute vec4 aS; uniform vec3 uBox, uShift, uWindV; uniform float uDens, uTime, uPx, uLeaf; varying vec2 vQ; varying float vK, vA; varying vec3 vP, vN;
void main(){
  float s = aS.w; vec3 rel = mod(aS.xyz * uBox + uShift * vec3(1.0, 0.0, 1.0) , uBox) - uBox * .5;
  rel.xz += vec2(sin(uTime * (1.1 + s) + s * 40.0), cos(uTime * (1.3 + s * .7) + s * 77.0)) * (.4 + 1.2 * aS.y);
  vec2 w = cameraPosition.xz + rel.xz; float hop = aS.y * aS.y, y = fxGround(w) + .04 + hop * (1.2 + uBox.y * .75) * (.6 + .4 * sin(uTime * (1.7 + 2.0 * s) + s * 90.0)) + abs(sin(uTime * (2.0 + 3.0 * s) + s * 50.0)) * .3;
  vec3 c = vec3(w.x, y, w.y); float d = distance(c, cameraPosition);
  // random tumbling frame
  float a = uTime * (5.0 + 11.0 * fract(s * 13.0)) + s * 91.0, b = uTime * (3.0 + 7.0 * fract(s * 29.0)) + s * 17.0; vec3 T = vec3(cos(a) * cos(b), sin(b), sin(a) * cos(b)), B = normalize(cross(T, vec3(sin(a * .7), cos(a * .7), .3)));
  vK = fract(s * 53.0); float leaf = step(vK, uLeaf); vec2 sz = mix(vec2(.0045, .06 + .07 * fract(s * 7.0)), vec2(.022, .035) * (.7 + .7 * fract(s * 7.0)), leaf); sz.x = max(sz.x, d * uPx * .55);
  vec3 p = c + T * position.y * sz.y + B * position.x * sz.x; vQ = position.xy; vP = c; vN = cross(T, B);
  vA = step(fract(s * 19.0), uDens) * (1.0 - smoothstep(.7, 1.0, length(rel.xz) / (uBox.x * .5))) * smoothstep(1.0, 3.0, d); vK = leaf;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); if (vA < .01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const BIT_FS = /* glsl */`
${LIGHT_GLSL}
uniform vec3 uColA, uColB; varying vec2 vQ; varying float vK, vA; varying vec3 vP, vN;
void main(){ vec2 q = vQ; if (vK > .5 && q.x * q.x + .7 * q.y * q.y > .62 * (1.0 - .45 * q.y)) discard; float nl = abs(dot(normalize(vN), uSunDir)); vec3 c = mix(uColA, uColB, vK) * (uAmbient * .95 + uSunColor * fxSunVis() * nl * .5 + fxLightning(vP)); gl_FragColor = vec4(c * .55 * vA, vA); }`;
const DUST_VS = /* glsl */`
${GROUND_GLSL}
attribute vec4 aS; uniform vec3 uBox, uShift, uWindV; uniform float uDens, uTime; varying vec2 vUv; varying float vA, vZ, vT, vB; varying vec3 vP, vR, vU, vF;
void main(){
  vec3 rel = mod(aS.xyz * uBox + uShift * vec3(1.0, 0.0, 1.0), uBox) - uBox * .5; vec2 w = cameraPosition.xz + rel.xz; float y = fxGround(w), h = .35 + 1.1 * aS.y * aS.y; vec3 c = vec3(w.x, y + h * .55, w.y), V = c - cameraPosition; float d = length(V); V /= max(d, .01);
  vec3 dir = normalize(vec3(uWindV.x, 0.0, uWindV.z) + vec3(1e-3)); vec3 s = cross(dir, V); s /= max(length(s), .2); s = normalize(mix(vec3(0, 1, 0), s, .25)); float L = 2.6 + 4.5 * aS.w; float e = fxGround(w + dir.xz * L * position.y);
  vec3 p = c + dir * position.y * L + s * position.x * h; p.y += e - y; vUv = position.yx * vec2(.5, .5) + .5; vT = fract(aS.w * 7.3); vP = c; vR = dir; vU = s; vF = -V; vB = position.x * .5 + .5;
  float pulse = .4 + .6 * sin(uTime * 1.7 + aS.w * 50.0 + dot(w, vec2(.05, .03))); vA = uDens * clamp(pulse, 0.0, 1.0) * (1.0 - smoothstep(.65, 1.0, length(rel.xz) / (uBox.x * .5))) * smoothstep(2.0, 7.0, d); vec4 mv = viewMatrix * vec4(p, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv;
}`;
const DUST_FS = /* glsl */`
${LIGHT_GLSL}${SOFT_GLSL}${PUFF_GLSL}
uniform vec3 uCol; varying vec2 vUv; varying float vA, vZ, vT, vB; varying vec3 vP, vR, vU, vF;
void main(){ vec4 s = puffSample(vUv, vT); float a = vA * s.r * (.4 + .6 * s.b) * fxSoft(vZ, .8) * smoothstep(0.0, .25, vB) * .5; if (a < .003) discard; gl_FragColor = vec4(uCol * fxScatter(vP, -vF, 1.1) * a, a); }`;

const LITTER = { plains: [[0.36, 0.33, 0.16], [0.3, 0.27, 0.12]], wheat: [[0.62, 0.5, 0.24], [0.55, 0.43, 0.2]], cornbelt: [[0.3, 0.36, 0.14], [0.4, 0.4, 0.18]], desert: [[0.42, 0.34, 0.22], [0.35, 0.27, 0.18]], mountain: [[0.2, 0.25, 0.12], [0.22, 0.2, 0.1]], forest: [[0.22, 0.28, 0.1], [0.36, 0.28, 0.1]], swamp: [[0.2, 0.28, 0.1], [0.24, 0.26, 0.1]], coast: [[0.3, 0.33, 0.16], [0.28, 0.28, 0.13]], urban: [[0.5, 0.5, 0.48], [0.3, 0.26, 0.14]] };
const LEAF = { forest: 0.75, swamp: 0.7, mountain: 0.6, urban: 0.5, plains: 0.25, cornbelt: 0.45, wheat: 0.08, coast: 0.4, desert: 0.1 };

export function createWindFx(ctx, soft, ground) {
  const q = Math.max(0.25, ctx.quality.particles), G = ctx.globals;
  const mk = (n, vs, fs, u, order, sd) => { const g = quad(); g.setAttribute('aS', new THREE.InstancedBufferAttribute(seeds(n, 4, sd), 4)); g.instanceCount = n; const m = fxMat({ vertexShader: vs, fragmentShader: fs, uniforms: { ...lightUniforms(G), ...ground.uniforms, uDens: { value: 0 }, uPx: { value: 0.001 }, uShift: { value: new THREE.Vector3() }, uWindV: { value: new THREE.Vector3() }, ...u } }); soft.register(m); const me = noCull(new THREE.Mesh(g, m), order); ctx.fxScene.add(me); return { mesh: me, u: m.uniforms, g, n, off: new THREE.Vector3() }; };
  const bits = mk(Math.round(1700 * q), BIT_VS, BIT_FS, { uBox: { value: new THREE.Vector3(46, 5, 46) }, uColA: { value: new THREE.Color(0.3, 0.3, 0.15) }, uColB: { value: new THREE.Color(0.3, 0.25, 0.12) }, uLeaf: { value: 0.3 } }, 10, 51);
  const dust = mk(Math.round(260 * q), DUST_VS, DUST_FS, { uBox: { value: new THREE.Vector3(90, 4, 90) }, uCol: { value: new THREE.Color(0.4, 0.3, 0.2) }, uAtlas: { value: puffAtlas() } }, 11, 57);
  const md = (a, b) => ((a % b) + b) % b; let bT = 0, dusty = 0.6; const cA = new THREE.Color(), cB = new THREE.Color(), cD = new THREE.Color(0.4, 0.3, 0.2);
  return {
    update(dt, wind, cam, px, agl) {
      const sp = Math.hypot(wind.x, wind.z), wet = G.uWetness.value;
      if ((bT -= dt) < 0) { bT = 0.7; const b = ctx.world?.biomeAt?.(cam.x, cam.z), s = ctx.world?.surfaceAt?.(cam.x, cam.z), L = LITTER[b?.id] || LITTER.plains; cA.setRGB(...L[0]); cB.setRGB(...L[1]); bits.u.uLeaf.value = LEAF[b?.id] ?? 0.3; const d = b?.dustColor || [0.42, 0.3, 0.2]; cD.setRGB(d[0], d[1], d[2]); dusty = (b?.id === 'desert' ? 1 : b?.id === 'plains' || b?.id === 'wheat' ? 0.75 : b?.id === 'cornbelt' ? 0.6 : 0.3) * (s?.type === 'water' ? 0 : 1); }
      bits.u.uColA.value.lerp(cA, 0.05); bits.u.uColB.value.lerp(cB, 0.05); dust.u.uCol.value.lerp(cD, 0.05); const low = 1 - smoothstep(8, 30, agl);
      for (const L of [bits, dust]) { const k = L === bits ? 0.72 : 0.85, B = L.u.uBox.value; L.off.x = md(L.off.x + wind.x * k * dt, B.x); L.off.z = md(L.off.z + wind.z * k * dt, B.z); L.u.uShift.value.set(md(L.off.x - cam.x, B.x), 0, md(L.off.z - cam.z, B.z)); L.u.uPx.value = px; L.u.uWindV.value.set(wind.x, 0, wind.z); }
      const db = smoothstep(8, 34, sp) * 0.95 * low; bits.mesh.visible = db > 0.005; bits.u.uDens.value = db; bits.g.instanceCount = bits.n;
      const dd = smoothstep(12, 34, sp) * dusty * (1 - 0.92 * clamp(wet * 1.6)) * low; dust.mesh.visible = dd > 0.01; dust.u.uDens.value = dd * 0.55;
    },
  };
}

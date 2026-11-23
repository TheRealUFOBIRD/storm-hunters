// Pooled, GPU-integrated sprite particles (smoke, dust, spray, mud, sparks, glows). CPU only writes the spawn record.
import * as THREE from 'three';
import { LIGHT_GLSL, SOFT_GLSL, PUFF_GLSL, quad, fxMat, lightUniforms, noCull, puffAtlas } from './common.js';

// types: 0 lit puff, 1 spark (emissive streak), 2 spray (fine translucent), 3 clod (solid lump), 4 wind streak dust (stretched puff), 5 glow (additive halo), 6 bit (tumbling flake: leaf / paper / shingle)
export const P = { PUFF: 0, SPARK: 1, SPRAY: 2, CLOD: 3, STREAK: 4, GLOW: 5, BIT: 6 };
const VS = /* glsl */`
attribute vec4 a0, a1, a2, a3, a4; uniform float uNow, uPx; varying vec2 vUv; varying vec4 vC; varying float vType, vTile, vZ, vAge, vGy; varying vec3 vP, vR, vU, vF;
void main(){
  float age = uNow - a0.w, life = a1.w, k = age / life; vType = floor(a3.z + .5);
  if (k < 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float drag = max(a2.w, 1e-3), e = (1.0 - exp(-drag * age)) / drag; float gy = vType == 1.0 || vType == 3.0 || vType == 2.0 ? -9.81 : vType == 6.0 ? -2.2 : vType == 5.0 ? 0.0 : .35;
  vec3 p = a0.xyz + a2.xyz * age + (a1.xyz - a2.xyz) * e; p.y += gy / drag * (age - e);
  vec3 v = a2.xyz + (a1.xyz - a2.xyz) * exp(-drag * age); v.y += gy / drag * (1.0 - exp(-drag * age));
  float seed = a3.w, size = mix(a3.x, a3.y, vType == 0.0 || vType == 4.0 ? sqrt(k) : k);
  vec3 D = p - cameraPosition; float d = length(D); vec3 V = D / max(d, .01); vec3 R = normalize(cross(V, vec3(0, 1, 0))), U = cross(R, V);
  vec2 q = position.xy;
  if (vType == 1.0 || vType == 4.0) { vec3 dv = normalize(v + vec3(1e-4)); vec3 s = cross(dv, V); s /= max(length(s), .05); float L = vType == 1.0 ? size + length(v) * .022 : size * 2.4; float w = max(size, d * uPx * .7); p += dv * q.y * L + s * q.x * w; R = s; U = dv; }
  else { float an = seed * 6.283 + (vType == 6.0 ? age * (6.0 + 9.0 * seed) : (seed - .5) * 1.4 * age); float c = cos(an), s = sin(an); vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y); if (vType == 6.0) r.y *= .25 + .75 * abs(sin(age * (5.0 + 8.0 * fract(seed * 7.0)))); if (vType != 0.0) size = max(size, d * uPx * .6); p += (R * r.x + U * r.y) * size; vec3 R2 = R * c + U * s, U2 = U * c - R * s; R = R2; U = U2; }
  vAge = k; vUv = position.xy * .5 + .5; vTile = fract(seed * 31.7); vC = a4; vP = p; vR = R; vU = U; vF = -V;
  float fi = vType == 1.0 || vType == 5.0 ? 1.0 - k : smoothstep(0.0, .12, k) * (1.0 - smoothstep(.35, 1.0, k)); if (vType == 3.0 || vType == 6.0) fi = 1.0 - smoothstep(.8, 1.0, k);
  vC.a *= fi * (vType == 0.0 || vType == 4.0 ? smoothstep(size * .15, size * .9 + .5, d) : 1.0);
  vec4 mv = viewMatrix * vec4(p, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */`
${LIGHT_GLSL}${SOFT_GLSL}${PUFF_GLSL}
varying vec2 vUv; varying vec4 vC; varying float vType, vTile, vZ, vAge; varying vec3 vP, vR, vU, vF;
void main(){
  vec2 c = vUv * 2.0 - 1.0; float r2 = dot(c, c);
  if (vType == 1.0) { float a = exp(-c.x * c.x * 5.0) * smoothstep(1.0, .0, abs(c.y)); vec3 k = mix(vec3(1.0, .28, .05), vec3(1.0, .85, .6), pow(1.0 - vAge, 2.0)); gl_FragColor = vec4(vC.rgb * k * a * vC.a, 0.0); return; }
  if (vType == 5.0) { float a = max(0.0, exp(-r2 * 5.0) + .25 / (1.0 + 40.0 * r2) - .0062) * smoothstep(1.0, .3, r2); gl_FragColor = vec4(vC.rgb * a * vC.a * fxSoft(vZ, 8.0), 0.0); return; }
  if (vType == 3.0) { if (r2 > .75 + .25 * sin(atan(c.y, c.x) * 3.0 + vTile * 20.0)) discard; vec3 N = normalize(vR * c.x + vU * c.y + vF * .7); float l = max(dot(N, uSunDir), 0.0); vec3 L = uAmbient * (.6 + .4 * N.y) + uSunColor * fxSunVis() * l + fxLightning(vP); float a = min(vC.a, 1.0); gl_FragColor = vec4(vC.rgb * L * a, a); return; }
  if (vType == 6.0) { vec2 w = abs(c); if (w.x + w.y * .6 > 1.0 - .25 * sin(c.x * 5.0 + vTile * 30.0)) discard; vec3 L = uAmbient * 1.0 + uSunColor * fxSunVis() * .35 + fxLightning(vP); gl_FragColor = vec4(vC.rgb * L * vC.a, vC.a); return; }
  vec4 s = puffSample(vUv, vTile);
  if (vType == 2.0) { float a = vC.a * smoothstep(.25, .9, s.r) * (.35 + .65 * s.b) * fxSoft(vZ, .4); vec3 L = fxScatter(vP, -vF, 1.6); gl_FragColor = vec4(vC.rgb * L * a, a); return; }
  float den = vType == 4.0 ? s.r * (.55 + .45 * s.b) : s.r; float a = vC.a * smoothstep(vAge * .42, 1.0, den) * fxSoft(vZ, 1.2); if (a < .003) discard;
  gl_FragColor = vec4(vC.rgb * puffLight(vUv, vTile, vR, vU, vF, vP, 1.0) * a, a);
}`;

export function createParticles(ctx, soft, cap) {
  const N = Math.max(400, Math.round(cap)), STR = 20, data = new Float32Array(N * STR), buf = new THREE.InstancedInterleavedBuffer(data, STR, 1); buf.setUsage(THREE.DynamicDrawUsage); for (let i = 0; i < N; i++) { data[i * STR + 3] = -1e6; data[i * STR + 7] = 1; }
  const g = quad(); for (let i = 0; i < 5; i++) g.setAttribute('a' + i, new THREE.InterleavedBufferAttribute(buf, 4, i * 4)); g.instanceCount = N;
  const u = { ...lightUniforms(ctx.globals), uNow: { value: 0 }, uPx: { value: 0.001 }, uAtlas: { value: puffAtlas() } }, m = fxMat({ vertexShader: VS, fragmentShader: FS, uniforms: u }); soft.register(m); const mesh = noCull(new THREE.Mesh(g, m), 12); ctx.fxScene.add(mesh);
  let head = 0, lo = 1e9, hi = -1, wrapped = false, now = 0, last = -1;
  const api = {
    mesh, N, get now() { return now; },
    // w = ambient velocity the particle relaxes to (wind), drag 1/s
    emit(type, x, y, z, vx, vy, vz, life, s0, s1, cr, cg, cb, al, drag = 1, wx = 0, wy = 0, wz = 0, delay = 0) {
      const o = head * STR; data[o] = x; data[o + 1] = y; data[o + 2] = z; data[o + 3] = now + delay; data[o + 4] = vx; data[o + 5] = vy; data[o + 6] = vz; data[o + 7] = life; data[o + 8] = wx; data[o + 9] = wy; data[o + 10] = wz; data[o + 11] = drag; data[o + 12] = s0; data[o + 13] = s1; data[o + 14] = type; data[o + 15] = Math.random(); data[o + 16] = cr; data[o + 17] = cg; data[o + 18] = cb; data[o + 19] = al;
      if (head < lo) lo = head; if (head > hi) hi = head; if (++head >= N) { head = 0; wrapped = true; } if (now + delay + life > last) last = now + delay + life;
    },
    update(dt, px) {
      now += dt; u.uNow.value = now; u.uPx.value = px; mesh.visible = now < last;
      if (hi >= 0) { buf.clearUpdateRanges(); if (!wrapped) buf.addUpdateRange(lo * STR, (hi - lo + 1) * STR); buf.needsUpdate = true; lo = 1e9; hi = -1; wrapped = false; }
    },
  };
  return api;
}

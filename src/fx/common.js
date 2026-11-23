// Shared bits for all FX: lighting GLSL, soft depth, terrain height window texture, procedural sprite atlas.
import * as THREE from 'three';
import { gnoise, fbm } from '../core/noise.js';

export const LIGHT_GLSL = /* glsl */`
uniform vec3 uSunDir, uSunColor, uAmbient; uniform vec4 uLightning; uniform float uStormDark;
float fxHash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
float fxH1(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec3 fxH3(float n){ return fract(vec3(n * .1031, n * .1130, n * .0973) * vec3(1.0, 1.37, 1.71) + fract(n * vec3(.754877, .569840, .438579))); }
float fxSunVis(){ return 1.0 - 0.3 * smoothstep(.1, .8, uStormDark); }
vec3 fxLightning(vec3 p){ vec3 d = uLightning.xyz - p; return vec3(.72, .8, 1.0) * uLightning.w / (1.0 + dot(d, d) * 4e-7); }
// isotropic light for tiny scatterers (rain, dust): g = forward scattering boost toward the sun
vec3 fxScatter(vec3 p, vec3 V, float g){
  float m = max(dot(-V, uSunDir), 0.0); return uAmbient + uSunColor * fxSunVis() * (0.16 + g * pow(m, 6.0)) + fxLightning(p);
}
`;

// depth fading. RENDER publishes ctx.gfx.depthTexture / resolution / cameraNearFar / depthK (uShDepth)
export const SOFT_GLSL = /* glsl */`
#ifdef FX_SOFT
uniform sampler2D uFxDepth; uniform vec2 uFxRes; uniform vec4 uFxDK;
float fxSceneDist(){ return uFxDK.y / (texture2D(uFxDepth, gl_FragCoord.xy / uFxRes).r * uFxDK.z + uFxDK.w + uFxDK.x); }
float fxSoft(float viewZ, float range){ return clamp((fxSceneDist() - viewZ) / range, 0.0, 1.0); }
#else
float fxSoft(float viewZ, float range){ return 1.0; }
#endif
`;
// terrain window: R32F toroidal height texture around the camera
export const GROUND_GLSL = /* glsl */`
uniform sampler2D uHTex; uniform vec4 uHInfo; // cell, n, originX, originZ (world xz of texel index base is absolute cell index)
float fxGround(vec2 p){
  vec2 c = p / uHInfo.x, i = floor(c), f = c - i; int n = int(uHInfo.y);
  ivec2 a = ivec2(mod(i, uHInfo.y)), b = ivec2(mod(i + 1.0, uHInfo.y));
  float h00 = texelFetch(uHTex, a, 0).r, h10 = texelFetch(uHTex, ivec2(b.x, a.y), 0).r, h01 = texelFetch(uHTex, ivec2(a.x, b.y), 0).r, h11 = texelFetch(uHTex, b, 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}
`;

export function makeSoft(ctx) {
  const u = { uFxDepth: { value: null }, uFxRes: { value: new THREE.Vector2(1, 1) }, uFxDK: { value: new THREE.Vector4() } }; let mats = []; let on = false;
  return {
    uniforms: u, reset() { mats = []; }, register(m) { mats.push(m); Object.assign(m.uniforms, u); if (on) m.defines.FX_SOFT = 1; },
    update() {
      const g = ctx.gfx, dt = g?.depthTexture; const tex = dt?.isTexture ? dt : dt?.value?.isTexture ? dt.value : null, want = !!tex;
      if (tex) {
        u.uFxDepth.value = tex; const r = g.resolution?.value ?? g.resolution; if (r) u.uFxRes.value.set(r.x ?? r.width ?? r[0], r.y ?? r.height ?? r[1]);
        const k = g.depthParams?.value ?? g.depthParams; if (k) u.uFxDK.value.copy(k); else { const e = ctx.camera.projectionMatrix.elements; u.uFxDK.value.set(e[10], e[14], 2, -1); }
      }
      if (want !== on) { on = want; for (const m of mats) { if (on) m.defines.FX_SOFT = 1; else delete m.defines.FX_SOFT; m.needsUpdate = true; } }
    },
  };
}

export function makeGround(ctx, n = 64, cell = 2.5) {
  const data = new Float32Array(n * n), tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType); tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
  const u = { uHTex: { value: tex }, uHInfo: { value: new THREE.Vector4(cell, n, 0, 0) } }; let cx = 1e9, cz = 1e9; const md = (a) => ((a % n) + n) % n;
  return {
    uniforms: u, half: n * cell / 2 - cell * 2,
    update(p) {
      const w = ctx.world; if (!w) return; const ix = Math.floor(p.x / cell), iz = Math.floor(p.z / cell); if (ix === cx && iz === cz) return; const h = n >> 1, jump = Math.abs(ix - cx) >= n || Math.abs(iz - cz) >= n;
      for (let z = iz - h; z < iz + h; z++) for (let x = ix - h; x < ix + h; x++) {
        if (!jump && x >= cx - h && x < cx + h && z >= cz - h && z < cz + h) { x = Math.min(ix + h, cx + h) - 1; continue; }
        data[md(z) * n + md(x)] = w.heightAt(x * cell, z * cell);
      }
      cx = ix; cz = iz; tex.needsUpdate = true;
    },
  };
}

// 4x4 puff atlas: R = density, G = height (for fake normals), B = fine detail
let _atlas;
export function puffAtlas() {
  if (_atlas) return _atlas; const T = 128, N = 4, S = T * N, d = new Uint8Array(S * S * 4), g = new Float32Array(T * T);
  for (let k = 0; k < N * N; k++) {
    const ox = (k % N) * T, oy = Math.floor(k / N) * T;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const u = (x + 0.5) / T * 2 - 1, v = (y + 0.5) / T * 2 - 1, wx = fbm(u * 1.3 + k * 7.1, v * 1.3, 3, 11) * 0.5, wy = fbm(u * 1.3, v * 1.3 + k * 5.3, 3, 17) * 0.5;
      const r = Math.hypot(u + wx * 0.55, v + wy * 0.55), n = fbm(u * 2.1 + wx + k * 3.7, v * 2.1 + wy - k * 2.9, 5, 23) * 1.25, e = 1 - Math.hypot(u, v);
      let q = (0.86 - r) * 1.5 + n * 0.85; q = Math.max(0, Math.min(1, q)); q = q * q * (3 - 2 * q); q *= Math.max(0, Math.min(1, e * 3.2));
      g[y * T + x] = q; const i = ((oy + y) * S + ox + x) * 4; d[i] = q * 255; d[i + 1] = Math.max(0, Math.min(1, 0.45 * (1 - r) + 0.5 + n * 0.45)) * 255; d[i + 2] = Math.max(0, Math.min(1, 0.5 + 0.9 * gnoise(u * 9 + k, v * 9, 29))) * 255; d[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return (_atlas = t);
}

// lit puff shading from the atlas. N from the height channel + sphere-ish bulge
export const PUFF_GLSL = /* glsl */`
uniform sampler2D uAtlas;
vec4 puffSample(vec2 uv, float tile){ float t = floor(tile * 15.99); vec2 o = vec2(mod(t, 4.0), floor(t / 4.0)); return texture2D(uAtlas, (o + clamp(uv, 0.012, 0.988)) * 0.25); }
// uv 0..1, right/up/fwd = billboard axes in world; returns rgb light
vec3 puffLight(vec2 uv, float tile, vec3 R, vec3 U, vec3 F, vec3 pos, float aoY){
  float e = 0.035; float h = puffSample(uv, tile).g, hx = puffSample(uv + vec2(e, 0.0), tile).g, hy = puffSample(uv + vec2(0.0, e), tile).g;
  vec2 c = uv * 2.0 - 1.0; vec3 n = normalize(vec3((h - hx) * 2.6 + c.x * 0.75, (h - hy) * 2.6 + c.y * 0.75, 0.62));
  vec3 N = normalize(R * n.x + U * n.y + F * n.z); float sv = fxSunVis();
  float nl = dot(N, uSunDir), sun = max(nl * 0.75 + 0.25, 0.0) * 0.62 + 0.45 * pow(max(dot(-F, uSunDir), 0.0), 8.0);
  vec3 amb = uAmbient * (0.62 + 0.38 * N.y) * mix(0.55, 1.05, h) * aoY;
  vec3 ld = uLightning.xyz - pos; vec3 lt = fxLightning(pos) * (0.45 + 0.55 * max(dot(N, normalize(ld + vec3(0.0, 1e-3, 0.0))), 0.0));
  return amb + uSunColor * sv * sun * mix(0.6, 1.0, h) + lt;
}
`;
export const quad = () => { const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9); return g; };
export const seeds = (n, k = 4, s = 1) => { const a = new Float32Array(n * k); let q = s * 7919 + 13; for (let i = 0; i < n * k; i++) { q = (q + 0x6d2b79f5) >>> 0; let t = q; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); a[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296; } return a; };
// premultiplied-alpha transparent material
export function fxMat(o) {
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: true, toneMapped: false, fog: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, side: THREE.DoubleSide, ...o, defines: { ...(o.defines || {}) } });
}
export const lightUniforms = (g) => ({ uSunDir: g.uSunDir, uSunColor: g.uSunColor, uAmbient: g.uAmbient, uLightning: g.uLightning, uStormDark: g.uStormDark, uTime: g.uTime });
export const noCull = (m, order = 0) => { m.frustumCulled = false; m.renderOrder = order; m.matrixAutoUpdate = false; return m; };

// Water: ocean (camera-following radial grid + Gerstner swell), lakes (polygons) and rivers (flow-mapped ribbons).
// With the real render pipeline the water is drawn in ctx.fxScene, i.e. after the opaque pass + sky/volume composite, so it can
// read scene depth (soft shores, Beer-Lambert thickness, foam) and scene colour (refraction, screen-space reflections).
// Waves: procedural FFT (Phillips-like) slope maps stored as LEAN moments (mean slope + second moments), so distant water gets the
// correct glossy roughness instead of sparkling. Everything is generated here; no downloaded textures.
import * as THREE from 'three';
import { ShapeUtils, DataUtils } from 'three';
import { GX, GZ, OX, OZ, CELL } from './sampler.js';

// ---------------------------------------------------------------- water types (deep albedo = body reflectance, ext = extinction 1/m)
// 0 ocean, 1 great lake, 2 green lake, 3 muddy plains river, 4 clear/green river, 5 salt lake, 6 alpine lake, 7 red muddy
const TYPES = [
  { alb: [.0035, .016, .028], ext: [.32, .06, .045] },
  { alb: [.005, .021, .022], ext: [.5, .16, .17] },
  { alb: [.011, .028, .017], ext: [.6, .24, .4] },
  { alb: [.07, .05, .029], ext: [1.6, 2.0, 2.7] },
  { alb: [.012, .026, .019], ext: [.7, .3, .38] },
  { alb: [.028, .055, .05], ext: [.42, .13, .13] },
  { alb: [.003, .013, .036], ext: [.26, .045, .035] },
  { alb: [.085, .043, .024], ext: [1.9, 2.5, 3.1] },
];
const MUDDY = /Mississippi|Missouri|Arkansas|Canadian|Cimarron|Platte|Kansas|Brazos|Illinois|Wabash|Ohio|Yellowstone/;
const lakeType = (n) => (/Superior|Michigan|Huron|Erie|Ontario/.test(n) ? 1 : /Salt/.test(n) ? 5 : /Tahoe/.test(n) ? 6 : /Texoma/.test(n) ? 7 : 2);
const riverType = (n) => (/Red River/.test(n) ? 7 : MUDDY.test(n) ? 3 : 4);

// ---------------------------------------------------------------- procedural textures
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function fft1(re, im, n) { // in-place radix-2 (sign irrelevant: random phases)
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const a = 2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < h; k++) { const p = i + k, q = p + h, xr = re[q] * cr - im[q] * ci, xi = re[q] * ci + im[q] * cr; re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
}
function fft2(re, im, N) {
  const r = new Float32Array(N), i = new Float32Array(N);
  for (let y = 0; y < N; y++) { const o = y * N; for (let x = 0; x < N; x++) { r[x] = re[o + x]; i[x] = im[o + x]; } fft1(r, i, N); for (let x = 0; x < N; x++) { re[o + x] = r[x]; im[o + x] = i[x]; } }
  for (let x = 0; x < N; x++) { for (let y = 0; y < N; y++) { r[y] = re[y * N + x]; i[y] = im[y * N + x]; } fft1(r, i, N); for (let y = 0; y < N; y++) { re[y * N + x] = r[y]; im[y * N + x] = i[y]; } }
}
// wave field: returns { mom: half-float RGBA (sx, sz, sx², sz²) with mip chain, h: Float32 height -1..1 }
function waveField(N, seed) {
  const R = rng(seed), Hr = new Float32Array(N * N), Hi = new Float32Array(N * N);
  const g = () => { const u = Math.max(1e-7, R()), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const kp = 3.2, kc = N * .3;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const kx = i <= N / 2 ? i : i - N, kz = j <= N / 2 ? j : j - N, k = Math.hypot(kx, kz), o = j * N + i; const a = g(), b = g(); if (k < 1) continue;
    const c = kx / k, dir = .22 + .78 * c * c * c * c, P = Math.exp(-((kp / k) ** 2) * 1.2) * Math.pow(k, -3.4) * dir * Math.exp(-((k / kc) ** 2)), s = Math.sqrt(P);
    Hr[o] = a * s; Hi[o] = b * s;
  }
  const hr = Hr.slice(), hi = Hi.slice(), xr = new Float32Array(N * N), xi = new Float32Array(N * N), zr = new Float32Array(N * N), zi = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const kx = i <= N / 2 ? i : i - N, kz = j <= N / 2 ? j : j - N, o = j * N + i; xr[o] = -Hi[o] * kx; xi[o] = Hr[o] * kx; zr[o] = -Hi[o] * kz; zi[o] = Hr[o] * kz; }
  fft2(hr, hi, N); fft2(xr, xi, N); fft2(zr, zi, N);
  let ss = 0, hm = 0; for (let k = 0; k < N * N; k++) { ss += xr[k] * xr[k] + zr[k] * zr[k]; hm = Math.max(hm, Math.abs(hr[k])); }
  const rs = 1 / Math.sqrt(ss / (2 * N * N)); for (let k = 0; k < N * N; k++) hr[k] /= hm;
  // LEAN moments + mip chain (box filter keeps moments exact)
  let w = N, lv = new Float32Array(N * N * 4); for (let k = 0; k < N * N; k++) { const a = xr[k] * rs, b = zr[k] * rs; lv[k * 4] = a; lv[k * 4 + 1] = b; lv[k * 4 + 2] = a * a; lv[k * 4 + 3] = b * b; }
  const levels = [lv];
  while (w > 1) { const n = w >> 1, d = new Float32Array(n * n * 4); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 4; c++) { const s = (2 * y * w + 2 * x) * 4 + c; d[(y * n + x) * 4 + c] = (lv[s] + lv[s + 4] + lv[s + w * 4] + lv[s + w * 4 + 4]) * .25; } levels.push(d); lv = d; w = n; }
  const toH = (f) => { const u = new Uint16Array(f.length); for (let k = 0; k < f.length; k++) u[k] = DataUtils.toHalfFloat(f[k]); return u; };
  const mips = levels.map((d, l) => ({ data: toH(d), width: N >> l, height: N >> l }));
  const t = new THREE.DataTexture(mips[0].data, N, N, THREE.RGBAFormat, THREE.HalfFloatType); t.mipmaps = mips; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
  return { tex: t, h: hr };
}
// aux RGBA8: r = wave height (same tiling as the wave field), g = foam cells, b = caustics, a = smooth large-scale noise
function auxTex(N, h, seed) {
  const R = rng(seed), d = new Uint8Array(N * N * 4);
  const worley = (cells) => { const P = new Float32Array(cells * cells * 2); for (let k = 0; k < P.length; k++) P[k] = R(); const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const u = x / N * cells, v = y / N * cells, ci = Math.floor(u), cj = Math.floor(v); let f1 = 9, f2 = 9;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = ci + a, jj = cj + b, q = ((jj + cells) % cells * cells + (ii + cells) % cells) * 2, dx = ii + P[q] - u, dz = jj + P[q + 1] - v, e = dx * dx + dz * dz; if (e < f1) { f2 = f1; f1 = e; } else if (e < f2) f2 = e; }
      out[y * N + x] = Math.sqrt(f2) - Math.sqrt(f1); } return out; };
  const f1 = worley(10), f2 = worley(23), c1 = worley(7);
  const vn = (cells) => { const G = new Float32Array(cells * cells); for (let k = 0; k < G.length; k++) G[k] = R(); return (x, y) => { const u = x / N * cells, v = y / N * cells, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, s = (t) => t * t * (3 - 2 * t), at = (ii, jj) => G[((jj % cells) * cells) + (ii % cells)]; return (at(i, j) * (1 - s(a)) + at(i + 1, j) * s(a)) * (1 - s(b)) + (at(i, j + 1) * (1 - s(a)) + at(i + 1, j + 1) * s(a)) * s(b); }; };
  const n1 = vn(4), n2 = vn(9);
  for (let k = 0, y = 0; y < N; y++) for (let x = 0; x < N; x++, k++) {
    const foam = Math.min(1, Math.max(0, 1 - f1[k] * 3.2) * .65 + Math.max(0, 1 - f2[k] * 4.5) * .55);
    const ca = Math.pow(Math.max(0, 1 - c1[k] * 4), 3);
    d[k * 4] = Math.round((h[k] * .5 + .5) * 255); d[k * 4 + 1] = Math.round(foam * 255); d[k * 4 + 2] = Math.round(ca * 255); d[k * 4 + 3] = Math.round((n1(x, y) * .65 + n2(x, y) * .35) * 255);
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- shaders
const VS = /* glsl */`
attribute vec4 aW; // flow.xz (m/s), type, across (-1..1)
attribute float aM; varying float vM; // aM: per-vertex visibility (0 over roads / perched banks)
uniform vec4 uGw[5]; uniform float uGQ, uTime; uniform sampler2D uDep; uniform vec4 uDepXf;
varying vec3 vWp; varying vec4 vW; varying vec3 vGN; varying vec2 vMac;
void main(){
  vec4 wp = modelMatrix*vec4(position,1.); vec3 n = vec3(0.,1.,0.); vMac = vec2(0.);
  if(aW.z < .5){
    vec4 m = textureLod(uDep, (wp.xz-uDepXf.xy)*uDepXf.zw, 0.); float dm = m.r*42.5; vMac = vec2(dm, m.g);
    float sh = smoothstep(.4, 9., dm), r = length(wp.xz-cameraPosition.xz); vec3 d = vec3(0.), nn = vec3(0.);
    for(int i=0;i<5;i++){ vec4 g = uGw[i]; float k = g.z, lam = 6.2832/k, a = g.w*sh*(1.-smoothstep(lam*1.8, lam*2.8, r)); if(a < 1e-4) continue;
      float ph = k*dot(g.xy, wp.xz) - sqrt(9.81*k)*uTime + float(i)*1.7, c = cos(ph), s = sin(ph), qa = min(uGQ/(k*5.), a);
      d.xz += qa*g.xy*c; d.y += a*s; nn.xz += g.xy*k*a*c; nn.y += k*qa*s; }
    wp.xyz += d; n = normalize(vec3(-nn.x, 1.-nn.y, -nn.z));
  }
  vWp = wp.xyz; vW = aW; vGN = n; vM = aM;
  gl_Position = projectionMatrix*viewMatrix*wp;
}`;

const FS = (fogGLSL, depthGLSL) => /* glsl */`
#ifdef PIPE
${depthGLSL}
${fogGLSL}
#endif
#ifndef sat
#define sat(x) clamp(x,0.,1.)
#endif
#ifndef PI
#define PI 3.14159265359
#endif
#ifdef ENV_CUBEUV
#define ENVMAP_TYPE_CUBE_UV
#include <cube_uv_reflection_fragment>
uniform sampler2D uEnv;
#endif
uniform sampler2D uNrm, uAux, uDepth, uColor, uVol, uDep; uniform vec4 uDepXf;
uniform vec4 uDepthK, uAmp, uTor, uLightning; uniform vec2 uRes, uWindDir, uWind; uniform mat4 uVP;
uniform float uTime, uRain, uGust, uWc, uStormDark, uHasCol, uHasVol, uEnvOn, uFlowT; uniform vec2 uDrift; // uDrift: wind drift integrated on the CPU (m per m/s): speed changes only change the rate, never jump the pattern
uniform vec3 uSunDir, uSunColor, uAmbient; uniform vec3 uAlb[8], uExt[8];
varying vec3 vWp; varying vec4 vW; varying vec3 vGN; varying vec2 vMac; varying float vM; uniform vec4 uSpot[2], uSpotD[2];

float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(.06711056,.00583715)))); }
float h12(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
// LEAN layer: acc.xy mean slope (world), acc.z slope variance (trace)
void lay(vec2 p, float L, float ang, vec2 drift, float a, float w, inout vec3 acc){
  float c=cos(ang), s=sin(ang); vec2 q=vec2(c*p.x+s*p.y, -s*p.x+c*p.y)/L + drift; vec4 t=texture2D(uNrm, q);
  vec2 sl=t.xy*a; acc.xy += w*vec2(c*sl.x-s*sl.y, s*sl.x+c*sl.y); acc.z += w*a*a*max(t.z-t.x*t.x+t.w-t.y*t.y, 0.) + w*(1.-w)*a*a*dot(t.xy,t.xy);
}
vec2 ripples(vec2 p, float t){ // expanding rain rings, two staggered grids
  vec2 s=vec2(0.);
  for(int l=0;l<2;l++){ float sc=l==0?1.9:1.3; vec2 q=p*sc+float(l)*.37; vec2 i=floor(q), f=fract(q)-.5; float h=h12(i+float(l)*13.); float ph=fract(t*(1.1+.3*h)+h*7.);
    vec2 c=(vec2(h, h12(i*1.7+5.))-.5)*.45; vec2 d=f-c; float r=length(d); float R=ph*.42; float e=(r-R)*28.; float wv=sin(e*3.)*exp(-e*e*.6)*(1.-ph)*(1.-ph);
    s += d/max(r,1e-3)*wv*step(h12(i+3.1), uRain*1.1); }
  return s*.55;
}
float schlick(float c, float f0){ float x=1.-c; float x2=x*x; return f0+(1.-f0)*x2*x2*x; }
vec3 envRefl(vec3 R, float rough){
#ifdef ENV_CUBEUV
  if(uEnvOn>.5) return textureCubeUV(uEnv, R, rough).rgb;
#endif
#ifdef PIPE
  return skyRad(normalize(vec3(R.x, max(R.y,.02), R.z)));
#else
  return mix(vec3(.35,.42,.5), vec3(.12,.25,.5), sat(R.y*2.));
#endif
}
#ifdef PIPE
vec2 proj(vec3 P, out float ok){ vec4 c=uVP*vec4(P,1.); ok=c.w>0.?1.:0.; return c.xy/max(c.w,1e-4)*.5+.5; }
float vdepth(vec3 P){ return -(viewMatrix*vec4(P,1.)).z; }
float sdepth(vec2 uv){ return shLinearDepth(textureLod(uDepth, uv, 0.).r, uDepthK); }
#endif

void main(){
  vec3 P = vWp, cam = cameraPosition, toC = cam-P; float dist = length(toC); vec3 V = toC/dist, rd = -V;
  int ty = int(vW.z+.5); vec3 alb = uAlb[ty], ext = uExt[ty];
  bool under = cam.y < P.y - .05 && dist < 400.;
  vec2 p = P.xz;
  // ---------------- scene depth: bottom position, water thickness
  vec2 uv = gl_FragCoord.xy/uRes; float sd = 1e5, path = 60., depthV = 30.;
#ifdef PIPE
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float zs = sdepth(uv); sd = zs/max(dot(rd,fwd),.02); path = max(sd-dist, 0.);
  if(zs < 59000. && sd < dist - .3 - dist*.003) discard; // belt and braces: never draw over opaque geometry in front of the surface
  vec3 B = cam + rd*sd; depthV = max(P.y - B.y, 0.); if(zs > 59000.) { depthV = 60.; path = 200.; }
#endif
  if(ty==0){ // ocean: macro depth + turbidity
    float tb = vMac.y; alb = mix(alb, vec3(.03,.038,.022), tb); ext = mix(ext, vec3(1.1,.9,1.), tb);
    float sh = smoothstep(14.,2.,vMac.x)*.6; alb = mix(alb, vec3(.006,.03,.03), sh);
  }
  alb *= mix(vec3(1.), vec3(.85,.95,.92), uStormDark);
  // ---------------- waves (LEAN)
  float ws = length(uWind); float wa = atan(uWindDir.y, uWindDir.x); vec2 wdir = uWindDir;
  vec4 aux0 = texture2D(uAux, (p - uDrift*2.09)/1900.); float paw = mix(.55, 1.35, smoothstep(.25,.8, aux0.a + (texture2D(uAux, (p + uDrift*1.72)/430.).a-.5)*.6)); paw = mix(1., paw, .45+.4*uGust);
  vec3 acc = vec3(0.); float t = uTime;
  float big = ty==0 ? 1. : ty<=2 || ty==5 || ty==6 ? .55 : .12;
  if(ty>=3 && ty!=5 && ty!=6 && dot(vW.xy,vW.xy) > 1e-4){
    // rivers: two-phase flow map along the river direction
    float ph0 = fract(t*uFlowT + aux0.a*1.7), ph1 = fract(ph0+.5), w0 = 1.-abs(2.*ph0-1.);
    float fa = atan(vW.y, vW.x);
    lay(p - vW.xy*ph0/uFlowT, 9.7, fa+.4, vec2(0.), uAmp.z*.8, w0, acc); lay(p - vW.xy*ph1/uFlowT + 3.1, 9.7, fa+.4, vec2(0.), uAmp.z*.8, 1.-w0, acc);
    lay(p - vW.xy*ph0/uFlowT, 2.3, fa-.6, vec2(0.), uAmp.w*.9, w0, acc); lay(p - vW.xy*ph1/uFlowT + 1.3, 2.3, fa-.6, vec2(0.), uAmp.w*.9, 1.-w0, acc);
    lay(p - uDrift*.37, 5.3, .9, vec2(0.), uAmp.w*.5*paw, 1., acc);
    // turbulent boils, slower near the banks
    float edge = abs(vW.w); acc.xy *= mix(1., .55, smoothstep(.6,1.,edge));
  } else {
    // fixed layer orientations (rotating patterns with the wind around the far-away world origin made them jump),
    // motion from the integrated wind drift at each layer's own speed
    lay(p - uDrift*2.04, 97., .31, vec2(0.), uAmp.x*big, 1., acc);
    lay(p - uDrift*1.27, 37., -.47, vec2(0.), uAmp.y*big, 1., acc);
    lay(p - uDrift*.71, 11.3, .83, vec2(0.), uAmp.z*paw, 1., acc);
    lay(p - uDrift*.38, 3.1, -.21, vec2(0.), uAmp.w*paw, 1., acc);
    lay(p - uDrift*.19, .93, 1.9, vec2(0.), uAmp.w*.6*paw, 1., acc);
  }
  if(uRain > .01 && dist < 70.) acc.xy += ripples(p, t*1.6)*uRain*(1.-smoothstep(25.,70.,dist));
  // tornado over water: churned, foaming surface
  float tor = 0.; if(uTor.w > 0.){ vec2 d = p-uTor.xy; float r = length(d); tor = uTor.w*exp(-pow(r/(uTor.z*2.2),2.)); acc.xy += vec2(-d.y,d.x)/max(r,1.)*tor*.25; acc.z += tor*.12; }
  // geometric normal (ocean swell) + detail slope
  vec3 Ng = vGN; vec3 N = normalize(vec3(Ng.x - acc.x*Ng.y, Ng.y, Ng.z - acc.y*Ng.y));
  float a2 = .0009 + acc.z + uRain*.01 + tor*.05; float rough = sqrt(sqrt(a2)); // perceptual roughness for env
  if(under) N = -N;
  float NoV = max(dot(N,V), 1e-3);
  float F = .02 + .98*pow(1.-NoV,5.)*mix(1., .45, sat(rough*1.3-.2)); // roughness-damped Schlick, F0 for IOR 1.33
  // ---------------- reflection
  vec3 R = reflect(rd, N); if(R.y < .005) R = normalize(vec3(R.x, .005 + (.005-R.y)*.3, R.z));
  vec3 env = envRefl(R, rough), refl = env;
#ifdef PIPE
#if SSR_STEPS > 0
  if(uHasCol > .5 && !under){
    float ssrW = (1.-smoothstep(.32,.55,rough))*(1.-smoothstep(7000.,14000.,dist));
    if(ssrW > .01){
      float jit = ign(gl_FragCoord.xy), tt = max(.6, dist*.015)*(.7+.6*jit), tp = 0., ok; vec2 hit = vec2(-1.); float hk = 0.;
      for(int i=0;i<SSR_STEPS;i++){ vec3 Q = P + R*tt; vec2 q = proj(Q, ok); if(ok<.5 || any(lessThan(q,vec2(0.))) || any(greaterThan(q,vec2(1.)))) break;
        float zr = vdepth(Q), zq = sdepth(q);
        if(zr > zq && zq < 59000. && zr-zq < (tt-tp)*1.6 + .6 + zr*.01){ float a=tp, b=tt; for(int k=0;k<5;k++){ float m=(a+b)*.5; vec2 qm=proj(P+R*m, ok); if(vdepth(P+R*m) > sdepth(qm)) b=m; else a=m; } hit = proj(P+R*b, ok); hk = 1.; break; }
        tp = tt; tt *= 1.42; }
      if(hk < .5){ // nothing hit: reflected direction at infinity may still be on screen as sky (+ volumetric clouds)
        vec4 c = uVP*vec4(cam + R*50000., 1.); if(c.w > 0.){ vec2 q = c.xy/c.w*.5+.5; if(all(greaterThan(q,vec2(0.))) && all(lessThan(q,vec2(1.))) && sdepth(q) > 59000.){ hit = q; hk = 1.; } } }
      if(hk > .5){ vec2 e = min(hit, 1.-hit); float fade = smoothstep(0.,.06,e.x)*smoothstep(0.,.1,e.y);
        vec3 s = textureLod(uColor, hit, 0.).rgb; float ls = dot(s,vec3(.2126,.7152,.0722)), lc = 6.*dot(env,vec3(.2126,.7152,.0722))+.05; s *= min(1., lc/max(ls,1e-4));
        refl = mix(env, s, fade*ssrW); }
    }
  }
#endif
#endif
  // lightning: bright flash mirrored on the surface
  if(uLightning.w > .001){ vec3 Ld = normalize(uLightning.xyz - P); refl += vec3(.75,.8,1.)*uLightning.w*(.06 + 2.*pow(max(dot(R,Ld),0.), 24.)); }
  // ---------------- sun glint (GGX, roughness from the LEAN variance)
  vec3 L = uSunDir; vec3 H = normalize(L+V); float NoL = max(dot(N,L),0.), NoH = max(dot(N,H),0.), VoH = max(dot(V,H),0.);
  float ag = clamp(a2, .0012, 1.), dd = NoH*NoH*(ag-1.)+1., D = ag/(PI*dd*dd); float Vis = .5/(NoL*sqrt(NoV*NoV*(1.-ag)+ag) + NoV*sqrt(NoL*NoL*(1.-ag)+ag) + 1e-5);
  vec3 spec = uSunColor*PI*NoL*min(D*Vis, 900.)*schlick(VoH, .02)*(under ? 0. : 1.);
  // ---------------- body (single scattering approx), foam
  vec3 Eb = uSunColor*max(L.y,0.)*.95 + uAmbient;
  // vehicle headlights (spot lights of the local car): diffuse into the water body + specular highlight
  vec3 Eh = vec3(0.);
  for(int i=0;i<2;i++){ vec4 sp = uSpot[i]; if(sp.w <= 0.) continue; vec3 Ld = sp.xyz-P; float d2 = dot(Ld,Ld), dl = sqrt(d2); Ld /= dl;
    float cone = smoothstep(uSpotD[i].w, uSpotD[i].w+.06, dot(-Ld, uSpotD[i].xyz)); float I = sp.w*cone/max(d2,1.)*pow(sat(1.-dl/95.),2.); if(I <= 0.) continue;
    vec3 Hh = normalize(Ld+V); float nl = max(dot(N,Ld),0.), nh = max(dot(N,Hh),0.), e2 = nh*nh*(ag-1.)+1.;
    vec3 lc = vec3(1.,.95,.87)*I; Eh += lc*max(Ld.y,0.)/PI; spec += lc*nl*min(ag/(PI*e2*e2)*.25/max(nl*NoV,.05),900.)*schlick(max(dot(V,Hh),0.),.02); }
  Eb += Eh; vec3 Lb = alb*Eb;
  vec3 T = exp(-ext*(path + depthV));
  float foam = 0.;
  {
    vec2 fd = ty>=3 ? vW.xy : wdir*.35; vec2 fdt = ty>=3 ? vW.xy*t : uDrift*.35; // rivers: constant flow; still water: integrated wind drift
    float fp = texture2D(uAux, (p - fdt*.9)/6.3).g*.6 + texture2D(uAux, (p - fdt*.75 + 17.)/2.2).g*.55;
    // shoreline / around obstacles (soft intersection)
    float sw = .5+.5*sin(t*(ty==0?.85:1.4) - depthV*(ty==0?2.1:4.) + aux0.a*9.);
    float shore = (1.-smoothstep(0., ty==0 ? 1.3 : ty>=3 ? .55 : .7, depthV + (1.-sw)*.25))*mix(.45, 1., sw);
    foam = max(foam, shore*smoothstep(.45,.95,fp+.2*sw)*(ty==0 ? 1. : ty>=3 ? .35 : .6));
    // whitecaps on crests in strong wind
    float wc = uWc*(ty==0 ? 1. : ty==1 ? .85 : ty>=3 ? .35 : .6);
    if(wc > .01){ float c1 = texture2D(uAux, (p - uDrift*1.27)/37.).r;
      float cr = c1*.75 + fp*.35 + (paw-1.)*.3; foam = max(foam, smoothstep(1.05-wc*.5, 1.15-wc*.35, cr)*min(1., wc*1.6)); }
    // rivers: foam streaks downstream
    if(ty>=3 && ty!=5 && ty!=6) foam = max(foam, smoothstep(.75,1.,fp)*.25*smoothstep(.5,1.,abs(vW.w)));
    foam = max(foam, tor*smoothstep(.2,.7,fp)*1.2);
    foam = sat(foam)*(1.-smoothstep(1500.,5000.,dist)*.6);
  }
  vec3 Lfoam = .8*(uSunColor*(NoL*.8+.2*max(L.y,0.)) + uAmbient + Eh);
  // ---------------- composite
  vec3 surf = F*refl + spec + (1.-F)*(vec3(1.)-T)*Lb;
  surf = mix(surf, Lfoam, foam);
  float edge = smoothstep(0., .08 + dist*.0015, depthV);
  bool river = dot(vW.xy,vW.xy) > 1e-6;
  // per-vertex mask: never over roads/shoulders or where the bank is missing; soft ribbon border
  if(river) edge *= sat(vM*1.15-.05)*(1.-smoothstep(.8,1.,abs(vW.w)));
  { vec4 mk = texture2D(uDep, (P.xz-uDepXf.xy)*uDepXf.zw); // clip ocean / lake planes to the real coast / shore
    if(ty==0) edge *= 1.-smoothstep(150., 260., (mk.a*255.-128.)*8.);
    else if(!river) edge *= 1.-smoothstep(20., 70., (mk.b*255.-128.)*8.);
    if(edge < .002) discard; }
  vec3 col;
#ifdef PIPE
  vec4 ap = aerial(cam, rd, dist); vec3 Ta = pow(vec3(ap.a), vec3(.82,1.,1.2)), A = ap.rgb;
  vec3 bot = vec3(0.);
  if(uHasCol > .5){
    vec2 ruv = uv + N.xz*min(path,3.)*.32/max(dist,1.)*vec2(uRes.y/uRes.x,1.); if(sdepth(ruv) < dist*dot(rd,fwd)) ruv = uv;
    bot = textureLod(uColor, ruv, 0.).rgb;
    if(uHasVol > .5){ vec4 v = textureLod(uVol, ruv, 0.); bot = (bot - v.rgb)/max(v.a,.05); }
    bot = max(bot - A, 0.);
    // caustics on shallow sunlit bottoms
    float cs = texture2D(uAux, (B.xz + N.xz*.6)/2.7 + vec2(t*.03,t*.017)).b*texture2D(uAux, (B.xz*1.3)/3.3 - vec2(t*.021,-t*.026)).b;
    bot *= 1. + cs*6.*exp(-depthV*.7)*smoothstep(0.,.3,L.y)*(1.-uStormDark)*step(.05,depthV);
  } else surf += (1.-F)*T*Lb*2.;
  col = surf*Ta + A + (1.-F)*(1.-foam)*T*bot;
  if(uHasVol > .5){ vec4 v = textureLod(uVol, uv, 0.); col = col*v.a + v.rgb; }
#else
  col = surf + (1.-F)*T*alb*Eb*3.;
#endif
  if(under){ vec3 Tu = exp(-ext*dist*1.5); col = mix(Lb*1.5, col, Tu); }
  gl_FragColor = vec4(max(col, vec3(0.)), edge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createWater(ctx, S, shared) {
  void shared;
  const data = S.data, gfx = ctx.gfx, PIPE = !!(gfx && gfx.fogGLSL && gfx.depthTexture && !gfx.mock);
  const group = new THREE.Group(); group.name = 'water'; (PIPE ? ctx.fxScene : ctx.scene).add(group);
  // ---- macro depth (r) + turbidity near big river mouths (g)
  const mouths = []; for (const r of data.rivers) { const n = r.y.length; if (n < 2) continue; const x = r.pts[n * 2 - 2], z = r.pts[n * 2 - 1]; if (S.coastAt(x, z) < 400) mouths.push([x, z, Math.max(...r.w) / 110]); }
  const dep = new Uint8Array(GX * GZ * 4);
  for (let j = 0, k = 0; j < GZ; j++) for (let i = 0; i < GX; i++, k++) {
    const dm = Math.max(0, -data.mac[k * 4]); dep[k * 4] = Math.min(255, Math.round(dm * 6)); const x = OX + i * CELL, z = OZ + j * CELL;
    let tb = Math.max(0, .2 - dm * .02); for (const m of mouths) tb += m[2] * Math.exp(-Math.hypot(x - m[0], z - m[1]) / (9000 * Math.sqrt(m[2]) + 1500));
    dep[k * 4 + 1] = Math.round(Math.min(1, tb) * 255); dep[k * 4 + 2] = 255; dep[k * 4 + 3] = Math.max(0, Math.min(255, Math.round(128 + data.coast[k] / 8)));
  }
  // b = signed distance to the real lake shore (+ outside): lake planes are clipped there, so they never float over land that
  // sits below the lake level (flattened city sites like Chicago)
  const segD = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az; let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1); t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(x - ax - dx * t, z - az - dz * t); };
  for (const L of data.lakes) {
    const r = L.ring, n = r.length / 2, i0 = Math.max(0, Math.floor((L.x0 - 1200 - OX) / CELL)), i1 = Math.min(GX - 1, Math.ceil((L.x1 + 1200 - OX) / CELL)), j0 = Math.max(0, Math.floor((L.z0 - 1200 - OZ) / CELL)), j1 = Math.min(GZ - 1, Math.ceil((L.z1 + 1200 - OZ) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = OX + i * CELL, z = OZ + j * CELL; let d = 1e9, ins = false;
      for (let a = 0, b = n - 1; a < n; b = a++) { d = Math.min(d, segD(x, z, r[b * 2], r[b * 2 + 1], r[a * 2], r[a * 2 + 1])); const za = r[b * 2 + 1], zb = r[a * 2 + 1]; if ((za > z) !== (zb > z) && x < r[b * 2] + (z - za) / (zb - za) * (r[a * 2] - r[b * 2])) ins = !ins; }
      const v = Math.max(0, Math.min(255, Math.round(128 + (ins ? -d : d) / 8))), k = (j * GX + i) * 4; if (Math.abs(v - 128) < Math.abs(dep[k + 2] - 128)) dep[k + 2] = v;
    }
  }
  const dt = new THREE.DataTexture(dep, GX, GZ, THREE.RGBAFormat); dt.minFilter = dt.magFilter = THREE.LinearFilter; dt.needsUpdate = true;
  // ---- textures
  const tw = performance.now(), wf = waveField(256, 7331), nrm = wf.tex, aux = auxTex(256, wf.h, 99);
  console.log(`[water] wave textures ${Math.round(performance.now() - tw)} ms`);
  const G = ctx.globals, V4 = () => new THREE.Vector4();
  const u = {
    uTime: G.uTime, uRain: G.uRain, uGust: G.uGust || { value: 0 }, uStormDark: G.uStormDark || { value: 0 }, uSunDir: G.uSunDir, uSunColor: G.uSunColor, uAmbient: G.uAmbient, uLightning: G.uLightning || { value: V4() },
    uWind: { value: new THREE.Vector2(4, 1) }, uWindDir: { value: new THREE.Vector2(1, 0) }, uDrift: { value: new THREE.Vector2() },
    uNrm: { value: nrm }, uAux: { value: aux }, uDep: { value: dt }, uDepXf: { value: new THREE.Vector4(OX - CELL / 2, OZ - CELL / 2, 1 / (CELL * GX), 1 / (CELL * GZ)) },
    uSpot: { value: [V4(), V4()] }, uSpotD: { value: [V4(), V4()] },
    uGw: { value: [V4(), V4(), V4(), V4(), V4()] }, uGQ: { value: .5 }, uAmp: { value: V4() }, uWc: { value: 0 }, uTor: { value: V4() }, uFlowT: { value: .33 },
    uAlb: { value: TYPES.map((t) => new THREE.Vector3(...t.alb)) }, uExt: { value: TYPES.map((t) => new THREE.Vector3(...t.ext)) },
    uDepth: PIPE ? gfx.depthTexture : { value: null }, uDepthK: PIPE ? gfx.depthParams : { value: V4() }, uRes: PIPE ? gfx.resolution : { value: new THREE.Vector2(1, 1) },
    uColor: { value: null }, uVol: { value: null }, uHasCol: { value: 0 }, uHasVol: { value: 0 }, uVP: { value: new THREE.Matrix4() }, uEnv: { value: null }, uEnvOn: { value: 0 },
    ...(PIPE ? gfx.fogUniforms : {}),
  };
  const ssrSteps = () => ({ low: 0, medium: 14, high: 20, ultra: 26 })[ctx.quality?.id] ?? 18;
  const defines = { SSR_STEPS: ssrSteps() }; if (PIPE) defines.PIPE = 1;
  const m = new THREE.ShaderMaterial({ uniforms: u, defines, vertexShader: VS, fragmentShader: FS(PIPE ? gfx.fogGLSL : '', PIPE ? gfx.linearDepthGLSL || '' : ''), side: THREE.DoubleSide, fog: false, lights: false,
    transparent: false, depthWrite: true, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  ctx.events?.on?.('quality:changed', () => { const s = ssrSteps(); if (s !== m.defines.SSR_STEPS) { m.defines.SSR_STEPS = s; m.needsUpdate = true; } });
  // per-frame pipeline hookup (scene colour / volume textures change on resize; projection is jittered at render time)
  let lastF = -1; const vp = new THREE.Matrix4();
  const hook = (r, sc, camera) => {
    const f = ctx.time?.frame ?? 0; if (f === lastF && camera === ctx.camera) return; lastF = f;
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); u.uVP.value.copy(vp);
    if (!PIPE) { const e = ctx.scene.environment; if (e && e.isTexture) setEnv(e); return; }
    const g = ctx.gfx, col = g.sceneColor?.value || g.post?.comp?.texture || null, vol = g.volumeTexture?.value || g.vol?.out?.textures?.[0] || null;
    u.uColor.value = col; u.uHasCol.value = col ? 1 : 0; u.uVol.value = vol; u.uHasVol.value = vol ? 1 : 0;
    const e = ctx.fxScene.environment || ctx.scene.environment; if (e) setEnv(e);
  };
  let envH = 0;
  function setEnv(e) {
    if (e.mapping !== THREE.CubeUVReflectionMapping || !e.image?.height) return; u.uEnv.value = e; u.uEnvOn.value = 1;
    if (e.image.height !== envH) { envH = e.image.height; const maxMip = Math.log2(envH) - 2; Object.assign(m.defines, { ENV_CUBEUV: 1, CUBEUV_TEXEL_WIDTH: (1 / (3 * Math.max(2 ** maxMip, 7 * 16))).toFixed(9), CUBEUV_TEXEL_HEIGHT: (1 / envH).toFixed(9), CUBEUV_MAX_MIP: maxMip.toFixed(1) }); m.needsUpdate = true; }
  }
  const add = (geo, ro = 0) => { const mm = new THREE.Mesh(geo, m); mm.renderOrder = ro; mm.onBeforeRender = hook; mm.receiveShadow = false; group.add(mm); return mm; };
  const mk = (pos, w4, idx, msk) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aW', new THREE.Float32BufferAttribute(w4, 4)); g.setAttribute('aM', new THREE.Float32BufferAttribute(msk || new Float32Array(pos.length / 3).fill(1), 1)); g.setIndex(idx); g.computeBoundingSphere(); return g; };

  // ---- ocean: radial grid around the camera (dense near, out to the far plane)
  const P = [], I = [], NA = 160, GROW = 1.06; let rad = 0; const radii = [0]; for (rad = 2.5; rad < 58000; rad *= GROW) radii.push(rad); radii.push(58000);
  for (const r of radii) for (let a = 0; a < NA; a++) { const t = a / NA * Math.PI * 2; P.push(Math.cos(t) * r, 0, Math.sin(t) * r); }
  const NR = radii.length - 1; for (let r = 0; r < NR; r++) for (let a = 0; a < NA; a++) { const i0 = r * NA + a, i1 = r * NA + (a + 1) % NA; I.push(i0, i0 + NA, i1, i1, i0 + NA, i1 + NA); }
  const ocean = add(mk(P, new Float32Array(P.length / 3 * 4), I), -2); ocean.frustumCulled = false;

  // ---- lakes
  for (const L of data.lakes) {
    if (!(L.level > .5)) continue; const pts = []; for (let i = 0; i < L.ring.length; i += 2) pts.push(new THREE.Vector2(L.ring[i], L.ring[i + 1])); if (ShapeUtils.isClockWise(pts)) pts.reverse();
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cz = pts.reduce((a, p) => a + p.y, 0) / pts.length; for (const p of pts) { const dx = p.x - cx, dz = p.y - cz, l = Math.hypot(dx, dz) || 1; p.x += dx / l * 420; p.y += dz / l * 420; }
    const tri = ShapeUtils.triangulateShape(pts, []), pos = [], w4 = [], idx = [], ty = lakeType(L.name); for (const p of pts) { pos.push(p.x, L.level, p.y); w4.push(0, 0, ty, 0); } for (const t of tri) idx.push(t[0], t[2], t[1]);
    add(mk(pos, w4, idx), -1);
  }
  // ---- rivers: dense ribbons (~8 m rows x 9 columns) with flow direction (downstream = decreasing level). Per-vertex mask aM hides
  // the water over road carriageways/shoulders (fords, roads graded below the river) and where the bank is missing (perched water).
  const ranked = [...data.rivers].sort((a, b) => Math.max(...a.w) - Math.max(...b.w)), O = S.O, sst = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const inLake = (x, z, y) => { const i = Math.round((x - OX) / CELL), j = Math.round((z - OZ) / CELL); if (i < 0 || j < 0 || i >= GX || j >= GZ || !data.lakeI) return false; const li = data.lakeI[j * GX + i]; return li !== 255 && data.lakes[li].level > .5 && y <= data.lakes[li].level + .6 && S.groundAt(x, z) < data.lakes[li].level; };
  const COLS = [-1, -.72, -.4, 0, .4, .72, 1], NC = COLS.length; let riverVerts = 0, masked = 0;
  ranked.forEach((r, rank) => {
    const n = r.y.length; if (n < 2) return; const down = r.y[n - 1] <= r.y[0] ? 1 : -1, ty = riverType(r.name), yo = .01 + rank * .004;
    const tan = (i) => { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let tx = r.pts[b * 2] - r.pts[a * 2], tz = r.pts[b * 2 + 1] - r.pts[a * 2 + 1]; const l = Math.hypot(tx, tz) || 1; return [tx / l, tz / l, Math.abs(r.y[b] - r.y[a]) / l]; };
    let pos = [], w4 = [], mm = [], idx = [], run = 0;
    const flush = (keep) => { riverVerts += pos.length / 3; if (idx.length) add(mk(pos, w4, idx, mm), 0); if (keep) { pos = pos.slice(-NC * 3); w4 = w4.slice(-NC * 4); mm = mm.slice(-NC); } else { pos = []; w4 = []; mm = []; } idx = []; };
    const row = (x, z, y, hw, tx, tz, slope) => {
      if (inLake(x, z, y)) { if (run) flush(false); run = 0; return; }
      const sp = Math.min(2.6, .55 + Math.sqrt(hw * 2) * .06 + slope * 900) * down, W = hw + 6;
      for (const s of COLS) { const px = x - tz * W * s, pz = z + tx * W * s, h = S.heightAt(px, pz), rc = Math.min(O.eMaj, O.eStr, O.eGrv);
        let k = O.deck ? 1 : sst(1.5, 7, rc); if (Math.abs(s) * W > hw) k *= 1 - sst(.15, .9, y - h); if (k < .5) masked++;
        pos.push(px, y + yo, pz); w4.push(tx * sp, tz * sp, ty, s); mm.push(k); }
      const v = pos.length / 3 - NC; if (run) for (let c = 0; c < NC - 1; c++) { const a = v - NC + c, b = v + c; idx.push(a, b, a + 1, a + 1, b, b + 1); } run++; if (run >= 160) { flush(true); run = 1; }
    };
    for (let i = 0; i < n - 1; i++) {
      const x0 = r.pts[i * 2], z0 = r.pts[i * 2 + 1], x1 = r.pts[i * 2 + 2], z1 = r.pts[i * 2 + 3], L = Math.hypot(x1 - x0, z1 - z0), K = Math.max(1, Math.ceil(L / 12)), t0 = tan(i), t1 = tan(i + 1);
      for (let k = 0; k < K + (i === n - 2 ? 1 : 0); k++) { const f = k / K; let tx = t0[0] + (t1[0] - t0[0]) * f, tz = t0[1] + (t1[1] - t0[1]) * f; const l = Math.hypot(tx, tz) || 1;
        row(x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, r.y[i] + (r.y[i + 1] - r.y[i]) * f, (r.w[i] + (r.w[i + 1] - r.w[i]) * f) / 2, tx / l, tz / l, t0[2]); }
    }
    flush(false);
  });
  console.log(`[water] rivers: ${riverVerts} verts, ${masked} masked (roads / missing banks)`);

  // ---- per-frame state
  const wind = new THREE.Vector2(4, 1); let wsS = 4;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const spray = []; // tornadoes currently over water: [{x,z,y,r,amount}] (hook for FX spray)
  function update() {
    const c = ctx.camera.position; ocean.position.set(Math.round(c.x / 2) * 2, 0, Math.round(c.z / 2) * 2); ocean.visible = S.coastAt(c.x, c.z) < 20000 + Math.max(0, c.y - S.heightAt(c.x, c.z)) * 25;
    // smoothed local wind; strengthens with gusts
    const gw = G.uWind.value, gust = G.uGust?.value || 0; const kw = 1 - Math.pow(.98, Math.min(ctx.time?.dt || 1 / 60, .1) * 60); wind.lerp(gw, kw); const ws = wind.length(); wsS += (ws * (1 + gust * .35) - wsS) * kw;
    u.uWind.value.copy(wind); if (ws > .05) u.uWindDir.value.set(wind.x / ws, wind.y / ws);
    { const d = Math.min(ctx.time?.dt || 0, .1), wd = u.uWindDir.value, k = .6 + .4 * Math.min(1, wsS / 12); u.uDrift.value.x += wd.x * d * k; u.uDrift.value.y += wd.y * d * k; }
    // Cox-Munk-like slope variance split over the 4 layer groups (big -> small)
    const v = .0025 + .0042 * Math.min(wsS, 24), rain = G.uRain?.value || 0; u.uAmp.value.set(Math.sqrt(v * .16), Math.sqrt(v * .22), Math.sqrt(v * .3), Math.sqrt(v * .32 + rain * .004));
    u.uWc.value = THREE.MathUtils.smoothstep(wsS, 7, 19);
    // Gerstner swell (ocean): background swell + wind sea
    const Hs = Math.min(2.6, .35 + .011 * wsS * wsS), wa = Math.atan2(wind.y, wind.x), gws = u.uGw.value;
    const spec = [[92, .0, .30], [61, .35, .24], [44, -.42, .2], [31, .7, .14], [23, -.9, .1]];
    for (let i = 0; i < 5; i++) { const [lam, da, sh] = spec[i], a = wa + da, k = 2 * Math.PI / lam; gws[i].set(Math.cos(a), Math.sin(a), k, Hs * .5 * sh); }
    u.uGQ.value = .55 + .3 * THREE.MathUtils.smoothstep(wsS, 5, 18);
    // nearest tornado over water
    // local car headlights (vehicle system SpotLights) so night water near the car is lit like the ground
    const spots = ctx.vehicles?.spots; for (let i = 0; i < 2; i++) { const s = spots?.[i], o = u.uSpot.value[i], od = u.uSpotD.value[i]; if (!s || !s.visible || !(s.intensity > 0) || !s.parent) { o.w = 0; continue; }
      s.getWorldPosition(_a); s.target.getWorldPosition(_b); _b.sub(_a).normalize(); o.set(_a.x, _a.y, _a.z, s.intensity); od.set(_b.x, _b.y, _b.z, Math.cos(s.angle)); }
    spray.length = 0; const T = ctx.storms?.tornadoes; let best = 1e18; u.uTor.value.set(0, 0, 1, 0);
    if (T) for (const t of T) { if (!t || t.stage === 'dead' || t.stage === 'funnel') continue; const wl = S.waterLevelAt(t.x, t.z); if (wl === -Infinity) continue; const amt = (t.strength ?? .5) * Math.min(1, t.condense ?? 1); spray.push({ x: t.x, z: t.z, y: wl, r: Math.max(20, t.rCore || 40), amount: amt });
      const d = (t.x - c.x) ** 2 + (t.z - c.z) ** 2; if (d < best) { best = d; u.uTor.value.set(t.x, t.z, Math.max(20, t.rCore || 40), amt); } }
  }
  return { group, material: m, spray, update };
}

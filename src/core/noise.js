import { hash2 } from './rng.js';
// CPU value/gradient noise, deterministic.  vnoise -> 0..1, gnoise -> -1..1
const G = new Float32Array(512); for (let i = 0; i < 256; i++) { const a = i / 256 * Math.PI * 2; G[i * 2] = Math.cos(a); G[i * 2 + 1] = Math.sin(a); }
const hi = (x, y, s) => { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) & 255; };
export function gnoise(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let g = hi(ix, iy, s) * 2; const a = G[g] * fx + G[g + 1] * fy;
  g = hi(ix + 1, iy, s) * 2; const b = G[g] * (fx - 1) + G[g + 1] * fy;
  g = hi(ix, iy + 1, s) * 2; const c = G[g] * fx + G[g + 1] * (fy - 1);
  g = hi(ix + 1, iy + 1, s) * 2; const d = G[g] * (fx - 1) + G[g + 1] * (fy - 1);
  return (a + (b - a) * u + (c - a + (a - b - c + d) * u) * v) * 1.414;
}
export function vnoise(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a + (a - b - c + d) * u) * v;
}
export function fbm(x, y, oct = 5, s = 0, lac = 2, gain = 0.5) { let a = 0.5, f = 0; for (let i = 0; i < oct; i++) { f += a * gnoise(x, y, s + i); x *= lac; y *= lac; a *= gain; } return f; }
export function ridged(x, y, oct = 5, s = 0) { let a = 0.5, f = 0, w = 1; for (let i = 0; i < oct; i++) { let n = 1 - Math.abs(gnoise(x, y, s + i)); n *= n * w; w = Math.min(1, n * 2); f += n * a; x *= 2.03; y *= 2.03; a *= 0.5; } return f; }
// GLSL helpers shared by everybody
export const NOISE_GLSL = /* glsl */`
float sh_hash13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float sh_hash12(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float sh_noise3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(sh_hash13(i),sh_hash13(i+vec3(1,0,0)),f.x),mix(sh_hash13(i+vec3(0,1,0)),sh_hash13(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(sh_hash13(i+vec3(0,0,1)),sh_hash13(i+vec3(1,0,1)),f.x),mix(sh_hash13(i+vec3(0,1,1)),sh_hash13(i+vec3(1,1,1)),f.x),f.y),f.z);}
float sh_fbm3(vec3 p){float f=0.,a=.5;for(int i=0;i<4;i++){f+=a*sh_noise3(p);p=p*2.02+17.3;a*=.5;}return f;}
`;

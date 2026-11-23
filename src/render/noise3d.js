// GPU-baked tiling 3D noise (Perlin-Worley shape + Worley/Perlin detail) and a CPU blue-noise tile
import * as THREE from 'three';
import { HEAD } from './glsl.js';
import { fsMaterial, draw } from './pass.js';

const BAKE = HEAD + /* glsl */`
in vec2 vUv; out vec4 o; uniform float uZ; uniform int uKind;
vec3 h3(vec3 p){ uvec3 q = uvec3(ivec3(p))*uvec3(1597334673U,3812015801U,2798796415U); uint n=(q.x^q.y^q.z); q = n*uvec3(1597334673U,3812015801U,2798796415U); return vec3(q)*(1./4294967295.); }
float perlin(vec3 x, float per){
  vec3 i=floor(x), f=fract(x), u=f*f*f*(f*(f*6.-15.)+10.); float r[8];
  #define GR(o) dot(h3(mod(i+o,per)+7.)*2.-1., f-o)
  float a=GR(vec3(0,0,0)),b=GR(vec3(1,0,0)),c=GR(vec3(0,1,0)),d=GR(vec3(1,1,0)),e=GR(vec3(0,0,1)),g=GR(vec3(1,0,1)),h=GR(vec3(0,1,1)),k=GR(vec3(1,1,1));
  return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(mix(e,g,u.x),mix(h,k,u.x),u.y),u.z);
}
float worley(vec3 x, float per){
  vec3 i=floor(x), f=fract(x); float m=1.;
  for(int X=-1;X<=1;X++)for(int Y=-1;Y<=1;Y++)for(int Z=-1;Z<=1;Z++){ vec3 g=vec3(float(X),float(Y),float(Z)); vec3 r=g+h3(mod(i+g,per)+91.)-f; m=min(m,dot(r,r)); }
  return 1.-sqrt(m);
}
float pfbm(vec3 p,float f,int oct){ float a=.5,s=0.,n=0.; for(int i=0;i<oct;i++){ s+=a*perlin(p*f,f); n+=a; f*=2.; a*=.5; } return s/n; }
float wfbm(vec3 p,float f){ return worley(p*f,f)*.625+worley(p*f*2.,f*2.)*.25+worley(p*f*4.,f*4.)*.125; }
void main(){
  vec3 p=vec3(vUv,uZ);
  if(uKind==0){
    float pf=sat(pfbm(p,4.,4)*.95+.5);
    float w=wfbm(p,4.);
    float pw=sat(remap(pf,0.,1.,w,1.)); pw = sat(remap(pw,.28,.95,0.,1.));
    o=vec4(pw, wfbm(p,7.), wfbm(p,14.), sat(pfbm(p+.37,5.,4)*1.05+.5));
  } else {
    // ridged filaments, worley fine, perlin warp pair
    float n=perlin(p*5.,5.), n2=perlin(p*10.+.5,10.), n3=perlin(p*20.,20.);
    float ridge=1.-abs(n+.5*n2+.25*n3)*1.9; ridge=sat(ridge);
    o=vec4(ridge*ridge, wfbm(p,5.), sat(pfbm(p+.21,4.,3)*1.1+.5), sat(pfbm(p+.63,4.,3)*1.1+.5));
  }
}`;

function bake(renderer, size, kind) {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, { depthBuffer: false });
  const t = rt.texture;
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.unpackAlignment = 1;
  const m = fsMaterial(BAKE, { uZ: { value: 0 }, uKind: { value: kind } });
  for (let z = 0; z < size; z++) { m.uniforms.uZ.value = (z + 0.5) / size; m.uniformsNeedUpdate = true; draw(renderer, m, rt, z); }
  renderer.setRenderTarget(null);
  const gl = renderer.getContext();
  renderer.state.bindTexture(gl.TEXTURE_3D, renderer.properties.get(t).__webglTexture);
  gl.generateMipmap(gl.TEXTURE_3D);
  renderer.state.unbindTexture();
  return { rt, m };
}
export function bakeNoise(renderer, baseSize = 128, detailSize = 64) {
  const a = bake(renderer, baseSize, 0), b = bake(renderer, detailSize, 1);
  a.m.dispose(); b.m.dispose();
  return { base: a.rt.texture, detail: b.rt.texture };
}

// void-and-cluster blue noise (64x64, R8)
export function blueNoise(N = 64) {
  const n2 = N * N, E = new Float32Array(n2), on = new Uint8Array(n2), rank = new Uint16Array(n2);
  const R = 9, S2 = 2 * 1.9 * 1.9, K = new Float32Array((2 * R + 1) ** 2);
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) K[(y + R) * (2 * R + 1) + x + R] = Math.exp(-(x * x + y * y) / S2);
  const add = (i, s) => { const px = i % N, py = (i / N) | 0; for (let y = -R; y <= R; y++) { const yy = ((py + y + N) % N) * N; for (let x = -R; x <= R; x++) E[yy + ((px + x + N) % N)] += s * K[(y + R) * (2 * R + 1) + x + R]; } };
  let seed = 1234567; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const ext = (want, max) => { let b = -1, bv = max ? -1e9 : 1e9; for (let i = 0; i < n2; i++) if (on[i] === want && (max ? E[i] > bv : E[i] < bv)) { bv = E[i]; b = i; } return b; };
  const init = (n2 * 0.1) | 0;
  for (let c = 0; c < init;) { const i = (rnd() * n2) | 0; if (!on[i]) { on[i] = 1; add(i, 1); c++; } }
  for (let it = 0; it < 400; it++) { const a = ext(1, true); on[a] = 0; add(a, -1); const b = ext(0, false); on[b] = 1; add(b, 1); if (a === b) break; }
  const on0 = on.slice(), E0 = E.slice();
  for (let r = init - 1; r >= 0; r--) { const a = ext(1, true); on[a] = 0; add(a, -1); rank[a] = r; }
  on.set(on0); E.set(E0);
  for (let r = init; r < n2; r++) { const b = ext(0, false); on[b] = 1; add(b, 1); rank[b] = r; }
  const d = new Uint8Array(n2); for (let i = 0; i < n2; i++) d[i] = (rank[i] * 256 / n2) | 0;
  const t = new THREE.DataTexture(d, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.NearestFilter; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

// Ocean (camera-following radial grid at y=0), lakes (polygons) and rivers (ribbons) with one animated water material.
import * as THREE from 'three';
import { ShapeUtils } from 'three';
import { GX, GZ, OX, OZ, CELL } from './sampler.js';

export function createWater(ctx, S, shared) {
  const data = S.data, group = new THREE.Group(); group.name = 'water'; ctx.scene.add(group);
  // depth / shallowness from the macro height grid
  const dep = new Uint8Array(GX * GZ); for (let k = 0; k < GX * GZ; k++) dep[k] = Math.max(0, Math.min(255, -data.mac[k * 4] * 6));
  const dt = new THREE.DataTexture(dep, GX, GZ, THREE.RedFormat); dt.minFilter = dt.magFilter = THREE.LinearFilter; dt.needsUpdate = true;
  const u = { uTime: ctx.globals.uTime, uWind: ctx.globals.uWind, uRain: ctx.globals.uRain, uDep: { value: dt }, uSunDir: ctx.globals.uSunDir };
  const m = new THREE.MeshStandardMaterial({ color: 0x0d2a33, roughness: .06, metalness: 0, fog: false, side: THREE.DoubleSide });
  m.customProgramCacheKey = () => 'sh-water'; m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aFlow; varying vec3 vWp; varying vec2 vFlow;').replace('#include <project_vertex>', '#include <project_vertex>\n vWp=(modelMatrix*vec4(transformed,1.)).xyz; vFlow=aFlow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uTime,uRain; uniform vec2 uWind; uniform sampler2D uDep; varying vec3 vWp; varying vec2 vFlow; float wh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float wn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(wh(i),wh(i+vec2(1,0)),f.x),mix(wh(i+vec2(0,1)),wh(i+vec2(1,1)),f.x),f.y); }
      vec2 wgrad(vec2 p){ float e=.05; return vec2(wn(p+vec2(e,0))-wn(p-vec2(e,0)),wn(p+vec2(0,e))-wn(p-vec2(0,e)))/(2.*e); }`)
      .replace('#include <map_fragment>', `vec2 p=vWp.xz; float ds=length(vWp-cameraPosition); vec2 fl=vFlow*uTime; float ws=clamp(length(uWind)/12.,.15,1.5);
        vec2 g=wgrad(p*.11+fl*.11+uTime*vec2(.06,.04))*.6+wgrad(p*.37-fl*.2+uTime*vec2(-.11,.07))*.35*ws+wgrad(p*1.3+uTime*vec2(.2,-.17))*.18*ws+wgrad(p*.023+uTime*.01)*.5;
        g*=mix(1.,.15,smoothstep(80.,1500.,ds)); if(uRain>.01&&ds<60.) g+=wgrad(p*7.+uTime*3.)*.25*uRain;
        float dpt=texture2D(uDep,vec2((p.x-(${OX}.))/${CELL * GX}.+${(.5 / GX).toFixed(7)},(p.y-(${OZ}.))/${CELL * GZ}.+${(.5 / GZ).toFixed(7)})).r;
        diffuseColor.rgb=mix(vec3(.035,.12,.11),vec3(.008,.035,.06),smoothstep(.0,.35,dpt)); if(vFlow!=vec2(0.)) diffuseColor.rgb=vec3(.045,.06,.04);
        float foam=smoothstep(.04,.0,dpt)*step(.0001,dpt+.0001)*smoothstep(.55,.8,wn(p*.6+uTime*.3)*.6+wn(p*.17-uTime*.1)*.6)*0.;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.7),foam);`)
      .replace('#include <normal_fragment_maps>', 'normal=normalize(mat3(viewMatrix)*normalize(vec3(-g.x*.35,1.,-g.y*.35)));')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=mix(.03,.16,smoothstep(100.,4000.,ds))+uRain*.1;');
  };
  // ocean: radial grid around the camera
  const og = new THREE.BufferGeometry(), P = [], I = [], NR = 48, NA = 64;
  for (let r = 0; r <= NR; r++) { const rad = r === 0 ? 0 : 4 * Math.pow(1.21, r); for (let a = 0; a < NA; a++) { const t = a / NA * Math.PI * 2; P.push(Math.cos(t) * rad, 0, Math.sin(t) * rad); } }
  for (let r = 0; r < NR; r++) for (let a = 0; a < NA; a++) { const i0 = r * NA + a, i1 = r * NA + (a + 1) % NA; I.push(i0, i1, i0 + NA, i1, i1 + NA, i0 + NA); }
  og.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); og.setAttribute('normal', new THREE.Float32BufferAttribute(P.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3)); og.setAttribute('aFlow', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3 * 2), 2)); og.setIndex(I);
  const ocean = new THREE.Mesh(og, m); ocean.frustumCulled = false; ocean.receiveShadow = true; ocean.position.y = 0; group.add(ocean);
  // lakes
  for (const L of data.lakes) { const pts = []; for (let i = 0; i < L.ring.length; i += 2) pts.push(new THREE.Vector2(L.ring[i], L.ring[i + 1])); if (ShapeUtils.isClockWise(pts)) pts.reverse(); const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cz = pts.reduce((a, p) => a + p.y, 0) / pts.length; for (const p of pts) { const dx = p.x - cx, dz = p.y - cz, l = Math.hypot(dx, dz) || 1; p.x += dx / l * 420; p.y += dz / l * 420; } const tri = ShapeUtils.triangulateShape(pts, []); const pos = [], idx = []; for (const p of pts) pos.push(p.x, L.level, p.y); for (const t of tri) idx.push(t[0], t[2], t[1]); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3)); g.setAttribute('aFlow', new THREE.Float32BufferAttribute(new Float32Array(pts.length * 2), 2)); g.setIndex(idx); g.computeBoundingSphere(); const mm = new THREE.Mesh(g, m); mm.receiveShadow = true; if (L.level > 0.5) group.add(mm); }
  // rivers
  for (const r of data.rivers) { const pos = [], fl = [], idx = []; const n = r.y.length; for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let tx = r.pts[b * 2] - r.pts[a * 2], tz = r.pts[b * 2 + 1] - r.pts[a * 2 + 1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; const w = r.w[i] / 2 + 6; for (const s of [-1, 1]) { pos.push(r.pts[i * 2] - tz * w * s, r.y[i], r.pts[i * 2 + 1] + tx * w * s); fl.push(-tx * 1.2, -tz * 1.2); } if (i) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); } } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3)); g.setAttribute('aFlow', new THREE.Float32BufferAttribute(fl, 2)); g.setIndex(idx); g.computeBoundingSphere(); const mm = new THREE.Mesh(g, m); mm.receiveShadow = true; group.add(mm); }
  return { group, update() { const c = ctx.camera.position; ocean.position.set(c.x, 0, c.z); const cs = S.coastAt(c.x, c.z); ocean.visible = cs < 30000; } };
}

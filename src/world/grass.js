// GPU-instanced grass / crop blades in 12 m tiles around the camera (wind + tornado flattening in the vertex shader).
import * as THREE from 'three';
import { hash2 } from '../core/rng.js';

const T = 12;
export function createGrass(ctx, S) {
  const q = ctx.quality.grass ?? .5; if (q <= 0) return { update() {}, group: new THREE.Group() };
  const RAD = 18 + 46 * Math.min(1.5, q), PER = Math.round(520 * Math.min(1.2, .6 + q * .5)), group = new THREE.Group(); group.name = 'grass'; ctx.scene.add(group);
  // clump of 5 blades, 4 segments each
  const bp = [], bi = [], bs = [];
  for (let b = 0; b < 5; b++) { const a = b * 2.4 + .3, ox = Math.cos(a * 1.7) * .09 * b, oz = Math.sin(a * 1.3) * .09 * b, ca = Math.cos(a), sa = Math.sin(a), o = bp.length / 3; for (let k = 0; k <= 4; k++) { const t = k / 4, w = .022 * (1 - t * .85); for (const sg of [-1, 1]) { bp.push(ox + ca * w * sg, t, oz + sa * w * sg); bs.push(t, b / 5); } } for (let k = 0; k < 4; k++) { const a0 = o + k * 2; bi.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2); } }
  const base = new THREE.BufferGeometry(); base.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); base.setAttribute('normal', new THREE.Float32BufferAttribute(bp.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3)); base.setAttribute('aS', new THREE.Float32BufferAttribute(bs, 2)); base.setIndex(bi);
  const g = ctx.globals, u = { uWind: g.uWind, uGust: g.uGust, uTime: g.uTime, uTornadoA: g.uTornadoA, uCamP: g.uCamPos, uRad: { value: RAD } };
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .8, fog: false }); mat.customProgramCacheKey = () => 'sh-grass';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 iP; attribute vec4 iC; attribute vec2 aS; uniform vec2 uWind; uniform float uGust,uTime,uRad; uniform vec4 uTornadoA[4]; uniform vec3 uCamP; varying vec3 vCol; varying float vT;`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal=vec3(0.,1.,0.);')
      .replace('#include <begin_vertex>', `
      vec3 wb=iP.xyz; float rnd=iP.w; float dc=length(wb.xz-uCamP.xz); float fade=1.-smoothstep(uRad*.72,uRad,dc); float th=fract(rnd*7.31+aS.y*.37);
      float hgt=iC.w*(.65+.6*fract(rnd*13.7+aS.y))*fade; float ang=rnd*6.2832; float ca=cos(ang),sa=sin(ang);
      vec3 p=vec3(position.x*ca-position.z*sa,0.,position.x*sa+position.z*ca); float wid=mix(1.,3.4,smoothstep(8.,uRad,dc))*(iC.w>1.2?3.:1.); p.xz*=wid;
      vec2 w=uWind*(1.+uGust*.8*sin(uTime*2.3+wb.x*.15+wb.z*.11)); float fl=0.;
      for(int i=0;i<4;i++){ vec4 T=uTornadoA[i]; if(T.w<1.) continue; vec2 d=wb.xz-T.xy; float r=max(length(d),1.); float v=T.w*2.*r*T.z/(r*r+T.z*T.z); w+=vec2(d.y,-d.x)/r*v-d/r*v*.35; }
      float sp=length(w); fl=clamp(sp/30.,0.,.95); vec2 dir=sp>.01?w/sp:vec2(1.,0.);
      float t=position.y; float bend=(.15+.35*th)*clamp(sp/12.,.05,1.4)+.08; float sway=sin(uTime*(1.6+sp*.15)+wb.x*.3+wb.z*.2+th*6.)*.12*clamp(sp/6.,.2,1.);
      vec2 off=dir*(bend+sway)*t*t*hgt*(1.+fl); float yy=t*hgt*(1.-fl*.75*t);
      vec3 transformed=wb+vec3(p.x+off.x+(rnd-.5)*.2*t*hgt,yy,p.z+off.y); vCol=iC.rgb; vT=t;`)
      .replace('#include <project_vertex>', 'vec4 mvPosition=viewMatrix*vec4(transformed,1.); gl_Position=projectionMatrix*mvPosition;')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition=vec4(transformed,1.);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCol; varying float vT;').replace('#include <map_fragment>', 'diffuseColor.rgb=vCol*(.45+.75*vT);').replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal=normalize(mat3(viewMatrix)*vec3(0.,1.,0.)); nonPerturbedNormal=normal;');
  };
  const tiles = new Map(), free = []; let need = [];
  const C = new THREE.Color();
  const colFor = (crop, b, x, z, o) => {
    const n = hash2(x * 3 | 0, z * 3 | 0, 5); let h = .32 + b.forest * .1, r, gg, bb; const dry = Math.min(1, b.arid * 1.3 + .15);
    if (crop === 2) { r = .09; gg = .16; bb = .04; h = .6; } else if (crop === 3 || crop === 9) { r = .3; gg = .22; bb = .085; h = crop === 3 ? .85 : .2; } else if (crop === 4) { r = .07; gg = .14; bb = .035; h = 2.0; } else if (crop === 5) { r = .08; gg = .15; bb = .04; h = .5; } else if (crop === 7) { r = .17; gg = .19; bb = .07; h = .35; }
    else { const dd = dry * (.5 + .5 * hash2(x * .2 | 0, z * .2 | 0, 6)); r = .055 + .12 * dd; gg = .085 + .06 * dd; bb = .025 + .04 * dd; h = .22 + .22 * (1 - b.arid) * hash2(x | 0, z | 0, 8); }
    C.setRGB(r * (.8 + .4 * n), gg * (.8 + .4 * n), bb * (.8 + .4 * n)); o[0] = C.r; o[1] = C.g; o[2] = C.b; o[3] = h;
  };
  const tmpC = [0, 0, 0, 0], O = S.O;
  function gen(tx, tz) {
    const P = new Float32Array(PER * 4), Cc = new Float32Array(PER * 4); let n = 0;
    for (let k = 0; k < PER; k++) {
      const x = tx * T + hash2(tx * PER + k, tz, 1) * T, z = tz * T + hash2(tx * PER + k, tz, 2) * T, y = S.heightAt(x, z);
      if (O.eMaj < .8 || O.eStr < 2.6 || O.eGrv < .4 || O.deck || O.eRiv < 2) continue; const f = S.fieldAt(x, z); if (f.crop === 6 || f.crop === 8 || f.yard < 0) continue; const b = S.bio(x, z); if (b.urban > .5 && hash2(k, tx, 3) < .7) continue; if (b.arid > .8 && hash2(k, tz, 4) < .7) continue;
      if (f.crop === 4 && (Math.abs(((f.dir ? x : z) % .76 + .76) % .76 - .38) > .12)) continue; if (S.waterLevelAt(x, z) > y - .05) continue;
      colFor(O.eMaj < 15 || O.eStr < 9 || f.edge < 0 ? 0 : f.crop, b, x, z, tmpC); P[n * 4] = x; P[n * 4 + 1] = y - .03; P[n * 4 + 2] = z; P[n * 4 + 3] = hash2(k, tx + tz * 977, 9); Cc.set(tmpC, n * 4); n++;
    }
    let m = free.pop(); if (!m) { const gg = new THREE.InstancedBufferGeometry(); gg.setIndex(base.index); for (const k of ['position', 'normal', 'aS']) gg.setAttribute(k, base.attributes[k]); gg.setAttribute('iP', new THREE.InstancedBufferAttribute(P, 4)); gg.setAttribute('iC', new THREE.InstancedBufferAttribute(Cc, 4)); m = new THREE.Mesh(gg, mat); m.frustumCulled = true; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); }
    else { const a = m.geometry.attributes; a.iP.array = P; a.iP.needsUpdate = true; a.iC.array = Cc; a.iC.needsUpdate = true; }
    m.geometry.instanceCount = n; m.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3((tx + .5) * T, n ? P[1] : 0, (tz + .5) * T), T * .75 + 2.5); m.visible = n > 0; return m;
  }
  let lx = 1e9, lz = 1e9;
  return { group, update() {
    const c = ctx.camera.position, cx = Math.floor(c.x / T), cz = Math.floor(c.z / T), rr = Math.ceil(RAD / T); if (c.y - S.heightAt(c.x, c.z) > 120) { group.visible = false; return; } group.visible = true;
    if (cx !== lx || cz !== lz) { lx = cx; lz = cz; for (const [k, m] of tiles) { const tx = Math.floor(k / 65536) - 32768, tz = (k % 65536) - 32768; if (Math.hypot((tx + .5) * T - c.x, (tz + .5) * T - c.z) > RAD + T) { m.visible = false; free.push(m); tiles.delete(k); } } need = []; for (let j = -rr; j <= rr; j++) for (let i = -rr; i <= rr; i++) { const tx = cx + i, tz = cz + j, k = (tx + 32768) * 65536 + tz + 32768; if (!tiles.has(k) && Math.hypot((tx + .5) * T - c.x, (tz + .5) * T - c.z) < RAD + T * .7) need.push([Math.hypot(i, j), tx, tz, k]); } need.sort((a, b) => b[0] - a[0]); }
    const t0 = performance.now(); while (need.length && performance.now() - t0 < 1.6) { const [, tx, tz, k] = need.pop(); tiles.set(k, gen(tx, tz)); }
  }, idle: () => need.length === 0 };
}

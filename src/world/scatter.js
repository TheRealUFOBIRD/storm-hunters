// Sector streaming of placed objects: instanced LOD rendering, wind, colliders, breakage, tornado damage.
import * as THREE from 'three';
import { KIND, KI, STRIDE, SEC_IDS, SS, SOX, SOZ, SGX, SGZ, NTREE } from './kinds.js';
import { makeAtlas, treeGeo, plantGeo, propGeo, bldGeo } from './geo.js';
import { BL } from './textures.js';

const WIND_GLSL = /* glsl */`
uniform vec2 uWind; uniform float uGust,uTime; uniform vec4 uTornadoA[4]; uniform vec3 uCamP; uniform vec4 uLod;
vec2 shWindAt(vec2 p){ vec2 w=uWind*(1.+uGust*.6*sin(uTime*1.7+p.x*.02+p.y*.013)); for(int i=0;i<4;i++){ vec4 T=uTornadoA[i]; if(T.w<1.) continue; vec2 d=p-T.xy; float r=max(length(d),1.); float v=T.w*2.*r*T.z/(r*r+T.z*T.z); w+=vec2(d.y,-d.x)/r*v-d/r*v*.35; } return w; }
float shIgnF(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }
varying float vFade;`;
// shared vertex patch: lod fade/collapse + wind sway. sway: 0 none, 1 tree, 2 light (props)
function patchVS(sh, sway, instanced) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_GLSL).replace('#include <project_vertex>', `
    vec4 wp=${instanced ? 'modelMatrix*instanceMatrix*vec4(transformed,1.)' : 'modelMatrix*vec4(transformed,1.)'}; vec3 base=${instanced ? '(modelMatrix*instanceMatrix[3]).xyz' : 'modelMatrix[3].xyz'};
    float dc=length(base-uCamP); float hs=fract(sin(dot(base.xz,vec2(12.9898,78.233)))*43758.5453);
    vFade=(uLod.x>0.?smoothstep(uLod.x-12.,uLod.x,dc):1.)*(1.-smoothstep(uLod.w*.9,uLod.w,dc)); if(uLod.y>0.&&hs>mix(1.,.38,smoothstep(uLod.y,uLod.z,dc))) vFade=0.;
    ${sway ? `float hy=max(wp.y-base.y,0.); vec2 w=shWindAt(base.xz); float sp=length(w); float k=${sway === 1 ? '.0011' : '.0003'}*hy*hy/(1.+hy*.04)*(1.+sp*.02); wp.xz+=w*k*(.8+.2*sin(uTime*(1.3+hs)+hs*9.))+ (sp>18.?w/sp*sin(uTime*6.+wp.y)*.04*sp*hy*.02:vec2(0.));` : ''}
    if(vFade<=0.) wp.xyz=base;
    vec4 mvPosition=viewMatrix*wp; gl_Position=projectionMatrix*mvPosition;`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade; float shIgnF2(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if(vFade<.999&&shIgnF2(gl_FragCoord.xy)>vFade) discard;');
}
function uni(ctx, lod) { const g = ctx.globals; return { uWind: g.uWind, uGust: g.uGust, uTime: g.uTime, uTornadoA: g.uTornadoA, uCamP: g.uCamPos, uLod: { value: lod } }; }

export function createScatter(ctx, S, pool, tex) {
  const group = new THREE.Group(); group.name = 'scatter'; ctx.scene.add(group);
  const atlas = makeAtlas(); const Q = ctx.quality, treeMul = Q.trees ?? 1;
  const R = Math.min(3300, 1500 + (Q.viewDist || 14000) * .08);
  // ---------- materials
  const mats = new Map();
  function vegMat(lod, sway, instanced = true) {
    const key = 'v' + lod.join(',') + sway; if (mats.has(key)) return mats.get(key);
    const u = uni(ctx, new THREE.Vector4(...lod)), m = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: .45, side: THREE.DoubleSide, vertexColors: true, roughness: .82, metalness: 0, fog: false });
    m.customProgramCacheKey = () => 'sh-veg' + sway; m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, u); patchVS(sh, sway, instanced);
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal=normalize(vNormal); nonPerturbedNormal=normal;').replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>\n #if NUM_DIR_LIGHTS>0\n reflectedLight.directDiffuse+=directLight.color*diffuseColor.rgb*.22*(1.-vColor.r*.5);\n #endif'); };
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: .45, side: THREE.DoubleSide }); d.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, u); patchVS(sh, sway, instanced); }; d.customProgramCacheKey = () => 'sh-vegd' + sway;
    const r = { m, d, u }; mats.set(key, r); return r;
  }
  function solidMat(lod, sway) {
    const key = 's' + lod.join(',') + sway; if (mats.has(key)) return mats.get(key);
    const u = { ...uni(ctx, new THREE.Vector4(...lod)), uBA: { value: tex.bA.texture }, uBN: { value: tex.bN.texture }, uSunDir: ctx.globals.uSunDir, uWet: ctx.globals.uWetness, uDark: ctx.globals.uStormDark };
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, fog: false }); m.customProgramCacheKey = () => 'sh-solid' + sway;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u); patchVS(sh, sway, true);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aL; varying float vL; varying vec2 vUv2; varying vec3 vWp2;').replace('#include <uv_vertex>', '#include <uv_vertex>\n vL=aL; vUv2=uv*vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));').replace('gl_Position=projectionMatrix*mvPosition;', 'gl_Position=projectionMatrix*mvPosition; vWp2=wp.xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        precision highp sampler2DArray; uniform sampler2DArray uBA,uBN; uniform vec3 uSunDir; uniform float uWet,uDark; varying float vL; varying vec2 vUv2; varying vec3 vWp2; vec3 bN; float bR,bE;`)
        .replace('#include <map_fragment>', `{ float L=floor(vL+.5); vec4 a=texture(uBA,vec3(vUv2,L)),n=texture(uBN,vec3(vUv2,L)); diffuseColor.rgb*=a.rgb*a.rgb*1.25; bR=n.b; bN=vec3(n.rg*2.-1.,1.); diffuseColor.rgb*=mix(1.,.62,uWet*step(L,15.)); bR=mix(bR,bR*.5,uWet);
          float night=smoothstep(.1,-.08,uSunDir.y)+uDark*.4; bE=0.; if(L==${BL.glass}.||L==${BL.office}.||L==${BL.curtain}.){ vec3 c=floor(vWp2/vec3(2.6,3.1,2.6)); float h=fract(sin(dot(c,vec3(12.99,78.23,37.71)))*43758.55); bE=step(.5,h)*night*smoothstep(.5,.6,1.-a.a)*(L==${BL.glass}.?1.:smoothstep(.3,.1,a.a)); } }`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=bR;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor=floor(vL+.5)==4.?.55:0.;')
        .replace('#include <normal_fragment_maps>', '{ vec3 q0=dFdx(-vViewPosition),q1=dFdy(-vViewPosition); vec2 s0=dFdx(vUv2),s1=dFdy(vUv2); vec3 N=normal; vec3 q1p=cross(q1,N),q0p=cross(N,q0); vec3 T=q1p*s0.x+q0p*s1.x,Bb=q1p*s0.y+q0p*s1.y; float det=max(dot(T,T),dot(Bb,Bb)); float sc=det==0.?0.:inversesqrt(det); normal=normalize(T*(bN.x*sc)+Bb*(bN.y*sc)+N*bN.z); }')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance+=vec3(1.,.72,.42)*bE*2.2;');
    };
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); d.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, u); patchVS(sh, sway, true); }; d.customProgramCacheKey = () => 'sh-solidd' + sway;
    const r = { m, d, u }; mats.set(key, r); return r;
  }
  // ---------- archetypes: per kind: {near: [state0, state1, state2], mid}
  const arch = KIND.map((K) => {
    const nm = K.name; let near = [], mid = null, veg = false, sway = 0;
    if (K.cls === 'tree') { veg = true; sway = 1; near = [treeGeo(nm, 0), treeGeo(nm, 0, true)]; mid = treeGeo(nm, 1); }
    else if (K.cls === 'plant' || K.cls === 'rock' || nm === 'bale') { veg = true; sway = K.cls === 'plant' ? 2 : 0; near = [plantGeo(nm, 0)]; mid = plantGeo(nm, 1); }
    else if (K.cls === 'bld' || nm === 'tower') { near = [bldGeo(nm, 0, 0), bldGeo(nm, 0, 1), bldGeo(nm, 0, 2)]; mid = bldGeo(nm, 1, 0); }
    else { near = [propGeo(nm, 0)]; mid = K.lod[1] ? propGeo(nm, 1) : null; sway = nm === 'turbine' || nm === 'pumpjack' || nm === 'elevator' || nm === 'waterTower' ? 0 : 0; }
    const lod = K.lod, mk = (l) => (veg ? vegMat(l, sway) : solidMat(l, sway));
    return { K, veg, near, mid, mNear: mk([0, 0, 0, lod[0]]), mMid: mid ? mk([lod[0], K.cls === 'tree' ? 900 * treeMul : 0, 2600, lod[1] * (K.cls === 'tree' ? Math.min(1, treeMul) : 1)]) : null };
  });
  // turbine rotors (animated, near+mid share one pool)
  const rotor = (() => { const g = new THREE.BufferGeometry(), p = [], n = []; for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a); const tip = [ca * 40, sa * 40], w = [-sa * 1.6, ca * 1.6]; p.push(w[0], w[1], 0, -w[0] * .5, -w[1] * .5, 0, tip[0], tip[1], 0); n.push(0, 0, 1, 0, 0, 1, 0, 0, 1); } g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3)); return g; })();
  const rotorMat = new THREE.MeshStandardMaterial({ color: 0xdcdde0, roughness: .5, side: THREE.DoubleSide, fog: false });
  const rotors = new THREE.InstancedMesh(rotor, rotorMat, 512); rotors.count = 0; rotors.frustumCulled = false; rotors.castShadow = true; group.add(rotors);
  // ---------- sectors
  const secs = new Map(); // key -> {i,j,items,state,mids:Map(kind->InstancedMesh), wires, signs, bins}
  const M = new THREE.Matrix4(), Qt = new THREE.Quaternion(), V = new THREE.Vector3(), Sc = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const itemMatrix = (it, o, m) => { Qt.setFromAxisAngle(Y, it[o + 4]); Sc.set(it[o + 5], it[o + 6], it[o + 5]); V.set(it[o + 1], it[o + 2], it[o + 3]); return m.compose(V, Qt, Sc); };
  const wireMat = new THREE.LineBasicMaterial({ color: 0x2a2c30, fog: false });
  function onSector(key, r) {
    const s = secs.get(key); if (!s || s.ready || !r) return; s.ready = true; s.items = r.items; const n = r.items.length / STRIDE; s.n = n; s.state = s.state || new Uint8Array(n);
    // bins (8x8 of 64 m)
    const x0 = SOX + s.i * SS, z0 = SOZ + s.j * SS, cnt = new Int32Array(65), bin = new Uint8Array(n);
    for (let k = 0; k < n; k++) { const bx = Math.min(7, Math.max(0, Math.floor((r.items[k * STRIDE + 1] - x0) / 64))), bz = Math.min(7, Math.max(0, Math.floor((r.items[k * STRIDE + 3] - z0) / 64))); bin[k] = bz * 8 + bx; cnt[bin[k] + 1]++; }
    for (let k = 0; k < 64; k++) cnt[k + 1] += cnt[k]; const ref = new Int32Array(n), pos = cnt.slice(); for (let k = 0; k < n; k++) ref[pos[bin[k]]++] = k; s.bins = { off: cnt, ref }; s.x0 = x0; s.z0 = z0;
    // apply damage remembered from net / earlier visits
    const pend = pendingBroken.get(key); if (pend) { for (const [idx, lv] of pend) if (idx < n) s.state[idx] = Math.max(s.state[idx], lv); pendingBroken.delete(key); }
    buildMids(s); s.wiresSrc = r.wires; buildWires(s); s.signs = r.signs.map((g) => makeSign(s, g)).filter(Boolean); dirtyNear = true;
  }
  function buildMids(s) {
    if (s.mids) for (const m of s.mids.values()) { group.remove(m); m.dispose(); }
    s.mids = new Map(); const it = s.items, byK = new Map();
    for (let k = 0; k < s.n; k++) { const kd = it[k * STRIDE]; if (!arch[kd].mid || s.state[k] > 0 && KIND[kd].cls !== 'bld') continue; if (s.state[k] > 1) continue; let a = byK.get(kd); if (!a) byK.set(kd, a = []); a.push(k); }
    for (const [kd, a] of byK) { const A = arch[kd], m = new THREE.InstancedMesh(A.mid, A.mMid.m, a.length); m.customDepthMaterial = A.mMid.d; for (let q = 0; q < a.length; q++) m.setMatrixAt(q, itemMatrix(it, a[q] * STRIDE, M)); m.computeBoundingSphere(); m.castShadow = A.K.cls !== 'plant' && A.K.cls !== 'rock'; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); s.mids.set(kd, m); }
  }
  function buildWires(s) {
    if (s.wires) { group.remove(s.wires); s.wires.geometry.dispose(); s.wires = null; } const w = s.wiresSrc; if (!w || !w.length) return; const p = [];
    for (let k = 0; k < w.length; k += 7) { if (s.state[w[k + 6]]) continue; p.push(w[k], w[k + 1], w[k + 2], w[k + 3], w[k + 4], w[k + 5]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeBoundingSphere(); s.wires = new THREE.LineSegments(g, wireMat); s.wires.matrixAutoUpdate = false; group.add(s.wires);
  }
  function makeSign(s, g) {
    const o = g.i * STRIDE, it = s.items, c = document.createElement('canvas'); c.width = 512; c.height = 288; const x = c.getContext('2d');
    x.fillStyle = '#0d5a33'; x.fillRect(0, 0, 512, 288); x.strokeStyle = '#e8eee8'; x.lineWidth = 7; x.beginPath(); x.roundRect(10, 10, 492, 268, 18); x.stroke();
    const num = g.route.replace(/^\D+-/, ''), isI = g.route.startsWith('I');
    x.save(); x.translate(256, 64); if (isI) { x.fillStyle = '#e8eee8'; x.beginPath(); x.moveTo(-38, -34); x.quadraticCurveTo(0, -44, 38, -34); x.quadraticCurveTo(44, 10, 0, 38); x.quadraticCurveTo(-44, 10, -38, -34); x.fill(); x.fillStyle = '#1b3f8f'; x.beginPath(); x.moveTo(-32, -18); x.quadraticCurveTo(0, -22, 32, -18); x.quadraticCurveTo(36, 12, 0, 32); x.quadraticCurveTo(-36, 12, -32, -18); x.fill(); x.fillStyle = '#c4262e'; x.fillRect(-33, -32, 66, 11); x.fillStyle = '#fff'; } else { x.fillStyle = '#f2f2ee'; x.fillRect(-36, -34, 72, 68); x.fillStyle = '#111'; }
    x.font = 'bold 30px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(num, 0, isI ? 8 : 2); x.restore();
    x.fillStyle = '#eef2ee'; x.font = 'bold 44px Arial'; x.textBaseline = 'middle'; g.lines.forEach(([name, d], k) => { x.textAlign = 'left'; x.fillText(name.slice(0, 15), 34, 150 + k * 70); x.textAlign = 'right'; x.fillText(String(d), 478, 150 + k * 70); });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 2.05), new THREE.MeshStandardMaterial({ map: t, roughness: .45, fog: false, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0 }));
    m.position.set(it[o + 1], it[o + 2] + 3.25, it[o + 3]); m.rotation.y = it[o + 4]; m.translateZ(.03); m.castShadow = true; m.userData.idx = g.i; group.add(m); return m;
  }
  function dropSector(key) { const s = secs.get(key); if (!s) return; if (s.mids) for (const m of s.mids.values()) { group.remove(m); m.dispose(); } if (s.wires) { group.remove(s.wires); s.wires.geometry.dispose(); } if (s.signs) for (const m of s.signs) { group.remove(m); m.material.map.dispose(); m.geometry.dispose(); m.material.dispose(); } if (s.state && s.state.some((v) => v)) { const a = []; s.state.forEach((v, i) => v && a.push([i, v])); pendingBroken.set(key, a); } secs.delete(key); dirtyNear = true; }
  const pendingBroken = new Map(); // sectorKey -> [[idx, level]]
  // ---------- near pools
  const pools = new Map(); let dirtyNear = true; const lastCam = new THREE.Vector3(1e9, 0, 0);
  const poolFor = (kd, st) => { const key = kd * 4 + st; let p = pools.get(key); if (!p) { const A = arch[kd], g = A.near[Math.min(st, A.near.length - 1)]; if (!g) return null; const m = new THREE.InstancedMesh(g, A.mNear.m, 64); m.customDepthMaterial = A.mNear.d; m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; group.add(m); p = { m, n: 0 }; pools.set(key, p); } return p; };
  function rebuildNear() {
    const c = ctx.camera.position; for (const p of pools.values()) p.n = 0; let nr = 0;
    for (const s of secs.values()) {
      if (!s.ready) continue; const dx = Math.max(s.x0 - c.x, 0, c.x - s.x0 - SS), dz = Math.max(s.z0 - c.z, 0, c.z - s.z0 - SS), ds = Math.hypot(dx, dz), it = s.items;
      if (s.wires) s.wires.visible = ds < 380;
      if (ds > 900) { for (let k = 0; k < s.n; k++) { if (it[k * STRIDE] === KI.turbine && !s.state[k]) addRotor(it, k * STRIDE, nr++); } continue; }
      for (let k = 0; k < s.n; k++) {
        const o = k * STRIDE, kd = it[o], K = KIND[kd], ex = it[o + 1] - c.x, ez = it[o + 3] - c.z, d2 = ex * ex + ez * ez; if (kd === KI.turbine && !s.state[k]) addRotor(it, o, nr++);
        if (d2 > K.lod[0] * K.lod[0]) continue; const st = s.state[k]; if (st && (K.cls === 'prop' || K.cls === 'sign' || K.cls === 'plant' || K.cls === 'land' && kd !== KI.tower)) continue;
        const p = poolFor(kd, st); if (!p) continue; if (p.n >= p.m.instanceMatrix.count) grow(p); p.m.setMatrixAt(p.n++, itemMatrix(it, o, M));
      }
    }
    for (const p of pools.values()) { p.m.count = p.n; p.m.instanceMatrix.needsUpdate = true; } rotors.count = Math.min(nr, 512); rotors.instanceMatrix.needsUpdate = true;
  }
  const rotorData = new Float32Array(512 * 4); function addRotor(it, o, n) { if (n >= 512) return; rotorData[n * 4] = it[o + 1]; rotorData[n * 4 + 1] = it[o + 2] + 79 * it[o + 6]; rotorData[n * 4 + 2] = it[o + 3] - 5.8; rotorData[n * 4 + 3] = it[o + 6]; }
  function grow(p) { const old = p.m, m = new THREE.InstancedMesh(old.geometry, old.material, old.instanceMatrix.count * 2); m.customDepthMaterial = old.customDepthMaterial; m.instanceMatrix.array.set(old.instanceMatrix.array); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; group.remove(old); old.dispose(); group.add(m); p.m = m; }
  // ---------- streaming
  let scanT = 0;
  function update(dt) {
    const c = ctx.camera.position, ci = Math.floor((c.x - SOX) / SS), cj = Math.floor((c.z - SOZ) / SS), rr = Math.ceil(R / SS);
    if ((scanT -= dt) <= 0) { scanT = .25;
      for (let j = cj - rr; j <= cj + rr; j++) for (let i = ci - rr; i <= ci + rr; i++) { if (i < 0 || j < 0 || i >= SGX || j >= SGZ) continue; const key = j * SGX + i; if (secs.has(key)) continue; const dx = SOX + (i + .5) * SS - c.x, dz = SOZ + (j + .5) * SS - c.z, d = Math.hypot(dx, dz); if (d > R) continue; secs.set(key, { i, j, ready: false }); pool.request('sector', { i, j }, d + 400, (r) => onSector(key, r), () => null); }
      for (const [key, s] of secs) { const dx = SOX + (s.i + .5) * SS - c.x, dz = SOZ + (s.j + .5) * SS - c.z; if (dx * dx + dz * dz > (R + 700) ** 2) dropSector(key); }
    }
    if (dirtyNear || c.distanceToSquared(lastCam) > 25) { lastCam.copy(c); dirtyNear = false; rebuildNear(); }
    // rotors spin
    const t = ctx.time.now, w = ctx.globals.uWind.value.length(); for (let n = 0; n < rotors.count; n++) { const s = rotorData[n * 4 + 3]; Qt.setFromAxisAngle(V.set(0, 0, 1), t * (.6 + Math.min(1.6, w * .12)) + n * 1.7); M.compose(V.set(rotorData[n * 4], rotorData[n * 4 + 1], rotorData[n * 4 + 2]), Qt, Sc.set(s, s, s)); rotors.setMatrixAt(n, M); }
    if (rotors.count) rotors.instanceMatrix.needsUpdate = true;
  }
  const near = (x, z, r = 400) => { for (const s of secs.values()) { const cx = SOX + (s.i + .5) * SS, cz = SOZ + (s.j + .5) * SS; if (Math.abs(cx - x) < r + SS / 2 && Math.abs(cz - z) < r + SS / 2 && !s.ready) return false; } const k = Math.floor((z - SOZ) / SS) * SGX + Math.floor((x - SOX) / SS); return !!secs.get(k)?.ready; };
  // ---------- colliders & damage
  const colCache = new Map();
  function collider(s, k) {
    const id = (s.j * SGX + s.i) * SEC_IDS + k; let c = colCache.get(id); const it = s.items, o = k * STRIDE, K = KIND[it[o]];
    if (!c) { c = { id, kind: K.name, shape: K.col[0], x: it[o + 1], y: 0, z: it[o + 3], r: 0, h: 0, hx: 0, hy: 0, hz: 0, rotY: it[o + 4], mass: K.mass * it[o + 5] * it[o + 5] * it[o + 6], breakSpeed: K.brk, broken: false, base: it[o + 2] }; if (K.col[0] === 'cyl') { c.r = K.col[1] * it[o + 5]; c.h = K.col[2] * it[o + 6]; c.y = c.base + c.h / 2; } else { c.hx = K.col[1] * it[o + 5]; c.hy = K.col[2] * it[o + 6]; c.hz = K.col[3] * it[o + 5]; c.y = c.base + c.hy; c.r = Math.hypot(c.hx, c.hz); c.h = c.hy * 2; } if (colCache.size > 6000) colCache.clear(); colCache.set(id, c); }
    const st = s.state[k]; c.broken = st > 0; if (st && K.cls === 'tree') { c.h = 1.6; c.y = c.base + .8; } else if (st && K.cls === 'bld') { c.hy = st > 1 ? .5 : c.hy * .8; c.y = c.base + c.hy; c.h = c.hy * 2; }
    return c;
  }
  function eachNear(x, z, r, fn) {
    for (let sj = Math.floor((z - r - SOZ) / SS); sj <= Math.floor((z + r - SOZ) / SS); sj++) for (let si = Math.floor((x - r - SOX) / SS); si <= Math.floor((x + r - SOX) / SS); si++) {
      const s = secs.get(sj * SGX + si); if (!s?.ready) continue; const b0x = Math.max(0, Math.floor((x - r - s.x0) / 64)), b1x = Math.min(7, Math.floor((x + r - s.x0) / 64)), b0z = Math.max(0, Math.floor((z - r - s.z0) / 64)), b1z = Math.min(7, Math.floor((z + r - s.z0) / 64));
      for (let bz = b0z; bz <= b1z; bz++) for (let bx = b0x; bx <= b1x; bx++) { const b = bz * 8 + bx; for (let q = s.bins.off[b]; q < s.bins.off[b + 1]; q++) fn(s, s.bins.ref[q]); }
    }
  }
  function queryColliders(x, z, r, out) { eachNear(x, z, r + 20, (s, k) => { const o = k * STRIDE, K = KIND[s.items[o]]; if (!K.col) return; const ext = (K.col[0] === 'cyl' ? K.col[1] : Math.max(K.col[1], K.col[3])) * s.items[o + 5]; const dx = s.items[o + 1] - x, dz = s.items[o + 3] - z; if (dx * dx + dz * dz > (r + ext) ** 2) return; const c = collider(s, k); if (s.state[k] && (K.cls === 'prop' || K.cls === 'sign' || K.cls === 'plant')) return; out.push(c); }); return out; }
  const listeners = { onBreak: null };
  function setBroken(s, k, lv, vel, emit) {
    if (s.state[k] >= lv) return false; s.state[k] = lv; const o = k * STRIDE, it = s.items, K = KIND[it[o]], id = (s.j * SGX + s.i) * SEC_IDS + k;
    s.dirty = true; dirtyNear = true; if (K.name === 'pole') { s.wdirty = true; ctx.events.emit('world:powerflash', { x: it[o + 1], y: it[o + 2] + 9.5, z: it[o + 3] }); }
    if (s.signs) for (const m of s.signs) if (m.userData.idx === k) m.visible = false;
    const c = colCache.get(id); if (c) c.broken = true;
    if (emit) { ctx.events.emit('world:break', { kind: K.debris, id, level: lv, pos: new THREE.Vector3(it[o + 1], it[o + 2] + (K.col ? (K.col[0] === 'cyl' ? K.col[2] : K.col[2] * 2) * it[o + 6] * .6 : 1), it[o + 3]), vel: vel || new THREE.Vector3(), size: K.cls === 'bld' ? Math.max(K.col[1], K.col[3]) : 1 }); listeners.onBreak?.(id * 4 + lv); }
    return true;
  }
  function hitCollider(id, imp) { const key = Math.floor(id / SEC_IDS), k = id % SEC_IDS, s = secs.get(key); if (!s?.ready || k >= s.n) return; const K = KIND[s.items[k * STRIDE]]; if (!K.brk && K.cls !== 'tree') return; setBroken(s, k, 1, imp ? new THREE.Vector3(imp.x, imp.y, imp.z).multiplyScalar(1 / Math.max(50, K.mass)) : null, true); }
  function applyBroken(codes) { for (const code of codes) { const lv = code % 4, id = (code - lv) / 4, key = Math.floor(id / SEC_IDS), k = id % SEC_IDS, s = secs.get(key); if (s?.ready && k < s.n) setBroken(s, k, lv, null, false); else { let a = pendingBroken.get(key); if (!a) pendingBroken.set(key, a = []); a.push([k, lv]); } } }
  // tornado wind damage
  const tv = new THREE.Vector3(); let rr = 0;
  function damage(tors, authority) {
    let budget = 40;
    for (let ti = 0; ti < tors.length; ti++) {
      const t = tors[(ti + rr) % tors.length]; if (!t || t.stage === 'dead' || t.stage === 'funnel' || !(t.vmax > 20)) continue; const rc = Math.max(10, t.rCore || 40), RR = Math.max(rc * 5, 140);
      eachNear(t.x, t.z, RR, (s, k) => {
        if (budget <= 0) return; const o = k * STRIDE, it = s.items, K = KIND[it[o]]; if (!K.w) return; const dx = it[o + 1] - t.x, dz = it[o + 3] - t.z, r = Math.hypot(dx, dz); if (r > RR) return;
        const v = t.vmax * 2 * r * rc / (r * r + rc * rc) * (.82 + .36 * it[o + 7]) * (t.strength ?? 1 > 0 ? 1 : 1); let lv = v > K.w[1] ? 2 : v > K.w[0] ? 1 : 0; if (K.cls === 'tree' || K.cls === 'prop' || K.cls === 'sign' || K.cls === 'plant') lv = Math.min(lv, 1); if (lv <= s.state[k]) return;
        tv.set(dz / (r + 1), .35, -dx / (r + 1)).multiplyScalar(v * .6 * (t.spin || 1)); if (setBroken(s, k, lv, tv, authority !== false)) budget--;
      });
    }
    rr++;
  }
  // flush dirty sectors (rebuild mids / wires) a few per frame
  function flush() { let n = 0; for (const s of secs.values()) { if (!s.ready) continue; if (s.dirty && n < 3) { s.dirty = false; buildMids(s); n++; } if (s.wdirty) { s.wdirty = false; buildWires(s); } } }
  const surfaceItems = (x, z, r, fn) => eachNear(x, z, r, (s, k) => fn(s.items, k * STRIDE, s.state[k]));
  return { group, update: (dt) => { update(dt); flush(); }, near, queryColliders, hitCollider, applyBroken, damage, listeners, surfaceItems, stats: () => ({ sectors: secs.size, pools: pools.size }), arch };
}

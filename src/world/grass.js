// Grass / crop blades in three bands, all with wind + tornado flattening in the vertex shader:
//  near  : CPU-placed 5-blade clumps in 12 m tiles (exact heightAt / road / field tests), dithered hand-over at the outer edge
//  mid+far: GPU-driven lattice of 3-blade clumps out to ~850 m. Patches (32 m) are picked per frame on the CPU (view wedge),
//           one instanced draw per LOD. Every lattice point has a level (trailing zero bits of its index); blades thin out
//           continuously with distance (density ~ 1/d^2, width ~ d: constant on-screen size) so there are no band edges.
//           Ground height / colour / blade height / density come from two toroidal clipmaps (1 m and 4 m) baked by
//           grassGen.js in a worker from the same samplers the terrain uses.
import * as THREE from 'three';
import { hash2 } from '../core/rng.js';
import { colFor, bakeRect } from './grassGen.js';

const T = 12, P = 32, S0 = .5, KMAX = 6, CELLS = P / S0;
const BEND = /* glsl */`
  vec2 w=uWind*(1.+uGust*.8*sin(uTime*2.3+wb.x*.15+wb.z*.11)); float fl=0.;
  for(int i=0;i<4;i++){ vec4 T=uTornadoA[i]; if(T.w<1.) continue; vec2 d=wb.xz-T.xy; float r=max(length(d),1.); float v=T.w*2.*r*T.z/(r*r+T.z*T.z); w+=vec2(d.y,-d.x)/r*v-d/r*v*.35; }
  float sp=length(w); fl=clamp(sp/30.,0.,.95); vec2 dir=sp>.01?w/sp:vec2(1.,0.);
  float bend=(.15+.35*th)*clamp(sp/12.,.05,1.4)+.08; float sway=sin(uTime*(1.6+sp*.15)+wb.x*.3+wb.z*.2+th*6.)*.12*clamp(sp/6.,.2,1.);
  vec2 off=dir*(bend+sway)*t*t*hgt*(1.+fl); float yy=t*hgt*(1.-fl*.75*t);`;
const FRAG = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCol; varying float vT;').replace('#include <map_fragment>', 'diffuseColor.rgb=vCol*(.45+.75*vT);').replace('#include <roughnessmap_fragment>', 'float roughnessFactor=1.;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor=0.;').replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal=normalize(mat3(viewMatrix)*vec3(0.,1.,0.)); nonPerturbedNormal=normal;'); };

export function createGrass(ctx, S) {
  const q = ctx.quality.grass ?? .5; if (q <= 0) return { update() {}, group: new THREE.Group(), idle: () => true };
  const qn = Math.min(1.5, q), RAD = 20 + 26 * qn, PER = Math.round(520 * Math.min(1.2, .6 + q * .5)), RFAR = q >= 1 ? 850 : 260 + 590 * q;
  const N0 = RAD * .62, N1 = RAD * .95;
  const group = new THREE.Group(); group.name = 'grass'; ctx.scene.add(group);
  const g = ctx.globals, camP = new THREE.Vector3();
  const u = { uWind: g.uWind, uGust: g.uGust, uTime: g.uTime, uTornadoA: g.uTornadoA, uCamP: { value: camP }, uN: { value: new THREE.Vector2(N0, N1) } };

  // ================= near band =================
  const bp = [], bi = [], bs = [];
  for (let b = 0; b < 5; b++) { const a = b * 2.4 + .3, ox = Math.cos(a * 1.7) * .09 * b, oz = Math.sin(a * 1.3) * .09 * b, ca = Math.cos(a), sa = Math.sin(a), o = bp.length / 3; for (let k = 0; k <= 4; k++) { const t = k / 4, w = .022 * (1 - t * .85); for (const sg of [-1, 1]) { bp.push(ox + ca * w * sg, t, oz + sa * w * sg); bs.push(t, b / 5); } } for (let k = 0; k < 4; k++) { const a0 = o + k * 2; bi.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2); } }
  const base = new THREE.BufferGeometry(); base.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); base.setAttribute('normal', new THREE.Float32BufferAttribute(bp.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3)); base.setAttribute('aS', new THREE.Float32BufferAttribute(bs, 2)); base.setIndex(bi);
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1, metalness: 0, envMapIntensity: .8, fog: false }); mat.customProgramCacheKey = () => 'sh-grass-near2';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 iP; attribute vec4 iC; attribute vec2 aS; uniform vec2 uWind,uN; uniform float uGust,uTime; uniform vec4 uTornadoA[4]; uniform vec3 uCamP; varying vec3 vCol; varying float vT;`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal=vec3(0.,1.,0.);')
      .replace('#include <begin_vertex>', `
      vec3 wb=iP.xyz; float rnd=iP.w; float dc=length(wb.xz-uCamP.xz); float th=fract(rnd*7.31+aS.y*.37);
      float ho=smoothstep(uN.x,uN.y,dc); float fade=clamp((fract(rnd*31.7)*.8+.2-ho)*5.,0.,1.);
      float hgt=iC.w*(.65+.6*fract(rnd*13.7+aS.y))*fade; float ang=rnd*6.2832; float ca=cos(ang),sa=sin(ang);
      vec3 p=vec3(position.x*ca-position.z*sa,0.,position.x*sa+position.z*ca); float wid=mix(1.,2.6,smoothstep(8.,uN.y,dc))*(iC.w>1.2?3.:1.); p.xz*=wid;
      float t=position.y; ${BEND}
      vec3 transformed=wb+vec3(p.x+off.x+(rnd-.5)*.2*t*hgt,yy,p.z+off.y); vCol=iC.rgb; vT=t;`)
      .replace('#include <project_vertex>', 'vec4 mvPosition=viewMatrix*vec4(transformed,1.); gl_Position=projectionMatrix*mvPosition; if(fade<=0.) gl_Position=vec4(2.,2.,2.,1.);')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition=vec4(transformed,1.);');
    FRAG(sh);
  };
  const tiles = new Map(), free = []; let need = [];
  const tmpC = [0, 0, 0, 0], O = S.O;
  function gen(tx, tz) {
    const Pa = new Float32Array(PER * 4), Cc = new Float32Array(PER * 4); let n = 0;
    for (let k = 0; k < PER; k++) {
      const x = tx * T + hash2(tx * PER + k, tz, 1) * T, z = tz * T + hash2(tx * PER + k, tz, 2) * T, y = S.heightAt(x, z);
      if (O.eMaj < .8 || O.eStr < 2.6 || O.eGrv < .4 || O.deck || O.eRiv < 2) continue; const f = S.fieldAt(x, z); if (f.crop === 6 || f.crop === 8 || f.yard < 0) continue; const b = S.bio(x, z); if (b.urban > .5 && hash2(k, tx, 3) < .7) continue; if (b.arid > .8 && hash2(k, tz, 4) < .7) continue;
      if (f.crop === 4 && (Math.abs(((f.dir ? x : z) % .76 + .76) % .76 - .38) > .12)) continue; if (S.waterLevelAt(x, z) > y - .05) continue;
      colFor(O.eMaj < 15 || O.eStr < 9 || f.edge < 0 ? 0 : f.crop, b, x, z, tmpC); Pa[n * 4] = x; Pa[n * 4 + 1] = y - .03; Pa[n * 4 + 2] = z; Pa[n * 4 + 3] = hash2(k, tx + tz * 977, 9); Cc.set(tmpC, n * 4); n++;
    }
    let m = free.pop(); if (!m) { const gg = new THREE.InstancedBufferGeometry(); gg.setIndex(base.index); for (const k of ['position', 'normal', 'aS']) gg.setAttribute(k, base.attributes[k]); gg.setAttribute('iP', new THREE.InstancedBufferAttribute(Pa, 4)); gg.setAttribute('iC', new THREE.InstancedBufferAttribute(Cc, 4)); gg.boundingSphere = new THREE.Sphere(); m = new THREE.Mesh(gg, mat); m.frustumCulled = true; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); }
    else { const a = m.geometry.attributes; a.iP.array = Pa; a.iP.needsUpdate = true; a.iC.array = Cc; a.iC.needsUpdate = true; }
    m.geometry.instanceCount = n; m.geometry.boundingSphere.center.set((tx + .5) * T, n ? Pa[1] : 0, (tz + .5) * T); m.geometry.boundingSphere.radius = T * .75 + 2.5; m.visible = n > 0; return m;
  }

  // ================= clipmaps (mid / far data) =================
  const LV = [{ c: 1, N: 512, hs: 24 }, { c: 4, N: 512, hs: 24 }].map((l) => {
    const H = new Float32Array(l.N * l.N * 2), C = new Uint8Array(l.N * l.N * 4);
    const tH = new THREE.DataTexture(H, l.N, l.N, THREE.RGFormat, THREE.FloatType), tC = new THREE.DataTexture(C, l.N, l.N, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const t of [tH, tC]) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    return { ...l, H, C, tH, tC, ox: 0, oz: 0, nox: 0, noz: 0, ready: false, busy: 0, win: new THREE.Vector4(1e8, 1e8, l.N, l.c) };
  });
  Object.assign(u, { uH0: { value: LV[0].tH }, uC0: { value: LV[0].tC }, uWin0: { value: LV[0].win }, uH1: { value: LV[1].tH }, uC1: { value: LV[1].tC }, uWin1: { value: LV[1].win }, uD0: { value: N0 }, uFar: { value: new THREE.Vector2(RFAR * .62, RFAR) }, uPx: { value: .002 } });
  // workers
  const jobs = new Map(), queue = []; let jid = 1, wk = [], mainThread = false;
  try {
    const nW = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 3));
    for (let i = 0; i < nW; i++) {
      const w = new Worker(new URL('./grassGen.js', import.meta.url), { type: 'module' }), o = { w, ok: false, dead: false, load: 0 };
      w.onerror = (e) => { console.warn('[grass] worker failed, baking on main thread', e.message || ''); o.dead = true; for (const [id, j] of jobs) if (j.o === o) { jobs.delete(id); queue.push(j); } if (wk.every((v) => v.dead)) mainThread = true; };
      w.onmessage = (e) => { const m = e.data; if (m.t === 'ready') { o.ok = true; return; } const j = jobs.get(m.id); if (!j) return; jobs.delete(m.id); o.load--; workMs += m.ms || 0; done.push([j, m.t === 'rect' ? m.H : null, m.t === 'rect' ? m.C : null]); if (m.t === 'err') console.error('[grass worker]', m.msg); };
      w.postMessage({ t: 'init', data: S.data }); wk.push(o);
    }
  } catch (e) { console.warn('[grass] no worker', e); mainThread = true; }
  const done = []; let workMs = 0;
  const md = (a, n) => ((a % n) + n) % n;
  function integrate(j, H, C) {
    const l = j.l, N = l.N;
    for (let r = 0; r < j.h; r++) { const jm = md(j.J0 + r, N); let im = md(j.I0, N); for (let i = 0; i < j.w; i++) { const s = r * j.w + i, d = jm * N + im; l.H[d * 2] = H ? H[s * 2] : 0; l.H[d * 2 + 1] = H ? H[s * 2 + 1] : 0; if (C) { l.C[d * 4] = C[s * 4]; l.C[d * 4 + 1] = C[s * 4 + 1]; l.C[d * 4 + 2] = C[s * 4 + 2]; l.C[d * 4 + 3] = C[s * 4 + 3]; } else l.C[d * 4 + 3] = 0; if (++im === N) im = 0; } }
    if (--l.busy === 0) { l.ox = l.nox; l.oz = l.noz; l.ready = true; l.tH.needsUpdate = l.tC.needsUpdate = true; l.win.set(l.ox, l.oz, l.N, l.c); }
  }
  function rect(l, I0, J0, w, h, out) { const rows = Math.max(1, Math.floor(8192 / w)); for (let r = 0; r < h; r += rows) out.push({ l, I0, J0: J0 + r, w, h: Math.min(rows, h - r) }); }
  function shift(l, nx, nz, cx, cz) {
    const out = [], N = l.N, dx = nx - l.ox, dz = nz - l.oz;
    if (!l.ready || Math.abs(dx) >= N || Math.abs(dz) >= N) rect(l, nx, nz, N, N, out);
    else {
      if (dx > 0) rect(l, l.ox + N, nz, dx, N, out); else if (dx < 0) rect(l, nx, nz, -dx, N, out);
      const x0 = Math.max(nx, l.ox), xw = Math.min(nx, l.ox) + N - x0;
      if (dz > 0) rect(l, x0, l.oz + N, xw, dz, out); else if (dz < 0) rect(l, x0, nz, xw, -dz, out);
    }
    if (!out.length) return;
    for (const j of out) j.d = Math.hypot((j.I0 + j.w / 2) * l.c - cx, (j.J0 + j.h / 2) * l.c - cz);
    out.sort((a, b) => a.d - b.d); l.nox = nx; l.noz = nz; l.busy = out.length; for (const j of out) { j.id = jid++; queue.push(j); }
  }
  let mtH = null, mtC = null;
  function pumpJobs() {
    if (!mainThread) { for (const o of wk) { if (o.dead) continue; while (o.load < 3 && queue.length) { const j = queue.shift(); j.o = o; o.load++; jobs.set(j.id, j); o.w.postMessage({ t: 'rect', id: j.id, c: j.l.c, I0: j.I0, J0: j.J0, w: j.w, h: j.h }); } } }
    else { // main-thread fallback: one row at a time, ~2 ms per frame
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 2) { const j = queue[0]; j.r ??= 0; if (!j.H) { j.H = new Float32Array(j.w * j.h * 2); j.C = new Uint8Array(j.w * j.h * 4); }
        mtH ??= new Float32Array(1024 * 2); mtC ??= new Uint8Array(1024 * 4); bakeRect(S, j.l.c, j.I0, j.J0 + j.r, j.w, 1, mtH, mtC); j.H.set(mtH.subarray(0, j.w * 2), j.r * j.w * 2); j.C.set(mtC.subarray(0, j.w * 4), j.r * j.w * 4);
        if (++j.r >= j.h) { queue.shift(); done.push([j, j.H, j.C]); } }
    }
    const t0 = performance.now(); while (done.length && (performance.now() - t0 < 1.5)) { const [j, H, C] = done.shift(); integrate(j, H, C); }
  }

  // ================= mid / far band =================
  const fmat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1, metalness: 0, envMapIntensity: .8, fog: false }); fmat.customProgramCacheKey = () => 'sh-grass-far1';
  fmat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 iPt; uniform vec2 uWind,uN,uFar; uniform float uGust,uTime,uD0,uPx; uniform vec4 uTornadoA[4]; uniform vec3 uCamP; varying vec3 vCol; varying float vT;
      uniform highp sampler2D uH0,uH1; uniform highp sampler2D uC0,uC1; uniform vec4 uWin0,uWin1;
      uint gS; float rn(){ gS=gS*747796405u+2891336453u; uint w=((gS>>((gS>>28u)+4u))^gS)*277803737u; w=(w>>22u)^w; return float(w>>8u)/16777216.; }
      int ctz(int v){ if(v==0) return 12; int n=0; for(int i=0;i<12;i++){ if((v&1)!=0) break; v>>=1; n++; } return n; }
      bool inW(vec4 W,vec2 p){ vec2 f=p/W.w-W.xy; return f.x>=1.&&f.y>=1.&&f.x<W.z-2.&&f.y<W.z-2.; }
      float gH(highp sampler2D T,vec4 W,vec2 p){ vec2 f=p/W.w; vec2 i=floor(f),a=f-i; float N=W.z;
        float h00=texelFetch(T,ivec2(mod(i,N)),0).r,h10=texelFetch(T,ivec2(mod(i+vec2(1.,0.),N)),0).r,h01=texelFetch(T,ivec2(mod(i+vec2(0.,1.),N)),0).r,h11=texelFetch(T,ivec2(mod(i+vec2(1.),N)),0).r;
        return mix(mix(h00,h10,a.x),mix(h01,h11,a.x),a.y); }`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal=vec3(0.,1.,0.);')
      .replace('#include <begin_vertex>', `
      float st=exp2(iPt.z); vec2 Iw=iPt.xy+position.xy*st; ivec2 ii=ivec2(Iw);
      float lev=float(min(ctz(ii.x),ctz(ii.y)));
      gS=uint(ii.x+1048576)*1664525u^(uint(ii.y+1048576)*1013904223u+374761393u); rn(); rn();
      float r0=rn(),r1=rn(),r2=rn(),r3=rn(),r4=rn(),r5=rn(),rnd=rn();
      vec2 p2=(Iw+(vec2(r0,r1)-.5)*exp2(min(lev,6.)))*${S0};
      float dc=length(p2-uCamP.xz); bool kill=false;
      float L=log2(max(dc,uD0)/uD0)*.85; float wl=clamp((lev+.75*r2-L)*4.+1.,0.,1.);
      float wn=clamp((smoothstep(uN.x,uN.y,dc)-r3*.8)*5.,0.,1.), wf=clamp((r4*.8+.2-smoothstep(uFar.x,uFar.y,dc))*5.,0.,1.);
      float wv=wl*wn*wf; vec2 hb=vec2(0.); vec4 cc=vec4(0.); float gy=0.;
      if(wv<=.002) kill=true;
      else if(inW(uWin0,p2)){ gy=gH(uH0,uWin0,p2); ivec2 nt=ivec2(mod(floor(p2/uWin0.w+.5),uWin0.z)); hb=texelFetch(uH0,nt,0).rg; cc=texelFetch(uC0,nt,0); }
      else if(inW(uWin1,p2)){ gy=gH(uH1,uWin1,p2); ivec2 nt=ivec2(mod(floor(p2/uWin1.w+.5),uWin1.z)); hb=texelFetch(uH1,nt,0).rg; cc=texelFetch(uC1,nt,0); }
      if(hb.y<=0.||r5>=cc.a) kill=true;
      float bl=floor(position.z/3.+.01), vi=position.z-bl*3.; float th=fract(rnd*7.31+bl*.37);
      float hgt=hb.y*(.65+.6*fract(rnd*13.7+bl*.29))*wv; float corn=hb.y>1.2?2.4:1.;
      float bw=max(.05,dc*uPx)*corn;
      float ang=rnd*6.2832+bl*2.1; vec2 rd=vec2(cos(ang),sin(ang)); vec2 tv=p2-uCamP.xz; vec2 fc=normalize(vec2(-tv.y,tv.x)+1e-4); if(dot(fc,rd)<0.) fc=-fc;
      rd=normalize(mix(rd,fc,smoothstep(25.,90.,dc)*.85)+1e-4);
      vec2 co=vec2(cos(bl*2.4+rnd*9.),sin(bl*2.4+rnd*9.))*(.06+.12*bl)*max(1.,bw*8.);
      float t=vi>1.5?1.:0.; vec3 wb=vec3(p2.x+co.x,gy-.04-dc*.0004,p2.y+co.y); ${BEND}
      float sd=vi<.5?-.5:(vi<1.5?.5:0.);
      vec3 transformed=wb+vec3(rd.x*bw*sd+off.x+(r0-.5)*.3*t*hgt,yy,rd.y*bw*sd+off.y);
      vCol=cc.rgb*cc.rgb; vT=t;`)
      .replace('#include <project_vertex>', 'vec4 mvPosition=viewMatrix*vec4(transformed,1.); gl_Position=projectionMatrix*mvPosition; if(kill) gl_Position=vec4(2.,2.,2.,1.);')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition=vec4(transformed,1.);');
    FRAG(sh);
  };
  const PR = Math.ceil(RFAR / P) + 1, MAXP = (2 * PR + 1) ** 2, lods = [];
  for (let k = 0; k <= KMAX; k++) {
    const n = CELLS >> k, pos = new Float32Array(n * n * 9 * 3); let o = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) for (let v = 0; v < 9; v++) { pos[o++] = i; pos[o++] = j; pos[o++] = v; }
    const gg = new THREE.InstancedBufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ia = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3); ia.setUsage(THREE.DynamicDrawUsage); gg.setAttribute('iPt', ia); gg.instanceCount = 0;
    gg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const m = new THREE.Mesh(gg, fmat); m.frustumCulled = false; m.receiveShadow = true; m.matrixAutoUpdate = false; m.visible = false; group.add(m); lods.push({ m, ia, n: 0 });
  }
  const fw = new THREE.Vector3();
  function pickPatches(c) {
    ctx.camera.getWorldDirection(fw); const fl = Math.hypot(fw.x, fw.z), noCull = fl < .3, fx = fw.x / (fl || 1), fz = fw.z / (fl || 1);
    const cam = ctx.camera, hv = Math.atan(Math.tan((cam.fov || 70) * Math.PI / 360) * (cam.aspect || 1.78)), cosH = Math.cos(Math.min(Math.PI, hv + .12));
    u.uPx.value = 2 * Math.tan((cam.fov || 70) * Math.PI / 360) / Math.max(300, (ctx.renderer?.domElement?.height || 900)) * 2.1;
    for (const l of lods) l.n = 0;
    const pcx = Math.floor(c.x / P), pcz = Math.floor(c.z / P), D0 = N0, cpx = c.x, cpz = c.z;
    for (let j = -PR; j <= PR; j++) for (let i = -PR; i <= PR; i++) {
      const x0 = (pcx + i) * P, z0 = (pcz + j) * P, ddx = Math.max(x0 - cpx, 0, cpx - x0 - P), ddz = Math.max(z0 - cpz, 0, cpz - z0 - P), dmin = Math.hypot(ddx, ddz);
      if (dmin > RFAR) continue; const ex = Math.max(Math.abs(x0 - cpx), Math.abs(x0 + P - cpx)), ez = Math.max(Math.abs(z0 - cpz), Math.abs(z0 + P - cpz)); if (Math.hypot(ex, ez) < N0) continue;
      if (!noCull && dmin > 2) { const vx = x0 + P / 2 - cpx, vz = z0 + P / 2 - cpz, vl = Math.hypot(vx, vz), r = P * .71 + 18; if (vl > r && (vx * fx + vz * fz) / vl < Math.cos(Math.min(Math.PI, Math.acos(cosH) + Math.asin(Math.min(1, r / vl))))) continue; }
      const k = Math.min(KMAX, Math.max(0, Math.floor(Math.log2(Math.max(dmin, D0) / D0)))), L = lods[k], a = L.ia.array, o = L.n * 3; a[o] = (pcx + i) * CELLS; a[o + 1] = (pcz + j) * CELLS; a[o + 2] = k; L.n++;
    }
    for (const l of lods) { l.m.geometry.instanceCount = l.n; l.m.visible = l.n > 0; if (l.n) { l.ia.clearUpdateRanges(); l.ia.addUpdateRange(0, l.n * 3); l.ia.needsUpdate = true; } }
  }

  let lx = 1e9, lz = 1e9; const t0c = performance.now(); let tReady = 0;
  group.userData.stats = () => ({ grassPatches: lods.map((l) => l.n), grassJobs: queue.length + jobs.size, grassReady: LV.map((l) => l.ready), bakeMs: tReady, workMs: Math.round(workMs), nW: wk.length, tiles: tiles.size, mainThread });
  return { group, update() {
    if (!tReady && LV.every((l) => l.ready)) tReady = Math.round(performance.now() - t0c);
    const c = ctx.camera.position, cx = Math.floor(c.x / T), cz = Math.floor(c.z / T), rr = Math.ceil(RAD / T); camP.copy(c);
    for (const l of LV) { if (l.busy) continue; const nx = Math.floor(c.x / l.c) - l.N / 2, nz = Math.floor(c.z / l.c) - l.N / 2; if (!l.ready || Math.abs(nx - l.ox) >= l.hs || Math.abs(nz - l.oz) >= l.hs) shift(l, nx, nz, c.x, c.z); }
    pumpJobs();
    if (c.y - S.heightAt(c.x, c.z) > 120) { group.visible = false; return; } group.visible = true;
    pickPatches(c);
    if (cx !== lx || cz !== lz) { lx = cx; lz = cz; for (const [k, m] of tiles) { const tx = Math.floor(k / 65536) - 32768, tz = (k % 65536) - 32768; if (Math.hypot((tx + .5) * T - c.x, (tz + .5) * T - c.z) > RAD + T) { m.visible = false; free.push(m); tiles.delete(k); } } need = []; for (let j = -rr; j <= rr; j++) for (let i = -rr; i <= rr; i++) { const tx = cx + i, tz = cz + j, k = (tx + 32768) * 65536 + tz + 32768; if (!tiles.has(k) && Math.hypot((tx + .5) * T - c.x, (tz + .5) * T - c.z) < RAD + T * .7) need.push([Math.hypot(i, j), tx, tz, k]); } need.sort((a, b) => b[0] - a[0]); }
    const t0 = performance.now(); while (need.length && performance.now() - t0 < 1.6) { const [, tx, tz, k] = need.pop(); tiles.set(k, gen(tx, tz)); }
  }, idle: () => need.length === 0 && LV.every((l) => l.ready && !l.busy),
  stats: () => ({ grassPatches: lods.map((l) => l.n), grassJobs: queue.length + jobs.size, grassReady: LV.map((l) => l.ready) }) };
}

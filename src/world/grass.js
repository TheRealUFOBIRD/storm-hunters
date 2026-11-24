// Grass / crops: one GPU-driven, world-locked lattice of thin blades from the camera out to ~850 m (one instanced draw).
//  * Lattice spacing S0 (12.5 cm). Each lattice point is a tuft of 3 thin 2-segment blades plus a small ground "thatch"
//    card in the blade base colour, so gaps between blades read as grass, not soil.
//  * Every lattice point has a level = trailing zero bits of its index. With distance the lower levels shrink away
//    (density ~ 1/d^2) while blades widen to stay ~1 px, so there are no LOD bands.
//  * The CPU emits quadtree nodes (32x32 cells, size 4 m * 2^k) per frame inside the view wedge; node level k is the
//    coarsest lattice whose points are all still visible.
//  * Ground height, colour, kind, blade height and density come from three toroidal clipmaps (0.25 m, 1 m, 4 m)
//    baked by grassGen.js in workers from the same samplers the terrain uses (no grass on roads/water/yards/plowed).
//  * Wind (ctx.globals.uWind/uGust) with travelling gust waves, tornado flattening (uTornadoA).
import * as THREE from 'three';
import { bakeRect } from './grassGen.js';

const S0 = .125, NC = 32, P0 = NC * S0, KMAX = 8, BL = 3, VPC = BL * 5 + 4;

export function createGrass(ctx, S) {
  const q = ctx.quality.grass ?? .5; if (q <= 0) return { update() {}, group: new THREE.Group(), idle: () => true };
  const qn = Math.min(1.5, q), D0 = 3.2 + 2.6 * qn, RFAR = q >= 1 ? 850 : 260 + 590 * q;
  const group = new THREE.Group(); group.name = 'grass'; ctx.scene.add(group);
  const g = ctx.globals, camP = new THREE.Vector3();

  // ================= clipmaps =================
  const LV = [{ c: .25, N: 256, hs: 16 }, { c: 1, N: 512, hs: 24 }, { c: 4, N: 512, hs: 24 }].map((l) => {
    const H = new Float32Array(l.N * l.N * 2), C = new Uint8Array(l.N * l.N * 4);
    const tH = new THREE.DataTexture(H, l.N, l.N, THREE.RGFormat, THREE.FloatType), tC = new THREE.DataTexture(C, l.N, l.N, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const t of [tH, tC]) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    return { ...l, H, C, tH, tC, ox: 0, oz: 0, nox: 0, noz: 0, ready: false, busy: 0, win: new THREE.Vector4(1e8, 1e8, l.N, l.c) };
  });
  const u = {
    uWind: g.uWind, uGust: g.uGust, uTime: g.uTime, uTornadoA: g.uTornadoA, uCamP: { value: camP },
    uH0: { value: LV[0].tH }, uC0: { value: LV[0].tC }, uWin0: { value: LV[0].win }, uH1: { value: LV[1].tH }, uC1: { value: LV[1].tC }, uWin1: { value: LV[1].win },
    uH2: { value: LV[2].tH }, uC2: { value: LV[2].tC }, uWin2: { value: LV[2].win }, uD0: { value: D0 }, uFar: { value: new THREE.Vector2(RFAR * .62, RFAR) }, uPx: { value: .0015 },
  };
  // workers
  const jobs = new Map(), queue = [], done = []; let jid = 1, workMs = 0; const wk = []; let mainThread = false;
  try {
    const nW = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 3));
    for (let i = 0; i < nW; i++) {
      const w = new Worker(new URL('./grassGen.js', import.meta.url), { type: 'module' }), o = { w, ok: false, dead: false, load: 0 };
      w.onerror = (e) => { console.warn('[grass] worker failed, baking on main thread', e.message || ''); o.dead = true; for (const [id, j] of jobs) if (j.o === o) { jobs.delete(id); queue.push(j); } if (wk.every((v) => v.dead)) mainThread = true; };
      w.onmessage = (e) => { const m = e.data; if (m.t === 'ready') { o.ok = true; return; } const j = jobs.get(m.id); if (!j) return; jobs.delete(m.id); o.load--; workMs += m.ms || 0; done.push([j, m.t === 'rect' ? m.H : null, m.t === 'rect' ? m.C : null]); if (m.t === 'err') console.error('[grass worker]', m.msg); };
      w.postMessage({ t: 'init', data: S.data }); wk.push(o);
    }
  } catch (e) { console.warn('[grass] no worker', e); mainThread = true; }
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

  // ================= material =================
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1, metalness: 0, envMapIntensity: .8, fog: false }); mat.customProgramCacheKey = () => 'sh-grass-3';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 iPt; uniform vec2 uWind,uFar; uniform float uGust,uTime,uD0,uPx; uniform vec4 uTornadoA[4]; uniform vec3 uCamP;
      varying vec3 vCol; varying float vT,vS,vF,vB;
      uniform highp sampler2D uH0,uH1,uH2,uC0,uC1,uC2; uniform vec4 uWin0,uWin1,uWin2;
      uint gS; float rn(){ gS=gS*747796405u+2891336453u; uint w=((gS>>((gS>>28u)+4u))^gS)*277803737u; w=(w>>22u)^w; return float(w>>8u)/16777216.; }
      int ctz(int v){ if(v==0) return 14; int n=0; for(int i=0;i<14;i++){ if((v&1)!=0) break; v>>=1; n++; } return n; }
      bool inW(vec4 W,vec2 p){ vec2 f=p/W.w-W.xy; return f.x>=1.&&f.y>=1.&&f.x<W.z-2.&&f.y<W.z-2.; }
      float gH(highp sampler2D T,vec4 W,vec2 p){ vec2 f=p/W.w; vec2 i=floor(f),a=f-i; float N=W.z;
        float h00=texelFetch(T,ivec2(mod(i,N)),0).r,h10=texelFetch(T,ivec2(mod(i+vec2(1.,0.),N)),0).r,h01=texelFetch(T,ivec2(mod(i+vec2(0.,1.),N)),0).r,h11=texelFetch(T,ivec2(mod(i+vec2(1.),N)),0).r;
        return mix(mix(h00,h10,a.x),mix(h01,h11,a.x),a.y); }
      float groundY(vec2 p){ if(inW(uWin0,p)) return gH(uH0,uWin0,p); if(inW(uWin1,p)) return gH(uH1,uWin1,p); return gH(uH2,uWin2,p); }`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal=vec3(0.,1.,0.);')
      .replace('#include <begin_vertex>', `
      float st=exp2(iPt.z); vec2 Iw=iPt.xy+position.xy*st; ivec2 ii=ivec2(Iw);
      float lev=float(min(ctz(ii.x),ctz(ii.y)));
      float code=position.z; bool thatch=code>=${BL * 8}.; float bl=thatch?0.:floor(code/8.+.01); float vi=thatch?code-${BL * 8}.:code-bl*8.;
      gS=uint(ii.x+1048576)*1664525u^(uint(ii.y+1048576)*1013904223u+374761393u); rn(); gS+=uint(bl)*2654435761u; rn();
      float r0=rn(),r1=rn(),r2=rn(),r3=rn(),r4=rn(),r5=rn(),r6=rn(),rnd=rn();
      float cl=exp2(min(lev,9.));
      vec2 p2=(Iw+(vec2(r0,r1)-.5)*cl)*${S0};
      float dc=length(p2-uCamP.xz); bool kill=false;
      float L=log2(max(dc,uD0)/uD0); float wl=clamp((lev+.75*r2-L)*4.+1.,0.,1.);
      float wf=clamp((r4*.8+.2-smoothstep(uFar.x,uFar.y,dc))*5.,0.,1.);
      float wv=wl*wf; vec2 hb=vec2(0.); vec4 cc=vec4(0.); float gy=0.;
      if(wv<=.002) kill=true;
      else if(inW(uWin0,p2)){ gy=gH(uH0,uWin0,p2); ivec2 nt=ivec2(mod(floor(p2/uWin0.w+.5),uWin0.z)); hb=texelFetch(uH0,nt,0).rg; cc=texelFetch(uC0,nt,0); }
      else if(inW(uWin1,p2)){ gy=gH(uH1,uWin1,p2); ivec2 nt=ivec2(mod(floor(p2/uWin1.w+.5),uWin1.z)); hb=texelFetch(uH1,nt,0).rg; cc=texelFetch(uC1,nt,0); }
      else if(inW(uWin2,p2)){ gy=gH(uH2,uWin2,p2); ivec2 nt=ivec2(mod(floor(p2/uWin2.w+.5),uWin2.z)); hb=texelFetch(uH2,nt,0).rg; cc=texelFetch(uC2,nt,0); }
      float ab=floor(cc.a*255.+.5), kind=floor(ab/16.), dens=mod(ab,16.)/15.;
      if(hb.y<=0.||r5>=dens) kill=true;
      bool corn=kind==4.||kind==10., grassK=kind==0.||kind==1.||kind==11.;
      if(corn){ float cr=kind>9.?p2.x:p2.y; float rw=abs(fract(cr/.76)-.5)*.76; if(rw>.09+smoothstep(30.,90.,dc)*.3) kill=true; }
      float tall=(grassK&&r3<.05)?1.45:1.;
      float hgt=hb.y*(.68+.55*r6)*tall*wv;
      vec3 col=cc.rgb*cc.rgb*(.86+.28*rnd);
      // wind with travelling gust waves
      vec2 w=uWind*(1.+uGust*.8*sin(uTime*2.3+p2.x*.15+p2.y*.11)); float fl=0.;
      for(int i=0;i<4;i++){ vec4 T=uTornadoA[i]; if(T.w<1.) continue; vec2 d=p2-T.xy; float r=max(length(d),1.); float v=T.w*2.*r*T.z/(r*r+T.z*T.z); w+=vec2(d.y,-d.x)/r*v-d/r*v*.35; }
      float sp=length(w); fl=clamp(sp/30.,0.,.95); vec2 dir=sp>.01?w/sp:vec2(1.,0.);
      float wave=sin(dot(p2,dir)*.16-uTime*(1.4+sp*.08)+sin(dot(p2,vec2(-dir.y,dir.x))*.05)*2.)*.5+.5; float ws=clamp(sp/7.,0.,1.);
      float th=fract(rnd*7.31+bl*.37);
      float bend=((.12+.3*th)*clamp(sp/12.,.05,1.4)+.06)*(.55+.9*wave*ws+(1.-ws)*.45); float sway=sin(uTime*(1.8+sp*.15)+p2.x*.4+p2.y*.3+th*6.)*.1*clamp(sp/6.,.2,1.);
      vB=1.+(.16*wave-.08)*ws;
      vec3 transformed; vS=0.; vF=0.;
      if(thatch){
        float lc=min(lev,max(L,0.)+1.); float hs=.62*${S0}*exp2(lc)*(.8+.4*r6)*clamp((70.-dc)/25.,0.,1.)*wv;
        if(!grassK&&kind!=2.&&kind!=3.&&kind!=7.&&kind!=9.) kill=true; if(hs<=.001) kill=true;
        float a=rnd*6.2832; vec2 cv=vec2(vi==1.||vi==2.?1.:-1.,vi>=2.?1.:-1.)*hs; vec2 rc=vec2(cv.x*cos(a)-cv.y*sin(a),cv.x*sin(a)+cv.y*cos(a));
        vec2 pp=p2+rc; transformed=vec3(pp.x,groundY(pp)+.022+.004*r3,pp.y); vT=.04+.1*r2; col*=.78+.2*r4; hgt=1.;
      } else {
        float bw=max(corn?.05+.02*r4:(kind==3.||kind==2.?.006:.0045+.0045*r4),dc*uPx);
        float ang=rnd*6.2832; vec2 rd=vec2(cos(ang),sin(ang)); vec2 tv=p2-uCamP.xz; vec2 fc=normalize(vec2(-tv.y,tv.x)+1e-4); if(dot(fc,rd)<0.) fc=-fc;
        rd=normalize(mix(rd,fc,smoothstep(18.,70.,dc)*.85)+1e-4);
        float t=vi<1.5?0.:(vi<3.5?.5:1.); float sd=(vi==0.||vi==2.)?-.5:((vi==1.||vi==3.)?.5:0.); sd*=1.-t*.55;
        vec2 lean=(vec2(r0,r1)-.5)*.5;
        vec2 off=(dir*(bend+sway)*(1.+fl)+lean)*t*t*hgt; float yy=t*hgt*(1.-fl*.75*t);
        transformed=vec3(p2.x+rd.x*bw*sd+off.x,gy-.03-dc*.0004+yy,p2.y+rd.y*bw*sd+off.y); vT=t;
        if(grassK){ vS=clamp((col.r-col.g*.8)*6.+.25+.35*r4,0.,1.)*(kind==11.?.5:1.); if(r3<.05) vS=1.3; else if(kind==0.&&r3<.072&&dc<90.) vF=1.+floor(r6*3.); }
        else if(kind==2.) vS=.15*r4;
      }
      if(hgt<=.004) kill=true;
      vCol=col;`)
      .replace('#include <project_vertex>', 'vec4 mvPosition=viewMatrix*vec4(transformed,1.); gl_Position=projectionMatrix*mvPosition; if(kill) gl_Position=vec4(2.,2.,2.,1.);')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition=vec4(transformed,1.);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCol; varying float vT,vS,vF,vB;')
      .replace('#include <map_fragment>', `
        vec3 gc=vCol; float tip=vT*vT; gc=mix(gc,vec3(.2,.16,.075)*(.9+.2*vCol.g*5.),clamp(vS*tip,0.,1.));
        if(vS>1.2&&vT>.82) gc=vec3(.13,.095,.05);
        if(vF>.5&&vT>.9) gc=vF<1.5?vec3(.62,.45,.04):(vF<2.5?vec3(.26,.11,.33):vec3(.7,.68,.6));
        diffuseColor.rgb=gc*(.55+.7*vT)*vB;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=1.;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor=0.;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal=normalize(mat3(viewMatrix)*vec3(0.,1.,0.)); nonPerturbedNormal=normal;');
  };

  // ================= geometry: one node = 32x32 cells, each 3 blades (5 verts) + thatch card =================
  const pos = new Float32Array(NC * NC * VPC * 3), idx = new Uint16Array(NC * NC * (BL * 9 + 6)); let o = 0, oi = 0;
  for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
    const v0 = (j * NC + i) * VPC;
    for (let b = 0; b < BL; b++) { for (let v = 0; v < 5; v++) { pos[o++] = i; pos[o++] = j; pos[o++] = b * 8 + v; } const a = v0 + b * 5; idx.set([a, a + 1, a + 3, a, a + 3, a + 2, a + 2, a + 3, a + 4], oi); oi += 9; }
    for (let v = 0; v < 4; v++) { pos[o++] = i; pos[o++] = j; pos[o++] = BL * 8 + v; } const a = v0 + BL * 5; idx.set([a, a + 1, a + 2, a, a + 2, a + 3], oi); oi += 6;
  }
  const MAXN = 6000, gg = new THREE.InstancedBufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); gg.setIndex(new THREE.BufferAttribute(idx, 1));
  const ia = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 3), 3); ia.setUsage(THREE.DynamicDrawUsage); gg.setAttribute('iPt', ia); gg.instanceCount = 0; gg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const mesh = new THREE.Mesh(gg, mat); mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.visible = false; group.add(mesh);

  // ================= per-frame node selection (quadtree in the view wedge) =================
  const fw = new THREE.Vector3(); let nN = 0; const lodCount = new Int32Array(KMAX + 1);
  let cpx = 0, cpz = 0, fx = 0, fz = 0, noCull = false, cosH = 0, acH = 0;
  function visit(k, ix, iz) {
    const size = P0 * 2 ** k, x0 = ix * size, z0 = iz * size, ddx = Math.max(x0 - cpx, 0, cpx - x0 - size), ddz = Math.max(z0 - cpz, 0, cpz - z0 - size), dmin = Math.hypot(ddx, ddz);
    if (dmin > RFAR) return;
    if (!noCull && dmin > 1) { const vx = x0 + size / 2 - cpx, vz = z0 + size / 2 - cpz, vl = Math.hypot(vx, vz), r = size * .71 + 3 + Math.min(size, 30); if (vl > r && (vx * fx + vz * fz) / vl < Math.cos(Math.min(Math.PI, acH + Math.asin(Math.min(1, r / vl))))) return; }
    const want = Math.floor(Math.log2(Math.max(dmin, D0) / D0));
    if (k === 0 || want >= k) { if (nN < MAXN) { const a = ia.array, oo = nN * 3, s = NC * 2 ** k; a[oo] = ix * s; a[oo + 1] = iz * s; a[oo + 2] = k; nN++; lodCount[k]++; } return; }
    visit(k - 1, ix * 2, iz * 2); visit(k - 1, ix * 2 + 1, iz * 2); visit(k - 1, ix * 2, iz * 2 + 1); visit(k - 1, ix * 2 + 1, iz * 2 + 1);
  }
  function pick(c) {
    const cam = ctx.camera; cam.getWorldDirection(fw); const fl = Math.hypot(fw.x, fw.z); noCull = fl < .3; fx = fw.x / (fl || 1); fz = fw.z / (fl || 1);
    const hv = Math.atan(Math.tan((cam.fov || 70) * Math.PI / 360) * (cam.aspect || 1.78)); cosH = Math.cos(Math.min(Math.PI, hv + .1)); acH = Math.acos(cosH);
    u.uPx.value = 2 * Math.tan((cam.fov || 70) * Math.PI / 360) / Math.max(300, (ctx.renderer?.domElement?.height || 900)) * 1.15;
    cpx = c.x; cpz = c.z; nN = 0; lodCount.fill(0);
    const RS = P0 * 2 ** KMAX, rx = Math.floor(c.x / RS), rz = Math.floor(c.z / RS), rr = Math.ceil(RFAR / RS);
    for (let j = -rr; j <= rr; j++) for (let i = -rr; i <= rr; i++) visit(KMAX, rx + i, rz + j);
    gg.instanceCount = nN; mesh.visible = nN > 0 && LV.every((l) => l.ready); if (nN) { ia.clearUpdateRanges(); ia.addUpdateRange(0, nN * 3); ia.needsUpdate = true; }
  }

  const t0c = performance.now(); let tReady = 0;
  group.userData.stats = () => ({ nodes: nN, perLod: [...lodCount], verts: nN * NC * NC * VPC, grassJobs: queue.length + jobs.size, grassReady: LV.map((l) => l.ready), bakeMs: tReady, workMs: Math.round(workMs), nW: wk.length, mainThread });
  return { group, update() {
    if (!tReady && LV.every((l) => l.ready)) tReady = Math.round(performance.now() - t0c);
    const c = ctx.camera.position; camP.copy(c);
    for (const l of LV) { if (l.busy) continue; const nx = Math.floor(c.x / l.c) - l.N / 2, nz = Math.floor(c.z / l.c) - l.N / 2; if (!l.ready || Math.abs(nx - l.ox) >= l.hs || Math.abs(nz - l.oz) >= l.hs) shift(l, nx, nz, c.x, c.z); }
    pumpJobs();
    if (c.y - S.heightAt(c.x, c.z) > 120) { group.visible = false; return; } group.visible = true;
    pick(c);
  }, idle: () => LV.every((l) => l.ready && !l.busy), stats: () => group.userData.stats() };
}

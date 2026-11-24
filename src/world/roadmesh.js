// Road ribbons (asphalt with procedural markings), streamed per 512 m sector + a continental far ribbon.
import * as THREE from 'three';
import { L } from './textures.js';
import { TERRAIN_COMMON } from './terrain.js';
import { XS, YS, CROWN, herm } from './sampler.js';
export const SS = 512, SOX = -51200, SOZ = -32768, SGX = 200, SGZ = 128;

export function createRoadMaterial(ctx, tex, shared, far) {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, fog: false });
  m.name = far ? 'road-far' : 'road'; m.customProgramCacheKey = () => 'sh-road-' + (far ? 'far' : 'near');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uGA: { value: tex.gA.texture }, uGN: { value: tex.gN.texture }, uWetness: ctx.globals.uWetness, uRain: ctx.globals.uRain, uTime: ctx.globals.uTime, uBioA: shared.uBioA, uBioB: shared.uBioB, uDmg: shared.uDmg, uDmgOrg: shared.uDmgOrg, uSec: shared.uSec });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n attribute vec4 aRd; varying vec4 vRd; varying vec3 vWp; varying vec3 vWn;')
      .replace('#include <project_vertex>', `vec4 wq=modelMatrix*vec4(transformed,1.); float dd0=length(wq.xyz-cameraPosition); wq.y+=clamp((dd0-250.)/1800.,0.,1.)*.45; vec4 mvPosition=viewMatrix*wq; float dd=length(mvPosition.xyz); mvPosition.xyz*=1.-(3.-min(aRd.z,3.))*4e-5; mvPosition.xyz*=1.-clamp((dd-25.)/2600.,0.,1.)*${far ? '.035' : '.022'}; gl_Position=projectionMatrix*mvPosition; vRd=aRd; vWp=(modelMatrix*vec4(transformed,1.)).xyz; vWn=normal;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      precision highp sampler2DArray; precision highp usampler2D; uniform sampler2DArray uGA,uGN; uniform float uWetness,uRain,uTime; varying vec4 vRd; varying vec3 vWp; varying vec3 vWn; ${TERRAIN_COMMON}
      vec3 tN; float tR; float hs(float n){ return fract(sin(n*91.17)*43758.5453); } float hs2(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453); }
      float ln(float x,float c,float w,float aa){ return 1.-smoothstep(w*.5-aa*.5,w*.5+aa*.5+.004,abs(x-c)); }`)
      .replace('#include <map_fragment>', /* glsl */`
      { float u=vRd.x,s=vRd.y,kind=floor(vRd.z+.5),au=abs(u); vec2 p=vWp.xz; float dist=length(vWp-cameraPosition);
      ${far ? 'if(dist<2300.) discard;' : 'if(dist>2350.) discard;'}
      if(vRd.w<(kind>1.5?.15:-.6)&&kind<3.5) discard;
      float hw=kind<.5?10.2:(kind<1.5?5.2:5.); if(kind>1.5&&kind<2.5){ float ds=abs(fract(s/132.+.5)-.5)*132.; if(au>5.05&&(ds<7.6||vRd.w<3.)) discard; }
      float n0=texture(uGA,vec3(p/6.1,${L.dirt}.)).a,n1=texture(uGA,vec3(p/47.,${L.dirt}.)).a,n2=texture(uGA,vec3(p/310.,${L.dirt}.)).a;
      vec4 a=texture(uGA,vec3(p/1.05,${L.asphalt}.)),b=texture(uGN,vec3(p/1.05,${L.asphalt}.)); vec4 a2=texture(uGA,vec3(p.yx/9.7,${L.asphalt}.)); float fd=smoothstep(15.,70.,dist); vec3 c=a.rgb*a.rgb; c=mix(c,a2.rgb*a2.rgb,fd*.6); c=mix(c,vec3(dot(c,vec3(.33))),.6)*vec3(1.55,1.5,1.42); float R=b.b; vec3 nl=vec3((b.rg*2.-1.)*(1.-fd)*.35,1.);
      float age=smoothstep(.36,.58,n2+(n1-.45)*.3); c*=mix(.72,1.28,age)*(.86+.3*n1);
      float mk=0.,yl=0.; float px=max(fwidth(u),.002),ps=max(fwidth(s),.002); float lane=3.7; float lc=0.; float trk=0.;
      if(kind<1.5){
        if(kind<.5){ lc=au-.6; lc=mod(lc,3.7); trk=au>.6&&au<8.?smoothstep(.55,.1,abs(abs(lc-1.85)-.88)):0.; float oil=au>.6&&au<8.?smoothstep(.6,.1,abs(lc-1.85)):0.; c*=1.-.16*oil*age; }
        else { lc=au-1.85+.05; trk=au<3.7?smoothstep(.5,.1,abs(abs(lc)-.86)):0.; c*=1.-.15*smoothstep(.55,.05,abs(lc))*age; }
        c*=1.-trk*(.10+.1*n1); R-=trk*.14;
        // patches
        vec2 pc=vec2(floor(s/13.),step(0.,u)+floor(au/3.7)*2.); float ph=hs2(pc); if(ph>.91&&au<hw-1.4){ vec2 q=vec2(fract(s/13.)*13.,mod(au,3.7)); float l=3.+hs(ph*31.)*8.; float e=min(min(q.x-.6,.6+l-q.x),min(q.y-.35,3.35-q.y)); float pm=smoothstep(0.,.05+ps,e); c=mix(c,c*vec3(.55,.55,.56),pm*.75); c*=1.-.5*(1.-smoothstep(0.,.05+ps,abs(e))); R=mix(R,R-.06,pm); }
        // cracks: transverse + longitudinal, tar sealed
        float cf=smoothstep(.16,.02,max(px,ps)); if(cf>.01&&age>.1){ float w=(n0-.45)*.9+(texture(uGA,vec3(p/1.3,${L.dirt}.)).a-.45)*.35; float cell=floor((s+w)/7.3),cs=abs(fract((s+w)/7.3)-.5)*7.3; float h=hs(cell+kind*17.); float ext=step(au,hw*(.35+h)); float tc=ln(cs,0.,.05+.07*step(.55,h),ps)*step(.38,h)*ext; float lw=u+w*.5; float lj=kind<.5?(ln(abs(lw),4.3+.35,.07,px)+ln(abs(lw),8.25,.08,px)):(ln(lw,.42,.06,px)+ln(abs(lw),3.35,.07,px)); lj*=step(.42,hs(floor(s/31.))); float cr=clamp(tc+lj,0.,1.)*cf*age; c=mix(c,vec3(.018),cr*.85); R=mix(R,.55,cr*.7); }
        // rumble strip
        float rc=kind<.5?8.62:4.15,rw=kind<.5?.34:.3; float rum=smoothstep(rw*.5+px,rw*.5-px,abs(au-rc)); float gr=smoothstep(.2,.05,abs(fract(s/.6)-.5))*smoothstep(.25,.05,ps); c*=1.-rum*gr*.45; nl.y+=rum*smoothstep(.2,.05,ps)*sin(fract(s/.6)*6.283)*.0;
        // markings
        float wear=smoothstep(.22,.5,a.a*.5+n0*.55+n1*.25-trk*.25+.02);
        if(kind<.5){ mk+=ln(au,8.05,.15,px); yl+=ln(au,.62,.14,px); float ds=abs(fract(s/12.2)-.5)*12.2; mk+=ln(au,4.33,.13,px)*smoothstep(1.55+ps*.5,1.55-ps*.5,ds); }
        else { mk+=ln(au,3.62,.12,px); float z=hs(floor(s/420.)+3.); float ds=abs(fract(s/12.2)-.5)*12.2; float dash=smoothstep(1.55+ps*.5,1.55-ps*.5,ds); float L1=ln(u,.11,.11,px),L2=ln(u,-.11,.11,px),C=ln(u,0.,.12,px); yl+=z<.42?C*dash:(z<.6?L1+L2*dash:(z<.78?L2+L1*dash:L1+L2)); }
        if(kind>.5&&vRd.w<9.) { mk*=step(6.,vRd.w); yl*=step(6.,vRd.w); }
        float cv=clamp(px>.35?.6:1.,0.,1.); c=mix(c,vec3(.62,.61,.57)*(.75+.35*a.a),clamp(mk,0.,1.)*wear*.92*cv); c=mix(c,vec3(.56,.36,.045)*(.8+.35*a.a),clamp(yl,0.,1.)*wear*.95*cv); R=mix(R,.62,clamp(mk+yl,0.,1.)*wear);
        // shoulder dirt, ragged gravel edge
        float ed=hw-au; float sh=smoothstep(1.7,0.,ed+(n0-.45)*1.4); float red=texture2D(uBioA,bioUv(p)).b; vec4 gv=texture(uGA,vec3(p/1.3,${L.gravel}.)),gb=texture(uGN,vec3(p/1.3,${L.gravel}.)); vec3 gc=gv.rgb*gv.rgb*mix(vec3(1.),vec3(1.2,.85,.62),red*.75); float gm=smoothstep(.32,-.1,ed+(n0-.45)*1.1+(gv.a-.5)*.4); c=mix(c,gc*.85,sh*.28); c=mix(c,gc*.62,gm); R=mix(R,.92,gm); nl=mix(nl,vec3(gb.rg*2.-1.,1.),gm);
      } else if(kind<2.5){
        if(au>4.98){ vec4 k=texture(uGA,vec3(p/2.7,${L.concrete}.)),kb=texture(uGN,vec3(p/2.7,${L.concrete}.)); c=k.rgb*k.rgb*(.8+.3*n1); R=kb.b; float j=abs(fract(s/1.5)-.5)*1.5; c*=1.-.4*ln(j,0.,.02,ps)*smoothstep(.2,.02,ps); c*=1.-.35*ln(au,5.06,.12,px); }
        else { trk=smoothstep(.6,.1,abs(abs(au-2.3)-.85)); c*=1.-trk*.08; float nd=abs(fract(s/132.+.5)-.5)*132.; yl=(ln(u,.1,.1,px)+ln(u,-.1,.1,px))*step(9.,nd)*.75; float cw=step(5.6,nd)*step(nd,8.4)*step(.5,fract(u/1.1))*.8; mk=cw*smoothstep(.5,.1,px); float wear=smoothstep(.25,.55,a.a*.5+n0*.6+n1*.2); c=mix(c,vec3(.6),mk*wear*.8); c=mix(c,vec3(.55,.36,.05),yl*wear*.8); float pl=smoothstep(.25,.0,abs(au-4.75)); c*=1.-pl*.25; }
      } else { vec4 k=texture(uGA,vec3(s/3.1,vWp.y/3.1+u/3.1,${L.concrete}.)); c=k.rgb*k.rgb*(.75+.3*n1); R=.85; if(kind>3.5) nl=vec3(0.,0.,1.); /* parapets/piers are vertical: the xz-projected asphalt normal map streaked them */ }
      float dm=damageAt(p); c=mix(c,vec3(.13,.09,.06)*(.6+.8*a.a),smoothstep(.2,.7,dm+(n0-.45)*.8)*.75);
      // wet
      float w=uWetness; float hol=smoothstep(.42,.62,n1*.65+n0*.35+trk*.10+smoothstep(1.6,.2,hw-au)*.08); float pud=kind<3.?smoothstep(.45,.95,w*.9+hol*.55-.3)*hol*smoothstep(.25,.55,w):0.; c*=mix(1.,.50,w); R=mix(R,.30,w*.85); nl.xy*=1.-.5*w; c=mix(c,c*.7,pud); R=mix(R,.035,pud); nl.xy*=1.-pud;
      if(uRain>.01&&dist<50.&&w>.2){ vec2 rp=p*3.4; for(int q=0;q<2;q++){ vec2 ic=floor(rp),fc=fract(rp)-.5; float hh=hs2(ic+float(q)*7.); float t=fract(uTime*1.4+hh); vec2 ct=fc-(vec2(hs2(ic+3.1),hs2(ic+9.7))-.5)*.5; float rr=length(ct); float wv=sin((rr-t*.45)*48.)*smoothstep(.085,0.,abs(rr-t*.45))*(1.-t); nl.xy+=ct/(rr+1e-3)*wv*.55*uRain*max(pud,.25*w); rp=rp*1.37+4.7; } }
      vec3 g=normalize(vWn),T=vec3(1.,0.,0.)-g*g.x,B=vec3(0.,0.,1.)-g*g.z; if(dot(T,T)<1e-4) T=cross(B,g); if(dot(B,B)<1e-4) B=cross(g,T); T=normalize(T); B=normalize(B); /* faces with normal exactly +-x/+-z (parapets on N-S/E-W bridges) gave normalize(0)=NaN -> black */ tN=normalize(T*nl.x+B*nl.y+g); tR=clamp(R,.03,1.); diffuseColor.rgb=c; }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=tR;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor=0.;').replace('#include <normal_fragment_maps>', 'normal=normalize(mat3(viewMatrix)*tN);');
  };
  return m;
}

export function createRoads(ctx, S, tex, shared) {
  const data = S.data, seg = data.seg, roads = data.roads, group = new THREE.Group(); group.name = 'roads'; ctx.scene.add(group);
  const mat = createRoadMaterial(ctx, tex, shared, false), matFar = createRoadMaterial(ctx, tex, shared, true);
  // sector -> segments
  const cnt = new Int32Array(SGX * SGZ + 1), secOf = new Int32Array(seg.n).fill(-1);
  for (let i = 0; i < seg.n; i++) { if (roads[seg.R[i]].k > 2 && !seg.B[i]) continue; const x = (seg.S[i * 6] + seg.S[i * 6 + 2]) / 2, z = (seg.S[i * 6 + 1] + seg.S[i * 6 + 3]) / 2, a = Math.floor((x - SOX) / SS), b = Math.floor((z - SOZ) / SS); if (a < 0 || b < 0 || a >= SGX || b >= SGZ) continue; secOf[i] = b * SGX + a; cnt[secOf[i] + 1]++; }
  for (let i = 0; i < SGX * SGZ; i++) cnt[i + 1] += cnt[i]; const ref = new Int32Array(cnt[SGX * SGZ]), pos = cnt.slice(); for (let i = 0; i < seg.n; i++) if (secOf[i] >= 0) ref[pos[secOf[i]]++] = i;
  const tan = (r, i, o) => { const p = r.pts, n = p.length / 2, a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let x = p[b * 2] - p[a * 2], z = p[b * 2 + 1] - p[a * 2 + 1]; const l = Math.sqrt(x * x + z * z) || 1; o.x = x / l; o.z = z / l; };
  const T0 = { x: 0, z: 0 }, T1 = { x: 0, z: 0 };
  let P = [], A = [], NR = [], IX = [];
  function emit(i) {
    const r = roads[seg.R[i]], q = seg.I[i], p = r.pts, k = r.k, xs = XS[k], ys = YS[k], m = xs.length; tan(r, q, T0); tan(r, q + 1, T1); const ax = p[q * 2], az = p[q * 2 + 1], bx = p[q * 2 + 2], bz = p[q * 2 + 3], ya = r.y[q], yb = r.y[q + 1], s0 = r.s[q], s1 = r.s[q + 1];
    const sub = k === 2 ? 4 : 3, base = P.length / 3, L = Math.max(1, s1 - s0), m0 = r.m[q] * L, m1 = r.m[q + 1] * L, sk = k === 2 && r.blk ? 132 / r.blk : 1; // streets: s scaled so intersections fall on the shader's 132 m grid
    for (let t = 0; t <= sub; t++) {
      const f = t / sub, x = ax + (bx - ax) * f, z = az + (bz - az) * f, y = herm(ya, yb, m0, m1, f), dy = (6 * (f * f - f) * (ya - yb) + (3 * f * f - 4 * f + 1) * m0 + (3 * f * f - 2 * f) * m1) / L; let tx = T0.x + (T1.x - T0.x) * f, tz = T0.z + (T1.z - T0.z) * f; const l = Math.sqrt(tx * tx + tz * tz); tx /= l; tz /= l; const s = s0 + (s1 - s0) * f;
      const dkB = seg.B[i]; for (let c = 0; c < m; c++) { const sk = dkB && Math.abs(xs[c]) > r.hw, u = sk ? Math.sign(xs[c]) * (r.hw + .25) : xs[c], X = x - tz * u, Z = z + tx * u; P.push(X, y - CROWN * Math.min(Math.abs(u), r.hw) + (sk ? .015 : ys[c]), Z); /* decks: no skirt into the parapets */ const sl = k < 2 && Math.abs(u) > .1 && Math.abs(u) <= r.hw ? Math.sign(u) * CROWN : 0; NR.push(-tz * sl - tx * dy, 1, tx * sl - tz * dy); A.push(u, s * sk, k, S.otherEdge(X, Z, r.id)); }
      if (t) for (let c = 0; c + 1 < m; c++) { const b = base + (t - 1) * m + c; IX.push(b, b + 1, b + m, b + 1, b + m + 1, b + m); }
    }
    if (seg.B[i]) bridge(r, ax, az, ya, bx, bz, yb, T0, T1, s0, s1, m0, m1);
  }
  function bridge(r, ax, az, ya, bx, bz, yb, t0, t1, s0, s1, m0, m1) { // parapets + deck underside + piers (kind 4), only over the open span
    const L = Math.max(1, s1 - s0), Y = (f) => herm(ya, yb, m0, m1, f), N = 24; let f0 = 2, f1 = -1;
    for (let k = 0; k <= N; k++) { const f = k / N, x = ax + (bx - ax) * f, z = az + (bz - az) * f; if (S.waterLevelAt(x, z) > -1e8 || S.terrainAt(x, z) < Y(f) - 2.5) { if (f < f0) f0 = f; f1 = f; } }
    if (f1 < 0) return; f0 = Math.max(0, f0 - 3 / L); f1 = Math.min(1, f1 + 3 / L);
    const w = r.hw + .25, prof = [[-w - .3, -1.3], [-w - .3, .8], [-w - .1, .8], [-w, .3], [-w, -.2]], quad = (pts, n) => { const b = P.length / 3; for (const v of pts) { P.push(v[0], v[1], v[2]); NR.push(n[0], n[1], n[2]); A.push(v[3], v[4], 4, 99); } IX.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2); };
    const at = (u, y, e) => { const f = e ? f1 : f0; let tx = t0.x + (t1.x - t0.x) * f, tz = t0.z + (t1.z - t0.z) * f; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; return [ax + (bx - ax) * f - tz * u, Y(f) + y, az + (bz - az) * f + tx * u, u + y, s0 + L * f]; };
    for (const sg of [1, -1]) for (let i = 0; i + 1 < prof.length; i++) { const [u0, y0] = prof[i], [u1, y1] = prof[i + 1], nx = (y1 - y0), ny = -(u1 - u0), l = Math.hypot(nx, ny), n = [(-t0.z * -nx * sg) / l, ny / l, (t0.x * -nx * sg) / l]; quad([at(u0 * sg, y0, 0), at(u1 * sg, y1, 0), at(u1 * sg, y1, 1), at(u0 * sg, y0, 1)], n); }
    quad([at(-w - .3, -1.3, 0), at(w + .3, -1.3, 0), at(w + .3, -1.3, 1), at(-w - .3, -1.3, 1)], [0, -1, 0]);
    if ((f1 - f0) * L < 30) return; const fm = (f0 + f1) / 2, pyy = Y(fm);
    for (const u of [-w * .55, w * .55]) { const cx = ax + (bx - ax) * fm - t0.z * u, cz = az + (bz - az) * fm + t0.x * u, g = S.terrainAt(cx, cz) - 4; for (let k = 0; k < 8; k++) { const a0 = k / 8 * 6.2832, a1 = (k + 1) / 8 * 6.2832, R = .75, v = (a, y) => [cx + Math.cos(a) * R, y, cz + Math.sin(a) * R, a, y]; quad([v(a0, g), v(a1, g), v(a1, pyy - 1.3), v(a0, pyy - 1.3)], [Math.cos(a0), 0, Math.sin(a0)]); } }
  }
  const mkGeo = (ox, oz) => { const n = P.length / 3, pa = new Float32Array(P.length); for (let i = 0; i < n; i++) { pa[i * 3] = P[i * 3] - ox; pa[i * 3 + 1] = P[i * 3 + 1]; pa[i * 3 + 2] = P[i * 3 + 2] - oz; } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pa, 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(NR), 3)); g.setAttribute('aRd', new THREE.BufferAttribute(new Float32Array(A), 4)); g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(IX), 1) : new THREE.BufferAttribute(new Uint16Array(IX), 1)); P = []; A = []; NR = []; IX = []; return g; };
  const live = new Map(); let job = null; const R = 2600;
  const keyList = []; let lastC = -1;
  function buildSector(k) { const e = cnt[k + 1]; if (cnt[k] === e) { live.set(k, null); return; } const i = k % SGX, j = (k / SGX) | 0, ox = SOX + (i + .5) * SS, oz = SOZ + (j + .5) * SS; job = { k, q: cnt[k], e, ox, oz }; }
  // far ribbon: all majors, every 2nd point, lifted (only drawn beyond 2.3 km, where terrain LODs are coarse)
  { for (const r of roads) { if (r.k > 1) continue; const p = r.pts, n = p.length / 2, hw = r.hw; let prev = -1; for (let q = 0; ; q += 2) { const i = Math.min(q, n - 1); tan(r, i, T0); const b = P.length / 3; for (const u of [-hw, 0, hw]) { P.push(p[i * 2] - T0.z * u, r.y[i] + .7, p[i * 2 + 1] + T0.x * u); NR.push(0, 1, 0); A.push(u, r.s[i], r.k, 99); } if (prev >= 0) IX.push(prev, prev + 1, b, prev + 1, b + 1, b, prev + 1, prev + 2, b + 1, prev + 2, b + 2, b + 1); prev = b; if (i === n - 1) break; } } const g = mkGeo(0, 0), mesh = new THREE.Mesh(g, matFar); mesh.frustumCulled = false; mesh.receiveShadow = false; mesh.renderOrder = 1; group.add(mesh); }
  function update(budget) {
    const c = ctx.camera.position, t0 = performance.now();
    if (job) { while (job.q < job.e && performance.now() - t0 < budget) { for (let n = 0; n < 6 && job.q < job.e; n++) emit(ref[job.q++]); } if (job.q >= job.e) { const g = mkGeo(job.ox, job.oz); g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.position.set(job.ox, 0, job.oz); m.receiveShadow = true; m.renderOrder = 2; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m); live.set(job.k, m); job = null; } return; }
    const ci = Math.floor((c.x - SOX) / SS), cj = Math.floor((c.z - SOZ) / SS), rr = Math.ceil(R / SS); let best = -1, bd = 1e18;
    for (let j = cj - rr; j <= cj + rr; j++) for (let i = ci - rr; i <= ci + rr; i++) { if (i < 0 || j < 0 || i >= SGX || j >= SGZ) continue; const k = j * SGX + i; if (live.has(k)) continue; const dx = SOX + (i + .5) * SS - c.x, dz = SOZ + (j + .5) * SS - c.z, d = dx * dx + dz * dz; if (d < bd && d < R * R) { bd = d; best = k; } }
    if (best >= 0) buildSector(best);
    else { const cc = cj * SGX + ci; if (cc !== lastC) { lastC = cc; for (const [k, m] of live) { const i = k % SGX, j = (k / SGX) | 0, dx = SOX + (i + .5) * SS - c.x, dz = SOZ + (j + .5) * SS - c.z; if (dx * dx + dz * dz > (R + 900) * (R + 900)) { if (m) { group.remove(m); m.geometry.dispose(); } live.delete(k); } } } }
  }
  const near = (x, z) => { const ci = Math.floor((x - SOX) / SS), cj = Math.floor((z - SOZ) / SS); for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) if (!live.has(j * SGX + i)) return false; return true; };
  return { group, update, near, mat, stats: () => ({ roads: live.size }) };
}

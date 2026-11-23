// Streaming quadtree terrain (CDLOD style morph + skirts) and the splatted ground material.
import * as THREE from 'three';
import { GX, GZ, OX, OZ, CELL, SEC, SX0, SZ0, SNX, SNZ } from './sampler.js';
import { N, NV, genChunk } from './gen.js';
import { dataTex, L } from './textures.js';
import { BOUNDS, toLatLon } from '../core/geo.js';

const ROOT = 131072;
export const TERRAIN_COMMON = /* glsl */`
uniform sampler2D uBioA,uBioB,uDmg; uniform highp usampler2D uSec; uniform vec3 uDmgOrg;
vec2 bioUv(vec2 p){ return vec2((p.x-(${OX}.))/${(CELL * GX).toFixed(1)}+${(.5 / GX).toFixed(8)},(p.y-(${OZ}.))/${(CELL * GZ).toFixed(1)}+${(.5 / GZ).toFixed(8)}); }
float damageAt(vec2 p){ vec2 q=(p-uDmgOrg.xy)/uDmgOrg.z; if(q.x<.004||q.y<.004||q.x>.996||q.y>.996) return 0.; return texture2D(uDmg,q).r; }
`;

export function createTerrainMaterial(ctx, tex, data, shared) {
  const u = {
    uGA: { value: tex.gA.texture }, uGN: { value: tex.gN.texture }, uBioA: shared.uBioA, uBioB: shared.uBioB, uSec: shared.uSec, uDmg: shared.uDmg, uDmgOrg: shared.uDmgOrg, uK: shared.uK, uCamAgl: shared.uCamAgl, uCamG: shared.uCamG,
    uWetness: ctx.globals.uWetness, uRain: ctx.globals.uRain, uTime: ctx.globals.uTime, uWind: ctx.globals.uWind, uGust: ctx.globals.uGust, uSnowA: shared.uSnowA,
  };
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, fog: false });
  m.name = 'terrain'; m.customProgramCacheKey = () => 'sh-terrain-1';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec2 aH; attribute vec4 aNrm; attribute vec4 aRoad; uniform float uK,uCamAgl; uniform vec3 uCamG; varying vec3 vWp; varying vec3 vWn; varying vec4 vRoad; varying float vLod;`)
      .replace('#include <beginnormal_vertex>', `
      float cs=length(modelMatrix[0].xyz); vec3 wp0=(modelMatrix*vec4(position.x,0.,position.z,1.)).xyz; vec3 dq=wp0-uCamG; dq.y=uCamAgl; float dm=length(dq);
      float rg=2.*cs*uK, mf=smoothstep(rg*.62,rg*.97,dm);
      vec2 nn=mix(aNrm.xy,aNrm.zw,mf); vec3 wN=normalize(vec3(nn.x,sqrt(max(.02,1.-dot(nn,nn))),nn.y)); vec3 objectNormal=wN;`)
      .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal=normalize(mat3(viewMatrix)*wN);')
      .replace('#include <begin_vertex>', `vec3 transformed=vec3(position.x,mix(aH.x,aH.y,mf)+position.y*(cs*.035+.4),position.z); vWn=wN; vRoad=aRoad; vLod=cs/${N}.;`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n vWp=(modelMatrix*vec4(transformed,1.)).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      precision highp sampler2DArray; precision highp usampler2D;
      uniform sampler2DArray uGA,uGN; uniform float uWetness,uRain,uTime,uGust; uniform vec2 uWind,uSnowA; varying vec3 vWp; varying vec3 vWn; varying vec4 vRoad; varying float vLod;
      ${TERRAIN_COMMON}
      vec3 tN; float tR,tAO;
      float hN(vec2 p){ return texture(uGA,vec3(p,${L.dirt}.)).a; }
      struct Lay{ vec3 c; vec3 n; float h; };
      Lay lay(float l,vec2 uv,vec2 dx,vec2 dy){ vec4 a=textureGrad(uGA,vec3(uv,l),dx,dy),b=textureGrad(uGN,vec3(uv,l),dx,dy); Lay o; o.c=a.rgb*a.rgb; o.h=a.a; o.n=vec3(b.rg*2.-1.,b.b); return o; }
      void over(inout Lay b,Lay a,float m){ float k=clamp((m-.5)*2.4+.5+(a.h-b.h)*.55*(1.-abs(m*2.-1.)),0.,1.); k=m<=.003?0.:(m>=.997?1.:mix(k,m,.35)); b.c=mix(b.c,a.c,k); b.n=mix(b.n,a.n,k); b.h=mix(b.h,a.h,k); }
      float g_stripe;
      `)
      .replace('#include <map_fragment>', /* glsl */`
      {
      vec2 p=vWp.xz; float dist=length(vWp-cameraPosition); vec2 dx=dFdx(p),dy=dFdy(p);
      vec3 gn=normalize(vWn); float slope=1.-gn.y;
      float n0=hN(p/7.3),n1=hN(p/61.),n2=hN(p/397.+.37),n3=hN(p/2310.+.11); float nm=(n1-.45)*1.4+(n2-.45)*1.6;
      vec2 wq=p+vec2(n2-.45,n3-.45)*420.; vec4 ba=texture2D(uBioA,bioUv(wq)),bb=texture2D(uBioB,bioUv(wq));
      float forest=ba.r,arid=ba.g,red=ba.b,urban=ba.a,swamp=bb.r,mesa=bb.b;
      vec4 rd=vec4(vRoad.x*48.-5.,vRoad.y*48.-5.,vRoad.z*48.-5.,vRoad.w*64.-14.); float fine=1.-smoothstep(5.,9.,vLod);
      float eMaj=mix(99.,rd.x,fine),eStr=mix(99.,rd.y,fine);
      float far=smoothstep(22.,110.,dist);
      // ---- grass base
      float dry=clamp(arid*1.35+.12+(n2-.45)*.9+(n3-.45)*.7-forest*.5-swamp*.5,0.,1.);
      vec2 ug=p/3.1,ug2=p.yx/17.; Lay b; { Lay g=lay(0.,ug,dx/3.1,dy/3.1); if(far>.01){ Lay q=lay(0.,ug2,dx.yx/17.,dy.yx/17.); g.c=mix(g.c,q.c,far*.75); g.h=mix(g.h,q.h,far*.75);} b=g;
        if(dry>.02){ Lay d=lay(1.,ug*.93+.3,dx/3.3,dy/3.3); if(far>.01){ Lay q=lay(1.,ug2*.9+.2,dx.yx/19.,dy.yx/19.); d.c=mix(d.c,q.c,far*.75);} over(b,d,clamp(dry+(n0-.45)*.8,0.,1.)); } }
      b.c*=.80+.42*n1+.35*(n2-.45); b.c=mix(b.c,b.c*vec3(1.10,1.02,.72),clamp((n3-.35)*1.5,0.,1.));
      vec3 soilT=mix(vec3(1.),vec3(1.38,.9,.66),red);
      float natural=1.;
      // ---- bare soil / sand
      float bare=smoothstep(.50,.80,arid*.92+(n1-.45)*.75+(n0-.45)*.35); bare=max(bare,smoothstep(.62,.72,n1*.6+n0*.4+arid*.1)*.45*(1.-forest));
      if(bare>.003){ float sd=smoothstep(.78,.96,arid+(n2-.45)*.5); Lay s=lay(sd>.5?5.:2.,p/3.7,dx/3.7,dy/3.7); if(far>.01){ Lay q=lay(2.,ug2,dx.yx/17.,dy.yx/17.); s.c=mix(s.c,q.c*mix(1.,1.35,sd),far*.7);} s.c*=soilT*(.82+.4*n1); over(b,s,bare); }
      // ---- forest floor / canopy
      float fm=smoothstep(.42,.7,forest+(n1-.45)*.5+(n2-.45)*.6)*(1.-urban);
      if(fm>.003){ Lay f=lay(8.,p/4.1,dx/4.1,dy/4.1); f.c*=.7+.6*n1; f.c=mix(f.c,vec3(.018,.032,.010)*(0.55+1.2*n0+.5*(n1-.4)),smoothstep(500.,2600.,dist)*.85); over(b,f,fm*.92); }
      if(swamp>.05){ Lay f=lay(2.,p/3.,dx/3.,dy/3.); f.c*=vec3(.42,.42,.34); over(b,f,smoothstep(.35,.65,swamp*.8+(n1-.45)*1.1)*.8); }
      // ---- urban lots
      if(urban>.15){ float um=smoothstep(.45,.7,urban*.55+(n0-.45)*.5+(n1-.45)*.8+.12); Lay f=lay(11.,p/5.,dx/5.,dy/5.); f.c*=(.32+.3*n1)*vec3(.95,.93,.9); over(b,f,um*.7*smoothstep(.55,.9,urban)); }
      // ---- farmland
      ivec2 sc=ivec2(floor(p/${SEC}.)); ivec2 si=sc-ivec2(${SX0},${SZ0}); float cropW=0.,gravE=99.,yardE=99.,rowA=0.; g_stripe=0.;
      if(si.x>=0&&si.y>=0&&si.x<${SNX}&&si.y<${SNZ}){
        uvec4 S=texelFetch(uSec,si,0); vec2 lp=p-vec2(sc)*${SEC}.; uint mode=S.r&7u; float H=${SEC / 2}.;
        if(((S.r>>3u)&3u)!=0u) gravE=min(gravE,lp.x); if(((S.r>>5u)&3u)!=0u) gravE=min(gravE,lp.y);
        if(si.x<${SNX - 1}){ uvec4 E=texelFetch(uSec,si+ivec2(1,0),0); if(((E.r>>3u)&3u)!=0u) gravE=min(gravE,${SEC}.-lp.x); }
        if(si.y<${SNZ - 1}){ uvec4 E=texelFetch(uSec,si+ivec2(0,1),0); if(((E.r>>5u)&3u)!=0u) gravE=min(gravE,${SEC}.-lp.y); }
        gravE-=3.6;
        if((S.r&128u)!=0u){ vec2 y=lp-vec2(62.,150.+float(S.a)/255.*480.); float d1=length(y)-34.,d2=max(abs(y.y)-3.2,max(y.x,-lp.x)); yardE=min(d1,d2)+(n0-.45)*7.; }
        if(mode!=0u){
          vec2 e=min(lp,${SEC}.-lp); uint q=0u; vec2 cl=abs(lp-H)+8.; if(mode==2u||mode>=4u){ if(lp.x>H) q+=1u; e.x=min(e.x,cl.x);} if(mode==3u){ if(lp.y>H) q+=1u; e.y=min(e.y,cl.y);} if(mode>=4u){ if(lp.y>H) q+=2u; e.y=min(e.y,cl.y);}
          uint c=((q>1u?S.b:S.g)>>((q&1u)*4u))&15u; float edge=min(e.x,e.y)-11.5; float pd=0.;
          if(mode==5u){ vec2 o=lp-vec2(lp.x>H?H*1.5:H*.5,lp.y>H?H*1.5:H*.5); float d=182.-length(o); if(d>0.){ edge=d; pd=d; } else { c=1u; edge=min(edge,-d);} }
          float fh=fract(float(S.a)*.137+float(q)*.383); float dirq=float((S.a>>q)&1u); vec2 r=dirq>.5?p:p.yx; vec2 rx=dirq>.5?dx:dx.yx,ry=dirq>.5?dy:dy.yx; if(pd>0.){ vec2 o=lp-vec2(lp.x>H?H*1.5:H*.5,lp.y>H?H*1.5:H*.5); r=vec2(length(o),atan(o.y,o.x)*90.); if(abs(o.y)<2.5&&o.x<0.) r.y=r.x; }
          edge+=(n0-.45)*2.2; cropW=smoothstep(-.4,1.2,edge)*smoothstep(13.,16.,eMaj+(n0-.45)*3.)*smoothstep(9.,13.,eStr)*step(1.5,float(c));
          if(cropW>.003){
            float tram=abs(fract(r.x/24.)-.5)*24.; g_stripe=smoothstep(.55,.25,abs(tram-10.))*smoothstep(500.,60.,dist); float band=sin(r.x/12.*3.14159)*smoothstep(3000.,200.,dist);
            Lay f; float rows=smoothstep(140.,30.,dist);
            if(c==2u){ f=lay(0.,r/2.2,rx/2.2,ry/2.2); Lay q2=lay(0.,r/13.,rx/13.,ry/13.); f.c=mix(f.c,q2.c,far*.7)*vec3(.80,1.12,.62)*1.05; f.c*=1.+.05*band; f.n.xy*=.8; }
            else if(c==3u){ f=lay(12.,r/2.4,rx/2.4,ry/2.4); Lay q2=lay(12.,r/14.,rx/14.,ry/14.); f.c=mix(f.c,q2.c,far*.7)*vec3(1.,.96,.84); f.c*=1.+.06*band; }
            else if(c==4u||c==5u){ f=lay(9.,r/3.8,rx/3.8,ry/3.8); vec3 mean=mix(vec3(.052,.085,.024),vec3(.075,.07,.035),.2); f.c=mix(f.c,mix(f.c,mean,.45),far); if(c==5u) f.c=mix(f.c*vec3(1.05,1.12,.95),vec3(.11,.085,.06),.18); else f.c*=vec3(.9,1.02,.85); f.c*=1.+.05*band; }
            else if(c==6u||c==8u){ f=lay(3.,r/3.2,rx/3.2,ry/3.2); Lay q2=lay(2.,r/15.,rx/15.,ry/15.); f.c=mix(f.c,q2.c*.72,far*.6); f.c*=soilT*(.85+.3*n1); if(c==8u){ float rw=abs(fract(r.x/1.6)-.5)*2.; f.c=mix(f.c,vec3(.06,.10,.03),smoothstep(.45,.2,rw+(n0-.45)*.8)*mix(.35,.75,rows)); } f.c*=1.+.06*band; }
            else if(c==7u){ f=lay(0.,r/2.6,rx/2.6,ry/2.6); f.c*=vec3(1.18,1.15,.8); f.c*=1.+.12*sin(r.x/5.*3.14159)*smoothstep(1500.,100.,dist); }
            else { f=lay(1.,r/2.6,rx/2.6,ry/2.6); Lay q2=lay(1.,r/14.,rx/14.,ry/14.); f.c=mix(f.c,q2.c,far*.7); float rw=abs(fract(r.x/.9)-.5)*2.; f.c*=mix(1.,.72+.4*rw,rows)*.92; }
            f.c*=.84+.32*fh; f.c*=.88+.25*n2; f.c=mix(f.c,f.c*vec3(1.15,.95,.8),g_stripe*.0);
            if(g_stripe>.01){ f.c=mix(f.c,vec3(.10,.075,.05)*soilT,g_stripe*.55); }
            over(b,f,cropW); natural*=1.-cropW;
          }
          if(c==1u&&mode!=0u) b.c*=.94+.1*fh;
        }
      }
      // ---- rock on slopes (triplanar)
      float rk=smoothstep(.30,.46,slope+(n0-.45)*.16+(n1-.45)*.10)*(1.-cropW); rk=max(rk,smoothstep(.10,.2,slope)*smoothstep(.35,.75,mesa)*.8); rk*=smoothstep(2.,8.,min(eMaj,eStr)+slope*14.);
      if(rk>.003){ vec3 an=abs(gn); an=pow(an,vec3(4.)); an/=an.x+an.y+an.z; vec3 q=vWp/vec3(9.,7.,9.); vec3 qx=dFdx(q),qy=dFdy(q); Lay r=lay(6.,q.xz,qx.xz,qy.xz); r.c*=an.y; r.n*=an.y; r.h*=an.y;
        if(an.x>.02){ Lay s=lay(6.,q.zy,qx.zy,qy.zy); r.c+=s.c*an.x; r.n+=s.n*an.x; r.h+=s.h*an.x; } if(an.z>.02){ Lay s=lay(6.,q.xy,qx.xy,qy.xy); r.c+=s.c*an.z; r.n+=s.n*an.z; r.h+=s.h*an.z; }
        Lay big=lay(6.,p/83.,dx/83.,dy/83.); r.c*=.55+big.c*2.2; vec3 tint=mix(vec3(.86,.87,.9),vec3(1.45,.86,.58),clamp(max(red*arid*1.5,mesa),0.,1.)); float st=sin(vWp.y*.42+n2*7.)*.5+.5; tint*=mix(1.,.78+.5*st,max(mesa,.25*arid)); r.c*=tint*.92; over(b,r,rk); }
      // ---- beach
      float shore=smoothstep(.62,.53,bb.a)*step(.4,bb.a); float bch=shore*smoothstep(2.4,1.2,vWp.y+(n0-.45)*1.2)*(1.-rk);
      if(bch>.003){ Lay s=lay(5.,p/4.3,dx/4.3,dy/4.3); s.c*=.95+.2*n1; float wt=smoothstep(.75,.15,vWp.y); s.c*=mix(1.,.5,wt); over(b,s,bch); }
      // ---- river banks
      float rv=mix(99.,rd.w,fine); if(rv<26.){ Lay s=lay(2.,p/3.3,dx/3.3,dy/3.3); s.c*=mix(vec3(.62,.6,.55),vec3(1.5,1.35,1.15),smoothstep(.35,.6,n1))*soilT; s.c*=mix(1.,.55,smoothstep(8.,0.,rv)); s.c=mix(s.c,vec3(dot(s.c,vec3(.33))),.4); over(b,s,smoothstep(10.,3.,rv+(n0-.45)*10.+(n1-.4)*8.)*.9); }
      // ---- snow
      float sl=uSnowA.x+uSnowA.y*vWp.z; float sn=smoothstep(0.,70.,vWp.y-sl+(n1-.45)*120.+(n0-.45)*30.-slope*170.); if(sn>.003){ Lay s=lay(7.,p/5.,dx/5.,dy/5.); over(b,s,sn); }
      // ---- gravel roads, yards, shoulders
      float gm=0.,trk=0.; float gE=gravE+(n0-.45)*.8; gE=max(gE,min(0.,0.)); float aaw=max(.35,length(vec2(length(dx),length(dy)))*.6); gm=smoothstep(aaw,-aaw,gE)*smoothstep(1.,6.,min(eMaj,eStr)+3.); trk=(smoothstep(.55,.2,abs(abs(gravE+3.6)-.95)));
      float ym=smoothstep(1.5,-1.5,yardE); float sm=smoothstep(.9,-.1,eMaj+(n0-.45)*1.2)*step(eMaj,50.); float gg=max(max(gm,ym*.95),sm);
      if(gg>.003){ Lay s=lay(4.,p/1.6,dx/1.6,dy/1.6); if(far>.01){ Lay q=lay(4.,p.yx/11.,dx.yx/11.,dy.yx/11.); s.c=mix(s.c,q.c,far*.7);} s.c*=.75; s.c=mix(s.c,s.c*mix(vec3(1.),vec3(1.2,.85,.62),red*.75),.85); s.c*=.8+.35*n1; s.c*=mix(1.,1.16,trk*gm*smoothstep(200.,40.,dist)); s.c*=1.-.25*smoothstep(-1.2,-.2,gravE)*gm; over(b,s,gg); natural*=1.-gg; }
      // ---- tornado damage swath
      float dm=damageAt(p); if(dm>.02){ float dn=dm+(n0-.45)*.35+(n1-.45)*.3; float sw=smoothstep(.22,.62,dn); Lay s=lay(2.,p/4.7,dx/4.7,dy/4.7); s.c*=soilT*vec3(.72,.68,.62)*(.8+.5*n0); b.c=mix(b.c,mix(b.c,b.c*vec3(.95,.82,.62),.8),smoothstep(.05,.3,dn)); over(b,s,sw*.92); }
      // ---- wetness
      float poro=.55; float w=uWetness; vec3 c=b.c; float R=clamp(b.n.z,0.04,1.); float flatN=smoothstep(.02,.004,slope);
      float low=1.-b.h; float pud=smoothstep(.62,.95,w*.75+low*.25+(n1-.45)*1.2+(n0-.45)*.6)*smoothstep(.3,.6,w)*flatN*max(max(gm*.9,ym),max(.35*(1.-natural),.16)); pud*=1.-smoothstep(60.,220.,dist)*.6;
      c*=mix(1.,.56,w*poro*1.1); R=mix(R,R*.62,w*.75); vec3 nl=vec3(b.n.xy*(1.-.75*smoothstep(30.,160.,dist)),1.);
      if(pud>.003){ c=mix(c,c*.55,pud); R=mix(R,.05,pud); nl.xy*=1.-pud; if(uRain>.01&&dist<45.){ vec2 rp=p*3.2; vec2 ic=floor(rp),fc=fract(rp)-.5; float hh=fract(sin(dot(ic,vec2(12.9898,78.233)))*43758.5453); float t=fract(uTime*1.35+hh); float rr=length(fc-(hh-.5)*.4); float wv=sin((rr-t*.5)*46.)*smoothstep(.09,0.,abs(rr-t*.5))*(1.-t); nl.xy+=normalize(fc+1e-4)*wv*.5*pud*uRain; } }
      // world normal from local detail (x,z plane)
      vec3 T=normalize(vec3(1.,0.,0.)-gn*gn.x),Bt=cross(gn,T); Bt=-Bt; tN=normalize(T*nl.x-Bt*0.+ normalize(vec3(0.,0.,1.)-gn*gn.z)*nl.y+gn*nl.z*1.05);
      tR=R; tAO=mix(1.,.55+.55*b.h,.6*smoothstep(150.,20.,dist)); diffuseColor.rgb=c*tAO;
      }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=tR;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor=0.;')
      .replace('#include <normal_fragment_maps>', 'normal=normalize(mat3(viewMatrix)*tN);');
  };
  return m;
}

export function createTerrain(ctx, S, pool, mat, shared) {
  const K = { low: 1.15, medium: 1.5, high: 1.9, ultra: 2.5 }[ctx.quality.id] || 1.6, MINS = ctx.quality.id === 'low' ? 128 : 64; shared.uK.value = K;
  const group = new THREE.Group(); group.name = 'terrain'; ctx.scene.add(group);
  // shared grid + index
  const total = NV * NV + 4 * NV, grid = new Float32Array(total * 3); let o = 0;
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) { grid[o++] = i / N; grid[o++] = 0; grid[o++] = j / N; }
  for (let e = 0; e < 4; e++) for (let i = 0; i < NV; i++) { grid[o++] = e < 2 ? i / N : e === 2 ? 0 : 1; grid[o++] = -1; grid[o++] = e < 2 ? e : i / N; }
  const idx = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * NV + i, b = a + 1, c = a + NV, d = c + 1; if (((i & 1) ^ (j & 1)) === 0) idx.push(a, c, b, b, c, d); else idx.push(a, c, b, b, c, d); }
  const s0 = NV * NV; for (let i = 0; i < N; i++) {
    const t = i, t2 = i + 1, st = s0 + i, b = N * NV + i, sb = s0 + NV + i, l = i * NV, sl = s0 + 2 * NV + i, r = i * NV + N, sr = s0 + 3 * NV + i;
    idx.push(t, t2, st, t2, st + 1, st, b, sb, b + 1, b + 1, sb, sb + 1, l, sl, l + NV, l + NV, sl, sl + 1, r, r + NV, sr, r + NV, sr + 1, sr);
  }
  const posAttr = new THREE.BufferAttribute(grid, 3), index = new THREE.BufferAttribute(new Uint16Array(idx), 1);
  const free = []; let live = 0, cacheN = 0; const pending = new Set(); let frame = 0;
  const mkNode = (x, z, size) => ({ x, z, size, kids: null, mesh: null, req: 0, used: 0, min: -50, max: 400, has: false });
  const root = mkNode(-ROOT / 2, -ROOT / 2, ROOT); const all = [];
  const onChunk = (n, r) => {
    pending.delete(n); n.req = 0; if (!r) return; let m = free.pop();
    if (!m) { const g = new THREE.BufferGeometry(); g.setAttribute('position', posAttr); g.setIndex(index); g.setAttribute('aH', new THREE.BufferAttribute(r.h, 2)); g.setAttribute('aNrm', new THREE.BufferAttribute(r.nrm, 4, true)); g.setAttribute('aRoad', new THREE.BufferAttribute(r.road, 4, true)); g.boundingSphere = new THREE.Sphere(); m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.visible = false; group.add(m); }
    else { const g = m.geometry; g.attributes.aH.array = r.h; g.attributes.aH.needsUpdate = true; g.attributes.aNrm.array = r.nrm; g.attributes.aNrm.needsUpdate = true; g.attributes.aRoad.array = r.road; g.attributes.aRoad.needsUpdate = true; }
    const g = m.geometry, hy = (r.min + r.max) / 2; g.boundingSphere.center.set(.5, hy, .5); // scaled by matrix (max scale = size)
    g.boundingSphere.radius = Math.max(.75, Math.hypot(.71, (r.max - r.min) / 2 / n.size + .05)); m.matrix.makeScale(n.size, 1, n.size); m.matrix.setPosition(n.x, 0, n.z); m.matrixWorld.copy(m.matrix); m.matrixWorldNeedsUpdate = false;
    n.mesh = m; n.has = true; n.min = r.min; n.max = r.max; cacheN++; all.push(n);
  };
  const request = (n, pri) => { if (n.req || n.has || pending.size > 26) return; n.req = 1; pending.add(n); pool.request('chunk', { x: n.x, z: n.z, size: n.size }, pri, (r) => onChunk(n, r), () => genChunk(S, n.x, n.z, n.size)); };
  const cam = { x: 0, z: 0, agl: 0 }; let drawn = 0, missing = 0;
  const distTo = (n) => { const dx = Math.max(n.x - cam.x, 0, cam.x - n.x - n.size), dz = Math.max(n.z - cam.z, 0, cam.z - n.z - n.size); return Math.sqrt(dx * dx + dz * dz + cam.agl * cam.agl); };
  function visit(n, d) { // returns true if node area is fully covered
    n.used = frame; const want = n.size > MINS && d < n.size * K;
    if (want) {
      if (!n.kids) { const h = n.size / 2; n.kids = [mkNode(n.x, n.z, h), mkNode(n.x + h, n.z, h), mkNode(n.x, n.z + h, h), mkNode(n.x + h, n.z + h, h)]; }
      let ok = true; const ks = n.kids;
      for (let i = 0; i < 4; i++) { const k = ks[i]; k.d = distTo(k); if (!covered(k)) { ok = false; request(k, k.d + k.size); } }
      if (ok || !n.has) { for (let i = 0; i < 4; i++) visit(ks[i], ks[i].d); return; }
      for (let i = 0; i < 4; i++) warm(ks[i]);
    }
    if (n.has) { n.mesh.visible = true; drawn++; } else { missing++; if (n.size <= 16384 || !n.kids) request(n, d); }
  }
  // a node can be shown if it has a mesh, or it must split and every kid is covered
  function covered(n) { if (n.has) return true; return false; }
  function warm(n) { n.used = frame; if (n.size > MINS && n.d < n.size * K && n.has && n.kids) for (let i = 0; i < 4; i++) { const k = n.kids[i]; k.d = distTo(k); k.used = frame; if (!k.has) request(k, k.d + k.size); } else if (n.size > MINS && n.d < n.size * K && n.has) { const h = n.size / 2; n.kids = [mkNode(n.x, n.z, h), mkNode(n.x + h, n.z, h), mkNode(n.x, n.z + h, h), mkNode(n.x + h, n.z + h, h)]; } }
  const maxCache = { low: 420, medium: 560, high: 800, ultra: 1100 }[ctx.quality.id] || 600;
  function update() {
    frame++; const p = ctx.camera.position; cam.x = p.x; cam.z = p.z; const g = S.heightAt(p.x, p.z); cam.agl = Math.max(0, p.y - g); shared.uCamAgl.value = cam.agl; shared.uCamG.value.set(p.x, g, p.z);
    for (let i = 0; i < all.length; i++) all[i].mesh.visible = false; drawn = missing = 0; visit(root, distTo(root));
    if (cacheN > maxCache && frame % 10 === 0) { // evict oldest unused
      let w = 0; for (let i = 0; i < all.length; i++) { const n = all[i]; if (n.used < frame - 240 && cacheN > maxCache * .9) { n.mesh.visible = false; free.push(n.mesh); n.mesh = null; n.has = false; cacheN--; } else all[w++] = n; } all.length = w;
    }
  }
  return { group, update, stats: () => ({ drawn, missing, cached: cacheN, pending: pending.size }), idle: () => missing === 0 && pending.size === 0 };
}
export function snowUniform() { const a = toLatLon(0, 0).lat, b = toLatLon(0, 1000).lat; return new THREE.Vector2(640 - (a - 37) * 30, -(b - a) * 30 / 1000); }

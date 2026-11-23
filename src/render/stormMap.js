// 2.5D storm fields: (a) cloud map  M0 = deck base, deck top, coverage, rain   M1 = anvil bottom, anvil top, anvil density, green tint
//                    (b) sun cloud-shadow map  R = sun transmittance at ground level, G = sky openness above
import * as THREE from 'three';
import { HEAD } from './glsl.js';
import { fsMaterial, draw, hdrRT } from './pass.js';

export const NS = 5;
export const MAP_SIZE = 64000, CS_SIZE = 44000;

export const STORM_UNI = /* glsl */`
#define NS ${NS}
uniform int uNS;
uniform vec4 uStA[NS]; // centre x,z, radius, seed
uniform vec4 uStB[NS]; // base y, top y, intensity, rotation
uniform vec4 uStC[NS]; // meso x,z,r, type(0 supercell 1 squall 2 shower)
uniform vec4 uStD[NS]; // downwind x,z, rain rate, hail
uniform vec4 uStE[NS]; // rain x,z,r, meso rotation angle
uniform vec4 uStW[NS]; // wall cloud x,z,r,drop
`;
// tower signed distance (m, negative inside), before noise
export const TOWER_GLSL = /* glsl */`
float towerSd(int i, vec3 p, out vec2 rel){
  vec4 A=uStA[i],B=uStB[i],C=uStC[i],D=uStD[i];
  float s=(p.y-B.x)/(B.y-B.x); float ss=clamp(s,-.1,1.1);
  vec2 c=C.xy+D.xy*(ss*ss*.16+ss*.10)*A.z; rel=p.xz-c; float r=length(rel);
  float R=A.z*(C.w>1.5?.46:.45)*(.60+.40*smoothstep(-.02,.34,ss)-.10*smoothstep(.45,.75,ss)+.22*smoothstep(.72,.98,ss));
  R=max(R,C.z*1.08);
  float topY=B.y*1.03-(B.y-B.x)*.16*(r*r)/(R*R);
  float d=max(r-R, p.y-topY); d=max(d, B.x-p.y+540.);
  return d;
}
`;

const MAP = HEAD + STORM_UNI + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
uniform sampler3D uBase; uniform vec4 uXf; uniform float uTime,uCu,uGround; uniform vec2 uDrift; uniform float uCuBase;
float smin(float a,float b,float k){ float h=max(k-abs(a-b),0.)/k; return min(a,b)-h*h*k*.25; }
float seg(vec2 p,vec2 a,vec2 b){ vec2 d=b-a; float h=sat(dot(p-a,d)/max(dot(d,d),1.)); return length(p-a-d*h); }
vec2 rot(vec2 v,float a){ float c=cos(a),s=sin(a); return vec2(c*v.x-s*v.y,s*v.x+c*v.y); }
vec4 N(vec2 p,float L,float z){ return textureLod(uBase,vec3(p/L,z).xzy,0.); }
// continuous union of height intervals (no vertical walls between 'present' and 'absent')
void uni(inout float zb,inout float zt,inout float th,inout float cov,float sb,float st,float dens){
  float t2=st-sb, k=sat((t2-th)/500.+.5), pr=smoothstep(0.,260.,min(t2,th));
  zb=mix(mix(zb,sb,k),smin(zb,sb,200.),pr); zt=mix(mix(zt,st,k),max(zt,st),pr); cov=mix(cov,dens,k); th=zt-zb;
}
void main(){
  vec2 p=uXf.xy+(vUv-.5)*uXf.z;
  vec4 wA=N(p,11000.,.13), wB=N(p-uDrift*.5,4200.,.47), wC=N(p-uDrift,1700.,.71);
  float warp=(wA.a-.5)*1500.+(wB.a-.5)*620.+(wC.a-.5)*180.;
  // fair-weather cumulus field
  float cell=N(p-uDrift,9500.,.37).r*.55+N(p-uDrift,5200.,.62).g*.75+wC.g*.16;
  float cuT=(cell-(1.22-.62*uCu))*3000.; float zb=uCuBase, zt=uCuBase-5000.; float cov=.8; float rain=0., green=0.;
  float ab=13000.,at=5000.,ad=0.; float bestTh=zt-zb, fm=1e5;
  for(int i=0;i<uNS;i++){
    vec4 A=uStA[i],B=uStB[i],C=uStC[i],D=uStD[i],E=uStE[i],W=uStW[i];
    vec2 dir=D.xy, rgt=vec2(-dir.y,dir.x); vec2 v=p-C.xy; float a=dot(v,dir), b=dot(v,rgt); float r=length(v);
    float f, sb=B.x, dens=1., rr=0., H=(B.y-B.x);
    if(C.w<.5){
      vec2 q=p-E.xy; float e1=length(q-dir*dot(q,dir)*.25)-E.z*1.25;
      f=smin(e1, seg(p,C.xy,E.xy)-C.z*1.05, 1400.);
      f=smin(f, r-C.z*2.05, 1100.); f=smin(f, length(p-A.xy)-A.z*.42, 1500.);
      // flanking line: stepped towers trailing to the rear-right
      vec2 fl=C.xy-dir*A.z*.75+rgt*A.z*.62; float fs=seg(p,C.xy,fl)-A.z*.10; f=smin(f,fs,700.);
      // beaver tail / inflow band toward the forward-right flank
      vec2 bt=C.xy+(dir*.75+rgt*.75)*C.z*3.2; float bd=seg(p+vec2(wB.a-.5)*420.,C.xy,bt)-200.; f=smin(f,bd,380.);
      f+=warp;
      float mesoW=smoothstep(C.z*1.35,C.z*.25,r);
      // relief
      float lumps=(wC.g-.5)*130.+(N(p-uDrift,760.,.23).g-.5)*70.;
      vec2 rv=rot(v,E.w); float th=atan(v.y,v.x);
      float band=sin(r/210.+th*2.+E.w*2.+(N(rv,3000.,.31).a-.5)*7.);
      float bandW=smoothstep(C.z*2.4,C.z*.9,r)*smoothstep(C.z*.15,C.z*.5,r);
      sb+=lumps*(1.-.45*mesoW)+band*34.*bandW*B.w-mesoW*110.*B.w;
      sb+=smoothstep(-500.,900.,f)*380.;
      // RFD clear slot
      float al=atan(b,a); // 0 fwd, +90 right, 180 rear
      float ap=al<-1.2?al+2.*PI:al; float u=(3.7-ap)/3.2; float rc=mix(1.45,.72,sat(u))*C.z; float w=mix(.44,.15,sat(u))*C.z;
      float slot=smoothstep(w*1.15,w*.2,abs(r+(wC.a-.5)*260.-rc))*smoothstep(-.05,.18,u)*smoothstep(1.05,.8,u)*smoothstep(.45,.85,B.w)*B.z;
      sb+=slot*330.; dens*=1.-.55*slot;
      // wall cloud + tail cloud
      if(W.w>1.){
        vec2 wv=p-W.xy; float rw=length(wv); vec2 rwv=rot(wv,E.w*3.); float nw=N(rwv,1500.,.83).g*.6+N(rwv,620.,.2).g*.5-.5;
        float ww=smoothstep(W.z*1.2,W.z*.62,rw*(1.+.5*nw));
        vec2 tdir=normalize(E.xy-C.xy+1.); vec2 te=W.xy+tdir*W.z*2.6; float td=seg(p+vec2(nw)*120.,W.xy,te); float tl=sat(dot(p-W.xy,tdir)/(W.z*2.6));
        float tail=smoothstep(mix(W.z*.42,90.,tl),20.,td)*.72*smoothstep(1.02,.7,tl);
        sb-=W.w*max(ww*(1.+.16*nw),tail); dens=max(dens,max(ww,tail)); slot*=1.-ww;
      }
      // precipitation core + hook
      float rd=length(q-dir*dot(q,dir)*.22)+warp*.45; rr=smoothstep(E.z*1.12,E.z*.28,rd);
      float hk=al>2.2?al-2.*PI:al; float hu=(-.5-hk)/3.4; float hrc=mix(1.75,1.28,sat(hu))*C.z;
      float hook=smoothstep(C.z*.5,C.z*.1,abs(r+(wC.a-.5)*320.-hrc))*smoothstep(-.06,.12,hu)*smoothstep(1.,.45,hu)*B.w;
      rr=max(rr,hook*.5)*D.z;
      float steep=2.2;
      float st=B.x+clamp(-f*steep,-3500.,H*.6)+(wB.g-.5)*260.; float fls=smoothstep(350.,-250.,fs+warp*.6); st=mix(st,max(st,B.x+min(H*.38,fls*1200.+clamp(-fs,0.,900.)*2.4+(wB.g-.4)*2400.)),fls);
      st=mix(st,min(st,max(B.x+700.,sb+250.)),slot*.8);
      uni(zb,zt,bestTh,cov,sb,st,dens);
    } else if(C.w<1.5){
      vec2 v2=p-A.xy; float ld=dot(v2,dir), al=dot(v2,rgt); float L=A.z*1.7; float bow=-al*al/(L*2.2)+warp*.5; ld-=bow;
      f=max(max(ld-1500.,-ld-6500.),abs(al)-L);
      float sh=smoothstep(1700.,1250.,ld)*smoothstep(-700.,200.,ld)*smoothstep(L,L*.75,abs(al));
      float tier=sh*(.75+.25*sin(ld/130.+warp*.006));
      sb+=(wC.g-.5)*180.*(1.-sh)-tier*470.*B.z+smoothstep(0.,-1800.,ld)*120.;
      float st=min(sb+90.+max(0.,1500.-ld)*.5, B.x+H*.62); st=min(st,B.x+clamp(-f*1.7,-3500.,H*.62));
      rr=smoothstep(150.,-900.,ld)*smoothstep(-5600.,-2500.,ld)*smoothstep(L,L*.8,abs(al))*(.65+.5*wB.r)*D.z;
      uni(zb,zt,bestTh,cov,sb,st,1.);
    } else {
      f=length(p-A.xy)-A.z*.5+warp*.8; sb+=(wC.g-.5)*150.+smoothstep(-400.,600.,f)*200.;
      float st=B.x+clamp(-f*2.,-3500.,H*.5)+(wB.g-.5)*500.; rr=smoothstep(E.z*1.1,E.z*.3,length(p-E.xy)+warp*.4)*D.z;
      uni(zb,zt,bestTh,cov,sb,st,1.);
    }
    fm=min(fm,f); rain=max(rain,rr); green=max(green,rr*D.w+smoothstep(2500.,0.,f)*D.w*.45);
    // anvil
    if(C.w<1.5||B.y-B.x>6000.){
      vec2 va=p-(C.w<.5?C.xy:A.xy); float aa=dot(va,dir), bb=dot(va,rgt); float big=C.w<.5?1.:1.25;
      float La=aa>0.?A.z*3.6:A.z*.95; float x=aa/La; float wd=A.z*(C.w<.5?1.15:2.1)*(1.+.75*sat(x)); float rr2=length(vec2(x,bb/wd));
      vec2 fib=vec2(aa*.22,bb); float fn=(N(fib+A.w*777.,7000.,.11).a-.5)*.34+(N(fib,2300.,.55).a-.5)*.13;
      float g=1.-rr2*big+fn; float th=smoothstep(0.,.42,g);
      float lob=N(p,5200.,.9).g*.75+N(p,2300.,.44).g*.3; float mam=smoothstep(.36,.80,lob)*420.*smoothstep(.08,.4,g)*smoothstep(.02,.3,x+.55);
      float nt=B.y*.95+120.*(wB.a-.5); float Th=320.*smoothstep(0.,.10,g)+1450.*th-max(-g,0.)*A.z*.55; float nb=nt-Th-mam;
      float ath=at-ab, k=sat((Th-ath)/500.+.5); ab=mix(ab,nb,k); at=mix(at,nt,k); ad=mix(ad,th,k);
    }
  }
  uni(zb,zt,bestTh,cov,uCuBase,uCuBase+cuT-smoothstep(3800.,-100.,fm)*4200.,.8);
  o0=vec4(zb,zt,cov,rain*smoothstep(-250.,350.,zt-zb)); o1=vec4(ab,at,ad,sat(green));
}`;

const SHADOW = HEAD + STORM_UNI + TOWER_GLSL + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uM0,uM1,uPrev; uniform vec4 uXf,uCsXf2,uPrevXf; uniform vec3 uSunDir; uniform float uGround,uJit,uBlend;
void main(){
  vec2 g=uCsXf2.xy+(vUv-.5)/uCsXf2.z; vec3 ro=vec3(g.x,uGround,g.y);
  float od=0.,ov=0.; float j=fract(ign(gl_FragCoord.xy)+uJit);
  vec3 L=uSunDir; float tMax=min(13500./max(L.y,.02),46000.); const int N=34; float tp=0.;
  for(int k=0;k<N;k++){ float f=(float(k)+j)/float(N); float t=tMax*pow(f,1.35); float dt=max(t-tp,1.); tp=t; vec3 p=ro+L*t;
    vec2 uv=(p.xz-uXf.xy)/uXf.z+.5; if(any(lessThan(uv,vec2(.005)))||any(greaterThan(uv,vec2(.995)))) break;
    vec4 a=textureLod(uM0,uv,0.), b=textureLod(uM1,uv,0.);
    float d=max(a.x-p.y,p.y-a.y); float s=smoothstep(120.,-260.,d)*a.z*.0045; s+=a.w*.0006*step(p.y,a.x);
    d=max(b.x-p.y,p.y-b.y); s+=smoothstep(60.,-300.,d)*b.z*.0011;
    for(int i=0;i<uNS&&i<4;i++){ if(uStC[i].w>.5&&uStC[i].w<1.5) continue; vec2 rel; float td=towerSd(i,p,rel); s+=smoothstep(200.,-500.,td)*.006; }
    od+=s*dt; }
  // vertical openness
  { vec2 uv=(g-uXf.xy)/uXf.z+.5; vec4 a=textureLod(uM0,uv,2.),b=textureLod(uM1,uv,2.); ov=smoothstep(-200.,1500.,a.y-a.x)*a.z*.9; ov=1.-(1.-ov)*(1.-.45*b.z*step(b.x,b.y)); ov=max(ov,a.w*.6); }
  vec4 r=vec4(exp(-od),1.-ov,0.,1.);
  vec2 pu=(g-uPrevXf.xy)*uPrevXf.z+.5; float ok=step(abs(pu.x-.5),.49)*step(abs(pu.y-.5),.49);
  o=mix(r,textureLod(uPrev,pu,0.),uBlend*ok);
}`;

export class StormMap {
  constructor(renderer, noise, stormU, size = 1024) {
    this.r = renderer;
    this.rt = hdrRT(size, size, { count: 2 });
    this.cs = [hdrRT(512, 512), hdrRT(512, 512)];
    this.csTex = { value: this.cs[0].texture };
    this.xf = new THREE.Vector4(0, 0, MAP_SIZE, 0); this.csXf = new THREE.Vector4(0, 0, 1 / CS_SIZE, 0); this.csPrevXf = new THREE.Vector4(0, 0, 1 / CS_SIZE, 0);
    this.csSunXf = new THREE.Vector4(0, 0, 0, 0);
    this.mMap = fsMaterial(MAP, { ...stormU, uBase: { value: noise.base }, uXf: { value: this.xf }, uTime: { value: 0 }, uCu: { value: 0.4 }, uGround: { value: 0 }, uDrift: { value: new THREE.Vector2() }, uCuBase: { value: 1600 } });
    this.mCs = fsMaterial(SHADOW, { ...stormU, uM0: { value: this.rt.textures[0] }, uM1: { value: this.rt.textures[1] }, uPrev: { value: null }, uXf: { value: this.xf }, uCsXf2: { value: this.csXf }, uPrevXf: { value: this.csPrevXf }, uSunDir: { value: new THREE.Vector3() }, uGround: { value: 0 }, uJit: { value: 0 }, uBlend: { value: 0 } });
    this.mCopy = fsMaterial(HEAD + 'in vec2 vUv; out vec4 o; uniform sampler2D uT; void main(){ o=textureLod(uT,vUv,0.); }', { uT: { value: this.cs[1].texture } });
    this.first = true;
  }
  update(cam, time, ground, sunDir, cu, frame, reset) {
    const snap = MAP_SIZE / this.rt.width * 4;
    this.xf.x = Math.round(cam.x / snap) * snap; this.xf.y = Math.round(cam.z / snap) * snap;
    const u = this.mMap.uniforms; u.uTime.value = time; u.uCu.value = cu; u.uGround.value = ground; u.uDrift.value.set(time * 7, time * -2.2); u.uCuBase.value = ground + 1500;
    draw(this.r, this.mMap, this.rt);
    const s = this.mCs.uniforms, sc = CS_SIZE / 512 * 2;
    this.csPrevXf.copy(this.csXf); this.csXf.x = Math.round(cam.x / sc) * sc; this.csXf.y = Math.round(cam.z / sc) * sc;
    s.uSunDir.value.copy(sunDir); s.uGround.value = ground; s.uJit.value = (frame * 0.61803) % 1; s.uBlend.value = this.first || reset ? 0 : 0.92;
    s.uPrev.value = this.cs[0].texture; draw(this.r, this.mCs, this.cs[1]); draw(this.r, this.mCopy, this.cs[0]); // cs[0] is the stable, publicly bound texture
    this.first = false;
  }
}

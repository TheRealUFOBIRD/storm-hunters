// Volumetric raymarch: storm clouds, anvils, rain, tornado funnels and dust; temporal resolve
import * as THREE from 'three';
import { HEAD, DEPTH_GLSL, SKY_GLSL } from './glsl.js';
import { fsMaterial, draw, hdrRT } from './pass.js';
import { STORM_UNI, TOWER_GLSL } from './stormMap.js';

export const NT = 4, PROF_N = 96;

export const TORNADO_UNI = /* glsl */`
#define NT ${NT}
uniform int uNT;
uniform vec4 uT0[NT]; // x,z,ground y,lcl
uniform vec4 uT1[NT]; // mean funnel R, bound R, vmax, roughness
uniform vec4 uT2[NT]; // dustR, dust, dust height, accumulated rotation
uniform vec4 uT3[NT]; // dust colour, seed
uniform vec4 uT4[NT]; // rCore, upward advection (m), spin, multi-vortex 0..1
uniform vec4 uSub[NT*4]; // angle, orbit r, strength, core radius
uniform float uSubPh[NT*4]; // sub-vortex spin phase, integrated on the CPU (time*rate jumped whenever the rate changed)
uniform sampler2D uTProf; // x: height 0..1.25 lcl ; y: tornado.  axis dx, axis dz, radius, flare
`;

const VOL = HEAD + DEPTH_GLSL + SKY_GLSL + STORM_UNI + TOWER_GLSL + TORNADO_UNI + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
uniform sampler2D uDepth,uM0,uM1,uCs,uBlue; uniform sampler3D uBase,uDetail;
uniform vec4 uDepthK,uXf,uCsXf; uniform vec2 uRes,uJit,uFRes; uniform float uLMode,uPar; uniform mat4 uInvVP; uniform vec3 uCam,uFwd,uSunDir,uSunE,uSunEHigh,uGroundRad;
uniform float uTime,uFrame,uGround,uTop,uPix,uQual,uStormDark,uMode,uRainSig; uniform int uSteps,uLSteps; uniform vec2 uDrift;
uniform vec4 uFlash[4]; uniform vec3 uFlashCol; uniform int uNF; uniform vec4 uClip; // camera-inside hints
const float MAXD=46000.;
float Bz; float gFp=1.; // pixel footprint (m) at the current sample: fades sub-pixel erosion that would only read as foam
vec2 rot2(vec2 v,float a){ float c=cos(a),s=sin(a); return vec2(c*v.x-s*v.y,s*v.x+c*v.y); }
float smin(float a,float b,float k){ float h=max(k-abs(a-b),0.)/k; return min(a,b)-h*h*k*.25; }
float hg(float c,float g){ float g2=g*g; return (1.-g2)/(4.*PI*pow(1.+g2-2.*g*c,1.5)); }
vec4 nB(vec3 p,float L,float lod){ return textureLod(uBase,p/L,lod); }
vec4 nD(vec3 p,float L,float lod){ return textureLod(uDetail,p/L,lod); }
void maps(vec2 xz,out vec4 m0,out vec4 m1){
  vec2 uv=(xz-uXf.xy)/uXf.z+.5; vec2 e=abs(uv-.5);
  if(max(e.x,e.y)>.497){ m0=vec4(6000.,0.,0.,0.); m1=vec4(14000.,0.,0.,0.); } else { m0=textureLod(uM0,uv,0.); m1=textureLod(uM1,uv,0.); }
}
vec2 cloudSun(vec3 p){
  vec3 g=p-uSunDir*((p.y-uGround)/max(uSunDir.y,.03)); vec2 uv=(g.xz-uCsXf.xy)*uCsXf.z+.5; vec2 e=abs(uv-.5);
  return mix(vec2(1.,1.),textureLod(uCs,uv,0.).rg,smoothstep(.5,.44,max(e.x,e.y)));
}
// ---- clouds -------------------------------------------------------------------------------------------------
// macro distance; kind weights: x deck, y anvil, z tower(d) ; returns min d
float cloudMacro(vec3 p,vec4 m0,vec4 m1,out vec3 dk,out vec4 tw){
  dk.x=max(m0.x-p.y,(p.y-m0.y)*.8); dk.y=max(m1.x-p.y,p.y-m1.y); dk.z=1e5; tw=vec4(0.);
  for(int i=0;i<uNS&&i<3;i++){ if(uStC[i].w>.5&&uStC[i].w<1.5) continue; vec2 rel; float d=towerSd(i,p,rel); if(d<dk.z){ dk.z=d; tw=vec4(rel,uStE[i].w,(p.y-uStB[i].x)/(uStB[i].y-uStB[i].x)); } }
  return min(min(dk.x,dk.y),dk.z);
}
// density 0..1 ; hq: include fine erosion
float cloudDens(vec3 p,vec4 m0,vec4 m1,vec3 dk,vec4 tw,float lod,bool hq,out float shell){
  float dens=0.; shell=1e5;
  vec3 q=p-vec3(uDrift.x,0.,uDrift.y);
  // meso rotation of noise domain for the deck near the primary mesocyclone
  float wRot=0.; vec3 qr=p; float lam=0.;
  if(uNS>0&&uStC[0].w>.5&&uStC[0].w<1.5) lam=.8*smoothstep(1100.,150.,p.y-uStB[0].x);
  else if(uNS>0){ vec2 v=p.xz-uStC[0].xy; float r=length(v); wRot=smoothstep(uStC[0].z*1.9,uStC[0].z*1.1,r)*step(.2,uStB[0].w); lam=wRot*smoothstep(2200.,200.,p.y-uStB[0].x)*uStB[0].w; if(wRot>0.) { vec2 vr=rot2(v,uStE[0].w); qr=vec3(vr.x,p.y,vr.y); } }
  float up=smoothstep(m0.x,m0.x+1100.,p.y); float bnd=mix(260.,900.,up);
  if(dk.x<bnd&&m0.z>.01){
    vec4 n=wRot<1.?nB(q,2700.,lod):vec4(0.); if(wRot>0.) n=mix(n,nB(qr,2700.,lod),wRot);
    float bill=n.g*.62+n.b*.38;
    float amp=mix(150.,430.,up);
    float d=dk.x+(.52-bill)*amp*1.6; if(up>.12){ vec4 bg=nB(q+vec3(0.,-uTime*6.,0.),7400.,lod); d+=(.5-bg.g*.7-bg.r*.3)*1500.*smoothstep(.12,.8,up); }
    if(lam>.01){ vec4 s=nB(vec3(qr.x*.16,qr.y*1.15,qr.z*.16),1500.,lod); d+=(.5-s.g)*120.*lam; }
    if(hq&&d<90.&&d>-150.){ vec3 qf=mix(q,qr,step(.5,wRot)); vec4 f=nD(qf,470.,max(lod-1.,0.)); float fk=mix(1.,.4,smoothstep(9.,45.,gFp)); d+=(.52-f.g*.7-f.r*.3)*mix(120.,150.,up)*fk; float k2=smoothstep(1.6,.3,lod)*smoothstep(16.,5.,gFp); if(k2>.01){ vec4 f2=nD(qf+31.,137.,max(lod,0.)); d+=(.5-f2.g)*46.*k2; } }
    float soft=mix(38.,95.,up);
    dens=max(dens,smoothstep(12.,-soft,d)*m0.z); shell=min(shell,d);
  } else shell=min(shell,dk.x);
  if(dk.z<900.){
    vec3 tp=vec3(rot2(tw.xy,tw.z*.6),p.y-uTime*9.).xzy;
    vec4 a=nB(tp,8600.,lod), b=nB(tp+vec3(0.,uTime*-4.,0.),2500.,lod);
    float hs=smoothstep(.0,.35,tw.w); float lamT=(1.-smoothstep(.12,.34,tw.w));
    float bt=smoothstep(.0,.07,tw.w); float big=(.5-(a.g*.6+a.r*.4))*1700.*mix(.08,1.,smoothstep(.01,.3,tw.w));
    float mid=(.5-(b.g*.65+b.b*.35))*640.*mix(.12,1.,smoothstep(0.,.22,tw.w));
    float d=dk.z+big+mid;
    if(lamT>.01){ vec3 sp=vec3(rot2(tw.xy,tw.z),p.y).xzy; vec4 s=nB(vec3(sp.x*.1,sp.y,sp.z*.1),1900.,lod); d+=(.52-s.g)*420.*lamT*bt*step(.2,uStB[0].w); }
    if(hq&&d<140.&&d>-220.){ vec4 f=nD(tp,640.,max(lod-1.,0.)); d+=(.55-f.g)*230.*mix(.2,1.,bt); }
    dens=max(dens,smoothstep(14.,-100.,d)); shell=min(shell,d);
  } else shell=min(shell,dk.z);
  if(dk.y<350.){
    vec2 wd=uStD[0].xy; vec2 qw=vec2(dot(q.xz,wd)*.28,dot(q.xz,vec2(-wd.y,wd.x))); vec4 n=nB(vec3(qw.x,p.y*1.2,qw.y),4600.,lod); float th=m1.y-m1.x; float f=sat((p.y-m1.x)/max(th,1.));
    float d=dk.y+(.5-n.g*.6-n.b*.4)*mix(200.,430.,f)*smoothstep(0.,.5,m1.z);
    if(hq&&d<80.){ vec4 k=nD(vec3(qw.x,p.y*1.5,qw.y),1500.,lod); d+=(.5-k.g)*120.; }
    float da=smoothstep(40.,-420.,d)*mix(.015,.34,smoothstep(.05,1.,m1.z))*smoothstep(0.,.3,m1.z)*mix(.45,1.3,smoothstep(.3,.75,n.a*.5+n.b*.5));
    dens=max(dens,da); shell=min(shell,d);
  } else shell=min(shell,dk.y);
  return dens;
}
// ---- tornado ------------------------------------------------------------------------------------------------
// returns condensation density (extinction 1/m); dust extinction in 'dust'; hint = distance to surface (m)
float tornadoDens(int i,vec3 p,float lod,float dist,bool hq,out float dust,out float hint,out vec3 loc){
  vec4 a=uT0[i],b=uT1[i],c=uT2[i],e=uT4[i]; float h=p.y-a.z; dust=0.; loc=vec3(0.);
  float u=h/(a.w*1.25);
  vec4 pr=textureLod(uTProf,vec2(clamp(u,.5/${PROF_N}.,1.-.5/${PROF_N}.),(float(i)+.5)/float(NT)),0.);
  vec2 q=p.xz-a.xy-pr.xy; float r=length(q); float R=pr.z;
  loc=vec3(q,R);
  float rc=e.x, sp=e.z, vm=b.z;
  float wRef=2.*vm*rc/(rc*rc*1.+b.x*b.x);
  float w=2.*vm*rc/(r*r+rc*rc);
  float dw=clamp(w-wRef,-1.6,1.6)*.75;
  const float TP=3.6; float f0=fract(uTime/TP+b.x*.013), f1=fract(f0+.5); float k0=1.-abs(2.*f0-1.), k1=1.-k0;
  float id0=floor(uTime/TP+b.x*.013), id1=floor(uTime/TP+b.x*.013+.5);
  float kn=1./sqrt(k0*k0+k1*k1);
  float sg=0.; hint=1e5;
  float th0=sp*c.w;
  float tw=sp*h*1.15/max(b.x,20.);
  if((R>.6||e.w>.01)&&h>-30.){
    hint=R>.6?r-R*1.12:1e5;
    if(R>.6&&r<R*1.75+30.){
      float Rs=pow(R,.55)*pow(max(b.x,12.),.45);
      vec2 q0=rot2(q,th0+tw+sp*dw*(f0-.5)*TP), q1=rot2(q,th0+tw+sp*dw*(f1-.5)*TP);
      vec3 s0=vec3(q0.x/Rs,(h-e.y)/(b.x*1.5),q0.y/Rs), s1=vec3(q1.x/Rs,(h-e.y)/(b.x*1.5),q1.y/Rs);
      vec3 o0v=vec3(id0*.37,id0*.171,id0*.613), o1v=vec3(id1*.37+.31,id1*.171+.77,id1*.613);
      vec4 A=textureLod(uBase,s0*.36+o0v,lod)*k0+textureLod(uBase,s1*.36+o1v,lod)*k1;
      vec4 An=(A-.5)*kn+.5;
      float N1=An.g, N1b=An.b;
      vec4 D=textureLod(uDetail,vec3(s0.x*.62,s0.y*.30,s0.z*.62)+o0v,max(lod-.5,0.))*k0+textureLod(uDetail,vec3(s1.x*.62,s1.y*.30,s1.z*.62)+o1v,max(lod-.5,0.))*k1;
      vec4 Dn=(D-.5)*kn+.5;
      float ro=b.w; // roughness
      float hk=h/a.w;
      float Ra=min(R,70.+R*.24); float d=r-R-Ra*ro*(N1-.52)*1.05;
      d+=Ra*ro*(.5-(N1b*.5+Dn.g*.5))*.62;
      float near=smoothstep(2600.,500.,dist);
      if(hq&&near>0.&&abs(d)<R*.5){
        float Lf=max(Ra*.36,9.); vec3 x0=vec3(q0.x,(h-e.y)*.55,q0.y)/Lf, x1=vec3(q1.x,(h-e.y)*.55,q1.y)/Lf;
        vec4 F=textureLod(uDetail,x0*.5+o1v,max(lod-1.,0.))*k0+textureLod(uDetail,x1*.5+o0v,max(lod-1.,0.))*k1; vec4 Fn=(F-.5)*kn+.5;
        d+=(.5-Fn.g)*Ra*.30*near*mix(.5,1.,ro);
        d-=Fn.r*Ra*.07*near;
      }
      float soft=Ra*mix(.13,.34,ro)+1.5;
      float s0v=clamp(7./max(R,4.),.022,.45);
      float core=smoothstep(0.,-soft,d);
      // translucent shreds around the body
      float veil=exp(-max(d,0.)/(Ra*.22+2.))*smoothstep(.45,.8,Dn.r*.6+N1*.5)*.16*ro;
      sg=s0v*(core*mix(.42,1.,smoothstep(.15,.7,r/R))+veil);
      hint=min(hint,d);
    }
    // sub-vortices
    if(e.w>.01&&r<R*1.6+c.x*1.2+40.){
      // sub-vortices: twisting condensation tubes, thin at the ground and flaring into the parent funnel / cloud base,
      // with helical striations and their own debris whirls at the foot
      float hs=a.w*.98, hk=sat(h/hs);
      for(int k=0;k<4;k++){ vec4 s=uSub[i*4+k]; if(s.z<.03||h>hs) continue;
        float an=s.x-sp*(h*.16/max(s.y,20.)+hk*hk*.9); float orb=s.y*mix(1.,.5,hk*hk)+s.w*.6*sin(h*.011+s.x*3.);
        vec2 qs=q-vec2(cos(an),sin(an))*orb; float rs=length(qs);
        float Rr=s.w*(.6+1.5*pow(hk,1.7)); if(rs>Rr*2.4+14.) { hint=min(hint,rs-Rr*2.); continue; }
        float sw=sp*(uSubPh[i*4+k]+h*.045); vec2 qq=rot2(qs,sw);
        vec4 sn=textureLod(uDetail,vec3(qq.x/(s.w*2.4),(h-e.y*.5)/(s.w*16.),qq.y/(s.w*2.4))+vec3(float(k)*.37,0.,.5),lod);
        vec4 sb=textureLod(uBase,vec3(qq.x/(s.w*5.),(h-e.y*.3)/(s.w*22.),qq.y/(s.w*5.))+vec3(.2,float(k)*.29,0.),lod);
        float ds=rs-Rr*(1.+.38*(sb.g-.5)+.3*(sn.g-.5));
        float tube=smoothstep(Rr*.32,-Rr*.42,ds)*(.55+.45*smoothstep(.25,.65,sn.b*.6+sb.r*.4));
        float fade=smoothstep(hs,hs*.62,h)*smoothstep(-8.,6.,h);
        sg=max(sg,clamp(4.2/Rr,.016,.2)*tube*s.z*fade*mix(1.,.5,hk)); hint=min(hint,ds);
        // debris whirl around the foot
        float fw=exp(-max(h,0.)/(s.w*2.2+6.))*smoothstep(s.w*4.,s.w*.6,rs)*smoothstep(.3,.7,sn.r+sb.g*.4);
        dust+=c.y*fw*clamp(1.8/s.w,.006,.05)*s.z;
      }
    }
  }
  // dust / debris bowl
  float dr=c.x; float dh=c.z;
  float dBowl=max(r-dr*1.35,h-dh*1.5), dStr=max(r-dr*3.1,h-(22.+dr*.2));
  if(c.y>.01&&min(dBowl,dStr)<0.){
    float hh=max(h,0.)/dh; float rr=r/dr;
    vec2 qd=rot2(q,sp*(c.w*.72+clamp((vm*1.1*rc/(r*r+rc*rc))-.2,-.6,1.2)*(f0-.5)*TP)), qd1=rot2(q,sp*(c.w*.72+clamp((vm*1.1*rc/(r*r+rc*rc))-.2,-.6,1.2)*(f1-.5)*TP));
    float Ld=dr*1.25; vec3 w0=vec3(qd.x,(h-e.y*.6)*1.1,qd.y)/Ld+vec3(id0*.31,0.,.2), w1=vec3(qd1.x,(h-e.y*.6)*1.1,qd1.y)/Ld+vec3(id1*.31+.5,.1,.7);
    vec4 n=(textureLod(uBase,w0,lod)*k0+textureLod(uBase,w1,lod)*k1-.5)*kn+.5;
    vec4 n2=(textureLod(uDetail,w0*2.3,lod)*k0+textureLod(uDetail,w1*2.3,lod)*k1-.5)*kn+.5;
    float nn=n.g*.5+n.b*.2+n2.g*.3;
    // flaring bouquet: wall radius grows with height, thick near the ground, eroded feathery rim
    float wall=.30+.50*sqrt(sat(hh)); float thick=.52-.22*sat(hh);
    float sh=1.-pow(abs(rr-wall)/thick,2.); sh=max(sh,1.15*smoothstep(1.2,.1,rr+hh*.55));
    float topf=hh+.28*(1.-smoothstep(.2,.8,rr))+(.5-nn)*1.5; float top=1.-smoothstep(.10,1.05,topf);
    float g=min(sh,1.)*(.35+.65*top)+(nn-.5)*2.1-.30;
    float s=smoothstep(0.,.95,g); s*=s*(.25+.75*top)*smoothstep(1.45,.95,hh)*smoothstep(1.34,.9,rr)*1.5;
    // ground-hugging inflow streamers (log-spiral)
    float lr=log(max(rr,.05)); vec2 qs=rot2(q/max(r,1.),sp*(lr*2.6+uTime*.55)); float st=textureLod(uBase,vec3(qs*.42,lr*.35+uTime*.10),lod).g*.6+n2.r*.35;
    float gl=exp(-max(h,0.)/(6.+dr*.05*smoothstep(3.,.8,rr)))*smoothstep(3.1,.9,rr)*smoothstep(.36,.72,st)*smoothstep(-25.,0.,h);
    dust+=c.y*(s*clamp(5.5/dr,.010,.10)+gl*clamp(1.6/dr,.004,.03));
    hint=min(hint,dBowl<0.?dr*(dust>0.?.10:.16):max(min(dBowl,dr*.36),dr*.16));
  } else if(c.y>.01) hint=min(hint,min(max(dBowl,dr*.1),max(dStr,dr*.1)));
  return sg;
}
// optical depth through funnel toward direction L (horizontal chord, analytic)
float funnelChord(vec2 q,float R,vec2 L){ float b=dot(q,L),c=dot(q,q)-R*R; float d=b*b-c; if(d<=0.) return 0.; float s=sqrt(d); return max(0.,s-b)-max(0.,-s-b); }
// ---- precipitation ------------------------------------------------------------------------------------------
float rainDens(vec3 p,vec4 m0,float lod){
  if(m0.w<.004) return 0.;
  vec2 sl=uDrift*.0+vec2(.10,.04)*(m0.x-p.y); vec3 q=vec3(p.x+sl.x,p.y,p.z+sl.y);
  vec4 n=textureLod(uBase,vec3(q.x,(q.y+uTime*70.)*.055,q.z)/2600.,lod); vec4 n2=textureLod(uBase,vec3(q.x,(q.y+uTime*110.)*.045,q.z)/830.,lod);
  float st=n.g*.6+n2.g*.4; float k=smoothstep(.22,.72,st+m0.w*.22);
  return m0.w*(.3+1.5*k)*uRainSig*smoothstep(m0.x+500.,m0.x-100.,p.y);
}
void main(){
  vec2 px=gl_FragCoord.xy; vec3 rd; float tEnd=MAXD; float rawD=0.; float scn=MAXD;
  if(uMode<.5){
    // sub-pixel jittered ray (R2 sequence); the full-res resolve knows where every sample landed
    // 0: low-res + sub-pixel jitter (low/medium); 1: checkerboard, samples sit exactly on full-res pixel centres; 2: full res
    vec2 uvJ=uLMode>1.5?gl_FragCoord.xy/uRes:uLMode>.5?vec2(2.*floor(gl_FragCoord.x)+mod(floor(gl_FragCoord.y)+uPar,2.)+.5,gl_FragCoord.y)/uFRes:(gl_FragCoord.xy+uJit)/uRes;
    vec4 w=uInvVP*vec4(uvJ*2.-1.,.5,1.); rd=normalize(w.xyz/w.w-uCam);
    vec2 hp=.5/(uLMode>.5?uFRes:uRes); scn=0.; for(int k=0;k<4;k++){ float z=shLinearDepth(textureLod(uDepth,uvJ+hp*vec2((k&1)*2-1,(k>>1)*2-1)*.7,0.).r,uDepthK); scn=max(scn,z); } scn=scn/max(dot(rd,uFwd),.05); tEnd=min(scn,MAXD);
  } else { float az=(vUv.x-.5)*2.*PI, el=(vUv.y-.5)*PI; rd=vec3(cos(az)*cos(el),sin(el),sin(az)*cos(el)); if(rd.y<0.) tEnd=min(MAXD,(uCam.y-uGround+2.)/-rd.y); px+=13.; }
  Bz=texelFetch(uBlue,ivec2(px)&63,0).r; float j=fract(Bz+uFrame*.61803399);
  vec3 ro=uCam;
  float mu=dot(rd,uSunDir); float pS[3];
  // three scattering octaves, dual lobe
  float ph0=mix(hg(mu,.82),hg(mu,-.18),.32), ph1=mix(hg(mu,.45),hg(mu,-.1),.4), ph2=hg(mu,.12);
  vec2 sa=normalize(uSunDir.xz+1e-4); float azd=dot(normalize(rd.xz+1e-4),sa);
  vec3 aHs=skyRad(normalize(vec3(sa.x,.10,sa.y)))*.5+skyRad(normalize(vec3(sa.x*.8+sa.y*.6,.16,sa.y*.8-sa.x*.6)))*.25+skyRad(normalize(vec3(sa.x*.8-sa.y*.6,.16,sa.y*.8+sa.x*.6)))*.25;
  vec3 aHo=skyRad(normalize(vec3(-sa.x,.12,-sa.y))), aZ=skyRad(normalize(vec3(-sa.x*.3,.9,-sa.y*.3)));
  aHs=min(aHs,vec3(lum(aHo)*5.+.4));
  vec3 aMean=aHs*.35+aHo*.4+aZ*.25;
  vec3 L=vec3(0.); float T=1., wT=0., wD=0.; float t=0.;
  // ---- global entry / exit
  float yTop=uTop; if(rd.y>1e-4) tEnd=min(tEnd,max(0.,(yTop-ro.y)/rd.y)); if(ro.y>yTop){ if(rd.y>=0.) tEnd=0.; else t=(ro.y-yTop)/-rd.y; }
  // tornado intervals
  float tn[NT],tf[NT];
  for(int i=0;i<NT;i++){ tn[i]=1e9; tf[i]=-1.; if(i>=uNT) continue; vec2 o=ro.xz-uT0[i].xy; float R=uT1[i].y; float A=dot(rd.xz,rd.xz),B=dot(o,rd.xz),C=dot(o,o)-R*R; float D=B*B-A*C; if(D<0.||A<1e-8) continue; D=sqrt(D); float t0=(-B-D)/A,t1=(-B+D)/A;
    float yT=uT0[i].z+uT0[i].w*1.18, yB=uT0[i].z-30.; if(abs(rd.y)>1e-5){ float a0=(yB-ro.y)/rd.y,a1=(yT-ro.y)/rd.y; t0=max(t0,min(a0,a1)); t1=min(t1,max(a0,a1)); } else if(ro.y>yT||ro.y<yB) continue; if(t1>max(t0,0.)){ tn[i]=max(t0,0.); tf[i]=t1; } }
  float first=1.; float gz=0.;
  vec3 glow=normalize(vec3(sa.x,-.10,sa.y));
  int it=0;
  for(;it<uSteps;it++){
    if(t>=tEnd||T<.008) break;
    float rj=fract(j+float(it)*.7548776662);
    vec3 p=ro+rd*t; float lodC=max(0.,log2(max(t*uPix,1.)/22.));
    vec4 m0,m1; maps(p.xz,m0,m1); vec3 dk; vec4 tw; float dM=cloudMacro(p,m0,m1,dk,tw);
    // adaptive empty-space step
    float bndX=mix(260.,900.,smoothstep(m0.x,m0.x+1100.,p.y)); float slope=abs(rd.y)+.22;
    float stp=min(min(max(dk.x-bndX,0.)/slope*.8,max(dk.y-300.,0.)/slope*.9),max(dk.z-900.,0.)*.85);
    float sC=0.,sh=1e5; float ds=1e5;
    bool inC=dk.x<bndX||dk.y<300.||dk.z<900.;
    if(inC){
      gFp=t*uPix; sC=cloudDens(p,m0,m1,dk,tw,lodC,true,sh);
      float fine=max(16.,t*.0075)*uQual;
      ds=sC>0.?fine*(1.+2.2*smoothstep(-80.,-500.,sh)):max(fine,sh*.45);
      ds*=1.+1.5*smoothstep(.45,.05,T);
      stp=ds;
    } else stp=max(stp,40.);
    float sigC=sC*mix(.030,.040,step(dk.z,dk.x));
    // rain
    float sR=rainDens(p,m0,max(0.,log2(max(t*uPix,1.)/20.)));
    if(sR>1e-6||m0.w>.0) stp=min(stp,(140.+t*.055)*uQual);
    stp=min(stp,700.+t*.12);
    // tornado
    float sT=0.,sDu=0.; vec3 tl=vec3(0.); int ti=-1; float hintMin=1e5;
    for(int i=0;i<uNT;i++){
      if(t<tn[i]){ if(tf[i]>0.) stp=min(stp,tn[i]-t+.5); continue; } if(t>tf[i]) continue;
      float du,hi; vec3 lc; float s=tornadoDens(i,p,max(0.,log2(max(t*uPix,.5)/max(uT1[i].x*.045,.4))),t,true,du,hi,lc);
      float dsm=max(max(uT1[i].x*.028,1.6),t*.0028)*uQual; float dst=max(hi*.65,dsm);
      dst*=1.+1.5*smoothstep(.4,.05,T);
      stp=min(stp,dst);
      if(s+du>sT+sDu){ sT=s; sDu=du; tl=lc; ti=i; }
    }
    float rem=tEnd-t; float dt=min(stp*mix(.72,1.28,rj),rem+.01); float wgt=min(stp,rem);
    float sig=sigC+sR+sT+sDu;
    if(sig>1e-6){
      // ---- lighting ----
      vec3 sunE=mix(uSunE,uSunEHigh,smoothstep(800.,9000.,p.y-uGround));
      vec3 Ls=vec3(0.); vec3 col=vec3(0.);
      bool low=p.y<m0.x+350.; vec2 cs=cloudSun(p);
      if(sigC>1e-6){
        float tau=0.; float vis=1.;
        float below=smoothstep(m0.x+700.,m0.x-100.,p.y);
        vis=mix(1.,cs.x,below*step(dk.x,dk.z+200.));
        if(lum(sunE)*vis>.004){
          float s=0.,l=70.; for(int k=0;k<uLSteps;k++){ vec3 lp=p+uSunDir*(s+l*(.35+.5*fract(rj+.37*float(k)))); s+=l; vec4 a0,a1; maps(lp.xz,a0,a1); vec3 ld; vec4 lt; float lm=cloudMacro(lp,a0,a1,ld,lt); float sx;
            if(ld.x<400.||ld.y<300.||ld.z<700.){ float dd=cloudDens(lp,a0,a1,ld,lt,lodC+1.5,false,sx); tau+=dd*.034*l; } l*=2.05; if(tau>9.) break; }
        }
        float pw=1.-.72*exp(-sC*9.-tau*1.6);  // powder
        vec3 sc=sunE*vis*(ph0*exp(-tau)+ph1*.55*exp(-tau*.42)+ph2*.42*exp(-tau*.14))*pw*2.5;
        // ambient: zenith from above, horizon ring + ground bounce from below
        float depthTop=max(max(m0.y,dk.z<50.?p.y+1200.:0.)-p.y,0.); float aTop=exp(-depthTop/900.)*mix(1.,.55,smoothstep(0.,-250.,sh));
        float hb=p.y-m0.x; float aBot=exp(-max(hb,0.)/170.);
        float rel=1.;
        if(dk.x<210.&&hb<500.){ vec3 sp=p+glow*75.; vec4 b0,b1; maps(sp.xz,b0,b1); vec3 bd; vec4 bt; cloudMacro(sp,b0,b1,bd,bt); float sx; float r1=cloudDens(sp,b0,b1,bd,bt,lodC+.5,false,sx); sp=p+glow*240.; maps(sp.xz,b0,b1); cloudMacro(sp,b0,b1,bd,bt); float r2=cloudDens(sp,b0,b1,bd,bt,lodC+1.,false,sx); rel=exp(-(r1*1.3+r2*1.5)); }
        vec3 hor=mix(aHo,aHs,.5+.5*azd*.6);
        float open=mix(.30,1.,cs.y);
        vec3 amb=aZ*aTop*.95+aMean*aTop*.25+(hor*(.16+.50*rel)*open+uGroundRad*.30)*aBot*(1.-.25*aTop);
        amb+=aMean*.012;
        amb*=mix(vec3(1.),vec3(.70,1.02,.86),m1.w*.65*(1.-aTop));
        Ls+=sigC*(sc+amb*.95);
      }
      if(sR>1e-7){
        float ab=smoothstep(m0.x+200.,m0.x-700.,p.y);
        float op=mix(.18,1.,cs.y); vec3 hor=mix(aHo,aHs,.5+.5*azd);
        vec3 sc=sunE*cs.x*(hg(mu,.72)*.7+hg(mu,-.2)*.3)*1.25+(hor*.34+aMean*.12)*mix(.35,1.,ab)*op+uGroundRad*.08;
        sc*=mix(vec3(1.),vec3(.72,1.,.84),m1.w*.8);
        Ls+=sR*sc;
      }
      if(sT+sDu>1e-7){
        vec2 q=tl.xy; float R=max(tl.z,1.); float r=length(q); vec2 nr=q/max(r,1e-3);
        vec4 b=uT1[ti],c=uT2[ti]; float h=p.y-uT0[ti].z;
        vec2 lh=normalize(uSunDir.xz+1e-4); float ch=funnelChord(q,R*.92,lh)/max(length(uSunDir.xz),.25);
        float s0v=clamp(7./max(R,4.),.022,.45);
        // local relief: two taps toward the light
        float t1=0.,t2=0.; float du1,hi1; vec3 lc1;
        vec3 lp=p+normalize(vec3(uSunDir.x,uSunDir.y*.5,uSunDir.z))*max(R*.16,c.y>.0&&sDu>sT?c.x*.10:0.); float d1=tornadoDens(ti,lp,1.5+max(0.,log2(max(t*uPix,.5)/max(b.x*.045,.4))),t,false,du1,hi1,lc1); t1=d1*R*.22+du1*c.x*.22;
        lp=p+normalize(vec3(uSunDir.x,uSunDir.y*.5,uSunDir.z))*max(R*.5,sDu>sT?c.x*.35:0.); float d2=tornadoDens(ti,lp,2.5+max(0.,log2(max(t*uPix,.5)/max(b.x*.045,.4))),t,false,du1,hi1,lc1); t2=d2*R*.45+du1*c.x*.5;
        float tauS=t1+t2+ch*s0v*.35;
        float sunv=cs.x;
        vec3 sc=sunE*sunv*(ph0*exp(-tauS)+ph1*.6*exp(-tauS*.4)+ph2*.5*exp(-tauS*.13))*2.2;
        // directional ambient: bright horizon ring, dark deck overhead
        float ndl=dot(nr,sa); float depthIn=max(R-r,0.)*s0v;
        float occ=exp(-depthIn*.55)*.8+.2*exp(-depthIn*.12);
        float rlf=exp(-t1*.8);
        vec3 hl=mix(aHo,aHs,sat(.5+.62*ndl));
        float hf=sat(h/uT0[ti].w); float op=mix(.42,.95,cs.y)*mix(1.,.55,hf*hf);
        // light also leaks through from behind (view-through glow)
        vec3 bk=mix(aHo,aHs,sat(.5+.62*dot(rd.xz,sa)));
        vec3 amb=(hl*.42*occ*(.45+.55*rlf)+bk*.10*exp(-depthIn*.5))*op+uGroundRad*.22*exp(-h/260.)*occ;
        Ls+=sT*(sc+amb);
        if(sDu>0.){ vec3 dc=mix(vec3(lum(uT3[ti].rgb)),uT3[ti].rgb,.72)*.82; float ot=exp(-t1*.6-t2*.25); vec3 dl=sunE*sunv*(hg(mu,.55)*.65+.35/(4.*PI))*exp(-(t1+t2)*.8)*2.2+(hl*.55*ot+bk*.12)*mix(.5,1.,cs.y)+uGroundRad*.18*ot; Ls+=sDu*dl*dc*1.05; }
      }
      for(int k=0;k<uNF;k++){ vec3 fv=uFlash[k].xyz-p; float fd=length(fv); float occF=exp(-fd/1700.)/(1.+fd*fd/(520.*520.)); Ls+=sig*uFlashCol*uFlash[k].w*occF*(sT+sDu>sC?.5:1.); }
      // integrate + aerial perspective at this depth
      float st=exp(-sig*wgt); float we=T*(1.-st); vec3 Li=Ls/sig;
      vec4 ap=aerial(ro,rd,t); Li=Li*pow(vec3(ap.a),vec3(.82,1.,1.2))+ap.rgb;
      L+=we*Li; wD+=we*t; wT+=we; T*=st;
    }
    t+=max(dt,.4);
  }
  if(it>=uSteps){ if(T<.55){ L/=max(1.-T,.2); T=0.; } else if(t<9000.&&rd.y<.25){ L+=T*aerial(ro,rd,40000.).rgb; T=0.; } }
  float dO=wT>.002?wD/wT:min(tEnd,scn);
  if(T<.012) { L*=1./(1.-T); T=0.; }
  o0=vec4(L,T); o1=vec4(min(dO,60000.),min(scn,60000.),0.,1.); if(uClip.x>.5) o0=vec4(mix(vec3(0.,0.,1.),vec3(1.,0.,0.),float(it)/float(uSteps))*(it>=uSteps?3.:1.),0.);
}`;

// Full-resolution temporal upsampling resolve. The raymarch runs at a fraction of the render resolution with a
// different sub-pixel offset every frame; this pass places every low-res sample where it actually landed and
// accumulates them into a full-res history (reprojected with the cloud depth), so the clouds converge to full
// resolution instead of being a bilinear blow-up of a 1/2 or 1/3 res buffer.
const TEMPORAL = HEAD + DEPTH_GLSL + TORNADO_UNI + /* glsl */`
in vec2 vUv; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
uniform sampler2D uCur,uCurD,uHist,uHistD,uDepth; uniform vec2 uRes,uLRes,uJit; uniform float uLMode,uPar; uniform vec4 uDepthK; uniform mat4 uInvVP,uPrevVP; uniform vec3 uCam,uFwd; uniform float uDt,uReset,uAlpha;
vec3 enc(vec3 c){ return c/(1.+lum(c)); } vec3 dec(vec3 c){ return c/max(1.-lum(c),1e-3); }
vec3 toY(vec3 c){ return vec3(dot(c,vec3(.25,.5,.25)),dot(c,vec3(.5,0.,-.5)),dot(c,vec3(-.25,.5,-.25))); } vec3 toR(vec3 c){ float t=c.x-c.z; return vec3(t+c.y,c.x+c.z,t-c.y); }
vec4 E(vec4 c){ return vec4(toY(enc(max(c.rgb,vec3(0.)))),c.a); }
vec4 hist(vec2 uv){ // Catmull-Rom, 5 taps, in the encoded space
  vec2 p=uv*uRes, c=floor(p-.5)+.5, f=p-c; vec2 w0=f*(-.5+f*(1.-.5*f)),w1=1.+f*f*(-2.5+1.5*f),w2=f*(.5+f*(2.-1.5*f)),w3=f*f*(-.5+.5*f); vec2 w12=w1+w2, p12=(c+w2/w12)/uRes, p0=(c-1.)/uRes,p3=(c+2.)/uRes;
  vec4 s=vec4(0.); float w=0.,k;
  #define TP(P,W) { k=W; s+=E(textureLod(uHist,P,0.))*k; w+=k; }
  TP(vec2(p12.x,p0.y),w12.x*w0.y) TP(vec2(p0.x,p12.y),w0.x*w12.y) TP(p12,w12.x*w12.y) TP(vec2(p3.x,p12.y),w3.x*w12.y) TP(vec2(p12.x,p3.y),w12.x*w3.y)
  return s/w;
}
void main(){
  vec2 fp=gl_FragCoord.xy, uv=fp/uRes;
  vec4 w=uInvVP*vec4(uv*2.-1.,.5,1.); vec3 rd=normalize(w.xyz/w.w-uCam);
  float md=min(shLinearDepth(textureLod(uDepth,uv,0.).r,uDepthK)/max(dot(rd,uFwd),.05),60000.);
  vec2 k=uRes/uLRes; vec2 lp=uv*uLRes-.5-uJit; ivec2 c0=uLMode>.5?ivec2(int(fp.x)/(uLMode>1.5?1:2),int(fp.y)):ivec2(floor(lp+.5)), mx=ivec2(uLRes)-1;
  // reconstruction kernel: gaussian, sigma = half a raymarch texel; dens = fresh samples per full-res pixel
  float sgm=uLMode>.5?.42:max(k.x*.5,.6), dens=uLMode>1.5?1.:uLMode>.5?.5:1./(k.x*k.y); float sg=1./(2.*sgm*sgm);
  vec4 s=vec4(0.),sh=vec4(0.),m1=vec4(0.),m2=vec4(0.),mn=vec4(9.),mxv=vec4(-9.); float ws=1e-6,wsh=0.,wm=1e-6,dsum=0.;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    ivec2 q=clamp(c0+ivec2(x,y),ivec2(0),mx); vec4 v=texelFetch(uCur,q,0); vec2 vd=texelFetch(uCurD,q,0).xy;
    float er=abs(log2(max(vd.y,.5)/max(md,.5)));
    // a sample that saw past our surface and whose cloud lies behind it contributes nothing here
    if(vd.y>md*1.15){ float kk=smoothstep(md*1.35,md*.6,vd.x); v=mix(vec4(0.,0.,0.,1.),v,kk); er*=.35+.65*kk; }
    vec2 d=(uLMode>1.5?vec2(q)+.5:uLMode>.5?vec2(2.*float(q.x)+mod(float(q.y)+uPar,2.)+.5,float(q.y)+.5):(vec2(q)+.5+uJit)*k)-fp; float d2=dot(d,d); float wd=exp(-er*9.);
    vec4 e=E(v); float g=exp(-d2*sg)*(wd+1e-4); s+=e*g; ws+=g; dsum+=min(vd.x,60000.)*g;
    float wn=wd*exp(-d2*sg*.25); m1+=e*wn; m2+=e*e*wn; wm+=wn; if(wd>.25){ mn=min(mn,e); mxv=max(mxv,e); }
  }
  vec4 sp=s/ws; float cdep=dsum/ws; if(mn.x>8.){ mn=sp; mxv=sp; }
  m1/=wm; m2/=wm; vec4 sd=sqrt(max(m2-m1*m1,vec4(0.)));
  // confidence = how much fresh sample weight landed on this pixel this frame, relative to the average (2*pi*sigma^2 in
  // raymarch texels). Blending by confidence (instead of snapping to the nearest sparse sample) keeps edges from
  // re-snapping to each frame's jitter lattice, which read as shaking clouds.
  float conf=ws/(6.283*sgm*sgm*dens); vec4 cur=sp;
  // reprojection at the cloud depth (+ swirl inside tornadoes)
  vec3 p=uCam+rd*min(cdep,md); float mov=0.;
  for(int i=0;i<uNT;i++){ vec4 a=uT0[i]; float h=p.y-a.z; if(h<-40.||h>a.w*1.1) continue; vec4 pr=textureLod(uTProf,vec2(clamp(h/(a.w*1.25),0.,1.),(float(i)+.5)/float(NT)),0.); vec2 q=p.xz-a.xy-pr.xy; float r=length(q); float lim=max(pr.z*1.6,uT2[i].x*1.4); if(r>lim) continue;
    float rc=uT4[i].x; float om=2.*uT1[i].z*rc/(r*r+rc*rc)*.75; om=min(om,2.2); float an=uT4[i].z*om*uDt; float c=cos(an),sn=sin(an); vec2 qp=vec2(c*q.x-sn*q.y,sn*q.x+c*q.y); p.xz+=qp-q; mov=1.; break; }
  vec4 pc=uPrevVP*vec4(p,1.); vec2 puv=pc.xy/pc.w*.5+.5;
  if(pc.w<=0.||any(lessThan(puv,vec2(.5/uRes)))||any(greaterThan(puv,1.-.5/uRes))||uReset>.5){ o0=vec4(dec(toR(sp.rgb)),sat(sp.a)); o1=vec4(cdep,md,0.,1.); return; }
  vec4 h=hist(puv); vec4 hd=textureLod(uHistD,puv,0.);
  // neighbourhood clip (YCoCg + transmittance) against the jittered low-res samples
  vec2 vel0=(puv-uv)*uRes; float g=mix(2.,1.3,mov); vec4 lo=max(m1-g*sd,mn-.015), hi=min(m1+g*sd,mxv+.015); lo=min(lo,cur); hi=max(hi,cur);
  vec4 cc=.5*(lo+hi), ee=.5*(hi-lo)+1e-4, vv=h-cc; vec4 av=abs(vv/ee); float km=max(max(av.x,av.y),max(av.z,av.w)); vec4 hc=km>1.?cc+vv/km:h;
  float clampAmt=length((h-hc).xyz)+abs(h.a-hc.a);
  // scene disocclusion (history saw a different surface)
  float ds=abs(hd.y-md)/max(min(hd.y,md),1.); float dis=smoothstep(.1,.4,ds)*step(min(hd.y,md),59000.);
  vec2 vel=(puv-uv)*uRes;
  // camera motion is reprojected exactly (rotation) or at the cloud depth, so no velocity-based history rejection
  float a=uAlpha*clamp(conf,.3,2.); a=mix(a,max(a,.12),smoothstep(.1,.5,clampAmt)); a=max(a,mov*.09);
  a=mix(a,.85,dis);
  vec4 r=mix(hc,cur,a); o0=vec4(dec(toR(r.rgb)),sat(r.a)); o1=vec4(cdep,md,0.,1.);
}`;
const COPY2 = HEAD + /* glsl */`in vec2 vUv; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; uniform sampler2D uA,uB; void main(){ o0=textureLod(uA,vUv,0.); o1=textureLod(uB,vUv,0.); }`;

export class Volume {
  constructor(renderer, shared) {
    this.r = renderer; this.s = shared;
    const u = this.u = {
      ...shared.atmU, ...shared.stormU, ...shared.torU,
      uDepth: { value: null }, uM0: { value: null }, uM1: { value: null }, uCs: shared.csTex, uBlue: { value: shared.blue }, uBase: { value: shared.noise.base }, uDetail: { value: shared.noise.detail },
      uDepthK: shared.depthK, uXf: { value: null }, uCsXf: { value: null }, uRes: { value: new THREE.Vector2() }, uJit: { value: new THREE.Vector2() }, uFRes: { value: new THREE.Vector2() }, uLMode: { value: 0 }, uPar: { value: 0 }, uInvVP: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() }, uFwd: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3() }, uSunE: { value: new THREE.Vector3() }, uSunEHigh: { value: new THREE.Vector3() }, uGroundRad: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uFrame: { value: 0 }, uGround: { value: 0 }, uTop: { value: 13500 }, uPix: { value: 0.002 }, uQual: { value: 1 }, uStormDark: { value: 0 }, uMode: { value: 0 }, uRainSig: { value: 0.0026 },
      uSteps: { value: 100 }, uLSteps: { value: 5 }, uDrift: { value: new THREE.Vector2() }, uFlash: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uFlashCol: { value: new THREE.Vector3(0.75, 0.85, 1.15) }, uNF: { value: 0 }, uClip: { value: new THREE.Vector4() },
    };
    this.mat = fsMaterial(VOL, u);
    this.mT = fsMaterial(TEMPORAL, { ...shared.torU, uCur: { value: null }, uCurD: { value: null }, uHist: { value: null }, uHistD: { value: null }, uDepth: u.uDepth, uDepthK: shared.depthK, uRes: { value: new THREE.Vector2() }, uLRes: u.uRes, uJit: u.uJit, uLMode: u.uLMode, uPar: u.uPar, uInvVP: u.uInvVP, uPrevVP: { value: new THREE.Matrix4() }, uCam: u.uCam, uFwd: u.uFwd, uDt: { value: 0.016 }, uReset: { value: 1 }, uAlpha: { value: 0.07 } });
    this.mCopy = fsMaterial(COPY2, { uA: { value: null }, uB: { value: null } });
    this.env = hdrRT(192, 96, { count: 2 });
    this.n = 0;
  }
  // lw,lh: raymarch resolution; fw,fh: reconstruction (= render) resolution
  // mode 'full' | 'checker' | 'jitter' (scale = raymarch / render resolution, jitter mode only)
  setMode(mode, fw, fh, scale) {
    this.mode = mode; this.u.uLMode.value = mode === 'full' ? 2 : mode === 'checker' ? 1 : 0;
    if (mode === 'full') this.resize(fw, fh, fw, fh); else if (mode === 'checker') this.resize(Math.ceil(fw / 2), fh, fw, fh); else this.resize(Math.round(fw * scale), Math.round(fh * scale), fw, fh);
  }
  resize(lw, lh, fw = lw, fh = lh) {
    lw = Math.max(64, lw | 0); lh = Math.max(36, lh | 0); fw = Math.max(64, fw | 0); fh = Math.max(36, fh | 0);
    if (this.lw !== lw || this.lh !== lh) {
      this.lw = lw; this.lh = lh; this.cur?.dispose();
      this.cur = hdrRT(lw, lh, { count: 2 }); for (const x of this.cur.textures) x.minFilter = x.magFilter = THREE.NearestFilter;
      this.u.uRes.value.set(lw, lh);
    }
    if (this.w !== fw || this.h !== fh) {
      const old = this.a; this.w = fw; this.h = fh;
      this.a = hdrRT(fw, fh, { count: 2 }); this.b?.dispose(); this.b = hdrRT(fw, fh, { count: 2 });
      // keep the accumulated history across (dynamic) resolution changes instead of resetting to a blurry frame
      if (old) { this.mCopy.uniforms.uA.value = old.textures[0]; this.mCopy.uniforms.uB.value = old.textures[1]; draw(this.r, this.mCopy, this.a); old.dispose(); } else this.reset = true;
      this.mT.uniforms.uRes.value.set(fw, fh); this.u.uFRes.value.set(fw, fh); this.out = this.a;
    }
  }
  render(prevVP, dt) {
    const n = this.n++; this.u.uPar.value = n & 1;
    if (this.u.uLMode.value > 0.5) this.u.uJit.value.set(0, 0); else this.u.uJit.value.set(((0.5 + n * 0.7548776662) % 1) - 0.5, ((0.5 + n * 0.5698402910) % 1) - 0.5); // R2
    this.u.uMode.value = 0; draw(this.r, this.mat, this.cur);
    const t = this.mT.uniforms; t.uCur.value = this.cur.textures[0]; t.uCurD.value = this.cur.textures[1]; t.uHist.value = this.a.textures[0]; t.uHistD.value = this.a.textures[1]; t.uPrevVP.value.copy(prevVP); t.uDt.value = dt; t.uReset.value = this.reset ? 1 : 0; this.reset = false;
    draw(this.r, this.mT, this.b); const x = this.a; this.a = this.b; this.b = x;
    this.out = this.a;
  }
  renderEnv(steps) {
    const u = this.u, rs = u.uSteps.value, q = u.uQual.value, l = u.uLSteps.value, p = u.uPix.value; u.uMode.value = 1; u.uSteps.value = steps; u.uQual.value = 2.2; u.uLSteps.value = 3; u.uPix.value = 0.03;
    draw(this.r, this.mat, this.env); u.uMode.value = 0; u.uSteps.value = rs; u.uQual.value = q; u.uLSteps.value = l; u.uPix.value = p;
  }
}

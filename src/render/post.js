// Screen-space passes: GTAO, composite (sky + clouds + aerial perspective), TAA, bloom, auto exposure, final grade
import * as THREE from 'three';
import { HEAD, DEPTH_GLSL, SKY_GLSL } from './glsl.js';
import { fsMaterial, draw, hdrRT } from './pass.js';

const AO = HEAD + DEPTH_GLSL + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uDepth; uniform vec4 uDepthK,uProjK; uniform vec2 uRes; uniform float uFrame;
// uProjK: 1/P00, 1/P11, P20, P21
vec3 vp(vec2 uv){ float z=shLinearDepth(textureLod(uDepth,uv,0.).r,uDepthK); return vec3((uv*2.-1.+uProjK.zw)*uProjK.xy*z,-z); }
void main(){
  vec3 p=vp(vUv); float z=-p.z; if(z>700.){ o=vec4(1.,z,0.,1.); return; }
  vec2 e=1./uRes; vec3 r=vp(vUv+vec2(e.x,0.)),l=vp(vUv-vec2(e.x,0.)),u=vp(vUv+vec2(0.,e.y)),d=vp(vUv-vec2(0.,e.y));
  vec3 dx=abs(r.z-p.z)<abs(p.z-l.z)?r-p:p-l, dy=abs(u.z-p.z)<abs(p.z-d.z)?u-p:p-d; vec3 n=normalize(cross(dx,dy));
  p*=.9985; vec3 V=normalize(-p);
  float rad=mix(1.1,6.,smoothstep(10.,250.,z)); float pr=rad*.5/(uProjK.y*z)*1.; pr=min(pr,.16); float asp=uRes.y/uRes.x;
  float nz=ign(gl_FragCoord.xy+uFrame*5.588238); float ao=0.; const int SL=3; const int ST=4;
  float j=fract(nz*7.13+uFrame*.618);
  for(int s=0;s<SL;s++){
    float phi=(float(s)+nz)*PI/float(SL); vec2 om=vec2(cos(phi),sin(phi)); vec3 D=vec3(om,0.); vec3 oD=D-dot(D,V)*V; vec3 ax=cross(D,V); vec3 pn=n-ax*dot(n,ax)/max(dot(ax,ax),1e-4); float pl=length(pn); float sg=sign(dot(oD,pn)); float cn=sat(dot(pn,V)/max(pl,1e-4)); float N=sg*acos(cn);
    float h0=-1.,h1=-1.;
    for(int k=0;k<ST;k++){ float f=(float(k)+j)/float(ST); f*=f; vec2 of=om*vec2(asp,1.)*max(pr*f,1.5/uRes.y);
      vec3 a=vp(vUv+of)-p, b=vp(vUv-of)-p; float la=dot(a,a), lb=dot(b,b); float wa=sat(1.-la/(rad*rad)), wb=sat(1.-lb/(rad*rad));
      h0=max(h0,mix(-1.,dot(a,V)/sqrt(la+1e-6),wa)); h1=max(h1,mix(-1.,dot(b,V)/sqrt(lb+1e-6),wb)); }
    float a1=-acos(clamp(h1,-1.,1.)), a0=acos(clamp(h0,-1.,1.)); a1=N+max(a1-N,-PI*.5); a0=N+min(a0-N,PI*.5);
    ao+=pl*.25*((cn+2.*a1*sin(N)-cos(2.*a1-N))+(cn+2.*a0*sin(N)-cos(2.*a0-N)));
  }
  ao=sat(ao/float(SL)); ao=pow(ao,1.25); ao=mix(ao,1.,smoothstep(350.,700.,z)); o=vec4(ao,z,0.,1.);
}`;
const AOBLUR = HEAD + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uT; uniform vec2 uDir;
void main(){ vec4 c=textureLod(uT,vUv,0.); float s=c.r,w=1.; for(int i=-3;i<=3;i++){ if(i==0) continue; vec4 q=textureLod(uT,vUv+uDir*float(i),0.); float k=exp(-abs(q.g-c.g)/max(c.g*.02,.02))*exp(-float(i*i)*.12); s+=q.r*k; w+=k; } o=vec4(s/w,c.g,0.,1.); }`;

// ---- composite ----
export const SKYCOL_GLSL = /* glsl */`
uniform sampler3D uBase; uniform vec3 uSunDirT,uMoonDir,uSunDisk,uSunE,uSunEHigh,uLightDir; uniform float uTime,uNight,uCirrus; uniform vec2 uDrift;
float starLayer(vec3 d,float sc,float th){ vec3 p=d*sc; vec3 i=floor(p); vec3 h=hash33(i); vec3 f=fract(p)-.5-(h-.5)*.6; float m=smoothstep(.10,.0,length(f))*step(th,h.x*.5+h.y*.5); return m*(.3+h.z*h.z*2.5); }
vec3 skyColor(vec3 ro,vec3 rd,float disk){
  vec3 c=skyRad(rd);
  if(uNight>.01&&rd.y>-.02){ float a=uTime*.00007; vec3 d=vec3(rd.x*cos(a)-rd.z*sin(a),rd.y,rd.x*sin(a)+rd.z*cos(a)); float st=starLayer(d,150.,.82)+starLayer(d,260.,.86)*.6; float mw=exp(-pow(dot(d,normalize(vec3(.5,.35,.78))),2.)*14.)*textureLod(uBase,d*1.3,0.).g; c+=uNight*(vec3(.85,.92,1.1)*st*.05*smoothstep(0.,.25,rd.y)+vec3(.5,.55,.75)*mw*.0022);
    float m=dot(rd,uMoonDir); c+=uNight*vec3(.95,.97,1.)*(smoothstep(.99994,.99996,m)*.9+pow(max(m,0.),900.)*.01); }
  if(disk>0.){ float m=dot(rd,uSunDirT); float s=smoothstep(.999955,.999972,m); c+=uSunDisk*(s*900.+pow(max(m,0.),3000.)*2.5)*disk; }
  // cirrus sheet (optically thin, 2 fetches)
  if(rd.y>.015){ float t=(10500.-ro.y)/rd.y; vec2 p=ro.xz+rd.xz*t-uDrift*2.5; float f=smoothstep(.015,.14,rd.y);
    vec2 pw=vec2(p.x*.8+p.y*.6,p.y*.8-p.x*.6); vec4 n=textureLod(uBase,vec3(pw.x*.22,0.,pw.y).xzy/26000.,0.); vec4 k=textureLod(uBase,vec3(pw.x*.14+n.a*1600.,900.,pw.y+n.g*2600.).xzy/7400.,0.); vec4 pch=textureLod(uBase,vec3(p,2000.).xzy/71000.,0.);
    float d=smoothstep(.40,1.05,n.a*.42+k.a*.22+k.b*.2+pch.a*.5-.16)*uCirrus*f; float mu=dot(rd,uLightDir); float ph=.10+.35*pow(sat(mu*.5+.5),6.)+1.1*pow(max(mu,0.),40.);
    vec3 a=skyRad(normalize(vec3(rd.x,.5,rd.z))); c=mix(c,uSunEHigh*ph*.55+a*.8,d*.62); }
  return c;
}
`;
const COMPOSITE = HEAD + DEPTH_GLSL + SKY_GLSL + SKYCOL_GLSL + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uColor,uDepth,uAo,uVol,uVolD,uBlue; uniform vec4 uDepthK; uniform mat4 uInvVP,uCurVP; uniform vec3 uCam,uFwd; uniform vec2 uVolRes; uniform float uAoOn,uFrame; uniform vec4 uFlashSky; uniform vec3 uFlashCol;
void main(){
  vec4 w=uInvVP*vec4(vUv*2.-1.,.5,1.); vec3 rd=normalize(w.xyz/w.w-uCam); float raw=textureLod(uDepth,vUv,0.).r; float z=shLinearDepth(raw,uDepthK); float d=z/max(dot(rd,uFwd),.05);
  vec3 c; bool sky=z>59000.;
  if(sky) c=skyColor(uCam,rd,1.); else { c=min(textureLod(uColor,vUv,0.).rgb,vec3(400.)); if(uAoOn>.5){ float ao=textureLod(uAo,vUv,0.).r; float l=lum(c); c*=mix(ao,1.,sat(l*.06)); } vec4 ap=aerial(uCam,rd,d); c=c*pow(vec3(ap.a),vec3(.82,1.,1.2))+ap.rgb; }
  // the volume is already resolved at full resolution in the un-jittered frame: fetch it where this ray lands
  vec4 pc=uCurVP*vec4(uCam+rd*100.,1.); vec2 vu=pc.xy/pc.w*.5+.5;
  vec4 v=textureLod(uVol,clamp(vu,.5/uVolRes,1.-.5/uVolRes),0.);
  c=c*v.a+v.rgb;
  o=vec4(max(c,vec3(0.)),1.);
}`;
const TAA = HEAD + DEPTH_GLSL + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uCur,uHist,uDepth,uVolD,uVol; uniform vec4 uDepthK; uniform vec2 uRes,uJit; uniform mat4 uInvVP,uPrevVP; uniform vec3 uCam,uFwd; uniform float uReset,uDt;
vec3 toY(vec3 c){ return vec3(dot(c,vec3(.25,.5,.25)),dot(c,vec3(.5,0.,-.5)),dot(c,vec3(-.25,.5,-.25))); } vec3 toR(vec3 c){ float t=c.x-c.z; return vec3(t+c.y,c.x+c.z,t-c.y); }
vec3 tm(vec3 c){ return c/(1.+lum(c)); } vec3 itm(vec3 c){ return c/max(1.-lum(c),1e-3); }
vec3 hist(vec2 uv){ vec2 p=uv*uRes,c=floor(p-.5)+.5,f=p-c; vec2 w0=f*(-.5+f*(1.-.5*f)),w1=1.+f*f*(-2.5+1.5*f),w2=f*(.5+f*(2.-1.5*f)),w3=f*f*(-.5+.5*f); vec2 w12=w1+w2,p12=(c+w2/w12)/uRes,p0=(c-1.)/uRes,p3=(c+2.)/uRes; vec3 s=vec3(0.); float w=0.,k;
  #define TP(P,W) { k=W; s+=tm(textureLod(uHist,P,0.).rgb)*k; w+=k; }
  TP(vec2(p12.x,p0.y),w12.x*w0.y) TP(vec2(p0.x,p12.y),w0.x*w12.y) TP(p12,w12.x*w12.y) TP(vec2(p3.x,p12.y),w3.x*w12.y) TP(vec2(p12.x,p3.y),w12.x*w3.y) return max(s/w,vec3(0.)); }
void main(){
  ivec2 ip=ivec2(gl_FragCoord.xy); ivec2 mx=ivec2(uRes)-1; float best=1e9; vec3 m1=vec3(0.),m2=vec3(0.),cur=vec3(0.); float ws=0.; vec3 mn=vec3(9.),mxc=vec3(-9.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ ivec2 q=clamp(ip+ivec2(x,y),ivec2(0),mx); vec3 c=toY(tm(texelFetch(uCur,q,0).rgb)); m1+=c; m2+=c*c; mn=min(mn,c); mxc=max(mxc,c); float z=shLinearDepth(texelFetch(uDepth,q,0).r,uDepthK); best=min(best,z); vec2 d=vec2(float(x),float(y))+uJit; float w=exp(-3.4*dot(d,d)); cur+=c*w; ws+=w; }
  cur/=ws; m1/=9.; m2/=9.; vec3 sd=sqrt(max(m2-m1*m1,vec3(0.)));
  vec4 w=uInvVP*vec4(vUv*2.-1.,.5,1.); vec3 rd=normalize(w.xyz/w.w-uCam); float d=best/max(dot(rd,uFwd),.05);
  float va=textureLod(uVol,vUv,0.).a; float vd=textureLod(uVolD,vUv,0.).x; if(best>59000.) d=va<.6?vd:60000.;
  vec4 pc=uPrevVP*vec4(uCam+rd*d,1.); vec2 uv=pc.xy/pc.w*.5+.5;
  if(uReset>.5||pc.w<=0.||any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))){ o=vec4(texelFetch(uCur,ip,0).rgb,1.); return; }
  vec3 h=toY(hist(uv)); float g=1.1; vec3 lo=max(m1-g*sd,mn),hi=min(m1+g*sd,mxc); vec3 c=.5*(lo+hi),e=.5*(hi-lo)+1e-4; vec3 v=h-c; float k=max(max(abs(v.x/e.x),abs(v.y/e.y)),abs(v.z/e.z)); if(k>1.) h=c+v/k;
  vec2 vel=(uv-vUv)*uRes; float a=mix(.085,.2,sat(length(vel)*.5)); a=1.-pow(1.-a,clamp(uDt,.002,.1)*60.); // weights tuned at 60 fps, applied per second: same look at any frame rate // sub-pixel motion resamples the history every frame (low-pass): refresh faster while moving float lc=cur.x,lh=h.x; float dif=abs(lc-lh)/max(max(lc,lh),.15); a*=mix(1.,.6,sat(1.-dif)*.0+.0);
  vec3 r=mix(h,cur,a); o=vec4(itm(max(toR(r),vec3(0.))),1.);
}`;
const COPY = HEAD + /* glsl */`in vec2 vUv; out vec4 o; uniform sampler2D uT,uDepth; void main(){ o=textureLod(uT,vUv,0.); gl_FragDepth=textureLod(uDepth,vUv,0.).r; }`;
const BLIT = HEAD + /* glsl */`in vec2 vUv; out vec4 o; uniform sampler2D uT; void main(){ o=textureLod(uT,vUv,0.); }`;
const DOWN = HEAD + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uT; uniform vec2 uPx; uniform float uFirst;
vec3 S(vec2 d){ return min(textureLod(uT,vUv+d*uPx,0.).rgb,vec3(300.)); }
float kw(vec3 c){ return 1./(1.+lum(c)); }
void main(){
  vec3 a=S(vec2(-2,-2)),b=S(vec2(0,-2)),c=S(vec2(2,-2)),d=S(vec2(-2,0)),e=S(vec2(0)),f=S(vec2(2,0)),g=S(vec2(-2,2)),h=S(vec2(0,2)),i=S(vec2(2,2)),j=S(vec2(-1,-1)),k=S(vec2(1,-1)),l=S(vec2(-1,1)),m=S(vec2(1,1));
  if(uFirst>.5){ vec3 q0=(a+b+d+e)*.25,q1=(b+c+e+f)*.25,q2=(d+e+g+h)*.25,q3=(e+f+h+i)*.25,q4=(j+k+l+m)*.25; float w0=kw(q0)*.125,w1=kw(q1)*.125,w2=kw(q2)*.125,w3=kw(q3)*.125,w4=kw(q4)*.5; o=vec4((q0*w0+q1*w1+q2*w2+q3*w3+q4*w4)/(w0+w1+w2+w3+w4),1.); }
  else o=vec4((a+c+g+i)*.03125+(b+d+f+h)*.0625+(e+j+k+l+m)*.125,1.);
}`;
const UP = HEAD + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uT; uniform vec2 uPx; uniform float uW;
void main(){ vec3 s=vec3(0.); s+=textureLod(uT,vUv+vec2(-1,-1)*uPx,0.).rgb+textureLod(uT,vUv+vec2(1,-1)*uPx,0.).rgb+textureLod(uT,vUv+vec2(-1,1)*uPx,0.).rgb+textureLod(uT,vUv+vec2(1,1)*uPx,0.).rgb; s+=2.*(textureLod(uT,vUv+vec2(0,-1)*uPx,0.).rgb+textureLod(uT,vUv+vec2(0,1)*uPx,0.).rgb+textureLod(uT,vUv+vec2(1,0)*uPx,0.).rgb+textureLod(uT,vUv+vec2(-1,0)*uPx,0.).rgb); s+=4.*textureLod(uT,vUv,0.).rgb; o=vec4(s/16.*uW,1.); }`;
const EXPO = HEAD + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uT,uPrev; uniform float uDt,uReset,uMin,uMax,uKey;
void main(){ float s=0.,w=0.; for(int y=0;y<12;y++)for(int x=0;x<16;x++){ vec2 u=(vec2(float(x),float(y))+.5)/vec2(16.,12.); float l=lum(textureLod(uT,u,0.).rgb); float k=1.-.55*length((u-vec2(.5,.42))*vec2(1.3,1.2)); k=max(k,.15); s+=log(max(l,1e-5))*k; w+=k; }
  float L=exp(s/w); float key=uKey*mix(.55,1.35,smoothstep(-7.,1.5,log2(L))); float e=clamp(key/L,uMin,uMax); float p=textureLod(uPrev,vec2(.5),0.).r; float sp=e<p?2.6:1.1; e=uReset>.5?e:p+(e-p)*(1.-exp(-uDt*sp)); o=vec4(e,L,0.,1.); }`;
const FINAL = HEAD + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uT,uBloom,uExp; uniform vec2 uRes; uniform float uTime,uGrain,uBloomW,uAspect,uEV,uMud,uDrops,uCA,uVig,uNight,uGreen,uSharp,uHurt; uniform vec3 uTint;
// AgX (Troy Sobotka), polynomial fit by Benjamin Wrensch
vec3 agx(vec3 v){ const mat3 M=mat3(.842479062253094,.0423282422610123,.0423756549057051,.0784335999999992,.878468636469772,.0784336,.0792237451477643,.0791661274605434,.879142973793104); v=M*v; v=clamp(log2(max(v,vec3(1e-10))),-12.47393,4.026069); v=(v+12.47393)/(4.026069+12.47393); vec3 x2=v*v,x4=x2*x2; return 15.5*x4*x2-40.14*x4*v+31.96*x4-6.868*x2*v+.4298*x2+.1191*v-.00232; }
vec3 agxEotf(vec3 v){ const mat3 M=mat3(1.19687900512017,-.0528968517574562,-.0529716355144438,-.0980208811401368,1.15190312990417,-.0980434501171241,-.0990297440797205,-.0989611768448433,1.15107367264116); return M*v; }
vec3 look(vec3 c){ float l=lum(c); c=pow(max(c,vec3(0.)),vec3(1.28)); c*=1.07; l=lum(c); return max(l+(c-l)*1.28,vec3(0.)); }
vec3 tonemap(vec3 c){ c=agx(c); c=look(c); c=agxEotf(c); return sat3(c); }
// lens drops: returns refraction offset + mask
vec3 drops(vec2 uv,float amt){
  vec3 r=vec3(0.); for(int L=0;L<3;L++){ float sc=L==0?7.:L==1?13.:24.; vec2 p=uv*vec2(uAspect,1.)*sc; p.y+=L==0?uTime*.12*0.:0.; vec2 i=floor(p); vec2 f=fract(p)-.5; vec2 h=vec2(hash12(i+float(L)*17.),hash12(i*1.7+31.+float(L)*7.)); float ph=fract(h.x*7.+uTime*(.05+.11*h.y)); float life=smoothstep(0.,.06,ph)*smoothstep(1.,.35,ph); if(h.x*.93+.07>amt) continue; vec2 c=(h-.5)*.5; if(L==0) c.y-=smoothstep(.5,1.,ph)*.5; vec2 d=f-c; d.x*=1.+.25*sin(h.y*40.); float R=(.14+.2*h.y)*life; float m=smoothstep(R,R*.75,length(d)); r+=vec3(-d/max(R,.01)*m*.035*(L==0?1.5:1.),m); } return r; }
void main(){
  vec2 uv=vUv; float wet=0.; float mask=0.;
  if(uDrops>.01){ vec3 d=drops(uv,uDrops*.6); uv+=d.xy; mask=d.z; }
  vec2 cc=uv-.5; float r2=dot(cc*vec2(uAspect,1.),cc*vec2(uAspect,1.)); vec2 ca=cc*r2*uCA;
  vec3 c; c.g=textureLod(uT,uv,0.).g; c.r=textureLod(uT,uv+ca,0.).r; c.b=textureLod(uT,uv-ca,0.).b;
  if(uSharp>0.){ vec2 e=1./uRes; vec3 n=textureLod(uT,uv+vec2(0,e.y),0.).rgb,s=textureLod(uT,uv-vec2(0,e.y),0.).rgb,E=textureLod(uT,uv+vec2(e.x,0),0.).rgb,W=textureLod(uT,uv-vec2(e.x,0),0.).rgb; vec3 mn=min(c,min(min(n,s),min(E,W))),mx=max(c,max(max(n,s),max(E,W))); vec3 sh=c+(c-(n+s+E+W)*.25)*uSharp; c=clamp(sh,mix(mn,c,-.1),mix(mx,c,-.1)); c=max(c,vec3(0.)); }
  vec3 bl=textureLod(uBloom,uv,0.).rgb*.27; c=mix(c,bl,uBloomW*(1.+mask*.5));
  if(uMud>.01){ vec2 p=vUv*vec2(uAspect,1.)*5.; float m=0.; for(int k=0;k<3;k++){ vec2 i=floor(p),f=fract(p)-.5; vec2 h=vec2(hash12(i+77.),hash12(i+191.)); float R=.1+.3*h.y*h.y; float a=atan(f.y-(h.y-.5)*.5,f.x-(h.x-.5)*.5); float l=length(f-(h.yx-.5)*.5)*(1.+.2*sin(a*5.+h.x*20.)+.12*sin(a*11.)); m=max(m,smoothstep(R,R*.6,l)*step(h.x,uMud)); p*=2.1; } c*=1.-m*.9*min(uMud*1.5,1.); }
  float vg=1.-uVig*smoothstep(.12,1.25,r2); c*=vg;
  c*=textureLod(uExp,vec2(.5),0.).r*uEV;
  c*=uTint; { float l=lum(c); c=mix(c,vec3(l)*vec3(.82,.95,1.18),uNight*.38*smoothstep(.25,.0,l)); c=mix(c,c*vec3(.93,1.04,.95),uGreen); }
  c=tonemap(c);
  if(uHurt>.001) c=mix(c,vec3(lum(c))*vec3(.9,.25,.2),uHurt*smoothstep(.05,.7,r2));
  c=c*c*c*(c*(c*6.-15.)+10.)*.10+c*.90; // gentle S-curve
  float g=(hash12(gl_FragCoord.xy+fract(uTime*7.13)*431.)+hash12(gl_FragCoord.xy*1.3+fract(uTime*3.7)*211.)-1.); c+=g*uGrain*(.35+.65*(1.-lum(c)))+ (ign(gl_FragCoord.xy)-.5)/255.;
  o=vec4(sat3(c),1.);
}`.replace('in vec2 vUv;', 'vec3 sat3(vec3 c){ return clamp(c,vec3(0.),vec3(1.)); }\nin vec2 vUv;');
const FXAA = HEAD + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uT; uniform vec2 uPx;
void main(){ vec3 M=textureLod(uT,vUv,0.).rgb; float lM=lum(M),lNW=lum(textureLod(uT,vUv+vec2(-.5,-.5)*uPx,0.).rgb),lNE=lum(textureLod(uT,vUv+vec2(.5,-.5)*uPx,0.).rgb),lSW=lum(textureLod(uT,vUv+vec2(-.5,.5)*uPx,0.).rgb),lSE=lum(textureLod(uT,vUv+vec2(.5,.5)*uPx,0.).rgb);
  float mn=min(lM,min(min(lNW,lNE),min(lSW,lSE))),mx=max(lM,max(max(lNW,lNE),max(lSW,lSE))); if(mx-mn<max(.035,mx*.10)){ o=vec4(M,1.); return; }
  vec2 d=vec2(-((lNW+lNE)-(lSW+lSE)),((lNW+lSW)-(lNE+lSE))); float r=max((lNW+lNE+lSW+lSE)*.03125,.0078125); float rc=1./(min(abs(d.x),abs(d.y))+r); d=clamp(d*rc,-8.,8.)*uPx;
  vec3 A=.5*(textureLod(uT,vUv+d*(1./3.-.5),0.).rgb+textureLod(uT,vUv+d*(2./3.-.5),0.).rgb); vec3 B=A*.5+.25*(textureLod(uT,vUv-d*.5,0.).rgb+textureLod(uT,vUv+d*.5,0.).rgb); float lB=lum(B); o=vec4(lB<mn||lB>mx?A:B,1.); }`;
const ENV = HEAD + SKY_GLSL + SKYCOL_GLSL + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uVol; uniform vec3 uCam,uGroundRad;
void main(){ float az=(vUv.x-.5)*2.*PI, el=(vUv.y-.5)*PI; vec3 rd=vec3(cos(az)*cos(el),sin(el),sin(az)*cos(el)); vec3 c=rd.y>0.?skyColor(uCam,rd,0.):mix(skyRad(normalize(vec3(rd.x,.02,rd.z))),uGroundRad,smoothstep(0.,-.12,rd.y)); vec4 v=textureLod(uVol,vUv,0.); c=c*v.a+v.rgb; o=vec4(min(c,vec3(40.)),1.); }`;

export class Post {
  constructor(renderer, shared) {
    this.r = renderer; const s = this.s = shared, V2 = () => new THREE.Vector2();
    const cam = { uInvVP: s.invVP, uCam: s.cam, uFwd: s.fwd, uDepthK: s.depthK };
    const sky = { ...s.atmU, uBase: { value: s.noise.base }, uSunDirT: { value: s.atm.sunDir }, uMoonDir: { value: s.atm.moonDir }, uSunDisk: { value: s.atm.sunE }, uSunE: { value: s.atm.lightE }, uSunEHigh: { value: s.atm.lightEHigh }, uLightDir: { value: s.atm.lightDir }, uTime: { value: 0 }, uNight: { value: 0 }, uCirrus: { value: 0.6 }, uDrift: { value: V2() } };
    this.skyU = sky;
    this.mAo = fsMaterial(AO, { uDepth: { value: null }, uDepthK: s.depthK, uProjK: { value: new THREE.Vector4() }, uRes: { value: V2() }, uFrame: { value: 0 } });
    this.mAoB = fsMaterial(AOBLUR, { uT: { value: null }, uDir: { value: V2() } });
    this.mComp = fsMaterial(COMPOSITE, { ...cam, ...sky, uCurVP: s.curVP, uColor: { value: null }, uDepth: { value: null }, uAo: { value: null }, uVol: { value: null }, uVolD: { value: null }, uBlue: { value: s.blue }, uVolRes: { value: V2() }, uAoOn: { value: 1 }, uFrame: { value: 0 }, uFlashSky: { value: new THREE.Vector4() }, uFlashCol: { value: new THREE.Vector3() } });
    // un-jittered inverse: the resolved pixel is un-jittered, so reprojecting through the jittered matrix shifted the history by the jitter every frame (smear)
    this.mTaa = fsMaterial(TAA, { uDt: { value: 1 / 60 }, ...cam, uInvVP: s.invVPu, uCur: { value: null }, uHist: { value: null }, uDepth: { value: null }, uVolD: { value: null }, uVol: { value: null }, uRes: { value: V2() }, uJit: { value: V2() }, uPrevVP: { value: new THREE.Matrix4() }, uReset: { value: 1 } });
    this.mCopy = fsMaterial(COPY, { uT: { value: null }, uDepth: { value: null } }, { depthWrite: true });
    this.mBlit = fsMaterial(BLIT, { uT: { value: null } });
    this.mDown = fsMaterial(DOWN, { uT: { value: null }, uPx: { value: V2() }, uFirst: { value: 0 } });
    this.mUp = fsMaterial(UP, { uT: { value: null }, uPx: { value: V2() }, uW: { value: 1 } }, { blending: THREE.CustomBlending });
    Object.assign(this.mUp, { blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation });
    this.mExp = fsMaterial(EXPO, { uT: { value: null }, uPrev: { value: null }, uDt: { value: 0.016 }, uReset: { value: 1 }, uMin: { value: 0.05 }, uMax: { value: 14 }, uKey: { value: 0.17 } });
    this.mFinal = fsMaterial(FINAL, { uT: { value: null }, uBloom: { value: null }, uExp: { value: null }, uRes: { value: V2() }, uTime: { value: 0 }, uGrain: { value: 0.02 }, uBloomW: { value: 0.05 }, uAspect: { value: 1.7 }, uEV: { value: 1 }, uMud: { value: 0 }, uDrops: { value: 0 }, uCA: { value: 0.0016 }, uVig: { value: 0.28 }, uNight: { value: 0 }, uGreen: { value: 0 }, uSharp: { value: 0 }, uHurt: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) } });
    this.mFx = fsMaterial(FXAA, { uT: { value: null }, uPx: { value: V2() } });
    this.mEnv = fsMaterial(ENV, { ...sky, uVol: { value: null }, uCam: s.cam, uGroundRad: s.groundRad });
    this.exp = [hdrRT(1, 1), hdrRT(1, 1)]; this.expI = 0; this.resetExp = true;
    this.env = new THREE.WebGLRenderTarget(512, 256, { type: THREE.HalfFloatType, depthBuffer: false, wrapS: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.env.texture.mapping = THREE.EquirectangularReflectionMapping;
  }
  resize(w, h) {
    if (this.w === w && this.h === h) return; this.w = w; this.h = h;
    const oldH = this.hist0;
    for (const t of [this.ao0, this.ao1, this.comp, this.hist1, this.hdr, this.ldr, ...(this.mips || [])]) t?.dispose();
    const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
    this.ao0 = hdrRT(hw, hh, { format: THREE.RGFormat }); this.ao1 = hdrRT(hw, hh, { format: THREE.RGFormat });
    this.comp = hdrRT(w, h); this.hist0 = hdrRT(w, h); this.hist1 = hdrRT(w, h);
    // resample the TAA history on (dynamic) resolution changes rather than restarting from an aliased frame
    if (oldH) { this.mBlit.uniforms.uT.value = oldH.texture; draw(this.r, this.mBlit, this.hist0); oldH.dispose(); }
    const d = new THREE.DepthTexture(w, h, THREE.FloatType); d.format = THREE.DepthFormat;
    this.hdr = hdrRT(w, h, { extra: { depthBuffer: true, depthTexture: d } });
    this.ldr = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.mips = []; let mw = w, mh = h; for (let i = 0; i < 6; i++) { mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); this.mips.push(hdrRT(mw, mh)); }
    if (!oldH) this.reset = true;
  }
  ao(depth, P, frame) {
    const u = this.mAo.uniforms; u.uDepth.value = depth; u.uRes.value.set(this.ao0.width, this.ao0.height); u.uFrame.value = frame % 64; u.uProjK.value.set(1 / P[0], 1 / P[5], P[8], P[9]);
    draw(this.r, this.mAo, this.ao0);
    const b = this.mAoB.uniforms; b.uT.value = this.ao0.texture; b.uDir.value.set(1 / this.ao0.width, 0); draw(this.r, this.mAoB, this.ao1); b.uT.value = this.ao1.texture; b.uDir.value.set(0, 1 / this.ao0.height); draw(this.r, this.mAoB, this.ao0);
  }
  composite(color, depth, vol, aoOn) {
    const u = this.mComp.uniforms; u.uColor.value = color; u.uDepth.value = depth; u.uAo.value = this.ao0.texture; u.uAoOn.value = aoOn ? 1 : 0; u.uVol.value = vol.out.textures[0]; u.uVolD.value = vol.out.textures[1]; u.uVolRes.value.set(vol.w, vol.h);
    draw(this.r, this.mComp, this.comp);
  }
  taa(depth, vol, prevVP, jx, jy) { this.mTaa.uniforms.uDt.value = this.dt ?? 1 / 60;
    const u = this.mTaa.uniforms; u.uCur.value = this.comp.texture; u.uHist.value = this.hist0.texture; u.uDepth.value = depth; u.uVolD.value = vol.out.textures[1]; u.uVol.value = vol.out.textures[0]; u.uRes.value.set(this.w, this.h); u.uJit.value.set(jx, jy); u.uPrevVP.value.copy(prevVP); u.uReset.value = this.reset ? 1 : 0; this.reset = false;
    draw(this.r, this.mTaa, this.hist1); const t = this.hist0; this.hist0 = this.hist1; this.hist1 = t; return this.hist0.texture;
  }
  toHdr(tex, depth) { this.mCopy.uniforms.uT.value = tex; this.mCopy.uniforms.uDepth.value = depth; draw(this.r, this.mCopy, this.hdr); }
  bloom(dt, on) {
    const d = this.mDown.uniforms, m = this.mips; let src = this.hdr.texture, w = this.w, h = this.h;
    for (let i = 0; i < m.length; i++) { d.uT.value = src; d.uPx.value.set(1 / w, 1 / h); d.uFirst.value = i === 0 ? 1 : 0; draw(this.r, this.mDown, m[i]); src = m[i].texture; w = m[i].width; h = m[i].height; }
    const e = this.mExp.uniforms; e.uT.value = m[4].texture; e.uPrev.value = this.exp[this.expI].texture; e.uDt.value = dt; e.uReset.value = this.resetExp ? 1 : 0; this.resetExp = false; this.expI ^= 1; draw(this.r, this.mExp, this.exp[this.expI]);
    if (!on) return;
    const u = this.mUp.uniforms, r = this.r, ac = r.autoClear; r.autoClear = false;
    for (let i = m.length - 1; i > 0; i--) { u.uT.value = m[i].texture; u.uPx.value.set(1 / m[i].width, 1 / m[i].height); u.uW.value = 0.85; draw(r, this.mUp, m[i - 1]); }
    r.autoClear = ac;
  }
  final(target, o) {
    const f = this.mFinal.uniforms; f.uT.value = this.hdr.texture; f.uBloom.value = this.mips[0].texture; f.uExp.value = this.exp[this.expI].texture; f.uRes.value.set(this.w, this.h); f.uAspect.value = this.w / this.h;
    draw(this.r, this.mFinal, this.ldr);
    // with TAA the image is already anti-aliased: FXAA on top only softened distant detail, so just upscale/blit
    if (o?.taa) { this.mBlit.uniforms.uT.value = this.ldr.texture; draw(this.r, this.mBlit, target); return; }
    this.mFx.uniforms.uT.value = this.ldr.texture; this.mFx.uniforms.uPx.value.set(1 / this.w, 1 / this.h); draw(this.r, this.mFx, target);
    void o;
  }
  envMap(volTex) { this.mEnv.uniforms.uVol.value = volTex; draw(this.r, this.mEnv, this.env); return this.env.texture; }
}

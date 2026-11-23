// Physically based sky (transmittance / multi-scatter / sky-view LUTs), aerial perspective LUT, sun + moon ephemeris
import * as THREE from 'three';
import { HEAD, SKY_GLSL } from './glsl.js';
import { fsMaterial, draw, hdrRT } from './pass.js';

export const E0 = 20;           // solar irradiance at top of atmosphere (scene units)
const ATM = /* glsl */`
const float RG=6360., RT=6460.;
const vec3 RAY=vec3(5.802,13.558,33.1)*1e-3; const vec3 OZO=vec3(.650,1.881,.085)*1e-3;
uniform float uMie;
void medium(float h, out vec3 sR, out float sM, out vec3 ext){
  sR=RAY*exp(-h/8.); float d=exp(-h/1.2); sM=3.996e-3*uMie*d; float aM=.6e-3*uMie*d;
  ext=sR+sM+aM+OZO*max(0.,1.-abs(h-25.)/15.);
}
float raySphere(vec2 o, float mu, float R){ // o.x = r ; returns far root or -1
  float r=o.x; float d=r*r*(mu*mu-1.)+R*R; if(d<0.) return -1.; return max(0.,-r*mu+sqrt(d));
}
float rayGround(float r,float mu){ float d=r*r*(mu*mu-1.)+RG*RG; if(d<0.||mu>=0.) return -1.; float t=-r*mu-sqrt(d); return t; }
vec2 tUv(float h,float mu){ return vec2(.5+.5*atan(mu*5.)/atan(5.), sqrt(sat(h/100.))); }
`;
const TRANS = HEAD + ATM + /* glsl */`
in vec2 vUv; out vec4 o;
void main(){
  float mu=tan((vUv.x*2.-1.)*atan(5.))/5.; float h=vUv.y*vUv.y*100.; float r=RG+h+.001;
  if(rayGround(r,mu)>0. && mu<-.12){ o=vec4(0.); return; }
  float tm=raySphere(vec2(r,0.),mu,RT); vec3 od=vec3(0.); const int N=40; float dt=tm/float(N);
  for(int i=0;i<N;i++){ float t=(float(i)+.5)*dt; float hh=max(0.,sqrt(r*r+t*t+2.*r*mu*t)-RG); vec3 a,e; float m; medium(hh,a,m,e); od+=e*dt; }
  o=vec4(exp(-od),1.);
}`;
const SCATTER = /* glsl */`
uniform sampler2D uTrans, uMs;
vec3 transm(float h,float mu){ return textureLod(uTrans,tUv(h,mu),0.).rgb; }
`;
const MS = HEAD + ATM + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uTrans;
vec3 transm(float h,float mu){ return textureLod(uTrans,tUv(h,mu),0.).rgb; }
void main(){
  float muS=vUv.x*2.-1.; float h=vUv.y*100.; float r=RG+h+.01; vec3 up=vec3(0,1,0); vec3 s=vec3(sqrt(1.-muS*muS),muS,0.);
  vec3 L=vec3(0.),F=vec3(0.);
  for(int i=0;i<48;i++){
    float y=1.-(float(i)+.5)/24.; float ph=float(i)*2.39996; vec3 d=vec3(sqrt(1.-y*y)*cos(ph),y,sqrt(1.-y*y)*sin(ph));
    float tg=rayGround(r,d.y); float tm=tg>0.?tg:raySphere(vec2(r,0.),d.y,RT); float dt=tm/16.; vec3 T=vec3(1.);
    for(int k=0;k<16;k++){ float t=(float(k)+.5)*dt; vec3 p=vec3(0,r,0)+d*t; float rr=length(p); float hh=max(0.,rr-RG); vec3 sR,e; float sM; medium(hh,sR,sM,e);
      float mu=dot(p/rr,s); vec3 sc=sR+sM; vec3 st=exp(-e*dt); vec3 Ts=transm(hh,mu); vec3 ii=(1.-st)/max(e,vec3(1e-6)); L+=T*sc*Ts*ii/(4.*PI); F+=T*sc*ii; T*=st; }
    if(tg>0.){ vec3 p=vec3(0,r,0)+d*tg; float mu=dot(normalize(p),s); L+=T*transm(0.,mu)*max(mu,0.)*.18/PI; }
  }
  L/=48.; F/=48.; o=vec4(L/(1.-F*.96),1.);
}`;
const SKYV = HEAD + ATM + SCATTER + /* glsl */`
in vec2 vUv; out vec4 o; uniform vec3 uS0,uS1,uE0,uE1; uniform float uH;
float hg(float c,float g){ return (1.-g*g)/(4.*PI*pow(1.+g*g-2.*g*c,1.5)); }
void main(){
  float az=(vUv.x-.5)*2.*PI; float v=vUv.y*2.-1.; float el=sign(v)*v*v*PI*.5; vec3 d=vec3(cos(az)*cos(el),sin(el),sin(az)*cos(el));
  float r=RG+uH; float tg=rayGround(r,d.y); float tm=tg>0.?tg:raySphere(vec2(r,0.),d.y,RT);
  float c0=dot(d,uS0),c1=dot(d,uS1); float pr0=3./(16.*PI)*(1.+c0*c0),pr1=3./(16.*PI)*(1.+c1*c1);
  float pm0=mix(hg(c0,.76),hg(c0,-.1),.18),pm1=mix(hg(c1,.76),hg(c1,-.1),.18);
  vec3 L=vec3(0.),T=vec3(1.); float tp=0.; const int N=28;
  for(int i=0;i<N;i++){
    float f=(float(i)+1.)/float(N); float t1=tm*f*f; float dt=t1-tp; float t=tp+dt*.4; tp=t1;
    vec3 p=vec3(0,r,0)+d*t; float rr=length(p); float h=max(0.,rr-RG); vec3 sR,e; float sM; medium(h,sR,sM,e);
    vec3 up=p/rr; float m0=dot(up,uS0),m1=dot(up,uS1);
    vec3 T0=transm(h,m0)*smoothstep(-.06,.0,m0+sqrt(h*.0003)), T1=transm(h,m1);
    vec3 ms0=textureLod(uMs,vec2(m0*.5+.5,h/100.),0.).rgb, ms1=textureLod(uMs,vec2(m1*.5+.5,h/100.),0.).rgb;
    vec3 S=uE0*(T0*(sR*pr0+sM*pm0)+(sR+sM)*ms0)+uE1*(T1*(sR*pr1+sM*pm1)+(sR+sM)*ms1);
    vec3 st=exp(-e*dt); L+=T*S*(1.-st)/max(e,vec3(1e-6)); T*=st;
  }
  if(tg>0.){ vec3 p=vec3(0,r,0)+d*tg; float m0=max(dot(normalize(p),uS0),0.); L+=T*(uE0*transm(0.,m0)*m0)*vec3(.12,.12,.08)/PI; }
  // airglow / starlight floor so night is never pure black
  L+=vec3(.00035,.00045,.0007)*(.6+.4*exp(-abs(d.y)*4.));
  o=vec4(min(L,vec3(60.)),1.);
}`;
const AERIAL = HEAD + SKY_GLSL + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uCloudShadow; uniform vec4 uCsXf; uniform vec3 uCam,uSunDir,uLight; uniform float uBeta,uJit;
void main(){
  float az=(vUv.x-.5)*2.*PI; vec3 d=vec3(cos(az),0.,sin(az)); float D=vUv.y*vUv.y*uHazeK.w;
  vec3 hor=(skyRad(normalize(vec3(d.x,.035,d.z)))*.6+skyRad(normalize(vec3(d.x,.12,d.z)))*.4);
  vec3 grey=mix(vec3(lum(hor)),hor,.72);
  vec3 L=vec3(0.); float T=1.; const int N=20; float tp=0.;
  for(int i=0;i<N;i++){ float f=(float(i)+1.)/float(N); float t1=D*f*f; float dt=t1-tp; float t=tp+dt*fract(.5+uJit*.0); tp=t1;
    vec2 p=uCam.xz+d.xz*t; vec2 uv=(p-uCsXf.xy)*uCsXf.z+.5; vec2 e=abs(uv-.5); float k=smoothstep(.5,.42,max(e.x,e.y));
    vec4 cs=textureLod(uCloudShadow,uv,1.5); float sh=mix(1.,cs.r,k), op=mix(1.,cs.g,k);
    float st=exp(-uBeta*dt); L+=T*(1.-st)*mix(grey*.36,hor,mix(op*.65,1.,sh*.75)); T*=st; }
  o=vec4(L,T);
}`;

const DEG = Math.PI / 180;
export class Atmosphere {
  constructor(renderer) {
    this.r = renderer;
    this.trans = hdrRT(256, 64); this.ms = hdrRT(32, 32);
    this.sky = hdrRT(256, 144, { wrapS: THREE.RepeatWrapping }); this.aerialRT = hdrRT(192, 48, { wrapS: THREE.RepeatWrapping });
    this.mie = { value: 2.2 };
    this.mT = fsMaterial(TRANS, { uMie: this.mie });
    this.mMs = fsMaterial(MS, { uMie: this.mie, uTrans: { value: this.trans.texture } });
    this.mSky = fsMaterial(SKYV, { uMie: this.mie, uTrans: { value: this.trans.texture }, uMs: { value: this.ms.texture }, uS0: { value: new THREE.Vector3() }, uS1: { value: new THREE.Vector3() }, uE0: { value: new THREE.Vector3() }, uE1: { value: new THREE.Vector3() }, uH: { value: 0.4 } });
    this.sunDir = new THREE.Vector3(); this.moonDir = new THREE.Vector3(); this.lightDir = new THREE.Vector3();
    this.sunE = new THREE.Vector3(); this.sunEHigh = new THREE.Vector3(); this.lightE = new THREE.Vector3(); this.lightEHigh = new THREE.Vector3(); this.lightEMid = new THREE.Vector3();
    this.night = 0; this.dirty = true; this._lastKey = null;
    this.hazeK = new THREE.Vector4(1 / 1300, 0, 0, 60000);
    this.beta = 9e-5;
    this.u = { uSkyLut: { value: this.sky.texture }, uAerialLut: { value: this.aerialRT.texture }, uHazeK: { value: this.hazeK } };
  }
  initAerial(shadowTex, csXf, cam) {
    this.mAer = fsMaterial(AERIAL, { ...this.u, uAerialLut: { value: null }, uCloudShadow: { value: shadowTex }, uCsXf: { value: csXf }, uCam: { value: cam }, uSunDir: { value: this.lightDir }, uLight: { value: this.lightE }, uBeta: { value: this.beta }, uJit: { value: 0 } });
  }
  init() { draw(this.r, this.mT, this.trans); draw(this.r, this.mMs, this.ms); this.ready = true; }
  // transmittance from altitude h (km) toward elevation mu, same constants as the shader
  transmittance(h, mu, out) {
    const RG = 6360, RT = 6460, r = RG + h + 0.001; const disc = r * r * (mu * mu - 1) + RG * RG;
    if (mu < 0 && disc > 0) return out.set(0, 0, 0);
    const tm = -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + RT * RT)), N = 28, dt = tm / N; let x = 0, y = 0, z = 0; const M = this.mie.value;
    for (let i = 0; i < N; i++) {
      const f0 = i / N, f1 = (i + 1) / N, t0 = tm * f0 * f0, t1 = tm * f1 * f1, t = (t0 + t1) / 2, d = t1 - t0, hh = Math.max(0, Math.sqrt(r * r + t * t + 2 * r * mu * t) - RG), eR = Math.exp(-hh / 8), eM = Math.exp(-hh / 1.2) * 4.596e-3 * M, o = Math.max(0, 1 - Math.abs(hh - 25) / 15);
      x += (5.802e-3 * eR + eM + 0.65e-3 * o) * d; y += (13.558e-3 * eR + eM + 1.881e-3 * o) * d; z += (33.1e-3 * eR + eM + 0.085e-3 * o) * d;
    }
    void dt;
    return out.set(Math.exp(-x), Math.exp(-y), Math.exp(-z));
  }
  // latitude 37 N, declination of late May
  static sunPos(hour, out, lat = 37 * DEG, dec = 21 * DEG) {
    const H = (hour - 12) * 15 * DEG, sEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    const east = -Math.cos(dec) * Math.sin(H), north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H);
    return out.set(east, sEl, -north).normalize();
  }
  update(hour, camY) {
    Atmosphere.sunPos(hour, this.sunDir);
    Atmosphere.sunPos(hour + 11.2, this.moonDir, 37 * DEG, -12 * DEG);
    const el = Math.asin(this.sunDir.y) / DEG;
    const T = this.transmittance(0.3, Math.max(this.sunDir.y, 0.004), this.sunE), fade = THREE.MathUtils.smoothstep(el, -2.2, 0.8);
    T.multiplyScalar(E0 * fade);
    // altitude dip: cloud tops keep the sun until about -3.5 degrees
    this.transmittance(9.5, Math.max(this.sunDir.y + 0.054, 0.002), this.sunEHigh).multiplyScalar(E0 * THREE.MathUtils.smoothstep(el, -4.5, -1.5));
    const moonUp = THREE.MathUtils.smoothstep(this.moonDir.y, 0.02, 0.25), dark = THREE.MathUtils.smoothstep(-el, 4, 9), moonE = 0.17 * moonUp;
    this.night = dark;
    const useMoon = el < -5;
    if (useMoon) { this.lightDir.copy(this.moonDir); if (this.lightDir.y < 0.12) { this.lightDir.y = 0.12; this.lightDir.normalize(); } this.lightE.set(0.62, 0.78, 1).multiplyScalar(moonE * dark); this.lightEHigh.copy(this.lightE); }
    else { this.lightDir.copy(this.sunDir); this.lightE.copy(this.sunE); this.lightEHigh.copy(this.sunEHigh); if (this.lightDir.y < 0.03) { this.lightDir.y = 0.03; this.lightDir.normalize(); } }
    const key = Math.round(hour * 600) + (useMoon ? 0.5 : 0);
    if (key !== this._lastKey) {
      this._lastKey = key; const u = this.mSky.uniforms;
      u.uS0.value.copy(this.sunDir); u.uS1.value.copy(this.moonDir); u.uE0.value.set(E0, E0, E0); u.uE1.value.set(0.62, 0.78, 1).multiplyScalar(moonE * 1.4 * dark);
      draw(this.r, this.mSky, this.sky); this.skyVersion = (this.skyVersion || 0) + 1;
    }
    this.hazeK.y = camY;
  }
  updateAerial(frame) { if (this.mAer) { this.mAer.uniforms.uBeta.value = this.beta; this.mAer.uniforms.uJit.value = (frame * 0.618) % 1; draw(this.r, this.mAer, this.aerialRT); } }
}

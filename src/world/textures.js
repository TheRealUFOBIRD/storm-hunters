// GPU generated tiling PBR texture arrays.  albedo array: rgb = sqrt(linear albedo), a = height.  normal array: rg = normal xy, b = roughness, a = ao
import * as THREE from 'three';
export const L = { grass: 0, dry: 1, dirt: 2, plowed: 3, gravel: 4, sand: 5, rock: 6, snow: 7, forest: 8, crop: 9, asphalt: 10, concrete: 11, wheat: 12, count: 13 };
export const BL = { siding: 0, planks: 1, brick: 2, stucco: 3, corrugated: 4, shingle: 5, concrete: 6, curtain: 7, wood: 8, bark: 9, pinebark: 10, stone: 11, paint: 12, block: 13, tar: 14, rust: 15, glass: 16, office: 17, count: 18 };

const COMMON = /* glsl */`
precision highp float; precision highp int; varying vec2 vUv; uniform float uSize;
uint uh(uvec2 p){ p = p*uvec2(374761393u,668265263u); uint h=p.x+p.y; h=(h^(h>>13u))*1274126177u; return h^(h>>16u);}
float h1(vec2 c,float per,float s){ c=mod(c,per); return float(uh(uvec2(ivec2(c)+ivec2(int(s)*131,int(s)*57))&0xffffffu)&0xffffu)/65535.;}
vec2 h2(vec2 c,float per,float s){ return vec2(h1(c,per,s),h1(c,per,s+31.)); }
float vn(vec2 p,float per,float s){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h1(i,per,s),h1(i+vec2(1,0),per,s),f.x),mix(h1(i+vec2(0,1),per,s),h1(i+vec2(1,1),per,s),f.x),f.y);}
float fb(vec2 uv,float f0,float s){ float a=.5,r=0.,f=f0; for(int i=0;i<6;i++){ r+=a*vn(uv*f,f,s+float(i)*7.); a*=.5; f*=2.; } return r; }
float rid(vec2 uv,float f0,float s){ float a=.5,r=0.,f=f0; for(int i=0;i<5;i++){ float n=1.-abs(vn(uv*f,f,s+float(i)*7.)*2.-1.); r+=a*n*n; a*=.5; f*=2.; } return r; }
// worley: x=F1 y=F2 z=id
vec3 wor(vec2 uv,float per,float s){ vec2 p=uv*per,i=floor(p),f=p-i; float a=9.,b=9.,id=0.; for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y),o=h2(i+g,per,s); vec2 d=g+o-f; float q=dot(d,d); if(q<a){b=a;a=q;id=h1(i+g,per,s+9.);} else if(q<b) b=q; } return vec3(sqrt(a),sqrt(b),id); }
// strokes: thin blades. returns height(0..1), id
vec2 strokes(vec2 uv,float per,float s,float len,float wid,float align){ vec2 p=uv*per,i=floor(p),f=p-i; vec2 best=vec2(0.); for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y),o=h2(i+g,per,s); float r=h1(i+g,per,s+3.); float an=(r-.5)*6.283*align+1.57*(1.-align); vec2 dir=vec2(cos(an),sin(an)),d=f-g-o+dir*len*.5; float t=clamp(dot(d,dir)/len,0.,1.); vec2 e=d-dir*t*len; e+=vec2(-dir.y,dir.x)*(fract(r*13.7)-.5)*t*t*len*.4; float w=wid*(1.-t*.85); float m=1.-smoothstep(w*.6,w,length(e)); float z=m*(.35+.65*t)*(.5+.5*fract(r*29.3)); if(z>best.x) best=vec2(z,fract(r*57.1)); } return best; }
vec3 srgb(float r,float g,float b){ return pow(vec3(r,g,b)/255.,vec3(2.2)); }
`;
const GROUND = /* glsl */`
void mat(int L,vec2 uv,out vec3 c,out float h,out float r){
 c=vec3(.2);h=.5;r=.9; float big=fb(uv,3.,1.),mid=fb(uv,11.,2.),fine=fb(uv,48.,3.);
 
#if LAY==0||LAY==1
{ vec2 a=strokes(uv,26.,11.,1.5,.085,1.),b=strokes(uv,38.,21.,1.5,.1,1.),d=strokes(uv,60.,41.,1.3,.14,1.); vec2 s=a; if(b.x*.85>s.x) s=vec2(b.x*.85,b.y); if(d.x*.6>s.x) s=vec2(d.x*.6,d.y); h=s.x; float k=.62+h*.55;
   vec3 soil=srgb(74.,74.,40.); vec3 g1=srgb(104.,120.,58.),g2=srgb(140.,143.,80.),g3=srgb(82.,102.,46.); vec3 g=mix(mix(g3,g1,s.y),g2,step(.78,s.y)); if(LAY==1){ g1=srgb(172.,152.,104.); g2=srgb(196.,178.,128.); g3=srgb(134.,118.,74.); g=mix(mix(g3,g1,s.y),g2,step(.7,s.y)); g=mix(g,srgb(120.,122.,62.),step(.9,fract(s.y*7.))); soil=srgb(98.,80.,58.);}
   c=mix(soil,g,smoothstep(.02,.22,h))*k*(.8+.4*mid); r=.86; h=h*.8+big*.2; }
#elif LAY==2
 { vec3 w=wor(uv,19.,5.),w2=wor(uv,61.,6.); float peb=smoothstep(.34,.1,w2.x)*step(.72,w2.z); h=.45+(big-.5)*.5+(fine-.5)*.35+peb*.25-(1.-smoothstep(.0,.06,w.y-w.x))*.07*smoothstep(.45,.6,mid); c=mix(srgb(104.,80.,58.),srgb(146.,118.,88.),clamp(mid*1.2+fine*.4-.35,0.,1.)); c=mix(c,srgb(150.,138.,122.),peb*.7)*(.75+h*.5); r=.94; }
#elif LAY==3
 { float fr=uv.x*8.+(vn(uv*vec2(8.,24.),8.*3.,3.)-.5)*.25; fr=abs(fract(fr)-.5)*2.; vec3 w=wor(uv,34.,8.),w3=wor(uv,74.,18.); float clod=(1.-w.x)*.6+(1.-w3.x)*.4; h=fr*.55+clod*.35+fine*.15; c=mix(srgb(60.,44.,32.),srgb(112.,86.,62.),clamp(h*1.1-.15+(mid-.5)*.4,0.,1.)); r=.95; c*=.85+.25*big; }
#elif LAY==4
 { vec3 a=wor(uv,23.,3.),b=wor(uv,47.,4.),d=wor(uv,97.,5.); float ha=smoothstep(.62,.12,a.x)*step(.45,a.z),hb=smoothstep(.6,.1,b.x)*.75,hd=smoothstep(.6,.1,d.x)*.45; h=max(ha,max(hb,hd)); float id=ha>=h?a.z:(hb>=h?b.z:d.z); vec3 g=mix(srgb(122.,113.,102.),srgb(178.,168.,152.),fract(id*5.3)); g=mix(g,srgb(150.,124.,98.),step(.8,fract(id*11.))); c=mix(srgb(116.,100.,80.),g,smoothstep(.1,.4,h))*(.62+.5*h)*(.85+.3*big); r=.9; h=h*.85+big*.15; }
#elif LAY==5
 { float wv=sin((uv.y*14.+(vn(uv*5.,5.,3.)-.5)*2.4+(mid-.5))*6.28318); h=.5+wv*.16*smoothstep(.3,.65,big)+(big-.5)*.4+(fine-.5)*.12; c=mix(srgb(176.,146.,108.),srgb(212.,184.,142.),clamp(h+fine*.3-.15,0.,1.)); vec3 w=wor(uv,80.,9.); c=mix(c,srgb(120.,104.,86.),step(.94,w.z)*smoothstep(.3,.15,w.x)); r=.95; }
#elif LAY==6
 { float wp=(vn(uv*4.,4.,3.)-.5)*.1+(vn(uv*13.,13.,4.)-.5)*.035; float st=uv.y+wp; float bands=fb(vec2(.37,st),9.,12.); float ledge=vn(vec2(.5,st*26.),26.,13.); vec3 w=wor(vec2(uv.x,st)*vec2(1.,1.),11.,14.); float cr=1.-smoothstep(0.,.05,w.y-w.x); float rr=rid(uv,5.,15.); h=ledge*.35+rr*.5+fine*.2-cr*.3; c=mix(srgb(110.,100.,90.),srgb(172.,158.,140.),clamp(bands*1.3-.2,0.,1.)); c=mix(c,srgb(136.,128.,120.),mid*.5)*(.55+.65*h); c*=1.-cr*.35; r=.88; }
#elif LAY==7
 { h=.5+(big-.5)*.8+(fine-.5)*.08; c=vec3(.78,.81,.86)*(.9+.1*mid); r=.62; }
#elif LAY==8
 { vec3 w=wor(uv,31.,3.),w2=wor(uv,53.,4.); float lf=smoothstep(.55,.2,w.x),l2=smoothstep(.55,.2,w2.x)*.7; h=max(lf,l2)*.6+fine*.4; float id=lf>l2?w.z:w2.z; vec3 g=mix(srgb(78.,58.,38.),srgb(128.,96.,60.),id); g=mix(g,srgb(72.,84.,40.),step(.72,fract(id*9.7))); c=mix(srgb(46.,36.,26.),g,smoothstep(.1,.5,max(lf,l2)))*(.6+.5*mid); r=.93; }
#elif LAY==9
 { float rows=5.; float x=uv.x*rows; float d=abs(fract(x)-.5)*2.; vec2 a=strokes(uv,34.,61.,1.7,.16,1.),b=strokes(uv,52.,62.,1.4,.16,1.); float leaf=max(a.x,b.x*.8); float m=smoothstep(.95,.35,d+(vn(uv*30.,30.,6.)-.5)*.5); float cov=leaf*m; h=cov*.85+fine*.1; vec3 g=mix(srgb(52.,84.,34.),srgb(104.,132.,58.),a.y); vec3 soil=mix(srgb(82.,64.,46.),srgb(118.,94.,68.),mid); c=mix(soil*(.75+.25*(1.-m)),g*(.7+.5*leaf),smoothstep(.03,.2,cov)); r=.85; }
#elif LAY==10
 { vec3 a=wor(uv,70.,3.),b=wor(uv,128.,4.); float st=smoothstep(.55,.15,a.x)*step(.35,a.z),s2=smoothstep(.6,.2,b.x); h=.35+st*.35+s2*.25+(fine-.5)*.2; float id=fract(a.z*7.); vec3 ag=mix(srgb(96.,95.,94.),srgb(150.,146.,140.),id); c=mix(srgb(62.,62.,63.),ag,max(st*.75,s2*.45)); c*=.82+.3*mid; r=.84-.06*st; }
#elif LAY==11
 { h=.6+(fine-.5)*.12+(mid-.5)*.12; vec3 w=wor(uv,90.,3.); float pit=smoothstep(.22,.08,w.x)*step(.86,w.z); h-=pit*.25; c=mix(srgb(146.,142.,134.),srgb(178.,172.,162.),mid)*(.88+.24*big); c*=1.-pit*.3; r=.82; }
#else
 { vec2 a=strokes(uv,30.,71.,1.2,.13,1.),b=strokes(uv,46.,72.,1.3,.14,1.),d=strokes(uv,70.,73.,1.1,.18,1.); vec2 s=a; if(b.x*.9>s.x) s=vec2(b.x*.9,b.y); if(d.x*.6>s.x) s=vec2(d.x*.6,d.y); h=s.x; c=mix(srgb(120.,92.,50.),mix(srgb(188.,158.,96.),srgb(214.,188.,126.),s.y),smoothstep(.0,.3,h))*(.68+.4*h)*(.88+.24*mid); r=.85; }
#endif
}`;
const BUILD = /* glsl */`
void mat(int L,vec2 uv,out vec3 c,out float h,out float r){
 c=vec3(.7);h=.5;r=.8; float big=fb(uv,3.,1.),mid=fb(uv,9.,2.),fine=fb(uv,50.,3.); float streak=fb(uv*vec2(1.,.12)+.1,24.,5.);
#if LAY==0
 { float y=uv.y*16.; float f=fract(y); h=(1.-f)*.8+.1; float gap=smoothstep(.06,.0,f); h-=gap*.5; float seam=step(.992,fract(uv.x*2.+h1(vec2(floor(y),0.),16.,3.)))*.4; c=vec3(.78)*(.9+.12*mid)*(1.-gap*.35-seam*.3)*(.94+.08*streak); r=.62; }
#elif LAY==1
 { float x=uv.x*14.; float id=h1(vec2(floor(x),1.),14.,7.); float f=abs(fract(x)-.5)*2.; float gap=smoothstep(.9,.98,f); float gr=fb(vec2(uv.x*1.,uv.y*.125+id),64.,9.); h=.6-gap*.6+(gr-.5)*.35; c=vec3(.62)*(.75+.4*id)*(.72+.5*gr)*(1.-gap*.7); r=.85; }
#elif LAY==2
 { vec2 p=uv*vec2(12.,32.); p.x+=mod(floor(p.y),2.)*.5; vec2 f=fract(p); float id=h1(floor(mod(p,vec2(12.,32.))),999.,3.); float m=smoothstep(.0,.05,f.x)*smoothstep(1.,.95,f.x)*smoothstep(0.,.12,f.y)*smoothstep(1.,.88,f.y); h=m*.7+fine*.2; vec3 bk=mix(vec3(.30,.115,.075),vec3(.42,.19,.125),id)*(.8+.4*fine); c=mix(vec3(.36,.34,.31),bk,m); r=.88; }
#elif LAY==3
 { h=.5+(fine-.5)*.6+(mid-.5)*.2; c=vec3(.72)*(.9+.14*mid)*(.95+.06*streak); r=.9; }
#elif LAY==4
 { float f=sin(uv.x*6.28318*16.); h=.5+f*.45; float seam=step(.985,fract(uv.y*2.))*.5; c=vec3(.62)*(.82+.3*streak)*(1.-seam*.4); c=mix(c,vec3(.23,.11,.05),smoothstep(.64,.8,streak*.7+mid*.4)*.55); r=.45+.3*mid; }
#elif LAY==5
 { vec2 p=uv*vec2(10.,20.); p.x+=mod(floor(p.y),2.)*.5+(h1(vec2(floor(p.y),2.),20.,4.)-.5)*.3; vec2 f=fract(p); float id=h1(floor(mod(p,vec2(10.,20.))),999.,5.); h=(1.-f.y)*.6+.2+(fine-.5)*.2; float gap=max(smoothstep(.04,.0,f.x),smoothstep(.08,.0,f.y)); h-=gap*.3; c=vec3(.5)*(.65+.5*id)*(.8+.4*fine)*(1.-gap*.5)*(.85+.25*big); r=.93; }
#elif LAY==6
 { vec2 f=fract(uv*vec2(4.,4.)); float j=max(max(smoothstep(.012,.0,f.x),smoothstep(.988,1.,f.x)),max(smoothstep(.012,0.,f.y),smoothstep(.988,1.,f.y))); h=.6-j*.5+(fine-.5)*.15; c=mix(vec3(.40,.385,.36),vec3(.52,.50,.47),mid)*(.85+.2*streak)*(1.-j*.4); r=.85; }
#elif LAY==7
 { vec2 p=uv*vec2(8.,8.),f=fract(p); float mu=max(smoothstep(.07,.04,f.x)+smoothstep(.95,.98,f.x),smoothstep(.05,.03,f.y)+smoothstep(.72,.74,f.y)*smoothstep(.98,.96,f.y)); mu=clamp(mu,0.,1.); float id=h1(floor(p),8.,3.); h=mu*.5+.2; c=mix(vec3(.03,.045,.055)*(.7+.6*id),vec3(.28,.30,.31),mu); r=mix(.06,.4,mu); }
#elif LAY==8
 { float gr=fb(vec2(uv.x,uv.y*.1),40.,9.); h=.5+(gr-.5)*.5; c=mix(vec3(.22,.14,.08),vec3(.42,.30,.19),gr); r=.8; }
#elif LAY==9
 { float x=uv.x*9.+(fb(uv*vec2(1.,.5),8.,4.)-.5)*2.6; float f=abs(fract(x)-.5)*2.; float rr=rid(uv*vec2(1.,.5),8.,6.); h=smoothstep(.1,.9,f)*.6*rr+rr*.35+fine*.2; c=mix(vec3(.055,.042,.032),vec3(.25,.205,.165),clamp(h*1.2,0.,1.)); c=mix(c,vec3(.17,.18,.12),smoothstep(.55,.75,mid)*.35); r=.95; }
#elif LAY==10
 { vec3 w=wor(uv*vec2(1.,.5),9.,4.); float cr=smoothstep(.0,.22,w.y-w.x); h=cr*.7*(.6+.4*w.z)+fine*.25; c=mix(vec3(.05,.032,.024),mix(vec3(.25,.14,.085),vec3(.34,.22,.15),w.z),clamp(h*1.2,0.,1.)); r=.95; }
#elif LAY==11
 { vec3 w=wor(uv,9.,4.); float m=smoothstep(.02,.12,w.y-w.x); h=m*.7*(.6+.4*w.z)+fine*.2; c=mix(vec3(.3,.28,.26),mix(vec3(.24,.21,.18),vec3(.42,.38,.33),w.z)*(.8+.4*fine),m); r=.9; }
#elif LAY==12
 { h=.5+(mid-.5)*.06; c=vec3(.75)*(.94+.08*mid); r=.42+.12*mid; }
#elif LAY==13
 { vec2 p=uv*vec2(8.,16.); p.x+=mod(floor(p.y),2.)*.5; vec2 f=fract(p); float m=smoothstep(0.,.03,f.x)*smoothstep(1.,.97,f.x)*smoothstep(0.,.06,f.y)*smoothstep(1.,.94,f.y); h=m*.5+fine*.25; c=vec3(.5,.49,.47)*(.82+.3*fine)*mix(.75,1.,m); r=.92; }
#elif LAY==14
 { h=.5+(fine-.5)*.4; c=mix(vec3(.09),vec3(.17,.165,.16),mid)*(.8+.4*fine); float pud=smoothstep(.55,.7,big); c*=1.-pud*.3; r=.92; }
#elif LAY==15
 { h=.5+(fine-.5)*.5; c=mix(vec3(.12,.055,.03),vec3(.33,.16,.08),mid*.8+fine*.3); c=mix(c,vec3(.36,.35,.33),smoothstep(.56,.5,big)*.5); r=.8; }
#elif LAY==16
 { h=.5; c=vec3(.018,.024,.028); r=.05; }
#else
 { vec2 p=uv*vec2(6.,6.),f=fract(p); float w=smoothstep(.18,.2,f.x)*smoothstep(.82,.8,f.x)*smoothstep(.22,.24,f.y)*smoothstep(.8,.78,f.y); float fr=smoothstep(.15,.17,f.x)*smoothstep(.85,.83,f.x)*smoothstep(.19,.21,f.y)*smoothstep(.83,.81,f.y); float id=h1(floor(p),6.,3.); h=.7-w*.6; c=mix(vec3(.5,.47,.43)*(.85+.2*streak),vec3(.2,.2,.2),fr-w); c=mix(c,vec3(.025,.035,.042)*(.6+.8*id),w); r=mix(.85,.07,w); }
#endif
}`;
const MAIN = /* glsl */`
layout(location=1) out vec4 oB;
void main(){ vec3 c; float h,r; mat(LAY,vUv,c,h,r); gl_FragColor=vec4(sqrt(clamp(c,0.,1.)),h); oB=vec4(r,h,0.,1.); }`;
const COPY = /* glsl */`precision highp float; varying vec2 vUv; uniform sampler2D tA,tB; uniform float uMode,uSize,uStr;
void main(){ vec4 a=texture2D(tA,vUv),b=texture2D(tB,vUv); if(uMode<.5){ gl_FragColor=a; return; } vec2 e=vec2(1./uSize,0.);
 float l=texture2D(tB,vUv-e.xy).g,rr=texture2D(tB,vUv+e.xy).g,d=texture2D(tB,vUv-e.yx).g,u=texture2D(tB,vUv+e.yx).g; vec3 n=normalize(vec3(vec2(l-rr,d-u)*uSize*uStr,1.)); gl_FragColor=vec4(n.xy*.5+.5,b.r,clamp(.45+.75*a.a,0.,1.)); }`;

const mkTmp = (sz) => new THREE.WebGLRenderTarget(sz, sz, { count: 2, depthBuffer: false, type: THREE.HalfFloatType, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
function makeArray(size, n, aniso) {
  const rt = new THREE.WebGLArrayRenderTarget(size, size, n, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: aniso, type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
  rt.texture.name = 'world-array'; return rt;
}
// IndexedDB cache of the generated texel data (generation costs seconds of shader compiles on some drivers)
const VER = (() => { let h = 2166136261; const t = COMMON + GROUND + BUILD + MAIN + COPY; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); })();
const idb = (fn) => new Promise((res) => { try { const r = indexedDB.open('storm-hunters-world', 1); r.onupgradeneeded = () => r.result.createObjectStore('tex'); r.onerror = () => res(null); r.onsuccess = () => { try { fn(r.result.transaction('tex', 'readwrite').objectStore('tex'), res); } catch { res(null); } }; } catch { res(null); } });
const dbGet = (k) => idb((st, res) => { const q = st.get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
const dbPut = (k, v) => idb((st, res) => { const q = st.put(v, k); q.onsuccess = () => res(true); q.onerror = () => res(null); });
function arrTex(data, sz, n, an) { const t = new THREE.DataArrayTexture(data, sz, sz, n); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = an; t.needsUpdate = true; return { texture: t }; }
export async function createTextures(quality) {
  const sz0 = quality.id === 'low' ? 256 : quality.id === 'medium' ? 512 : 1024, bs0 = quality.id === 'low' ? 256 : 512, an0 = quality.id === 'low' ? 2 : 8, key = `${VER}-${sz0}-${bs0}`;
  const hit = await Promise.race([dbGet(key), new Promise((r) => setTimeout(() => r(null), 1500))]);
  if (hit && hit.gA) return { gA: arrTex(new Uint8Array(hit.gA), sz0, L.count, an0), gN: arrTex(new Uint8Array(hit.gN), sz0, L.count, an0), bA: arrTex(new Uint8Array(hit.bA), bs0, BL.count, an0), bN: arrTex(new Uint8Array(hit.bN), bs0, BL.count, an0), done: true, cached: true, fill() {} };
  const T = createTexturesGPU(quality); T.key = key; return T;
}
function createTexturesGPU(quality) {
  const size = quality.id === 'low' ? 256 : quality.id === 'medium' ? 512 : 1024, bs = quality.id === 'low' ? 256 : 512, an = quality.id === 'low' ? 2 : 8;
  const T = { gA: makeArray(size, L.count, an), gN: makeArray(size, L.count, an), bA: makeArray(bs, BL.count, an), bN: makeArray(bs, BL.count, an), done: false };
  T.fill = (renderer) => {
    const t0 = performance.now();
    if (T.done) return; T.done = true;
    const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; scene.add(quad);
    const VS = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }';
    const cp = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: COPY, uniforms: { tA: { value: null }, tB: { value: null }, uMode: { value: 0 }, uSize: { value: size }, uStr: { value: 1 } }, depthTest: false, depthWrite: false, toneMapped: false });
    const prep = (body, n, sz) => { const a = []; for (let i = 0; i < n; i++) { const m = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: COMMON + body + MAIN, defines: { LAY: i }, uniforms: { uSize: { value: sz } }, depthTest: false, depthWrite: false, toneMapped: false }); a.push(m); } return a; };
    const gm = prep(GROUND, L.count, size), bm = prep(BUILD, BL.count, bs), tmpA = mkTmp(size), tmpB = mkTmp(bs);
    // kick all compiles off in parallel before first use
    const warm = new THREE.Scene(); for (const m of [...gm, ...bm, cp]) { const q = new THREE.Mesh(quad.geometry, m); q.frustumCulled = false; warm.add(q); }
    const prev = renderer.getRenderTarget(); renderer.compile(warm, cam);
    const cap = { gA: new Uint8Array(size * size * 4 * L.count), gN: new Uint8Array(size * size * 4 * L.count), bA: new Uint8Array(bs * bs * 4 * BL.count), bN: new Uint8Array(bs * bs * 4 * BL.count) }; let ok = true;
    const capRT = { [size]: new THREE.WebGLRenderTarget(size, size, { depthBuffer: false }), [bs]: new THREE.WebGLRenderTarget(bs, bs, { depthBuffer: false }) };
    const grab = (arr, i, sz) => { if (!ok) return; try { const rt = capRT[sz]; renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.readRenderTargetPixels(rt, 0, 0, sz, sz, arr.subarray(i * sz * sz * 4, (i + 1) * sz * sz * 4)); } catch (e) { ok = false; } };
    const run = (mats, tmp, str, A, Nn, n, sz, ca, cn) => {
      cp.uniforms.uSize.value = sz; cp.uniforms.uStr.value = str; A.texture.generateMipmaps = Nn.texture.generateMipmaps = false;
      for (let i = 0; i < n; i++) {
        quad.material = mats[i]; renderer.setRenderTarget(tmp); renderer.render(scene, cam); mats[i].dispose();
        quad.material = cp; cp.uniforms.tA.value = tmp.textures[0]; cp.uniforms.tB.value = tmp.textures[1]; if (i === n - 1) A.texture.generateMipmaps = Nn.texture.generateMipmaps = true;
        cp.uniforms.uMode.value = 0; renderer.setRenderTarget(A, i); renderer.render(scene, cam); grab(ca, i, sz); cp.uniforms.uMode.value = 1; renderer.setRenderTarget(Nn, i); renderer.render(scene, cam); grab(cn, i, sz);
      }
      renderer.setRenderTarget(null); tmp.dispose();
    };
    const pAuto = renderer.autoClear, pTM = renderer.toneMapping; renderer.autoClear = true; renderer.toneMapping = THREE.NoToneMapping;
    run(gm, tmpA, .0065, T.gA, T.gN, L.count, size, cap.gA, cap.gN); run(bm, tmpB, .0085, T.bA, T.bN, BL.count, bs, cap.bA, cap.bN); capRT[size].dispose(); capRT[bs].dispose();
    if (ok && T.key) dbPut(T.key, { gA: cap.gA.buffer, gN: cap.gN.buffer, bA: cap.bA.buffer, bN: cap.bN.buffer });
    renderer.setRenderTarget(prev); renderer.autoClear = pAuto; renderer.toneMapping = pTM; T.ms = performance.now() - t0; 
  };
  return T;
}
export function dataTex(arr, w, h, fmt, linear, type = THREE.UnsignedByteType) {
  const t = new THREE.DataTexture(arr, w, h, fmt, type); t.minFilter = t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false; t.needsUpdate = true; return t;
}

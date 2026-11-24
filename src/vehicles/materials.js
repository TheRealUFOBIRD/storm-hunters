// Vehicle materials: clearcoat flake paint with SDF shut lines + dirt/wet/scratches/dents, merged trim material, glass with cracks + rain, lenses.
import * as THREE from 'three';

const NOISE = /* glsl */`
float vh13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float vn3(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(vh13(i),vh13(i+vec3(1,0,0)),f.x),mix(vh13(i+vec3(0,1,0)),vh13(i+vec3(1,1,0)),f.x),f.y),mix(mix(vh13(i+vec3(0,0,1)),vh13(i+vec3(1,0,1)),f.x),mix(vh13(i+vec3(0,1,1)),vh13(i+vec3(1,1,1)),f.x),f.y),f.z);}
float vfbm(vec3 p){return vn3(p)*.5+vn3(p*2.03+7.1)*.27+vn3(p*4.1+3.3)*.15+vn3(p*8.3)*.08;}
vec2 vh22(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.xx+q.yz)*q.zy);}`;
const DIRT_U = /* glsl */`
uniform float uDirt,uWet,uDamage,uTimeV;uniform vec3 uMud;uniform vec4 uDirtZ; // uDirtZ: wheel f front, rear, radius, ground y
varying vec3 vOP;varying vec3 vON;`;
const DIRT_FN = /* glsl */`
float dirtMask(vec3 p,vec3 n){
 float h=p.y-uDirtZ.w;float nz=vfbm(p*3.1),fine=vfbm(p*17.);
 float low=1.-smoothstep(.05,.75,h+(nz-.5)*.55);
 float wz=min(abs(p.z-uDirtZ.x-.35),abs(p.z-uDirtZ.y-.35));
 float spray=(1.-smoothstep(.1,.75,wz))*(1.-smoothstep(.1,1.15,h+(nz-.5)*.4));
 float back=smoothstep(.35,.9,n.z)*(1.-smoothstep(.5,1.7,h));
 float m=low*.85+spray*.75+back*.6+.18*nz;
 m*=.35+1.1*fine;
 return clamp(m*uDirt*1.25-(1.-uDirt)*.12,0.,1.);}`;
const VERT_PARS = /* glsl */`varying vec3 vOP;varying vec3 vON;uniform vec4 uDents[6];uniform mat3 uPart;
vec3 dentDisp(vec3 p,vec3 n){vec3 q=p;for(int i=0;i<6;i++){float r=.12+abs(uDents[i].w)*1.6;vec3 d=p-uDents[i].xyz;float k=exp(-dot(d,d)/(r*r));q-=n*uDents[i].w*k*(.75+.5*sin(d.x*31.+d.y*23.+d.z*27.));}return q;}`;

export function makeUniforms(spec) {
  return {
    uDirt: { value: 0.15 }, uWet: { value: 0 }, uDamage: { value: 0 }, uTimeV: { value: 0 }, uMud: { value: new THREE.Color(0.16, 0.115, 0.075) }, uDirtZ: { value: new THREE.Vector4(-spec.wheelbase / 2, spec.wheelbase / 2, spec.R, 0) },
    uDents: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -99, 0, 0)) }, uLamp: { value: new Float32Array(12) }, uPaint: { value: new THREE.Color(spec.color) }, uCrack: { value: 0 }, uCrackP: { value: [0, 1, 2].map(() => new THREE.Vector4(0, -99, 0, 0)) }, uRain: { value: 0 }, uSpeedV: { value: 0 }, uWiper: { value: 0 }, uLines: { value: null }, uRects: { value: [0, 1, 2].map(() => new THREE.Vector4(0, 0, 1, 1)) }, uGlassTint: { value: 0.5 },
  };
}
function base(mat, U, frag, vert = {}) {
  mat.fog = false;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n${VERT_PARS}\n${vert.pars || ''}`)
      .replace('#include <begin_vertex>', `vec3 transformed=dentDisp(position,normal);vOP=position;vON=normal;${vert.begin || ''}`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${DIRT_U}\n${NOISE}\n${DIRT_FN}\n${frag.pars || ''}`);
    for (const k in frag) if (k[0] === '<') s.fragmentShader = s.fragmentShader.replace(`#include ${k}`, frag[k].replace('@', `#include ${k}`));
  };
  return mat;
}
export function paintMaterial(U, { metal = 0.55, rough = 0.42, matte = false } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: metal, roughness: rough, clearcoat: matte ? 0.12 : 1, clearcoatRoughness: matte ? 0.5 : 0.045, envMapIntensity: 1 });
  m.customProgramCacheKey = () => 'vpaint' + (matte ? 1 : 0);
  return base(m, U, {
    pars: /* glsl */`uniform sampler2D uLines;uniform vec4 uRects[3];uniform vec3 uPaint;varying vec3 vAUv;float gDirt,gClad,gGroove,gScr,gLd,gLa;vec3 gBN;
// bicubic B-spline (4 bilinear taps) keeps the shut lines smooth at close range
vec4 texLines(vec2 uv){vec2 ts=vec2(textureSize(uLines,0));vec2 p=uv*ts-.5,f=fract(p),b=floor(p);vec2 f2=f*f,f3=f2*f;vec2 w0=(1.-f)*(1.-f)*(1.-f)/6.,w1=(4.-6.*f2+3.*f3)/6.,w3=f3/6.,w2=1.-w0-w1-w3;vec2 g0=w0+w1,g1=w2+w3;vec2 h0=(b+w1/g0-.5)/ts,h1=(b+w3/g1+1.5)/ts;return g0.y*(g0.x*textureLod(uLines,h0,0.)+g1.x*textureLod(uLines,vec2(h1.x,h0.y),0.))+g1.y*(g0.x*textureLod(uLines,vec2(h0.x,h1.y),0.)+g1.x*textureLod(uLines,h1,0.));}
vec3 bumpN(vec3 vp,vec3 n,float h){vec3 sx=dFdx(vp),sy=dFdy(vp);vec3 R1=cross(sy,n),R2=cross(n,sx);float det=dot(sx,R1);vec3 g=sign(det)*(dFdx(h)*R1+dFdy(h)*R2);vec3 b=abs(det)*n-g;float l=length(b);return l>1e-9?b/l:n;}`,
    '<color_fragment>': /* glsl */`@
 {int w=int(vAUv.z+.5);vec4 rc=w==0?uRects[0]:w==1?uRects[1]:uRects[2];vec2 luv=(vAUv.xy-rc.xy)/(rc.zw-rc.xy);vec4 ls=texLines(luv);float ld=sqrt(max((w==0?ls.r:w==1?ls.g:ls.b)-.02,0.))*.016;gLd=ld;gLa=ls.a;
 float aa=max(length(vec2(dFdx(ld),dFdy(ld))),1e-5);float vis=clamp(.0035/aa,0.,1.);
 gGroove=(1.-smoothstep(.0022,.0022+max(aa,.0012),ld))*mix(.35,1.,vis);
 gClad=w==0?1.-smoothstep(-aa*1.5,aa*1.5,(ls.a-.5)*.08):0.;
 gDirt=dirtMask(vOP,vON);
 vec3 col=uPaint;
 float sc=vfbm(vOP*vec3(3.,14.,3.));float sn=vfbm(vOP*vec3(60.,8.,9.));gScr=smoothstep(.62-.16*uDamage,.7,sc*.6+sn*.45)*smoothstep(.12,.55,uDamage);
 for(int i=0;i<6;i++){vec3 dd=vOP-uDentsF[i].xyz;gScr=max(gScr,step(.001,abs(uDentsF[i].w))*smoothstep(.35,.75,vfbm(vOP*31.)+exp(-dot(dd,dd)*22.)*.55-.22)*exp(-dot(dd,dd)*9.));}
 col=mix(col,vec3(.23,.235,.24),gScr*.75);
 col=mix(col,vec3(.018),gClad);
 col*=1.-.93*gGroove; col*=1.-.4*(1.-smoothstep(.002,.014,ld))*vis;
 col=mix(col,uMud*(1.-.45*uWet)*(.8+.5*vn3(vOP*40.)),gDirt*.93);
 diffuseColor.rgb=col;}`,
    '<roughnessmap_fragment>': /* glsl */`@
 roughnessFactor=mix(roughnessFactor,.62,gClad);roughnessFactor=mix(roughnessFactor,.55,gScr);roughnessFactor=mix(roughnessFactor,mix(.95,.5,uWet),gDirt);roughnessFactor=mix(roughnessFactor,.9,gGroove);`,
    '<metalnessmap_fragment>': /* glsl */`@
 metalnessFactor*=(1.-gDirt)*(1.-gClad)*(1.-gGroove);`,
    '<normal_fragment_maps>': /* glsl */`@
 {int w=int(vAUv.z+.5);float ld=gLd;
 float px=length(fwidth(vOP));float fade=clamp(.006/px,0.,1.);
 float hg=smoothstep(.001,.0085,ld)*.0035*fade;hg+=smoothstep(.0,.006,abs((gLa-.5)*.08))*.002*fade*(w==0?1.:0.);
 hg+=gDirt*vn3(vOP*55.)*.0025*fade+gClad*(vn3(vOP*420.))*.0006*clamp(.0015/px,0.,1.);
 vec3 bn=bumpN(-vViewPosition,normal,hg);normal=bn;gBN=bn;
 // metallic flake on the base layer only
 float fl=clamp(.0012/px,0.,1.);vec3 fc=floor(vOP*900.);vec3 fr=vec3(vh13(fc),vh13(fc+17.),vh13(fc+41.))-.5;
normal=normalize(normal+fr*.075*fl*(1.-gDirt)*(1.-gClad));
 }`,
    '<clearcoat_normal_fragment_maps>': `@
 {float px=length(fwidth(vOP));clearcoatNormal=normalize(gBN+(vec3(vn3(vOP*140.),vn3(vOP*140.+9.),vn3(vOP*140.+19.))-.5)*.012*clamp(.004/px,0.,1.));}`,
    '<clearcoat_fragment_dummy>': '',
    '<lights_physical_fragment>': /* glsl */`@
 material.clearcoat*=(1.-gDirt*.97)*(1.-gClad*.92)*(1.-gGroove)*(1.-gScr*.8);material.clearcoatRoughness=max(material.clearcoatRoughness,.03)+uWet*.0+gDirt*.4;
 material.diffuseColor*=mix(1.,.82,uWet*(1.-gDirt));`,
  }, { pars: 'attribute vec3 aUv;varying vec3 vAUv;', begin: 'vAUv=aUv;' }), patchDents(m);
}
function patchDents(m) { const o = m.onBeforeCompile; m.onBeforeCompile = (s) => { o(s); s.uniforms.uDentsF = s.uniforms.uDents; s.fragmentShader = s.fragmentShader.replace('uniform sampler2D uLines;', 'uniform vec4 uDentsF[6];uniform sampler2D uLines;'); }; return m; }

// merged trim: colour + aMat(rough, metal, emissive group, flag[1 = body paint, 2 = tyre rubber])
export function trimMaterial(U, { dents = true, side = THREE.FrontSide } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 1, side }); void dents;
  m.customProgramCacheKey = () => 'vtrim';
  return base(m, U, {
    pars: 'varying vec4 vMat;uniform vec3 uPaint;uniform float uLamp[12];float gDirt;',
    '<color_fragment>': `@
 gDirt=dirtMask(vOP,vON)*step(vMat.z,.5)*(vMat.w>2.5?.0:1.);
 if(vMat.w>.5&&vMat.w<1.5)diffuseColor.rgb=uPaint;
 diffuseColor.rgb=mix(diffuseColor.rgb,uMud*(1.-.45*uWet)*(.75+.5*vn3(vOP*40.)),gDirt*(vMat.w>1.5?.75:.9));`,
    '<roughnessmap_fragment>': 'float roughnessFactor=mix(vMat.x,mix(.95,.55,uWet),gDirt);roughnessFactor=mix(roughnessFactor,roughnessFactor*.6,uWet*step(.3,vMat.x)*step(vMat.w,2.5));',
    '<metalnessmap_fragment>': 'float metalnessFactor=vMat.y*(1.-gDirt);',
    '<emissivemap_fragment>': '@\n if(vMat.z>.5){int g=int(vMat.z+.5);totalEmissiveRadiance+=vColor.rgb*uLamp[g];}',
  }, { pars: 'attribute vec4 aMat;varying vec4 vMat;', begin: 'vMat=aMat;' });
}
export function glassMaterial(U, { tint = 0x0b0f10, opacity = 0.62, side = THREE.DoubleSide } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.03, transparent: true, opacity, side, depthWrite: false, envMapIntensity: 1.1, specularIntensity: 1, ior: 1.5 });
  m.customProgramCacheKey = () => 'vglass';
  return base(m, U, {
    pars: /* glsl */`uniform float uCrack,uRain,uSpeedV,uWiper,uGlassTint;uniform vec4 uCrackP[3];varying vec3 vAUv;float gCr,gDrop;
float crackAt(vec3 p,vec4 c){vec3 d=p-c.xyz;float r=length(d);if(c.w<=0.||r>c.w)return 0.;vec2 q=vec2(d.x,d.y+d.z*.6);float a=atan(q.y,q.x);float w=vn3(vec3(q*9.,c.x*7.))*.5;
 float n=11.;float k=abs(fract(a/6.2832*n+w+c.x*3.)-.5)*6.2832/n*r;float rad=1.-smoothstep(.0007,.0022,k);
 float rr=r*22.+w*2.;float cir=(1.-smoothstep(.03,.09,abs(fract(rr)-.5)))*step(.4,vn3(vec3(a*3.,floor(rr),1.)))*smoothstep(.45*c.w,.0,r);
 float web=smoothstep(.07,.0,r);return clamp(max(rad,cir)*(1.-smoothstep(c.w*.5,c.w,r*(1.+.5*w)))+web*.6,0.,1.);}
float dropL(vec2 uv,float sc,float t){vec2 p=uv*sc;vec2 i=floor(p),f=fract(p)-.5;vec2 h=vh22(i);float on=step(h.x,uRain*.9);float life=fract(t*(.15+.3*h.y)+h.x*7.);vec2 o=(h-.5)*.6;o.y+=life*life*.2;float r=.28*(1.-life)*(.4+.6*h.y);return on*smoothstep(r,r*.55,length(f-o));}`,
    '<color_fragment>': /* glsl */`@
 gCr=0.;for(int i=0;i<3;i++)gCr=max(gCr,crackAt(vOP,uCrackP[i]));gCr*=step(.01,uCrack);
 gDrop=0.;if(uRain>.02){vec2 suv=abs(vON.x)>.6?vOP.zy:vec2(vOP.x,length(vOP.yz));gDrop=max(dropL(suv,34.,uTimeV),dropL(suv+3.3,61.,uTimeV*1.3));}
 gDrop*=clamp(.004/length(fwidth(vOP)),0.,1.);
 float gd=dirtMask(vOP,vON)*.5+.06*uDirt;
 diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.75,.8,.82),gCr*.8);diffuseColor.rgb=mix(diffuseColor.rgb,uMud,gd*.8);
 diffuseColor.a=mix(diffuseColor.a,1.,max(gCr*.75,gd*.55));diffuseColor.a=mix(diffuseColor.a,max(diffuseColor.a-.08,.1),gDrop);`,
    '<roughnessmap_fragment>': '@\n roughnessFactor=mix(roughnessFactor,.35,max(gCr,dirtMask(vOP,vON)*.6));',
    '<normal_fragment_maps>': '@\n if(gDrop>.01){vec3 dg=vec3(dFdx(gDrop),dFdy(gDrop),0.);normal=normalize(normal-dg*1.4);}',
    '<opaque_fragment>': /* glsl */`
 {vec3 V=normalize(vViewPosition);float fr=pow(1.-clamp(abs(dot(V,normal)),0.,1.),4.);diffuseColor.a=clamp(max(diffuseColor.a,.04+.96*fr),0.,1.);}
 // keep reflections at full strength independent of alpha (premultiplied style)
 vec3 refl=reflectedLight.directSpecular+reflectedLight.indirectSpecular;
 outgoingLight=(outgoingLight-refl)+refl/max(diffuseColor.a,.12)*mix(.75,1.,diffuseColor.a);
@`,
  }, { pars: 'attribute vec3 aUv;varying vec3 vAUv;', begin: 'vAUv=aUv;' });
}
export function lensMaterial(U, { color = 0xffffff, opacity = 0.16, rough = 0.02 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: rough, transparent: true, opacity, depthWrite: false, envMapIntensity: 1.2, ior: 1.5 });
  m.customProgramCacheKey = () => 'vlens';
  return base(m, U, {
    '<opaque_fragment>': `
 {vec3 V=normalize(vViewPosition);float fr=pow(1.-clamp(abs(dot(V,normal)),0.,1.),4.);diffuseColor.a=clamp(max(diffuseColor.a,.04+.9*fr),0.,1.);}
 vec3 refl=reflectedLight.directSpecular+reflectedLight.indirectSpecular;outgoingLight=(outgoingLight-refl)+refl/max(diffuseColor.a,.1)*mix(.7,1.,diffuseColor.a);
@`, '<color_fragment>': '@\n float gd=dirtMask(vOP,vON)*.6;diffuseColor.rgb=mix(diffuseColor.rgb,uMud,gd);diffuseColor.a=mix(diffuseColor.a,1.,gd*.8);',
  });
}

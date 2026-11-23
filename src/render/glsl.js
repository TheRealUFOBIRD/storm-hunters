// Shared GLSL for all render passes (GLSL ES 3.00, RawShaderMaterial)
export const FS_VERT = /* glsl */`
in vec3 position; out vec2 vUv;
void main(){ vUv = position.xy*.5+.5; gl_Position = vec4(position.xy, 0., 1.); }`;

export const HEAD = /* glsl */`
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D;
#define PI 3.14159265359
#define sat(x) clamp(x,0.,1.)
float lum(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(.06711056,.00583715)))); }
float hash12(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
float hash13(vec3 p){ p=fract(p*.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
vec3 hash33(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float remap(float v,float a,float b,float c,float d){ return c+(v-a)/(b-a)*(d-c); }
`;

// raw depth -> view distance. uShDepth = (P10, P14, ndcScale, ndcBias)
export const DEPTH_GLSL = /* glsl */`
float shLinearDepth(float raw, vec4 k){ return k.y / (raw*k.z + k.w + k.x); }
`;

// sky-view LUT + aerial perspective LUT lookups
export const SKY_GLSL = /* glsl */`
uniform sampler2D uSkyLut, uAerialLut;
vec2 skyUv(vec3 d){
  float az = atan(d.z, d.x)/(2.*PI); float el = asin(clamp(d.y,-1.,1.));
  return vec2(az + .5, .5 + .5*sign(el)*sqrt(abs(el)/(PI*.5)));
}
vec3 skyRad(vec3 d){ return textureLod(uSkyLut, skyUv(d), 0.).rgb; }
// hazeK: (1/scaleHeight, camera height above haze base, unused, maxDist)
uniform vec4 uHazeK;
float hazeEffDist(vec3 ro, vec3 rd, float t){
  float k = uHazeK.x, y0 = max(ro.y - uHazeK.y, 0.);
  float a = k*rd.y*t;
  float f = abs(a) < 1e-3 ? 1. - .5*a : (1.-exp(-clamp(a,-12.,60.)))/a;
  return t*exp(-k*y0)*f;
}
vec4 aerial(vec3 ro, vec3 rd, float t){
  float e = hazeEffDist(ro, rd, t);
  float az = atan(rd.z, rd.x)/(2.*PI) + .5;
  return textureLod(uAerialLut, vec2(az, sqrt(sat(e/uHazeK.w))), 0.);
}
vec3 applyAerial(vec3 c, vec3 ro, vec3 rd, float t){ vec4 a = aerial(ro, rd, t); return c*pow(vec3(a.a), vec3(.82,1.,1.2)) + a.rgb; }
`;

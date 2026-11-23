// Cascaded sun shadows + cloud shadow + storm ambient + lightning for *every* lit three.js material (global ShaderChunk patch).
// All cascades live in one depth atlas (1 sampler) and are rendered by three's own shadow pass, so alphaTest / customDepthMaterial / instancing work.
import * as THREE from 'three';

const P = [...Array(8)].map(() => new THREE.Vector4());
export const csmU = { shTex: { value: [null] }, shMap: { value: [null] }, shMat: { value: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()] }, shInv: { value: [new THREE.Matrix4()] }, shP: { value: P } };
// P0 cascades, 1/atlas, enabled, softness | P1 cloudshadow centre xz, 1/size, groundY | P2 sunDir world, camera openness | P3 flash pos view, intensity
// P4 cascade radii | P5 sky irradiance | P6 ground irradiance | P7 flash colour

const PARS = /* glsl */`
#ifndef SH_CSM_PARS
#define SH_CSM_PARS
uniform highp sampler2DShadow shTex[1]; uniform sampler2D shMap[1]; uniform mat4 shMat[3]; uniform mat4 shInv[1]; uniform vec4 shP[8];
float shIgn(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }
vec2 shCloud(vec3 wp){
  vec3 g=wp-shP[2].xyz*((wp.y-shP[1].w)/max(shP[2].y,.03)); vec2 uv=(g.xz-shP[1].xy)*shP[1].z+.5; vec2 e=abs(uv-.5);
  return mix(vec2(1.),textureLod(shMap[0],uv,0.).rg,smoothstep(.5,.42,max(e.x,e.y)));
}
float shSun(vec3 vpos, vec3 vn, bool recv){
  vec3 wp=(shInv[0]*vec4(vpos,1.)).xyz; float cl=shCloud(wp).x;
  bool on=recv&&shP[0].z>.5&&cl>=.003;
  float s=1.; int n=int(shP[0].x); float a=shIgn(gl_FragCoord.xy+shP[0].w*vec2(5.588238,3.1))*6.2831853; vec2 rs=vec2(cos(a),sin(a));
  float nd=1.-clamp(dot(vn,(viewMatrix*vec4(shP[2].xyz,0.)).xyz),0.,1.);
  int ci=-1; vec3 cc=vec3(.5); float cm=0.;
  for(int i=2;i>=0;i--){
    if(i<n){ float R=i==0?shP[4].x:i==1?shP[4].y:shP[4].z; float tx=R*2.*shP[0].y*2.;
    vec4 c=shMat[i]*vec4(vpos+vn*tx*(.6+1.8*nd),1.); vec2 e=abs(c.xy-.5); float m=max(e.x,e.y);
    if(m<.485&&c.z>0.&&c.z<1.){ ci=i; cc=c.xyz; cm=m; } }
  }
  vec2 base=vec2(ci==1?.5:0.,ci==2?.5:0.)+cc.xy*.5; float f=0.; float rad=shP[0].y*(ci==0?2.2:1.5);
  #define SHT(a,b) f+=textureLod(shTex[0],vec3(base+vec2(a*rs.x-b*rs.y,a*rs.y+b*rs.x)*rad,cc.z),0.);
  if(on&&ci>=0){ SHT(.25,0.) SHT(-.3194,.2924) SHT(.0488,-.5576) SHT(.4024,.5248) SHT(-.7383,-.1305) SHT(.6993,-.4454) SHT(-.2343,.8703) SHT(-.4463,-.8593) f*=.125; } else f=1.;
  s=mix(1.,f,(ci==n-1)?smoothstep(.485,.40,cm):1.);
  return s*cl;
}
#endif
`;

let patched = false;
export function patchChunks() {
  if (patched) return; patched = true;
  const C = THREE.ShaderChunk;
  C.lights_pars_begin += PARS;
  C.lights_fragment_begin = C.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', `getDirectionalLightInfo( directionalLight, directLight );
		#if UNROLLED_LOOP_INDEX == 0
		directLight.color *= shSun( geometryPosition, nonPerturbedNormal, receiveShadow );
		#endif`);
  C.lights_fragment_end = /* glsl */`
#if defined( RE_Direct )
	if ( shP[3].w > 0.0005 ) { // lightning
		vec3 shFv = shP[3].xyz - geometryPosition; float shFd = length( shFv );
		directLight.direction = shFv / shFd; directLight.color = shP[7].rgb * ( shP[3].w * 9.0 / ( 1.0 + shFd * shFd / 2.2e6 ) ); directLight.visible = true;
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
#endif
#if defined( RE_IndirectDiffuse )
	{ vec3 shWp = ( shInv[0] * vec4( geometryPosition, 1.0 ) ).xyz; float shOp = clamp( ( shCloud( shWp ).y + .28 ) / ( shP[2].w + .28 ), .45, 2.2 ); shOp = mix( 1.0, shOp, smoothstep( 300.0, 2500.0, length( geometryPosition ) ) );
	vec3 shWn = inverseTransformDirection( geometryNormal, viewMatrix );
	#ifndef STANDARD
		irradiance += mix( shP[6].rgb, shP[5].rgb, shWn.y * .5 + .5 );
	#endif
	irradiance *= shOp;
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		iblIrradiance *= shOp;
	#endif
	#if defined( RE_IndirectSpecular )
		radiance *= mix( 1.0, shOp, .6 ); clearcoatRadiance *= mix( 1.0, shOp, .6 );
	#endif
	irradiance += shP[7].rgb * shP[3].w * .35; }
#endif
` + C.lights_fragment_end;
  const add = (u) => { for (const k in csmU) u[k] = csmU[k]; };
  add(THREE.UniformsLib.lights);
  for (const k of ['standard', 'physical', 'lambert', 'phong', 'toon', 'shadow']) if (THREE.ShaderLib[k]) add(THREE.ShaderLib[k].uniforms);
}

const TILES = [[0, 0], [1, 0], [0, 1]];
const _c = new THREE.Vector3(), _f = new THREE.Vector3(), _m = new THREE.Matrix4(), _b = new THREE.Matrix4(), _v = new THREE.Vector4();
export class CSM {
  constructor(renderer, ctx) {
    this.r = renderer; this.ctx = ctx; this.reversed = renderer.state.buffers.depth.getReversed?.() === true;
    this.count = 3; this.tile = 2048; this.radii = [24, 110, 560]; this.enabled = true; this.active = [];
    const dt = new THREE.DepthTexture(4096, 4096, THREE.UnsignedIntType); dt.format = THREE.DepthFormat;
    dt.compareFunction = this.reversed ? THREE.GreaterEqualCompare : THREE.LessEqualCompare; dt.minFilter = dt.magFilter = THREE.LinearFilter;
    this.rt = new THREE.WebGLRenderTarget(4096, 4096, { depthTexture: dt, format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    csmU.shTex.value[0] = dt;
    const self = this, cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 2000); if (this.reversed) { cam._reversedDepth = true; cam.updateProjectionMatrix(); }
    this.cam = cam; this.frustum = new THREE.Frustum(); this.vps = []; this.sunDir = new THREE.Vector3(0, 1, 0);
    this.world2shadow = [0, 1, 2].map(() => new THREE.Matrix4());
    const ext = new THREE.Vector2(2, 2);
    this.light = { name: 'sun', isPointLight: false, shadow: { camera: cam, map: this.rt, mapSize: new THREE.Vector2(2048, 2048), autoUpdate: true, needsUpdate: true, getFrameExtents: () => ext, getViewportCount: () => self.active.length, getViewport: (i) => { const t = TILES[self.active[i]]; return _v.set(t[0], t[1], 1, 1); }, updateMatrices(l, i) { self._fit(self.active[i]); }, getFrustum: () => self.frustum } };
    this.lights = [this.light];
    const sm = renderer.shadowMap; sm.enabled = true; sm.type = THREE.PCFShadowMap;
    const orig = sm.render;
    this.want = false;
    sm.render = function (lights, scene, camera) {
      if (self.want && scene === ctx.scene) {
        self.want = false;
        const oc = renderer.clear;
        renderer.clear = () => { for (const k of self.active) { const t = TILES[k], z = self.tile; renderer.state.scissor(new THREE.Vector4(t[0] * z, t[1] * z, z, z)); renderer.state.setScissorTest(true); oc.call(renderer, true, true, false); } renderer.state.setScissorTest(false); };
        try { orig.call(sm, self.lights, scene, camera); } finally { renderer.clear = oc; }
      }
      if (lights.length) orig.call(sm, lights, scene, camera);
    };
  }
  setQuality(q, shadowsOn) {
    this.enabled = shadowsOn !== false; this.count = Math.max(1, Math.min(3, q.cascades)); this.tile = Math.min(q.shadowSize, 3072);
    this.radii = this.count === 3 ? [24, 110, 560] : this.count === 2 ? [38, 240, 0] : [90, 0, 0];
    const S = this.tile * 2; if (this.rt.width !== S) this.rt.setSize(S, S);
    this.light.shadow.mapSize.set(this.tile, this.tile);
    P[0].set(this.count, 1 / S, this.enabled ? 1 : 0, 0); P[4].set(this.radii[0], this.radii[1], this.radii[2], 0);
    this.force = true;
  }
  _fit(i) {
    const R = this.radii[i], cam = this.cam, c = this.ctx.camera; c.getWorldDirection(_f); _f.y *= 0.4; _f.normalize();
    _c.copy(c.position).addScaledVector(_f, R * 0.72);
    const L = this.sunDir; cam.up.set(0, Math.abs(L.y) > 0.98 ? 0 : 1, Math.abs(L.y) > 0.98 ? 1 : 0);
    cam.position.set(0, 0, 0); _m.lookAt(L, cam.position, cam.up); cam.quaternion.setFromRotationMatrix(_m);
    // snap the centre to whole texels in light space
    _b.copy(_m).invert(); _c.applyMatrix4(_b); const tx = (2 * R) / this.tile; _c.x = Math.round(_c.x / tx) * tx; _c.y = Math.round(_c.y / tx) * tx; _c.applyMatrix4(_m);
    const back = Math.max(R * 1.6, 220);
    cam.position.copy(_c).addScaledVector(L, back); cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 0.1; cam.far = back + R * 2 + 120; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.frustum.setFromProjectionMatrix(_m, cam.coordinateSystem, cam.reversedDepth);
    if (this.reversed) _b.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 1, 0, 0, 0, 0, 1); else _b.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.world2shadow[i].multiplyMatrices(_b, _m);
    const bias = 0.00002 + 0.02 / (cam.far - cam.near); this.world2shadow[i].elements[14] += this.reversed ? bias : -bias;
  }
  prepare(frame, sunDir, sunOn) {
    this.sunDir.copy(sunDir); if (this.sunDir.y < 0.06) { this.sunDir.y = 0.06; this.sunDir.normalize(); }
    this.active.length = 0; P[0].z = this.enabled && sunOn ? 1 : 0;
    if (!this.enabled || !sunOn) { this.want = false; return; }
    for (let i = 0; i < this.count; i++) { const every = i === 0 ? 1 : i === 1 ? 2 : 4; if (this.force || (frame + i) % every === 0) this.active.push(i); }
    this.force = false; this.want = this.active.length > 0;
    // matrices must exist before the main pass reads them: fit now (three calls _fit again with identical inputs)
    for (const i of this.active) this._fit(i);
  }
  updateReceivers(camera, frame) {
    csmU.shInv.value[0].copy(camera.matrixWorld); P[0].w = frame % 16;
    for (let i = 0; i < 3; i++) csmU.shMat.value[i].multiplyMatrices(this.world2shadow[i], camera.matrixWorld);
  }
}

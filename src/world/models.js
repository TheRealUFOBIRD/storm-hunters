// Real (CC0, Poly Haven) vegetation & rock models, baked offline into compact LOD meshes + one atlas per variant
// (assets/models/nature/<id>.bin, <id>_c.webp colour+alpha, <id>_n.webp normal). See CREDITS.md (VEGETATION).
// Also bakes far-field impostors (8 views per variant) at load time from the LOD0 meshes. Everything async + fail-soft.
import * as THREE from 'three';

// kind -> variant ids (picked per instance from its seed). Kinds missing here keep the procedural geometry.
export const NATURE = {
  oak: ['oak_a', 'oak_b'], cottonwood: ['cottonwood_a'], pine: ['pine_a'], spruce: ['spruce_a', 'spruce_b'], cedar: ['cedar_a', 'cedar_b'],
  mesquite: ['mesquite_a', 'mesquite_b'], dead: ['dead_a'], shrub: ['shrub_a', 'shrub_b', 'shrub_c'], rock: ['rock_a', 'rock_b', 'rock_c', 'rock_d'],
};
const BASE = new URL('../../assets/models/nature/', import.meta.url).href;

function parseBin(buf) {
  const dv = new DataView(buf); if (dv.getUint32(0, true) !== 0x31474556) throw new Error('bad veg bin');
  const jl = dv.getUint32(4, true), meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl))); let o = 8 + jl;
  const take = (C, n) => { const a = new C(buf, o, n); o += (a.byteLength + 3) & ~3; return a; };
  meta.geos = meta.lods.map((l) => {
    if (!l) return null; const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(take(Float32Array, l.nv * 3), 3));
    g.setAttribute('normal', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(take(Int8Array, l.nv * 4), 4), 3, 0, true));
    g.setAttribute('uv', new THREE.BufferAttribute(take(Uint16Array, l.nv * 2), 2, true));
    g.setAttribute('color', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(take(Uint8Array, l.nv * 4), 4), 3, 0, true));
    g.setIndex(new THREE.BufferAttribute(take(l.i32 ? Uint32Array : Uint16Array, l.ni), 1)); g.computeBoundingSphere(); return g;
  });
  return meta;
}
const texLoader = new THREE.TextureLoader();
function loadTex(url, srgb, aniso) { return new Promise((res, rej) => texLoader.load(url, (t) => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; res(t); }, undefined, rej)); }

/** Load one variant: {id, H, crown, geos:[lod0, lod1, stump|null], map, normalMap}. Rejects on any failure. */
export async function loadVariant(id, { base = BASE, normals = true, aniso = 4 } = {}) {
  const [buf, map, normalMap] = await Promise.all([fetch(base + id + '.bin').then((r) => { if (!r.ok) throw new Error(id + ' ' + r.status); return r.arrayBuffer(); }), loadTex(base + id + '_c.webp', true, aniso), normals ? loadTex(base + id + '_n.webp', false, aniso).catch(() => null) : null]);
  const m = parseBin(buf); m.map = map; m.normalMap = normalMap; return m;
}
/** Load all kinds; resolves to Map(kindName -> [variant...]) with failed variants/kinds simply missing. */
export async function loadNature(opts = {}) {
  const out = new Map(), jobs = [];
  for (const [kind, ids] of Object.entries(NATURE)) jobs.push(Promise.all(ids.map((id) => loadVariant(id, opts).catch((e) => { console.warn('[nature] ' + id + ' failed, procedural fallback', e?.message || e); return null; }))).then((vs) => { vs = vs.filter(Boolean); if (vs.length) out.set(kind, vs); }));
  await Promise.all(jobs); return out;
}

// ---------------------------------------------------------------- material (MeshStandard so CSM/shadows/env apply)
// vertex colour: r = AO, g = foliage (translucency, flutter), b = unused. `patch(shader)` adds the world's wind/LOD code.
export function natureMaterial(v, { patch, key = '', foliage = true } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: v.map, normalMap: v.normalMap || null, normalScale: new THREE.Vector2(.9, .9), vertexColors: true, alphaTest: .5, side: foliage ? THREE.DoubleSide : THREE.FrontSide, roughness: .88, metalness: 0, fog: false, envMapIntensity: .7 });
  m.customProgramCacheKey = () => 'nature' + key + (v.normalMap ? 'n' : '');
  m.onBeforeCompile = (sh) => {
    patch?.(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vFol;').replace('#include <color_vertex>', '#include <color_vertex>\n vFol=color.g;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFol;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb*=vColor.r;')
      // alpha: sharpen + keep coverage in the mips (no thinning / popping at distance)
      .replace('#include <alphatest_fragment>', `{ vec2 ts=vec2(textureSize(map,0)); vec2 dx=dFdx(vMapUv*ts),dy=dFdy(vMapUv*ts); float lod=max(0.,.5*log2(max(dot(dx,dx),dot(dy,dy))));
        float a=diffuseColor.a*(1.+lod*.28); a=(a-.5)/max(fwidth(a),1e-4)+.5; if(a<.5) discard; diffuseColor.a=1.; }`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n if(vFol>.5){ vec3 gn=normalize(vNormal); normal=normalize(gn+(normal*faceDirection-gn)*.8); }')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=roughness+vFol*.04;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS>0
        if(vFol>.5){ vec3 L=directionalLights[0].direction; float t=clamp(dot(-normalize(vViewPosition),L),0.,1.); reflectedLight.directDiffuse+=directionalLights[0].color*diffuseColor.rgb*(.1+.55*t*t*t)*vColor.r; }
        #endif`);
  };
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: v.map, alphaTest: .5, side: THREE.DoubleSide });
  d.customProgramCacheKey = () => 'natured' + key; if (patch) d.onBeforeCompile = (sh) => patch(sh);
  return { m, d };
}

// ---------------------------------------------------------------- impostors (8 views around Y, albedo + view-space normal)
export const IMP_VIEWS = 8;
/** list: [{geo, map, H}] (map: colour atlas, vertex colour r = AO). Returns {map, nrm, rows, size:[S...], cy:[...]} or null. */
export function bakeImpostors(renderer, list, cell = 192) {
  if (!renderer || !list.length) return null; const W = cell * IMP_VIEWS, Ht = cell * list.length;
  const mk = () => { const t = new THREE.WebGLRenderTarget(W, Ht, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true }); t.texture.anisotropy = 4; return t; };
  const rtC = mk(), rtN = mk(); rtC.texture.colorSpace = THREE.SRGBColorSpace;
  const vs = 'attribute vec3 color; varying vec2 vUv; varying vec3 vN; varying float vAo; void main(){ vUv=uv; vAo=color.r; vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }';
  const fsC = 'uniform sampler2D map; varying vec2 vUv; varying vec3 vN; varying float vAo; void main(){ vec4 c=texture2D(map,vUv); if(c.a<.5) discard; gl_FragColor=vec4(c.rgb*vAo,1.);\n#include <colorspace_fragment>\n}';
  const fsN = 'uniform sampler2D map; varying vec2 vUv; varying vec3 vN; varying float vAo; void main(){ vec4 c=texture2D(map,vUv); if(c.a<.5) discard; vec3 n=normalize(vN); if(!gl_FrontFacing) n=-n; n.z=abs(n.z)*.7+.3; gl_FragColor=vec4(normalize(n)*.5+.5,vAo); }';
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 400), sizes = [], cys = [];
  const prev = { rt: renderer.getRenderTarget(), cc: renderer.getClearColor(new THREE.Color()), ca: renderer.getClearAlpha(), sc: renderer.getScissorTest(), xr: renderer.xr.enabled, sh: renderer.shadowMap.autoUpdate };
  renderer.xr.enabled = false;
  for (const [pass, rt] of [[0, rtC], [1, rtN]]) {
    rt.scissorTest = false; rt.viewport.set(0, 0, W, Ht); renderer.setRenderTarget(rt); renderer.setClearColor(pass ? 0x8080ff : 0x2a3220, 0); renderer.clear(); rt.scissorTest = true;
    list.forEach((it, row) => {
      it.geo.computeBoundingBox(); const b = it.geo.boundingBox, R = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z), S = Math.max(2 * R, b.max.y) * 1.04, cy = b.max.y / 2; if (!pass) { sizes.push(S); cys.push(cy); }
      const mat = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: pass ? fsN : fsC, uniforms: { map: { value: it.map } }, side: THREE.DoubleSide }), mesh = new THREE.Mesh(it.geo, mat); scene.add(mesh);
      cam.left = cam.bottom = -S / 2; cam.right = cam.top = S / 2; cam.updateProjectionMatrix();
      for (let k = 0; k < IMP_VIEWS; k++) { const a = k / IMP_VIEWS * Math.PI * 2; cam.position.set(Math.sin(a) * 200, cy + 200 * Math.tan(.06), Math.cos(a) * 200); cam.up.set(0, 1, 0); cam.lookAt(0, cy, 0); cam.updateMatrixWorld();
        const x = k * cell, y = (list.length - 1 - row) * cell; rt.viewport.set(x, y, cell, cell); rt.scissor.set(x, y, cell, cell); renderer.setRenderTarget(rt); renderer.render(scene, cam); }
      scene.remove(mesh); mat.dispose();
    });
  }
  for (const t of [rtC, rtN]) { t.scissorTest = false; t.viewport.set(0, 0, W, Ht); t.scissor.set(0, 0, W, Ht); } renderer.setRenderTarget(prev.rt); renderer.setClearColor(prev.cc, prev.ca); renderer.xr.enabled = prev.xr;
  return { map: rtC.texture, nrm: rtN.texture, rows: list.length, sizes, cys, targets: [rtC, rtN] };
}
/** Material for instanced impostor quads. Instance attrs: aIP (x,y,z,sy), aIS (row, yaw, sxz, hash). */
export function impostorMaterial(imp, u, fade) {
  const m = new THREE.MeshStandardMaterial({ roughness: .9, metalness: 0, fog: false, envMapIntensity: .6 }); m.customProgramCacheKey = () => 'nature-imp';
  const meta = new Float32Array(imp.rows * 2); imp.sizes.forEach((s, i) => { meta[i * 2] = s; meta[i * 2 + 1] = imp.cys[i]; });
  const metaTex = new THREE.DataTexture(meta, imp.rows, 1, THREE.RGFormat, THREE.FloatType); metaTex.needsUpdate = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uImpC: { value: imp.map }, uImpN: { value: imp.nrm }, uImpMeta: { value: metaTex }, uImpRows: { value: imp.rows }, uImpFade: fade });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 aIP, aIS; uniform sampler2D uImpMeta; uniform float uImpRows; uniform vec3 uCamP; uniform vec4 uImpFade; uniform vec2 uWind; uniform float uTime;
      varying vec2 vIUvA, vIUvB; varying float vIBl, vIFade; varying vec3 vIR, vIF;`)
      .replace('#include <beginnormal_vertex>', `vec3 toC=uCamP-aIP.xyz; float dc=length(toC.xz); vec2 dd=toC.xz/max(dc,1e-3); vec3 F=vec3(dd.x,0.,dd.y), Rr=vec3(dd.y,0.,-dd.x); vec3 objectNormal=F;`)
      .replace('#include <begin_vertex>', `vec2 mt=texture2D(uImpMeta,vec2((aIS.x+.5)/uImpRows,.5)).rg; float hs=aIS.w;
        float keep=mix(1.,.32,smoothstep(uImpFade.z,uImpFade.w,dc)); float grow=1.+.35*smoothstep(uImpFade.z,uImpFade.w,dc);
        vIFade=smoothstep(uImpFade.x*.9,uImpFade.x,dc)*step(hs,keep)*(1.-smoothstep(uImpFade.y*.92,uImpFade.y,dc));
        float S=mt.x*grow; vec3 transformed=aIP.xyz+Rr*position.x*S*aIS.z+vec3(0.,(position.y*S+mt.y*grow)*aIP.w,0.);
        transformed.xz+=uWind*.0009*max(transformed.y-aIP.y,0.)*max(transformed.y-aIP.y,0.)*(position.y+.5);
        if(vIFade<=0.) transformed=aIP.xyz;
        float ca=cos(aIS.y), sa=sin(aIS.y); vec2 l=vec2(ca*dd.x-sa*dd.y, sa*dd.x+ca*dd.y); float ang=atan(l.x,l.y)/6.2831853*${IMP_VIEWS}.; ang=mod(ang+${IMP_VIEWS}.,${IMP_VIEWS}.);
        float f0=floor(ang), f1=mod(f0+1.,${IMP_VIEWS}.); vIBl=ang-f0; vec2 cu=vec2(position.x+.5,position.y+.5);
        vIUvA=vec2((f0+cu.x)/${IMP_VIEWS}., (uImpRows-1.-aIS.x+cu.y)/uImpRows); vIUvB=vec2((f1+cu.x)/${IMP_VIEWS}., vIUvA.y); vIR=Rr; vIF=F;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uImpC, uImpN; varying vec2 vIUvA, vIUvB; varying float vIBl, vIFade; varying vec3 vIR, vIF; float impIgn(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }`)
      .replace('#include <map_fragment>', `float ig=impIgn(gl_FragCoord.xy); if(vIFade<=0.||ig<1.-vIFade) discard; vec2 iuv=ig<vIBl?vIUvB:vIUvA, gx=dFdx(vIUvA), gy=dFdy(vIUvA); vec4 ic=textureGrad(uImpC,iuv,gx,gy); if(ic.a<.5) discard; diffuseColor.rgb=ic.rgb; vec4 inr=textureGrad(uImpN,iuv,gx,gy);`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        { vec3 n=inr.xyz*2.-1.; vec3 nw=normalize(vIR*n.x+vec3(0.,1.,0.)*n.y+vIF*n.z); normal=normalize((viewMatrix*vec4(nw,0.)).xyz); nonPerturbedNormal=normal; }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS>0
        reflectedLight.directDiffuse+=directionalLights[0].color*diffuseColor.rgb*.12;
        #endif`);
  };
  return m;
}

// Fullscreen-pass helpers
import * as THREE from 'three';
import { FS_VERT } from './glsl.js';

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const mesh = new THREE.Mesh(geo); mesh.frustumCulled = false;
const scene = new THREE.Scene(); scene.add(mesh); scene.matrixWorldAutoUpdate = false; scene.matrixAutoUpdate = false;

export function fsMaterial(fragmentShader, uniforms, opts = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader, uniforms,
    depthTest: opts.depthWrite === true, depthWrite: opts.depthWrite === true, depthFunc: THREE.LessEqualDepth /* three swaps Always<->Never when reversed */,
    blending: opts.blending ?? THREE.NoBlending, transparent: false, toneMapped: false, fog: false, defines: opts.defines || {},
  });
}
export function draw(renderer, material, target = null, layer = 0) {
  mesh.material = material;
  renderer.setRenderTarget(target, layer);
  renderer.render(scene, cam);
}
export function compileAsync(renderer, materials) {
  // Warm programs up in parallel (KHR_parallel_shader_compile) without blocking
  const s = new THREE.Scene();
  for (const m of materials) { const o = new THREE.Mesh(geo, m); o.frustumCulled = false; s.add(o); }
  return renderer.compileAsync(s, cam);
}
export function hdrRT(w, h, o = {}) {
  return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    type: THREE.HalfFloatType, format: o.format ?? THREE.RGBAFormat, minFilter: o.filter ?? THREE.LinearFilter, magFilter: o.filter ?? THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false, count: o.count ?? 1, wrapS: o.wrapS ?? THREE.ClampToEdgeWrapping, wrapT: o.wrapT ?? THREE.ClampToEdgeWrapping, ...o.extra,
  });
}

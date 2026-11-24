// Offline vegetation baker (runs in headless Firefox). Loads a Poly Haven glTF, produces game-ready LODs:
// wood: meshoptimizer-simplified trunk/branches; foliage: "twig cards" textured with tiles rendered from the real leaves.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptSimplifier as MS } from '/mo/meshopt_simplifier.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1600, 900); document.body.appendChild(renderer.domElement); renderer.outputColorSpace = THREE.SRGBColorSpace;
const post = (name, data) => fetch('/out/' + name, { method: 'POST', body: data });
const rngf = (s) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const imgCache = new Map();
async function imageData(url) { // -> {w,h,d}
  if (imgCache.has(url)) return imgCache.get(url);
  const p = (async () => { const r = await fetch(url); if (!r.ok) return null; const bm = await createImageBitmap(await r.blob()); const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d'); g.drawImage(bm, 0, 0); return { w: bm.width, h: bm.height, d: g.getImageData(0, 0, bm.width, bm.height).data, bm }; })();
  imgCache.set(url, p); return p;
}
const texCache = new Map();
async function tex(url, srgb) { const k = url + srgb; if (texCache.has(k)) return texCache.get(k); const im = await imageData(url); if (!im) return null; const t = new THREE.Texture(im.bm); t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.needsUpdate = true; texCache.set(k, t); return t; }

// ---------------------------------------------------------------- load + flatten
async function load(cfg) {
  const base = `/dl/${cfg.src}/`, gltf = await new GLTFLoader().loadAsync(base + `${cfg.src}_1k.gltf`), J = gltf.parser.json; gltf.scene.updateMatrixWorld(true);
  const re = new RegExp(cfg.node), leafRe = new RegExp(cfg.leaf || 'leaves|leaf|twig', 'i'), parts = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return; let n = o, hit = null; while (n) { if (re.test(n.name)) { hit = n; break; } n = n.parent; } if (!hit) return;
    const mi = J.materials.findIndex((m) => m.name === o.material.name), mj = J.materials[mi]; const ti = mj.pbrMetallicRoughness?.baseColorTexture?.index, ni = mj.normalTexture?.index;
    const img = ti != null ? J.images[J.textures[ti].source].uri : null, nimg = ni != null ? J.images[J.textures[ni].source].uri : null;
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, I = g.index, m = o.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3();
    const pos = new Float32Array(P.count * 3), nrm = new Float32Array(P.count * 3), uv = new Float32Array(P.count * 2);
    for (let k = 0; k < P.count; k++) { v.fromBufferAttribute(P, k).applyMatrix4(m); pos.set([v.x, v.y, v.z], k * 3); v.fromBufferAttribute(N, k).applyMatrix3(nm).normalize(); nrm.set([v.x, v.y, v.z], k * 3); if (U) { uv[k * 2] = U.getX(k); uv[k * 2 + 1] = U.getY(k); } }
    const idx = I ? new Uint32Array(I.array) : Uint32Array.from({ length: P.count }, (_, k) => k);
    const foliage = !cfg.solid && leafRe.test(mj.name);
    const alpha = img ? img.replace(/_diff_1k\.jpg$/, '_alpha_1k.jpg') : null;
    parts.push({ pos, nrm, uv, idx, img: img && base + img, nimg: nimg && base + nimg, alpha: alpha && base + alpha, foliage, name: mj.name });
  });
  // normalise: ground at y=0, trunk base at x=z=0, scale to target
  let mnY = 1e9, mxY = -1e9, mnX = 1e9, mxX = -1e9, mnZ = 1e9, mxZ = -1e9;
  for (const p of parts) for (let k = 0; k < p.pos.length; k += 3) { mnY = Math.min(mnY, p.pos[k + 1]); mxY = Math.max(mxY, p.pos[k + 1]); mnX = Math.min(mnX, p.pos[k]); mxX = Math.max(mxX, p.pos[k]); mnZ = Math.min(mnZ, p.pos[k + 2]); mxZ = Math.max(mxZ, p.pos[k + 2]); }
  let cx = 0, cz = 0, cn = 0; const low = mnY + (mxY - mnY) * .04;
  for (const p of parts) if (!p.foliage) for (let k = 0; k < p.pos.length; k += 3) if (p.pos[k + 1] < low) { cx += p.pos[k]; cz += p.pos[k + 2]; cn++; }
  if (!cn || cfg.solid) { cx = (mnX + mxX) / 2; cz = (mnZ + mxZ) / 2; } else { cx /= cn; cz /= cn; }
  const s = cfg.solid ? cfg.R / Math.max(mxX - mnX, mxZ - mnZ) * 2 : cfg.H / (mxY - mnY), y0 = cfg.solid ? mnY + (mxY - mnY) * .12 : mnY;
  for (const p of parts) for (let k = 0; k < p.pos.length; k += 3) { p.pos[k] = (p.pos[k] - cx) * s; p.pos[k + 1] = (p.pos[k + 1] - y0) * s; p.pos[k + 2] = (p.pos[k + 2] - cz) * s; }
  return { parts, H: (mxY - y0) * s, s };
}

// ---------------------------------------------------------------- helpers
function components(idx, nv, pos) { // union-find over welded positions -> comp id per triangle
  const key = new Map(), weld = new Uint32Array(nv); for (let k = 0; k < nv; k++) { const h = Math.round(pos[k * 3] * 500) + ',' + Math.round(pos[k * 3 + 1] * 500) + ',' + Math.round(pos[k * 3 + 2] * 500); let w = key.get(h); if (w === undefined) key.set(h, w = k); weld[k] = w; }
  const par = new Int32Array(nv).map((_, i) => i), f = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  for (let t = 0; t < idx.length; t += 3) { const a = f(weld[idx[t]]), b = f(weld[idx[t + 1]]), c = f(weld[idx[t + 2]]); par[b] = a; par[f(c)] = a; }
  const comp = new Int32Array(idx.length / 3); for (let t = 0; t < idx.length; t += 3) comp[t / 3] = f(weld[idx[t]]); return comp;
}
function compact(pos, nrm, uv, extra, idx) { // drop unused verts
  const map = new Int32Array(pos.length / 3).fill(-1); let n = 0; const out = new Uint32Array(idx.length);
  for (let k = 0; k < idx.length; k++) { const v = idx[k]; if (map[v] < 0) map[v] = n++; out[k] = map[v]; }
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), E = extra ? new Float32Array(n * extra.stride) : null;
  for (let v = 0; v < map.length; v++) { const m = map[v]; if (m < 0) continue; P.set(pos.subarray(v * 3, v * 3 + 3), m * 3); N.set(nrm.subarray(v * 3, v * 3 + 3), m * 3); U.set(uv.subarray(v * 2, v * 2 + 2), m * 2); if (E) E.set(extra.a.subarray(v * extra.stride, (v + 1) * extra.stride), m * extra.stride); }
  return { pos: P, nrm: N, uv: U, ex: E, idx: out };
}
function mergeParts(list) { let nv = 0, ni = 0; for (const p of list) { nv += p.pos.length / 3; ni += p.idx.length; } const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), pid = new Float32Array(nv), idx = new Uint32Array(ni); let o = 0, oi = 0; list.forEach((p, j) => { const n = p.pos.length / 3; pos.set(p.pos, o * 3); nrm.set(p.nrm, o * 3); uv.set(p.uv, o * 2); pid.fill(j, o, o + n); for (let k = 0; k < p.idx.length; k++) idx[oi + k] = p.idx[k] + o; o += n; oi += p.idx.length; }); return { pos, nrm, uv, pid, idx }; }

// ---------------------------------------------------------------- wood
function simplifyWood(m, target, minSize) {
  // drop small disconnected twigs, then simplify (meshopt keeps attribute seams)
  let idx = m.idx; if (minSize > 0) { const comp = components(idx, m.pos.length / 3, m.pos), bb = new Map(); for (let t = 0; t < comp.length; t++) { let b = bb.get(comp[t]); if (!b) bb.set(comp[t], b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]); for (let j = 0; j < 3; j++) { const v = idx[t * 3 + j]; for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], m.pos[v * 3 + a]); b[a + 3] = Math.max(b[a + 3], m.pos[v * 3 + a]); } } }
    const keep = []; for (let t = 0; t < comp.length; t++) { const b = bb.get(comp[t]); if (Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) >= minSize) keep.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]); } idx = new Uint32Array(keep); }
  if (idx.length / 3 > target) { const [r] = MS.simplify(idx, m.pos, 3, target * 3, .08, []); idx = r; if (idx.length / 3 > target * 1.6) { const [r2] = MS.simplifyWithAttributes(idx, m.pos, 3, m.uv, 2, [.5, .5], null, target * 3, .3, ['Permissive']); idx = r2; } if (idx.length / 3 > target * 1.6) { const [r3] = MS.simplifySloppy(idx, m.pos, 3, null, target * 3, .3); idx = r3; } }
  const ex = { a: new Float32Array(m.pid), stride: 1 }; const c = compact(m.pos, m.nrm, m.uv, ex, idx); return { pos: c.pos, nrm: c.nrm, uv: c.uv, pid: c.ex, idx: c.idx };
}

// ---------------------------------------------------------------- foliage clustering
function kmeans(pts, w, K, iters, r) { // pts Float32 xyz, w weights -> {c: Float32 K*3, a: Int32 assignment}
  const n = w.length, C = new Float32Array(K * 3), a = new Int32Array(n), d2 = new Float32Array(n).fill(1e18);
  let first = Math.floor(r() * n); C.set(pts.subarray(first * 3, first * 3 + 3), 0);
  for (let k = 1; k < K; k++) { let sum = 0; for (let i = 0; i < n; i++) { const dx = pts[i * 3] - C[(k - 1) * 3], dy = pts[i * 3 + 1] - C[(k - 1) * 3 + 1], dz = pts[i * 3 + 2] - C[(k - 1) * 3 + 2]; d2[i] = Math.min(d2[i], dx * dx + dy * dy + dz * dz); sum += d2[i] * w[i]; } let t = r() * sum, i = 0; for (; i < n - 1; i++) { t -= d2[i] * w[i]; if (t <= 0) break; } C.set(pts.subarray(i * 3, i * 3 + 3), k * 3); }
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) { let best = 0, bd = 1e18; const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2]; for (let k = 0; k < K; k++) { const dx = x - C[k * 3], dy = y - C[k * 3 + 1], dz = z - C[k * 3 + 2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = k; } } a[i] = best; }
    const S = new Float64Array(K * 4); for (let i = 0; i < n; i++) { const k = a[i]; S[k * 4] += pts[i * 3] * w[i]; S[k * 4 + 1] += pts[i * 3 + 1] * w[i]; S[k * 4 + 2] += pts[i * 3 + 2] * w[i]; S[k * 4 + 3] += w[i]; }
    for (let k = 0; k < K; k++) if (S[k * 4 + 3] > 0) { C[k * 3] = S[k * 4] / S[k * 4 + 3]; C[k * 3 + 1] = S[k * 4 + 1] / S[k * 4 + 3]; C[k * 3 + 2] = S[k * 4 + 2] / S[k * 4 + 3]; }
  }
  return { c: C, a };
}
function leafTris(fol) { // per-triangle centroid, normal, area
  const n = fol.idx.length / 3, c = new Float32Array(n * 3), nr = new Float32Array(n * 3), ar = new Float32Array(n), A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
  for (let t = 0; t < n; t++) { const i0 = fol.idx[t * 3], i1 = fol.idx[t * 3 + 1], i2 = fol.idx[t * 3 + 2]; A.fromArray(fol.pos, i0 * 3); B.fromArray(fol.pos, i1 * 3); Cc.fromArray(fol.pos, i2 * 3); c[t * 3] = (A.x + B.x + Cc.x) / 3; c[t * 3 + 1] = (A.y + B.y + Cc.y) / 3; c[t * 3 + 2] = (A.z + B.z + Cc.z) / 3; B.sub(A); Cc.sub(A); B.cross(Cc); ar[t] = B.length() / 2; B.normalize(); nr.set([B.x, B.y, B.z], t * 3); }
  return { n, c, nr, ar };
}
function clusters(L, K, r, crown) { // -> [{c:Vector3, n:Vector3, h, cnt}]
  const step = Math.max(1, Math.floor(L.n / 50000)), sel = []; for (let t = 0; t < L.n; t += step) if (L.ar[t] > 0) sel.push(t);
  const pts = new Float32Array(sel.length * 3), w = new Float32Array(sel.length); sel.forEach((t, i) => { pts.set(L.c.subarray(t * 3, t * 3 + 3), i * 3); w[i] = Math.sqrt(L.ar[t]); });
  const km = kmeans(pts, w, K, 9, r), out = [];
  for (let k = 0; k < K; k++) out.push({ c: new THREE.Vector3().fromArray(km.c, k * 3), mn: new THREE.Vector3(), cnt: 0, pts: [] });
  sel.forEach((t, i) => { const o = out[km.a[i]]; o.cnt++; o.pts.push(i); o.mn.x += Math.abs(L.nr[t * 3]); });
  const up = new THREE.Vector3(0, 1, 0), res = [];
  for (const o of out) {
    if (o.cnt < 3) continue; const c = o.c, hor = new THREE.Vector3(c.x - crown.x, 0, c.z - crown.z), hl = hor.length(); const vy = (c.y - crown.y) / Math.max(1, crown.ry);
    const n = (hl > .05 ? hor.divideScalar(hl) : new THREE.Vector3(r() - .5, 0, r() - .5).normalize()).multiplyScalar(1).add(new THREE.Vector3(0, Math.max(-.3, vy) * .9 + .15, 0)).normalize();
    n.x += (r() - .5) * .5; n.z += (r() - .5) * .5; n.normalize();
    if (crown.pca > 0 && o.pts.length > 8) { // plane fit (billboard cloud): smallest principal axis of the cluster
      const C = [0, 0, 0, 0, 0, 0]; for (const i of o.pts) { const dx = pts[i * 3] - c.x, dy = pts[i * 3 + 1] - c.y, dz = pts[i * 3 + 2] - c.z; C[0] += dx * dx; C[1] += dx * dy; C[2] += dx * dz; C[3] += dy * dy; C[4] += dy * dz; C[5] += dz * dz; }
      const M = (v) => new THREE.Vector3(C[0] * v.x + C[1] * v.y + C[2] * v.z, C[1] * v.x + C[3] * v.y + C[4] * v.z, C[2] * v.x + C[4] * v.y + C[5] * v.z);
      let e1 = new THREE.Vector3(1, .3, .2); for (let k = 0; k < 30; k++) e1 = M(e1).normalize(); let e2 = new THREE.Vector3(.2, 1, .3); for (let k = 0; k < 30; k++) { e2 = M(e2); e2.addScaledVector(e1, -e2.dot(e1)).normalize(); }
      const pn = new THREE.Vector3().crossVectors(e1, e2).normalize(); if (pn.dot(n) < 0) pn.negate(); n.lerp(pn, crown.pca).normalize(); }
    let rt = new THREE.Vector3().crossVectors(up, n); if (rt.lengthSq() < 1e-4) rt.set(1, 0, 0); rt.normalize(); const uv = new THREE.Vector3().crossVectors(n, rt);
    const a = r() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), R = rt.clone().multiplyScalar(ca).addScaledVector(uv, sa), U = uv.clone().multiplyScalar(ca).addScaledVector(rt, -sa);
    const px = [], py = []; for (const i of o.pts) { const dx = pts[i * 3] - c.x, dy = pts[i * 3 + 1] - c.y, dz = pts[i * 3 + 2] - c.z; px.push(Math.abs(dx * R.x + dy * R.y + dz * R.z)); py.push(Math.abs(dx * U.x + dy * U.y + dz * U.z)); }
    px.sort((a, b) => a - b); py.sort((a, b) => a - b); const q = (arr) => arr[Math.floor(arr.length * .85)] || .1;
    res.push({ c, n, R, U, h: Math.max(q(px), q(py)), cnt: o.cnt });
  }
  return res;
}

// ---------------------------------------------------------------- tile rendering (albedo + card-space normal)
const nrmMat = (alphaMap, map) => new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { aMap: { value: alphaMap }, cMap: { value: map } }, vertexShader: 'varying vec3 vN; varying vec2 vUv; void main(){ vUv=uv; vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: 'uniform sampler2D aMap,cMap; varying vec3 vN; varying vec2 vUv; void main(){ float a=texture2D(aMap,vUv).g; if(a<.5) discard; vec3 n=normalize(vN); if(!gl_FrontFacing) n=-n; if(n.z<0.) n.z=-n.z*.4; n=normalize(n); gl_FragColor=vec4(n*.5+.5,1.); }' });
async function renderTiles(fol, parts, tiles, px) { // tiles: [{c,n,R,U,h}] -> [{col: Uint8 RGBA px*px, nrm}]
  const SS = 2, W = px * SS, rt = new THREE.WebGLRenderTarget(W, W, { colorSpace: THREE.SRGBColorSpace }), rtN = new THREE.WebGLRenderTarget(W, W);
  const scene = new THREE.Scene(), sceneN = new THREE.Scene(), out = [];
  for (const T of tiles) {
    scene.clear(); sceneN.clear(); const r2 = (T.h * 1.12) ** 2;
    for (const p of parts) { // gather triangles near the tile centre
      const keep = []; for (let t = 0; t < p.idx.length; t += 3) { let x = 0, y = 0, z = 0; for (let j = 0; j < 3; j++) { const v = p.idx[t + j]; x += p.pos[v * 3]; y += p.pos[v * 3 + 1]; z += p.pos[v * 3 + 2]; } x = x / 3 - T.c.x; y = y / 3 - T.c.y; z = z / 3 - T.c.z; if (x * x + y * y + z * z < r2) keep.push(p.idx[t], p.idx[t + 1], p.idx[t + 2]); }
      if (!keep.length || !p.img) continue; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(p.nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2)); g.setIndex(keep);
      const map = await tex(p.img, true), am = p.foliage ? await tex(p.alpha, false) : null;
      scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map, alphaMap: am, alphaTest: .5, side: THREE.DoubleSide })));
      sceneN.add(new THREE.Mesh(g, nrmMat(am || whiteTex, map)));
    }
    const h = T.h, cam = new THREE.OrthographicCamera(-h, h, h, -h, .01, h * 8); cam.position.copy(T.c).addScaledVector(T.n, h * 4); cam.up.copy(T.U); cam.lookAt(T.c); cam.updateMatrixWorld();
    const read = (sc, target) => { renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cam); const b = new Uint8Array(W * W * 4); renderer.readRenderTargetPixels(target, 0, 0, W, W, b); renderer.setRenderTarget(null); return down(b, W, SS); };
    out.push({ col: read(scene, rt), nrm: read(sceneN, rtN) });
  }
  return out;
}
const whiteTex = (() => { const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t; })();
function down(b, W, S) { // box downsample + flip rows (readPixels is bottom-up); colour weighted by alpha
  const w = W / S, o = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { let r = 0, g = 0, bb = 0, a = 0; for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = ((y * S + j) * W + x * S + i) * 4, al = b[k + 3]; r += b[k] * al; g += b[k + 1] * al; bb += b[k + 2] * al; a += al; } const k = ((w - 1 - y) * w + x) * 4; if (a > 0) { o[k] = r / a; o[k + 1] = g / a; o[k + 2] = bb / a; } o[k + 3] = a / (S * S); }
  return o;
}
function dilate(img, w, h, passes, fill) { // bleed colour into transparent texels (no dark halos in mips)
  const d = img, known = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) known[i] = d[i * 4 + 3] > 8 ? 1 : 0;
  for (let p = 0; p < passes; p++) { const nk = known.slice(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (known[i]) continue; let r = 0, g = 0, b = 0, n = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (!known[j]) continue; r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; n++; } if (n) { d[i * 4] = r / n; d[i * 4 + 1] = g / n; d[i * 4 + 2] = b / n; nk[i] = 1; } } known.set(nk); }
  if (fill) for (let i = 0; i < w * h; i++) if (!known[i]) { d[i * 4] = fill[0]; d[i * 4 + 1] = fill[1]; d[i * 4 + 2] = fill[2]; }
}

// ---------------------------------------------------------------- main bake
const TILE = (A) => { const t = A / 2; return [[0, 0, t, t], [t, 0, t, t], [0, t, t, t]]; }; // x,y,w,h from top-left; tiles 0,1 = LOD0 twigs, 2 = LOD1 branch
export async function bake(cfg) {
  await MS.ready; const r = rngf(cfg.id.length * 977 + 13), A = cfg.atlas || 1024, half = A / 2, PAL_H = A / 32;
  const { parts, H } = await load(cfg); const wood = parts.filter((p) => !p.foliage), folP = parts.filter((p) => p.foliage && !cfg.noLeaves);
  const atlas = new OffscreenCanvas(A, A), g = atlas.getContext('2d'), atlasN = new OffscreenCanvas(A, A), gn = atlasN.getContext('2d'); gn.fillStyle = 'rgb(128,128,255)'; gn.fillRect(0, 0, A, A);
  const lods = [];
  // ---- solid (rocks): whole texture, simplified mesh
  if (cfg.solid) {
    const m = mergeParts(wood), im = await imageData(wood[0].img), imN = await imageData(wood[0].nimg); g.drawImage(im.bm, 0, 0, A, A); gn.drawImage(imN.bm, 0, 0, A, A);
    for (const tgt of [cfg.w0, cfg.w1]) { const s = simplifyWood(m, tgt, 0); const uv = s.uv.map((v, i) => (i & 1 ? 1 - v : v)); lods.push(pack(s.pos, s.nrm, uv, null, s.idx, () => [255, 0, 40])); }
    return finish(cfg, lods, atlas, atlasN, H, A);
  }
  // ---- crown frame
  const fol = folP.length ? mergeParts(folP) : null, L = fol ? leafTris(fol) : null;
  let crown = { x: 0, z: 0, y: H * .6, ry: H * .3, rx: H * .3 };
  if (L) { let sx = 0, sy = 0, sz = 0, sw = 0, my = 1e9, My = -1e9, mr = 0; for (let t = 0; t < L.n; t += 7) { sx += L.c[t * 3] * L.ar[t]; sy += L.c[t * 3 + 1] * L.ar[t]; sz += L.c[t * 3 + 2] * L.ar[t]; sw += L.ar[t]; my = Math.min(my, L.c[t * 3 + 1]); My = Math.max(My, L.c[t * 3 + 1]); }
    crown = { x: sx / sw, y: sy / sw, z: sz / sw, ry: (My - my) / 2, pca: cfg.pca ?? .5 }; for (let t = 0; t < L.n; t += 7) mr = Math.max(mr, Math.hypot(L.c[t * 3] - crown.x, L.c[t * 3 + 2] - crown.z)); crown.rx = mr; crown.my = my; crown.My = My; }
  const aoAt = (x, y, z) => { if (!L) return 1; const rr = Math.hypot(x - crown.x, z - crown.z) / Math.max(.3, crown.rx), hy = (y - crown.my) / Math.max(.3, crown.My - crown.my); if (hy < -.05) return .92; return Math.min(1, .42 + .5 * Math.min(1, rr) ** 1.2 + .25 * Math.max(0, hy)); };
  // ---- wood: main texture -> bottom-right quadrant, other textures -> palette strip
  const woodTexUrl = cfg.woodTex ? `/dl/${cfg.src}/textures/${cfg.woodTex}_1k.jpg` : null; let palette = [], palMap = new Map();
  const WOOD_R = [half, half, half, half - PAL_H]; // x,y,w,h
  if (woodTexUrl) { const im = await imageData(woodTexUrl); g.drawImage(im.bm, WOOD_R[0], WOOD_R[1], WOOD_R[2], WOOD_R[3]); const imN = await imageData(woodTexUrl.replace('_diff_', '_nor_gl_')); if (imN) gn.drawImage(imN.bm, WOOD_R[0], WOOD_R[1], WOOD_R[2], WOOD_R[3]); }
  const palUV = async (p, u, v) => { const im = await imageData(p.img); if (!im) return [0.75, PAL_H / 2 / A]; const x = ((u % 1) + 1) % 1 * im.w | 0, y = ((v % 1) + 1) % 1 * im.h | 0, k = (y * im.w + x) * 4; const q = [im.d[k] >> 4, im.d[k + 1] >> 4, im.d[k + 2] >> 4], key = q.join(); let i = palMap.get(key); if (i === undefined) { i = palette.length; palette.push(q); palMap.set(key, i); } const pw = half, px = i % pw, py = Math.floor(i / pw) % PAL_H; return [(half + px + .5) / A, 1 - (A - PAL_H + py + .5) / A]; };
  const woodM = wood.length ? mergeParts(wood) : null;
  async function woodLOD(target, minSize) {
    if (!woodM || target <= 0) return null; const s = simplifyWood(woodM, target, minSize); const n = s.pos.length / 3, uv = new Float32Array(n * 2);
    for (let v = 0; v < n; v++) { const p = wood[s.pid[v]], u0 = s.uv[v * 2], v0 = s.uv[v * 2 + 1]; if (woodTexUrl && p.img === woodTexUrl) { uv[v * 2] = (WOOD_R[0] + Math.min(1, Math.max(0, u0)) * WOOD_R[2]) / A; uv[v * 2 + 1] = 1 - (WOOD_R[1] + Math.min(1, Math.max(0, v0)) * WOOD_R[3]) / A; } else { const q = await palUV(p, u0, v0); uv[v * 2] = q[0]; uv[v * 2 + 1] = q[1]; } }
    return { ...s, uv };
  }
  // ---- foliage cards
  let tilesK0 = null, cl0 = null, cl1 = null;
  if (L && cfg.K0) {
    cl0 = clusters(L, cfg.K0, r, crown); cl1 = clusters(L, cfg.K1, r, crown);
    const pick = (cl, n) => { const hs = cl.map((c) => c.h).sort((a, b) => a - b), med = hs[Math.floor(hs.length * .55)]; const outer = cl.filter((c) => Math.abs(c.h - med) < med * .35).sort((a, b) => b.cnt - a.cnt); const res = []; for (let i = 0; i < n && outer.length; i++) res.push({ ...outer[Math.floor(i * outer.length / n * .6)], h: med * (cfg.tileMul ?? 1.3) }); return res; };
    const t0 = pick(cl0, 2), t1 = pick(cl1, 1); const imgs = await renderTiles(fol, folP.concat(cfg.tileWood === false ? [] : wood), t0.concat(t1), half);
    const TR = TILE(A); imgs.forEach((im, i) => { const [x, y, w] = TR[i]; dilate(im.col, w, w, 24, [60, 70, 40]); putRGBA(g, im.col, w, x, y); dilate(im.nrm, w, w, 8, [128, 128, 255]); putRGBA(gn, im.nrm.map((v, j) => (j & 3) === 3 ? 255 : v), w, x, y); });
    tilesK0 = { t0, t1 };
  }
  // palette strip
  { const id = g.getImageData(half, A - PAL_H, half, PAL_H); palette.forEach((q, i) => { const k = ((Math.floor(i / half) % PAL_H) * half + i % half) * 4; id.data[k] = q[0] * 17; id.data[k + 1] = q[1] * 17; id.data[k + 2] = q[2] * 17; id.data[k + 3] = 255; }); g.putImageData(id, half, A - PAL_H); gn.fillStyle = 'rgb(128,128,255)'; gn.fillRect(half, A - PAL_H, half, PAL_H); }
  if (!woodTexUrl) { // fill the empty wood quadrant with palette-ish colour so mips stay sane
    const id = g.getImageData(half, half, half, half - PAL_H); const c = palette[0] || [6, 5, 4]; for (let k = 0; k < id.data.length; k += 4) { id.data[k] = c[0] * 17; id.data[k + 1] = c[1] * 17; id.data[k + 2] = c[2] * 17; id.data[k + 3] = 255; } g.putImageData(id, half, half); }
  const cards = (cl, tileIdx, sizeMul, cross) => { // -> geometry arrays
    const P = [], N = [], U = [], C = [], I = [], TR = TILE(A), m = 6 / A;
    for (const k of cl) {
      const ti = tileIdx(k), [tx, ty, tw] = TR[ti], u0 = tx / A + m, u1 = (tx + tw) / A - m, v1 = 1 - ty / A - m, v0 = 1 - (ty + tw) / A + m, h = k.h * sizeMul;
      const sph = new THREE.Vector3(k.c.x - crown.x, (k.c.y - crown.y) * .7, k.c.z - crown.z).normalize(); const ao = aoAt(k.c.x, k.c.y, k.c.z);
      const quad = (R, Uv, n) => { const o = P.length / 3, nn = n.clone().multiplyScalar(.45).addScaledVector(sph, .55).normalize(); for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(k.c.x + (R.x * a + Uv.x * b) * h, k.c.y + (R.y * a + Uv.y * b) * h, k.c.z + (R.z * a + Uv.z * b) * h); N.push(nn.x, nn.y, nn.z); U.push(a < 0 ? u0 : u1, b < 0 ? v0 : v1); C.push(ao * 255, 255, 255); } I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
      quad(k.R, k.U, k.n); if (r() < cross) { const n2 = k.U.clone(); quad(k.R, k.n.clone().negate(), n2); }
    }
    return { pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(U), col: C, idx: new Uint32Array(I) };
  };
  const join = (w, f) => { // wood + foliage -> packed lod
    const parts2 = [], cols = []; if (w) { parts2.push(w); const n = w.pos.length / 3; for (let v = 0; v < n; v++) cols.push(aoAt(w.pos[v * 3], w.pos[v * 3 + 1], w.pos[v * 3 + 2]) * 255, 0, 150); }
    if (f) { parts2.push(f); cols.push(...f.col); } if (!parts2.length) return null; const m = mergeParts(parts2); return pack(m.pos, m.nrm, m.uv, cols, m.idx);
  };
  const w0 = await woodLOD(cfg.w0, cfg.minWood0 ?? .3), w1 = await woodLOD(cfg.w1, cfg.minWood1 ?? 2);
  const f0 = cl0 ? cards(cl0, () => (r() < .5 ? 0 : 1), cfg.size0 ?? 1.55, cfg.cross ?? .4) : null, f1 = cl1 ? cards(cl1, () => (r() < .65 ? 2 : r() < .5 ? 0 : 1), cfg.size1 ?? 1.6, (cfg.cross ?? .4) * .8) : null;
  lods.push(join(w0, f0), join(w1, f1));
  // ---- stump (broken state): lower trunk of the detailed wood, jagged top + light-wood cap
  if (!cfg.shrub && w0) lods.push(stump(w0, H, r, A, palUV));
  else lods.push(null);
  return finish(cfg, lods, atlas, atlasN, H, A, crown);
}
function putRGBA(g, d, w, x, y) { const id = new ImageData(new Uint8ClampedArray(d.buffer.slice(0)), w, w); g.putImageData(id, x, y); }
function stump(w, H, r, A, palUV) {
  const hc = Math.min(H * .2, 3.2), P = w.pos, n = P.length / 3; let ax = 0, az = 0, an = 0; for (let v = 0; v < n; v++) if (P[v * 3 + 1] < hc) { ax += P[v * 3]; az += P[v * 3 + 2]; an++; } ax /= an || 1; az /= an || 1;
  const rads = []; for (let v = 0; v < n; v++) if (P[v * 3 + 1] > hc * .3 && P[v * 3 + 1] < hc) rads.push(Math.hypot(P[v * 3] - ax, P[v * 3 + 2] - az)); rads.sort((a, b) => a - b); const tr = rads[Math.floor(rads.length * .5)] || .2;
  const keep = []; for (let t = 0; t < w.idx.length; t += 3) { let ok = true, lo = false; for (let j = 0; j < 3; j++) { const v = w.idx[t + j]; if (Math.hypot(P[v * 3] - ax, P[v * 3 + 2] - az) > tr * 3.5) ok = false; if (P[v * 3 + 1] < hc) lo = true; } if (ok && lo) keep.push(w.idx[t], w.idx[t + 1], w.idx[t + 2]); }
  const pos = new Float32Array(P), jag = (x, z) => { const a = Math.atan2(z - az, x - ax); return hc + (Math.sin(a * 3 + 1) * .5 + Math.sin(a * 7 + 2) * .35 + .4) * tr * .75; };
  for (let v = 0; v < n; v++) if (pos[v * 3 + 1] > hc) pos[v * 3 + 1] = Math.min(pos[v * 3 + 1], jag(pos[v * 3], pos[v * 3 + 2]));
  const c = compact(pos, w.nrm, w.uv, null, new Uint32Array(keep)); const cols = []; for (let v = 0; v < c.pos.length / 3; v++) cols.push(235, 0, 0);
  // cap
  const capP = [], capN = [], capU = [], capC = [], capI = [], cu = [(A / 2 + A / 4) / A, 1 - (A - 2) / A], seg = 12, o = c.pos.length / 3;
  capP.push(ax, hc + tr * .3, az); capN.push(0, 1, 0); capU.push(...cu); capC.push(255, 0, 0);
  for (let k = 0; k <= seg; k++) { const a = k / seg * Math.PI * 2, x = ax + Math.cos(a) * tr * .95, z = az + Math.sin(a) * tr * .95; capP.push(x, jag(x, z) - tr * .5 * (k & 1), z); capN.push(Math.cos(a) * .3, 1, Math.sin(a) * .3); capU.push(...cu); capC.push(200, 0, 0); }
  for (let k = 0; k < seg; k++) capI.push(o, o + 2 + k, o + 1 + k);
  const pos2 = new Float32Array([...c.pos, ...capP]), nrm2 = new Float32Array([...c.nrm, ...capN]), uv2 = new Float32Array([...c.uv, ...capU]), idx2 = new Uint32Array([...c.idx, ...capI]);
  return pack(pos2, nrm2, uv2, cols.concat(capC), idx2);
}
// light-wood cap colour lives at the palette strip's last texels: written in finish()
function pack(pos, nrm, uv, cols, idx, colFn) {
  const n = pos.length / 3; const P = new Float32Array(pos), N = new Int8Array(n * 4), U = new Uint16Array(n * 2), C = new Uint8Array(n * 4);
  for (let v = 0; v < n; v++) { const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1; for (let a = 0; a < 3; a++) N[v * 4 + a] = Math.round(nrm[v * 3 + a] / l * 127); U[v * 2] = Math.round(Math.min(1, Math.max(0, uv[v * 2])) * 65535); U[v * 2 + 1] = Math.round(Math.min(1, Math.max(0, uv[v * 2 + 1])) * 65535); const c = cols ? [cols[v * 3], cols[v * 3 + 1], cols[v * 3 + 2]] : colFn(v); C[v * 4] = c[0]; C[v * 4 + 1] = c[1]; C[v * 4 + 2] = c[2]; C[v * 4 + 3] = 255; }
  const I = n < 65536 ? new Uint16Array(idx) : new Uint32Array(idx); return { P, N, U, C, I, nv: n, ni: idx.length };
}
async function finish(cfg, lods, atlas, atlasN, H, A, crown) {
  const g = atlas.getContext('2d'); g.fillStyle = 'rgb(150,120,84)'; g.fillRect(A / 2 + A / 4 - 4, A - 4, 8, 4); // stump cap texel
  // binary: 'VEG1' u32 jsonLen json (pad4) then per lod P N U C I
  const meta = { id: cfg.id, H: +H.toFixed(3), A, crown: crown ? { y: +crown.y.toFixed(2), r: +crown.rx.toFixed(2), ry: +crown.ry.toFixed(2) } : null, lods: lods.map((l) => (l ? { nv: l.nv, ni: l.ni, i32: l.I instanceof Uint32Array } : null)) };
  const js = new TextEncoder().encode(JSON.stringify(meta)), jl = (js.length + 3) & ~3, chunks = [new Uint8Array([86, 69, 71, 49]), new Uint8Array(new Uint32Array([jl]).buffer), (() => { const b = new Uint8Array(jl).fill(32); b.set(js); return b; })()];
  const pad = (b) => { const u = new Uint8Array(b.buffer, b.byteOffset, b.byteLength); const l = (u.length + 3) & ~3; if (l === u.length) return u; const o = new Uint8Array(l); o.set(u); return o; };
  for (const l of lods) if (l) chunks.push(pad(l.P), pad(l.N), pad(l.U), pad(l.C), pad(l.I));
  await post(cfg.id + '.bin', new Blob(chunks));
  for (const [c, suf] of [[atlas, '_c'], [atlasN, '_n']]) { const d = c.getContext('2d').getImageData(0, 0, A, A).data; const hdr = new Uint32Array([A, A]); await post(cfg.id + suf + '.rgba', new Blob([hdr, d])); }
  return { id: cfg.id, H: meta.H, lods: meta.lods, tris: lods.map((l) => (l ? l.ni / 3 : 0)) };
}
window.bake = bake; window.ready = true;

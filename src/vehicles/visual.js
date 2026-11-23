// Runtime visual of a vehicle: meshes, LOD, wheels, steering, lamps, wipers, whips, dish, skirts, screens, damage.
import * as THREE from 'three';
import { SPECS, TYPE_IDS } from './specs.js';
import { BUILDERS, buildKit } from './defs.js';
import { buildWheel, buildCaliper } from './kit.js';
import { rbox, pipe, tube, cyl, lathe, torus, Trim } from './mesh.js';
import { ST } from './kit.js';
import { makeUniforms, paintMaterial, trimMaterial, glassMaterial, lensMaterial, coneMaterial, glowMaterial } from './materials.js';
import { clamp, damp, lerp } from '../core/math.js';

const cache = new Map();
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion();
function merge(list) { // list of [geometry]
  let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; } const p = new Float32Array(nv * 3), n = new Float32Array(nv * 3), u = new Float32Array(nv * 3), I = new Uint32Array(ni); let a = 0, b = 0;
  for (const g of list) { p.set(g.attributes.position.array, a * 3); n.set(g.attributes.normal.array, a * 3); u.set(g.attributes.aUv.array, a * 3); const ix = g.index.array; for (let k = 0; k < ix.length; k++) I[b + k] = ix[k] + a; a += g.attributes.position.count; b += ix.length; g.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); g.setAttribute('aUv', new THREE.BufferAttribute(u, 3)); g.setIndex(new THREE.BufferAttribute(I, 1)); return g;
}
export function getModel(type) {
  let m = cache.get(type); if (m) return m; const spec = SPECS[type], def = BUILDERS[type]; m = { lods: [] };
  for (const lod of [0, 1]) {
    const K = buildKit(type, lod), P = K.paint; const o = { K, paint: merge([P.wall.geometry(0), P.cap.geometry(1), P.house.geometry(2)]), trim: K.trim.geometry(), glass: K.glass.geometry(), lens: K.lens.count ? K.lens.geometry() : null, red: K.red.count ? K.red.geometry() : null, wheel: buildWheel(spec, def.wheel, lod).geometry(), wheelR: def.wheelR ? buildWheel(spec, def.wheelR, lod).geometry() : null, caliper: lod ? null : buildCaliper(spec, def.wheel).geometry() };
    for (const [k, t] of Object.entries(K.parts2 || {})) (o.parts || (o.parts = {}))[k] = { geo: t.trim.geometry(), ...t };
    o.tris = [o.paint, o.trim, o.glass, o.lens, o.red].reduce((s, g) => s + (g ? g.index.count / 3 : 0), 0) + o.wheel.index.count / 3 * (o.wheelR ? 2 : 4) + (o.wheelR ? o.wheelR.index.count / 3 * 2 : 0); if (!lod) m.atlas = { tex: K.atlas.texture(), rect: K.atlas.rect }; m.lods.push(o);
  }
  // steering wheel
  const sw = new Trim(), R = 0.185; sw.add(torus(R, 0.0155, 10, 40).map((p) => { if (p[1] < -R * 0.8) p[1] = -R * 0.8 + (p[1] + R * 0.8) * 0.4; }), ST.black); sw.add(rbox(0.13, 0.11, 0.05, 0.03, 2).at(0, 0, 0.0), ST.dash2); for (const s of [-1, 1]) sw.add(rbox(0.12, 0.035, 0.02, 0.008).at(s * 0.115, 0.0, -0.005), ST.gloss); sw.add(rbox(0.04, 0.1, 0.02, 0.008).at(0, -0.1, -0.005), ST.gloss); sw.add(rbox(0.05, 0.012, 0.004, 0.002).at(0, 0.02, 0.026), ST.satinIn); m.steer = sw.geometry();
  // two-tone driver hands are added by the player camera; wipers
  const wp = new Trim(); wp.add(pipe([0, 0, 0], [0.24, 0.03, 0], 0.006, 6), ST.black); wp.add(pipe([0.24, 0.03, 0], [0.3, 0.024, 0], 0.005, 6), ST.black); wp.add(rbox(0.5, 0.012, 0.009, 0.003).at(0.3, 0.012, 0), ST.black); wp.add(rbox(0.5, 0.004, 0.014, 0.001).at(0.3, 0.006, 0), ST.rubber); wp.add(cyl(0.015, 0.012, 0.02, 10).at(0, 0, 0), ST.black); m.wiper = wp.geometry();
  const an = new Trim(); for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; an.add(pipe([0, 0, 0], [Math.cos(a) * 0.075, 0, Math.sin(a) * 0.075], 0.0035, 5), ST.powder); an.add(lathe([[0.001, -0.022], [0.016, -0.016], [0.023, 0]], 10).at(0, 0, 0, Math.PI / 2, 0, 0).at(Math.cos(a) * 0.085, 0, Math.sin(a) * 0.085, 0, -a, 0), ST.powder); } m.anemo = an.geometry();
  const vn = new Trim(); vn.add(pipe([0, 0.02, -0.1], [0, 0.02, 0.1], 0.004, 5), ST.alu); vn.add(rbox(0.003, 0.07, 0.07, 0.001).at(0, 0.03, 0.12), ST.powder); vn.add(cyl(0.012, 0.001, 0.04, 8).at(0, 0.02, -0.12, -Math.PI / 2, 0, 0), ST.alu); m.vane = vn.geometry();
  cache.set(type, m); return m;
}
let plateTex = null;
function makePlate(n) {
  if (typeof document === 'undefined') return null; const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#cfe0ea'); gr.addColorStop(0.55, '#f1ead8'); gr.addColorStop(1, '#d9b98a'); g.fillStyle = gr; g.fillRect(0, 0, 512, 256); g.fillStyle = 'rgba(70,60,45,.25)'; g.beginPath(); g.moveTo(0, 200); for (let x = 0; x <= 512; x += 32) g.lineTo(x, 196 + Math.sin(x * 0.03) * 12); g.lineTo(512, 256); g.lineTo(0, 256); g.fill();
  g.fillStyle = '#1b2d44'; g.textAlign = 'center'; g.font = '700 32px "Segoe UI",Arial,sans-serif'; g.fillText('T O R N A D O   A L L E Y', 256, 46); g.font = '900 128px "Arial Narrow",Arial,sans-serif'; g.fillText(n, 256, 172); g.font = '600 26px Arial,sans-serif'; g.fillText('STORM RESEARCH', 256, 228); g.strokeStyle = '#1b2d44'; g.lineWidth = 6; g.strokeRect(6, 6, 500, 244); g.fillStyle = '#555'; for (const x of [60, 452]) for (const y of [26, 230]) { g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const decalCache = new Map();
function decalTex(key, w, h, draw) { let t = decalCache.get(key); if (t !== undefined) return t; if (typeof document === 'undefined') return null; const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; decalCache.set(key, t); return t; }

export class VehicleVisual {
  constructor(type, { remote = false, fxScene = null, color = null } = {}) {
    const spec = (this.spec = SPECS[type]); this.type = type; this.remote = remote; const M = (this.model = getModel(type)), def = BUILDERS[type]; const U = (this.U = makeUniforms(spec)); if (color != null) U.uPaint.value.set(color);
    U.uLines.value = M.atlas.tex; M.atlas.rect.forEach((r, i) => U.uRects.value[i].set(...r));
    this.object3d = new THREE.Group(); this.object3d.name = 'vehicle-' + type; const body = (this.body = new THREE.Group()); body.position.set(0, -spec.cgY, spec.cgF); this.object3d.add(body);
    const mats = (this.mats = { paint: paintMaterial(U, def.paint), trim: trimMaterial(U, { side: THREE.DoubleSide }), glass: glassMaterial(U, def.glass || {}), lens: lensMaterial(U), red: lensMaterial(U, { color: 0x7a0606, opacity: 0.72, rough: 0.05 }) });
    this.lodG = M.lods.map((L, i) => {
      const g = new THREE.Group(), add = (geo, mat, sh = true, ro = 0) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.castShadow = sh; m.receiveShadow = true; m.renderOrder = ro; g.add(m); return m; };
      add(L.paint, mats.paint); add(L.trim, mats.trim); add(L.glass, mats.glass, false, 2); add(L.lens, mats.lens, false, 3); add(L.red, mats.red, false, 3); g.visible = i === 0; body.add(g); return g;
    });
    const K = M.lods[0].K, A = K.anim; this.K = K;
    // wheels
    this.wheels = [0, 1, 2, 3].map((i) => {
      const fr = i < 2, hub = new THREE.Group(), spin = new THREE.Group(); hub.position.set((i % 2 ? 1 : -1) * (fr ? spec.trackF : spec.trackR) / 2, spec.R, fr ? -spec.wheelbase / 2 : spec.wheelbase / 2);
      const meshes = M.lods.map((L, l) => { const m = new THREE.Mesh(!fr && L.wheelR ? L.wheelR : L.wheel, mats.wheel || (mats.wheel = this.wheelMat(U))); m.castShadow = true; m.receiveShadow = true; m.visible = l === 0; spin.add(m); return m; }); if (i % 2 === 0) hub.rotation.y = Math.PI; const steer = new THREE.Group(); steer.position.copy(hub.position); hub.position.set(0, 0, 0); steer.add(hub); hub.add(spin); if (M.lods[0].caliper) { const c = new THREE.Mesh(M.lods[0].caliper, mats.wheel); hub.add(c); } body.add(steer); return { steer, spin, meshes, y0: spec.R, side: i % 2 ? 1 : -1 };
    });
    // steering wheel
    if (A.steer) { const g = new THREE.Group(); g.position.set(A.steer.x, A.steer.y, A.steer.z); g.rotation.x = A.steer.tilt; const m = new THREE.Mesh(M.steer, mats.trim); g.add(m); body.add(g); this.steerMesh = m; this.steerG = g; }
    if (A.wipers) { this.wipers = []; const w = A.wipers, H = K.C.house, top = K.L.top; for (const s of [0, 1]) { const x = lerp(-w.spread * 0.88, w.spread * 0.1, s), g = new THREE.Group(), f = w.f - (Math.abs(x) / 0.7) ** 2 * 0.2; const a = new THREE.Vector3(0, K.G.roofY(H.roof.fc, 0) - H.yBase(H.base.fc, 0), H.base.fc - H.roof.fc).normalize(); g.position.set(x, top(f, x) + 0.03, -f + 0.0); const m4 = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0).cross(a).x ? a : a, new THREE.Vector3(1, 0, 0).cross(a)); g.quaternion.setFromRotationMatrix(m4); g.translateZ(w.off ?? 0.02); const m = new THREE.Mesh(M.wiper, mats.trim); m.scale.setScalar(w.len / 0.55); g.add(m); body.add(g); this.wipers.push(m); } }
    if (A.whips) { this.whips = A.whips.map((w) => { const n = 8, g = new THREE.CylinderGeometry(w.r * 0.45, w.r, w.h, 5, n); g.translate(0, w.h / 2, 0); const cnt = g.attributes.position.count; g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cnt * 3).fill(0.02), 3)); const mt = new Float32Array(cnt * 4); for (let k = 0; k < cnt; k++) mt[k * 4] = 0.5; g.setAttribute('aMat', new THREE.BufferAttribute(mt, 4)); const m = new THREE.Mesh(g, mats.trim); m.position.set(w.x, w.y, w.z); m.castShadow = true; m.frustumCulled = false; body.add(m); return { m, base: Float32Array.from(g.attributes.position.array), x: 0, z: 0, vx: 0, vz: 0, h: w.h }; }); }
    if (A.anemo) { this.anemo = new THREE.Mesh(M.anemo, mats.trim); this.anemo.position.set(A.anemo.x, A.anemo.y, A.anemo.z); body.add(this.anemo); } if (A.vane) { this.vane = new THREE.Mesh(M.vane, mats.trim); this.vane.position.set(A.vane.x, A.vane.y, A.vane.z); body.add(this.vane); }
    // animated named parts (dish, skirts, anchors...)
    this.parts = {}; for (const [k, p] of Object.entries(M.lods[0].parts || {})) { const g = new THREE.Group(); g.position.set(...p.pos); const m = new THREE.Mesh(p.geo, mats.trim); m.castShadow = true; m.receiveShadow = true; g.add(m); body.add(g); this.parts[k] = g; g.userData.base = p.pos; }
    // decals / plates
    for (const d of K.decals) { let tex; if (d.kind === 'plate') tex = plateTex || (plateTex = makePlate('STORM')); else tex = decalTex(d.key, d.tw || 1024, d.th || 256, d.draw); if (!tex) continue; const m = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), new THREE.MeshStandardMaterial({ map: tex, transparent: d.kind !== 'plate', roughness: d.rough ?? 0.4, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: d.kind === 'plate' })); m.material.fog = false; m.position.set(d.x, d.y, d.z); m.rotation.set(d.rx || 0, d.ry || 0, d.rz || 0, 'YXZ'); m.receiveShadow = true; this.lodG[0].add(m); }
    // screens
    if (!remote && typeof document !== 'undefined') this.makeScreens(K);
    // mounts
    this.mounts = {}; for (const [k, p] of Object.entries(K.mounts)) { const o = new THREE.Object3D(); o.position.set(p[0], p[1], -p[2]); body.add(o); this.mounts[k] = o; }
    // lamp glow + volumetric cones
    this.lampPos = def.lamps || K.lampPos || [[0.66, 0.62, spec.L / 2 - 0.15]]; const lp = this.lampPos[0]; this.glows = []; this.cones = []; this.fxRoot = new THREE.Group(); this.fxRoot.matrixAutoUpdate = true;
    const pg = new THREE.PlaneGeometry(1, 1); this.mHead = glowMaterial(0xfff0d8); this.mTail = glowMaterial(0xff1a0c); this.mTail.uniforms.uSize.value = 0.5; this.mHead.uniforms.uSize.value = 1.1; const tp = K.tailPos || [0.6, 0.9, -spec.L / 2 + 0.05];
    for (const s of [-1, 1]) { const g = new THREE.Mesh(pg, this.mHead); g.position.set(lp[0] * s, lp[1] - spec.cgY, -(lp[2] + 0.03) + spec.cgF); this.fxRoot.add(g); const t = new THREE.Mesh(pg, this.mTail); t.position.set(tp[0] * s, tp[1] - spec.cgY, -tp[2] + 0.06 + spec.cgF); this.fxRoot.add(t); this.glows.push(g, t); g.frustumCulled = t.frustumCulled = false; }
    this.mCone = coneMaterial(); const cg = new THREE.CylinderGeometry(0.06, 2.6, 18, 20, 1, true); cg.translate(0, -9, 0); cg.rotateX(Math.PI / 2 - 0.0); cg.scale(1.5, 0.75, 1); cg.computeVertexNormals(); cg.rotateX(0);
    for (const s of [-1, 1]) { const c = new THREE.Mesh(cg, this.mCone); c.position.set(lp[0] * s, lp[1] - spec.cgY, -lp[2] + spec.cgF); c.rotation.x = -0.045; this.fxRoot.add(c); this.cones.push(c); c.frustumCulled = false; }
    this.fxScene = fxScene; if (fxScene) fxScene.add(this.fxRoot);
    this.state = { steer: 0, brake: 0, lights: false, throttle: 0, dirt: 0.15, wet: 0, reverse: false, hazard: 0 }; this.cur = { susp: [0, 0, 0, 0], spin: [0, 0, 0, 0] }; this.t = 0; this.damageShown = 0; this.lodI = 0; this.anchorK = 0; this.dishA = 0; this.windLocal = new THREE.Vector3(); this.prevVel = new THREE.Vector3(); this.interior = false;
    U.uLamp.value[9] = 0.9;
  }
  wheelMat(U) { // wheels are in their own space -> separate dirt uniforms
    const W = { ...U, uDirtZ: { value: new THREE.Vector4(-99, 99, 0.4, -0.35) }, uDents: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -99, 0, 0)) } }; return trimMaterial(W, { side: THREE.DoubleSide });
  }
  makeScreens(K) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; this.scr = { c, g: c.getContext('2d'), t: -1 }; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; this.scr.tex = tex; const mat = (this.scrMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: true })); mat.fog = false; mat.color.setScalar(0.8);
    const mk = (s, u0, v0, u1, v1) => { if (!s) return; const g = new THREE.PlaneGeometry(s.w, s.h), uv = g.attributes.uv; for (let k = 0; k < 4; k++) uv.setXY(k, lerp(u0, u1, uv.getX(k)), lerp(v0, v1, uv.getY(k))); const m = new THREE.Mesh(g, mat); m.position.set(s.x, s.y, s.z); m.rotation.set(s.rx || 0, s.ry || 0, 0, 'YXZ'); m.translateZ(0.003); this.lodG[0].add(m); return m; };
    mk(K.cluster, 0, 0.75, 1, 1); mk(K.screen, 0, 0.375, 0.5, 0.75); mk(K.laptop, 0, 0, 0.6, 0.375); this.drawScreens(null);
  }
  drawScreens(d) {
    if (!this.scr) return; const g = this.scr.g; g.fillStyle = '#04070b'; g.fillRect(0, 0, 512, 512);
    // cluster 0..512 x 0..128
    const sp = d ? Math.abs(d.speed) : 0, rpm = d ? d.rpm : 0, unit = d?.mph ? 2.237 : 3.6; g.save(); const dial = (x, v, a, col, txt, lab) => { g.lineWidth = 7; g.strokeStyle = '#1a2735'; g.beginPath(); g.arc(x, 74, 46, Math.PI * 0.8, Math.PI * 2.2); g.stroke(); g.strokeStyle = col; g.beginPath(); g.arc(x, 74, 46, Math.PI * 0.8, Math.PI * (0.8 + 1.4 * clamp(v))); g.stroke(); g.fillStyle = '#e8f1f6'; g.textAlign = 'center'; g.font = '700 34px Arial'; g.fillText(txt, x, 84); g.font = '13px Arial'; g.fillStyle = '#7f95a5'; g.fillText(lab, x, 106); void a; };
    dial(100, sp / 62, 0, '#5fb4ff', String(Math.round(sp * unit)), d?.mph ? 'MPH' : 'KM/H'); dial(412, rpm / 7000, 0, rpm > 6000 ? '#ff5a3a' : '#ffa94a', (rpm / 1000).toFixed(1), 'x1000'); g.font = '700 40px Arial'; g.fillStyle = '#fff'; g.fillText(d ? (d.gear < 0 ? 'R' : sp < 0.3 && d.throttle < 0.02 ? 'P' : 'D' + d.gear) : 'P', 256, 66); g.font = '14px Arial'; g.fillStyle = '#8aa'; g.fillText('FUEL', 220, 104); g.fillStyle = '#233'; g.fillRect(244, 94, 60, 9); g.fillStyle = (d?.fuel ?? 1) < 0.15 ? '#f43' : '#6c8'; g.fillRect(244, 94, 60 * (d?.fuel ?? 1), 9); g.restore();
    // centre screen 0..256 x 128..320 : nav/wind
    g.save(); g.translate(0, 128); g.fillStyle = '#0a131c'; g.fillRect(0, 0, 256, 192); g.fillStyle = '#16314a'; g.fillRect(0, 0, 256, 30); g.fillStyle = '#cfe6f5'; g.textAlign = 'left'; g.font = '700 17px Arial'; g.fillText('WX LINK', 10, 21); g.textAlign = 'right'; g.fillText(d?.clock || '17:12', 246, 21); g.textAlign = 'left'; g.font = '14px Arial'; g.fillStyle = '#7f9db2'; g.fillText('WIND', 14, 58); g.fillText('PRES', 14, 108); g.fillText('TEMP / DEW', 14, 154); g.fillStyle = '#fff'; g.font = '700 27px Arial'; g.fillText(d ? `${Math.round((d.wind || 0) * (d.mph ? 2.237 : 3.6))}` : '--', 14, 84); g.fillText(d ? `${Math.round(d.pres || 0)}` : '--', 14, 134); g.fillText(d ? `${Math.round(d.temp || 0)} / ${Math.round(d.dew || 0)}` : '--', 14, 180); g.strokeStyle = '#3f6380'; g.lineWidth = 2; g.beginPath(); g.arc(186, 110, 52, 0, 7); g.stroke(); g.translate(186, 110); g.rotate(d?.windDir || 0); g.fillStyle = '#ff8c3a'; g.beginPath(); g.moveTo(0, -44); g.lineTo(13, 26); g.lineTo(0, 15); g.lineTo(-13, 26); g.fill(); g.restore();
    // laptop 0..307 x 320..512 : radar
    g.save(); g.translate(0, 320); g.beginPath(); g.rect(0, 0, 307, 192); g.clip(); g.fillStyle = '#070a0c'; g.fillRect(0, 0, 307, 192); const R = d?.radar; if (R) { const n = R.n, s = 192 / n, ox = 57; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const z = R.z[j * n + i]; if (z < 12) continue; g.fillStyle = z > 62 ? '#e23cf0' : z > 55 ? '#c00018' : z > 48 ? '#f02010' : z > 42 ? '#ff8a00' : z > 36 ? '#ffd800' : z > 28 ? '#18a818' : z > 20 ? '#1cd21c' : '#1c74c8'; g.fillRect(ox + i * s, j * s, s + 0.6, s + 0.6); } } g.strokeStyle = 'rgba(150,180,200,.35)'; g.lineWidth = 1; for (const r of [32, 64, 96]) { g.beginPath(); g.arc(153, 96, r, 0, 7); g.stroke(); } g.beginPath(); g.moveTo(153, 0); g.lineTo(153, 192); g.moveTo(57, 96); g.lineTo(249, 96); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(153, 96, 3, 0, 7); g.fill(); g.font = '11px Arial'; g.fillStyle = '#9fc'; g.fillText('REF 0.5°', 6, 14); g.fillText('dBZ', 6, 184); const cols = ['#1c74c8', '#1cd21c', '#ffd800', '#ff8a00', '#f02010', '#e23cf0']; cols.forEach((k, i) => { g.fillStyle = k; g.fillRect(262, 150 - i * 20, 14, 20); }); g.restore();
    this.scr.tex.needsUpdate = true;
  }
  setPaint(hex) { this.U.uPaint.value.set(hex); }
  setLod(i) { if (i === this.lodI) return; this.lodI = i; this.lodG.forEach((g, k) => (g.visible = k === i)); for (const w of this.wheels) w.meshes.forEach((m, k) => (m.visible = k === i)); }
  // s: {steer(rad), wheelSpin[4], susp[4], brake, lights, throttle, reverse, anchored, damage, dirt}
  setState(s) {
    const st = this.state; if (s.steer !== undefined) st.steer = s.steer; if (s.wheelSpin) for (let i = 0; i < 4; i++) this.cur.spin[i] = s.wheelSpin[i]; if (s.susp) for (let i = 0; i < 4; i++) this.cur.susp[i] = s.susp[i];
    if (s.brake !== undefined) st.brake = +s.brake; if (s.lights !== undefined) st.lights = s.lights; if (s.throttle !== undefined) st.throttle = s.throttle; if (s.reverse !== undefined) st.reverse = s.reverse; if (s.anchored !== undefined) st.anchored = s.anchored; if (s.damage !== undefined) st.damage = s.damage; if (s.hazard !== undefined) st.hazard = s.hazard; if (s.dirt !== undefined) st.dirt = s.dirt; if (s.wet !== undefined) st.wet = s.wet; if (s.crack !== undefined) st.crack = s.crack;
  }
  addDent(x, y, z, depth) { // body local (cg) coords
    const D = this.U.uDents.value; this.dentI = ((this.dentI ?? -1) + 1) % 6; const d = D[this.dentI]; const p = this.body.position; d.set(x - p.x, y - p.y, z - p.z, clamp(depth, 0.01, 0.14));
  }
  addCrack(x, y, z, r) { const C = this.U.uCrackP.value; this.crI = ((this.crI ?? -1) + 1) % 3; const p = this.body.position; C[this.crI].set(x - p.x, y - p.y, z - p.z, r); this.U.uCrack.value = 1; }
  repair() { for (const d of this.U.uDents.value) d.set(0, -99, 0, 0); for (const d of this.U.uCrackP.value) d.set(0, -99, 0, 0); this.U.uCrack.value = 0; this.U.uDamage.value = 0; this.state.damage = 0; }
  // env: {rain, night(0..1), windX, windZ (world), cam (Vector3), vel (Vector3), wetness, throttleRpm}
  update(dt, env) {
    const st = this.state, U = this.U, A = this.K.anim; this.t += dt; const t = this.t; U.uTimeV.value = t;
    for (let i = 0; i < 4; i++) { const w = this.wheels[i]; w.steer.position.y = w.y0 + this.cur.susp[i]; w.steer.rotation.y = i < 2 ? -st.steer * 1 : 0; w.spin.rotation.x = w.side > 0 ? -this.cur.spin[i] : this.cur.spin[i]; w.steer.rotation.z = -w.side * 0; }
    if (this.steerMesh) this.steerMesh.rotation.z = -st.steer * 9;
    const L = U.uLamp.value, on = st.lights ? 1 : 0, dim = env?.night ?? 0.5; const K = lerp(2.2, 1, dim) * 1.6;
    L[1] = damp(L[1], on * 9 * K, 14, dt); L[6] = on ? 4 * K : 1.2 * K; L[2] = on * 1.6 * K + 0.02; L[3] = damp(L[3], st.brake > 0.08 ? 6 * K : on * 0.25, 20, dt); L[5] = st.reverse ? 3 * K : 0.01; const bl = st.hazard && (t * 1.5) % 1 < 0.5 ? 5 * K : 0.02; L[4] = bl; L[7] = st.bar ? 12 * K : 0.02; const fl = st.beacon ? 1 : 0; L[8] = 0.03 + fl * 6 * K * (Math.sin(t * 9) > 0.2 ? 1 : 0); L[10] = 0.03 + fl * 6 * K * (Math.sin(t * 9 + 3.14) > 0.2 ? 1 : 0); L[9] = 1.1;
    U.uWet.value = st.wet; U.uDirt.value = st.dirt; U.uRain.value = env?.rain || 0;
    if (st.damage !== undefined && Math.abs(st.damage - U.uDamage.value) > 0.001) U.uDamage.value = st.damage;
    // glow & cones
    this.object3d.updateMatrixWorld(); this.fxRoot.position.copy(this.object3d.position); this.fxRoot.quaternion.copy(this.object3d.quaternion); const cam = env?.cam; let dist = 10, face = 0, faceT = 0;
    if (cam) { V.copy(cam).sub(this.object3d.position); dist = V.length(); V.normalize(); V2.set(0, 0, -1).applyQuaternion(this.object3d.quaternion); face = V.dot(V2); faceT = -face; }
    const far = clamp(dist / 60, 0.25, 3); this.mHead.uniforms.uI.value = on * Math.pow(clamp(face * 1.15), 3) * (0.25 + 1.2 * dim) * 1.6; this.mHead.uniforms.uSize.value = 0.5 + far * 0.75; this.mTail.uniforms.uI.value = (on * 0.25 + (st.brake > 0.08 ? 0.7 : 0)) * Math.pow(clamp(faceT * 1.1), 2) * (0.25 + 0.9 * dim); this.mTail.uniforms.uSize.value = 0.25 + far * 0.4;
    const wetAir = clamp((env?.rain || 0) * 1.2 + (env?.dust || 0) + 0.06); this.mCone.uniforms.uI.value = on * wetAir * (0.15 + dim) * 0.55; this.mCone.uniforms.uT.value = t; this.fxRoot.visible = this.object3d.visible && (on > 0 || st.brake > 0.08); for (const c of this.cones) c.visible = this.mCone.uniforms.uI.value > 0.01;
    if (dist < 80) {
      // whips: spring pendulum driven by acceleration + airflow
      if (this.whips) { V.set(env?.windX || 0, 0, env?.windZ || 0); if (env?.vel) V.sub(env.vel); Q.copy(this.object3d.quaternion).invert(); V.applyQuaternion(Q); let ax = 0, az = 0; if (env?.vel && dt > 1e-4) { V2.copy(env.vel).sub(this.prevVel).multiplyScalar(1 / dt); this.prevVel.copy(env.vel); V2.applyQuaternion(Q); ax = clamp(-V2.x, -25, 25); az = clamp(-V2.z, -25, 25); }
        for (const w of this.whips) { const kx = V.x * Math.abs(V.x) * 0.03 + Math.sin(t * 23 + w.h * 9) * Math.abs(V.x + V.z) * 0.12 + ax * 0.5, kz = V.z * Math.abs(V.z) * 0.03 + Math.cos(t * 19) * Math.abs(V.z) * 0.1 + az * 0.5; const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n; for (let k = 0; k < n; k++) { w.vx += (kx - w.x * 260 - w.vx * 3.2) * h * (1.1 / w.h); w.vz += (kz - w.z * 260 - w.vz * 3.2) * h * (1.1 / w.h); w.x = clamp(w.x + w.vx * h, -1.2, 1.2); w.z = clamp(w.z + w.vz * h, -1.2, 1.2); } const p = w.m.geometry.attributes.position, b = w.base; for (let i = 0; i < b.length; i += 3) { const u = b[i + 1] / w.h, k = u * u * w.h * 0.9; p.array[i] = b[i] + w.x * k; p.array[i + 2] = b[i + 2] + w.z * k; p.array[i + 1] = b[i + 1] - (w.x * w.x + w.z * w.z) * k * 0.35; } p.needsUpdate = true; } }
      if (this.anemo) { const rel = Math.hypot((env?.windX || 0) - (env?.vel?.x || 0), (env?.windZ || 0) - (env?.vel?.z || 0)); this.anemo.rotation.y += rel * dt * 3.2; if (this.vane) { const a = Math.atan2((env?.windX || 0) - (env?.vel?.x || 0), (env?.windZ || 0) - (env?.vel?.z || 0)); V2.set(0, 0, -1).applyQuaternion(this.object3d.quaternion); this.vane.rotation.y = a - Math.atan2(-V2.x, -V2.z) + Math.sin(t * 8) * 0.06; } }
      if (this.wipers) { const r = env?.wiper ?? (env?.rain || 0); this.wipeT = (this.wipeT || 0); if (r > 0.04 || this.wipeT % 1 > 0.02) this.wipeT += dt * (r > 0.5 ? 1.25 : r > 0.15 ? 0.85 : 0.5); const ph = this.wipeT % 1, a = 0.5 - 0.5 * Math.cos(ph * Math.PI * 2); for (const w of this.wipers) w.rotation.z = 0.06 + a * 1.55; this.wipePhase = a; }
    }
    if (this.parts.dish) { this.dishA += dt * (st.dishSpeed ?? 1.4); this.parts.dish.rotation.y = this.dishA; }
    const ak = (this.anchorK = damp(this.anchorK, st.anchored ? 1 : 0, 2.2, dt)); if (this.parts.skirts) { const b = this.parts.skirts.userData.base; this.parts.skirts.position.y = b[1] - ak * (this.K.skirtDrop || 0.3); } if (this.parts.spikes) { const b = this.parts.spikes.userData.base; this.parts.spikes.position.y = b[1] - ak * 0.55; }
    void A;
  }
  dispose() { this.object3d.removeFromParent(); this.fxRoot.removeFromParent(); for (const k in this.mats) this.mats[k].dispose(); this.mHead.dispose(); this.mTail.dispose(); this.mCone.dispose(); this.scr?.tex.dispose(); this.scrMat?.dispose(); if (this.whips) for (const w of this.whips) w.m.geometry.dispose(); }
}
export const ALL_TYPES = TYPE_IDS;

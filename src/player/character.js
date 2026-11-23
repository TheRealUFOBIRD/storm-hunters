// Procedural storm-chaser character: segmented smooth body (lathe/capsule lofts), rain jacket, cap, backpack. Walk/run/crouch/aim/tumble.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp } from '../core/math.js';

const mats = new Map();
const M = (key, o) => { let m = mats.get(key); if (!m) { m = new THREE.MeshStandardMaterial(o); m.fog = false; mats.set(key, m); } return m; };
const lat = (prof, seg = 16, sz = 1) => { const g = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), seg); g.scale(1, 1, sz); g.computeVertexNormals(); return g; };
const cap = (r, l, seg = 10) => new THREE.CapsuleGeometry(r, l, 4, seg);
function limb(r0, r1, len, seg = 12) { // tapered capsule hanging down from origin
  const p = []; for (let i = 0; i <= 5; i++) { const a = i / 5 * Math.PI / 2; p.push([Math.sin(a) * r0, -r0 + Math.cos(a) * r0 + 0.0]); } for (let i = 1; i <= 6; i++) { const t = i / 6; p.push([lerp(r0, r1, t) * (1 + Math.sin(t * Math.PI) * 0.08), -r0 - (len - r0 - r1) * t]); } for (let i = 1; i <= 5; i++) { const a = i / 5 * Math.PI / 2; p.push([Math.cos(a) * r1, -len + r1 - Math.sin(a) * r1]); }
  p.reverse(); return lat(p.map(([x, y]) => [Math.max(x, 1e-4), y]), seg);
}
export function createCharacterVisual(color = 0xc8541a, opts = {}) {
  const jacket = M('j' + color, { color, roughness: 0.55, metalness: 0 }), dark = M('pants', { color: 0x262b33, roughness: 0.85 }), skin = M('skin' + (opts.skin || 0), { color: opts.skin || 0xc08a68, roughness: 0.62 }), boot = M('boot', { color: 0x3a2a1c, roughness: 0.8 }), sole = M('sole', { color: 0x111111, roughness: 0.9 }), capM = M('cap' + (opts.cap || 0), { color: opts.cap || 0x1d2a3a, roughness: 0.7 }), pack = M('pack', { color: 0x2c3a2a, roughness: 0.8 }), strap = M('strap', { color: 0x151515, roughness: 0.8 }), refl = M('refl', { color: 0xd8d8d0, roughness: 0.3, metalness: 0.6 }), hair = M('hair', { color: 0x2a1d14, roughness: 0.9 });
  const root = new THREE.Group(), hips = new THREE.Group(); root.add(hips); hips.position.y = 0.98; const mesh = (g, m, p) => { const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; p.add(o); return o; };
  // pelvis + torso (jacket)
  mesh(lat([[0.0, -0.12], [0.15, -0.1], [0.175, 0.0], [0.17, 0.1], [0.0, 0.11]], 16, 0.68), dark, hips);
  const spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine);
  mesh(lat([[0.0, -0.13], [0.19, -0.12], [0.205, -0.02], [0.2, 0.12], [0.215, 0.26], [0.225, 0.37], [0.19, 0.45], [0.12, 0.49], [0.07, 0.5], [0.0, 0.5]], 20, 0.62), jacket, spine);
  mesh(new THREE.TorusGeometry(0.09, 0.035, 6, 16).rotateX(Math.PI / 2).translate(0, 0.5, 0.0), jacket, spine); // collar
  mesh(new THREE.TorusGeometry(0.2, 0.012, 5, 22).rotateX(Math.PI / 2).scale(1, 1, 0.64).translate(0, 0.18, 0), refl, spine); // reflective band
  mesh(new THREE.BoxGeometry(0.012, 0.42, 0.012).translate(0, 0.25, -0.13), strap, spine); // zip
  // backpack
  const bp = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.2, 4, 10).scale(1.15, 1, 0.55).translate(0, 0.26, 0.2), pack); bp.castShadow = true; spine.add(bp); for (const s of [-1, 1]) mesh(new THREE.TorusGeometry(0.17, 0.014, 4, 14, Math.PI * 1.1).rotateY(Math.PI / 2).rotateX(-0.3).translate(s * 0.1, 0.3, 0.03), strap, spine);
  // head
  const neck = new THREE.Group(); neck.position.y = 0.5; spine.add(neck); mesh(cap(0.058, 0.06, 10).translate(0, 0.05, 0), skin, neck); mesh(new THREE.TorusGeometry(0.085, 0.045, 8, 16, Math.PI * 1.2).rotateX(Math.PI / 2).rotateY(-Math.PI * 0.1 + Math.PI).translate(0, 0.02, 0.03), jacket, neck); // rolled hood
  const head = new THREE.Group(); head.position.y = 0.12; neck.add(head); mesh(new THREE.SphereGeometry(0.105, 18, 14).scale(0.9, 1.08, 1).translate(0, 0.07, 0), skin, head); mesh(new THREE.SphereGeometry(0.108, 16, 10, 0, Math.PI * 2, 0, 1.25).scale(0.92, 1.08, 1.02).translate(0, 0.075, 0.005), hair, head);
  mesh(new THREE.SphereGeometry(0.03, 8, 6).scale(0.5, 0.9, 0.6).translate(0, 0.06, -0.1), skin, head); for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.022, 8, 6).scale(0.5, 1, 0.8).translate(s * 0.095, 0.065, 0.0), skin, head);
  mesh(new THREE.SphereGeometry(0.112, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.95, 0.7, 1.02).translate(0, 0.11, 0.0), capM, head); mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 18, 1, false, -Math.PI / 2 - 0.9, 1.8).scale(1, 1, 1.15).translate(0, 0.115, -0.07), capM, head);
  // arms
  const arms = [-1, 1].map((s) => { const sh = new THREE.Group(); sh.position.set(s * 0.215, 0.42, 0); spine.add(sh); mesh(new THREE.SphereGeometry(0.072, 12, 8).scale(1, 0.9, 1), jacket, sh); mesh(limb(0.07, 0.06, 0.31), jacket, sh); const el = new THREE.Group(); el.position.y = -0.29; sh.add(el); mesh(new THREE.SphereGeometry(0.058, 10, 8), jacket, el); mesh(limb(0.06, 0.052, 0.28), jacket, el); const wr = new THREE.Group(); wr.position.y = -0.27; el.add(wr); mesh(new THREE.CylinderGeometry(0.052, 0.054, 0.04, 12).translate(0, 0.01, 0), jacket, wr); mesh(new THREE.CapsuleGeometry(0.035, 0.05, 4, 8).scale(0.75, 1, 1.15).translate(0, -0.065, 0), skin, wr); mesh(cap(0.017, 0.045, 6).rotateX(0.6).translate(0, -0.05, -0.045), skin, wr); return { sh, el, wr, s }; });
  // legs
  const legs = [-1, 1].map((s) => { const th = new THREE.Group(); th.position.set(s * 0.095, -0.04, 0); hips.add(th); mesh(limb(0.088, 0.066, 0.46), dark, th); const kn = new THREE.Group(); kn.position.y = -0.44; th.add(kn); mesh(new THREE.SphereGeometry(0.066, 10, 8), dark, kn); mesh(limb(0.065, 0.05, 0.44), dark, kn); const an = new THREE.Group(); an.position.y = -0.44; kn.add(an); mesh(new THREE.CylinderGeometry(0.058, 0.055, 0.12, 12).translate(0, 0.02, 0), boot, an); const ft = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.13, 4, 8).rotateX(Math.PI / 2).scale(1.05, 0.85, 1).translate(0, -0.035, -0.05), boot); ft.castShadow = true; an.add(ft); mesh(new THREE.BoxGeometry(0.1, 0.02, 0.25).translate(0, -0.075, -0.05), sole, an); return { th, kn, an, s }; });
  // optional handheld camera for aim
  const camG = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.08), M('camera', { color: 0x111214, roughness: 0.4 })); camG.position.set(0.0, -0.06, -0.05); arms[1].wr.add(camG); const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 14).rotateX(Math.PI / 2).translate(0.0, 0, -0.07), M('lensC', { color: 0x050505, roughness: 0.2, metalness: 0.5 })); camG.add(lens);
  let ph = 0, spd = 0, cr = 0, aim = 0, tum = 0; const st = { speed: 0, crouch: 0, aim: 0, tumble: 0, lean: 0 }; const t0 = Math.random() * 10;
  const api = {
    object3d: root, state: st, setState(s) { Object.assign(st, s); },
    update(dt) {
      spd = damp(spd, st.speed, 8, dt); cr = damp(cr, st.crouch ? 1 : 0, 9, dt); aim = damp(aim, st.aim ? 1 : 0, 10, dt); tum = damp(tum, st.tumble ? 1 : 0, 6, dt); camG.visible = aim > 0.05;
      const run = clamp((spd - 2.2) / 3), f = lerp(1.7, 2.6, run) / 1.4; ph += dt * (0.6 + spd * f * 1.1) * (spd > 0.15 ? 1 : 0); const sw = Math.sin(ph * Math.PI), sw2 = Math.cos(ph * Math.PI), amp = clamp(spd / 1.4) * lerp(0.42, 0.75, run), t = performance.now() / 1000 + t0;
      hips.position.y = 0.98 - cr * 0.32 - Math.abs(sw2) * 0.03 * clamp(spd) + 0.02 * run; hips.rotation.y = sw * 0.12 * amp; spine.rotation.x = -0.05 - run * 0.22 - cr * 0.35 + (st.lean || 0); spine.rotation.y = -sw * 0.18 * amp; neck.rotation.x = -spine.rotation.x * 0.7 + Math.sin(t * 0.7) * 0.03;
      for (const L of legs) { const k = L.s > 0 ? sw : -sw, k2 = L.s > 0 ? sw2 : -sw2; L.th.rotation.x = -k * amp * 1.0 - cr * 1.2; L.kn.rotation.x = Math.max(0, k2) * amp * 1.5 + 0.06 + cr * 2.0; L.an.rotation.x = -L.kn.rotation.x * 0.35 - L.th.rotation.x * 0.25 + cr * -0.6; }
      for (const A of arms) { const k = A.s > 0 ? -sw : sw; A.sh.rotation.x = k * amp * 0.9 - run * 0.2; A.sh.rotation.z = A.s * (0.08 + run * 0.06); A.el.rotation.x = -(0.25 + run * 1.1 + Math.max(0, -k) * amp * 0.4); }
      if (aim > 0.01) for (const A of arms) { A.sh.rotation.x = lerp(A.sh.rotation.x, -1.35, aim); A.sh.rotation.z = lerp(A.sh.rotation.z, -A.s * 0.35, aim); A.el.rotation.x = lerp(A.el.rotation.x, -0.9, aim); }
      if (tum > 0.01) { for (const A of arms) { A.sh.rotation.x = lerp(A.sh.rotation.x, Math.sin(t * 9 + A.s) * 2.2, tum); A.sh.rotation.z = lerp(A.sh.rotation.z, A.s * (1.2 + Math.sin(t * 7) * 0.8), tum); A.el.rotation.x = lerp(A.el.rotation.x, -0.5 - Math.sin(t * 11) * 0.8, tum); } for (const L of legs) { L.th.rotation.x = lerp(L.th.rotation.x, Math.sin(t * 8 + L.s * 2) * 1.1, tum); L.kn.rotation.x = lerp(L.kn.rotation.x, 0.6 + Math.sin(t * 10 + L.s) * 0.6, tum); } }
      // breathing when idle
      spine.scale.set(1, 1 + Math.sin(t * 1.6) * 0.008 * (1 - clamp(spd)), 1);
    },
    dispose() { root.traverse((o) => o.geometry?.dispose()); root.removeFromParent(); },
  };
  void mergeGeometries; return api;
}

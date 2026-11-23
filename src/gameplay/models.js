// Procedural PBR models: hand-held tools (view-models), ground probe, drone.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { rng } from '../core/rng.js';

// ---------- textures / materials ----------
let M = null;
function noiseTex(seed, fn, size = 128, rep = 2) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), id = g.createImageData(size, size), r = rng(seed);
  for (let i = 0; i < size * size; i++) { const v = fn(i % size, (i / size) | 0, r); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  g.putImageData(id, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4; return t;
}
export function mats() {
  if (M) return M;
  const grain = noiseTex(3, (x, y, r) => 118 + r() * 60 + Math.sin(x * 0.7 + Math.sin(y * 0.5) * 2) * 8, 128, 3);
  const knurl = noiseTex(5, (x, y) => (((x + y) % 16 < 8) !== ((x - y + 256) % 16 < 8) ? 190 : 60), 128, 5);
  const rib = noiseTex(6, (x) => 128 + 110 * Math.sin(x / 128 * Math.PI * 2 * 16), 128, 1);
  const weave = noiseTex(7, (x, y, r) => 120 + (((x >> 2) + (y >> 2)) & 1 ? 45 : -35) + r() * 20, 128, 6);
  const scratch = noiseTex(9, (x, y, r) => 140 + r() * 30 + (r() > 0.985 ? 80 : 0) + Math.sin(y * 1.3) * 9, 128, 2);
  const std = (o) => { const m = new THREE.MeshStandardMaterial(o); m.fog = false; return m; };
  const phy = (o) => { const m = new THREE.MeshPhysicalMaterial(o); m.fog = false; return m; };
  M = {
    body: std({ color: 0x17181a, roughness: 0.62, metalness: 0.05, bumpMap: grain, bumpScale: 0.35, roughnessMap: grain }),
    body2: std({ color: 0x26282a, roughness: 0.55, metalness: 0.1, bumpMap: grain, bumpScale: 0.25 }),
    grip: std({ color: 0x0d0d0e, roughness: 0.92, bumpMap: knurl, bumpScale: 0.6 }),
    rib: std({ color: 0x101113, roughness: 0.85, bumpMap: rib, bumpScale: 1.6 }),
    alu: std({ color: 0x9a9c9e, roughness: 0.34, metalness: 0.95, roughnessMap: scratch }),
    steel: std({ color: 0x6f7376, roughness: 0.42, metalness: 0.9, roughnessMap: scratch, bumpMap: scratch, bumpScale: 0.1 }),
    amber: std({ color: 0xc86a12, roughness: 0.48, metalness: 0.02, bumpMap: grain, bumpScale: 0.3 }),
    yellow: std({ color: 0xc99a1a, roughness: 0.5, bumpMap: scratch, bumpScale: 0.25 }),
    red: std({ color: 0x9c1d12, roughness: 0.45 }),
    white: std({ color: 0xd6d4cc, roughness: 0.5, bumpMap: scratch, bumpScale: 0.12 }),
    glass: phy({ color: 0x0a0e16, roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.9, iridescenceIOR: 1.6, iridescenceThicknessRange: [120, 420] }),
    glove: std({ color: 0x2a2620, roughness: 0.88, bumpMap: weave, bumpScale: 0.7 }),
    glovePalm: std({ color: 0x53412c, roughness: 0.8, bumpMap: grain, bumpScale: 0.7 }),
    sleeve: std({ color: 0x3b4030, roughness: 0.93, bumpMap: weave, bumpScale: 0.9 }),
    cable: std({ color: 0x0b0b0c, roughness: 0.6 }),
    prop: std({ color: 0x141414, roughness: 0.4, transparent: true, opacity: 0.9 }),
    blur: std({ color: 0x1b1b1b, roughness: 0.5, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    led: new THREE.MeshBasicMaterial({ color: 0xff8a1e }), ledG: new THREE.MeshBasicMaterial({ color: 0x35ff6a }), ledR: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  };
  for (const k of ['led', 'ledG', 'ledR']) { M[k].fog = false; M[k].color.multiplyScalar(2.2); }
  return M;
}
// ---------- helpers ----------
const add = (g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
const rb = (w, h, d, r = 0.004, s = 3) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
const cyl = (r0, r1, h, n = 32, open = false) => new THREE.CylinderGeometry(r0, r1, h, n, 1, open);
const lathe = (pts, n = 48) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), n);
const tube = (pts, r, n = 24) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), n, r, 8);
function label(text, w, h, o = {}) { // small printed decal
  const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * h / w); const g = c.getContext('2d'); if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, c.width, c.height); }
  g.fillStyle = o.fg || '#e6e2d6'; g.font = `700 ${Math.round(c.height * (o.k || 0.6))}px Bahnschrift, "Arial Narrow", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2 + 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; const m = new THREE.MeshStandardMaterial({ map: t, transparent: !o.bg, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }); m.fog = false;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}
export function screenMesh(w, h, canvas, bright = 1) {
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  const m = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(bright, bright, bright) }); m.fog = false; m.toneMapped = true; const me = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); me.userData.tex = t; return me;
}
// gloved hand: curl 0..1, mirrored for the left
function hand(curl = 0.8, left = false, spread = 0) {
  const m = mats(), g = new THREE.Group(), s = left ? -1 : 1;
  add(g, rb(0.082, 0.032, 0.092, 0.016, 4), m.glove, 0, 0, 0); add(g, rb(0.07, 0.018, 0.08, 0.009, 3), m.glovePalm, 0, -0.012, 0);
  add(g, rb(0.06, 0.012, 0.05, 0.006, 3), m.grip, 0, 0.018, -0.008);
  for (let i = 0; i < 4; i++) { // fingers along -z
    const L = [0.037, 0.043, 0.04, 0.032][i], r = [0.0098, 0.0102, 0.0098, 0.0088][i], f = new THREE.Group(); f.position.set((i - 1.5) * 0.0202 * -s, 0.002, -0.044); f.rotation.set(-curl * 1.0, (i - 1.5) * spread * -s * 0.12, 0); let p = f; g.add(f);
    for (let k = 0; k < 3; k++) { const l = L * [1, 0.72, 0.58][k]; add(p, new THREE.CapsuleGeometry(r * (1 - k * 0.07), l, 4, 12), k === 2 ? m.glovePalm : m.glove, 0, 0, -l / 2, Math.PI / 2); const q = new THREE.Group(); q.position.set(0, 0, -l - r * 0.4); q.rotation.x = -curl * [1.15, 0.95, 0][k]; p.add(q); p = q; }
  }
  const t = new THREE.Group(); t.position.set(0.04 * s, -0.006, 0.012); t.rotation.set(-0.35 * curl, -0.75 * s + curl * 0.5 * s, 0.3 * s); g.add(t);
  add(t, new THREE.CapsuleGeometry(0.0125, 0.036, 4, 12), m.glove, 0, 0, -0.022, Math.PI / 2); const t2 = new THREE.Group(); t2.position.set(0, 0, -0.046); t2.rotation.set(-curl * 0.5, curl * 0.6 * s, 0); t.add(t2); add(t2, new THREE.CapsuleGeometry(0.0108, 0.024, 4, 12), m.glovePalm, 0, 0, -0.016, Math.PI / 2);
  // cuff and sleeve going back (+z)
  add(g, lathe([[0.0, 0], [0.034, 0], [0.037, 0.006], [0.036, 0.03], [0.038, 0.034], [0.0, 0.034]], 28), m.grip, 0, 0, 0.042, Math.PI / 2).scale.set(1, 1, 0.8);
  const pts = [[0.0, 0]]; for (let i = 0; i <= 18; i++) pts.push([0.041 + i * 0.0014 + Math.sin(i * 1.9) * 0.0028 + (i % 5 === 0 ? 0.002 : 0), i * 0.02]); add(g, lathe(pts, 28), m.sleeve, 0, 0.002, 0.07, Math.PI / 2).scale.set(1, 1, 0.86);
  return g;
}
const place = (o, x, y, z, rx = 0, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };

// ---------- camera ----------
export function cameraModel() {
  const m = mats(), g = new THREE.Group();
  add(g, rb(0.142, 0.094, 0.052, 0.012, 4), m.body); add(g, rb(0.034, 0.098, 0.072, 0.016, 5), m.grip, 0.056, -0.001, -0.008); add(g, rb(0.138, 0.05, 0.05, 0.01), m.grip, 0, -0.01, -0.0025);
  add(g, rb(0.056, 0.036, 0.062, 0.012, 4), m.body, -0.004, 0.058, -0.002); add(g, rb(0.03, 0.006, 0.026, 0.002), m.steel, -0.004, 0.078, 0.004); // prism + hot shoe
  add(g, rb(0.034, 0.026, 0.016, 0.007), m.rib, -0.004, 0.052, 0.034); add(g, rb(0.024, 0.016, 0.004, 0.002), m.glass, -0.004, 0.052, 0.041);
  for (const [x, r] of [[0.048, 0.013], [-0.054, 0.014]]) { add(g, cyl(r, r, 0.011, 40), m.rib, x, 0.052, 0.004); add(g, cyl(r * 0.8, r * 0.8, 0.002, 40), m.body2, x, 0.0585, 0.004); }
  add(g, cyl(0.0075, 0.0085, 0.006, 24), m.alu, 0.056, 0.051, -0.028, 0.35); add(g, cyl(0.0035, 0.0035, 0.004, 16), m.red, 0.036, 0.05, -0.016);
  // rear screen
  const cv = document.createElement('canvas'); cv.width = 240; cv.height = 160; add(g, rb(0.083, 0.06, 0.006, 0.003), m.body2, -0.014, -0.004, 0.028); const scr = screenMesh(0.074, 0.0495, cv, 1.2); scr.position.set(-0.014, -0.004, 0.0315); g.add(scr);
  for (let i = 0; i < 4; i++) add(g, cyl(0.0035, 0.0038, 0.003, 14), m.body2, 0.049, 0.018 - i * 0.013, 0.028, Math.PI / 2); add(g, cyl(0.012, 0.012, 0.003, 32), m.rib, 0.05, -0.006, 0.028, Math.PI / 2);
  // telephoto lens along -z
  const L = new THREE.Group(); L.position.set(-0.006, 0.002, -0.026); g.add(L);
  add(L, lathe([[0, 0], [0.034, 0], [0.035, 0.004], [0.035, 0.016], [0.0375, 0.02], [0.0375, 0.07], [0.04, 0.076], [0.04, 0.12], [0.0425, 0.126], [0.0425, 0.17], [0.0445, 0.174], [0.0445, 0.192], [0.041, 0.194], [0.039, 0.186], [0, 0.182]], 64), m.body, 0, 0, 0, -Math.PI / 2);
  for (const [z, w, r] of [[-0.044, 0.036, 0.0392], [-0.147, 0.032, 0.0443]]) { const o = add(L, cyl(r, r, w, 64, true), m.rib, 0, 0, z, Math.PI / 2); o.geometry.attributes.uv.array.forEach((v, i, a) => { if (i % 2 === 0) a[i] = v * 5; }); }
  add(L, new THREE.TorusGeometry(0.0398, 0.0008, 8, 64), m.amber, 0, 0, -0.112); add(L, new THREE.SphereGeometry(0.062, 40, 20, 0, 6.283, 0, 0.66), m.glass, 0, 0, -0.13, -Math.PI / 2).scale.set(1, 0.9, 1);
  add(L, lathe([[0.0445, 0], [0.0525, 0.052], [0.0532, 0.053], [0.0512, 0.052], [0.0435, 0.002]], 64), m.body, 0, 0, -0.19, -Math.PI / 2);
  const lb = label('28-105 f/4', 0.04, 0.008, { k: 0.75 }); place(lb, 0, 0.0405, -0.098, -Math.PI / 2); L.add(lb);
  const n = label('VANTAGE', 0.03, 0.009, { k: 0.75 }); place(n, -0.004, 0.056, -0.0335, 0, Math.PI, 0); g.add(n);
  g.add(tubeMesh([[0.074, 0.03, 0], [0.1, -0.02, 0.05], [0.07, -0.13, 0.1], [0, -0.17, 0.14]], 0.0045, m.cable));
  const r = hand(0.95); place(r, 0.073, -0.012, 0.03, 0.15, 0.12, 1.35); g.add(r); const l = hand(0.75, true); place(l, -0.01, -0.052, -0.075, -0.15, 0.5, 0.1); l.rotateZ(Math.PI); l.rotateY(0.5); g.add(l);
  g.userData = { canvas: cv, screen: scr }; return g;
}
const tubeMesh = (p, r, mat) => { const o = new THREE.Mesh(tube(p, r), mat); return o; };

// ---------- portable doppler ----------
export function scannerModel() {
  const m = mats(), g = new THREE.Group(), d = new THREE.Group(); d.position.set(0, 0.055, -0.15); g.add(d);
  // parabolic antenna in an open cradle
  const pts = []; for (let i = 0; i <= 20; i++) { const r = i / 20 * 0.115; pts.push([r, r * r * 1.9]); } pts.push([0.1175, 0.0262], [0.117, 0.0225]); for (let i = 20; i >= 0; i--) { const r = i / 20 * 0.115; pts.push([r, r * r * 1.9 - 0.003]); }
  add(d, lathe(pts, 64), m.white, 0, 0, 0, -Math.PI / 2); add(d, new THREE.TorusGeometry(0.1165, 0.0032, 10, 72), m.alu, 0, 0, -0.0255);
  for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; d.add(tubeMesh([[Math.cos(a) * 0.1, Math.sin(a) * 0.1, -0.022], [Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.066], [0, 0, -0.088]], 0.0022, m.alu)); }
  add(d, lathe([[0, 0], [0.009, 0.001], [0.013, 0.01], [0.013, 0.02], [0, 0.026]], 24), m.body, 0, 0, -0.078, -Math.PI / 2);
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; add(d, rb(0.004, 0.09, 0.008, 0.0015), m.steel, Math.cos(a) * 0.058, Math.sin(a) * 0.058, 0.007, 0, 0, a - Math.PI / 2); }
  add(d, cyl(0.03, 0.026, 0.05, 32), m.body, 0, 0, 0.028, Math.PI / 2); const ring = add(d, new THREE.TorusGeometry(0.031, 0.002, 8, 40), m.led, 0, 0, 0.03);
  // body
  add(g, rb(0.082, 0.07, 0.14, 0.012, 4), m.amber, 0, 0.055, -0.02); add(g, rb(0.086, 0.02, 0.1, 0.006), m.body, 0, 0.085, -0.02); for (let i = 0; i < 6; i++) add(g, rb(0.088, 0.003, 0.006, 0.0012), m.grip, 0, 0.04, -0.065 + i * 0.013);
  for (const x of [-1, 1]) for (const z of [-0.08, 0.04]) add(g, cyl(0.0045, 0.0045, 0.006, 6), m.steel, x * 0.041, 0.074, z, 0, 0, Math.PI / 2);
  add(g, rb(0.036, 0.12, 0.046, 0.014, 4), m.grip, 0, -0.035, 0.012, -0.28); add(g, rb(0.012, 0.03, 0.012, 0.005), m.red, 0, 0.0, -0.022, -0.2); add(g, rb(0.05, 0.022, 0.06, 0.007), m.body, 0, -0.1, 0.03, -0.28);
  // display tilted to the user
  const cv = document.createElement('canvas'); cv.width = 384; cv.height = 256; const hd = new THREE.Group(); place(hd, 0, 0.128, 0.034, -0.42); g.add(hd); add(hd, rb(0.166, 0.118, 0.02, 0.009, 4), m.body); add(hd, rb(0.172, 0.014, 0.024, 0.006), m.rib, 0, 0.056, 0); add(hd, rb(0.172, 0.014, 0.024, 0.006), m.rib, 0, -0.056, 0);
  const scr = screenMesh(0.144, 0.096, cv, 1.5); scr.position.z = 0.0107; hd.add(scr); for (let i = 0; i < 4; i++) add(hd, rb(0.008, 0.006, 0.003, 0.0015), i ? m.body2 : m.led, 0.0745, 0.03 - i * 0.02, 0.0112);
  add(hd, rb(0.026, 0.05, 0.02, 0.006), m.steel, 0, -0.07, -0.014, 0.3); g.add(tubeMesh([[0.04, 0.06, 0.05], [0.085, 0.07, 0.07], [0.075, 0.12, 0.05], [0.06, 0.125, 0.03]], 0.004, m.cable));
  const lb = label('X-BAND 9.4 GHz', 0.07, 0.011, { k: 0.8, fg: '#1a1208' }); place(lb, 0.0415, 0.06, -0.02, 0, Math.PI / 2); g.add(lb);
  const r = hand(1.0); place(r, 0.012, -0.03, 0.06, 0.75, 0.15, 0.1); r.rotateZ(1.4); g.add(r); const l = hand(0.85, true); place(l, -0.098, 0.13, 0.03, -0.42, 0, Math.PI / 2); g.add(l);
  g.userData = { canvas: cv, screen: scr, dish: d, ring }; return g;
}

// ---------- binoculars ----------
export function binoModel() {
  const m = mats(), g = new THREE.Group();
  for (const s of [-1, 1]) { const b = new THREE.Group(); b.position.set(s * 0.037, 0, 0); b.rotation.z = s * -0.06; g.add(b);
    add(b, lathe([[0, 0], [0.024, 0], [0.026, 0.006], [0.027, 0.06], [0.031, 0.082], [0.033, 0.13], [0.0345, 0.134], [0.0345, 0.146], [0.0305, 0.146], [0.03, 0.14], [0, 0.138]], 48), m.grip, 0, 0, 0.05, -Math.PI / 2);
    add(b, lathe([[0.015, 0], [0.021, 0.001], [0.022, 0.03], [0.0245, 0.034], [0.0245, 0.04], [0, 0.04]], 40), m.rib, 0, 0, 0.085, -Math.PI / 2); add(b, new THREE.SphereGeometry(0.046, 32, 16, 0, 6.283, 0, 0.68), m.glass, 0, 0, -0.058, -Math.PI / 2).scale.set(1, 0.6, 1); add(b, new THREE.TorusGeometry(0.0335, 0.001, 8, 48), m.amber, 0, 0, -0.06); }
  add(g, rb(0.05, 0.03, 0.06, 0.01, 4), m.body, 0, 0.004, 0.004); add(g, cyl(0.011, 0.011, 0.034, 32), m.rib, 0, 0.026, 0.02, Math.PI / 2); add(g, rb(0.03, 0.022, 0.05, 0.007), m.body2, 0, -0.018, -0.014); add(g, cyl(0.006, 0.006, 0.004, 20), m.glass, 0, -0.018, -0.0405, Math.PI / 2);
  const r = hand(0.7); place(r, 0.085, -0.02, 0.02, 0.2, 0.35, 1.2); g.add(r); const l = hand(0.7, true); place(l, -0.085, -0.02, 0.02, 0.2, -0.35, -1.2); g.add(l); return g;
}

// ---------- field meter ----------
export function meterModel() {
  const m = mats(), g = new THREE.Group(), cv = document.createElement('canvas'); cv.width = 192; cv.height = 256;
  add(g, rb(0.052, 0.14, 0.026, 0.012, 5), m.yellow); add(g, rb(0.046, 0.06, 0.028, 0.006), m.body, 0, -0.014, 0.0005); const scr = screenMesh(0.04, 0.0533, cv, 1.2); scr.position.set(0, -0.013, 0.0148); g.add(scr);
  add(g, new THREE.TorusGeometry(0.024, 0.0052, 14, 48), m.yellow, 0, 0.088, 0); add(g, new THREE.TorusGeometry(0.0195, 0.0012, 8, 40), m.steel, 0, 0.088, 0); const imp = new THREE.Group(); imp.position.set(0, 0.088, 0); g.add(imp); add(imp, cyl(0.0035, 0.0035, 0.01, 16), m.steel, 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < 8; i++) { const h = new THREE.Group(); h.rotation.z = i / 8 * 6.283; imp.add(h); add(h, rb(0.007, 0.015, 0.001, 0.0005, 2), m.white, 0, 0.0105, 0, 0, 0.7); }
  for (let i = 0; i < 3; i++) add(g, cyl(0.0055, 0.006, 0.004, 24), i === 1 ? m.amber : m.body, (i - 1) * 0.0145, -0.054, 0.0135, Math.PI / 2); add(g, new THREE.TorusGeometry(0.006, 0.0016, 8, 20), m.steel, 0, -0.074, 0);
  g.add(tubeMesh([[0, -0.078, 0], [0.012, -0.11, 0.02], [0.004, -0.15, 0.03]], 0.0018, m.cable));
  const r = hand(0.9); place(r, 0.026, -0.05, -0.008, 1.1, 0.3, 0.9); g.add(r); g.userData = { canvas: cv, screen: scr, impeller: imp }; return g;
}

// ---------- drone controller ----------
export function controllerModel() {
  const m = mats(), g = new THREE.Group(), cv = document.createElement('canvas'); cv.width = 320; cv.height = 200;
  add(g, rb(0.19, 0.03, 0.1, 0.014, 5), m.body, 0, 0, 0); for (const s of [-1, 1]) { add(g, rb(0.045, 0.04, 0.07, 0.016, 4), m.grip, s * 0.085, -0.008, 0.032, 0.2, s * 0.2); add(g, cyl(0.019, 0.02, 0.005, 32), m.rib, s * 0.062, 0.016, 0.012); add(g, cyl(0.0026, 0.0026, 0.02, 12), m.alu, s * 0.062, 0.028, 0.012); add(g, lathe([[0, 0], [0.008, 0], [0.0085, 0.002], [0.006, 0.004], [0, 0.0032]], 24), m.alu, s * 0.062, 0.037, 0.012); add(g, rb(0.014, 0.007, 0.062, 0.003), m.body2, s * 0.06, 0.018, -0.07, 0.9, s * 0.18); }
  const hd = new THREE.Group(); place(hd, 0, 0.066, -0.052, -0.42); g.add(hd); add(hd, rb(0.172, 0.112, 0.012, 0.006, 4), m.body); const scr = screenMesh(0.158, 0.099, cv, 1.3); scr.position.z = 0.0066; hd.add(scr); add(hd, rb(0.02, 0.06, 0.01, 0.003), m.steel, 0, -0.05, -0.01);
  add(g, rb(0.012, 0.003, 0.012, 0.001), m.amber, 0, 0.0155, 0.03); const r = hand(0.75); place(r, 0.108, -0.004, 0.034, 0.1, 0.35, 0.5); g.add(r); const l = hand(0.75, true); place(l, -0.108, -0.004, 0.034, 0.1, -0.35, -0.5); g.add(l); g.userData = { canvas: cv, screen: scr }; return g;
}

// ---------- ground probe ----------
export function probeModel(view = false) {
  const m = mats(), g = new THREE.Group(), b = new THREE.Group(); g.add(b);
  // low cone "turtle" shell, skirt, handles, sensor mast
  add(b, lathe([[0, 0], [0.34, 0], [0.355, 0.012], [0.352, 0.03], [0.3, 0.075], [0.205, 0.135], [0.12, 0.172], [0.06, 0.18], [0, 0.18]], 72), m.amber);
  add(b, lathe([[0.31, 0.066], [0.332, 0.05], [0.336, 0.054], [0.315, 0.074]], 72), m.body); add(b, lathe([[0.2, 0.139], [0.214, 0.131], [0.217, 0.136], [0.203, 0.145]], 72), m.steel);
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; const h = new THREE.Group(); h.rotation.y = a; b.add(h); add(h, rb(0.05, 0.02, 0.014, 0.005), m.steel, 0, 0.034, 0.345, -0.5); add(h, cyl(0.011, 0.011, 0.02, 6), m.steel, 0, 0.1, 0.262, 0.45); add(h, rb(0.028, 0.012, 0.12, 0.004), m.body2, 0, 0.112, 0.235, 0.5); }
  for (const s of [0, Math.PI]) { const h = new THREE.Group(); h.rotation.y = s + 0.5; b.add(h); h.add(tubeMesh([[-0.07, 0.15, 0.17], [-0.06, 0.2, 0.2], [0.06, 0.2, 0.2], [0.07, 0.15, 0.17]], 0.009, m.grip)); }
  add(b, cyl(0.062, 0.07, 0.03, 40), m.body, 0, 0.192, 0); add(b, cyl(0.052, 0.052, 0.012, 40), m.alu, 0, 0.212, 0); for (let i = 0; i < 3; i++) add(b, cyl(0.046, 0.046, 0.006, 40), m.white, 0, 0.226 + i * 0.011, 0); add(b, cyl(0.014, 0.02, 0.06, 20), m.body, 0, 0.27, 0);
  add(b, new THREE.SphereGeometry(0.02, 24, 16), m.alu, 0, 0.305, 0); b.add(tubeMesh([[0.09, 0.17, 0.05], [0.1, 0.3, 0.056], [0.1, 0.46, 0.056]], 0.0025, m.cable));
  const led = add(b, new THREE.SphereGeometry(0.013, 16, 12), m.led, -0.08, 0.183, 0.04); const lb = label('PRAIRIE STATE / DO NOT MOVE', 0.2, 0.026, { k: 0.72, bg: '#e7e0cc', fg: '#1b1508' }); place(lb, 0, 0.107, 0.253, -0.98); b.add(lb);
  const spikes = []; for (let i = 0; i < 3; i++) { const a = i / 3 * 6.283 + 0.5; const s = add(b, cyl(0.012, 0.003, 0.22, 12), m.steel, Math.sin(a) * 0.3, 0.14, Math.cos(a) * 0.3); spikes.push(s); add(s, cyl(0.02, 0.02, 0.016, 6), m.red, 0, 0.11, 0); }
  g.userData = { led, spikes }; if (view) { g.scale.setScalar(0.62); for (const s of [-1, 1]) { const h = hand(0.9, s < 0); place(h, s * 0.36, 0.08, 0.06, 0.5, s * 1.1, s * 0.9); h.scale.setScalar(1.6); g.add(h); } } return g;
}

// ---------- drone ----------
export function droneModel() {
  const m = mats(), g = new THREE.Group(), b = new THREE.Group(), rotors = []; g.add(b);
  add(b, rb(0.15, 0.06, 0.24, 0.026, 5), m.body2); add(b, rb(0.1, 0.03, 0.17, 0.014, 4), m.amber, 0, 0.034, 0.01); add(b, rb(0.07, 0.012, 0.1, 0.005), m.body, 0, 0.052, 0.02);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const ex = sx * 0.24, ez = sz * 0.22 - 0.01; b.add(tubeMesh([[sx * 0.06, 0.006, sz * 0.07], [sx * 0.15, 0.022, sz * 0.15], [ex, 0.03, ez]], 0.0125, m.body)); add(b, cyl(0.024, 0.022, 0.045, 28), m.alu, ex, 0.04, ez); add(b, cyl(0.02, 0.02, 0.012, 28), m.body, ex, 0.068, ez);
    const r = new THREE.Group(); r.position.set(ex, 0.076, ez); b.add(r); for (const k of [0, Math.PI]) { const h = new THREE.Group(); h.rotation.y = k; r.add(h); add(h, rb(0.14, 0.0025, 0.018, 0.001, 2), m.prop, 0.072, 0, 0, 0.22); } const disc = add(b, new THREE.CircleGeometry(0.142, 40), m.blur, ex, 0.077, ez, -Math.PI / 2); disc.castShadow = false; rotors.push({ r, disc, s: sx * sz });
    b.add(tubeMesh([[sx * 0.2, 0.02, sz * 0.18], [sx * 0.215, -0.05, sz * 0.2], [sx * 0.22, -0.1, sz * 0.2]], 0.006, m.body)); add(b, rb(0.018, 0.012, 0.03, 0.005), m.grip, sx * 0.22, -0.104, sz * 0.2); add(b, new THREE.SphereGeometry(0.006, 12, 8), sz < 0 ? m.ledG : m.ledR, ex, 0.016, ez);
  }
  const gim = new THREE.Group(); gim.position.set(0, -0.045, -0.1); b.add(gim); add(gim, rb(0.05, 0.012, 0.03, 0.005), m.body, 0, 0.016, 0.01); const cam = new THREE.Group(); gim.add(cam); add(cam, new THREE.SphereGeometry(0.03, 28, 20), m.body); add(cam, cyl(0.018, 0.02, 0.018, 28), m.body2, 0, 0, -0.026, Math.PI / 2); add(cam, new THREE.SphereGeometry(0.022, 24, 12, 0, 6.283, 0, 0.8), m.glass, 0, 0, -0.018, -Math.PI / 2);
  g.userData = { body: b, rotors, gimbal: cam }; return g;
}
export function balloonModel() {
  const m = mats(), g = new THREE.Group(), w = new THREE.MeshPhysicalMaterial({ color: 0xe9e4d8, roughness: 0.35, transmission: 0, sheen: 0.4, clearcoat: 0.3 }); w.fog = false;
  add(g, lathe([[0, 0], [0.05, 0.02], [0.08, 0.1], [0.4, 0.5], [0.58, 0.95], [0.6, 1.3], [0.48, 1.62], [0.25, 1.8], [0, 1.85]], 40), w, 0, 0.6, 0); g.add(tubeMesh([[0, 0.6, 0], [0.03, -0.4, 0.02], [-0.02, -1.2, 0]], 0.006, m.cable)); add(g, rb(0.16, 0.2, 0.12, 0.02), m.white, -0.02, -1.3, 0); add(g, cyl(0.006, 0.006, 0.3, 8), m.steel, 0.03, -1.5, 0); return g;
}

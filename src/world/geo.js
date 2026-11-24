// Procedural geometry for trees, props and buildings + the foliage/bark canvas atlas.
import * as THREE from 'three';
import { KI, KIND } from './kinds.js';
import { BL } from './textures.js';
import { rng } from '../core/rng.js';

// ---------------- builder
class B {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.l = []; this.i = []; }
  v(x, y, z, nx, ny, nz, u, w, c, l) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, w); this.c.push(c[0], c[1], c[2]); this.l.push(l); return this.p.length / 3 - 1; }
  quad(a, b, c, d, n, l, col, uv) { // a,b,c,d ccw seen from front; uv [[u,v]x4]
    const o = this.p.length / 3; [a, b, c, d].forEach((q, k) => this.v(q[0], q[1], q[2], n[0], n[1], n[2], uv[k][0], uv[k][1], col, l)); this.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  // planar quad from corner + edge vectors, uv in metres / tile
  face(o, e1, e2, l, col, tile = 3) { const n = new THREE.Vector3(...e1).cross(new THREE.Vector3(...e2)).normalize(); const L1 = Math.hypot(...e1) / tile, L2 = Math.hypot(...e2) / tile; const p = (a, b) => [o[0] + e1[0] * a + e2[0] * b, o[1] + e1[1] * a + e2[1] * b, o[2] + e1[2] * a + e2[2] * b]; this.quad(p(0, 0), p(1, 0), p(1, 1), p(0, 1), [n.x, n.y, n.z], l, col, [[0, 0], [L1, 0], [L1, L2], [0, L2]]); }
  box(cx, y0, cz, hx, hy, hz, l, col, tile = 3, top = true, bottom = false) {
    const x0 = cx - hx, x1 = cx + hx, z0 = cz - hz, z1 = cz + hz, y1 = y0 + hy * 2;
    this.face([x0, y0, z1], [2 * hx, 0, 0], [0, 2 * hy, 0], l, col, tile); this.face([x1, y0, z0], [-2 * hx, 0, 0], [0, 2 * hy, 0], l, col, tile);
    this.face([x1, y0, z1], [0, 0, -2 * hz], [0, 2 * hy, 0], l, col, tile); this.face([x0, y0, z0], [0, 0, 2 * hz], [0, 2 * hy, 0], l, col, tile);
    if (top) this.face([x0, y1, z1], [2 * hx, 0, 0], [0, 0, -2 * hz], l, col, tile); if (bottom) this.face([x0, y0, z0], [2 * hx, 0, 0], [0, 0, 2 * hz], l, col, tile);
  }
  cyl(cx, cz, r0, r1, y0, y1, seg, l, col, cap = true, tile = 3, cx1 = cx, cz1 = cz) {
    const o = this.p.length / 3, circ = 2 * Math.PI * Math.max(r0, r1) / tile;
    for (let k = 0; k <= seg; k++) { const a = k / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), sl = (r0 - r1) / Math.max(.01, y1 - y0); const nl = Math.hypot(1, sl); this.v(cx + ca * r0, y0, cz + sa * r0, ca / nl, sl / nl, sa / nl, k / seg * circ, 0, col, l); this.v(cx1 + ca * r1, y1, cz1 + sa * r1, ca / nl, sl / nl, sa / nl, k / seg * circ, (y1 - y0) / tile, col, l); }
    for (let k = 0; k < seg; k++) { const a = o + k * 2; this.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    if (cap && r1 > 0) { const c = this.v(cx1, y1, cz1, 0, 1, 0, 0, 0, col, l); for (let k = 0; k <= seg; k++) { const a = k / seg * Math.PI * 2; this.v(cx1 + Math.cos(a) * r1, y1, cz1 + Math.sin(a) * r1, 0, 1, 0, Math.cos(a) * r1 / tile, Math.sin(a) * r1 / tile, col, l); } for (let k = 0; k < seg; k++) this.i.push(c, c + 2 + k, c + 1 + k); }
  }
  // gable roof along z: footprint hx,hz at y0, ridge height h, overhang o
  gable(cx, y0, cz, hx, hz, h, o, l, col, wallL, wallC) {
    const X0 = cx - hx - o, X1 = cx + hx + o, Z0 = cz - hz - o, Z1 = cz + hz + o, yr = y0 + h, ye = y0 - o * h / hx;
    const s = Math.hypot(hx + o, h + o * h / hx);
    this.face([X0, ye, Z1], [0, 0, Z0 - Z1], [cx - X0, yr - ye, 0], l, col, 3); this.face([X1, ye, Z0], [0, 0, Z1 - Z0], [cx - X1, yr - ye, 0], l, col, 3);
    this.quad([X0, ye - .12, Z1], [X0, ye - .12, Z0], [cx, yr - .12, Z0], [cx, yr - .12, Z1], [0, -1, 0], l, [.3, .3, .3], [[0, 0], [1, 0], [1, 1], [0, 1]]); this.quad([X1, ye - .12, Z0], [X1, ye - .12, Z1], [cx, yr - .12, Z1], [cx, yr - .12, Z0], [0, -1, 0], l, [.3, .3, .3], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    for (const [z, sg] of [[cz + hz, 1], [cz - hz, -1]]) { const o2 = this.p.length / 3; this.v(cx - hx * sg, y0, z, 0, 0, sg, 0, 0, wallC, wallL); this.v(cx + hx * sg, y0, z, 0, 0, sg, 2 * hx / 3, 0, wallC, wallL); this.v(cx, yr, z, 0, 0, sg, hx / 3, h / 3, wallC, wallL); this.i.push(o2, o2 + 1, o2 + 2); }
    void s;
  }
  window(cx, cy, cz, w, h, nx, nz, frame = [.85, .85, .82], l = BL.glass) { // on wall with outward normal (nx,nz)
    const tx = -nz, tz = nx, d = .04, f = .09, P = (a, b, o) => [cx + tx * a + nx * o, cy + b, cz + tz * a + nz * o];
    this.quad(P(-w / 2, -h / 2, d), P(w / 2, -h / 2, d), P(w / 2, h / 2, d), P(-w / 2, h / 2, d), [nx, 0, nz], l, [1, 1, 1], [[0, 0], [w / 3, 0], [w / 3, h / 3], [0, h / 3]]);
    for (const [a0, b0, a1, b1] of [[-w / 2 - f, -h / 2 - f, w / 2 + f, -h / 2], [-w / 2 - f, h / 2, w / 2 + f, h / 2 + f], [-w / 2 - f, -h / 2, -w / 2, h / 2], [w / 2, -h / 2, w / 2 + f, h / 2], [-.025, -h / 2, .025, h / 2], [-w / 2, -.025, w / 2, .025]]) this.quad(P(a0, b0, d + .05), P(a1, b0, d + .05), P(a1, b1, d + .05), P(a0, b1, d + .05), [nx, 0, nz], BL.paint, frame, [[0, 0], [.1, 0], [.1, .1], [0, .1]]);
  }
  merge(g, m) { const o = this.p.length / 3; const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m); for (let k = 0; k < g.p.length / 3; k++) { v.fromArray(g.p, k * 3).applyMatrix4(m); n.fromArray(g.n, k * 3).applyMatrix3(nm).normalize(); this.p.push(v.x, v.y, v.z); this.n.push(n.x, n.y, n.z); } this.u.push(...g.u); this.c.push(...g.c); this.l.push(...g.l); for (const q of g.i) this.i.push(q + o); }
  geo(withL = true) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); if (withL) g.setAttribute('aL', new THREE.Float32BufferAttribute(this.l, 1)); g.setIndex(this.i); g.computeBoundingSphere(); return g; }
}

// ---------------- foliage atlas (4x4 cells)
export const AC = { oak: 0, cotton: 1, pine: 2, spruce: 3, cedar: 4, mesq: 5, palm: 6, twig: 7, shrub: 8, bark: 9, barkL: 10, cactus: 11, hay: 12, rock: 13, white: 14, dry: 15 };
export function makeAtlas() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S * 4; const g = cv.getContext('2d'), R = rng(77);
  const cell = (i) => [(i % 4) * S, Math.floor(i / 4) * S];
  const leafy = (i, cols, n, len, wid, shape, twig = '#3a2a1c', mode = 0) => {
    const [ox, oy] = cell(i); g.save(); g.beginPath(); g.rect(ox, oy, S, S); g.clip();
    g.strokeStyle = twig; g.lineCap = 'round';
    for (let k = 0; k < 7; k++) { g.lineWidth = 3 - k * .3; g.beginPath(); g.moveTo(ox + S / 2, oy + S); g.quadraticCurveTo(ox + S / 2 + (R() - .5) * 60, oy + S * .6, ox + S * (.15 + R() * .7), oy + S * (.12 + R() * .5)); g.stroke(); }
    for (let k = 0; k < n; k++) {
      let x, y; do { x = R(); y = R(); } while (Math.hypot(x - .5, (y - .5) * 1.1) > .47 + R() * .05);
      const sh = .55 + .45 * (1 - y) * (.6 + .4 * x), c = cols[Math.floor(R() * cols.length)];
      g.fillStyle = `rgb(${c[0] * sh | 0},${c[1] * sh | 0},${c[2] * sh | 0})`; g.save(); g.translate(ox + x * S, oy + y * S); g.rotate(mode === 1 ? Math.atan2(y - .5, x - .5) + Math.PI / 2 + (R() - .5) * .4 : R() * 6.28);
      if (shape === 'needle') { g.fillRect(-wid / 2, -len / 2, wid, len); } else { g.beginPath(); g.ellipse(0, 0, wid, len, 0, 0, 6.28); g.fill(); }
      g.restore();
    }
    g.restore();
  };
  leafy(AC.oak, [[70, 96, 38], [86, 112, 44], [58, 82, 30], [100, 122, 52]], 1300, 7, 4.2, 'leaf');
  leafy(AC.cotton, [[96, 124, 50], [118, 138, 60], [80, 106, 40]], 1100, 7.5, 5.5, 'leaf', '#5a4c3c');
  leafy(AC.pine, [[48, 70, 34], [62, 84, 40], [40, 60, 28]], 2400, 16, 1.6, 'needle', '#3c2a1c', 1);
  leafy(AC.spruce, [[34, 56, 36], [44, 68, 44], [28, 46, 30]], 2600, 10, 1.6, 'needle', '#2c2016', 1);
  leafy(AC.cedar, [[52, 72, 42], [66, 84, 50], [44, 60, 34]], 2200, 5, 2.2, 'leaf', '#4a3424');
  leafy(AC.mesq, [[96, 112, 62], [114, 126, 72], [84, 96, 54]], 1500, 3.5, 1.8, 'leaf', '#3a2c20');
  { const [ox, oy] = cell(AC.palm); g.strokeStyle = '#6a6a3a'; g.lineWidth = 4; g.beginPath(); g.moveTo(ox + 4, oy + S / 2); g.lineTo(ox + S - 4, oy + S / 2); g.stroke(); for (let k = 0; k < 70; k++) { const t = k / 70, x = ox + 8 + t * (S - 16), L = Math.sin(t * Math.PI) * 100 + 14; g.strokeStyle = `rgb(${70 + R() * 30 | 0},${100 + R() * 30 | 0},${40 + R() * 15 | 0})`; g.lineWidth = 3; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(x, oy + S / 2); g.lineTo(x + 18, oy + S / 2 + sg * L); g.stroke(); } } }
  { const [ox, oy] = cell(AC.twig); g.strokeStyle = '#5c5048'; for (let k = 0; k < 40; k++) { g.lineWidth = 1 + R() * 2; g.beginPath(); let x = ox + S / 2 + (R() - .5) * 40, y = oy + S; g.moveTo(x, y); for (let s = 0; s < 5; s++) { x += (R() - .5) * 70; y -= R() * 60; g.lineTo(x, y); } g.stroke(); } }
  leafy(AC.shrub, [[92, 104, 58], [108, 116, 66], [78, 90, 50], [124, 118, 78]], 1500, 5, 3, 'leaf', '#4a3a2a');
  const noiseFill = (i, base, var_, streak) => { const [ox, oy] = cell(i); const id = g.createImageData(S, S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const n = (Math.sin(x * (streak ? .35 : .9) + Math.sin(y * .05) * 6) * .5 + .5) * .5 + R() * .5; const k = (y * S + x) * 4; for (let c = 0; c < 3; c++) id.data[k + c] = Math.max(0, Math.min(255, base[c] + (n - .5) * var_)); id.data[k + 3] = 255; } g.putImageData(id, ox, oy); };
  noiseFill(AC.bark, [70, 56, 44], 70, true); noiseFill(AC.barkL, [150, 140, 126], 60, true); noiseFill(AC.cactus, [74, 100, 56], 40, true); noiseFill(AC.hay, [184, 156, 96], 70, true); noiseFill(AC.rock, [128, 120, 110], 70, false);
  { const [ox, oy] = cell(AC.white); g.fillStyle = '#d8d4cc'; g.fillRect(ox, oy, S, S); } leafy(AC.dry, [[150, 130, 80], [130, 110, 70]], 900, 6, 2, 'needle', '#6a5a40');
  // bleed colour into transparent texels (no dark halos)
  const id = g.getImageData(0, 0, S * 4, S * 4), d = id.data;
  for (let i = 0; i < 16; i++) { const [ox, oy] = cell(i); let r = 0, gg = 0, b = 0, n = 0; for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) { const k = ((oy + y) * S * 4 + ox + x) * 4; if (d[k + 3] > 200) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++; } } if (!n) continue; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = ((oy + y) * S * 4 + ox + x) * 4; if (d[k + 3] < 128) { d[k] = r / n; d[k + 1] = gg / n; d[k + 2] = b / n; } } }
  const t = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), S * 4, S * 4, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true; return t;
}
const auv = (c, u, v) => [((c % 4) + .02 + u * .96) / 4, (Math.floor(c / 4) + .02 + v * .96) / 4];

// ---------------- trees (VEG family: uv into atlas, colour = tint*ao)
function card(b, x, y, z, s, c, r, cnx, cny, cnz, ao, axis) { // camera-agnostic leaf card; normal = spherical
  const a = r() * Math.PI * 2, t = axis ?? (r() - .5) * 1.2; const ux = Math.cos(a) * s, uz = Math.sin(a) * s, vy = Math.cos(t) * s, vx = -Math.sin(a) * Math.sin(t) * s, vz = Math.cos(a) * Math.sin(t) * s;
  const nl = Math.hypot(cnx, cny, cnz) || 1, col = [ao, ao, ao], o = b.p.length / 3, P = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [i, j] of P) { const uv = auv(c, (i + 1) / 2, (j + 1) / 2); b.v(x + ux * i + vx * j, y + vy * j, z + uz * i + vz * j, cnx / nl, cny / nl, cnz / nl, uv[0], uv[1], col, 0); }
  b.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
}
function limb(b, x0, y0, z0, x1, y1, z1, r0, r1, seg, cellB) { const o = b.p.length / 3, dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dx, dy, dz); const ax = new THREE.Vector3(dx, dy, dz).normalize(), p1 = new THREE.Vector3(1, 0, 0); if (Math.abs(ax.x) > .9) p1.set(0, 0, 1); const u = p1.clone().cross(ax).normalize(), w = ax.clone().cross(u); for (let k = 0; k <= seg; k++) { const a = k / seg * Math.PI * 2, nx = u.x * Math.cos(a) + w.x * Math.sin(a), ny = u.y * Math.cos(a) + w.y * Math.sin(a), nz = u.z * Math.cos(a) + w.z * Math.sin(a); const uv0 = auv(cellB, k / seg, 0), uv1 = auv(cellB, k / seg, Math.min(1, L / 6)); b.v(x0 + nx * r0, y0 + ny * r0, z0 + nz * r0, nx, ny, nz, uv0[0], uv0[1], [.8, .8, .8], 1); b.v(x1 + nx * r1, y1 + ny * r1, z1 + nz * r1, nx, ny, nz, uv1[0], uv1[1], [1, 1, 1], 1); } for (let k = 0; k < seg; k++) { const a = o + k * 2; b.i.push(a, a + 1, a + 3, a, a + 3, a + 2); } }
const SPEC = { // height, crown radius, crown base frac, leaf cell, bark cell, cards, card size, shape
  oak: [11, 5.2, .35, AC.oak, AC.bark, 170, 1.5, 'round'], cottonwood: [16, 6.2, .4, AC.cotton, AC.barkL, 200, 1.7, 'round'], pine: [17, 3.6, .55, AC.pine, AC.bark, 140, 1.5, 'pine'], spruce: [15, 3, .12, AC.spruce, AC.bark, 190, 1.2, 'cone'],
  cedar: [5.5, 1.7, .05, AC.cedar, AC.bark, 110, .9, 'cone'], mesquite: [4.4, 3, .35, AC.mesq, AC.bark, 90, 1.1, 'flat'], palm: [11, 3.6, .9, AC.palm, AC.barkL, 14, 2.6, 'palm'], dead: [8, 3.5, .3, AC.twig, AC.barkL, 26, 1.7, 'round'],
};
export function treeGeo(name, lod, broken) {
  const [H, CR, base, leaf, bark, NC, CS, shape] = SPEC[name], b = new B(), r = rng(name.length * 31 + lod), trunkR = H * .022 + .08;
  if (broken) { limb(b, 0, -.3, 0, .05, H * .18, 0, trunkR * 1.1, trunkR * .8, 6, AC.barkL); for (let k = 0; k < 3; k++) limb(b, 0, H * .16, 0, (r() - .5) * .5, H * .22 + r() * .4, (r() - .5) * .5, trunkR * .5, .02, 3, AC.barkL); return b.geo(false); }
  const segs = lod ? 4 : 7, top = shape === 'palm' ? H : H * (shape === 'cone' || shape === 'pine' ? .97 : .55);
  let lx = 0, lz = 0; const lean = shape === 'palm' ? .9 : .25; const N = shape === 'palm' ? 6 : 3; let px = 0, py = -.3, pz = 0;
  for (let k = 1; k <= N; k++) { const f = k / N, x = Math.sin(f * 1.6) * lean * (r() - .2), z = (r() - .5) * lean * .5, y = top * f; limb(b, px, py, pz, x, y, z, trunkR * (1 - (k - 1) / N * .65), trunkR * (1 - k / N * .65), segs, bark); px = x; py = y; pz = z; lx = x; lz = z; }
  const crowY = H * base, cy = (crowY + H) / 2, ry = (H - crowY) / 2;
  if (!lod && (shape === 'round' || shape === 'flat')) for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28 + r(), e = CR * (.55 + r() * .3); limb(b, px * .5, H * (base + .1) + r() * H * .15, 0, Math.cos(a) * e, cy + (r() - .3) * ry * (shape === 'flat' ? .3 : .8), Math.sin(a) * e, trunkR * .45, trunkR * .12, 4, bark); }
  const nc = lod ? Math.max(6, Math.round(NC * .12)) : NC, cs = lod ? CS * 2.3 : CS;
  for (let k = 0; k < nc; k++) {
    let x, y, z, nx, ny, nz;
    if (shape === 'palm') { const a = k / nc * 6.28 + r() * .3, d = cs * .9; x = lx + Math.cos(a) * d; z = lz + Math.sin(a) * d; y = H - .3 - r() * .6; nx = Math.cos(a); ny = .3; nz = Math.sin(a); const uv = (u, v) => auv(AC.palm, u, v), o = b.p.length / 3, L = cs * 1.9, W = cs * .7, ca = Math.cos(a), sa = Math.sin(a); [[0, -1], [1, -1], [1, 1], [0, 1]].forEach(([u, v]) => b.v(lx + ca * L * u - sa * W * v * .5, H - L * u * u * .45, lz + sa * L * u + ca * W * v * .5, nx, ny + .5, nz, ...uv(u, (v + 1) / 2), [1, 1, 1], 0)); b.i.push(o, o + 1, o + 2, o, o + 2, o + 3); continue; }
    if (shape === 'cone' || shape === 'pine') { const t = r(), hh = shape === 'pine' ? crowY + (H - crowY) * Math.sqrt(t) : crowY + (H - crowY) * t, rad = (shape === 'pine' ? CR * (1 - Math.pow((hh - crowY) / (H - crowY), 1.6)) * (.4 + .6 * Math.sin(Math.min(1, (hh - crowY) / (H - crowY) + .2) * 3)) : CR * (1 - (hh - crowY) / (H - crowY))) * (.5 + .5 * r()), a = r() * 6.28; x = Math.cos(a) * rad; z = Math.sin(a) * rad; y = hh; nx = x; ny = .4 * CR; nz = z; }
    else { let u, v, w; do { u = r() * 2 - 1; v = r() * 2 - 1; w = r() * 2 - 1; } while (u * u + v * v + w * w > 1); const fl = shape === 'flat' ? .45 : 1; x = u * CR; y = cy + v * ry * fl; z = w * CR; nx = u; ny = v * .7 + .35; nz = w; }
    const ao = .55 + .45 * Math.min(1, Math.hypot(x / CR, (y - cy) / Math.max(1, ry), z / CR)) * (.7 + .3 * (y - crowY) / (H - crowY + .01));
    card(b, x, y, z, cs * (.8 + r() * .4), leaf, r, nx, ny, nz, ao, shape === 'cone' || shape === 'pine' ? .25 + r() * .3 : undefined);
  }
  return b.geo(false);
}
export function plantGeo(name, lod) {
  const b = new B(), r = rng(name.length * 7 + lod);
  if (name === 'shrub') for (let k = 0; k < (lod ? 4 : 14); k++) { const a = r() * 6.28, d = r() * .6; card(b, Math.cos(a) * d, .45 + r() * .35, Math.sin(a) * d, lod ? .9 : .55, k % 3 ? AC.shrub : AC.dry, r, Math.cos(a), .8, Math.sin(a), .7 + r() * .3); }
  else if (name === 'cactus') { limb(b, 0, -.2, 0, 0, 4.5, 0, .3, .26, lod ? 5 : 9, AC.cactus); if (!lod) for (const s of [-1, 1]) { const h = 1.8 + r(); limb(b, 0, h, 0, s * .8, h + .25, 0, .18, .17, 6, AC.cactus); limb(b, s * .8, h + .2, 0, s * .82, h + 1.6, 0, .18, .15, 6, AC.cactus); } }
  else if (name === 'rock') { const g = new THREE.IcosahedronGeometry(1, lod ? 0 : 2), p = g.attributes.position; for (let k = 0; k < p.count; k++) { const x = p.getX(k), y = p.getY(k), z = p.getZ(k), f = .75 + .5 * Math.abs(Math.sin(x * 4.1 + z * 3.3) * Math.cos(y * 3.7)); p.setXYZ(k, x * f * 1.2, Math.max(-.2, y * f * .7), z * f); } g.computeVertexNormals(); const nb = g.toNonIndexed(); const P = nb.attributes.position, Nn = nb.attributes.normal; for (let k = 0; k < P.count; k++) { const uv = auv(AC.rock, (P.getX(k) * .4 + .5) % 1, (P.getZ(k) * .4 + .5) % 1); b.v(P.getX(k), P.getY(k), P.getZ(k), Nn.getX(k), Nn.getY(k), Nn.getZ(k), uv[0], uv[1], [1, 1, 1], 1); } for (let k = 0; k < P.count; k++) b.i.push(b.p.length / 3 - P.count + k); }
  else if (name === 'bale') { limb(b, 0, .88, -.75, 0, .88, .75, .88, .88, lod ? 8 : 18, AC.hay); for (const zz of [-.75, .75]) { const seg = lod ? 8 : 18, c0 = b.v(0, .88, zz, 0, 0, Math.sign(zz), ...auv(AC.hay, .5, .5), [.85, .8, .75], 1); for (let k = 0; k <= seg; k++) { const a = k / seg * 6.283; b.v(Math.cos(a) * .88, .88 + Math.sin(a) * .88, zz, 0, 0, Math.sign(zz), ...auv(AC.hay, .5 + Math.cos(a) * .45, .5 + Math.sin(a) * .45), [.85, .8, .75], 1); } for (let k = 0; k < seg; k++) zz > 0 ? b.i.push(c0, c0 + 1 + k, c0 + 2 + k) : b.i.push(c0, c0 + 2 + k, c0 + 1 + k); } }
  return b.geo(false);
}

// ---------------- props & buildings (SOLID family: aL = building texture layer, uv in tiles)
const WOOD = [.36, .28, .2], GREY = [.55, .55, .55], WHITE = [.86, .85, .82], RED = [.45, .09, .06], GALV = [.62, .64, .66];
function pole(b, lod) { b.cyl(0, 0, .17, .12, -.5, 10.5, lod ? 4 : 8, BL.wood, WOOD, true, 2); b.box(0, 9.6, 0, 1.25, .07, .07, BL.wood, WOOD, 2); if (!lod) { for (const x of [-1.05, 1.05, 0]) b.cyl(x, 0, .05, .04, x ? 9.74 : 10.5, (x ? 9.74 : 10.5) + .2, 6, BL.paint, [.25, .32, .3], true, 1); b.cyl(.3, .25, .25, .25, 7.6, 8.6, 8, BL.paint, GREY, true, 1); } }
function fence(b, lod) { for (const x of [-3, 0]) b.box(x, -.3, 0, .05, .95, .05, BL.planks, [.75, .7, .62], 1); if (!lod) b.box(1.5, -.3, 0, .035, .9, .035, BL.paint, [.42, .44, .42], 1); }
function signPost(b, h) { b.box(0, 0, 0, .045, h / 2, .045, BL.paint, GALV, 1); }
export function propGeo(name, lod, extra) {
  const b = new B();
  switch (name) {
    case 'pole': pole(b, lod); break; case 'fence': fence(b, lod); break;
    case 'guardrail': for (const x of [-2, 0]) b.box(x, 0, -.08, .08, .4, .08, BL.paint, GALV, 1); b.box(0, .55, .02, 2, .17, .03, BL.paint, GALV, 1); break;
    case 'mile': b.box(0, 0, 0, .06, .7, .02, BL.paint, [.05, .3, .12], 1); b.box(0, .9, .03, .14, .2, .005, BL.paint, [.85, .85, .85], 1); break;
    case 'signSmall': signPost(b, 2.6); b.box(0, 1.7, .05, .32, .42, .01, BL.paint, WHITE, 1); break;
    case 'signGreen': for (const x of [-1.5, 1.5]) b.box(x, 0, 0, .07, 1.6, .07, BL.paint, GALV, 1); b.box(0, 3.2, -.02, 1.9, 1.05, .04, BL.paint, [.03, .2, .1], 1); break;
    case 'turbine': { b.cyl(0, 0, 2.1, 1.2, 0, 80, lod ? 6 : 14, BL.paint, [.85, .86, .87], false, 4); b.box(0, 78.6, -1.5, 1.6, 1.8, 4.5, BL.paint, [.85, .86, .87], 2); break; }
    case 'pumpjack': b.box(0, 0, 0, 2.4, .25, .8, BL.paint, [.3, .3, .3], 1); b.box(.8, 0, 0, .15, 2.2, .15, BL.paint, [.42, .4, .2], 1); b.box(.8, 4.2, 0, 3.4, .25, .2, BL.paint, [.42, .4, .2], 1); b.box(3.9, 3.4, 0, .5, .9, .3, BL.paint, [.42, .4, .2], 1); b.box(-2.4, 2.2, 0, .9, .8, .15, BL.paint, [.25, .25, .25], 1); break;
    case 'radioTower': for (let k = 0; k < 3; k++) { const a = k / 3 * 6.283; b.cyl(Math.cos(a) * 1.1, Math.sin(a) * 1.1, .07, .05, 0, 90, 3, BL.paint, k % 2 ? [.7, .15, .1] : WHITE, false, 2, Math.cos(a) * .4, Math.sin(a) * .4); } if (!lod) for (let y = 3; y < 90; y += 3) b.box(0, y, 0, .9 - y / 180, .02, .9 - y / 180, BL.paint, GREY, 1, false); break;
    case 'waterTower': { b.cyl(0, 0, .5, .5, 0, 26, 8, BL.paint, GALV, false, 2); for (let k = 0; k < 4; k++) { const a = k * 1.571 + .785; b.cyl(Math.cos(a) * 4, Math.sin(a) * 4, .22, .22, 0, 24, 6, BL.paint, GALV, false, 2, Math.cos(a) * 2.6, Math.sin(a) * 2.6); } b.cyl(0, 0, 2.6, 6.2, 22, 26.5, lod ? 10 : 20, BL.paint, [.82, .83, .85], false, 3); b.cyl(0, 0, 6.2, 6.2, 26.5, 30.5, lod ? 10 : 20, BL.paint, [.84, .85, .86], false, 3); b.cyl(0, 0, 6.2, .6, 30.5, 32.6, lod ? 10 : 20, BL.paint, [.8, .8, .82], true, 3); break; }
    case 'elevator': { for (let k = 0; k < 6; k++) b.cyl(-10 + k * 4.1, 0, 2.05, 2.05, 0, 30, lod ? 8 : 16, BL.concrete, [.78, .76, .72], true, 3); b.box(-1.6, 0, 3, 3.2, 21, 2.2, BL.concrete, [.76, .74, .7], 3); b.box(-1.6, 30, 0, 12.6, 1.2, 2.2, BL.concrete, [.74, .72, .68], 3); break; }
    default: return null;
  }
  return b.geo();
}
// buildings. state 0 intact, 1 roof gone, 2 rubble
export function bldGeo(name, lod, state, variant = 0) {
  if (KIND[KI[name]].ext) return null; // city kinds are drawn by buildings.js
  const b = new B(), K = KIND[KI[name]], [, hx, hy, hz] = K.col, H = hy * 2, r = rng(KI[name] * 13 + variant), wall = (l, c) => [l, c];
  if (state === 2) { // rubble pile + slab
    b.box(0, -.3, 0, hx * 1.02, .3, hz * 1.02, BL.concrete, [.6, .58, .55], 3);
    const n = lod ? 8 : 40; for (let k = 0; k < n; k++) { const x = (r() - .5) * hx * 1.8, z = (r() - .5) * hz * 1.8, s = .3 + r() * 1.4, L = [BL.planks, BL.wood, BL.shingle, BL.siding, BL.brick, BL.corrugated][k % 6]; b.box(x, 0, z, s * (1 + r()), .12 + r() * .4, s * .3, L, [.5 + r() * .3, .45 + r() * .3, .4 + r() * .3], 2); }
    return b.geo();
  }
  const roof = state === 0, wn = !lod;
  const walls = (W, D, h, l, c, y0 = 0) => b.box(0, y0, 0, W, h / 2, D, l, c, 3, false);
  const rowWin = (W, D, y, nx_, w = 1.1, h = 1.3, gap = 3.2, sides = [1, 1, 1, 1], frame) => { if (!wn) return; const ss = [[0, 1, W, D], [0, -1, W, D], [1, 0, D, W], [-1, 0, D, W]]; ss.forEach(([nx, nz, L, d], i) => { if (!sides[i]) return; const n = Math.max(1, Math.floor(L * 2 / gap)); for (let k = 0; k < n; k++) { const t = -L + (k + .5) * (2 * L / n); b.window(nx ? nx * d : t, y, nz ? nz * d : t, w, h, nx, nz, frame); } }); };
  const door = (x, z, nx, nz, c = [.35, .2, .12]) => { if (wn) b.window(x, 1.05, z, 1, 2.1, nx, nz, WHITE, BL.wood); void c; };
  switch (name) {
    case 'farmhouse': case 'house': case 'house2': {
      const pal = [[.85, .84, .8], [.72, .68, .58], [.62, .7, .74], [.8, .76, .62], [.66, .62, .55], [.55, .6, .5]], wc = pal[(variant * 7 + KI[name]) % pal.length], two = name !== 'house';
      const h1 = two ? 5.6 : 3; walls(hx, hz, h1, BL.siding, wc); b.box(0, -.4, 0, hx + .15, .3, hz + .15, BL.concrete, [.6, .6, .58], 3, true);
      rowWin(hx, hz, 1.6, 0, 1, 1.35, 3.4); if (two) rowWin(hx, hz, 4.3, 0, 1, 1.2, 3.4); door(1.2, hz, 0, 1);
      if (roof) { b.gable(0, h1, 0, hx, hz, two ? 2.6 : 1.9, .45, BL.shingle, [.36, .3, .28], BL.siding, wc); if (!lod) b.box(hx * .45, h1 + 1.2, 0, .35, 1, .35, BL.brick, [1, 1, 1], 2); }
      else b.box(0, h1 - .1, 0, hx, .05, hz, BL.planks, [.5, .45, .4], 3);
      if (!lod) { b.box(0, 2.6, hz + 1.2, hx * .7, .06, 1.2, BL.shingle, [.4, .34, .3], 3); for (const x of [-hx * .65, 0, hx * .65]) b.box(x, 0, hz + 2.2, .08, 1.3, .08, BL.paint, WHITE, 1); b.box(0, .1, hz + 1.2, hx * .7, .1, 1.2, BL.wood, [.5, .44, .36], 2); }
      break; }
    case 'mobile': walls(hx, hz, 2.6, BL.corrugated, [.8, .8, .76], .5); rowWin(hx, hz, 2, 0, .9, .8, 3.2, [1, 1, 0, 0]); if (roof) b.box(0, 3.1, 0, hx + .05, .08, hz + .05, BL.paint, [.7, .7, .7], 3); b.box(0, 0, 0, hx * .95, .25, hz * .9, BL.paint, [.3, .3, .3], 2); break;
    case 'barn': { walls(hx, hz, 4.4, BL.planks, RED); if (wn) { b.window(0, 2.2, hz + .01, 4, 4, 0, 1, WHITE, BL.planks); b.window(0, 6.3, hz, 1.6, 1.6, 0, 1, WHITE, BL.planks); } if (roof) { // gambrel
        const y0 = 4.4, s = [[-hx - .4, y0 - .2], [-hx * .62, y0 + 3.6], [0, y0 + 5.2], [hx * .62, y0 + 3.6], [hx + .4, y0 - .2]]; for (let k = 0; k < 4; k++) { const [x0, ya] = s[k], [x1, yb] = s[k + 1]; b.face([x0, ya, hz + .4], [0, 0, -2 * hz - .8], [x1 - x0, yb - ya, 0], BL.corrugated, [.34, .34, .36], 3); }
        for (const sg of [1, -1]) { const o = b.p.length / 3; b.v(-hx, y0, sg * hz, 0, 0, sg, 0, 0, RED, BL.planks); for (let k = 1; k < 4; k++) b.v(s[k][0], s[k][1], sg * hz, 0, 0, sg, 1, 1, RED, BL.planks); b.v(hx, y0, sg * hz, 0, 0, sg, 2, 0, RED, BL.planks); for (let k = 1; k < 4; k++) sg > 0 ? b.i.push(o, o + k, o + k + 1) : b.i.push(o, o + k + 1, o + k); } } break; }
    case 'shed': walls(hx, hz, 4.4, BL.corrugated, [.7, .72, .74]); if (wn) b.window(0, 2, hz + .01, 6, 3.8, 0, 1, [.5, .5, .5], BL.corrugated); if (roof) b.gable(0, 4.4, 0, hx, hz, 1.6, .3, BL.corrugated, [.6, .62, .64], BL.corrugated, [.7, .72, .74]); break;
    case 'silo': b.cyl(0, 0, hx, hx, 0, H - 1, lod ? 8 : 18, BL.brick, [.85, .82, .78], !roof, 3); if (roof) b.cyl(0, 0, hx, .3, H - 1, H + 1.4, lod ? 8 : 18, BL.paint, [.7, .72, .74], true, 3); break;
    case 'bin': b.cyl(0, 0, hx, hx, 0, H - 1.4, lod ? 10 : 22, BL.corrugated, GALV, !roof, 3); if (roof) b.cyl(0, 0, hx + .1, .4, H - 1.4, H + .6, lod ? 10 : 22, BL.corrugated, [.66, .68, .7], true, 3); break;
    case 'church': walls(hx, hz, 6, BL.siding, WHITE); rowWin(hx, hz, 3, 0, 1, 2.6, 4, [0, 0, 1, 1]); door(0, hz, 0, 1); if (roof) { b.gable(0, 6, 0, hx, hz, 4.5, .4, BL.shingle, [.3, .3, .32], BL.siding, WHITE); b.box(0, 6, hz - 1.6, 1.6, 2.5, 1.6, BL.siding, WHITE, 3); b.cyl(0, hz - 1.6, 1.6, .05, 11, 17, 4, BL.shingle, [.3, .3, .32], false, 2); } break;
    case 'shop': case 'gas': case 'motel': case 'warehouse': case 'apartment': case 'office': case 'tower': {
      const lay = { shop: BL.brick, gas: BL.stucco, motel: BL.stucco, warehouse: BL.corrugated, apartment: BL.brick, office: BL.office, tower: BL.curtain }[name], cols = [[1, 1, 1], [.9, .84, .76], [.8, .82, .86], [.95, .9, .8]], c = cols[variant % 4];
      const h = name === 'gas' ? 4 : H; walls(hx, hz, h, lay, c);
      if (name === 'shop') { if (wn) { b.window(0, 1.5, hz + .01, hx * 1.5, 2.2, 0, 1, [.2, .2, .2]); rowWin(hx, hz, 5, 0, 1.1, 1.5, 3, [1, 0, 0, 0]); b.box(0, 3.1, hz + .8, hx, .08, .8, BL.paint, [.6 + r() * .3, .2 + r() * .3, .1], 1); } }
      else if (name === 'motel') { if (wn) for (let k = -5; k <= 5; k++) { b.window(k * 3, 1.05, hz + .01, .95, 2.05, 0, 1, WHITE, BL.paint); b.window(k * 3 + 1.2, 1.5, hz + .01, 1.1, 1, 0, 1); } b.box(0, 2.8, hz + 1, hx, .1, 1, BL.paint, [.6, .6, .58], 2); }
      else if (name === 'gas') { if (wn) b.window(0, 1.5, hz + .01, hx * 1.2, 2.2, 0, 1, [.3, .3, .3]); b.box(0, 5, hz + 9, 7.5, .5, 4.6, BL.paint, [.85, .85, .85], 2); for (const x of [-5, 5]) for (const z of [hz + 6, hz + 12]) b.box(x, 0, z, .25, 2.5, .25, BL.paint, [.8, .8, .8], 1); for (const x of [-5, 5]) b.box(x, 0, hz + 9, .5, .65, .9, BL.paint, [.75, .15, .1], 1); b.box(hx + 3, 0, hz + 15, .25, 4, .25, BL.paint, GREY, 1); b.box(hx + 3, 8, hz + 15, 1.6, 1.2, .15, BL.paint, [.1, .3, .6], 1); }
      else if (name === 'warehouse') { if (wn) for (let k = -2; k <= 2; k++) b.window(k * 5, 2.2, hz + .01, 3.6, 4.2, 0, 1, [.5, .5, .5], BL.corrugated); }
      else if (name === 'apartment') { for (let f = 0; f < 4; f++) rowWin(hx, hz, 1.6 + f * 3.4, 0, 1.2, 1.4, 3.2); }
      if (roof) { b.box(0, h, 0, hx + .15, .3, hz + .15, BL.tar, [1, 1, 1], 3); if (!lod && (name === 'office' || name === 'tower' || name === 'apartment')) { b.box(hx * .3, h + .6, -hz * .2, 2, 1.2, 1.5, BL.paint, GREY, 2); b.box(-hx * .4, h + .6, hz * .3, 1.4, 1.6, 1.4, BL.paint, [.6, .6, .6], 2); } if (name === 'tower') b.box(0, h + .6, 0, hx * .7, 3, hz * .7, BL.curtain, c, 3); }
      break; }
    default: b.box(0, 0, 0, hx, hy, hz, BL.siding, WHITE);
  }
  return b.geo();
}

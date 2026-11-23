// Hard-surface toolkit: param surfaces carrying 2D params, SDF clipping (windows, lamps, arches), rim extrusion, primitives,
// and a merged "trim" builder with per-vertex colour / roughness / metalness / emissive group.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp } from '../core/math.js';

// ---------- curves ----------
export function curve1(pts) { // monotone-ish cubic through [x,y] (sorted descending or ascending in x)
  const a = pts.slice().sort((p, q) => p[0] - q[0]), n = a.length, m = new Array(n).fill(0), d = [];
  for (let i = 0; i < n - 1; i++) d[i] = (a[i + 1][1] - a[i][1]) / (a[i + 1][0] - a[i][0]);
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]);
  m[0] = d[0] || 0; m[n - 1] = d[n - 2] || 0;
  return (x) => {
    if (x <= a[0][0]) return a[0][1]; if (x >= a[n - 1][0]) return a[n - 1][1]; let i = 0; while (x > a[i + 1][0]) i++;
    const h = a[i + 1][0] - a[i][0], t = (x - a[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * a[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}
// Closed-form sampled half outline from [f,x] control points (centripetal catmull-rom), arc-length table.
export class Outline {
  constructor(ctrl, n = 320, smooth = 0) {
    const c = ctrl.map((p) => new THREE.Vector2(p[0], p[1])); c.unshift(new THREE.Vector2(c[0].x, -c[1].y)); c.push(new THREE.Vector2(c[c.length - 1].x, -c[c.length - 2].y));
    const raw = []; for (let i = 1; i < c.length - 2; i++) { const p0 = c[i - 1], p1 = c[i], p2 = c[i + 1], p3 = c[i + 2]; for (let k = 0; k < 40; k++) raw.push(cr(p0, p1, p2, p3, k / 40)); } raw.push([c[c.length - 2].x, c[c.length - 2].y]);
    this.set(resample(raw, n)); if (smooth > 0) this.smooth(smooth);
  }
  set(pts) { this.p = pts; this.n = pts.length; const L = [0]; for (let i = 1; i < pts.length; i++) L[i] = L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); this.L = L; this.len = L[L.length - 1]; }
  smooth(r) { const h = this.len / (this.n - 1), w = Math.max(1, Math.round(r / h)), o = []; const P = this.p, n = this.n; const g = (i) => (i < 0 ? [P[-i][0], -P[-i][1]] : i >= n ? [P[2 * n - 2 - i][0], -P[2 * n - 2 - i][1]] : P[i]); for (let i = 0; i < n; i++) { let a = 0, b = 0, s = 0; for (let k = -w; k <= w; k++) { const q = 1 - Math.abs(k) / (w + 1), v = g(i + k); a += v[0] * q; b += v[1] * q; s += q; } o.push([a / s, b / s]); } o[0][1] = 0; o[n - 1][1] = 0; this.set(o); }
  at(S, out = []) { const L = this.L, t = clamp(S, 0, this.len); let lo = 0, hi = this.n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= t) lo = m; else hi = m; } const k = (t - L[lo]) / Math.max(1e-9, L[hi] - L[lo]); out[0] = lerp(this.p[lo][0], this.p[hi][0], k); out[1] = lerp(this.p[lo][1], this.p[hi][1], k); return out; }
  normal(S) { const e = 0.02, a = this.at(S - e, []), b = this.at(S + e, []); if (S - e < 0) { a[0] = this.at(e - S)[0]; a[1] = -this.at(e - S)[1]; } if (S + e > this.len) { const q = this.at(2 * this.len - S - e); b[0] = q[0]; b[1] = -q[1]; } const df = b[0] - a[0], dx = b[1] - a[1], l = Math.hypot(df, dx) || 1; return [dx / l, -df / l]; } // [nf,nx] outward
  sOfF(f) { let best = 0, bd = 1e9; for (let i = 0; i < this.n; i++) { const d = Math.abs(this.p[i][0] - f) - this.p[i][1] * 0.02; if (this.p[i][1] > 0.3 && d < bd) { bd = d; best = i; } } return this.L[best]; }
  xOfF(f) { let m = 0; const P = this.p; for (let i = 1; i < this.n; i++) { const a = P[i - 1], b = P[i]; if ((a[0] - f) * (b[0] - f) <= 0) { const k = Math.abs(b[0] - a[0]) < 1e-9 ? 0 : (f - a[0]) / (b[0] - a[0]); m = Math.max(m, lerp(a[1], b[1], k)); } } return m; }
}
function cr(p0, p1, p2, p3, t) { // centripetal
  const A = 0.5, d = (a, b) => Math.max(1e-4, Math.pow(a.distanceTo(b), A)), t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3), T = lerp(t1, t2, t);
  const L = (a, b, ta, tb) => [(tb - T) / (tb - ta) * (a.x ?? a[0]) + (T - ta) / (tb - ta) * (b.x ?? b[0]), (tb - T) / (tb - ta) * (a.y ?? a[1]) + (T - ta) / (tb - ta) * (b.y ?? b[1])];
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3); return L(B1, B2, t1, t2);
}
export function resample(pts, n) {
  const L = [0]; for (let i = 1; i < pts.length; i++) { let s = 0; for (let k = 0; k < pts[i].length; k++) s += (pts[i][k] - pts[i - 1][k]) ** 2; L[i] = L[i - 1] + Math.sqrt(s); }
  const T = L[L.length - 1], o = []; let j = 0; for (let i = 0; i < n; i++) { const t = T * i / (n - 1); while (j < pts.length - 2 && L[j + 1] < t) j++; const k = (t - L[j]) / Math.max(1e-9, L[j + 1] - L[j]); o.push(pts[j].map((v, c) => lerp(v, pts[j + 1][c], k))); } return o;
}

// ---------- 2D SDF ----------
export function sdPoly(poly) { // signed distance to polygon (negative inside)
  const n = poly.length;
  return (x, y) => {
    let d = (x - poly[0][0]) ** 2 + (y - poly[0][1]) ** 2, s = 1;
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const ex = poly[j][0] - poly[i][0], ey = poly[j][1] - poly[i][1], wx = x - poly[i][0], wy = y - poly[i][1], t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey + 1e-12)), bx = wx - ex * t, by = wy - ey * t; d = Math.min(d, bx * bx + by * by);
      const c1 = y >= poly[i][1], c2 = y < poly[j][1], c3 = ex * wy > ey * wx; if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * Math.sqrt(d);
  };
}
export const sdRound = (poly, r) => { const f = sdPoly(insetPoly(poly, r)); return (x, y) => f(x, y) - r; };
export function insetPoly(poly, r) { // inset by r (convex-ish polygons)
  let A = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) A += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]; const sg = A > 0 ? 1 : -1, n = poly.length;
  return poly.map((p, i) => { const a = poly[(i + n - 1) % n], b = poly[(i + 1) % n]; let x1 = p[0] - a[0], y1 = p[1] - a[1], x2 = b[0] - p[0], y2 = b[1] - p[1]; const l1 = Math.hypot(x1, y1) || 1, l2 = Math.hypot(x2, y2) || 1; x1 /= l1; y1 /= l1; x2 /= l2; y2 /= l2; const n1x = -y1 * sg, n1y = x1 * sg, n2x = -y2 * sg, n2y = x2 * sg, d = 1 + n1x * n2x + n1y * n2y; const k = r / Math.max(0.25, d); return [p[0] + (n1x + n2x) * k, p[1] + (n1y + n2y) * k]; });
}
export const sdBox = (cx, cy, hx, hy, r = 0) => (x, y) => { const dx = Math.abs(x - cx) - hx + r, dy = Math.abs(y - cy) - hy + r; return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r; };

// ---------- surface ----------
export class Surf {
  constructor() { this.p = []; this.n = []; this.a = []; this.i = []; }
  get count() { return this.p.length / 3; }
  v(x, y, z, nx = 0, ny = 1, nz = 0, a = 0, b = 0) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.a.push(a, b); return this.p.length / 3 - 1; }
  t(a, b, c) { this.i.push(a, b, c); }
  q(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  clone() { const s = new Surf(); s.p = this.p.slice(); s.n = this.n.slice(); s.a = this.a.slice(); s.i = this.i.slice(); return s; }
  static grid(nu, nv, fn, flip = false) { // fn(iu,iv)->[x,y,z,a,b]
    const s = new Surf(); for (let u = 0; u < nu; u++) for (let v = 0; v < nv; v++) { const r = fn(u, v); s.v(r[0], r[1], r[2], 0, 0, 0, r[3] || 0, r[4] || 0); }
    for (let u = 0; u < nu - 1; u++) for (let v = 0; v < nv - 1; v++) { const a = u * nv + v, b = a + nv, c = b + 1, d = a + 1; if (flip) s.q(a, d, c, b); else s.q(a, b, c, d); }
    s.normals(); return s;
  }
  normals() { // area weighted smooth
    const { p, i } = this, n = new Array(p.length).fill(0);
    for (let k = 0; k < i.length; k += 3) { const a = i[k] * 3, b = i[k + 1] * 3, c = i[k + 2] * 3, ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2], x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; for (const o of [a, b, c]) { n[o] += x; n[o + 1] += y; n[o + 2] += z; } }
    for (let k = 0; k < n.length; k += 3) { const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1; n[k] /= l; n[k + 1] /= l; n[k + 2] /= l; } this.n = n; return this;
  }
  flat() { // unshare vertices -> facetted
    const s = new Surf(); for (let k = 0; k < this.i.length; k += 3) { const id = []; for (let j = 0; j < 3; j++) { const o = this.i[k + j]; id.push(s.v(this.p[o * 3], this.p[o * 3 + 1], this.p[o * 3 + 2], 0, 0, 0, this.a[o * 2], this.a[o * 2 + 1])); } s.t(...id); } return s.normals();
  }
  weldMirrorNormals(eps = 1e-3) { for (let k = 0; k < this.p.length; k += 3) if (Math.abs(this.p[k]) < eps) { this.p[k] = 0; this.n[k] = 0; const l = Math.hypot(this.n[k + 1], this.n[k + 2]) || 1; this.n[k + 1] /= l; this.n[k + 2] /= l; } return this; }
  mirrorX() { const s = this.clone(); for (let k = 0; k < s.p.length; k += 3) { s.p[k] = -s.p[k]; s.n[k] = -s.n[k]; } for (let k = 0; k < s.i.length; k += 3) { const t = s.i[k + 1]; s.i[k + 1] = s.i[k + 2]; s.i[k + 2] = t; } return s; }
  append(o) { const b = this.count; for (const v of o.p) this.p.push(v); for (const v of o.n) this.n.push(v); for (const v of o.a) this.a.push(v); for (const v of o.i) this.i.push(v + b); return this; }
  both() { return this.clone().append(this.mirrorX()); }
  flip() { for (let k = 0; k < this.n.length; k++) this.n[k] = -this.n[k]; for (let k = 0; k < this.i.length; k += 3) { const t = this.i[k + 1]; this.i[k + 1] = this.i[k + 2]; this.i[k + 2] = t; } return this; }
  offset(d) { for (let k = 0; k < this.p.length; k++) this.p[k] += this.n[k] * d; return this; }
  move(x, y, z) { for (let k = 0; k < this.p.length; k += 3) { this.p[k] += x; this.p[k + 1] += y; this.p[k + 2] += z; } return this; }
  map(fn) { const o = [0, 0, 0]; for (let k = 0; k < this.p.length; k += 3) { o[0] = this.p[k]; o[1] = this.p[k + 1]; o[2] = this.p[k + 2]; fn(o); this.p[k] = o[0]; this.p[k + 1] = o[1]; this.p[k + 2] = o[2]; } return this; }
  apply(m) { const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m); for (let k = 0; k < this.p.length; k += 3) { v.set(this.p[k], this.p[k + 1], this.p[k + 2]).applyMatrix4(m); this.p[k] = v.x; this.p[k + 1] = v.y; this.p[k + 2] = v.z; v.set(this.n[k], this.n[k + 1], this.n[k + 2]).applyMatrix3(nm).normalize(); this.n[k] = v.x; this.n[k + 1] = v.y; this.n[k + 2] = v.z; } if (m.determinant() < 0) for (let k = 0; k < this.i.length; k += 3) { const t = this.i[k + 1]; this.i[k + 1] = this.i[k + 2]; this.i[k + 2] = t; } return this; }
  at(x, y, z, rx = 0, ry = 0, rz = 0, s = 1) { return this.apply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s))); }
  // split by scalar field f(x,y,z,a,b): returns {neg,pos,edges} (edges: boundary segments [p,n] of neg side, oriented)
  split(f) {
    const N = this.count, val = new Float64Array(N), p = this.p, n = this.n, a = this.a;
    for (let k = 0; k < N; k++) { let q = f(p[k * 3], p[k * 3 + 1], p[k * 3 + 2], a[k * 2], a[k * 2 + 1]); if (Math.abs(q) < 1e-5) q = 1e-5; val[k] = q; }
    const A = new Surf(), B = new Surf(), mapA = new Int32Array(N).fill(-1), mapB = new Int32Array(N).fill(-1), cut = new Map(), edges = [];
    const cp = (S, m, k) => { if (m[k] < 0) m[k] = S.v(p[k * 3], p[k * 3 + 1], p[k * 3 + 2], n[k * 3], n[k * 3 + 1], n[k * 3 + 2], a[k * 2], a[k * 2 + 1]); return m[k]; };
    const mix = (i, j, t) => { const o = []; for (let c = 0; c < 3; c++) o.push(lerp(p[i * 3 + c], p[j * 3 + c], t)); for (let c = 0; c < 3; c++) o.push(lerp(n[i * 3 + c], n[j * 3 + c], t)); const l = Math.hypot(o[3], o[4], o[5]) || 1; o[3] /= l; o[4] /= l; o[5] /= l; o.push(lerp(a[i * 2], a[j * 2], t), lerp(a[i * 2 + 1], a[j * 2 + 1], t)); return o; };
    const edge = (i, j) => { const key = i < j ? i * N + j : j * N + i; let c = cut.get(key); if (c) return c; let i0 = Math.min(i, j), j0 = Math.max(i, j), t0 = 0, t1 = 1, v0 = val[i0], v1 = val[j0], t = v0 / (v0 - v1); for (let it = 0; it < 3; it++) { const o = mix(i0, j0, t), q = f(o[0], o[1], o[2], o[6], o[7]); if (q * v0 > 0) { t0 = t; v0 = q; } else { t1 = t; v1 = q; } t = t0 + (t1 - t0) * clamp(v0 / (v0 - v1 || 1), 0.02, 0.98); } const o = mix(i0, j0, t); c = [A.v(...o), B.v(...o), o]; cut.set(key, c); return c; };
    for (let k = 0; k < this.i.length; k += 3) {
      const t = [this.i[k], this.i[k + 1], this.i[k + 2]], neg = t.map((q) => val[q] < 0), c = neg[0] + neg[1] + neg[2];
      if (c === 3) A.t(cp(A, mapA, t[0]), cp(A, mapA, t[1]), cp(A, mapA, t[2])); else if (c === 0) B.t(cp(B, mapB, t[0]), cp(B, mapB, t[1]), cp(B, mapB, t[2]));
      else { let r = c === 1 ? neg.indexOf(true) : neg.indexOf(false); const i0 = t[r], i1 = t[(r + 1) % 3], i2 = t[(r + 2) % 3], e1 = edge(i0, i1), e2 = edge(i0, i2);
        if (c === 1) { A.t(cp(A, mapA, i0), e1[0], e2[0]); B.t(e1[1], cp(B, mapB, i1), cp(B, mapB, i2)); B.t(e1[1], cp(B, mapB, i2), e2[1]); edges.push([e1[2], e2[2]]); }
        else { B.t(cp(B, mapB, i0), e1[1], e2[1]); A.t(e1[0], cp(A, mapA, i1), cp(A, mapA, i2)); A.t(e1[0], cp(A, mapA, i2), e2[0]); edges.push([e2[2], e1[2]]); } }
    }
    return { neg: A, pos: B, edges };
  }
  geometry(which = 0) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    const u = new Float32Array(this.count * 3); for (let k = 0; k < this.count; k++) { u[k * 3] = this.a[k * 2]; u[k * 3 + 1] = this.a[k * 2 + 1]; u[k * 3 + 2] = which; } g.setAttribute('aUv', new THREE.BufferAttribute(u, 3)); g.setIndex(this.i.slice()); return g;
  }
  tris() { return this.i.length / 3; }
}
// wall of a cut: extrude edge segments. dir(o)->[dx,dy,dz] displacement; faces point to the hole interior
export function rim(edges, dir, flip = false, segs = 1) {
  const s = new Surf(); for (const [e0, e1] of edges) { const d0 = dir(e0), d1 = dir(e1); const ux = e1[0] - e0[0], uy = e1[1] - e0[1], uz = e1[2] - e0[2]; let nx = uy * d0[2] - uz * d0[1], ny = uz * d0[0] - ux * d0[2], nz = ux * d0[1] - uy * d0[0]; const l = Math.hypot(nx, ny, nz) || 1, g = flip ? 1 : -1; nx *= g / l; ny *= g / l; nz *= g / l;
    for (let k = 0; k < segs; k++) { const a = k / segs, b = (k + 1) / segs; const i0 = s.v(e0[0] + d0[0] * a, e0[1] + d0[1] * a, e0[2] + d0[2] * a, nx, ny, nz, e0[6], e0[7]), i1 = s.v(e1[0] + d1[0] * a, e1[1] + d1[1] * a, e1[2] + d1[2] * a, nx, ny, nz, e1[6], e1[7]), i2 = s.v(e1[0] + d1[0] * b, e1[1] + d1[1] * b, e1[2] + d1[2] * b, nx, ny, nz, e1[6], e1[7]), i3 = s.v(e0[0] + d0[0] * b, e0[1] + d0[1] * b, e0[2] + d0[2] * b, nx, ny, nz, e0[6], e0[7]); if (flip) s.q(i0, i1, i2, i3); else s.q(i0, i3, i2, i1); } }
  return s;
}

// ---------- primitives (return Surf) ----------
export function fromGeo(g) { const s = new Surf(); s.p = Array.from(g.attributes.position.array); s.n = Array.from(g.attributes.normal.array); s.a = new Array(s.count * 2).fill(0); if (g.index) s.i = Array.from(g.index.array); else s.i = Array.from({ length: s.count }, (_, k) => k); g.dispose(); return s; }
// 44-tri bevelled box whose chamfers interpolate face normals (reads as a small radius); seg>1 -> true rounded box
export function rbox(w, h, d, r = 0.01, seg = 1) {
  r = Math.min(r, w * 0.49, h * 0.49, d * 0.49); if (seg > 1) return fromGeo(new RoundedBoxGeometry(w, h, d, seg - 1, r));
  const s = new Surf(), H = [w / 2, h / 2, d / 2], id = {}; // vertex id[axis][sx,sy,sz]
  for (let ax = 0; ax < 3; ax++) for (let k = 0; k < 8; k++) { const g = [k & 1 ? 1 : -1, k & 2 ? 1 : -1, k & 4 ? 1 : -1], p = g.map((q, c) => q * (H[c] - (c === ax ? 0 : r))), n = [0, 0, 0]; n[ax] = g[ax]; id[ax * 8 + k] = s.v(...p, ...n); }
  const C = (a, b, c, e) => { const P = (i) => new THREE.Vector3(s.p[i * 3], s.p[i * 3 + 1], s.p[i * 3 + 2]), A = P(a), n = P(b).sub(A).cross(P(c).sub(A)); const m = A.clone().add(P(c)); if (n.dot(m) < 0) { if (e === undefined) s.t(a, c, b); else s.q(a, e, c, b); } else if (e === undefined) s.t(a, b, c); else s.q(a, b, c, e); };
  for (let ax = 0; ax < 3; ax++) { const u = (ax + 1) % 3, v = (ax + 2) % 3; for (const sg of [0, 1]) { const k = (a, b) => ax * 8 + ((sg << ax) | (a << u) | (b << v)); C(id[k(0, 0)], id[k(1, 0)], id[k(1, 1)], id[k(0, 1)]); } }
  for (let ax = 0; ax < 3; ax++) { const u = (ax + 1) % 3, v = (ax + 2) % 3; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const bits = (e) => (e << ax) | (a << u) | (b << v); C(id[u * 8 + bits(0)], id[u * 8 + bits(1)], id[v * 8 + bits(1)], id[v * 8 + bits(0)]); } }
  for (let k = 0; k < 8; k++) C(id[k], id[8 + k], id[16 + k]);
  return s;
}
export const box = (w, h, d) => fromGeo(new THREE.BoxGeometry(w, h, d));
export const cyl = (r0, r1, h, seg = 16, open = false) => fromGeo(new THREE.CylinderGeometry(r1, r0, h, seg, 1, open));
export const sph = (r, a = 14, b = 10, p0 = 0, pl = Math.PI * 2, t0 = 0, tl = Math.PI) => fromGeo(new THREE.SphereGeometry(r, a, b, p0, pl, t0, tl));
export const torus = (R, r, a = 8, b = 24, arc = Math.PI * 2) => fromGeo(new THREE.TorusGeometry(R, r, a, b, arc));
export function tube(pts, r, seg = 8, n = 0, closed = false) { const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed, 'catmullrom', 0.2); return fromGeo(new THREE.TubeGeometry(c, n || pts.length * 5, r, seg, closed)); }
export function pipe(a, b, r, seg = 8) { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), l = d.length(); return fromGeo(new THREE.CylinderGeometry(r, r, l, seg, 1)).apply(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1))); }
export function lathe(prof, seg = 32) { return fromGeo(new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), seg)); } // around Y
export function extrude(poly, depth, bevel = 0, bs = 1) { const sh = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], p[1]))); const g = new THREE.ExtrudeGeometry(sh, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelOffset: -bevel, bevelSegments: bs, curveSegments: 6 }); g.translate(0, 0, -(depth - bevel * 2) / 2); return fromGeo(g); }
// convex hull-ish prism from 8 arbitrary corners (for plates/wedges). c: bottom 4 (ccw from above) then top 4
export function hexa(c) { const s = new Surf(); const f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]; for (const q of f) { const id = q.map((k) => s.v(...c[k])); s.q(...id); } return s.normals(); }

// ---------- merged trim builder ----------
export class Trim {
  constructor() { this.s = new Surf(); this.c = []; this.m = []; this.M = null; }
  add(surf, st) { const col = new THREE.Color(st.c ?? 0x111111), n = surf.count; const s = this.s, b = s.count; for (let k = 0; k < surf.p.length; k++) { s.p.push(surf.p[k]); s.n.push(surf.n[k]); } for (const v of surf.i) s.i.push(v + b); for (let k = 0; k < n; k++) { this.c.push(col.r, col.g, col.b); this.m.push(st.r ?? 0.6, st.m ?? 0, st.e ?? 0, st.d ?? 0); } return this; }
  both(surf, st) { this.add(surf, st); return this.add(surf.mirrorX(), st); }
  get tris() { return this.s.tris(); }
  geometry() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.s.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.s.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.m, 4)); g.setIndex(this.s.i); g.computeBoundingSphere(); return g; }
}

// ---------- line SDF atlas (shut lines / cladding) ----------
export class LineAtlas {
  constructor(w = 1536, h = 384) { this.w = w; this.h = h; this.range = 0.016; this.d = new Float32Array(w * h * 4).fill(1); /* rgb: (d/range)^2 to three line sets, a: cladding sd */ this.rect = [[0, 0, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1]]; }
  setRect(ch, u0, v0, u1, v1) { this.rect[ch] = [u0, v0, u1, v1]; }
  line(ch, pts, closed = false) { const [u0, v0, u1, v1] = this.rect[ch], { w, h, range } = this, sx = (u1 - u0) / w, sy = (v1 - v0) / h; const P = closed ? [...pts, pts[0]] : pts;
    for (let i = 0; i < P.length - 1; i++) { const [ax, ay] = P[i], [bx, by] = P[i + 1], x0 = Math.max(0, Math.floor((Math.min(ax, bx) - range - u0) / sx)), x1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + range - u0) / sx)), y0 = Math.max(0, Math.floor((Math.min(ay, by) - range - v0) / sy)), y1 = Math.min(h - 1, Math.ceil((Math.max(ay, by) + range - v0) / sy)), ex = bx - ax, ey = by - ay, ll = ex * ex + ey * ey + 1e-12;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const px = u0 + (x + 0.5) * sx, py = v0 + (y + 0.5) * sy, t = clamp(((px - ax) * ex + (py - ay) * ey) / ll), dx = px - ax - ex * t, dy = py - ay - ey * t, q = Math.min(1, (dx * dx + dy * dy) / (range * range)), o = (y * w + x) * 4 + ch; if (q < this.d[o]) this.d[o] = q; } } return this; }
  region(fn, ch = 0) { const [u0, v0, u1, v1] = this.rect[ch], { w, h } = this; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = fn(u0 + (x + 0.5) / w * (u1 - u0), v0 + (y + 0.5) / h * (v1 - v0)); const o = (y * w + x) * 4 + 3; this.d[o] = Math.min(this.d[o], clamp(0.5 + d / 0.08, 0, 1)); } return this; }
  texture() { const hf = new Uint16Array(this.d.length); for (let i = 0; i < hf.length; i++) hf[i] = THREE.DataUtils.toHalfFloat(this.d[i]); this.d = null; const t = new THREE.DataTexture(hf, this.w, this.h, THREE.RGBAFormat, THREE.HalfFloatType); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; }
}
export const roundedPath = (pts, r, closed = true, seg = 5) => { const o = [], n = pts.length; for (let i = 0; i < n; i++) { if (!closed && (i === 0 || i === n - 1)) { o.push(pts[i]); continue; } const a = pts[(i + n - 1) % n], p = pts[i], b = pts[(i + 1) % n]; const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]), k = Math.min(p[2] ?? r, la * 0.45, lb * 0.45), p1 = [p[0] + (a[0] - p[0]) / la * k, p[1] + (a[1] - p[1]) / la * k], p2 = [p[0] + (b[0] - p[0]) / lb * k, p[1] + (b[1] - p[1]) / lb * k]; for (let j = 0; j <= seg; j++) { const t = j / seg, u = 1 - t; o.push([u * u * p1[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * p[1] + t * t * p2[1]]); } } return o; };

// Assembly kit: turns shells into finished car bodies (windows, lamps, grilles, arches, interior, wheels, equipment).
import * as THREE from 'three';
import { Surf, Trim, LineAtlas, rim, rbox, box, cyl, sph, torus, tube, pipe, lathe, extrude, sdPoly, sdRound, roundedPath, hexa } from './mesh.js';
import { buildLower, buildHouse } from './shell.js';
import { lerp, clamp } from '../core/math.js';

// trim styles: c colour, r rough, m metal, e emissive group, d flag (1 paint, 2 rubber, 3 clean)
export const ST = {
  black: { c: 0x0c0c0d, r: 0.62, m: 0 }, gloss: { c: 0x050506, r: 0.12, m: 0 }, rubber: { c: 0x0b0b0b, r: 0.85, m: 0, d: 2 }, tyre: { c: 0x121212, r: 0.92, m: 0, d: 2 }, chrome: { c: 0xd8dadd, r: 0.1, m: 1 }, satin: { c: 0x9fa3a8, r: 0.32, m: 1 }, alu: { c: 0xb4b7bb, r: 0.36, m: 1 }, dark: { c: 0x050505, r: 0.95, m: 0 }, steel: { c: 0x55585c, r: 0.45, m: 0.9 }, disc: { c: 0x8b8d90, r: 0.28, m: 1 }, iron: { c: 0x2a2724, r: 0.7, m: 0.6 }, paint: { c: 0xffffff, r: 0.28, m: 0.25, d: 1 }, powder: { c: 0x17181a, r: 0.55, m: 0.25 }, gun: { c: 0x3a3d41, r: 0.34, m: 0.9 }, bowl: { c: 0xc9ccd0, r: 0.08, m: 1, d: 3 }, housing: { c: 0x101113, r: 0.22, m: 0.4, d: 3 },
  seat: { c: 0x1b1c1f, r: 0.85, m: 0, d: 3 }, seat2: { c: 0x2b2d31, r: 0.9, m: 0, d: 3 }, dash: { c: 0x151617, r: 0.75, m: 0, d: 3 }, dash2: { c: 0x232426, r: 0.6, m: 0, d: 3 }, carpet: { c: 0x0d0d0e, r: 1, m: 0, d: 3 }, liner: { c: 0x3a3a38, r: 0.95, m: 0, d: 3 }, satinIn: { c: 0x7d8084, r: 0.35, m: 0.9, d: 3 },
  head: { c: 0xfff6e2, r: 0.2, m: 0, e: 1 }, drl: { c: 0xf2f6ff, r: 0.2, m: 0, e: 6 }, tail: { c: 0xff1208, r: 0.2, m: 0, e: 2 }, brake: { c: 0xff1408, r: 0.2, m: 0, e: 3 }, amber: { c: 0xff7a08, r: 0.25, m: 0, e: 4 }, rev: { c: 0xffffff, r: 0.2, m: 0, e: 5 }, bar: { c: 0xfff3dc, r: 0.15, m: 0, e: 7 }, barA: { c: 0xff8a10, r: 0.2, m: 0, e: 8 }, screen: { c: 0x66b8ff, r: 0.3, m: 0, e: 9 }, dashlit: { c: 0xff9a50, r: 0.4, m: 0, e: 9 }, barB: { c: 0xff8a10, r: 0.2, m: 0, e: 10 },
};
const mm = (o) => ({ ...o });

export class CarKit {
  constructor(spec, C, lod) {
    this.spec = spec; this.C = C; this.lod = lod; this.q = lod ? 0.42 : 1; this.trim = new Trim(); this.paint = { wall: new Surf(), cap: new Surf(), house: new Surf(), }; this.glass = new Surf(); this.lens = new Surf(); this.red = new Surf(); this.atlas = new LineAtlas(); this.mounts = {}; this.anim = {}; this.parts = []; this.decals = [];
    this.wbF = spec.wheelbase / 2;
  }
  // ----- lower body -----
  lower() {
    const { C, spec, trim } = this, L = (this.L = buildLower(C.lower, this.q)), hi = !this.lod; let wall = L.wall; this.cabF = C.cabF;
    this.atlas.setRect(0, 0, 0, L.O.len, 1.8); this.atlas.setRect(1, L.f0 - 0.1, 0, L.f1 + 0.1, 1.2);
    const xin = Math.min(spec.trackF, spec.trackR) / 2 - spec.wheelW / 2 - 0.07;
    for (const A of C.lower.arches || []) {
      const ay = A.y, cutY = A.cutTop; void cutY;
      const r = wall.split((x, y, z) => (x < 0.3 ? 1 : Math.hypot(-z - A.f, (y - ay) * (A.sq ?? 1)) - A.r)); wall = r.pos;
      trim.both(rim(r.edges, (e) => [-0.03, 0, 0], true), A.clad ? ST.black : mm({ ...ST.paint }));
      const e2 = r.edges.map(([a, b]) => [[a[0] - 0.03, a[1], a[2], 0, 0, 0, 0, 0], [b[0] - 0.03, b[1], b[2], 0, 0, 0, 0, 0]]);
      if (hi) trim.both(rim(e2, (e) => [xin - e[0], 0, 0], true, 2), ST.dark);
      const disc = []; for (let k = 0; k <= 16; k++) disc.push([A.f + Math.cos(Math.PI * k / 16) * A.r, ay + Math.sin(Math.PI * k / 16) * A.r]); const pl = new Surf(); const yl = Math.max(L.yBot(A.f), ay - 0.25); const c0 = pl.v(xin, yl, -A.f, 1, 0, 0); let prev = -1; for (const d of [[A.f + A.r, yl], ...disc, [A.f - A.r, yl]]) { const i = pl.v(xin, d[1], -d[0], 1, 0, 0); if (prev >= 0) pl.t(c0, i, prev); prev = i; } trim.both(pl, ST.dark);
      if (A.lipClad && hi) { } // reserved
    }
    this.wall = wall; this.cap = L.cap;
    // underbody
    const bt = L.bottom.clone(); let b2 = bt; for (const A of C.lower.arches || []) b2 = b2.split((x, y, z) => Math.max(Math.abs(-z - A.f) - A.r * 1.02, xin - x)).pos; trim.both(b2, ST.dark);
  }
  cutWall(sd) { const r = this.wall.split((x, y, z, a, b) => sd(a, b)); this.wall = r.pos; return r; }
  cutCap(sd) { const r = this.cap.split((x, y, z, a, b) => sd(a, b)); this.cap = r.pos; return r; }
  wp(S, y, off = 0) { return this.L.wallAt(S, y, off); }
  wline(pts, off, n = 5) { const o = []; for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < n; k++) { const t = k / n; o.push(this.wp(lerp(pts[i][0], pts[i + 1][0], t), lerp(pts[i][1], pts[i + 1][1], t), off).slice(0, 3)); } const l = pts[pts.length - 1]; o.push(this.wp(l[0], l[1], off).slice(0, 3)); return o; }
  // flat ribbon along polyline on the wall (light strips)
  strip(pts, off, hw, st, n = 4, both = true) { const P = this.wline(pts, off, this.lod ? 1 : n), s = new Surf(); P.forEach((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], t = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(), N = new THREE.Vector3(p[0] * 0.3, 0.05, p[2] < 0 ? -1 : 1).normalize(); const w = this.wp(0, 0) && new THREE.Vector3().crossVectors(N, t).normalize(); s.v(p[0] + w.x * hw, p[1] + w.y * hw, p[2] + w.z * hw, N.x, N.y, N.z); s.v(p[0] - w.x * hw, p[1] - w.y * hw, p[2] - w.z * hw, N.x, N.y, N.z); if (i) { const k = i * 2; s.q(k - 2, k, k + 1, k - 1); s.q(k - 2, k - 1, k + 1, k); } }); both ? this.trim.both(s, st) : this.trim.add(s, st); }
  lamp(poly, r, { depth = 0.07, lens = 'lens', back = ST.housing, rimSt = ST.gloss } = {}) {
    const c = this.cutWall(sdRound(poly, r)), T = this.trim; const L = c.neg.clone().offset(-0.003);
    this[lens].append(L.both()); T.both(rim(c.edges, (e) => [-e[3] * depth, -e[4] * depth, -e[5] * depth], true), rimSt); T.both(c.neg.clone().offset(-depth), back); return c;
  }
  projector(S, y, off, R, { st = ST.head, big = false, zdir = -1 } = {}) {
    const p = this.wp(S, y, off), T = this.trim, seg = this.lod ? 8 : 18; void big;
    const bowl = lathe([[R * 0.34, -R * 0.7], [R * 0.62, -R * 0.5], [R * 0.85, -R * 0.15], [R, R * 0.1], [R * 1.06, R * 0.1]], seg).at(p[0], p[1], p[2], zdir < 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0); T.both(bowl, ST.bowl);
    T.both(sph(R * 0.6, seg, 6, 0, Math.PI * 2, 0, Math.PI / 2).at(p[0], p[1], p[2] - zdir * R * 0.45, zdir < 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0), st); T.both(torus(R * 0.64, R * 0.07, 5, seg).at(p[0], p[1], p[2] - zdir * R * 0.35), ST.satin);
  }
  reflectorBox(S, y, off, w, h, st, zdir = -1) { const p = this.wp(S, y, off); this.trim.both(rbox(w, h, 0.03, 0.008).at(p[0], p[1], p[2]), st); void zdir; }
  // recessed grille: poly in (S,y) half (mirrored over S=0)
  grille(poly, r, { depth = 0.06, bars = 5, vbars = 0, hex = false, st = ST.black, barSt = ST.black, frame = null, barR = 0.006 } = {}) {
    const half = poly; if (poly.some((p) => p[0] === 0)) { const up = poly.filter((p) => p[0] > 0); poly = [...up, ...up.slice().reverse().map((p) => [-p[0], p[1]])]; const ctr = half.filter((p) => p[0] === 0); if (ctr.length === 2) { const lo = ctr[0][1] < ctr[1][1] ? ctr[0] : ctr[1], hi = lo === ctr[0] ? ctr[1] : ctr[0]; const first = up[0], loFirst = Math.abs(first[1] - lo[1]) < Math.abs(first[1] - hi[1]); poly = [loFirst ? lo : hi, ...up, loFirst ? hi : lo, ...up.slice().reverse().map((p) => [-p[0], p[1]])]; } }
    const c = this.cutWall(sdRound(poly, r)), T = this.trim; T.both(rim(c.edges, (e) => [-e[3] * depth, -e[4] * depth, -e[5] * depth], true), st); T.both(c.neg.clone().offset(-depth), ST.dark);
    let y0 = 9, y1 = -9, s1 = 0; for (const p of poly) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); s1 = Math.max(s1, p[0]); } const sd = sdRound(poly, r), ext = (y) => { let s = 0; for (let x = 0; x <= s1; x += 0.01) if (sd(x, y) < 0) s = x; return s; };
    if (this.lod) bars = Math.min(bars, 3);
    if (bars && !hex) for (let k = 1; k <= bars; k++) { const y = lerp(y0, y1, k / (bars + 1)), e = ext(y); if (e > 0.02) T.both(tube(this.wline([[0, y], [e, y]], -depth * 0.35, 8), barR, 5, 8), barSt); }
    if (vbars) for (let k = 0; k <= vbars; k++) { const s = s1 * (k + 0.5) / (vbars + 1); let a = 9, b = -9; for (let y = y0; y <= y1; y += 0.01) if (sd(s, y) < 0) { a = Math.min(a, y); b = Math.max(b, y); } if (b > a) T.both(tube(this.wline([[s, a], [s, b]], -depth * 0.45, 4), barR * 0.9, 5, 4), barSt); }
    if (hex && !this.lod) { const g = hex === true ? 0.05 : hex; for (let j = 0, y = y0 + g * 0.4; y < y1; y += g * 0.5, j++) for (let s = (j % 2) * g * 0.5; s < s1; s += g) if (sd(s, y) < -0.004) { const p = this.wp(s, y, -depth * 0.5); for (const sx of s < 0.001 ? [1] : [1, -1]) { const b = box(g * 0.6, 0.006, 0.02).at(p[0] * sx, p[1], p[2], 0, 0, 0.55); const b2 = box(g * 0.6, 0.006, 0.02).at(p[0] * sx, p[1], p[2], 0, 0, -0.55); T.add(b, barSt).add(b2, barSt); } } }
    if (frame) { const pts = roundedPath(poly, r, true, 4).map((p) => p); const P = pts.map((p) => this.wp(p[0], p[1], 0.004).slice(0, 3)); const full = poly !== half; (full ? T.add(tube(P, frame.w || 0.011, 6, P.length * 2, true), frame.st || ST.chrome) : T.both(tube(P, frame.w || 0.011, 6, P.length * 2, true), frame.st || ST.chrome)); }
    return c;
  }
  // ----- greenhouse -----
  house() {
    const { C, trim: T } = this, H = C.house; H.yBase = H.yBase || ((f, x) => this.L.top(f, x) - 0.004); const G = (this.G = buildHouse(H, this.q)); this.atlas.setRect(2, 0, 0, G.aE, G.Hs + 1.2);
    // cap: remove what lies under the greenhouse
    const inner = G.basePoly.map((p) => [p[0], Math.max(0, p[1] - 0.012)]), poly = [...inner, ...inner.slice().reverse().map((p) => [p[0], -p[1] - 0.001])], sd = sdPoly(poly.filter((_, i) => i % 2 === 0)); this.cutCap((f, x) => sd(f, x));
    let body = G.s; const Hs = G.Hs, gl = (s, off = -0.006) => this.glass.append(s.clone().offset(off).both());
    const reveal = (edges, d = 0.016, st = ST.gloss) => T.both(rim(edges, (e) => [-e[3] * d, -e[4] * d, -e[5] * d], true), st);
    const reg = (a0, a1, k) => ({ m: (a, b) => [a, b * k], a0, a1, k });
    const W = C.win; const side = (p) => [G.aA + p[0] * (G.aC - G.aA), p[1] * Hs];
    // windshield
    if (W.ws) { const k = G.slantF, f = sdRound([[-(G.aA - W.ws.p0), W.ws.t0 * Hs * k], [G.aA - W.ws.p0, W.ws.t0 * Hs * k], [G.aA - W.ws.p1, W.ws.t1 * Hs * k], [-(G.aA - W.ws.p1), W.ws.t1 * Hs * k]], W.ws.r ?? 0.06); const c = body.split((x, y, z, a, b) => (a > G.aA + 0.1 ? 1 : f(a, b * k))); body = c.pos; reveal(c.edges, 0.008); const fr = c.neg.split((x, y, z, a, b) => f(a, b * k) + (b > Hs * 0.5 ? 0.045 : 0.03)); gl(fr.neg, -0.004); T.both(fr.pos.offset(-0.003), ST.gloss); this.wsF = f; void reg; }
    if (W.rw) { const k = G.slantR, E = G.aE, hA = G.aE - G.aC, f = sdRound([[-(hA - W.rw.p0), W.rw.t0 * Hs * k], [hA - W.rw.p0, W.rw.t0 * Hs * k], [hA - W.rw.p1, W.rw.t1 * Hs * k], [-(hA - W.rw.p1), W.rw.t1 * Hs * k]], W.rw.r ?? 0.06); const c = body.split((x, y, z, a, b) => (a < G.aC - 0.1 ? 1 : f(E - a, b * k))); body = c.pos; reveal(c.edges, 0.008); const fr = c.neg.split((x, y, z, a, b) => f(E - a, b * k) + 0.035); gl(fr.neg, -0.004); T.both(fr.pos.offset(-0.003), ST.gloss); }
    if (W.dlo) {
      const f = sdRound(W.dlo.map(side), W.dloR ?? 0.05), c = body.split((x, y, z, a, b) => (b > Hs * 1.02 ? 1 : f(a, b))); body = c.pos; reveal(c.edges, 0.012); let rest = c.neg;
      for (const w of W.side) { const g = sdRound(w.map(side), W.sideR ?? 0.035), r = rest.split((x, y, z, a, b) => g(a, b)); rest = r.pos; gl(r.neg); T.both(rim(r.edges, (e) => [-e[3] * 0.014, -e[4] * 0.014, -e[5] * 0.014], true), ST.rubber); }
      T.both(rest.offset(-0.004), ST.gloss);
      if (W.chrome) { const P = roundedPath(W.dlo.map(side), W.dloR ?? 0.05, true, 5).map((p) => G.at(p[0], p[1], 0.002).slice(0, 3)); T.both(tube(P, 0.0065, 5, P.length * 2, true), W.chrome === true ? ST.satin : W.chrome); }
    }
    this.houseS = body;
    // weatherstrip where the greenhouse meets the body
    { const st = this.lod ? 14 : 5, P = []; for (let i = 0; i < G.basePoly.length; i += st) { const p = G.basePoly[i]; P.push([p[1], this.C.house.yBase(p[0], p[1]) + 0.006, -p[0]]); } T.both(tube(P, 0.011, 6, P.length * 2), ST.rubber); }
    // head liner / inner pillars
    T.both(body.clone().offset(-0.028).flip(), ST.liner);
  }
  innerShell(f0, f1, yMin = 0.3, st = ST.dash) { // inside of doors seen through glass
    const w = this.wall.split((x, y, z) => Math.max(-z - f0, f1 + z, yMin - y)).neg; if (w.count) this.trim.both(w.offset(-0.045).flip(), st);
    const c = this.cap.split((x, y, z) => Math.max(-z - f0, f1 + z)).neg; if (c.count) this.trim.both(c.offset(-0.02).flip(), st);
  }
  finish() { this.paint.wall.append(this.wall.both()); this.paint.cap.append(this.cap.both()); if (this.houseS) this.paint.house.append(this.houseS.both()); }
  door(f0, f1, o = {}) { // shut lines on wall + continuing up the greenhouse frame. f0 front edge, f1 rear edge
    const L = this.L, a = this.atlas, y0 = o.y0 ?? 0.27, s0 = L.sOf(f0), s1 = L.sOf(f1), yT = 1.6, pts = []; void yT;
    pts.push([s0 + (o.lean0 ?? 0.02), 1.75], [s0 + (o.lean0 ?? 0.02) * 0.5, 0.75], [s0, y0 + 0.12], [s0 + 0.06, y0], [s1 - (o.cut ? 0.28 : 0.06), y0], [s1 - (o.cut ? 0.1 : 0), y0 + (o.cut ? 0.22 : 0.12)], [s1 + (o.lean1 ?? 0.02) * 0.5, 0.75], [s1 + (o.lean1 ?? 0.02), 1.75]); a.line(0, roundedPath(pts, 0.06, false, 6));
  }
  handle(f, y, { st = ST.paint, flip = 1 } = {}) {
    const S = this.L.sOf(f), p = this.wp(S, y, 0.0), q = this.wp(S + 0.2 * flip, y, 0.0), T = this.trim; const ang = Math.atan2(q[0] - p[0], (q[2] - p[2])) ; const cup = rbox(0.012, 0.05, 0.17, 0.005).at(p[0] - 0.004, p[1] + 0.004, p[2] + 0.1 * flip, 0, ang, 0); T.both(cup, ST.dark);
    if (this.lod) return; const h = tube([[p[0] + 0.004, p[1], p[2]], [p[0] + 0.034, p[1] + 0.003, p[2] + 0.035 * flip], [(p[0] + q[0]) / 2 + 0.038, p[1] + 0.004, p[2] + 0.1 * flip], [q[0] + 0.034, p[1] + 0.003, p[2] + 0.17 * flip], [q[0] + 0.004, p[1], p[2] + 0.205 * flip]], 0.0115, 7, 16).map((o) => { o[1] = p[1] + (o[1] - p[1]) * 1.15; }); T.both(h, st);
  }
  mirror(f, y, x, o = {}) {
    const s = o.s ?? 1, T = this.trim; const R0 = 0.11 * s, pw = (v, e) => Math.sign(v) * Math.pow(Math.abs(v) / R0, e) * R0; const m = sph(R0, this.lod ? 8 : 20, this.lod ? 6 : 14).map((p) => { const bz = p[2] > 0; p[0] = pw(p[0], 0.62); p[1] = pw(p[1], 0.62) * (0.6 + p[0] * 1.0); p[2] = bz ? pw(p[2], 0.5) * 0.3 : p[2] * 0.72; }).normals(); m.at(x + 0.15 * s, y, -f, 0, 0.12, 0); T.both(m, o.st || ST.paint);
    T.both(rbox(0.175 * s, 0.1 * s, 0.006, 0.003).at(x + 0.15 * s, y, -f + 0.032 * s, 0, 0.12, 0), { c: 0x8fa2ad, r: 0.03, m: 1, d: 3 }); T.both(tube([[x - 0.03, y - 0.075 * s, -f + 0.01], [x + 0.04, y - 0.06 * s, -f - 0.01], [x + 0.11 * s, y - 0.03 * s, -f]], 0.019 * s, 7, 8), ST.gloss);
    T.both(rbox(0.07 * s, 0.012, 0.012, 0.004).at(x + 0.19 * s, y + 0.005, -f - 0.066 * s, 0, -0.25, 0), ST.amber);
  }
  wipers(f, y, spread = 0.62, len = 0.56, rake = 0.5) { this.anim.wipers = { f, y, spread, len, rake }; }
  plateAt(f, y, rot = 0, tilt = 0) { this.trim.add(rbox(0.325, 0.17, 0.012, 0.004).at(0, y, -f, tilt, 0, 0), ST.black); this.decals.push({ kind: 'plate', x: 0, y, z: -f + (rot ? 0.0085 : -0.0085), ry: rot ? 0 : Math.PI, rx: rot ? tilt : -tilt, w: 0.305, h: 0.152 }); }
  exhaust(x, y, f, r = 0.034, st = ST.chrome) { this.trim.add(lathe([[r * 0.82, -0.1], [r * 0.82, 0.06], [r, 0.07], [r, -0.1]], 16).at(x, y, -f, Math.PI / 2, 0, 0), st); this.trim.add(cyl(r * 0.8, r * 0.8, 0.01, 12).at(x, y, -f - 0.03, Math.PI / 2, 0, 0), ST.dark); }
  // ----- interior -----
  seat(x, f, y, o = {}) {
    if (this.lod) return; const T = this.trim, s = o.w ?? 0.5, z = -f, sg = 3; const back = -0.3;
    T.add(rbox(s, 0.15, 0.5, 0.06, 2).map((p) => { if (Math.abs(p[0]) > s * 0.32 && p[1] > 0) p[1] += 0.03; if (p[2] < -0.1) p[1] += 0.025; }).normals().at(x, y, z, 0.08, 0, 0), ST.seat); void sg;
    T.add(rbox(s, 0.62, 0.14, 0.06, 2).map((p) => { if (Math.abs(p[0]) > s * 0.32) { p[2] -= 0.04; } if (p[1] > 0.1) p[0] *= 1 - (p[1] - 0.1) * 0.5; if (p[1] < 0 && p[1] > -0.2) p[2] -= 0.015; }).normals().at(x, y + 0.36, z + 0.27, back, 0, 0), ST.seat);
    T.add(rbox(s * 0.6, 0.5, 0.02, 0.01).at(x, y + 0.36, z + 0.2, back, 0, 0), ST.seat2); T.add(rbox(s * 0.58, 0.02, 0.36, 0.01).at(x, y + 0.078, z - 0.02, 0.08, 0, 0), ST.seat2);
    T.add(rbox(0.27, 0.17, 0.1, 0.045, 2).at(x, y + 0.79, z + 0.385, back, 0, 0), ST.seat); for (const k of [-1, 1]) T.add(pipe([x + k * 0.06, y + 0.62, z + 0.345], [x + k * 0.06, y + 0.76, z + 0.385], 0.006, 6), ST.satinIn); T.add(box(s * 0.8, 0.2, 0.44).at(x, y - 0.16, z + 0.02), ST.carpet);
  }
  interior(o) { // o: {f (dash front face), y (dash top), w half width, floor, seatF, seatY, seatX, rear, wheel:[x,y,f,tilt]}
    const T = this.trim, w = o.w, z = -o.f; T.add(box(w * 2, 0.03, o.fr ? o.f + 0.45 - o.fr : 2.4).at(0, o.floor, o.fr ? -(o.f + 0.45 + o.fr) / 2 : z + 0.9), ST.carpet); T.add(box(w * 2 - 0.02, o.y - o.floor, 0.04).at(0, (o.y + o.floor) / 2 - 0.02, z - 0.42), ST.dark);
    if (this.lod) { T.add(box(w * 2, 0.2, 0.5).at(0, o.y - 0.12, z - 0.2), ST.dash); for (const sx of [-1, 1]) T.add(rbox(0.5, 0.7, 0.2, 0.05).at(o.seatX * sx, o.seatY + 0.3, -o.seatF + 0.25, -0.25, 0, 0), ST.seat); return; }
    // dash: swept section
    const sec = [[0.0, -0.36], [0.02, -0.2], [0.02, -0.05], [-0.04, -0.005], [-0.14, 0.012], [-0.3, -0.005], [-0.55, -0.05], [-0.55, -0.36]]; // [z rel, y rel]
    const hb = this.C.house.base, lim = (x) => lerp(hb.fc, hb.f0, Math.min(1, (x / hb.x0) ** 2)) - 0.05, n = 22; const g = Surf.grid(n, sec.length, (u, v) => { const x = lerp(-w, w, u / (n - 1)), c = sec[v], bw = Math.abs(x) / w, drv = Math.exp(-(((x + o.seatX) / 0.2) ** 2)); const zz = Math.max(z + c[0] + (v < 5 ? bw * bw * 0.05 : 0) + (v < 3 ? drv * -0.02 : 0), -lim(x)); let yy = o.y + c[1] + (v >= 2 && v <= 4 ? drv * 0.035 : 0); const out = this.G.basePoly.some((p, i, P) => i && (P[i - 1][0] + zz) * (p[0] + zz) <= 0 && Math.abs(x) > Math.min(p[1], P[i - 1][1]) - 0.06 && p[1] > 0.3); yy = Math.min(yy, this.L.top(-zz, x) + (out || zz < -hb.f0 ? -0.02 : 0.05)); return [x, yy, zz, 0, 0]; }, false); T.add(g, ST.dash);
    T.add(rbox(w * 1.9, 0.012, 0.012, 0.004).at(0, o.y - 0.115, z + 0.028), ST.satinIn); T.add(rbox(w * 1.2, 0.09, 0.02, 0.01).at(o.seatX * 0.72, o.y - 0.18, z + 0.03), ST.dash2);
    // centre stack + tunnel
    T.add(rbox(0.3, 0.34, 0.1, 0.03, 2).at(0, o.y - 0.26, z + 0.02, -0.25, 0, 0), ST.dash2); this.screen = { x: 0, y: o.y - 0.02, z: z + 0.075, w: 0.27, h: 0.155, rx: -0.22 }; T.add(rbox(0.295, 0.18, 0.018, 0.008).at(0, o.y - 0.02, z + 0.062, -0.22, 0, 0), ST.gloss);
    for (let k = -2; k <= 2; k++) T.add(cyl(0.014, 0.012, 0.02, 10).at(k * 0.05, o.y - 0.235, z + 0.085, Math.PI / 2 - 0.25, 0, 0), ST.satinIn); for (const sx of [-1, 1]) for (const v of [0.36, 0.84]) { T.add(rbox(0.13, 0.07, 0.02, 0.01).at(sx * w * v, o.y - 0.06, z + 0.03), ST.gloss); for (let k = 0; k < 3; k++) T.add(box(0.11, 0.004, 0.012).at(sx * w * v, o.y - 0.08 + k * 0.02, z + 0.042), ST.dash2); }
    T.add(rbox(0.24, 0.16, 1.0, 0.04, 2).at(0, o.floor + 0.17, z + 0.62), ST.dash2); T.add(rbox(0.22, 0.14, 0.4, 0.04, 2).at(0, o.floor + 0.28, z + 0.95), ST.seat); T.add(rbox(0.05, 0.1, 0.07, 0.02, 2).at(0.0, o.floor + 0.32, z + 0.45, 0.2, 0, 0), ST.gloss);
    // cluster hood + cluster
    this.cluster = { x: -o.seatX, y: o.y + 0.0, z: z + 0.035, w: 0.3, h: 0.1, rx: -0.2 };
    T.add(rbox(0.34, 0.14, 0.03, 0.02, 2).at(-o.seatX, o.y - 0.005, z + 0.012, -0.2, 0, 0), ST.gloss); T.add(rbox(0.38, 0.018, 0.14, 0.009).at(-o.seatX, o.y + 0.075, z + 0.0, 0.05, 0, 0), ST.dash);
    this.anim.steer = { x: -o.seatX, y: o.y - 0.085, z: z + 0.22, tilt: -0.42 }; T.add(pipe([-o.seatX, o.y - 0.1, z + 0.18], [-o.seatX, o.y - 0.2, z - 0.1], 0.045, 10), ST.dash);
    // seats
    for (const sx of [-1, 1]) this.seat(o.seatX * sx, o.seatF, o.seatY); if (o.rearF !== undefined) { const bw = o.rearW ?? w * 1.6; T.add(rbox(bw, 0.16, 0.5, 0.06, 2).at(0, o.seatY, -o.rearF), ST.seat); T.add(rbox(bw, 0.52, 0.16, 0.06, 2).map((p) => { if (p[1] > 0) p[0] *= 0.9; }).at(0, o.seatY + 0.3, -o.rearF + 0.28, -0.32, 0, 0), ST.seat); for (const sx of [-1, 1]) T.add(rbox(0.26, 0.16, 0.1, 0.04, 2).at(sx * o.seatX, o.seatY + 0.7, -o.rearF + 0.42, -0.3, 0, 0), ST.seat); }
    // laptop on a mount, radio, coiled mic
    const lx = 0.2, ly = o.y - 0.12, lz = z + 0.32; T.add(pipe([0.14, o.floor + 0.1, lz + 0.08], [lx, ly - 0.02, lz], 0.014, 8), ST.gun); T.add(rbox(0.33, 0.016, 0.22, 0.006).at(lx, ly, lz, 0.12, -0.35, 0), ST.powder); T.add(rbox(0.28, 0.004, 0.1, 0.002).at(lx + 0.01, ly + 0.011, lz - 0.03, 0.12, -0.35, 0), ST.dark); T.add(rbox(0.33, 0.215, 0.012, 0.006).at(lx - 0.035, ly + 0.115, lz - 0.125, -0.22, -0.35, 0), ST.powder); this.laptop = { x: lx - 0.032, y: ly + 0.118, z: lz - 0.1165, w: 0.3, h: 0.185, rx: -0.22, ry: -0.35 };
    T.add(rbox(0.17, 0.05, 0.14, 0.008).at(0, o.y - 0.31, z + 0.08, -0.3, 0, 0), ST.powder); T.add(rbox(0.07, 0.022, 0.005, 0.002).at(-0.03, o.y - 0.305, z + 0.155, -0.3, 0, 0), ST.screen); T.add(cyl(0.012, 0.012, 0.02, 10).at(0.055, o.y - 0.305, z + 0.16, 1.27, 0, 0), ST.satinIn);
    const coil = []; for (let k = 0; k <= 60; k++) { const t = k / 60; coil.push([0.12 + Math.cos(k * 1.4) * 0.012 + t * 0.05, o.y - 0.33 - Math.sin(t * Math.PI) * 0.12, z + 0.15 + Math.sin(k * 1.4) * 0.012]); } T.add(tube(coil, 0.003, 4, 90), ST.rubber); T.add(rbox(0.045, 0.065, 0.03, 0.01).at(0.17, o.y - 0.31, z + 0.15), ST.black);
    // rear view mirror, sun visors, pedals
    if (o.rvm) { T.add(rbox(0.23, 0.065, 0.022, 0.012).at(0, o.rvm[1], -o.rvm[0], 0, 0.15, 0), ST.gloss); T.add(rbox(0.215, 0.052, 0.004, 0.002).at(0.002, o.rvm[1], -o.rvm[0] + 0.0125, 0, 0.15, 0), { c: 0x97a5ad, r: 0.03, m: 1, d: 3 }); T.add(pipe([0, o.rvm[1], -o.rvm[0] - 0.01], [0, o.rvm[1] + 0.06, -o.rvm[0] - 0.07], 0.008, 6), ST.gloss); T.add(rbox(0.06, 0.035, 0.07, 0.01).at(0.12, o.rvm[1] + 0.01, -o.rvm[0] - 0.05), ST.black); T.add(cyl(0.012, 0.012, 0.02, 10).at(0.12, o.rvm[1] + 0.01, -o.rvm[0] - 0.09, Math.PI / 2, 0, 0), ST.gloss); }
    for (const [dx, hh] of [[0.06, 0.1], [0.17, 0.12]]) T.add(rbox(0.05, hh, 0.012, 0.004).at(-o.seatX + dx - 0.02, o.floor + 0.14, z - 0.2, 0.7, 0, 0), ST.gun);
    // grab handles & door armrests
    for (const sx of [-1, 1]) { T.add(rbox(0.07, 0.06, 0.5, 0.02, 2).at(sx * (w - 0.03), o.seatY + 0.17, -o.seatF - 0.1), ST.dash2); T.add(rbox(0.03, 0.24, 0.75, 0.02).at(sx * (w + 0.01), o.seatY + 0.24, -o.seatF - 0.05), ST.seat2); }
  }
  // ----- equipment -----
  lightBar(y, f, w, n, o = {}) { const T = this.trim; T.add(rbox(w, 0.075, 0.07, 0.015).at(0, y, -f), ST.powder); for (let k = 0; k < n; k++) { const x = lerp(-w / 2 + 0.05, w / 2 - 0.05, k / (n - 1)); if (!this.lod) { T.add(lathe([[0.006, -0.02], [0.02, -0.014], [0.031, 0.004]], 12).at(x, y, -f - 0.034, -Math.PI / 2, 0, 0), ST.bowl); } T.add(cyl(0.013, 0.013, 0.012, 8).at(x, y, -f - 0.03, Math.PI / 2, 0, 0), ST.bar); } for (const sx of [-1, 1]) T.add(rbox(0.02, 0.09, 0.05, 0.005).at(sx * w * 0.46, y - 0.07, -f), ST.powder); this.lens.append(rbox(w * 0.98, 0.062, 0.004, 0.001).at(0, y, -f - 0.037)); void o; }
  beacon(x, y, f, e = ST.barA) { const T = this.trim; T.add(cyl(0.062, 0.055, 0.025, 14).at(x, y, -f), ST.black); T.add(lathe([[0.0, 0.085], [0.03, 0.08], [0.05, 0.055], [0.052, 0]], 14).at(x, y + 0.01, -f), e); }
  antenna(x, y, f, h, r = 0.003, base = true) { if (base) this.trim.add(lathe([[0.0, 0.06], [0.012, 0.055], [0.016, 0.02], [0.03, 0.006], [0.03, 0]], 10).at(x, y, -f), ST.black); (this.anim.whips || (this.anim.whips = [])).push({ x, y: y + 0.05, z: -f, h, r }); }
  anemometer(x, y, f, h = 0.5) { const T = this.trim; T.add(pipe([x, y, -f], [x, y + h, -f], 0.011, 8), ST.alu); T.add(cyl(0.02, 0.016, 0.05, 10).at(x, y + h + 0.02, -f), ST.powder); this.anim.anemo = { x, y: y + h + 0.055, z: -f }; T.add(pipe([x, y + h * 0.7, -f], [x + 0.14, y + h * 0.7, -f], 0.007, 6), ST.alu); this.anim.vane = { x: x + 0.14, y: y + h * 0.7, z: -f }; T.add(cyl(0.028, 0.028, 0.08, 10).at(x - 0.0, y + h * 0.45, -f), { c: 0xe8e8e4, r: 0.5, m: 0 }); }
  rack(y, f0, f1, w, o = {}) { const T = this.trim, n = o.n ?? 5, r = 0.016; for (const sx of [-1, 1]) { T.add(tube([[sx * w, y - 0.07, -f0 - 0.03], [sx * w, y, -f0 + 0.05], [sx * w, y + 0.0, -(f0 + f1) / 2], [sx * w, y, -f1 - 0.05], [sx * w, y - 0.07, -f1 + 0.03]], r, 7, 24), ST.powder); for (const f of [f0 - 0.1, (f0 + f1) / 2, f1 + 0.1]) T.add(rbox(0.03, 0.09, 0.07, 0.008).at(sx * w, y - 0.045, -f), ST.powder); if (o.rail) T.add(tube([[sx * w, y + 0.0, -f0 + 0.04], [sx * w, y + o.rail, -f0 + 0.1], [sx * w, y + o.rail, -f1 - 0.1], [sx * w, y, -f1 - 0.04]], r * 0.85, 6, 16), ST.powder); } for (let k = 0; k < n; k++) { const f = lerp(f0 - 0.08, f1 + 0.08, k / (n - 1)); T.add(rbox(w * 2, 0.022, 0.045, 0.008).at(0, y + 0.004, -f), ST.powder); } if (o.rail) for (const f of [f0 - 0.1, f1 + 0.1]) T.add(pipe([-w, y + o.rail, -f], [w, y + o.rail, -f], r * 0.85, 6), ST.powder); }
  caseBox(x, y, f, w, h, d, c = 0x1d1f20, latch = true) { const T = this.trim; T.add(rbox(w, h, d, 0.02, this.lod ? 1 : 2).at(x, y + h / 2, -f), { c, r: 0.6, m: 0 }); T.add(rbox(w * 1.01, 0.018, d * 1.01, 0.005).at(x, y + h * 0.68, -f), { c: 0x0a0a0a, r: 0.6, m: 0 }); if (this.lod) return; for (const k of [-0.32, 0.32]) { for (const g of [-1, 1]) T.add(rbox(0.05, 0.06, 0.014, 0.004).at(x + k * w, y + h * 0.62, -f + g * d / 2), ST.gun); for (const g of [-1, 1]) T.add(rbox(0.025, h * 0.9, 0.02, 0.006).at(x + k * w * 1.35, y + h / 2, -f + g * d / 2), { c, r: 0.6, m: 0 }); } if (latch) T.add(tube([[x - 0.07, y + h * 0.5, -f - d / 2 - 0.005], [x - 0.06, y + h * 0.5, -f - d / 2 - 0.03], [x + 0.06, y + h * 0.5, -f - d / 2 - 0.03], [x + 0.07, y + h * 0.5, -f - d / 2 - 0.005]], 0.007, 6, 10), ST.black); }
  probe(x, y, f, s = 1) { const T = this.trim; T.add(lathe([[0.0, 0.2], [0.05, 0.19], [0.1, 0.13], [0.16, 0.06], [0.2, 0.0], [0.21, -0.015], [0, -0.015]].map((p) => [p[0] * s, p[1] * s]), 20).at(x, y, -f), { c: 0xc8741a, r: 0.45, m: 0.1 }); T.add(torus(0.175 * s, 0.012 * s, 6, 20).at(x, y + 0.05 * s, -f, Math.PI / 2, 0, 0), ST.powder); T.add(cyl(0.02 * s, 0.015 * s, 0.1 * s, 8).at(x, y + 0.24 * s, -f), ST.alu); }
  // wire guard floating over the greenhouse glass between params (a fraction along side or explicit a), b fractions
  guard(a0, a1, b0, b1, off, na, nb, o = {}) { const G = this.G, T = this.trim, H = G.Hs, P = (a, b) => G.at(a, b * H, off).slice(0, 3), r = o.r ?? 0.012, ad = (s) => (o.center ? T.add(s, ST.powder) : T.both(s, ST.powder)); const ring = [P(a0, b0), P((a0 + a1) / 2, b0), P(a1, b0), P(a1, (b0 + b1) / 2), P(a1, b1), P((a0 + a1) / 2, b1), P(a0, b1), P(a0, (b0 + b1) / 2)]; ad(tube(ring, r, 6, 32, true)); if (this.lod) return; for (let k = 1; k < na; k++) { const a = lerp(a0, a1, k / na); ad(tube([P(a, b0), P(a, (b0 + b1) / 2), P(a, b1)], 0.0032, 4, 4)); } for (let k = 1; k < nb; k++) { const b = lerp(b0, b1, k / nb); ad(tube([P(a0, b), P((a0 + a1) / 2, b), P(a1, b)], 0.0032, 4, 6)); } for (const [a, b] of [[a0, b0], [a1, b0], [a0, b1], [a1, b1]]) { const p = G.at(a, b * H, 0), q = P(a, b); ad(pipe(p.slice(0, 3), q, 0.01, 5)); } }
  hailCage(paths, r = 0.011) { for (const p of paths) this.trim.both(tube(p, r, 6, p.length * 4), ST.powder); }
  mesh(x0, x1, y, z0, z1, n, m, r = 0.004) { if (this.lod) return; for (let k = 0; k <= n; k++) { const x = lerp(x0, x1, k / n); this.trim.add(pipe([x, y, z0], [x, y, z1], r, 4), ST.powder); } for (let k = 0; k <= m; k++) { const z = lerp(z0, z1, k / m); this.trim.add(pipe([x0, y, z], [x1, y, z], r, 4), ST.powder); } }
}

// ---------- wheels ----------
// W:{R,w,rim (radius),style,spokes,color,blocks,dual}
export function buildWheel(spec, W, lod) { // axle along x, outer face +x
  const T = new Trim(), R = spec.R, w = spec.wheelW, rr = W.rim, hw = w / 2, seg = lod ? 18 : 36, flat = W.flat ?? 0.78;
  const tw = hw * flat, side = R - rr, prof = [[rr - 0.012, -hw * 0.78], [rr + 0.004, -hw * 0.86], [rr + side * 0.25, -hw * 0.985], [rr + side * 0.5, -hw], [rr + side * 0.78, -hw * 0.95], [R - 0.022, -hw * 0.87], [R - 0.009, -tw], [R - 0.008, 0], [R - 0.009, tw], [R - 0.022, hw * 0.87], [rr + side * 0.78, hw * 0.95], [rr + side * 0.5, hw], [rr + side * 0.25, hw * 0.985], [rr + 0.004, hw * 0.86], [rr - 0.012, hw * 0.78]];
  T.add(lathe(prof, seg).at(0, 0, 0, 0, 0, -Math.PI / 2), ST.tyre);
  if (!lod) { // tread blocks
    const nB = W.blocks || 36, at = W.at, ribs = 4, s = new Surf(); const bd = at ? 0.014 : 0.0095;
    for (let k = 0; k < nB; k++) for (let j = 0; j < ribs; j++) {
      const c0 = lerp(-tw * 1.06, tw * 1.06, j / ribs) + (at ? 0.007 : 0.0045), c1 = lerp(-tw * 1.06, tw * 1.06, (j + 1) / ribs) - (at ? 0.007 : 0.0045), off = (j % 2 ? 0.5 : 0) + (at ? 0.12 * (j - 1.5) : 0), gap = at ? 0.66 : 0.82, a0 = (k + off) / nB * Math.PI * 2, a1 = a0 + gap / nB * Math.PI * 2, sk = (at ? 0.16 : 0.1) / nB * Math.PI * 2 * (j < ribs / 2 ? 1 : -1), edge = j === 0 || j === ribs - 1;
      const r0 = R - 0.016, r1 = R - 0.009 + bd * (at ? 0.65 : 0.3), v = (r, x, a) => [x, Math.cos(a) * r, Math.sin(a) * r], rT = (x) => r1 - (edge && Math.abs(x) > tw * 0.9 ? 0.008 : 0), P = [[c0, a0], [c1, a0 + sk], [c1, a1 + sk], [c0, a1]], it = [], ib = []; for (const [x, a] of P) { it.push(s.v(...v(rT(x), x, a), 0, Math.cos(a), Math.sin(a))); }
      s.q(it[0], it[1], it[2], it[3]); for (let e = 0; e < 4; e++) { const A = P[e], B = P[(e + 1) % 4], m = (A[1] + B[1]) / 2, n = e % 2 === 0 ? [0, e === 0 ? Math.sin(m) : -Math.sin(m), e === 0 ? -Math.cos(m) : Math.cos(m)] : [e === 1 ? 1 : -1, 0, 0]; const q0 = s.v(...v(rT(A[0]), A[0], A[1]), ...n), q1 = s.v(...v(rT(B[0]), B[0], B[1]), ...n), q2 = s.v(...v(r0, B[0], B[1]), ...n), q3 = s.v(...v(r0, A[0], A[1]), ...n); s.q(q0, q3, q2, q1); } void ib;
    }
    T.add(s, ST.tyre); for (const sx of [1]) T.add(torus(rr + side * 0.62, 0.0035, 4, 40).at(sx * hw * 0.975, 0, 0, 0, Math.PI / 2, 0), ST.tyre);
  }
  const rim1 = { c: W.color ?? 0x8f9296, r: W.rough ?? 0.3, m: W.metal ?? 0.95 }, lip = W.lip ? { c: W.lip, r: 0.2, m: 1 } : rim1;
  // barrel
  T.add(lathe([[rr + 0.006, hw * 0.86], [rr + 0.004, hw * 0.8], [rr - 0.012, hw * 0.74], [rr - 0.022, hw * 0.5], [rr - 0.03, -hw * 0.2], [rr - 0.02, -hw * 0.8], [rr + 0.004, -hw * 0.85]], seg).flip().at(0, 0, 0, 0, 0, -Math.PI / 2).flip(), lip);
  T.add(lathe([[rr - 0.032, -hw * 0.8], [rr - 0.04, 0.0], [rr - 0.024, hw * 0.55]], seg).flip().at(0, 0, 0, 0, 0, -Math.PI / 2), ST.gun);
  // face with windows
  const N = W.spokes || 5, off = W.offset ?? hw * 0.52, dish = W.dish ?? 0.05, hub = W.hub ?? 0.075, nr = lod ? 4 : 7, nt = lod ? N * 6 : N * (W.nt ?? 16), rO = rr - 0.012; const surf = (r) => { const t = clamp((r - hub) / (rO - hub)); return off + dish * (Math.pow(t, W.pow ?? 1.6)) - (W.conv ?? 0) * Math.sin(Math.PI * t); };
  const face = Surf.grid(nt + 1, nr + 1, (u, v) => { const a = u / nt * Math.PI * 2, r = lerp(hub * 0.55, rO, v / nr); return [surf(r), Math.cos(a) * r, Math.sin(a) * r, a, r]; }, true);
  for (let v = 0; v <= nr; v++) for (let c = 0; c < 3; c++) face.n[(nt * (nr + 1) + v) * 3 + c] = face.n[v * 3 + c] = (face.n[v * 3 + c] + face.n[(nt * (nr + 1) + v) * 3 + c]) / 2;
  const hole = (a, r) => W.hole ? W.hole(a, r, N, hub, rO) : (() => { const st = Math.PI * 2 / N, d = Math.abs(((a % st) + st) % st - st / 2) * r; const wS = lerp(W.s0 ?? 0.034, W.s1 ?? 0.026, clamp((r - hub) / (rO - hub))); const half = st / 2 * r - wS; return Math.max(d - half, (hub + (W.hubPad ?? 0.02)) - r, r - (rO - (W.lipW ?? 0.016))) + 0; })();
  const rnd = 0.0; const c = face.split((x, y, z, a, r) => { const t = hole(a, r); return -(t + rnd); }); const keep = c.neg; // keep where hole>0
  if (keep.n.length) T.add(keep, { ...rim1 }); const cen = (e) => { const r = Math.hypot(e[1], e[2]); return r; }; void cen;
  if (!lod) { T.add(rim(c.edges, () => [-(W.thick ?? 0.032), 0, 0], true), { ...rim1, r: rim1.r + 0.12 }); T.add(keep.clone().move(-(W.thick ?? 0.032), 0, 0).flip(), ST.gun); }
  // hub cap & lugs
  T.add(lathe([[0.0, 0.012], [hub * 0.36, 0.011], [hub * 0.4, 0.0], [hub * 0.6, -0.004]], lod ? 8 : 20).at(surf(hub * 0.5) + 0.002, 0, 0, 0, 0, -Math.PI / 2), W.cap || ST.gun); if (!lod) for (let k = 0; k < (W.lugs ?? 5); k++) { const a = (k + 0.5) / (W.lugs ?? 5) * Math.PI * 2; T.add(cyl(0.009, 0.008, 0.02, 6).at(surf(hub * 0.8) + 0.002, Math.cos(a) * hub * 0.76, Math.sin(a) * hub * 0.76, 0, 0, -Math.PI / 2), ST.chrome); }
  if (!lod && !W.noDisc) { const dr = rr * (W.disc ?? 0.78); T.add(lathe([[hub * 0.7, 0.012], [dr, 0.012], [dr, -0.012], [hub * 0.7, -0.012]], 30).at(off - 0.07, 0, 0, 0, 0, -Math.PI / 2), ST.disc); T.add(cyl(hub * 1.02, hub * 0.95, 0.06, 18).at(off - 0.05, 0, 0, 0, 0, -Math.PI / 2), ST.iron); }
  if (W.dual) { const t2 = new Trim(); void t2; T.add(lathe(prof, lod ? 14 : 28).at(-w - 0.03, 0, 0, 0, 0, -Math.PI / 2), ST.tyre); }
  return T;
}
export function buildCaliper(spec, W) { const T = new Trim(), rr = W.rim * (W.disc ?? 0.78), off = (W.offset ?? spec.wheelW / 2 * 0.52) - 0.07; T.add(rbox(0.075, 0.075, 0.19, 0.02).map((p) => { const a = p[2] / rr; p[1] -= rr * (1 - Math.cos(a)); }).at(off, rr - 0.02, 0).at(0, 0, 0, 0.9, 0, 0), { c: W.caliper ?? 0x2c2d2f, r: 0.45, m: 0.5 }); return T; }
export { hexa, box, cyl, sph, torus, tube, pipe, lathe, extrude, rbox, Surf, Trim, roundedPath };

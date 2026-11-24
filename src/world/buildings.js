// CITIES renderer: towns & cities as merged, procedurally varied meshes per scatter sector.
// Placement/colliders/damage/net state stay in scatter (items with KIND.ext); this module discovers those items through
// scatter.surfaceItems, builds one "main" mesh (buildings, cars, pavement) + one "detail" mesh (street furniture, faded
// by distance) + one "sign" mesh per sector (time-sliced on the main thread), and rebuilds when an item's damage state
// changes (0 intact, 1 roofless / blown-out, 2 rubble). Everything is procedural: no external assets.
import * as THREE from 'three';
import { KIND, KI, STRIDE } from './kinds.js';
import { BL } from './textures.js';
import { variantOf, driveX, PAVE } from './citygen.js';
import { hash2 } from '../core/rng.js';

// ---------------------------------------------------------------- palettes
const C = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const PAL = {
  sid: [0xf2efe6, 0xe9e2cf, 0xd9d6cc, 0xc9cfc8, 0xbfcbd2, 0xe8dcb2, 0xc6b89a, 0x9fae9a, 0xa9b9c6, 0xd8c7a7, 0xb8b2a6, 0x8f9fa8, 0xefe9d8, 0xc2a28a].map(C),
  brk: [0x9a4a36, 0x8a3d2c, 0xa86048, 0x7a4a3a, 0xb8946a, 0xc9b08a, 0x8e5a44, 0x6e3a2e, 0xa0a0a0, 0xd8cfb8].map(C),
  roof: [0x4a4744, 0x3a3836, 0x5a4a3e, 0x2e3032, 0x6a5a4c, 0x55504a, 0x4a3a34, 0x3c4a3e, 0x61615f, 0x7a4a3a].map(C),
  acc: [0x2f4a36, 0x23324a, 0x1e1e1e, 0x7a2420, 0xf2f0ea, 0x5a3a24, 0x3a5a6a, 0x6a6a2a].map(C),
  awn: [0x8a1f1f, 0x1f5a2e, 0x1f2f6a, 0x6a1f3a, 0xc8a030, 0x2a6a6a, 0x3a3a3a, 0xa04a1a].map(C),
  stuc: [0xe8e0cc, 0xd8c8a8, 0xf0ece2, 0xc8b898, 0xb8b0a0, 0xe0d0b8].map(C),
  conc: [0xc8c4ba, 0xb0aca4, 0xd8d2c4, 0x9c9890, 0xc4b49a, 0xe0ddd4].map(C),
  glass: [0x6a8aa8, 0x5a8a8a, 0x8a7a60, 0x9aa6b0, 0x4a5a6a, 0x7a9ab8, 0x6a7a7a].map(C),
  metal: [0xc0c4c8, 0x9aa4ac, 0xd0ccc0, 0x7a8a9a, 0xa8a8a0, 0x6a7a6a, 0xb8b0a0].map(C),
  car: [0xeeeeee, 0xb8bcc0, 0x1a1a1c, 0x8a1a1a, 0x1a3a7a, 0x5a5c60, 0x1e3a2a, 0xc8b898, 0x3a2a1a, 0xd0d4d8, 0x7a7c80, 0x2a2a3a].map(C),
};
const pk = (a, s) => a[Math.floor(s * a.length) % a.length];
function palette(name, seed) {
  const h = (k) => hash2(Math.floor(seed * 1e6), k, 77), v = variantOf(name, seed);
  switch (name) {
    case 'house_ranch': case 'house_2st': case 'bungalow': case 'duplex': { const brick = (name === 'house_ranch' && v >= 4) || (name === 'duplex' && v === 1); return [brick ? pk(PAL.brk, h(1)) : pk(PAL.sid, h(1)), pk(PAL.roof, h(2)), pk(PAL.acc, h(3))]; }
    case 'mobile_home': return [pk([C(0xf0eee6), C(0xe6dcc0), C(0xc8d4dc), C(0xd8d0bc), C(0xb8c4b0)], h(1)), C(0xb8b8b4), pk(PAL.acc, h(3))];
    case 'shop_2st': case 'shop_wide': return [h(4) < .2 ? pk(PAL.stuc, h(1)) : pk(PAL.brk, h(1)), C(0x3a3836), pk(PAL.awn, h(3))];
    case 'shop_1st': case 'strip_mall': case 'gas_store': case 'motel': case 'big_box': return [pk(PAL.stuc, h(1)), C(0x5a5856), pk(PAL.awn, h(3))];
    case 'gas_canopy': return [C(0xf2f2f0), C(0xdddddd), pk([C(0xc02020), C(0x1f4fa0), C(0x1f8a3a), C(0xe0a020)], h(3))];
    case 'church2': return [h(1) < .5 ? C(0xf4f2ec) : pk(PAL.brk, h(5)), pk(PAL.roof, h(2)), C(0x3a3a3a)];
    case 'school': case 'apartment2': return [pk(PAL.brk, h(1)), C(0x4a4846), pk(PAL.acc, h(3))];
    case 'warehouse2': case 'factory': return [pk(PAL.metal, h(1)), pk([C(0x8a8e92), C(0x6a3a2a), C(0x4a5a6a)], h(2)), pk(PAL.awn, h(3))];
    case 'office': case 'tower2': case 'tower_slim': case 'parking_garage': return [pk(PAL.conc, h(1)), pk(PAL.glass, h(2)), pk(PAL.acc, h(3))];
    case 'grain_elevator': return [C(0xd8d4cc), C(0xb8bcc0), C(0x2a4a7a)];
    case 'water_tower2': return [pk([C(0xdcdfe2), C(0xc8d8e4), C(0xe4e0d4)], h(1)), C(0x9aa0a6), C(0x2a3a5a)];
    case 'tank': return [pk([C(0xe8e8e6), C(0xc8ccd0), C(0xd8d0b8)], h(1)), C(0x9a9a9a), C(0x3a3a3a)];
    case 'car': return [C(0x1a1a1a), C(0x2a2a2a), pk(PAL.car, h(3))];
    case 'fence_run': return [v === 0 ? C(0xf0eee8) : v === 1 ? C(0x9a7a5a) : C(0x8a8e8a), C(0x777777), C(0x777777)];
    case 'trash_can': return [pk([C(0x2a4a2e), C(0x3a3a3a), C(0x2a3a5a)], h(1)), C(0x555555), C(0x555555)];
    case 'dumpster': return [pk([C(0x2a5a3a), C(0x2a4a7a), C(0x5a5a5a)], h(1)), C(0x333333), C(0x333333)];
    default: return [C(0xcccccc), C(0x555555), C(0x884422)];
  }
}
const DET = new Set(['street_light', 'traffic_light', 'hydrant', 'mailbox', 'bench', 'trash_can', 'fence_run', 'dumpster']);
const FADE = { street_light: 420, traffic_light: 450, hydrant: 120, mailbox: 140, bench: 150, trash_can: 130, fence_run: 220, dumpster: 200, car: 1100 };
const SIGNS = ['CAFE', 'HARDWARE', 'DRUGS', 'BANK', 'ANTIQUES', 'BARBER', 'DINER', 'THEATRE', 'FEED & SEED', 'INSURANCE', 'BAKERY', 'FLOWERS', 'BOOKS', 'TAVERN', 'POST OFFICE', 'FARM SUPPLY', 'PIZZA', 'TACOS', 'AUTO PARTS', 'LAUNDRY', 'PHARMACY', 'MARKET', 'BURGERS', 'DONUTS', 'HOTEL', 'JEWELRY', 'SHOES', 'GROCERY', 'BBQ', 'VIDEO', 'PAWN', 'NAILS', 'MOTEL', 'VACANCY', 'GAS', 'STARLITE', 'PETRO', 'FOOD MART', 'HIGH SCHOOL', 'FIRST BAPTIST', 'METHODIST', 'FARMERS CO-OP', 'SUPERSTORE', 'OUTLET', 'DISCOUNT', 'STEAKHOUSE', 'BOWLING', 'CINEMA'];
const SG = (n) => SIGNS.indexOf(n);

// ---------------------------------------------------------------- geometry builder (local frame: front = +z)
class CB {
  constructor(signs = false) { this.p = []; this.n = []; this.t = []; this.c = []; this.l = []; this.s = []; this.a = []; this.i = []; this.T = { x: 0, y: 0, z: 0, c: 1, s: 0, sx: 1, sy: 1 }; this.pal = [[1, 1, 1], [1, 1, 1], [1, 1, 1]]; this.cen = [0, 0, 0, 0]; this.fix = false; this.ruin = false; this.signs = signs; this.ox = 0; this.oz = 0; }
  set(x, y, z, rot, sx, sy, pal, fade) { const T = this.T; T.x = x - this.ox; T.y = y; T.z = z - this.oz; T.c = Math.cos(rot); T.s = Math.sin(rot); T.sx = sx; T.sy = sy; this.pal = pal; this.cen[0] = T.x; this.cen[1] = y + 3; this.cen[2] = T.z; this.cen[3] = fade; }
  v(x, y, z, nx, ny, nz, u, w, col, L, S) {
    const T = this.T; x *= T.sx; y *= T.sy; z *= T.sx; if (!this.fix) { u *= T.sx; w *= Math.abs(ny) > .7 ? T.sx : T.sy; }
    let ax = nx / T.sx, ay = ny / T.sy, az = nz / T.sx; const nl = Math.hypot(ax, ay, az) || 1; ax /= nl; ay /= nl; az /= nl;
    this.p.push(T.x + x * T.c + z * T.s, T.y + y, T.z - x * T.s + z * T.c); this.n.push(ax * T.c + az * T.s, ay, -ax * T.s + az * T.c); this.t.push(u, w);
    const m = S >= 1 && S <= 3 ? this.pal[S - 1] : null; this.c.push(m ? col[0] * m[0] : col[0], m ? col[1] * m[1] : col[1], m ? col[2] * m[2] : col[2]); this.l.push(L); this.s.push(S); this.a.push(...this.cen);
  }
  quad(a, b, c, d, uv, col, L, S) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const o = this.p.length / 3; [a, b, c, d].forEach((q, k) => this.v(q[0], q[1], q[2], nx, ny, nz, uv[k][0], uv[k][1], col, L, S)); this.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  tri(a, b, c, uv, col, L, S) { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; const o = this.p.length / 3; [a, b, c].forEach((q, k) => this.v(q[0], q[1], q[2], nx / l, ny / l, nz / l, uv[k][0], uv[k][1], col, L, S)); this.i.push(o, o + 1, o + 2); }
  // vertical wall from (ax,az) to (bx,bz); outward normal = (-dz, dx)
  wall(ax, az, bx, bz, y0, y1, L, S, col, tu = 3, tv = 3, vo = 0) {
    if (this.ruin && y1 > 1.2) { const L2 = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L2 / 3)); for (let k = 0; k < n; k++) { const f0 = k / n, f1 = (k + 1) / n, r = hash2(Math.round(ax * 10 + k), Math.round(az * 10 + y1), 9); const top = y0 + (y1 - y0) * (r < .25 ? .15 : .35 + r * .6); this.wall1(ax + (bx - ax) * f0, az + (bz - az) * f0, ax + (bx - ax) * f1, az + (bz - az) * f1, y0, Math.min(top, 4.5), L, S, col, tu, tv, vo, L2 * f0); } return; }
    this.wall1(ax, az, bx, bz, y0, y1, L, S, col, tu, tv, vo, 0);
  }
  wall1(ax, az, bx, bz, y0, y1, L, S, col, tu, tv, vo, u0) { const len = Math.hypot(bx - ax, bz - az), U0 = u0 / tu, U1 = (u0 + len) / tu; this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [[U0, y0 / tv + vo], [U1, y0 / tv + vo], [U1, y1 / tv + vo], [U0, y1 / tv + vo]], col, L, S); }
  ring(P, y0, y1, L, S, col, tu, tv, vo) { for (let k = 0; k < P.length; k++) { const a = P[k], b = P[(k + 1) % P.length]; this.wall(a[0], a[1], b[0], b[1], y0, y1, L, S, col, tu, tv, vo); } }
  top(x0, x1, z0, z1, y, L, S, col, t = 3) { this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [[x0 / t, z1 / t], [x1 / t, z1 / t], [x1 / t, z0 / t], [x0 / t, z0 / t]], col, L, S); }
  bot(x0, x1, z0, z1, y, L, S, col, t = 3) { this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [[0, 0], [1, 0], [1, 1], [0, 1]], col, L, S); }
  box(x0, x1, y0, y1, z0, z1, L, S, col, tu = 3, tv = 3, top = true) { this.ring([[x0, z1], [x1, z1], [x1, z0], [x0, z0]], y0, y1, L, S, col, tu, tv); if (top && !this.ruin) this.top(x0, x1, z0, z1, y1, L, S, col, tu); }
  boxR(cx, cz, hx, hz, y0, y1, ang, L, S, col) { const c = Math.cos(ang), s = Math.sin(ang), P = [[-hx, hz], [hx, hz], [hx, -hz], [-hx, -hz]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]); this.ring(P, y0, y1, L, S, col, 2, 2); this.quad([P[0][0], y1, P[0][1]], [P[1][0], y1, P[1][1]], [P[2][0], y1, P[2][1]], [P[3][0], y1, P[3][1]], [[0, 0], [1, 0], [1, 1], [0, 1]], col, L, S); }
  // window/door/sign panel on a wall facing (nx,nz): full-tile uv
  panel(x, y, z, nx, nz, w, h, L, S, col, d = .04, u0 = 0, v0 = 0, u1 = 1, v1 = 1) { const tx = -nz, tz = nx, P = (a, b) => [x + tx * a + nx * d, y + b, z + tz * a + nz * d]; this.fix = true; this.quad(P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], col, L, S); this.fix = false; }
  // gable roof; ridge along x (alongX) or z
  gable(x0, x1, z0, z1, y, h, o, L, S, col, alongX, wL, wS, wc) {
    if (this.ruin) return;
    if (alongX) { const zc = (z0 + z1) / 2, hz = (z1 - z0) / 2, ye = y - o * h / hz, X0 = x0 - o, X1 = x1 + o, sl = Math.hypot(hz + o, h + o * h / hz) / 3;
      this.quad([X0, ye, z1 + o], [X1, ye, z1 + o], [X1, y + h, zc], [X0, y + h, zc], [[X0 / 3, 0], [X1 / 3, 0], [X1 / 3, sl], [X0 / 3, sl]], col, L, S); this.quad([X1, ye, z0 - o], [X0, ye, z0 - o], [X0, y + h, zc], [X1, y + h, zc], [[X1 / 3, 0], [X0 / 3, 0], [X0 / 3, sl], [X1 / 3, sl]], col, L, S);
      this.tri([x0, y, z1], [x0, y + h, zc], [x0, y, z0], [[z1 / 3, y / 3], [zc / 3, (y + h) / 3], [z0 / 3, y / 3]], wc, wL, wS); this.tri([x1, y, z0], [x1, y + h, zc], [x1, y, z1], [[z0 / 3, y / 3], [zc / 3, (y + h) / 3], [z1 / 3, y / 3]], wc, wL, wS);
      this.quad([X0, ye - .05, z0 - o], [X1, ye - .05, z0 - o], [X1, ye - .05, z1 + o], [X0, ye - .05, z1 + o], [[0, 0], [1, 0], [1, 1], [0, 1]], [.85, .85, .82], BL.paint, 0);
    } else { const xc = (x0 + x1) / 2, hx = (x1 - x0) / 2, ye = y - o * h / hx, Z0 = z0 - o, Z1 = z1 + o, sl = Math.hypot(hx + o, h + o * h / hx) / 3;
      this.quad([x1 + o, ye, Z1], [x1 + o, ye, Z0], [xc, y + h, Z0], [xc, y + h, Z1], [[Z1 / 3, 0], [Z0 / 3, 0], [Z0 / 3, sl], [Z1 / 3, sl]], col, L, S); this.quad([x0 - o, ye, Z0], [x0 - o, ye, Z1], [xc, y + h, Z1], [xc, y + h, Z0], [[Z0 / 3, 0], [Z1 / 3, 0], [Z1 / 3, sl], [Z0 / 3, sl]], col, L, S);
      this.tri([x1, y, z1], [xc, y + h, z1], [x0, y, z1], [[x1 / 3, y / 3], [xc / 3, (y + h) / 3], [x0 / 3, y / 3]], wc, wL, wS); this.tri([x0, y, z0], [xc, y + h, z0], [x1, y, z0], [[x0 / 3, y / 3], [xc / 3, (y + h) / 3], [x1 / 3, y / 3]], wc, wL, wS);
      this.quad([x0 - o, ye - .05, Z0], [x1 + o, ye - .05, Z0], [x1 + o, ye - .05, Z1], [x0 - o, ye - .05, Z1], [[0, 0], [1, 0], [1, 1], [0, 1]], [.85, .85, .82], BL.paint, 0); }
  }
  hip(x0, x1, z0, z1, y, h, o, L, S, col) {
    if (this.ruin) return; x0 -= o; x1 += o; z0 -= o; z1 += o; const ax = (x1 - x0) >= (z1 - z0), hw = Math.min(x1 - x0, z1 - z0) / 2, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, ye = y - o * h / hw;
    const r0 = ax ? [x0 + hw, y + h, zc] : [xc, y + h, z0 + hw], r1 = ax ? [x1 - hw, y + h, zc] : [xc, y + h, z1 - hw], A = [x0, ye, z1], B = [x1, ye, z1], Cc = [x1, ye, z0], Dd = [x0, ye, z0], uv = [[0, 0], [3, 0], [3, 2], [0, 2]];
    if (ax) { this.quad(A, B, r1, r0, uv, col, L, S); this.quad(Cc, Dd, r0, r1, uv, col, L, S); this.tri(B, Cc, r1, uv, col, L, S); this.tri(Dd, A, r0, uv, col, L, S); }
    else { this.quad(B, Cc, r0, r1, uv, col, L, S); this.quad(Dd, A, r1, r0, uv, col, L, S); this.tri(A, B, r1, uv, col, L, S); this.tri(Cc, Dd, r0, uv, col, L, S); }
    this.quad([x0, ye - .05, z0], [x1, ye - .05, z0], [x1, ye - .05, z1], [x0, ye - .05, z1], [[0, 0], [1, 0], [1, 1], [0, 1]], [.85, .85, .82], BL.paint, 0);
  }
  cyl(cx, cz, r0, r1, y0, y1, seg, L, S, col, cap = true, tu = 3, tv = 3) {
    for (let k = 0; k < seg; k++) { const a0 = k / seg * 6.2832, a1 = (k + 1) / seg * 6.2832, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1), u0 = k / seg * 6.28 * r0 / tu, u1 = (k + 1) / seg * 6.28 * r0 / tu;
      this.quad([cx + s0 * r0, y0, cz + c0 * r0], [cx + s1 * r0, y0, cz + c1 * r0], [cx + s1 * r1, y1, cz + c1 * r1], [cx + s0 * r1, y1, cz + c0 * r1], [[u0, y0 / tv], [u1, y0 / tv], [u1, y1 / tv], [u0, y1 / tv]], col, L, S);
      if (cap && r1 > 0 && !this.ruin) this.tri([cx + s0 * r1, y1, cz + c0 * r1], [cx + s1 * r1, y1, cz + c1 * r1], [cx, y1, cz], [[s0 * r1 / tu, c0 * r1 / tu], [s1 * r1 / tu, c1 * r1 / tu], [0, 0]], col, L, S); }
  }
  geo(origin) {
    const g = new THREE.BufferGeometry(), n = this.p.length / 3; if (!n) return null;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Int8Array.from(this.n, (v) => Math.round(v * 127)), 3, true));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(this.t, 2)); g.setAttribute('color', new THREE.BufferAttribute(Uint8Array.from(this.c, (v) => Math.max(0, Math.min(255, Math.round(v * 255)))), 3, true));
    g.setAttribute('aL', new THREE.BufferAttribute(Uint8Array.from(this.l), 1)); g.setAttribute('aS', new THREE.BufferAttribute(Uint8Array.from(this.s), 1)); g.setAttribute('aC', new THREE.Float32BufferAttribute(this.a, 4));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1)); g.computeBoundingSphere(); void origin; return g;
  }
}

// ---------------------------------------------------------------- generators
const W1 = [1, 1, 1], CONC = [.62, .6, .57], DARK = [.12, .12, .13], TRIM = [.92, .91, .88], GLASSC = [.75, .8, .85];
function found(b, hx, hz) { b.box(-hx - .12, hx + .12, -1.4, .35, -hz - .12, hz + .12, BL.concrete, 0, CONC, 3, 3, false); }
function win(b, x, y, z, nx, nz, w = 1.3, h = 1.35, sh = false) { b.panel(x, y, z, nx, nz, w, h, BL.hwin, 0, W1); if (sh && !b.lod) { const tx = -nz, tz = nx; for (const s of [-1, 1]) b.panel(x + tx * s * (w / 2 + .32), y, z + tz * s * (w / 2 + .32), nx, nz, .5, h * 1.05, BL.paint, 3, W1, .05); } }
function rubble(b, hx, hz, h, seed, pal) {
  b.top(-hx, hx, -hz, hz, .15, BL.concrete, 0, CONC); let r = hash2(Math.floor(seed * 1e6), 3, 5) * 1e6 | 0; const R = () => ((r = (Math.imul(r, 1103515245) + 12345) | 0) >>> 8) / 16777216;
  const n = Math.min(70, 14 + (hx * hz) / 6 | 0), mats = [[BL.planks, 0, [.6, .52, .44]], [BL.siding, 1, W1], [BL.shingle, 2, W1], [BL.brickN, 1, W1], [BL.wood, 0, [.7, .6, .5]], [BL.concrete, 0, CONC]];
  for (let k = 0; k < n; k++) { const m = mats[k % mats.length], s = .4 + R() * 1.8; b.boxR((R() - .5) * hx * 1.8, (R() - .5) * hz * 1.8, s * (.6 + R()), s * .25 + .1, 0, .15 + R() * Math.min(2.2, h * .25), R() * 3.14, m[0], m[1], m[2]); }
  for (let k = 0; k < 5; k++) { const a = (R() - .5) * hx * 1.6, c = (R() - .5) * hz * 1.6; b.boxR(a, c, .12, .12, 0, .8 + R() * 2.5, R(), BL.wood, 0, [.6, .5, .4]); }
}
const G = {};
G.house_ranch = (b, v, st) => {
  const hx = 7, hz = 5, H = 3.0, gx = driveX('house_ranch', v), gs = Math.sign(gx), wl = v >= 4 ? BL.brickN : BL.siding; found(b, hx, hz); b.box(-hx, hx, .35, H, -hz, hz, wl, 1, W1, 3, 3, false);
  if (!b.ruin) { b.panel(gx, 1.5, hz, 0, 1, 5.2, 2.3, BL.garage, 0, TRIM); const hc = -gs * 3.5; b.panel(hc + gs * 1.6, 1.4, hz, 0, 1, 1, 2.1, BL.wood, 3, W1); win(b, hc - gs * .6, 1.75, hz, 0, 1, 1.5, 1.3, v < 4); win(b, hc - gs * 2.6, 1.75, hz, 0, 1, 1.5, 1.3, v < 4);
    for (const z of [-2, 2]) { win(b, hx, 1.75, z, 1, 0, 1.1, 1.2); win(b, -hx, 1.75, z, -1, 0, 1.1, 1.2); } for (const x of [-4.5, 0, 4.5]) win(b, x, 1.75, -hz, 0, -1, 1.2, 1.2);
    if (!b.lod && v % 3 === 1) { b.box(hc + gs * 1.6 - 1.2, hc + gs * 1.6 + 1.2, .35, .5, hz, hz + 1.6, BL.concrete, 0, CONC); for (const s of [-1, 1]) b.box(hc + gs * 1.6 + s * 1.1 - .07, hc + gs * 1.6 + s * 1.1 + .07, .5, 2.7, hz + 1.4, hz + 1.55, BL.paint, 0, TRIM, 1, 1); } }
  if (b.ruin) return; if (v & 1) b.hip(-hx, hx, -hz, hz, H, 2.1, .55, BL.shingle, 2, W1); else b.gable(-hx, hx, -hz, hz, H, 2.2, .55, BL.shingle, 2, W1, true, wl, 1, W1);
  if (!b.lod && v % 3 === 0) b.box(-gs * 4.5 - .4, -gs * 4.5 + .4, H, H + 2.9, -1.8, -1, BL.brick, 0, W1, 1.5, 1.5);
};
G.house_2st = (b, v, st) => {
  const hx = 5.2, hz = 4.4, H = 5.8, wl = BL.siding; found(b, hx, hz); b.box(-hx, hx, .35, H, -hz, hz, wl, 1, W1, 3, 3, false);
  if (v >= 4) b.box(-hx - .02, hx + .02, .35, 3, -hz - .02, hz + .02, BL.brickN, 0, [.62, .36, .28], 3, 3, false);
  const dx = (v & 1 ? -1 : 1) * 1.8;
  if (!b.ruin) { b.panel(dx, 1.4, hz, 0, 1, 1, 2.1, BL.wood, 3, W1); win(b, -dx, 1.8, hz, 0, 1, 1.6, 1.4, true); for (const x of [-2.8, 0, 2.8]) win(b, x, 4.4, hz, 0, 1, 1.1, 1.3, true);
    for (const z of [-1.8, 1.8]) for (const y of [1.8, 4.4]) { win(b, hx, y, z, 1, 0, 1, 1.2); win(b, -hx, y, z, -1, 0, 1, 1.2); } for (const x of [-2.5, 2.5]) for (const y of [1.8, 4.4]) win(b, x, y, -hz, 0, -1, 1.1, 1.2);
    if (v < 3) { b.box(-hx, hx, .35, .55, hz, hz + 2.2, BL.wood, 0, [.62, .55, .46]); if (!b.lod) for (const x of [-hx + .2, -1.5, 1.5, hx - .2]) b.box(x - .09, x + .09, .55, 3, hz + 1.9, hz + 2.08, BL.paint, 0, TRIM, 1, 1); b.quad([-hx - .2, 3.05, hz + 2.4], [hx + .2, 3.05, hz + 2.4], [hx + .2, 3.55, hz], [-hx - .2, 3.55, hz], [[0, 0], [3, 0], [3, 1], [0, 1]], W1, BL.shingle, 2); } }
  if (b.ruin) return; if (v % 3 === 2) b.hip(-hx, hx, -hz, hz, H, 2.6, .5, BL.shingle, 2, W1); else b.gable(-hx, hx, -hz, hz, H, 2.7, .45, BL.shingle, 2, W1, true, wl, 1, W1);
  if (!b.lod && v % 2 === 0) b.box(hx - 1.6, hx - .8, H, H + 3.3, -2, -1.2, BL.brick, 0, W1, 1.5, 1.5);
};
G.bungalow = (b, v, st) => {
  const hx = 4.4, hz = 5, H = 3.0, wl = v === 3 ? BL.brickN : BL.siding; found(b, hx, hz); b.box(-hx, hx, .35, H, -hz, hz - 2.4, wl, 1, W1, 3, 3, false);
  if (!b.ruin) { b.panel(-1.2, 1.4, hz - 2.4, 0, 1, 1, 2.1, BL.wood, 3, W1); win(b, 1.6, 1.8, hz - 2.4, 0, 1, 1.8, 1.4); for (const z of [-3, 0]) { win(b, hx, 1.8, z, 1, 0, 1.1, 1.3); win(b, -hx, 1.8, z, -1, 0, 1.1, 1.3); } win(b, 0, 1.8, -hz, 0, -1, 1.2, 1.2);
    b.box(-hx, hx, .35, .6, hz - 2.4, hz, BL.wood, 0, [.6, .54, .45]); for (const x of [-hx + .3, hx - .3]) b.box(x - .22, x + .22, .6, H, hz - .45, hz - .05, wl === BL.siding ? BL.paint : BL.brickN, wl === BL.siding ? 0 : 1, TRIM, 1, 1); }
  if (b.ruin) return; b.gable(-hx, hx, -hz, hz, H, 2.6, .5, BL.shingle, 2, W1, false, wl, 1, W1);
  if (!b.lod) b.box(-hx + 1, -hx + 1.8, H, H + 2.6, -2.5, -1.7, BL.brick, 0, W1, 1.5, 1.5);
};
G.mobile_home = (b, v) => {
  const hx = 8, hz = 2.3; b.box(-hx + .3, hx - .3, 0, .7, -hz + .15, hz - .15, BL.corrugated, 0, [.5, .5, .5], 2, 2, false); b.box(-hx, hx, .7, 3.1, -hz, hz, BL.corrugated, 1, W1, 3, 3, !b.ruin);
  b.box(-hx - .02, hx + .02, 1.9, 2.15, -hz - .02, hz + .02, BL.paint, 3, W1, 3, 3, false);
  if (!b.ruin) { b.panel(-3, 1.75, hz, 0, 1, .9, 1.9, BL.paint, 0, [.85, .84, .8]); for (const x of [-6, 0, 3, 5.6]) win(b, x, 2.15, hz, 0, 1, 1.2, .9); for (const x of [-5, 0, 4]) win(b, x, 2.15, -hz, 0, -1, 1.2, .9); b.box(-3.7, -2.3, 0, .7, hz, hz + 1.2, BL.wood, 0, [.6, .52, .42]);
    if (v === 2) b.quad([-hx - .1, 3.1, hz + .1], [hx + .1, 3.1, hz + .1], [hx + .1, 3.45, 0], [-hx - .1, 3.45, 0], [[0, 0], [5, 0], [5, 1], [0, 1]], [.72, .72, .7], BL.corrugated, 0), b.quad([hx + .1, 3.1, -hz - .1], [-hx - .1, 3.1, -hz - .1], [-hx - .1, 3.45, 0], [hx + .1, 3.45, 0], [[0, 0], [5, 0], [5, 1], [0, 1]], [.72, .72, .7], BL.corrugated, 0); }
};
G.duplex = (b, v) => {
  const hx = 13, hz = 6, H = 6.2, wl = v ? BL.brickN : BL.siding; found(b, hx, hz); b.box(-hx, hx, .35, H, -hz, hz, wl, 1, W1, 3, 3, false);
  if (!b.ruin) { for (let k = -3; k <= 3; k++) { const x = k * 3.6; if (k === -2 || k === 2) b.panel(x, 1.4, hz, 0, 1, 1, 2.1, BL.wood, 3, W1); else win(b, x, 1.8, hz, 0, 1, 1.4, 1.3); win(b, x, 4.6, hz, 0, 1, 1.4, 1.3); win(b, x, 1.8, -hz, 0, -1, 1.4, 1.3); win(b, x, 4.6, -hz, 0, -1, 1.4, 1.3); }
    for (const z of [-2.5, 2.5]) for (const y of [1.8, 4.6]) { win(b, hx, y, z, 1, 0); win(b, -hx, y, z, -1, 0); } }
  if (!b.ruin) b.hip(-hx, hx, -hz, hz, H, 2.3, .5, BL.shingle, 2, W1);
};
// main-street commercial: storefront, upper windows, cornice, awning, sign
function shopFront(b, hx, hz, H, v, two, sign) {
  if (!b.ruin) { b.wall1(-hx + .4, hz + .02, hx - .4, hz + .02, .3, 3.6, BL.store, 0, W1, 2 * (hx - .4) / Math.max(1, Math.round((hx - .4) / 1.6)), 4, 0, 0);
    if (two) { const n = Math.max(2, Math.round(hx / 1.7)); for (let k = 0; k < n; k++) b.panel(-hx + (k + .5) * 2 * hx / n, 5.6, hz, 0, 1, 1.1, 1.9, BL.hwin, 0, W1); }
    b.box(-hx - .02, hx + .02, H - .7, H - .2, hz - .02, hz + .25, BL.concrete, 3, [.85, .82, .76], 2, 2); b.box(-hx, hx, 3.6, 3.9, hz, hz + .12, BL.concrete, 0, [.8, .78, .72], 2, 2);
    if (v % 3 !== 2) b.quad([-hx + .2, 3.0, hz + 1.7], [hx - .2, 3.0, hz + 1.7], [hx - .2, 3.75, hz + .05], [-hx + .2, 3.75, hz + .05], [[0, 0], [3, 0], [3, 1], [0, 1]], W1, BL.paint, 3);
    if (sign >= 0 && b.sg) b.sg.push([0, two ? 4.35 : 4.3, hz + .2, 0, 1, Math.min(2 * hx - 1.2, 6.5), .9, sign]); }
}
const shopSign = (seed) => Math.floor(hash2(Math.floor(seed * 1e6), 8, 1) * 32);
G.shop_2st = (b, v, st, seed) => { const hx = 4.5, hz = 10, H = 8.4 + (v % 3) * .5; b.box(-hx, hx, -1.2, H, -hz, hz, BL.brickN, 1, W1, 3, 3, false); if (!b.ruin) { b.top(-hx, hx, -hz, hz, H - .5, BL.tar, 0, W1); if (v >= 3) b.box(-1.6, 1.6, H, H + .9, hz - .3, hz + .02, BL.brickN, 1, W1); } shopFront(b, hx, hz, H, v, true, shopSign(seed)); };
G.shop_wide = (b, v, st, seed) => { const hx = 7, hz = 11, H = 7.4; b.box(-hx, hx, -1.2, H, -hz, hz, v === 1 ? BL.stucco : BL.brickN, 1, W1, 3, 3, false); if (!b.ruin) b.top(-hx, hx, -hz, hz, H - .5, BL.tar, 0, W1); shopFront(b, hx, hz, H, v, true, shopSign(seed)); };
G.shop_1st = (b, v, st, seed) => { const hx = 6, hz = 8, H = 4.8 + (v & 1) * .6; b.box(-hx, hx, -1.2, H, -hz, hz, v >= 2 ? BL.brickN : BL.stucco, 1, W1, 3, 3, false); if (!b.ruin) b.top(-hx, hx, -hz, hz, H - .4, BL.tar, 0, W1); shopFront(b, hx, hz, H + .6, v, false, 16 + shopSign(seed) % 16); };
G.gas_store = (b, v) => { const hx = 6.5, hz = 4.5, H = 4.2; b.box(-hx, hx, -1, H, -hz, hz, BL.stucco, 1, W1, 3, 3, false); if (b.ruin) return; b.top(-hx, hx, -hz, hz, H, BL.tar, 0, W1); b.wall1(-hx + .6, hz + .02, hx - .6, hz + .02, .3, 2.9, BL.store, 0, W1, 2.4, 3.6, 0, 0); b.box(-hx - .1, hx + .1, H - .8, H + .3, -hz - .1, hz + .1, BL.paint, 3, W1, 3, 3, false); if (b.sg) b.sg.push([0, H - .25, hz + .15, 0, 1, 6, .9, SG('FOOD MART')]); };
G.gas_canopy = (b, v, st, seed) => {
  const hx = 9, hz = 5; for (const x of [-5.5, 5.5]) for (const z of [-1.6, 1.6]) b.box(x - .22, x + .22, 0, 4.8, z - .22, z + .22, BL.paint, 0, TRIM, 1, 1);
  b.box(-hx, hx, 4.8, 5.7, -hz, hz, BL.paint, 1, W1, 3, 3, true); b.box(-hx - .03, hx + .03, 4.95, 5.45, -hz - .03, hz + .03, BL.paint, 3, W1, 3, 3, false); b.bot(-hx, hx, -hz, hz, 4.8, BL.paint, 0, [.9, .9, .9]);
  for (const x of [-4, 0, 4]) b.bot(x - .6, x + .6, -2.5, 2.5, 4.78, BL.paint, 4, [1, .98, .9]);
  for (const x of [-5.5, 5.5]) { b.box(x - .5, x + .5, 0, .2, -3.2, 3.2, BL.concrete, 0, CONC); for (const z of [-1.6, 1.6]) b.box(x - .35, x + .35, .2, 1.9, z - .25, z + .25, BL.paint, 3, W1, 1, 1); }
  if (b.sg) { const n = hash2(Math.floor(seed * 1e6), 1, 2) < .5 ? SG('STARLITE') : SG('PETRO'); b.sg.push([0, 5.25, hz + .06, 0, 1, 5, .7, n]); b.sg.push([0, 5.25, -hz - .06, 0, -1, 5, .7, n]); }
};
G.motel = (b, v) => {
  const hx = 18, hz = 5.5, two = v === 1, H = two ? 6.4 : 3.4; b.box(-hx, hx, -1, H, -hz, hz, BL.stucco, 1, W1, 3, 3, false);
  if (!b.ruin) { b.top(-hx - .2, hx + .2, -hz - .2, hz + 2.2, H, BL.tar, 0, W1); for (const y of two ? [0, 3.2] : [0]) for (let k = -5; k <= 5; k++) { const x = k * 3.1; b.panel(x - .6, y + 1.1, hz, 0, 1, .9, 2.1, BL.paint, 3, W1); b.panel(x + .7, y + 1.6, hz, 0, 1, 1.2, 1.1, BL.hwin, 0, W1); }
    if (two) b.box(-hx, hx, 3.0, 3.25, hz, hz + 2, BL.concrete, 0, CONC); for (let k = -6; k <= 6; k += 2) b.box(k * 3 - .1, k * 3 + .1, 0, H, hz + 1.8, hz + 2, BL.paint, 0, TRIM, 1, 1);
    b.box(hx - 2, hx + 3.5, -1, 3.6, -hz, hz - 1, BL.stucco, 3, W1); b.box(-hx - 4, -hx - 3.6, 0, 7.5, hz + 3, hz + 3.4, BL.paint, 0, [.5, .5, .5], 1, 1);
    if (b.sg) { b.sg.push([-hx - 3.8, 6.5, hz + 3.45, 0, 1, 4, 1, SG('MOTEL'), 1]); b.sg.push([-hx - 3.8, 5.2, hz + 3.45, 0, 1, 3, .7, SG('VACANCY'), 1]); } }
};
G.strip_mall = (b, v) => {
  const hx = 22, hz = 9, H = 5.4; b.box(-hx, hx, -1, H, -hz, hz, v ? BL.brickN : BL.stucco, 1, W1, 3, 3, false); if (b.ruin) return; b.top(-hx, hx, -hz, hz, H - .4, BL.tar, 0, W1);
  b.wall1(-hx + .5, hz + .02, hx - .5, hz + .02, .3, 3.4, BL.store, 0, W1, 3.4, 4, 0, 0); b.box(-hx, hx, 3.6, 3.85, hz, hz + 2.6, BL.paint, 0, TRIM); for (let k = -3; k <= 3; k++) { b.box(k * 6.2 - .15, k * 6.2 + .15, 0, 3.6, hz + 2.3, hz + 2.6, BL.paint, 0, TRIM, 1, 1); if (b.sg && k > -3) b.sg.push([k * 6.2 - 3.1, 4.6, hz + .06, 0, 1, 4.2, .8, 16 + ((k + 7) * 5 + v * 3) % 30]); }
  b.box(-hx, hx, H - .9, H + .3, hz - .1, hz + .15, BL.paint, 3, W1);
};
G.big_box = (b, v) => { const hx = 32, hz = 24, H = 9; b.box(-hx, hx, -1, H, -hz, hz, BL.block, 1, W1, 3, 3, false); if (b.ruin) return; b.top(-hx, hx, -hz, hz, H, BL.tar, 0, W1); b.box(-7, 7, -1, H + 2.5, hz - .5, hz + .6, BL.paint, 3, W1); b.wall1(-5, hz + .62, 5, hz + .62, .2, 3.6, BL.store, 0, W1, 2.5, 4, 0, 0); if (b.sg) b.sg.push([0, H, hz + .65, 0, 1, 11, 2, SG(v ? 'DISCOUNT' : 'SUPERSTORE')]); for (const x of [-20, 0, 20]) b.box(x - 1.5, x + 1.5, H, H + 1.2, -6, -3, BL.paint, 0, [.6, .6, .6]); };
G.church2 = (b, v) => {
  const hx = 6, hz = 12, H = 7, wl = v ? BL.brickN : BL.siding; found(b, hx, hz); b.box(-hx, hx, .35, H, -hz, hz, wl, 1, W1, 3, 3, false);
  if (!b.ruin) { for (const z of [-7.5, -3, 1.5, 6]) { b.panel(hx, 3.6, z, 1, 0, 1.3, 3.6, BL.hwin, 0, [1, .9, .7]); b.panel(-hx, 3.6, z, -1, 0, 1.3, 3.6, BL.hwin, 0, [1, .9, .7]); }
    b.gable(-hx, hx, -hz, hz, H, 5.4, .5, BL.shingle, 2, W1, false, wl, 1, W1);
    b.box(-1.9, 1.9, .35, 14, hz - .6, hz + 3.2, wl, 1, W1); b.panel(0, 1.8, hz + 3.2, 0, 1, 1.8, 3, BL.wood, 0, [.5, .32, .2]); b.panel(0, 9.5, hz + 3.2, 0, 1, 1, 2, BL.hwin, 0, W1);
    b.cyl(0, hz + 1.3, 2.0, .05, 14, 23.5, 8, BL.shingle, 2, W1, false); if (!b.lod) { b.box(-.06, .06, 23.4, 25.6, hz + 1.24, hz + 1.36, BL.paint, 0, [.85, .8, .5], 1, 1); b.box(-.6, .6, 24.5, 24.65, hz + 1.24, hz + 1.36, BL.paint, 0, [.85, .8, .5], 1, 1); }
    if (b.sg) b.sg.push([hx + 2.5, 1.2, hz + 4, 0, 1, 3.4, .8, SG(v ? 'METHODIST' : 'FIRST BAPTIST')]); }
};
G.school = (b) => {
  const hx = 26, hz = 13, H = 8; b.box(-hx, hx, -1, H, -hz, hz, BL.aptw, 1, W1, 3.2, 3.6, false); if (b.ruin) return; b.top(-hx, hx, -hz, hz, H, BL.tar, 0, W1);
  b.box(-hx - .1, hx + .1, H - .6, H + .5, -hz - .1, hz + .1, BL.concrete, 0, [.85, .83, .78], 3, 3, false); b.box(-5, 5, -1, 4.2, hz, hz + 4, BL.brickN, 1, W1); b.wall1(-3.6, hz + 4.02, 3.6, hz + 4.02, .2, 3.2, BL.store, 0, W1, 2.4, 4, 0, 0);
  b.cyl(hx - 2, hz + 8, .08, .06, 0, 11, 5, BL.paint, 0, [.85, .85, .85], false); if (!b.lod) b.box(hx - 1.95, hx - .1, 9.6, 10.8, hz + 7.97, hz + 8.03, BL.paint, 0, [.7, .1, .1], 1, 1);
  if (b.sg) b.sg.push([0, 5, hz + 4.05, 0, 1, 7, 1, SG('HIGH SCHOOL')]);
};
G.warehouse2 = (b, v) => {
  const hx = 20, hz = 14, H = 8.4; b.box(-hx, hx, -1, H, -hz, hz, BL.corrugated, 1, W1, 3, 3, false); if (b.ruin) return;
  b.gable(-hx, hx, -hz, hz, H, 1.4, .3, BL.corrugated, 2, W1, false, BL.corrugated, 1, W1); for (let k = -2; k <= 2; k++) b.panel(k * 7, 2.4, hz, 0, 1, 4, 4.4, BL.garage, 0, [.85, .85, .82]);
  b.box(-hx, -hx + 9, -1, 4, hz, hz + 1, BL.block, 0, [.8, .78, .74]); b.box(-hx + 9, hx, 0, 1.2, hz, hz + 2.2, BL.concrete, 0, CONC); if (v === 2 && b.sg) b.sg.push([-hx + 4.5, 3.3, hz + 1.05, 0, 1, 6, .8, SG('FARM SUPPLY')]);
};
G.factory = (b, v) => {
  const hx = 25, hz = 16, H = 10; b.box(-hx, hx, -1, H, -hz, hz, v ? BL.brickN : BL.corrugated, 1, W1, 3, 3, false); if (b.ruin) return;
  for (let k = 0; k < 5; k++) { const z0 = -hz + k * 6.4, z1 = z0 + 6.4; b.quad([-hx, H, z0], [-hx, H + 3, z1], [hx, H + 3, z1], [hx, H, z0], [[0, 0], [0, 1], [8, 1], [8, 0]], W1, BL.corrugated, 2); b.quad([-hx, H, z1], [hx, H, z1], [hx, H + 3, z1], [-hx, H + 3, z1], [[0, 0], [8, 0], [8, 1], [0, 1]], [.4, .45, .5], BL.office, 0); }
  b.cyl(hx - 5, -hz + 5, 1.6, 1.2, 0, 34, 10, BL.brick, 0, W1, false); b.cyl(hx - 10, -hz + 5, 1.3, 1.0, 0, 28, 10, BL.brick, 0, W1, false); for (let k = -2; k <= 2; k++) b.panel(k * 9, 2.4, hz, 0, 1, 4.4, 4.6, BL.garage, 0, [.8, .8, .78]);
};
function floors(b, hx, hz, y0, y1, L, S, col, tu, tv) { b.ring([[-hx, hz], [hx, hz], [hx, -hz], [-hx, -hz]], y0, y1, L, S, col, tu, tv); }
function roofUnits(b, hx, hz, y, n) { if (b.ruin) return; for (let k = 0; k < n; k++) { const x = (hash2(k, n, Math.round(hx)) - .5) * hx * 1.2, z = (hash2(n, k, Math.round(hz)) - .5) * hz * 1.2; b.box(x - 1.6, x + 1.6, y, y + 1.6, z - 1.1, z + 1.1, BL.paint, 0, [.62, .63, .64], 2, 2); } }
G.office = (b, v) => {
  const hx = 17, hz = 12, H = 24, L = [BL.bay, BL.curt, BL.aptw, BL.office][v], S = v === 1 ? 2 : 1; b.box(-hx - .2, hx + .2, -1.5, 4.2, -hz - .2, hz + .2, BL.store, 0, W1, 3.4, 4.2, false); floors(b, hx, hz, 4.2, H, L, S, W1, v === 1 ? 1.6 : 3.2, 3.8);
  if (b.ruin) return; b.top(-hx, hx, -hz, hz, H, BL.tar, 0, W1); b.box(-hx - .1, hx + .1, H - .2, H + .8, -hz - .1, hz + .1, BL.concrete, 1, W1, 3, 3, false); roofUnits(b, hx, hz, H, 3);
};
G.apartment2 = (b, v) => {
  const hx = 16, hz = 9, H = 20; b.box(-hx, hx, -1.5, H, -hz, hz, v === 2 ? BL.bay : BL.aptw, 1, W1, 3.2, 3.2, false); if (b.ruin) return; b.top(-hx, hx, -hz, hz, H, BL.tar, 0, W1); b.box(-hx - .15, hx + .15, H - .3, H + .7, -hz - .15, hz + .15, BL.concrete, 0, [.82, .8, .76], 3, 3, false); roofUnits(b, hx, hz, H, 2);
  b.box(-2.5, 2.5, 0, 3.4, hz, hz + 2.5, BL.concrete, 0, [.8, .78, .74]); b.panel(0, 1.4, hz + .02, 0, 1, 2, 2.6, BL.store, 0, W1);
};
G.parking_garage = (b) => {
  const hx = 20, hz = 15; for (let k = 0; k < 5; k++) { const y = k * 3; b.box(-hx, hx, y, y + .35, -hz, hz, BL.concrete, 0, [.7, .69, .66], 3, 3, true); b.ring([[-hx, hz], [hx, hz], [hx, -hz], [-hx, -hz]], y + .35, y + 1.25, BL.concrete, 0, [.78, .77, .74], 3, 3); if (y > 0) b.bot(-hx, hx, -hz, hz, y - .01, BL.concrete, 0, [.3, .3, .3]); }
  for (const x of [-hx + .3, -hx / 3, hx / 3, hx - .3]) for (const z of [-hz + .3, 0, hz - .3]) b.box(x - .3, x + .3, 0, 12, z - .3, z + .3, BL.concrete, 0, [.6, .6, .58], 2, 2, false); b.box(-hx, hx, 15, 15.3, -hz, hz, BL.concrete, 0, [.7, .69, .66]); b.box(-hx, hx, 15.3, 16.2, -hz, -hz + .3, BL.concrete, 0, [.78, .77, .74]);
};
function towerGlass(b, hx, hz, y0, y1, L, S, col, tu) { floors(b, hx, hz, y0, y1, L, S, col, tu, 3.8); }
G.tower2 = (b, v, st) => {
  const glass = st === 1 ? [.35, .35, .35] : W1, hx = 17, hz = 17, H = 100;
  b.box(-hx, hx, -1.5, 9, -hz, hz, v === 1 ? BL.stone : BL.store, v === 1 ? 1 : 0, W1, v === 1 ? 3 : 3.6, v === 1 ? 3 : 4.5, true);
  if (v === 0) { b.ring([[-hx + 1.5, hz - 1.5], [hx - 1.5, hz - 1.5], [hx - 1.5, -hz + 1.5], [-hx + 1.5, -hz + 1.5]], 9, H, BL.curt, 2, glass, 1.6, 3.8); b.box(-hx + 4, hx - 4, H, H + 5, -hz + 4, hz - 4, BL.curt, 2, glass, 1.6, 3.8); roofUnits(b, hx - 5, hz - 5, H + 5, 2); }
  else if (v === 1) { floors(b, hx - 1, hz - 1, 9, H * .58, BL.bay, 1, W1, 2.6, 3.8); b.top(-hx + 1, hx - 1, -hz + 1, hz - 1, H * .58, BL.tar, 0, W1); floors(b, hx - 4.5, hz - 4.5, H * .58, H * .82, BL.bay, 1, W1, 2.6, 3.8); b.top(-hx + 4.5, hx - 4.5, -hz + 4.5, hz - 4.5, H * .82, BL.tar, 0, W1); floors(b, hx - 8, hz - 8, H * .82, H, BL.bay, 1, W1, 2.6, 3.8); b.cyl(0, 0, 6, .3, H, H + 14, 4, BL.stone, 1, W1, false); }
  else if (v === 2) { towerGlass(b, hx - 1, hz - 1, 9, H, BL.curt, 2, glass, 1.6); const y = H; b.quad([-hx + 1, y, hz - 1], [hx - 1, y, hz - 1], [hx - 1, y + 14, -hz + 1], [-hx + 1, y + 14, -hz + 1], [[0, 0], [20, 0], [20, 6], [0, 6]], glass, BL.curt, 2); b.quad([hx - 1, y, -hz + 1], [-hx + 1, y, -hz + 1], [-hx + 1, y + 14, -hz + 1], [hx - 1, y + 14, -hz + 1], [[0, 0], [20, 0], [20, 4], [0, 4]], glass, BL.curt, 2); b.tri([hx - 1, y, hz - 1], [hx - 1, y, -hz + 1], [hx - 1, y + 14, -hz + 1], [[0, 0], [20, 0], [20, 4]], glass, BL.curt, 2); b.tri([-hx + 1, y, -hz + 1], [-hx + 1, y, hz - 1], [-hx + 1, y + 14, -hz + 1], [[0, 0], [20, 0], [0, 4]], glass, BL.curt, 2); }
  else { floors(b, hx - 1, hz - 1, 9, H, BL.office, 1, W1, 3, 3); b.top(-hx + 1, hx - 1, -hz + 1, hz - 1, H, BL.tar, 0, W1); b.box(-6, 6, H, H + 6, -6, 6, BL.concrete, 1, W1); b.cyl(0, 0, .3, .15, H + 6, H + 24, 4, BL.paint, 0, [.8, .8, .8], false); }
};
G.tower_slim = (b, v, st) => {
  const glass = st === 1 ? [.35, .35, .35] : W1, hx = 13, hz = 13, H = 100; b.box(-hx, hx, -1.5, 7, -hz, hz, BL.store, 0, W1, 3.6, 4.5, true);
  if (v === 0) { towerGlass(b, hx - 1, hz - 1, 7, H, BL.curt, 2, glass, 1.6); b.box(-hx + 3, hx - 3, H, H + 8, -hz + 3, hz - 3, BL.curt, 2, glass, 1.6, 3.8); }
  else if (v === 1) { floors(b, hx - .5, hz - .5, 7, H * .7, BL.bay, 1, W1, 2.6, 3.8); b.top(-hx + .5, hx - .5, -hz + .5, hz - .5, H * .7, BL.tar, 0, W1); floors(b, hx - 4, hz - 4, H * .7, H, BL.bay, 1, W1, 2.6, 3.8); b.top(-hx + 4, hx - 4, -hz + 4, hz - 4, H, BL.tar, 0, W1); roofUnits(b, hx - 5, hz - 5, H, 2); }
  else { b.cyl(0, 0, hx - .5, hx - .5, 7, H, 16, BL.curt, 2, glass, true, 1.6, 3.8); b.cyl(0, 0, hx - 3, 1, H, H + 10, 16, BL.curt, 2, glass, false, 1.6, 3.8); }
};
G.grain_elevator = (b, v, st, seed, info) => {
  const n = 5; for (let k = 0; k < n; k++) b.cyl(-11 + k * 4.4, 0, 2.3, 2.3, -1, 30, b.lod ? 10 : 14, BL.concrete, 1, W1, !b.ruin, 3, 3);
  for (let k = 0; k < n - 1; k++) b.box(-11 + k * 4.4 + 1.2, -11 + k * 4.4 + 3.2, -1, 30, -1.6, 1.6, BL.concrete, 1, [.97, .97, .97], 3, 3, false);
  if (b.ruin) return; b.box(10, 16, -1, 40, -3.5, 3.5, BL.concrete, 1, W1); b.gable(10, 16, -3.5, 3.5, 40, 2, .2, BL.corrugated, 2, W1, false, BL.concrete, 1, W1); b.box(-13.5, 10, 30, 32.5, -1.4, 1.4, BL.corrugated, 2, W1); b.box(15, 15.2, -1, 36, 3.5, 3.6, BL.corrugated, 0, [.5, .5, .5], 1, 1);
  if (v === 1) for (const x of [-6, 3]) { b.cyl(x, -8.5, 3.6, 3.6, -1, 9, 14, BL.corrugated, 0, [.8, .82, .84], false, 2); b.cyl(x, -8.5, 3.7, .4, 9, 11.4, 14, BL.corrugated, 0, [.76, .78, .8], true, 2); }
  if (b.sg) { b.sg.push([13, 34, 3.55, 0, 1, 5.6, 1.4, SG('FARMERS CO-OP')]); if (info?.town >= 0) b.sg.push([-1.6, 26, 2.35, 0, 1, 14, 3.5, info.town]); }
};
G.water_tower2 = (b, v, st, seed, info) => {
  b.cyl(0, 0, .55, .55, 0, 26, 8, BL.paint, 2, W1, false); for (let k = 0; k < 4; k++) { const a = k * 1.5708 + .785, c = Math.cos(a), s = Math.sin(a); b.quad([s * 5 - c * .2, 0, c * 5 + s * .2], [s * 5 + c * .2, 0, c * 5 - s * .2], [s * 3 + c * .2, 25, c * 3 - s * .2], [s * 3 - c * .2, 25, c * 3 + s * .2], [[0, 0], [1, 0], [1, 8], [0, 8]], W1, BL.paint, 2); b.quad([s * 5 + c * .2, 0, c * 5 - s * .2], [s * 5 - c * .2, 0, c * 5 + s * .2], [s * 3 - c * .2, 25, c * 3 + s * .2], [s * 3 + c * .2, 25, c * 3 - s * .2], [[0, 0], [1, 0], [1, 8], [0, 8]], W1, BL.paint, 2); }
  if (b.ruin) return; const sg = b.lod ? 12 : 20; b.cyl(0, 0, 2.2, 6.2, 22, 26.5, sg, BL.paint, 1, W1, false, 3); b.cyl(0, 0, 6.2, 6.2, 26.5, 31, sg, BL.paint, 1, W1, false, 3); b.cyl(0, 0, 6.2, .5, 31, 33.4, sg, BL.paint, 1, W1, true, 3);
  b.cyl(0, 0, 6.6, 6.6, 26.2, 26.5, sg, BL.paint, 2, W1, true, 3);
  if (b.sg && info?.town >= 0) for (let k = 0; k < 2; k++) { const a = k * Math.PI; for (let j = 0; j < 4; j++) { const t = (j - 1.5) * .26 + a, c = Math.cos(t), s = Math.sin(t); b.sg.push([s * 6.25, 28.75, c * 6.25, s, c, 1.62, 3.2, info.town, 0, (3 - j) / 4, (4 - j) / 4]); } }
};
G.tank = (b, v) => { b.cyl(0, 0, 7, 7, 0, 12, b.lod ? 12 : 18, v ? BL.corrugated : BL.paint, 1, W1, false, 3); if (b.ruin) return; b.cyl(0, 0, 7, 1, 12, 13.6, b.lod ? 12 : 18, BL.paint, 1, [.92, .92, .92], true, 3); b.box(6.9, 7.3, 0, 13, -.5, .5, BL.paint, 0, [.4, .4, .4], 1, 1); };
// ---- props
G.street_light = (b) => { b.cyl(0, 0, .14, .09, 0, 8.6, 6, BL.paint, 0, [.55, .56, .57], false, 1); b.quad([-.05, 8.5, 0], [.05, 8.5, 0], [.05, 8.6, 2.4], [-.05, 8.6, 2.4], [[0, 0], [1, 0], [1, 1], [0, 1]], [.55, .56, .57], BL.paint, 0); b.box(-.25, .25, 8.4, 8.7, 2.0, 2.9, BL.paint, 0, [.5, .5, .52], 1, 1); b.bot(-.22, .22, 2.05, 2.85, 8.39, BL.paint, 4, [1, .95, .8]); };
G.traffic_light = (b) => {
  b.cyl(0, 0, .2, .14, 0, 6.8, 8, BL.paint, 0, [.45, .46, .44], true, 1); b.box(-.08, .08, 6.1, 6.35, 0, 8.5, BL.paint, 0, [.45, .46, .44], 1, 1);
  for (const z of [3.4, 7.2]) { b.box(-.22, .22, 4.9, 6.1, z - .2, z + .2, BL.paint, 0, [.18, .17, .12], 1, 1); [[5.85, [1, .12, .08]], [5.5, [1, .7, .1]], [5.15, [.2, 1, .45]]].forEach(([y, c], i) => b.panel(-.23, y, z, -1, 0, .26, .26, BL.paint, i === 0 ? 5 : 0, i === 0 ? c : c.map((q) => q * .15), .01)); }
};
G.hydrant = (b) => { b.cyl(0, 0, .14, .14, 0, .65, 6, BL.paint, 0, [.75, .12, .08], false, 1); b.cyl(0, 0, .17, .05, .65, .85, 6, BL.paint, 0, [.8, .75, .7], true, 1); b.box(-.25, .25, .4, .5, -.05, .05, BL.paint, 0, [.75, .12, .08], 1, 1); };
G.mailbox = (b) => { b.box(-.05, .05, 0, 1.05, -.05, .05, BL.wood, 0, [.5, .42, .34], 1, 1); b.box(-.13, .13, 1.0, 1.28, -.25, .25, BL.paint, 0, [.25, .25, .27], 1, 1); };
G.bench = (b) => { for (const x of [-.75, .75]) b.box(x - .04, x + .04, 0, .45, -.25, .2, BL.paint, 0, [.2, .2, .2], 1, 1); b.box(-.9, .9, .42, .48, -.25, .2, BL.wood, 0, [.55, .4, .28], 1, 1); b.box(-.9, .9, .55, .9, -.28, -.23, BL.wood, 0, [.55, .4, .28], 1, 1); };
G.trash_can = (b) => { b.cyl(0, 0, .28, .3, 0, .95, 8, BL.corrugated, 1, W1, true, 1); };
G.dumpster = (b) => { b.box(-1, 1, .15, 1.3, -.85, .85, BL.paint, 1, W1, 2, 2, false); b.quad([-1.02, 1.3, .9], [1.02, 1.3, .9], [1.02, 1.42, -.9], [-1.02, 1.42, -.9], [[0, 0], [1, 0], [1, 1], [0, 1]], [.15, .15, .15], BL.paint, 0); };
G.fence_run = (b, v) => {
  if (v === 0) { b.box(-3, 3, .3, .42, -.02, .02, BL.paint, 1, W1, 1, 1); b.box(-3, 3, .7, 1.05, -.012, .012, BL.planks, 1, W1, .4, 1); b.box(-3, 3, .05, .7, -.012, .012, BL.planks, 1, W1, .4, 1); for (const x of [-3, 0]) b.box(x - .05, x + .05, 0, 1.15, -.05, .05, BL.paint, 1, W1, 1, 1); }
  else if (v === 1) { b.box(-3, 3, .05, 1.85, -.02, .02, BL.planks, 1, W1, .8, 2); for (const x of [-3, 0]) b.box(x - .06, x + .06, 0, 1.9, -.06, .06, BL.wood, 0, [.45, .36, .28], 1, 1); }
  else { b.box(-3, 3, 1.7, 1.76, -.03, .03, BL.paint, 1, W1, 1, 1); b.box(-3, 3, .05, 1.7, -.006, .006, BL.office, 0, [.55, .57, .6], .25, .25); for (const x of [-3, 0]) b.cyl(x, 0, .04, .04, 0, 1.8, 4, BL.paint, 1, W1, true, 1); }
};
G.car = (b, v) => {
  const P = BL.paint, B = [.92, .92, .92], GL = [.4, .45, .5], T = [.08, .08, .08];
  const wheels = (l, w) => { for (const z of [-l * .62, l * .62]) for (const x of [-w, w]) b.box(x - .12, x + .12, 0, .66, z - .33, z + .33, BL.paint, 0, T, 1, 1, false); };
  if (v === 4) { wheels(3.2, .95); b.box(-1.05, 1.05, .45, 1.2, -3.4, 3.4, P, 0, [.3, .3, .3], 2, 2); b.box(-1.0, 1.0, .9, 2.1, 1.6, 3.3, P, 3, B, 2, 2); b.box(-1.2, 1.2, 1.2, 3.4, -3.5, 1.5, BL.corrugated, 0, [.92, .92, .9], 2, 2); b.panel(0, 1.75, 3.31, 0, 1, 1.8, .6, BL.glass, 0, GL, .01); return; }
  const len = [2.3, 2.4, 2.65, 2.45][v], hz = len, wd = .9; wheels(hz, wd);
  if (v === 2) { b.box(-wd, wd, .4, 1.05, -hz, hz, P, 3, B, 2, 2); b.box(-wd + .05, wd - .05, 1.05, 1.75, .2, 1.6, P, 3, B, 2, 2); b.panel(0, 1.45, 1.61, 0, 1, 1.5, .5, BL.glass, 0, GL, .01); b.box(-wd + .06, wd - .06, .9, 1.05, -hz + .1, .1, BL.tar, 0, W1, 1, 1); return; }
  const top = v === 1 || v === 3 ? 1.85 : 1.4, cz0 = v === 0 ? -1.2 : v === 3 ? -hz + .2 : -1.7, cz1 = v === 0 ? .9 : v === 3 ? hz - .8 : 1.1;
  b.box(-wd, wd, .35, .95, -hz, hz, P, 3, B, 2, 2); b.quad([-wd + .08, .95, cz1 + .5], [wd - .08, .95, cz1 + .5], [wd - .12, top, cz1], [-wd + .12, top, cz1], [[0, 0], [1, 0], [1, 1], [0, 1]], GL, BL.glass, 0);
  b.ring([[-wd + .08, cz1], [wd - .08, cz1], [wd - .08, cz0], [-wd + .08, cz0]], .95, top, BL.glass, 0, GL, 1, 1); b.top(-wd + .12, wd - .12, cz0, cz1, top, P, 3, B, 2);
  b.quad([wd - .08, .95, cz0 - .45], [-wd + .08, .95, cz0 - .45], [-wd + .12, top, cz0], [wd - .12, top, cz0], [[0, 0], [1, 0], [1, 1], [0, 1]], GL, BL.glass, 0);
  b.panel(-.6, .75, hz, 0, 1, .3, .16, BL.paint, 0, [1, .95, .85], .01); b.panel(.6, .75, hz, 0, 1, .3, .16, BL.paint, 0, [1, .95, .85], .01); b.panel(-.6, .8, -hz, 0, -1, .3, .14, BL.paint, 0, [.6, .05, .05], .01); b.panel(.6, .8, -hz, 0, -1, .3, .14, BL.paint, 0, [.6, .05, .05], .01);
};

// ---------------------------------------------------------------- sign atlas (canvas): 4x16 cells of 256x64; cells 48..63 = town names
function makeAtlas() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 1024; const g = cv.getContext('2d');
  const bgs = ['#7a1c18', '#1d3d6e', '#24502c', '#e8e2d0', '#2a2a2a', '#5a2a5a', '#c89a2a', '#f2f0ea'], fgs = ['#f4eedc', '#f4eedc', '#f4eedc', '#3a2a1a', '#f2c84a', '#f4eedc', '#2a1a0a', '#a01818'];
  const cell = (i, text, bg, fg) => { const x = (i % 4) * 256, y = Math.floor(i / 4) * 64; g.fillStyle = bg; g.fillRect(x, y, 256, 64); g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, 248, 56); g.fillStyle = fg; let fs = 40; g.font = `bold ${fs}px Georgia, serif`; while (g.measureText(text).width > 230 && fs > 14) { fs -= 2; g.font = `bold ${fs}px Georgia, serif`; } g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x + 128, y + 34); };
  SIGNS.forEach((s, i) => { const k = (i * 5 + 3) % bgs.length; cell(i, s, s === 'MOTEL' || s === 'VACANCY' ? '#1a1a1a' : s === 'STARLITE' ? '#c02020' : s === 'PETRO' ? '#1f4fa0' : bgs[k], s === 'MOTEL' ? '#ff5a3a' : s === 'VACANCY' ? '#5aff8a' : s === 'STARLITE' || s === 'PETRO' ? '#ffffff' : fgs[k]); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
  const slots = new Map(); let next = 0;
  t.town = (name) => { if (slots.has(name)) return slots.get(name); const i = 48 + (next++ % 16); for (const [k, v] of slots) if (v === i) slots.delete(k); slots.set(name, i); const x = (i % 4) * 256, y = Math.floor(i / 4) * 64; g.fillStyle = '#d6dadd'; g.fillRect(x, y, 256, 64); g.fillStyle = '#1e2c4a'; let fs = 46; g.font = `bold ${fs}px Arial Black, Arial, sans-serif`; const s = name.toUpperCase(); while (g.measureText(s).width > 236 && fs > 14) { fs -= 2; g.font = `bold ${fs}px Arial Black, Arial, sans-serif`; } g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x + 128, y + 34); t.needsUpdate = true; return i; };
  return t;
}

// ---------------------------------------------------------------- material
function cityMat(ctx, tex, kind, atlas) {
  const g = ctx.globals, u = { uBA: { value: tex.bA.texture }, uBN: { value: tex.bN.texture }, uSunDir: g.uSunDir, uWet: g.uWetness, uDark: g.uStormDark, uCamP: g.uCamPos, uSign: { value: atlas } };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, fog: false }); m.customProgramCacheKey = () => 'city-' + kind;
  if (kind === 'sign') { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float aL, aS; attribute vec4 aC; attribute vec2 aT; uniform vec3 uCamP; varying float vL, vS, vFade; varying vec2 vT; varying vec3 vWp;`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n vL=aL; vS=aS; vT=aT;')
      .replace('#include <project_vertex>', `vec4 wp=modelMatrix*vec4(transformed,1.); vec3 cw=(modelMatrix*vec4(aC.xyz,1.)).xyz; float dc=distance(cw,uCamP); vFade=aC.w>0.?1.-smoothstep(aC.w*.8,aC.w,dc):1.; if(vFade<=0.) wp.xyz=cw; vWp=wp.xyz;
        vec4 mvPosition=viewMatrix*wp; gl_Position=projectionMatrix*mvPosition;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      precision highp sampler2DArray; uniform sampler2DArray uBA,uBN; uniform sampler2D uSign; uniform vec3 uSunDir; uniform float uWet,uDark; varying float vL,vS,vFade; varying vec2 vT; varying vec3 vWp; vec3 bN; float bR,bE,bM;
      float cIgn(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if(vFade<.999&&cIgn(gl_FragCoord.xy)>vFade) discard;')
      .replace('#include <map_fragment>', kind === 'sign' ? `{ vec3 s=texture(uSign,vT).rgb; diffuseColor.rgb*=s*s; bR=.55; bM=0.; bN=vec3(0.,0.,1.); float night=clamp(smoothstep(.12,-.1,uSunDir.y)+uDark*.4,0.,1.); bE=night*(vS>.5?1.6:.35); }` : `{ float L=floor(vL+.5); vec4 a=texture(uBA,vec3(vT,L)),n=texture(uBN,vec3(vT,L)); diffuseColor.rgb*=a.rgb*a.rgb*1.25; bR=n.b; bN=vec3(n.rg*2.-1.,1.);
        diffuseColor.rgb*=mix(1.,.66,uWet); bR=mix(bR,bR*.45,uWet);
        float night=clamp(smoothstep(.12,-.1,uSunDir.y)+uDark*.35,0.,1.); float isG=(L>18.5&&L<22.5)||L>25.5||L==16.||L==17.?1.:0.; float gm=isG*smoothstep(.2,.08,a.a); bM=gm*(L==20.?.55:.3);
        vec3 cell=floor((vWp+.01)/vec3(1.7,3.8,1.7)); float hs=fract(sin(dot(cell,vec3(12.99,78.23,37.71)))*43758.55); bE=gm*night*step(.42,hs)*(.5+.9*fract(hs*7.31));
        if(vS>3.5&&vS<4.5) bE=max(bE,night*2.5); if(vS>4.5) bE=1.6; }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=bR;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor=bM;')
      .replace('#include <normal_fragment_maps>', '{ vec3 q0=dFdx(-vViewPosition),q1=dFdy(-vViewPosition); vec2 s0=dFdx(vT),s1=dFdy(vT); vec3 N=normal; vec3 q1p=cross(q1,N),q0p=cross(N,q0); vec3 T=q1p*s0.x+q0p*s1.x,Bb=q1p*s0.y+q0p*s1.y; float det=max(dot(T,T),dot(Bb,Bb)); float sc=det==0.?0.:inversesqrt(det); normal=normalize(T*(bN.x*sc)+Bb*(bN.y*sc)+N*bN.z); }')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance+=(vS>4.5?diffuseColor.rgb*4.:${kind === 'sign' ? 'diffuseColor.rgb*2.5' : 'vec3(1.,.74,.44)'})*bE*2.2;`);
  };
  return m;
}

// ---------------------------------------------------------------- system
export function createBuildings(ctx, S, scatter, tex, data) {
  const group = new THREE.Group(); group.name = 'city'; ctx.scene.add(group);
  const atlas = makeAtlas(), mMain = cityMat(ctx, tex, 'main', atlas), mSign = cityMat(ctx, tex, 'sign', atlas);
  const Q = ctx.quality || {}, R = Math.min(3300, 1500 + (Q.viewDist || 14000) * .08), DET_R = 520;
  const known = new WeakMap(), recs = []; let cand = [], ci = 0, pi = 0, ui = 0, candT = 0; const queue = [];
  const townOf = (x, z) => { let b = null, bd = 1e18; for (const c of data.cities) { const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < bd) { bd = d; b = c; } } return b; };
  function candidates() {
    const p = ctx.camera.position, out = [];
    for (const c of data.cities) { const m = c.radius * 1.7; if (Math.hypot(c.x - p.x, c.z - p.z) > R + m + 300) continue; for (let z = c.z - m; z <= c.z + m + 255; z += 256) for (let x = c.x - m; x <= c.x + m + 255; x += 256) out.push(x, z); }
    return out;
  }
  function makeRec(items) {
    const n = items.length / STRIDE, list = []; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let k = 0; k < n; k++) { const K = KIND[items[k * STRIDE]]; if (!K?.ext) continue; list.push(k); const x = items[k * STRIDE + 1], z = items[k * STRIDE + 3]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    if (!list.length) { known.set(items, false); return; }
    const r = { items, list: Int32Array.from(list), st: new Uint8Array(list.length), pos: new Int32Array(n).fill(-1), x0, x1, z0, z1, ox: Math.round((x0 + x1) / 2), oz: Math.round((z0 + z1) / 2), meshes: null, dirty: true, poll: true, dead: false };
    r.list.forEach((k, i) => { r.pos[k] = i; }); known.set(items, r); recs.push(r); pollRec(r); queue.push(r);
  }
  function pollRec(r) { // pull damage states from scatter
    let ch = false, seen = false; const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, rad = Math.hypot(r.x1 - r.x0, r.z1 - r.z0) / 2 + 2;
    scatter.surfaceItems(cx, cz, rad, (items, o, st) => { if (items !== r.items) return; seen = true; const i = r.pos[o / STRIDE]; if (i >= 0 && r.st[i] !== st) { r.st[i] = st; ch = true; } });
    if (!seen) { r.dead = true; return; } if (ch && !r.dirty) { r.dirty = true; queue.push(r); }
  }
  function build(r) {
    const main = new CB(), det = new CB(), sg = new CB(true); for (const b of [main, det, sg]) { b.ox = r.ox; b.oz = r.oz; }
    const it = r.items, signs = [];
    for (let i = 0; i < r.list.length; i++) {
      const o = r.list[i] * STRIDE, K = KIND[it[o]], nm = K.name, st = r.st[i], x = it[o + 1], y = it[o + 2], z = it[o + 3], rot = it[o + 4], sx = it[o + 5], sy = it[o + 6], seed = it[o + 7], v = variantOf(nm, seed);
      if (nm === 'pavement') { pave(main, x, y, z, rot, sx, sy, v); continue; }
      if (st > 0 && (K.cls === 'prop')) continue;
      const b = DET.has(nm) ? det : main, pal = palette(nm, seed); b.set(x, y, z, rot, sx, sy, pal, FADE[nm] || 0); b.lod = 0;
      if (st === 2) { const hx = K.col[0] === 'box' ? K.col[1] : K.col[1], hz = K.col[0] === 'box' ? K.col[3] : K.col[1]; rubble(b, hx, hz, (K.col[0] === 'box' ? K.col[2] * 2 : K.col[2]) * Math.min(sy, 1.5), seed, pal); continue; }
      b.ruin = st === 1 && K.cls === 'bld'; b.sg = st === 0 ? signs : null; signs.length = 0;
      const info = (nm === 'water_tower2' || nm === 'grain_elevator') ? { town: atlas.town(townOf(x, z)?.name || '') } : null;
      G[nm]?.(b, v, st, seed, info); b.ruin = false;
      if (b.ruin === false && b.sg && signs.length) { sg.set(x, y, z, rot, sx, sy, [W1, W1, W1], 600); for (const [lx, ly, lz, nx, nz, w, h, cell, lit, f0 = 0, f1 = 1] of signs) { const cu = (cell % 4) / 4, cv = 1 - (Math.floor(cell / 4) + 1) / 16; sg.panel(lx, ly, lz, nx, nz, w, h, 0, lit ? 4 : 0, W1, .03, cu + f0 * .25, cv + .002, cu + f1 * .25, cv + 1 / 16 - .002); } }
    }
    const old = r.meshes; r.meshes = [];
    for (const [b, mat, cast] of [[main, mMain, true], [det, mMain, true], [sg, mSign, false]]) { const g = b.geo(); if (!g) { r.meshes.push(null); continue; } const m = new THREE.Mesh(g, mat); m.position.set(r.ox, 0, r.oz); m.castShadow = cast; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m); r.meshes.push(m); }
    if (old) for (const m of old) if (m) { group.remove(m); m.geometry.dispose(); }
    r.dirty = false;
  }
  function pave(b, x, y, z, rot, w, l, v) {
    const c = Math.cos(rot), s = Math.sin(rot), nu = Math.max(1, Math.ceil(w / 7)), nv = Math.max(1, Math.ceil(l / 7)), L = [BL.concrete, BL.park, BL.tar, BL.stone, BL.turf, BL.block][v], col = [[.78, .76, .72], [1, 1, 1], [1, 1, 1], [.75, .66, .55], [1, 1, 1], [.85, .8, .74]][v];
    const tu = v === 1 ? 2.7 : v === 4 ? 9.1 : 3, tv = v === 1 ? 5.4 : v === 4 ? 9.1 : 3; b.set(0 + b.ox, 0, 0 + b.oz, 0, 1, 1, [W1, W1, W1], 0); b.cen[0] = x - b.ox; b.cen[1] = y; b.cen[2] = z - b.oz;
    const P = (i, j) => { const lx = (i / nu - .5) * w, lz = (j / nv - .5) * l, X = x + lx * c + lz * s, Z = z - lx * s + lz * c; return [X - b.ox, S.terrainAt(X, Z) + .1, Z - b.oz, (lx + w / 2) / tu, (lz + l / 2) / tv]; };
    b.fix = true; for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = P(i, j + 1), bb = P(i + 1, j + 1), cc = P(i + 1, j), d = P(i, j); b.quad([a[0], a[1], a[2]], [bb[0], bb[1], bb[2]], [cc[0], cc[1], cc[2]], [d[0], d[1], d[2]], [[a[3], a[4]], [bb[3], bb[4]], [cc[3], cc[4]], [d[3], d[4]]], col, L, 0); } b.fix = false;
  }
  ctx.events?.on?.('world:break', (e) => { const p = e?.pos; if (!p) return; for (const r of recs) if (p.x > r.x0 - 30 && p.x < r.x1 + 30 && p.z > r.z0 - 30 && p.z < r.z1 + 30) r.poll = true; });
  let calls = 0;
  function update(dt) {
    const cam = ctx.camera.position;
    if ((candT -= dt) <= 0) { candT = 1; cand = candidates(); }
    // discovery: scan two candidate cells per frame
    for (let q = 0; q < 2 && cand.length; q++) { ci = (ci + 2) % cand.length; const x = cand[ci], z = cand[ci + 1]; if (Math.hypot(x - cam.x, z - cam.z) > R + 400) continue; const fresh = []; scatter.surfaceItems(x, z, 190, (items) => { if (!known.has(items) && !fresh.includes(items)) fresh.push(items); }); for (const a of fresh) makeRec(a); }
    // state polls (forced by break events, plus round-robin), unload of dropped sectors
    for (const r of recs) if (r.poll) { r.poll = false; pollRec(r); }
    if (recs.length) { pi = (pi + 1) % recs.length; pollRec(recs[pi]); }
    for (let i = recs.length - 1; i >= 0; i--) if (recs[i].dead) { const r = recs[i]; if (r.meshes) for (const m of r.meshes) if (m) { group.remove(m); m.geometry.dispose(); } recs.splice(i, 1); }
    // builds: nearest dirty record first, time-sliced
    const t0 = performance.now(); let n = 0;
    while (queue.length && (n === 0 || performance.now() - t0 < 4)) { let bi = 0, bd = 1e18; for (let i = 0; i < queue.length; i++) { const r = queue[i], d = Math.hypot(r.ox - cam.x, r.oz - cam.z); if (d < bd) { bd = d; bi = i; } } const r = queue.splice(bi, 1)[0]; if (r.dead || !r.dirty) continue; build(r); n++; }
    // detail & sign meshes only near the camera
    calls = 0; for (const r of recs) { if (!r.meshes) continue; const dx = Math.max(r.x0 - cam.x, 0, cam.x - r.x1), dz = Math.max(r.z0 - cam.z, 0, cam.z - r.z1), d = Math.hypot(dx, dz, Math.max(0, cam.y - 300)); if (r.meshes[1]) r.meshes[1].visible = d < DET_R; if (r.meshes[2]) r.meshes[2].visible = d < 650; for (const m of r.meshes) if (m?.visible) calls++; }
    void ui;
  }
  return { group, update, near: () => !queue.length, stats: () => ({ cityRecs: recs.length, cityQueue: queue.length, cityMeshes: calls }) };
}

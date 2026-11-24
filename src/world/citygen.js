// City & town layout (worker-safe, no three.js). Owned by CITIES.
// Blocks come from the city street grid (c.block spacing around c.x/c.z), commercial strips follow the major-road polylines.
// Every lot is validated against the *sampled* road clearance (O.eStr/eMaj/eGrv), so nothing lands on a road even if the
// road network changes; lots that face a missing street are dropped. Items: put(kind, x, z, rotY, sxz, sy, seed).
import { KI, KIND } from './kinds.js';
import { hash2 } from '../core/rng.js';

// archetype variants per kind (buildings.js generates one look per variant; palette comes from the seed)
export const NVAR = { house_ranch: 6, house_2st: 6, bungalow: 4, mobile_home: 3, duplex: 2, shop_2st: 6, shop_wide: 3, shop_1st: 4, gas_store: 2, gas_canopy: 1, motel: 2, strip_mall: 2, big_box: 2, church2: 2, school: 1, warehouse2: 3, factory: 2, office: 4, apartment2: 3, parking_garage: 1, tower2: 4, tower_slim: 3, grain_elevator: 2, water_tower2: 1, tank: 2, street_light: 1, traffic_light: 1, hydrant: 1, mailbox: 1, bench: 1, trash_can: 1, car: 5, fence_run: 3, dumpster: 1, pavement: 6 };
export const variantOf = (name, seed) => Math.max(0, Math.min((NVAR[name] || 1) - 1, Math.floor(seed * (NVAR[name] || 1))));
// pavement variants
export const PAVE = { concrete: 0, parking: 1, asphalt: 2, gravel: 3, turf: 4, plaza: 5 };
// local x of a house's driveway (garage side) - shared by layout (driveway/car) and the generator (garage door)
export function driveX(name, v) {
  if (name === 'house_ranch') return [1, -1, 1, -1, 1, -1][v] * 3.6;
  if (name === 'house_2st') return (v & 1 ? 1 : -1) * 7.1;
  return (v & 1 ? 1 : -1) * 6.2;
}
const SEED = (x, y, k, c) => hash2(x * 131 + k * 7 + 9, y * 97 + 11, c);

export function makeCityGen(s) {
  const O = s.O, D = s.data, plans = new Map(); let MM = 0; // extra clearance from major roads for grid lots (towns: the highway corridor belongs to the strip)
  const wet = (x, z) => s.waterLevelAt(x, z) > -1e8;
  // footprint check: 3x3 samples clear of roads (m metres from paved edge), dry, not too steep
  function fits(x, z, rot, hx, hz, m = 2.8) {
    const c = Math.cos(rot), sn = Math.sin(rot); let lo = 1e9, hi = -1e9;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const lx = a * hx, lz = b * hz, X = x + lx * c + lz * sn, Z = z - lx * sn + lz * c, h = s.heightAt(X, Z);
      if (O.eStr < m || O.eMaj < m + 1.5 + MM || O.eGrv < m || O.eRiv < 5 || O.deck || wet(X, Z)) return false; if (h < lo) lo = h; if (h > hi) hi = h;
    }
    return hi - lo < 2.2 + (hx + hz) * .05;
  }
  const streetAt = (x, z) => { s.heightAt(x, z); return O.eStr < 0 || O.eMaj < 0; };
  function plan(c) {
    let p = plans.get(c); if (p) return p;
    const S = c.block || (c.town ? 120 : 132), R = c.radius * .96, n = Math.max(1, Math.floor(R / S)), key = (c.x & 4095) ^ ((c.z & 4095) << 3);
    const h = (k) => hash2(key, k, 4242);
    p = { S, R, n, key, hb: S / 2 - 7.6, mh: Math.max(1, Math.round(n * .5)), dt: S * (1.25 + 1.6 * Math.min(1, c.pop / 1.2e6)), indAng: h(1) * 6.283,
      wt: c.town ? [h(2) < .5 ? -1 : 0, Math.floor(h(3) * 2 * n) - n] : [Math.floor(h(2) * 2 * n) - n, Math.round(n * .7) * (h(3) < .5 ? -1 : 1)],
      church: [Math.floor(h(4) * 2 * n) - n, Math.floor(h(5) * 2 * n) - n], schoolSide: Math.floor(h(6) * 4), mobile: h(7) < .65, elevator: c.town, hmax: 70 + 170 * Math.min(1, c.pop / 1.5e6) };
    plans.set(c, p); return p;
  }

  function city(c, x0, z0, x1, z1, put, towersOnly = false) {
    const P = plan(c), { S, n, hb, key } = P;
    const emit = (k, x, z, rot, sxz = 1, sy = 1, seed = .5) => { if (x >= x0 && x < x1 && z >= z0 && z < z1) put(k, x, z, rot, sxz, sy, seed); };
    for (let bj = -n - 1; bj <= n; bj++) for (let bi = -n - 1; bi <= n; bi++) {
      const bx = c.x + (bi + .5) * S, bz = c.z + (bj + .5) * S; if (bx + S < x0 || bx - S > x1 || bz + S < z0 || bz - S > z1) continue;
      const d = Math.hypot(bx - c.x, bz - c.z) / P.R; if (d > 1.35) continue;
      const h = (k) => SEED(bi + 64, bj + 64, k, key), ring = bi < -n || bi >= n || bj < -n || bj >= n;
      if (ring) { if ((bi < -n || bi >= n) && (bj < -n || bj >= n)) continue; if (towersOnly) continue; ringBlock(c, P, bi, bj, bx, bz, h, emit); continue; }
      let zone = 'res';
      if (c.town) { if ((bi === -1 || bi === 0) && Math.abs(bj + .5) <= P.mh) zone = 'main'; }
      else { const ang = Math.abs(((Math.atan2(bz - c.z, bx - c.x) - P.indAng) % 6.283 + 9.425) % 6.283 - 3.1416);
        const dm = d * P.R; if (dm < P.dt) zone = 'cbd'; else if (dm < P.dt + 1.5 * S) zone = 'mid'; else if (ang < .6 && d > .42) zone = 'ind'; else if (d < .62 && h(90) < .3) zone = 'mid'; }
      if (towersOnly && zone !== 'cbd' && zone !== 'mid') continue;
      if (zone === 'cbd' || zone === 'mid') downtown(c, P, zone, bx, bz, d * P.R, h, emit);
      else if (zone === 'ind') industrial(bx, bz, hb, h, emit);
      else if (zone === 'main') mainBlock(c, P, bi, bj, bx, bz, h, emit);
      else resBlock(c, P, bi, bj, bx, bz, h, emit);
      if (towersOnly) continue;
      // street furniture on the block's N and W edges (neighbours do theirs), hydrant at the NW corner
      for (const [nx, nz] of [[0, -1], [-1, 0]]) for (const u of [-.5, .5]) { const tx = -nz, tz = nx, o = hb + 1.7, x = bx + nx * o + tx * u * hb, z = bz + nz * o + tz * u * hb; s.heightAt(x, z); if (O.eStr > .4 && O.eStr < 4 && O.eMaj > 1) emit(KI.street_light, x, z, Math.atan2(nx, nz), 1, 1, h(40 + u)); }
      { const x = bx - hb - 1.2, z = bz - hb - 1.2; s.heightAt(x, z); if (O.eStr > .3 && O.eMaj > 1 && h(44) < .8) emit(KI.hydrant, x, z, 0, 1, 1, h(45)); }
      // traffic signals at busy junctions (block owns its NW junction)
      const busy = c.town ? (bi === 0 && bj === 0 && n >= 2) : (zone === 'cbd' || (zone === 'mid' && ((bi + bj) & 1) === 0));
      if (busy) { const jx = c.x + bi * S, jz = c.z + bj * S; if (streetAt(jx, jz) && streetAt(jx + 14, jz) && streetAt(jx, jz + 14) && streetAt(jx - 14, jz) && streetAt(jx, jz - 14))
        for (const [ox, oz, r] of [[7, 7, -Math.PI / 2], [-7, -7, Math.PI / 2], [-7, 7, Math.PI], [7, -7, 0]]) { const x = jx + ox, z = jz + oz; s.heightAt(x, z); if (O.eStr > .1) emit(KI.traffic_light, x, z, r, 1, 1, h(50)); } }
    }
    MM = 0; if (!towersOnly) strips(c, P, emit);
  }

  // ---- residential row of houses along one block edge (outward normal nx,nz)
  function houseRow(c, bx, bz, nx, nz, hb, h, k0, lim = 1, opt = {}) {
    const tx = -nz, tz = nx, rot = Math.atan2(nx, nz), emit = opt.emit; let u = -hb + 1.5 + h(k0) * 3, q = 0;
    while (u < hb - 6) {
      const r = h(k0 + q * 13 + 1), kn = c.town ? (r < .36 ? 'bungalow' : r < .7 ? 'house_ranch' : 'house_2st') : (r < .2 ? 'bungalow' : r < .62 ? 'house_ranch' : 'house_2st');
      const K = KIND[KI[kn]], hx = K.col[1], hz = K.col[3], side = kn === 'house_ranch' ? 0 : 3.3, lotW = 2 * hx + side + 3.5 + h(k0 + q * 13 + 2) * 4;
      if (u + lotW > hb * lim + 1) break;
      const seed = h(k0 + q * 13 + 3), v = variantOf(kn, seed), dx = driveX(kn, v), uc = u + lotW / 2 - (side ? Math.sign(dx) * side / 2 : 0), sb = 5.5 + h(k0 + q * 13 + 4) * 3.5, dc = hb - sb - hz;
      const x = bx + nx * dc + tx * uc, z = bz + nz * dc + tz * uc, fx = bx + nx * (hb + 5) + tx * uc, fz = bz + nz * (hb + 5) + tz * uc;
      q++; u += lotW;
      if (!streetAt(fx, fz) || !fits(x, z, rot, hx + .3, hz + .3)) continue;
      emit(KI[kn], x, z, rot + (h(k0 + q * 13 + 5) - .5) * .03, 1, 1, seed);
      // driveway (local x = dx), car, mailbox, trees, back fence
      const L = (lx, lz) => [x + Math.cos(rot) * lx + Math.sin(rot) * lz, z - Math.sin(rot) * lx + Math.cos(rot) * lz];
      const dl = sb + .6, [px, pz] = L(dx, hz + dl / 2 - .3); emit(KI.pavement, px, pz, rot, 3.4, dl, PAVE.concrete / 6 + .01);
      if (h(k0 + q * 13 + 6) < .72) { const [cx, cz] = L(dx, hz + 2.9 + h(k0 + q * 13 + 7) * Math.max(0, sb - 5.2)); emit(KI.car, cx, cz, rot + (h(k0 + q * 13 + 8) < .5 ? Math.PI : 0), 1, 1, h(k0 + q * 13 + 9)); }
      { const [mx, mz] = L(dx + (dx > 0 ? -2.2 : 2.2), hz + sb + 1.1); s.heightAt(mx, mz); if (O.eStr > .2) emit(KI.mailbox, mx, mz, rot, 1, 1, seed); }
      if (h(k0 + q * 13 + 10) < .6) { const [ax, az] = L(-dx * .9 + (h(k0 + q * 13 + 11) - .5) * 3, hz + sb * .55); if (fits(ax, az, 0, .6, .6, 1.5)) emit(h(k0 + q * 13 + 12) < .7 ? KI.oak : KI.cottonwood, ax, az, h(q) * 6.28, .7 + h(q + 3) * .35, .75 + h(q + 4) * .35, h(q + 5)); }
      if (h(k0 + q * 13 + 13) < .7) { const [ax, az] = L((h(k0 + q * 13 + 14) - .5) * hx * 1.6, -hz - 4 - h(q + 8) * Math.max(0, dc - hz - 9)); if (fits(ax, az, 0, .6, .6, 2)) emit(h(q + 9) < .5 ? KI.oak : h(q + 9) < .8 ? KI.cottonwood : KI.cedar, ax, az, h(q + 10) * 6.28, .7 + h(q + 11) * .4, .75 + h(q + 12) * .4, h(q + 13)); }
      if (opt.backFence !== false && h(k0 + q * 13 + 15) < .55 && dc > hz + 4) { const fs = h(k0 + q * 13 + 16), lz = -(dc - .8); for (let f = -lotW / 2 + 3; f <= lotW / 2 - 3 + .01; f += 6) { const [ax, az] = L(f, lz); emit(KI.fence_run, ax, az, rot, 1, 1, fs); } }
    }
  }
  function resBlock(c, P, bi, bj, bx, bz, h, emit) {
    const { hb } = P, ew = h(1) < .5;
    if (!c.town && h(91) < .16 && Math.hypot(bx - c.x, bz - c.z) / P.R < .75) { // garden apartments
      for (const sg of [-1, 1]) for (const u of [-.48, .48]) { const nx = ew ? sg : 0, nz = ew ? 0 : sg, tx = -nz, tz = nx, dc = hb - 9 - 6, x = bx + nx * dc + tx * u * hb, z = bz + nz * dc + tz * u * hb, rot = Math.atan2(nx, nz); if (fits(x, z, rot, 13.3, 6.3)) emit(KI.duplex, x, z, rot, 1, 1, h(7 + u + sg)); }
      const x = bx, z = bz; if (fits(x, z, ew ? Math.PI / 2 : 0, 20, 8, 2)) { emit(KI.pavement, x, z, ew ? Math.PI / 2 : 0, 46, 18, PAVE.parking / 6 + .01); for (let q = 0; q < 10; q++) if (h(60 + q) < .6) { const u = -20 + q * 4.6 + 1.2, w = (q & 1 ? -1 : 1) * 4.5; emit(KI.car, x + (ew ? w : u), z + (ew ? u : w), (ew ? 0 : Math.PI / 2) + (q & 1 ? Math.PI : 0), 1, 1, h(70 + q)); } }
      return;
    }
    if (!c.town && h(92) < .06) { schoolAt(bx, bz, ew ? 1 : 0, 0, hb, h, emit, true); return; }
    const isCh = P.church[0] === bi && P.church[1] === bj, isWt = P.wt[0] === bi && P.wt[1] === bj;
    for (const sg of [-1, 1]) {
      const nx = ew ? sg : 0, nz = ew ? 0 : sg;
      if (isCh && sg === 1) { const tx = -nz, tz = nx, rot = Math.atan2(nx, nz), x = bx + nx * (hb - 14) - tx * (hb - 9), z = bz + nz * (hb - 14) - tz * (hb - 9); if (fits(x, z, rot, 6.5, 12.5)) { emit(KI.church2, x, z, rot, 1, 1, h(30)); houseRowSkip(c, bx, bz, nx, nz, hb, h, 200, emit); continue; } }
      houseRow(c, bx, bz, nx, nz, hb, h, sg > 0 ? 100 : 300, 1, { emit });
    }
    if (isWt && fits(bx, bz, 0, 6.5, 6.5, 2)) emit(KI.water_tower2, bx, bz, h(31) * 6.28, 1, .9 + h(32) * .2, h(33));
  }
  function houseRowSkip(c, bx, bz, nx, nz, hb, h, k0, emit) { // houses on the far part of the row (church on the corner)
    const tx = -nz, tz = nx, sh = 11; houseRow(c, bx + tx * sh, bz + tz * sh, nx, nz, hb, h, k0, (hb - sh) / hb, { emit });
  }
  function mainBlock(c, P, bi, bj, bx, bz, h, emit) {
    const { hb } = P, nx = bi === -1 ? 1 : -1, tx = 0, tz = nx, rot = Math.atan2(nx, 0); let u = -hb + .5, q = 0;
    // brick commercial row facing Main St, flush with the sidewalk
    while (u < hb - 6) {
      const r = h(10 + q), kn = r < .55 ? 'shop_2st' : r < .8 ? 'shop_wide' : 'shop_1st', K = KIND[KI[kn]], hx = K.col[1], hz = K.col[3], w = 2 * hx + .05;
      if (u + w > hb) break; const uc = u + w / 2, dc = hb - hz - .3, x = bx + nx * dc + tx * uc, z = bz + tz * uc; u += w + (h(30 + q) < .12 ? 5 : 0); q++;
      if (!streetAt(bx + nx * (hb + 5), z) || !fits(x, z, rot, hx - .2, hz - .2, 2.3)) continue; emit(KI[kn], x, z, rot, 1, 1, h(50 + q));
    }
    for (let k = 0; k < 4; k++) { const z = bz + (-hb * .75 + k * hb * .5), x = bx + nx * (hb + .9); s.heightAt(x, z); if (O.eStr > .2) emit(k & 1 ? KI.bench : KI.trash_can, x, z, rot, 1, 1, h(70 + k)); }
    // rear parking lot + cars, houses on the opposite edge, water tower in the middle
    const px = bx + nx * (hb - 36), pz = bz; if (fits(px, pz, Math.PI / 2, 22, 7, 2)) { emit(KI.pavement, px, pz, Math.PI / 2, 50, 16, PAVE.parking / 6 + .01); for (let k = 0; k < 9; k++) if (h(80 + k) < .55) emit(KI.car, px + (k & 1 ? 4.3 : -4.3), pz - 20 + k * 5, k & 1 ? 0 : Math.PI, 1, 1, h(90 + k)); emit(KI.dumpster, px + nx * 10, pz + 26, rot, 1, 1, h(99)); }
    const P2 = plan(c); if (P2.wt[0] === bi && P2.wt[1] === bj) { const x = bx - nx * 4, z = bz + (h(5) < .5 ? -22 : 22); if (fits(x, z, 0, 6.5, 6.5, 2)) emit(KI.water_tower2, x, z, h(31) * 6.28, 1, .9 + h(32) * .2, h(33)); }
    houseRow(c, bx, bz, -nx, 0, hb, h, 400, 1, { emit, backFence: false });
  }
  function ringBlock(c, P, bi, bj, bx, bz, h, emit) {
    const { hb } = P; let nx = 0, nz = 0, side; if (bi < -P.n) { nx = 1; side = 0; } else if (bi >= P.n) { nx = -1; side = 1; } else if (bj < -P.n) { nz = 1; side = 2; } else { nz = -1; side = 3; }
    const tx = -nz, tz = nx, rot = Math.atan2(nx, nz), mid = Math.abs(nx ? bj + .5 : bi + .5) < .6;
    if (c.town && side === P.schoolSide && mid) { schoolAt(bx, bz, nx, nz, hb, h, emit, false); return; }
    if (c.town && P.mobile && side === (P.schoolSide ^ 1) && mid) { // mobile home park: narrow ends face the street, gravel lots
      for (let k = -5; k <= 5; k++) { const u = k * 9.2, x = bx + nx * (hb - 9) + tx * u, z = bz + nz * (hb - 9) + tz * u, r = rot + Math.PI / 2; if (!fits(x, z, r, 8.2, 2.5, 2.4)) continue; emit(KI.mobile_home, x, z, r + (h(k + 20) < .5 ? Math.PI : 0), 1, 1, h(k + 30)); const gx = x + tx * 4.6, gz = z + tz * 4.6; emit(KI.pavement, gx + nx * 2, gz + nz * 2, rot, 3.2, 12, PAVE.gravel / 6 + .01); if (h(k + 40) < .6) emit(KI.car, gx + nx * 5, gz + nz * 5, rot, 1, 1, h(k + 50)); }
      return;
    }
    houseRow(c, bx, bz, nx, nz, hb, h, 500, 1, { emit, backFence: false });
  }
  function schoolAt(bx, bz, nx, nz, hb, h, emit, whole) {
    const rot = Math.atan2(nx, nz), dc = whole ? hb - 20 : hb - 18, x = bx + nx * dc, z = bz + nz * dc; if (!fits(x, z, rot, 26.5, 13.5)) return;
    emit(KI.school, x, z, rot, 1, 1, h(1)); const fx = x - nx * 62, fz = z - nz * 62; if (fits(fx, fz, rot, 26, 50, 2)) emit(KI.pavement, fx, fz, rot + Math.PI / 2, 100, 50, PAVE.turf / 6 + .01);
    const tx = -nz, tz = nx, px = x + tx * 42 - nx * 4, pz = z + tz * 42 - nz * 4; if (fits(px, pz, rot, 10, 16, 2)) { emit(KI.pavement, px, pz, rot, 20, 32, PAVE.parking / 6 + .01); for (let k = 0; k < 6; k++) if (h(20 + k) < .6) emit(KI.car, px + tx * (k & 1 ? 4.5 : -4.5) + nx * (-11 + Math.floor(k / 2) * 5), pz + tz * (k & 1 ? 4.5 : -4.5) + nz * (-11 + Math.floor(k / 2) * 5), rot + (k & 1 ? Math.PI / 2 : -Math.PI / 2), 1, 1, h(30 + k)); }
  }
  function downtown(c, P, zone, bx, bz, d, h, emit) {
    const { hb } = P;
    for (let q = 0; q < 4; q++) {
      const qx = q & 1 ? 1 : -1, qz = q & 2 ? 1 : -1, cx = bx + qx * hb / 2, cz = bz + qz * hb / 2, fx = h(q + 1) < .5, nx = fx ? qx : 0, nz = fx ? 0 : qz, rot = Math.atan2(nx, nz), r = h(q + 10), sd = h(q + 20);
      if (zone === 'cbd' && r < .8) { const slim = h(q + 30) < .4, kn = slim ? 'tower_slim' : 'tower2', fw = slim ? 26 : 34, sxz = Math.min(slim ? 1.5 : 1.25, (hb - 5) / fw) * (.82 + .18 * h(q + 40)), H = P.hmax * (1 - .5 * d / P.dt) * (.45 + .75 * h(q + 50)), half = fw / 2 * sxz;
        if (fits(cx, cz, rot, half, half)) { emit(KI[kn], cx, cz, rot, sxz, Math.max(.42, H / 100), sd); continue; } }
      if (r < .84 || (zone === 'mid' && r < .5)) { const off = h(q + 60) < .5, kn = off ? 'office' : 'apartment2', K = KIND[KI[kn]], sxz = Math.min(1, (hb - 5) / (2 * K.col[1])), H = zone === 'cbd' ? 30 + h(q + 70) * 35 : 14 + h(q + 70) * 26;
        if (fits(cx, cz, rot, K.col[1] * sxz, K.col[3] * sxz)) { emit(KI[kn], cx, cz, rot, sxz, H / (2 * K.col[2]), sd); continue; } }
      if (r < .92) { if (fits(cx, cz, rot, 20, 15)) { emit(KI.parking_garage, cx, cz, rot, 1, .8 + h(q + 80) * .4, sd); continue; } }
      if (fits(cx, cz, 0, hb / 2 - 2, hb / 2 - 2, 2)) { const pl = h(q + 90) < .3; emit(KI.pavement, cx, cz, 0, hb - 3, hb - 3, (pl ? PAVE.plaza : PAVE.parking) / 6 + .01);
        if (pl) { for (const [a, b] of [[-1, -1], [1, 1], [1, -1], [-1, 1]]) emit(KI.oak, cx + a * hb * .25, cz + b * hb * .25, h(a + b) * 6, .8, .85, h(q + a)); emit(KI.bench, cx, cz, 0, 1, 1, sd); }
        else for (let k = 0; k < 18; k++) if (h(q * 30 + k + 100) < .55) { const row = Math.floor(k / 6), u = (k % 6 - 2.5) * 4.6; emit(KI.car, cx + u, cz + (row - 1) * 14 + (row & 1 ? 2.6 : -2.6), row & 1 ? Math.PI : 0, 1, 1, h(q * 30 + k + 200)); } }
    }
  }
  function industrial(bx, bz, hb, h, emit) {
    const ew = h(1) < .5;
    for (const sg of [-1, 1]) {
      const nx = ew ? sg : 0, nz = ew ? 0 : sg, rot = Math.atan2(nx, nz), r = h(sg + 5), cx = bx + nx * hb / 2, cz = bz + nz * hb / 2, tx = -nz, tz = nx;
      if (r < .6) { if (fits(cx, cz, rot, 20.5, 14.5)) { emit(KI.warehouse2, cx, cz, rot, 1, 1, h(sg + 7)); for (let k = 0; k < 3; k++) if (h(sg * 9 + k) < .6) emit(KI.car, cx + tx * (-12 + k * 9) + nx * 19, cz + tz * (-12 + k * 9) + nz * 19, rot, 1.15, 1.2, .99 - h(k) * .19); emit(KI.dumpster, cx + tx * 22, cz + tz * 22, rot, 1, 1, h(sg + 9)); } }
      else if (r < .8) { for (const a of [-1, 1]) for (const b of [-1, 1]) { const x = cx + tx * a * 13 + nx * b * 11, z = cz + tz * a * 13 + nz * b * 11; if (fits(x, z, 0, 7.4, 7.4, 2)) emit(KI.tank, x, z, 0, .7 + h(a + b * 3 + sg) * .4, .7 + h(a * 3 + b + sg) * .6, h(a + b + 40)); } }
      else if (fits(cx, cz, rot, 25.5, 16.5)) emit(KI.factory, cx, cz, rot, 1, 1, h(sg + 11));
      const gx = cx - nx * 2, gz = cz - nz * 2; if (h(sg + 13) < .7 && fits(gx, gz, rot, 24, 24, 1.2)) emit(KI.pavement, gx, gz, rot, hb * 1.85, hb - 2, PAVE.asphalt / 6 + .01);
    }
  }
  // ---- commercial strips along the major roads (in small towns the highway *is* main street)
  function strips(c, P, emit) {
    const town = c.town, hi = town ? P.R * 1.6 : P.R * 1.35, band = P.n * P.S + 40, occ = [], ivl = []; let elev = !P.elevator, gasN = 0;
    for (const r of D.roads) {
      if (r.k > 1 || (!town && r.k === 0)) continue; const p = r.pts, np = p.length / 2; let near = false;
      for (let i = 0; i < np; i += 2) if (Math.abs(p[i * 2] - c.x) < hi + 60 && Math.abs(p[i * 2 + 1] - c.z) < hi + 60) { near = true; break; } if (!near) continue;
      let acc = 0;
      for (let i = 0; i + 1 < np; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, L = Math.hypot(dx, dz) || 1, tx = dx / L, tz = dz / L;
        for (let t = (6 - acc % 6) % 6; t < L; t += 6) {
          const x = ax + tx * t, z = az + tz * t, dd = Math.hypot(x - c.x, z - c.z), sa = acc + t; if (dd > hi) continue;
          const core = town && dd < P.R * .8, inBand = Math.max(Math.abs(x - c.x), Math.abs(z - c.z)) < band; if (!core && (Math.round(sa / 6) % 5)) continue; if (!town && inBand) continue;
          for (const sd of [1, -1]) {
            const hh = (k) => hash2(Math.round(sa / 6) | 0, r.id * 2 + (sd > 0 ? 1 : 0), P.key + k * 31), nx = -tz * sd, nz = tx * sd, rot = Math.atan2(-nx, -nz), roll = hh(1);
            let kn;
            if (core) kn = roll < .42 ? 'shop_2st' : roll < .6 ? 'shop_wide' : roll < .74 ? 'shop_1st' : roll < .82 ? 'gas_store' : null;
            else { if (roll > (town ? .85 : .6)) continue;
              if (!elev && dd > P.R * .7 && roll < .3) kn = 'grain_elevator'; else if (roll < .12) kn = 'gas_store'; else if (roll < .2) kn = 'motel'; else if (roll < (town ? .34 : .34)) kn = 'shop_1st'; else if (!town && roll < .44) kn = 'strip_mall'; else if (!town && roll < .49) kn = 'big_box'; else if (roll < .5) kn = 'warehouse2'; else kn = town ? (roll < .68 ? 'house_ranch' : roll < .78 ? 'bungalow' : 'house_2st') : 'shop_1st'; }
            if (!kn) continue; if (kn === 'gas_store' && gasN++ >= (town ? 2 : 6)) kn = 'shop_1st';
            const K = KIND[KI[kn]], hx = K.col[1], hz = K.col[3], row = kn === 'shop_2st' || kn === 'shop_wide' || (core && kn === 'shop_1st'), front = row ? 4 : kn === 'gas_store' ? 22 : kn === 'grain_elevator' ? 16 : kn === 'big_box' ? 40 : kn.startsWith('house') || kn === 'bungalow' ? 9 : 13;
            if (town && inBand && front + 2 * hz > 38) continue;
            const off = r.hw + 4 + front + hz, X = x + nx * off, Z = z + nz * off, rad = Math.hypot(hx, hz) * .9;
            if (ivl.some((o) => o[0] === r.id && o[1] === sd && sa + hx > o[2] && sa - hx < o[3])) continue;
            if (occ.some((o) => Math.hypot(o[0] - X, o[1] - Z) < o[2] + rad)) continue;
            if (!fits(X, Z, rot, hx + .3, hz + .3, row ? 2.2 : 3) || !fits(x + nx * (r.hw + 4 + front / 2), z + nz * (r.hw + 4 + front / 2), rot, Math.min(hx, 8), Math.max(.5, front / 2 - 2), 1.5)) continue;
            occ.push([X, Z, rad]); ivl.push([r.id, sd, sa - hx - (row ? .05 : 3), sa + hx + (row ? .05 : 3)]); const seed = hh(2); emit(KI[kn], X, Z, rot, 1, 1, seed);
            const fx = X - nx * (hz + front / 2), fz = Z - nz * (hz + front / 2);
            if (row) { emit(KI.pavement, fx, fz, rot, 2 * hx + .1, front + .2, PAVE.concrete / 6 + .01); if (hh(5) < .35) emit(hh(6) < .5 ? KI.bench : KI.trash_can, fx + tx * hx * .5 - nx * 1, fz + tz * hx * .5 - nz * 1, rot, 1, 1, hh(7)); if (hh(8) < .3) emit(KI.street_light, fx - nx * (front / 2 - .6), fz - nz * (front / 2 - .6), rot, 1, 1, hh(9)); continue; }
            if (kn === 'grain_elevator') { elev = true; emit(KI.pavement, fx, fz, rot, 2 * hx + 6, front, PAVE.gravel / 6 + .01); continue; }
            if (kn === 'gas_store') { const gx = X - nx * (hz + 10.5), gz = Z - nz * (hz + 10.5); emit(KI.gas_canopy, gx, gz, rot, 1, 1, seed); emit(KI.pavement, fx, fz, rot, 2 * hx + 16, front, PAVE.concrete / 6 + .01); if (hh(3) < .6) emit(KI.car, gx + tx * 3.4 - nx * 2.6, gz + tz * 3.4 - nz * 2.6, rot + Math.PI / 2, 1, 1, hh(4)); continue; }
            if (kn.startsWith('house') || kn === 'bungalow') { emit(KI.pavement, fx, fz, rot, 3.4, front, PAVE.concrete / 6 + .01); if (hh(3) < .6) emit(KI.car, fx, fz, rot, 1, 1, hh(4)); if (hh(5) < .6) emit(KI.oak, fx + tx * (hx + 3), fz + tz * (hx + 3), hh(6) * 6, .8, .9, hh(7)); continue; }
            emit(KI.pavement, fx, fz, rot, 2 * hx + 4, front, PAVE.parking / 6 + .01); const nc = Math.floor(2 * hx / 3.2); for (let k = 0; k < nc; k++) if (hh(10 + k) < .45) { const u = (k - nc / 2 + .5) * 3.1; emit(KI.car, fx + tx * u - nx * 2, fz + tz * u - nz * 2, rot + (hh(20 + k) < .5 ? 0 : Math.PI), 1, 1, hh(30 + k)); }
          }
        }
        acc += L;
      }
    }
  }
  return { city, plan, fits };
}

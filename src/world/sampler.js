// Pure samplers over the baked world data. No three.js, no allocation in hot paths. Used by main thread, worker and node.
import { gnoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { toLatLon } from '../core/geo.js';
export const CELL = 200, GX = 512, GZ = 328, OX = -51200, OZ = -32800;          // macro grid
export const RC = 128, RGX = 800, RGZ = 512, ROX = -51200, ROZ = -32768;        // road / river index
export const SEC = 800, SX0 = -63, SZ0 = -40, SNX = 126, SNZ = 80;              // farm sections
export const FAR_E = 48;
// road ribbon cross-sections (interstate, highway, street): lateral offsets u and height offsets on top of the crowned
// grade line y - CROWN*min(|u|,hw). Shared by roadmesh.js (mesh) and the grading below (terrain must stay under it).
export const CROWN = .018;
export const XS = [[-11.3, -10.2, -5, 0, 5, 10.2, 11.3], [-6.3, -5.2, -2.6, 0, 2.6, 5.2, 6.3], [-7.6, -7.45, -5.1, -5, 0, 5, 5.1, 7.45, 7.6]];
export const YS = [[-.32, .015, .03, .04, .03, .015, -.32], [-.32, .015, .03, .04, .03, .015, -.32], [-.4, .15, .15, .0, .03, .0, .15, .15, -.4]];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sst = (a, b, v) => { let t = (v - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const cub = (a, b, c, d, t) => b + .5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
// EDGE: flat graded footprint (axis distance) per class; HWK: paved half width; PRI: blend priority outside footprints;
// FP: dominance inside a footprint (a higher class footprint always owns a junction); SURF: half width of the drawn top
// surface (street incl. sidewalk); SKIRT: where the ribbon skirt reaches the ground; SINK: terrainAt drop under ribbons
export const EDGE = [12.7, 7.2, 7.8, 4.6], HWK = [10.2, 5.2, 5, 3.6], INFK = [100, 90, 34, 34];
const PRI = [64, 16, 1, 4], FP = [1e8, 1e6, 1e2, 1e4], SURF = [10.2, 5.2, 7.45, 0], SKIRT = [11.3, 6.3, 7.6, 0], SINK = .16;
// cubic Hermite road profile on a segment: y0,y1 heights, m0,m1 tangents (height per unit t)
export const herm = (y0, y1, m0, m1, t) => { const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (3 * t2 - 2 * t3) * y1 + (t3 - t2) * m1; };
export const CROPS = ['natural', 'pasture', 'wheat', 'goldwheat', 'corn', 'soy', 'plowed', 'hay', 'cotton', 'stubble'];

export function makeSampler(data) {
  const M = data.mac, seg = data.seg, segIdx = data.segIdx, riv = data.rivSeg, rivIdx = data.rivIdx, hasRoads = !!(data.roads && seg);
  const S = seg?.S, SB = seg?.B, SR = seg?.R, SM = seg?.M, KR = hasRoads ? Uint8Array.from(data.roads, (r) => r.k) : null;
  // outputs of last height call: signed distances to road edges (by class) and river bank
  const O = { eMaj: 99, eGrv: 99, eStr: 99, eRiv: 999, rivY: -Infinity, rough: 0, mesa: 0, deck: false };
  const P = { h: 0, rough: 0, mesa: 0, roll: 0 };
  function macro(x, z) {
    let u = (x - OX) / CELL, v = (z - OZ) / CELL; u = u < 1 ? 1 : u > GX - 2.001 ? GX - 2.001 : u; v = v < 1 ? 1 : v > GZ - 2.001 ? GZ - 2.001 : v;
    const i = u | 0, j = v | 0, a = u - i, b = v - j, k = (j * GX + i) * 4, r = GX * 4;
    const k0 = k - r, k2 = k + r, k3 = k2 + r;
    P.h = cub(cub(M[k0 - 4], M[k0], M[k0 + 4], M[k0 + 8], a), cub(M[k - 4], M[k], M[k + 4], M[k + 8], a), cub(M[k2 - 4], M[k2], M[k2 + 4], M[k2 + 8], a), cub(M[k3 - 4], M[k3], M[k3 + 4], M[k3 + 8], a), b);
    const c = 1 - a, d = 1 - b, w0 = c * d, w1 = a * d, w2 = c * b, w3 = a * b;
    P.rough = M[k + 1] * w0 + M[k + 5] * w1 + M[k2 + 1] * w2 + M[k2 + 5] * w3;
    P.mesa = M[k + 2] * w0 + M[k + 6] * w1 + M[k2 + 2] * w2 + M[k2 + 6] * w3;
    P.roll = M[k + 3] * w0 + M[k + 7] * w1 + M[k2 + 3] * w2 + M[k2 + 7] * w3;
    return P.h;
  }
  function bil(A, x, z) { let u = (x - OX) / CELL, v = (z - OZ) / CELL; u = clamp(u, 0, GX - 1.001); v = clamp(v, 0, GZ - 1.001); const i = u | 0, j = v | 0, a = u - i, b = v - j, k = j * GX + i; return (A[k] * (1 - a) + A[k + 1] * a) * (1 - b) + (A[k + GX] * (1 - a) + A[k + GX + 1] * a) * b; }
  function bil4(A, c, x, z) { let u = (x - OX) / CELL, v = (z - OZ) / CELL; u = clamp(u, 0, GX - 1.001); v = clamp(v, 0, GZ - 1.001); const i = u | 0, j = v | 0, a = u - i, b = v - j, k = (j * GX + i) * 4 + c, r = GX * 4; return ((A[k] * (1 - a) + A[k + 4] * a) * (1 - b) + (A[k + r] * (1 - a) + A[k + r + 4] * a) * b) / 255; }
  const coastAt = (x, z) => bil(data.coast, x, z);
  const macroAt = (x, z) => macro(x, z), mesaRaw = (x, z) => { macro(x, z); return P.mesa; };

  // natural ground (no roads)
  function groundAt(x, z) {
    let h = macro(x, z); const ro = P.roll, rg = P.rough, me = P.mesa;
    h += ro * (gnoise(x * .00078, z * .00078, 1) * 8.5 + gnoise(x * .0026, z * .0026, 2) * 2.6);
    h += (.35 + .65 * ro) * gnoise(x * .0093, z * .0093, 3) * .55 + gnoise(x * .041, z * .041, 4) * .09;
    if (rg > .012) {
      const a = 1 - Math.abs(gnoise(x * .0019, z * .0019, 21)), b = 1 - Math.abs(gnoise(x * .0041 + 3.1, z * .0041, 22)), c = 1 - Math.abs(gnoise(x * .0093, z * .0093 + 7.7, 23)), d = gnoise(x * .021, z * .021, 24), e = gnoise(x * .052, z * .052, 25);
      const w = a * a, q = w * b; h += rg * ((w - .55) * 92 + (b * b - .55) * 46 * (.35 + w) + (c * c - .5) * 24 * (.3 + q) + d * 8 * (.4 + c * .6) + e * 2.6);
    }
    if (me > .012) {
      const n = gnoise(x * .00135, z * .00135, 31) + .42 * gnoise(x * .0043, z * .0043, 32) + .13 * gnoise(x * .014, z * .014, 33) + .05 * gnoise(x * .045, z * .045, 34);
      const t1 = sst(.1, .155, n), t2 = sst(.33, .375, n), t0 = sst(-.12, .1, n);
      h += me * (t0 * 13 + t1 * 44 + t2 * 36 + sst(.16, .33, n) * 9) - me * sst(-.1, -.5, n) * 10;
    }
    O.eRiv = 999; O.rivY = -Infinity; O.rough = rg; O.mesa = me;
    if (riv) h = riverCarve(x, z, h);
    return h;
  }
  function riverCarve(x, z, h) {
    const ci = Math.floor((x - ROX) / RC), cj = Math.floor((z - ROZ) / RC); if (ci < 0 || cj < 0 || ci >= RGX || cj >= RGZ) return h; const c = cj * RGX + ci, e = rivIdx.off[c + 1]; let best = 1e9, wy = 0, hw = 0;
    for (let q = rivIdx.off[c]; q < e; q++) {
      const a = rivIdx.ref[q] * 8, ax = riv[a], az = riv[a + 1], dx = riv[a + 2] - ax, dz = riv[a + 3] - az; let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz); t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = x - ax - dx * t, ez = z - az - dz * t, w = riv[a + 6] + (riv[a + 7] - riv[a + 6]) * t, d = Math.sqrt(ex * ex + ez * ez) - w; if (d < best) { best = d; wy = riv[a + 4] + (riv[a + 5] - riv[a + 4]) * t; hw = w; }
    }
    if (best < 95) {
      const n = gnoise(x * .035, z * .035, 41) * 3.5; best += n; O.eRiv = best; O.rivY = wy;
      const hb = Math.max(h, wy + 1.5 - 60 * sst(40, 95, best)), t = sst(-7, 26, best), bed = wy - Math.min(3.6, .6 + hw * .07); let y = bed + (hb - bed) * t;
      if (best > 0 && y < wy + .25) y = Math.max(y, Math.min(hb, wy + best * .04)); return y;
    }
    return h;
  }
  // full height; deck=true -> includes bridge decks
  function grade(x, z, h, deck) {
    O.eMaj = O.eGrv = O.eStr = 99; O.deck = false; if (!hasRoads) return h;
    const ci = Math.floor((x - ROX) / RC), cj = Math.floor((z - ROZ) / RC); if (ci < 0 || cj < 0 || ci >= RGX || cj >= RGZ) return h;
    const c = cj * RGX + ci, off = segIdx.off, e1 = off[c + 1]; let q = off[c]; if (q === e1) return h; const ref = segIdx.ref;
    // Only the nearest segment of each road counts (segments of one road are contiguous in the cell list): blending a
    // road's other segments in used their clamped end heights and biased the surface on vertical curves (bumps).
    let ws = 0, ys = 0, wm = 0, em = 99, dk = -1e9, sk = 0, cr = -1, bd = 1e18, bs = -1, bt = 0, nd = 1e18, ns = -1, nt = 0;
    for (; ; q++) {
      const s = q < e1 ? ref[q] : -1, r = s < 0 ? -2 : SR[s];
      if (r !== cr) {
        if (cr >= 0) {
          const k = KR[cr], inf = INFK[k], hw = HWK[k]; let dry = 1e9;
          if (SB[bs] && bd < (hw + .8) * (hw + .8)) { // bridge deck
            const d = Math.sqrt(bd), a = bs * 6, ry = (SM ? herm(S[a + 4], S[a + 5], SM[bs * 2], SM[bs * 2 + 1], bt) : S[a + 4] + (S[a + 5] - S[a + 4]) * bt) - (d < hw ? d : hw) * CROWN;
            dry = ry - 1.7; if (deck && ry > dk) dk = ry; if (k < 2 && d - hw < O.eMaj) O.eMaj = d - hw;
          }
          if (ns >= 0 && nd < inf * inf) {
            const d = Math.sqrt(nd), a = ns * 6; let ry = (SM ? herm(S[a + 4], S[a + 5], SM[ns * 2], SM[ns * 2 + 1], nt) : S[a + 4] + (S[a + 5] - S[a + 4]) * nt) - (d < hw ? d : hw) * CROWN, e = d - EDGE[k], u = d - hw; if (ry > dry) ry = dry; // abutment: never grade above the deck
            if (k < 2) { if (u < O.eMaj) O.eMaj = u; } else if (k === 3) { if (u < O.eGrv) O.eGrv = u; } else if (u < O.eStr) O.eStr = u;
            let w = 1; if (e > 0) { const df = ry > h ? ry - h : h - ry, mx = inf - EDGE[k], bw = k > 1 ? Math.min(mx, 9 + df * 1.6) : Math.min(mx, 16 + 2.4 * df); if (e >= bw) w = 0; else { const f = e / bw; w = 1 - f * f * (3 - 2 * f); } }
            if (w > 0) {
              if (k !== 2 && e < em) em = e; else if (k === 2 && e < 0) em = -1;
              const w2 = w * w, w4 = w2 * w2 * PRI[k] + (e < 1.5 ? FP[k] * (e <= 0 ? 1 : 1 - sst(0, 1.5, e)) : 0); ws += w4; ys += w4 * ry; if (w > wm) wm = w;
              if (k < 3) { const v = d - SURF[k], g = v <= 0 ? 1 : 1 - sst(0, (SKIRT[k] - SURF[k]) * .6, v); if (g > sk) sk = g; } // under a drawn ribbon
            }
          }
        }
        if (s < 0) break; cr = r; bd = nd = 1e18; bs = ns = -1;
      }
      const a = s * 6, ax = S[a], az = S[a + 1], dx = S[a + 2] - ax, dz = S[a + 3] - az, px = x - ax, pz = z - az; let t = (px * dx + pz * dz) / (dx * dx + dz * dz); t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px - dx * t, ez = pz - dz * t, d2 = ex * ex + ez * ez;
      if (d2 < bd) { bd = d2; bs = s; bt = t; } if (!SB[s] && d2 < nd) { nd = d2; ns = s; nt = t; }
    }
    if (ws > 0) { h += (ys / ws - h) * wm; if (em > 0 && em < 8) { const f = em / 8; h -= .95 * 6.75 * f * (1 - f) * (1 - f); } }
    if (dk > -1e8 && dk > h - .5) { O.deck = true; return dk; }
    // terrainAt (render/placement ground) sits SINK below the ribbon so coarse terrain LODs never poke through it;
    // heightAt (physics) stays exactly on the road surface
    return deck ? h : h - sk * SINK;
  }
  const heightAt = (x, z) => grade(x, z, groundAt(x, z), true);
  const terrainAt = (x, z) => grade(x, z, groundAt(x, z), false);
  function waterLevelAt(x, z) {
    let u = Math.round((x - OX) / CELL), v = Math.round((z - OZ) / CELL); u = clamp(u, 0, GX - 1); v = clamp(v, 0, GZ - 1); const k = v * GX + u; let w = -Infinity;
    if (data.coast[k] < 450) { if (groundAt(x, z) < .15 && coastAt(x, z) < 260) return 0; }
    if (data.lakeI && data.lakeI[k] !== 255) { const L = data.lakes[data.lakeI[k]]; if (groundAt(x, z) < L.level + .1 && macro(x, z) < L.level + .6) return L.level; } // macro test: river valleys cut below a nearby lake's level are not lake
    if (riv) { groundAt(x, z); if (O.eRiv < 7) w = O.rivY; }
    return w;
  }
  const Fd = { crop: 0, edge: 99, u: 0, v: 0, sx: 0, sz: 0, q: 0, dir: 0, yard: 99 };
  // farm field at a point (mirrors GLSL in terrainMaterial.js)
  function fieldAt(x, z) {
    const sx = Math.floor(x / SEC), sz = Math.floor(z / SEC), i = sx - SX0, j = sz - SZ0; Fd.crop = 0; Fd.edge = 99; Fd.yard = 99; Fd.sx = sx; Fd.sz = sz; if (!data.sec || i < 0 || j < 0 || i >= SNX || j >= SNZ) return Fd;
    const e = (j * SNX + i) * 4, R = data.sec[e], mode = R & 7, lx = x - sx * SEC, lz = z - sz * SEC, A = data.sec[e + 3];
    if (R & 128) { const yx = lx - 62, yz = lz - (150 + A / 255 * 480), d1 = Math.sqrt(yx * yx + yz * yz) - 34, d2 = Math.max(Math.abs(yz) - 3.2, Math.max(lx - 62, -lx)); Fd.yard = d1 < d2 ? d1 : d2; }
    if (!mode) return Fd; const H = SEC / 2; let q = 0, ex = Math.min(lx, SEC - lx), ez = Math.min(lz, SEC - lz);
    if (mode === 2 || mode >= 4) { q += lx > H ? 1 : 0; ex = Math.min(ex, Math.abs(lx - H) + 8); }
    if (mode === 3) { q += lz > H ? 1 : 0; ez = Math.min(ez, Math.abs(lz - H) + 8); } if (mode >= 4) { q += lz > H ? 2 : 0; ez = Math.min(ez, Math.abs(lz - H) + 8); }
    Fd.q = q; let c = (data.sec[e + 1 + (q >> 1)] >> ((q & 1) * 4)) & 15, edge = Math.min(ex, ez) - 11.5;
    if (mode === 5) { const qx = lx - (lx > H ? H * 1.5 : H * .5), qz = lz - (lz > H ? H * 1.5 : H * .5), d = 182 - Math.sqrt(qx * qx + qz * qz); if (d > 0) edge = d; else { c = 1; edge = Math.min(edge, -d); } }
    Fd.dir = (A >> q) & 1; Fd.edge = edge; Fd.crop = edge > 0 ? c : 0; return Fd;
  }
  const B = { forest: 0, arid: 0, red: 0, urban: 0, swamp: 0 };
  function bio(x, z) { B.forest = bil4(data.bioA, 0, x, z); B.arid = bil4(data.bioA, 1, x, z); B.red = bil4(data.bioA, 2, x, z); B.urban = bil4(data.bioA, 3, x, z); B.swamp = bil4(data.bioB, 0, x, z); return B; }
  const snowLine = (z) => 640 - (toLatLon(0, z).lat - 37) * 30;
  // local forest coverage 0..1 incl. clumping
  function forestAt(x, z) { const f = bil4(data.bioA, 0, x, z); if (f < .01) return 0; const n = gnoise(x * .0047, z * .0047, 51) * .6 + gnoise(x * .0017, z * .0017, 52) * .55; return f > .8 ? clamp(.9 + n * .5, 0, 1) : sst(.16, .42, n * .5 + f * .72 - .02) * clamp(.35 + f, 0, 1); }

  // signed distance to the edge of any road that has priority over road `id` (higher class, or same class and built
  // earlier: at a street crossing the earlier street owns the intersection, the later one is clipped there)
  function otherEdge(x, z, id) {
    const ci = Math.floor((x - ROX) / RC), cj = Math.floor((z - ROZ) / RC); if (ci < 0 || cj < 0 || ci >= RGX || cj >= RGZ) return 99; const c = cj * RGX + ci, own = KR[id]; let m = 99;
    for (let q = segIdx.off[c], e = segIdx.off[c + 1]; q < e; q++) { const s = segIdx.ref[q], r = SR[s]; if (r === id) continue; const k = KR[r]; if (k > own || (k === own && r > id) || k === 3) continue; const a = s * 6, ax = S[a], az = S[a + 1], dx = S[a + 2] - ax, dz = S[a + 3] - az; let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz); t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = x - ax - dx * t, ez = z - az - dz * t, d = Math.sqrt(ex * ex + ez * ez) - HWK[k]; if (d < m) m = d; }
    return m;
  }
  // ---- nearest road
  const nr = { x: 0, z: 0, y: 0, dist: 1e9, dirX: 0, dirZ: -1, width: 8, name: '', kind: '', road: -1, seg: -1, s: 0 };
  function nearest(x, z, maxKind = 3, noStreet = false) {
    const ci = Math.floor((x - ROX) / RC), cj = Math.floor((z - ROZ) / RC); let best = 1e18, bs = -1, bt = 0, stop = 40;
    for (let r = 0; r <= stop && r < 40; r++) {
      for (let j = cj - r; j <= cj + r; j++) { if (j < 0 || j >= RGZ) continue; const edge = j === cj - r || j === cj + r; for (let i = ci - r; i <= ci + r; i += edge ? 1 : Math.max(1, 2 * r)) {
        if (i < 0 || i >= RGX) continue; const c = j * RGX + i; for (let q = segIdx.off[c], e = segIdx.off[c + 1]; q < e; q++) { const s = segIdx.ref[q]; { const kk = KR[SR[s]]; if (kk > maxKind || (noStreet && kk === 2)) continue; } const a = s * 6, ax = S[a], az = S[a + 1], dx = S[a + 2] - ax, dz = S[a + 3] - az; let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz); t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = x - ax - dx * t, ez = z - az - dz * t, d = ex * ex + ez * ez; if (d < best) { best = d; bs = s; bt = t; } }
      } }
      if (bs >= 0 && stop === 40) stop = Math.min(39, Math.ceil(Math.sqrt(best) / RC) + (r === 0 ? 0 : 0));
    }
    if (bs < 0 || best > (38 * RC) ** 2) for (let s = 0; s < seg.n; s++) { { const kk = KR[SR[s]]; if (kk > maxKind || (noStreet && kk === 2)) continue; } const a = s * 6, ax = S[a], az = S[a + 1], dx = S[a + 2] - ax, dz = S[a + 3] - az; let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz); t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = x - ax - dx * t, ez = z - az - dz * t, d = ex * ex + ez * ez; if (d < best) { best = d; bs = s; bt = t; } }
    if (bs < 0) return nr; const a = bs * 6, dx = S[a + 2] - S[a], dz = S[a + 3] - S[a + 1], l = Math.sqrt(dx * dx + dz * dz) || 1, rd = data.roads[SR[bs]];
    nr.x = S[a] + dx * bt; nr.z = S[a + 1] + dz * bt; nr.y = S[a + 4] + (S[a + 5] - S[a + 4]) * bt; nr.dist = Math.sqrt(best); nr.dirX = dx / l; nr.dirZ = dz / l; nr.width = rd.hw * 2; nr.name = rd.name; nr.kind = rd.kind; nr.road = rd.id; nr.seg = bs; nr.s = rd.s[seg.I[bs]] + l * bt; return nr;
  }
  const stateAt = (x, z) => { const i = Math.round((x - OX) / CELL), j = Math.round((z - OZ) / CELL); if (i < 0 || j < 0 || i >= GX || j >= GZ) return ''; const s = data.stateGrid[j * GX + i]; return s ? data.stateNames[s - 1] : ''; };
  return { data, O, P, B, macroAt, mesaRaw, coastAt, groundAt, heightAt, terrainAt, grade, waterLevelAt, fieldAt, bio, forestAt, snowLine, nearest, otherEdge, stateAt, bil4, hash2 };
}

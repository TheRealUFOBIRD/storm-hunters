// Deterministic object placement per 512 m sector (runs in the worker). No three.js.
import { KI, STRIDE, SS, SOX, SOZ, SGX } from './kinds.js';
import { RC, RGX, RGZ, ROX, ROZ, SEC } from './sampler.js';
import { hash2 } from '../core/rng.js';
import { gnoise } from '../core/noise.js';
import { toLatLon } from '../core/geo.js';

export function makeLayout(s) {
  const D = s.data, roads = D.roads, seg = D.seg, O = s.O;
  // cities passed by each major road (for guide signs)
  const passes = roads.map((r) => { if (r.k > 1) return null; const a = []; for (const c of D.cities) { let best = 1e18, bs = 0; const p = r.pts; for (let i = 0; i < p.length; i += 4) { const d = (p[i] - c.x) ** 2 + (p[i + 1] - c.z) ** 2; if (d < best) { best = d; bs = r.s[i / 2]; } } if (best < (c.radius * 1.2) ** 2) a.push([bs, c.name, c.pop]); } return a.sort((x, y) => x[0] - y[0]); });
  const at = (r, s0, o) => { // point & tangent at arclength
    const p = r.pts, n = p.length / 2; let lo = 0, hi = n - 1; s0 = Math.max(0, Math.min(r.len, s0)); while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.s[m] <= s0) lo = m; else hi = m; }
    const f = (s0 - r.s[lo]) / Math.max(1e-6, r.s[hi] - r.s[lo]), dx = p[hi * 2] - p[lo * 2], dz = p[hi * 2 + 1] - p[lo * 2 + 1], l = Math.hypot(dx, dz) || 1; o.x = p[lo * 2] + dx * f; o.z = p[lo * 2 + 1] + dz * f; o.tx = dx / l; o.tz = dz / l; o.y = r.y[lo] + (r.y[hi] - r.y[lo]) * f; return o;
  };
  const roadClear = (x, z, m) => { s.heightAt(x, z); return O.eMaj > m && O.eStr > m * .8 && O.eGrv > m * .6; };
  function sector(si, sj) {
    const x0 = SOX + si * SS, z0 = SOZ + sj * SS, x1 = x0 + SS, z1 = z0 + SS, items = [], wires = [], signs = [];
    const inS = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
    const put = (k, x, z, rot, sxz = 1, sy = 1, seed = hash2(x * 7 | 0, z * 7 | 0, k), y) => { items.push(k, x, y ?? s.terrainAt(x, z), z, rot, sxz, sy, seed); return items.length / STRIDE - 1; };
    const wet = (x, z) => s.waterLevelAt(x, z) > -1e8;
    // ---------- roadside
    const segs = new Set(); for (let cj = Math.floor((z0 - ROZ) / RC); cj < Math.ceil((z1 - ROZ) / RC); cj++) for (let ci = Math.floor((x0 - ROX) / RC); ci < Math.ceil((x1 - ROX) / RC); ci++) { if (ci < 0 || cj < 0 || ci >= RGX || cj >= RGZ) continue; const c = cj * RGX + ci; for (let q = D.segIdx.off[c]; q < D.segIdx.off[c + 1]; q++) segs.add(D.segIdx.ref[q]); }
    const P = {}, Q = {};
    for (const sg of segs) {
      const r = roads[seg.R[sg]], q = seg.I[sg], s0 = r.s[q], s1 = r.s[q + 1], k = r.k; if (k === 2) continue; const rh = hash2(r.id, 7, 1), bridge = seg.B[sg];
      const mark = (sp, off, fn) => { for (let t = Math.ceil(s0 / sp) * sp; t < s1; t += sp) { at(r, t, P); const x = P.x - P.tz * off, z = P.z + P.tx * off; if (inS(x, z)) fn(t, x, z); } };
      // utility poles + wires
      const hasPoles = k === 1 || (k === 3 && rh < .55) || (k === 0 && rh < .3);
      if (hasPoles && !bridge) { const side = r.id & 1 ? 1 : -1, off = side * (r.hw + (k === 3 ? 5.5 : k === 0 ? 20 : 10.5)), sp = k === 3 ? 52 : 46;
        mark(sp, off, (t, x, z) => { if (wet(x, z) || !roadClear(x, z, 1.5) || s.otherEdge(x, z, r.id) < 3 || s.bio(x, z).urban > .55) return; const y = s.terrainAt(x, z), rot = Math.atan2(P.tx, P.tz), i = put(KI.pole, x, z, rot, 1, .92 + hash2(t | 0, r.id, 3) * .16, undefined, y);
          at(r, t + sp, Q); const nx = Q.x - Q.tz * off, nz = Q.z + Q.tx * off; if (wet(nx, nz) || !roadClear(nx, nz, 1.5)) return; const ny = s.terrainAt(nx, nz), h = 10 * items[i * STRIDE + 6];
          for (const [u, dh] of [[-1.05, 0], [1.05, 0], [0, .9]]) { const ax = x + P.tz * u * 0 - P.tz * 0 + Math.cos(rot) * u, az = z - Math.sin(rot) * u, bx = nx + Math.cos(rot) * u, bz = nz - Math.sin(rot) * u; let px = ax, py = y + h - .25 + dh, pz = az; for (let w = 1; w <= 6; w++) { const f = w / 6, sag = Math.sin(Math.PI * f) * .9, X = ax + (bx - ax) * f, Y = y + h - .25 + dh + (ny - y) * f - sag, Z = az + (bz - az) * f; wires.push(px, py, pz, X, Y, Z, i); px = X; py = Y; pz = Z; } } }); }
      // fences
      if ((k === 1 || k === 3) && !bridge && rh > .12) for (const side of [1, -1]) { const off = side * (r.hw + (k === 3 ? 7.2 : 15.5));
        mark(6, off, (t, x, z) => { const blk = hash2(Math.floor(t / 400), r.id, side + 5); if (blk < .3) return; const f = s.fieldAt(x, z); if (f.yard < 6) return; const b = s.bio(x, z); if (b.urban > .3 || b.forest > .55 || wet(x, z) || !roadClear(x, z, 2.2) || s.otherEdge(x, z, r.id) < 8) return; put(KI.fence, x, z, Math.atan2(P.tx, P.tz) + Math.PI / 2); }); }
      if (k <= 1 && !bridge) {
        mark(600, r.hw + 2.6, (t, x, z) => { if (roadClear(x, z, -2)) put(KI.mile, x, z, Math.atan2(-P.tx, -P.tz)); });
        mark(1900, r.hw + 3.5, (t, x, z) => { if (s.otherEdge(x, z, r.id) > 4 && !wet(x, z)) put(KI.signSmall, x, z, Math.atan2(-P.tx, -P.tz), 1, 1, hash2(t | 0, r.id, 9)); });
        for (const dir of [1, -1]) mark(2900, dir * (r.hw + 4.5), (t, x, z) => {
          if (wet(x, z) || s.otherEdge(x, z, r.id) < 6 || s.bio(x, z).urban > .4) return; const ps = passes[r.id], lines = [];
          if (dir > 0) { for (const p of ps) if (p[0] > t + 300 && lines.length < 2) lines.push([p[1], Math.max(1, Math.round((p[0] - t) / 18.8 * .6214))]); } else { for (let i = ps.length - 1; i >= 0; i--) if (ps[i][0] < t - 300 && lines.length < 2) lines.push([ps[i][1], Math.max(1, Math.round((t - ps[i][0]) / 18.8 * .6214))]); }
          if (!lines.length) return; const rot = Math.atan2(-P.tx * dir, -P.tz * dir); const i = put(KI.signGreen, x, z, rot); signs.push({ i, route: r.name, lines });
        });
      }
    }
    // ---------- farm sections
    for (let sz = Math.floor(z0 / SEC); sz <= Math.floor((z1 - 1) / SEC); sz++) for (let sx = Math.floor(x0 / SEC); sx <= Math.floor((x1 - 1) / SEC); sx++) {
      const cx = sx * SEC, cz = sz * SEC; s.fieldAt(cx + 400, cz + 400); const i = sx + 63, j = sz + 40; if (i < 0 || j < 0 || i >= 126 || j >= 80) continue; const e = (j * 126 + i) * 4, R = D.sec[e], A = D.sec[e + 3], h = (n) => hash2(sx, sz, n);
      if (R & 128) { // farmstead
        const yx = cx + 62, yz = cz + 150 + A / 255 * 480, rot = h(1) * .2 - .1, rot2 = rot + Math.PI / 2;
        const B = [[KI.farmhouse, 4, -16, rot + Math.PI / 2], [KI.barn, 22, 10, rot], [h(3) < .5 ? KI.silo : KI.bin, 10, 26, 0], [KI.bin, 4, 30, 0], [KI.shed, -12, 18, rot2], [KI.bale, 32, -8, h(5) * 3]];
        if (h(4) < .7) B.push([KI.bin, 16, 30, 0]); if (h(6) < .4) B.push([KI.pumpjack, -2, 0, 9e9]);
        for (const [k, dx, dz, r] of B) { if (r > 1e9) continue; const x = yx + dx, z = yz + dz; if (inS(x, z) && !wet(x, z)) put(k, x, z, r, k === KI.silo || k === KI.bin ? .8 + h(dx) * .4 : 1, k === KI.silo ? .8 + h(dz) * .5 : 1); }
        for (let t = -40; t <= 50; t += 7) { const x = yx + 48 + (h(t + 9) - .5) * 2, z = yz + t; if (inS(x, z)) put(h(t) < .5 ? KI.cedar : KI.oak, x, z, h(t + 1) * 6.28, .8 + h(t + 2) * .5, .8 + h(t + 3) * .5); }
        for (let t = -10; t <= 48; t += 7) { const x = yx + t, z = yz - 44 + (h(t + 19) - .5) * 2; if (inS(x, z)) put(h(t + 4) < .6 ? KI.cedar : KI.cottonwood, x, z, h(t + 5) * 6.28, .8 + h(t + 6) * .4, .8 + h(t + 7) * .4); }
      }
      // windbreaks, bales, pumpjacks, turbines
      if ((R & 7) && h(11) < .3) { const z = cz + 13; for (let t = 20; t < 780; t += 8) { const x = cx + t; if (inS(x, z) && roadClear(x, z, 4)) put(h(t + 30) < .55 ? KI.cedar : KI.cottonwood, x, z + (h(t) - .5) * 2, h(t + 1) * 6.28, .8 + h(t + 2) * .45, .85 + h(t + 3) * .4); } }
      for (let q = 0; q < 4; q++) {
        const qx = cx + (q & 1) * 400 + 200, qz = cz + (q >> 1) * 400 + 200, lo = toLatLon(qx, qz).lon;
        const wf = gnoise(qx / 7000, qz / 7000, 808); if ((R & 7) && wf > .38 && lo < -97.5 && lo > -103) { const x = qx + 40, z = qz - 30; if (inS(x, z)) put(KI.turbine, x, z, 0, 1, .9 + h(q + 40) * .2); }
        if (h(q + 50) < .07 && lo > -102 && lo < -95.5 && toLatLon(qx, qz).lat < 37.3) { const x = qx + 120, z = qz + 90; if (inS(x, z) && roadClear(x, z, 10) && !wet(x, z)) put(KI.pumpjack, x, z, h(q + 51) * 6.28); }
        const f = s.fieldAt(qx, qz); if (f.crop === 7 || f.crop === 9) for (let b = 0; b < 14; b++) { const x = qx + (h(q * 40 + b) - .5) * 340, z = qz + (h(q * 40 + b + 20) - .5) * 340; if (inS(x, z) && s.fieldAt(x, z).crop > 1) put(KI.bale, x, z, h(b) * 6.28, 1, 1); }
      }
    }
    // ---------- natural trees / shrubs / rocks
    const C = 12;
    for (let z = z0; z < z1; z += C) for (let x = x0; x < x1; x += C) {
      const hx = hash2(x, z, 77), jx = x + hash2(x, z, 78) * C, jz = z + hash2(x, z, 79) * C; let f = s.forestAt(jx, jz); const b = s.bio(jx, jz), ar = b.arid;
      const g = s.terrainAt(jx, jz); if (O.eRiv < 70) f = Math.max(f, (1 - ar * .5) * .42 * (1 - Math.max(0, O.eRiv) / 70)); if (f < .03) f = .006 * (1 - ar);
      let kind = -1;
      if (hx < f) {
        const ll = toLatLon(jx, jz), mt = O.rough > .25 || g > 300, sp = hash2(x, z, 80);
        if (g > s.snowLine(jz) - 40 + hash2(x, z, 81) * 60) continue;
        if (ll.lat < 28.5 && sp < .5) kind = KI.palm; else if (ar > .55) kind = sp < .5 ? KI.mesquite : sp < .9 ? KI.cedar : KI.dead; else if (mt) kind = sp < .55 ? KI.pine : KI.spruce; else if (ll.lon > -95 && ll.lat < 36 && sp < .45) kind = KI.pine; else if (ll.lat > 45 && sp < .4) kind = KI.spruce;
        else kind = O.eRiv < 70 ? (sp < .6 ? KI.cottonwood : KI.oak) : sp < .55 ? KI.oak : sp < .75 ? KI.cottonwood : sp < .93 ? KI.cedar : KI.dead;
      } else if (hx < f + ar * .18 && hash2(x, z, 82) < .9) kind = (toLatLon(jx, jz).lon < -109 && ar > .8 && hash2(x, z, 83) < .25) ? KI.cactus : KI.shrub;
      else if (hx > .995 - O.rough * .04 - O.mesa * .03) kind = KI.rock;
      if (kind < 0) continue; if (b.urban > .45 && kind !== KI.oak) continue;
      if (wet(jx, jz) || !roadClear(jx, jz, kind === KI.shrub ? 3 : 6)) continue; const fd = s.fieldAt(jx, jz); if (fd.crop > 1 || fd.edge > -3 && fd.crop !== 0 && fd.crop !== 1 || fd.yard < 8) continue;
      const big = kind === KI.rock ? .6 + hash2(x, z, 84) * 1.8 : .75 + hash2(x, z, 84) * .55; put(kind, jx, jz, hash2(x, z, 85) * 6.283, big, big * (.85 + hash2(x, z, 86) * .3), hash2(x, z, 87), g - (kind === KI.rock ? .3 : 0));
    }
    // ---------- towns & cities
    for (const c of D.cities) {
      const Rr = c.radius * .96, S = c.block, n = Math.floor(Rr / S); if (c.x + Rr < x0 || c.x - Rr > x1 || c.z + Rr < z0 || c.z - Rr > z1) continue;
      for (let bj = -n; bj < n; bj++) for (let bi = -n; bi < n; bi++) {
        const bx = c.x + (bi + .5) * S, bz = c.z + (bj + .5) * S, d = Math.hypot(bx - c.x, bz - c.z) / Rr; if (d > .97 || !inS(bx, bz)) continue; const h = (k) => hash2(bi + 99, bj + 99, (c.x & 4095) + k);
        const lots = []; let type;
        if (!c.town && d < .2) type = 'tower'; else if (!c.town && d < .38) type = h(1) < .5 ? 'office' : 'apartment'; else if (c.town ? d < .28 : d < .55) type = h(2) < .7 ? 'shop' : h(2) < .85 ? 'warehouse' : 'gas'; else type = c.town && d > .7 && h(3) < .25 ? 'mobile' : 'house';
        if (c.town && bi === 0 && bj === 0) type = 'waterTower'; if (c.town && bi === -n && bj === 0) type = 'elevator'; if (h(4) < .05) type = 'church'; if (c.town && h(5) < .05) type = 'motel';
        if (type === 'tower' || type === 'office' || type === 'waterTower' || type === 'elevator' || type === 'church' || type === 'warehouse' || type === 'motel' || type === 'apartment') lots.push([0, 0, type === 'elevator' ? 0 : Math.PI / 2 * Math.floor(h(6) * 4) * (type === 'church' ? 1 : 0)]);
        else if (type === 'gas') lots.push([0, -18, 0]); else { const per = type === 'shop' ? [-38, -12, 14, 40] : [-36, 0, 36]; for (const px of per) { lots.push([px, -S / 2 + 20.5, Math.PI]); lots.push([px, S / 2 - 20.5, 0]); } }
        for (const [lx, lz, rot] of lots) {
          const x = bx + lx, z = bz + lz; if (wet(x, z) || !roadClear(x, z, type === 'tower' ? 14 : 7)) continue;
          const kn = type === 'house' ? (h(lx + lz * 3) < .5 ? KI.house : KI.house2) : KI[type]; const sy = type === 'tower' ? 1 + Math.min(3.2, c.pop / 9e5) * (1 - d / .2) * (.4 + h(7) * .8) : type === 'office' ? .8 + h(8) * .9 : 1;
          put(kn, x, z, rot + (type === 'house' ? (h(lx) - .5) * .06 : 0), 1, sy, h(lx * 7 + lz));
          if (type === 'house' && h(lx + 31) < .7) { const tx = x + (h(lx + 32) - .5) * 20, tz = z + (lz < 0 ? -1 : 1) * 15; put(h(lx + 33) < .7 ? KI.oak : KI.cottonwood, tx, tz, h(lx) * 6, .8, .8 + h(lz) * .3); }
        }
      }
    }
    // radio towers near towns
    const items32 = new Float32Array(items), w32 = new Float32Array(wires);
    return { items: items32, wires: w32, signs, buffers: [items32.buffer, w32.buffer] };
  }
  return { sector };
}

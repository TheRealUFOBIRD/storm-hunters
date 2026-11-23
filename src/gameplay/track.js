// Tornado track prediction, warning polygons, intercept assistant. Pure.
import { clamp, dirToHeading } from '../core/math.js';

export const motionOf = (t, o = {}) => {
  let vx = t.vx || 0, vz = t.vz || 0; const s = t.storm;
  if (Math.hypot(vx, vz) < 0.8 && s) { vx = s.vx || 0; vz = s.vz || 0; }
  o.vx = vx; o.vz = vz; o.speed = Math.hypot(vx, vz); o.heading = dirToHeading(vx, vz); return o;
};
const M = {};
// cone polygon (xz pairs) from the tornado along its motion for `secs`, +-spread radians
export function trackCone(t, secs = 480, spread = 0.2, out = []) {
  motionOf(t, M); const sp = Math.max(M.speed, 2), r0 = Math.max(120, (t.rCore || 60) * 2); out.length = 0;
  const ux = M.vx / sp || 0, uz = M.vz / sp || 0, L = sp * secs, w = r0 + Math.tan(spread) * L, px = -uz, pz = ux;
  out.push(t.x + px * r0, t.z + pz * r0, t.x + ux * L + px * w, t.z + uz * L + pz * w, t.x + ux * (L + w * 0.35), t.z + uz * (L + w * 0.35), t.x + ux * L - px * w, t.z + uz * L - pz * w, t.x - px * r0, t.z - pz * r0);
  return out;
}
// NWS style storm based polygon for a warned storm (4-5 pts)
export function warningPolygon(s, out = []) {
  const v = Math.max(2, Math.hypot(s.vx || 0, s.vz || 0)), ux = (s.vx || 0) / v || 0, uz = (s.vz || 0) / v || 0, px = -uz, pz = ux;
  const o = s.meso || s, w0 = Math.max(900, (s.radius || 4000) * 0.22), w1 = w0 * 1.9, L = v * 900 + w0 * 2; out.length = 0;
  out.push(o.x - ux * w0 + px * w0, o.z - uz * w0 + pz * w0, o.x + ux * L + px * w1, o.z + uz * L + pz * w1, o.x + ux * L * 1.02 - px * w1 * 0.8, o.z + uz * L * 1.02 - pz * w1 * 0.8, o.x - ux * w0 - px * w0 * 0.9, o.z - uz * w0 - pz * w0 * 0.9);
  return out;
}
export function inPoly(p, x, z) {
  let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) c = !c; return c;
}
// closest point of approach to a stationary observer: {t, dist, now, closing (m/s, + = approaching), along, cross}
export function approach(t, x, z, vx = 0, vz = 0, o = {}) {
  motionOf(t, M); const rx = t.x - x, rz = t.z - z, wx = M.vx - vx, wz = M.vz - vz, w2 = wx * wx + wz * wz, now = Math.hypot(rx, rz);
  const tc = w2 > 0.01 ? Math.max(0, -(rx * wx + rz * wz) / w2) : 0;
  o.t = tc; o.now = now; o.dist = Math.hypot(rx + wx * tc, rz + wz * tc); o.closing = now > 1 ? -(rx * wx + rz * wz) / now : 0;
  const sp = Math.max(0.5, M.speed); o.along = -(rx * M.vx + rz * M.vz) / sp; o.cross = (rx * M.vz - rz * M.vx) / sp; o.heading = M.heading; o.speed = M.speed; return o;
}
// Best road point to be at: lateral offset to the right (safe, inflow side) of the predicted track, reachable before the tornado
export function suggestIntercept(t, px, pz, roads, opts = {}) {
  motionOf(t, M); const sp = M.speed, offset = opts.offset ?? Math.max(700, (t.rCore || 80) * 6), car = opts.speed || 24, res = { x: 0, z: 0, eta: 0, lead: 0, score: -1e9, name: '' };
  const ux = sp > 0.5 ? M.vx / sp : 0, uz = sp > 0.5 ? M.vz / sp : 0, side = opts.side ?? 1; // right of motion (clockwise) = southeast side for NE movers
  for (let s = 45; s <= 900; s += 45) {
    for (const k of [1, 1.7]) {
      let x = t.x + ux * sp * s - uz * offset * k * side, z = t.z + uz * sp * s + ux * offset * k * side;
      const r = roads?.nearest?.(x, z); let nd = 0; if (r && r.dist < 2500) { nd = Math.hypot(r.x - x, r.z - z); x = r.x; z = r.z; }
      const cross = Math.abs((x - t.x) * uz - (z - t.z) * ux); if (cross < offset * 0.45) continue;
      const drive = Math.hypot(x - px, z - pz) * 1.35 / car, lead = s - drive; if (lead < (opts.margin ?? 40)) continue;
      const score = -drive * 0.5 - Math.abs(lead - 120) * 0.35 - nd * 0.02 - Math.abs(cross - offset) * 0.02;
      if (score > res.score) { res.score = score; res.x = x; res.z = z; res.eta = drive; res.lead = lead; res.name = r?.name || ''; }
    }
  }
  return res.score > -1e8 ? res : null;
}
export const polylineLength = (p) => { let d = 0; for (let i = 2; i < (p?.length || 0); i += 2) d += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return d; };
// distance along a route polyline remaining from nearest vertex, and index
export function routeProgress(p, x, z, o = {}) {
  let bi = 0, bd = 1e18, bx = 0, bz = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, l2 = dx * dx + dz * dz || 1e-6, k = clamp(((x - ax) * dx + (z - az) * dz) / l2), qx = ax + dx * k, qz = az + dz * k, d = (qx - x) ** 2 + (qz - z) ** 2;
    if (d < bd) { bd = d; bi = i; bx = qx; bz = qz; }
  }
  let rem = p.length >= 4 ? Math.hypot(p[bi + 2] - bx, p[bi + 3] - bz) : 0; for (let i = bi + 2; i + 3 < p.length; i += 2) rem += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  o.i = bi; o.off = Math.sqrt(bd); o.rem = rem; o.x = bx; o.z = bz;
  // next turn
  o.turn = 0; o.turnDist = 0; let acc = p.length >= 4 ? Math.hypot(p[bi + 2] - bx, p[bi + 3] - bz) : 0;
  for (let i = bi + 2; i + 3 < p.length && acc < 4000; i += 2) {
    const a = Math.atan2(p[i] - p[i - 2], -(p[i + 1] - p[i - 1])), b = Math.atan2(p[i + 2] - p[i], -(p[i + 3] - p[i + 1])); let d = b - a; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832;
    if (Math.abs(d) > 0.6) { o.turn = d; o.turnDist = acc; break; } acc += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  }
  return o;
}
export const threatOf = (t, dist, closing = 0) => {
  const r = Math.max(60, t.rCore || 60), k = 1 - clamp((dist - r * 2) / (2600 + (t.ef || 0) * 500)); return clamp(k * (0.75 + 0.06 * (t.ef || 0)) + clamp(closing / 30) * 0.2 * k);
};

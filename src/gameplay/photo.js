// Photo scoring. Pure maths, no three.js, testable in node.
import { clamp, smoothstep, MPH } from '../core/math.js';

// cam: {x,y,z, f:[3], r:[3], u:[3], tan (tan half vertical fov), aspect}
export function camFrom(camera, o = {}) {
  const e = camera.matrixWorld.elements;
  o.x = e[12]; o.y = e[13]; o.z = e[14];
  o.r = [e[0], e[1], e[2]]; o.u = [e[4], e[5], e[6]]; o.f = [-e[8], -e[9], -e[10]];
  o.tan = Math.tan(camera.fov * Math.PI / 360) / (camera.zoom || 1); o.aspect = camera.aspect; return o;
}
export function lookCam(x, y, z, heading, pitch, fovDeg, aspect = 16 / 9) {
  const ch = Math.cos(heading), sh = Math.sin(heading), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return { x, y, z, f: [sh * cp, sp, -ch * cp], r: [ch, 0, sh], u: [-sh * sp, cp, ch * sp], tan: Math.tan(fovDeg * Math.PI / 360), aspect };
}
export function project(c, x, y, z, o = {}) {
  const dx = x - c.x, dy = y - c.y, dz = z - c.z, d = dx * c.f[0] + dy * c.f[1] + dz * c.f[2];
  o.d = d; o.ok = d > 0.1; const k = 1 / (Math.max(d, 0.1) * c.tan);
  o.x = (dx * c.r[0] + dy * c.r[1] + dz * c.r[2]) * k / c.aspect; o.y = (dx * c.u[0] + dy * c.u[1] + dz * c.u[2]) * k;
  o.in = o.ok && Math.abs(o.x) < 1 && Math.abs(o.y) < 1; return o;
}
const thirds = (x) => 1 - clamp(Math.min(Math.abs(x), Math.abs(Math.abs(x) - 1 / 3)) / 0.62);
const prox = (d, near = 150, far = 8000) => clamp(1 - Math.log(Math.max(d, near) / near) / Math.log(far / near));
export const starsFor = (s) => (s >= 740 ? 5 : s >= 560 ? 4 : s >= 380 ? 3 : s >= 200 ? 2 : s >= 60 ? 1 : 0);
export const mmFromFov = (fovDeg) => 12 / Math.tan(fovDeg * Math.PI / 360);   // full-frame 24 mm sensor height
export const fovFromMm = (mm) => Math.atan(12 / mm) * 360 / Math.PI;

const P = {}, Q = {}, AX = { x: 0, z: 0 };
function tornadoGeom(S, t) {
  const c = S.cam, lcl = t.lcl || 900, y0 = t.y0 || 0, cond = clamp(t.condense ?? 1), n = 14;
  let inF = 0, cx = 0, minY = 9, maxY = -9, minX = 9, maxX = -9, vis = 0, vn = 0, sw = 0;
  for (let i = 0; i < n; i++) {
    const h = lcl * i / (n - 1); (S.axisAt || axisDefault)(t, h, AX); project(c, AX.x, y0 + h, AX.z, P);
    const condensed = h >= lcl * (1 - cond) - 1 || (h < 120 && t.dust > 0.2);
    if (!condensed || !P.ok) continue; sw++;
    if (P.in) { inF++; cx += P.x; minY = Math.min(minY, P.y); maxY = Math.max(maxY, P.y); const rw = (S.funnelRadius ? S.funnelRadius(t, h) : t.rCore) / (P.d * c.tan * c.aspect); minX = Math.min(minX, P.x - rw); maxX = Math.max(maxX, P.x + rw); if (S.visibility) { vis += S.visibility(AX.x, y0 + Math.max(h, 20), AX.z); vn++; } }
  }
  if (!inF) return null;
  (S.axisAt || axisDefault)(t, 0, AX); project(c, AX.x, y0 + 3, AX.z, Q);
  const dist = Math.hypot(t.x - c.x, t.z - c.z);
  return { dist, frac: inF / Math.max(1, sw), cx: cx / inF, minY, maxY, height: (maxY - minY) / 2, width: Math.min(2, maxX - minX) / 2, vis: vn ? vis / vn : 1, ground: Q.in, gy: Q.y, occluded: S.occluded ? S.occluded(t.x, y0 + lcl * 0.5, t.z) : false };
}
const axisDefault = (t, h, o) => { const k = h / (t.lcl || 900); o.x = t.x + (t.lean?.x || 0) * k * k; o.z = t.z + (t.lean?.z || 0) * k * k; return o; };

export const isNight = (h) => h < 5.6 || h > 20.4;
export const isGolden = (h) => (h > 18.2 && h < 20.2) || (h > 5.6 && h < 7.4);

// S: {cam, tornadoes, axisAt, funnelRadius, storms, lightning:[{x,y,z,tx,ty,tz,age}], visibility, occluded, weather, hour, sunDir:[3], cities, steady, focus}
export function scorePhoto(S) {
  const c = S.cam, tags = [], parts = [], add = (k, label, pts, max) => parts.push({ k, label, pts: Math.round(clamp(pts, 0, max)), max });
  const night = isNight(S.hour ?? 14), golden = isGolden(S.hour ?? 14);
  // lightning in frame
  let bolt = null;
  for (const l of S.lightning || []) {
    if (l.age > 0.4) continue; project(c, l.x, l.y ?? 800, l.z, P); project(c, l.tx ?? l.x, l.ty ?? 0, l.tz ?? l.z, Q);
    const mid = project(c, (l.x + (l.tx ?? l.x)) / 2, ((l.y ?? 800) + (l.ty ?? 0)) / 2, (l.z + (l.tz ?? l.z)) / 2, {});
    if (P.in || Q.in || mid.in) { bolt = { dist: Math.hypot((l.tx ?? l.x) - c.x, (l.tz ?? l.z) - c.z), cx: mid.x, full: P.in && Q.in, kind: l.kind || 'cg', k: (P.in + Q.in + mid.in) / 3 }; break; }
  }
  // candidates
  let best = null; const consider = (o) => { if (!best || o.rank > best.rank) best = o; };
  let nT = 0;
  for (const t of S.tornadoes || []) {
    if (t.stage === 'dead') continue; const g = tornadoGeom(S, t); if (!g || g.occluded || g.vis < 0.04) continue; nT++;
    consider({ kind: 'tornado', t, g, rank: 10 + g.frac * 2 + prox(g.dist) * 3 + (t.ef || 0) * 0.2 });
  }
  for (const s of S.storms || []) {
    const top = s.cloudTop || 11000, base = s.cloudBase || 900, y0 = S.groundY || 0;
    if (s.type === 'supercell' && s.meso && (s.rotation ?? 0) > 0.4) {
      project(c, s.meso.x, y0 + base * 0.92, s.meso.z, P); const d = Math.hypot(s.meso.x - c.x, s.meso.z - c.z), ang = (s.meso.r || 900) / (Math.max(P.d, 1) * c.tan * c.aspect), vis = S.visibility ? S.visibility(s.meso.x, y0 + base * 0.8, s.meso.z) : 1;
      if (P.in && d < 14000 && vis > 0.05) consider({ kind: 'wallcloud', s, d, cx: P.x, cy: P.y, size: ang, vis, rank: 5 + s.rotation * 2 + prox(d) });
    }
    if (s.type === 'squall') {
      const hx = Math.sin(s.heading || 0), hz = -Math.cos(s.heading || 0), r = (s.radius || 4000) * 0.75, x = s.x + hx * r, z = s.z + hz * r;
      project(c, x, y0 + base * 0.8, z, P); const d = Math.hypot(x - c.x, z - c.z), vis = S.visibility ? S.visibility(x, y0 + base, z) : 1;
      if (P.in && d < 12000) consider({ kind: 'shelf', s, d, cx: P.x, cy: P.y, size: 0.7, vis, rank: 4.5 + (s.intensity || 0) });
    }
    const d = Math.hypot(s.x - c.x, s.z - c.z); project(c, s.x, y0 + base, s.z, P); project(c, s.x, y0 + top, s.z, Q);
    if (d > 3500 && d < 42000 && (P.in || Q.in) && (s.intensity ?? 1) > 0.35) consider({ kind: 'structure', s, d, cx: (P.x + Q.x) / 2, both: P.in && Q.in, size: Math.abs(Q.y - P.y) / 2, vis: 1, rank: 3 + (P.in && Q.in ? 1.2 : 0) });
  }
  if (bolt) consider({ kind: 'lightning', bolt, rank: 7.5 });
  if (S.sunDir && S.sunDir[1] > 0.02 && S.sunDir[1] < 0.64 && (S.weather?.rain ?? 0) < 0.55 && (S.rainAhead ?? 0) > 0.15) {
    const dot = -(c.f[0] * S.sunDir[0] + c.f[1] * S.sunDir[1] + c.f[2] * S.sunDir[2]), a = Math.acos(clamp(dot, -1, 1)) * 57.3, half = Math.atan(c.tan * c.aspect) * 57.3;
    if (Math.abs(a - 42) < half) consider({ kind: 'rainbow', rank: 4.2, cx: (a - 42) / half });
  }
  if ((S.weather?.hail ?? 0) > 0.25 && c.f[1] < -0.35) consider({ kind: 'hail', rank: 6, cx: 0, hail: S.weather.hail });
  const steady = clamp(S.steady ?? 1), focus = clamp(S.focus ?? 1), sharp = steady * 0.55 + focus * 0.45;
  if (!best) {
    add('framing', 'Framing', 24 * sharp, 150); add('light', 'Light', golden ? 45 : 18, 120);
    return finish(S, { subject: 'landscape', title: S.city ? `Plains near ${S.city}` : 'Open country', tags, parts, sharp, rarity: 0.4, id: 'land', dist: 0 });
  }
  const lm = landmark(S, c);
  let rarity = 1, title = '', id = best.kind, dist = best.d || 0, ef = 0, minM = 0;
  if (best.kind === 'tornado') {
    const { t, g } = best; dist = g.dist; ef = t.ef || 0; id = 't' + t.id;
    const subs = t.sub?.length || 0, wide = (S.funnelRadius ? S.funnelRadius(t, t.lcl * 0.15) : t.rCore) * 2 / (t.lcl || 900);
    const touching = t.stage !== 'funnel' && ((t.condense ?? 1) > 0.9 || t.dust > 0.25);
    if (subs >= 2) { tags.push('MULTI-VORTEX'); rarity *= 1.35; }
    if (t.stage === 'rope') { tags.push('ROPE'); rarity *= 1.15; }
    if (wide > 0.5) { tags.push('WEDGE'); rarity *= 1.2; }
    if (nT >= 2 && (S.tornadoes || []).some((o) => o !== t && o.storm === t.storm && o.stage !== 'dead')) { tags.push(t.satellite ? 'SATELLITE' : 'TWIN TORNADOES'); rarity *= 1.4; }
    if (touching && g.ground) tags.push('TOUCHDOWN');
    if (dist < Math.max(220, t.rCore * 3)) { tags.push('DANGER CLOSE'); rarity *= 1.15; }
    if (night) { tags.push('NIGHT TORNADO'); rarity *= 1.25; }
    add('framing', 'Framing', 60 * thirds(g.cx) + 50 * g.frac + 40 * (g.ground ? smoothstep(-0.98, -0.8, g.gy) * (1 - smoothstep(-0.15, 0.35, g.gy)) : 0), 150);
    add('size', 'Size in frame', 150 * smoothstep(0.05, 0.42, Math.max(g.height, g.width)) * (1 - 0.35 * smoothstep(1.05, 1.5, g.width * 2)), 150);
    add('prox', 'Proximity', 250 * prox(dist), 250);
    add('vis', 'Visibility', 130 * smoothstep(0.02, 0.75, g.vis), 130);
    add('char', 'Character', ({ funnel: 40, touchdown: 85, mature: 100, shrinking: 95, rope: 140 }[t.stage] ?? 60) + ef * 16 + (touching && g.ground ? 25 : 0) + (subs >= 2 ? 40 : 0), 200);
    add('drama', 'Light and drama', (bolt ? 70 : 0) + (golden ? 40 : night ? 22 : 14) + (lm ? 22 : 0), 120);
    title = `${ef >= 0 && touching ? 'EF' + ef + ' ' : ''}${!touching ? 'Funnel cloud' : t.stage === 'rope' ? 'rope tornado' : wide > 0.5 ? 'wedge tornado' : 'tornado'}`;
  } else if (best.kind === 'lightning') {
    const b = best.bolt; dist = b.dist; id = 'ltg' + Math.round(S.now || 0); rarity = night ? 1.15 : 0.85; if (night) tags.push('NIGHT'); if (b.full) tags.push('CLOUD TO GROUND'); else if (b.kind === 'ic') tags.push('CRAWLER');
    add('framing', 'Framing', 90 * thirds(b.cx) + 60 * b.k, 150); add('size', 'Bolt in frame', 150 * b.k, 150); add('prox', 'Proximity', 200 * prox(dist, 250, 9000), 250); add('vis', 'Contrast', night ? 125 : 70, 130); add('char', 'Timing', 130 + (b.full ? 40 : 0), 200); add('drama', 'Light and drama', (night ? 60 : 30) + (lm ? 25 : 0), 120);
    title = b.kind === 'ic' ? 'Cloud lightning' : 'Lightning strike';
  } else if (best.kind === 'wallcloud') {
    const b = best, s = b.s; id = 'wc' + s.id; add('framing', 'Framing', 90 * thirds(b.cx) + 60 * (1 - clamp(Math.abs(b.cy - 0.15) / 0.9)), 150); add('size', 'Size in frame', 150 * smoothstep(0.04, 0.3, b.size), 150); add('prox', 'Proximity', 200 * prox(b.d, 600, 13000), 250); add('vis', 'Visibility', 130 * smoothstep(0.05, 0.7, b.vis), 130); add('char', 'Rotation', 170 * clamp(s.rotation), 200); add('drama', 'Light and drama', (bolt ? 60 : 0) + (golden ? 45 : 15) + (lm ? 20 : 0), 120);
    rarity = 0.8; title = 'Rotating wall cloud';
  } else if (best.kind === 'shelf') {
    const b = best; id = 'sh' + b.s.id; add('framing', 'Framing', 120 * (1 - clamp(Math.abs(b.cy - 0.05))), 150); add('size', 'Coverage', c.tan > 0.35 ? 130 : 70, 150); add('prox', 'Proximity', 190 * prox(b.d, 500, 11000), 250); add('vis', 'Visibility', 120 * b.vis, 130); add('char', 'Structure', 140 * (b.s.intensity ?? 0.7), 200); add('drama', 'Light and drama', (bolt ? 60 : 0) + (golden ? 45 : 15), 120); rarity = 0.75; title = 'Shelf cloud';
  } else if (best.kind === 'structure') {
    const b = best; id = 'st' + b.s.id; add('framing', 'Framing', 80 * thirds(b.cx) + (b.both ? 60 : 10), 150); add('size', 'Size in frame', 150 * smoothstep(0.1, 0.5, b.size), 150); add('prox', 'Vantage', 130 * (1 - clamp(Math.abs(b.d - 14000) / 18000)), 250); add('vis', 'Visibility', 110, 130); add('char', 'Structure', 120 * (b.s.intensity ?? 0.7) + (b.s.type === 'supercell' ? 40 : 0), 200); add('drama', 'Light and drama', (bolt ? 70 : 0) + (golden ? 50 : 12) + (lm ? 20 : 0), 120); rarity = 0.6; title = b.s.type === 'supercell' ? 'Supercell structure' : 'Thunderstorm structure';
  } else if (best.kind === 'rainbow') { add('framing', 'Framing', 130 * (1 - Math.abs(best.cx) * 0.6), 150); add('size', 'Arc', 110, 150); add('vis', 'Clarity', 90, 130); add('char', 'Rarity', 110, 200); add('drama', 'Light and drama', golden ? 110 : 60, 120); rarity = 0.8; title = 'Rainbow'; tags.push('OPTICS');
  } else { add('framing', 'Framing', 90, 150); add('size', 'Stone size', 150 * best.hail, 150); add('vis', 'Clarity', 100, 130); add('char', 'Severity', 190 * best.hail, 200); rarity = 0.7; title = best.hail > 0.7 ? 'Giant hail' : 'Hail'; }
  if (bolt && best.kind !== 'lightning') { tags.push('LIGHTNING'); rarity *= 1.25; }
  if (golden) tags.push('GOLDEN HOUR');
  if (lm) tags.push(lm);
  return finish(S, { subject: best.kind, title, tags, parts, sharp, rarity, id, dist, ef, tornado: best.t?.id, storm: (best.s || best.t?.storm)?.id, bolt: !!bolt, night, vis: best.g?.vis ?? best.vis ?? 1 });
}
function landmark(S, c) {
  for (const l of S.landmarks || []) { project(c, l.x, l.y || 0, l.z, P); if (P.in && P.d < (l.range || 1600)) return l.name.toUpperCase(); }
  return null;
}
function finish(S, r) {
  const raw = r.parts.reduce((a, p) => a + p.pts, 0); r.sharpMul = 0.55 + 0.45 * r.sharp;
  r.parts.push({ k: 'sharp', label: 'Sharpness', pts: Math.round(r.sharp * 100), max: 100, mul: r.sharpMul });
  r.score = Math.round(Math.min(1000, raw * r.sharpMul)); r.stars = starsFor(r.score);
  r.value = Math.round(Math.pow(r.score / 1000, 1.65) * 4800 * r.rarity * (1 + (r.ef || 0) * 0.15) / 5) * 5;
  return r;
}
// what the viewfinder tells the player while composing
export function quickSubject(S) { const r = scorePhoto(S); return r; }
export const windText = (ms, units) => (units === 'metric' ? Math.round(ms * 3.6) + ' km/h' : Math.round(ms * MPH) + ' mph');

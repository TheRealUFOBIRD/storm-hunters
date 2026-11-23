// Doppler radar: polar sampling engine, map overlay drawing, full-screen radar app, in-car laptop canvas.
import { TAU, clamp, dirToHeading, compass, MPH } from '../core/math.js';
import { dbzLUT, velLUT, DBZ_STEPS, VEL_STEPS, EF_COLOR, WARN, RISK, hexA } from './palette.js';
import { h, refs, txt, cls, vis, icon, fitCanvas, fmtDist, fmtSpeed, fmtTime, FONT, esc, keyGlyph } from './dom.js';
import { trackCone, warningPolygon, motionOf } from '../gameplay/track.js';
import { gearValue } from '../gameplay/profile.js';

const N = 512, AZ = 720, GATES = 250;
export class RadarEngine {
  constructor(ctx) {
    this.ctx = ctx; this.range = 20000; this.sx = 0; this.sz = 0; this.angle = 0; this.rate = 60; this.pending = AZ; this.bufs = {}; this.tilt = 0.5;
    for (const k of ['ref', 'vel']) { const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), id = g.createImageData(N, N); this.bufs[k] = { c, g, id, px: new Uint32Array(id.data.buffer), dirty: false }; }
    this.lutR = new Uint32Array(dbzLUT.buffer); this.lutV = new Uint32Array(velLUT.buffer);
    // pixel buckets per azimuth
    const cnt = new Uint16Array(AZ + 1), tmp = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = x - N / 2 + 0.5, dy = y - N / 2 + 0.5, r = Math.hypot(dx, dy) / (N / 2); if (r >= 1) continue; let a = Math.atan2(dx, -dy); if (a < 0) a += TAU; const az = Math.min(AZ - 1, Math.floor(a / TAU * AZ)); tmp.push(az, y * N + x, Math.floor(r * GATES)); cnt[az + 1]++; }
    this.start = new Uint32Array(AZ + 1); for (let i = 0; i < AZ; i++) this.start[i + 1] = this.start[i] + cnt[i + 1]; const pos = this.start.slice(), n = tmp.length / 3; this.pix = new Uint32Array(n); this.gate = new Uint16Array(n); for (let i = 0; i < n; i++) { const p = pos[tmp[i * 3]]++; this.pix[p] = tmp[i * 3 + 1]; this.gate[p] = tmp[i * 3 + 2]; }
    this.gr = new Uint32Array(GATES); this.gv = new Uint32Array(GATES);
  }
  setRange(r) { if (r !== this.range) { this.range = r; this.refill(); } }
  refill() { this.pending = AZ; this.bufs.ref.px.fill(0); this.bufs.vel.px.fill(0); this.relocate(); }
  relocate() { const p = this.site?.() || this.ctx.player?.pos || this.ctx.camera.position; this.sx = p.x; this.sz = p.z; }
  ray(az) {
    const S = this.ctx.storms, a = (az + 0.5) / AZ * TAU, dx = Math.sin(a), dz = -Math.cos(a), R = this.range, gr = this.gr, gv = this.gv, sx = this.sx, sz = this.sz, seed = (az * 7919) | 0;
    for (let i = 0; i < GATES; i++) {
      const r = (i + 0.5) / GATES * R, x = sx + dx * r, z = sz + dz * r; let d = S.reflectivity ? S.reflectivity(x, z) : 0; const n = (((seed ^ (i * 104729)) * 2654435761) >>> 24) / 255 - 0.5;
      if (r < 500 && d < 8) d = Math.max(d, 6 + n * 10 - r / 80); // ground clutter near the site
      d += d > 4 ? n * 3.2 : 0; const q = d < 5 ? 0 : d > 80 ? 160 : (d * 2) | 0; gr[i] = this.lutR[q];
      if (d > 7 && S.velocity) { const v = S.velocity(x, z, sx, sz) + n * 2; gv[i] = this.lutV[v < -64 ? 0 : v > 64 ? 256 : Math.round((v + 64) * 2)]; } else gv[i] = 0;
    }
    const A = this.bufs.ref.px, B = this.bufs.vel.px; for (let k = this.start[az]; k < this.start[az + 1]; k++) { const p = this.pix[k], gk = this.gate[k]; A[p] = gr[gk]; B[p] = gv[gk]; }
  }
  update(dt) {
    let n; const cur = Math.floor(this.angle / TAU * AZ);
    if (this.pending > 0) { n = Math.min(this.pending, 24); this.pending -= n; } else { this.acc = (this.acc || 0) + this.rate * dt / 360 * AZ; n = Math.min(40, Math.floor(this.acc)); this.acc -= n; }
    if (n <= 0) return;
    for (let i = 0; i < n; i++) { const az = (cur + i) % AZ; if (az === 0 && i + cur > 0) this.relocate(); this.ray(az); }
    this.angle = ((cur + n) % AZ) / AZ * TAU; for (const k of ['ref', 'vel']) this.bufs[k].dirty = true;
  }
  canvas(k) { const b = this.bufs[k]; if (b.dirty) { b.g.putImageData(b.id, 0, 0); b.dirty = false; } return b.c; }
  fill() { while (this.pending > 0) this.update(0.016); }
  // draw into g whose transform maps world metres (x right, z down)
  drawWorld(g, k, alpha = 1, smooth = false) { g.globalAlpha = alpha; g.imageSmoothingEnabled = smooth; const R = this.range; g.drawImage(this.canvas(k), this.sx - R, this.sz - R, R * 2, R * 2); g.globalAlpha = 1; }
}

// ---------- vector overlay shared by radar, map, minimap ----------
export class Overlay {
  constructor(ctx) { this.ctx = ctx; this.chunks = null; this.tracks = new Map(); this.trackT = 0; }
  roads() {
    if (this.chunks) return this.chunks; const L = this.ctx.world?.roads?.lines; if (!L || !L.length) return []; const out = [];
    for (const l of L) { const p = l.pts, n = p.length / 2, big = /inter|motor|free/i.test(l.kind) ? 2 : /high|us|state|prim/i.test(l.kind) ? 1 : 0; for (let i = 0; i < n - 1; i += 48) { const path = new Path2D(), e = Math.min(n - 1, i + 48); let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let k = i; k <= e; k++) { const x = p[k * 2], z = p[k * 2 + 1]; if (k === i) path.moveTo(x, z); else path.lineTo(x, z); a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); } out.push({ path, a, b, c, d, big, name: l.name }); } }
    out.sort((p, q) => p.big - q.big); this.chunks = out; return out;
  }
  tick(dt) { this.trackT -= dt; if (this.trackT > 0) return; this.trackT = 5; const seen = new Set(); for (const s of this.ctx.storms?.list || []) { seen.add(s.id); const c = s.meso || s; let t = this.tracks.get(s.id); if (!t) this.tracks.set(s.id, t = []); t.push(c.x, c.z); if (t.length > 120) t.splice(0, 2); } for (const k of this.tracks.keys()) if (!seen.has(k)) this.tracks.delete(k); }
  // view: {cx,cz,s (px per m),w,h,rot}
  apply(g, v) { g.setTransform(v.s, 0, 0, v.s, v.w / 2 - v.cx * v.s, v.h / 2 - v.cz * v.s); if (v.rot) { g.setTransform(1, 0, 0, 1, v.ox ?? v.w / 2, v.oy ?? v.h / 2); g.rotate(-v.rot); g.scale(v.s, v.s); g.translate(-v.cx, -v.cz); } else if (v.ox != null) g.setTransform(v.s, 0, 0, v.s, v.ox - v.cx * v.s, v.oy - v.cz * v.s); }
  pt(v, x, z, o = {}) { let dx = (x - v.cx) * v.s, dy = (z - v.cz) * v.s; if (v.rot) { const c = Math.cos(-v.rot), s = Math.sin(-v.rot), t = dx * c - dy * s; dy = dx * s + dy * c; dx = t; } o.x = (v.ox ?? v.w / 2) + dx; o.y = (v.oy ?? v.h / 2) + dy; return o; }
  drawRoads(g, v, o = {}) {
    const px = 1 / v.s, hw = v.w / 2 * px * 1.5, hh = v.h / 2 * px * 1.5, k = v.dpr || 1, r = Math.max(hw, hh); this.apply(g, v); g.lineJoin = 'round'; g.lineCap = 'butt';
    for (const c of this.roads()) { if (c.c < v.cx - r || c.a > v.cx + r || c.d < v.cz - r || c.b > v.cz + r) continue; if (c.big < (o.min ?? (v.s < 0.012 ? 1 : 0))) continue; g.strokeStyle = o.color?.[c.big] || ['rgba(200,192,168,.34)', 'rgba(214,204,176,.55)', 'rgba(235,222,186,.78)'][c.big]; g.lineWidth = px * k * (o.w?.[c.big] || [0.9, 1.4, 2.1][c.big]); g.stroke(c.path); } g.setTransform(1, 0, 0, 1, 0, 0);
  }
  text(g, s, x, y, o = {}) { const k = o.k || 1; g.font = `${o.w || 500} ${(o.size || 11) * k}px ${FONT}`; g.textAlign = o.align || 'left'; g.textBaseline = o.base || 'middle'; g.lineWidth = 3 * k; g.strokeStyle = o.halo || 'rgba(12,12,8,.85)'; g.lineJoin = 'round'; g.strokeText(s, x, y); g.fillStyle = o.color || '#e8dfc8'; g.fillText(s, x, y); }
  cities(g, v, o = {}) { const k = v.dpr || 1, q = {}, placed = []; for (const c of [...(this.ctx.world?.cities || [])].sort((a, b) => (b.pop || 0) - (a.pop || 0))) { this.pt(v, c.x, c.z, q); if (q.x < -60 || q.y < -20 || q.x > v.w + 60 || q.y > v.h + 20) continue; const wd = c.name.length * 6.5 * k + 14 * k, hit = placed.some((r) => q.x < r[0] + r[2] && q.x + wd > r[0] && Math.abs(q.y - r[1]) < 13 * k); g.fillStyle = '#e8dfc8'; const r = (c.pop > 500000 ? 3 : 2.2) * k; g.fillRect(q.x - r, q.y - r, r * 2, r * 2); if (hit || o.noLabel) continue; placed.push([q.x, q.y, wd]); this.text(g, c.name.toUpperCase(), q.x + 7 * k, q.y, { k, size: o.size || 11, w: c.pop > 500000 ? 600 : 400, color: o.color || '#d9d0b6' }); } }
  poly(g, v, p, stroke, fill, lw = 2, dash) { const q = {}; g.beginPath(); for (let i = 0; i < p.length; i += 2) { this.pt(v, p[i], p[i + 1], q); i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); } g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } g.setLineDash(dash || []); g.strokeStyle = 'rgba(10,10,6,.8)'; g.lineWidth = (lw + 2) * (v.dpr || 1); g.stroke(); g.strokeStyle = stroke; g.lineWidth = lw * (v.dpr || 1); g.stroke(); g.setLineDash([]); }
  warnings(g, v) { for (const s of this.ctx.storms?.list || []) { if (!s.warned && !(s.intensity > 0.55 && s.type !== 'shower')) continue; const tor = s.warned && (s.type === 'supercell'); this.poly(g, v, warningPolygon(s, []), tor ? WARN.TOR : WARN.SVR, hexA(tor ? WARN.TOR : WARN.SVR, 0.07), 2); } }
  stormsLayer(g, v, o = {}) {
    const k = v.dpr || 1, q = {}, q2 = {}; for (const s of this.ctx.storms?.list || []) {
      const c = s.meso || s; this.pt(v, c.x, c.z, q); if (q.x < -100 || q.y < -100 || q.x > v.w + 100 || q.y > v.h + 100) continue; const t = this.tracks.get(s.id);
      if (o.tracks && t && t.length > 4) { g.beginPath(); for (let i = 0; i < t.length; i += 2) { this.pt(v, t[i], t[i + 1], q2); i ? g.lineTo(q2.x, q2.y) : g.moveTo(q2.x, q2.y); } g.strokeStyle = 'rgba(242,234,214,.55)'; g.lineWidth = 1.2 * k; g.stroke(); }
      if (o.tracks) { const sp = Math.hypot(s.vx || 0, s.vz || 0); if (sp > 1) { g.strokeStyle = '#f2ead6'; g.lineWidth = 1.3 * k; g.beginPath(); g.moveTo(q.x, q.y); this.pt(v, c.x + s.vx * 360, c.z + s.vz * 360, q2); g.lineTo(q2.x, q2.y); g.stroke(); const a = Math.atan2(q2.y - q.y, q2.x - q.x) + Math.PI / 2; for (const m of [120, 240, 360]) { this.pt(v, c.x + s.vx * m, c.z + s.vz * m, q2); g.beginPath(); g.moveTo(q2.x - Math.cos(a) * 5 * k, q2.y - Math.sin(a) * 5 * k); g.lineTo(q2.x + Math.cos(a) * 5 * k, q2.y + Math.sin(a) * 5 * k); g.stroke(); } } }
      const sel = o.sel === s.id; g.strokeStyle = sel ? '#ffb000' : '#f2ead6'; g.lineWidth = (sel ? 2.4 : 1.5) * k; const rr = (s.rotation > 0.5 ? 8 : 5) * k; g.beginPath(); g.arc(q.x, q.y, rr, 0, TAU); g.stroke(); if (s.rotation > 0.5) { g.beginPath(); for (const a of [0, 1.571, 3.142, 4.712]) { g.moveTo(q.x + Math.cos(a) * rr, q.y + Math.sin(a) * rr); g.lineTo(q.x + Math.cos(a) * (rr + 4 * k), q.y + Math.sin(a) * (rr + 4 * k)); } g.stroke(); }
      if (o.labels) { this.text(g, s.name || 'CELL ' + s.id, q.x + 13 * k, q.y - 7 * k, { k, size: 12, w: 600, color: sel ? '#ffb000' : '#f2ead6' }); if (o.labels > 1) this.text(g, `TOP ${Math.round((s.cloudTop || 11000) * 0.00328)}K  ${s.hail ? 'HAIL ' + (s.hail / 2.54).toFixed(1) + 'in' : ''}`, q.x + 13 * k, q.y + 6 * k, { k, size: 10, color: '#c9bfa4' }); }
    }
  }
  tornadoes(g, v, o = {}) {
    const k = v.dpr || 1, q = {}, now = performance.now() / 1000; for (const t of this.ctx.storms?.tornadoes || []) { if (t.stage === 'dead') continue; if (o.cone) this.poly(g, v, trackCone(t, o.cone, 0.16, []), hexA(EF_COLOR[t.ef || 0], 0.9), hexA(EF_COLOR[t.ef || 0], 0.13), 1, [4 * k, 4 * k]); this.pt(v, t.x, t.z, q); const sz = (o.size || 9) * k, p = 1 + (now * 1.2) % 1; g.strokeStyle = hexA(EF_COLOR[t.ef || 0], 1 - (p - 1)); g.lineWidth = 2 * k; g.beginPath(); g.arc(q.x, q.y, sz * p * 1.2, 0, TAU); g.stroke(); g.fillStyle = EF_COLOR[t.ef || 0]; g.strokeStyle = '#120f08'; g.lineWidth = 1.5 * k; g.beginPath(); g.moveTo(q.x - sz, q.y - sz * 0.75); g.lineTo(q.x + sz, q.y - sz * 0.75); g.lineTo(q.x, q.y + sz); g.closePath(); g.fill(); g.stroke(); if (o.label) this.text(g, `EF${t.ef || 0}`, q.x + sz * 1.5, q.y, { k, size: 13, w: 700, color: EF_COLOR[t.ef || 0] }); }
  }
  route(g, v, w, lw = 3) { if (!w) return; const k = v.dpr || 1, q = {}; if (w.route && w.route.length >= 4) { g.beginPath(); const i0 = Math.max(0, (w.idx || 0)); for (let i = i0; i < w.route.length; i += 2) { this.pt(v, w.route[i], w.route[i + 1], q); i > i0 ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); } g.lineJoin = 'round'; g.strokeStyle = 'rgba(12,10,4,.85)'; g.lineWidth = (lw + 2.5) * k; g.stroke(); g.strokeStyle = '#ffb000'; g.lineWidth = lw * k; g.stroke(); } this.pt(v, w.x, w.z, q); this.flag(g, q.x, q.y, k, '#ffb000'); }
  flag(g, x, y, k, col) { g.fillStyle = col; g.strokeStyle = '#120f08'; g.lineWidth = 1.5 * k; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 7 * k, y - 11 * k); g.lineTo(x, y - 20 * k); g.lineTo(x + 7 * k, y - 11 * k); g.closePath(); g.fill(); g.stroke(); }
  me(g, v, x, z, heading, col = '#f2ead6', size = 9) { const k = v.dpr || 1, q = this.pt(v, x, z), a = heading - (v.rot || 0), s = size * k; g.save(); g.translate(q.x, q.y); g.rotate(a); g.beginPath(); g.moveTo(0, -s * 1.15); g.lineTo(s * 0.75, s * 0.85); g.lineTo(0, s * 0.45); g.lineTo(-s * 0.75, s * 0.85); g.closePath(); g.fillStyle = col; g.strokeStyle = '#120f08'; g.lineWidth = 2 * k; g.stroke(); g.fill(); g.restore(); }
  peers(g, v, o = {}) { const k = v.dpr || 1; for (const p of this.ctx.net?.peers?.values?.() || []) { if (!p.pos) continue; this.me(g, v, p.pos.x, p.pos.z, p.heading || 0, css(p.color), 7); if (o.label) { const q = this.pt(v, p.pos.x, p.pos.z); this.text(g, p.name || 'Chaser', q.x + 10 * k, q.y, { k, size: 11, w: 600, color: css(p.color) }); } } }
  probes(g, v) { const k = v.dpr || 1, q = {}; for (const p of this.ctx.gameplay?.probes || []) { const o = p.obj.position; this.pt(v, o.x, o.z, q); g.fillStyle = p.done ? '#a79f88' : '#ffb000'; g.strokeStyle = '#120f08'; g.lineWidth = 1.5 * k; g.beginPath(); g.moveTo(q.x - 5 * k, q.y + 4 * k); g.lineTo(q.x + 5 * k, q.y + 4 * k); g.lineTo(q.x + 2 * k, q.y - 4 * k); g.lineTo(q.x - 2 * k, q.y - 4 * k); g.closePath(); g.fill(); g.stroke(); } }
  rings(g, v, x, z, R, step) { const k = v.dpr || 1, q = this.pt(v, x, z); g.strokeStyle = 'rgba(232,223,200,.22)'; g.lineWidth = k; g.setLineDash([2 * k, 5 * k]); for (let r = step; r <= R; r += step) { g.beginPath(); g.arc(q.x, q.y, r * v.s, 0, TAU); g.stroke(); this.text(g, fmtDist(r, this.ctx.settings?.get?.('units')), q.x, q.y - r * v.s, { k, size: 10, align: 'center', color: '#a79f88' }); } g.setLineDash([]); }
  intercept(g, v) { const i = this.ctx.gameplay?.intercept; if (!i) return; const k = v.dpr || 1, q = this.pt(v, i.x, i.z); g.strokeStyle = '#4be37a'; g.lineWidth = 2 * k; g.beginPath(); g.rect(q.x - 6 * k, q.y - 6 * k, 12 * k, 12 * k); g.moveTo(q.x - 11 * k, q.y); g.lineTo(q.x + 11 * k, q.y); g.moveTo(q.x, q.y - 11 * k); g.lineTo(q.x, q.y + 11 * k); g.stroke(); this.text(g, `INTERCEPT ${fmtTime(i.eta)}`, q.x + 13 * k, q.y + 9 * k, { k, size: 10, w: 600, color: '#4be37a' }); }
  outlook(g, v) { const k = v.dpr || 1; for (const a of [...(this.ctx.storms?.outlook || [])].sort((p, q) => q.r - p.r)) { const q = this.pt(v, a.x, a.z), c = RISK[a.level] || '#66a366'; g.beginPath(); for (let i = 0; i <= 48; i++) { const t = i / 48 * TAU, r = a.r * v.s * (1 + 0.1 * Math.sin(t * 2 + a.x) + 0.07 * Math.sin(t * 3 + a.z) + 0.03 * Math.sin(t * 7)); const x = q.x + Math.cos(t) * r * 1.18, y = q.y + Math.sin(t) * r * 0.9; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.fillStyle = hexA(c, 0.16); g.fill(); g.strokeStyle = c; g.lineWidth = 2 * k; g.stroke(); this.text(g, a.level, q.x, q.y - a.r * v.s * 0.78, { k, size: 13, w: 700, align: 'center', color: c }); } }
}
export const css = (c) => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c || '#8fd3ff');

// ---------- radar screen ----------
const RANGES = [5000, 10000, 20000, 30000, 45000, 70000];
export function radarScreen(ui) {
  const { ctx } = ui, E = ui.radar, O = ui.overlay; let prod = 'ref', range = 20000, view = { cx: 0, cz: 0, s: 1, w: 1, h: 1, dpr: 1 }, zoom = 1, pan = { x: 0, z: 0 }, sel = null, drag = null, listT = 0, hover = null; const layers = { roads: true, tracks: true, warn: true };
  const root = h('section.scr.radar', null, h('div', { html: `
   <header class="bar"><h2>Doppler radar</h2><div class="seg" data-r="prod"><button data-p="ref" class="on">Reflectivity</button><button data-p="vel">Velocity</button></div><div class="seg" data-r="rng"></div><div class="seg multi" data-r="lay"><button data-l="roads" class="on">Roads</button><button data-l="tracks" class="on">Tracks</button><button data-l="warn" class="on">Warnings</button></div><span class="grow"></span><button class="x" data-r="close" aria-label="Close">${icon('close')}<kbd>Tab</kbd></button></header>
   <div class="rbody"><aside class="storms"><h3>Storm cells</h3><div data-r="list" class="cells"></div><h3>Report to forecast desk</h3><div class="reports" data-r="reports"></div></aside>
   <div class="scope"><canvas data-r="cv" class="scv"></canvas><div class="vcp"><b data-r="vcp1"></b><span data-r="vcp2"></span></div><div class="cursor" data-r="cursor" hidden></div><div class="legend" data-r="legend"></div><div class="tip"><span>Drag to pan, wheel to zoom</span><span>Click a cell to select, right-click to set a waypoint</span></div></div></div>` })); root.firstChild.className = 'full';
  const r = refs(root), cv = r.cv, g = cv.getContext('2d');
  const maxR = () => gearValue(ctx.gameplay?.profile || { upgrades: { gear: {} } }, 'radar', 'range');
  function rangeBtns() { r.rng.innerHTML = ''; for (const R of RANGES) { const lock = R > maxR(); r.rng.append(h('button' + (R === range ? '.on' : ''), { disabled: lock, title: lock ? 'Radar uplink upgrade required' : '', onclick: () => { range = R; pan.x = pan.z = 0; zoom = 1; E.setRange(R); rangeBtns(); } }, (R / 1000) + ' km')); } }
  r.prod.onclick = (e) => { const p = e.target.dataset?.p; if (p) { prod = p; for (const b of r.prod.children) b.classList.toggle('on', b.dataset.p === p); legend(); } };
  r.lay.onclick = (e) => { const l = e.target.dataset?.l; if (l) { layers[l] = !layers[l]; e.target.classList.toggle('on', layers[l]); } }; r.close.onclick = () => ui.closeScreen();
  r.cursor.hidden = true;
  function legend() { const st = prod === 'ref' ? DBZ_STEPS.map((s) => [s[0], `rgb(${s[1]},${s[2]},${s[3]})`]) : VEL_STEPS.filter((s) => Math.abs(s[0]) >= 4).map((s) => [Math.round(s[0] * MPH), `rgb(${s[1]},${s[2]},${s[3]})`]); r.legend.innerHTML = `<i>${prod === 'ref' ? 'dBZ' : 'mph  toward / away'}</i><div>${st.map((s) => `<span style="background:${s[1]}"></span>`).join('')}</div><div class="n">${st.map((s, i) => `<em>${i % 2 === 0 || st.length < 12 ? s[0] : ''}</em>`).join('')}</div>`; }
  for (const [k, n] of ctx.gameplay?.reportKinds || []) r.reports.append(h('button.rep', { onclick: () => { ctx.gameplay.submitReport(k); } }, h('span', { html: icon({ tornado: 'tornado', funnel: 'funnel', wallcloud: 'supercell', hail: 'hail', wind: 'wind' }[k]) }), n));
  const toWorld = (e) => { const b = cv.getBoundingClientRect(), x = (e.clientX - b.left) * view.dpr, y = (e.clientY - b.top) * view.dpr; return { x: view.cx + (x - view.w / 2) / view.s, z: view.cz + (y - view.h / 2) / view.s, px: e.clientX - b.left, py: e.clientY - b.top }; };
  cv.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, px: pan.x, pz: pan.z, moved: false }; cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = (e) => { hover = toWorld(e); if (drag && e.buttons & 1) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 4) drag.moved = true; if (drag.moved) { pan.x = drag.px - dx * view.dpr / view.s; pan.z = drag.pz - dy * view.dpr / view.s; } } };
  cv.onpointerup = (e) => { const d = drag; drag = null; if (!d || d.moved || e.button !== 0) return; const w = toWorld(e); let b = null, bd = 26 * view.dpr / view.s; for (const s of ctx.storms.list) { const c = s.meso || s, q = Math.hypot(c.x - w.x, c.z - w.z); if (q < bd) { bd = q; b = s; } } sel = b ? b.id : null; listT = 0; };
  cv.onpointerleave = () => { hover = null; }; cv.oncontextmenu = (e) => { e.preventDefault(); const w = toWorld(e); ctx.gameplay?.setWaypoint(w.x, w.z, 'Waypoint'); ui.beep('set'); };
  cv.onwheel = (e) => { e.preventDefault(); zoom = clamp(zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 0.8, 14); };
  function list() {
    const p = ui.pos(), u = ui.units, L = [...ctx.storms.list].sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)); if (sel != null && !L.some((s) => s.id === sel)) sel = null;
    const html = L.map((s) => { const c = s.meso || s, d = Math.hypot(c.x - p.x, c.z - p.z), t = ctx.storms.tornadoes.find((t) => t.storm === s && t.stage !== 'dead') || ctx.storms.tornadoes.find((t) => t.storm?.id === s.id && t.stage !== 'dead'); return `<button class="cell ${s.id === sel ? 'on' : ''} ${t ? 'tor' : s.warned ? 'warn' : ''}" data-id="${s.id}"><b>${esc(s.name || 'CELL ' + s.id)}</b><span class="ty">${esc({ supercell: 'Supercell', squall: 'Squall line', shower: 'Shower' }[s.type] || s.type)}</span><span class="ds">${fmtDist(d, u)} ${compass(dirToHeading(c.x - p.x, c.z - p.z))}</span><span class="mv">${compass(dirToHeading(s.vx, s.vz))} ${fmtSpeed(Math.hypot(s.vx, s.vz), u)}</span><i class="rot" title="Rotation"><s style="width:${Math.round((s.rotation || 0) * 100)}%"></s></i>${t ? `<em style="background:${EF_COLOR[t.ef || 0]}">EF${t.ef || 0}</em>` : s.warned ? '<em class="w">TOR WARN</em>' : s.hail > 2 ? `<em class="h">${(s.hail / 2.54).toFixed(1)} IN HAIL</em>` : ''}${s.id === sel ? `<div class="act"><span data-go="${s.id}">Set waypoint</span>${t ? `<span data-int="1">Route to intercept</span>` : ''}</div>` : ''}</button>`; }).join('') || '<p class="none">No echoes in range.</p>';
    if (r.list._h !== html) { r.list._h = html; r.list.innerHTML = html; }
  }
  r.list.onpointerdown = (e) => { const go = e.target.dataset?.go, it = e.target.dataset?.int; if (it) { const i = ctx.gameplay?.intercept; if (i) { ctx.gameplay.setWaypoint(i.x, i.z, 'Intercept'); ui.beep('set'); } return; } if (go) { const s = ctx.storms.list.find((s) => String(s.id) === go); if (s) { const c = s.meso || s; ctx.gameplay.setWaypoint(c.x, c.z, s.name || 'Storm'); ui.beep('set'); } return; } const b = e.target.closest('.cell'); if (b) { const id = ctx.storms.list.find((s) => String(s.id) === b.dataset.id)?.id; if (sel === id) { const s = ctx.storms.list.find((s) => s.id === id), c = s.meso || s, p = ui.pos(); pan.x = c.x - p.x; pan.z = c.z - p.z; } sel = id; listT = 0; } };
  function draw(dt) {
    const d = fitCanvas(cv), w = cv.width, hh = cv.height, p = ui.pos(), u = ui.units; view.dpr = d; view.w = w; view.h = hh; view.s = Math.min(w, hh) * 0.485 / range * zoom; view.cx = p.x + pan.x; view.cz = p.z + pan.z;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0c0d08'; g.fillRect(0, 0, w, hh);
    const mc = ui.mapCanvas(); if (mc) { O.apply(g, view); const b = ctx.world.bounds; g.globalAlpha = 0.3; g.imageSmoothingEnabled = true; g.drawImage(mc, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ); g.globalAlpha = 1; }
    O.apply(g, view); E.drawWorld(g, prod, 0.94); g.setTransform(1, 0, 0, 1, 0, 0);
    if (layers.roads) O.drawRoads(g, view, { color: ['rgba(230,220,190,.2)', 'rgba(230,220,190,.4)', 'rgba(240,230,200,.62)'] });
    O.rings(g, view, E.sx, E.sz, E.range, E.range / 4); if (layers.warn) O.warnings(g, view); O.cities(g, view, { size: 11 });
    const q = O.pt(view, E.sx, E.sz), R = E.range * view.s; g.save(); g.beginPath(); g.arc(q.x, q.y, R, 0, TAU); g.strokeStyle = 'rgba(255,176,0,.55)'; g.lineWidth = 1.5 * d; g.stroke(); g.clip(); const a = E.angle - Math.PI / 2; if (g.createConicGradient) { const cg = g.createConicGradient(a - 0.6, q.x, q.y); cg.addColorStop(0, 'rgba(255,176,0,0)'); cg.addColorStop(0.6 / TAU, 'rgba(255,190,60,.2)'); cg.addColorStop(0.6 / TAU + 0.0001, 'rgba(255,176,0,0)'); cg.addColorStop(1, 'rgba(255,176,0,0)'); g.fillStyle = cg; g.fillRect(q.x - R, q.y - R, R * 2, R * 2); } g.strokeStyle = '#ffb000'; g.lineWidth = 1.5 * d; g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x + Math.cos(a) * R, q.y + Math.sin(a) * R); g.stroke(); g.restore();
    for (let i = 0; i < 36; i++) { const t = i / 36 * TAU, k = i % 9 === 0 ? 10 : 5; g.strokeStyle = 'rgba(255,176,0,.6)'; g.lineWidth = d; g.beginPath(); g.moveTo(q.x + Math.sin(t) * R, q.y - Math.cos(t) * R); g.lineTo(q.x + Math.sin(t) * (R + k * d), q.y - Math.cos(t) * (R + k * d)); g.stroke(); }
    O.route(g, view, ctx.gameplay?.waypoint, 2.5); O.stormsLayer(g, view, { tracks: layers.tracks, labels: prod === 'ref' ? 2 : 1, sel }); O.tornadoes(g, view, { cone: layers.tracks ? 360 : 0, label: true }); O.intercept(g, view); O.probes(g, view); O.peers(g, view, { label: true }); O.me(g, view, p.x, p.z, ui.heading());
    txt(r.vcp1, `${prod === 'ref' ? 'BASE REFLECTIVITY' : 'STORM RELATIVE VELOCITY'} 0.5`); txt(r.vcp2, `VCP 212   RANGE ${Math.round(E.range / 1000)} KM   AZ ${String(Math.round(E.angle / TAU * 360) % 360).padStart(3, '0')}`);
    vis(r.cursor, !!hover); if (hover) { r.cursor.style.transform = `translate(${hover.px + 16}px,${hover.py + 14}px)`; const dz = ctx.storms.reflectivity?.(hover.x, hover.z) ?? 0, ve = ctx.storms.velocity?.(hover.x, hover.z, E.sx, E.sz) ?? 0; txt(r.cursor, `${prod === 'ref' ? Math.round(Math.max(0, dz)) + ' dBZ' : Math.round(Math.abs(ve) * MPH) + ' mph ' + (ve < 0 ? 'toward' : 'away')}   ${fmtDist(Math.hypot(hover.x - p.x, hover.z - p.z), u)} ${compass(dirToHeading(hover.x - p.x, hover.z - p.z))}`); }
    listT -= dt; if (listT <= 0) { listT = 0.6; list(); }
  }
  return { el: root, block: true, open() { range = Math.min(range, maxR()); E.setRange(range); rangeBtns(); legend(); listT = 0; pan.x = pan.z = 0; }, update(dt) { draw(dt); }, key(e) { if (e.code === 'KeyV') { r.prod.children[prod === 'ref' ? 1 : 0].click(); return true; } } };
}

// compact dash laptop view
export function drawLaptop(ui, cv, t) {
  const g = cv.getContext('2d'), w = cv.width, hh = cv.height, E = ui.radar, O = ui.overlay, p = ui.pos(), ctx = ui.ctx, v = { cx: p.x, cz: p.z, s: hh * 0.47 / 9000, w, h: hh, dpr: 1.5 }; g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0c0d08'; g.fillRect(0, 0, w, hh); O.apply(g, v); E.drawWorld(g, 'ref', 1); g.setTransform(1, 0, 0, 1, 0, 0); O.drawRoads(g, v); O.warnings(g, v); O.route(g, v, ctx.gameplay?.waypoint, 2); O.tornadoes(g, v, { cone: 240, size: 8 }); O.me(g, v, p.x, p.z, ui.heading());
  g.fillStyle = '#14130d'; g.fillRect(0, 0, w, 34); g.fillStyle = '#ffb000'; g.font = `700 20px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('REFLECTIVITY 0.5', 12, 18); const T = ctx.gameplay?.threat; g.textAlign = 'right'; g.fillStyle = T && T.dist < 9000 ? EF_COLOR[T.tornado?.ef || 0] : '#a79f88'; g.fillText(T && Number.isFinite(T.dist) ? `TOR ${fmtDist(T.dist, ui.units)} ${compass(T.heading)}` : 'NO TVS', w - 12, 18); void t;
}
export { motionOf, keyGlyph, cls };

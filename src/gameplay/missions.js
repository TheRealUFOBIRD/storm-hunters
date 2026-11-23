// Contract board. Missions are plain JSON; logic is table driven so it can be synced and tested headless.
import { clamp, dirToHeading, MPH } from '../core/math.js';
import { STORY, CLIENTS } from './campaign.js';
import { isNight } from './photo.js';
import { approach, motionOf } from './track.js';

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const A = {};
const live = (t) => t.stage !== 'dead';
export function nearestTornado(list, x, z, minEf = 0, filter) {
  let b = null, bd = 1e12; for (const t of list || []) { if (!live(t) || (t.ef || 0) < minEf || (filter && !filter(t))) continue; const d = dist(t.x, t.z, x, z); if (d < bd) { bd = d; b = t; } } if (b) b.dist = bd; return b;
}
export function nearestStorm(list, x, z, type) { let b = null, bd = 1e12; for (const s of list || []) { if (type && s.type !== type) continue; const d = dist(s.x, s.z, x, z); if (d < bd) { bd = d; b = s; } } return b; }
const tornadoFor = (m, e, minEf = 0) => { if (m.tornado != null) { const t = e.tornadoes.find((t) => t.id === m.tornado && live(t)); if (t) return t; } return nearestTornado(e.tornadoes, e.px, e.pz, minEf); };
const stormFor = (m, e) => (m.storm != null && e.storms.find((s) => s.id === m.storm)) || nearestStorm(e.storms, e.px, e.pz);
const cityFor = (m, e) => (m.city && e.cities.find((c) => c.name === m.city)) || null;
const inPath = (t, x, z) => { approach(t, x, z, 0, 0, A); return A.along > 0 && Math.abs(A.cross) < Math.max(450, t.rCore * 4); };

// Objective types: tick(o,m,e,dt) per frame while current; on(o,m,e,name,d) for events; marker(o,m,e) -> {x,z,label}
export const OBJ = {
  drive: { tick(o, m, e, dt) { if (e.mode === 'drive') o.p = Math.min(o.n, o.p + e.speed * dt); } },
  screen: { on(o, m, e, n, d) { if (n === 'ui:screen' && d.name === o.screen) o.p = 1; } },
  waypoint: { on(o, m, e, n) { if (n === 'waypoint:set') o.p = 1; }, marker: (o, m, e) => at(stormFor(m, e), 'Storm') },
  nearStorm: { tick(o, m, e) { const s = stormFor(m, e); if (s) { const d = dist(s.x, s.z, e.px, e.pz); o.live = d; if (d < o.dist) o.p = 1; } }, marker: (o, m, e) => at(stormFor(m, e), 'Storm') },
  nearMeso: { tick(o, m, e) { const s = m.storm != null ? stormFor(m, e) : nearestStorm(e.storms, e.px, e.pz, 'supercell'); if (s) { const c = s.meso || s, d = dist(c.x, c.z, e.px, e.pz); o.live = d; if (d < o.dist) o.p = 1; } }, marker: (o, m, e) => { const s = nearestStorm(e.storms, e.px, e.pz, 'supercell'); return s && at(s.meso || s, 'Updraft base'); } },
  nearTornado: { tick(o, m, e) { const t = tornadoFor(m, e, o.minEf); if (t) { const d = dist(t.x, t.z, e.px, e.pz); o.live = d; if (d < o.dist) o.p = 1; } }, marker: (o, m, e) => at(tornadoFor(m, e, o.minEf), 'Tornado') },
  photo: { on(o, m, e, n, d) {
    if (n !== 'photo:taken') return; const r = d.result || d;
    const miss = (s) => { o.note = s; e.emit('mission:note', { mission: m, text: s }); };
    if (o.subject && o.subject !== 'any' && r.subject !== o.subject) { if (r.subject !== 'landscape') miss(`Wrong subject. Need ${SUBJ[o.subject] || o.subject}.`); return; }
    if (o.subject === 'any' && r.subject === 'landscape') return;
    if (o.bolt && !r.bolt && r.subject !== 'lightning') return miss('No lightning in the frame.');
    if (o.night && !r.night) return miss('It has to be dark.');
    if (o.golden && !(r.tags || []).includes('GOLDEN HOUR')) return miss('Wrong light. Needs low sun.');
    if (o.maxDist && r.dist > o.maxDist) return miss(`Too far out (${(r.dist / 1000).toFixed(1)} km).`);
    if (o.minEf && (r.ef || 0) < o.minEf) return miss(`Needs EF${o.minEf} or stronger.`);
    if (o.tag && !(r.tags || []).includes(o.tag)) return miss(`Needs ${o.tag.toLowerCase()}.`);
    if (o.min && r.score < o.min) return miss(`Score ${r.score}, needs ${o.min}.`);
    o.p = Math.min(o.n, o.p + 1); o.best = Math.max(o.best || 0, r.score);
  }, marker: (o, m, e) => (o.subject === 'tornado' ? at(tornadoFor(m, e, o.minEf), 'Tornado') : o.subject === 'wallcloud' ? OBJ.nearMeso.marker(o, m, e) : at(stormFor(m, e), 'Storm')) },
  scan: { on(o, m, e, n, d) { if (n === 'scan:progress' && (d.ef || 0) >= (o.minEf || 0)) o.frac = Math.max(o.frac || 0, d.progress / o.quality); if (n === 'scan:complete' && (d.ef || 0) >= (o.minEf || 0) && d.quality >= (o.quality || 0)) o.p = Math.min(o.n, o.p + 1); }, marker: (o, m, e) => at(tornadoFor(m, e, o.minEf), 'Scan target') },
  probeDeploy: { on(o, m, e, n, d) { if (n !== 'probe:deployed') return; const t = nearestTornado(e.tornadoes, d.x, d.z); if (t && inPath(t, d.x, d.z) && dist(t.x, t.z, d.x, d.z) < 9000) o.p = Math.min(o.n, o.p + 1); else e.emit('mission:note', { mission: m, text: 'Probe is outside the projected path.' }); }, marker: (o, m, e) => { const t = tornadoFor(m, e, 0); if (!t) return null; motionOf(t, A); return { x: t.x + A.vx * 150, z: t.z + A.vz * 150, label: 'Projected path' }; } },
  probeData: { on(o, m, e, n, d) { if (n === 'probe:data' && d.score >= (o.score || 0.2)) o.p = Math.min(o.n, o.p + 1); }, marker: (o, m, e) => at(tornadoFor(m, e, 0), 'Tornado') },
  measure: { tick(o, m, e, dt) { const v = e.measure; if (v && v.active && (v[o.what] || 0) >= o.min) o.p = Math.min(o.n, o.p + dt); else o.p = Math.max(0, o.p - dt * 0.3); }, marker: (o, m, e) => { const s = stormFor(m, e); return s && (o.what === 'hail' && s.rain ? at(s.rain, 'Hail core') : at(s, 'Storm')); } },
  night: { tick(o, m, e) { if (isNight(e.hour)) o.p = 1; } },
  drone: { on(o, m, e, n) { if (n === 'drone:launch') o.p = 1; } },
  droneNear: { tick(o, m, e) { const d = e.drone; if (!d?.active) return; const t = nearestTornado(e.tornadoes, d.x, d.z); if (t) { const k = dist(t.x, t.z, d.x, d.z); o.live = k; if (k < Math.max(o.min, t.rCore * o.mult)) o.p = 1; } }, marker: (o, m, e) => at(tornadoFor(m, e, 0), 'Circulation') },
  reachCity: { tick(o, m, e) { const c = cityFor(m, e); if (!c) return; const d = dist(c.x, c.z, e.px, e.pz); o.live = d; if (d < o.r) o.p = 1; }, marker: (o, m, e) => at(cityFor(m, e), m.city) },
  holdUse: { tick(o, m, e, dt) { if (e.useHeld && e.speed < 4) o.p = Math.min(o.n, o.p + dt); else o.p = Math.max(0, o.p - dt); o.hold = true; } },
  stopHere: { tick(o, m, e, dt) { const near = dist(m.x, m.z, e.px, e.pz) < 22; if (near && e.speed < 1.2) o.p = Math.min(o.n, o.p + dt); }, marker: (o, m) => ({ x: m.x, z: m.z, label: 'Stranded motorist' }) },
  reachRescue: { tick(o, m, e) { const d = dist(m.x, m.z, e.px, e.pz); o.live = d; if (d < 60) o.p = 1; }, marker: (o, m) => ({ x: m.x, z: m.z, label: 'Stranded motorist' }) },
  deliver: { tick(o, m, e) { let b = null, bd = 1e9; for (const c of e.cities) { if (c.name === m.city) continue; const d = dist(c.x, c.z, e.px, e.pz); if (d < bd) { bd = d; b = c; } } if (!b) return; o.to = b.name; o.mx = b.x; o.mz = b.z; o.live = bd; if (bd < Math.max(o.r, b.radius * 0.6)) o.p = 1; }, marker: (o) => (o.mx != null ? { x: o.mx, z: o.mz, label: 'Shelter: ' + o.to } : null) },
  reach: { tick(o, m, e) { const x = o.x ?? m.x, z = o.z ?? m.z, d = dist(x, z, e.px, e.pz); o.live = d; if (d < (o.r || 80)) o.p = 1; }, marker: (o, m) => ({ x: o.x ?? m.x, z: o.z ?? m.z, label: o.mark || 'Destination' }) },
  escapeTornado: { tick(o, m, e) { const t = nearestTornado(e.tornadoes, e.px, e.pz); if (!t || dist(t.x, t.z, e.px, e.pz) > o.dist) o.p = 1; else o.live = dist(t.x, t.z, e.px, e.pz); } },
  armored: { tick(o, m, e) { if (e.armorLevel >= o.level) o.p = 1; } },
  intercept: { tick(o, m, e, dt) { const t = nearestTornado(e.tornadoes, e.px, e.pz, o.minEf); if (t) { const d = dist(t.x, t.z, e.px, e.pz); o.live = d; if (d < o.dist + (t.rCore || 0) * 0.25) o.p = Math.min(o.n, o.p + dt); } }, marker: (o, m, e) => at(tornadoFor(m, e, o.minEf), 'Tornado') },
  report: { on(o, m, e, n, d) { if (n === 'report:accepted' && (!o.kind || d.kind === o.kind)) o.p = Math.min(o.n, o.p + 1); } },
};
const SUBJ = { wallcloud: 'a wall cloud', tornado: 'a tornado', shelf: 'a shelf cloud', structure: 'storm structure', lightning: 'lightning', hail: 'hail', rainbow: 'a rainbow' };
const at = (o, label) => (o ? { x: o.x, z: o.z, label } : null);

let seq = 1;
export const PAY = 2.5;
export function buildStory(i) {
  const s = STORY[i]; if (!s) return null;
  return { id: 'story-' + s.key, kind: 'story', story: i, key: s.key, title: s.title, client: s.client, tag: 'STORY', level: s.level, brief: s.brief, intro: s.intro, outro: s.outro, ensure: s.ensure || null, reward: { money: s.reward.money * PAY, rep: s.reward.rep }, time: s.time || 0, left: s.time || 0, step: 0, state: 'available', objectives: s.objectives.map((o) => ({ n: 1, ...o, p: 0 })) };
}
const mk = (o) => ({ id: 'c' + (seq++).toString(36) + '-' + Math.floor(Math.random() * 46656).toString(36), state: 'available', step: 0, level: 1, age: 0, expires: 420, ...o, objectives: o.objectives.map((x) => ({ n: 1, ...x, p: 0 })), client: CLIENTS[o.cl].name, tag: CLIENTS[o.cl].tag, left: o.time || 0 });

// Build contracts from what the sky is doing right now
export function generate(e, rnd, have) {
  const out = [], has = (k) => have.some((m) => m.tpl === k) || out.some((m) => m.tpl === k), lv = e.level || 1;
  const T = e.tornadoes.filter(live), near = (o) => dist(o.x, o.z, e.px, e.pz);
  const S = e.storms.filter((s) => near(s) < 30000), sc = S.filter((s) => s.type === 'supercell').sort((a, b) => near(a) - near(b));
  const pay = (base, o) => Math.round(base * PAY * (1 + lv * 0.06) * (1 + Math.min(1, near(o) / 20000) * 0.4) / 10) * 10;
  const city = (o) => e.nearestCity?.(o.x, o.z)?.name || 'open country';
  for (const t of T) if (near(t) < 25000) {
    if (!has('news-t')) out.push(mk({ tpl: 'news-t', cl: 'news', tornado: t.id, title: `Tornado near ${city(t)}`, brief: `We go live in minutes. A sharp frame of the tornado near ${city(t)}, three stars or better.`, time: 360, reward: { money: pay(620 + (t.ef || 0) * 160, t), rep: 45 + (t.ef || 0) * 8 }, objectives: [{ type: 'photo', subject: 'tornado', min: 380, label: 'Photograph the tornado, 3 stars or better', key: 'tool1' }] }));
    if (lv >= 2 && !has('uni-scan')) out.push(mk({ tpl: 'uni-scan', cl: 'uni', tornado: t.id, title: 'Low-level volume', brief: 'Complete one Doppler volume of the circulation before it decays.', time: 420, reward: { money: pay(950, t), rep: 60 }, objectives: [{ type: 'scan', minEf: 0, quality: 0.5, label: 'Doppler scan the tornado', key: 'tool2' }] }));
    if (lv >= 3 && !has('uni-probe')) out.push(mk({ tpl: 'uni-probe', cl: 'uni', tornado: t.id, title: 'Pressure deficit', brief: 'One ground station, close enough to feel it. Payment scales with proximity.', time: 420, reward: { money: pay(1400, t), rep: 80 }, objectives: [{ type: 'probeDeploy', label: 'Deploy a probe in the path', key: 'tool3' }, { type: 'probeData', score: 0.3, label: 'Record the pass' }] }));
    if (!has('spot-t')) out.push(mk({ tpl: 'spot-t', cl: 'spot', tornado: t.id, title: 'Ground truth', brief: 'The forecast office needs a confirmed report. Get a visual and submit it.', time: 300, reward: { money: pay(320, t), rep: 50 }, objectives: [{ type: 'nearTornado', dist: 6000, label: 'Get a visual on the tornado' }, { type: 'report', kind: 'tornado', label: 'Submit a tornado report', key: 'report' }] }));
    if (lv >= 4 && (t.ef || 0) >= 2 && !has('close')) out.push(mk({ tpl: 'close', cl: 'mag', tornado: t.id, title: 'Too close', brief: 'One frame from inside 600 metres. We will not ask how.', time: 360, reward: { money: pay(1700, t), rep: 90 }, objectives: [{ type: 'photo', subject: 'tornado', maxDist: 600, min: 350, label: 'Photograph from under 600 m', key: 'tool1' }] }));
  }
  if (sc[0]) {
    const s = sc[0];
    if (!has('struct')) out.push(mk({ tpl: 'struct', cl: 'mag', storm: s.id, title: 'Mothership', brief: `Full supercell structure near ${city(s)}, base to anvil in one frame. Distance is your friend.`, time: 0, reward: { money: pay(420, s), rep: 35 }, objectives: [{ type: 'photo', subject: 'structure', min: 330, label: 'Photograph the storm structure', key: 'tool1' }] }));
    if (!has('wall') && s.rotation > 0.45) out.push(mk({ tpl: 'wall', cl: 'news', storm: s.id, title: 'Wall cloud, live', brief: `${s.name || 'The cell'} near ${city(s)} is rotating. Show us.`, time: 420, reward: { money: pay(480, s), rep: 40 }, objectives: [{ type: 'photo', subject: 'wallcloud', min: 300, label: 'Photograph the wall cloud', key: 'tool1' }] }));
    if (lv >= 2 && !has('hail') && (s.hail || 0) > 2) out.push(mk({ tpl: 'hail', cl: 'ins', storm: s.id, title: 'Claims season', brief: `Radar suggests ${(s.hail || 3).toFixed(0)} cm stones. Verify from the ground.`, time: 480, reward: { money: pay(700, s), rep: 55 }, objectives: [{ type: 'measure', what: 'hail', min: 0.3, n: 6, label: 'Measure hail for 6 s', key: 'tool6' }] }));
    if (!has('wind')) out.push(mk({ tpl: 'wind', cl: 'uni', storm: s.id, title: 'Inflow profile', brief: 'Measure sustained inflow of 20 m/s or more with the field meter.', time: 0, reward: { money: pay(380, s), rep: 40 }, objectives: [{ type: 'measure', what: 'wind', min: 20, n: 5, label: `Hold the meter in ${Math.round(20 * MPH)}+ mph wind`, key: 'tool6' }] }));
    if (isNight(e.hour) && !has('bolt')) out.push(mk({ tpl: 'bolt', cl: 'mag', storm: s.id, title: 'After dark', brief: 'A single clean bolt against a black sky.', time: 0, reward: { money: pay(650, s), rep: 45 }, objectives: [{ type: 'photo', subject: 'any', bolt: true, night: true, min: 260, label: 'Photograph lightning at night', key: 'tool1' }] }));
    if (lv >= 3 && !has('rescue') && rnd() < 0.5) { const r = e.roadNear?.(s.x + (s.vx || 5) * 260, s.z + (s.vz || 0) * 260); if (r && r.dist < 2500) out.push(mk({ tpl: 'rescue', cl: 'ema', storm: s.id, x: r.x, z: r.z, title: 'Welfare check', brief: `A driver is stuck on ${r.name || 'the highway'} ahead of the storm. Get them to shelter.`, time: 540, reward: { money: pay(1100, s), rep: 110 }, objectives: [{ type: 'reachRescue', label: 'Reach the stranded motorist' }, { type: 'stopHere', n: 4, label: 'Stop and let them board' }, { type: 'deliver', r: 400, label: 'Drive them to the nearest town' }] })); }
  }
  const sq = S.find((s) => s.type === 'squall'); if (sq && !has('shelf')) out.push(mk({ tpl: 'shelf', cl: 'mag', storm: sq.id, title: 'Leading edge', brief: 'Shelf cloud along the squall line. Go wide.', time: 480, reward: { money: pay(420, sq), rep: 35 }, objectives: [{ type: 'photo', subject: 'shelf', min: 280, label: 'Photograph the shelf cloud', key: 'tool1' }] }));
  return out;
}

export class MissionManager {
  constructor(env, events) { this.e = env; this.ev = events; this.available = []; this.active = []; this.done = []; this.tracked = null; this.genT = 0; this.rnd = Math.random; this.version = 0; this.maxActive = 3; }
  get current() { return this.active.find((m) => m.id === this.tracked) || this.active[0] || null; }
  objective(m = this.current) { return m ? m.objectives[m.step] : null; }
  emit(n, d) { this.ev?.emit(n, d); }
  refresh(force) {
    const e = this.e; this.available = this.available.filter((m) => m.kind === 'story' || (m.expires > 0 && this.alive(m)));
    const st = e.story ?? 0, sid = STORY[st] && 'story-' + STORY[st].key;
    this.available = this.available.filter((m) => m.kind !== 'story' || m.id === sid);
    if (sid && !this.active.some((m) => m.id === sid) && !this.available.some((m) => m.id === sid)) { const m = buildStory(st); if (m) { m.locked = (e.level || 1) < m.level; this.available.unshift(m); } }
    for (const m of this.available) if (m.kind === 'story') m.locked = (e.level || 1) < m.level;
    if (e.authority !== false || force) { const room = 7 - this.available.length; if (room > 0) this.available.push(...generate(e, this.rnd, [...this.available, ...this.active]).slice(0, room)); }
    this.version++; this.emit('mission:board', this.available);
  }
  alive(m) { if (m.tornado != null) return this.e.tornadoes.some((t) => t.id === m.tornado && live(t)); if (m.storm != null) return this.e.storms.some((s) => s.id === m.storm); return true; }
  accept(id) {
    const e = this.e, m = this.available.find((m) => m.id === id); if (!m || m.locked) return null;
    if (e.authority === false && e.request) e.request('accept', id);
    if (this.active.length >= this.maxActive) { this.emit('mission:note', { mission: m, text: `Finish or drop a contract first (${this.maxActive} max).` }); return null; }
    this.available.splice(this.available.indexOf(m), 1); m.state = 'active'; m.left = m.time || 0; m.started = e.now; m.step = 0; m.ensureT = 0;
    this.active.push(m); this.tracked = m.id; this.prepare(m); this.version++;
    this.emit('mission:accepted', m); this.emit('mission:step', { mission: m, objective: m.objectives[0] }); return m;
  }
  prepare(m) {
    const e = this.e, en = m.ensure; if (!en || !this.auth()) return;
    if (en.toCity) { // pick a town 4-7 km off and stage the tornado on the far side heading for it
      let c = null, bs = 1e18; for (const k of e.cities) { const d = dist(k.x, k.z, e.px, e.pz), s = Math.abs(d - 5500); if (d > 2200 && s < bs) { bs = s; c = k; } } if (!c) c = e.nearestCity?.(e.px, e.pz);
      if (c) { m.city = c.name; const a = dirToHeading(c.x - e.px, c.z - e.pz) + 1.9, L = en.dist, x = c.x + Math.sin(a) * L, z = c.z - Math.cos(a) * L; e.spawn?.(x, z, { type: en.type, ef: en.ef, stage: 'mature', toward: { x: c.x, z: c.z }, heading: dirToHeading(c.x - x, c.z - z), mission: true }); m.ensured = true; }
    }
    if (m.objectives.some((o) => o.type === 'reachRescue') && m.x == null) { const a = this.rnd() * 6.283, r = e.roadNear?.(e.px + Math.sin(a) * 4200, e.pz - Math.cos(a) * 4200); m.x = r ? r.x : e.px + 3000; m.z = r ? r.z : e.pz; if (en.tornado && e.spawn) { const b = a + 0.9; e.spawn(m.x + Math.sin(b) * en.dist * 0.6, m.z - Math.cos(b) * en.dist * 0.6, { type: en.type, ef: en.ef, stage: 'mature', toward: { x: m.x, z: m.z }, mission: true }); m.ensured = true; } }
  }
  auth() { return this.e.authority !== false; }
  ensure(m, dt) {
    const e = this.e, en = m.ensure; if (!en || m.ensured || !this.auth() || !e.spawn) return;
    const ok = en.tornado ? e.tornadoes.some((t) => live(t) && (t.ef || 0) >= (en.ef || 0) && dist(t.x, t.z, e.px, e.pz) < 14000 && (!en.multi || (t.sub?.length || 0) >= 2)) : e.storms.some((s) => s.type === en.type && dist(s.x, s.z, e.px, e.pz) < 16000);
    if (ok) { m.ensureT = 0; return; }
    m.ensureT = (m.ensureT || 0) + dt; if (m.ensureT < 25) return; m.ensureT = -200;
    const a = (e.heading || 0) + (this.rnd() - 0.5) * 1.6, x = e.px + Math.sin(a) * en.dist, z = e.pz - Math.cos(a) * en.dist;
    e.spawn(x, z, { type: en.type, ef: en.ef, stage: en.tornado ? (en.ef >= 3 ? 'touchdown' : 'funnel') : undefined, multi: en.multi, mission: true });
  }
  abandon(id, reason = 'abandoned') { const m = this.active.find((m) => m.id === id); if (!m) return; if (!this.auth() && this.e.request) this.e.request('abandon', id); this.remove(m); m.state = 'failed'; m.reason = reason; this.version++; this.emit(reason === 'abandoned' ? 'mission:abandoned' : 'mission:failed', m); if (m.kind === 'story') this.refresh(); }
  track(id) { this.tracked = id; this.version++; this.emit('mission:tracked', id); }
  remove(m) { const i = this.active.indexOf(m); if (i >= 0) this.active.splice(i, 1); if (this.tracked === m.id) this.tracked = this.active[0]?.id || null; }
  event(name, d) { for (const m of [...this.active]) { const o = m.objectives[m.step], T = o && OBJ[o.type]; if (T?.on) { const p = o.p; T.on(o, m, this.e, name, d || {}); if (o.p !== p) this.progress(m, o); } } }
  progress(m, o) { this.version++; this.emit('mission:progress', { mission: m, objective: o, p: o.p, n: o.n }); if (!this.auth()) this.e.request?.('progress', { id: m.id, step: m.step, p: o.p }); this.check(m); }
  check(m) {
    let o = m.objectives[m.step]; if (!o || o.p < o.n - 1e-6) return;
    o.done = true; if (o.line) this.e.radio?.(o.line); m.step++; this.version++; this.emit('mission:objective', { mission: m, objective: o });
    const nx = m.objectives[m.step]; if (nx) { this.emit('mission:step', { mission: m, objective: nx }); return; }
    if (this.auth()) this.complete(m);
  }
  complete(m) {
    if (m.state === 'done') return; m.state = 'done'; m.bonus = m.time ? Math.round(clamp(m.left / m.time) * 0.35 * m.reward.money / 10) * 10 : 0; this.remove(m); this.done.push(m.id); if (this.done.length > 40) this.done.shift();
    this.version++; this.emit('mission:complete', m); this.genT = 0;
  }
  fail(m, reason) { this.abandon(m.id, reason); }
  update(dt) {
    const e = this.e; this.genT -= dt; for (const m of this.available) if (m.kind !== 'story') m.expires -= dt;
    if (this.genT <= 0) { this.genT = 20; this.refresh(); }
    for (const m of [...this.active]) {
      const o = m.objectives[m.step]; if (!o) continue;
      if (m.time) { m.left -= dt; if (m.left <= 0 && this.auth()) { this.fail(m, 'Out of time'); continue; } }
      if (this.auth() && m.kind !== 'story' && !this.alive(m)) { m.grace = (m.grace || 0) + dt; if (m.grace > 45) { this.fail(m, 'The storm is gone'); continue; } }
      this.ensure(m, dt);
      const T = OBJ[o.type]; if (T?.tick) { const p = o.p; T.tick(o, m, e, dt); if (o.p !== p) { if (Math.floor(p * 4) !== Math.floor(o.p * 4) || o.p >= o.n) this.progress(m, o); } }
    }
  }
  marker(m = this.current) { if (!m) return null; const o = m.objectives[m.step]; return (o && OBJ[o.type]?.marker?.(o, m, this.e)) || null; }
  serialize() { return { v: this.version, a: this.available, c: this.active, d: this.done.slice(-12) }; }
  apply(s) {
    if (!s) return; const me = this.done; const prev = this.active, was = new Map(prev.map((m) => [m.id, m]));
    this.available = s.a || []; const act = s.c || [];
    for (const m of act) { const old = was.get(m.id); if (old) { for (let i = 0; i < m.objectives.length; i++) m.objectives[i].p = Math.max(m.objectives[i].p, i === m.step && old.step === m.step ? old.objectives[i].p : 0); if (m.step > old.step) this.emit('mission:step', { mission: m, objective: m.objectives[m.step] }); } else if (!me.includes(m.id)) { this.emit('mission:accepted', m); this.tracked ||= m.id; } }
    this.active = act;
    for (const m of prev) if (!act.some((x) => x.id === m.id)) { if ((s.d || []).includes(m.id) && !me.includes(m.id)) { m.state = 'done'; me.push(m.id); this.emit('mission:complete', m); } else if (!me.includes(m.id)) this.emit('mission:failed', { ...m, reason: 'Dropped' }); }
    if (!act.some((m) => m.id === this.tracked)) this.tracked = act[0]?.id || null;
    this.version++; this.emit('mission:board', this.available);
  }
}

// Storm simulation system. Host authoritative, deterministic, runs in node (no DOM, no three).
import { rng, hash2 } from '../core/rng.js';
import { clamp, lerp, smoothstep, damp, compass, dirToHeading, MPH, MI } from '../core/math.js';
import { BOUNDS } from '../core/geo.js';
import { axisAt as axisFn, funnelRadius, packTornado } from './tornadoAxis.js';
import { makeTornado, stepTornado, stageTau, SHAPES } from './tornado.js';
import { makeStorm, stepStorm, TYPES } from './storm.js';
import { createField } from './field.js';

const ABBR = { Alabama: 'AL', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY' };
const r1 = (v) => Math.round(v * 10) / 10, r3 = (v) => Math.round(v * 1000) / 1000;

export async function create(ctx) {
  const seed0 = (ctx.stormSeed ?? ctx.seed ?? ((Date.now() / 1000) | 0)) >>> 0;
  const storms = [], tornadoes = [], outlook = [];
  const env = { steerX: 11, steerZ: -6, sfcX: -2.5, sfcZ: -6, day: 0, seed: seed0 };
  const S = { ctx, storms, tornadoes, env };
  const F = createField(S);
  let R = rng(seed0), nextId = 1, dirT = 0, started = false, lastSec = -1, snapT = 0, nStormsNamed = 0, quiet = 0;
  const lastP = new Map(), players = [], PW = { x: 0, y: 0, z: 0 }, aW = {}, camW = {};
  const bounds = () => ctx.world?.bounds || BOUNDS;
  const biome = (x, z) => ctx.world?.biomeAt?.(x, z), isLand = (x, z) => (ctx.world?.isLand ? ctx.world.isLand(x, z) : true);
  const prob = (x, z) => (isLand(x, z) ? biome(x, z)?.tornadoProb ?? 0.5 : 0);
  const emit = (n, d) => ctx.events?.emit(n, d);
  const tod = () => 0.55 + 0.45 * smoothstep(0, 1, 0.5 + 0.75 * Math.cos((ctx.time.hour - 17.5) / 24 * Math.PI * 2)); // peak 17:30

  function newDay(d) {
    env.day = d; const q = rng((seed0 ^ Math.imul(d + 1, 2654435761)) >>> 0), h = (q.range(38, 82)) * Math.PI / 180, sp = q.range(9.5, 15.5);
    env.steerX = Math.sin(h) * sp; env.steerZ = -Math.cos(h) * sp; const s = (q.range(318, 356)) * Math.PI / 180, v = q.range(5, 8.5); env.sfcX = Math.sin(s) * v; env.sfcZ = -Math.cos(s) * v;
    buildOutlook(q);
  }
  function buildOutlook(q) {
    outlook.length = 0; const b = bounds(); let best = null, bs = -1;
    for (let i = 0; i < 60; i++) { const x = q.range(b.minX + 8000, b.maxX - 8000), z = q.range(b.minZ + 6000, b.maxZ - 6000), s = prob(x, z) * (0.5 + q()); if (s > bs) { bs = s; best = { x, z }; } }
    const peak = q() < 0.3 ? 3 : q() < 0.6 ? 2 : 1, L = ['SLGT', 'ENH', 'MDT', 'HIGH'];
    for (let i = 0; i <= peak; i++) outlook.push({ level: L[i], x: best.x + q.range(-900, 900), z: best.z + q.range(-900, 900), r: 15000 * (1 - i * 0.23) });
    let s2 = -1, b2 = null; for (let i = 0; i < 30; i++) { const x = q.range(b.minX + 6000, b.maxX - 6000), z = q.range(b.minZ + 5000, b.maxZ - 5000), d = Math.hypot(x - best.x, z - best.z), s = prob(x, z) * (d > 20000 ? 1 : 0.1); if (s > s2) { s2 = s; b2 = { x, z }; } }
    outlook.push({ level: 'SLGT', x: b2.x, z: b2.z, r: 9000 });
  }

  // -------------------------------------------------------------------- spawning
  function gatherPlayers() {
    players.length = 0; const p = ctx.player?.pos; if (p) players.push(p);
    const peers = ctx.net?.peers; if (peers) for (const q of peers.values()) if (q?.pos && Number.isFinite(q.pos.x ?? q.pos[0])) players.push(q.pos.x !== undefined ? q.pos : { x: q.pos[0], z: q.pos[2] ?? q.pos[1] });
    if (!players.length) players.push({ x: 0, z: 0 });
  }
  function addStorm(type, x, z, o = {}, age = 0) {
    const seed = (R() * 4294967296) >>> 0, st = makeStorm(nextId++, type, seed, x, z, o);
    st.age = age; st.born = o.noFade ? -1e6 : ctx.time.now; nameStorm(st); storms.push(st); stepStorm(st, 0, ctx.time.now, ctx.world, bounds()); emit('storm:spawn', st); return st;
  }
  function nameStorm(st) { if (st.name) return; const s = ctx.world?.stateAt?.(st.x, st.z); st.name = `${ABBR[s] || 'XX'}-${String(st.id % 100).padStart(2, '0')}`; }
  function addTornado(st, x, z, o = {}) {
    const t = makeTornado(nextId++, st, (R() * 4294967296) >>> 0, x, z, o); tornadoes.push(t); if (st) { st.nTor++; if (!o.parent) st.tornado = t; }
    stepTornado(t, 0, ctx.time.now, ctx.world, findT(o.parent)); emit('tornado:spawn', t); return t;
  }
  const findT = (id) => { if (!id) return null; for (let i = 0; i < tornadoes.length; i++) if (tornadoes[i].id === id) return tornadoes[i]; return null; };
  const steer = (o = {}, vary = 0.22) => { const a = (R() - 0.5) * 2 * vary, k = R.range(0.82, 1.2), c = Math.cos(a) * k, s = Math.sin(a) * k; o.vx = env.steerX * c - env.steerZ * s; o.vz = env.steerX * s + env.steerZ * c; return o; };

  // a supercell whose meso will pass 1.2-3.4 km from the player in `eta` seconds, first tornado before that
  function spawnForPlayer(p, immediate) {
    const o = steer({}), b = bounds(); let best = null, bs = -1;
    for (let i = 0; i < 14; i++) {
      const eta = immediate ? R.range(210, 420) : R.range(380, 620), miss = R.range(1500, 3800) * (R() < 0.5 ? -1 : 1), sp = Math.hypot(o.vx, o.vz), fx = o.vx / sp, fz = o.vz / sp;
      const x = p.x - o.vx * eta - fz * miss, z = p.z - o.vz * eta + fx * miss, d = Math.hypot(x - p.x, z - p.z); if (x < b.minX - 2000 || x > b.maxX + 2000 || z < b.minZ - 2000 || z > b.maxZ + 2000) continue;
      const mx = x + o.vx * eta * 0.6, mz = z + o.vz * eta * 0.6, s = (0.15 + prob(x, z) + prob(mx, mz)) * (d > 3800 && d < 10000 ? 1 : 0.3) * (0.8 + 0.4 * R());
      if (s > bs) { bs = s; best = { x, z, eta }; }
    }
    if (!best) best = { x: p.x - o.vx * 300, z: p.z - o.vz * 300, eta: 300 };
    const pr = Math.max(prob(best.x, best.z), prob(p.x, p.z)); o.potential = clamp(0.5 + 0.5 * pr * R.range(0.6, 1.15) * tod() + 0.12, 0.45, 1);
    const age = immediate ? R.range(330, 480) : 0; if (immediate) o.noFade = 1;
    o.next = age + (immediate ? R.range(55, 130) : Math.min(R.range(330, 430), best.eta * 0.75)); o.life = age + R.range(1500, 2600);
    return addStorm('supercell', best.x, best.z, o, age);
  }
  function spawnAnywhere(type) {
    const b = bounds(); let best = null, bs = -1;
    for (let i = 0; i < 24; i++) {
      const x = R.range(b.minX + 2000, b.maxX - 5000), z = R.range(b.minZ + 4000, b.maxZ - 2000); let s = prob(x, z) * (0.4 + R());
      for (const q of outlook) { const d = Math.hypot(q.x - x, q.z - z); if (d < q.r) s *= 1.35; }
      for (const t of storms) if (Math.hypot(t.x - x, t.z - z) < 9000) s *= 0.15;
      for (const p of players) if (Math.hypot(p.x - x, p.z - z) < 4500) s *= 0.1;
      if (s > bs) { bs = s; best = { x, z }; }
    }
    const o = steer({}); if (type === 'supercell') { o.potential = clamp(0.25 + 0.75 * prob(best.x, best.z) * tod() * R.range(0.6, 1.2), 0.15, 1); if (R() > 0.35 + 0.6 * o.potential) o.next = 1e9; }
    return addStorm(type, best.x, best.z, o, started ? 0 : R.range(0, 700));
  }
  function director(dt) {
    if ((dirT -= dt) > 0) return; dirT = 2; gatherPlayers();
    const d = Math.floor((ctx.time.now + 600) / 3600); if (d !== env.day) newDay(d);
    let live = 0; for (const s of storms) if (s.phase !== 'dissipating') live++;
    const want = Math.round(3.2 + 2.6 * tod());
    for (const p of players) {
      let ok = false; const pid = p.id ?? players.indexOf(p), lp = lastP.get(pid), jumped = !lp || Math.hypot(lp.x - p.x, lp.z - p.z) > 2500; lastP.set(pid, { x: p.x, z: p.z });
      for (const s of storms) {
        if (s.type !== 'supercell' || s.o.hold) { if (s.o.hold && Math.hypot(s.x - p.x, s.z - p.z) < 16000) ok = true; continue; }
        const dx = s.meso.x - p.x, dz = s.meso.z - p.z, dd = Math.hypot(dx, dz), rem = s.life - 420 - s.age, coming = -(dx * s.vx + dz * s.vz) > 0 || dd < 6000;
        if (dd < 15000 && coming && rem > 150 && (s.tornado || s.next < s.life)) { ok = true; break; }
      }
      if (!ok && live < 8) { if (started) quiet += 2; if (!started || jumped || quiet > 6) { spawnForPlayer(p, !started || jumped); live++; quiet = 0; } }
    }
    if (live < want && storms.length < 9) { const u = R(); if (!started) { while (live++ < want) spawnAnywhere(R() < 0.55 ? 'supercell' : R() < 0.5 ? 'shower' : 'squall'); } else if (R() < 0.12) spawnAnywhere(u < 0.5 ? 'supercell' : u < 0.78 ? 'shower' : 'squall'); }
    started = true;
  }
  const minPlayerDist = (x, z) => { let m = 1e9; for (const p of players) m = Math.min(m, Math.hypot(p.x - x, p.z - z)); return m; };
  function genesis(st) {
    if (st.type !== 'supercell' || st.o.hold || st.age < st.next || (st.tornado && st.tornado.stage !== 'rope')) return;
    const m = st.meso; let tx = 0, tz = 0, ok = false;
    for (let i = 0; i < 8 && !ok; i++) { const a = R() * 6.283, q = m.r * R.range(0.1, 0.45 + i * 0.08); tx = m.x + Math.cos(a) * q; tz = m.z + Math.sin(a) * q; ok = minPlayerDist(tx, tz) > 1550; }
    if (!ok) { st.next = st.age + 12; return; }
    if (prob(tx, tz) <= 0 && !isLand(tx, tz) && R() < 0.6) { st.next = st.age + 60; return; }
    const t = addTornado(st, tx, tz); st.cycles++;
    const again = R() < 0.45 + 0.5 * st.potential; st.next = again ? st.age + t.life * R.range(0.82, 1.05) + R.range(40, 190) : 1e9; if (st.next > st.life - 500) st.next = 1e9;
    if (t.efPeak >= 4 && t.p.rPeak > 150 && R() < 0.4) { t.satAt = t.life * R.range(0.4, 0.55); }
  }

  // -------------------------------------------------------------------- warnings
  function place(x, z) {
    const w = ctx.world, c = w?.nearestCity?.(x, z), s = w?.stateAt?.(x, z) || c?.state || ''; if (!c) return { s, txt: s || 'this area', city: null };
    const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), mi = d / MI;
    return { s, city: c, d, txt: mi < 0.6 ? `${c.name}` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi ${compass(dirToHeading(dx, dz))} of ${c.name}` };
  }
  function warnings() {
    for (const st of storms) {
      const t = st.tornado, mph = Math.round(Math.hypot(st.vx, st.vz) * MPH / 5) * 5, dir = compass(st.heading);
      const tor = t ? (t.onGround ? (t.ef >= 4 ? 3 : 2) : 1) : st.rotation > 0.78 && st.next - st.age < 110 ? 1 : 0, svr = st.intensity > 0.6 && (st.hail > 2.4 || st.type !== 'shower');
      if (tor && tor > (st._torLvl || 0)) {
        const at = t || st.meso, P = place(at.x, at.z); st._torLvl = tor; st.warned = true; st.warnKind = 'TOR';
        const body = tor === 3 ? `TORNADO EMERGENCY for ${P.s || 'the area'}. A large and extremely dangerous tornado is on the ground ${P.txt}, moving ${dir} at ${mph} mph. Seek shelter underground now.`
          : tor === 2 ? `Tornado warning, ${P.s}. A tornado has been confirmed ${P.txt}, moving ${dir} at ${mph} mph. Take cover now.` : `Tornado warning, ${P.s}. Radar indicates strong rotation ${P.txt}, moving ${dir} at ${mph} mph.`;
        emit('warning', { kind: 'TOR', level: tor, storm: st, text: body, city: P.city, x: at.x, z: at.z });
      } else if (!tor) { if (st._torLvl) st._torLvl = 0; st.warned = !!st._svr; st.warnKind = st._svr ? 'SVR' : null; }
      if (svr && !st._svr) {
        st._svr = true; if (!tor) { st.warned = true; st.warnKind = 'SVR'; } const P = place(st.x, st.z), hz = st.hail > 2.4 ? `${(st.hail / 2.54).toFixed(1)} inch hail and 60 mph gusts` : '65 mph wind gusts';
        emit('warning', { kind: 'SVR', level: 1, storm: st, text: `Severe thunderstorm warning, ${P.s}. ${hz}. Storm located ${P.txt}, moving ${dir} at ${mph} mph.`, city: P.city, x: st.x, z: st.z });
      } else if (!svr && st.intensity < 0.4) st._svr = false;
    }
  }
  // -------------------------------------------------------------------- lightning: deterministic per (storm, 0.25 s slot) so every client sees the same strokes
  function lightning() {
    const slot = Math.floor(ctx.time.now * 4); if (slot === lastSec) return; const from = lastSec < 0 || slot - lastSec > 8 ? slot : lastSec + 1; lastSec = slot;
    for (let q = from; q <= slot; q++) for (const st of storms) {
      if (hash2(q, st.seed & 0xffffff, 5) > st.lightning * 0.25) continue;
      const a = hash2(q, st.seed & 0xffffff, 6) * 6.283, u = hash2(q, st.seed & 0xffffff, 7), v = hash2(q, st.seed & 0xffffff, 8), w = hash2(q, st.seed & 0xffffff, 9), sd = (hash2(q, st.seed & 0xffffff, 10) * 1e9) | 0;
      let cx = st.rain.x * 0.6 + st.x * 0.4, cz = st.rain.z * 0.6 + st.z * 0.4, rad = st.rain.r * 1.5;
      if (st.type === 'squall') { const l = (u * 2 - 1) * st.len; cx = st.x - st.fz * l; cz = st.z + st.fx * l; }
      const cg = v < 0.3, anvil = !cg && v > 0.86, e = (0.35 + 0.65 * w * w) * (cg ? 1 : 0.7), d = rad * Math.sqrt(hash2(q, st.seed & 0xffffff, 11)), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, g = F.ground(x, z);
      if (cg) { const ox = x + (u - 0.5) * 1800, oz = z + (w - 0.5) * 1800; emit('lightning', { x: ox, y: st.y0 + st.cloudBase * 1.25, z: oz, tx: x, ty: ctx.world?.heightAt(x, z) ?? g, tz: z, energy: e, kind: 'cg', seed: sd, strokes: strokes('cg', sd), storm: st.id }); }
      else { const yy = st.y0 + (anvil ? st.cloudTop * 0.72 : lerp(st.cloudBase * 1.5, st.cloudTop * 0.6, u)), l = anvil ? 6500 : 2200, b = a + 1.2 + w * 3; emit('lightning', { x, y: yy, z, tx: x + Math.cos(b) * l, ty: yy + (w - 0.5) * (anvil ? 500 : 1500), tz: z + Math.sin(b) * l, energy: e, kind: 'ic', anvil, seed: sd, strokes: strokes('ic', sd), storm: st.id }); }
    }
  }
  // return strokes [[t s, energy, decay s]...] shared by the channel (fx) and the light (gfx)
  function strokes(kind, seed) { const r = rng(seed), n = 1 + Math.floor(r() * 4.2), out = []; let t = kind === 'cg' ? 0.05 + r() * 0.09 : 0.02; for (let i = 0; i < n; i++) { out.push([r3(t), r3(i ? 0.35 + 0.6 * r() : 1), r3(0.045 + 0.06 * r() + (i === n - 1 ? 0.08 * r() : 0))]); t += 0.045 + r() * 0.13; } return out; }
  // -------------------------------------------------------------------- stepping
  function removeStorm(i) { const s = storms[i]; storms.splice(i, 1); emit('storm:end', s); }
  function step(dt) {
    const now = ctx.time.now, auth = api.isAuthority, w = ctx.world, b = bounds();
    if (auth && api.director) director(dt);
    for (let i = storms.length - 1; i >= 0; i--) { const s = storms[i]; stepStorm(s, dt, now, w, b); if (auth) genesis(s); if (s.done && auth && !s.tornado) removeStorm(i); }
    for (let i = tornadoes.length - 1; i >= 0; i--) {
      const t = tornadoes[i], was = t.stage, parent = findT(t.parent), wasG = t.onGround; let dead = stepTornado(t, dt, now, w, parent);
      if (t.parent && !parent && auth && t.age < t.life * 0.86) t.age = t.life * 0.86;
      if (t.stage !== was) emit('tornado:stage', t); if (t.onGround && !wasG) emit('tornado:touchdown', t);
      if (auth && t.satAt && t.age > t.satAt) { t.satAt = 0; const r = Math.min(1500, t.rCore * R.range(3.2, 4.4) + 120); addTornado(t.storm, t.x + r, t.z, { parent: t.id, ef: Math.floor(R() * 2), shape: R() < 0.5 ? 'rope' : 'cone', life: R.range(80, 170), orbR: r, orbA: R() * 6.28 }); }
      if (dead) { if (t.stage !== 'dead') t.stage = 'dead'; tornadoes.splice(i, 1); if (t.storm?.tornado === t) t.storm.tornado = null; emit('tornado:end', t); }
      else { const p = ctx.player?.pos || ctx.camera?.position; t.dist = p ? Math.hypot(t.x - p.x, t.z - p.z) : undefined; }
    }
    warnings(); lightning(); writeGlobals(dt);
  }
  const near = [null, null, null, null];
  function writeGlobals(dt) {
    const g = ctx.globals, c = ctx.camera?.position; if (!g || !c) return;
    F.windAt(c.x, Math.max(c.y, F.ground(c.x, c.z) + 3), c.z, PW); const q = 1 - Math.exp(-dt * 5); g.uWind.value.x += (PW.x - g.uWind.value.x) * q; g.uWind.value.y += (PW.z - g.uWind.value.y) * q;
    F.weatherAt(c.x, c.z, camW); const sp = Math.hypot(PW.x, PW.z); g.uGust.value = damp(g.uGust.value, clamp((sp - 7) / 24), 2.5, dt);
    g.uRain.value = damp(g.uRain.value, camW.rain, 1.5, dt); g.uHail.value = damp(g.uHail.value, camW.hail, 1.5, dt); g.uStormDark.value = damp(g.uStormDark.value, camW.dark, 0.6, dt);
    const wet = camW.rain > 0.02; g.uWetness.value = clamp(g.uWetness.value + dt * (wet ? 0.012 + 0.12 * camW.rain : -0.008)); api.local = camW;
    // four nearest/strongest tornadoes
    near.fill(null); for (const t of tornadoes) { const s = t.dist ?? 0; for (let k = 0; k < 4; k++) if (!near[k] || s < (near[k].dist ?? 0)) { for (let j = 3; j > k; j--) near[j] = near[j - 1]; near[k] = t; break; } }
    for (let k = 0; k < 4; k++) { const t = near[k], v = g.uTornadoA.value[k]; if (t) v.set(t.x, t.z, t.rCore, t.vmax * (t.onGround ? 1 : 0.35)); else v.set(0, 0, 1, 0); }
  }
  // -------------------------------------------------------------------- network
  function snapshot() {
    return { t: r3(ctx.time.now), sd: seed0, d: env.day, s: storms.map((s) => [s.id, TYPES.indexOf(s.type), s.seed, r1(s.x), r1(s.z), r3(s.vx), r3(s.vz), r1(s.age), r1(s.born), r1(s.next), s.name, s.o]),
      n: tornadoes.map((t) => [t.id, t.storm?.id ?? 0, t.seed, r1(t.x), r1(t.z), r1(t.age), t.o, t.spin, t.sub.map((v) => r3(v.a)), t.efMax, r3(t.storm ? t.storm.potential : 0.7)]) };
  }
  function applySnapshot(m) {
    if (!m || !m.s) return; const now = ctx.time.now, lag = clamp(now - m.t, 0, 2);
    if (m.sd !== env.netSeed || m.d !== env.day) { env.netSeed = m.sd; newDayFrom(m.sd, m.d); }
    const seen = new Set();
    for (const a of m.s) {
      let s = storms.find((q) => q.id === a[0] && q.seed === a[2]); seen.add('s' + a[0] + a[2]); const isNew = !s;
      if (isNew) { s = makeStorm(a[0], TYPES[a[1]], a[2], a[3], a[4], a[11] || {}); s.born = a[8]; s.name = a[10]; storms.push(s); }
      const x = a[3] + a[5] * lag, z = a[4] + a[6] * lag; s.vx = a[5]; s.vz = a[6]; s.age = a[7] + (s.o.hold ? 0 : lag); s.next = a[9];
      if (isNew || Math.hypot(x - s.x, z - s.z) > 900) { s.x = x; s.z = z; s.ex = s.ez = 0; } else { s.ex = x - s.x; s.ez = z - s.z; }
      if (isNew) { stepStorm(s, 0, now, ctx.world, bounds()); emit('storm:spawn', s); }
    }
    for (let i = storms.length - 1; i >= 0; i--) if (!seen.has('s' + storms[i].id + storms[i].seed)) removeStorm(i);
    seen.clear(); for (const s of storms) s.tornado = null;
    for (const a of m.n) {
      let t = tornadoes.find((q) => q.id === a[0] && q.seed === a[2]); seen.add(a[0] + '_' + a[2]); const isNew = !t, st = storms.find((q) => q.id === a[1]) || null;
      if (isNew) { if (st) st.potential = a[10]; t = makeTornado(a[0], st, a[2], a[3], a[4], a[6] || {}); t.spin = a[7]; tornadoes.push(t); }
      t.storm = st; if (st && !t.parent) st.tornado = t; const x = a[3] + t.vx * lag, z = a[4] + t.vz * lag; t.age = a[5] + (t.o.hold ? 0 : lag); t.efMax = Math.max(t.efMax, a[9]);
      if (isNew || Math.hypot(x - t.x, z - t.z) > 400) { t.x = x; t.z = z; t.ex = t.ez = 0; } else { t.ex = x - t.x; t.ez = z - t.z; }
      if (isNew) { t._bioT = 0; stepTornado(t, 0, now, ctx.world, findT(t.parent)); }
      for (let i = 0; i < t.sub.length && i < a[8].length; i++) { const w = a[8][i] - t.spin * t.vmax * 0.52 / Math.max(10, t.rCore) * lag; let dA = (w - t.sub[i].a) % 6.2832; if (dA > 3.1416) dA -= 6.2832; if (dA < -3.1416) dA += 6.2832; t.sub[i].a += isNew || Math.abs(dA) > 1.5 ? dA : dA * 0.3; }
      if (isNew) emit('tornado:spawn', t);
    }
    for (let i = tornadoes.length - 1; i >= 0; i--) { const t = tornadoes[i]; if (!seen.has(t.id + '_' + t.seed)) { tornadoes.splice(i, 1); emit('tornado:end', t); } }
    started = true;
  }
  function newDayFrom(sd, d) { const q = rng((sd ^ Math.imul(d + 1, 2654435761)) >>> 0), h = (q.range(38, 82)) * Math.PI / 180, sp = q.range(9.5, 15.5); env.day = d; env.steerX = Math.sin(h) * sp; env.steerZ = -Math.cos(h) * sp; const s = (q.range(318, 356)) * Math.PI / 180, v = q.range(5, 8.5); env.sfcX = Math.sin(s) * v; env.sfcZ = -Math.cos(s) * v; buildOutlook(q); }

  // -------------------------------------------------------------------- public API
  /** spawn for missions / tutorial / dev. opts: {ef, stage, type:'supercell'|'squall'|'shower'|<tornado shape>, shape, hold, still, vx, vz, vPeak, rCore, swirl, life, noTornado} -> Tornado (or Storm) */
  function spawnAt(x, z, opts = {}) {
    if (!api.isAuthority) return null; started = true;
    const kind = TYPES.includes(opts.type) ? opts.type : 'supercell', shape = opts.shape || (SHAPES.includes(opts.type) ? opts.type : undefined);
    const o = steer({}, 0.1); if (opts.vx !== undefined) o.vx = opts.vx; if (opts.vz !== undefined) o.vz = opts.vz; if (opts.hold) o.hold = 1; if (opts.still) o.still = 1; o.noFade = 1; if (opts.peak) o.peak = opts.peak; if (opts.cloudBase) o.cloudBase = opts.cloudBase; if (opts.potential) o.potential = opts.potential; o.next = 1e9;
    if (kind !== 'supercell' || opts.noTornado) { if (opts.next !== undefined) o.next = opts.next; return addStorm(kind, x, z, o, opts.age ?? (kind === 'shower' ? 330 : 600)); }
    let st = null; if (!opts.hold) for (const s of storms) if (s.type === 'supercell' && s.phase === 'mature' && Math.hypot(s.meso.x - x, s.meso.z - z) < s.meso.r && !s.tornado) st = s;
    if (!st) { // put the parent so that its mesocyclone is over the tornado
      st = addStorm('supercell', x, z, o, 700); st.x += x - st.meso.x; st.z += z - st.meso.z; stepStorm(st, 0, ctx.time.now, ctx.world, bounds());
    }
    const tau = stageTau(opts.stage || 'funnel'), to = { tau }; for (const k of ['ef', 'vPeak', 'rCore', 'swirl', 'life', 'spin']) if (opts[k] !== undefined) to[k] = opts[k]; if (shape) to.shape = shape; if (opts.hold) to.hold = 1; if (opts.still) to.still = 1;
    const t = addTornado(st, x, z, to); const lf = st.age + t.life * (1 - tau) + 700; if (st.life < lf) st.life = st.p.life = st.o.life = lf; if (!opts.hold && opts.cyclic) st.next = st.age + t.life + 120; return t;
  }
  function clear() { for (let i = tornadoes.length - 1; i >= 0; i--) emit('tornado:end', tornadoes[i]); for (const s of storms) emit('storm:end', s); tornadoes.length = 0; storms.length = 0; }

  const api = {
    list: storms, tornadoes, outlook, env, local: camW, director: true,
    get isAuthority() { return (ctx.net?.role ?? 'solo') !== 'client'; },
    axisAt: (t, h, o) => axisFn(t, h, o, ctx.time.now), funnelRadius, packTornado,
    windAt: F.windAt, ambient: F.ambient, pressureAt: F.pressureAt, weatherAt: F.weatherAt, reflectivity: F.reflectivity, velocity: F.velocity, cape: F.cape, echo: F.echo,
    snapshot, applySnapshot, spawnAt, clear, place,
    nearestTornado(x, z) { let b = null, m = 1e12; for (const t of tornadoes) { const d = (t.x - x) ** 2 + (t.z - z) ** 2; if (d < m) { m = d; b = t; } } return b; },
    restart() { clear(); started = false; dirT = 0; quiet = 0; },
    update(dt) { if (dt > 0) step(dt); },
  };
  newDay(Math.floor((ctx.time.now + 600) / 3600));
  ctx.events?.on('game:start', (e) => { if (e?.mode === 'join') clear(); else if (!api.frozen) api.restart(); });
  ctx.events?.on('player:respawn', () => { dirT = Math.min(dirT, 1); });
  Object.defineProperty(api, '_dir', { get: () => director });
  return api;
}

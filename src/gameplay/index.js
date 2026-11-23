// GAMEPLAY system: profile, tools, missions, danger/stream economy, waypoints, services, dispatcher.
import * as THREE from 'three';
import { clamp, damp, dirToHeading, MPH } from '../core/math.js';
import { createProfile, gearValue, GEAR_UPGRADES, VEHICLE_UPGRADES, rankName, repForLevel } from './profile.js';
import { MissionManager, nearestTornado, nearestStorm } from './missions.js';
import { MARLOW, STORY } from './campaign.js';
import { createTools } from './tools.js';
import { approach, routeProgress, suggestIntercept, threatOf, trackCone, warningPolygon } from './track.js';
import { isNight } from './photo.js';
import { probeModel, droneModel } from './models.js';

const HINTS = [
  { id: 'drive', t: 1, when: (c) => c.mode === 'drive' && c.st > 2, text: 'Accelerate and steer', keys: ['throttle', 'left', 'brake', 'right'] },
  { id: 'missions', when: (c) => c.mode === 'drive' && c.st > 14 && !c.G.missions.active.length, text: 'Open contracts and take the first one', keys: ['missions'] },
  { id: 'radar', when: (c) => c.st > 26 && c.storm < 16000, text: 'Find storms on the radar', keys: ['radar'] },
  { id: 'map', when: (c) => c.st > 60 && !c.G.waypoint, text: 'Set a waypoint on the map', keys: ['map'] },
  { id: 'camera', when: (c) => c.storm < 7000 && c.st > 40 && !c.G.activeTool, text: 'Take out the camera', keys: ['tool1'] },
  { id: 'aim', when: (c) => c.G.activeTool === 'camera' && !c.G.tools.state.aiming, text: 'Hold to frame, then click to shoot', keys: ['mouse:right', 'mouse:left'] },
  { id: 'zoom', when: (c) => c.G.activeTool === 'camera' && c.G.tools.state.aiming && c.G.tools.state.mm < 50, text: 'Zoom the lens', keys: ['mouse:wheel'] },
  { id: 'close', when: (c) => c.tornado < 1600 && c.mode === 'drive', text: 'Park facing your exit. Photos pay more the closer you are.', keys: [] },
  { id: 'foot', when: (c) => c.mode === 'foot' && c.st > 5, text: 'Get back in the vehicle', keys: ['enter'] },
  { id: 'anchor', when: (c) => c.tornado < 700 && c.anchorable, text: 'Deploy ground anchors before it reaches you', keys: ['anchor'] },
  { id: 'fuel', when: (c) => c.fuel < 0.25, text: 'Low fuel. Stop in any town and open the garage', keys: ['garage'] },
  { id: 'probe', when: (c) => c.G.activeTool === 'probe', text: 'Drop a probe, then hold to drive in the anchor', keys: ['use'] },
  { id: 'scan', when: (c) => c.G.activeTool === 'scanner', text: 'Hold on the funnel and sweep from ground to cloud base', keys: ['mouse:left'] },
  { id: 'drone', when: (c) => c.G.tools.drone.active, text: 'Fly. Return within 10 m and press to land', keys: ['throttle', 'jump', 'crouch', 'use'] },
];

export async function create(ctx) {
  const types = ctx.vehicles?.types || {}, profile = createProfile(ctx.events, types), P = profile.data, rnd = ctx.rng((Date.now() & 0xffff) + 11);
  const V = new THREE.Vector3(), AP = {}, RP = {}, queue = [];
  let started = 0, radioT = 0, acc = 0, slow = 0, wpT = 0, streamQuiet = 0, lastPos = null, hint = null, hintT = 0, netReady = false, gasT = 0, lastLine = {}, sweptAt = null;
  const env = {
    now: 0, px: 0, pz: 0, speed: 0, mode: 'drive', heading: 0, hour: 17, level: 1, story: 0, authority: true, armorLevel: 0, useHeld: false, measure: { active: false, wind: 0, hail: 0 }, drone: null, tornadoes: [], storms: [], cities: [],
    nearestCity: (x, z) => ctx.world.nearestCity?.(x, z), roadNear: (x, z) => ctx.world.roads?.nearest?.(x, z),
    spawn: (x, z, o) => { try { return ctx.storms.spawnAt?.(x, z, o); } catch (e) { console.error('[missions] spawnAt', e); } return null; },
    radio: (t) => G.radio(t), emit: (n, d) => ctx.events.emit(n, d), request: (a, d) => { if (ctx.net?.role === 'client') ctx.net.send('gp:req', { a, d }, { to: ctx.net.hostId, reliable: true }); },
  };
  const tools = createTools(ctx, profile, { onPhoto() {} }), missions = new MissionManager(env, ctx.events);
  Object.defineProperty(tools, 'state', { get: () => tools.st });

  const G = {
    profile: P, economy: profile, types, GEAR_UPGRADES, VEHICLE_UPGRADES, STORY, tools, missions, waypoint: null, threat: { level: 0, dist: Infinity, tornado: null, closing: 0, eta: 0, cpa: 0, heading: 0 }, danger: { active: false, mult: 1, pot: 0, rate: 0, viewers: 0, closeness: 0 }, intercept: null, prompt: null, hint: null, subtitle: null, swept: null, rankName, repForLevel, handlesNetTool: true,
    get activeTool() { return tools.st.active; }, get drone() { return tools.drone; }, get probes() { return tools.probes.list; }, get scanning() { return tools.st.scan.on; }, get mode() { return ctx.player.mode; },
    selectTool: (id) => tools.select(id), accept: (id) => missions.accept(id), abandon: (id) => missions.abandon(id), track: (id) => { missions.track(id); const m = missions.marker(); if (m) G.setWaypoint(m.x, m.z, m.label, { kind: 'mission' }); },
    buyVehicle: (id) => profile.buyVehicle(id), selectVehicle: (id) => profile.select(id), buyUpgrade: (k, v) => { const r = profile.buyUpgrade(k, v || P.current); applyMods(true); return r; },
    createProbeVisual: () => probeModel(), createDroneVisual: () => droneModel(), syncViewModel: (dt) => tools.syncView(dt), trackCone, warningPolygon, approach,
    setWaypoint(x, z, label = 'Waypoint', o = {}) { let route = null; const p = pos(); try { route = ctx.world.route?.(p.x, p.z, x, z) || null; } catch (e) { console.error('[route]', e); } G.waypoint = { x, z, label, kind: o.kind || 'user', route, dist: 0, rem: 0, turn: 0, turnDist: 0, eta: 0 }; wpT = 4; updateWaypoint(); if (!o.silent) ctx.events.emit('waypoint:set', G.waypoint); return G.waypoint; },
    clearWaypoint() { G.waypoint = null; ctx.events.emit('waypoint:clear'); },
    radio(text, who = 'Marlow', now = false) { if (queue.length > 4 && !now) return; const q = { text, who }; if (now) queue.unshift(q); else queue.push(q); },
    say(kind, data = {}, gap = 45) { const t = ctx.time.real; if (t - (lastLine[kind] ?? -1e9) < gap) return; lastLine[kind] = t; G.radio(rnd.pick(MARLOW[kind]).replace('{s}', data.s || 'the storm')); },
    // ---- services
    serviceInfo() {
      const p = pos(), c = ctx.world.nearestCity?.(p.x, p.z), d = c ? Math.hypot(c.x - p.x, c.z - p.z) : 1e9, st = nearestStation(p.x, p.z), inTown = (c && d < Math.max(380, c.radius * 0.85)) || (st && st.d < 70), v = ctx.player.vehicle || ctx.vehicles.active || ctx.vehicles.list?.[0], t = v && (types[typeId(v)] || {}), k = inTown ? 1 : 2.2, fee = inTown ? 0 : 180;
      return { inTown: !!inTown, city: c?.name, vehicle: v, fuelCost: v ? Math.round((1 - v.fuel) * (70 + (t.fuelCap || 80) * 0.6) * k / 5) * 5 + (v.fuel < 0.985 ? fee : 0) : 0, repairCost: v ? Math.round((v.damage || 0) * (500 + (t.price || 8000) * 0.055) * k / 5) * 5 + (v.damage > 0.015 ? fee : 0) : 0, station: st };
    },
    refuel() { const s = G.serviceInfo(); if (!s.vehicle || s.vehicle.fuel > 0.985) return false; if (!profile.pay(s.fuelCost, 'Fuel')) return poor(); if (ctx.vehicles.refuel) ctx.vehicles.refuel(s.vehicle); else s.vehicle.fuel = 1; ctx.audio?.play?.('refuel'); ctx.events.emit('service', { kind: 'fuel', cost: s.fuelCost, inTown: s.inTown }); return true; },
    repair() { const s = G.serviceInfo(); if (!s.vehicle || !(s.vehicle.damage > 0.015)) return false; if (!profile.pay(s.repairCost, 'Repair')) return poor(); if (ctx.vehicles.repair) ctx.vehicles.repair(s.vehicle); else s.vehicle.damage = 0; ctx.audio?.play?.('repair'); ctx.events.emit('service', { kind: 'repair', cost: s.repairCost, inTown: s.inTown }); return true; },
    restock() { tools.probes.restock(); return true; },
    deliverVehicle(id) { // swap active vehicle in town
      if (!P.owned.includes(id)) return false; profile.select(id); if (ctx.state === 'menu') return true; const s = G.serviceInfo(); if (!s.inTown) { ctx.ui?.notify?.({ title: 'Not in town', text: 'Vehicle will be waiting at your next stop.', kind: 'info' }); return true; }
      const p = pos(), r = ctx.world.roads?.nearest?.(p.x, p.z), x = r ? r.x : p.x, z = r ? r.z : p.z, h = r ? dirToHeading(r.dirX, r.dirZ) : 0, old = ctx.player.vehicle; if (old && typeId(old) === id) return true; if (old) { ctx.player.exit?.(); (ctx.vehicles.remove || ctx.vehicles.despawn)?.call(ctx.vehicles, old); } const v = ctx.vehicles.spawn(id, x, z, h); if (v) { v.mods = profile.vehicleMods(id); ctx.player.enter?.(v); } return true;
    },
    // ---- spotter reports
    reportKinds: [['tornado', 'Tornado'], ['funnel', 'Funnel cloud'], ['wallcloud', 'Wall cloud'], ['hail', 'Large hail'], ['wind', 'Damaging wind']],
    reportCd: 0, reported: {},
    submitReport(kind) {
      if (G.reportCd > 0) { ctx.ui?.notify?.({ title: 'Report not sent', text: `Wait ${Math.ceil(G.reportCd)} s`, kind: 'info' }); return false; } G.reportCd = 12; const p = pos(), S = ctx.storms, w = S.weatherAt?.(p.x, p.z) || {}, near = (r, f) => S.tornadoes.find((t) => t.stage !== 'dead' && f(t) && Math.hypot(t.x - p.x, t.z - p.z) < r); let src = null;
      if (kind === 'tornado') src = near(7000, (t) => t.stage !== 'funnel'); else if (kind === 'funnel') src = near(7000, (t) => t.stage === 'funnel' || t.condense < 0.9); else if (kind === 'wallcloud') src = S.list.find((s) => s.type === 'supercell' && (s.rotation ?? 0) > 0.45 && Math.hypot((s.meso?.x ?? s.x) - p.x, (s.meso?.z ?? s.z) - p.z) < 6000); else if (kind === 'hail') src = (w.hail || 0) > 0.18 ? w.storm || { id: 'h' } : null; else if (kind === 'wind') src = Math.max(w.gust || 0, tools.st.meter.wind) > 25 ? w.storm || { id: 'w' } : null;
      const key = kind + ':' + (src?.id ?? '');
      if (!src) { profile.addRep(-8); ctx.events.emit('report:rejected', { kind }); ctx.ui?.notify?.({ title: 'Report rejected', text: 'The desk sees nothing to support that. Reputation lost.', kind: 'bad' }); return false; }
      if (G.reported[key]) { ctx.ui?.notify?.({ title: 'Already logged', text: 'That report is in the system.', kind: 'info' }); ctx.events.emit('report:accepted', { kind, repeat: true }); return true; } G.reported[key] = 1; const pay = { tornado: 600, funnel: 350, wallcloud: 250, hail: 300, wind: 300 }[kind] || 200; P.stats.reports++; profile.earn(pay, 'Storm report'); profile.addRep(14); ctx.events.emit('report:accepted', { kind, pay, x: p.x, z: p.z }); ctx.ui?.notify?.({ title: 'Report accepted', text: `Ground truth logged. +$${pay}`, kind: 'good' }); return true;
    },
    // ---- respawn
    respawn() {
      const cost = G.swept?.cost || 0; if (cost) profile.earn(-Math.min(cost, P.money), 'Recovery'); const p = G.swept || pos(), c = ctx.world.nearestCity?.(p.x, p.z); G.swept = null;
      if (ctx.player.respawn) ctx.player.respawn(c?.name); else { const s = ctx.world.spawnPoint(c?.name); ctx.player.teleport(s.x, s.z, s.heading); let v = ctx.vehicles.list?.find?.((x) => !x.remote); if (v && !ctx.vehicles.recover) v = null; if (!v) v = ctx.vehicles.spawn(P.current, s.x, s.z, s.heading); else { ctx.vehicles.repair?.(v); if (v.pos?.set) v.pos.set(s.x, ctx.world.heightAt(s.x, s.z) + 1, s.z); ctx.vehicles.recover?.(v); } if (v) ctx.player.enter?.(v); try { ctx.player.health = 1; } catch { /* ro */ } }
      ctx.events.emit('gameplay:respawned', { cost });
    },
    // ---- co-op
    serializeShared() {
      const cl = (m) => { const o = { ...m, left: m.time ? Math.ceil(m.left / 5) * 5 : 0, expires: 999, ensureT: 0, grace: 0, age: 0 }; o.objectives = m.objectives.map((q) => ({ ...q, p: Math.round(q.p * 10) / 10, live: 0, frac: Math.round((q.frac || 0) * 10) / 10, note: undefined })); return o; }; const s = missions.serialize(); return { a: s.a.map(cl), c: s.c.map(cl), d: s.d };
    },
    applyShared(s) { if (!s || !Array.isArray(s.a) || !Array.isArray(s.c)) return; const lv = P.level; for (const m of s.a) if (m.kind === 'story') m.locked = lv < m.level; const keep = new Map(missions.active.map((m) => [m.id, m.left])); missions.apply(s); for (const m of missions.active) if (keep.has(m.id) && Math.abs(keep.get(m.id) - m.left) < 7) m.left = keep.get(m.id); },
    dispose() { profile.save(); },
  };
  tools.G = G;
  const pos = () => ctx.player.vehicle && ctx.player.mode === 'drive' ? ctx.player.vehicle.pos : ctx.player.pos || ctx.camera.position;
  const typeId = (v) => (typeof v.type === 'string' ? v.type : v.type?.id ?? v.typeId);
  const poor = () => { ctx.ui?.notify?.({ title: 'Not enough money', text: 'Sell photos or take a contract.', kind: 'bad' }); return false; };
  function nearestStation(x, z) { const L = ctx.world.services || ctx.world.gasStations; if (!L) return null; let b = null, bd = 1e9; for (const s of L) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; b = s; } } return b ? { x: b.x, z: b.z, d: bd } : null; }
  function applyMods(force) { for (const v of ctx.vehicles.list || []) if (!v.remote && (force || !v.mods)) { v.mods = profile.vehicleMods(typeId(v)); ctx.vehicles.setMods?.(v, v.mods); } }
  function updateWaypoint() {
    const w = G.waypoint; if (!w) return; const p = pos(); w.dist = Math.hypot(w.x - p.x, w.z - p.z);
    if (w.route && w.route.length >= 4) { routeProgress(w.route, p.x, p.z, RP); w.rem = RP.rem; w.turn = RP.turn; w.turnDist = RP.turnDist; w.off = RP.off; w.idx = RP.i; } else { w.rem = w.dist; w.turn = 0; } w.eta = w.rem / Math.max(12, env.speed || 24);
  }
  // ---------- events ----------
  const E = ctx.events, FWD = ['photo:taken', 'scan:progress', 'scan:complete', 'probe:deployed', 'probe:data', 'drone:launch', 'waypoint:set', 'ui:screen', 'report:accepted'];
  for (const n of FWD) E.on(n, (d) => { if (ctx.state !== 'menu') missions.event(n, d); });
  E.on('mission:accepted', (m) => { if (m.intro) for (const l of m.intro) G.radio(l); else G.radio(`Contract from ${m.client}. ${m.title}.`); const k = missions.marker(m); if (k) G.setWaypoint(k.x, k.z, k.label, { kind: 'mission', silent: true }); });
  E.on('mission:step', ({ mission }) => { if (missions.current !== mission) return; const k = missions.marker(mission); if (k) G.setWaypoint(k.x, k.z, k.label, { kind: 'mission', silent: true }); else if (G.waypoint?.kind === 'mission') G.clearWaypoint(); });
  E.on('mission:complete', (m) => { const pay = m.reward.money + (m.bonus || 0); profile.earn(pay, m.title); profile.addRep(m.reward.rep); P.stats.missions++; if (m.outro) G.radio(m.outro); if (m.kind === 'story' && m.story === P.story) { P.story++; P.storyDone.push(m.key); profile.save(); } env.story = P.story; if (G.waypoint?.kind === 'mission') G.clearWaypoint(); missions.genT = 1; });
  E.on('mission:failed', (m) => { if (m.kind === 'story') G.radio('That one got away from us. It is back on the board when you want it.'); profile.addRep(-6); if (G.waypoint?.kind === 'mission') G.clearWaypoint(); });
  E.on('mission:objective', ({ objective }) => { if (objective.siren) { const c = ctx.world.nearestCity?.(env.px, env.pz); E.emit('siren:on', { name: c?.name, x: c?.x ?? env.px, z: c?.z ?? env.pz, duration: 120 }); } });
  E.on('warning', (d) => { if (ctx.state === 'playing' && d.kind === 'TOR') { const s = d.storm; if (s && Math.hypot(s.x - env.px, s.z - env.pz) < 14000) G.say('warned', { s: s.name || 'that storm' }, 40); } });
  E.on('player:swept', (d) => { if (sweptAt) return; sweptAt = { t: ctx.time.real }; G.danger.lost = G.danger.pot; const pot = G.danger.pot; G.danger.pot = 0; G.danger.mult = 1; G.danger.active = false; const p = pos(); P.stats.swept++; tools.select(null); G.swept = { x: p.x, z: p.z, cost: Math.min(2500, Math.round((80 + P.money * 0.04) / 10) * 10), lost: Math.round(pot), ef: G.threat.tornado?.ef ?? 0, wind: tools.st.meter.wind, peak: 0, height: 0, dist: 0, t: 0, sx: p.x, sz: p.z, ...(d && typeof d === 'object' ? { info: 1 } : {}) }; setTimeout(() => G.say('swept', {}, 5), 2600); E.emit('gameplay:swept', G.swept); });
  const clearSwept = () => { sweptAt = null; }; E.on('player:respawn', clearSwept); E.on('gameplay:respawned', clearSwept);
  E.on('levelup', () => { env.level = P.level; missions.refresh(); });
  E.on('game:started', (o) => { started = ctx.time.real; env.story = P.story; env.level = P.level; tools.clear(); tools.resetShots(); G.danger.pot = 0; G.danger.mult = 1; G.reported = {}; G.swept = null; sweptAt = null; G.waypoint = null; if (o?.mode !== 'join') { missions.available = []; missions.active = []; missions.done = []; } missions.genT = 0.5; applyMods(true); queue.length = 0; if (P.story === 0) G.radio('Radio check. Open your contract list when you are ready and take the first one.'); else G.radio(rnd.pick(['Morning. Models are ugly, which is good for business.', 'You are live on the network. Radar is updating.', 'Scope is busy today. Pick a storm and I will talk you in.'])); });
  E.on('game:quit', () => { tools.clear(); profile.save(); G.waypoint = null; G.danger.pot = 0; queue.length = 0; G.subtitle = null; missions.active = []; missions.available = []; G.swept = null; sweptAt = null; });
  E.on('vehicle:impact', () => {}); E.on('photo:taken', ({ result }) => { if (result.stars >= 4) streamBoost(result.stars * 0.12); });
  E.on('probe:data', (d) => ctx.ui?.notify?.(d.score > 0.08 ? { title: 'Probe data received', text: `Peak ${Math.round(d.peak * MPH)} mph, ${Math.round(d.minP)} hPa, ${Math.round(d.minDist)} m. +$${d.pay}`, kind: 'good', ttl: 7 } : { title: 'Probe missed', text: `Closest approach ${Math.round(d.minDist)} m. No usable data.`, kind: 'warn' }));
  E.on('scan:complete', (d) => ctx.ui?.notify?.({ title: 'Doppler volume complete', text: `EF${d.ef}, peak ${Math.round(d.vmax * MPH)} mph. +$${d.pay}`, kind: 'good', ttl: 6 }));
  E.on('drone:lost', (d) => { ctx.ui?.notify?.({ title: 'Drone lost', text: d.why, kind: 'warn' }); profile.earn(-Math.min(P.money, 250), 'Drone replacement'); });
  E.on('mission:note', (d) => ctx.ui?.notify?.({ title: d.mission?.title || 'Contract', text: d.text, kind: 'warn', ttl: 5 }));
  E.on('profile:upgrade', () => applyMods(true));
  const streamBoost = (k) => { const d = G.danger; if (d.active) d.mult = Math.min(5, d.mult + k); };

  // ---------- per frame ----------
  function update(dt) {
    profile.tick(dt); if (ctx.state === 'menu' || ctx.state === 'loading') return;
    if (!netReady && ctx.net?.on) { netReady = true; ctx.net.on('gp:req', onReq); ctx.net.on('gp:probe', (d, from) => { if (d && Number.isFinite(d.x) && Number.isFinite(d.z) && String(d.id).length < 32) tools.probes.deploy(d.x, d.z, d.s, { mine: false, id: 'r' + from + ':' + d.id }); }); ctx.net.on('gp:probe-x', (d, from) => tools.probes.remove('r' + from + ':' + d?.id)); }
    const p = pos(), I = ctx.input, S = ctx.storms, v = ctx.player.vehicle; env.now = ctx.time.now; env.px = p.x; env.pz = p.z; env.mode = ctx.player.mode; env.speed = env.mode === 'drive' ? Math.abs(v?.speed || 0) : 0; env.heading = ctx.player.heading || 0; env.hour = ctx.time.hour; env.level = P.level; env.story = P.story; env.authority = ctx.net?.role !== 'client'; env.tornadoes = S.tornadoes; env.storms = S.list; env.cities = ctx.world.cities || []; env.drone = tools.drone;
    env.useHeld = !I.uiBlock && I.down('use'); const tid = v ? typeId(v) : P.current; env.armorLevel = Math.max(profile.upLevel('armor', tid), (types[tid]?.armor || 0) >= 0.6 ? 3 : 0); const me = env.measure, m = tools.st.meter; me.active = tools.st.active === 'anemometer'; me.wind = m.wind; me.hail = m.hail;
    tools.update(dt); missions.update(dt); threatUpdate(dt, p, v); dangerUpdate(dt); waypointTick(dt); radioTick(dt); prompts(dt, v);
    if (G.reportCd > 0) G.reportCd -= dt; const st = P.stats;
    if (lastPos && env.mode === 'drive') { const d = Math.hypot(p.x - lastPos.x, p.z - lastPos.z); if (d < 60) st.km += d / 1000; } (lastPos ||= { x: 0, z: 0 }).x = p.x; lastPos.z = p.z;
    if (G.swept) { const q = G.swept; q.t += dt; q.peak = Math.max(q.peak, m.wind); const pp = ctx.player.pos || p; q.height = Math.max(q.height, (pp.y || 0) - ctx.world.heightAt(pp.x, pp.z)); q.dist = Math.max(q.dist, Math.hypot(pp.x - q.sx, pp.z - q.sz)); if (env.mode !== 'swept' && q.t > 4 && q.auto === undefined) q.settled = true; }
    slow -= dt; if (slow <= 0) { slow = 1; slowTick(v); }
  }
  function slowTick(v) {
    applyMods(false); profile.touch(); const t = G.threat.tornado, S = ctx.storms;
    G.intercept = t && G.threat.dist < 14000 ? suggestIntercept(t, env.px, env.pz, ctx.world.roads) : null;
    if (v && v.fuel < 0.14) G.say('fuel', {}, 180); if (isNight(env.hour) && !env.wasNight) G.say('night', {}, 600); env.wasNight = isNight(env.hour);
    if (t) { const d = G.threat.dist; if (d < 500) G.say('tooClose', {}, 40); else if (d < 1500) G.say('close', {}, 110); if ((t.ef || 0) >= 4 && d < 6000) G.say('ef4', {}, 400); P.stats.closest = P.stats.closest ? Math.min(P.stats.closest, d) : d; }
    // contextual hints
    if (ctx.settings.get('hints') !== false && ctx.state === 'playing') {
      const st = nearestStorm(S.list, env.px, env.pz), c = { mode: env.mode, st: ctx.time.real - started, G, storm: st ? Math.hypot(st.x - env.px, st.z - env.pz) : 1e9, tornado: G.threat.dist, fuel: v ? v.fuel : 1, anchorable: v && !!types[typeId(v)]?.anchor };
      if (hint) { hintT -= 1; if (hintT <= 0 || (hintT < 5 && !hint.when(c))) { hint = null; G.hint = null; hintT = 4; } } else if ((hintT -= 1) <= 0) for (const h of HINTS) if (!P.hintsSeen[h.id] && h.when(c)) { hint = h; G.hint = h; hintT = 9; P.hintsSeen[h.id] = 1; break; }
    } else G.hint = null;
  }
  function threatUpdate(dt, p, v) {
    const t = nearestTornado(ctx.storms.tornadoes, p.x, p.z), T = G.threat; T.tornado = t; if (!t) { T.dist = Infinity; T.level = damp(T.level, 0, 1.5, dt); T.closing = 0; return; }
    const vel = v?.vel && env.mode === 'drive' ? v.vel : null; approach(t, p.x, p.z, vel?.x || 0, vel?.z || 0, AP); T.dist = AP.now; T.closing = AP.closing; T.eta = AP.t; T.cpa = AP.dist; T.heading = dirToHeading(t.x - p.x, t.z - p.z); T.motion = AP.heading; T.speed = AP.speed; T.level = damp(T.level, threatOf(t, AP.now, AP.closing), 3, dt);
    approach(t, p.x, p.z, 0, 0, AP); T.hitEta = AP.dist < Math.max(250, t.rCore * 3) && AP.t < 600 && AP.closing > 0.5 ? AP.t : 0;
  }
  function dangerUpdate(dt) {
    const d = G.danger, t = G.threat.tornado, dist = G.threat.dist, R = 3600 + (t?.ef || 0) * 250, ok = t && t.stage !== 'funnel' && dist < R && env.mode !== 'swept'; d.closeness = ok ? clamp(1 - (dist - t.rCore) / R) : 0;
    if (ok) { if (!d.active && d.pot < 1) ctx.events.emit('stream:start', {}); d.active = true; streamQuiet = 0; const k = d.closeness; d.mult = Math.min(5, d.mult + k * k * 0.035 * dt); d.rate = 11 * (1 + (t.ef || 0) * 0.45) * k * k * d.mult * gearValue(P, 'stream', 'rate'); d.pot += d.rate * dt; d.viewers = damp(d.viewers, 400 + 26000 * k * k * (1 + (t.ef || 0) * 0.6) * (d.mult / 2), 0.25, dt); if (d.mult > 3) G.say('combo', {}, 240); }
    else { d.rate = 0; d.viewers = damp(d.viewers, 0, 0.3, dt); if (d.active) { streamQuiet += dt; if (streamQuiet > 8) { d.active = false; d.mult = 1; const n = Math.round(d.pot); d.pot = 0; if (n > 5) { profile.earn(n, 'Live stream'); profile.addRep(Math.min(60, n / 60)); ctx.events.emit('stream:banked', { amount: n }); ctx.ui?.notify?.({ title: 'Stream banked', text: `+$${n}`, kind: 'good' }); } } else d.mult = Math.max(1, d.mult - dt * 0.12); } }
  }
  function waypointTick(dt) {
    const w = G.waypoint; if (!w) return; wpT -= dt; updateWaypoint();
    if (w.kind === 'mission') { const k = missions.marker(); if (k && Math.hypot(k.x - w.x, k.z - w.z) > 500 && wpT <= 0) return void G.setWaypoint(k.x, k.z, k.label, { kind: 'mission', silent: true }); if (k && wpT <= 0 && Math.hypot(k.x - w.x, k.z - w.z) > 30) { w.x = k.x; w.z = k.z; } }
    if (wpT <= 0) { wpT = 4; if (w.route && w.off > 220) { const r = G.setWaypoint(w.x, w.z, w.label, { kind: w.kind, silent: true }); wpT = 8; void r; } }
    if (w.kind === 'user' && w.dist < 60) { ctx.ui?.notify?.({ title: 'Arrived', text: w.label, kind: 'info', ttl: 3 }); G.clearWaypoint(); }
  }
  function radioTick(dt) {
    radioT -= dt; if (radioT > 0) return; if (G.subtitle) { G.subtitle = null; ctx.ui?.subtitle?.(null); } const q = queue.shift(); if (!q) return; radioT = 2.2 + q.text.length * 0.052; G.subtitle = q; ctx.ui?.subtitle?.(q.text, q.who); ctx.audio?.play?.('radio', { text: q.text }); ctx.events.emit('radio', q);
  }
  function prompts(dt, v) {
    const st = tools.st, o = missions.objective(), P0 = ctx.player; let pr = null;
    if (o?.hold) pr = { action: 'use', text: o.label, hold: o.p / o.n };
    else if (tools.drone.active) pr = tools.drone.canLand ? { action: 'use', text: 'Land drone' } : null;
    else if (st.active === 'probe' && st.nearProbe) pr = st.nearProbe.secured ? { action: 'use', text: 'Hold to retrieve probe', hold: st.dropHold / 1.1 } : { action: 'use', text: 'Hold to anchor probe', hold: st.dropHold / 1.4 };
    else if (st.active === 'probe' && tools.probes.stock > 0 && env.speed < 14 && env.mode !== 'swept') pr = { action: 'use', text: `Drop probe (${tools.probes.stock} left)` };
    else if (st.active === 'drone' && tools.drone.cooldown <= 0 && env.speed < 3) pr = { action: 'use', text: 'Launch drone' };
    else if (st.active === 'camera' && !st.aiming) pr = { action: 'mouse:right', text: 'Hold to raise camera' };
    else if (st.active === 'binoculars' && !st.aiming) pr = { action: 'mouse:right', text: 'Hold to look' };
    else if (P0.prompt) pr = typeof P0.prompt === 'string' ? { action: 'enter', text: P0.prompt } : P0.prompt;
    else if (env.mode === 'foot') { const L = ctx.vehicles.list || []; for (const k of L) if (k.pos && Math.hypot(k.pos.x - env.px, k.pos.z - env.pz) < 5 && !k.remote) { pr = { action: 'enter', text: 'Get in' }; break; } }
    else if (env.mode === 'drive' && env.speed < 1.5 && v) { gasT -= dt; if (gasT <= 0) { gasT = 1; const s = G.serviceInfo(); G.canService = s.inTown && (v.fuel < 0.92 || v.damage > 0.05); } if (G.canService) pr = { action: 'garage', text: 'Service: refuel and repair' }; if (v.flipped) pr = { action: 'recover', text: 'Recover vehicle' }; }
    G.prompt = pr;
  }
  function onReq(d) {
    if (ctx.net?.role !== 'host' || !d || typeof d !== 'object') return;
    if (d.a === 'accept') { const m = missions.available.find((m) => m.id === d.d); if (m) { m.locked = false; missions.accept(d.d); } } else if (d.a === 'abandon') missions.abandon(d.d);
    else if (d.a === 'progress' && d.d) { const m = missions.active.find((m) => m.id === d.d.id); if (m && m.step === d.d.step) { const o = m.objectives[m.step]; if (o && Number.isFinite(d.d.p) && d.d.p > o.p) { o.p = Math.min(o.n, d.d.p); missions.progress(m, o); } } }
  }
  G.update = update; G.init = () => { profile.types = ctx.vehicles?.types || types; G.types = profile.types; Object.assign(types, {}); profile.ensureVehicles(profile.types); };
  if (typeof addEventListener === 'function') addEventListener('pagehide', () => profile.save());
  void acc; void V; return G;
}

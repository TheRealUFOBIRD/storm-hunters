// ctx.net - co-op networking. Host authoritative storms & missions, peers simulate their own vehicle / character.
import { Session, slewTime, MAX_PLAYERS } from './session.js';
import { MODES, F, newState } from './codec.js';
import { pickTransport, NetError, MESSAGES } from './transports.js';
import { createRemotes } from './remotes.js';
import { cleanData, cleanText, cleanName, isNum, num, normalizeCode, validCode, isType } from './sanitize.js';

export const NET_VERSION = '1.0';
const SNAP_DT = 1 / 3, MISSION_DT = 0.4, PARK_MOVE = 0.1, PARK_IDLE = 2.5, MAX_PARK = 3;
const EVENTS = { lightning: 1, warning: 1, 'storms:note': 1 };

export async function create(ctx, opt = {}) {
  const handlers = new Map(), ev = ctx.events, session = new Session({ transport: opt.transport || pickTransport(), version: NET_VERSION, clock: opt.clock, hooks: hooks() });
  const recs = [newState()]; let seq = 0, acc = 0, snapAcc = 0, misAcc = 0, misKey = '', startReq = null, applying = false, spawn = null, idleAcc = 0, pendingSync = null, vidMap = new WeakMap(), vidUse = [], parked = new Map(), quietTools = 0, lastLight = -1e9;

  const net = {
    get peers() { return session.peers; }, MAX_PLAYERS, version: NET_VERSION,
    get role() { return session.role; }, get room() { return session.room; }, get state() { return session.state; }, get id() { return session.id; }, get hostId() { return session.hostId; }, get online() { return session.role !== 'solo'; },
    get ping() { return Math.round(session.ts.rtt); }, get self() { return { id: session.id, name: session.name, color: session.color }; }, get stats() { return session.stats; }, get transport() { return session.transport.kind; }, session,
    get inviteLink() { return session.room ? location.origin + location.pathname + keepQuery() + '#room=' + session.room : ''; },
    get remoteVehicles() { return remotes.remoteVehicles; }, get hostSpawn() { return spawn; },
    parseRoom() { const m = /[#&?]room=([A-Za-z0-9-]+)/.exec(location.hash) || /[?&]room=([A-Za-z0-9-]+)/.exec(location.search); const c = m && normalizeCode(m[1]); return c && validCode(c) ? c : null; },
    validCode: (c) => validCode(normalizeCode(c)),
    async host(name, room) { const c = await session.host(name || ctx.settings?.get?.('name') || 'Chaser', room || undefined); setHash(c); return c; },
    async join(code, name) {
      const c = await session.join(code, name || ctx.settings?.get?.('name') || 'Chaser'); setHash(c);
      if (startReq && startReq.mode === 'join' && !startReq.city && spawn) { const ct = ctx.world?.nearestCity?.(spawn.x, spawn.z); if (ct?.name) startReq.city = ct.name; } // start near the host
      return c;
    },
    leave() { session.leave(); setHash(null); },
    kick(id) { session.kick(id); },
    chat(text) { session.chat(text); },
    send(type, data, o) { return session.send(type, cleanData(data), o); },
    on(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); return () => handlers.get(type)?.delete(fn); },
    tool(kind, data) { if (session.role !== 'solo') session.send('net:tool', cleanData({ ...data, kind })); },
    update, dispose() { session.leave(); bg?.terminate?.(); },
  };
  const keepQuery = () => { const q = new URLSearchParams(location.search), n = q.get('net'); return n ? '?net=' + n : ''; };
  function setHash(c) { try { history.replaceState(null, '', location.pathname + location.search + (c ? '#room=' + c : '')); } catch { /* sandboxed */ } }
  const remotes = createRemotes(ctx, net);

  function hooks() {
    return {
      time: () => ctx.time,
      role: (r) => {
        const s = ctx.storms; if (s) { try { s.isAuthority = r !== 'client'; } catch { /* derived getter */ } }
        ev.emit('net:role', r); misKey = ''; if (r !== 'client') pendingSync = null;
      },
      status: (o) => {
        const e = { ...o, message: o.error || o.text || null }; ev.emit('net:status', e); if (!ctx.ui || ctx.ui.handlesNetStatus) return;
        const n = (title, text, kind) => ctx.ui.notify?.({ title, text, kind, ttl: 6 });
        if (o.state === 'reconnecting') n('Connection lost', 'Trying to reconnect...', 'warn'); else if (o.state === 'migrating') n('Host left', o.text, 'warn'); else if (o.migrated) n('You are now the host', 'Room ' + session.room + ' stays open.', 'info'); else if (o.state === 'online' && o.rejoined === true) n('Reconnected', 'Room ' + session.room, 'good');
      },
      time0: (ts) => { pendingSync = ts; applySync(0, true); },
      extra: (x) => { if (x && isNum(x.x) && isNum(x.z)) spawn = { x: num(x.x, -6e4, 6e4), z: num(x.z, -6e4, 6e4), heading: num(x.h, -10, 10) }; },
      peerJoin: (p, existing) => { remotes.add(p); ev.emit('net:peer-join', { id: p.id, name: p.name, color: p.color, existing, peer: p }); },
      peerLeave: (p, reason) => { remotes.remove(p.id); ev.emit('net:peer-leave', { id: p.id, name: p.name, color: p.color, reason, peer: p }); },
      state: (r) => { remotes.push(r); },
      snapshot: (s) => { if (validSnapshot(s)) ctx.storms?.applySnapshot?.(s); else session.stats.dropped++; },
      event: (n, d) => { if (!EVENTS[n]) return; d = cleanData(d); if (n === 'lightning') { if (!validBolt(d) || ctx.time.real - lastLight < 20) return; fromNet = true; ev.emit(n, d); fromNet = false; } else if (d && typeof d === 'object') { d.text = cleanText(d.text, 300); fromNet = true; ev.emit(n, d); fromNet = false; } },
      user: onUser, chat: (m) => ev.emit('chat', m),
      mission: (d) => { applying = true; try { ctx.gameplay?.applyShared?.(cleanData(d, 0, { n: 20000 }), session.hostId); } finally { applying = false; } },
      broken: (ids) => { applying = true; try { ctx.world?.applyBroken?.(ids); } finally { applying = false; } },
      late: () => ({ snapshot: safe(() => ctx.storms?.snapshot?.()), mission: safe(() => ctx.gameplay?.serializeShared?.()), extra: ctx.player?.pos ? { x: ctx.player.pos.x, z: ctx.player.pos.z, h: ctx.player.heading || 0 } : null }),
      hostGone: (msg) => { setHash(null); remotes.clear(); ctx.ui?.notify?.({ title: 'Multiplayer ended', text: msg, kind: 'warn', ttl: 9 }); ev.emit('net:ended', { message: msg }); },
    };
  }
  let fromNet = false;
  const safe = (f) => { try { return f() ?? null; } catch (e) { console.error('[net]', e); return null; } };
  function validSnapshot(s) {
    if (!s || typeof s !== 'object') return false; if (!s.s && !s.n) return true; if (!Array.isArray(s.s) || s.s.length > 32 || !Array.isArray(s.n) || s.n.length > 24 || !isNum(s.t)) return false;
    for (const a of s.s) if (!Array.isArray(a) || a.length < 11 || typeof a[10] !== 'string' || a[10].length > 40 || a.slice(0, 10).some((v) => !isNum(v)) || Math.abs(a[3]) > 2e5 || Math.abs(a[4]) > 2e5) return false;
    for (const a of s.n) if (!Array.isArray(a) || a.slice(0, 6).some((v) => !isNum(v)) || Math.abs(a[3]) > 2e5 || Math.abs(a[4]) > 2e5 || !Array.isArray(a[8]) || a[8].length > 16 || a[8].some((v) => !isNum(v))) return false;
    return true;
  }
  const validBolt = (d) => d && ['x', 'y', 'z', 'tx', 'ty', 'tz', 'energy'].every((k) => isNum(d[k]) && Math.abs(d[k]) < 2e5);
  function onUser(type, data, from) {
    const p = session.peers.get(from);
    if (type === 'net:tool' && p) {
      if (!data || typeof data !== 'object' || typeof data.kind !== 'string') return;
      const pos = ['x', 'y', 'z'].every((k) => isNum(data[k]) && Math.abs(data[k]) < 6e4), o = { ...data, kind: cleanText(data.kind, 16), id: from, name: p.name, color: p.color };
      if (o.kind === 'photo' && pos && o.flash) remotes.flash(o.x, o.y, o.z); else if (o.kind === 'probe' && pos && !(ctx.gameplay?.handlesNetTool || ctx.gameplay?.tools || (ctx.gameplay && !ctx.gameplay.mock && ctx.gameplay.probes))) remotes.probe(from, o.x, o.y, o.z); else if (o.kind === 'probes:clear') remotes.clearProbes(from);
      ev.emit('net:tool', o);
    }
    const h = handlers.get(type); if (h) for (const f of [...h]) { try { f(data, from); } catch (e) { console.error('[net on ' + type + ']', e); } }
    ev.emit('net:msg', { type, data, from });
  }

  // ---- local events -> network
  ev.on('game:start', (o) => { startReq = o; });
  ev.on('world:breakIds', (ids) => { if (!applying && session.role !== 'solo' && ids?.length) session.sendBroken(Array.from(ids)); else if (!applying && ids?.length) for (const i of ids) if (session.broken.size < 60000) session.broken.add(i); });
  ev.on('lightning', (d) => { if (fromNet) return; lastLight = ctx.time.real; if (session.role === 'host' && ctx.storms?.needsEventSync) session.sendEvent('lightning', d); });
  ev.on('warning', (d) => { if (!fromNet && session.role === 'host' && ctx.storms?.needsEventSync) session.sendEvent('warning', { kind: d.kind, text: d.text, storm: d.storm?.id ?? null, x: d.x, z: d.z }); });
  ev.on('photo:taken', (d) => { const p = ctx.player?.pos; if (p) net.tool('photo', { x: p.x, y: p.y + 1.6, z: p.z, flash: true, score: num(d?.score, 0, 1e7) }); });
  ev.on('probe:deployed', (d) => { const p = d?.pos || d || ctx.player?.pos; if (p && isNum(p.x) && isNum(p.z)) net.tool('probe', { x: p.x, y: isNum(p.y) ? p.y : ctx.world?.heightAt?.(p.x, p.z) ?? 0, z: p.z }); });

  // ---- time
  function applySync(dt, force) {
    const ts = session.ts; if (session.role !== 'client' || !ts.ok) return; const now = session.clock(), T = ctx.time, tn = ts.now(now);
    T.now = force ? tn : slewTime(T.now, tn, dt);
    let h = ts.hourNow(now) - T.hour; h -= Math.round(h / 24) * 24; T.hour = (T.hour + (force || Math.abs(h) > 0.4 ? h : h * Math.min(1, dt * 0.8)) + 24) % 24;
  }

  // ---- local state records
  const toolFlag = () => { const g = ctx.gameplay, p = ctx.player; return g?.activeTool === 'scanner' || g?.activeTool?.id === 'scanner' ? (p?.mode === 'drive' || g?.scanning ? F.SCAN : 0) : 0; };
  function vidOf(v) { let id = vidMap.get(v); if (id) return id; for (id = 1; id <= 8 && vidUse[id] && ctx.vehicles.list.includes(vidUse[id]); id++); if (id > 8) id = 1; vidUse[id] = v; vidMap.set(v, id); return id; }
  const vtype = (v) => String(typeof v.type === 'string' ? v.type : v.type?.id ?? v.typeId ?? '').slice(0, 24).replace(/[^A-Za-z0-9_-]/g, '');
  function fillVehicle(r, v) {
    r.pos[0] = v.pos.x; r.pos[1] = v.pos.y; r.pos[2] = v.pos.z; const l = v.vel; r.vel[0] = l.x; r.vel[1] = l.y; r.vel[2] = l.z; r.quat[0] = v.quat.x; r.quat[1] = v.quat.y; r.quat[2] = v.quat.z; r.quat[3] = v.quat.w;
    r.rpm = num(v.rpm, 0, 8000); r.throttle = num(v.throttle, 0, 1); r.type = vtype(v); r.vid = vidOf(v); r.aux.length = 0; try { const a = ctx.vehicles.serializeState?.(v, r.aux); if (Array.isArray(a) && a !== r.aux) r.aux = a; } catch (e) { if (!fillVehicle.w) { fillVehicle.w = 1; console.error('[net] serializeState', e); } }
    for (let i = 0; i < r.aux.length; i++) r.aux[i] = +r.aux[i] || 0;
    let sk = 0; const ws = v.wheels; if (ws) for (let i = 0; i < ws.length; i++) if (Math.abs(ws[i]?.slip || 0) > 0.35) sk = F.SKID;
    r.flags = (v.headlights ? F.LIGHTS : 0) | (v.brake > 0.05 ? F.BRAKE : 0) | (v.gear < 0 ? F.REVERSE : 0) | (v.anchored ? F.ANCHOR : 0) | (v.damage >= 1 ? F.WRECK : 0) | sk;
    const m = Math.atan2(-(2 * (v.quat.x * v.quat.z + v.quat.w * v.quat.y)), 1 - 2 * (v.quat.x * v.quat.x + v.quat.y * v.quat.y)); r.heading = m; // forward -Z
  }
  const lp = { x: 0, y: 0, z: 0, t: -1 };
  function buildLocal(dt) {
    const P = ctx.player, r = recs[0]; recs.length = 1; if (!P?.pos || !isNum(P.pos.x)) return false;
    r.kind = 0; r.seq = seq = (seq + 1) & 65535; r.t = ctx.time.now; r.mode = Math.max(0, MODES.indexOf(P.mode)); r.pitch = num(P.pitch, -1.57, 1.57); r.flags = 0;
    const v = P.vehicle;
    if (v?.pos && v.quat) { fillVehicle(r, v); r.flags |= F.INVEH; if (v.horn || (ctx.input?.down?.('horn') && P.mode === 'drive')) r.flags |= F.HORN; } else {
      r.pos[0] = P.pos.x; r.pos[1] = P.pos.y; r.pos[2] = P.pos.z; r.heading = num(P.heading, -100, 100); r.aux.length = 0; r.type = ''; r.vid = 0; r.rpm = r.throttle = 0;
      const vel = P.vel || P.velocity; if (vel && isNum(vel.x)) { r.vel[0] = vel.x; r.vel[1] = vel.y; r.vel[2] = vel.z; } else { const d = ctx.time.now - lp.t; if (d > 0 && d < 0.5) { r.vel[0] = (P.pos.x - lp.x) / d; r.vel[1] = (P.pos.y - lp.y) / d; r.vel[2] = (P.pos.z - lp.z) / d; } else r.vel.fill(0); }
      lp.x = P.pos.x; lp.y = P.pos.y; lp.z = P.pos.z; lp.t = ctx.time.now;
      const q = P.quat || P.object3d?.quaternion; if (P.mode === 'swept' && q && isNum(q.x)) { r.quat[0] = q.x; r.quat[1] = q.y; r.quat[2] = q.z; r.quat[3] = q.w; } else { r.quat[0] = r.quat[2] = 0; r.quat[1] = Math.sin(-r.heading / 2); r.quat[3] = Math.cos(-r.heading / 2); }
      const I = ctx.input; r.flags |= (P.crouching ?? I?.down?.('crouch') ? F.CROUCH : 0) | (P.aiming || I?.mouse?.right ? F.AIM : 0) | (P.flashlight ? F.FLASH : 0);
    }
    r.flags |= toolFlag();
    if (P.mode === 'drone') { const D = ctx.gameplay?.drone, p = D?.pos || D?.position || (isNum(D?.x) && isNum(D?.y) ? D : null) || ctx.camera.position; r.flags |= F.DRONE; r.drone[0] = p.x; r.drone[1] = p.y; r.drone[2] = p.z; const e = ctx.camera.matrixWorld.elements; r.drone[3] = isNum(D?.heading) ? D.heading : Math.atan2(-e[8], e[10]); }
    // own vehicles nobody sits in
    const list = ctx.vehicles?.list; let n = 0;
    if (list) for (let i = list.length - 1; i >= 0 && n < MAX_PARK; i--) {
      const w = list[i]; if (!w || w === v || w.remote || !w.pos || !w.quat) continue; n++;
      const sp = w.vel ? Math.hypot(w.vel.x, w.vel.y, w.vel.z) : 0, e = parked.get(w) || { t: -1 }, age = ctx.time.real - e.t; if (age < (sp > 0.3 ? PARK_MOVE : PARK_IDLE)) continue;
      e.t = ctx.time.real; parked.set(w, e); const k = e.r || (e.r = newState()); k.kind = 1; k.seq = e.seq = ((e.seq ?? 0) + 1) & 65535; k.t = ctx.time.now; fillVehicle(k, w); k.mode = 4; recs.push(k);
    }
    if (parked.size > 16) parked.clear();
    return true;
  }

  function update(dt) {
    session.tick(); if (session.role === 'solo') { if (pendingSync) pendingSync = null; return; }
    applySync(dt, false);
    const playing = ctx.state === 'playing' || ctx.state === 'paused';
    acc += dt; idleAcc += dt; const rate = session.peers.size > 4 ? 15 : 18;
    if (acc >= 1 / rate) {
      acc = Math.min(acc - 1 / rate, 1 / rate);
      if (playing && buildLocal(dt)) { const r = recs[0], still = Math.abs(r.vel[0]) + Math.abs(r.vel[1]) + Math.abs(r.vel[2]) < 0.03 && r.mode !== 3 && r.flags === update.f; update.f = r.flags; if (still && idleAcc < 0.22) recs.shift(); else idleAcc = 0; session.sendStates(recs); if (recs.length && recs[0] !== r) recs.unshift(r); else if (!recs.length) recs.push(r); } else if (session.role === 'host') session.sendStates([]);
    }
    if (session.role === 'host' && session.peers.size) {
      snapAcc += dt; if (snapAcc >= SNAP_DT) { snapAcc %= SNAP_DT; const s = safe(() => ctx.storms?.snapshot?.()); if (s) session.sendSnapshot(s); }
      misAcc += dt; if (misAcc >= MISSION_DT && !applying) { misAcc = 0; const m = safe(() => ctx.gameplay?.serializeShared?.()); if (m) { const k = JSON.stringify(m); if (k !== misKey) { misKey = k; session.sendMission(m); } } }
    }
    remotes.update(dt);
  }

  // ---- background tabs: rAF stops, so a worker timer keeps the room (and the host's storms) alive
  let bg = null;
  if (typeof Worker !== 'undefined' && typeof document !== 'undefined' && !opt.noWorker) {
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),100)'], { type: 'text/javascript' })); bg = new Worker(url); let last = performance.now();
      bg.onmessage = () => {
        const now = performance.now(), dt = Math.min(0.25, (now - last) / 1000); last = now; if (!document.hidden || session.role === 'solo') return;
        ctx.time.now += dt; ctx.time.real += dt; ctx.time.hour = (ctx.time.hour + dt / 150) % 24; ctx.time.dt = dt;
        try { update(dt); if (session.role === 'host') { ctx.storms?.update?.(dt); ctx.gameplay?.update?.(dt); } } catch (e) { if (!bg.w) { bg.w = 1; console.error('[net bg]', e); } }
      };
    } catch { /* workers blocked: the room pauses while the tab is hidden */ }
  }
  if (typeof addEventListener === 'function') addEventListener('pagehide', () => { if (session.role !== 'solo') session.leave(); });
  return net;
}
export { NetError, MESSAGES };

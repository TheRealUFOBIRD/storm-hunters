import test from 'node:test'; import assert from 'node:assert/strict';
import { encode, decode, writeState, readState, stateBytes, newState, F } from '../src/net/codec.js';
import { validCode, makeCode, cleanText, cleanName, cleanData, normalizeCode, Bucket } from '../src/net/sanitize.js';
import { MemoryHub, broadcastTransport } from '../src/net/transports.js';
import { Session, TimeSync, slewTime, OP, PROTO } from '../src/net/session.js';
import { InterpBuffer } from '../src/net/interp.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function node(hub, o = {}) {
  const log = { status: [], join: [], leave: [], state: [], snap: [], user: [], mission: [], broken: [], chat: [], event: [], gone: [], role: [] }, T = { now: o.now ?? 100, hour: o.hour ?? 12 };
  const s = new Session({ transport: o.transport || hub.transport(), version: o.version || '1', max: o.max, hooks: {
    time: () => ({ now: T.now + (performance.now() - t0) / 1000, hour: T.hour }), role: (r) => log.role.push(r), status: (x) => log.status.push(x), peerJoin: (p, e) => log.join.push([p.id, p.name, e]), peerLeave: (p, r) => log.leave.push([p.id, r]),
    state: (r) => log.state.push(r), snapshot: (x) => log.snap.push(x), user: (t, d, f) => log.user.push([t, d, f]), mission: (d) => log.mission.push(d), broken: (i, f) => log.broken.push([i, f]), chat: (m) => log.chat.push(m), event: (n, d) => log.event.push([n, d]), hostGone: (m) => log.gone.push(m),
    late: () => ({ snapshot: { s: [], n: [], t: 1 }, mission: { a: 1 }, extra: { x: 5, z: 6 } }) } });
  const t0 = performance.now(); const timer = setInterval(() => s.tick(), 15); timer.unref?.();
  return { s, log, stop() { clearInterval(timer); s.leave(); } };
}
const rec = (o = {}) => Object.assign(newState(), { t: 100, pos: [1, 2, 3], vel: [4, 5, 6], type: 'scout', aux: [0.5, -1], flags: F.INVEH | F.LIGHTS, vid: 1, seq: 1 }, o);

test('codec roundtrip', () => {
  const v = { a: [1, -1, 127, 128, -32, -33, 255, 256, 65535, 65536, 4294967295, -2147483648, 1.5, 0.1, 1e300], s: 'héllo ☂ ' + 'x'.repeat(300), b: true, n: null, o: { k: { z: [] } }, u: new Uint8Array([1, 2, 3]), f: new Float32Array([1, 2.5]) };
  const d = decode(encode(v)); assert.deepEqual(d.a, v.a); assert.equal(d.s, v.s); assert.deepEqual(d.o, v.o); assert.deepEqual([...d.u], [1, 2, 3]); assert.deepEqual(d.f, [1, 2.5]); assert.equal(decode(encode(NaN)), 0); assert.equal(decode(encode(Infinity)), 0);
});
test('codec hostile input', () => {
  assert.throws(() => decode(new Uint8Array([0xdd, 255, 255, 255, 255]))); assert.throws(() => decode(new Uint8Array([0xdb, 0, 255, 255, 255]))); assert.throws(() => decode(new Uint8Array(40).fill(0x91))); assert.throws(() => decode(new Uint8Array([0xc1]))); assert.throws(() => decode(new Uint8Array([])));
  assert.throws(() => decode(new Uint8Array([1, 1]))); // trailing
  const p = decode(new Uint8Array([0x81, 0xa9, ...Buffer.from('__proto__'), 0x81, 0xa1, 0x78, 1])); assert.equal(Object.keys(p).length, 0); assert.equal({}.x, undefined);
  assert.equal(decode(new Uint8Array([0xcb, 0x7f, 0xf8, 0, 0, 0, 0, 0, 0])), 0); // NaN
  for (let i = 0; i < 4000; i++) { const u = crypto.getRandomValues(new Uint8Array(1 + Math.random() * 90)); try { decode(u); } catch (e) { assert.match(e.message, /decode|valid|Invalid|bounds|range/i); } readState(u); }
});
test('state record', () => {
  const r = rec({ heading: 4, pitch: -0.4, rpm: 3000, throttle: 0.5, flags: F.DRONE | F.INVEH, drone: [10, 20, 30, 1] }), u = stateBytes(r), d = readState(u); assert.equal(u.length, r && d.bytes); assert.ok(u.length < 120, 'bytes ' + u.length);
  assert.deepEqual(d.pos, [1, 2, 3]); assert.deepEqual(d.vel, [4, 5, 6]); assert.ok(Math.abs(d.heading - 4) < 1e-3); assert.ok(Math.abs(d.rpm - 3000) < 20); assert.equal(d.type, 'scout'); assert.deepEqual(d.aux, [0.5, -1]); assert.deepEqual(d.drone, [10, 20, 30, 1]);
  for (const bad of [{ pos: [NaN, 0, 0] }, { pos: [1e6, 0, 0] }, { quat: [0, 0, 0, 0] }, { mode: 77 }, { type: '<img>' }, { t: NaN }]) assert.equal(readState(stateBytes(rec(bad))), null, JSON.stringify(bad));
  assert.equal(readState(u.subarray(0, 60)), null);
});
test('sanitize', () => {
  for (let i = 0; i < 50; i++) assert.ok(validCode(makeCode())); assert.ok(!validCode('ABCD')); assert.ok(!validCode('ABCDO')); assert.ok(!validCode('AB"DE')); assert.equal(normalizeCode(' ab-cd e '), 'ABCDE');
  assert.equal(cleanText('a\u0000b‮c  d\n', 50), 'a b c d'); assert.equal(cleanName('<b>Bob</b>'), 'bBob/b'); assert.equal(cleanName('   '), 'Chaser'); assert.equal(cleanName('x'.repeat(99)).length, 20);
  const c = cleanData({ a: NaN, f() {}, n: { deep: { deep: 1 } }, s: 'x'.repeat(9999) }); assert.equal(c.a, 0); assert.equal(c.f, null); assert.equal(c.s.length, 2000);
  const b = new Bucket(10, 5); let n = 0; for (let i = 0; i < 20; i++) if (b.take(0)) n++; assert.equal(n, 5); assert.ok(b.take(1000, 5));
});
test('time sync + slew', () => {
  const ts = new TimeSync(), off = 500; for (let i = 0; i < 30; i++) { const d1 = 20 + Math.random() * 60, d2 = 20 + Math.random() * 60, s = i * 200; ts.add(s, s + d1 + d2, (s + d1) / 1000 + off, 12); }
  assert.ok(Math.abs(ts.offset - off) < 0.02, 'offset err ' + (ts.offset - off));
  let t = 10, prev = t; for (let i = 0; i < 400; i++) { t += 1 / 60; t = slewTime(t, 10.6 + (i + 1) / 60, 1 / 60); assert.ok(t > prev); prev = t; } assert.ok(Math.abs(t - (10.6 + 400 / 60)) < 0.01);
  t = 10; prev = t; for (let i = 0; i < 600; i++) { t += 1 / 60; t = slewTime(t, 9 + (i + 1) / 60, 1 / 60); assert.ok(t >= prev, 'monotonic'); prev = t; } assert.ok(Math.abs(t - 19) < 0.02);
});
test('interpolation', () => {
  const b = new InterpBuffer(), path = (t) => [Math.sin(t) * 40, 0, Math.cos(t) * 40], vel = (t) => [Math.cos(t) * 40, 0, -Math.sin(t) * 40]; let worst = 0, maxStep = 0, last = null;
  let next = 0; for (let i = 0; i < 600; i++) { const now = i / 60; while (next <= now) { if (Math.random() > 0.1) b.push({ t: next, pos: path(next), vel: vel(next), quat: [0, Math.sin(next / 2), 0, Math.cos(next / 2)], heading: 0, pitch: 0, aux: [] }); next += 1 / 18; } const t = now - 0.12; if (t < 0.2) continue; const o = b.sample(t, 1 / 60), p = path(t); worst = Math.max(worst, Math.hypot(o.pos[0] - p[0], o.pos[2] - p[2])); if (last) maxStep = Math.max(maxStep, Math.abs(Math.hypot(o.pos[0] - last[0], o.pos[2] - last[2]) - 40 / 60)); last = [...o.pos]; }
  assert.ok(worst < 1, 'err ' + worst); assert.ok(maxStep < 0.4, 'step ' + maxStep);
  const c = new InterpBuffer(); for (let i = 0; i < 10; i++) c.push({ t: i / 18, pos: [i, 0, 0], vel: [18, 0, 0], quat: [0, 0, 0, 1], heading: 0, pitch: 0, aux: [] }); const q = c.sample(9 / 18 + 5, 0.016); assert.ok(q.pos[0] < 9 + 18 * 0.4 && q.extrapolating);
  // correction after extrapolation must not pop
  const before = [...c.sample(9 / 18 + 5, 0.016).pos]; c.push({ t: 9 / 18 + 5.05, pos: [12, 0, 3], vel: [0, 0, 0], quat: [0, 0, 0, 1], heading: 0, pitch: 0, aux: [] }); const after = c.sample(9 / 18 + 5.016, 0.016).pos; assert.ok(Math.hypot(after[0] - before[0], after[2] - before[2]) < 0.8, 'pop ' + Math.hypot(after[0] - before[0], after[2] - before[2]));
  c.push({ t: 20, pos: [9000, 0, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1], heading: 0, pitch: 0, aux: [] }); assert.equal(c.sample(21, 0.016).pos[0], 9000);
});
test('join, state relay, user messages, chat, late join, leave', async () => {
  const hub = new MemoryHub({ latency: 8, jitter: 6, loss: 0.05 }), H = node(hub, { now: 1000, hour: 17 }), A = node(hub, { now: 0 }), B = node(hub, { now: 5 });
  const code = await H.s.host('Host'); assert.ok(validCode(code)); H.s.sendBroken([1, 2, 'x9']);
  await A.s.join(code.toLowerCase(), 'Ann<script>'); assert.equal(A.s.role, 'client'); assert.equal(A.log.snap.length, 1); assert.deepEqual(A.log.mission[0], { a: 1 });
  await B.s.join(code, 'Ann'); await sleep(700);
  assert.equal(H.s.peers.size, 2); assert.equal(A.s.peers.size, 2); assert.equal(B.s.peers.size, 2); assert.equal(A.log.join.at(-1)[2], false); assert.equal(B.log.join[0][2], true);
  assert.deepEqual(B.log.broken[0][0], [1, 2, 'x9']); // late joiner gets destruction
  const est = A.s.ts.now(performance.now()), host = H.s.hooks.time().now; assert.ok(Math.abs(est - host) < 0.03, 'sync err ' + (est - host)); assert.equal(Math.round(A.s.ts.hour), 17);
  for (let i = 1; i <= 20; i++) { A.s.sendStates([rec({ t: H.s.hooks.time().now, seq: i, pos: [i, 0, 0] })]); B.s.sendStates([rec({ t: H.s.hooks.time().now, seq: i, pos: [0, 0, i], type: 'van' }), rec({ kind: 1, vid: 2, seq: i, t: H.s.hooks.time().now, pos: [7, 0, 0] })]); H.s.sendStates([rec({ t: H.s.hooks.time().now, seq: i })]); await sleep(20); }
  await sleep(80);
  const fromB = A.log.state.filter((r) => r.id === B.s.id); assert.ok(fromB.length > 20, 'relayed ' + fromB.length); assert.ok(fromB.some((r) => r.kind === 1)); assert.ok(A.log.state.some((r) => r.id === H.s.id)); assert.ok(!A.log.state.some((r) => r.id === A.s.id)); assert.ok(H.log.state.filter((r) => r.id === A.s.id).length > 12);
  for (const k of ['pos']) { const s = fromB.filter((r) => r.kind === 0).map((r) => r[k][2]); assert.deepEqual(s, [...s].sort((a, b) => a - b)); }
  A.s.send('net:tool', { kind: 'probe', x: 1, f: undefined, n: NaN }); B.s.send('hello', { to: 'host only' }, { to: 'host' }); H.s.send('priv', 1, { to: A.s.id }); A.s.chat('hi \u0007there'); await sleep(60);
  assert.deepEqual(B.log.user.find((u) => u[0] === 'net:tool'), ['net:tool', { kind: 'probe', x: 1, n: 0 }, A.s.id]); assert.ok(H.log.user.some((u) => u[0] === 'hello' && u[2] === B.s.id)); assert.ok(!A.log.user.some((u) => u[0] === 'hello')); assert.ok(A.log.user.some((u) => u[0] === 'priv')); assert.ok(!B.log.user.some((u) => u[0] === 'priv')); assert.equal(B.log.chat[0].text, 'hi there'); assert.equal(H.log.chat[0].id, A.s.id);
  B.s.sendBroken([5, 5, 6]); await sleep(40); assert.deepEqual(A.log.broken.at(-1)[0], [5, 6]); assert.ok(H.s.broken.has(6));
  H.s.sendSnapshot({ t: 2, s: [], n: [] }); H.s.sendMission({ z: 2 }); H.s.sendEvent('lightning', { x: 1 }); await sleep(60); assert.deepEqual(A.log.mission.at(-1), { z: 2 }); assert.equal(A.log.event[0][0], 'lightning');
  A.s.leave(); await sleep(60); assert.equal(H.s.peers.size, 1); assert.equal(B.s.peers.size, 1); assert.equal(A.s.role, 'solo');
  H.stop(); await sleep(80); assert.equal(B.s.role, 'solo'); assert.equal(B.log.gone.length, 1); B.stop(); A.stop();
});
test('rejections: bad code, missing room, version, full, duplicate room', async () => {
  const hub = new MemoryHub(), H = node(hub, { max: 2 }); await H.s.host('H', 'abcde'); assert.equal(H.s.room, 'ABCDE');
  const A = node(hub), B = node(hub), V = node(hub, { version: '9' });
  await assert.rejects(A.s.join('nope!', 'x'), /5 letters/); await assert.rejects(A.s.join('ZZZZZ', 'x'), /Room not found/); await assert.rejects(V.s.join('ABCDE', 'x'), /different version/);
  await A.s.join('ABCDE', 'x'); await assert.rejects(B.s.join('ABCDE', 'x'), /full/); assert.equal(B.s.role, 'solo'); assert.equal(B.s.state, 'idle'); await assert.rejects(B.s.host('x', 'ABCDE'), /in use/); assert.equal(B.s.state, 'idle');
  H.s.kick(A.s.id); await sleep(50); assert.equal(A.s.role, 'solo'); for (const n of [H, A, B, V]) n.stop();
});
test('untrusted client: spoofing, floods, garbage', async () => {
  const hub = new MemoryHub(), H = node(hub), A = node(hub), B = node(hub); const code = await H.s.host('H'); await A.s.join(code, 'A'); await B.s.join(code, 'B'); await sleep(20);
  A.s.link.send(encode({ t: 9 }, OP.SNAP), true); A.s.link.send(encode({ t: 9 }, OP.MISSION), true); A.s.link.send(encode(['lightning', {}], OP.EVENT), true); A.s.link.send(new Uint8Array([]), true); A.s.link.send(crypto.getRandomValues(new Uint8Array(200)), true); await sleep(20);
  assert.equal(B.log.snap.length, 1); assert.equal(B.log.event.length, 0);
  const r = rec({ t: 100, seq: 1 }); A.s.id = B.s.id; A.s.sendStates([r]); H.s.sendStates([rec({ seq: 1 })]); await sleep(20); assert.ok(!H.log.state.some((x) => x.id === B.s.id)); // id is forced by host
  for (let i = 0; i < 60; i++) A.s.link.send(encode('spam ' + i, OP.CHAT), true); await sleep(30); assert.ok(B.log.chat.length <= 6, 'chat ' + B.log.chat.length);
  A.s.link.send(encode(['__proto__', 1, null], OP.USER), true); A.s.link.send(encode(['bad type!', 1, null], OP.USER), true); await sleep(20); assert.equal(B.log.user.length, 0);
  for (let i = 0; i < 1500; i++) A.s.link?.send(new Uint8Array([OP.SNAP]), true); await sleep(400); assert.ok(![...H.s.peers.values()].some((p) => p.name === 'A'), 'flooder kicked');
  for (const n of [H, A, B]) n.stop();
});
test('reconnect after transient loss keeps identity', async () => {
  const hub = new MemoryHub({ latency: 2 }), H = node(hub), A = node(hub); const code = await H.s.host('H'); await A.s.join(code, 'A'); const id = A.s.id; await sleep(30);
  hub.links[0].drop(); assert.equal(A.s.state, 'reconnecting'); await sleep(700); assert.equal(A.s.state, 'online'); assert.equal(A.s.id, id); assert.equal(H.s.peers.size, 1); assert.equal(H.log.leave.length, 0); assert.equal(H.log.join.length, 1); H.stop(); A.stop();
});
test('host migration', async () => {
  const hub = new MemoryHub({ latency: 2 }), H = node(hub), A = node(hub), B = node(hub); const code = await H.s.host('H'); await A.s.join(code, 'A'); await B.s.join(code, 'B'); await sleep(40); const a = A.s.id, b = B.s.id;
  H.s.leave(); await sleep(1800); assert.equal(A.s.role, 'host'); assert.equal(A.s.room, code); assert.equal(B.s.role, 'client'); assert.equal(B.s.id, b); assert.equal(A.s.id, a); assert.equal(A.s.peers.size, 1); assert.equal(B.s.peers.size, 1); assert.equal([...B.s.peers.values()][0].name, 'A');
  const C = node(hub); await C.s.join(code, 'C'); await sleep(20); assert.equal(C.s.peers.size, 2); for (const n of [A, B, C, H]) n.stop();
});
test('BroadcastChannel transport', async () => {
  const H = node(null, { transport: broadcastTransport() }), A = node(null, { transport: broadcastTransport() }); const code = await H.s.host('H'); await A.s.join(code, 'A'); A.s.send('ping', [1, 2]); await sleep(60); assert.deepEqual(H.log.user[0][1], [1, 2]);
  const X = node(null, { transport: broadcastTransport() }); await assert.rejects(X.s.join('ZZZZ2', 'x'), /not found/); await assert.rejects(X.s.host('x', code), /in use/); A.stop(); await sleep(60); assert.equal(H.s.peers.size, 0); H.stop(); X.stop(); await sleep(100);
});
test('full ctx integration (two headless games)', async () => {
  const { create } = await import('../src/net/index.js'); const THREE = await import('three'); const { Events } = await import('../src/core/events.js');
  const hub = new MemoryHub({ latency: 10, jitter: 5 });
  globalThis.location ||= { search: '', hash: '', origin: 'x', pathname: '/' };
  const game = async (x) => {
    const events = new Events(), applied = [], v = { id: 1, type: 'scout', pos: new THREE.Vector3(x, 1, 0), vel: new THREE.Vector3(0, 0, -20), quat: new THREE.Quaternion(), wheels: [], rpm: 2000, throttle: 0.5, headlights: true };
    const ctx = { events, state: 'playing', scene: new THREE.Scene(), fxScene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), time: { now: x, real: 0, hour: 3, dt: 0, frame: 0 }, input: { down: () => false, mouse: {} }, player: { mode: 'drive', pos: v.pos, heading: 0, vehicle: v }, vehicles: { types: { scout: {} }, list: [v], serializeState: (q, o) => { o.push(q.rpm, 1); return o; }, createVisual: () => ({ object3d: new THREE.Group(), setState() {} }), applyState(vis, a) { vis.last = a[0]; } }, storms: { isAuthority: true, snapshot: () => ({ t: ctx.time.now, s: [], n: [] }), applySnapshot: (s) => applied.push(s) }, world: { applyBroken: (i) => { ctx.broken = i; }, nearestCity: () => ({ name: 'Wichita' }) }, gameplay: { serializeShared: () => ({ m: ctx.mm || 1 }), applyShared: (d) => { ctx.shared = d; } }, ui: { notify() {} } };
    ctx.net = await create(ctx, { transport: hub.transport(), noWorker: true }); ctx.applied = applied; ctx.v = v; ctx.step = (dt) => { ctx.time.now += dt; ctx.time.real += dt; ctx.time.hour += dt / 150; v.pos.addScaledVector(v.vel, dt); ctx.net.update(dt); }; return ctx;
  };
  const H = await game(0), C = await game(50); H.time.now = 777; H.time.hour = 17;
  let lt = performance.now(); const timer = setInterval(() => { const n = performance.now(), d = (n - lt) / 1000; lt = n; H.step(d); C.step(d); }, 1000 / 60); const code = await H.net.host('Host'); const req = { mode: 'join', room: code }; C.events.emit('game:start', req); await C.net.join(code, 'Cli'); assert.equal(C.storms.isAuthority, false); assert.equal(req.city, 'Wichita'); assert.ok(Math.abs(C.time.now - H.time.now) < 0.2); assert.ok(Math.abs(C.time.hour - 17) < 0.1);
  H.events.emit('world:breakIds', [4, 5]); H.mm = 2; const toolEv = []; H.events.on('net:tool', (e) => toolEv.push(e)); C.events.emit('probe:deployed', { x: 3, y: 1, z: 4 }); await sleep(1500);
  assert.ok(C.applied.length >= 3); assert.deepEqual(C.broken, [4, 5]); assert.deepEqual(C.shared, { m: 2 }); assert.equal(toolEv[0]?.kind, 'probe');
  const p = [...C.net.peers.values()][0]; assert.equal(p.name, 'Host'); assert.equal(p.mode, 'drive'); assert.equal(p.vehicleType, 'scout'); assert.ok(p.lights); const lag = p.pos.z - H.v.pos.z; assert.ok(lag > 0 && lag < 7, 'lag m ' + lag); assert.equal(C.net.remoteVehicles.length, 1); assert.ok(C.net.remoteVehicles[0].vel.z < -15);
  H.player.mode = 'foot'; H.player.vehicle = null; H.player.pos = new THREE.Vector3(9, 0, 9); H.v.vel.set(0, 0, 0); await sleep(600); assert.equal(p.mode, 'foot'); assert.ok(Math.abs(p.pos.x - 9) < 0.01); assert.equal(C.net.remoteVehicles.length, 1, 'parked vehicle stays');
  H.net.leave(); C.net.session.hooks; await sleep(150); assert.equal(C.net.role, 'solo'); assert.equal(C.storms.isAuthority, true); assert.equal(C.net.peers.size, 0); assert.equal(C.net.remoteVehicles.length, 0); clearInterval(timer);
});

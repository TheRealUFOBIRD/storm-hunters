// Room session: star topology, host relays. No DOM / three / ctx dependencies (node-testable).
import { encode, decode, readState, stateBytes, MODES } from './codec.js';
import { NetError, MESSAGES } from './transports.js';
import { Bucket, cleanText, cleanName, cleanData, isType, isNum, num, makeCode, makeToken, normalizeCode, validCode, validBreakId } from './sanitize.js';

export const PROTO = 1, MAX_PLAYERS = 8;
export const COLORS = ['#ff9a3c', '#4fb7ff', '#7ee08a', '#ff5d73', '#c99bff', '#ffe066', '#58e0d8', '#f58fd0'];
export const OP = { HELLO: 1, WELCOME: 2, REJECT: 3, PEER: 4, LEAVE: 5, PING: 6, PONG: 7, STATE: 8, SNAP: 9, EVENT: 10, USER: 11, USERU: 12, MISSION: 13, BROKEN: 14, CHAT: 15, BYE: 16, PEERS: 17 };
const FROM_CLIENT = new Set([OP.HELLO, OP.PING, OP.STATE, OP.USER, OP.USERU, OP.BROKEN, OP.CHAT, OP.BYE]);
const STATE_LIM = 1100, GRACE = 20000, TIMEOUT = 15000, INTEREST = 2500, MAX_BROKEN = 60000;

// NTP-like clock: keeps the lowest-delay recent samples, estimates the host's simulation time
export class TimeSync {
  constructor() { this.reset(); }
  reset() { this.s = []; this.offset = 0; this.hourAt = 0; this.hour = 0; this.ok = false; this.rtt = 0; this.jitter = 0; }
  add(sent, recv, hostNow, hostHour) {
    const rtt = recv - sent; if (!(rtt >= 0) || rtt > 20000 || !isNum(hostNow) || !isNum(hostHour)) return;
    this.s.push({ rtt, recv, off: hostNow + rtt / 2000 - recv / 1000 }); if (this.s.length > 12) this.s.shift();
    let best = null, bs = Infinity; for (const x of this.s) { const k = x.rtt + (recv - x.recv) * 0.004; if (k < bs) { bs = k; best = x; } }
    this.jitter += (Math.abs(rtt - this.rtt) - this.jitter) * 0.1; this.rtt = this.ok ? this.rtt + (rtt - this.rtt) * 0.2 : rtt;
    if (!this.ok || Math.abs(best.off - this.offset) > 1) this.offset = best.off; else this.offset += (best.off - this.offset) * 0.35;
    this.hour = hostHour; this.hourAt = hostNow; this.ok = true;
  }
  // one-way hint from host state packets: follows a host whose simulation runs slower than wall time
  hint(hostNow, ms) { if (!this.ok || !isNum(hostNow)) return; const e = hostNow + this.rtt / 2000 - this.now(ms), dead = 0.04 + Math.min(0.1, this.jitter / 1000); if (Math.abs(e) > dead && Math.abs(e) < 5) this.offset += e * 0.12; }
  now(ms) { return ms / 1000 + this.offset; }
  hourNow(ms) { return (((this.hour + (this.now(ms) - this.hourAt) / 150) % 24) + 24) % 24; }
}
// nudges local value towards target without ever running backwards; returns the new time
export function slewTime(local, target, dt) {
  const e = target - local; if (Math.abs(e) > 3) return target; // only after a stall / initial sync
  return local + Math.max(-0.5 * dt, Math.min(dt, e * Math.min(1, 2.5 * dt)));
}

export class Session {
  // hooks: time()->{now,hour}, role(role), status(obj), peerJoin(p,existing), peerLeave(p,reason), state(rec), snapshot(o), event(n,d), user(type,d,from), mission(d), broken(ids,from), chat(m), late()->{snapshot,mission}, hostGone(msg)
  constructor({ transport, hooks = {}, clock = () => performance.now(), version = '1', max = MAX_PLAYERS }) {
    Object.assign(this, { transport, hooks, clock, version, max }); this.ts = new TimeSync(); this.broken = new Set(); this.stats = { in: 0, out: 0, dropped: 0 }; this._gen = 0; this._reset();
  }
  _reset() {
    this.role = 'solo'; this.state = 'idle'; this.room = null; this.id = 0; this.hostId = 0; this.name = 'Chaser'; this.color = COLORS[0]; this.token = null;
    this.peers = new Map(); this.link = null; this.server = null; this.nextId = 1; this._latest = new Map(); this._seq = new Map(); this._tickN = 0; this._pingAt = 0; this._pings = 0; this._infoAt = 0; this._snapSeq = 0; this._snapIn = -1; this.broken.clear(); this.ts.reset(); this._last = 0; this._claims = null;
  }
  h(n, ...a) { try { return this.hooks[n]?.(...a); } catch (e) { console.error('[net hook ' + n + ']', e); } }
  _status(state, extra = {}) { this.state = state; this.h('status', { state, role: this.role, room: this.room, ...extra }); }
  _setRole(r) { this.role = r; this.h('role', r); }
  get busy() { return this.state !== 'idle'; }

  // ---- host -----------------------------------------------------------------------------------------------------
  async host(name, code) {
    if (this.busy) throw new NetError('busy');
    const gen = ++this._gen, custom = code ? normalizeCode(code) : null; if (custom && !validCode(custom)) throw new NetError('code');
    this._status('hosting'); let srv = null, c = custom;
    try {
      for (let i = 0; !srv; i++) { c = custom || makeCode(); try { srv = await this.transport.listen(c, (l) => this._accept(l)); } catch (e) { if (e.code === 'taken' && !custom && i < 4) continue; throw e; } }
    } catch (e) { if (gen === this._gen) this._status('idle', { error: e.message }); throw e; }
    if (gen !== this._gen) { srv.close(); throw new NetError('cancelled'); }
    this._reset(); this.server = srv; this.room = c; this.name = cleanName(name); this.color = COLORS[0]; this._setRole('host'); this._status('online'); return c;
  }
  _accept(link) {
    if (this.role !== 'host' && this.state !== 'migrating') { link.close(); return; }
    const c = { link, member: null, at: this.clock(), seen: this.clock(), bytes: new Bucket(96000, 400000), msgs: new Bucket(140, 400), chat: new Bucket(1, 5), user: new Bucket(40, 100), brk: new Bucket(400, 4000), bad: 0 };
    link.start((u8) => this._fromClient(c, u8), () => { if (c.member?.conn === c) { c.member.conn = null; c.member.lostAt = this.clock(); this.h('status', { state: this.state, role: this.role, room: this.room, unstable: c.member.name }); } });
    setTimeout(() => { if (!c.member && link.open) link.close(); }, 10000)?.unref?.();
  }
  _reject(c, code) { c.link.send(encode({ c: code, m: MESSAGES[code] || code }, OP.REJECT), true); setTimeout(() => c.link.close(), 200); }
  _bad(c) { this.stats.dropped++; if (++c.bad > 400) { this._reject(c, 'kicked'); if (c.member) this._drop(c.member, 'kicked'); } }
  _fromClient(c, u8) {
    const now = this.clock(); c.seen = now; this.stats.in += u8.length;
    if (!u8.length || u8.length > 65536 || !FROM_CLIENT.has(u8[0]) || !c.bytes.take(now, u8.length) || !c.msgs.take(now)) return this._bad(c);
    const op = u8[0];
    if (!c.member) { if (op === OP.HELLO) { try { this._hello(c, decode(u8, 1)); } catch (e) { if (!(e instanceof NetError) && !/^decode/.test(e.message)) console.error(e); this._reject(c, 'bad-hello'); } } return; }
    const m = c.member; if (m.conn !== c) return;
    if (op === OP.STATE) return this._stateIn(u8, m.id, c);
    if (op === OP.PING) {
      if (u8.length !== 13) return this._bad(c);
      const d = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), sent = d.getFloat64(1), rtt = d.getFloat32(9); if (isNum(rtt)) m.ping = Math.round(num(rtt, 0, 9999));
      const o = new Uint8Array(25), dv = new DataView(o.buffer), t = this.h('time') || { now: 0, hour: 0 }; o[0] = OP.PONG; dv.setFloat64(1, sent); dv.setFloat64(9, t.now); dv.setFloat64(17, t.hour); this._tx(c.link, o, false); return;
    }
    let d; try { d = decode(u8, 1); } catch { return this._bad(c); }
    switch (op) {
      case OP.USER: case OP.USERU: {
        if (!Array.isArray(d) || !isType(d[0]) || !c.user.take(now)) return this._bad(c);
        const data = cleanData(d[1]), to = d[2]; this._route(d[0], data, m.id, to, op === OP.USER); break;
      }
      case OP.BROKEN: {
        if (!Array.isArray(d) || d.length > 2000 || !c.brk.take(now, d.length + 1)) return this._bad(c);
        const ids = []; for (const i of d) if (validBreakId(i) && !this.broken.has(i) && this.broken.size < MAX_BROKEN) { this.broken.add(i); ids.push(i); }
        if (ids.length) { this.h('broken', ids, m.id); this._all(encode(ids, OP.BROKEN), true, m.id); } break;
      }
      case OP.CHAT: {
        const text = cleanText(typeof d === 'string' ? d : '', 200); if (!text || !c.chat.take(now)) return this._bad(c);
        this._all(encode([m.id, text], OP.CHAT), true, m.id); this.h('chat', { id: m.id, name: m.name, color: m.color, text }); break;
      }
      case OP.BYE: this._drop(m, 'left'); break;
    }
  }
  _hello(c, d) {
    if (!d || typeof d !== 'object' || d.p !== PROTO || String(d.v) !== String(this.version)) return this._reject(c, 'version');
    const tok = typeof d.k === 'string' && d.k.length >= 8 && d.k.length <= 32 ? d.k : null;
    let m = null;
    if (tok) for (const x of this.peers.values()) if (x.token === tok) m = x;
    if (!m && this._claims && isNum(d.i) && this._claims.has(d.i)) { const x = this.peers.get(d.i); if (x && !x.conn && x.name === cleanName(d.n)) { m = x; this._claims.delete(d.i); } }
    const back = !!m;
    if (!m) {
      if (this.peers.size + 1 >= this.max) return this._reject(c, 'full');
      let name = cleanName(d.n); const used = new Set([this.name, ...[...this.peers.values()].map((x) => x.name)]); for (let i = 2, b = name; used.has(name); i++) name = b.slice(0, 17) + ' ' + i;
      const uc = new Set([this.color, ...[...this.peers.values()].map((x) => x.color)]), id = this._freeId();
      m = { id, name, color: COLORS.find((x) => !uc.has(x)) || COLORS[id % 8], ping: 0, token: makeToken(), ipos: null }; this.peers.set(id, m);
    }
    if (m.conn && m.conn !== c) { const o = m.conn; m.conn = null; o.member = null; o.link.close(); }
    if (!m.token) m.token = makeToken();
    m.conn = c; m.lostAt = 0; c.member = m; for (const k of this._seq.keys()) if ((k >> 9) === m.id) this._seq.delete(k);
    const t = this.h('time') || { now: 0, hour: 0 }, late = this.h('late') || {}, peers = [[this.id, this.name, this.color, 0]];
    for (const x of this.peers.values()) if (x !== m) peers.push([x.id, x.name, x.color, x.ping | 0]);
    this._tx(c.link, encode({ id: m.id, h: this.id, k: m.token, n: m.name, c: m.color, r: this.room, peers, now: t.now, hour: t.hour, snap: late.snapshot ?? null, mis: late.mission ?? null, x: late.extra ?? null }, OP.WELCOME), true);
    const ids = [...this.broken]; for (let i = 0; i < ids.length; i += 1000) this._tx(c.link, encode(ids.slice(i, i + 1000), OP.BROKEN), true);
    if (!back) { this._all(encode([m.id, m.name, m.color], OP.PEER), true, m.id); this.h('peerJoin', m, false); } else this.h('status', { state: this.state, role: this.role, room: this.room, rejoined: m.name });
  }
  _freeId() { for (let i = 0; i < 31; i++) { const id = this.nextId; this.nextId = this.nextId % 30 + 1; if (id !== this.id && !this.peers.has(id)) return id; } return 31; }
  _drop(m, reason) {
    if (!this.peers.has(m.id)) return; this.peers.delete(m.id); for (const k of [...this._latest.keys()]) if ((k >> 9) === m.id) this._latest.delete(k);
    const c = m.conn; m.conn = null; if (c) { c.member = null; setTimeout(() => c.link.close(), 150); }
    this._all(encode([m.id, reason], OP.LEAVE), true); this.h('peerLeave', m, reason);
  }
  kick(id) { const m = this.peers.get(id); if (this.role === 'host' && m) { if (m.conn) m.conn.link.send(encode({ c: 'kicked', m: MESSAGES.kicked }, OP.REJECT), true); this._drop(m, 'kicked'); } }
  _tx(link, u8, reliable) { if (link?.open && link.send(u8, reliable)) this.stats.out += u8.length; }
  _all(u8, reliable, except = -1) { for (const m of this.peers.values()) if (m.id !== except && m.conn) this._tx(m.conn.link, u8, reliable); }
  _route(type, data, from, to, reliable) {
    const list = to === undefined || to === null ? null : (Array.isArray(to) ? to : [to]).slice(0, 8).map((x) => (x === 'host' ? this.hostId : x));
    const pkt = encode([type, data, from], reliable ? OP.USER : OP.USERU);
    for (const m of this.peers.values()) if (m.id !== from && m.conn && (!list || list.includes(m.id))) this._tx(m.conn.link, pkt, reliable);
    if (from !== this.id && (!list || list.includes(this.id))) this.h('user', type, data, from);
  }

  // ---- client ---------------------------------------------------------------------------------------------------
  async join(code, name) {
    if (this.busy) throw new NetError('busy');
    const c = normalizeCode(code); if (!validCode(c)) throw new NetError('code');
    const gen = ++this._gen; this._status('joining', { target: c });
    try { await this._connect(c, cleanName(name), gen); } catch (e) { if (gen === this._gen) { this._reset(); this._status('idle', { error: e.message }); } throw e; }
    if (gen !== this._gen) throw new NetError('cancelled');
    return this.room;
  }
  async _connect(code, name, gen, extra = {}) {
    const link = await this.transport.connect(code); if (gen !== this._gen) { link.close(); throw new NetError('cancelled'); }
    await new Promise((res, rej) => {
      let done = false; const to = setTimeout(() => fail(new NetError('timeout')), 9000);
      const fail = (e) => { if (done) return; done = true; clearTimeout(to); link.close(); rej(e); };
      link.start((u8) => {
        if (done) { if (this.link === link) this._fromHost(u8); return; }
        if (gen !== this._gen) return fail(new NetError('cancelled'));
        try {
          if (u8[0] === OP.WELCOME) { const d = decode(u8, 1); done = true; clearTimeout(to); this._welcome(link, code, d); res(); } else if (u8[0] === OP.REJECT) { const d = decode(u8, 1), k = cleanText(d?.c, 20); fail(new NetError(k in MESSAGES ? k : 'bad-hello')); }
        } catch (e) { fail(new NetError('bad-hello', 'The host sent an invalid response.')); }
      }, () => { if (!done) fail(new NetError('lost')); else if (this.link === link) this._linkLost(); });
      link.send(encode({ p: PROTO, v: this.version, n: name, k: this.token, ...extra }, OP.HELLO), true);
    });
  }
  _welcome(link, code, d) {
    if (!d || !isNum(d.id) || !isNum(d.h) || !Array.isArray(d.peers)) throw new Error('bad welcome');
    const again = this.role === 'client', old = new Map(this.peers);
    if (!again) this._reset();
    this.link = link; this.room = code; this.id = d.id & 255; this.hostId = d.h & 255; this.token = typeof d.k === 'string' ? d.k.slice(0, 32) : null; this.name = cleanName(d.n); this.color = COLORS.includes(d.c) ? d.c : COLORS[1];
    this._last = this.clock(); this._pingAt = 0; this._pings = 0; this._seq.clear(); this._snapIn = -1; this.ts.reset(); this.peers = new Map();
    const t = this.clock(); this.ts.add(t, t, num(d.now, 0, 1e9), num(d.hour, 0, 24)); this.ts.s.length = 0;
    this._setRole('client');
    for (const x of d.peers.slice(0, this.max)) this._addPeer(x, !again || old.has(x?.[0]), old.get(x?.[0]));
    for (const p of old.values()) if (!this.peers.has(p.id)) this.h('peerLeave', p, 'left');
    this._status('online', { rejoined: again });
    this.h('time0', this.ts);
    if (d.x) this.h('extra', cleanData(d.x));
    if (d.snap) this.h('snapshot', d.snap, true);
    if (d.mis) this.h('mission', d.mis);
  }
  _addPeer(x, existing, old) {
    if (!Array.isArray(x) || !isNum(x[0]) || (x[0] & 255) === this.id || this.peers.size >= this.max) return;
    const p = old || { id: x[0] & 255, ipos: null }; p.name = cleanName(x[1]); p.color = COLORS.includes(x[2]) ? x[2] : COLORS[p.id % 8]; p.ping = num(x[3], 0, 9999); p.host = p.id === this.hostId;
    this.peers.set(p.id, p); if (!old) this.h('peerJoin', p, existing);
  }
  _fromHost(u8) {
    const now = this.clock(); this._last = now; this.stats.in += u8.length; if (!u8.length) return;
    const op = u8[0];
    if (op === OP.STATE) return this._stateIn(u8, -1, null);
    if (op === OP.PONG) { if (u8.length === 25) { const d = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.ts.add(d.getFloat64(1), now, d.getFloat64(9), d.getFloat64(17)); } return; }
    let d; try { d = decode(u8, 1); } catch { this.stats.dropped++; return; }
    switch (op) {
      case OP.PEER: this._addPeer(d, false); break;
      case OP.LEAVE: { const p = Array.isArray(d) && this.peers.get(d[0]); if (p) { this.peers.delete(p.id); this.h('peerLeave', p, cleanText(d[1], 20)); } break; }
      case OP.PEERS: if (Array.isArray(d)) for (const x of d) { const p = Array.isArray(x) && this.peers.get(x[0]); if (p) p.ping = num(x[1], 0, 9999); } break;
      case OP.SNAP: if (Array.isArray(d) && isNum(d[0])) { if (this._snapIn >= 0 && ((d[0] - this._snapIn) & 65535) > 32767) break; this._snapIn = d[0]; this.h('snapshot', d[1], false); } break;
      case OP.EVENT: if (Array.isArray(d) && isType(d[0])) this.h('event', d[0], d[1]); break;
      case OP.USER: case OP.USERU: if (Array.isArray(d) && isType(d[0]) && isNum(d[2])) this.h('user', d[0], cleanData(d[1]), d[2]); break;
      case OP.MISSION: this.h('mission', d); break;
      case OP.BROKEN: if (Array.isArray(d)) { const ids = d.filter((i) => validBreakId(i) && !this.broken.has(i)); for (const i of ids) if (this.broken.size < MAX_BROKEN) this.broken.add(i); if (ids.length) this.h('broken', ids, this.hostId); } break;
      case OP.CHAT: if (Array.isArray(d)) { const p = this.peers.get(d[0]), text = cleanText(d[1], 200); if (p && text) this.h('chat', { id: p.id, name: p.name, color: p.color, text }); } break;
      case OP.REJECT: this._end(MESSAGES[d?.c] || 'Disconnected by the host.'); break;
      case OP.BYE: { const l = this.link; this.link = null; l?.close(); this._migrate('The host left the room.'); break; }
    }
  }
  _linkLost() {
    this.link = null; if (this.role !== 'client') return;
    const gen = ++this._gen; this._status('reconnecting');
    (async () => {
      let gone = 0;
      for (const w of [300, 1200, 2500, 4000, 6000]) {
        await new Promise((r) => setTimeout(r, w)); if (gen !== this._gen) return;
        try { await this._connect(this.room, this.name, gen, { i: this.id }); return; } catch (e) { if (gen !== this._gen) return; if (['kicked', 'full', 'version'].includes(e.code)) return this._end(e.message); if (e.code === 'not-found' && ++gone >= 2) break; }
      }
      if (gen === this._gen) this._migrate('Connection to the host was lost.');
    })();
  }
  // host is gone: the lowest remaining id re-hosts under the same code, everybody else reconnects to it
  async _migrate(why) {
    const gen = ++this._gen, oldHost = this.peers.get(this.hostId), room = this.room; if (oldHost) { this.peers.delete(this.hostId); this.h('peerLeave', oldHost, 'left'); }
    if (!this.peers.size) return this._end(why + ' You can keep chasing solo.');
    const low = Math.min(this.id, ...this.peers.keys()); this._status('migrating', { text: why + ' Moving the room to another player...' });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (low === this.id) {
      this._claims = new Set(this.peers.keys()); for (const p of this.peers.values()) { p.conn = null; p.token = null; p.lostAt = this.clock(); p.host = false; }
      for (let i = 0; i < 8; i++) {
        try {
          const srv = await this.transport.listen(room, (l) => this._accept(l)); if (gen !== this._gen) { srv.close(); return; }
          this.server = srv; this.hostId = this.id; this.nextId = Math.max(this.id, ...this.peers.keys()) % 30 + 1; this._latest.clear(); this._seq.clear(); this._setRole('host'); this._status('online', { migrated: true }); setTimeout(() => { this._claims = null; }, 40000)?.unref?.(); return;
        } catch (e) { if (gen !== this._gen) return; if (e.code !== 'taken') break; await sleep(1500); if (gen !== this._gen) return; }
      }
      return this._end(why + ' You can keep chasing solo.');
    }
    for (let i = 0; i < 10; i++) {
      await sleep(i ? 1600 : 900); if (gen !== this._gen) return;
      try { this.token = null; await this._connect(room, this.name, gen, { i: this.id }); return; } catch (e) { if (gen !== this._gen) return; if (['kicked', 'full', 'version'].includes(e.code)) break; }
    }
    this._end(why + ' You can keep chasing solo.');
  }
  _end(msg) {
    ++this._gen; const ps = [...this.peers.values()], l = this.link; this.link = null; l?.close(); this.server?.close(); for (const p of ps) { const c = p.conn; p.conn = null; c?.link.close(); } this._reset(); for (const p of ps) this.h('peerLeave', p, 'left');
    this._setRole('solo'); this._status('idle', { error: msg }); this.h('hostGone', msg);
  }
  leave() {
    ++this._gen; const was = this.role, ps = [...this.peers.values()];
    if (was === 'host') { this._all(encode('left', OP.BYE), true); for (const m of ps) { const c = m.conn; m.conn = null; c?.link.close(); } this.server?.close(); } else if (this.link) { const l = this.link; this.link = null; l.send(encode('left', OP.BYE), true); l.close(); }
    this._reset(); for (const p of ps) this.h('peerLeave', p, 'left');
    if (was !== 'solo') this._setRole('solo'); this._status('idle', { left: was !== 'solo' });
  }

  // ---- outgoing ---------------------------------------------------------------------------------------------------
  send(type, data, { to, reliable = true } = {}) {
    if (this.role === 'solo' || !isType(type)) return false;
    if (this.role === 'host') { this._route(type, data, this.id, to, reliable); return true; }
    if (!this.link) return false; this._tx(this.link, encode([type, data, to ?? null], reliable ? OP.USER : OP.USERU), reliable); return true;
  }
  chat(text) {
    text = cleanText(text, 200); if (!text) return; this.h('chat', { id: this.id, name: this.name, color: this.color, text, self: true });
    if (this.role === 'host') this._all(encode([this.id, text], OP.CHAT), true); else if (this.link) this._tx(this.link, encode(text, OP.CHAT), true);
  }
  sendBroken(ids) {
    const n = []; for (const i of ids) if (validBreakId(i) && !this.broken.has(i) && this.broken.size < MAX_BROKEN) { this.broken.add(i); n.push(i); }
    for (let i = 0; i < n.length; i += 1000) { const p = encode(n.slice(i, i + 1000), OP.BROKEN); if (this.role === 'host') this._all(p, true); else if (this.link) this._tx(this.link, p, true); }
  }
  sendSnapshot(o) { if (this.role === 'host' && this.peers.size) { this._snapSeq = (this._snapSeq + 1) & 65535; this._all(encode([this._snapSeq, o], OP.SNAP), false); } }
  sendEvent(name, data) { if (this.role === 'host' && this.peers.size) this._all(encode([name, data], OP.EVENT), true); }
  sendMission(d) { if (this.role === 'host' && this.peers.size) this._all(encode(d, OP.MISSION), true); }
  // own records for this tick; host also relays everybody else's newest records
  sendStates(recs) {
    const own = recs.map((r) => { r.id = this.id; return { u8: stateBytes(r), x: r.pos[0], z: r.pos[2] }; });
    if (this.role === 'client') { if (this.link) this._pack(this.link, own.map((o) => o.u8)); return; }
    if (this.role !== 'host') return;
    this._tickN++; const self = recs[0];
    for (const m of this.peers.values()) {
      if (!m.conn) continue; const out = [], far = (x, z) => m.ipos && Math.abs(m.ipos[0] - x) + Math.abs(m.ipos[2] - z) > INTEREST;
      for (const o of own) if (!far(o.x, o.z) || this._tickN % 5 === 0) out.push(o.u8);
      for (const [k, e] of this._latest) { if ((k >> 9) === m.id) continue; const bit = 1 << (m.id & 31); if (!(e.to & bit) || (far(e.x, e.z) && (this._tickN + (k >> 9)) % 5)) continue; e.to &= ~bit; out.push(e.u8); }
      if (out.length) this._pack(m.conn.link, out);
    }
    return self;
  }
  _pack(link, list) {
    for (let i = 0; i < list.length;) {
      let n = 1, j = i; while (j < list.length && (j === i || n + list[j].length <= STATE_LIM)) n += list[j++].length;
      const u = new Uint8Array(n); u[0] = OP.STATE; let o = 1; for (; i < j; i++) { u.set(list[i], o); o += list[i].length; }
      this._tx(link, u, false);
    }
  }
  _stateIn(u8, forceId, c) {
    let o = 1, n = 0; const tn = this.h('time')?.now ?? 0;
    while (o < u8.length && n++ < 64) {
      const r = readState(u8, o); if (!r) { if (c) this._bad(c); else this.stats.dropped++; return; }
      const raw = u8.subarray(o, o + r.bytes); o += r.bytes;
      if (forceId >= 0) { if (r.vid > 8 || n > 6) { this._bad(c); return; } r.id = forceId; if (Math.abs(r.t - tn) > 4) r.t = tn; } else if (r.id === this.id || !this.peers.has(r.id)) continue;
      const key = (r.id << 9) | (r.kind << 8) | r.vid, last = this._seq.get(key), q = (r.seq - last) & 65535; if (last !== undefined && (q === 0 || q > 32767)) continue;
      this._seq.set(key, r.seq);
      const p = this.peers.get(r.id); if (p && r.kind === 0) { if (forceId < 0 && r.id === this.hostId) this.ts.hint(r.t, this.clock()); p.ipos = r.pos; p.mode = MODES[r.mode]; }
      if (forceId >= 0) { const b = raw.slice(); b[3] = r.id; new DataView(b.buffer).setFloat64(7, r.t); this._latest.set(key, { u8: b, x: r.pos[0], z: r.pos[2], to: -1 }); }
      this.h('state', r);
    }
  }
  // call every frame (or from a background timer)
  tick() {
    const now = this.clock();
    if (this.role === 'client' && this.link && this.state === 'online') {
      if (now >= this._pingAt) {
        this._pings++; this._pingAt = now + (this._pings < 6 ? 150 : 1000);
        const u = new Uint8Array(13), d = new DataView(u.buffer); u[0] = OP.PING; d.setFloat64(1, now); d.setFloat32(9, this.ts.rtt); this._tx(this.link, u, false);
        if (this._pings % 5 === 0) this._tx(this.link, u, true); // also keeps the reliable channel verified
      }
      if (now - this._last > TIMEOUT) { const l = this.link; this.link = null; l.close(); this._linkLost(); }
    }
    if (this.role === 'host') {
      for (const m of [...this.peers.values()]) {
        if (m.conn && now - m.conn.seen > TIMEOUT) { const l = m.conn.link; m.conn = null; m.lostAt = now; l.close(); }
        if (!m.conn && m.lostAt && now - m.lostAt > (this._claims ? 35000 : GRACE)) this._drop(m, 'lost');
      }
      if (now >= this._infoAt && this.peers.size) { this._infoAt = now + 2000; this._all(encode([[this.id, 0], ...[...this.peers.values()].map((m) => [m.id, m.ping | 0])], OP.PEERS), false); }
    }
  }
}

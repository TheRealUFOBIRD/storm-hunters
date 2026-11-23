// Transport abstraction. Every transport offers
//   listen(code, onLink) -> Promise<{close()}>      (reject code 'taken')
//   connect(code)        -> Promise<Link>           (reject code 'not-found' | 'network' | 'timeout' | 'nat' | 'unsupported')
// Link: send(Uint8Array, reliable) , onmessage(u8), onclose(reason), close(), open, label
export class NetError extends Error { constructor(code, msg) { super(msg || MESSAGES[code] || code); this.code = code; } }
export const MESSAGES = {
  'not-found': 'Room not found. Check the code, or ask the host whether the room is still open.',
  network: 'Could not reach the matchmaking server. Check your internet connection and try again.',
  timeout: 'The host did not answer in time. Try again in a moment.',
  nat: 'A direct connection to the host could not be established. A strict firewall or mobile network may be blocking peer-to-peer traffic.',
  unsupported: 'This browser does not support WebRTC data channels.',
  taken: 'That room code is already in use.',
  code: 'Room codes have 5 letters or digits (no I, L, O, 0 or 1).',
  version: 'The host is running a different version of Storm Hunters. Both players should reload the page.',
  full: 'That room is full.', kicked: 'You were removed from the room.', 'bad-hello': 'The host refused the connection.', busy: 'A connection attempt is already running.',
  cancelled: 'Cancelled.', lost: 'Connection to the host was lost.',
};

class Link {
  constructor(label) { this.label = label; this.open = true; this.onmessage = null; this.onclose = null; this._q = []; }
  _recv(u8) { if (!this.open) return; if (this.onmessage) this.onmessage(u8); else if (this._q.length < 256) this._q.push(u8); }
  start(onmessage, onclose) { this.onmessage = onmessage; this.onclose = onclose; const q = this._q; this._q = []; for (const m of q) if (this.open) onmessage(m); }
  _closed(why) { if (!this.open) return; this.open = false; const f = this.onclose; f?.(why); }
}

// ---- in-memory (node tests) ------------------------------------------------------------------------------------
export class MemoryHub {
  constructor({ latency = 0, jitter = 0, loss = 0 } = {}) { this.rooms = new Map(); this.latency = latency; this.jitter = jitter; this.loss = loss; this.links = []; }
  transport() {
    const hub = this;
    return {
      kind: 'memory',
      async listen(code, onLink) {
        if (hub.rooms.has(code)) throw new NetError('taken');
        const e = { onLink }; hub.rooms.set(code, e);
        return { close() { if (hub.rooms.get(code) === e) hub.rooms.delete(code); } };
      },
      async connect(code) {
        await Promise.resolve(); const e = hub.rooms.get(code); if (!e) throw new NetError('not-found');
        const a = new Link('c'), b = new Link('h');
        const pipe = (from, to) => {
          from.send = (u8, reliable = true) => {
            if (!from.open) return false; if (!reliable && Math.random() < hub.loss) return true;
            const c = u8.slice(); const go = () => to._recv(c);
            if (hub.latency || hub.jitter) { // reliable keeps order
              const now = performance.now(); let at = now + hub.latency + (reliable ? 0 : Math.random() * hub.jitter); if (reliable) at = from._last = Math.max(from._last || 0, at); setTimeout(go, at - now);
            } else queueMicrotask(go);
            return true;
          };
          from.close = () => { if (!from.open) return; setTimeout(() => to._closed('closed'), hub.latency + 1); from._closed('local'); };
          from.drop = () => { from._closed('lost'); to._closed('lost'); };
        };
        pipe(a, b); pipe(b, a); hub.links.push(a); e.onLink(b); return a;
      },
    };
  }
}

// ---- BroadcastChannel: several tabs of one browser, no internet (?net=loopback) -----------------------------------
export function broadcastTransport() {
  const me = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const ch = (code) => new BroadcastChannel('stormhunters-v1-' + code);
  const mk = (bc, to, sid) => {
    const l = new Link('bc');
    l.send = (u8) => { if (!l.open) return false; bc.postMessage({ k: 'd', to, sid, d: u8.slice() }); return true; };
    l.close = () => { if (!l.open) return; try { bc.postMessage({ k: 'x', to, sid }); } catch { /* closed */ } l._closed('local'); };
    return l;
  };
  return {
    kind: 'loopback',
    async listen(code, onLink) {
      const bc = ch(code), links = new Map(); let taken = false, live = false;
      bc.onmessage = ({ data: m }) => {
        if (!m || typeof m !== 'object') return;
        if (m.k === 'who' && live && m.from !== me) { bc.postMessage({ k: 'here', to: m.from }); return; }
        if (m.k === 'here' && m.to === me) { taken = true; return; }
        if (!live) return;
        if (m.k === 'conn' && m.sid && !links.has(m.sid)) { const l = mk(bc, m.sid + 'c', m.sid); links.set(m.sid, l); bc.postMessage({ k: 'ok', to: m.sid + 'c' }); onLink(l); } else if (m.to === m.sid + 'h') {
          const l = links.get(m.sid); if (!l) return; if (m.k === 'd' && m.d instanceof Uint8Array) l._recv(m.d); else if (m.k === 'x') { links.delete(m.sid); l._closed('closed'); }
        }
      };
      bc.postMessage({ k: 'who', from: me }); await new Promise((r) => setTimeout(r, 150));
      if (taken) { bc.close(); throw new NetError('taken'); }
      live = true;
      return { close() { live = false; setTimeout(() => bc.close(), 50); } };
    },
    connect(code) {
      return new Promise((res, rej) => {
        const bc = ch(code), sid = Math.random().toString(36).slice(2); let l = null;
        const to = setTimeout(() => { bc.close(); rej(new NetError('not-found')); }, 1500);
        bc.onmessage = ({ data: m }) => {
          if (!m || m.to !== sid + 'c') return;
          if (m.k === 'ok' && !l) { clearTimeout(to); l = mk(bc, sid + 'h', sid); const c = l._closed.bind(l); l._closed = (w) => { c(w); setTimeout(() => bc.close(), 50); }; res(l); } else if (m.k === 'd' && m.d instanceof Uint8Array) l?._recv(m.d); else if (m.k === 'x') l?._closed('closed');
        };
        bc.postMessage({ k: 'conn', sid });
      });
    },
  };
}

// ---- PeerJS / WebRTC ------------------------------------------------------------------------------------------------
const PREFIX = 'stormhunters-v1-', CFG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }], sdpSemantics: 'unified-plan' };
let loading;
async function getPeer() {
  if (globalThis.Peer) return globalThis.Peer;
  loading ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL('../../vendor/peerjs/peerjs.min.js', import.meta.url).href; s.onload = res; s.onerror = () => rej(new NetError('network', 'Could not load the networking library.')); document.head.append(s); });
  await loading; if (!globalThis.Peer) throw new NetError('unsupported'); return globalThis.Peer;
}
// One ordered channel comes from PeerJS; the lossy state channel is a pre-negotiated one on the same RTCPeerConnection
// (PeerJS' own reliable:false is only unordered, it still retransmits).
function peerLink(conn, onGone) {
  const l = new Link(conn.peer), pc = conn.peerConnection; let st = null, ice = 0;
  try {
    st = pc.createDataChannel('state', { negotiated: true, id: 100, ordered: false, maxRetransmits: 0 }); st.binaryType = 'arraybuffer';
    st.onmessage = (e) => { if (e.data instanceof ArrayBuffer) l._recv(new Uint8Array(e.data)); }; st.onerror = () => {};
  } catch (e) { console.warn('[net] state channel unavailable', e); }
  conn.on('data', (d) => { if (d instanceof ArrayBuffer) l._recv(new Uint8Array(d)); else if (ArrayBuffer.isView(d)) l._recv(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)); });
  l.send = (u8, reliable = true) => {
    if (!l.open) return false;
    if (!reliable && st?.readyState === 'open') { if (st.bufferedAmount > 120000) return false; try { st.send(u8); return true; } catch { return false; } }
    const dc = conn.dataChannel; if (!dc || (!reliable && dc.bufferedAmount > 60000)) return false;
    try { conn.send(u8); return true; } catch { return false; }
  };
  const gone = (why) => { clearTimeout(ice); if (l.open) { l._closed(why); } onGone?.(); };
  l.close = () => { if (!l.open) return; l._closed('local'); setTimeout(() => { try { conn.close(); } catch { /* already */ } onGone?.(); }, 250); }; // let the last message flush
  conn.on('close', () => gone('lost')); conn.on('error', (e) => { console.warn('[net] connection', e?.type || e); gone('lost'); });
  conn.on('iceStateChanged', (s) => { clearTimeout(ice); if (s === 'disconnected') ice = setTimeout(() => { gone('lost'); try { conn.close(); } catch { /* already */ } }, 7000); });
  l.conn = conn; l.stateOpen = () => st?.readyState === 'open';
  return l;
}
const mapErr = (t) => ({ 'peer-unavailable': 'not-found', 'unavailable-id': 'taken', 'browser-incompatible': 'unsupported', 'negotiation-failed': 'nat', webrtc: 'nat' }[t] || 'network');
export function peerTransport(opts = {}) {
  const PO = { debug: 0, config: CFG, ...opts };
  return {
    kind: 'peerjs',
    async listen(code, onLink) {
      const Peer = await getPeer(); if (typeof RTCPeerConnection === 'undefined') throw new NetError('unsupported');
      return new Promise((res, rej) => {
        const peer = new Peer(PREFIX + code, PO); let up = false, dead = false, back = 1000, timer = 0;
        const to = setTimeout(() => { if (!up) { dead = true; peer.destroy(); rej(new NetError('network')); } }, 12000);
        peer.on('open', () => { back = 1000; if (!up) { up = true; clearTimeout(to); res({ close() { dead = true; clearTimeout(timer); setTimeout(() => peer.destroy(), 300); }, peer }); } });
        peer.on('connection', (conn) => { conn.on('open', () => onLink(peerLink(conn))); conn.on('error', () => {}); });
        // broker drop: existing players stay connected; keep retrying so new players can still join
        peer.on('disconnected', () => { if (dead || !up) return; clearTimeout(timer); timer = setTimeout(() => { if (!dead && !peer.destroyed && peer.disconnected) try { peer.reconnect(); } catch { /* retry on next event */ } }, back); back = Math.min(30000, back * 2); });
        peer.on('error', (e) => { if (!up) { clearTimeout(to); dead = true; peer.destroy(); rej(new NetError(mapErr(e.type))); } else if (e.type !== 'peer-unavailable') console.warn('[net] broker', e.type); });
      });
    },
    async connect(code) {
      const Peer = await getPeer(); if (typeof RTCPeerConnection === 'undefined') throw new NetError('unsupported');
      return new Promise((res, rej) => {
        const peer = new Peer(undefined, PO); let done = false, stage = 'network';
        const fail = (c) => { if (done) return; done = true; clearTimeout(to); try { peer.destroy(); } catch { /* ok */ } rej(new NetError(c)); };
        const to = setTimeout(() => fail(stage), 16000);
        peer.on('error', (e) => fail(mapErr(e.type)));
        peer.on('open', () => {
          stage = 'nat';
          const conn = peer.connect(PREFIX + code, { serialization: 'raw', reliable: true });
          conn.on('error', (e) => fail(mapErr(e?.type)));
          conn.on('close', () => fail('nat'));
          conn.on('open', () => { if (done) { conn.close(); return; } done = true; clearTimeout(to); const l = peerLink(conn, () => setTimeout(() => peer.destroy(), 400)); res(l); });
        });
      });
    },
  };
}
export function pickTransport(search = globalThis.location?.search || '') {
  const n = new URLSearchParams(search).get('net');
  if (n === 'loopback' || n === 'local') return broadcastTransport();
  return peerTransport();
}

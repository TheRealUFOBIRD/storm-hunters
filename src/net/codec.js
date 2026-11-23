// Small MessagePack subset (nil, bool, int, float, str, bin, array, map) with hard limits on everything it decodes.
// Peers are untrusted: decode() throws on malformed / oversized input, never yields NaN/Infinity or prototype keys.
const TE = new TextEncoder(), TD = new TextDecoder('utf-8');
let buf = new Uint8Array(4096), dv = new DataView(buf.buffer), p = 0;
function need(n) {
  if (p + n <= buf.length) return;
  const b = new Uint8Array(Math.max(buf.length * 2, p + n + 1024)); b.set(buf.subarray(0, p)); buf = b; dv = new DataView(b.buffer);
}
function enc(v, d) {
  if (d > 16) throw new Error('encode: too deep');
  need(16);
  if (v === null || v === undefined || typeof v === 'function' || typeof v === 'symbol') { buf[p++] = 0xc0; return; }
  if (v === true || v === false) { buf[p++] = v ? 0xc3 : 0xc2; return; }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) v = 0;
    if (Number.isInteger(v) && v >= -2147483648 && v <= 4294967295 && !Object.is(v, -0)) {
      if (v >= 0) {
        if (v < 128) buf[p++] = v; else if (v < 256) { buf[p++] = 0xcc; buf[p++] = v; } else if (v < 65536) { buf[p++] = 0xcd; dv.setUint16(p, v); p += 2; } else { buf[p++] = 0xce; dv.setUint32(p, v); p += 4; }
      } else if (v >= -32) buf[p++] = v & 255; else if (v >= -128) { buf[p++] = 0xd0; dv.setInt8(p++, v); } else if (v >= -32768) { buf[p++] = 0xd1; dv.setInt16(p, v); p += 2; } else { buf[p++] = 0xd2; dv.setInt32(p, v); p += 4; }
    } else if (Math.fround(v) === v) { buf[p++] = 0xca; dv.setFloat32(p, v); p += 4; } else { buf[p++] = 0xcb; dv.setFloat64(p, v); p += 8; }
    return;
  }
  if (typeof v === 'string') {
    const b = TE.encode(v), n = b.length; need(n + 8);
    if (n < 32) buf[p++] = 0xa0 | n; else if (n < 256) { buf[p++] = 0xd9; buf[p++] = n; } else if (n < 65536) { buf[p++] = 0xda; dv.setUint16(p, n); p += 2; } else { buf[p++] = 0xdb; dv.setUint32(p, n); p += 4; }
    buf.set(b, p); p += n; return;
  }
  if (typeof v === 'bigint') { enc(Number(v), d); return; }
  if (v instanceof Uint8Array) {
    const n = v.length; need(n + 8);
    if (n < 256) { buf[p++] = 0xc4; buf[p++] = n; } else if (n < 65536) { buf[p++] = 0xc5; dv.setUint16(p, n); p += 2; } else { buf[p++] = 0xc6; dv.setUint32(p, n); p += 4; }
    buf.set(v, p); p += n; return;
  }
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const n = v.length;
    if (n < 16) buf[p++] = 0x90 | n; else if (n < 65536) { buf[p++] = 0xdc; dv.setUint16(p, n); p += 2; } else { buf[p++] = 0xdd; dv.setUint32(p, n); p += 4; }
    for (let i = 0; i < n; i++) enc(v[i], d + 1);
    return;
  }
  if (v instanceof Set) { enc([...v], d); return; }
  if (v instanceof Map) v = Object.fromEntries(v);
  const ks = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== 'function'), n = ks.length;
  if (n < 16) buf[p++] = 0x80 | n; else { buf[p++] = 0xde; dv.setUint16(p, n); p += 2; }
  for (const k of ks) { enc(k, d + 1); enc(v[k], d + 1); }
}
// op: optional leading opcode byte
export function encode(v, op = -1) { p = 0; if (op >= 0) { need(1); buf[p++] = op; } enc(v, 0); return buf.slice(0, p); }

const BAD = new Set(['__proto__', 'constructor', 'prototype']);
export const LIMITS = { depth: 12, items: 60000, str: 8192, bin: 65536, bytes: 1 << 20 };
export function decode(u8, start = 0, lim = LIMITS) {
  if (u8.length > lim.bytes) throw new Error('decode: too large');
  const d = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), end = u8.length; let o = start, items = 0;
  const take = (n) => { const s = o; if (n > end - o) throw new Error('decode: truncated'); o += n; return s; };
  const str = (n) => { if (n > lim.str) throw new Error('decode: string'); const s = take(n); return TD.decode(u8.subarray(s, s + n)); };
  const bin = (n) => { if (n > lim.bin) throw new Error('decode: bin'); const s = take(n); return u8.slice(s, s + n); };
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const arr = (n, dep) => { if (n > end - o) throw new Error('decode: array'); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = val(dep + 1); return a; };
  const map = (n, dep) => { if (n * 2 > end - o) throw new Error('decode: map'); const m = {}; for (let i = 0; i < n; i++) { const k = val(dep + 1), v = val(dep + 1); if (typeof k !== 'string' && typeof k !== 'number') throw new Error('decode: key'); if (!BAD.has(String(k))) m[k] = v; } return m; };
  function val(dep) {
    if (dep > lim.depth) throw new Error('decode: depth');
    if (++items > lim.items) throw new Error('decode: items');
    const b = u8[take(1)];
    if (b < 0x80) return b; if (b >= 0xe0) return b - 256;
    if (b < 0x90) return map(b & 15, dep); if (b < 0xa0) return arr(b & 15, dep); if (b < 0xc0) return str(b & 31);
    switch (b) {
      case 0xc0: return null; case 0xc2: return false; case 0xc3: return true;
      case 0xc4: return bin(u8[take(1)]); case 0xc5: return bin(d.getUint16(take(2))); case 0xc6: return bin(d.getUint32(take(4)));
      case 0xca: return num(d.getFloat32(take(4))); case 0xcb: return num(d.getFloat64(take(8)));
      case 0xcc: return u8[take(1)]; case 0xcd: return d.getUint16(take(2)); case 0xce: return d.getUint32(take(4));
      case 0xd0: return d.getInt8(take(1)); case 0xd1: return d.getInt16(take(2)); case 0xd2: return d.getInt32(take(4));
      case 0xd9: return str(u8[take(1)]); case 0xda: return str(d.getUint16(take(2))); case 0xdb: return str(d.getUint32(take(4)));
      case 0xdc: return arr(d.getUint16(take(2)), dep); case 0xdd: return arr(d.getUint32(take(4)), dep); case 0xde: return map(d.getUint16(take(2)), dep);
    }
    throw new Error('decode: type');
  }
  const v = val(0);
  if (o !== end) throw new Error('decode: trailing bytes');
  return v;
}

// ---- player / vehicle state records (fixed layout, quantised) ---------------------------------------------------
export const MODES = ['drive', 'foot', 'swept', 'drone', 'spectate'];
export const F = { LIGHTS: 1, HORN: 2, AIM: 4, CROUCH: 8, FLASH: 16, BRAKE: 32, INVEH: 64, REVERSE: 128, DRONE: 256, SKID: 512, ANCHOR: 1024, SCAN: 2048, TELEPORT: 4096, WRECK: 8192 };
const MAXAUX = 48, MAXTYPE = 24, TAU = Math.PI * 2;
const ab = new ArrayBuffer(1024), su = new Uint8Array(ab), sd = new DataView(ab);
const q16 = (v) => Math.max(-32767, Math.min(32767, Math.round(v))), u8c = (v) => Math.max(0, Math.min(255, Math.round(v)));
const ang = (a) => Math.round((((a % TAU) + TAU) % TAU) / TAU * 65535) & 65535;
// r: {kind 0 player|1 parked vehicle, id, vid, seq, t, mode, flags, pos[3], vel[3], quat[4], heading, pitch, rpm 0..8000, throttle 0..1, type, aux[], drone[4]}
export function writeState(r, out = su, off = 0) {
  const d = out === su ? sd : new DataView(out.buffer, out.byteOffset, out.byteLength); let o = off + 2;
  out[o++] = r.kind; out[o++] = r.id; out[o++] = r.vid; d.setUint16(o, r.seq & 65535); o += 2; d.setFloat64(o, r.t); o += 8;
  out[o++] = r.mode; d.setUint16(o, r.flags); o += 2;
  for (let i = 0; i < 3; i++, o += 4) d.setFloat32(o, r.pos[i]);
  for (let i = 0; i < 3; i++, o += 2) d.setInt16(o, q16(r.vel[i] * 80));
  for (let i = 0; i < 4; i++, o += 2) d.setInt16(o, q16(r.quat[i] * 32767));
  d.setUint16(o, ang(r.heading)); o += 2; d.setInt8(o++, Math.max(-127, Math.min(127, Math.round(r.pitch * 80)))); out[o++] = u8c(r.rpm / 8000 * 255); out[o++] = u8c(r.throttle * 255);
  const ty = r.type || '', n = Math.min(MAXTYPE, ty.length); out[o++] = n; for (let i = 0; i < n; i++) out[o++] = ty.charCodeAt(i) & 127;
  const m = Math.min(MAXAUX, r.aux.length); out[o++] = m; for (let i = 0; i < m; i++, o += 4) { const v = +r.aux[i]; d.setFloat32(o, Number.isFinite(v) ? v : 0); }
  if (r.flags & F.DRONE) { for (let i = 0; i < 4; i++, o += 4) d.setFloat32(o, r.drone[i]); }
  d.setUint16(off, o - off);
  return o - off;
}
export const stateBytes = (r) => { const n = writeState(r); return su.slice(0, n); };
export const newState = () => ({ kind: 0, id: 0, vid: 0, seq: 0, t: 0, mode: 0, flags: 0, pos: [0, 0, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1], heading: 0, pitch: 0, rpm: 0, throttle: 0, type: '', aux: [], drone: [0, 0, 0, 0] });
// validates ranges; returns record or null. Sets r.bytes = length consumed.
export function readState(u, off = 0) {
  if (off + 51 > u.length) return null;
  const d = new DataView(u.buffer, u.byteOffset, u.byteLength), len = d.getUint16(off); if (len < 51 || off + len > u.length) return null;
  const r = newState(), end = off + len; let o = off + 2; r.bytes = len;
  r.kind = u[o++]; r.id = u[o++]; r.vid = u[o++]; r.seq = d.getUint16(o); o += 2; r.t = d.getFloat64(o); o += 8;
  r.mode = u[o++]; r.flags = d.getUint16(o); o += 2;
  for (let i = 0; i < 3; i++, o += 4) r.pos[i] = d.getFloat32(o);
  for (let i = 0; i < 3; i++, o += 2) r.vel[i] = d.getInt16(o) / 80;
  let l = 0; for (let i = 0; i < 4; i++, o += 2) { r.quat[i] = d.getInt16(o) / 32767; l += r.quat[i] * r.quat[i]; }
  r.heading = d.getUint16(o) / 65535 * TAU; o += 2; r.pitch = d.getInt8(o++) / 80; r.rpm = u[o++] / 255 * 8000; r.throttle = u[o++] / 255;
  const n = u[o++]; if (n > MAXTYPE || o + n > end) return null;
  for (let i = 0; i < n; i++) { const c = u[o++]; if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95)) return null; r.type += String.fromCharCode(c); }
  const m = u[o++]; if (!(m <= MAXAUX) || o + m * 4 > end) return null;
  for (let i = 0; i < m; i++, o += 4) { const v = d.getFloat32(o); r.aux.push(Number.isFinite(v) && Math.abs(v) < 1e6 ? v : 0); }
  if (r.flags & F.DRONE) { if (o + 16 > end) return null; for (let i = 0; i < 4; i++, o += 4) { r.drone[i] = d.getFloat32(o); if (!Number.isFinite(r.drone[i]) || Math.abs(r.drone[i]) > 1e5) return null; } }
  if (r.kind > 1 || r.mode >= MODES.length || !Number.isFinite(r.t) || l < 0.5 || l > 1.6) return null;
  l = 1 / Math.sqrt(l); for (let i = 0; i < 4; i++) r.quat[i] *= l;
  for (let i = 0; i < 3; i++) if (!Number.isFinite(r.pos[i])) return null;
  if (Math.abs(r.pos[0]) > 60000 || Math.abs(r.pos[2]) > 45000 || r.pos[1] < -2000 || r.pos[1] > 20000) return null;
  return r;
}

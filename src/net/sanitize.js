// Validation helpers for untrusted peer data. Pure.
export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I L O 0 1
const RE = new RegExp(`^[${ALPHABET}]{5}$`);
export const validCode = (c) => typeof c === 'string' && RE.test(c);
export const normalizeCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
export function makeCode() {
  const r = new Uint32Array(5); globalThis.crypto.getRandomValues(r);
  let s = ''; for (let i = 0; i < 5; i++) s += ALPHABET[r[i] % ALPHABET.length]; return s;
}
export const makeToken = () => { const r = new Uint32Array(4); globalThis.crypto.getRandomValues(r); return Array.from(r, (v) => v.toString(36)).join('').slice(0, 24); };
// strips control, bidi-override, zero-width and combining-spam characters; collapses whitespace
const ctl = (c) => c < 32 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202f) || (c >= 0x2060 && c <= 0x206f) || c === 0xfeff || (c >= 0xfff9 && c <= 0xffff);
export function cleanText(s, max = 200) {
  if (typeof s !== 'string') return '';
  let o = ''; for (const ch of s.slice(0, max * 4).normalize('NFC')) o += ctl(ch.codePointAt(0)) ? ' ' : ch;
  return o.replace(/(\p{M}{2})\p{M}+/gu, '$1').replace(/\s+/g, ' ').trim().slice(0, max);
}
export const cleanName = (s) => cleanText(s, 20).replace(/[<>&"'`]/g, '') || 'Chaser';
export const num = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isType = (s) => typeof s === 'string' && /^[a-z][a-z0-9:_-]{0,31}$/i.test(s);
// deep-cleans generic payloads: finite numbers, bounded strings/arrays/depth, no prototype keys
export function cleanData(v, depth = 0, b = { n: 4000 }) {
  if (--b.n < 0 || depth > 8) return null;
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case 'number': return Number.isFinite(v) ? v : 0;
    case 'boolean': return v;
    case 'string': return v.length > 2000 ? v.slice(0, 2000) : v;
    case 'object': break;
    default: return null;
  }
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return v.slice(0, 2000).map((x) => cleanData(x, depth + 1, b));
  const o = {};
  for (const k of Object.keys(v).slice(0, 256)) if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype' && k.length <= 64) o[k] = cleanData(v[k], depth + 1, b);
  return o;
}
export const validBreakId = (i) => (typeof i === 'number' && Number.isFinite(i)) || (typeof i === 'string' && i.length > 0 && i.length <= 40);
// token bucket
export class Bucket {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.v = burst; this.t = -1; }
  take(now, n = 1) {
    if (this.t >= 0) this.v = Math.min(this.burst, this.v + (now - this.t) / 1000 * this.rate);
    this.t = now; if (this.v < n) return false; this.v -= n; return true;
  }
}

// Recorded sample layer (CC0 recordings, see CREDITS.md). Loaded lazily after the first gesture, essential tier first.
// Every sample has a procedural fallback: if a fetch/decode fails the synthesised sound in dsp.js keeps playing.
import { MANIFEST, REPLACE, ENGINES } from './manifest.js';
export { MANIFEST, REPLACE, ENGINES };
const BASE = new URL('../../assets/audio/', import.meta.url).href;

// loudest 50 ms window RMS (one-shots) or plain RMS (loops) of channel 0; used to level-match samples to the procedural mix
export function level(b, loop) {
  const x = b.getChannelData ? b.getChannelData(0) : b, n = x.length; if (!n) return 0;
  if (loop) { let s = 0; for (let i = 0; i < n; i += 2) s += x[i] * x[i]; return Math.sqrt(s / Math.ceil(n / 2)); }
  const w = Math.max(64, Math.floor((b.sampleRate || 44100) * 0.05)); let m = 0, s = 0; for (let i = 0; i < n; i++) { s += x[i] * x[i]; if (i >= w) s -= x[i - w] * x[i - w]; if (i >= w - 1 && s > m) m = s; } if (n < w) m = s * w / n; return Math.sqrt(Math.max(0, m) / w);
}
// mp3 encoders pad both ends; trim the padding and crossfade the tail into the head so loops are seamless in every browser
function seamless(ac, b, xf) {
  const C = b.numberOfChannels, sr = b.sampleRate, L = b.length, ch = []; for (let c = 0; c < C; c++) ch.push(b.getChannelData(c));
  let pk = 0; for (let i = 0; i < L; i += 3) pk = Math.max(pk, Math.abs(ch[0][i])); const th = pk * 0.004; let a = 0, z = L - 1; const lim = Math.min(L >> 3, 6000);
  while (a < lim && Math.abs(ch[0][a]) <= th) a++; while (z > L - lim && Math.abs(ch[0][z]) <= th) z--; a = Math.min(a + 32, L >> 3); z = Math.max(z - 32, L - (L >> 3));
  const len = z - a, n = Math.min(Math.floor(xf * sr), len >> 2), out = len - n; if (out < sr * 0.2) return b;
  const o = ac.createBuffer(C, out, sr);
  for (let c = 0; c < C; c++) { const s = ch[c], d = o.getChannelData(c); for (let i = 0; i < out; i++) d[i] = s[a + i]; for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; d[i] = s[a + i] * Math.sin(t * Math.PI / 2) + s[a + out + i] * Math.cos(t * Math.PI / 2); } }
  return o;
}

export class Samples {
  constructor(manifest = MANIFEST) { this.m = manifest; this.buf = new Map(); this.wait = new Map(); this.failed = []; this.ok = 0; this.files = 0; this.ac = null; this.done = false; this.last = new Map(); this.lv = new Map(); this.disabled = false; }
  // key of a procedural sound name (or a manifest key itself)
  alias(name) { const k = REPLACE[name] || name; return this.m[k] ? k : null; }
  has(key) { return !!key && this.buf.has(key); }
  // random variant, never the same twice in a row; returns {b: AudioBuffer, i}
  pick(key, r = Math.random) { const v = this.buf.get(key); if (!v?.length) return null; let i = Math.floor(r() * v.length); if (v.length > 1 && i === this.last.get(key)) i = (i + 1) % v.length; this.last.set(key, i); return v[i]; }
  ready(key, f) { if (this.buf.has(key)) f(); else { if (!this.wait.has(key)) this.wait.set(key, []); this.wait.get(key).push(f); } }
  // gain that makes variant v as loud as the procedural buffer `ref` (cached per variant), times the manifest trim
  gainFor(key, v, ref) { const e = this.m[key], c = v.lv; if (c !== undefined && v.ref === ref) return c; let g = e.g ?? 1; if (ref) { const a = level(ref, !!e.loop), b = v.l ?? (v.l = level(v.b, !!e.loop)); if (a > 1e-5 && b > 1e-5) g *= Math.min(12, Math.max(0.03, a / b)); } v.lv = g; v.ref = ref; return g; }
  // fetch + decode everything, tier by tier, `par` files at a time. Returns a promise that resolves when all are settled.
  start(ac, par = 4) {
    if (this.ac || this.disabled) return this.all; this.ac = ac; const keys = Object.keys(this.m).sort((a, b) => (this.m[a].tier ?? 1) - (this.m[b].tier ?? 1)); const q = [];
    for (const k of keys) for (const f of this.m[k].f) q.push([k, f]); this.files = q.length;
    const one = async ([k, f]) => {
      try {
        const r = await fetch(BASE + f); if (!r.ok) throw new Error('HTTP ' + r.status); const ab = await r.arrayBuffer();
        let b = await new Promise((res, rej) => { const p = ac.decodeAudioData(ab, res, rej); if (p?.then) p.then(res, rej); }); const e = this.m[k]; if (e.loop) b = seamless(ac, b, e.xf ?? 0.35);
        if (!this.buf.has(k)) this.buf.set(k, []); this.buf.get(k).push({ b, f, rate: e.rates?.[e.f.indexOf(f)] }); this.ok++; const w = this.wait.get(k); if (w) { this.wait.delete(k); for (const cb of w) try { cb(); } catch (er) { console.error('[audio] sample cb', k, er); } }
      } catch (e) { this.failed.push(f); console.warn('[audio] sample failed, keeping procedural', f, e?.message || e); }
    };
    this.all = (async () => { let i = 0; const run = async () => { while (i < q.length) { const it = q[i++]; await one(it); } }; await Promise.all(Array.from({ length: par }, run)); this.done = true; return { ok: this.ok, failed: this.failed.slice(), files: this.files }; })();
    return this.all;
  }
}

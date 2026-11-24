// Recorded sample layer (CC0 recordings, sources in CREDITS.md). Loaded lazily after the first gesture, essential tier first.
// Every sample has a procedural fallback: if a fetch/decode fails the synthesised sound from dsp.js keeps playing.
import { MANIFEST } from './manifest.js';
import { SOUNDS } from './dsp.js';
export { MANIFEST };
const BASE = new URL('../../assets/audio/', import.meta.url).href;

// procedural name -> sample key (drop-in replacement, level-matched to the procedural sound)
export const REPLACE = {
  wind: 'wind', leaves: 'leaves', rainGround: 'rainHeavy', rainRoof: 'rainRoof', rainGlass: 'rainGlass', crickets: 'crickets', cicada: 'cicada', frogs: 'frogs', squeal: 'squeal', gravel: 'gravel',
  impact0: 'impLight', impact1: 'impMed', impact2: 'impHeavy', impact3: 'impHuge', glass0: 'glassBreak', glass1: 'glassBreak', crack: 'woodCrack', thump0: 'thump', thump1: 'thump', thump2: 'thump',
  doorOpen: 'doorOpen', doorClose: 'doorClose', starter: 'starter', wiper: 'wiper', tick: 'indicator', tock: 'indicator', shutter: 'shutter', squelchOn: 'squelchOn', squelchOff: 'squelchOff',
  click: 'uiClick', hover: 'uiHover', back: 'uiBack', whoosh: 'whoosh', bird0: 'bird', bird1: 'bird', bird2: 'bird', bird3: 'bird', bird4: 'bird', bird5: 'bird', bird6: 'bird', bird7: 'bird',
};
// sample-only keys: procedural sound used as fallback while loading / on failure, and as loudness reference (null = silent until loaded)
export const FALLBACK = { torJet: 'roar', torTrain: 'roar', torFall: 'pink', torRumble: 'rumble', torDebris: 'debris', rainLight: 'rainGround', hailCar: 'rainRoof', hailGround: 'rainGround', trees: 'leaves', windHowl: null, meadow: null, traffic: null, metalBang: 'impact1' };

// loudest 50 ms window RMS (one-shots) or plain RMS (loops) of channel 0; used to level-match samples to the procedural mix
export function level(b, loop) {
  const x = b.getChannelData ? b.getChannelData(0) : b, n = x.length; if (!n) return 0;
  if (loop) { let s = 0; for (let i = 0; i < n; i += 2) s += x[i] * x[i]; return Math.sqrt(s / Math.ceil(n / 2)); }
  const w = Math.max(64, Math.floor((b.sampleRate || 44100) * 0.05)); let m = 0, s = 0; for (let i = 0; i < n; i++) { s += x[i] * x[i]; if (i >= w) s -= x[i - w] * x[i - w]; if (s > m) m = s; } return Math.sqrt(Math.max(0, m) / Math.min(w, n));
}
// mp3 encoders pad both ends; trim the padding and crossfade the tail into the head so loops are seamless in every browser
function seamless(b, xf) {
  const C = b.numberOfChannels, sr = b.sampleRate, L = b.length, ch = []; for (let c = 0; c < C; c++) ch.push(b.getChannelData(c));
  let pk = 0; for (let i = 0; i < L; i += 3) pk = Math.max(pk, Math.abs(ch[0][i])); const th = pk * 0.004, lim = Math.min(L >> 3, 6000); let a = 0, z = L - 1;
  while (a < lim && Math.abs(ch[0][a]) <= th) a++; while (z > L - lim && Math.abs(ch[0][z]) <= th) z--; a = Math.min(a + 32, L >> 3); z = Math.max(z - 32, L - (L >> 3));
  const len = z - a, n = Math.min(Math.floor(xf * sr), len >> 2), out = len - n; if (out < sr * 0.2) return b;
  const o = new AudioBuffer({ numberOfChannels: C, length: out, sampleRate: sr });
  for (let c = 0; c < C; c++) { const s = ch[c], d = o.getChannelData(c); for (let i = 0; i < out; i++) d[i] = s[a + i]; for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; d[i] = s[a + i] * Math.sin(t * Math.PI / 2) + s[a + out + i] * Math.cos(t * Math.PI / 2); } }
  return o;
}
const OAC = () => globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;

export class Samples {
  constructor(manifest = MANIFEST) { this.m = manifest; this.buf = new Map(); this.wait = new Map(); this.failed = []; this.ok = 0; this.files = 0; this.started = false; this.done = false; this.last = new Map(); this.dec = new Map(); this.all = null; }
  // sample key for a procedural sound name (or a manifest key itself)
  alias(name) { const k = REPLACE[name] || name; return this.m[k] ? k : null; }
  // procedural sound that stands in for `key` (when `name` is procedural it is its own fallback)
  fallback(key, name) { return SOUNDS[name] ? name : FALLBACK[key] ?? null; }
  has(key) { return !!key && this.buf.has(key); }
  // random variant, never the same twice in a row
  pick(key, r = Math.random) { const v = this.buf.get(key); if (!v?.length) return null; let i = Math.floor(r() * v.length); if (v.length > 1 && i === this.last.get(key)) i = (i + 1) % v.length; this.last.set(key, i); return v[i]; }
  ready(key, f) { if (this.buf.has(key)) f(); else { if (!this.wait.has(key)) this.wait.set(key, []); this.wait.get(key).push(f); } }
  // gain that makes variant v as loud as the procedural buffer `ref` (cached per variant/ref)
  gainFor(key, v, ref) { if (v.lv !== undefined && v.ref === ref) return v.lv; const e = this.m[key]; let g = e.g ?? 1; if (ref) { const a = level(ref, !!e.loop), b = v.l ?? (v.l = level(v.b, !!e.loop)); if (a > 1e-5 && b > 1e-5) g *= Math.min(10, Math.max(0.05, a / b)); } v.lv = g; v.ref = ref; return g; }
  _ctx(sr) { let c = this.dec.get(sr); if (!c) { const O = OAC(); c = new O(1, 1, sr); this.dec.set(sr, c); } return c; }
  // fetch + decode everything, tier by tier, `par` files at a time; resolves with {ok, failed, files} once all are settled
  start(par = 4) {
    if (this.started) return this.all; this.started = true; if (!OAC() || typeof fetch !== 'function') { this.done = true; return (this.all = Promise.resolve({ ok: 0, failed: [], files: 0 })); }
    const keys = Object.keys(this.m).sort((a, b) => (this.m[a].tier ?? 1) - (this.m[b].tier ?? 1)), q = []; for (const k of keys) for (const f of this.m[k].f) q.push([k, f]); this.files = q.length;
    const one = async ([k, f]) => {
      try {
        const r = await fetch(BASE + f); if (!r.ok) throw new Error('HTTP ' + r.status); const ab = await r.arrayBuffer(), e = this.m[k], ac = this._ctx(e.sr || 32000);
        let b = await new Promise((res, rej) => { const p = ac.decodeAudioData(ab, res, rej); if (p?.then) p.then(res, rej); }); if (e.loop) b = seamless(b, e.xf ?? 0.35);
        if (!this.buf.has(k)) this.buf.set(k, []); this.buf.get(k).push({ b, f }); this.ok++;
        const w = this.wait.get(k); if (w) { this.wait.delete(k); for (const cb of w) try { cb(); } catch (er) { console.error('[audio] sample callback', k, er); } }
      } catch (e) { this.failed.push(f); console.warn('[audio] sample failed, keeping procedural:', f, e?.message || e); }
    };
    let i = 0; const run = async () => { while (i < q.length) await one(q[i++]); };
    this.all = Promise.all(Array.from({ length: par }, run)).then(() => { this.done = true; return { ok: this.ok, failed: this.failed.slice(), files: this.files }; });
    return this.all;
  }
}

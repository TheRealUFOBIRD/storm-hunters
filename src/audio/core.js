// Audio graph: buses, limiter, reverb, sound bank, pooled one-shots. Works with any BaseAudioContext (also Offline for tests).
import { ORDER, LOOPS, render, rateOf, impulse, thunder as thunderSync, mulberry } from './dsp.js';
import { level as levelOf0 } from './samples.js';
const levelOf = (b) => levelOf0(b, false);
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// AudioParam with change detection (keeps automation timelines tiny)
export class Par {
  constructor(ac, param, v) { this.ac = ac; this.p = param; this.v = v ?? param.value; if (v !== undefined) param.value = v; }
  set(v, tc = 0.08) { if (!(v === v)) return; const d = Math.abs(v - this.v); if (d < 1e-5 || (d < Math.abs(this.v) * 0.006 && v !== 0)) return; this.v = v; this.p.setTargetAtTime(v, this.ac.currentTime, tc); }
}
export const gain = (ac, v = 1, to) => { const g = ac.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
export const filt = (ac, type, f, q = 0.7, to) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (to) b.connect(to); return b; };

// direction only (distance handled by explicit gains / filters); positions are relative to the camera
export class Spatial {
  constructor(ac, to, hrtf = false) { this.ac = ac; const p = this.node = ac.createPanner(); p.panningModel = hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'linear'; p.rolloffFactor = 0; p.refDistance = 1; p.maxDistance = 1e6; p.connect(to); this.px = p.positionX ? new Par(ac, p.positionX, 0) : null; if (this.px) { this.py = new Par(ac, p.positionY, 0); this.pz = new Par(ac, p.positionZ, -1); } }
  set(x, y, z, tc = 0.05) { const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l; if (this.px) { if (tc) { this.px.set(x, tc); this.py.set(y, tc); this.pz.set(z, tc); } else { this.px.p.value = this.px.v = x; this.py.p.value = this.py.v = y; this.pz.p.value = this.pz.v = z; } } else this.node.setPosition(x, y, z); }
}

export class Bank {
  constructor() { this.raw = new Map(); this.bufs = new Map(); this.wait = new Map(); this.done = false; this.worker = null; this.n = 0; this.cbs = new Map(); }
  // render everything in a worker (falls back to time-sliced main thread work)
  start() {
    if (this.started) return; this.started = true;
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => { const cb = this.cbs.get(data.id); this.cbs.delete(data.id); cb?.(data.ok ? data.o : null, data.e); };
      this.worker.onerror = (e) => { if (this.worker) { console.warn('[audio] worker failed, rendering on main thread', e.message || ''); this.worker.terminate(); this.worker = null; this.cbs.clear(); this._main(); } };
      for (const n of ORDER) this._post({ k: 'render', name: n }, (o, e) => { if (o) this.put(o); else console.error('[audio] render ' + n, e); });
    } catch { this.worker = null; this._main(); }
  }
  _post(m, cb) { m.id = ++this.n; this.cbs.set(m.id, cb); this.worker.postMessage(m); }
  _main() { const q = ORDER.filter((n) => !this.raw.has(n)); const go = () => { const t = performance.now(); while (q.length && performance.now() - t < 6) { const n = q.shift(); try { this.put(render(n)); } catch (e) { console.error('[audio]', n, e); } } if (q.length) setTimeout(go, 24); }; go(); }
  put(o) { this.raw.set(o.name, o); if (this.raw.size >= ORDER.length) this.done = true; const w = this.wait.get(o.name); if (w) { this.wait.delete(o.name); for (const f of w) f(); } }
  ready(name, f) { if (this.raw.has(name)) f(); else { if (!this.wait.has(name)) this.wait.set(name, []); this.wait.get(name).push(f); } }
  get(name) {
    let b = this.bufs.get(name); if (b) return b; const o = this.raw.get(name); if (!o) return null;
    b = new AudioBuffer({ length: o.ch[0].length, numberOfChannels: o.ch.length, sampleRate: o.sr }); o.ch.forEach((c, i) => b.copyToChannel(c, i)); this.bufs.set(name, b); this.raw.set(name, { name, sr: o.sr, ch: null }); return b;
  }
  thunder(p, cb) { if (this.worker) this._post({ k: 'thunder', p }, cb); else setTimeout(() => cb(thunderSync(p)), 0); }
  sync(names) { for (const n of names || ORDER) if (!this.raw.has(n)) this.put(render(n)); } // tests
}

export class Core {
  constructor(ac, bank, dest) {
    this.ac = ac; this.bank = bank; this.r = mulberry(4711); this.voices = 0; this.maxVoices = 44; this.interior = 0; this.vol = { master: 0.8, sfx: 1, engine: 1, weather: 1, music: 0.5, voice: 0.8 };
    const out = dest || ac.destination;
    this.clip = ac.createWaveShaper(); const c = new Float32Array(2049); for (let i = 0; i < 2049; i++) { const x = (i / 1024 - 1) * 1.6, a = Math.abs(x); c[i] = Math.sign(x) * (a < 0.75 ? a : 0.75 + 0.22 * Math.tanh((a - 0.75) / 0.22)); } this.clip.curve = c; this.clip.oversample = 'none'; this.pre = gain(ac, 1 / 1.6, this.clip); this.clip.connect(out);
    this.lim = ac.createDynamicsCompressor(); this.lim.threshold.value = -9; this.lim.knee.value = 8; this.lim.ratio.value = 14; this.lim.attack.value = 0.003; this.lim.release.value = 0.22; this.lim.connect(this.pre);
    this.master = gain(ac, 0.8, this.lim); this.world = gain(ac, 1, this.master); // world = everything ducked by pause
    this.bus = { sfx: gain(ac, 1, this.world), engine: gain(ac, 1, this.world), weather: gain(ac, 1, this.world), music: gain(ac, 0.5, this.master), voice: gain(ac, 0.8, this.master), ui: gain(ac, 1, this.master) };
    // outdoor sounds pass the cabin filter
    this.exW = filt(ac, 'lowpass', 20000, 0.5, this.bus.weather); this.exS = filt(ac, 'lowpass', 20000, 0.5, this.bus.sfx); this.weather = gain(ac, 1, this.exW); this.outside = gain(ac, 1, this.exS); this.engineIn = gain(ac, 1); this.enF = filt(ac, 'lowpass', 16000, 0.6, this.bus.engine); this.enP = ac.createBiquadFilter(); this.enP.type = 'peaking'; this.enP.frequency.value = 105; this.enP.Q.value = 1; this.enP.gain.value = 0; this.engineIn.connect(this.enP); this.enP.connect(this.enF);
    const ir = impulse(ac.sampleRate, 2.4, { decay: 1.5, lp: 2600, early: 14, sparse: 0.02 }), b = ac.createBuffer(2, ir[0].length, ac.sampleRate); b.copyToChannel(ir[0], 0); b.copyToChannel(ir[1], 1); this.verb = ac.createConvolver(); this.verb.normalize = false; this.verb.buffer = b; this.verbOut = gain(ac, 0.35, this.exS); this.verb.connect(this.verbOut); this.send = gain(ac, 1, this.verb);
    this.pMaster = new Par(ac, this.master.gain); this.pBus = {}; for (const k in this.bus) this.pBus[k] = new Par(ac, this.bus[k].gain); this.pWorld = new Par(ac, this.world.gain); this.pe = { w: new Par(ac, this.exW.frequency), wg: new Par(ac, this.weather.gain), s: new Par(ac, this.exS.frequency), sg: new Par(ac, this.outside.gain), e: new Par(ac, this.enF.frequency), p: new Par(ac, this.enP.gain), eg: new Par(ac, this.engineIn.gain) };
    this.last = new Map();
  }
  applyVolumes() { const v = this.vol; this.pMaster.set(v.master * 0.85); this.pBus.sfx.set(v.sfx); this.pBus.ui.set(v.sfx * 0.8); this.pBus.engine.set(v.sfx * v.engine); this.pBus.weather.set(v.sfx * v.weather); this.pBus.music.set(v.music); this.pBus.voice.set(v.voice); }
  setInterior(k) { this.interior = k; const f = (o, c) => o * Math.pow(c / o, k); this.pe.w.set(f(20000, 760), 0.12); this.pe.wg.set(lerp(1, 0.62, k), 0.12); this.pe.s.set(f(20000, 1500), 0.12); this.pe.sg.set(lerp(1, 0.6, k), 0.12); this.pe.e.set(f(16000, 1250), 0.12); this.pe.p.set(5 * k, 0.12); this.pe.eg.set(lerp(1, 0.85, k), 0.12); }
  // looped source; returns {gain Par, setRate, node, sample}. `name` is a procedural sound or a sample key: the procedural render starts
  // as soon as it exists and is crossfaded to the (level-matched) recording when that has loaded. sk = rate scale applied to the recording.
  loop(name, to, g = 0, rate = 1, sk = 1) {
    const ac = this.ac, G = gain(ac, g, to), S = this.bank.samples, key = S?.alias(name) || null, fb = key ? S.fallback(key, name) : name, o = { gain: new Par(ac, G.gain), node: G, src: null, sg: null, rate: null, stopped: false, _r: rate, sample: false, sk, old: [] };
    const start = (buf, lv, isS) => {
      if (o.stopped || !buf) return; const s = ac.createBufferSource(), k = isS ? o.sk : 1; s.buffer = buf; s.loop = true; s.playbackRate.value = o._r * k; const sg = gain(ac, o.src ? 0 : lv, G); s.connect(sg); s.start(0, this.r() * buf.duration);
      if (o.src) { const t = ac.currentTime, os = o.src, og = o.sg; sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(lv, t + 1.5); og.gain.cancelScheduledValues(t); og.gain.setValueAtTime(og.gain.value, t); og.gain.linearRampToValueAtTime(0, t + 1.5); try { os.stop(t + 1.6); } catch { /* */ } os.onended = () => { os.disconnect(); og.disconnect(); }; }
      o.src = s; o.sg = sg; o.sample = isS; o.rate = new Par(ac, s.playbackRate, o._r * k);
    };
    const useSample = () => { if (o.stopped || o.sample) return; const go = () => { const v = S.pick(key, this.r); if (v) start(v.b, S.gainFor(key, v, fb ? this.bank.get(fb) : null), true); }; if (fb && !this.bank.raw.has(fb)) this.bank.ready(fb, go); else go(); };
    if (key && S.has(key)) useSample(); else { if (fb) this.bank.ready(fb, () => { if (!o.src) start(this.bank.get(fb), 1, false); }); if (key) S.ready(key, useSample); }
    o.setRate = (r, tc) => { o._r = r; o.rate?.set(r * (o.sample ? o.sk : 1), tc); }; o.stop = () => { o.stopped = true; try { o.src?.stop(); } catch { /* not started */ } G.disconnect(); }; return o;
  }
  // buffer + level for a one-shot: recording (random variant) when loaded, else the procedural render
  shot(name) { const S = this.bank.samples, key = S?.alias(name); if (key && S.has(key)) { const v = S.pick(key, this.r), fb = S.fallback(key, name); return { b: v.b, lv: S.gainFor(key, v, fb ? this.bank.get(fb) : null) }; } const b = this.bank.get(name); return b ? { b, lv: 1 } : null; }
  // one-shot. o: {gain, rate, bus, to, pos:{x,y,z} relative to camera, delay, send, lp, pan, hrtf, min (min interval s), dist}
  play(name, o = {}) {
    const ac = this.ac; if (this.voices >= this.maxVoices + (o.prio ? 12 : 0)) return null; const sh = this.shot(name); if (!sh) return null; const buf = sh.b;
    const now = ac.currentTime; if (o.min) { const l = this.last.get(name) ?? -9; if (now - l < o.min) return null; this.last.set(name, now); }
    let g = (o.gain ?? 1) * sh.lv, lp = o.lp || 0, delay = o.delay || 0; if (o.pos) { const d = Math.hypot(o.pos.x, o.pos.y, o.pos.z), rf = o.ref || 8; if (o.atten !== false) { g *= rf / Math.max(rf, d); if (g < 0.003) return null; const c = 18000 / (1 + d / 260); if (c < 14000) lp = lp ? Math.min(lp, c) : c; } if (d > 60) delay += d / 343; }
    const s = ac.createBufferSource(), G = gain(ac, g); s.buffer = buf; s.playbackRate.value = (o.rate || 1) * (o.vary ? 1 + (this.r() * 2 - 1) * o.vary : 1); const nodes = [s, G]; s.connect(G); let tail = G;
    if (lp) { const f = filt(ac, 'lowpass', lp, 0.5); tail.connect(f); tail = f; nodes.push(f); }
    const to = o.to || (o.bus ? this.bus[o.bus] : this.outside);
    if (o.pos) { const p = new Spatial(ac, to, o.hrtf); p.set(o.pos.x, o.pos.y, o.pos.z, 0); tail.connect(p.node); nodes.push(p.node); } else if (o.pan) { const p = ac.createStereoPanner(); p.pan.value = o.pan; tail.connect(p); p.connect(to); nodes.push(p); } else tail.connect(to);
    if (o.send) { const sg = gain(ac, o.send, this.send); tail.connect(sg); nodes.push(sg); }
    this.voices++; s.onended = () => { this.voices--; for (const n of nodes) n.disconnect(); }; s.start(now + delay); if (o.dur) s.stop(now + delay + o.dur); return { src: s, gain: G, stop: (t = 0.05) => { G.gain.setTargetAtTime(0, ac.currentTime, t / 3); try { s.stop(ac.currentTime + t * 2); } catch { /* ended */ } } };
  }
  // recorded thunder layered on the procedural (geometry-correct) render: close cracks or distant rolls by distance, level-matched to the render,
  // air-absorption lowpass, same light-speed/sound-speed delay and direction. Returns true when a recording was scheduled.
  thunderRec(o, b, late) {
    const S = this.bank.samples, d = o.dmin, key = d < 2200 ? 'thunderNear' : 'thunderFar'; if (!S?.has(key) || !(d >= 0)) return false; const v = S.pick(key, this.r), ac = this.ac;
    const lv = (v.l ??= levelOf(v.b)), ref = levelOf(b), g = o.gain * Math.min(6, ref / Math.max(1e-4, lv)) * (d < 2200 ? 1.1 : 0.95); if (!(g > 0.002)) return false;
    const s = ac.createBufferSource(); s.buffer = v.b; s.playbackRate.value = (d < 2200 ? 1 : 0.9) * (0.92 + 0.16 * this.r()); const G = gain(ac, g), f = filt(ac, 'lowpass', Math.max(260, 16000 / (1 + d / 700)), 0.5), wide = gain(ac, 0.55), dir = gain(ac, 0.7), p = new Spatial(ac, this.weather, false);
    s.connect(f); f.connect(G); G.connect(wide); wide.connect(this.weather); G.connect(dir); dir.connect(p.node); p.set(o.x, 0.35, o.z, 0); let sg = null; if (d < 4000) { sg = gain(ac, 0.15, this.send); G.connect(sg); }
    this.voices++; this.thunders = (this.thunders || 0) + 1; s.onended = () => { this.voices--; this.thunders--; for (const n of [s, f, G, wide, dir, p.node, sg]) n?.disconnect(); };
    const off = late > o.delay ? late - o.delay : 0; s.start(ac.currentTime + Math.max(0, o.delay - late) + (d < 2200 ? 0 : 0.15), Math.min(off, 0.5)); return true;
  }
  // play a thunder render result
  playThunder(o, late = 0) {
    const ac = this.ac, b = new AudioBuffer({ length: o.ch[0].length, numberOfChannels: 2, sampleRate: o.sr }); b.copyToChannel(o.ch[0], 0); b.copyToChannel(o.ch[1], 1);
    const rec = this.thunderRec(o, b, late), s = ac.createBufferSource(); s.buffer = b; const G = gain(ac, o.gain * (rec ? 0.55 : 1)), wide = gain(ac, 0.5), dir = gain(ac, 0.75), p = new Spatial(ac, this.weather, false); s.connect(G); G.connect(wide); wide.connect(this.weather); G.connect(dir); dir.connect(p.node); p.set(o.x, 0.35, o.z, 0); let sg = null; if (o.dmin < 4000) { sg = gain(ac, 0.12, this.send); G.connect(sg); }
    const off = late > o.delay ? late - o.delay : 0; this.voices++; s.onended = () => { this.voices--; for (const n of [s, G, wide, dir, p.node, sg]) n?.disconnect(); this.thunders--; }; this.thunders = (this.thunders || 0) + 1; s.start(ac.currentTime + Math.max(0, o.delay - late), Math.min(off, 0.5)); return s;
  }
}

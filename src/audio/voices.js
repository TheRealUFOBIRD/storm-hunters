// Continuous voices. All parameters are driven by set(); no node is created per frame.
import { Par, Spatial, gain, filt, clamp, lerp, sstep } from './core.js';
import { SampleEngine } from './engine.js';
const osc = (ac, type, f, to) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; if (to) o.connect(to); o.start(); return o; };

// ---------------------------------------------------------------------------------------------- tornado
export class TornadoVoice {
  constructor(core) {
    const ac = core.ac; this.core = core; this.nodes = [];
    this.out = gain(ac, 1); this.pan = new Spatial(ac, core.weather, true); this.dir = gain(ac, 0.8, this.pan.node); this.bed = gain(ac, 0.3, core.weather); this.out.connect(this.dir); this.out.connect(this.bed); this.pDir = new Par(ac, this.dir.gain); this.pBed = new Par(ac, this.bed.gain);
    this.air = filt(ac, 'lowpass', 900, 0.4, this.out); this.pAir = new Par(ac, this.air.frequency); this.am = gain(ac, 1, this.air);
    this.roar = core.loop('torJet', this.am); this.roar2 = core.loop('torTrain', this.am, 0, 0.61, 1.6); this.white = core.loop('torFall', filt(ac, 'highpass', 700, 0.5, this.am)); // jet roar, freight train, waterfall hiss (recorded; procedural fallback)
    this.scream = core.loop('scream', this.am); this.debris = core.loop('torDebris', this.air); this.debris2 = core.loop('debris', this.air, 0, 0.73); this.rumble = core.loop('torRumble', this.out); this.rumble2 = core.loop('rumble', core.weather, 0, 1.37);
    // rotating amplitude modulation (two incommensurate rates so that it never sounds like a siren)
    this.l1 = osc(ac, 'sine', 0.6); this.l2 = osc(ac, 'triangle', 1.1); this.d1 = gain(ac, 0.2, this.am.gain); this.d2 = gain(ac, 0.1, this.am.gain); this.l1.connect(this.d1); this.l2.connect(this.d2); this.pl1 = new Par(ac, this.l1.frequency); this.pl2 = new Par(ac, this.l2.frequency); this.pd1 = new Par(ac, this.d1.gain); this.pd2 = new Par(ac, this.d2.gain);
    this.subG = gain(ac, 0, core.weather); this.pSub = new Par(ac, this.subG.gain); this.s1 = osc(ac, 'sine', 27, this.subG); this.s2 = osc(ac, 'sine', 34.3, this.subG); this.ds = gain(ac, 0, this.subG.gain); this.l1.connect(this.ds); this.pds = new Par(ac, this.ds.gain); this.idle = 0;
  }
  // x,y,z rel camera; dist horizontal m
  set(p) {
    const { dist: D, vmax, rCore } = p, d = Math.max(0, D - rCore * 0.9), L = Math.min(1.35, Math.pow(Math.max(0, vmax) / 80, 1.25)) * (p.strength ?? 1), S = 230 + rCore * 2.2, near = 1 / (1 + Math.pow(d / S, 1.7)), far = Math.exp(-d / 3000) / (1 + d / 1500), ground = p.ground ?? 1;
    const big = clamp(rCore / 320), lv = L * (0.35 + 0.65 * ground);
    this.pan.set(p.x, p.y + 40, p.z, 0.1); this.pAir.set(clamp(13000 * Math.exp(-d / 420) + 1500 * Math.exp(-d / 1800) + 160, 160, 16000), 0.15);
    const inside = sstep(S * 1.2, 0, d); this.pDir.set(lerp(1, 0.45, inside), 0.2); this.pBed.set(lerp(0.12, 0.85, inside), 0.2);
    this.roar.gain.set(lv * (1.3 * near + 0.55 * far), 0.2); this.roar2.gain.set(lv * (0.75 * near * (0.5 + 0.5 * big) + 0.6 * far), 0.2); this.roar.setRate(lerp(1.15, 0.78, big) * (0.92 + 0.12 * L), 0.5); this.roar2.setRate(lerp(0.7, 0.5, big), 0.5);
    this.white.gain.set(lv * near * near * 2.4, 0.2); this.scream.gain.set(L * ground * sstep(520, 30, d) * 1.15 * (1 - 0.35 * big), 0.25); this.scream.setRate(lerp(1.12, 0.74, big) * (0.75 + 0.3 * L), 0.4);
    const deb = ground * (0.25 + 0.75 * (p.dust ?? 0.6)) * sstep(28, 70, vmax); this.debris.gain.set(deb * (sstep(620, 20, d) * 1.5 + 0.15 * near), 0.25); this.debris2.gain.set(deb * sstep(260, 0, d) * 0.9, 0.25);
    this.rumble.gain.set(lv * (0.5 * near + 0.95 * far), 0.25); this.rumble2.gain.set(lv * near * 0.55, 0.25);
    const f = clamp(vmax / (6.283 * Math.max(15, rCore)) * 0.9, 0.22, 2.6); this.pl1.set(f, 0.8); this.pl2.set(f * 2.37, 0.8); this.pd1.set(0.16 + 0.2 * near, 0.3); this.pd2.set(0.06 + 0.14 * near, 0.3); const sub = lv * (0.28 * near * near + 0.04 * far); this.pSub.set(sub, 0.3); this.pds.set(sub * 0.45, 0.3);
    this.level = lv * (near + far);
  }
  mute() { for (const v of [this.roar, this.roar2, this.white, this.scream, this.debris, this.debris2, this.rumble, this.rumble2]) v.gain.set(0, 0.6); this.pSub.set(0, 0.6); this.pds.set(0, 0.6); this.level = 0; }
  dispose() { for (const v of [this.roar, this.roar2, this.white, this.scream, this.debris, this.debris2, this.rumble, this.rumble2]) v.stop(); for (const o of [this.l1, this.l2, this.s1, this.s2]) o.stop(); this.subG.disconnect(); this.pan.node.disconnect(); this.bed.disconnect(); }
}

// ---------------------------------------------------------------------------------------------- wind
export class WindVoice {
  constructor(core) {
    const ac = core.ac; this.core = core; this.sum = gain(ac, 1, core.weather); this.base = core.loop('wind', this.sum); this.low = core.loop('brown', filt(ac, 'lowpass', 120, 0.7, this.sum)); this.hiF = filt(ac, 'bandpass', 900, 0.5, this.sum); this.hi = core.loop('pink', this.hiF, 0, 1.1); this.pHi = new Par(ac, this.hiF.frequency);
    this.wh = [[520, 16], [1130, 22], [1840, 26]].map(([f, q]) => { const g = gain(ac, 0, this.sum), b = filt(ac, 'bandpass', f, q, g), s = core.loop('white', b, 1, 0.8 + Math.random() * 0.3); return { f, b, g: new Par(ac, g.gain), pf: new Par(ac, b.frequency), s, w: Math.random() * 9 }; });
    this.leaves = core.loop('leaves', this.sum); this.trees = core.loop('trees', this.sum); this.howl = core.loop('windHowl', filt(ac, 'highpass', 300, 0.5, core.bus.weather)); this.cab = core.loop('roll', filt(ac, 'lowpass', 500, 0.6, core.bus.weather)); this.gust = 0.5; this.tg = 0.5; this.t = 0; this.buf = 0;
  }
  // v wind speed relative to camera, amb = weather wind only, car road speed, inCar, veg 0..1 foliage
  set(p, dt) {
    this.t += dt; if (Math.random() < dt * (0.5 + p.v * 0.05)) this.tg = Math.random(); this.gust += (this.tg - this.gust) * Math.min(1, dt * 1.6); const buffet = 0.5 + 0.5 * Math.sin(this.t * 7.3) * Math.sin(this.t * 3.1 + 1) * Math.sin(this.t * 1.17);
    const v = p.v * (0.8 + 0.4 * this.gust), k = clamp(v / 55), g = Math.pow(k, 1.35);
    this.base.gain.set((0.05 * sstep(0.5, 5, v) + 1.25 * g) * (0.8 + 0.3 * buffet * k), 0.12); this.base.setRate(0.7 + 0.75 * k, 0.3); this.low.gain.set(1.3 * g * (0.5 + 0.9 * buffet), 0.09); this.hi.gain.set(0.9 * Math.pow(k, 1.8), 0.15); this.pHi.set(500 + 1900 * k, 0.2);
    for (const w of this.wh) { w.w += dt * (0.4 + k); const on = sstep(9, 38, v) * (0.35 + 0.65 * Math.max(0, Math.sin(w.w * 1.7) * Math.sin(w.w * 0.63))); w.g.set(on * (p.inCar ? 0.5 : 0.85) * 0.55, 0.2); w.pf.set(w.f * (0.75 + 0.6 * k + 0.12 * this.gust), 0.3); }
    this.leaves.gain.set((p.veg ?? 0.5) * (0.06 + 0.5 * sstep(2, 18, p.amb)) * (p.inCar ? 0.4 : 1) * 0.8, 0.3); this.trees.gain.set((p.veg ?? 0.5) * sstep(6, 30, p.amb) * (p.inCar ? 0.3 : 0.9) * (0.7 + 0.5 * this.gust), 0.3); this.trees.setRate(0.9 + 0.2 * k, 0.5); this.howl.gain.set(p.inCar ? sstep(10, 45, p.v) * 0.09 * (0.6 + 0.6 * this.gust) * (0.5 + 0.5 * this.core.interior) : 0, 0.2); this.howl.setRate(0.85 + 0.3 * k, 0.4); this.cab.gain.set(p.inCar ? Math.pow(clamp(p.v / 60), 1.7) * 0.8 * (0.4 + 0.6 * this.core.interior) : 0, 0.15);
  }
}

// ---------------------------------------------------------------------------------------------- rain & hail
export class RainVoice {
  constructor(core) { const ac = core.ac; this.core = core; this.ground = core.loop('rainGround', core.weather); this.heavy = core.loop('pink', filt(ac, 'bandpass', 2100, 0.4, core.weather), 0, 0.9); this.roof = core.loop('rainRoof', core.bus.weather); this.roof2 = core.loop('rainRoof', core.bus.weather, 0, 1.29); this.glass = core.loop('rainGlass', core.bus.weather); this.light = core.loop('rainLight', core.weather); this.hailC = core.loop('hailCar', core.bus.weather); this.hailG = core.loop('hailGround', core.weather); this.hb = 0; }
  set(r, inCar) { const k = this.core.interior, s = Math.sqrt(r); this.ground.gain.set(s * (0.2 + 0.8 * sstep(0.1, 0.75, r)), 0.4); this.light.gain.set(s * (1 - sstep(0.15, 0.8, r)) * 0.9, 0.4); this.heavy.gain.set(r * r * 0.7, 0.4); const roof = inCar ? 0.3 + 0.9 * k : 0; this.roof.gain.set(s * roof * 1.2, 0.3); this.roof2.gain.set(r * roof, 0.3); this.glass.gain.set(inCar ? s * (0.15 + 0.85 * k) * 1.1 : 0, 0.3); this.ground.setRate(lerp(1.08, 0.92, r), 1); }
  // individual stones
  hail(h, cm, inCar, dt) {
    const hk = this.core.interior, hs = Math.sqrt(clamp(h)); this.hailC.gain.set(inCar ? hs * (0.35 + 0.65 * hk) * 1.1 : 0, 0.3); this.hailG.gain.set(hs * (inCar ? 0.45 * (1 - 0.5 * hk) : 1) * 1.1, 0.3); this.hailC.setRate(lerp(1.1, 0.85, clamp(cm / 6)), 1);
    if (h < 0.01) return; const size = clamp(cm / 6, 0.08, 1); this.hb += dt * (h * (inCar ? 26 : 18) / (0.6 + size)); let n = 0; const r = this.core.r, k = this.core.interior;
    while (this.hb > 1 && n < 4) { this.hb -= 1; n++; const big = Math.pow(r(), 2) * size + 0.15 * size, at = r() * 0.04; if (inCar && r() < 0.65) this.core.play('hailCar' + Math.floor(r() * 6), { gain: (0.12 + 0.9 * big) * (0.5 + 0.5 * k), rate: lerp(1.5, 0.72, big) , vary: 0.12, to: this.core.bus.weather, pan: r() * 1.6 - 0.8, delay: at }); else { const a = r() * 6.28, d = 3 + r() * 16; this.core.play('hailGround' + Math.floor(r() * 4), { gain: 0.15 + 0.8 * big, rate: lerp(1.6, 0.8, big), vary: 0.15, pos: { x: Math.cos(a) * d, y: -1.5, z: Math.sin(a) * d }, to: this.core.weather, delay: at }); } }
    if (this.hb > 3) this.hb = 0;
  }
}

// ---------------------------------------------------------------------------------------------- ambience
const BIO = { plains: [0.7, 0.8, 0.5, 0.1], cornbelt: [0.8, 0.8, 0.7, 0.15], wheat: [0.7, 0.8, 0.4, 0.1], desert: [0.18, 0.5, 0.3, 0], mountain: [0.6, 0.25, 0.05, 0], forest: [1, 0.6, 0.6, 0.3], swamp: [0.8, 0.9, 0.9, 1], coast: [0.6, 0.4, 0.2, 0.3], urban: [0.3, 0.25, 0.2, 0] }; // birds crickets cicada frogs
export class AmbienceVoice {
  constructor(core) { this.core = core; const ac = core.ac, hp = filt(ac, 'highpass', 250, 0.5, core.outside); this.cr = core.loop('crickets', hp); this.ci = core.loop('cicada', hp); this.fr = core.loop('frogs', hp); this.low = core.loop('rumble', core.weather); this.meadow = core.loop('meadow', hp); this.traffic = core.loop('traffic', filt(ac, 'lowpass', 1800, 0.5, core.outside)); this.next = 1; this.calm = 1; }
  // dark 0..1, threat 0..1, wind, rain, hour, biome, storm distance hush
  set(p, dt) {
    const b = BIO[p.biome] || BIO.plains, calm = clamp(1 - p.dark * 1.15) * (1 - sstep(0.25, 0.6, p.threat)) * (1 - sstep(8, 20, p.wind)) * (1 - sstep(0.02, 0.25, p.rain)) * (1 - 0.7 * sstep(14, 30, p.speed)); this.calm += (calm - this.calm) * Math.min(1, dt * 0.35); const c = this.calm * (1 - 0.75 * this.core.interior);
    const h = p.hour, day = sstep(5.3, 7.5, h) * (1 - sstep(19, 20.6, h)), dusk = Math.max(sstep(18.5, 20.3, h), 1 - sstep(4.5, 6.2, h)), warm = sstep(10, 13, h) * (1 - sstep(18.5, 20, h));
    this.cr.gain.set(b[1] * (0.12 * day + 0.85 * dusk) * c * 0.55, 1); this.ci.gain.set(b[2] * warm * c * 0.4, 1); this.fr.gain.set(b[3] * Math.max(dusk, p.wet * 0.4 * day) * c * 0.6, 1);
    this.meadow.gain.set(b[0] * day * c * 0.22, 1); this.traffic.gain.set((p.biome === 'urban' ? 0.12 : 0.015) * (1 - 0.6 * sstep(0.2, 0.8, p.rain)) * (1 - 0.5 * this.core.interior), 1.5);
    this.low.gain.set(sstep(0.25, 0.9, p.dark) * 0.1 * (1 - sstep(0.3, 0.8, p.threat)), 2); this.low.setRate(1.6, 1); // distant, felt more than heard
    this.next -= dt; if (this.next < 0) { const g = b[0] * day * c; this.next = 0.5 + Math.random() * lerp(9, 2.5, b[0]); if (g > 0.05) { const a = Math.random() * 6.28, d = 12 + Math.random() * 40; this.core.play('bird' + Math.floor(Math.random() * 8), { gain: 0.1 + 0.25 * g * Math.random(), ref: 30, vary: 0.12, pos: { x: Math.cos(a) * d, y: 4 + Math.random() * 5, z: Math.sin(a) * d }, send: 0.12 }); } }
  }
}

// ---------------------------------------------------------------------------------------------- engine
export function engineSpec(t = {}) { // t = vehicles.types[id]
  const red = t.engine?.red || t.redline || (t.mass > 4500 ? 3400 : 6300), kw = t.power || 140, V8 = { cyl: 8, fire: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => i / 8), bank: [0, 1, 1, 0, 1, 0, 0, 1] };
  if (t.electric || /electric|\bEV\b/i.test((t.desc || '') + (t.name || ''))) return { cyl: 4, red: 12000, muffler: 1, ev: true, turbo: 0, body: 0.2 };
  if (red < 4300 || /diesel/i.test(t.desc || '')) return { cyl: 6, fire: [0, 1, 2, 3, 4, 5].map((i) => i / 6), bank: [0, 0, 0, 1, 1, 1], diesel: 1, turbo: 1, rough: 0.18, red, muffler: 0.55, pipe: 0.0105, body: 1.5 };
  if (kw >= 270) return { ...V8, red, rough: 0.16, muffler: t.cls === 'Muscle' || t.mass < 2000 ? 0.2 : 0.55, pops: t.cls === 'Muscle' ? 1 : 0, pipe: t.cls === 'Muscle' ? 0.0078 : 0.0092, body: 1.25 };
  if (kw >= 170) return { cyl: 6, fire: [0, 1, 2, 3, 4, 5].map((i) => i / 6), bank: [0, 1, 0, 1, 0, 1], red, rough: 0.1, muffler: 0.62, pipe: 0.0071, body: 0.9, turbo: t.turbo ? 0.6 : 0 };
  return { cyl: 4, fire: [0, 0.25, 0.5, 0.75], bank: [0, 1, 1, 0], red, rough: 0.12, muffler: 0.72, pipe: 0.0058, body: 0.7, turbo: t.turbo ? 0.7 : 0 };
}
export class EngineVoice {
  constructor(core, spec, remote = false) {
    const ac = core.ac; this.core = core; this.spec = spec; this.remote = remote; this.out = gain(ac, 0); this.pOut = new Par(ac, this.out.gain); this.pan = null;
    if (remote) { this.air = filt(ac, 'lowpass', 8000, 0.5, this.out); this.pAir = new Par(ac, this.air.frequency); this.pan = new Spatial(ac, core.outside); this.out.connect(this.pan.node); } else { this.air = this.out; this.out.connect(core.engineIn); }
    if (core.worklet && !spec.ev) {
      this.n = new AudioWorkletNode(ac, 'sh-engine', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: spec }); this.wg = gain(ac, 1, this.air); this.pwg = new Par(ac, this.wg.gain); this.n.connect(this.wg); this.pr = new Par(ac, this.n.parameters.get('rpm')); this.pl = new Par(ac, this.n.parameters.get('load')); this.pc = new Par(ac, this.n.parameters.get('cut'));
      this.se = new SampleEngine(core, spec, this.air);
    } else { // fallback: detuned saws through a load-driven filter
      this.f = filt(ac, 'lowpass', 400, 0.8, this.air); this.pf = new Par(ac, this.f.frequency); this.o = [1, 0.5, 2.01, 0.25].map((m, i) => { const g = gain(ac, [0.4, 0.4, 0.12, 0.25][i], this.f), o = osc(ac, spec.ev ? 'triangle' : 'sawtooth', 50, g); return { o, m, p: new Par(ac, o.frequency) }; });
    }
  }
  // gain 0..1; doppler = frequency factor; rel = position relative to camera (remote)
  set(rpm, load, o = {}) {
    const dop = o.doppler || 1, rn = clamp(rpm / this.spec.red), on = o.running === false ? 0 : 1;
    if (this.n) { this.pr.set(Math.max(0, rpm * dop), 0.03); this.pl.set(clamp(load), 0.05); this.pc.set(on && !o.cut ? 0 : 1, 0.02); if (this.se) { this.se.set(rpm, o.cut ? load * 0.2 : load, on && !o.cut, dop); this.pwg.set(this.se.ready ? (this.spec.cyl >= 8 || this.spec.diesel ? 0.55 : 0.3) : 1, 0.3); } } else { for (const q of this.o) q.p.set(Math.max(1, rpm / 60 * this.spec.cyl / 2 * q.m * dop), 0.03); this.pf.set(180 + 1600 * load + 1200 * rn, 0.05); }
    let g = (0.6 + 0.4 * load + 0.1 * rn) * on * (o.gain ?? 1);
    if (this.remote) { const d = Math.hypot(o.x, o.y, o.z); g *= 9 / Math.max(9, d); this.pAir.set(14000 / (1 + d / 120), 0.1); this.pan.set(o.x, o.y, o.z); }
    this.pOut.set(g * 0.85, 0.06);
  }
  mute() { this.pOut.set(0, 0.1); this.se?.mute(); }
  dispose() { this.se?.dispose(); this.n?.port.postMessage('stop'); this.n?.disconnect(); for (const q of this.o || []) q.o.stop(); this.out.disconnect(); this.pan?.node.disconnect(); }
}

// ---------------------------------------------------------------------------------------------- tyres
export class TyreVoice {
  constructor(core) { const ac = core.ac; this.core = core; this.rF = filt(ac, 'lowpass', 1200, 0.5, core.engineIn); this.pR = new Par(ac, this.rF.frequency); this.roll = core.loop('roll', this.rF); this.gr = core.loop('gravel', filt(ac, 'lowpass', 5200, 0.5, core.engineIn)); this.wet = core.loop('hiss', core.engineIn); this.sq = core.loop('squeal', core.engineIn); this.soft = core.loop('brown', filt(ac, 'lowpass', 260, 0.7, core.engineIn)); }
  set(p) { // speed m/s, surface type, wet 0..1, slip 0..1, contact 0..1, bump
    const s = p.speed, k = clamp(s / 45), hard = p.surface === 'asphalt', loose = p.surface === 'gravel' || p.surface === 'rock', c = p.contact;
    this.roll.gain.set(c * (hard ? 0.75 : 0.35) * Math.pow(k, 1.1), 0.1); this.roll.setRate(0.55 + 0.85 * k, 0.15); this.pR.set(500 + 2600 * k, 0.2);
    this.gr.gain.set(c * (loose ? 0.2 * sstep(0.5, 4, s) + 0.7 * k : p.surface === 'dirt' || p.surface === 'field' || p.surface === 'mud' ? 0.25 * k : 0) + c * (hard ? 0 : 0.55) * p.slip * sstep(1, 8, s), 0.07); this.gr.setRate(0.6 + 0.7 * k, 0.15);
    this.soft.gain.set(c * (hard ? 0.12 : 0.85) * Math.pow(k, 0.9) * (1 + 2 * (p.bump || 0)), 0.1); this.wet.gain.set(c * p.wet * (hard ? 0.7 : 0.25) * Math.pow(k, 1.2), 0.1);
    const q = c * (hard ? 1 : 0) * (1 - 0.7 * p.wet) * sstep(0.22, 0.8, p.slip) * sstep(2, 7, s); this.sq.gain.set(q * 0.55, 0.05); this.sq.setRate(0.82 + 0.25 * clamp(s / 30) + 0.1 * p.slip, 0.08); this.sqv = q;
  }
  mute() { for (const l of [this.roll, this.gr, this.wet, this.sq, this.soft]) l.gain.set(0, 0.15); }
}

// ---------------------------------------------------------------------------------------------- warning siren (town)
export class SirenVoice {
  constructor(core) {
    const ac = core.ac; this.core = core; this.pan = new Spatial(ac, core.outside); this.air = filt(ac, 'lowpass', 1500, 0.6, this.pan.node); this.pAir = new Par(ac, this.air.frequency); this.out = gain(ac, 0, this.air); this.pOut = new Par(ac, this.out.gain); this.echo = gain(ac, 0, core.send); this.pEcho = new Par(ac, this.echo.gain); this.out.connect(this.echo);
    this.rot = gain(ac, 0.62, this.out); this.lfo = osc(ac, 'sine', 0.118); const d = gain(ac, 0.38, this.rot.gain); this.lfo.connect(d); // slowly rotating horn: loud facing you, muted away, slight pitch shift
    this.tone = filt(ac, 'peaking', 900, 1.2, this.rot); this.tone.gain.value = 7; const ws = ac.createWaveShaper(), c = new Float32Array(257); for (let i = 0; i < 257; i++) c[i] = Math.tanh((i / 128 - 1) * 2.4); ws.curve = c; ws.connect(this.tone); this.mixG = gain(ac, 0.5, ws);
    this.o1 = osc(ac, 'sawtooth', 120, filt(ac, 'lowpass', 2400, 0.5, this.mixG)); this.o2 = osc(ac, 'triangle', 144, this.mixG); this.p1 = new Par(ac, this.o1.frequency); this.p2 = new Par(ac, this.o2.frequency); const dd = gain(ac, 14, this.o1.detune); this.lfo.connect(dd); dd.connect(this.o2.detune); this.f = 110; this.on = 0; this.smp = core.loop('siren', this.out, 0, 1); this.pMix = new Par(ac, this.mixG.gain);
  }
  set(p, dt) { // active, x,y,z, dist
    this.on = p.active ? Math.min(1, this.on + dt / 5.5) : Math.max(0, this.on - dt / 9); const s = this.on * this.on * (3 - 2 * this.on), f = lerp(95, 462, s); this.p1.set(f, 0.08); this.p2.set(f * 1.2, 0.08); const d = p.dist, g = sstep(0.05, 0.5, this.on) * 0.6 / (1 + Math.pow(d / 420, 1.25)); if (this.smp.sample) { this.pMix.set(0, 0.5); this.smp.gain.set(2.4 * sstep(0.02, 0.6, this.on), 0.2); this.smp.setRate(0.5 + 0.5 * s, 0.1); } this.pOut.set(g, 0.2); this.pEcho.set(0.5 * clamp(d / 900), 0.4); this.pAir.set(clamp(5200 / (1 + d / 420), 380, 5200), 0.3); this.pan.set(p.x, p.y, p.z, 0.15);
  }
  dispose() { this.smp.stop(); for (const o of [this.o1, this.o2, this.lfo]) o.stop(); this.out.disconnect(); this.pan.node.disconnect(); }
}

// ---------------------------------------------------------------------------------------------- horn, drone, servo
export class HornVoice {
  constructor(core, remote) { const ac = core.ac; this.g = gain(ac, 0); this.pg = new Par(ac, this.g.gain); this.pan = remote ? new Spatial(ac, core.outside) : null; this.f = filt(ac, 'lowpass', 3000, 0.6, this.g); this.g.connect(remote ? this.pan.node : core.engineIn); const pk = filt(ac, 'peaking', 1300, 1.5, this.f); pk.gain.value = 8; this.og = gain(ac, 1, pk); this.pog = new Par(ac, this.og.gain); this.o = [392, 494, 393.5].map((f) => { const g = gain(ac, 0.16, this.og); return osc(ac, 'sawtooth', f, g); }); this.smp = core.loop('horn', this.g, 0); this.core = core; this.heavy = false; this.ac = ac; }
  set(on, heavy, rel) { if (heavy !== this.heavy) { this.heavy = heavy; const b = heavy ? 277 : 392; this.o[0].frequency.value = b; this.o[1].frequency.value = b * 1.26; this.o[2].frequency.value = b * 1.004; } if (this.smp.sample) { this.pog.set(0, 0.05); this.smp.gain.set(1.7, 0.05); this.smp.setRate(heavy ? 0.74 : 1, 0.01); } let g = on ? 0.8 : 0; if (rel && this.pan) { const d = Math.hypot(rel.x, rel.y, rel.z); g *= 14 / Math.max(14, d); this.pan.set(rel.x, rel.y, rel.z); } this.pg.set(g, on ? 0.012 : 0.04); }
}
export class DroneVoice {
  constructor(core) { const ac = core.ac; this.g = gain(ac, 0); this.pg = new Par(ac, this.g.gain); this.pan = new Spatial(ac, core.bus.sfx); this.g.connect(this.pan.node); const lp = filt(ac, 'lowpass', 2600, 0.6, this.g); this.o = [1, 1.013, 0.988, 1.027].map((m) => { const g = gain(ac, 0.1, lp), o = osc(ac, 'sawtooth', 190 * m, g); return { p: new Par(ac, o.frequency), m }; }); this.nz = core.loop('pink', filt(ac, 'bandpass', 1500, 0.8, this.g), 0.35); this.lp = lp; this.smp = core.loop('drone', this.g, 0); }
  set(on, thr, rel, atten = 1) { if (this.smp.sample && !this.cut) { this.cut = true; this.lp.disconnect(); this.nz.gain.set(0.08, 0.3); } this.smp.gain.set(1.6, 0.2); this.smp.setRate(0.85 + 0.4 * thr, 0.08); for (const q of this.o) q.p.set((165 + 110 * thr) * q.m, 0.06); this.pg.set(on ? (0.3 + 0.35 * thr) * atten : 0, 0.15); if (rel) this.pan.set(rel.x, rel.y, rel.z); }
}
export class ServoVoice {
  constructor(core) { const ac = core.ac; this.g = gain(ac, 0, core.engineIn); this.pg = new Par(ac, this.g.gain); const lp = filt(ac, 'bandpass', 760, 1.4, this.g), a = gain(ac, 0.28, lp); this.o = osc(ac, 'sawtooth', 184, a); osc(ac, 'triangle', 368.7, a); const l = osc(ac, 'sine', 0.47), d = gain(ac, 7); l.connect(d); d.connect(this.o.frequency); this.nz = core.loop('roll', lp, 0.22, 1.3); }
  set(on) { this.pg.set(on ? 0.3 : 0, on ? 0.5 : 0.8); }
}

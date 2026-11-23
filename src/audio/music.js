// Generative adaptive score. Calm: sparse plucked strings + warm pad. Threat: pulsing low strings, drums, dissonance.
import { Par, gain, filt, clamp, sstep } from './core.js';
import { PLUCKS, impulse, mulberry } from './dsp.js';
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// D dorian-ish progression, [bass, triad...]
const CALM = [[38, 50, 57, 62, 65], [36, 48, 55, 60, 64], [41, 53, 57, 60, 65], [43, 50, 55, 62, 67], [38, 50, 57, 62, 69], [34, 50, 53, 58, 65]];
const DARK = [[38, 50, 53, 57, 62], [38, 50, 53, 58, 62], [36, 48, 51, 55, 60], [37, 49, 52, 55, 61]];
const SCALE = [0, 2, 3, 5, 7, 9, 10];
export class Music {
  constructor(core) {
    const ac = core.ac; this.core = core; this.ac = ac; this.r = mulberry((Date.now() & 0xffff) + 1); this.bus = gain(ac, 1, core.bus.music);
    const ir = impulse(ac.sampleRate, 3.4, { decay: 2.4, lp: 3600, early: 6 }), b = ac.createBuffer(2, ir[0].length, ac.sampleRate); b.copyToChannel(ir[0], 0); b.copyToChannel(ir[1], 1); this.verb = ac.createConvolver(); this.verb.normalize = false; this.verb.buffer = b; this.verb.connect(gain(ac, 0.5, this.bus));
    this.g = {}; this.P = {}; for (const k of ['pluck', 'pad', 'pulse', 'drum', 'tension']) { this.g[k] = gain(ac, 0, this.bus); this.P[k] = new Par(ac, this.g[k].gain); const s = gain(ac, { pluck: 0.6, pad: 0.5, pulse: 0.22, drum: 0.3, tension: 0.6 }[k], this.verb); this.g[k].connect(s); }
    // pad: 4 voices of detuned oscillators through a slow filter
    this.padF = filt(ac, 'lowpass', 520, 0.6, this.g.pad); this.pPadF = new Par(ac, this.padF.frequency); this.pad = [0, 1, 2, 3].map((i) => { const g = gain(ac, [0.2, 0.12, 0.1, 0.08][i], this.padF); return ['sawtooth', 'triangle'].map((t, j) => { const o = ac.createOscillator(); o.type = t; o.detune.value = (j ? 6 : -6) + i; o.frequency.value = hz(CALM[0][i]); o.connect(gain(ac, t === 'sawtooth' ? 0.35 : 0.8, g)); o.start(); return new Par(ac, o.frequency); }); });
    // tension: clustered high strings + sub drone
    this.tenF = filt(ac, 'bandpass', 900, 0.7, this.g.tension); this.pTen = new Par(ac, this.tenF.frequency); this.ten = [62, 63, 68, 69.3].map((m, i) => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); const g = gain(ac, 0.12, this.tenF), l = ac.createOscillator(); l.frequency.value = 4.2 + i * 0.7; const d = gain(ac, 9, o.detune); l.connect(d); l.start(); o.connect(g); o.start(); return new Par(ac, o.frequency); }); const so = ac.createOscillator(); so.frequency.value = hz(26); so.connect(gain(ac, 0.5, this.g.tension)); so.start();
    this.mode = 'menu'; this.threat = 0; this.t = 0; this.bar = 0; this.step = 0; this.nextStep = 0; this.nextPluck = 0; this.chord = CALM[0]; this.mel = 4; this.phrase = 0; this.quiet = 0; this.chordAt = 0;
  }
  _chord(c, tc = 1.2) { this.chord = c; for (let i = 0; i < 4; i++) for (const p of this.pad[i]) p.set(hz(c[i]), tc); }
  _pluck(m, g, at, pan = 0) { let best = PLUCKS[0]; for (const p of PLUCKS) if (Math.abs(p - m) < Math.abs(best - m)) best = p; this.core.play('pl' + best, { gain: g, rate: Math.pow(2, (m - best) / 12), to: this.g.pluck, delay: Math.max(0, at - this.ac.currentTime), pan, prio: true }); }
  // threat 0..1 (smoothed here), mode 'menu' | 'game' | 'off'
  update(dt, mode, threat) {
    const now = this.ac.currentTime, r = this.r; this.mode = mode; this.threat += (threat - this.threat) * Math.min(1, dt * (threat > this.threat ? 0.5 : 0.16)); const T = this.threat, menu = mode === 'menu', off = mode === 'off';
    const calm = (1 - sstep(0.18, 0.42, T)), mid = sstep(0.28, 0.5, T), high = sstep(0.55, 0.8, T), ex = sstep(0.8, 1, T);
    this.P.pluck.set(off ? 0 : menu ? 0.8 : 0.55 * calm, 1.5); this.P.pad.set(off ? 0 : menu ? 0.26 : 0.16 * calm + 0.12 * mid * (1 - 0.5 * high), 2); this.P.pulse.set(off || menu ? 0 : 0.5 * mid, 1.2); this.P.drum.set(off || menu ? 0 : 0.75 * high, 1); this.P.tension.set(off || menu ? 0 : 0.05 * mid + 0.17 * high + 0.1 * ex, 1.5);
    this.pPadF.set((menu ? 620 : 380) + 260 * Math.sin(now * 0.13) + 300 * high, 0.8); this.pTen.set(500 + 900 * T + 260 * Math.sin(now * 0.31), 0.6); const bend = 1 + 0.03 * ex; this.ten[2].set(hz(68) * bend, 2); this.ten[3].set(hz(69.3) * bend, 2);
    if (off) return;
    if (now > this.chordAt) { const set = T > 0.32 && !menu ? DARK : CALM; this.chordAt = now + (menu ? 7.2 : T > 0.32 ? 5.4 : 10 + r() * 5); this._chord(set[menu ? this.bar++ % 6 : Math.floor(r() * set.length)]); if (this.phrase <= 0 && (menu || r() < 0.75) && calm > 0.2) this.phrase = menu ? 9 : 3 + Math.floor(r() * 6); if (now > this.quiet && !menu && calm > 0.5 && r() < 0.22) this.quiet = now + 25 + r() * 35; }
    // plucked guitar-like figures
    if (calm > 0.05 || menu) {
      if (this.nextPluck < now - 1) this.nextPluck = now + 0.3;
      while (this.nextPluck < now + 0.25) {
        const at = this.nextPluck, c = this.chord;
        if (this.phrase > 0 && (menu || now > this.quiet)) { const first = this.phrase === 9 || r() < 0.18; if (first) { this._pluck(c[0] < 40 ? c[0] : c[0], 0.5, at, -0.15); if (r() < 0.5) this._pluck(c[2], 0.28, at + 0.02, 0.1); } this.mel = clamp(this.mel + Math.floor(r() * 5) - 2, 0, 9); const oct = Math.floor(this.mel / 7), m = r() < 0.6 ? c[1 + Math.floor(r() * 4)] + (r() < 0.25 ? 12 : 0) : 50 + SCALE[this.mel % 7] + 12 * oct; this._pluck(m, 0.2 + 0.25 * r(), at, r() * 0.6 - 0.3); this.phrase--; this.nextPluck = at + (menu ? 0.6 : 0.5) * [1, 1, 2, 1, 3, 0.5][Math.floor(r() * 6)]; } else this.nextPluck = at + (menu ? 1.2 : 1.5 + r() * 3);
      }
    }
    // ostinato strings + drums
    if (mid > 0.02 && !menu) {
      const bpm = 84 + 52 * T, sx = 30 / bpm; if (this.nextStep < now - 0.5) this.nextStep = now + 0.05;
      while (this.nextStep < now + 0.2) {
        const at = this.nextStep, s = this.step++ % 16, d = at - now, root = this.chord[0], acc = s % 8 === 0 ? 1 : s % 3 === 0 ? 0.75 : 0.45; if (high > 0.4 || s % 2 === 0 || mid > 0.7) { const n = s === 11 && high > 0.3 ? root + 1 : s % 8 === 6 ? root + 12 : root, b = n < 42 ? 38 : n < 48 ? 45 : 50; this.core.play('str' + b, { gain: 0.5 * acc, rate: Math.pow(2, (n - b) / 12), to: this.g.pulse, delay: d, prio: true, pan: s % 2 ? 0.12 : -0.12 }); if (high > 0.5 && s % 4 === 2) this.core.play('str50', { gain: 0.28, rate: Math.pow(2, (this.chord[2] - 50) / 12), to: this.g.pulse, delay: d, prio: true }); }
        if (high > 0.02) { if (s === 0 || s === 6 || (s === 10 && r() < 0.7)) this.core.play('taiko', { gain: s === 0 ? 0.9 : 0.6, vary: 0.02, to: this.g.drum, delay: d, prio: true }); if ((s === 3 || s === 13 || s === 14) && r() < 0.6 + 0.4 * ex) this.core.play('tom', { gain: 0.4, vary: 0.05, to: this.g.drum, delay: d, prio: true, pan: r() * 0.8 - 0.4 }); if (ex > 0.2 && s % 2 === 1) this.core.play('tik', { gain: 0.25, to: this.g.drum, delay: d, prio: true }); }
        this.nextStep = at + sx;
      }
    }
  }
}

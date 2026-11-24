// Recorded engine: granular playback of a real dyno sweep (rpm-indexed by its measured firing frequency) + recorded idle loops.
// Each grain reads the part of the sweep whose firing frequency is closest to the target and pitch-corrects the rest, so any
// cylinder count / rpm maps onto the same recording. Load crossfades a bright (on-throttle) and a muffled (overrun) path.
import { Par, gain, filt, clamp, lerp, sstep } from './core.js';

export class SampleEngine {
  constructor(core, spec, to) {
    const ac = core.ac; this.core = core; this.ac = ac; this.spec = spec; this.S = core.bank.samples; this.ready = false; this.nextT = 0; this.rpm = 800; this.load = 0; this.run = 1; this.dop = 1;
    this.idleRpm = spec.idle || (spec.diesel ? 620 : spec.cyl >= 8 ? 650 : 780);
    this.out = gain(ac, 0, to); this.pOut = new Par(ac, this.out.gain);
    this.on = gain(ac, 0, this.out); this.pOn = new Par(ac, this.on.gain); const offF = filt(ac, 'lowpass', 900, 0.6, this.out); this.off = gain(ac, 0, offF); this.pOff = new Par(ac, this.off.gain);
    this.lowS = filt(ac, 'lowshelf', 160, 0.7); this.lowS.gain.value = spec.cyl >= 8 ? 6 : spec.diesel ? 7 : 2; this.bus = gain(ac, 1, this.lowS); this.lowS.connect(this.on); this.lowS.connect(this.off);
    this.pGr = new Par(ac, this.bus.gain);
    const ik = spec.diesel ? 'engIdleDiesel' : spec.cyl >= 8 ? 'engIdleV8' : 'engIdleI4';
    this.idle = core.loop(ik, this.lowS, 0, 1); // sample-only key: silent until loaded
    if (this.S) this.S.ready('engSweep', () => { const v = this.S.pick('engSweep'); const t = this.S.m.engSweep.table; if (!v || !t?.length) return; this.sw = v.b; this.tab = t; this.ready = true; });
  }
  // position (s) in the sweep whose firing frequency is f, and that frequency
  locate(f) { const t = this.tab, n = t.length; if (f <= t[0][1]) return t[0]; if (f >= t[n - 1][1]) return t[n - 1]; let a = 0, b = n - 1; while (b - a > 1) { const m = (a + b) >> 1; if (t[m][1] < f) a = m; else b = m; } const k = (f - t[a][1]) / Math.max(1e-6, t[b][1] - t[a][1]); return [lerp(t[a][0], t[b][0], k), f]; }
  set(rpm, load, run, dop = 1) {
    this.rpm = Math.max(0, rpm); this.load = clamp(load); this.run = run ? 1 : 0; this.dop = dop; const sp = this.spec, idle = this.idleRpm;
    const hi = sstep(idle * 1.15, idle * 2.1, rpm), wSw = sp.diesel ? 0.25 + 0.75 * hi : sp.cyl >= 8 ? 0.35 + 0.65 * hi : hi; // sweep weight (V8 / diesel keep some grains at idle for body)
    this.pGr.set(wSw, 0.05); this.idle.gain.set(this.run * (1 - 0.92 * hi) * (0.9 + 0.3 * load), 0.06); this.idle.setRate(clamp(rpm / idle, 0.6, 2.4) * dop, 0.04);
    this.pOn.set(0.3 + 0.95 * this.load, 0.05); this.pOff.set((1 - this.load) * 0.75, 0.05); this.pOut.set(this.run ? 1 : 0, 0.08);
    this.pump();
  }
  // schedule grains up to `ahead` seconds past now (call every frame; offline tests call it once with a long horizon)
  pump(ahead = 0.16) {
    if (!this.ready || !this.run) return; const ac = this.ac, now = ac.currentTime, gl = 0.1, hop = gl / 2; if (this.nextT < now + 0.005) this.nextT = now + 0.01; const until = now + ahead; let n = 0;
    while (this.nextT < until && n++ < 400) { this.grain(this.nextT, gl); this.nextT += hop; }
  }
  grain(t, gl) {
    const ac = this.ac, f = this.rpm * this.spec.cyl / 120 * this.dop, [pos, fs] = this.locate(f), rate = clamp(f / fs, 0.3, 2.5), r = this.core.r, dur = this.sw.duration;
    const off = clamp(pos + (r() - 0.5) * 0.06 - gl * rate / 2, 0, dur - gl * rate - 0.01), s = ac.createBufferSource(), g = ac.createGain(); s.buffer = this.sw; s.playbackRate.value = rate;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + gl / 2); g.gain.linearRampToValueAtTime(0, t + gl); s.connect(g); g.connect(this.bus); s.start(t, off); s.stop(t + gl + 0.005); s.onended = () => { s.disconnect(); g.disconnect(); };
  }
  mute() { this.pOut.set(0, 0.1); this.run = 0; }
  dispose() { this.run = 0; this.idle.stop(); this.out.disconnect(); }
}

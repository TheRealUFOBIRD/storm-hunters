// Engine synthesiser: per-cylinder combustion pulses in firing order -> two exhaust banks (waveguide pipes) -> muffler,
// plus intake breath, valve train / diesel clatter, turbo whistle and overrun crackle.
const TAU = Math.PI * 2;
class ShEngine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, d, a, b) => ({ name, defaultValue: d, minValue: a, maxValue: b, automationRate: 'k-rate' });
    return [k('rpm', 800, 0, 12000), k('load', 0, 0, 1), k('cut', 0, 0, 1)];
  }
  constructor(o) {
    super(); const p = o.processorOptions || {}; this.cyl = p.cyl || 4; this.fire = p.fire || Array.from({ length: this.cyl }, (_, i) => i / this.cyl); this.bank = p.bank || this.fire.map((_, i) => i & 1); this.diesel = p.diesel || 0; this.turbo = p.turbo || 0; this.rough = p.rough ?? 0.1; this.red = p.red || 6500; this.muff = p.muffler ?? 0.5; this.pops = p.pops || 0; this.body = p.body || 1;
    const n = this.cyl; this.e1 = new Float32Array(n); this.e2 = new Float32Array(n); this.prev = new Float32Array(n); this.ph = Math.random(); this.rpm = 800; this.load = 0; this.spool = 0; this.tph = 0;
    this.len = [Math.floor(sampleRate * (p.pipe || 0.0062)), Math.floor(sampleRate * (p.pipe || 0.0062) * 1.07)]; this.dl = [new Float32Array(4096), new Float32Array(4096)]; this.w = 0; this.dlp = [0, 0]; this.m1 = this.m2 = this.hp = this.hx = 0; this.i1 = this.i2 = 0; this.c1 = this.c2 = this.d1 = this.d2 = 0; this.nlp = 0; this.sub = 0; this.s = 1234567; this.dead = false;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.dead = true; };
  }
  rnd() { this.s = (Math.imul(this.s, 1664525) + 1013904223) | 0; return this.s / 2147483648; }
  process(_, outs, P) {
    if (this.dead) return false; const out = outs[0][0], sr = sampleRate, tr = P.rpm[0], tl = P.load[0], cut = P.cut[0], n = this.cyl;
    for (let i = 0; i < out.length; i++) {
      this.rpm += (tr - this.rpm) * 0.0012; this.load += (tl - this.load) * 0.0015; const rpm = this.rpm, load = this.load, f = rpm / 120 / sr, rn = Math.min(1.1, rpm / this.red);
      this.ph += f * (1 + this.rnd() * 0.0006); if (this.ph >= 1) this.ph -= 1;
      const k1 = 1 - Math.min(0.2, f * (26 - 8 * load)), k2 = 1 - Math.min(0.6, f * 110 + 0.02); let b0 = 0, b1 = 0, fired = 0;
      for (let c = 0; c < n; c++) {
        let x = this.ph - this.fire[c]; if (x < 0) x += 1;
        if (x < this.prev[c]) { let a = (0.3 + 0.7 * load) * (1 + this.rnd() * this.rough * (1.4 - rn)) * (1 - cut); if (this.pops && load < 0.08 && rn > 0.45 && this.rnd() > 0.82) a *= 2.2 + 2 * Math.abs(this.rnd()); a *= 0.55 + 0.45 * Math.min(1, rpm / 600); this.e1[c] += a; this.e2[c] += a; fired = a; }
        this.prev[c] = x; this.e1[c] *= k1; this.e2[c] *= k2; const p = this.e1[c] - this.e2[c]; if (this.bank[c]) b1 += p; else b0 += p;
      }
      const nz = this.rnd(); this.nlp += (nz - this.nlp) * 0.35; const turb = 1 + this.nlp * (0.25 + 0.5 * load); b0 *= turb; b1 *= turb;
      // exhaust pipes: reflection with sign flip at the open end
      let ex = 0; for (let k = 0; k < 2; k++) { const d = this.dl[k], r = d[(this.w - this.len[k] + 4096) & 4095]; this.dlp[k] += (r - this.dlp[k]) * 0.42; const y = (k ? b1 : b0) - 0.56 * this.dlp[k]; d[this.w] = y; ex += y; } this.w = (this.w + 1) & 4095;
      const fc = Math.min(0.75, TAU * (330 + (1 - this.muff) * 1100 + load * (900 + 1700 * (1 - this.muff)) + rn * 500) / sr); this.m1 += (ex - this.m1) * fc; this.m2 += (this.m1 - this.m2) * fc; let y = this.m2 * 0.75 + (ex - this.m1) * (0.06 + 0.1 * load + 0.1 * (1 - this.muff));
      // intake: noise gated by the induction strokes, resonance rises with rpm
      const fi = 2 * Math.sin(Math.PI * Math.min(0.2, (190 + rpm * 0.11) / sr)), gateI = Math.max(0, Math.sin(this.ph * TAU * n / 2)); const xi = nz * gateI * load; this.i2 += fi * this.i1; this.i1 += fi * (xi - this.i2 - 0.5 * this.i1); y += this.i1 * (0.1 + 0.4 * rn) * 0.5;
      // valve train / injector clatter
      if (fired) { this.d1 += fired * this.diesel * 0.5; this.c1 += 0.02 + 0.05 * rn; } const wd = TAU * 1850 / sr; const rd = 0.987; const t = 2 * rd * Math.cos(wd) * this.d1 - rd * rd * this.d2; this.d2 = this.d1; this.d1 = t; y += t * 0.1 * (1 - 0.35 * load); const wc = TAU * 3900 / sr, t2 = 2 * 0.97 * Math.cos(wc) * this.c1 - 0.9409 * this.c2; this.c2 = this.c1; this.c1 = t2; y += t2 * 0.25; y += (nz - this.nlp) * 0.006 * rn * rn;
      if (this.turbo) { const tgt = load * Math.min(1, rn * 1.5); this.spool += (tgt - this.spool) * (tgt > this.spool ? 0.00004 : 0.00007); this.tph += (1800 + 7200 * this.spool) / sr; if (this.tph > 1) this.tph -= 1; y += Math.sin(this.tph * TAU) * this.spool * this.spool * 0.035 * this.turbo + nz * this.spool * 0.018 * this.turbo; }
      // fundamental body resonance + DC removal
      this.sub += (this.m2 - this.sub) * (TAU * 95 / sr); y += this.sub * 0.32 * this.body; const h = y - this.hx + 0.9965 * this.hp; this.hx = y; this.hp = h; out[i] = Math.tanh(h * 1.15) * 0.8;
    }
    return true;
  }
}
registerProcessor('sh-engine', ShEngine);

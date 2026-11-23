// Snapshot interpolation buffer: hermite position (uses velocities), slerped rotation, short extrapolation and smooth
// correction of prediction errors. Pure maths, fixed storage, no per-frame allocation.
const N = 24, MAX_EXTRA = 0.35;
const mk = () => ({ t: -1, pos: [0, 0, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1], heading: 0, pitch: 0, aux: [], tele: false });
export function slerp(o, a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const s = d < 0 ? -1 : 1; d *= s;
  let w0 = 1 - t, w1 = t; if (d < 0.9995) { const th = Math.acos(Math.min(1, d)), si = 1 / Math.sin(th); w0 = Math.sin((1 - t) * th) * si; w1 = Math.sin(t * th) * si; }
  let l = 0; for (let i = 0; i < 4; i++) { o[i] = a[i] * w0 + b[i] * w1 * s; l += o[i] * o[i]; } l = 1 / (Math.sqrt(l) || 1); for (let i = 0; i < 4; i++) o[i] *= l; return o;
}
const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const before = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };

export class InterpBuffer {
  constructor() {
    this.s = Array.from({ length: N }, mk); this.n = 0; this.out = { pos: [0, 0, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1], heading: 0, pitch: 0, aux: [], extrapolating: false, stale: 0 };
    this.err = [0, 0, 0]; this.qerr = [0, 0, 0, 1]; this.hasErr = false; this.lastT = -1; this._raw = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
  }
  clear() { this.n = 0; this.hasErr = false; this.err.fill(0); this.qerr = [0, 0, 0, 1]; this.lastT = -1; }
  get newest() { return this.n ? this.s[this.n - 1] : null; }
  push(r) {
    const last = this.newest; if (last && r.t <= last.t + 1e-4) { if (r.t < last.t - 5) this.clear(); else return false; }
    const extra = this.lastT >= 0 && last && this.lastT > last.t; if (extra) { this._eval(this.lastT); for (let i = 0; i < 3; i++) before.pos[i] = this._raw.pos[i]; for (let i = 0; i < 4; i++) before.quat[i] = this._raw.quat[i]; }
    if (this.n === N) { const f = this.s.shift(); this.s.push(f); this.n--; }
    const d = this.s[this.n++]; d.t = r.t; for (let i = 0; i < 3; i++) { d.pos[i] = r.pos[i]; d.vel[i] = r.vel[i]; } for (let i = 0; i < 4; i++) d.quat[i] = r.quat[i];
    d.heading = r.heading; d.pitch = r.pitch; d.aux.length = r.aux.length; for (let i = 0; i < r.aux.length; i++) d.aux[i] = r.aux[i];
    if (last) { const dt = r.t - last.t, sp = Math.max(Math.hypot(...r.vel), Math.hypot(...last.vel)); d.tele = Math.hypot(r.pos[0] - last.pos[0], r.pos[1] - last.pos[1], r.pos[2] - last.pos[2]) > 12 + sp * dt * 2.5; } else d.tele = false;
    if (d.tele) { this.err.fill(0); this.hasErr = false; this.qerr = [0, 0, 0, 1]; } else if (extra) { // blend away the misprediction instead of popping
      this._eval(this.lastT); let m = 0; for (let i = 0; i < 3; i++) { this.err[i] += before.pos[i] - this._raw.pos[i]; m += this.err[i] * this.err[i]; }
      if (m > 400) this.err.fill(0);
      const a = before.quat, b = this._raw.quat, q = [0, 0, 0, 0]; // q = a * conj(b)
      q[0] = -a[3] * b[0] + a[0] * b[3] - a[1] * b[2] + a[2] * b[1]; q[1] = -a[3] * b[1] + a[0] * b[2] + a[1] * b[3] - a[2] * b[0]; q[2] = -a[3] * b[2] - a[0] * b[1] + a[1] * b[0] + a[2] * b[3]; q[3] = a[3] * b[3] + a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      this.qerr = mulq(this.qerr, q); this.hasErr = true;
    }
    return true;
  }
  _eval(t) {
    const o = this.out, raw = this._raw, n = this.n; o.extrapolating = false; o.stale = 0;
    let i = n - 1; while (i >= 0 && this.s[i].t > t) i--;
    if (i < 0) { const a = this.s[0]; cp(raw, a); o.heading = a.heading; o.pitch = a.pitch; setAux(o.aux, a.aux); set3(o.vel, a.vel); return; }
    const a = this.s[i];
    if (i === n - 1) { // extrapolate with decaying velocity
      const dt = t - a.t, e = Math.min(dt, MAX_EXTRA * 4), k = MAX_EXTRA * (1 - Math.exp(-e / MAX_EXTRA)); o.extrapolating = dt > 0; o.stale = dt;
      for (let j = 0; j < 3; j++) { raw.pos[j] = a.pos[j] + a.vel[j] * k; o.vel[j] = a.vel[j] * Math.exp(-e / MAX_EXTRA); }
      const p = i > 0 ? this.s[i - 1] : null;
      if (p && !a.tele && a.t - p.t < 0.5) { const u = 1 + Math.min(k, 0.15) / (a.t - p.t); slerp(raw.quat, p.quat, a.quat, Math.min(u, 2)); o.heading = a.heading + wrap(a.heading - p.heading) * Math.min(u - 1, 1); } else { for (let j = 0; j < 4; j++) raw.quat[j] = a.quat[j]; o.heading = a.heading; }
      o.pitch = a.pitch; setAux(o.aux, a.aux); return;
    }
    const b = this.s[i + 1], h = b.t - a.t, u = (t - a.t) / h;
    if (b.tele) { cp(raw, u < 1 ? a : b); o.heading = a.heading; o.pitch = a.pitch; setAux(o.aux, a.aux); set3(o.vel, a.vel); return; }
    const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = (u3 - 2 * u2 + u) * h, h01 = 3 * u2 - 2 * u3, h11 = (u3 - u2) * h, lin = h > 0.6; // long gaps: linear, hermite would overshoot
    for (let j = 0; j < 3; j++) {
      raw.pos[j] = lin ? a.pos[j] + (b.pos[j] - a.pos[j]) * u : a.pos[j] * h00 + a.vel[j] * h10 + b.pos[j] * h01 + b.vel[j] * h11; o.vel[j] = a.vel[j] + (b.vel[j] - a.vel[j]) * u;
    }
    slerp(raw.quat, a.quat, b.quat, u); o.heading = a.heading + wrap(b.heading - a.heading) * u; o.pitch = a.pitch + (b.pitch - a.pitch) * u;
    setAux(o.aux, a.aux, b.aux, u);
  }
  // t = render time on the shared clock
  sample(t, dt = 0) {
    if (!this.n) return null; this._eval(t); this.lastT = t; const o = this.out, r = this._raw;
    if (this.hasErr) {
      const k = Math.exp(-7 * dt); let m = 0; for (let j = 0; j < 3; j++) { this.err[j] *= k; m += Math.abs(this.err[j]); o.pos[j] = r.pos[j] + this.err[j]; }
      slerp(this.qerr, this.qerr, ID, 1 - k); mulq(this.qerr, r.quat, o.quat); if (m < 0.002 && Math.abs(this.qerr[3]) > 0.99999) this.hasErr = false;
    } else { set3(o.pos, r.pos); for (let j = 0; j < 4; j++) o.quat[j] = r.quat[j]; }
    return o;
  }
}
const ID = [0, 0, 0, 1];
function mulq(a, b, o = [0, 0, 0, 0]) {
  const x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
  o[0] = x; o[1] = y; o[2] = z; o[3] = w; return o;
}
function cp(o, s) { set3(o.pos, s.pos); for (let j = 0; j < 4; j++) o.quat[j] = s.quat[j]; }
function set3(o, s) { o[0] = s[0]; o[1] = s[1]; o[2] = s[2]; }
// auxiliary vehicle state: smooth channels are lerped, large jumps (wrapping wheel angles, flags) take the newer value
function setAux(o, a, b, u = 0) { o.length = a.length; for (let i = 0; i < a.length; i++) { const d = b && b.length === a.length ? b[i] - a[i] : 0; o[i] = !b ? a[i] : Math.abs(d) < 3 ? a[i] + d * u : b[i]; } }

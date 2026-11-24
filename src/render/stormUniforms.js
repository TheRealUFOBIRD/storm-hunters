// Packs ctx.storms state into uniforms (storm arrays, tornado arrays + per-height profile texture)
import * as THREE from 'three';
import { NS } from './stormMap.js';
import { NT, PROF_N } from './volume.js';

const v4 = (n) => [...Array(n)].map(() => new THREE.Vector4());
const toH = THREE.DataUtils.toHalfFloat;
const hash = (n) => { const s = Math.sin(n * 127.1 + 11.7) * 43758.5453; return s - Math.floor(s); };
const smooth = THREE.MathUtils.smoothstep;

export class StormUniforms {
  constructor(ctx) {
    this.ctx = ctx;
    this.stormU = { uNS: { value: 0 }, uStA: { value: v4(NS) }, uStB: { value: v4(NS) }, uStC: { value: v4(NS) }, uStD: { value: v4(NS) }, uStE: { value: v4(NS) }, uStW: { value: v4(NS) } };
    this.data = new Uint16Array(PROF_N * NT * 4);
    this.tex = new THREE.DataTexture(this.data, PROF_N, NT, THREE.RGBAFormat, THREE.HalfFloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter; this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping; this.tex.generateMipmaps = false; this.tex.needsUpdate = true;
    this.torU = { uNT: { value: 0 }, uT0: { value: v4(NT) }, uT1: { value: v4(NT) }, uT2: { value: v4(NT) }, uT3: { value: v4(NT) }, uT4: { value: v4(NT) }, uSub: { value: v4(NT * 4) }, uSubPh: { value: new Array(NT * 4).fill(0) }, uTProf: { value: this.tex } };
    this.st = new Map(); this.tt = new Map(); this._s = []; this._t = []; this._o = { x: 0, z: 0 }; this.top = 13000;
  }
  groundAt(x, z) { const w = this.ctx.world; const h = w?.heightAt ? w.heightAt(x, z) : 0; return Number.isFinite(h) ? h : 0; }
  update(dt) {
    const S = this.ctx.storms, cam = this.ctx.camera.position, U = this.stormU, now = this.ctx.time.now; this.top = 3600;
    const list = this._s; list.length = 0;
    if (S?.list) for (const s of S.list) { s._rd = Math.hypot(s.x - cam.x, s.z - cam.z) - (s.radius || 4000); if (s._rd < 40000) list.push(s); }
    // storms carrying a tornado win ties so the primary slot always has the interesting mesocyclone
    list.sort((a, b) => a._rd - b._rd); const n = Math.min(NS, list.length); U.uNS.value = n;
    for (let i = 0; i < n; i++) {
      const s = list[i]; let m = this.st.get(s.id ?? s); if (!m) { m = { drop: 0, wx: s.meso?.x ?? s.x, wz: s.meso?.z ?? s.z, wr: 400, rot: hash(s.seed || 1) * 6.28, gy: this.groundAt(s.x, s.z), seen: 0, inten: s.intensity ?? 1 }; this.st.set(s.id ?? s, m); m.first = true; }
      m.seen = now;
      const k = m.first ? 1 : 1 - Math.exp(-dt * 0.7), g = this.groundAt(s.x, s.z); m.gy += (g - m.gy) * (m.first ? 1 : Math.min(1, dt * 0.2));
      const rotS = s.rotation ?? 0; m.rot += dt * (0.012 + 0.05 * rotS);
      const base = m.gy + (s.cloudBase || 900), top = m.gy + (s.cloudTop || 11000), type = s.type === 'squall' ? 1 : s.type === 'shower' ? 2 : 0;
      const spd = Math.hypot(s.vx || 0, s.vz || 0); let dx = spd > 0.2 ? s.vx / spd : Math.sin(s.heading || 0.9), dz = spd > 0.2 ? s.vz / spd : -Math.cos(s.heading || 0.9);
      const meso = s.meso || { x: s.x, z: s.z, r: 900 }, mr = meso.r || 1000, rain = s.rain || { x: s.x, z: s.z, r: s.rainR || 2000, rate: 0.6 };
      // wall cloud: follows the strongest tornado of this storm, otherwise the mesocyclone
      let tw = null; if (S.tornadoes) for (const t of S.tornadoes) if ((t.storm === s || t.storm?.id === s.id || t.storm === s.id) && t.stage !== 'dead' && (!tw || t.strength > tw.strength)) tw = t;
      let wx = meso.x, wz = meso.z, wr = mr * 0.42, drop = type === 0 ? smooth(rotS, 0.45, 0.95) * 230 * (0.6 + 0.8 * hash((s.seed || 1) + 3)) : 0;
      if (tw) { const o = S.axisAt ? S.axisAt(tw, tw.lcl, this._o) : tw; wx = o.x; wz = o.z; const wide = Math.min(1, (tw.rTop || 200) / (tw.lcl || 900)); wr = Math.max(mr * (0.34 + 0.14 * hash((tw.seed || 1) + 9)), (tw.rTop || 200) * (1.6 - 0.35 * wide)); drop = Math.max(drop * 0.6, 150 + 150 * hash((tw.seed || 1) + 5) * (0.5 + tw.strength)) * (1 - 0.62 * wide); }
      drop = Math.min(drop, (s.cloudBase || 900) * 0.42);
      m.drop += (drop - m.drop) * k * 0.5; if (m.first) m.drop = drop; m.wx += (wx - m.wx) * k; m.wz += (wz - m.wz) * k; m.wr += (wr - m.wr) * k; m.inten += ((s.intensity ?? 1) - m.inten) * k; m.first = false;
      U.uStA.value[i].set(s.x, s.z, s.radius || 4500, hash(s.seed || 1)); U.uStB.value[i].set(base, top, m.inten, rotS); U.uStC.value[i].set(meso.x, meso.z, mr, type);
      U.uStD.value[i].set(dx, dz, (rain.rate ?? 0.6) * (0.35 + 0.65 * m.inten), Math.min(1, (s.hail || 0) / 5)); U.uStE.value[i].set(rain.x, rain.z, rain.r || 2000, m.rot); U.uStW.value[i].set(m.wx, m.wz, m.wr, m.drop);
      this.top = Math.max(this.top, top + 900);
    }
    this.primary = n ? list[0] : null;
    // tornadoes
    const T = this.torU, tl = this._t; tl.length = 0;
    if (S?.tornadoes) for (const t of S.tornadoes) if (t.stage !== 'dead') { t._rd = Math.hypot(t.x - cam.x, t.z - cam.z); if (t._rd < 32000) tl.push(t); }
    tl.sort((a, b) => a._rd - b._rd); const nt = Math.min(NT, tl.length); T.uNT.value = nt; const d = this.data, o = this._o;
    for (let i = 0; i < nt; i++) {
      const t = tl[i]; let m = this.tt.get(t.id ?? t); if (!m) { m = { rot: hash(t.seed || 1) * 6.28, up: hash((t.seed || 1) + 2) * 500 }; this.tt.set(t.id ?? t, m); }
      m.seen = now;
      const lcl = t.lcl || 900, y0 = t.y0 ?? this.groundAt(t.x, t.z), rc = Math.max(t.rCore || 50, 4), hMax = lcl * 1.25; let rs = 0, rn = 0, ext = 0;
      for (let k = 0; k < PROF_N; k++) {
        const h = (k + 0.5) / PROF_N * hMax, hh = Math.min(h, lcl); let ax = t.x, az = t.z, R;
        if (S.axisAt) { S.axisAt(t, hh, o); ax = o.x; az = o.z; } else if (t.lean) { const q = hh / lcl; ax += t.lean.x * q * q; az += t.lean.z * q * q; }
        R = S.funnelRadius ? S.funnelRadius(t, hh) : rc * 0.5 + ((t.rTop || 300) - rc * 0.5) * Math.pow(hh / lcl, 1.6); if (!(R > 0)) R = 0;
        { const fl = smooth(h / lcl, 0.70, 1.1); R *= 1 + 0.9 * fl * fl * (1 - 0.6 * Math.min(1, R / lcl)); }
        const q = (i * PROF_N + k) * 4; d[q] = toH(ax - t.x); d[q + 1] = toH(az - t.z); d[q + 2] = toH(R); d[q + 3] = toH(0);
        if (hh < lcl * 0.75 && R > 1) { rs += R; rn++; } ext = Math.max(ext, Math.hypot(ax - t.x, az - t.z) + R * 1.9 + 45);
      }
      const Rm = Math.max(6, rn ? rs / rn : (t.rTop || 60) * 0.4), vm = t.vmax || 40, str = t.strength ?? 0.5, dustR = Math.max(t.dustR || rc * 2, 8);
      m.rot += dt * Math.min(2.2, (2 * vm * rc / (rc * rc + Rm * Rm)) * 0.75); m.up += dt * Math.min(45, 6 + vm * 0.3);
      const wide = Rm / lcl, rough = THREE.MathUtils.clamp(0.26 + 1.1 * wide + 0.26 * str + 0.28 * (hash((t.seed || 1) + 4) - 0.35), 0.18, 1.0);
      const dust = t.dust ?? 0.5, dh = Math.min(lcl * 0.34, dustR * (0.3 + 0.42 * str));
      T.uT0.value[i].set(t.x, t.z, y0, lcl); T.uT1.value[i].set(Rm, Math.max(ext, dust > 0.01 ? dustR * 3.2 : 0), vm, rough); T.uT2.value[i].set(dustR, dust, dh, m.rot);
      const c = t.dustColor || [0.42, 0.3, 0.2]; T.uT3.value[i].set(c[0], c[1], c[2], hash(t.seed || 1));
      let mv = 0, se = 0; for (let k = 0; k < 4; k++) { const s = t.sub?.[k]; if (s) { const rcs = Math.max(3, s.rc || 20); T.uSub.value[i * 4 + k].set(s.a, s.r, s.s ?? 1, rcs); m.sph ||= [0, 0, 0, 0]; m.sph[k] += dt * Math.min(vm / Math.max(rcs, 6), 2.4); T.uSubPh.value[i * 4 + k] = m.sph[k] % 6283.185; mv = Math.max(mv, s.s ?? 1); se = Math.max(se, (s.r || 0) + rcs * 6 + 40); } else T.uSub.value[i * 4 + k].set(0, 1, 0, 1); }
      if (mv > 0) T.uT1.value[i].y = Math.max(T.uT1.value[i].y, se);
      T.uT4.value[i].set(rc, m.up, t.spin || 1, mv);
    }
    if (nt) this.tex.needsUpdate = true;
    if (this.ctx.time.frame % 600 === 0) for (const M of [this.st, this.tt]) for (const [k, m] of M) if (now - m.seen > 60) M.delete(k);
    this.nearTornado = nt ? tl[0] : null;
  }
}

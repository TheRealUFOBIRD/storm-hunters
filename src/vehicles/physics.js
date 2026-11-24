// 6-DOF vehicle dynamics, fixed 240 Hz. No engine dependency, only THREE math. Headless testable.
// env: { world:{heightAt,normalAt,surfaceAt,waterLevelAt,queryColliders,hitCollider}, storms:{windAt}, wetness(), time(), fx?, others:[bodies] }
import { Vector3, Quaternion } from 'three';
import { gnoise } from '../core/noise.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { SPECS } from './specs.js';

export const STEP = 1 / 240;
const G = 9.81, RHO = 1.12;
const N = new Vector3(), U = new Vector3();
const DEFAULT_SURF = { type: 'grass', grip: 0.75, wetGrip: 0.5, rollRes: 0.04, bump: 0.02, dust: 0.3 };

// Magic-formula-like normalised curve: peak 1 at s=1, decays toward `slide`
export function mfCurve(s, slide, off) {
  if (s <= 1) { const t = 1 - s; return 1 - t * t * t * (1 + 0.12 * s) - 0.0 * t; }
  return slide + (1 - slide) / (1 + off * (s - 1) * (s - 1) * 0.35 + (s - 1) * 0.12);
}

export class Wheel {
  constructor(i) {
    this.index = i; this.contact = false; this.compression = 0; this.susp = 0; this.x = 0; this.xPrev = 0; this.steer = 0; this.spin = 0; this.omega = 0; this.slip = 0; this.slipLong = 0; this.slipLat = 0;
    this.load = 0; this.ux = 0; this.uy = 0; this.surface = 'asphalt'; this.grip = 1; this.rollRes = 0.012; this.bump = 0; this.dust = 0; this.brakeT = 0; this.fx = 0; this.fy = 0; this.abs = 1;
    this.pos = new Vector3(); this.normal = new Vector3(0, 1, 0); this.water = 0; this.pSusp = 0; this.pSpin = 0; this.rSusp = 0; this.rSpin = 0; this.gy = 0;
  }
}

export class VehicleBody {
  constructor(typeId, env) {
    const s = (this.spec = SPECS[typeId]); this.type = typeId; this.env = env;
    this.p = new Vector3(); this.q = new Quaternion(); this.v = new Vector3(); this.w = new Vector3();
    this.pp = new Vector3(); this.pq = new Quaternion(); // previous step (interpolation)
    this.rp = new Vector3(); this.rq = new Quaternion(); // render
    this.M = new Float64Array(9); this.Iw = new Float64Array(9);
    const m = s.mass, W = s.W * 0.94, H = (s.tall || s.H) * 0.82, L = s.L * 0.9;
    this.Ix = m / 12 * (H * H + L * L) * 0.92; this.Iy = m / 12 * (W * W + L * L) * 0.96; this.Iz = m / 12 * (W * W + H * H) * 1.05;
    this.acc = 0; this.input = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analog: false };
    this.steer = 0; this.throttle = 0; this.brake = 0; this.hand = 0; this.steerAngle = 0;
    this.engW = s.engine.idle / 9.55; this.gear = 1; this.shiftTimer = 0; this.shiftCool = 0; this.revTimer = 0; this.limiter = false; this.stalled = false;
    this.abs = true; this.tc = true; this.absActive = false; this.tcActive = false;
    this.damage = 0; this.fuel = 1; this.anchored = false; this.anchorK = 0; this.anchors = null; this.windLoad = 0; this.windU = [0, 0, 0, 0, 0, 0, 0, 0, 0]; this.windSpeed = 0; this.occupied = false;
    this.flipped = false; this.airborne = false; this.airTime = 0; this.asleep = false; this.sleepT = 0; this.upY = 1; this.speed = 0; this.vLong = 0; this.vLat = 0; this.engineOn = true; this.waterDepth = 0;
    this.accLocal = new Vector3(); this.gForce = new Vector3(); this.onImpact = null; this.colliders = []; this.contactN = 0; this.scrape = 0; this.powerMul = 1; this.gripMul = 1; this.massMul = 1; this.looseMul = 1; this.armorMul = 1; this.fuelMul = 1; this.holdMul = 1;
    const a = this;
    this.wheels = [0, 1, 2, 3].map((i) => {
      const w = new Wheel(i), front = i < 2, R = s.R, fr = front ? s.susp.fF : s.susp.fR;
      const wb = s.wheelbase, loadFrac = (front ? wb / 2 + s.cgF : wb / 2 - s.cgF) / wb, mc = m * loadFrac / 2;
      w.front = front; w.R = R; w.bx = (i % 2 ? 1 : -1) * (front ? s.trackF : s.trackR) / 2; w.bz = front ? -(wb / 2 - s.cgF) : wb / 2 + s.cgF;
      w.k = mc * (2 * Math.PI * fr) ** 2; w.xs = mc * G / w.k; w.l0 = w.xs + s.susp.bump + 0.25; w.by = R - s.cgY + w.l0 - w.xs; w.xMax = w.xs + s.susp.bump;
      const cc = 2 * Math.sqrt(w.k * mc); w.cB = cc * s.susp.zB; w.cR = cc * s.susp.zR; w.mc = mc; w.Fz0 = mc * G; w.I = 0.62 * (R * R) * (10 + 300 * R * R * R) * (s.dually && !front ? 1.8 : 1); w.x = w.xs;
      return w;
    });
    void a;
    const hw = s.W / 2, hl = s.L / 2, cf = s.cgF, cg = s.cgY, top = (s.tall || s.H), P = [];
    const add = (x, y, f, r) => P.push({ x, y: y - cg, z: -(f - cf), r: r || 0 });
    const low = s.R * 0.72;
    for (const sx of [-1, 1]) {
      add(sx * hw * 0.8, low, hl * 0.97); add(sx * hw * 0.8, low, -hl * 0.97);
      add(sx * hw * 0.82, s.H * 0.5, hl); add(sx * hw * 0.82, s.H * 0.52, -hl);
      add(sx * hw, low * 1.05, 0); add(sx * hw, s.H * 0.5, hl * 0.35); add(sx * hw, s.H * 0.5, -hl * 0.4);
      add(sx * hw * 0.68, s.H * 0.97, hl * 0.12); add(sx * hw * 0.7, (s.tall ? top : s.H) * 0.98, -hl * 0.45);
    }
    this.hull = P; this.box = { hx: hw * 0.97, hy: s.H * 0.46, hz: hl * 0.98, cy: s.H * 0.54 - cg, cz: cf };
    this.radius = Math.hypot(hw, hl);
    this._F = new Float64Array(3); this._T = new Float64Array(3); this._prevV = new Vector3(); this._gh = 0; this._gn = new Vector3(0, 1, 0);
    this.updateM();
  }
  get mass() { return this.spec.mass; }
  get rpm() { return this.engineOn ? this.engW * 9.5493 : 0; }

  place(x, z, heading, y) {
    const h = y ?? this.env.world.heightAt(x, z); this.env.world.normalAt(x, z, N);
    this.q.setFromAxisAngle(U.set(0, 1, 0), -heading); const qa = new Quaternion().setFromUnitVectors(U, N); this.q.premultiply(qa);
    this.p.set(x, h, z).addScaledVector(N, this.spec.cgY + 0.02); this.v.set(0, 0, 0); this.w.set(0, 0, 0);
    for (const w of this.wheels) { w.omega = 0; w.ux = w.uy = 0; w.x = w.xPrev = w.xs; }
    this.gear = 1; this.engW = this.spec.engine.idle / 9.55; this.setAnchored(false); this.asleep = false; this.acc = 0; this.sync();
  }
  sync() { this.pp.copy(this.p); this.pq.copy(this.q); this.rp.copy(this.p); this.rq.copy(this.q); this.updateM(); this._prevV.copy(this.v); }
  updateM() {
    const { x, y, z, w } = this.q, M = this.M;
    M[0] = 1 - 2 * (y * y + z * z); M[1] = 2 * (x * y - w * z); M[2] = 2 * (x * z + w * y);
    M[3] = 2 * (x * y + w * z); M[4] = 1 - 2 * (x * x + z * z); M[5] = 2 * (y * z - w * x);
    M[6] = 2 * (x * z - w * y); M[7] = 2 * (y * z + w * x); M[8] = 1 - 2 * (x * x + y * y);
    const a = 1 / this.Ix, b = 1 / this.Iy, c = 1 / this.Iz, I = this.Iw;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i * 3 + j] = M[i * 3] * a * M[j * 3] + M[i * 3 + 1] * b * M[j * 3 + 1] + M[i * 3 + 2] * c * M[j * 3 + 2];
    this.upY = M[4];
  }
  setAnchored(on) {
    if (!this.spec.anchor) { this.anchored = false; return false; }
    if (on && (Math.abs(this.speed) > 2.5 || this.upY < 0.8 || this.airborne)) return false;
    this.anchored = on; if (!on) this.anchors = null; this.wake(); return true;
  }
  wake() { this.asleep = false; this.sleepT = 0; }
  addImpulse(jx, jy, jz, px, py, pz) { // world impulse at world point
    const m = this.spec.mass, rx = px - this.p.x, ry = py - this.p.y, rz = pz - this.p.z, I = this.Iw;
    this.v.x += jx / m; this.v.y += jy / m; this.v.z += jz / m;
    const tx = ry * jz - rz * jy, ty = rz * jx - rx * jz, tz = rx * jy - ry * jx;
    this.w.x += I[0] * tx + I[1] * ty + I[2] * tz; this.w.y += I[3] * tx + I[4] * ty + I[5] * tz; this.w.z += I[6] * tx + I[7] * ty + I[8] * tz;
    this.wake();
  }
  addDamage(d) { const o = this.damage; this.damage = clamp(o + d * (1 - this.spec.armor * 0.85) * this.armorMul); return this.damage - o; }

  // --- per frame ---
  update(dt) {
    this.frameSample(dt);
    if (this.asleep) { this.rp.copy(this.p); this.rq.copy(this.q); for (const w of this.wheels) { w.rSusp = w.susp; w.rSpin = w.spin; } return; }
    this.acc += Math.min(dt, 0.1); let n = 0;
    while (this.acc >= STEP && n++ < 26) {
      this.pp.copy(this.p); this.pq.copy(this.q); for (const w of this.wheels) { w.pSusp = w.susp; w.pSpin = w.spin; }
      this.step(STEP); this.acc -= STEP;
    }
    const a = clamp(this.acc / STEP);
    this.rp.lerpVectors(this.pp, this.p, a); this.rq.slerpQuaternions(this.pq, this.q, a);
    for (const w of this.wheels) { w.rSusp = lerp(w.pSusp, w.susp, a); w.rSpin = lerp(w.pSpin, w.spin, a); }
  }
  // slow-changing samples (surface, wind, colliders) once per frame
  frameSample(dt) {
    const e = this.env, s = this.spec, W = e.world, p = this.p, M = this.M;
    const wet = e.wetness ? e.wetness() : 0;
    for (const w of this.wheels) {
      const wx = p.x + M[0] * w.bx + M[2] * w.bz, wz = p.z + M[6] * w.bx + M[8] * w.bz, sf = W.surfaceAt(wx, wz) || DEFAULT_SURF;
      w.surface = sf.type; w.rollRes = sf.rollRes; w.bump = sf.bump || 0; w.dust = sf.dust || 0;
      let g = lerp(sf.grip, sf.wetGrip ?? sf.grip * 0.75, wet);
      if (wet > 0.45 && sf.type === 'asphalt') { const v = Math.abs(this.vLong), crit = 30 + 10 * (w.Fz0 / 6000); g *= 1 - 0.5 * smoothstep(crit - 8, crit + 14, v) * smoothstep(0.45, 1, wet); }
      if (sf.type !== 'asphalt' && sf.type !== 'concrete') g *= this.looseMul;
      w.grip = g;
      w.water = 0; const wl = W.waterLevelAt ? W.waterLevelAt(wx, wz) : -Infinity; if (wl > -1e5) w.water = Math.max(0, wl - W.heightAt(wx, wz)); w.wl = wl;
    }
    this._gh = W.heightAt(p.x, p.z); W.normalAt(p.x, p.z, this._gn);
    // wind: front slice, rear slice, roof
    const wnd = e.storms, h = s.aero.h - s.cgY, L = s.L * 0.28, A = this.windU;
    if (wnd && wnd.windAt) {
      const t = e.time ? e.time() : 0; let sp = 0;
      for (let i = 0; i < 3; i++) {
        const by = i === 2 ? (s.tall || s.H) - s.cgY : h, bz = i === 0 ? -L : i === 1 ? L : 0;
        const x = p.x + M[1] * by + M[2] * bz, y = p.y + M[4] * by + M[5] * bz, z = p.z + M[7] * by + M[8] * bz;
        wnd.windAt(x, y, z, U); const V = Math.hypot(U.x, U.y, U.z); sp += V / 3;
        const g = V > 6 ? 1 + 0.16 * gnoise(t * 0.9 + i * 0.35, i * 0.2 + 7.1) + 0.09 * gnoise(t * 3.1 + i * 0.6, 3.3) : 1;
        // directional turbulence: gusts swing and lift the car in violent wind
        const tb = smoothstep(14, 60, V), sw = tb * (0.3 * gnoise(t * 0.7 + i * 0.5, 11.3) + 0.14 * gnoise(t * 2.3 + i, 5.7)), c = Math.cos(sw), n = Math.sin(sw);
        A[i * 3] = (U.x * c - U.z * n) * g; A[i * 3 + 1] = U.y * g + tb * V * 0.08 * gnoise(t * 1.3 + i * 0.4, 21.9); A[i * 3 + 2] = (U.x * n + U.z * c) * g;
      }
      this.windSpeed = Number.isFinite(sp) ? sp : 0;
      if (!Number.isFinite(sp)) A.fill(0);
    } else { A.fill(0); this.windSpeed = 0; }
    // colliders
    this.colliders.length = 0;
    if (!this.asleep && W.queryColliders) W.queryColliders(p.x, p.z, this.radius + 1.5 + this.v.length() * dt * 1.5, this.colliders);
    // sleep
    if (this.asleep && (this.windSpeed > 20 || this.occupied)) this.wake();
    if (!this.occupied && !this.asleep) {
      if (this.v.lengthSq() < 0.02 && this.w.lengthSq() < 0.02 && this.windSpeed < 18) { this.sleepT += dt; if (this.sleepT > 1.5) { this.asleep = true; this.v.set(0, 0, 0); this.w.set(0, 0, 0); this.sync(); } } else this.sleepT = 0;
    }
    // smoothed local acceleration for cameras / hud
    if (dt > 1e-4 && !this.asleep) {
      const ax = (this.v.x - this._prevV.x) / dt, ay = (this.v.y - this._prevV.y) / dt, az = (this.v.z - this._prevV.z) / dt, k = 1 - Math.exp(-dt * 9);
      this.accLocal.x += (M[0] * ax + M[3] * ay + M[6] * az - this.accLocal.x) * k; this.accLocal.y += (M[1] * ax + M[4] * ay + M[7] * az - this.accLocal.y) * k; this.accLocal.z += (M[2] * ax + M[5] * ay + M[8] * az - this.accLocal.z) * k;
      this._prevV.copy(this.v);
    }
    if (this.occupied && this.engineOn) { const P = Math.abs(this.throttle) * s.power; this.fuel = Math.max(0, this.fuel - dt * (0.00004 + P * 2.6e-7 * (60 / s.fuelCap)) / this.fuelMul); }
    const a = this.anchored ? 1 : 0; this.anchorK += clamp(a - this.anchorK, -dt * 0.55, dt * 0.55);
    this.scrape *= Math.exp(-dt * 6);
  }

  controls(dt) {
    const s = this.spec, I = this.input, v = this.vLong, sp = Math.abs(v);
    const inS = clamp(I.steer || 0, -1, 1), inT = clamp(I.throttle || 0), inB = clamp(I.brake || 0); this.hand = clamp(I.handbrake || 0);
    // direction logic
    let acc = inT, brk = inB;
    if (this.gear > 0) { if (inB > 0.15 && inT < 0.05 && v < 0.7 && !this.anchored) { this.revTimer += dt; if (this.revTimer > 0.12) { this.gear = -1; this.shiftTimer = 0.18; this.revTimer = 0; } } else this.revTimer = 0; }
    else if (inT > 0.1 && v > -0.7) { this.gear = 1; this.shiftTimer = 0.18; }
    if (this.gear < 0) { acc = inB; brk = inT; }
    if (acc < 0.03 && sp < 0.9) brk = Math.max(brk, 0.35); // auto hold
    if (!this.occupied) { acc = 0; brk = Math.max(brk, 0.35); this.hand = Math.max(this.hand, 1); }
    if (this.anchorK > 0.05) { acc = 0; brk = 1; }
    if (this.fuel <= 0 || this.damage >= 1) acc = 0;
    const rt = I.analog ? 14 : 4.2, rb = I.analog ? 16 : 5.5;
    this.throttle += clamp(acc - this.throttle, -dt * 9, dt * rt); this.brake += clamp(brk - this.brake, -dt * 10, dt * rb);
    // steering: lateral-accel limited lock, slower at speed, gentle self-countersteer
    const ayMax = 9.0 * s.tyre.mu * 0.92, aLim = Math.min(s.steerMax, s.wheelbase * ayMax / Math.max(sp * sp, 1) + s.tyre.ap * (I.analog ? 1.15 : 0.95));
    const toward = Math.abs(inS) < 0.01 || inS * this.steer < 0;
    const rate = (I.analog ? 9 : lerp(3.4, 1.9, smoothstep(5, 38, sp))) * (toward ? 2.1 : 1);
    let st = inS; if (!I.analog) st = inS; else st = Math.sign(inS) * Math.pow(Math.abs(inS), 1.35);
    this.steer += clamp(st - this.steer, -dt * rate, dt * rate);
    let d = this.steer * aLim;
    if (sp > 5 && this.contactN >= 2) { const beta = Math.atan2(this.vLat, Math.max(sp, 1)) * (v >= 0 ? 1 : -0.2), ex = Math.sign(beta) * Math.max(0, Math.abs(beta) - 0.05); d += clamp(ex * 0.62, -0.42, 0.42) * smoothstep(5, 11, sp) * (this.hand > 0.5 ? 0.5 : 1); }
    if (this.damage > 0.35) d += (this.damage - 0.35) * 0.035 * Math.sin((this.type.length * 2.1));
    this.steerAngle += clamp(clamp(d, -s.steerMax, s.steerMax) - this.steerAngle, -dt * 5.2, dt * 5.2);
    const dl = this.steerAngle, t = Math.tan(dl), ak = t / s.wheelbase * s.trackF / 2;
    this.wheels[0].steer = Math.atan(t / (1 + ak)); this.wheels[1].steer = Math.atan(t / (1 - ak));
  }
  torqueAt(rpm) { const c = this.spec.engine.curve; if (rpm <= c[0][0]) return c[0][1]; for (let i = 1; i < c.length; i++) if (rpm < c[i][0]) return lerp(c[i - 1][1], c[i][1], (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0])); return c[c.length - 1][1] * 0.5; }
  drivetrain(dt) {
    const s = this.spec, E = s.engine, W = this.wheels, red = E.red / 9.55, idle = E.idle / 9.55;
    const fw = (W[0].omega + W[1].omega) / 2, rw = (W[2].omega + W[3].omega) / 2, sf = s.drive === 'FWD' ? 1 : s.drive === 'RWD' ? 0 : s.split ?? 0.45;
    const drv = sf * fw + (1 - sf) * rw;
    const ratioOf = (g) => (g > 0 ? s.gears[g - 1] : -s.rev) * s.final;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt); this.shiftCool = Math.max(0, this.shiftCool - dt);
    if (this.gear > 0 && this.shiftTimer <= 0 && this.shiftCool <= 0) {
      const rv = Math.max(this.vLong, 0) / s.R * 9.55, th = this.throttle, rpmV = rv * ratioOf(this.gear), rpmW = drv * 9.55 * ratioOf(this.gear);
      const up = lerp(0.36, 0.955, Math.pow(th, 1.3)) * E.red, dn = lerp(0.2, 0.45, th * th) * E.red;
      if (this.gear < s.gears.length && (rpmV > up || (rpmW > E.red * 0.985 && rpmV > up * 0.7)) && this.contactN > 0) { this.gear++; this.shiftTimer = s.shiftT; this.shiftCool = 0.55; }
      else if (this.gear > 1 && rpmV < dn && rv * ratioOf(this.gear - 1) < E.red * (0.6 + 0.32 * th)) { this.gear--; this.shiftTimer = s.shiftT * 0.7; this.shiftCool = 0.3; }
    }
    const ratio = ratioOf(this.gear), tw = drv * ratio; // turbine speed
    let th = this.throttle;
    if (this.engW > red) this.limiter = true; else if (this.engW < red * 0.965) this.limiter = false;
    if (this.limiter) th = 0; th *= clamp((s.topSpeed / 3.6 + 0.6 - this.vLong) / 1.2);
    if (this.shiftTimer > 0) th *= 0.12;
    // traction control
    this.tcActive = false;
    if (this.tc && th > 0.05 && !(this.hand > 0.4)) { let mx = 0; for (const w of W) { if ((w.front ? sf : 1 - sf) < 0.01) continue; if (w.slipLong > mx) mx = w.slipLong; } const lim = s.tyre.kp * (this.contactN && W[2].surface !== 'asphalt' ? 2.9 : 1.75); if (mx > lim && Math.abs(this.vLong) > 0.5) { th *= clamp(1 - (mx - lim) / (lim * 2.2), 0.12, 1); this.tcActive = true; } }
    let Te = 0;
    const rpm = this.engW * 9.55, hp = (1 - 0.6 * smoothstep(0.25, 1, this.damage)) * this.powerMul;
    if (this.engineOn && this.fuel > 0) { Te = th * this.torqueAt(rpm) * hp; const idleT = clamp((idle - this.engW) * E.inertia * 12 + 12, 0, 120 + E.curve[1][1] * 0.3); Te += Math.max(0, 1 - th * 2) * idleT; }
    Te -= (1 - th) * (8 + (0.045 * rpm * E.curve[2][1] / 400) * 0.9) * (rpm > 100 ? 1 : 0);
    // torque converter
    const ws = E.stall / 9.55, Ts = this.torqueAt(E.stall), C = Ts / (ws * ws), we = Math.max(this.engW, 5), sr = clamp(tw / we, -0.5, 2.5);
    let Iwh = 0; for (const w of W) Iwh += (w.front ? sf > 0 : sf < 1) ? w.I : 0;
    const nd = s.drive === 'AWD' ? 4 : 2, cMax = 0.5 / dt / (1 / E.inertia + ratio * ratio / Iwh); // stability limit of the engine<->wheel coupling
    let Tp, Tt; if (sr <= 1) { const s4 = sr > 0 ? sr * sr * sr * sr * sr : 0; Tp = C * we * we * (1 - s4); Tt = Tp * (sr < 0.85 ? 1 + 0.85 * (1 - Math.max(sr, 0) / 0.85) : 1); } else { Tp = -C * we * we * Math.min(1, (sr - 1) * 3); Tt = Tp; }
    if (this.anchorK > 0.05 || this.stalled) { Tp = Tt = 0; }
    for (const w of W) w.Ie = this.locked && (w.front ? sf > 0 : sf < 1) ? w.I + E.inertia * ratio * ratio / nd : w.I;
    // lock-up clutch: engine rigidly coupled, its inertia reflected to the driven wheels
    if (this.locked) { if (tw < idle * 1.25 || this.shiftTimer > 0 || this.anchorK > 0.05) this.locked = false; } else if (sr > 0.72 && sr < 1.2 && tw > idle * 2 && this.shiftTimer <= 0 && this.anchorK < 0.05) this.locked = true;

    const capT = Math.abs(we - tw) * cMax * 1.5; Tp = clamp(Tp, -capT, capT); Tt = clamp(Tt, -capT * 1.2, capT * 1.2);
    if (this.locked) { this.engW += clamp(tw - this.engW, -dt * 700, dt * 700); Tt = Te; } else this.engW += (Te - Tp) / E.inertia * dt;
    this.engW = clamp(this.engW, this.engineOn ? idle * 0.55 : 0, red * 1.06);
    if (this.shiftTimer > 0) { Tt *= 0.35; if (tw > idle) this.engW += (clamp(tw, idle, red) - this.engW) * Math.min(1, dt * 9); }
    const Tax = Tt * ratio * 0.91; this.engLoad = th;
    // axle split + LSD
    const lsd = (a, b, T, K) => { const d = a.omega - b.omega, mx = 40 + K * Math.abs(T) + K * 260, l = clamp(d * a.I * 46, -mx, mx); a.driveT = T / 2 - l; b.driveT = T / 2 + l; };
    let Tf = Tax * sf, Tr = Tax * (1 - sf);
    if (s.drive === 'AWD') { const d = clamp((fw - rw) * W[0].I * 60, -1, 1) * Math.min(Math.abs(fw - rw) * 120, 300 + 0.7 * Math.abs(Tax)); Tf -= d; Tr += d; }
    lsd(W[0], W[1], Tf, s.drive === 'RWD' ? 0 : s.lsd * 0.5); lsd(W[2], W[3], Tr, s.drive === 'FWD' ? 0 : s.lsd);
    if (s.drive === 'RWD') W[0].driveT = W[1].driveT = 0; if (s.drive === 'FWD') W[2].driveT = W[3].driveT = 0;
  }

  step(dt) {
    const s = this.spec, e = this.env, W = e.world, M = this.M, p = this.p, v = this.v, w = this.w, F = this._F, T = this._T, m = s.mass, I = this.input; void I;
    this.vLong = -(v.x * M[2] + v.y * M[5] + v.z * M[8]); this.vLat = v.x * M[0] + v.y * M[3] + v.z * M[6]; this.speed = this.vLong;
    this.controls(dt); this.drivetrain(dt);
    F[0] = 0; F[1] = -m * G; F[2] = 0; T[0] = T[1] = T[2] = 0;
    const ux = M[1], uy = M[4], uz = M[7], t = s.tyre;
    let nC = 0; this.absActive = false;
    // --- suspension ---
    const drop = this.anchorK * Math.max(0, s.cgY * 0.18); // hydraulic lowering
    for (let i = 0; i < 4; i++) {
      const q = this.wheels[i], rx = M[0] * q.bx + M[1] * q.by + M[2] * q.bz, ry = M[3] * q.bx + M[4] * q.by + M[5] * q.bz, rz = M[6] * q.bx + M[7] * q.by + M[8] * q.bz;
      const ax = p.x + rx, ay = p.y + ry, az = p.z + rz, l0 = q.l0 - drop; q.contact = false; q.load = 0; q.fx = q.fy = 0;
      let x = 0;
      if (uy > 0.15) {
        const l = l0 + q.R, gx = ax - ux * (l - q.xs), gz = az - uz * (l - q.xs); let gy = W.heightAt(gx, gz);
        if (q.bump > 0) gy += q.bump * (0.6 * gnoise(gx * 0.55, gz * 0.55, 3) + 0.4 * gnoise(gx * 1.9, gz * 1.9, 5));
        W.normalAt(gx, gz, N); if (!(N.y > 0.05)) N.set(0, 1, 0);
        const dn = -(ux * N.x + uy * N.y + uz * N.z); // d·n, d=-up
        const tt = ((gx - ax) * N.x + (gy - ay) * N.y + (gz - az) * N.z) / Math.min(dn, -0.15);
        x = l - tt;
        if (x > 0) { q.contact = true; q.normal.copy(N); q.pos.set(ax - ux * tt, ay - uy * tt, az - uz * tt); q.gy = gy; nC++; }
      }
      if (!q.contact) { q.x = Math.max(0, q.x - dt * 1.6); q.xv = 0; } else { q.x = Math.min(x, q.xMax + 0.2); }
      q.susp = Math.min(q.x, q.xMax + 0.03) - q.xs; q.compression = clamp(q.x / q.xMax);
    }
    this.contactN = nC;
    for (let i = 0; i < 4; i++) {
      const q = this.wheels[i], o = this.wheels[i ^ 1]; if (!q.contact) { this.spinFree(q, dt); continue; }
      const n = q.normal, cx = q.pos.x - p.x, cy = q.pos.y - p.y, cz = q.pos.z - p.z;
      const vx = v.x + w.y * cz - w.z * cy, vy = v.y + w.z * cx - w.x * cz, vz = v.z + w.x * cy - w.y * cx;
      const cosu = Math.max(0.2, ux * n.x + uy * n.y + uz * n.z), xv = -(vx * n.x + vy * n.y + vz * n.z) / cosu;
      let fs = q.k * Math.min(q.x, q.xMax) + (xv > 0 ? q.cB : q.cR) * xv + (q.front ? s.susp.arbF : s.susp.arbR) * (q.x - o.x);
      if (q.x > q.xMax) fs += q.k * 9 * (q.x - q.xMax) + q.cB * 2.2 * Math.max(0, xv);
      fs = clamp(fs, 0, q.Fz0 * 9); q.load = fs;
      F[0] += n.x * fs; F[1] += n.y * fs; F[2] += n.z * fs; T[0] += cy * n.z * fs - cz * n.y * fs; T[1] += cz * n.x * fs - cx * n.z * fs; T[2] += cx * n.y * fs - cy * n.x * fs;
      // --- tyre ---
      const cs = Math.cos(q.steer), sn = Math.sin(q.steer);
      const axx = M[0] * cs + M[2] * sn, axy = M[3] * cs + M[5] * sn, axz = M[6] * cs + M[8] * sn; // axle (right)
      let fx = n.y * axz - n.z * axy, fy = n.z * axx - n.x * axz, fz = n.x * axy - n.y * axx; const fl = 1 / (Math.hypot(fx, fy, fz) || 1); fx *= fl; fy *= fl; fz *= fl;
      const sx = fy * n.z - fz * n.y, sy = fz * n.x - fx * n.z, sz = fx * n.y - fy * n.x;
      const vl = vx * fx + vy * fy + vz * fz, vs = vx * sx + vy * sy + vz * sz;
      const R = q.R, load = fs / q.Fz0, mu = q.grip * this.gripMul * clamp(1 - t.load * (load - 1), 0.6, 1.25);
      // brakes
      let bt = this.brake * s.brake * (q.front ? s.brakeF : 1 - s.brakeF) * 0.5 * 0.55; if (!q.front) bt += this.hand * s.handbrake * 0.5;
      if (this.abs && q.front + 0 >= 0 && this.brake > 0.05 && Math.abs(vl) > 2.2 && !(this.hand > 0.3 && !q.front)) { const k = -q.slipLong * Math.sign(vl || 1); const lim = t.kp * (q.surface === 'asphalt' ? 1.25 : 2.6); if (k > lim) { q.abs = Math.max(0.05, q.abs - dt * 22); this.absActive = true; } else q.abs = Math.min(1, q.abs + dt * 9); bt *= q.abs; } else q.abs = Math.min(1, q.abs + dt * 12);
      q.brakeT = bt;
      const slx = vl - q.omega * R, spd = Math.abs(vl), soft = q.surface === 'asphalt' ? 1 : 1.5;
      const kp = t.kp * soft, ap = t.ap * (soft > 1 ? 1.3 : 1), sgX = t.sigX, sgY = t.sigY;
      // relaxation (implicit) -> static bristle at rest
      q.ux = (q.ux + slx * dt) / (1 + spd * dt / sgX); q.uy = (q.uy + vs * dt) / (1 + spd * dt / sgY);
      let nx = q.ux / (sgX * kp), ny = q.uy / (sgY * ap), S = Math.hypot(nx, ny);
      const SM = 5; if (S > SM) { const k = SM / S; q.ux *= k; q.uy *= k; nx *= k; ny *= k; S = SM; }
      const slide = q.surface === 'asphalt' ? t.slide : 0.9;
      const D = fs * mu * mfCurve(S, slide, t.off); let FX = 0, FY = 0;
      if (S > 1e-6) { FX = -D * t.mu * nx / S; FY = -D * t.muLat * ny / S; }
      const dampK = Math.min(1, fs / q.Fz0) * 420 * clamp(1 - spd / 4) * clamp(1.5 - S); FX -= slx * dampK; FY -= vs * dampK * 2.2;
      q.slipLong = clamp(-slx / Math.max(spd, 2.2), -3, 6); q.slipLat = Math.atan2(vs, Math.max(spd, 1.5)); q.slip = S; q.slipV = Math.hypot(slx, vs);
      // rolling resistance, soft ground & water drag
      let rr = (q.rollRes || 0.012) * fs * clamp(vl / 0.4, -1, 1) * (1 + spd * 0.012); if (q.water > 0.02) rr += Math.min(q.water, 1) * 900 * R * vl * (0.25 + 0.1 * spd) * 0.25;
      q.fx = FX; q.fy = FY; const fLong = FX - rr;
      const GX = fx * fLong + sx * FY, GY = fy * fLong + sy * FY, GZ = fz * fLong + sz * FY;
      F[0] += GX; F[1] += GY; F[2] += GZ;
      const rc = s.susp.rc, hx = cx + ux * rc, hy = cy + uy * rc, hz = cz + uz * rc;
      T[0] += hy * GZ - hz * GY; T[1] += hz * GX - hx * GZ; T[2] += hx * GY - hy * GX;
      // wheel spin
      let om = q.omega + (q.driveT - FX * R) / q.Ie * dt; const db = bt / q.Ie * dt; om = om > 0 ? Math.max(0, om - db) : Math.min(0, om + db); q.omega = clamp(om, -260, 420); q.spin += q.omega * dt;
    }
    this.airborne = nC === 0; this.airTime = nC === 0 ? this.airTime + dt : 0; this.flipped = this.upY < 0.25;
    if (nC >= 3 && this.tc && this.hand < 0.3) { // mild ESC
      const yr = -(w.x * ux + w.y * uy + w.z * uz), sp = Math.abs(this.vLong); if (sp > 7) { const tgt = this.vLong * Math.tan(this.steerAngle) / (s.wheelbase + 0.0028 * sp * sp * 2), ex = yr - tgt; if (Math.abs(yr) > Math.abs(tgt) + 0.08 || yr * tgt < 0) { const Tq = clamp(ex * this.Iy * 1.5, -m * 3.2, m * 3.2); T[0] += ux * Tq; T[1] += uy * Tq; T[2] += uz * Tq; } }
    }
    this.aero(F, T); this.water(F, T, dt); if (this.anchorK > 0.8 && this.anchored) this.anchorForces(F, T, dt); else if (this.anchors) this.anchors = null;
    // integrate
    v.x += F[0] / m * dt; v.y += F[1] / m * dt; v.z += F[2] / m * dt;
    // angular, body frame with gyroscopic term
    let bx = M[0] * w.x + M[3] * w.y + M[6] * w.z, by = M[1] * w.x + M[4] * w.y + M[7] * w.z, bz = M[2] * w.x + M[5] * w.y + M[8] * w.z;
    const tx = M[0] * T[0] + M[3] * T[1] + M[6] * T[2], ty = M[1] * T[0] + M[4] * T[1] + M[7] * T[2], tz = M[2] * T[0] + M[5] * T[1] + M[8] * T[2];
    const { Ix, Iy, Iz } = this, dx = (tx - (Iz - Iy) * by * bz) / Ix, dy = (ty - (Ix - Iz) * bz * bx) / Iy, dz = (tz - (Iy - Ix) * bx * by) / Iz;
    const ad = Math.exp(-dt * 0.12); bx = (bx + dx * dt) * ad; by = (by + dy * dt) * ad; bz = (bz + dz * dt) * ad;
    w.set(M[0] * bx + M[1] * by + M[2] * bz, M[3] * bx + M[4] * by + M[5] * bz, M[6] * bx + M[7] * by + M[8] * bz);
    this.contacts(dt);
    const vm = v.length(); if (vm > 150) v.multiplyScalar(150 / vm); const wm = w.length(); if (wm > 18) w.multiplyScalar(18 / wm);
    p.addScaledVector(v, dt);
    const q = this.q, hx = w.x * dt * 0.5, hy = w.y * dt * 0.5, hz = w.z * dt * 0.5, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    q.set(qx + hx * qw + hy * qz - hz * qy, qy + hy * qw + hz * qx - hx * qz, qz + hz * qw + hx * qy - hy * qx, qw - hx * qx - hy * qy - hz * qz).normalize();
    if (!Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z + w.x + w.y + w.z + q.x + q.w)) { // never propagate NaN
      p.copy(this.pp); q.copy(this.pq); v.set(0, 0, 0); w.set(0, 0, 0); for (const o of this.wheels) { o.omega = 0; o.ux = o.uy = 0; } if (!Number.isFinite(this.engW)) this.engW = 80; if (!Number.isFinite(this.steer)) this.steer = this.steerAngle = 0; if (!Number.isFinite(this.throttle)) this.throttle = 0; if (!Number.isFinite(this.brake)) this.brake = 0;
    }
    this.updateM();
  }
  spinFree(q, dt) {
    const s = this.spec; let bt = this.brake * s.brake * 0.14 + (q.front ? 0 : this.hand * s.handbrake * 0.5); q.brakeT = bt;
    let om = q.omega + (q.driveT || 0) / q.Ie * dt; om *= 1 - dt * 0.15; const db = bt / q.Ie * dt; om = om > 0 ? Math.max(0, om - db) : Math.min(0, om + db); q.omega = clamp(om, -260, 420); q.spin += q.omega * dt;
    q.ux *= 0.9; q.uy *= 0.9; q.slip = 0; q.slipLong = 0; q.slipLat = 0; q.slipV = 0;
  }
  // wind pressure on body slices: side force (two slices -> yaw moment, gust rocking), roof suction lift on the windward half, updraft on the floor
  aero(F, T) {
    const s = this.spec, a = s.aero, M = this.M, v = this.v, w = this.w, A = this.windU, k = this.anchorK, an = s.anchor;
    const cs = an ? lerp(a.cs, an.cs, k) : a.cs, cl = an ? lerp(a.clRoof, an.cl, k) : a.clRoof, hP = (a.h - s.cgY) * (1 - 0.35 * k);
    const up = this.upY; let side = 0, lift = 0;
    for (let i = 0; i < 2; i++) {
      const bz = (i ? 1 : -1) * s.L * 0.24 + s.cgF * 0, by = hP;
      const rx = M[1] * by + M[2] * bz, ry = M[4] * by + M[5] * bz, rz = M[7] * by + M[8] * bz;
      const wx = (A[i * 3] * 2 + A[6]) / 3 - (v.x + w.y * rz - w.z * ry), wy = (A[i * 3 + 1] * 2 + A[7]) / 3 - (v.y + w.z * rx - w.x * rz), wz = (A[i * 3 + 2] * 2 + A[8]) / 3 - (v.z + w.x * ry - w.y * rx);
      const lx = M[0] * wx + M[3] * wy + M[6] * wz, ly = M[1] * wx + M[4] * wy + M[7] * wz, lz = M[2] * wx + M[5] * wy + M[8] * wz, V = Math.sqrt(lx * lx + ly * ly + lz * lz), q = 0.5 * RHO;
      const fx = q * cs * a.side * 0.5 * lx * Math.sqrt(lx * lx + 0.25 * lz * lz);
      const fz = q * (a.cd * a.front * 0.5 * lz * Math.abs(lz) + 0.12 * a.front * lz * Math.abs(lx));
      const bot = (an ? 1 - 0.95 * k : 1) * a.top; let fy = q * 0.5 * bot * (this.airborne ? 2.1 : 1.5) * ly * Math.abs(ly);
      const lf = q * a.top * 0.5 * cl * (lx * lx + (Math.abs(lz) > 40 ? 0.13 + 0.25 * smoothstep(45, 85, Math.abs(lz)) : 0.13) * lz * lz) * clamp(up * 1.5, -0.3, 1) * (V > 0 ? 1 : 0) * (1 + 0.25 * smoothstep(20, 60, Math.abs(lx)) * (i ? 0.9 : 1.1)); fy += lf;
      if (an && k > 0) fy -= q * a.top * 0.5 * 0.22 * k * (lx * lx + lz * lz); // skirt deflector downforce
      const ox = -Math.sign(lx) * s.W * 0.17 * smoothstep(8, 40, Math.abs(lx)); // suction peak on windward roof edge
      const Fx = M[0] * fx + M[1] * fy + M[2] * fz, Fy = M[3] * fx + M[4] * fy + M[5] * fz, Fz = M[6] * fx + M[7] * fy + M[8] * fz;
      const px = rx + M[0] * ox, py = ry + M[3] * ox, pz = rz + M[6] * ox;
      F[0] += Fx; F[1] += Fy; F[2] += Fz; T[0] += py * Fz - pz * Fy; T[1] += pz * Fx - px * Fz; T[2] += px * Fy - py * Fx;
      side += Math.hypot(fx, fz * (Math.abs(lz) > Math.abs(this.vLong) + 3 ? 1 : 0)); lift += fy;
    }
    // wake / tumbling angular drag
    const wl = this.w; const ka = 0.5 * RHO * a.side * s.L * s.L * 0.02 * wl.length(); T[0] -= wl.x * ka; T[1] -= wl.y * ka; T[2] -= wl.z * ka;
    const W0 = s.mass * G, hold = an ? k * an.hold * this.holdMul : 0, cap = Math.max(0.15 * W0, 0.8 * (W0 + hold - Math.max(0, lift))), roll = (side * (a.h * (1 - 0.35 * k)) + Math.max(0, lift) * s.W * 0.67) / ((W0 + hold) * s.trackF * 0.5);
    const wlT = Math.max(side / cap, roll); this.windLoad += (wlT - this.windLoad) * 0.02; this.windSide = side; this.windLift = lift;
  }
  water(F, T, dt) {
    const s = this.spec, p = this.p; let wl = -Infinity; for (const q of this.wheels) if (q.wl > wl) wl = q.wl; this.waterDepth = 0; if (!(wl > -1e5)) return;
    const bottom = p.y - s.cgY + s.R * 0.6, d = wl - bottom; if (d <= 0) return; this.waterDepth = d;
    const sub = clamp(d / s.H), v = this.v, B = sub * s.L * s.W * s.H * 0.42 * 1000 * G * 0.75, m = s.mass; F[1] += Math.min(B, m * G * 1.06);
    const k = sub * m * 0.9 + sub * 450 * Math.hypot(v.x, v.z) * 0.6; F[0] -= v.x * k; F[2] -= v.z * k; F[1] -= v.y * sub * m * 2.2;
    const w = this.w, kr = sub * m * 2.4; T[0] -= w.x * kr; T[1] -= w.y * kr; T[2] -= w.z * kr;
    const rt = sub * m * G * 0.5; T[0] += this.M[7] * rt * 1; T[2] += -this.M[1] * rt; // self-righting
    if (d > s.H * 0.55) { this.addDamage(dt * 0.12); if (d > s.H * 0.7) this.engineOn = false; }
  }
  anchorForces(F, T) {
    const s = this.spec, M = this.M, p = this.p, v = this.v, w = this.w, hx = s.W * 0.42, hz = s.L * 0.36;
    if (!this.anchors) { this.anchors = []; for (let i = 0; i < 4; i++) { const bx = (i % 2 ? 1 : -1) * hx, bz = (i < 2 ? -1 : 1) * hz, by = -s.cgY; this.anchors.push({ bx, by, bz, x: p.x + M[0] * bx + M[1] * by + M[2] * bz, y: p.y + M[3] * bx + M[4] * by + M[5] * bz, z: p.z + M[6] * bx + M[7] * by + M[8] * bz }); } this.anchorSum = 0; }
    const K = s.mass * 55, C = s.mass * 5.5; let mx = 0;
    for (const a of this.anchors) {
      const rx = M[0] * a.bx + M[1] * a.by + M[2] * a.bz, ry = M[3] * a.bx + M[4] * a.by + M[5] * a.bz, rz = M[6] * a.bx + M[7] * a.by + M[8] * a.bz;
      let fx = -K * (p.x + rx - a.x) - C * (v.x + w.y * rz - w.z * ry), fy = -K * (p.y + ry - a.y) - C * (v.y + w.z * rx - w.x * rz), fz = -K * (p.z + rz - a.z) - C * (v.z + w.x * ry - w.y * rx);
      if (fy > 0) fy *= 0.15; const f = Math.hypot(fx, fy, fz); mx = Math.max(mx, f);
      F[0] += fx; F[1] += fy; F[2] += fz; T[0] += ry * fz - rz * fy; T[1] += rz * fx - rx * fz; T[2] += rx * fy - ry * fx;
    }
    this.anchorStress = mx / (s.anchor.hold * this.holdMul / 2); if (this.anchorStress > 1) { this.anchored = false; this.anchors = null; this.anchorBroke = true; }
  }
  invK(rx, ry, rz, nx, ny, nz) {
    const I = this.Iw, cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx, ax = I[0] * cx + I[1] * cy + I[2] * cz, ay = I[3] * cx + I[4] * cy + I[5] * cz, az = I[6] * cx + I[7] * cy + I[8] * cz;
    return 1 / this.spec.mass + nx * (ay * rz - az * ry) + ny * (az * rx - ax * rz) + nz * (ax * ry - ay * rx);
  }
  // resolve one contact (r rel. to cg). mInv/oth velocity for the other side. returns normal impulse
  resolve(rx, ry, rz, nx, ny, nz, pen, e, mu, dt, oInv = 0, ox = 0, oy = 0, oz = 0) {
    const v = this.v, w = this.w; let vx = v.x + w.y * rz - w.z * ry - ox, vy = v.y + w.z * rx - w.x * rz - oy, vz = v.z + w.x * ry - w.y * rx - oz;
    const vn = vx * nx + vy * ny + vz * nz, bias = Math.min(3, Math.max(0, pen - 0.012) * 9);
    if (vn > bias) return 0;
    const j = Math.max(0, (-(1 + (vn < -1.2 ? e : 0)) * vn + bias) / (this.invK(rx, ry, rz, nx, ny, nz) + oInv)); if (!(j > 0)) return 0;
    let tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz; const tl = Math.hypot(tx, ty, tz); let jt = 0;
    if (tl > 1e-3) { tx /= tl; ty /= tl; tz /= tl; jt = Math.min(mu * j, tl / (this.invK(rx, ry, rz, tx, ty, tz) + oInv)); }
    const jx = nx * j - tx * jt, jy = ny * j - ty * jt, jz = nz * j - tz * jt, px = this.p.x + rx, py = this.p.y + ry, pz = this.p.z + rz;
    this.addImpulse(jx, jy, jz, px, py, pz); this._vn = -vn; this._jx = jx; this._jy = jy; this._jz = jz; this._tl = tl; return j;
  }
  contacts(dt) {
    const W = this.env.world, M = this.M, p = this.p, s = this.spec, gn = this._gn, gh = this._gh;
    const near = this.upY < 0.9 || this.contactN < 4 || Math.abs(this.v.y) > 2 || gn.y < 0.96 || Math.abs(this.speed) > 8;
    if (near) for (let i = 0; i < this.hull.length; i++) {
      const h = this.hull[i], rx = M[0] * h.x + M[1] * h.y + M[2] * h.z, ry = M[3] * h.x + M[4] * h.y + M[5] * h.z, rz = M[6] * h.x + M[7] * h.y + M[8] * h.z;
      const x = p.x + rx, y = p.y + ry, z = p.z + rz; if (y - gh + (rx * gn.x + rz * gn.z) / Math.max(gn.y, 0.3) > 1.4) continue;
      const gy = W.heightAt(x, z); const pen = gy - y; if (pen <= 0) continue;
      W.normalAt(x, z, N); if (!(N.y > 0.05)) N.set(0, 1, 0); const soft = this.upY > 0.6 ? 0.32 : 0.62;
      const j = this.resolve(rx, ry, rz, N.x, N.y, N.z, pen * N.y, 0.12, soft, dt);
      if (j > 0) { this.scrape = Math.max(this.scrape, clamp(this._tl / 20)); if (this._vn > 2.2) this.impact(this._vn * (this.upY < 0.3 ? 1 : 0.85), x, gy, z, N.x, N.y, N.z, 'ground'); }
    }
    // static colliders
    const b = this.box;
    for (let c = 0; c < this.colliders.length; c++) {
      const k = this.colliders[c]; if (k.broken) continue;
      if (k.shape === 'cyl') this.hitCyl(k, k.x, k.z, k.r, k.y, k.y + (k.h || 4), dt);
      else {
        const cs = Math.cos(k.rotY || 0), sn = Math.sin(k.rotY || 0), yb = k.y - (k.hy ?? (k.h || 4) / 2), yt = k.y + (k.hy ?? (k.h || 4) / 2);
        for (let i = 0; i < this.hull.length; i++) {
          const h = this.hull[i], rx = M[0] * h.x + M[1] * h.y + M[2] * h.z, ry = M[3] * h.x + M[4] * h.y + M[5] * h.z, rz = M[6] * h.x + M[7] * h.y + M[8] * h.z;
          const X = p.x + rx - k.x, Y = p.y + ry, Z = p.z + rz - k.z; if (Y < yb || Y > yt) continue;
          const lx = X * cs - Z * sn, lz = X * sn + Z * cs, dx = k.hx - Math.abs(lx), dz = k.hz - Math.abs(lz), dy = yt - Y; if (dx <= 0 || dz <= 0) continue;
          let nx, ny = 0, nz, pen; if (dy < dx && dy < dz && dy < 0.5) { nx = nz = 0; ny = 1; pen = dy; } else if (dx < dz) { const g = Math.sign(lx) || 1; nx = cs * g; nz = -sn * g; pen = dx; } else { const g = Math.sign(lz) || 1; nx = sn * g; nz = cs * g; pen = dz; }
          if (this.hitSolid(k, rx, ry, rz, nx, ny, nz, pen, dt)) break;
        }
        if (!k.broken) for (let i = 0; i < 4; i++) { const ex = (i & 1 ? 1 : -1) * k.hx, ez = (i & 2 ? 1 : -1) * k.hz; this.hitCyl(k, k.x + ex * cs + ez * sn, k.z - ex * sn + ez * cs, 0.03, yb, yt, dt); if (k.broken) break; }
      }
    }
    void s; void b;
  }
  // vertical cylinder vs body OBB (sampled along its height)
  hitCyl(k, cx, cz, r, y0, y1, dt) {
    const p = this.p, M = this.M, b = this.box, X = cx - p.x, Z = cz - p.z; if (X * X + Z * Z > (this.radius + r + 0.5) ** 2) return;
    let best = 1e9, bx = 0, by = 0, bz = 0, nx = 0, ny = 0, nz = 0; const lo = Math.max(y0, p.y - this.radius), hi = Math.min(y1, p.y + this.radius); if (hi < lo) return;
    for (let i = 0; i < 4; i++) {
      const Y = lerp(lo, hi, clamp(i === 0 ? (p.y - lo) / Math.max(hi - lo, 0.01) : (i - 1) / 2)) - p.y;
      const lx = M[0] * X + M[3] * Y + M[6] * Z, ly = M[1] * X + M[4] * Y + M[7] * Z - b.cy, lz = M[2] * X + M[5] * Y + M[8] * Z - b.cz;
      const qx = clamp(lx, -b.hx, b.hx), qy = clamp(ly, -b.hy, b.hy), qz = clamp(lz, -b.hz, b.hz); let dx = lx - qx, dy = ly - qy, dz = lz - qz, d = Math.hypot(dx, dy, dz), ox = qx, oz = qz;
      if (d < 1e-5) { const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz); if (px < pz) { dx = Math.sign(lx) || 1; dz = 0; d = -px; ox = dx * b.hx; } else { dz = Math.sign(lz) || 1; dx = 0; d = -pz; oz = dz * b.hz; } dy = 0; } else { dx /= d; dy /= d; dz /= d; }
      if (d < best) { best = d; bx = ox; by = qy + b.cy; bz = oz + b.cz; nx = -dx; ny = -dy; nz = -dz; }
    }
    const pen = r - best; if (pen <= 0) return;
    const wx = M[0] * nx + M[1] * ny + M[2] * nz, wy = M[3] * nx + M[4] * ny + M[5] * nz, wz = M[6] * nx + M[7] * ny + M[8] * nz;
    this.hitSolid(k, M[0] * bx + M[1] * by + M[2] * bz, M[3] * bx + M[4] * by + M[5] * bz, M[6] * bx + M[7] * by + M[8] * bz, wx, wy * 0.2, wz, pen, dt);
  }
  hitSolid(k, rx, ry, rz, nx, ny, nz, pen, dt) {
    const v = this.v, w = this.w, vn = (v.x + w.y * rz - w.z * ry) * nx + (v.y + w.z * rx - w.x * rz) * ny + (v.z + w.x * ry - w.y * rx) * nz, W = this.env.world, x = this.p.x + rx, y = this.p.y + ry, z = this.p.z + rz;
    if (k.breakSpeed > 0 && k.breakSpeed < 1e4 && -vn > k.breakSpeed && !k.broken) {
      const mc = Math.max(5, k.mass || 60), J = Math.min(-vn * 0.85, -vn) / (this.invK(rx, ry, rz, nx, ny, nz) + 1 / mc); k.broken = true; // local guard until world marks it
      const vv = -vn; this.addImpulse(nx * J, ny * J * 0.3, nz * J, x, y, z); U.set(-nx * J, Math.abs(J) * 0.25, -nz * J); W.hitCollider?.(k.id, U); try { this.env.fx?.spark?.(U.set(x, y, z), 16); } catch { /* optional */ } this.impact(Math.min(vv, J / this.spec.mass * 1.6), x, y, z, nx, ny, nz, k.kind || 'break'); return true;
    }
    const j = this.resolve(rx, ry, rz, nx, ny, nz, pen, 0.18, 0.35, dt); if (j > 0 && this._vn > 1.2) this.impact(this._vn, x, y, z, nx, ny, nz, k.kind || 'solid');
    return false;
  }
  impact(sp, x, y, z, nx, ny, nz, kind) {
    const d = Math.max(0, sp - 3.2) / 26; const dm = this.addDamage(Math.pow(d, 1.35) * 0.75); if (sp > 1.4 && this.onImpact) this.onImpact(sp, x, y, z, nx, ny, nz, kind, dm);
  }
}

// hull-point vs OBB between two dynamic bodies (or b kinematic: {p,q,v,M,box,radius,kinematic})
export function collidePair(a, b, dt) {
  const dx = a.p.x - b.p.x, dz = a.p.z - b.p.z, dy = a.p.y - b.p.y, R = a.radius + b.radius; if (dx * dx + dz * dz + dy * dy > R * R) return;
  pass(a, b, dt); if (b.hull && !b.kinematic) pass(b, a, dt); else if (b.hull) pass2(a, b, dt);
}
function pass(a, b, dt) { // hull of a inside box of b
  const M = a.M, B = b.M, bx = b.box;
  for (let i = 0; i < a.hull.length; i++) {
    const h = a.hull[i], rx = M[0] * h.x + M[1] * h.y + M[2] * h.z, ry = M[3] * h.x + M[4] * h.y + M[5] * h.z, rz = M[6] * h.x + M[7] * h.y + M[8] * h.z;
    const X = a.p.x + rx - b.p.x, Y = a.p.y + ry - b.p.y, Z = a.p.z + rz - b.p.z, lx = B[0] * X + B[3] * Y + B[6] * Z, ly = B[1] * X + B[4] * Y + B[7] * Z - bx.cy, lz = B[2] * X + B[5] * Y + B[8] * Z - bx.cz;
    const px = bx.hx - Math.abs(lx), py = bx.hy - Math.abs(ly), pz = bx.hz - Math.abs(lz); if (px <= 0 || py <= 0 || pz <= 0) continue;
    let nx = 0, ny = 0, nz = 0, pen; if (px < pz && px < py * 1.5) { nx = Math.sign(lx) || 1; pen = px; } else if (pz < py * 1.5) { nz = Math.sign(lz) || 1; pen = pz; } else { ny = Math.sign(ly) || 1; pen = py; }
    const wx = B[0] * nx + B[1] * ny + B[2] * nz, wy = B[3] * nx + B[4] * ny + B[5] * nz, wz = B[6] * nx + B[7] * ny + B[8] * nz;
    const qx = X, qy = Y, qz = Z, bw = b.w || ZERO; const oi = b.kinematic ? 0 : b.invK(qx, qy, qz, wx, wy, wz); if (b.asleep) b.wake();
    const j = a.resolve(rx, ry, rz, wx, wy, wz, Math.min(pen, 0.15), 0.15, 0.3, dt, oi, b.v.x + bw.y * qz - bw.z * qy, b.v.y + bw.z * qx - bw.x * qz, b.v.z + bw.x * qy - bw.y * qx);
    if (j > 0) { const s = a._vn, x = a.p.x + rx, y = a.p.y + ry, z = a.p.z + rz; if (!b.kinematic) { b.addImpulse(-a._jx, -a._jy, -a._jz, x, y, z); if (s > 1.5) b.impact(s * 0.6, x, y, z, -wx, -wy, -wz, 'vehicle'); } if (s > 1.5) a.impact(s * 0.6, x, y, z, wx, wy, wz, 'vehicle'); }
  }
}
function pass2(a, b, dt) { // hull of kinematic b inside box of a
  const M = b.M, B = a.M, bx = a.box;
  for (let i = 0; i < b.hull.length; i++) {
    const h = b.hull[i], X = b.p.x + M[0] * h.x + M[1] * h.y + M[2] * h.z - a.p.x, Y = b.p.y + M[3] * h.x + M[4] * h.y + M[5] * h.z - a.p.y, Z = b.p.z + M[6] * h.x + M[7] * h.y + M[8] * h.z - a.p.z;
    const lx = B[0] * X + B[3] * Y + B[6] * Z, ly = B[1] * X + B[4] * Y + B[7] * Z - bx.cy, lz = B[2] * X + B[5] * Y + B[8] * Z - bx.cz, px = bx.hx - Math.abs(lx), py = bx.hy - Math.abs(ly), pz = bx.hz - Math.abs(lz); if (px <= 0 || py <= 0 || pz <= 0) continue;
    let nx = 0, nz = 0, pen; if (px < pz) { nx = -(Math.sign(lx) || 1); pen = px; } else { nz = -(Math.sign(lz) || 1); pen = pz; }
    const wx = B[0] * nx + B[2] * nz, wy = B[3] * nx + B[5] * nz, wz = B[6] * nx + B[8] * nz;
    if (a.resolve(X, Y, Z, wx, wy, wz, Math.min(pen, 0.15), 0.15, 0.3, dt, 0, b.v.x, b.v.y, b.v.z) > 0 && a._vn > 1.5) a.impact(a._vn * 0.6, a.p.x + X, a.p.y + Y, a.p.z + Z, wx, wy, wz, 'vehicle');
  }
}
const ZERO = new Vector3();

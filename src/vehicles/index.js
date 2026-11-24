// VEHICLE system: spawning, simulation, driving input, visuals, damage, fx hooks, network state.
import * as THREE from 'three';
import { SPECS, TYPES, TYPE_IDS } from './specs.js';
import { VehicleBody, collidePair } from './physics.js';
import { VehicleVisual, getModel } from './visual.js';
import { clamp, damp, lerp, dirToHeading } from '../core/math.js';

const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion(), WIND = new THREE.Vector3();
let nextId = 1;

export class Vehicle {
  constructor(sys, type, x, z, heading) {
    this.sys = sys; this.id = 'v' + nextId++; this.type = type; this.spec = SPECS[type]; const ctx = sys.ctx;
    this.body = new VehicleBody(type, sys.env); this.body.place(x, z, heading);
    this.visual = new VehicleVisual(type, { fxScene: ctx.fxScene }); this.object3d = this.visual.object3d; this.mounts = this.visual.mounts; this.object3d.userData.vehicle = this;
    ctx.scene?.add(this.object3d);
    this.pos = this.object3d.position; this.quat = this.object3d.quaternion; this.vel = this.body.v; this.angVel = this.body.w; this.headlights = false; this.dirt = 0.12; this.wet = 0; this.horn = false; this.beacon = false; this.lightBar = false; this.swept = false; this.destroyed = false; this.sweptT = 0;
    this.body.onImpact = (sp, x, y, z, nx, ny, nz, kind, dm) => this.onImpact(sp, x, y, z, nx, ny, nz, kind, dm); this.sync(0);
  }
  get speed() { return this.body.vLong; } get rpm() { return this.body.rpm; } get gear() { return this.body.gear; } get throttle() { return this.body.throttle; } get brake() { return this.body.brake; } get steer() { return this.body.steerAngle; } get steerInput() { return this.body.steer; }
  get wheels() { return this.body.wheels; } get damage() { return this.body.damage; } set damage(d) { this.body.damage = clamp(d); } get fuel() { return this.body.fuel; } set fuel(f) { this.body.fuel = clamp(f); }
  get anchored() { return this.body.anchored; } get anchorLevel() { return this.body.anchorK; } get flipped() { return this.body.flipped; } get airborne() { return this.body.airborne; } get windLoad() { return this.body.windLoad; } get windSpeed() { return this.body.windSpeed; }
  get engineLoad() { return this.body.engLoad || 0; } get limiter() { return this.body.limiter; } get absActive() { return this.body.absActive; } get tcActive() { return this.body.tcActive; } get scrape() { return this.body.scrape; } get waterDepth() { return this.body.waterDepth; } get height() { return this.spec.tall || this.spec.H; }
  get slip() { let s = 0; for (const w of this.body.wheels) if (w.contact) s = Math.max(s, w.slipV || 0); return s; }
  setInput(o) { Object.assign(this.body.input, o); }
  anchor(on = !this.body.anchored) { const ok = this.body.setAnchored(on); if (ok) this.sys.ctx.events.emit('vehicle:anchor', { v: this, on }); return ok; }
  sync(dt) {
    const b = this.body, o = this.object3d; o.position.copy(b.rp); o.quaternion.copy(b.rq); o.updateMatrixWorld();
    const sp = new Array(4), su = new Array(4); for (let i = 0; i < 4; i++) { sp[i] = b.wheels[i].rSpin; su[i] = b.wheels[i].rSusp; }
    this.visual.setState({ steer: b.steerAngle, wheelSpin: sp, susp: su, brake: b.brake > 0.05 && b.occupied ? b.brake : 0, lights: this.headlights, throttle: b.throttle, reverse: b.gear < 0, anchored: b.anchored, damage: b.damage, dirt: this.dirt, wet: this.wet, hazard: this.destroyed || b.flipped });
    this.visual.state.bar = this.lightBar; this.visual.state.beacon = this.beacon; void dt;
  }
  onImpact(sp, x, y, z, nx, ny, nz, kind, dm) {
    const ctx = this.sys.ctx; V.set(x, y, z); this.sys.ctx.events.emit('vehicle:impact', { v: this, speed: sp, pos: V.clone(), normal: new THREE.Vector3(nx, ny, nz), kind, damage: dm });
    if (sp > 4) { V2.set(x, y, z); this.object3d.worldToLocal(V2); this.visual.addDent(V2.x, V2.y, V2.z, Math.min(0.14, (sp - 3) * 0.006)); }
    if (sp > 13 && Math.random() < 0.5) { V2.set(x, y, z); this.object3d.worldToLocal(V2); V2.y = Math.max(V2.y, this.spec.H * 0.45); this.visual.addCrack(V2.x * 0.6, V2.y, V2.z * 0.5, clamp(sp / 40, 0.2, 0.8)); }
    if (sp > 6 && kind !== 'ground') try { ctx.fx?.spark?.(V.set(x, y, z), Math.min(40, sp * 2) | 0); } catch { /* fx optional */ }
    if (this.body.damage >= 1 && !this.destroyed) { this.destroyed = true; ctx.events.emit('vehicle:destroyed', { v: this }); }
  }
  repair() { this.body.damage = 0; this.destroyed = false; this.body.engineOn = true; this.visual.repair(); this.dirt = 0.05; }
  dispose() { this.object3d.removeFromParent(); this.visual.dispose(); }
}

export async function create(ctx) {
  const sys = {
    ctx, types: TYPES, typeIds: TYPE_IDS, list: [], active: null, remotes: new Set(), tc: true, abs: true,
    env: {
      get world() { return ctx.world; }, get storms() { return ctx.storms; }, get fx() { return ctx.fx; },
      wetness: () => clamp(ctx.globals?.uWetness?.value ?? 0), time: () => ctx.time.now,
    },
    spawn(type, x, z, heading = 0) { if (!SPECS[type]) type = TYPE_IDS[0]; const v = new Vehicle(sys, type, x, z, heading); sys.list.push(v); ctx.events.emit('vehicle:spawn', { v }); return v; },
    remove(v) { const i = sys.list.indexOf(v); if (i >= 0) sys.list.splice(i, 1); if (sys.active === v) sys.active = null; v.dispose(); },
    clear() { for (const v of [...sys.list]) sys.remove(v); },
    // profile upgrades -> physics multipliers (see gameplay/profile.js VEHICLE_UPGRADES.mod)
    setMods(v, m = {}) { const b = v?.body; if (!b) return; v.mods = m; b.powerMul = m.power ?? 1; b.gripMul = m.grip ?? 1; b.looseMul = (m.looseGrip ?? 1) / (m.grip ?? 1); b.armorMul = m.armor ?? 1; b.massMul = m.mass ?? 1; b.fuelMul = m.fuel ?? 1; b.holdMul = m.anchor ?? 1; },
    repair(v) { v.repair(); }, refuel(v) { v.fuel = 1; v.body.engineOn = true; },
    recover(v) {
      const w = ctx.world, b = v.body, r = w.roads?.nearest?.(b.p.x, b.p.z); let x = b.p.x, z = b.p.z, h = dirToHeading(-b.M[2], -b.M[8]);
      if (r && r.dist < 2000) { const side = r.width ? r.width * 0.25 : 2, hd = dirToHeading(r.dirX, r.dirZ); h = Math.abs(((hd - h + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < Math.PI / 2 ? hd : hd + Math.PI; const fx = Math.sin(h), fz = -Math.cos(h); x = r.x - fz * side; z = r.z + fx * side; } // right-hand lane
      b.place(x, z, h); v.swept = false; v.sweptT = 0; ctx.events.emit('vehicle:recover', { v });
    },
    createVisual(typeId, opts = {}) { const vis = new VehicleVisual(SPECS[typeId] ? typeId : TYPE_IDS[0], { remote: true, fxScene: ctx.fxScene, color: opts.color }); const k = { visual: vis, object3d: vis.object3d, p: vis.object3d.position, q: vis.object3d.quaternion, v: new THREE.Vector3(), M: new Float64Array(9), box: null, kinematic: true, prev: new THREE.Vector3(), t: -1, radius: 3 };
      const tmp = new VehicleBody(vis.type, sys.env); k.hull = tmp.hull; k.box = tmp.box; k.radius = tmp.radius; sys.remotes.add(k);
      return { object3d: vis.object3d, visual: vis, setState: (s) => vis.setState(s), update: (dt) => vis.update(dt, sys.visEnv(vis, k.v)), dispose: () => { sys.remotes.delete(k); vis.dispose(); }, _k: k };
    },
    // compact network state
    serializeState(v, out = []) {
      const b = v.body; out.length = 0; out.push(TYPE_IDS.indexOf(v.type), r3(b.p.x), r3(b.p.y), r3(b.p.z), r4(b.q.x), r4(b.q.y), r4(b.q.z), r4(b.q.w), r2(b.v.x), r2(b.v.y), r2(b.v.z), r3(b.steerAngle));
      for (const w of b.wheels) out.push(r3(((w.spin % 6.2832) + 6.2832) % 6.2832)); for (const w of b.wheels) out.push(r3(w.susp));
      out.push((v.headlights ? 1 : 0) | (b.brake > 0.05 ? 2 : 0) | (b.gear < 0 ? 4 : 0) | (b.anchored ? 8 : 0) | (v.beacon ? 16 : 0) | (v.lightBar ? 32 : 0) | (v.horn ? 64 : 0), r2(b.damage), r2(b.throttle), Math.round(b.rpm), r2(v.dirt)); return out;
    },
    applyState(vis, a) {
      if (!vis || !a || a.length < 25) return; const o = vis.object3d, V0 = vis.visual || vis; o.position.set(a[1], a[2], a[3]); o.quaternion.set(a[4], a[5], a[6], a[7]).normalize(); if (vis._k) vis._k.v.set(a[8], a[9], a[10]);
      const f = a[20]; V0.setState({ steer: a[11], wheelSpin: [a[12], a[13], a[14], a[15]], susp: [a[16], a[17], a[18], a[19]], lights: !!(f & 1), brake: f & 2 ? 1 : 0, reverse: !!(f & 4), anchored: !!(f & 8), damage: a[21], throttle: a[22], dirt: a[24] }); V0.state.beacon = !!(f & 16); V0.state.bar = !!(f & 32); V0.rpm = a[23]; V0.horn = !!(f & 64);
    },
    visEnv(vis, vel) { const cam = ctx.camera.position, o = vis.object3d.position; ctx.storms?.windAt?.(o.x, o.y + 1.5, o.z, WIND); const wx = ctx.globals?.uRain?.value ?? 0; return { cam, night: sys.night(), rain: wx, windX: WIND.x, windZ: WIND.z, vel, dust: 0 }; },
    night() { const h = ctx.time.hour ?? 12; const d = h < 6 || h > 20 ? 1 : h < 7.5 ? (7.5 - h) / 1.5 : h > 18.5 ? (h - 18.5) / 1.5 : 0; return clamp(Math.max(d, (ctx.globals?.uStormDark?.value ?? 0) * 0.7)); },
    preload() { for (const t of TYPE_IDS) getModel(t); },
    update(dt) {
      const I = ctx.input, act = sys.active, pl = ctx.player;
      for (const v of sys.list) { v.body.abs = sys.abs; v.body.tc = sys.tc; v.body.occupied = v === act && pl?.mode === 'drive'; }
      if (act && pl?.mode === 'drive' && !I.uiBlock && ctx.state === 'playing') {
        const analog = I.steerIsAnalog?.() || false; act.setInput({ steer: I.axis('steer'), throttle: I.axis('throttle'), brake: I.axis('brake'), handbrake: I.down('handbrake') ? 1 : 0, analog });
        if (I.pressed('lights')) act.headlights = !act.headlights; if (I.pressed('anchor')) { if (!act.anchor() && act.spec.anchor) ctx.ui?.notify?.({ title: 'Anchor', text: 'Stop the vehicle on level ground first', kind: 'warn', ttl: 2.5 }); }
        if (I.pressed('recover') && (act.body.flipped || Math.abs(act.speed) < 3)) sys.recover(act); act.horn = I.down('horn');
      } else if (act) act.setInput({ steer: 0, throttle: 0, brake: 0, handbrake: 0 });
      // simulate
      for (const v of sys.list) v.body.update(dt);
      // vehicle-vehicle + remote kinematic contacts (post-step correction)
      const L = sys.list; for (let i = 0; i < L.length; i++) { const a = L[i]; if (a.body.asleep && !L.some((b) => b !== a && !b.body.asleep)) continue; for (let j = i + 1; j < L.length; j++) collidePair(a.body, L[j].body, dt); for (const k of sys.remotes) { k.object3d.updateMatrixWorld(); const m = k.object3d.matrixWorld.elements; k.M.set([m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]); collidePair(a.body, k, dt); } }
      const cam = ctx.camera.position, night = sys.night(), wet = clamp(ctx.globals?.uWetness?.value ?? 0);
      for (const v of sys.list) {
        const b = v.body; v.sync(dt);
        // dirt / wetness / fx
        let dust = 0, mud = 0; const sp = b.v.length(); for (const w of b.wheels) if (w.contact) { dust += (w.dust || 0) / 4; if (w.surface === 'mud' || w.surface === 'dirt' || w.surface === 'field') mud += 0.25; }
        v.dirt = clamp(v.dirt + dt * (sp * 0.00025 * (dust + mud * 3 + wet * mud * 4)) - dt * wet * 0.002); v.wet = damp(v.wet, wet, 0.5, dt);
        if (ctx.fx?.spawnWheel && sp > 1 && cam.distanceToSquared(b.p) < 160 * 160) for (const w of b.wheels) { if (!w.contact) continue; const amt = clamp((w.slipV || 0) / 6) + (w.dust || 0) * clamp(sp / 25) * 0.6 + (w.water > 0.02 || wet > 0.4 ? clamp(sp / 20) * 0.5 : 0); if (amt > 0.08) { w._fx = (w._fx || 0) + amt * dt * 20; if (w._fx > 1) { w._fx = 0; try { ctx.fx.spawnWheel(w.pos, b.v, w.surface, amt); } catch { /* fx optional */ } } } }
        // swept detection: lofted by the wind itself
        const gh = ctx.world.heightAt(b.p.x, b.p.z), agl = b.p.y - gh;
        if (!v.swept && b.windSpeed > 38 && agl > 1.6 && b.airTime > 0.35) { v.swept = true; v.sweptT = 0; ctx.events.emit('vehicle:swept', { v }); }
        if (v.swept) { v.sweptT += dt; if (b.contactN > 0 && b.v.length() < 2 && v.sweptT > 2) { v.swept = false; ctx.events.emit('vehicle:landed', { v }); } }
        // lod + visual update
        const d = cam.distanceTo(v.object3d.position); v.visual.setLod(d > 45 ? 1 : 0); v.object3d.visible = d < 2500;
        v.visual.update(dt, { cam, night, rain: ctx.globals?.uRain?.value ?? 0, windX: b.windU[6], windZ: b.windU[8], vel: b.v, dust: 0, wiper: v === act ? Math.max(wet > 0.05 ? wet : 0, ctx.globals?.uRain?.value ?? 0) : 0 });
        if (b.anchorBroke) { b.anchorBroke = false; ctx.events.emit('vehicle:anchor-break', { v }); ctx.ui?.notify?.({ title: 'Anchors torn out', text: 'Wind load exceeded the hydraulic hold', kind: 'bad', ttl: 4 }); }
      }
      for (const k of sys.remotes) { const vis = k.visual; if (k.t >= 0 && dt > 0 && k.v.lengthSq() === 0) k.v.copy(k.p).sub(k.prev).multiplyScalar(1 / dt); k.prev.copy(k.p); k.t = 1; vis.setLod(cam.distanceTo(k.p) > 45 ? 1 : 0); vis.update(dt, sys.visEnv(vis, k.v)); }
      // headlight spot lights only for the local active vehicle
      sys.lights(act, night);
      if (act && act.visual.scr && pl?.mode === 'drive' && (pl.cameraMode === 'cockpit') && ctx.time.real - (act._scrT || 0) > 0.5) { act._scrT = ctx.time.real; sys.drawDash(act); }
    },
    lights(v, night) {
      if (!sys.spots) { sys.spots = [0, 1].map(() => { const s = new THREE.SpotLight(0xfff2de, 0, 95, 0.46, 0.55, 1.6); s.castShadow = false; s.target = new THREE.Object3D(); return s; }); }
      for (const [i, s] of sys.spots.entries()) {
        if (!v || !v.headlights || v.destroyed) { s.intensity = 0; s.visible = false; continue; } const lp = v.visual.lampPos[0], par = v.visual.body;
        if (s.parent !== par) { par.add(s); par.add(s.target); } s.visible = true; s.position.set(lp[0] * (i ? 1 : -1), lp[1], -lp[2]); s.target.position.set(lp[0] * (i ? 1 : -1) * 1.4, lp[1] - 1.2, -lp[2] - 20); s.intensity = 260 * (0.25 + night);
      }
    },
    drawDash(v) {
      const st = ctx.storms, b = v.body, p = b.p, d = { speed: b.vLong, rpm: b.rpm, gear: b.gear, throttle: b.throttle, fuel: b.fuel, mph: ctx.settings.get('units') !== 'metric' };
      try { st.windAt(p.x, p.y + 2, p.z, WIND); d.wind = Math.hypot(WIND.x, WIND.z); d.windDir = Math.atan2(WIND.x, -WIND.z) - Math.atan2(-b.M[2], -b.M[8]); const w = st.weatherAt?.(p.x, p.z); d.pres = st.pressureAt?.(p.x, p.y, p.z) ?? 1000; d.temp = w?.temp ?? 25; d.dew = w?.dewpoint ?? 18;
        if (st.reflectivity) { const n = 40, z = (sys._rz ||= new Float32Array(n * n)), R = 20000; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) z[j * n + i] = st.reflectivity(p.x + (i / (n - 1) - 0.5) * R, p.z + (j / (n - 1) - 0.5) * R); d.radar = { n, z }; } } catch { /* storms optional */ }
      const h = ctx.time.hour ?? 12; d.clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; v.visual.drawScreens(d);
    },
    dispose() { sys.clear(); },
  };
  // debris hits from fx: {pos, vel, mass, v?}
  ctx.events.on('fx:debris-hit', (e) => {
    const v = e.v || sys.list.find((o) => o.body.p.distanceTo(e.pos) < o.body.radius + 1); if (!v || !e.pos) return; const m = e.mass ?? 20, vel = e.vel || V.set(0, 0, 0);
    const rel = V2.copy(vel).sub(v.body.v), sp = rel.length(), J = Math.min(m * sp, v.spec.mass * 8); if (sp < 1) return; rel.normalize().multiplyScalar(J); v.body.addImpulse(rel.x, rel.y, rel.z, e.pos.x, e.pos.y, e.pos.z);
    const dm = v.body.addDamage(Math.min(0.25, m * sp * sp * 2.5e-7)); v.onImpact(sp * Math.min(1, m / 50 + 0.3), e.pos.x, e.pos.y, e.pos.z, -rel.x, -rel.y, -rel.z, 'debris', dm); if (sp > 15) { V2.copy(e.pos); v.object3d.worldToLocal(V2); v.visual.addCrack(V2.x * 0.7, Math.max(V2.y, v.spec.H * 0.5), V2.z * 0.6, clamp(sp / 60, 0.2, 0.7)); }
  });
  return sys;
}
const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000, r4 = (x) => Math.round(x * 10000) / 10000;
export { TYPES, SPECS, VehicleVisual, lerp };

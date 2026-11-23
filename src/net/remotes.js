// Visuals of other players: vehicles (driven and parked), characters, drones, deployed probes, photo flashes.
import * as THREE from 'three';
import { InterpBuffer } from './interp.js';
import { MODES, F } from './codec.js';

const HIDE = 7000, PARK_TIMEOUT = 15, MAXV = 4, MAXPROBES = 12;
const V = new THREE.Vector3(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
let flashTex = null;
function flashTexture() {
  if (flashTex) return flashTex; const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.12, 'rgba(240,246,255,.9)'); r.addColorStop(0.4, 'rgba(190,215,255,.22)'); r.addColorStop(1, 'rgba(150,190,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  flashTex = new THREE.CanvasTexture(c); flashTex.colorSpace = THREE.SRGBColorSpace; return flashTex;
}
const dark = () => new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.6, metalness: 0.2 });
// only used while the vehicle / character modules are mocked
function fallbackVehicle() { const g = new THREE.Group(), m = new THREE.Mesh(new THREE.CapsuleGeometry(0.95, 2.6, 6, 14), dark()); m.rotation.x = Math.PI / 2; m.position.y = 0.95; g.add(m); return { object3d: g, setState() {} }; }
function fallbackCharacter(color) { const g = new THREE.Group(), m = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.15, 6, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.8 })); m.position.y = 0.88; g.add(m); return { object3d: g, setState() {} }; }
function buildDrone(color) {
  const g = new THREE.Group(), m = dark(), b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 12), m); b.scale.set(1.1, 0.45, 1.6); g.add(b);
  const rotors = [], disc = new THREE.MeshBasicMaterial({ color: 0x11161a, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.3, 8), m); arm.rotation.z = Math.PI / 2; arm.rotation.y = Math.atan2(-z, x); arm.position.set(x * 0.12, 0.01, z * 0.12); g.add(arm);
    const r = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), disc); r.rotation.x = -Math.PI / 2; r.position.set(x * 0.23, 0.05, z * 0.23); g.add(r); rotors.push(r);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: z < 0 ? color : 0xff2020 })); led.position.set(x * 0.23, -0.01, z * 0.23); g.add(led);
  }
  return g;
}
function buildProbe() {
  const g = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0xb9662a, roughness: 0.55, metalness: 0.35 });
  const c = new THREE.Mesh(new THREE.LatheGeometry([[0.0, 0.42], [0.07, 0.41], [0.12, 0.36], [0.36, 0.1], [0.45, 0.03], [0.46, 0]].map(([x, y]) => new THREE.Vector2(x, y)), 28), steel); g.add(c);
  const a = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.3, 8), dark()); a.position.y = 0.55; g.add(a); return g;
}
function dispose(o) { o?.traverse?.((m) => { if (m.userData?.shared) return; }); o?.parent?.remove(o); }

export function createRemotes(ctx, net) {
  const peers = new Map(), remoteVehicles = [], flashes = []; let delay = 0.12;
  class RVeh {
    constructor(R, vid, type) { this.R = R; this.vid = vid; this.type = ''; this.buf = new InterpBuffer(); this.visual = null; this.occupied = false; this.seen = 0; this.flags = 0; this.throttle = 0; this.rpm = 0; this.st = { lights: false, brake: 0, throttle: 0, horn: false }; this.col = { id: `${R.id}:${vid}`, peerId: R.id, type, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), radius: 2.6, hx: 1, hy: 0.8, hz: 2.4, mass: 2000 }; remoteVehicles.push(this.col); this.setType(type); }
    setType(t) {
      const types = ctx.vehicles?.types || {}, ty = types[t] ? t : Object.keys(types)[0] || t; if (this.type === ty && this.visual) return;
      dispose(this.visual?.object3d); this.visual?.dispose?.(); this.type = ty; this.col.type = ty;
      let v = null; try { v = ctx.vehicles?.createVisual?.(ty); } catch (e) { console.error('[remotes] createVisual', e); }
      this.visual = v?.object3d ? v : fallbackVehicle(); ctx.scene.add(this.visual.object3d);
      const s = types[ty] || {}; this.col.hx = (s.W || 2) / 2; this.col.hy = (s.H || 1.6) / 2; this.col.hz = (s.L || 4.8) / 2; this.col.radius = Math.hypot(this.col.hx, this.col.hz); this.col.mass = s.mass || 2000;
    }
    remove() { dispose(this.visual?.object3d); this.visual?.dispose?.(); const i = remoteVehicles.indexOf(this.col); if (i >= 0) remoteVehicles.splice(i, 1); }
  }
  class Remote {
    constructor(p) { this.id = p.id; this.p = p; this.veh = new Map(); this.foot = new InterpBuffer(); this.char = null; this.droneBuf = new InterpBuffer(); this.drone = null; this.mode = 'spectate'; this.inVeh = -1; this.flags = 0; this.footSeen = -1; this.droneOn = false; this.probes = []; this.rec = null; this.cs = { speed: 0, crouch: false, aim: false, mode: 'foot', pitch: 0, flashlight: false }; this.jit = 0; this.lastArr = 0; }
    vehicle(vid, type) {
      let v = this.veh.get(vid);
      if (!v) { if (this.veh.size >= MAXV) { let old = null; for (const x of this.veh.values()) if (!x.occupied && (!old || x.seen < old.seen)) old = x; if (!old) return null; old.remove(); this.veh.delete(old.vid); } this.veh.set(vid, v = new RVeh(this, vid, type)); }
      v.setType(type); v.seen = ctx.time.real; return v;
    }
    push(r) {
      const f = r.flags;
      if (r.kind === 1) { const v = this.vehicle(r.vid, r.type); if (v) { v.buf.push(r); v.flags = f; v.rpm = r.rpm; v.throttle = r.throttle; if (this.inVeh !== r.vid) v.occupied = false; } return; }
      const now = ctx.time.real, gap = now - this.lastArr; this.lastArr = now; if (gap < 1) this.jit += (Math.abs(gap - 0.06) - this.jit) * 0.05;
      this.rec = r; this.flags = f; this.mode = MODES[r.mode]; const p = this.p; p.mode = this.mode; p.horn = !!(f & F.HORN); p.lights = !!(f & F.LIGHTS); p.scanning = !!(f & F.SCAN); p.reverse = !!(f & F.REVERSE); p.rpm = r.rpm; p.throttle = r.throttle;
      if (f & F.INVEH) {
        if (this.inVeh !== r.vid) { const o = this.veh.get(this.inVeh); if (o) o.occupied = false; this.inVeh = r.vid; this.foot.clear(); }
        const v = this.vehicle(r.vid, r.type); if (v) { v.occupied = true; v.buf.push(r); v.flags = f; v.rpm = r.rpm; v.throttle = r.throttle; p.vehicleType = v.type; }
      } else { if (this.inVeh >= 0) { const o = this.veh.get(this.inVeh); if (o) o.occupied = false; this.inVeh = -1; } p.vehicleType = null; this.foot.push(r); this.footSeen = now; }
      const d = !!(f & F.DRONE); if (d) { dr.t = r.t; for (let i = 0; i < 3; i++) dr.pos[i] = r.drone[i]; dr.heading = r.drone[3]; const n = this.droneBuf.newest; if (n && r.t - n.t < 1) for (let i = 0; i < 3; i++) dr.vel[i] = (r.drone[i] - n.pos[i]) / Math.max(0.02, r.t - n.t); else dr.vel.fill(0); this.droneBuf.push(dr); } else if (this.droneOn) this.droneBuf.clear(); this.droneOn = d;
    }
    remove() { for (const v of this.veh.values()) v.remove(); this.veh.clear(); dispose(this.char?.object3d); this.char?.dispose?.(); dispose(this.drone); for (const o of this.probes) dispose(o); }
  }
  const dr = { t: 0, pos: [0, 0, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1], heading: 0, pitch: 0, aux: [] };
  const setPose = (o, s) => { o.position.set(s.pos[0], s.pos[1], s.pos[2]); o.quaternion.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]); };
  function updateOne(R, dt, t) {
    const p = R.p, cam = ctx.camera.position, now = ctx.time.real;
    for (const v of [...R.veh.values()]) {
      if (!v.occupied && now - v.seen > PARK_TIMEOUT) { v.remove(); R.veh.delete(v.vid); continue; }
      const s = v.buf.sample(t, dt), o = v.visual.object3d; if (!s) { o.visible = false; continue; }
      o.visible = V.set(s.pos[0], s.pos[1], s.pos[2]).distanceToSquared(cam) < HIDE * HIDE;
      if (o.visible) {
        try { if (s.aux.length && ctx.vehicles?.applyState) ctx.vehicles.applyState(v.visual, s.aux, dt); else { v.st.lights = !!(v.flags & F.LIGHTS); v.st.brake = v.flags & F.BRAKE ? 1 : 0; v.st.throttle = v.throttle; v.visual.setState?.(v.st); } } catch (e) { if (!R.warned) { R.warned = true; console.error('[remotes] applyState', e); } }
        setPose(o, s);
      }
      v.col.pos.set(s.pos[0], s.pos[1], s.pos[2]); v.col.quat.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]); v.col.vel.set(s.vel[0], s.vel[1], s.vel[2]); v.col.rpm = v.rpm; v.col.throttle = v.throttle; v.col.occupied = v.occupied;
      if (v.occupied) { p.pos.copy(v.col.pos); p.vel.copy(v.col.vel); p.heading = s.heading; p.label.copy(p.pos); p.label.y += v.col.hy * 2 + 0.7; p.speed = p.vel.length(); p.stale = s.stale; }
    }
    if (R.inVeh < 0 && R.foot.n && R.mode !== 'spectate') {
      const s = R.foot.sample(t, dt);
      if (!R.char) { let c = null; try { c = ctx.player?.createCharacterVisual?.(p.color); } catch (e) { console.error('[remotes] character', e); } R.char = c?.object3d ? c : fallbackCharacter(p.color); ctx.scene.add(R.char.object3d); }
      const o = R.char.object3d; o.visible = V.set(s.pos[0], s.pos[1], s.pos[2]).distanceToSquared(cam) < 2500 * 2500;
      if (R.mode === 'swept') setPose(o, s); else { o.position.set(s.pos[0], s.pos[1], s.pos[2]); o.quaternion.setFromAxisAngle(UP, -s.heading); }
      p.pos.copy(o.position); p.vel.set(s.vel[0], s.vel[1], s.vel[2]); p.heading = s.heading; p.speed = Math.hypot(s.vel[0], s.vel[2]); p.label.copy(p.pos); p.label.y += 2.15; p.stale = s.stale;
      const c = R.cs; c.speed = p.speed; c.crouch = !!(R.flags & F.CROUCH); c.aim = !!(R.flags & F.AIM); c.flashlight = !!(R.flags & F.FLASH); c.pitch = s.pitch; c.mode = R.mode; c.vx = s.vel[0]; c.vz = s.vel[2]; c.dt = dt; if (o.visible) R.char.setState?.(c, dt);
    } else if (R.char) R.char.object3d.visible = false;
    if (R.droneOn && R.droneBuf.n) {
      if (!R.drone) { R.drone = ctx.gameplay?.createDroneVisual?.(p.color) || buildDrone(p.color); R.drone = R.drone.object3d || R.drone; ctx.scene.add(R.drone); }
      const s = R.droneBuf.sample(t, dt); R.drone.visible = true; R.drone.position.set(s.pos[0], s.pos[1], s.pos[2]); R.drone.rotation.set(Math.max(-0.4, Math.min(0.4, -Math.hypot(s.vel[0], s.vel[2]) * 0.02)), -s.heading, 0, 'YXZ'); (p.drone ||= new THREE.Vector3()).copy(R.drone.position);
    } else { if (R.drone) R.drone.visible = false; p.drone = null; }
  }
  return {
    remoteVehicles, peers,
    add(p) { p.pos = new THREE.Vector3(NaN, 0, 0); p.pos.set(0, -1e4, 0); p.vel = new THREE.Vector3(); p.label = new THREE.Vector3(0, -1e4, 0); p.heading = 0; p.mode = 'spectate'; p.vehicleType = null; p.speed = 0; p.horn = p.lights = false; peers.get(p.id)?.remove(); peers.set(p.id, new Remote(p)); },
    remove(id) { peers.get(id)?.remove(); peers.delete(id); },
    clear() { for (const R of peers.values()) R.remove(); peers.clear(); },
    push(r) { peers.get(r.id)?.push(r); },
    get delay() { return delay; },
    update(dt) {
      let j = 0; for (const R of peers.values()) j = Math.max(j, R.jit); const want = Math.max(0.1, Math.min(0.2, 0.095 + j * 1.6)); delay += (want - delay) * Math.min(1, dt);
      const t = ctx.time.now - delay; for (const R of peers.values()) updateOne(R, dt, t);
      for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.t += dt; const k = f.t < 0.03 ? 1 : Math.exp(-(f.t - 0.03) * 26); f.s.material.opacity = k; if (f.t > 0.35) { f.s.visible = false; f.s.parent?.remove(f.s); f.s.material.dispose(); flashes.splice(i, 1); } }
    },
    flash(x, y, z) {
      if (flashes.length > 12) return; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, color: new THREE.Color(5, 5.4, 6) }));
      s.position.set(x, y, z); s.scale.setScalar(3.2); (ctx.fxScene || ctx.scene).add(s); flashes.push({ s, t: 0 });
    },
    probe(id, x, y, z) {
      const R = peers.get(id); if (!R) return; let o = null; try { o = ctx.gameplay?.createProbeVisual?.(); } catch { /* optional */ } o = o?.object3d || o || buildProbe();
      o.position.set(x, y, z); ctx.scene.add(o); R.probes.push(o); if (R.probes.length > MAXPROBES) dispose(R.probes.shift());
    },
    clearProbes(id) { const R = peers.get(id); if (R) { for (const o of R.probes) dispose(o); R.probes.length = 0; } },
  };
}

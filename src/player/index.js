// PLAYER: modes (drive/foot/swept/drone/spectate), on-foot controller, wind on the body, being swept, cameras.
import * as THREE from 'three';
import { createCharacterVisual } from './character.js';
import { clamp, damp, lerp, wrapAngle, headingToDir, dirToHeading } from '../core/math.js';
import { gnoise } from '../core/noise.js';

const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), N = new THREE.Vector3(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ'), WIND = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), M4 = new THREE.Matrix4();
const EYE = 1.66, R = 0.32, G = 9.81;

export async function create(ctx) {
  const P = {
    mode: 'spectate', pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), heading: 0, pitch: 0, vehicle: null, health: 1, cameraMode: 'chase', driveCam: 'chase', cameraOverride: null, fovOverride: null,
    onGround: true, crouch: 0, sprinting: false, windSpeed: 0, windLean: 0, knocked: 0, blackout: 0, stamina: 1, look: { yaw: 0, pitch: 0, t: 0 }, shake: 0, lookBack: false, aiming: false,
    character: null, swept: null, _cam: { pos: new THREE.Vector3(), q: new THREE.Quaternion(), fov: 72, init: false, blend: 1 }, colliders: [],
    createCharacterVisual,
    teleport(x, z, heading = 0) { const y = ctx.world.heightAt(x, z); P.pos.set(x, y, z); P.vel.set(0, 0, 0); P.heading = heading; P.pitch = 0; P._cam.init = false; },
    enter(v) {
      if (!v) return; if (P.vehicle && P.vehicle !== v) P.vehicle.body.occupied = false; P.vehicle = v; ctx.vehicles.active = v; v.body.occupied = true; v.body.wake(); P.setMode('drive'); P.cameraMode = P.driveCam; P.look.yaw = P.look.pitch = 0; P._cam.blend = 0; if (P.character) P.character.object3d.visible = false;
    },
    exit() {
      const v = P.vehicle; if (!v) return false; const b = v.body; if (Math.abs(b.vLong) > 7 && !b.flipped) return false;
      // choose a free side (driver side first)
      const sides = [-1, 1], s = b.spec; let best = null;
      for (const sd of sides) { V.set(sd * (s.W / 2 + 0.55), 0, -(s.cgF)).applyQuaternion(b.q).add(b.p); const ok = !P.blocked(V.x, V.z, 0.35, v); if (ok) { best = V.clone(); break; } }
      if (!best) { V.set(0, 0, s.L / 2 + 0.7).applyQuaternion(b.q).add(b.p); best = V.clone(); }
      P.pos.set(best.x, ctx.world.heightAt(best.x, best.z), best.z); P.vel.copy(b.v).multiplyScalar(0.5); P.heading = dirToHeading(-b.M[2], -b.M[8]); P.pitch = 0; b.occupied = false; P.lastVehicle = v; P.vehicle = null; P.setMode('foot'); P.cameraMode = 'foot'; P._cam.blend = 0; return true;
    },
    setMode(m) { if (P.mode === m) return; const prev = P.mode; P.mode = m; ctx.events.emit('player:mode', { mode: m, prev }); },
    setCameraMode(m) { if (m === 'foot') { P.cameraMode = 'foot'; return; } if (P.mode === 'drive') { P.driveCam = m; P.cameraMode = m; P._cam.blend = 0.3; } else P.cameraMode = m; },
    damage(a, cause = 'impact') { if (a <= 0) return; P.health = clamp(P.health - a); ctx.events.emit('player:damage', { amount: a, health: P.health, cause }); if (P.health <= 0 && !P.blackoutT) P.startBlackout(); },
    blocked(x, z, r, ignore) { const L = P.colliders; L.length = 0; ctx.world.queryColliders?.(x, z, r + 2, L); for (const c of L) { if (c.broken) continue; if (c.shape === 'cyl') { if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true; } else { const cs = Math.cos(c.rotY || 0), sn = Math.sin(c.rotY || 0), dx = x - c.x, dz = z - c.z, lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; if (Math.abs(lx) < c.hx + r && Math.abs(lz) < c.hz + r) return true; } } for (const v of ctx.vehicles.list || []) { if (v === ignore) continue; if (inVehicle(v, x, P.pos.y + 1, z, r)) return true; } return false; },
    startBlackout() { P.blackoutT = 0.001; ctx.events.emit('player:blackout', {}); },
    respawn() {
      const w = ctx.world, p = P.swept ? P.swept.p : P.pos; let x = p.x, z = p.z, h = P.heading; const r = w.roads?.nearest?.(x, z), c = w.nearestCity?.(x, z);
      if (r && r.dist < 6000) { x = r.x; z = r.z; h = dirToHeading(r.dirX, r.dirZ); } else if (c) { const sp = w.spawnPoint?.(c.name); if (sp) { x = sp.x; z = sp.z; h = sp.heading; } }
      if (P.character) P.character.setState({ tumble: 0 }); P.swept = null; P.health = Math.max(P.health, 0.35); P.knocked = 0; const v = P.vehicle || P.lastVehicle;
      if (v && v.body.p.distanceTo(new THREE.Vector3(x, v.body.p.y, z)) < 3000 || v === P.vehicle) { ctx.vehicles.recover(v); v.body.place(x + Math.cos(h) * 3, z + Math.sin(h) * 3, h); v.damage = Math.max(v.damage, 0.85); v.fuel = Math.max(v.fuel, 0.2); P.enter(v); }
      else { P.teleport(x, z, h); P.setMode('foot'); P.cameraMode = 'foot'; }
      ctx.events.emit('player:respawn', { x, z, heading: h, city: c?.name });
    },
    update(dt) { if (ctx.state !== 'playing' && !P.cameraOverride) return; step(dt); },
    lateUpdate(dt) { camera(dt); },
  };
  ctx.events.on('lightning', (e) => { const d = Math.hypot(e.x - P.pos.x, e.z - P.pos.z); P.thunder = Math.max(P.thunder || 0, clamp(1 - d / 6000) * (e.energy ?? 1)); P.thunderDelay = d / 343; });
  ctx.events.on('vehicle:swept', (e) => { if (e.v === P.vehicle) { ctx.events.emit('player:swept', { inVehicle: true, v: e.v }); P.vSwept = 0.001; } });
  ctx.events.on('vehicle:landed', (e) => { if (e.v === P.vehicle && P.vSwept) { P.vSwept = 0; P.damage(0.35 + e.v.damage * 0.3, 'tornado'); P.startBlackout(); } });

  function inVehicle(v, x, y, z, r) { const b = v.body, M = b.M, bx = b.box, X = x - b.p.x, Y = y - b.p.y, Z = z - b.p.z; const lx = M[0] * X + M[3] * Y + M[6] * Z, ly = M[1] * X + M[4] * Y + M[7] * Z - bx.cy, lz = M[2] * X + M[5] * Y + M[8] * Z - bx.cz; return Math.abs(lx) < bx.hx + r && Math.abs(lz) < bx.hz + r && Math.abs(ly) < bx.hy + 1; }

  function step(dt) {
    const I = ctx.input, W = ctx.world;
    if (P.blackoutT) { P.blackoutT += dt; if (P.blackoutT > 3.2) { P.blackoutT = 0; P.respawn(); } }
    // vehicle interaction
    if (P.mode === 'drive' && P.vehicle) {
      const b = P.vehicle.body; P.pos.copy(b.rp); P.health = Math.min(1, P.health + dt * 0.002);
      if (I.pressed('enter')) P.exit(); if (I.pressed('camera')) { const order = ['chase', 'cockpit', 'hood']; P.setCameraMode(order[(order.indexOf(P.driveCam) + 1) % order.length]); }
      if (P.vSwept) { P.vSwept += dt; if (P.vSwept > 14) { P.vSwept = 0; P.startBlackout(); } }
      return;
    }
    if (P.mode === 'foot') foot(dt); else if (P.mode === 'swept') swept(dt);
  }
  function foot(dt) {
    const I = ctx.input, W = ctx.world; if (I.pressed('camera')) {}
    // look
    const sens = 0.0022 * (ctx.settings.get('mouseSens') ?? 1), inv = ctx.settings.get('invertY') ? -1 : 1; P.heading = wrapAngle(P.heading + I.mouse.dx * sens + I.axis('lookX') * dt * 2.6); P.pitch = clamp(P.pitch - (I.mouse.dy * sens + I.axis('lookY') * dt * 2.2) * inv, -1.45, 1.45);
    // enter nearest vehicle
    if (I.pressed('enter')) { let best = null, bd = 3.2; for (const v of ctx.vehicles.list || []) { const d = Math.hypot(v.body.p.x - P.pos.x, v.body.p.z - P.pos.z) - Math.max(v.spec.W, v.spec.L) * 0.35; if (d < bd) { bd = d; best = v; } } if (best && !best.body.flipped) { P.enter(best); return; } }
    P.crouch = damp(P.crouch, I.down('crouch') ? 1 : 0, 10, dt); P.aiming = I.mouse.right;
    // wind at chest
    ctx.storms?.windAt?.(P.pos.x, P.pos.y + 1.2, P.pos.z, WIND); if (!Number.isFinite(WIND.x)) WIND.set(0, 0, 0); const ws = Math.hypot(WIND.x, WIND.z); P.windSpeed = ws;
    const mx = I.axis('moveX'), my = I.axis('moveY'), f = headingToDir(P.heading, {}), rx = -f.z, rz = f.x; let dx = f.x * my + rx * mx, dz = f.z * my + rz * mx; const dl = Math.hypot(dx, dz); if (dl > 1) { dx /= dl; dz /= dl; }
    P.stamina = clamp(P.stamina + dt * (P.sprinting ? -0.12 : 0.2)); P.sprinting = I.down('sprint') && my > 0.2 && P.stamina > 0.05 && P.crouch < 0.5;
    let sp = P.crouch > 0.5 ? 1.4 : P.sprinting ? 6.2 : 2.6; if (P.aiming) sp = Math.min(sp, 1.6);
    // walking into the wind is hard, ground slope slows
    W.normalAt(P.pos.x, P.pos.z, N); const slope = 1 - N.y; sp *= clamp(1 - slope * 2.5, 0.25, 1);
    const head = dl > 0.01 ? (WIND.x * dx + WIND.z * dz) / dl : 0; sp *= clamp(1 + head / 45, 0.08, 1.5); if (ws > 35) sp *= clamp(1 - (ws - 35) / 25, 0.15, 1);
    const tvx = dx * sp, tvz = dz * sp, acc = P.onGround ? 14 : 2.5; P.vel.x = damp(P.vel.x, tvx, acc, dt); P.vel.z = damp(P.vel.z, tvz, acc, dt);
    // wind force on the body (drag ~ 0.5 rho Cd A, A~0.7 m2, m 80 kg)
    const rvx = WIND.x - P.vel.x, rvz = WIND.z - P.vel.z, rv = Math.hypot(rvx, rvz), k = 0.5 * 1.15 * 1.1 * (0.75 - P.crouch * 0.35) / 80; let fx = rvx * rv * k, fz = rvz * rv * k; const brace = P.onGround ? clamp(1 - (ws - 18) / 30, 0, 1) * 6 : 0, fl = Math.hypot(fx, fz); if (fl < brace) { fx = fz = 0; } else { fx *= (fl - brace) / fl; fz *= (fl - brace) / fl; }
    P.vel.x += fx * dt; P.vel.z += fz * dt; P.windLean = damp(P.windLean, clamp(fl / 12, 0, 0.5), 3, dt);
    if (ws > 50 || (ws > 42 && P.crouch < 0.5 && Math.random() < dt * 0.6)) { P.knocked += dt * (ws - 40) / 10; } else P.knocked = Math.max(0, P.knocked - dt);
    if (P.knocked > 0.6) { startSwept(); return; }
    // gravity / jump / ground
    const gy = W.heightAt(P.pos.x, P.pos.z); if (P.onGround && I.pressed('jump') && P.crouch < 0.5) { P.vel.y = 4.6; P.onGround = false; }
    P.vel.y -= G * dt; P.pos.addScaledVector(P.vel, dt); const gy2 = W.heightAt(P.pos.x, P.pos.z);
    if (P.pos.y <= gy2 + 0.02 || (P.onGround && P.pos.y - gy2 < 0.35 && P.vel.y <= 0)) { if (!P.onGround && P.vel.y < -11) P.damage((-P.vel.y - 11) * 0.08, 'fall'); P.pos.y = gy2; P.vel.y = 0; P.onGround = true; } else P.onGround = false;
    if (N.y < 0.72 && P.onGround) { P.vel.x += N.x * G * dt * 1.4; P.vel.z += N.z * G * dt * 1.4; }
    void gy; collide(); const wl = W.waterLevelAt?.(P.pos.x, P.pos.z) ?? -Infinity; if (wl > P.pos.y + 1.2) P.vel.multiplyScalar(0.9);
    if (P.character) { P.character.object3d.visible = false; }
  }
  function collide() {
    const p = P.pos, L = P.colliders; L.length = 0; ctx.world.queryColliders?.(p.x, p.z, 3, L);
    for (const c of L) { if (c.broken) continue; const top = c.shape === 'cyl' ? c.y + (c.h || 4) : c.y + (c.hy ?? (c.h || 4) / 2); if (p.y > top - 0.3) { if (p.y < top + 0.1 && P.vel.y <= 0) { p.y = top; P.vel.y = 0; P.onGround = true; } continue; }
      if (c.shape === 'cyl') { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + R; if (d < m && d > 1e-4) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; const vn = (P.vel.x * dx + P.vel.z * dz) / d; if (vn < 0) { P.vel.x -= vn * dx / d; P.vel.z -= vn * dz / d; } } }
      else { const cs = Math.cos(c.rotY || 0), sn = Math.sin(c.rotY || 0), dx = p.x - c.x, dz = p.z - c.z; let lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; const px = c.hx + R - Math.abs(lx), pz = c.hz + R - Math.abs(lz); if (px > 0 && pz > 0) { if (px < pz) lx += Math.sign(lx) * px; else lz += Math.sign(lz) * pz; p.x = c.x + lx * cs + lz * sn; p.z = c.z - lx * sn + lz * cs; } } }
    for (const v of ctx.vehicles.list || []) { const b = v.body, M = b.M, bx = b.box, X = p.x - b.p.x, Y = p.y + 0.9 - b.p.y, Z = p.z - b.p.z; let lx = M[0] * X + M[3] * Y + M[6] * Z; const ly = M[1] * X + M[4] * Y + M[7] * Z - bx.cy; let lz = M[2] * X + M[5] * Y + M[8] * Z - bx.cz; const px = bx.hx + R - Math.abs(lx), pz = bx.hz + R - Math.abs(lz);
      if (px > 0 && pz > 0 && Math.abs(ly) < bx.hy + 0.9) { if (ly > bx.hy - 0.2 && P.vel.y <= 0) { continue; } if (px < pz) lx += Math.sign(lx) * px; else lz += Math.sign(lz) * pz; const wx = M[0] * lx + M[2] * (lz + bx.cz) + M[1] * (ly + bx.cy), wz = M[6] * lx + M[8] * (lz + bx.cz) + M[7] * (ly + bx.cy); p.x = b.p.x + wx; p.z = b.p.z + wz; const rel = Math.hypot(b.v.x, b.v.z); if (rel > 4) { P.damage(rel * 0.02, 'vehicle'); P.vel.x = b.v.x * 1.1; P.vel.z = b.v.z * 1.1; P.vel.y = rel * 0.3; P.onGround = false; if (rel > 9) startSwept(); } } }
  }
  function startSwept() {
    if (P.mode === 'swept') return; const s = (P.swept = { p: P.pos.clone().add(V.set(0, 1, 0)), v: P.vel.clone(), q: new THREE.Quaternion().setFromEuler(E.set(0, -P.heading, 0)), w: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6), t: 0, hits: 0, rest: 0 });
    void s; P.setMode('swept'); P.cameraMode = 'swept'; ctx.events.emit('player:swept', { inVehicle: false }); ensureChar(); P.character.setState({ tumble: 1 });
  }
  function swept(dt) {
    const s = P.swept, W = ctx.world; s.t += dt; ctx.storms?.windAt?.(s.p.x, s.p.y, s.p.z, WIND); if (!Number.isFinite(WIND.x)) WIND.set(0, 0, 0);
    const rel = V.copy(WIND).sub(s.v), rv = rel.length(), k = 0.5 * 1.15 * 0.9 * 0.85 / 80; s.v.addScaledVector(rel, rv * k * dt); s.v.y -= G * dt; s.p.addScaledVector(s.v, dt);
    s.w.x += (gnoise(s.t * 2, 1) * rv * 0.3 - s.w.x * 0.3) * dt; s.w.z += (gnoise(s.t * 2, 7) * rv * 0.3 - s.w.z * 0.3) * dt; s.w.y += (gnoise(s.t * 2, 4) * rv * 0.2 - s.w.y * 0.3) * dt; Q.setFromEuler(E.set(s.w.x * dt, s.w.y * dt, s.w.z * dt)); s.q.multiply(Q);
    const gy = W.heightAt(s.p.x, s.p.z) + 0.25; if (s.p.y < gy) { s.p.y = gy; const imp = -s.v.y + Math.hypot(s.v.x, s.v.z) * 0.3; if (imp > 6) { P.damage(imp * imp * 0.0009, 'tornado'); s.hits++; ctx.events.emit('player:impact', { speed: imp }); } s.v.y = Math.abs(s.v.y) * 0.25; s.v.x *= 0.6; s.v.z *= 0.6; s.w.multiplyScalar(0.6); }
    const L = P.colliders; L.length = 0; W.queryColliders?.(s.p.x, s.p.z, 2, L); for (const c of L) { if (c.broken) continue; const d = Math.hypot(s.p.x - c.x, s.p.z - c.z); if (d < (c.r || Math.max(c.hx, c.hz)) + 0.4 && s.p.y < c.y + (c.h || (c.hy || 2) * 2)) { const sp = s.v.length(); if (sp > 6) P.damage(sp * sp * 0.0012, 'tornado'); s.v.multiplyScalar(-0.3); } }
    P.pos.copy(s.p); P.pos.y -= 1; const sp = s.v.length(); if (s.p.y - gy < 0.3 && sp < 2.5 && WIND.length() < 30) s.rest += dt; else s.rest = 0;
    if ((s.rest > 1.5 || s.t > 25 || P.health <= 0) && !P.blackoutT) { if (P.health < 0.4 || s.hits > 2 || s.t > 25) P.startBlackout(); else { P.swept = null; P.pos.y = W.heightAt(P.pos.x, P.pos.z); P.vel.set(0, 0, 0); P.character?.setState({ tumble: 0 }); P.setMode('foot'); P.cameraMode = 'foot'; P.knocked = 0; } }
    ensureChar(); const o = P.character.object3d; o.visible = true; o.position.copy(s.p).add(V2.set(0, -0.9, 0).applyQuaternion(s.q)); o.quaternion.copy(s.q); P.character.update(dt);
  }
  function ensureChar() { if (!P.character) { P.character = createCharacterVisual(0xc8541a); ctx.scene.add(P.character.object3d); } }

  // -------------------- cameras --------------------
  const cam = ctx.camera, C = P._cam, tgt = new THREE.Vector3(), want = new THREE.Vector3(), wq = new THREE.Quaternion(), shakeV = new THREE.Vector3();
  let bob = 0, chaseYaw = 0, chaseVel = new THREE.Vector3(), lastMode = '', gLean = new THREE.Vector2();
  function proximity() { let best = 0; for (const t of ctx.storms?.tornadoes || []) { const d = Math.hypot(t.x - P.pos.x, t.z - P.pos.z); best = Math.max(best, clamp(1 - (d - (t.rCore || 80)) / 1600) * (t.strength ?? 0.7)); } return best; }
  function camera(dt) {
    if (P.cameraOverride) { P.cameraOverride(cam, dt); C.init = false; applyFov(dt, 0); return; }
    if (ctx.state !== 'playing') return;
    const I = ctx.input, sens = 0.0022 * (ctx.settings.get('mouseSens') ?? 1), inv = ctx.settings.get('invertY') ? -1 : 1, mode = P.mode === 'drive' ? P.cameraMode : P.mode === 'swept' ? 'swept' : P.mode === 'foot' ? 'foot' : 'spectate';
    if (mode !== lastMode) { C.blend = 0; lastMode = mode; }
    P.lookBack = I.down('lookBack'); let fovAdd = 0; const prox = proximity(); const shakeAmt = (ctx.settings.get('cameraShake') ?? 1);
    if (P.thunderDelay > 0) P.thunderDelay -= dt; else if (P.thunder > 0) { P.shake = Math.max(P.shake, P.thunder * 0.6); P.thunder = 0; }
    P.shake = Math.max(0, P.shake - dt * 1.5); const tShake = (prox * prox * 0.9 + P.shake) * shakeAmt;
    if (mode === 'chase' || mode === 'hood' || mode === 'cockpit') {
      const v = P.vehicle, b = v.body, s = v.spec, o = v.object3d; const mdx = I.mouse.dx * sens + I.axis('lookX') * dt * 2.5, mdy = (I.mouse.dy * sens + I.axis('lookY') * dt * 2) * inv;
      if (Math.abs(mdx) + Math.abs(mdy) > 1e-5) { P.look.yaw = wrapAngle(P.look.yaw - mdx); P.look.pitch = clamp(P.look.pitch - mdy, -0.9, 0.7); P.look.t = 0; } else { P.look.t += dt; if (P.look.t > (mode === 'chase' ? 1.6 : 3)) { P.look.yaw = damp(P.look.yaw, 0, 2.2, dt); P.look.pitch = damp(P.look.pitch, 0, 2.2, dt); } }
      const lb = P.lookBack ? Math.PI : 0, sp = b.v.length();
      if (mode === 'chase') {
        // spring arm following the velocity heading, damped; rolls slightly with the body
        const fwd = V.set(0, 0, -1).applyQuaternion(b.rq); const vh = sp > 3 && b.vLong > -1 ? Math.atan2(b.v.x, -b.v.z) : Math.atan2(fwd.x, -fwd.z), bh = Math.atan2(fwd.x, -fwd.z), hh = sp > 3 ? lerp(bh, bh + wrapAngle(vh - bh) * 0.5, 1) : bh;
        if (!C.init) chaseYaw = hh; chaseYaw += wrapAngle(hh - chaseYaw) * (1 - Math.exp(-dt * (b.airborne ? 1.2 : 4.2)));
        const yaw = chaseYaw + P.look.yaw + lb, dist = Math.max(4.6, s.L * 0.95 + 1.6) + clamp(sp / 40) * 1.2, h = (s.tall || s.H) * 0.62 + 1.15, pitch = 0.12 + P.look.pitch * -1;
        tgt.copy(b.rp).add(V2.set(0, (s.tall || s.H) * 0.55 - s.cgY + 0.35, 0)); chaseVel.lerp(b.v, 1 - Math.exp(-dt * 6));
        want.set(Math.sin(yaw) * Math.cos(pitch) * -dist, h - 0.8 + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist).add(tgt).addScaledVector(chaseVel, -0.035);
        const gy = ctx.world.heightAt(want.x, want.z) + 0.45; if (want.y < gy) want.y = gy; // terrain collision
        if (ctx.world.raycastTerrain) { V3.copy(want).sub(tgt); const L = V3.length(); V3.normalize(); const hit = ctx.world.raycastTerrain(tgt, V3, L); if (hit > 0 && hit < L) want.copy(tgt).addScaledVector(V3, Math.max(1.5, hit - 0.4)); }
        if (!C.init) C.pos.copy(want); C.pos.lerp(want, 1 - Math.exp(-dt * 12)); M4.lookAt(C.pos, tgt, UP); wq.setFromRotationMatrix(M4);
        const roll = clamp(-b.accLocal.x * 0.004, -0.06, 0.06) + clamp(b.windLoad * 0.03, 0, 0.05) * Math.sin(ctx.time.now * 6); wq.multiply(Q2.setFromAxisAngle(V2.set(0, 0, 1), roll));
        fovAdd = clamp((sp - 8) / 45) * 11;
      } else {
        const m = mode === 'cockpit' ? v.mounts.driver : null; if (m) { m.updateMatrixWorld(); m.getWorldPosition(want); } else { want.set(0, (s.tall || s.H) * 0.86 - s.cgY + 0.12, -s.L * 0.18 + s.cgF).applyQuaternion(b.rq).add(b.rp); }
        // g-force lean & head bob
        gLean.x = damp(gLean.x, clamp(-b.accLocal.x * 0.006, -0.06, 0.06), 6, dt); gLean.y = damp(gLean.y, clamp(b.accLocal.z * 0.004, -0.05, 0.05), 6, dt); V2.set(gLean.x, Math.sin(ctx.time.now * 13) * clamp(sp / 30) * 0.004 + clamp(-b.accLocal.y * 0.002, -0.03, 0.03), gLean.y).applyQuaternion(b.rq); want.add(V2);
        C.pos.copy(want); E.set(P.look.pitch - 0.04, P.look.yaw + lb, 0, 'YXZ'); wq.copy(b.rq).multiply(Q.setFromEuler(E)); fovAdd = clamp((sp - 10) / 50) * 6;
      }
      // suspension / wind / rough road shake
      const vib = clamp(b.windLoad * 0.6 + (b.windSpeed > 20 ? (b.windSpeed - 20) / 80 : 0)) * 0.6 + clamp(Math.abs(b.accLocal.y) / 30) * 0.4 + b.scrape * 0.6; P.shake = Math.max(P.shake, vib * 0.25);
      if (P.vSwept) P.shake = Math.max(P.shake, 1.2);
    } else if (mode === 'foot') {
      ensureChar(); const ch = P.character; ch.object3d.visible = false; const sp = Math.hypot(P.vel.x, P.vel.z); bob += dt * sp * 1.9;
      const eye = EYE - P.crouch * 0.55; want.copy(P.pos); want.y += eye + Math.abs(Math.sin(bob * Math.PI)) * 0.04 * clamp(sp / 3) - 0.02; const fd = headingToDir(P.heading, {}); want.x += -fd.z * Math.sin(bob * Math.PI) * 0.02 * clamp(sp / 3) + WIND.x * 0.001 * P.windLean; want.z += fd.x * Math.sin(bob * Math.PI) * 0.02 * clamp(sp / 3);
      C.pos.copy(want); E.set(P.pitch, -P.heading + (P.lookBack ? Math.PI : 0), Math.sin(bob * Math.PI) * 0.006 * clamp(sp / 3) - P.windLean * 0.15 * Math.sign(WIND.x * fd.z - WIND.z * fd.x || 1), 'YXZ'); wq.setFromEuler(E); fovAdd = P.sprinting ? 5 : 0;
      P.shake = Math.max(P.shake, clamp((P.windSpeed - 22) / 40) * 0.4);
    } else if (mode === 'swept') {
      const s = P.swept; if (s) { tgt.copy(s.p); want.copy(s.p).add(V2.set(Math.sin(s.t * 0.7) * 4.5, 1.6 + Math.sin(s.t * 1.3), Math.cos(s.t * 0.7) * 4.5)); C.pos.lerp(want, 1 - Math.exp(-dt * 5)); M4.lookAt(C.pos, tgt, UP); wq.setFromRotationMatrix(M4); wq.multiply(Q2.setFromAxisAngle(V2.set(0, 0, 1), Math.sin(s.t * 2.3) * 0.5)); P.shake = Math.max(P.shake, 1.4); fovAdd = 12; }
    } else { return; }
    // blend between modes
    C.blend = Math.min(1, C.blend + dt * 2.8); const bl = C.init ? C.blend * C.blend * (3 - 2 * C.blend) : 1;
    if (!C.init) { cam.position.copy(C.pos); cam.quaternion.copy(wq); C.init = true; C.blend = 1; } else if (bl < 1) { cam.position.lerp(C.pos, bl * 0.5 + 0.1); cam.quaternion.slerp(wq, bl * 0.5 + 0.1); } else { cam.position.copy(C.pos); cam.quaternion.copy(wq); }
    // shake (noise, not random) — strong near tornadoes
    const sh = Math.min(2, P.shake * shakeAmt + tShake), t = ctx.time.real; if (sh > 0.001) { shakeV.set(gnoise(t * 17, 1.3), gnoise(t * 19, 5.1), gnoise(t * 23, 9.7)).multiplyScalar(0.012 * sh); cam.position.add(shakeV); E.set(gnoise(t * 13, 3.3) * 0.01 * sh, gnoise(t * 11, 7.7) * 0.01 * sh, gnoise(t * 9, 2.2) * 0.014 * sh, 'YXZ'); cam.quaternion.multiply(Q.setFromEuler(E)); }
    applyFov(dt, fovAdd);
  }
  function applyFov(dt, add) { const base = ctx.settings.get('fov') ?? 72, f = P.fovOverride ?? base + add; C.fov = damp(C.fov || f, f, 5, dt); if (Math.abs(cam.fov - C.fov) > 0.01) { cam.fov = C.fov; cam.updateProjectionMatrix(); } }
  return P;
}

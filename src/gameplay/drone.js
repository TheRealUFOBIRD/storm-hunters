// Pilotable quad-copter: physics with wind, battery, signal range, camera gimbal.
import * as THREE from 'three';
import { clamp, damp } from '../core/math.js';
import { droneModel } from './models.js';
import { gearValue } from './profile.js';

const W = new THREE.Vector3(), A = new THREE.Vector3(), E = new THREE.Euler(0, 0, 0, 'YXZ');
export function createDrone(ctx, profile, feel) {
  let obj = null, prevMode = null;
  const d = {
    active: false, state: 'stowed', pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: -0.1, tilt: new THREE.Vector2(), battery: 1, signal: 1, wind: 0, alt: 0, dist: 0, damage: 0, cooldown: 0, home: new THREE.Vector3(), fov: 68, t: 0,
    get x() { return d.pos.x; }, get y() { return d.pos.y; }, get z() { return d.pos.z; }, get heading() { return -d.yaw; },
    launch(x, y, z, heading) {
      if (d.active || d.cooldown > 0) return false; obj ||= droneModel(); ctx.scene.add(obj); d.pos.set(x, y, z); d.home.copy(d.pos); d.vel.set(0, 2.2, 0); d.yaw = -heading; d.pitch = -0.08; d.battery = 1; d.damage = 0; d.state = 'fly'; d.active = true; d.t = 0; d.fov = 68; d.spin = 0;
      prevMode = ctx.player.mode; try { ctx.player.mode = 'drone'; } catch { /* read only */ } ctx.player.cameraOverride = cam; profile.data.stats.drones++; ctx.events.emit('drone:launch', {}); ctx.audio?.play?.('drone_start'); return true;
    },
    recall(why) {
      if (!d.active) return; d.active = false; d.state = 'stowed'; if (ctx.player.cameraOverride === cam) ctx.player.cameraOverride = null; try { if (ctx.player.mode === 'drone') ctx.player.mode = prevMode === 'drone' || !prevMode ? 'foot' : prevMode; } catch { /* read only */ }
      if (why !== 'lost') { ctx.scene.remove(obj); d.cooldown = 2; } ctx.events.emit('drone:end', { why: why || 'recall' });
    },
    destroy(why) { if (!d.active || d.state === 'dead') return; d.state = 'dead'; d.deadT = 0; d.cooldown = 40; d.why = why; ctx.events.emit('drone:lost', { why, x: d.pos.x, z: d.pos.z }); ctx.audio?.play?.('drone_crash'); },
    update(dt) {
      if (d.cooldown > 0 && !d.active) d.cooldown -= dt; if (!d.active) return; d.t += dt; const I = ctx.input, S = ctx.storms;
      S.windAt(d.pos.x, d.pos.y, d.pos.z, W); d.wind = W.length(); const thrust = gearValue(profile.data, 'drone', 'thrust');
      if (d.state === 'fly') {
        const sens = 0.0021 * (ctx.settings.get('mouseSens') || 1) * (d.fov / 72); d.yaw -= (I.mouse.dx || 0) * sens + (I.axis('lookX') || 0) * dt * 1.8; d.pitch = clamp(d.pitch - ((I.mouse.dy || 0) * sens + (I.axis('lookY') || 0) * dt * 1.2) * (ctx.settings.get('invertY') ? -1 : 1), -1.5, 0.6);
        const f = I.axis('moveY') || 0, r = I.axis('moveX') || 0, u = (I.down('jump') || I.down('handbrake') ? 1 : 0) - (I.down('crouch') ? 1 : 0), boost = I.down('sprint') ? 1.55 : 1, vmax = 19 * Math.sqrt(thrust) * boost;
        const s = Math.sin(d.yaw), c = Math.cos(d.yaw), tx = (-s * f + c * r) * vmax, tz = (-c * f - s * r) * vmax;
        // flight controller holds ground velocity; authority limited by thrust, wind force is drag
        const lim = 11 * thrust; A.set((tx - d.vel.x) * 2.2, (u * 8 - d.vel.y) * 3, (tz - d.vel.z) * 2.2); const al = Math.hypot(A.x, A.z); if (al > lim) { A.x *= lim / al; A.z *= lim / al; } A.y = clamp(A.y, -8, 7 * thrust);
        const rx = W.x - d.vel.x, ry = W.y - d.vel.y, rz = W.z - d.vel.z, rl = Math.hypot(rx, ry, rz), k = 0.021 * rl; d.vel.x += (A.x + rx * k) * dt; d.vel.y += (A.y + ry * k * 0.7) * dt; d.vel.z += (A.z + rz * k) * dt;
        d.tilt.x = damp(d.tilt.x, clamp((A.x * -s + A.z * -c) * 0.05, -0.7, 0.7), 6, dt); d.tilt.y = damp(d.tilt.y, clamp((A.x * c - A.z * s) * 0.05, -0.7, 0.7), 6, dt);
        d.battery -= dt / gearValue(profile.data, 'drone', 'battery') * (1 + d.wind * 0.02 + (boost > 1 ? 0.5 : 0)); const P = ctx.player.vehicle?.pos || ctx.player.pos; d.dist = d.pos.distanceTo(P); const R = gearValue(profile.data, 'drone', 'range'); d.signal = clamp(1.15 - d.dist / R - (S.weatherAt?.(d.pos.x, d.pos.z)?.rain || 0) * 0.15);
        d.damage += Math.max(0, d.wind - 36 * Math.sqrt(thrust)) * dt * 0.02; if (d.damage > 1) d.destroy('Airframe failure'); if (d.battery <= 0) d.destroy('Battery empty'); if (d.signal <= 0.01) d.destroy('Signal lost');
      } else { W.sub(d.vel); d.vel.addScaledVector(W, Math.min(1, 0.02 * W.length() * dt)); d.vel.y -= 9.8 * dt; d.spin += dt; d.yaw += dt * 5; d.deadT += dt; if (d.deadT > 2.6) return d.recall('lost'); }
      d.pos.addScaledVector(d.vel, dt); const gy = Math.max(ctx.world.heightAt(d.pos.x, d.pos.z), ctx.world.waterLevelAt?.(d.pos.x, d.pos.z) ?? -1e9); d.alt = d.pos.y - gy;
      if (d.alt < 0.25) { const v = d.vel.length(); d.pos.y = gy + 0.25; if (d.state === 'fly' && v > 9) d.destroy('Crashed'); d.vel.multiplyScalar(0.2); if (d.state === 'fly' && d.t > 3 && v < 1.5 && d.dist < 8) d.canLand = true; } else d.canLand = d.dist < 10 && d.alt < 4;
      const u = obj.userData; obj.position.copy(d.pos); E.set(d.tilt.x * (d.state === 'fly' ? 1 : 0) + (d.state === 'dead' ? d.spin * 7 : 0), d.yaw, -d.tilt.y + (d.state === 'dead' ? d.spin * 5 : 0)); obj.quaternion.setFromEuler(E); for (const r of u.rotors) r.r.rotation.y += r.s * dt * (d.state === 'dead' ? 9 : 95); u.gimbal.rotation.x = d.pitch;
    },
    clear() { if (d.active) d.recall(); if (obj) ctx.scene.remove(obj); d.cooldown = 0; },
  };
  let shake = 0;
  function cam(camera, dt) {
    const s = d.state === 'dead' ? 1 : clamp((d.wind - 12) / 45); shake += (dt || 0.016) * (10 + s * 25); const j = s * 0.018 + (d.state === 'dead' ? 0.1 : 0);
    camera.position.set(d.pos.x, d.pos.y - 0.06, d.pos.z); E.set(d.pitch + Math.sin(shake * 1.7) * j, d.yaw + Math.sin(shake * 1.1) * j, (d.state === 'dead' ? Math.sin(d.spin * 6) * 0.8 : -d.tilt.y * 0.12) + Math.sin(shake * 2.3) * j); camera.quaternion.setFromEuler(E); camera.position.addScaledVector(A.set(0, 0, -1).applyQuaternion(camera.quaternion), 0.2);
    if (Math.abs(camera.fov - d.fov) > 0.01) { camera.fov = d.fov; camera.updateProjectionMatrix(); }
    if (feel) feel(camera);
  }
  d.camFn = cam; return d;
}

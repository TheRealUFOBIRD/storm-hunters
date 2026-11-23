// Tool belt: selection, aiming (foot + vehicle roof mode), view-models, camera / scanner / optics logic.
import * as THREE from 'three';
import { clamp, damp, lerp, dirToHeading, TAU, smoothstep } from '../core/math.js';
import { camFrom, scorePhoto, fovFromMm } from './photo.js';
import { approach, motionOf } from './track.js';
import { gearValue } from './profile.js';
import { velLUT, dbzLUT } from '../ui/palette.js';
import { createDrone } from './drone.js';
import { createProbes } from './probes.js';
import { cameraModel, scannerModel, binoModel, meterModel, controllerModel, probeModel, balloonModel } from './models.js';

export const TOOLS = [
  { id: 'camera', name: 'Camera', key: 'tool1', icon: 'camera', hint: 'Hold RMB to frame, LMB to shoot, wheel to zoom' },
  { id: 'scanner', name: 'Doppler', key: 'tool2', icon: 'scanner', hint: 'Hold LMB on the funnel and sweep up and down' },
  { id: 'probe', name: 'Probes', key: 'tool3', icon: 'probe', hint: 'Tap to drop, hold to anchor' },
  { id: 'drone', name: 'Drone', key: 'tool4', icon: 'drone', hint: 'LMB to launch, WASD to fly' },
  { id: 'binoculars', name: 'Rangefinder', key: 'tool5', icon: 'binoculars', hint: 'Hold RMB to range a tornado' },
  { id: 'anemometer', name: 'Field meter', key: 'tool6', icon: 'meter', hint: 'Reads wind and hail. RMB launches a balloon' },
];
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ'), AX = { x: 0, z: 0 }, AP = {};
export const TILTS = 8;

export function createTools(ctx, profile, G) {
  const probes = createProbes(ctx, profile), drone = createDrone(ctx, profile);
  const st = {
    active: null, aiming: false, raise: 0, mm: 35, fov: 72, steady: 1, focus: 0, shutter: 0, cool: 0, subject: null, subjT: 0, roof: false, yaw: 0, pitch: 0, hold: 0, dropHold: 0, spread: 0,
    scan: { on: false, target: null, tilts: new Float32Array(TILTS), quality: 0, progress: 0, reason: '', locked: false, heading: 0, done: {}, sweep: 0, drawT: 0, ef: 0 },
    range: { target: null, dist: 0, heading: 0, motion: 0, speed: 0, ef: null, closing: 0, t: 0 },
    meter: { wind: 0, gust: 0, peak: 0, dir: 0, temp: 0, dew: 0, hail: 0, p: 0, spin: 0 }, balloonCd: 0, balloon: null, sounding: null,
  };
  const scanCanvas = document.createElement('canvas'); scanCanvas.width = 384; scanCanvas.height = 256; const sg = scanCanvas.getContext('2d');
  const grid = new ImageData(64, 64), lightning = [], bestBySubject = {}, lastDir = new THREE.Vector3(0, 0, -1), velField = new Float32Array(64 * 64);
  ctx.events.on('lightning', (l) => { lightning.push({ ...l, t: ctx.time.now }); if (lightning.length > 12) lightning.shift(); });

  // ---------- view models ----------
  const vm = new THREE.Group(); vm.name = 'viewmodel'; const inner = new THREE.Group(); vm.add(inner); const built = {}; let shown = null, sway = { x: 0, y: 0, bob: 0, k: 0 }, vmIn = 0;
  const POSE = { camera: [0.17, -0.2, -0.43, 0.02, 0.1, 0], scanner: [0.17, -0.26, -0.45, 0.1, 0.06, 0], probe: [0, -0.42, -0.62, 0.25, 0.4, 0], drone: [0, -0.24, -0.46, 0.45, 0, 0], binoculars: [0.04, -0.2, -0.4, 0.15, 0.1, 0], anemometer: [0.17, -0.14, -0.4, -0.05, -0.18, 0.04] };
  const AIM = { camera: [0, -0.05, -0.2], scanner: [0.1, -0.22, -0.4], binoculars: [0, -0.03, -0.14], anemometer: [0.08, -0.07, -0.3] };
  const MODEL = { camera: cameraModel, scanner: scannerModel, probe: () => probeModel(true), drone: controllerModel, binoculars: binoModel, anemometer: meterModel };
  const key = new THREE.DirectionalLight(0xfff1dd, 2.2), fill = new THREE.HemisphereLight(0xb8c8d8, 0x4a4436, 1.1), rim = new THREE.DirectionalLight(0x9fc4ff, 0.5); let lit = false;
  function model(id) { if (!built[id] && MODEL[id]) { const g = MODEL[id](); const p = POSE[id]; g.userData.base = p; g.visible = false; inner.add(g); built[id] = g; } return built[id]; }
  function syncView(dt) {
    if (!ctx.viewScene) return; if (!lit) { lit = true; ctx.viewScene.add(vm, key, key.target, fill, rim, rim.target); }
    const drive = ctx.player.mode === 'drive', want = st.active && ctx.state === 'playing' && !drone.active && ctx.player.mode !== 'swept' && (!drive || st.roof) ? st.active : null;
    if (want !== shown) { vmIn = Math.max(0, vmIn - dt * 5); if (vmIn <= 0) { if (shown && built[shown]) built[shown].visible = false; shown = want; if (want) model(want).visible = true; } } else vmIn = Math.min(1, vmIn + dt * 3.4);
    vm.visible = !!shown; if (!shown) return; const c = ctx.camera; c.updateMatrixWorld(); vm.position.setFromMatrixPosition(c.matrixWorld); vm.quaternion.setFromRotationMatrix(c.matrixWorld);
    const g = built[shown], p = POSE[shown], a = AIM[shown], r = smoothstep(0, 1, st.raise), out = 1 - smoothstep(0, 1, vmIn), m = ctx.input.mouse, I = ctx.input;
    sway.x = damp(sway.x, clamp((m.dx || 0) * -0.0006, -0.03, 0.03), 9, dt); sway.y = damp(sway.y, clamp((m.dy || 0) * 0.0006, -0.03, 0.03), 9, dt);
    const sp = drive ? 0 : Math.min(1, Math.hypot(I.axis('moveX') || 0, I.axis('moveY') || 0)); sway.k = damp(sway.k, sp, 6, dt); sway.bob += dt * (I.down('sprint') ? 11 : 7.5) * (0.15 + sway.k); const b = sway.k * (1 - r * 0.8);
    let hide = 0, x = p[0], y = p[1], z = p[2], rx = p[3], ry = p[4], rz = p[5]; if (a) { x = lerp(x, a[0], r); y = lerp(y, a[1], r); z = lerp(z, a[2], r); rx = lerp(rx, 0, r); ry = lerp(ry, 0, r); rz = lerp(rz, 0, r); hide = (shown === 'camera' || shown === 'binoculars') && r > 0.86; }
    if (shown === 'probe') { const d = clamp(st.dropHold / 1.4); y -= d * 0.12; rx += d * 0.5; } if (shown === 'camera' && st.shutter > 0) { z += st.shutter * 0.02; rx += st.shutter * 0.03; }
    g.visible = !hide; inner.position.set(x + sway.x + Math.sin(sway.bob) * 0.006 * b, y + sway.y - Math.abs(Math.cos(sway.bob)) * 0.008 * b - out * 0.32 + Math.sin(ctx.time.real * 1.3) * 0.0016, z); inner.rotation.set(rx - out * 0.9 + sway.y * 2, ry + sway.x * 3, rz + Math.sin(sway.bob) * 0.012 * b);
    const gl = ctx.globals, sun = gl.uSunDir.value, dark = gl.uStormDark.value || 0, day = clamp(sun.y * 3 + 0.25, 0.04, 1), si = ctx.gfx?.sun?.intensity; key.position.copy(vm.position).addScaledVector(sun, 10); key.target.position.copy(vm.position); key.color.copy(gl.uSunColor.value); const mx = Math.max(key.color.r, key.color.g, key.color.b, 0.001); if (mx > 1) key.color.multiplyScalar(1 / mx); const sc = ctx.gfx?.viewLightScale ?? 1;
    key.intensity = (si != null ? Math.min(si, 6) : 2.2) * (1 - dark * 0.75) * day * sc; fill.intensity = (0.35 + 0.9 * day) * (1 - dark * 0.45) * sc * (ctx.viewScene.environment || ctx.scene.environment ? 0.45 : 1); rim.position.copy(vm.position).add(V.set(-6, 4, 4).applyQuaternion(vm.quaternion)); rim.target.position.copy(vm.position); rim.intensity = 0.4 * day * sc + 0.08;
    if (ctx.scene.environment && ctx.viewScene.environment !== ctx.scene.environment && !ctx.gfx?.viewEnv) { ctx.viewScene.environment = ctx.scene.environment; ctx.viewScene.environmentIntensity = ctx.scene.environmentIntensity ?? 1; }
    const u = g.userData;
    if (shown === 'scanner') { u.dish.rotation.z += 0; u.dish.rotation.y = Math.sin(ctx.time.real * 5) * 0.05 * (st.scan.on ? 1 : 0); u.ring.material.color.setRGB(...(st.scan.on ? [3, 1.2, 0.2] : [0.5, 0.22, 0.05])); scrBlit(u, scanCanvas); }
    if (shown === 'anemometer') { u.impeller.rotation.z += dt * st.meter.wind * 2.2; drawMeter(u); } if (shown === 'camera') drawCamScreen(u); if (shown === 'drone') drawCtl(u);
  }
  const scrBlit = (u, src) => { const g = u.canvas.getContext('2d'); g.drawImage(src, 0, 0, u.canvas.width, u.canvas.height); u.screen.userData.tex.needsUpdate = true; };
  const font = (s, w = 600) => `${w} ${s}px Bahnschrift, "Arial Narrow", sans-serif`;
  function drawMeter(u) { if (ctx.time.frame % 8) return; const g = u.canvas.getContext('2d'), w = 192, h = 256, m = st.meter, met = ctx.settings.get('units') === 'metric'; g.fillStyle = '#b9c4a0'; g.fillRect(0, 0, w, h); g.fillStyle = '#1c2116'; g.font = font(22); g.textAlign = 'left'; g.fillText('WIND ' + (met ? 'km/h' : 'mph'), 14, 34); g.font = font(86, 700); g.textAlign = 'right'; g.fillText(String(Math.round(m.wind * (met ? 3.6 : 2.237))), 178, 112); g.font = font(24); g.textAlign = 'left'; g.fillText('MAX ' + Math.round(m.peak * (met ? 3.6 : 2.237)), 14, 152); g.fillText(`${met ? m.temp.toFixed(1) + ' C' : Math.round(m.temp * 1.8 + 32) + ' F'}`, 14, 186); g.fillText(m.hail > 0.1 ? 'HAIL ' + (m.hail * 8).toFixed(1) + 'cm' : `${Math.round(m.p)} hPa`, 14, 220); g.fillRect(14, 234, 164 * clamp(m.wind / 60), 8); u.screen.userData.tex.needsUpdate = true; }
  function drawCamScreen(u) { if (ctx.time.frame % 12) return; const g = u.canvas.getContext('2d'); g.fillStyle = '#05070a'; g.fillRect(0, 0, 240, 160); g.fillStyle = '#e8e2d0'; g.font = font(26); g.textAlign = 'left'; g.fillText('M', 14, 34); g.fillText(`${Math.round(st.mm)}mm`, 150, 34); g.font = font(34, 700); g.fillText('1/500', 14, 92); g.fillText('F4', 130, 92); g.fillStyle = '#ffb000'; g.font = font(24); g.fillText('ISO 800', 14, 138); g.fillText(String(Math.max(0, 999 - profile.data.stats.photos)), 176, 138); u.screen.userData.tex.needsUpdate = true; }
  function drawCtl(u) { if (ctx.time.frame % 12) return; const g = u.canvas.getContext('2d'); g.fillStyle = '#080a08'; g.fillRect(0, 0, 320, 200); g.strokeStyle = '#4b4733'; g.lineWidth = 2; g.beginPath(); for (let i = 1; i < 4; i++) { g.moveTo(i * 80, 0); g.lineTo(i * 80, 200); } g.moveTo(0, 100); g.lineTo(320, 100); g.stroke(); g.fillStyle = drone.cooldown > 0 ? '#ff4438' : '#4be37a'; g.font = font(34, 700); g.textAlign = 'center'; g.fillText(drone.cooldown > 0 ? `AIRFRAME ${Math.ceil(drone.cooldown)}s` : 'READY', 160, 92); g.fillStyle = '#ffb000'; g.font = font(22); g.fillText(`WIND ${Math.round(st.meter.wind * 2.237)} MPH`, 160, 140); u.screen.userData.tex.needsUpdate = true; }

  // ---------- helpers ----------
  const maxMm = () => gearValue(profile.data, 'lens', 'max');
  const heading = () => { ctx.camera.getWorldDirection(V); return dirToHeading(V.x, V.z); };
  const eyePos = () => ctx.camera.position;
  function roofPos(v, out) {
    const m = v.mounts?.roof, o = v.object3d; if (m?.isObject3D) { m.getWorldPosition(out); } else if (m && m.x != null && v.quat) out.set(m.x, m.y, m.z).applyQuaternion(v.quat).add(v.pos); else out.copy(v.pos).add(V3.set(0, 1.9, 0).applyQuaternion(v.quat || Q.identity())); void o; return out;
  }
  function roofCam(camera, dt) {
    const v = ctx.player.vehicle; if (!v) return; const I = ctx.input, sens = 0.0021 * (ctx.settings.get('mouseSens') || 1) * (st.fov / 72); st.yaw -= (I.mouse.dx || 0) * sens + (I.axis('lookX') || 0) * dt * 2 * (st.fov / 72); st.pitch = clamp(st.pitch - ((I.mouse.dy || 0) * sens + (I.axis('lookY') || 0) * dt * 1.5 * (st.fov / 72)) * (ctx.settings.get('invertY') ? -1 : 1), -0.9, 1.3);
    roofPos(v, V2); V2.y += 0.55; camera.position.copy(V2); const sh = clamp((v.speed || 0) / 30) * 0.004 * (1 - gearValue(profile.data, 'lens', 'steady')); E.set(st.pitch + Math.sin(ctx.time.real * 17) * sh, st.yaw + Math.sin(ctx.time.real * 13) * sh, 0); camera.quaternion.setFromEuler(E); if (Math.abs(camera.fov - st.fov) > 0.01) { camera.fov = st.fov; camera.updateProjectionMatrix(); }
  }
  function setRoof(on) {
    if (on === st.roof) return; st.roof = on;
    if (on) { ctx.camera.getWorldDirection(V); st.yaw = Math.atan2(-V.x, -V.z); st.pitch = Math.asin(clamp(V.y, -0.5, 0.5)); ctx.player.cameraOverride = roofCam; } else { if (ctx.player.cameraOverride === roofCam) ctx.player.cameraOverride = null; if (ctx.camera.fov !== ctx.settings.get('fov')) { ctx.camera.fov = ctx.settings.get('fov'); ctx.camera.updateProjectionMatrix(); } }
  }
  function shotInput() {
    const c = ctx.camera, S = ctx.storms, now = ctx.time.now; c.updateMatrixWorld(); const cam = camFrom(c), w = S.weatherAt?.(cam.x, cam.z) || {}; const dir = c.getWorldDirection(V);
    const ahead = S.weatherAt ? S.weatherAt(cam.x + dir.x * 1800, cam.z + dir.z * 1800)?.rain || 0 : 0; const wk = { rain: w.rain, hail: w.hail, dark: w.dark }; const w2 = S.weatherAt?.(cam.x, cam.z); wk.rain = w2?.rain || 0; wk.hail = w2?.hail || 0;
    return { cam, now, tornadoes: S.tornadoes, storms: S.list, axisAt: (t, h, o) => S.axisAt(t, h, o), funnelRadius: S.funnelRadius ? (t, h) => S.funnelRadius(t, h) : null, groundY: cam.y, lightning: lightning.map((l) => ({ ...l, age: now - l.t })).filter((l) => l.age < 0.6), weather: wk, rainAhead: ahead, hour: ctx.time.hour, sunDir: ctx.globals.uSunDir.value.toArray(), steady: clamp(st.steady + gearValue(profile.data, 'lens', 'steady') * (1 - st.steady)), focus: drone.active ? 1 : st.focus,
      visibility: ctx.gfx?.visibilityAlong ? (x, y, z) => ctx.gfx.visibilityAlong(x, y, z) : (x, y, z) => { const d = Math.hypot(x - cam.x, z - cam.z); return Math.exp(-d / Math.max(2500, (w.visibility || 12000) * 1.2)); },
      occluded: (x, y, z) => { V.set(x - cam.x, y - cam.y, z - cam.z); const L = V.length(); V.divideScalar(L); V2.set(cam.x, cam.y, cam.z); const d = ctx.world.raycastTerrain?.(V2, V, Math.min(L, 6000)) ?? -1; return d > 0 && d < L - 120; },
      landmarks: ctx.world.landmarks || (ctx.world.cities || []).filter((k) => k.pop > 60000).map((k) => ({ name: k.name, x: k.x, y: cam.y, z: k.z, range: 3500 })), city: ctx.world.nearestCity?.(cam.x, cam.z)?.name };
  }
  async function takePhoto() {
    if (st.cool > 0) return; st.cool = 1.05; st.shutter = 1; ctx.audio?.play?.('shutter'); const S = shotInput(), r = scorePhoto(S), p = profile.data; ctx.events.emit('photo:shutter', {});
    const prev = bestBySubject[r.id] || 0; r.base = r.value; r.value = Math.max(0, Math.round((r.value - prev + (prev ? r.value * 0.04 : 0)) / 5) * 5); if (r.subject === 'landscape') r.value = Math.round(r.value * 0.3); bestBySubject[r.id] = Math.max(prev, r.base); r.repeat = prev > 0;
    if (r.tornado != null && !p.stats.seen.includes('t' + r.tornado)) { p.stats.seen.push('t' + r.tornado); if (p.stats.seen.length > 60) p.stats.seen.shift(); p.stats.tornadoes++; }
    const photo = { id: Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), score: r.score, stars: r.stars, title: r.title, subject: r.subject, tags: r.tags, value: r.value, dist: Math.round(r.dist), ef: r.ef, mm: Math.round(st.mm), place: S.city || '', hour: S.hour, date: Date.now(), parts: r.parts, url: '' };
    try { const cap = await (ctx.gfx?.capture ? ctx.gfx.capture(960, 540) : null); const src = cap?.canvas || (ctx.gfx?.capture ? null : ctx.canvas); if (src) { const c = document.createElement('canvas'); c.width = 480; c.height = 270; const g = c.getContext('2d'); g.drawImage(src, 0, 0, 480, 270); photo.url = c.toDataURL('image/jpeg', 0.74); } } catch (e) { console.warn('[photo] capture failed', e?.message); }
    if (r.value) profile.earn(r.value, 'Photo: ' + r.title); profile.addRep(Math.round(r.score / 28) * (r.repeat ? 0.3 : 1)); profile.addPhoto(photo); ctx.events.emit('photo:taken', { ...r, result: r, photo }); G.onPhoto?.(r); return photo;
  }
  // ---------- doppler ----------
  function scanUpdate(dt, firing) {
    const s = st.scan, S = ctx.storms, c = ctx.camera; s.on = firing; s.drawT -= dt; const p = eyePos(); c.getWorldDirection(V); s.heading = dirToHeading(V.x, V.z); const elev = Math.asin(clamp(V.y, -1, 1));
    const R = gearValue(profile.data, 'scanner', 'range'); let best = null, ba = 0.2; for (const t of S.tornadoes) { if (t.stage === 'dead') continue; const d = Math.hypot(t.x - p.x, t.z - p.z); if (d > R * 1.25) continue; let a = Math.abs(dirToHeading(t.x - p.x, t.z - p.z) - s.heading); if (a > Math.PI) a = TAU - a; const w = a - Math.atan(t.rCore * 1.5 / d); if (w < ba) { ba = w; best = t; } }
    if (best && s.target !== best.id) { s.target = best.id; s.tilts.fill(0); s.ef = best.ef || 0; s.completed = !!s.done[best.id]; } s.t = best; s.locked = false; s.reason = '';
    if (!firing) s.quality = damp(s.quality, 0, 3, dt); else if (!best) { s.reason = 'No rotation in beam'; s.quality = damp(s.quality, 0, 4, dt); }
    else {
      const d = Math.hypot(best.x - p.x, best.z - p.z), top = Math.atan2(best.lcl || 900, d), lo = -0.06, k = clamp((elev - lo) / Math.max(0.08, top - lo)); V2.copy(p); V3.set(best.x - p.x, (best.y0 || 0) + 120 - p.y, best.z - p.z); const L = V3.length(); V3.divideScalar(L); const hit = ctx.world.raycastTerrain?.(V2, V3, Math.min(L, 7000)) ?? -1, blocked = hit > 0 && hit < L - 200; const rain = S.weatherAt?.(p.x, p.z)?.rain || 0;
      const qd = smoothstep(R, 1200, d) * smoothstep(60, 220, d) * 0.9 + 0.1 * (d < R), qa = 1 - smoothstep(0.02, 0.12, Math.max(0, ba)), qs = 0.35 + 0.65 * st.steady, q = blocked || d > R ? 0 : qd * qa * qs * (1 - rain * 0.4); s.reason = blocked ? 'Beam blocked by terrain' : d > R ? 'Out of range' : qa < 0.3 ? 'Re-centre the beam' : q < 0.25 ? 'Weak return' : ''; s.quality = damp(s.quality, q, 5, dt); s.locked = q > 0.2; s.dist = d;
      const ti = Math.min(TILTS - 1, Math.floor(k * TILTS)); s.tilt = ti; if (!s.completed) { const rate = s.quality * dt * 0.62 * gearValue(profile.data, 'scanner', 'rate'); s.tilts[ti] = Math.min(1, s.tilts[ti] + rate); if (ti > 0) s.tilts[ti - 1] = Math.min(1, s.tilts[ti - 1] + rate * 0.3); if (ti < TILTS - 1) s.tilts[ti + 1] = Math.min(1, s.tilts[ti + 1] + rate * 0.3); s.qSum = (s.qSum || 0) * (1 - dt * 0.1) + s.quality * dt; }
      let sum = 0; for (const v of s.tilts) sum += v; s.progress = sum / TILTS; s.ef = Math.max(best.ef || 0, s.completed ? s.ef : 0);
      s.evT = (s.evT || 0) - dt; if (s.evT <= 0) { s.evT = 0.4; ctx.events.emit('scan:progress', { id: best.id, progress: s.progress, quality: s.quality, ef: best.ef || 0 }); }
      if (s.progress > 0.97 && !s.completed) { s.completed = true; s.done[best.id] = 1; const ql = clamp(0.35 + s.quality * 0.75), pay = Math.round((500 + (best.ef || 0) * 380) * 2.4 * ql / 10) * 10; s.last = { ql, pay, vmax: best.vmax, ef: best.ef }; profile.data.stats.scans++; profile.earn(pay, 'Doppler volume'); profile.addRep(30 + (best.ef || 0) * 12); ctx.events.emit('scan:complete', { id: best.id, quality: Math.max(ql, 0.62), ef: best.ef || 0, vmax: best.vmax, pay }); }
    }
    if (st.active === 'scanner' && s.drawT <= 0) { s.drawT = 0.12; drawScan(p); }
  }
  function drawScan(p) {
    const s = st.scan, S = ctx.storms, t = s.t, R = 1400, g = sg; s.sweep = (s.sweep + 0.5) % TAU;
    g.fillStyle = '#0b0c08'; g.fillRect(0, 0, 384, 256);
    if (t && S.velocity) { const d = grid.data; for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) { const x = t.x + (i / 63 - 0.5) * 2 * R, z = t.z + (j / 63 - 0.5) * 2 * R; const n = (j * 64 + i) * 4, rr = Math.hypot(i - 31.5, j - 31.5) / 32; let v = S.velocity(x, z, p.x, p.z) + (Math.random() - 0.5) * (9 - s.quality * 8); if (rr > 1) { d[n + 3] = 0; continue; } const li = clamp(Math.round((v + 64) * 2), 0, 256) * 4; d[n] = velLUT[li]; d[n + 1] = velLUT[li + 1]; d[n + 2] = velLUT[li + 2]; d[n + 3] = (60 + 195 * clamp(s.quality * 1.5 + (s.completed ? 0.5 : 0))) | 0; } tmp.putImageData(grid, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(tmpC, 8, 14, 228, 228); }
    g.strokeStyle = 'rgba(242,234,214,.28)'; g.lineWidth = 1; for (const r of [38, 76, 114]) { g.beginPath(); g.arc(122, 128, r, 0, TAU); g.stroke(); } g.beginPath(); g.moveTo(8, 128); g.lineTo(236, 128); g.moveTo(122, 14); g.lineTo(122, 242); g.stroke(); g.strokeStyle = s.on ? '#ffb000' : 'rgba(255,176,0,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(122, 128); g.lineTo(122 + Math.cos(s.sweep) * 114, 128 + Math.sin(s.sweep) * 114); g.stroke();
    g.fillStyle = '#f2ead6'; g.font = font(17); g.textAlign = 'left'; g.fillText('VEL 0.5', 250, 26); g.fillStyle = '#a79f88'; g.font = font(13); g.fillText('VOLUME', 250, 52);
    for (let i = 0; i < TILTS; i++) { const y = 214 - i * 20; g.fillStyle = '#24241a'; g.fillRect(250, y, 96, 14); g.fillStyle = s.tilts[i] > 0.97 ? '#4be37a' : '#ffb000'; g.fillRect(250, y, 96 * s.tilts[i], 14); if (s.on && s.locked && s.tilt === i) { g.strokeStyle = '#f2ead6'; g.lineWidth = 2; g.strokeRect(249, y - 1, 98, 16); } g.fillStyle = '#a79f88'; g.font = font(11); g.fillText(String(i + 1), 352, y + 11); }
    g.fillStyle = '#f2ead6'; g.font = font(20, 700); g.fillText(Math.round(s.progress * 100) + '%', 250, 248); if (t && s.locked) { g.font = font(14); g.textAlign = 'right'; g.fillText(Math.round((t.vmax || 0) * 2.237 * (0.9 + s.quality * 0.1)) + ' MPH', 376, 248); }
  }
  const tmpC = document.createElement('canvas'); tmpC.width = tmpC.height = 64; const tmp = tmpC.getContext('2d'); void velField; void dbzLUT;
  // ---------- rangefinder ----------
  function rangeUpdate(dt) {
    const r = st.range, p = eyePos(); ctx.camera.getWorldDirection(V); const h = dirToHeading(V.x, V.z); r.heading = h; let best = null, ba = 0.12; for (const t of ctx.storms.tornadoes) { if (t.stage === 'dead') continue; const d = Math.hypot(t.x - p.x, t.z - p.z); let a = Math.abs(dirToHeading(t.x - p.x, t.z - p.z) - h); if (a > Math.PI) a = TAU - a; a -= Math.atan((t.rTop || 200) / d); if (a < ba && d < 16000) { ba = a; best = t; } }
    if (best) { if (r.target !== best.id) { r.t = 0; r.target = best.id; } r.t += dt; const v = ctx.player.vehicle?.vel; approach(best, p.x, p.z, 0, 0, AP); void v; r.dist = AP.now; r.motion = AP.heading; r.speed = AP.speed; r.closing = AP.closing; r.cpa = AP.dist; r.eta = AP.t; r.ef = r.t > 1.6 ? best.ef || 0 : null; r.tObj = best; } else { r.target = null; r.t = 0; const d = ctx.world.raycastTerrain?.(V2.copy(p), V, 5000) ?? -1; r.dist = d; r.tObj = null; }
  }
  function meterUpdate(dt) {
    const m = st.meter, p = ctx.player.pos || eyePos(), S = ctx.storms; S.windAt(p.x, (p.y || 0) + 1.8, p.z, V); m.wind = damp(m.wind, Math.hypot(V.x, V.z), 4, dt); m.gust = Math.max(m.wind, m.gust - dt * 2); m.dir = dirToHeading(-V.x, -V.z); const w = S.weatherAt?.(p.x, p.z); if (w) { m.temp = w.temp; m.dew = w.dewpoint; m.hail = w.hail || 0; } m.p = S.pressureAt?.(p.x, p.y || 0, p.z) ?? 1000; if (st.active === 'anemometer') m.peak = Math.max(m.peak, m.wind); profile.data.stats.maxWind = Math.max(profile.data.stats.maxWind, m.wind);
  }
  function launchBalloon() {
    if (st.balloonCd > 0) { ctx.ui?.notify?.({ title: 'Balloon not ready', text: `Next sonde in ${Math.ceil(st.balloonCd)} s`, kind: 'info' }); return; } st.balloonCd = 240; const o = balloonModel(), p = ctx.player.pos; o.position.set(p.x, (p.y || 0) + 1.4, p.z); ctx.scene.add(o); st.balloon = { o, t: 0, vx: 0, vz: 0 }; ctx.events.emit('balloon:launch', {}); ctx.ui?.notify?.({ title: 'Sonde released', text: 'Sounding in a few seconds', kind: 'info' });
  }
  function balloonUpdate(dt) {
    if (st.balloonCd > 0) st.balloonCd -= dt; const b = st.balloon; if (!b) return; b.t += dt; ctx.storms.windAt(b.o.position.x, b.o.position.y, b.o.position.z, V); b.vx = damp(b.vx, V.x * 0.8, 1, dt); b.vz = damp(b.vz, V.z * 0.8, 1, dt); b.o.position.x += b.vx * dt; b.o.position.z += b.vz * dt; b.o.position.y += dt * 5.4; b.o.rotation.z = clamp(-b.vx * 0.03, -0.5, 0.5); b.o.rotation.x = clamp(b.vz * 0.03, -0.5, 0.5);
    if (b.t > 7 && !b.sent) { b.sent = true; const p = ctx.player.pos, s = sounding(ctx.storms, p.x, p.z); st.sounding = s; const pay = 180 + Math.round(s.cape / 12); profile.earn(pay, 'Sounding'); profile.addRep(12); ctx.events.emit('sounding', { ...s, pay }); } if (b.t > 45) { ctx.scene.remove(b.o); st.balloon = null; }
  }

  // ---------- selection + update ----------
  function select(id) {
    if (id === st.active) id = null; if (id && !TOOLS.some((t) => t.id === id)) return; if (drone.active && id !== 'drone') drone.recall(); st.active = id; st.hold = 0; st.dropHold = 0; aim(false); ctx.events.emit('tool:select', { id });
  }
  function aim(on) { if (st.aiming === on) return; st.aiming = on; st.focus = 0; if (!on) { setRoof(false); try { ctx.player.fovOverride = null; } catch { /* ro */ } } else if (ctx.player.mode === 'drive') setRoof(true); ctx.events.emit('tool:aim', { on, id: st.active }); }
  const cycle = (d) => { const i = TOOLS.findIndex((t) => t.id === st.active), n = TOOLS.length, j = i < 0 ? (d > 0 ? 0 : n - 1) : (i + d + n) % n; select(TOOLS[j].id); };
  function placeProbe(secured) {
    const P = ctx.player, v = P.mode === 'drive' ? P.vehicle : null; let x, z; if (v) { V.set(0, 0, 1).applyQuaternion(v.quat || Q.identity()); x = v.pos.x + V.x * 4.4; z = v.pos.z + V.z * 4.4; } else { ctx.camera.getWorldDirection(V); const l = Math.hypot(V.x, V.z) || 1; x = P.pos.x + V.x / l * 1.1; z = P.pos.z + V.z / l * 1.1; }
    const n = probes.nearest(x, z, 0.9); if (n) return; return probes.deploy(x, z, secured);
  }
  function update(dt) {
    const I = ctx.input, P = ctx.player, playing = ctx.state === 'playing', free = playing && !I.uiBlock && P.mode !== 'swept', foot = P.mode === 'foot', drive = P.mode === 'drive';
    st.cool -= dt; st.shutter = Math.max(0, st.shutter - dt * 4.5); probes.update(dt); meterUpdate(dt); balloonUpdate(dt);
    if (free) { for (const t of TOOLS) if (I.pressed(t.key)) select(t.id); if (I.pressed('tool0')) select(null); if (I.pressed('toolPrev')) cycle(1); if (I.pressed('toolNext')) cycle(-1); if (I.mouse.wheel && foot && !st.aiming && !drone.active) cycle(I.mouse.wheel > 0 ? 1 : -1); }
    // steadiness from camera rotation + motion + wind
    ctx.camera.getWorldDirection(V); const ang = V.angleTo(lastDir) / Math.max(dt, 1e-3); lastDir.copy(V); const veh = P.vehicle, mv = drone.active ? drone.wind * 0.25 : drive ? (veh?.speed || 0) : Math.hypot(I.axis('moveX') || 0, I.axis('moveY') || 0) * 4; st.steady = damp(st.steady, 1 - clamp(ang * (st.mm / 60) * 0.9 + mv * 0.022 + st.meter.wind * 0.006, 0, 1), ang > 0.2 ? 14 : 3, dt);
    const id = st.active, canAim = free && (id === 'camera' || id === 'binoculars' || ((id === 'scanner' || id === 'anemometer') && drive)) && !drone.active;
    const padAim = I.usingPad && I.pad?.buttons[6]?.pressed && !drive, usePress = free && (I.pressed('use') || (I.mouse.leftPressed && I.captured !== false) || (I.usingPad && !drive && I.pressed('use'))), useHeld = free && (I.down('use') || I.mouse.left);
    const wantAim = canAim && (I.mouse.right || padAim || (drive && id === 'scanner' && useHeld) || (drive && id === 'camera' && st.roof && useHeld)); aim(!!wantAim); st.raise = clamp(st.raise + (st.aiming ? dt * 5.5 : -dt * 6));
    if (st.aiming || drone.active) { if (I.mouse.wheel && free) { const z = Math.pow(1.22, -I.mouse.wheel); st.mm = clamp(st.mm * z, 24, drone.active ? 85 : maxMm()); } } st.mm = Math.min(st.mm, maxMm());
    const base = ctx.settings.get('fov') || 72, want = id === 'camera' ? fovFromMm(st.mm) : id === 'binoculars' ? 9 : base; st.fov = damp(st.fov, st.aiming ? want : base, 14, dt);
    if (st.aiming && !st.roof) { try { P.fovOverride = st.fov; } catch { /* ro */ } } if (drone.active) drone.fov = damp(drone.fov, fovFromMm(st.mm), 10, dt);
    if (st.aiming || drone.active) st.focus = damp(st.focus, ang > 1.6 ? 0.15 : 1, ang > 1.6 ? 8 : 3.6, dt); else st.focus = damp(st.focus, 0.2, 2, dt);
    // per tool
    if (id === 'camera' && (st.aiming || drone.active)) { st.subjT -= dt; if (st.subjT <= 0) { st.subjT = 0.25; try { st.subject = scorePhoto(shotInput()); } catch { st.subject = null; } } } else if (!drone.active) st.subject = null;
    if (drone.active) {
      st.subjT -= dt; if (st.subjT <= 0) { st.subjT = 0.3; st.subject = scorePhoto(shotInput()); } if (free && I.mouse.leftPressed && drone.state === 'fly') takePhoto(); if (free && I.pressed('use')) { if (drone.canLand) drone.recall('landed'); else { st.recallT = (st.recallT || 0) + 1; ctx.ui?.notify?.({ title: 'Return to land', text: 'Fly back within 10 m, or hold F to abandon it.', kind: 'info', ttl: 3 }); } } st.hold = free && I.down('use') ? st.hold + dt : 0; if (st.hold > 1.6) { drone.destroy('Abandoned'); st.hold = 0; }
    } else if (id === 'camera') { if (usePress && st.aiming) takePhoto(); else if (usePress && foot && I.mouse.leftPressed && st.raise < 0.1) { /* needs aim */ } }
    else if (id === 'drone') { if (usePress && (foot || (drive && (veh?.speed || 0) < 3))) { if (drone.cooldown > 0) ctx.ui?.notify?.({ title: 'Drone not ready', text: `Airframe swap ${Math.ceil(drone.cooldown)} s`, kind: 'info' }); else if (st.meter.wind > 30) ctx.ui?.notify?.({ title: 'Too windy to launch', text: 'Find shelter or get further out.', kind: 'warn' }); else { if (drive) roofPos(veh, V2); else V2.copy(eyePos()); ctx.camera.getWorldDirection(V); const h = dirToHeading(V.x, V.z); if (!drive) { V2.x += Math.sin(h) * 1.5; V2.z -= Math.cos(h) * 1.5; V2.y -= 0.4; } st.mm = 24; drone.launch(V2.x, V2.y + (drive ? 0.6 : 0), V2.z, h); } } }
    else if (id === 'probe') {
      const pp = foot ? probes.nearest(P.pos.x, P.pos.z, 2.6) : null; st.nearProbe = pp;
      if (pp && !pp.secured && pp.state === 'live') { if (useHeld) { st.dropHold += dt; if (st.dropHold > 1.4) { probes.secure(pp); st.dropHold = 0; st.needUp = true; } } else st.dropHold = 0; }
      else if (pp && useHeld && !st.needUp) { st.dropHold += dt; if (st.dropHold > 1.1) { probes.retrieve(pp); st.dropHold = 0; st.needUp = true; ctx.ui?.notify?.({ title: 'Probe recovered', text: `${probes.stock} in the rack`, kind: 'good' }); } }
      else if (usePress && !st.needUp) { if (!drive || (veh?.speed || 0) < 14) { if (placeProbe(drive && (veh?.speed || 0) < 2)) st.needUp = true; } }
      if (!useHeld) { st.needUp = false; st.dropHold = 0; }
    } else if (id === 'anemometer' && free && foot && I.mouse.rightPressed) launchBalloon();
    if (id === 'scanner') scanUpdate(dt, useHeld && (foot || st.roof) && !drone.active); else { st.scan.on = false; st.scan.quality = damp(st.scan.quality, 0, 3, dt); }
    if (id === 'binoculars' && st.aiming) rangeUpdate(dt); else { st.range.target = null; st.range.t = 0; }
    drone.update(dt);
  }
  return { list: TOOLS, st, probes, drone, scanCanvas, select, cycle, update, syncView, takePhoto, shotInput, heading, resetShots() { for (const k in bestBySubject) delete bestBySubject[k]; }, clear() { aim(false); st.active = null; drone.clear(); probes.clear(); if (st.balloon) { ctx.scene.remove(st.balloon.o); st.balloon = null; } }, viewGroup: vm, motionOf, model, setMode(m) { st.raise = m; } };
}
// plausible sounding from environment: skew-T levels plus CAPE / shear / hodograph
export function sounding(storms, x, z) {
  const w = storms.weatherAt?.(x, z) || {}, T0 = w.temp ?? 28, D0 = w.dewpoint ?? 21, cape = storms.cape?.(x, z) ?? 2500, lv = [], lcl = Math.max(200, 125 * (T0 - D0));
  for (let i = 0; i <= 24; i++) {
    const h = i * 500, p = 1000 * Math.exp(-h / 8000), capL = h > 1200 && h < 2400 ? 2.2 * Math.sin((h - 1200) / 1200 * 3.14159) : 0;
    const t = h < 11500 ? T0 - 0.0067 * h - (cape - 2000) * 0.0006 * Math.min(1, h / 5000) + capL : T0 - 0.0067 * 11500, td = Math.min(t - 0.3, D0 - 0.0018 * Math.min(h, lcl * 1.3) - Math.max(0, h - lcl * 1.3) * 0.0088 + 5 * Math.sin(h / 1900));
    const sh = Math.min(1, h / 6000), a = lerp(2.7, 4.6, Math.min(1, h / 2500)), s = 7 + sh * 24 + Math.min(1, h / 12000) * 10; lv.push({ h, p, t, td, u: -Math.sin(a) * s * (h < 1500 ? 0.75 : 1), v: -Math.cos(a) * s * 0.8 });
  }
  // lifted parcel
  let tp = T0; const parcel = []; for (let i = 0; i <= 24; i++) { const h = i * 500; parcel.push({ p: lv[i].p, t: tp }); tp -= h < lcl ? 4.9 : lerp(2.1, 4.4, clamp(h / 9500)); }
  const shear = Math.hypot(lv[12].u - lv[0].u, lv[12].v - lv[0].v), srh = Math.round(90 + cape * 0.045 + shear * 4), stp = clamp(cape / 1500, 0, 4) * clamp(srh / 150, 0, 4) * clamp(shear / 20, 0, 1.5) * clamp((2000 - lcl) / 1000, 0, 1);
  return { levels: lv, parcel, cape: Math.round(cape), shear, srh, lcl: Math.round(lcl), stp: Math.round(stp * 10) / 10, x, z };
}

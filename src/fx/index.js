// FX system: precipitation, wind-blown litter, tornado debris & dust, lightning, sparks, wheel particles.
import * as THREE from 'three';
import { makeSoft, makeGround } from './common.js';
import { createParticles } from './particles.js';
import { createRain } from './rain.js';
import { createHail } from './hail.js';
import { createWindFx } from './wind.js';
import { createLightning } from './lightning.js';
import { createDebris, breakSet } from './debris.js';
import { createTornadoFx } from './tornadoFx.js';
import { damp, smoothstep } from '../core/math.js';

export async function create(ctx) {
  const soft = makeSoft(ctx), ground = makeGround(ctx); let particles, rain, hail, wind, bolts, debris, torn, built = [];
  const offs = [], camVel = new THREE.Vector3(), lastCam = new THREE.Vector3(1e9, 0, 0), W = new THREE.Vector3(), Ws = new THREE.Vector3(), wx = {}; let rainS = 0, hailS = 0, hailCm = 0, lensT = 0, flash = 0;
  function build() {
    const before = new Set([...ctx.fxScene.children, ...ctx.scene.children]); bolts?.dispose();
    particles = createParticles(ctx, soft, 5200 * ctx.quality.particles); rain = createRain(ctx, soft, ground); hail = createHail(ctx, soft, particles); wind = createWindFx(ctx, soft, ground); torn = createTornadoFx(ctx, soft, particles); debris = createDebris(ctx, particles); bolts = createLightning(ctx, particles);
    built = [...ctx.fxScene.children, ...ctx.scene.children].filter((o) => !before.has(o));
  }
  function teardown() { soft.reset(); for (const o of built) { o.parent?.remove(o); o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose()); } built = []; }
  build(); let qid = ctx.quality.id;
  offs.push(ctx.events.on('quality:changed', (p) => { if (p.id === qid) return; qid = p.id; teardown(); build(); }));
  offs.push(ctx.events.on('world:break', (e) => { if (!e?.pos) return; const d = Math.hypot(e.pos.x - ctx.camera.position.x, e.pos.z - ctx.camera.position.z); if (d < 2500) { debris.burst(e.kind, e.pos, e.vel); if (d < 900) breakDust(e); } }));
  offs.push(ctx.events.on('vehicle:impact', (e) => { if (e?.pos && e.speed > 5) api.spark(e.pos, Math.min(40, e.speed * 2)); }));
  offs.push(ctx.events.on('game:start', () => debris.clear()));
  function breakDust(e) {
    const big = /house|barn|build|silo|church|store|ware|motel/i.test(e.kind || ''), n = big ? 12 : 4, c = big ? [0.45, 0.41, 0.36] : ctx.world?.biomeAt?.(e.pos.x, e.pos.z)?.dustColor || [0.4, 0.3, 0.2]; ctx.storms?.windAt?.(e.pos.x, e.pos.y + 3, e.pos.z, W);
    for (let i = 0; i < n; i++) particles.emit(0, e.pos.x + (Math.random() - 0.5) * (big ? 8 : 2), e.pos.y + 0.5 + Math.random() * (big ? 4 : 1.5), e.pos.z + (Math.random() - 0.5) * (big ? 8 : 2), (Math.random() - 0.5) * 6, 1 + Math.random() * 3, (Math.random() - 0.5) * 6, 2 + Math.random() * 2.5, big ? 2 : 0.6, big ? 8 : 2.6, c[0], c[1], c[2], 0.5, 1.2, W.x * 0.7, Math.max(0, W.y * 0.5), W.z * 0.7);
    const tree = /tree|corn|bush|pine|oak/i.test(e.kind || ''); for (let i = 0; i < (tree ? 24 : big ? 26 : 6); i++) { const g = tree ? [0.16, 0.2, 0.07] : [0.4, 0.34, 0.26]; particles.emit(6, e.pos.x + (Math.random() - 0.5) * 4, e.pos.y + Math.random() * 4, e.pos.z + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8, 2 + Math.random() * 6, (Math.random() - 0.5) * 8, 2.5 + Math.random() * 2, 0.05 + Math.random() * 0.14, 0.1, g[0], g[1], g[2], 1, 1.1, W.x * 0.9, W.y * 0.7, W.z * 0.9); }
  }
  const R = Math.random;
  const api = {
    get particles() { return particles; }, get debris() { return debris; }, get tornadoFx() { return torn; }, get bolts() { return bolts; },
    /** kind: plank|beam|sheet|branch|tree|roof|wall|fence|bale|car or any world break kind */
    spawnDebris(kind, pos, vel) { if (debris.pools[kind]) return debris.spawn(kind, pos, vel, false); debris.burst(kind, pos, vel); },
    /** wheel kick-up. amount 0..1 (slip * load * speed) */
    spawnWheel(pos, vel, surfaceType, amount = 0.5) {
      if (amount <= 0.01) return; const wet = ctx.globals.uWetness.value, n = amount * 1.1 * Math.max(0.4, ctx.quality.particles); let k = Math.floor(n) + (R() < n % 1 ? 1 : 0); const vx = vel?.x || 0, vy = vel?.y || 0, vz = vel?.z || 0, w = Ws, bio = ctx.world?.biomeAt?.(pos.x, pos.z)?.dustColor || [0.42, 0.32, 0.22];
      while (k-- > 0) {
        const jx = (R() - 0.5), jy = R(), jz = (R() - 0.5);
        switch (surfaceType) {
          case 'asphalt': if (wet > 0.25) { particles.emit(2, pos.x, pos.y + 0.12, pos.z, vx * 0.45 + jx * 1.6, 0.8 + jy * 2.2, vz * 0.45 + jz * 1.6, 0.5 + R() * 0.5, 0.14, 0.75 + R() * 0.7, 0.95, 0.97, 1, 0.16 * Math.min(1, amount + 0.2), 1.6, w.x * 0.6, 0, w.z * 0.6); if (R() < 0.35) particles.emit(0, pos.x, pos.y + 0.3, pos.z, vx * 0.35, 0.8, vz * 0.35, 1.1, 0.4, 2.2, 0.85, 0.88, 0.92, 0.1 * amount, 1.2, w.x, 0, w.z); }
            else if (amount > 0.3) particles.emit(0, pos.x, pos.y + 0.15, pos.z, vx * 0.15 + jx, 0.5 + jy * 0.6, vz * 0.15 + jz, 1.6 + R() * 1.4, 0.3, 1.9 + R(), 0.6, 0.61, 0.63, 0.2 * amount, 1.3, w.x * 0.7, 0.2, w.z * 0.7); break;
          case 'water': particles.emit(2, pos.x, pos.y + 0.1, pos.z, vx * 0.35 + jx * 3.5, 1.8 + jy * 4, vz * 0.35 + jz * 3.5, 0.7 + R() * 0.5, 0.2, 0.9 + R(), 0.95, 0.98, 1, 0.34 * amount, 1.2, w.x * 0.4, 0, w.z * 0.4); break;
          case 'mud': case 'swamp': particles.emit(3, pos.x, pos.y + 0.1, pos.z, vx * 0.35 + jx * 3, 1.5 + jy * 3.6, vz * 0.35 + jz * 3, 0.9, 0.018 + R() * 0.035, 0.02, 0.09, 0.065, 0.04, 1, 0.35); if (R() < 0.3) particles.emit(2, pos.x, pos.y + 0.1, pos.z, vx * 0.3 + jx * 2, 1 + jy * 2, vz * 0.3 + jz * 2, 0.5, 0.12, 0.5, 0.25, 0.19, 0.13, 0.3 * amount, 1.8); break;
          case 'snow': particles.emit(0, pos.x, pos.y + 0.15, pos.z, vx * 0.3 + jx * 1.5, 1 + jy * 1.5, vz * 0.3 + jz * 1.5, 1 + R(), 0.25, 1.4, 0.9, 0.93, 0.97, 0.35 * amount, 1.8, w.x, 0, w.z); break;
          case 'rock': if (R() < 0.3) particles.emit(0, pos.x, pos.y + 0.1, pos.z, vx * 0.2, 0.5, vz * 0.2, 1, 0.2, 1, 0.5, 0.48, 0.45, 0.2 * amount, 1.5, w.x, 0, w.z); break;
          default: {
            const grass = surfaceType === 'grass' || surfaceType === 'field', dry = 1 - 0.95 * Math.min(1, wet * 1.8), gr = surfaceType === 'gravel';
            if (dry > 0.1) { const a = (grass ? 0.11 : gr ? 0.2 : 0.26) * amount * dry, c = gr ? [0.5 * 0.6 + bio[0] * 0.4, 0.46 * 0.6 + bio[1] * 0.4, 0.4 * 0.6 + bio[2] * 0.4] : bio; particles.emit(0, pos.x + jx * 0.3, pos.y + 0.2, pos.z + jz * 0.3, vx * 0.25 + jx * 1.4, 0.6 + jy * 1.1, vz * 0.25 + jz * 1.4, 2 + R() * 2.4, 0.4, 2.4 + R() * 2.2, c[0] * 0.75, c[1] * 0.75, c[2] * 0.75, a, 1.1, w.x * 0.75, 0.15, w.z * 0.75); }
            else if (R() < 0.6) particles.emit(3, pos.x, pos.y + 0.1, pos.z, vx * 0.3 + jx * 2, 1.2 + jy * 2.6, vz * 0.3 + jz * 2, 0.8, 0.012 + R() * 0.02, 0.014, bio[0] * 0.3, bio[1] * 0.3, bio[2] * 0.3, 1, 0.4);
            if (gr && R() < 0.25) particles.emit(3, pos.x, pos.y + 0.08, pos.z, vx * 0.45 + jx * 3, 1 + jy * 3, vz * 0.45 + jz * 3, 0.9, 0.008 + R() * 0.014, 0.01, 0.32, 0.3, 0.27, 1, 0.25);
            if (grass && R() < 0.35) particles.emit(6, pos.x, pos.y + 0.1, pos.z, vx * 0.35 + jx * 3, 1 + jy * 3, vz * 0.35 + jz * 3, 1.2, 0.02 + R() * 0.03, 0.03, 0.22, 0.25, 0.1, 1, 1.5, w.x, 0, w.z);
          }
        }
      }
    },
    spark(pos, n = 10) { for (let i = 0; i < n; i++) { const a = R() * 6.283, s = 1.5 + R() * 6; particles.emit(1, pos.x, pos.y, pos.z, Math.cos(a) * s, 1 + R() * 5, Math.sin(a) * s, 0.25 + R() * 0.55, 0.012, 0.005, 12, 8, 4, 1, 0.8); } },
    powerFlash: (x, y, z, k) => torn.powerFlash(x, y, z, k), strike: (e) => bolts.strike(e),
    /** generic puff (smoke, dust) */
    puff(pos, vel, color, size = 1, life = 2, alpha = 0.4) { particles.emit(0, pos.x, pos.y, pos.z, vel?.x || 0, vel?.y || 0, vel?.z || 0, life, size * 0.4, size * 1.6, color[0], color[1], color[2], alpha, 1.2, Ws.x, 0.1, Ws.z); },
    update(dt) {
      if (!(dt > 0)) return; const cam = ctx.camera.position, st = ctx.storms, w = ctx.world; soft.update();
      const H = ctx.renderer?.domElement?.height || innerHeight, px = 2 * Math.tan(ctx.camera.fov * Math.PI / 360) / Math.max(300, H);
      if (lastCam.distanceToSquared(cam) > 3600) camVel.set(0, 0, 0); else { W.copy(cam).sub(lastCam).divideScalar(dt); camVel.lerp(W, Math.min(1, dt * 12)); } lastCam.copy(cam); ground.update(cam);
      const gy = w ? w.heightAt(cam.x, cam.z) : 0, agl = cam.y - gy; if (st?.windAt) st.windAt(cam.x, gy + Math.max(2.5, Math.min(agl, 60)), cam.z, W); else W.set(4, 0, 1); Ws.lerp(W, Math.min(1, dt * 4));
      if (st?.weatherAt) { const o = st.weatherAt(cam.x, cam.z, wx); const base = st.mock ? 1 : 1; rainS = damp(rainS, o.rain * base, 2, dt); hailS = damp(hailS, o.hail, 2, dt); hailCm = o.hailCm ?? 2.5; }
      const top = 1 - smoothstep(700, 1100, agl), fr = api.forceRain ?? rainS * top, fh = api.forceHail ?? hailS * top, mode = ctx.player?.cameraMode ?? ctx.player?.camMode, inside = mode === 'cockpit';
      particles.update(dt, px); rain.update(dt, fr, Ws, camVel, cam, px, inside); hail.update(dt, fh, api.forceHail !== undefined ? api.forceHailCm ?? 3 : hailCm, Ws, camVel, cam, px); wind.update(dt, Ws, cam, px, agl); torn.update(dt, cam, px); debris.update(dt, cam); bolts.update(dt, px);
      // ---- lens drops
      if (fr > 0.06 && (lensT -= dt) < 0) { lensT = 0.12; const up = ctx.gfx?.addLensEffect, out = inside || mode === 'hood' || mode === 'foot' || ctx.player?.mode === 'foot' || ctx.player?.mode === 'drone'; if (up && out) ctx.gfx.addLensEffect('rain', fr * (0.05 + Math.min(0.12, Math.hypot(Ws.x - camVel.x, Ws.z - camVel.z) * 0.004))); }
      // ---- tyre spray etc. for vehicles that expose contacts is driven by VEHICLE via spawnWheel
    },
    dispose() { for (const f of offs) f(); bolts.dispose(); teardown(); },
  };
  ctx.fxBreakSet = breakSet;
  return api;
}

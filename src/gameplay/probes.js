// Ground probes: deployable sensor pods, recording, being thrown, telemetry.
import * as THREE from 'three';
import { clamp, damp } from '../core/math.js';
import { probeModel } from './models.js';
import { gearValue } from './profile.js';

const W = new THREE.Vector3(), N = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
// data quality 0..1 from closest approach and recorded peak wind
export function probeScore(minDist, rCore, peak) { const r = Math.max(40, rCore || 60); return clamp(1 - (minDist - r) / (r * 5 + 250)) * clamp(0.35 + peak / 85); }
export const probePay = (score, ef) => Math.round((500 + 9500 * score * (1 + ef * 0.25)) * (score > 0.05 ? 1 : 0) / 10) * 10;

export function createProbes(ctx, profile) {
  const list = []; let seq = 1, stock = null;
  const cap = () => gearValue(profile.data, 'probes', 'count'), holdV = () => gearValue(profile.data, 'probes', 'hold');
  const api = {
    list, get capacity() { return cap(); }, get stock() { return Math.max(0, cap() - list.filter((p) => p.mine && p.state !== 'lost').length - (stock || 0)); },
    deploy(x, z, secured, o = {}) {
      const mine = o.mine !== false; if (mine && api.stock <= 0) { ctx.ui?.notify?.({ title: 'Probe rack empty', text: 'Retrieve a pod or restock in town.', kind: 'bad' }); return null; }
      const y = ctx.world.heightAt(x, z), p = { id: o.id || `${mine ? 'p' : 'r'}${seq++}-${Math.floor(Math.random() * 1e6).toString(36)}`, mine, x, y, z, secured: secured ? 1 : 0, state: 'live', t: 0, sampleT: 0, samples: [], peak: 0, minP: 2000, minDist: 1e9, score: 0, done: false, tornado: null, v: new THREE.Vector3(), w: new THREE.Vector3(), obj: probeModel(), drop: mine ? 0.35 : 0 };
      p.obj.position.set(x, y + p.drop, z); ctx.world.normalAt?.(x, z, N); if (N.lengthSq() > 0.5) p.obj.quaternion.setFromUnitVectors(UP, N); p.obj.rotateY(Math.random() * 6.28); ctx.scene.add(p.obj); list.push(p); if (!p.secured) for (const s of p.obj.userData.spikes) s.position.y = 0.2;
      if (mine) { profile.data.stats.probes++; profile.touch(); ctx.events.emit('probe:deployed', { id: p.id, x, z, secured: !!p.secured }); ctx.audio?.play?.('probe_drop'); ctx.net?.send?.('gp:probe', { id: p.id, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, s: p.secured }); }
      return p;
    },
    secure(p) { p.secured = 1; for (const s of p.obj.userData.spikes) s.position.y = 0.06; ctx.audio?.play?.('probe_anchor'); ctx.events.emit('probe:secured', { id: p.id }); },
    retrieve(p) { const i = list.indexOf(p); if (i < 0) return; list.splice(i, 1); ctx.scene.remove(p.obj); if (p.mine) { if (!p.done && p.minDist < 3000) finish(p); ctx.events.emit('probe:retrieved', { id: p.id }); ctx.net?.send?.('gp:probe-x', { id: p.id }); } },
    remove(id) { const p = list.find((p) => p.id === id); if (p) { list.splice(list.indexOf(p), 1); ctx.scene.remove(p.obj); } },
    nearest(x, z, r = 3) { let b = null, bd = r; for (const p of list) { if (!p.mine || p.state === 'lost') continue; const d = Math.hypot(p.obj.position.x - x, p.obj.position.z - z); if (d < bd) { bd = d; b = p; } } return b; },
    restock() { for (const p of [...list]) if (p.mine) api.remove(p.id); }, clear() { for (const p of list) ctx.scene.remove(p.obj); list.length = 0; },
    get recording() { let b = null; for (const p of list) if (p.mine && p.state === 'live' && !p.done && p.minDist < 4000 && (!b || p.minDist < b.minDist)) b = p; return b; },
    update(dt) {
      for (const p of list) {
        p.t += dt; const o = p.obj.position; p.obj.userData.led.visible = (p.t * (p.done ? 0.5 : p.peak > 25 ? 5 : 1.4)) % 1 < 0.5;
        if (p.drop > 0 && p.state === 'live') { p.drop = Math.max(0, p.drop - dt * 2.4); o.y = p.y + p.drop * p.drop; }
        const S = ctx.storms; S.windAt(o.x, o.y + 0.4, o.z, W); const wind = Math.hypot(W.x, W.z);
        if (p.state === 'live') {
          p.sampleT -= dt; let t = null, d = 1e9; for (const k of S.tornadoes) { if (k.stage === 'dead') continue; const q = Math.hypot(k.x - o.x, k.z - o.z); if (q < d) { d = q; t = k; } }
          if (t && d < 4000) {
            if (p.sampleT <= 0) { p.sampleT = 0.5; const pr = S.pressureAt?.(o.x, o.y + 0.3, o.z) ?? 985; p.wind = wind; p.pressure = pr; p.dist = d; p.samples.push(wind, pr, d); if (p.samples.length > 720) p.samples.splice(0, 3); if (!p.done) { p.peak = Math.max(p.peak, wind); p.minP = Math.min(p.minP, pr); if (d < p.minDist) { p.minDist = d; p.ef = t.ef || 0; p.rCore = t.rCore; p.tornado = t.id; } } }
            if (!p.done && p.mine && p.minDist < 2200 && d > p.minDist + 350) finish(p);
          } else if (!p.done && p.mine && p.minDist < 2200) finish(p);
          const lim = holdV() * (p.secured ? 1 : 0.6); if (wind > lim) { p.state = 'air'; p.v.set(W.x * 0.15, 3 + Math.random() * 3, W.z * 0.15); p.w.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3); ctx.events.emit('probe:thrown', { id: p.id }); if (p.mine) { if (!p.done && p.minDist < 1500) finish(p, 0.85); ctx.ui?.notify?.({ title: 'Probe torn loose', text: p.secured ? `Peak ${Math.round(p.peak * 2.237)} mph before the anchor went.` : 'It was not anchored.', kind: 'warn' }); } }
        } else if (p.state === 'air') {
          W.sub(p.v); const k = 0.0032 * W.length(); p.v.addScaledVector(W, Math.min(0.5, k * dt)); p.v.y -= 9.81 * dt; o.addScaledVector(p.v, dt); p.obj.rotation.x += p.w.x * dt; p.obj.rotation.y += p.w.y * dt; p.obj.rotation.z += p.w.z * dt;
          const gy = ctx.world.heightAt(o.x, o.z); if (o.y < gy + 0.1) { o.y = gy + 0.1; p.v.y = Math.abs(p.v.y) * 0.3; p.v.x *= 0.6; p.v.z *= 0.6; p.w.multiplyScalar(0.6); if (p.v.lengthSq() < 4 && wind < 25) { p.state = 'spent'; p.x = o.x; p.y = gy; p.z = o.z; ctx.events.emit('probe:landed', { id: p.id, x: o.x, z: o.z }); } }
        }
      }
    },
  };
  function finish(p, mul = 1) {
    p.done = true; p.score = probeScore(p.minDist, p.rCore, p.peak) * mul; const pay = probePay(p.score, p.ef || 0);
    if (p.score > 0.08) { profile.data.stats.probeHits++; if (pay) { profile.earn(pay, 'Probe telemetry'); profile.addRep(20 + p.score * 90); } ctx.events.emit('probe:data', { id: p.id, score: p.score, peak: p.peak, minP: p.minP, minDist: p.minDist, ef: p.ef, pay }); }
    else ctx.events.emit('probe:data', { id: p.id, score: 0, peak: p.peak, minP: p.minP, minDist: p.minDist, ef: p.ef, pay: 0 });
  }
  return api;
}
export { damp };

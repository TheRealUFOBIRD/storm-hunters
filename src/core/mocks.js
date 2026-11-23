// Stand-ins so every module can be developed / run before the others exist.
import { BOUNDS } from './geo.js';
import { fbm } from './noise.js';
export const mocks = {
  world() {
    const S = { type: 'grass', grip: 0.75, wetGrip: 0.5, rollRes: 0.04, bump: 0.02, dust: 0.3 }, R = { x: 0, z: 0, dist: 0, dirX: 0, dirZ: -1, width: 8, name: 'US-77', kind: 'highway' };
    const A = { type: 'asphalt', grip: 1, wetGrip: 0.7, rollRes: 0.012, bump: 0, dust: 0 };
    const heightAt = (x, z) => fbm(x / 900, z / 900, 3, 7) * 18 * Math.min(1, Math.max(0, (Math.abs(x) - 8) / 200));
    return {
      mock: true, heightAt, normalAt(x, z, o) { return o.set(heightAt(x - 1, z) - heightAt(x + 1, z), 2, heightAt(x, z - 1) - heightAt(x, z + 1)).normalize(); },
      surfaceAt: (x) => (Math.abs(x) < 5 ? A : S), biomeAt: () => ({ id: 'plains', name: 'Great Plains', dustColor: [0.42, 0.3, 0.2], humidity: 0.6, tornadoProb: 1 }), waterLevelAt: () => -Infinity, isLand: () => true, bounds: BOUNDS,
      cities: [{ name: 'Oklahoma City', state: 'Oklahoma', x: 0, z: 0, radius: 900, pop: 700000 }], nearestCity() { return this.cities[0]; }, stateAt: () => 'Oklahoma',
      roads: { nearest(x, z) { R.x = 0; R.z = z; R.dist = Math.abs(x); return R; }, lines: [{ kind: 'highway', name: 'US-77', width: 8, pts: new Float32Array([0, -20000, 0, 20000]) }] }, route: (a, b, c, d) => new Float32Array([a, b, 0, b, 0, d, c, d]),
      queryColliders() {}, hitCollider() {}, applyBroken() {}, getMapCanvas() { const c = document.createElement('canvas'); c.width = 2048; c.height = 1290; const g = c.getContext('2d'); g.fillStyle = '#12181f'; g.fillRect(0, 0, 2048, 1290); return c; },
      worldToMap: (x, z) => ({ u: (x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX), v: (z - BOUNDS.minZ) / (BOUNDS.maxZ - BOUNDS.minZ) }), spawnPoint: () => ({ x: 2, z: 0, heading: 0 }),
      raycastTerrain(o, d, max) { for (let t = 0; t < max; t += Math.max(1, t * 0.02)) if (o.y + d.y * t < heightAt(o.x + d.x * t, o.z + d.z * t)) return t; return -1; }, ready: Promise.resolve(), prewarm: () => Promise.resolve(), update() {},
    };
  },
  storms() {
    const st = { id: 1, type: 'supercell', seed: 12, x: -600, z: -2600, vx: 6, vz: -2, heading: 1.2, age: 900, life: 5400, intensity: 0.9, radius: 5200, rainR: 2400, cloudBase: 900, cloudTop: 11500, rotation: 0.9, meso: { x: -600, z: -2300, r: 1100 }, rain: { x: 1200, z: -4600, r: 2200, rate: 0.9 }, hail: 4, warned: true, name: 'OK-01' };
    const t = { id: 1, storm: st, seed: 3, x: -500, z: -1500, y0: 0, vx: 0, vz: 0, age: 200, stage: 'mature', strength: 0.8, ef: 3, vmax: 70, rCore: 90, dp: 70, lcl: 900, condense: 1, rTop: 320, dustR: 260, dust: 0.9, dustColor: [0.42, 0.3, 0.2], spin: 1, sub: [], lean: { x: 120, z: -80 }, wobbleSeed: 1 };
    return {
      mock: true, list: [st], tornadoes: [t], isAuthority: true, axisAt(t, h, o) { const k = h / t.lcl; o.x = t.x + t.lean.x * k * k; o.z = t.z + t.lean.z * k * k; return o; }, funnelRadius: (t, h) => t.rCore * 0.5 + (t.rTop - t.rCore * 0.5) * Math.pow(h / t.lcl, 1.6),
      windAt(x, y, z, o) { const dx = x - t.x, dz = z - t.z, r = Math.hypot(dx, dz) + 1e-3, v = t.vmax * (2 * r * t.rCore) / (r * r + t.rCore * t.rCore); return o.set(dz / r * v - dx / r * v * 0.35, 6, -dx / r * v - dz / r * v * 0.35).multiplyScalar(r < 2500 ? 1 : 0); }, ambient: (x, z, o) => o.set(5, 0, 2), pressureAt: () => 985,
      weatherAt: () => ({ rain: 0.15, hail: 0, cloud: 0.8, dark: 0.6, temp: 24, dewpoint: 20, visibility: 12000, windSpeed: 9, gust: 14, storm: st }), reflectivity: (x, z) => Math.max(0, 62 - Math.hypot(x - st.rain.x, z - st.rain.z) / 60), velocity: () => 0, cape: () => 3200, outlook: [{ level: 'MDT', x: 0, z: 0, r: 9000 }], snapshot: () => ({}), applySnapshot() {}, spawnAt() {}, clear() {}, update() {},
    };
  },
  fx: () => ({ mock: true, spawnDebris() {}, spawnWheel() {}, spark() {}, update() {} }),
  vehicles: () => ({ mock: true, types: {}, list: [], active: null, spawn() { return null; }, createVisual: () => null, clear() {}, update() {} }),
  player: (ctx) => ({ mock: true, mode: 'spectate', pos: ctx.camera.position, heading: 0, pitch: 0, vehicle: null, health: 1, teleport() {}, enter() {}, exit() {}, update() {} }),
  gameplay: () => ({ mock: true, profile: { money: 0, rep: 0, level: 1, owned: [], upgrades: {}, stats: {}, photos: [] }, missions: { available: [], active: [] }, update() {} }),
  ui: () => ({ mock: true, notify() {}, openScreen() {}, closeScreen() {}, subtitle() {}, update() {} }),
  net: () => ({ mock: true, role: 'solo', peers: new Map(), send() {}, on() {}, update() {} }),
  audio: () => ({ mock: true, unlock() {}, setVolume() {}, play() {}, update() {} }),
};

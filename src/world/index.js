// WORLD system: compressed continental USA. See docs/CONTRACTS.md (world).
import * as THREE from 'three';
import { buildWorldData } from './build.js';
import { makeSampler, GX, GZ, SNX, SNZ, CROPS } from './sampler.js';
import { createTextures, dataTex } from './textures.js';
import { createTerrain, createTerrainMaterial, snowUniform } from './terrain.js';
import { createRoads } from './roadmesh.js';
import { createScatter } from './scatter.js';
import { createWater } from './water.js';
import { createGrass } from './grass.js';
import { makeRouter } from './route.js';
import { drawMap } from './map.js';
import { createPool } from './pool.js';
import { BOUNDS, toWorld, inBounds } from '../core/geo.js';

const BIOMES = {
  plains: { id: 'plains', name: 'Great Plains', dustColor: [.45, .33, .22], humidity: .55, tornadoProb: 1 }, wheat: { id: 'wheat', name: 'Wheat Belt', dustColor: [.5, .4, .28], humidity: .5, tornadoProb: .95 },
  cornbelt: { id: 'cornbelt', name: 'Corn Belt', dustColor: [.33, .26, .19], humidity: .7, tornadoProb: .7 }, desert: { id: 'desert', name: 'Desert', dustColor: [.62, .48, .33], humidity: .15, tornadoProb: .08 },
  mountain: { id: 'mountain', name: 'Mountains', dustColor: [.45, .42, .38], humidity: .4, tornadoProb: .05 }, forest: { id: 'forest', name: 'Forest', dustColor: [.3, .24, .17], humidity: .75, tornadoProb: .45 },
  swamp: { id: 'swamp', name: 'Bayou', dustColor: [.28, .25, .18], humidity: .95, tornadoProb: .5 }, coast: { id: 'coast', name: 'Coast', dustColor: [.6, .55, .45], humidity: .85, tornadoProb: .3 }, urban: { id: 'urban', name: 'City', dustColor: [.45, .43, .4], humidity: .6, tornadoProb: .6 },
};
const SURF = { asphalt: [1, .72, .012, 0, 0], gravel: [.72, .55, .025, .03, .8], dirt: [.68, .45, .03, .04, .9], grass: [.7, .5, .035, .03, .35], field: [.62, .42, .045, .05, .7], mud: [.4, .3, .07, .06, .15], sand: [.55, .45, .06, .03, 1], snow: [.4, .3, .03, .02, .05], rock: [.85, .6, .02, .08, .3], water: [.2, .15, .2, 0, 0] };

export async function create(ctx) {
  const t0 = performance.now(), data = buildWorldData(), S = makeSampler(data), O = S.O;
  const tex = await createTextures(ctx.quality); const pool = createPool(data, 2);
  const shared = { uBioA: { value: dataTex(data.bioA, GX, GZ, THREE.RGBAFormat, true) }, uBioB: { value: dataTex(data.bioB, GX, GZ, THREE.RGBAFormat, true) }, uK: { value: 2 }, uCamAgl: { value: 0 }, uCamG: { value: new THREE.Vector3() }, uDmg: { value: null }, uDmgOrg: { value: new THREE.Vector3(0, 0, 4096) }, uSnowA: { value: snowUniform() } };
  const st = new THREE.DataTexture(data.sec, SNX, SNZ, THREE.RGBAIntegerFormat, THREE.UnsignedByteType); st.internalFormat = 'RGBA8UI'; st.needsUpdate = true; shared.uSec = { value: st };
  // tornado damage mask: 1024^2 @ 4 m window that follows the camera
  const DM = 1024, DR = 4, dmask = new Uint8Array(DM * DM), dtex = dataTex(dmask, DM, DM, THREE.RedFormat, true); shared.uDmg.value = dtex; const dorg = shared.uDmgOrg.value; dorg.set(-DM * DR / 2, -DM * DR / 2, DM * DR); let dDirty = 0;
  const mat = createTerrainMaterial(ctx, tex, data, shared), terrain = createTerrain(ctx, S, pool, mat, shared), roads = createRoads(ctx, S, tex, shared), scatter = createScatter(ctx, S, pool, tex), water = createWater(ctx, S, shared), grass = createGrass(ctx, S);
  let router = null; const getRouter = () => (router ||= makeRouter(S));
  const lines = data.roads.filter((r) => r.k <= 1).map((r) => ({ kind: r.kind, name: r.name, width: r.hw * 2, pts: r.pts }));
  const bounds = { ...BOUNDS }, surf = { type: 'grass', grip: .7, wetGrip: .5, rollRes: .035, bump: .03, dust: .35 }, nv = new THREE.Vector3();
  let mapCanvas = null; const breakQ = [];
  scatter.listeners.onBreak = (code) => breakQ.push(code);
  if (ctx.renderer) tex.fill(ctx.renderer);

  function surfaceAt(x, z) {
    const h = S.heightAt(x, z); let t = 'grass';
    if (O.deck || O.eMaj < 0 || O.eStr < 0) t = 'asphalt'; else if (O.eGrv < 0 || O.eMaj < 1.6) t = 'gravel'; else if (S.waterLevelAt(x, z) > h - .3) t = 'water';
    else { const f = S.fieldAt(x, z), b = S.bio(x, z); if (f.yard < 0) t = 'gravel'; else if (f.crop === 6 || f.crop === 8) t = 'dirt'; else if (f.crop > 1) t = 'field'; else if (h > S.snowLine(z) + 40) t = 'snow'; else if (b.arid > .78) t = 'sand'; else if (b.arid > .55) t = 'dirt'; else if (O.eRiv < 8) t = 'mud';
      if (t !== 'snow') { const sl = Math.abs(S.heightAt(x + 1.5, z) - S.heightAt(x - 1.5, z)) + Math.abs(S.heightAt(x, z + 1.5) - S.heightAt(x, z - 1.5)); if (sl > 2.6) t = 'rock'; } }
    const w = ctx.globals.uWetness.value; if (w > .55 && (t === 'dirt' || t === 'field')) t = 'mud';
    const q = SURF[t]; surf.type = t; surf.grip = q[0]; surf.wetGrip = q[1]; surf.rollRes = q[2]; surf.bump = q[3]; surf.dust = q[4] * (1 - w); return surf;
  }
  function biomeAt(x, z) {
    const b = S.bio(x, z), h = S.macroAt(x, z); if (b.urban > .5) return BIOMES.urban; if (S.coastAt(x, z) < 900) return BIOMES.coast; if (O.rough > .3 || h > 420) return BIOMES.mountain; if (b.swamp > .5) return BIOMES.swamp; if (b.arid > .65) return BIOMES.desert; if (b.forest > .55) return BIOMES.forest;
    const f = S.fieldAt(x, z); if (f.crop === 4 || f.crop === 5) return BIOMES.cornbelt; if (f.crop === 2 || f.crop === 3 || f.crop === 9) return BIOMES.wheat; return BIOMES.plains;
  }
  function spawnPoint(cityName) {
    let x = toWorld(36.15, -97.92).x, z = toWorld(36.15, -97.92).z, c = null;
    if (cityName) { c = data.cities.find((q) => q.name.toLowerCase() === String(cityName).toLowerCase()); if (c) { x = c.x + c.radius * 1.25; z = c.z + c.radius * .4; } }
    const n = S.nearest(x, z, 1); if (n.road < 0) return { x, z, heading: 0 };
    const px = n.x - n.dirZ * n.width * .25, pz = n.z + n.dirX * n.width * .25; return { x: px, z: pz, heading: Math.atan2(n.dirX, -n.dirZ) < 0 ? Math.atan2(n.dirX, -n.dirZ) + Math.PI * 2 : Math.atan2(n.dirX, -n.dirZ) };
  }
  // tornado damage swath stamping
  function stamp(t) {
    const rc = Math.max(12, t.rCore || 40), ef = t.ef ?? 1, R = rc * (1 + ef * .25), u0 = (t.x - dorg.x) / DR, v0 = (t.z - dorg.y) / DR, r = R / DR, val = Math.min(255, 70 + ef * 37);
    for (let j = Math.max(0, Math.floor(v0 - r)); j <= Math.min(DM - 1, Math.ceil(v0 + r)); j++) for (let i = Math.max(0, Math.floor(u0 - r)); i <= Math.min(DM - 1, Math.ceil(u0 + r)); i++) { const d = Math.hypot(i - u0, j - v0) / r; if (d > 1) continue; const v = val * (1 - d * d); const k = j * DM + i; if (dmask[k] < v) { dmask[k] = v; dDirty = 1; } }
  }
  function recentre(cx, cz) { const nx = Math.round((cx - DM * DR / 2) / 256) * 256, nz = Math.round((cz - DM * DR / 2) / 256) * 256; if (Math.abs(nx - dorg.x) < 1200 && Math.abs(nz - dorg.y) < 1200) return; const di = Math.round((nx - dorg.x) / DR), dj = Math.round((nz - dorg.y) / DR), old = dmask.slice(); dmask.fill(0); for (let j = 0; j < DM; j++) { const sj = j + dj; if (sj < 0 || sj >= DM) continue; for (let i = 0; i < DM; i++) { const si = i + di; if (si >= 0 && si < DM) dmask[j * DM + i] = old[sj * DM + si]; } } dorg.x = nx; dorg.y = nz; dDirty = 1; }
  let dmT = 0;
  const w = {
    S, data, bounds, cities: data.cities, stats: () => ({ ...terrain.stats(), ...roads.stats(), ...scatter.stats(), pool: pool.size }),
    heightAt: S.heightAt, terrainAt: S.terrainAt,
    normalAt(x, z, o = nv) { const e = 1; return o.set(S.heightAt(x - e, z) - S.heightAt(x + e, z), 2 * e, S.heightAt(x, z - e) - S.heightAt(x, z + e)).normalize(); },
    surfaceAt, biomeAt, waterLevelAt: S.waterLevelAt, isLand: (x, z) => S.waterLevelAt(x, z) === -Infinity, stateAt: S.stateAt,
    nearestCity(x, z) { let b = null, bd = 1e18; for (const c of data.cities) { const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < bd) { bd = d; b = c; } } return b; },
    roads: { nearest: (x, z, maxKind) => S.nearest(x, z, maxKind), lines }, route: (a, b, c, d) => getRouter().route(a, b, c, d),
    queryColliders: (x, z, r, out = []) => scatter.queryColliders(x, z, r, out), hitCollider: (id, imp) => scatter.hitCollider(id, imp), applyBroken: (ids) => scatter.applyBroken(ids || []),
    getMapCanvas: () => (mapCanvas ||= drawMap(S)), worldToMap: (x, z) => ({ u: (x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX), v: (z - BOUNDS.minZ) / (BOUNDS.maxZ - BOUNDS.minZ) }),
    spawnPoint, inBounds,
    raycastTerrain(o, d, max = 5000) { let t = 0, prev = o.y - S.heightAt(o.x, o.z); if (prev < 0) return 0; while (t < max) { const st = Math.max(.5, Math.min(40, prev * .6, t * .03 + .5)); t += st; const y = o.y + d.y * t - S.heightAt(o.x + d.x * t, o.z + d.z * t); if (y < 0) { let a = t - st, b = t; for (let k = 0; k < 10; k++) { const m = (a + b) / 2; if (o.y + d.y * m - S.heightAt(o.x + d.x * m, o.z + d.z * m) < 0) b = m; else a = m; } return (a + b) / 2; } prev = y; } return -1; },
    ready: null, prewarm(x, z) { return new Promise((res) => { const s0 = performance.now(), cam = ctx.camera.position, sv = cam.clone(); const tick = () => { cam.set(x, S.heightAt(x, z) + 2, z); try { w.update(.016); } catch (e) { console.error(e); } cam.copy(sv); if ((terrain.idle() && roads.near(x, z) && scatter.near(x, z) && grass.idle?.()) || performance.now() - s0 > 15000) res(); else setTimeout(tick, 4); }; tick(); }); },
    update(dt = .016) {
      if (ctx.renderer && !tex.done) tex.fill(ctx.renderer);
      pool.pump(3); terrain.update(); roads.update(2); scatter.update(dt); water.update(); grass.update();
      const T = ctx.storms?.tornadoes; const c = ctx.camera.position; recentre(c.x, c.z);
      if (T && T.length) { scatter.damage(T, ctx.storms.isAuthority !== false); for (const t of T) if (t && (t.stage === 'touchdown' || t.stage === 'mature' || t.stage === 'shrinking' || t.stage === 'rope') && (t.condense ?? 1) > .2) stamp(t); }
      if (breakQ.length) { ctx.events.emit('world:breakIds', breakQ.splice(0)); }
      if (dDirty && (dmT -= dt) <= 0) { dmT = .3; dDirty = 0; dtex.needsUpdate = true; }
    },
  };
  w.ready = (async () => { await new Promise((r) => setTimeout(r, 0)); })();
  console.log(`[world] created in ${Math.round(performance.now() - t0)} ms (${data.roads.length} roads)`);
  return w;
}

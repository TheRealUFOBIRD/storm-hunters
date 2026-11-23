import * as THREE from 'three';
import { buildWorldData } from './build.js';
import { makeSampler, GX, GZ, SNX, SNZ } from './sampler.js';
import { createTextures, dataTex } from './textures.js';
import { createTerrain, createTerrainMaterial, snowUniform } from './terrain.js';
import { createRoads } from './roadmesh.js';
import { createPool } from './pool.js';
export async function create(ctx) {
  const data = buildWorldData(), S = makeSampler(data);
  const tex = createTextures(ctx.quality); const pool = createPool(data, 2);
  const shared = { uBioA: { value: dataTex(data.bioA, GX, GZ, THREE.RGBAFormat, true) }, uBioB: { value: dataTex(data.bioB, GX, GZ, THREE.RGBAFormat, true) }, uK: { value: 2 }, uCamAgl: { value: 0 }, uCamG: { value: new THREE.Vector3() }, uDmg: { value: null }, uDmgOrg: { value: new THREE.Vector3(0, 0, 4096) }, uSnowA: { value: snowUniform() } };
  const st = new THREE.DataTexture(data.sec, SNX, SNZ, THREE.RGBAIntegerFormat, THREE.UnsignedByteType); st.internalFormat = 'RGBA8UI'; st.needsUpdate = true; shared.uSec = { value: st };
  shared.uDmg.value = dataTex(new Uint8Array(64 * 64), 64, 64, THREE.RedFormat, true);
  const mat = createTerrainMaterial(ctx, tex, data, shared); const terrain = createTerrain(ctx, S, pool, mat, shared);
  const roads = createRoads(ctx, S, tex, shared);
  const w = { S, data, heightAt: S.heightAt, cities: data.cities, roads: { nearest: S.nearest }, stats: () => ({ ...terrain.stats(), pool: pool.size }),
    update() { if (ctx.renderer) tex.fill(ctx.renderer); pool.pump(3); terrain.update(); roads.update(2.5); if (tex.ms) { console.log('texfill', tex.ms); tex.ms = 0; } }, ready: Promise.resolve(), prewarm(x, z) { return new Promise((res) => { const t0 = performance.now(); const tick = () => { ctx.camera.position.x = x; ctx.camera.position.z = z; w.update(0); if ((terrain.idle() && roads.near(x, z)) || performance.now() - t0 > 15000) res(); else setTimeout(tick, 5); }; tick(); }); } };
  return w;
}

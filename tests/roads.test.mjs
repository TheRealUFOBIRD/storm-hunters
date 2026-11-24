// ROADS: driveable profiles, ribbon above terrain (fine + coarse LOD grids), nothing spawns on roads, spawn on a lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldData } from '../src/world/build.js';
import { makeSampler } from '../src/world/sampler.js';
import { makeLayout } from '../src/world/layout.js';
import { KIND, STRIDE, SS, SOX, SOZ } from '../src/world/kinds.js';
import { roadMetrics } from './roadmetrics.mjs';
import { toWorld } from '../src/core/geo.js';

const data = buildWorldData(), S = makeSampler(data), O = S.O;
const M = roadMetrics(data, S, { stride: 3, lods: [1, 4, 8] });

test('road profiles are smooth (second derivative of the driven surface)', () => {
  const lim = { interstate: .02, highway: .03, gravel: .05, street: .15 };
  for (const [k, v] of Object.entries(M.smooth)) {
    console.log(`${k}: max d2 ${v.max.toFixed(4)} /m, >0.02: ${(v.over / v.n * 100).toFixed(3)}%, max grade ${(v.grade * 100).toFixed(1)}%`);
    assert.ok(v.max < lim[k], `${k} max d2 ${v.max} at ${JSON.stringify(M.worst['smooth_' + k])}`);
    assert.ok(v.over / v.n < (k === 'street' ? .005 : .0005), `${k} rough share ${v.over / v.n}`);
  }
  assert.ok(M.smooth.interstate.grade < .2 && M.smooth.gravel.grade < .15, 'grades');
});

test('road ribbon stays above the terrain (fine and coarse LOD grids)', () => {
  for (const [k, v] of Object.entries(M.poke)) {
    console.log(`${k}: >5cm ${(v.over5 / v.n * 100).toFixed(3)}%, >20cm ${(v.over20 / v.n * 100).toFixed(4)}%, max ${v.max.toFixed(2)} m`);
    const street = k.startsWith('street');
    assert.ok(v.over20 / v.n < (street ? .002 : .0002), `${k} pokes >20cm ${v.over20}/${v.n} worst ${JSON.stringify(M.worst['poke_' + k])}`);
    assert.ok(v.max < (street ? 1 : .5), `${k} max ${v.max}`);
  }
});

test('no placed object intersects a road surface', () => {
  const L = makeLayout(S), secs = [];
  for (const n of ['Wichita', 'Oklahoma City', 'Dodge City', 'Amarillo', 'Kansas City', 'Denver']) { const c = data.cities.find((q) => q.name === n); if (c) secs.push([c.x, c.z], [c.x + 600, c.z + 300]); }
  for (let i = 0; i < 40; i++) secs.push([-30000 + ((i * 7919) % 50000), -20000 + ((i * 104729) % 36000)]);
  let n = 0, bad = []; const gap = (x, z, r) => { S.heightAt(x, z); return !O.deck && O.eMaj > r + .5 && O.eStr > r && O.eGrv > r; };
  for (const [x, z] of secs) {
    const it = L.sector(Math.floor((x - SOX) / SS), Math.floor((z - SOZ) / SS)).items;
    for (let i = 0; i < it.length; i += STRIDE) {
      const K = KIND[it[i]], X = it[i + 1], Z = it[i + 3], rot = it[i + 4], s = it[i + 5]; n++; const col = K.col;
      let ok; if (col && col[0] === 'box') { const c = Math.cos(rot), sn = Math.sin(rot); ok = gap(X, Z, 0); for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const lx = a * col[1] * s, lz = b * col[3] * s; ok = ok && gap(X + lx * c + lz * sn, Z - lx * sn + lz * c, 0); } }
      else ok = gap(X, Z, (col ? col[1] : .3) * s);
      if (!ok) bad.push(`${K.name}@${X.toFixed(0)},${Z.toFixed(0)}`);
    }
  }
  console.log(`checked ${n} objects in ${secs.length} sectors, ${bad.length} on roads`);
  assert.ok(n > 5000); assert.equal(bad.length, 0, bad.slice(0, 12).join(' '));
});

test('spawn points lie on a driving lane', () => {
  const pts = [toWorld(36.15, -97.92)]; for (const c of data.cities.slice(0, 60)) pts.push({ x: c.x + c.radius * 1.25, z: c.z + c.radius * .4 });
  let off = 0;
  for (const q of pts) { // mirrors world.spawnPoint (src/world/index.js)
    const n = S.nearest(q.x, q.z, 1); if (n.road < 0) continue; const px = n.x - n.dirZ * n.width * .25, pz = n.z + n.dirX * n.width * .25;
    const r = S.nearest(px, pz, 1); const h = S.heightAt(px, pz); if (r.dist > n.width / 2 - .5 || O.deck && Math.abs(h - n.y) > 1) off++;
  }
  assert.equal(off, 0, `${off} spawn points off the lane`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldData } from '../src/world/build.js';
import { makeSampler } from '../src/world/sampler.js';
import { makeLayout } from '../src/world/layout.js';
import { KIND, STRIDE, SS, SOX, SOZ, SEC_IDS } from '../src/world/kinds.js';

const data = buildWorldData(), S = makeSampler(data), L = makeLayout(S);
const secOf = (x, z) => [Math.floor((x - SOX) / SS), Math.floor((z - SOZ) / SS)];
for (const name of ['Oklahoma City', 'Pratt', 'Wichita']) test(`city layout: ${name}`, () => {
  const c = data.cities.find((q) => q.name === name), [i0, j0] = secOf(c.x - c.radius * 1.6, c.z - c.radius * 1.6), [i1, j1] = secOf(c.x + c.radius * 1.6, c.z + c.radius * 1.6), cnt = {};
  let bad = 0, t = 0, maxN = 0; const t0 = performance.now();
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const r = L.sector(i, j), it = r.items, n = it.length / STRIDE; maxN = Math.max(maxN, n);
    for (let k = 0; k < n; k++) { const K = KIND[it[k * STRIDE]]; if (!K.ext) continue; cnt[K.name] = (cnt[K.name] || 0) + 1; t++;
      if (K.cls === 'bld' || K.cls === 'land') { S.heightAt(it[k * STRIDE + 1], it[k * STRIDE + 3]); if (S.O.eStr < 0 || S.O.eMaj < 0) bad++; } }
  }
  console.log(name, t, 'items', Math.round(performance.now() - t0), 'ms', JSON.stringify(cnt));
  assert.ok(maxN < SEC_IDS, 'sector item cap'); assert.equal(bad, 0, 'buildings on roads'); assert.ok((cnt.house_ranch || 0) + (cnt.house_2st || 0) + (cnt.bungalow || 0) > 20, 'houses');
});

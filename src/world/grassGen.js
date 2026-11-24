// Grass data baking, shared by the main thread (near blades) and the grass worker (far clipmap rects). No three.js.
// Clipmap texel (I,J) of a level with spacing c samples the world at (I*c, J*c):
//   H  (Float32 x2): ground height (terrainAt, matches the terrain mesh), blade height in m (0 = no grass)
//   C  (Uint8 x4)  : sqrt-encoded linear colour rgb, density 0..255
import { hash2 } from '../core/rng.js';
import { makeSampler } from './sampler.js';

// blade colour / height for a crop class (same palette the near blades use)
export function colFor(crop, b, x, z, o) {
  const n = hash2(x * 3 | 0, z * 3 | 0, 5); let h = .32 + b.forest * .1, r, gg, bb; const dry = Math.min(1, b.arid * 1.3 + .15);
  if (crop === 2) { r = .09; gg = .16; bb = .04; h = .6; } else if (crop === 3 || crop === 9) { r = .3; gg = .22; bb = .085; h = crop === 3 ? .85 : .2; } else if (crop === 4) { r = .07; gg = .14; bb = .035; h = 2.0; } else if (crop === 5) { r = .08; gg = .15; bb = .04; h = .5; } else if (crop === 7) { r = .17; gg = .19; bb = .07; h = .35; }
  else { const dd = dry * (.5 + .5 * hash2(x * .2 | 0, z * .2 | 0, 6)); r = .055 + .12 * dd; gg = .085 + .06 * dd; bb = .025 + .04 * dd; h = .22 + .22 * (1 - b.arid) * hash2(x | 0, z | 0, 8); }
  const k = .8 + .4 * n; o[0] = r * k; o[1] = gg * k; o[2] = bb * k; o[3] = h;
}

const tmp = [0, 0, 0, 0];
// fill a w*h rect of clipmap texels starting at global texel (I0,J0), spacing c
export function bakeRect(S, c, I0, J0, w, h, H, C) {
  const O = S.O;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = (I0 + i) * c, z = (J0 + j) * c, k = j * w + i, y = S.terrainAt(x, z);
    H[k * 2] = y; H[k * 2 + 1] = 0; C[k * 4] = C[k * 4 + 1] = C[k * 4 + 2] = C[k * 4 + 3] = 0;
    // conservative road / river clearance (blades are jittered up to ~c/2 off the sample)
    const m = c * .5; if (O.eMaj < 1.4 + m || O.eStr < 3 + m || O.eGrv < .9 + m || O.deck || O.eRiv < 2.5 + m) continue;
    const edgeRoad = O.eMaj < 15 || O.eStr < 9;
    const f = S.fieldAt(x, z); if (f.crop === 6 || f.crop === 8 || f.yard < 1 + m) continue;
    const crop = edgeRoad || f.edge < 0 ? 0 : f.crop, b = S.bio(x, z); let d = 1;
    if (b.urban > .5) d *= .3; if (b.arid > .8) d *= .3;
    if (S.waterLevelAt(x, z) > y - .05) continue;
    colFor(crop, b, x, z, tmp);
    H[k * 2 + 1] = tmp[3]; C[k * 4] = Math.min(255, Math.sqrt(tmp[0]) * 255 + .5); C[k * 4 + 1] = Math.min(255, Math.sqrt(tmp[1]) * 255 + .5); C[k * 4 + 2] = Math.min(255, Math.sqrt(tmp[2]) * 255 + .5); C[k * 4 + 3] = d * 255;
  }
}

// ---- worker entry (only when loaded as a module worker)
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
  let S = null;
  self.onmessage = (e) => {
    const m = e.data;
    if (m.t === 'init') { S = makeSampler(m.data); self.postMessage({ t: 'ready' }); return; }
    if (m.t === 'rect') {
      const H = new Float32Array(m.w * m.h * 2), C = new Uint8Array(m.w * m.h * 4);
      try { bakeRect(S, m.c, m.I0, m.J0, m.w, m.h, H, C); } catch (err) { self.postMessage({ t: 'err', id: m.id, msg: String(err?.stack || err) }); return; }
      self.postMessage({ t: 'rect', id: m.id, H, C }, [H.buffer, C.buffer]);
    }
  };
}

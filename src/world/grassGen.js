// Grass data baking for the grass clipmaps (runs in the grass worker; main-thread fallback). No three.js.
// Clipmap texel (I,J) of a level with spacing c samples the world at (I*c, J*c):
//   H (Float32 x2): ground height (terrainAt, matches the terrain mesh), blade height in cm + straw fraction (0 = no grass)
//   C (Uint8 x4)  : sqrt-encoded linear colour rgb, a = kind*16 + density(0..15)
// kinds: 0 prairie / natural, 1 pasture, 2 green wheat, 3 gold wheat, 4 corn (rows along z), 5 soy, 7 hay, 9 stubble,
//        10 corn (rows along x), 11 mown verge
import { hash2 } from '../core/rng.js';
import { makeSampler, OX, OZ, CELL, GX, GZ } from './sampler.js';

const sm = (t) => t * t * (3 - 2 * t);
// smooth value noise 0..1 on an s-metre grid
export function vnoise(x, z, s, seed) {
  const u = x / s, v = z / s, i = Math.floor(u), j = Math.floor(v), a = sm(u - i), b = sm(v - j);
  const h00 = hash2(i, j, seed), h10 = hash2(i + 1, j, seed), h01 = hash2(i, j + 1, seed), h11 = hash2(i + 1, j + 1, seed);
  return (h00 + (h10 - h00) * a) * (1 - b) + (h01 + (h11 - h01) * a) * b;
}

// blade colour (linear rgb) and base height (m) for a kind; o = [r,g,b,h]
export function colFor(kind, b, x, z, o) {
  o[4] = 0;
  const p1 = vnoise(x, z, 7, 11), p2 = vnoise(x, z, 23, 12), p3 = vnoise(x, z, 2.3, 13), p4 = vnoise(x, z, 61, 14);
  const dry = Math.min(1, Math.max(0, b.arid * 1.25 + .1 + (p2 - .5) * .5 - b.forest * .3));
  let r, g, bb, h;
  if (kind === 2) { r = .085; g = .15; bb = .04; h = .62; }
  else if (kind === 3) { r = .30; g = .22; bb = .085; h = .85; }
  else if (kind === 9) { r = .27; g = .2; bb = .08; h = .18; }
  else if (kind === 4 || kind === 10) { r = .07; g = .14; bb = .035; h = 2.0; }
  else if (kind === 5) { r = .075; g = .14; bb = .04; h = .45; }
  else if (kind === 7) { r = .16; g = .18; bb = .07; h = .32; }
  else {
    // grassland: mixed greens with straw patches
    const straw = Math.min(1, Math.max(0, (.16 + dry * .85) * (.15 + 1.35 * p1 * p1 + .5 * p4) + (p3 - .5) * .25)), green = 1 - straw;
    r = .055; g = .10; bb = .028; o[4] = straw * .92; /* straw is applied per blade (stippled) in the shader */
    const lush = (.72 + .3 * p3) * (.8 + .45 * p4); r *= lush; g *= lush; bb *= lush;
    h *= 1; if (kind === 11) h = .16 + .14 * p1;                    // mown verge 15-30 cm (x blade var)
    else if (kind === 1) h = .17 + .2 * p1 * (1 - b.arid * .5); // pasture 15-45 cm
    else h = (.28 + .3 * p2 * (1 - b.arid * .6) + .1 * p1) * (.85 + .3 * p4); // prairie 30-70 cm
  }
  const k = .88 + .24 * p3; o[0] = r * k; o[1] = g * k; o[2] = bb * k; o[3] = h;
}

const tmp = [0, 0, 0, 0, 0];
// fill a w*h rect of clipmap texels starting at global texel (I0,J0), spacing c
export function bakeRect(S, c, I0, J0, w, h, H, C) {
  const O = S.O;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = (I0 + i) * c, z = (J0 + j) * c, k = j * w + i, y = S.terrainAt(x, z);
    H[k * 2] = y; H[k * 2 + 1] = 0; C[k * 4] = C[k * 4 + 1] = C[k * 4 + 2] = C[k * 4 + 3] = 0;
    // conservative road / river clearance (blades are jittered up to ~c/2 off the sample)
    const m = c * .5; if (O.eMaj < .9 + m || O.eStr < 2.6 + m || O.eGrv < .5 + m || O.deck || O.eRiv < 2.2 + m) continue;
    const edgeRoad = O.eMaj < 15 || O.eStr < 9;
    const f = S.fieldAt(x, z); if (f.crop === 6 || f.crop === 8 || f.yard < .5 + m) continue;
    const crop = edgeRoad || f.edge < 0 ? (edgeRoad ? 11 : 0) : f.crop, b = S.bio(x, z); let d = 1;
    const kind = crop === 4 && f.dir ? 10 : crop;
    if (b.urban > .5) d *= .35; if (b.arid > .8) d *= .3;
    if (kind === 4 || kind === 10) d *= .5; else if (kind === 5) d *= .5; else if (kind === 9) d *= .7;
    if (O.eRiv < 7 && O.rivY > y - .05) continue;
    { // coast / lake test only where the macro grid says water is possible (waterLevelAt re-runs groundAt: expensive)
      let gu = Math.round((x - OX) / CELL), gv = Math.round((z - OZ) / CELL); gu = gu < 0 ? 0 : gu > GX - 1 ? GX - 1 : gu; gv = gv < 0 ? 0 : gv > GZ - 1 ? GZ - 1 : gv; const gk = gv * GX + gu, D = S.data;
      if ((D.coast[gk] < 450 || (D.lakeI && D.lakeI[gk] !== 255)) && S.waterLevelAt(x, z) > y - .05) continue; }
    colFor(kind, b, x, z, tmp);
    H[k * 2 + 1] = Math.max(1, Math.round(tmp[3] * 100)) + Math.min(.99, tmp[4]); /* cm + straw fraction */ C[k * 4] = Math.min(255, Math.sqrt(tmp[0]) * 255 + .5); C[k * 4 + 1] = Math.min(255, Math.sqrt(tmp[1]) * 255 + .5); C[k * 4 + 2] = Math.min(255, Math.sqrt(tmp[2]) * 255 + .5);
    C[k * 4 + 3] = kind * 16 + Math.max(1, Math.round(d * 15));
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
      const t0 = performance.now(); try { bakeRect(S, m.c, m.I0, m.J0, m.w, m.h, H, C); } catch (err) { self.postMessage({ t: 'err', id: m.id, msg: String(err?.stack || err) }); return; }
      self.postMessage({ t: 'rect', id: m.id, H, C, ms: performance.now() - t0 }, [H.buffer, C.buffer]);
    }
  };
}

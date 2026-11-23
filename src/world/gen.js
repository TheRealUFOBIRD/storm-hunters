// Chunk generation shared by worker and main-thread fallback. No three.js.
export const N = 64, NV = N + 1;
const NB = N + 3, hb = new Float32Array(NB * NB), nb = new Int8Array(NV * NV * 2);
// returns { h: Float32Array (h, morphH) per vertex + skirt, nrm: Int8Array(4), road: Uint8Array(4), min, max }
export function genChunk(s, x0, z0, size) {
  const st = size / N, total = NV * NV + 4 * NV, h = new Float32Array(total * 2), nrm = new Int8Array(total * 4), road = new Uint8Array(total * 4), O = s.O; let mn = 1e9, mx = -1e9;
  for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) {
    const x = x0 + (i - 1) * st, z = z0 + (j - 1) * st; let y = s.terrainAt(x, z); 
    if (i > 0 && j > 0 && i <= NV && j <= NV) {
      const k = ((j - 1) * NV + i - 1) * 4; const a = O.eMaj, b = O.eStr, c = O.eGrv, d = O.eRiv;
      road[k] = a > 43 ? 255 : a < -5 ? 0 : (a + 5) * 5.3; road[k + 1] = b > 43 ? 255 : b < -5 ? 0 : (b + 5) * 5.3; road[k + 2] = c > 43 ? 255 : c < -5 ? 0 : (c + 5) * 5.3; road[k + 3] = d > 50 ? 255 : d < -14 ? 0 : (d + 14) * 4;
    }
    const e = O.eMaj < O.eStr ? O.eMaj : O.eStr; if (e < -.3 && st < 9) y -= .14; hb[j * NB + i] = y;
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    const b = (j + 1) * NB + i + 1, k = j * NV + i, y = hb[b]; h[k * 2] = y; if (y < mn) mn = y; if (y > mx) mx = y;
    const nx = hb[b - 1] - hb[b + 1], nz = hb[b - NB] - hb[b + NB], l = 127 / Math.sqrt(nx * nx + nz * nz + 4 * st * st); nb[k * 2] = Math.round(nx * l); nb[k * 2 + 1] = Math.round(nz * l);
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    const k = j * NV + i, oi = i & 1, oj = j & 1; let a = k, b = k; if (oi && oj) { a = k - NV + 1; b = k + NV - 1; } else if (oi) { a = k - 1; b = k + 1; } else if (oj) { a = k - NV; b = k + NV; }
    h[k * 2 + 1] = (h[a * 2] + h[b * 2]) * .5; nrm[k * 4] = nb[k * 2]; nrm[k * 4 + 1] = nb[k * 2 + 1]; nrm[k * 4 + 2] = (nb[a * 2] + nb[b * 2]) >> 1; nrm[k * 4 + 3] = (nb[a * 2 + 1] + nb[b * 2 + 1]) >> 1;
  }
  let o = NV * NV; const cp = (k) => { h[o * 2] = h[k * 2]; h[o * 2 + 1] = h[k * 2 + 1]; for (let q = 0; q < 4; q++) { nrm[o * 4 + q] = nrm[k * 4 + q]; road[o * 4 + q] = road[k * 4 + q]; } o++; };
  for (let i = 0; i < NV; i++) cp(i); for (let i = 0; i < NV; i++) cp(N * NV + i); for (let j = 0; j < NV; j++) cp(j * NV); for (let j = 0; j < NV; j++) cp(j * NV + N);
  return { h, nrm, road, min: mn, max: mx };
}

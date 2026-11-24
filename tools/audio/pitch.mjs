// pitch track of engine recordings: harmonic-sum on FFT + Viterbi smoothing.  node pitch.mjs file ss t fmin fmax [hop]
import { decode } from './lib.mjs';
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } } for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr; re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
export function track(file, { ss = 0, t, fmin = 20, fmax = 500, hop = 0.1, H = 6, win = 2048, jump = 0.06 } = {}) {
  const sr = 8000, x = decode(file, { ss, t, sr })[0], N = 16384, df = sr / N, frames = [];
  for (let o = 0; o + win <= x.length; o += Math.floor(hop * sr)) {
    const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < win; i++) re[i] = x[o + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / win)); fft(re, im);
    const M = new Float64Array(N / 2); for (let i = 0; i < N / 2; i++) M[i] = Math.log1p(Math.hypot(re[i], im[i]) * 50);
    const s = []; for (let f = fmin; f <= fmax; f += 0.5) { let v = 0; for (let k = 1; k <= H; k++) { const b = Math.round(k * f / df); if (b < N / 2) v += M[b] / Math.pow(k, 0.3); } v -= 0.5 * M[Math.round(f * 0.5 / df)]; s.push(v); } frames.push(s);
  }
  // viterbi
  const K = frames[0].length, fr = (i) => fmin + i * 0.5, back = [], score = Float64Array.from(frames[0]);
  for (let t = 1; t < frames.length; t++) { const ns = new Float64Array(K), bk = new Int32Array(K); for (let i = 0; i < K; i++) { const f = fr(i), lo = Math.max(0, Math.floor((f * (1 - jump) - fmin) * 2)), hi = Math.min(K - 1, Math.ceil((f * (1 + jump) - fmin) * 2)); let best = -1e9, bi = i; for (let j = lo; j <= hi; j++) { const v = score[j] - 30 * Math.abs(Math.log(fr(j) / f)); if (v > best) { best = v; bi = j; } } ns[i] = best + frames[t][i]; bk[i] = bi; } back.push(bk); score.set(ns); }
  let i = score.indexOf(Math.max(...score)); const path = [i]; for (let t = back.length - 1; t >= 0; t--) { i = back[t][i]; path.push(i); } path.reverse(); return path.map((p, k) => [+(ss + k * hop + win / 2 / sr).toFixed(2), fr(p)]);
}
if (process.argv[1].endsWith('pitch.mjs')) { const [f, ss = 0, t = 0, a = 20, b = 500, hop = 0.25] = process.argv.slice(2); const r = track(f, { ss: +ss, t: +t || undefined, fmin: +a, fmax: +b, hop: +hop }); console.log(r.map(([t, f]) => `${t}:${Math.round(f)}`).join(' ')); }

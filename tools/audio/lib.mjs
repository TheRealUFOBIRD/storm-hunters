// processing helpers: decode with ffmpeg filters -> Float32 PCM in node -> normalise/fade -> encode mp3
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path';
export const SR = 44100;
export function decode(file, { ss = 0, t, ch = 1, af = '', sr = SR } = {}) {
  const a = ['-v', 'error', '-ss', String(ss)]; if (t) a.push('-t', String(t)); a.push('-i', file, '-ac', String(ch), '-ar', String(sr)); if (af) a.push('-af', af); a.push('-f', 'f32le', '-');
  const r = spawnSync('ffmpeg', a, { maxBuffer: 1 << 30 }); if (r.status) throw new Error(r.stderr.toString()); const b = Buffer.from(r.stdout); const x = new Float32Array(b.buffer, b.byteOffset, b.length >> 2);
  if (ch === 1) return [Float32Array.from(x)]; const o = [new Float32Array(x.length / 2), new Float32Array(x.length / 2)]; for (let i = 0; i < o[0].length; i++) { o[0][i] = x[2 * i]; o[1][i] = x[2 * i + 1]; } return o;
}
export const rms = (c) => { let s = 0, n = 0; for (const x of c) { for (let i = 0; i < x.length; i++) s += x[i] * x[i]; n += x.length; } return Math.sqrt(s / n); };
export const peak = (c) => { let p = 0; for (const x of c) for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return p; };
export function gainTo(c, g) { for (const x of c) for (let i = 0; i < x.length; i++) x[i] *= g; return c; }
export function fades(c, a = 0.003, b = 0.02, sr = SR) { for (const x of c) { const n = Math.min(x.length >> 1, a * sr | 0), m = Math.min(x.length >> 1, b * sr | 0); for (let i = 0; i < n; i++) x[i] *= i / n; for (let i = 0; i < m; i++) x[x.length - 1 - i] *= i / m; } return c; }
// loops: rms target (dBFS) with a soft ceiling; shots: peak target
export function normLoop(c, db = -20) { gainTo(c, Math.pow(10, db / 20) / (rms(c) || 1)); const p = peak(c); if (p > 0.95) gainTo(c, 0.95 / p); return c; }
export function normShot(c, db = -1) { return gainTo(c, Math.pow(10, db / 20) / (peak(c) || 1)); }
export function encode(c, out, kbps) {
  const C = c.length, n = c[0].length, b = new Float32Array(n * C); for (let i = 0; i < n; i++) for (let k = 0; k < C; k++) b[i * C + k] = Math.max(-1, Math.min(1, c[k][i]));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', String(C), '-i', '-', '-c:a', 'libmp3lame', '-b:a', (kbps || (C > 1 ? 112 : 80)) + 'k', out], { input: Buffer.from(b.buffer), maxBuffer: 1 << 28 });
  if (r.status) throw new Error(r.stderr.toString()); return fs.statSync(out).size;
}
// envelope (10 ms hop) and onset picking for slicing one-shots out of recordings
export function env(x, sr = SR, hop = 0.01) { const h = hop * sr | 0, e = new Float32Array(Math.floor(x.length / h)); for (let k = 0; k < e.length; k++) { let s = 0; for (let i = k * h; i < (k + 1) * h; i++) s += x[i] * x[i]; e[k] = Math.sqrt(s / h); } return e; }
export function onsets(x, { sr = SR, n = 6, gap = 0.4, pre = 0.01, rise = 3 } = {}) {
  const e = env(x, sr), cand = []; for (let k = 3; k < e.length - 1; k++) { const b = (e[k - 3] + e[k - 2]) / 2 + 1e-6; if (e[k] > b * rise && e[k] >= e[k + 1] * 0.7) cand.push([k, e[k]]); }
  cand.sort((a, b) => b[1] - a[1]); const out = []; for (const [k] of cand) { if (out.every((o) => Math.abs(o - k) * 0.01 > gap)) out.push(k); if (out.length >= n) break; } return out.sort((a, b) => a - b).map((k) => Math.max(0, k * 0.01 - pre));
}
export const slice = (c, a, b, sr = SR) => c.map((x) => x.slice(Math.max(0, a * sr | 0), Math.min(x.length, b * sr | 0)));
// trim leading/trailing quiet (rel to peak)
export function trimQuiet(c, rel = 0.01, tail = 0.05, sr = SR) { const x = c[0], p = peak([x]) * rel; let a = 0, z = x.length - 1; while (a < z && Math.abs(x[a]) < p) a++; while (z > a && Math.abs(x[z]) < p) z--; return c.map((y) => y.slice(Math.max(0, a - 40), Math.min(y.length, z + tail * sr))); }

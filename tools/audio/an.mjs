// node an.mjs [--step s] files... -> loudness envelope (dB per step) + brightness, to pick segments without listening
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2); let step = 1; if (args[0] === '--step') { step = +args[1]; args.splice(0, 2); }
export function pcm(f, sr = 16000) { const r = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 }); const b = r.stdout; return new Float32Array(b.buffer, b.byteOffset, b.length >> 2); }
for (const f of args) {
  const sr = 16000, x = pcm(f, sr), n = Math.floor(step * sr), env = [], cen = [];
  for (let o = 0; o + n <= x.length; o += n) { let s = 0, d = 0, e = 0; for (let i = o; i < o + n; i++) { s += x[i] * x[i]; if (i > o) { const q = x[i] - x[i - 1]; d += q * q; } } e = Math.sqrt(s / n); env.push(Math.round(20 * Math.log10(e + 1e-9))); cen.push(Math.round(Math.sqrt(d / (s + 1e-12)) * sr / (2 * Math.PI))); }
  let s = 0, p = 0; for (const v of x) { s += v * v; p = Math.max(p, Math.abs(v)); }
  console.log(`# ${f.split(/[\\/]/).pop()} ${(x.length / sr).toFixed(1)}s rms ${(20 * Math.log10(Math.sqrt(s / x.length))).toFixed(1)}dB peak ${(20 * Math.log10(p)).toFixed(1)}dB`);
  console.log('  dB : ' + env.join(' ')); console.log('  Hz : ' + cen.join(' '));
}

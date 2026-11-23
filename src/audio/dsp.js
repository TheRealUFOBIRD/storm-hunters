// Offline DSP: every one-shot and texture loop of the game is synthesised here (pure JS, runs in a worker or in node).
// SOUNDS[name](sr) -> Float32Array | [L, R]
const TAU = Math.PI * 2;
export function mulberry(seed) { let s = seed >>> 0; const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; r.n = () => r() * 2 - 1; r.range = (a, b) => a + (b - a) * r(); r.pick = (a) => a[Math.floor(r() * a.length)]; return r; }
export const buf = (sr, s) => new Float32Array(Math.max(1, Math.round(sr * s)));
// RBJ biquad, in place
export function biquad(x, type, f, Q, sr, dbGain = 0) {
  const w = TAU * Math.min(f, sr * 0.49) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q), A = Math.pow(10, dbGain / 40); let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b1 = 1 - c; b0 = b2 = b1 / 2; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; } else if (type === 'hp') { b0 = b2 = (1 + c) / 2; b1 = -(1 + c); a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; } else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; } else { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0; let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = Math.abs(y) < 1e-18 ? 0 : y; x[i] = y; } return x;
}
export function white(sr, s, r) { const b = buf(sr, s); for (let i = 0; i < b.length; i++) b[i] = r.n(); return b; }
export function pink(sr, s, r) { const b = buf(sr, s); let a = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0; for (let i = 0; i < b.length; i++) { const w = r.n(); a = 0.99886 * a + w * 0.0555179; c = 0.99332 * c + w * 0.0750759; d = 0.969 * d + w * 0.153852; e = 0.8665 * e + w * 0.3104856; f = 0.55 * f + w * 0.5329522; g = -0.7616 * g - w * 0.016898; b[i] = (a + c + d + e + f + g + h + w * 0.5362) * 0.11; h = w * 0.115926; } return b; }
export function brown(sr, s, r) { const b = buf(sr, s); let v = 0; for (let i = 0; i < b.length; i++) { v = (v + r.n() * 0.045) * 0.9975; b[i] = v; } return b; }
export function peak(x) { let m = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; } return m; }
export function norm(x, p = 0.9) { const m = peak(x); if (m > 1e-9) { const g = p / m; for (let i = 0; i < x.length; i++) x[i] *= g; } return x; }
export function rms(x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); }
export function normRms(x, target = 0.2, clip = 0.98) { const g = target / (rms(x) || 1); for (let i = 0; i < x.length; i++) { const v = x[i] * g; x[i] = Math.abs(v) > 0.7 ? Math.sign(v) * (0.7 + Math.tanh((Math.abs(v) - 0.7) / (clip - 0.7)) * (clip - 0.7)) : v; } return x; }
export function mix(o, x, at = 0, g = 1) { const n = Math.min(x.length, o.length - at); for (let i = Math.max(0, -at); i < n; i++) o[at + i] += x[i] * g; return o; }
export function mixWrap(o, x, at, g = 1) { const L = o.length; for (let i = 0; i < x.length; i++) o[(at + i) % L] += x[i] * g; return o; }
export function mul(x, f) { for (let i = 0; i < x.length; i++) x[i] *= f(i); return x; }
export function fade(x, sr, a = 0.002, b = 0.01) { const n = Math.floor(a * sr), m = Math.floor(b * sr), L = x.length; for (let i = 0; i < n && i < L; i++) x[i] *= i / n; for (let i = 0; i < m && i < L; i++) x[L - 1 - i] *= i / m; return x; }
// equal-power crossfade of the tail into the head -> seamless loop
export function loop(x, sr, f = 0.4) { const n = Math.floor(f * sr), L = x.length - n, o = x.slice(0, L); for (let i = 0; i < n; i++) { const t = i / n; o[i] = x[i] * Math.sin(t * Math.PI / 2) + x[L + i] * Math.cos(t * Math.PI / 2); } return o; }
// sum of decaying sinusoids (struck resonant body). modes: [freq, amp, decay s]
export function modal(sr, s, modes, r, strike = 0.0006) {
  const b = buf(sr, s);
  for (const [f, a, d] of modes) { if (f > sr * 0.45) continue; const w = TAU * f / sr, k = Math.exp(-1 / (d * sr)), ph = r() * 0.6; let y1 = Math.sin(ph) * a, y2 = Math.sin(ph - w) / k * a; const c = 2 * k * Math.cos(w), kk = k * k, n = Math.min(b.length, Math.floor(d * sr * 8)); for (let i = 0; i < n; i++) { b[i] += y1; const y = c * y1 - kk * y2; y2 = y1; y1 = y; } }
  const m = Math.max(1, Math.floor(strike * sr)); for (let i = 0; i < m && i < b.length; i++) b[i] *= i / m; return b;
}
export function burst(sr, s, decay, r, type, f, Q) { const b = white(sr, s, r); if (type) biquad(b, type, f, Q || 0.7, sr); const k = Math.exp(-1 / (decay * sr)); let e = 1; for (let i = 0; i < b.length; i++) { b[i] *= e; e *= k; } return b; }
export function tone(sr, s, f, env, shape = Math.sin) { const b = buf(sr, s); let p = 0; for (let i = 0; i < b.length; i++) { const t = i / sr; p += TAU * (typeof f === 'function' ? f(t) : f) / sr; b[i] = shape(p) * env(t); } return b; }
const ad = (a, d) => (t) => Math.min(1, t / a) * Math.exp(-Math.max(0, t - a) / d);
export const gate = (a, len, rel) => (t) => Math.max(0, Math.min(1, t / a) * (t < len ? 1 : 1 - (t - len) / rel));
// Karplus-Strong plucked string with pick position, body resonance
export function pluck(sr, f, s, r, { bright = 0.5, damp = 0.996, pos = 0.17, body = true } = {}) {
  const N = sr / f, n = Math.floor(N), fr = N - n, d = new Float32Array(n + 1), o = buf(sr, s); let lp = 0;
  for (let i = 0; i < n; i++) { const w = r.n(); lp += (w - lp) * (0.15 + 0.8 * bright); d[i] = lp; }
  const k = Math.floor(n * pos); const e = d.slice(); for (let i = 0; i < n; i++) d[i] = e[i] - 0.9 * e[(i + k) % n];
  let p = 0, last = 0, ap = 0, px = 0;
  for (let i = 0; i < o.length; i++) { const x = d[p], nx = d[(p + 1) % n], y = (x * (0.5 + 0.5 * bright * 0.6) + last * (0.5 - 0.5 * bright * 0.6)) * damp; last = x; const c = (1 - fr) / (1 + fr), q = c * (y - ap) + px; ap = q; px = y; d[p] = q; o[i] = x; p = (p + 1) % n; }
  if (body) { const b1 = biquad(o.slice(), 'bp', 110, 1.6, sr), b2 = biquad(o.slice(), 'bp', 235, 2.2, sr), b3 = biquad(o.slice(), 'bp', 2400, 1, sr); for (let i = 0; i < o.length; i++) o[i] = o[i] * 0.6 + b1[i] * 0.9 + b2[i] * 0.6 + b3[i] * 0.15; }
  biquad(o, 'hp', 50, 0.7, sr); return fade(norm(o, 0.8), sr, 0.001, 0.15);
}
const st = (f) => (sr) => { const a = f(sr, mulberry(101)), b = f(sr, mulberry(9091)); return [a, b]; };
const seed = (n) => mulberry(n * 7919 + 13);

// ---- textures ------------------------------------------------------------------------------------------------------
function rain(sr, r, o) {
  const L = 5, b = buf(sr, L), bed = pink(sr, L + 0.4, r); biquad(bed, 'hp', o.hp, 0.7, sr); biquad(bed, 'lp', o.lp, 0.6, sr); mix(b, loop(bed, sr), 0, o.bed);
  const proto = []; for (let i = 0; i < 14; i++) { const f = r.range(o.f0, o.f1); proto.push(o.metal ? mix(modal(sr, 0.09, [[f * 0.31, 0.5, 0.018], [f * 0.53, 0.8, 0.014], [f, 1, 0.009], [f * 1.71, 0.7, 0.006], [f * 2.63, 0.4, 0.004]], r, 0.0003), burst(sr, 0.01, 0.0012, r, 'hp', 2500), 0, 0.8) : mix(burst(sr, 0.03, r.range(0.0015, 0.006), r, 'bp', f, 0.9), tone(sr, 0.02, (t) => f * (0.6 + t * 22), ad(0.0005, 0.004)), 0, 0.35)); }
  for (let i = 0; i < o.n; i++) mixWrap(b, r.pick(proto), Math.floor(r() * b.length), o.drop * Math.pow(r(), 2.2)); return normRms(b, o.rms);
}
function debris(sr, r) {
  const L = 11, b = buf(sr, L);
  const mk = { wood: () => { const f = r.range(180, 620); return mix(modal(sr, 0.3, [[f, 1, 0.03], [f * 1.63, 0.7, 0.022], [f * 2.7, 0.5, 0.014], [f * 4.1, 0.3, 0.009]], r), burst(sr, 0.08, 0.012, r, 'bp', 1800, 0.7), 0, 0.9); }, metal: () => { const f = r.range(160, 900), m = []; for (let i = 0; i < 9; i++) m.push([f * (1 + i * r.range(0.35, 0.9)), r.range(0.2, 1), r.range(0.03, 0.22)]); return mix(modal(sr, 0.8, m, r), burst(sr, 0.05, 0.006, r, 'hp', 2500), 0, 0.8); }, glass: () => { const o = buf(sr, 0.5); for (let k = 0; k < 10; k++) { const f = r.range(2600, 8500); mix(o, modal(sr, 0.14, [[f, 1, r.range(0.01, 0.05)], [f * 1.47, 0.6, 0.015]], r), Math.floor(r() * r() * 0.3 * sr), r.range(0.1, 0.5)); } return mix(o, burst(sr, 0.06, 0.01, r, 'hp', 4000), 0, 0.6); }, tin: () => { const x = burst(sr, 0.7, 0.16, r, 'bp', r.range(400, 1300), 2.2), q = r.range(18, 34); return mul(x, (i) => 0.4 + 0.6 * Math.abs(Math.sin(i / sr * q * 3))); }, grit: () => burst(sr, 0.12, 0.03, r, 'hp', r.range(1500, 4500)), thud: () => tone(sr, 0.35, (t) => 70 * Math.exp(-t * 6) + 38, ad(0.003, 0.09)) };
  const w = ['wood', 'wood', 'wood', 'metal', 'metal', 'tin', 'glass', 'grit', 'grit', 'grit', 'thud'];
  for (let i = 0; i < 210; i++) { const x = mk[r.pick(w)](); mixWrap(b, norm(x, 1), Math.floor(r() * b.length), 0.08 + 0.7 * Math.pow(r(), 2.6)); }
  return normRms(b, 0.16);
}
// smooth random control curve 0..1, loopable
function wander(n, pts, r) { const v = Array.from({ length: pts }, () => r()), o = new Float32Array(n); for (let i = 0; i < n; i++) { const u = i / n * pts, k = Math.floor(u), t = u - k, s = t * t * (3 - 2 * t); o[i] = v[k % pts] * (1 - s) + v[(k + 1) % pts] * s; } return o; }
function roar(sr, r) { // broadband "freight train / waterfall" bed with irregular surges and rhythmic clatter of the rotation
  const L = 9, n = Math.floor((L + 0.6) * sr), a = pink(sr, L + 0.6, r), b = a.slice(), c = white(sr, L + 0.6, r), w1 = wander(n, 24, r), w2 = wander(n, 70, r); biquad(a, 'bp', 190, 0.6, sr); biquad(b, 'bp', 720, 0.5, sr); biquad(c, 'bp', 2600, 0.5, sr);
  const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = a[i] * (0.75 + 0.6 * w1[i]) * 1.6 + b[i] * (0.5 + 0.9 * w2[i]) * 0.8 + c[i] * (0.4 + 0.6 * w1[n - 1 - i]) * 0.1; return normRms(loop(o, sr, 0.6), 0.22);
}
function scream(sr, r) { // vortex whistle: several narrow unstable resonances sliding around
  const L = 8, n = Math.floor((L + 0.5) * sr), o = new Float32Array(n);
  for (const [f, q] of [[410, 26], [655, 34], [980, 30], [1480, 36], [2210, 30]]) { const w = wander(n, 16, r), g = wander(n, 22, r), x = white(sr, L + 0.5, r); let y1 = 0, y2 = 0; for (let i = 0; i < n; i++) { const fr = f * (0.82 + 0.36 * w[i]), R = 1 - Math.PI * fr / q / sr, y = (1 - R) * x[i] * 3 + 2 * R * Math.cos(TAU * fr / sr) * y1 - R * R * y2; y2 = y1; y1 = y; o[i] += y * g[i] * g[i] * Math.sqrt(410 / f); } }
  return normRms(loop(o, sr, 0.5), 0.14);
}
function rumble(sr, r) { const L = 10, n = Math.floor((L + 1) * sr), a = brown(sr, L + 1, r), w = wander(n, 30, r); biquad(a, 'lp', 75, 0.8, sr); biquad(a, 'hp', 17, 0.7, sr); for (let i = 0; i < n; i++) a[i] *= 0.45 + 0.85 * w[i]; return normRms(loop(a, sr, 1), 0.25); }
function wind(sr, r) { const L = 8, n = Math.floor((L + 0.6) * sr), a = pink(sr, L + 0.6, r), w = wander(n, 14, r); biquad(a, 'lp', 900, 0.6, sr); biquad(a, 'hp', 40, 0.7, sr); for (let i = 0; i < n; i++) a[i] *= 0.6 + 0.6 * w[i]; return normRms(loop(a, sr, 0.6), 0.2); }
function gravel(sr, r) { const L = 3, b = buf(sr, L); for (let i = 0; i < 2600; i++) { const x = burst(sr, 0.02, r.range(0.001, 0.005), r, 'bp', r.range(700, 5200), 1); mixWrap(b, x, Math.floor(r() * b.length), Math.pow(r(), 3)); } const bed = pink(sr, L + 0.3, r); biquad(bed, 'bp', 420, 0.5, sr); mix(b, loop(bed, sr, 0.3), 0, 0.5); return normRms(b, 0.2); }
function roll(sr, r) { const a = pink(sr, 4.4, r), b = a.slice(); biquad(a, 'bp', 900, 0.8, sr); biquad(b, 'lp', 190, 0.7, sr); for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.8 + b[i] * 0.9; return normRms(loop(a, sr), 0.2); }
function hiss(sr, r) { const a = white(sr, 3.4, r); biquad(a, 'bp', 3600, 0.5, sr); biquad(a, 'hp', 1200, 0.7, sr); return normRms(loop(a, sr), 0.16); }
function squeal(sr, r) { const L = 3, n = Math.floor((L + 0.3) * sr), o = new Float32Array(n), w = wander(n, 20, r), w2 = wander(n, 33, r), nz = white(sr, L + 0.3, r); let p = 0, p2 = 0; for (let i = 0; i < n; i++) { const f = 820 + 190 * w[i] + nz[i] * 60; p += f / sr; p2 += f * 1.487 / sr; const s1 = (p % 1) * 2 - 1, s2 = (p2 % 1) * 2 - 1; o[i] = (Math.tanh(s1 * 2.2) * 0.6 + s2 * 0.35) * (0.55 + 0.6 * w2[i]) + nz[i] * 0.22; } biquad(o, 'bp', 1150, 0.9, sr); biquad(o, 'hp', 420, 0.7, sr); return normRms(loop(o, sr, 0.3), 0.18); }
function crickets(sr, r) { const L = 8, b = buf(sr, L); for (let c = 0; c < 7; c++) { const f = r.range(3900, 5100), per = r.range(0.42, 0.75), g = r.range(0.15, 1), ph = r() * per, np = Math.floor(L / per); for (let k = 0; k < np; k++) for (let j = 0; j < 3; j++) { const x = tone(sr, 0.035, f * (1 + j * 0.004), (t) => Math.sin(Math.min(1, t / 0.033) * Math.PI) ** 2); mixWrap(b, x, Math.floor((k * L / np + ph + j * 0.048 + r() * 0.004) * sr), g); } } return normRms(b, 0.1); }
function cicada(sr, r) { const L = 9, n = Math.floor((L + 0.6) * sr), x = white(sr, L + 0.6, r), w = wander(n, 5, r); biquad(x, 'bp', 5600, 5, sr); biquad(x, 'bp', 5900, 3, sr); for (let i = 0; i < n; i++) { const t = i / sr; x[i] *= (0.35 + 0.65 * Math.abs(Math.sin(t * TAU * 43))) * (0.25 + 0.75 * w[i]); } return normRms(loop(x, sr, 0.6), 0.09); }
function frogs(sr, r) { const L = 10, b = buf(sr, L); for (let c = 0; c < 5; c++) { const f = r.range(380, 1150), per = r.range(0.7, 1.6), np = Math.floor(L / per), g = r.range(0.2, 0.9); for (let k = 0; k < np; k++) if (r() < 0.75) { const x = tone(sr, 0.22, (t) => f * (0.9 + 0.5 * t), (t) => Math.sin(Math.min(1, t / 0.21) * Math.PI) * (0.4 + 0.6 * Math.max(0, Math.sin(t * TAU * 46))), (p) => Math.tanh(1.8 * Math.sin(p))); mixWrap(b, x, Math.floor((k * L / np + r() * 0.2) * sr), g); } } return normRms(b, 0.09); }
function leaves(sr, r) { const L = 7, n = Math.floor((L + 0.5) * sr), a = white(sr, L + 0.5, r), w = wander(n, 18, r); biquad(a, 'bp', 3200, 0.5, sr); for (let i = 0; i < n; i++) a[i] *= 0.15 + 0.9 * w[i] * w[i]; return normRms(loop(a, sr, 0.5), 0.1); }

// ---- one shots -----------------------------------------------------------------------------------------------------
const bird = (k) => (sr) => { const r = seed(60 + k), o = buf(sr, 1.6); const sp = [() => { for (let i = 0, t = 0; i < 4 + r() * 5; i++) { const f = r.range(3000, 5200), d = r.range(0.04, 0.12), s = r.range(-9000, 9000); mix(o, tone(sr, d, (u) => f + s * u, (u) => Math.sin(u / d * Math.PI) ** 2), Math.floor(t * sr), 0.8); t += d + r.range(0.02, 0.09); } }, () => { const f = r.range(2100, 2900); for (const [a, b, t] of [[f, f * 1.25, 0], [f * 1.25, f * 0.85, 0.22], [f * 0.95, f * 0.8, 0.5]]) mix(o, tone(sr, 0.19, (u) => a + (b - a) * u / 0.19, (u) => Math.sin(u / 0.19 * Math.PI) ** 1.4), Math.floor(t * sr), 0.8); }, () => { const f = r.range(3400, 4600), n = 9 + Math.floor(r() * 9); for (let i = 0; i < n; i++) mix(o, tone(sr, 0.045, (u) => f * (1 + 0.16 * Math.sin(u * 140)), (u) => Math.sin(u / 0.045 * Math.PI)), Math.floor(i * 0.066 * sr), 0.4 + 0.4 * i / n); }, () => { for (let i = 0; i < 2; i++) mix(o, tone(sr, 0.5, (u) => 1950 + 420 * Math.sin(u * 6.2 + i) + 30 * Math.sin(u * 190), (u) => Math.sin(u / 0.5 * Math.PI)), Math.floor(i * 0.62 * sr), 0.7); }]; sp[k % 4](); return norm(o, 0.7); };
const hailCar = (k) => (sr) => { const r = seed(20 + k), f = 210 + k * 75 + r() * 60, m = []; for (let i = 0; i < 12; i++) m.push([f * (1 + i * r.range(0.42, 0.78)), Math.pow(0.82, i) * r.range(0.5, 1), r.range(0.018, 0.085)]); const o = modal(sr, 0.42, m, r, 0.0002); mix(o, burst(sr, 0.03, 0.0024, r, 'hp', 1600), 0, 4.2); mix(o, tone(sr, 0.12, (t) => 120 * Math.exp(-t * 14) + 70, ad(0.001, 0.028)), 0, 1.6); return fade(norm(o, 0.9), sr, 0, 0.05); };
const hailGround = (k) => (sr) => { const r = seed(40 + k), o = burst(sr, 0.12, 0.012, r, 'bp', 500 + 350 * k, 0.8); mix(o, tone(sr, 0.1, 150 + 30 * k, ad(0.001, 0.02)), 0, 0.8); return fade(norm(o, 0.8), sr, 0, 0.03); };
const impact = (k) => (sr) => { // 0 light .. 3 heavy
  const r = seed(80 + k), L = 0.7 + k * 0.45, o = buf(sr, L), m = []; for (let i = 0; i < 18; i++) m.push([r.range(90, 400 + 900 * (1 - k / 5)) * (1 + i * 0.33), r.range(0.2, 1) * Math.pow(0.93, i), r.range(0.02, 0.1 + 0.08 * k)]);
  mix(o, modal(sr, L, m, r), 0, 0.5); mix(o, burst(sr, L, 0.03 + 0.03 * k, r, 'lp', 1400 + 900 * k), 0, 1.2); mix(o, tone(sr, L, (t) => (90 - 12 * k) * Math.exp(-t * 7) + 34, ad(0.002, 0.07 + 0.05 * k)), 0, 1.2 + 0.4 * k);
  for (let i = 0; i < 4 + k * 9; i++) { const t = 0.01 + r() * r() * (0.15 + 0.25 * k); mix(o, r() < 0.6 ? burst(sr, 0.09, r.range(0.005, 0.025), r, 'bp', r.range(600, 4200), 1.2) : modal(sr, 0.2, [[r.range(700, 3600), 1, 0.03], [r.range(1500, 6000), 0.5, 0.016]], r), Math.floor(t * sr), r.range(0.1, 0.55) * Math.exp(-t * 4)); }
  for (let i = 0; i < o.length; i++) o[i] = Math.tanh(o[i] * 1.4); return fade(norm(o, 0.95), sr, 0, 0.1);
};
const glass = (k) => (sr) => { const r = seed(90 + k), o = buf(sr, 1.5); mix(o, burst(sr, 0.12, 0.018, r, 'hp', 2800), 0, 1); for (let i = 0; i < 70; i++) { const t = r() * r() * 1.1, f = r.range(2400, 9500); mix(o, modal(sr, 0.22, [[f, 1, r.range(0.008, 0.05)], [f * 1.36, 0.5, 0.014], [f * 1.9, 0.3, 0.01]], r), Math.floor(t * sr), r.range(0.05, 0.4) * Math.exp(-t * 2)); } return fade(norm(o, 0.85), sr, 0, 0.1); };
const thump = (k) => (sr) => { const r = seed(100 + k), o = tone(sr, 0.35, (t) => (78 + 12 * k) * Math.exp(-t * 9) + 36, ad(0.003, 0.06)); mix(o, burst(sr, 0.15, 0.02, r, 'lp', 420), 0, 0.9); mix(o, modal(sr, 0.15, [[310 + 60 * k, 0.5, 0.02], [760, 0.25, 0.012]], r), 0, 0.5); return fade(norm(o, 0.9), sr, 0, 0.05); };
const step = (type, k) => (sr) => { const r = seed(120 + k * 5 + type.length), o = buf(sr, 0.3), [f, q, d, g] = { grass: [900, 0.5, 0.035, 0.9], gravel: [2400, 0.6, 0.03, 1], asphalt: [480, 0.8, 0.018, 1] }[type]; mix(o, burst(sr, 0.14, d, r, 'bp', f, q), 0, g); mix(o, tone(sr, 0.12, 95, ad(0.002, 0.022)), 0, 0.5); if (type === 'gravel') for (let i = 0; i < 16; i++) mix(o, burst(sr, 0.02, 0.003, r, 'bp', r.range(1500, 5500), 1.4), Math.floor((0.005 + r() * 0.11) * sr), r() * 0.8); return fade(norm(o, 0.8), sr, 0.001, 0.05); };
const noteFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const PLUCKS = [38, 41, 43, 45, 48, 50, 53, 55, 57, 60, 62, 65, 67, 69, 72, 74];
function string(sr, m, s, r) { // ensemble of bowed strings
  const o = buf(sr, s), f = noteFreq(m); for (let v = 0; v < 4; v++) { const d = 1 + (v - 1.5) * 0.0028; let p = r(), q = 0; for (let i = 0; i < o.length; i++) { const t = i / sr; q += 0.00025 * r.n(); q *= 0.9995; p += f * d * (1 + q + 0.0022 * Math.sin(t * 33 + v * 2) * Math.min(1, t * 3)) / sr; o[i] += ((p % 1) * 2 - 1) * 0.25; } }
  biquad(o, 'lp', Math.min(5200, f * 7), 0.7, sr); biquad(o, 'pk', 320, 1.2, sr, 4); biquad(o, 'pk', 1100, 1.4, sr, 3); return mul(o, (i) => { const t = i / sr; return Math.min(1, t / 0.025) * (t < s - 0.16 ? 0.55 + 0.45 * Math.exp(-t * 5) : 0.5 * Math.max(0, (s - t) / 0.16)); });
}
export const SOUNDS = {
  // loops
  white: st((sr, r) => normRms(loop(white(sr, 3.4, r), sr), 0.3)), pink: st((sr, r) => normRms(loop(pink(sr, 5.4, r), sr), 0.2)), brown: st((sr, r) => normRms(loop(brown(sr, 7.5, r), sr, 0.5), 0.2)),
  roar: st(roar), scream: st(scream), rumble: (sr) => rumble(sr, seed(3)), debris: st(debris), wind: st(wind),
  rainGround: st((sr, r) => rain(sr, r, { bed: 1, hp: 700, lp: 6500, n: 2600, f0: 1400, f1: 5200, drop: 1.2, rms: 0.13 })), rainRoof: st((sr, r) => rain(sr, r, { metal: true, bed: 0.16, hp: 180, lp: 2200, n: 620, f0: 620, f1: 2100, drop: 0.9, rms: 0.12 })), rainGlass: st((sr, r) => rain(sr, r, { bed: 0.1, hp: 900, lp: 5000, n: 430, f0: 1700, f1: 3800, drop: 1.1, rms: 0.08 })),
  gravel: (sr) => gravel(sr, seed(5)), roll: st(roll), hiss: (sr) => hiss(sr, seed(6)), squeal: (sr) => squeal(sr, seed(7)), crickets: st(crickets), cicada: (sr) => cicada(sr, seed(9)), frogs: st(frogs), leaves: st(leaves),
  // weather / world
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((k) => ['hailCar' + k, hailCar(k)])), ...Object.fromEntries([0, 1, 2, 3].map((k) => ['hailGround' + k, hailGround(k)])), ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((k) => ['bird' + k, bird(k)])),
  ...Object.fromEntries([0, 1, 2, 3].map((k) => ['impact' + k, impact(k)])), glass0: glass(0), glass1: glass(1), ...Object.fromEntries([0, 1, 2].map((k) => ['thump' + k, thump(k)])),
  ...Object.fromEntries(['grass', 'gravel', 'asphalt'].flatMap((t) => [0, 1, 2].map((k) => ['step_' + t + k, step(t, k)]))),
  crack: (sr) => { const r = seed(140), o = buf(sr, 1.1); for (let i = 0; i < 26; i++) { const t = r() * r() * 0.6, f = r.range(160, 620); mix(o, modal(sr, 0.2, [[f, 1, 0.024], [f * 1.8, 0.6, 0.016], [f * 3.1, 0.4, 0.01]], r), Math.floor(t * sr), r.range(0.15, 0.8)); mix(o, burst(sr, 0.06, 0.008, r, 'bp', r.range(1200, 3800), 0.8), Math.floor(t * sr), r.range(0.2, 0.9)); } mix(o, tone(sr, 0.6, (t) => 60 * Math.exp(-t * 3) + 34, ad(0.004, 0.16)), Math.floor(0.12 * sr), 1); return fade(norm(o, 0.9), sr, 0, 0.1); },
  zap: (sr) => { const r = seed(141), o = buf(sr, 0.9), n = white(sr, 0.9, r); for (let i = 0; i < o.length; i++) { const t = i / sr; o[i] = (((t * 120) % 1) < 0.35 ? 1 : 0.15) * (n[i] * 0.7 + (((t * 60) % 1) * 2 - 1) * 0.6) * Math.exp(-t * 3.4) * (0.6 + 0.4 * (Math.sin(t * 71) > 0)); } biquad(o, 'bp', 1800, 0.4, sr); mix(o, tone(sr, 0.5, 58, ad(0.001, 0.14)), 0, 0.6); return fade(norm(o, 0.9), sr, 0, 0.1); },
  whoosh: (sr) => { const r = seed(142), x = pink(sr, 0.9, r); biquad(x, 'bp', 700, 0.7, sr); return fade(norm(mul(x, (i) => Math.sin(Math.min(1, i / x.length) * Math.PI) ** 2), 0.8), sr); },
  // vehicle
  doorOpen: (sr) => { const r = seed(150), o = buf(sr, 0.5); mix(o, modal(sr, 0.1, [[1250, 1, 0.012], [2900, 0.6, 0.007], [520, 0.7, 0.02]], r), 0, 0.8); mix(o, burst(sr, 0.05, 0.006, r, 'bp', 2600, 1), Math.floor(0.045 * sr), 0.7); mix(o, burst(sr, 0.3, 0.08, r, 'bp', 480, 0.8), Math.floor(0.07 * sr), 0.25); return fade(norm(o, 0.7), sr, 0, 0.05); },
  doorClose: (sr) => { const r = seed(151), o = buf(sr, 0.6); mix(o, tone(sr, 0.4, (t) => 96 * Math.exp(-t * 11) + 44, ad(0.002, 0.07)), 0, 1.2); mix(o, burst(sr, 0.2, 0.02, r, 'lp', 1300), 0, 1); mix(o, modal(sr, 0.12, [[820, 0.6, 0.012], [1900, 0.5, 0.008], [3400, 0.3, 0.005]], r), Math.floor(0.012 * sr), 0.7); return fade(norm(o, 0.9), sr, 0, 0.08); },
  starter: (sr) => { const r = seed(152), L = 1.05, o = buf(sr, L), nz = white(sr, L, r); let p = 0, q = 0; for (let i = 0; i < o.length; i++) { const t = i / sr, f = 8.5 + 2 * Math.sin(t * 9); p += f / sr; const c = 0.55 + 0.45 * Math.cos(TAU * p); q += (210 + 60 * c) / sr; o[i] = (((q % 1) * 2 - 1) * 0.5 + nz[i] * 0.2) * (0.45 + 0.55 * c) * Math.min(1, t * 25) * Math.min(1, (L - t) * 8); } biquad(o, 'bp', 950, 0.6, sr); mix(o, modal(sr, 0.1, [[900, 1, 0.012], [2300, 0.5, 0.008]], r), 0, 0.4); return norm(o, 0.75); },
  shift: (sr) => { const r = seed(153), o = modal(sr, 0.12, [[340, 1, 0.02], [810, 0.5, 0.012], [1700, 0.25, 0.006]], r); mix(o, burst(sr, 0.06, 0.008, r, 'lp', 900), 0, 0.7); return fade(norm(o, 0.7), sr, 0, 0.03); },
  blowoff: (sr) => { const r = seed(154), x = white(sr, 0.45, r); let y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const t = i / sr, f = 3600 * Math.exp(-t * 4) + 900, R = 1 - Math.PI * f / 3 / sr, y = x[i] * 0.2 + 2 * R * Math.cos(TAU * f / sr) * y1 - R * R * y2; y2 = y1; y1 = y; x[i] = y * Math.exp(-t * 8) * Math.min(1, t * 120); } return norm(x, 0.7); },
  pop: (sr) => { const r = seed(155), o = burst(sr, 0.16, 0.014, r, 'lp', 1700); mix(o, tone(sr, 0.14, (t) => 150 * Math.exp(-t * 20) + 60, ad(0.001, 0.025)), 0, 0.9); return fade(norm(o, 0.9), sr, 0, 0.03); },
  tick: (sr) => { const r = seed(156); return fade(norm(modal(sr, 0.05, [[2300, 1, 0.004], [4100, 0.6, 0.0025], [900, 0.4, 0.006]], r), 0.6), sr, 0, 0.01); }, tock: (sr) => { const r = seed(157); return fade(norm(modal(sr, 0.05, [[1700, 1, 0.005], [3300, 0.5, 0.003], [700, 0.5, 0.007]], r), 0.6), sr, 0, 0.01); },
  wiper: (sr) => { const r = seed(158), x = white(sr, 0.75, r); biquad(x, 'bp', 1300, 0.7, sr); mul(x, (i) => { const u = i / x.length; return Math.sin(u * Math.PI) ** 0.7 * (0.6 + 0.4 * Math.sin(u * 190)); }); const o = norm(x, 0.35); mix(o, thump(0)(sr).subarray(0, Math.floor(0.2 * sr)), Math.floor(0.58 * sr), 0.4); return fade(o, sr, 0.02, 0.08); },
  splash: (sr) => { const r = seed(159), x = white(sr, 1, r); biquad(x, 'bp', 1600, 0.4, sr); return fade(norm(mul(x, (i) => { const t = i / sr; return Math.min(1, t * 30) * Math.exp(-t * 4.5); }), 0.8), sr, 0, 0.1); },
  clamp: (sr) => { const r = seed(160), o = buf(sr, 1.2), x = pink(sr, 0.8, r); biquad(x, 'bp', 900, 1.5, sr); mul(x, (i) => Math.min(1, i / sr * 12) * Math.min(1, (0.8 - i / sr) * 10)); mix(o, norm(x, 0.35)); mix(o, impact(0)(sr), Math.floor(0.75 * sr), 0.8); return fade(norm(o, 0.85), sr, 0.005, 0.1); },
  // tools
  shutter: (sr) => { const r = seed(170), o = buf(sr, 0.28); const c = (t, f, g) => { mix(o, modal(sr, 0.05, [[f, 1, 0.004], [f * 1.9, 0.7, 0.0025], [f * 0.42, 0.6, 0.007]], r), Math.floor(t * sr), g); mix(o, burst(sr, 0.03, 0.0035, r, 'hp', 2200), Math.floor(t * sr), g * 0.9); }; c(0, 1500, 0.9); c(0.018, 2600, 0.5); c(0.078, 1900, 0.8); c(0.092, 1150, 0.5); mix(o, burst(sr, 0.09, 0.03, r, 'bp', 3200, 1), Math.floor(0.1 * sr), 0.12); return fade(norm(o, 0.85), sr, 0, 0.03); },
  beep: (sr) => fade(tone(sr, 0.07, 1480, gate(0.003, 0.05, 0.018), (p) => Math.sin(p) + 0.2 * Math.sin(2 * p)).map((v) => v * 0.6), sr), beepHi: (sr) => fade(tone(sr, 0.09, 2090, gate(0.003, 0.065, 0.02), (p) => Math.sin(p) + 0.2 * Math.sin(2 * p)).map((v) => v * 0.6), sr),
  geiger: (sr) => { const r = seed(171), o = burst(sr, 0.02, 0.0014, r, 'bp', 2800, 0.8); mix(o, tone(sr, 0.012, 1100, ad(0.0004, 0.002)), 0, 0.7); return norm(o, 0.7); },
  probe: (sr) => { const r = seed(172), o = impact(1)(sr); mix(o, modal(sr, 0.9, [[118, 1, 0.16], [251, 0.8, 0.13], [395, 0.5, 0.09], [843, 0.3, 0.05]], r), 0, 0.8); for (let i = 0; i < 3; i++) mix(o, tone(sr, 0.06, 1760, gate(0.003, 0.045, 0.012)), Math.floor((0.55 + i * 0.12) * sr), 0.3); return fade(norm(o, 0.9), sr, 0, 0.1); },
  ready: (sr) => { const o = buf(sr, 0.5); mix(o, tone(sr, 0.12, 880, gate(0.004, 0.09, 0.03)), 0, 0.5); mix(o, tone(sr, 0.22, 1318, gate(0.004, 0.16, 0.06)), Math.floor(0.13 * sr), 0.5); return o; },
  click: (sr) => { const r = seed(173), o = modal(sr, 0.04, [[1900, 1, 0.004], [3900, 0.5, 0.002]], r); return fade(norm(o, 0.45), sr, 0, 0.01); }, hover: (sr) => fade(tone(sr, 0.03, 2600, ad(0.001, 0.006)).map((v) => v * 0.22), sr), back: (sr) => { const r = seed(174); return fade(norm(modal(sr, 0.06, [[1100, 1, 0.006], [2300, 0.5, 0.003]], r), 0.45), sr, 0, 0.01); },
  notify: (sr) => { const o = buf(sr, 0.7); mix(o, tone(sr, 0.5, 784, ad(0.004, 0.13)), 0, 0.35); mix(o, tone(sr, 0.5, 1175, ad(0.004, 0.16)), Math.floor(0.09 * sr), 0.35); return fade(o, sr); }, error: (sr) => { const o = buf(sr, 0.45); mix(o, tone(sr, 0.18, 220, gate(0.004, 0.13, 0.04), (p) => Math.tanh(2 * Math.sin(p))), 0, 0.35); mix(o, tone(sr, 0.22, 175, gate(0.004, 0.16, 0.05), (p) => Math.tanh(2 * Math.sin(p))), Math.floor(0.19 * sr), 0.35); return fade(o, sr); },
  cash: (sr) => { const r = seed(175), o = buf(sr, 0.9); mix(o, burst(sr, 0.05, 0.005, r, 'hp', 3000), 0, 0.4); for (const [t, f] of [[0.03, 2093], [0.09, 2637], [0.15, 3136]]) mix(o, modal(sr, 0.6, [[f, 1, 0.12], [f * 2.76, 0.4, 0.06], [f * 5.4, 0.15, 0.02]], r), Math.floor(t * sr), 0.4); return fade(norm(o, 0.6), sr, 0, 0.1); },
  levelup: (sr) => { const r = seed(176), o = buf(sr, 2.6); [50, 57, 62, 65, 69, 74].forEach((m, i) => mix(o, pluck(sr, noteFreq(m), 2, r, { bright: 0.6, damp: 0.997 }), Math.floor(i * 0.085 * sr), 0.5)); mix(o, string(sr, 50, 2, r), Math.floor(0.4 * sr), 0.3); mix(o, string(sr, 62, 2, r), Math.floor(0.4 * sr), 0.25); return fade(norm(o, 0.8), sr, 0, 0.4); },
  squelchOn: (sr) => { const r = seed(177), o = buf(sr, 0.16), n = white(sr, 0.16, r); biquad(n, 'bp', 1700, 0.8, sr); mul(n, (i) => (i / sr < 0.05 ? 1 : 0.12) * Math.exp(-i / sr * 9)); mix(o, n, 0, 0.6); mix(o, burst(sr, 0.02, 0.002, r, 'bp', 1200, 1), 0, 0.9); return fade(norm(o, 0.5), sr, 0.001, 0.02); }, squelchOff: (sr) => { const r = seed(178), n = white(sr, 0.22, r); biquad(n, 'bp', 1500, 0.7, sr); return fade(norm(mul(n, (i) => Math.exp(-i / sr * 16)), 0.5), sr, 0.002, 0.04); },
  heart: (sr) => { const o = buf(sr, 0.7), b = (f) => tone(sr, 0.22, (t) => f * Math.exp(-t * 6) + 30, ad(0.012, 0.055)); mix(o, b(48), 0, 1); mix(o, b(40), Math.floor(0.26 * sr), 0.75); return fade(norm(o, 0.95), sr, 0.002, 0.05); },
  alert: (sr) => { // original two-tone attention signal: alternating minor third, deliberately not any broadcast standard
    const o = buf(sr, 2.5), seq = [523.25, 440, 523.25, 440, 523.25, 440]; seq.forEach((f, i) => mix(o, tone(sr, 0.36, (t) => f * (1 + 0.002 * Math.sin(t * 60)), gate(0.008, 0.31, 0.04), (p) => Math.tanh(1.6 * Math.sin(p)) * 0.8 + 0.18 * Math.sin(p * 3)), Math.floor(i * 0.38 * sr), 0.5)); biquad(o, 'hp', 280, 0.7, sr); biquad(o, 'lp', 3000, 0.7, sr); return fade(norm(o, 0.7), sr); },
  // music
  ...Object.fromEntries(PLUCKS.map((m) => ['pl' + m, (sr) => pluck(sr, noteFreq(m), 3.6, seed(200 + m), { bright: 0.42, damp: 0.9972 })])),
  str38: (sr) => norm(string(sr, 38, 0.55, seed(301)), 0.8), str45: (sr) => norm(string(sr, 45, 0.55, seed(302)), 0.8), str50: (sr) => norm(string(sr, 50, 0.55, seed(303)), 0.8),
  taiko: (sr) => { const r = seed(310), o = tone(sr, 1.4, (t) => 62 * (1 + 0.8 * Math.exp(-t * 26)), ad(0.003, 0.28)); mix(o, modal(sr, 0.8, [[104, 0.5, 0.18], [157, 0.35, 0.12], [226, 0.2, 0.07]], r), 0, 0.8); mix(o, burst(sr, 0.12, 0.012, r, 'bp', 900, 0.6), 0, 0.4); return fade(norm(o, 0.95), sr, 0, 0.1); }, tom: (sr) => { const r = seed(311), o = tone(sr, 0.7, (t) => 104 * (1 + 0.6 * Math.exp(-t * 30)), ad(0.002, 0.13)); mix(o, burst(sr, 0.06, 0.008, r, 'bp', 1400, 0.6), 0, 0.3); return fade(norm(o, 0.85), sr, 0, 0.1); }, tik: (sr) => { const r = seed(312), o = burst(sr, 0.09, 0.011, r, 'bp', 5200, 1); return fade(norm(o, 0.5), sr, 0, 0.02); },
};
export const LOOPS = new Set(['white', 'pink', 'brown', 'roar', 'scream', 'rumble', 'debris', 'wind', 'rainGround', 'rainRoof', 'rainGlass', 'gravel', 'roll', 'hiss', 'squeal', 'crickets', 'cicada', 'frogs', 'leaves']);
export const LOWRATE = new Set(['rumble', 'brown', 'wind', 'roar', 'taiko', 'tom', 'heart', 'str38', 'str45', 'str50', 'scream']); // rendered at 24 kHz
// load order: what is needed first
export const ORDER = [...['click', 'hover', 'back', 'notify', 'pink', 'wind', 'roll', 'rumble', 'roar', 'brown', 'white', 'rainGround', 'rainRoof', 'debris', 'scream', 'thump0', 'starter', 'doorClose', 'squelchOn', 'squelchOff', 'alert'], ...Object.keys(SOUNDS)].filter((v, i, a) => a.indexOf(v) === i);
export const rateOf = (n) => (LOWRATE.has(n) ? 24000 : 44100);
export function render(name) { const sr = rateOf(name), o = SOUNDS[name](sr); return { name, sr, ch: Array.isArray(o) ? o : [o] }; }

// outdoor / hall impulse response
export function impulse(sr, s, { early = 10, decay = 1.2, lp = 4000, r = seed(400), sparse = 0 } = {}) {
  const mk = () => { const x = white(sr, s, r); if (sparse) for (let i = 0; i < x.length; i++) if (r() > 1 - sparse) x[i] *= 4; else x[i] *= 0.25; biquad(x, 'lp', lp, 0.6, sr); biquad(x, 'hp', 120, 0.7, sr); mul(x, (i) => Math.exp(-i / sr / decay * 3) * Math.min(1, i / sr * 40)); for (let k = 0; k < early; k++) { const at = Math.floor((0.012 + r() * 0.28) * sr); if (at < x.length) x[at] += r.n() * 0.7; } return x; };
  const a = mk(), b = mk(); let e = 0; for (let i = 0; i < a.length; i++) e += a[i] * a[i] + b[i] * b[i]; const g = 1 / Math.sqrt(e / 2); for (let i = 0; i < a.length; i++) { a[i] *= g; b[i] *= g; } return [a, b];
}

// ---- thunder: N-waves from every segment of a tortuous channel, travel time + geometric + air absorption -------------
// p: {ax,ay,az (cloud end), bx,by,bz (other end)} relative to the listener, energy 0..1, kind, seed  -> {sr, L, R, delay s, gain, az}
export function thunder(p) {
  const r = mulberry((p.seed | 0) ^ 0x5bd1e995), len = Math.max(50, Math.hypot(p.bx - p.ax, p.by - p.ay, p.bz - p.az)), n0 = Math.max(24, Math.min(160, Math.round(len / 14)));
  const segs = []; // x y z weight
  const walk = (ax, ay, az, bx, by, bz, n, w, jag) => { let ox = 0, oy = 0, oz = 0; const L = Math.hypot(bx - ax, by - ay, bz - az) / n; for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, k = Math.sin(t * Math.PI); ox += r.n() * L * jag; oy += r.n() * L * jag * 0.6; oz += r.n() * L * jag; ox *= 0.94; oy *= 0.94; oz *= 0.94; segs.push([ax + (bx - ax) * t + ox * k, ay + (by - ay) * t + oy * k, az + (bz - az) * t + oz * k, w * L * (0.35 + 1.3 * Math.pow(r(), 2))]); } };
  walk(p.ax, p.ay, p.az, p.bx, p.by, p.bz, n0, 1, 1.5);
  const nb = p.kind === 'cg' ? 3 + Math.floor(r() * 4) : 4 + Math.floor(r() * 5); for (let i = 0; i < nb; i++) { const s = segs[Math.floor(r() * n0 * 0.8)], l = len * r.range(0.15, 0.5), a = r() * TAU; walk(s[0], s[1], s[2], s[0] + Math.cos(a) * l, s[1] + (p.kind === 'cg' ? -l * 0.7 : r.n() * l * 0.3), s[2] + Math.sin(a) * l, Math.max(8, Math.round(n0 * 0.25)), 0.42, 1.2); }
  let dmin = 1e9, dmax = 0, wx = 0, wz = 0; for (const s of segs) { s[1] = Math.max(0, s[1]); s[4] = Math.max(12, Math.hypot(s[0], s[1], s[2])); if (s[4] < dmin) dmin = s[4]; if (s[4] > dmax) dmax = s[4]; const k = s[3] / (s[4] * s[4]); wx += s[0] * k; wz += s[2] * k; }
  const sr = dmin < 1800 ? 44100 : 24000, C = 343, az0 = Math.atan2(wx, wz), tail = 2.6 + Math.min(3.5, dmin / 2600), T = Math.min(16, (dmax - dmin) / C + tail + 0.4), N = Math.floor(T * sr), ch = [new Float32Array(N), new Float32Array(N)], env = new Float32Array(N);
  const strokes = p.kind === 'cg' ? 1 + Math.floor(r() * 3.4) : 1, times = [[0, 1]]; for (let k = 1; k < strokes; k++) times.push([times[k - 1][0] + r.range(0.04, 0.11), r.range(0.3, 0.75)]);
  const E = 0.4 + 0.6 * p.energy, pre = dmin < 700 ? 0.22 : 0.02, near = Math.max(0, 1 - dmin / 1600);
  for (const s of segs) {
    const d = s[4], t0 = (d - dmin) / C + pre, dur = (0.0035 + 0.006 * E) * Math.pow(Math.max(1, d / 250), 0.35) * r.range(0.7, 1.4), m = Math.max(4, Math.floor(dur * sr)), az = Math.atan2(s[0], s[2]) - az0, pan = Math.max(-1, Math.min(1, Math.sin(az) * 1.3)), gl = Math.sqrt(0.5 - 0.45 * pan), gr = Math.sqrt(0.5 + 0.45 * pan), amp = s[3] / d * Math.exp(-d / 14000);
    for (const [dt, g] of times) { const i0 = Math.floor((t0 + dt) * sr); if (i0 + m >= N) continue; const a = amp * g; env[i0] += a; for (let j = 0; j < m; j++) { const u = j / m, v = a * (1 - 2 * u) * Math.min(1, u * 14) * Math.min(1, (1 - u) * 9); ch[0][i0 + j] += v * gl; ch[1][i0 + j] += v * gr; }
      if (near > 0) { const q = Math.min(N - i0, Math.floor(0.011 * sr)), kq = Math.exp(-1 / (0.0016 * sr * (1 + r() * 2))); let h = a * near * 1.5; for (let j = 0; j < q; j++) { const v = r.n() * h; h *= kq; ch[0][i0 + j] += v * gl; ch[1][i0 + j] += v * gr; } } }
  }
  if (dmin < 700) { // leader crackle / tearing just before the main front
    const k = (1 - dmin / 700), m = Math.floor(pre * sr); for (let i = 0; i < m; i++) { const u = i / m; if (r() < 0.004 + 0.03 * u * u) { const a = amp0(env) * 0.5 * k * u * r(); for (let j = 0; j < 40 && i + j < N; j++) { const v = a * r.n() * Math.exp(-j / 9); ch[0][i + j] += v; ch[1][i + j] += v * r.range(0.6, 1); } } }
  }
  // air absorption + late rumble driven by the arrival envelope (ground / cloud echoes)
  const fc = Math.max(110, Math.min(11000, 11000 / (1 + Math.pow(dmin / 420, 1.35)))); let e1 = 0; const kd = Math.exp(-1 / (tail * 0.36 * sr)), ka = 1 - Math.exp(-1 / (0.09 * sr)); let e2 = 0, b0 = 0, b1 = 0, l0 = 0, l1 = 0; const fr = 1 - Math.exp(-TAU * Math.min(170, fc) / sr), w = wander(N, Math.max(4, Math.floor(T * 5)), r);
  const peakE = amp0(env) || 1, nrm = peak(ch[0]) || 1, rumbleAmt = (0.35 + Math.min(1.5, dmin / 2500)) * nrm / peakE * 0.09;
  for (const c of ch) { biquad(c, 'lp', fc, 0.6, sr); if (dmin > 1500) biquad(c, 'lp', fc * 1.4, 0.6, sr); }
  for (let i = 0; i < N; i++) { e1 = e1 * kd + env[i]; e2 += (e1 - e2) * ka; b0 = (b0 + r.n() * 0.06) * 0.997; b1 = (b1 + r.n() * 0.06) * 0.997; l0 += (b0 - l0) * fr; l1 += (b1 - l1) * fr; const g = e2 * rumbleAmt * (0.35 + 1.1 * w[i]); ch[0][i] += l0 * g * 3; ch[1][i] += l1 * g * 3; }
  const drive = dmin < 900 ? 2.6 : 1.5; // saturate: the ear (and a microphone) overloads close by
  for (const c of ch) { biquad(c, 'pk', Math.min(320, fc), 0.5, sr, dmin < 2500 ? 9 : 5); biquad(c, 'hp', 32, 0.6, sr); if (dmin < 900) biquad(c, 'pk', 1500, 0.5, sr, 8); }
  for (const c of ch) { const pk = Math.max(peak(ch[0]), peak(ch[1])) || 1; for (let i = 0; i < N; i++) c[i] = Math.tanh(c[i] / pk * drive) * 0.95; biquad(c, 'hp', 18, 0.7, sr); fade(c, sr, 0, 0.6); const q = peak(c); if (q > 0.97) for (let i = 0; i < N; i++) c[i] *= 0.97 / q; }
  return { sr, ch, delay: Math.max(0, dmin / C - pre), gain: Math.max(0.03, Math.min(1, 1.15 / (1 + Math.pow(dmin / 1100, 1.05)))) * (0.6 + 0.4 * E), dmin, x: Math.sin(az0), z: Math.cos(az0) };
}
function amp0(x) { let m = 0; for (let i = 0; i < x.length; i++) if (x[i] > m) m = x[i]; return m; }

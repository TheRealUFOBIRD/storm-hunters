// builds assets/audio/*.mp3 + src/audio/manifest.js from the scratch downloads (never executes downloaded content)
import fs from 'node:fs'; import path from 'node:path';
import { decode, normLoop, normShot, fades, encode, onsets, slice, trimQuiet, SR, gainTo, peak } from './lib.mjs';
import { track } from './pitch.mjs';
const S = path.resolve(import.meta.dirname, '..'), ROOT = process.argv[2], OUT = path.join(ROOT, 'assets/audio');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const meta = {}; for (const d of ['dl', 'dl2', 'dl3', 'dl4']) { const f = path.join(S, d, 'meta.json'); if (fs.existsSync(f)) Object.assign(meta, JSON.parse(fs.readFileSync(f, 'utf8'))); }
const src = (id) => { for (const d of ['dl', 'dl2', 'dl3', 'dl4']) { const g = fs.readdirSync(path.join(S, d)).find((f) => f.endsWith('__' + id + '.mp3')); if (g) return path.join(S, d, g); } throw new Error('missing ' + id); };
const M = {}, used = {}; let bytes = 0, chs = 0;
const XF = 0.35;
// reduce the level rise of a sweep: per-250 ms gain (rms target/rms)^amt, interpolated
function flatten(x, amt) { const h = SR / 4 | 0, n = Math.ceil(x.length / h), r = []; for (let k = 0; k < n; k++) { let s = 0, m = 0; for (let i = k * h; i < Math.min(x.length, (k + 1) * h); i++) { s += x[i] * x[i]; m++; } r.push(Math.sqrt(s / Math.max(1, m)) + 1e-5); } const tgt = Math.max(...r) * 0.5, g = r.map((v) => Math.pow(tgt / v, amt)); for (let i = 0; i < x.length; i++) { const p = i / h - 0.5, k = Math.max(0, Math.min(n - 2, Math.floor(p))), t = Math.max(0, Math.min(1, p - k)); x[i] *= g[k] * (1 - t) + g[k + 1] * t; } }
function put(key, file, c, o) { const kb = o.kbps || (c.length > 1 ? 96 : (o.loop ? 64 : 80)); bytes += encode(c, path.join(OUT, file), kb); chs += c.length * c[0].length / SR; (M[key] ||= { f: [], ...o.m }).f.push(file); for (const id of o.ids) (used[id] ||= []).push(file); }
// loop: [key, id, ss, t, ch, af, manifest extras]
function loop(key, id, ss, t, ch = 1, af = '', m = {}, db = -20) { const n = (M[key]?.f.length || 0); const c = decode(src(id), { ss, t: t + XF + 0.1, ch, af }); normLoop(c, db); put(key, `${key}${n ? '_' + n : ''}.mp3`, c, { loop: true, ids: [id], m: { loop: true, ...m } }); }
function shot(key, id, ss, t, af = '', m = {}, db = -1.5, trim = true) { const n = (M[key]?.f.length || 0); let c = decode(src(id), { ss, t, ch: 1, af }); if (trim) c = trimQuiet(c, 0.02, 0.05); fades(c, 0.002, Math.min(0.25, c[0].length / SR * 0.3)); normShot(c, db); put(key, `${key}${n ? '_' + n : ''}.mp3`, c, { ids: [id], m }); }
// n onset-sliced shots of length len from [ss, ss+t]
function shots(key, id, ss, t, n, len, af = '', m = {}, o = {}) { const c = decode(src(id), { ss, t, ch: 1, af }); const on = onsets(c[0], { n, gap: o.gap ?? len * 0.8, rise: o.rise ?? 3 }); for (const a of on) shot2(key, id, slice(c, a, a + len), m); }
function shot2(key, id, c, m) { const n = (M[key]?.f.length || 0); fades(c, 0.002, Math.min(0.2, c[0].length / SR * 0.35)); normShot(c, -1.5); put(key, `${key}${n ? '_' + n : ''}.mp3`, c, { ids: [id], m }); }

// ---------------- tornado layers (tier 1)
const T1 = { tier: 1 };
loop('torJet', 847113, 63, 12, 1, 'highpass=f=35', T1); loop('torJet', 717912, 99, 9, 1, 'highpass=f=35', T1);
loop('torTrain', 69005, 10, 12, 1, 'highpass=f=30', T1); loop('torTrain', 455775, 1, 12, 1, 'highpass=f=30', T1);
loop('torFall', 383732, 3, 11, 1, 'highpass=f=200', T1); loop('torFall', 44880, 0, 9, 1, 'highpass=f=200', T1);
loop('torRumble', 220127, 18, 12, 1, 'lowpass=f=500,highpass=f=22', T1);
loop('torDebris', 699674, 128, 12, 1, 'highpass=f=120', T1); loop('torDebris', 699674, 15, 10, 1, 'highpass=f=120', T1);
// ---------------- wind / weather beds (tier 0 = essential)
const T0 = { tier: 0 };
loop('wind', 344887, 0.5, 12, 2, '', T0); loop('wind', 97397, 2, 12, 2, '', T0); loop('wind', 505999, 60, 12, 2, '', T0);
loop('windHowl', 117611, 4, 12, 1, 'highpass=f=150', T0); loop('windHowl', 174501, 14, 10, 1, 'highpass=f=150', T0);
loop('trees', 403051, 54, 12, 2, 'highpass=f=120', T0); loop('leaves', 347557, 1, 12, 2, 'highpass=f=200', T0);
loop('rainHeavy', 507902, 6, 12, 2, '', T0); loop('rainLight', 167034, 3, 12, 2, '', T0);
loop('rainRoof', 535870, 0.5, 10, 2, '', T0); loop('rainRoof', 344460, 3, 10, 2, '', T0); loop('rainGlass', 128707, 4, 12, 2, '', T0);
loop('hailCar', 240742, 12, 10, 2, '', T1); loop('hailGround', 274093, 10, 10, 2, '', T1); loop('hailGround', 436145, 18, 10, 2, '', T1);
// ---------------- ambience (tier 2)
const T2 = { tier: 2 };
loop('crickets', 333221, 20, 12, 2, 'highpass=f=900', T2); loop('crickets', 522299, 40, 12, 2, 'highpass=f=600', T2);
loop('cicada', 422048, 0, 13.5, 2, 'highpass=f=1500', T2); loop('cicada', 272169, 25, 12, 2, 'highpass=f=1200', T2);
loop('frogs', 32655, 10, 12, 2, 'highpass=f=250', T2);
loop('meadow', 198277, 0, 12, 2, 'highpass=f=1000', T2); loop('meadow', 409143, 20, 12, 2, 'highpass=f=400', T2);
loop('traffic', 235531, 40, 12, 2, 'lowpass=f=2500', T2);
shots('bird', 184870, 0, 19, 4, 1.6, 'highpass=f=1200', T2); shots('bird', 364663, 0, 60, 5, 1.6, 'highpass=f=1200', T2, { gap: 3 });
// ---------------- sirens / horn / drone
loop('siren', 72831, 2, 22, 1, 'highpass=f=150', T1, -18); loop('siren', 58642, 10, 22, 1, 'highpass=f=150', T1, -18);
loop('horn', 182474, 1.25, 0.95, 1, 'highpass=f=150', { tier: 1, xf: 0.12 }, -16); loop('drone', 677833, 10, 10, 1, 'highpass=f=150', T1);
// ---------------- tyres
loop('squeal', 71739, 5.2, 2.8, 1, 'highpass=f=400', { tier: 1, xf: 0.25 }); loop('squeal', 71740, 3.3, 2.3, 1, 'highpass=f=300', { tier: 1, xf: 0.25 });
loop('gravel', 251662, 1, 10, 1, '', T1); loop('gravel', 251661, 1, 9, 1, '', T1);
// ---------------- engine (tier 0): one clean dyno sweep (firing-frequency table) + idle loops
loop('engIdleI4', 369054, 0, 3.8, 1, 'highpass=f=25', { tier: 0, xf: 0.3 }, -18); loop('engIdleV8', 348430, 8, 4.5, 1, 'highpass=f=25', { tier: 0, xf: 0.3 }, -18); loop('engIdleDiesel', 565598, 3, 6, 1, 'highpass=f=25', { tier: 0, xf: 0.3 }, -18);
{ const id = 183654, ss = 3.3, t = 20.2, c = decode(src(id), { ss, t, ch: 1, af: 'highpass=f=25' }); flatten(c[0], 0.75); normLoop(c, -18); fades(c, 0.01, 0.05); put('engSweep', 'engSweep.mp3', c, { ids: [id], m: { tier: 0 } });
  const tr = track(src(id), { ss, t, fmin: 40, fmax: 300, hop: 0.25 }); M.engSweep.table = tr.map(([tt, f]) => [+(tt - ss).toFixed(2), Math.round(f * 10) / 10]); }
shot('starter', 458461, 0, 2.7, 'highpass=f=40', T0, -3, false);
// ---------------- thunder (tier 1), mono, rendered on the weather bus with distance filtering
const TH = { tier: 1 };
shot('thunderNear', 646912, 0, 13, '', TH, -1.5, false); shot('thunderNear', 399656, 0, 9, '', TH, -1.5, false); shot('thunderNear', 840628, 0, 10, '', TH, -1.5, false); shot('thunderNear', 243614, 5.6, 22, '', TH, -1.5, false); shot('thunderNear', 242048, 0, 12, '', TH, -1.5, false); shot('thunderNear', 361772, 7.6, 12, '', TH, -1.5, false);
shot('thunderFar', 486557, 3.5, 12, '', TH, -1.5, false); shot('thunderFar', 581125, 3, 11, '', TH, -1.5, false); shot('thunderFar', 717845, 1.5, 12, '', TH, -1.5, false); shot('thunderFar', 128497, 12, 16, '', TH, -1.5, false); shot('thunderFar', 244053, 5, 10, '', TH, -1.5, false); shot('thunderFar', 446753, 0, 24, '', TH, -1.5, false);
// ---------------- impacts / debris (tier 1)
const I = { tier: 1 };
shot('impLight', 262516, 0, 1.4, '', I); shot('impLight', 461696, 0, 1.2, '', I); shot('impLight', 461695, 0, 1.6, '', I); shot('impLight', 151624, 0, 0.5, '', I);
shot('impMed', 562189, 0, 1, '', I); shot('impMed', 536777, 0, 1, '', I); shot('impMed', 587443, 0, 1.4, '', I); shot('impMed', 587443, 2.4, 1.5, '', I);
shot('impHeavy', 237375, 0, 3, '', I); shot('impHeavy', 592388, 0, 2.6, '', I); shot('impHeavy', 653294, 0, 3.5, '', I);
shot('impHuge', 705629, 0, 6.5, '', I, -4); shot('impHuge', 653294, 0, 5, 'lowpass=f=5000', I); shot('impHuge', 257752, 0, 4, '', I);
shot('glassBreak', 221528, 0, 1.9, '', I); shot('glassBreak', 244238, 0, 1.6, '', I); shot('glassBreak', 448004, 0, 3, '', I);
shot('woodCrack', 257752, 0, 2.5, 'highpass=f=80', I); shots('woodCrack', 483354, 0, 62, 3, 1.4, '', I, { gap: 4 });
shot('metalBang', 547979, 0, 1.4, '', I); shot('metalBang', 547979, 1.5, 1.4, '', I);
// ---------------- car foley (tier 0)
shot('doorClose', 173009, 0, 0.8, '', T0); shot('doorClose', 208695, 0, 0.6, '', T0); shot('doorOpen', 335102, 0, 1.4, '', T0); shot('doorOpen', 50697, 0, 0.7, '', T0);
shot('thump', 173009, 0, 0.6, 'lowpass=f=350,asetrate=44100*0.8,aresample=44100', T0); shot('thump', 208695, 0, 0.5, 'lowpass=f=300,asetrate=44100*0.75,aresample=44100', T0); shot('thump', 86234, 0, 2, 'lowpass=f=500', T0);
shots('wiper', 200975, 0, 19, 3, 1.3, 'highpass=f=150', T0, { gap: 2, rise: 2 });
shots('indicator', 860718, 2, 8, 4, 0.12, 'highpass=f=300', T0, { gap: 0.3, rise: 2 });
shot('shutter', 431588, 0, 0.6, '', T0); shot('shutter', 157812, 0.4, 0.6, '', T0);
shot('squelchOn', 760245, 0, 0.4, '', T0); shot('squelchOff', 524205, 0, 1.2, '', T0); shot('squelchOff', 47646, 0, 0.4, '', T0); shot('squelchOff', 522164, 0, 0.3, '', T0);
shot('uiClick', 146721, 0, 0.12, '', T0, -6); shot('uiClick', 342200, 0, 0.15, '', T0, -6); shot('uiHover', 256116, 0, 0.06, '', T0, -10); shot('uiBack', 253168, 0, 0.2, '', T0, -6);
shots('whoosh', 361487, 0, 24, 3, 2.2, '', T1, { gap: 4, rise: 1.3 });

// decode rate per key (memory): bright material at 44.1k, low rumbles at 22.05k, rest 32k
const HI = /^(rain|hail|cicada|crickets|meadow|glass|leaves|trees|ui|shutter|indicator|squelch|bird|wiper|gravel|torFall|torDebris|impLight|frogs)/, LO = /^(torRumble|torTrain|thunderFar|engIdleDiesel)/;
for (const k in M) M[k].sr = HI.test(k) ? 44100 : LO.test(k) ? 22050 : 32000;
fs.writeFileSync(path.join(ROOT, 'src/audio/manifest.js'), '// GENERATED by the audio build script. key -> { f: files in assets/audio, loop, tier (0 essential, 1 storm, 2 ambience), sr: decode rate, table: engine sweep [t s, firing Hz] }\nexport const MANIFEST = {\n' + Object.entries(M).map(([k, v]) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(v)).join(',\n') + ',\n};\n');
// ---------------- write manifest + credits table
const credits = Object.entries(used).map(([id, files]) => ({ ...meta[id], files }));
let js = '// GENERATED by the audio build script (scratch tools). key -> { f: files in assets/audio, loop, tier (0 essential, 1, 2 ambience), table }.\n';
js += 'export const MANIFEST = ' + JSON.stringify(M) + ';\n';
fs.writeFileSync(path.join(S, 'manifest.json'), JSON.stringify(M, null, 1)); fs.writeFileSync(path.join(S, 'credits.json'), JSON.stringify(credits, null, 1));
console.log('files', Object.values(M).reduce((a, m) => a + m.f.length, 0), 'MB', (bytes / 1048576).toFixed(2), 'channel-seconds', chs.toFixed(0), 'sources', credits.length);
console.log('sweep table', JSON.stringify(M.engSweep.table));

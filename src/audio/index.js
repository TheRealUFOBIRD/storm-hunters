// ctx.audio - procedural audio. Everything is synthesised; see dsp.js (one-shots/loops), voices.js (continuous), music.js.
import * as THREE from 'three';
import { Core, Bank, Par, clamp, lerp, sstep } from './core.js';
import { TornadoVoice, WindVoice, RainVoice, AmbienceVoice, EngineVoice, TyreVoice, SirenVoice, HornVoice, DroneVoice, ServoVoice, engineSpec } from './voices.js';
import { Music } from './music.js';
import { SOUNDS } from './dsp.js';

const MAX_TORNADO = 2, MAX_SIREN = 2, MAX_REMOTE = 2, STEP = 1 / 30;
// public names (other modules) -> bank sound(s)
const ALIAS = {
  shutter: ['shutter', 0.7, 'sfx'], camera: ['shutter', 0.7, 'sfx'], probe_drop: ['probe', 0.9, 'sfx'], probe_anchor: ['clamp', 0.8, 'sfx'], anchor: ['clamp', 0.9, 'sfx'], drone_start: ['ready', 0.5, 'sfx'], drone_crash: ['impact1', 0.8, 'sfx'], eas: ['alert', 0.55, 'voice'], alert: ['notify', 0.6, 'ui'], refuel: ['cash', 0.5, 'ui'], repair: ['clamp', 0.6, 'ui'], radio: ['squelchOn', 0.5, 'voice'],
  click: ['click', 0.6, 'ui'], ui_click: ['click', 0.6, 'ui'], hover: ['hover', 0.5, 'ui'], ui_hover: ['hover', 0.5, 'ui'], back: ['back', 0.6, 'ui'], ui_back: ['back', 0.6, 'ui'], open: ['click', 0.6, 'ui'], close: ['back', 0.6, 'ui'], notify: ['notify', 0.5, 'ui'], error: ['error', 0.5, 'ui'], bad: ['error', 0.5, 'ui'], cash: ['cash', 0.6, 'ui'], money: ['cash', 0.6, 'ui'], buy: ['cash', 0.6, 'ui'], levelup: ['levelup', 0.7, 'ui'], success: ['ready', 0.6, 'ui'], beep: ['beep', 0.4, 'sfx'], scan: ['beepHi', 0.4, 'sfx'], lock: ['ready', 0.5, 'sfx'], whoosh: ['whoosh', 0.6, 'sfx'], horn: ['tick', 0.3, 'sfx'], door: ['doorClose', 0.7, 'sfx'], thump: ['thump0', 0.7, 'sfx'], impact: ['impact1', 0.8, 'sfx'], glass: ['glass0', 0.7, 'sfx'], siren: null,
};

export async function create(ctx) {
  const bank = new Bank(), ev = ctx.events, offs = [], on = (n, f) => offs.push(ev.on(n, f)), R = Math.random;
  let ac = null, core = null, music = null, unlocked = false, starting = null, acc = 0, muted = false;
  let wind, rain, amb, tyre, horn, drone, servo, rHorn, remoteDrone; const tors = [], sirens = [], engines = new Map(); let engine = null, engineFor = null;
  const cam = ctx.camera, F = new THREE.Vector3(), U = new THREE.Vector3(), W = new THREE.Vector3(), prevCam = new THREE.Vector3(), camVel = new THREE.Vector3(); let havePrev = false, wx = null, wxT = 0, cityT = 0, sirenList = [], forced = [], prevMode = null, prevVeh = null, lastGear = 0, lastThr = 0, susp = [0, 0, 0, 0], thumpT = 0, wipeT = 0, heartT = 0, scanT = 0, scanQ = 0, scanAt = -9, stepT = 0, thrEnv = 0, startT = 0, popT = 0, threat = 0, closing = 0, lastDist = 1e9, squelch = null, talkT = 0, talkEnd = 0, hid = false, dtv = 0, indT = 0, wasAnch = false, menuFade = 0, talkPitch = 1;
  const rel = { x: 0, y: 0, z: 0 }, relTo = (p) => ({ x: p.x - cam.position.x, y: p.y - cam.position.y, z: p.z - cam.position.z });
  bank.start();

  async function build() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return false;
    ac = new AC({ latencyHint: 'interactive' }); core = new Core(ac, bank); volumes(true); core.worklet = false;
    try { if (ac.audioWorklet) { await Promise.race([ac.audioWorklet.addModule(new URL('./engine.worklet.js', import.meta.url).href), new Promise((_, j) => setTimeout(() => j(new Error('timeout')), 4000))]); core.worklet = true; } } catch (e) { console.warn('[audio] worklet unavailable, using fallback engine', e.message || e); }
    wind = new WindVoice(core); rain = new RainVoice(core); amb = new AmbienceVoice(core); tyre = new TyreVoice(core); horn = new HornVoice(core); drone = new DroneVoice(core); servo = new ServoVoice(core); music = new Music(core); return true;
  }
  const api = {
    get context() { return ac; }, get core() { return core; }, get unlocked() { return unlocked; }, get threat() { return threat; }, bank,
    unlock() {
      if (unlocked && ac?.state === 'running') return Promise.resolve(true); if (starting) { ac?.resume?.().catch(() => {}); return starting; }
      starting = (async () => { try { if (!ac && !(await build())) return false; await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 1500))]); unlocked = ac.state === 'running'; if (unlocked && SILENT_IOS()) { const s = ac.createBufferSource(); s.buffer = ac.createBuffer(1, 1, 22050); s.connect(ac.destination); s.start(); } return unlocked; } catch (e) { console.warn('[audio] unavailable', e?.message || e); return false; } finally { starting = null; } })();
      return starting;
    },
    setVolume(b, v) { if (!core) return; v = clamp(+v || 0, 0, 1.5); if (b in core.vol) { core.vol[b] = v; core.applyVolumes(); } },
    setMuted(m) { muted = m; },
    // name: ALIAS or bank name. opts {x,y,z | pos (world), gain|volume, rate, bus, delay, pan}
    play(name, o = {}) {
      if (!core || !unlocked) return null; if (name === 'radio') return radio(o.text); if (name === 'siren') { forced.push({ x: o.x ?? cam.position.x, z: o.z ?? cam.position.z, until: ctx.time.real + (o.duration || 60) }); return null; }
      const a = ALIAS[name], n = a ? a[0] : SOUNDS[name] ? name : null; if (!n) { if (!api['_w' + name]) { api['_w' + name] = 1; console.warn('[audio] unknown sound', name); } return null; }
      const p = o.pos || (o.x !== undefined && o.z !== undefined ? o : null);
      return core.play(n, { gain: (o.gain ?? o.volume ?? 1) * (a ? a[1] : 0.8), rate: o.rate, vary: o.vary, delay: o.delay, pan: o.pan, pos: p ? relTo({ x: p.x, y: p.y ?? cam.position.y, z: p.z }) : null, to: p ? core.outside : core.bus[o.bus || (a ? a[2] : 'sfx')] || core.bus.sfx, send: p ? 0.15 : 0, min: 0.06, prio: true });
    },
    update, dispose() { for (const f of offs) f(); ac?.close?.(); },
    debug: () => ({ state: ac?.state, worklet: core?.worklet, voices: core?.voices, thunders: core?.thunders || 0, threat: +threat.toFixed(3), bank: bank.raw.size, tornado: tors.map((t) => +(t.level || 0).toFixed(3)), interior: core?.interior, calm: amb?.calm, sirens: sirens.map((s) => +s.on.toFixed(2)), reduction: core?.lim.reduction }),
  };
  const SILENT_IOS = () => /iP(hone|ad)/.test(navigator.userAgent);
  const gesture = () => { api.unlock().then((ok) => { if (ok) for (const n of ['pointerdown', 'keydown', 'touchend']) removeEventListener(n, gesture, true); }); };
  for (const n of ['pointerdown', 'keydown', 'touchend']) addEventListener(n, gesture, true);
  document.addEventListener('visibilitychange', () => { hid = document.hidden; if (!ac || !unlocked) return; if (hid) { if ((ctx.net?.role ?? 'solo') === 'solo') ac.suspend().catch(() => {}); else core.pMaster.set(0, 0.2); } else { ac.resume().catch(() => {}); volumes(); } });

  function volumes(now) { if (!core) return; const s = ctx.settings; for (const k of ['master', 'sfx', 'music', 'voice', 'engine', 'weather']) { const v = s?.get?.(k); if (typeof v === 'number') core.vol[k] = clamp(v, 0, 1.5); } core.applyVolumes(); if (now) core.master.gain.value = core.vol.master * 0.85; }
  on('settings:changed', () => volumes());

  // ------------------------------------------------------------------------------------------------ events
  const snd = (n, o) => (core && unlocked && !hid ? core.play(n, o) : null);
  on('lightning', (d) => {
    if (!core || !unlocked || hid || ctx.state === 'loading') return; const t0 = ac.currentTime, p = { ax: d.x - cam.position.x, ay: d.y - cam.position.y, az: d.z - cam.position.z, bx: d.tx - cam.position.x, by: d.ty - cam.position.y, bz: d.tz - cam.position.z, energy: clamp(d.energy ?? 0.6), kind: d.kind, seed: d.seed | 0 };
    const near = Math.min(Math.hypot(p.ax, p.ay, p.az), Math.hypot(p.bx, p.by, p.bz), Math.hypot((p.ax + p.bx) / 2, (p.ay + p.by) / 2, (p.az + p.bz) / 2)); if (near > 17000) return; const act = core.thunders || 0, pend = api._pend || 0; if (act + pend > (near < 2500 ? 12 : near < 6000 ? 8 : 5)) return;
    if (near < 260) snd('zap', { gain: 0.5 * (1 - near / 260), pos: relTo({ x: d.tx, y: d.ty, z: d.tz }), atten: false });
    api._pend = pend + 1; bank.thunder(p, (o) => { api._pend--; if (o && core && ctx.state !== 'paused' && !hid) core.playThunder(o, ac.currentTime - t0); });
  });
  on('vehicle:impact', (d) => { const s = Math.abs(d?.speed || 0); if (s < 1) return; const k = s > 18 ? 3 : s > 10 ? 2 : s > 4.5 ? 1 : 0, p = d.pos ? relTo(d.pos) : null, own = !d.v || d.v === ctx.player?.vehicle; snd('impact' + k, { gain: clamp(0.25 + s / 16) * (own ? 1 : 0.8), vary: 0.08, pos: own ? null : p, to: own ? core.engineIn : core.outside, min: 0.09, prio: true, send: 0.12 }); if (s > 9) snd('glass' + Math.floor(R() * 2), { gain: clamp(s / 30) * 0.7, pos: own ? null : p, to: own ? core.engineIn : core.outside, delay: 0.03, min: 0.3 }); });
  on('vehicle:destroyed', (d) => { const p = d?.v?.pos ? relTo(d.v.pos) : null; snd('impact3', { gain: 1, pos: p, ref: 20, send: 0.3, prio: true }); snd('glass1', { gain: 0.8, pos: p, ref: 20, delay: 0.05 }); });
  on('vehicle:swept', () => { snd('whoosh', { gain: 1, rate: 0.6, to: core.outside, prio: true }); snd('impact1', { gain: 0.5, to: core.engineIn, rate: 0.7, delay: 0.1 }); }); on('player:swept', () => snd('whoosh', { gain: 1, rate: 0.7, to: core.outside, min: 0.4, prio: true })); on('player:damage', (d) => snd('thump1', { gain: 0.5 + 0.5 * clamp(d?.amount ?? 0.2), rate: 0.8, to: core.bus.sfx, min: 0.15 }));
  on('player:mode', () => modeSounds());
  on('world:break', (d) => { if (!d?.pos) return; const p = relTo(d.pos), k = String(d.kind || ''); if (Math.hypot(p.x, p.y, p.z) > 450) return; if (/tree|trunk|wood|pole|branch/.test(k)) snd('crack', { gain: 1, pos: p, ref: 16, vary: 0.2, rate: /branch|small/.test(k) ? 1.5 : 1, min: 0.12, send: 0.15 }); else if (/fence|sign|post|mail/.test(k)) snd('impact0', { gain: 0.8, pos: p, ref: 9, vary: 0.2, min: 0.06 }); else { snd('impact' + (2 + Math.floor(R() * 2)), { gain: 1, pos: p, ref: 24, vary: 0.15, min: 0.1, send: 0.25 }); snd('crack', { gain: 0.9, pos: p, ref: 22, rate: 0.8, vary: 0.2, min: 0.2 }); if (/house|glass|build|barn|store|shop/.test(k)) snd('glass' + Math.floor(R() * 2), { gain: 0.8, pos: p, ref: 16, min: 0.2, delay: 0.1 }); } });
  on('fx:powerflash', (d) => snd('zap', { gain: 1, pos: relTo(d), ref: 60, send: 0.2, min: 0.1, vary: 0.1 }));
  on('fx:debris-hit', (d) => { const s = clamp((d.speed || 10) / 45), m = clamp(Math.sqrt(d.mass || 0.3) / 6, 0.08, 1), car = !!d.vehicle; if (car) snd(m > 0.35 ? 'impact' + (m > 0.7 ? 2 : 1) : m > 0.15 ? 'impact0' : 'hailCar' + Math.floor(R() * 6), { gain: clamp(0.2 + s * m * 2.4), vary: 0.25, to: core.engineIn, pan: R() * 1.4 - 0.7, min: 0.05, prio: m > 0.35 }); else snd('thump' + Math.floor(R() * 3), { gain: 0.3 + 0.7 * s * m, vary: 0.2, to: core.bus.sfx, min: 0.06 }); });
  on('fx:debris-ground', (d) => { const s = clamp((d.speed || 5) / 25), m = clamp(Math.sqrt(d.mass || 1) / 12, 0.1, 1), k = String(d.kind); snd(/sheet|metal|tin|car/.test(k) ? 'impact' + (m > 0.5 ? 2 : 0) : m > 0.5 ? 'impact1' : 'hailGround' + Math.floor(R() * 4), { gain: 0.3 + 0.7 * s, ref: 5 + 14 * m, pos: relTo(d.pos), vary: 0.2, min: 0.05 }); });
  on('fx:hail-hit', (d) => { const s = clamp((d.cm || 2) / 8, 0.15, 1), car = !!ctx.player?.vehicle; if (car) snd('hailCar' + Math.floor(R() * 6), { gain: 0.35 + 0.7 * s, rate: lerp(1.15, 0.65, s), vary: 0.1, to: core.bus.weather, pan: R() * 1.4 - 0.7, min: 0.04 }); });
  on('photo:taken', () => snd('shutter', { gain: 0.7, to: core.bus.sfx, min: 0.5 })); on('probe:deployed', (d) => snd('probe', { gain: 0.9, pos: d?.x !== undefined ? relTo({ x: d.x, y: cam.position.y - 1.5, z: d.z }) : null, min: 0.5 })); on('scan:progress', (d) => { scanQ = clamp(d?.quality ?? 0); scanAt = ctx.time.real; }); on('scan:complete', () => snd('ready', { gain: 0.7, to: core.bus.sfx, min: 0.5 }));
  on('money', (d) => { if ((d?.amount ?? 1) > 0) snd('cash', { gain: 0.5, to: core.bus.ui, min: 0.8 }); }); on('levelup', () => snd('levelup', { gain: 0.8, to: core.bus.ui, min: 2, prio: true })); on('mission:complete', () => snd('levelup', { gain: 0.5, rate: 0.84, to: core.bus.ui, min: 2, prio: true })); on('mission:accepted', () => snd('notify', { gain: 0.4, to: core.bus.ui, min: 0.5 })); on('mission:objective', () => snd('ready', { gain: 0.35, rate: 0.9, to: core.bus.ui, min: 0.5 })); on('mission:failed', () => snd('error', { gain: 0.4, to: core.bus.ui, min: 0.5 }));
  on('service', (d) => snd(d?.kind === 'fuel' ? 'cash' : 'clamp', { gain: 0.5, to: core.bus.ui, min: 0.5 })); on('tool:select', () => snd('tick', { gain: 0.5, to: core.bus.sfx, min: 0.05 })); on('photo:shutter', () => snd('shutter', { gain: 0.7, to: core.bus.sfx, min: 0.5 })); on('siren:on', (d) => { if (d && Number.isFinite(d.x)) forced.push({ x: d.x, z: d.z, until: ctx.time.real + Math.min(300, d.duration || 90) }); });
  on('net:peer-join', (d) => { if (!d?.existing) snd('squelchOn', { gain: 0.5, to: core.bus.voice, min: 0.3 }); }); on('net:peer-leave', () => snd('squelchOff', { gain: 0.5, to: core.bus.voice, min: 0.3 })); on('chat', (m) => { if (!m?.self) snd('beep', { gain: 0.25, rate: 0.8, to: core.bus.ui, min: 0.2 }); });
  on('net:tool', (d) => { if (d?.kind === 'photo' && Number.isFinite(d.x)) snd('shutter', { gain: 0.6, ref: 4, pos: relTo(d) }); });
  on('radio', (q) => { if (q?.text) radio(q.text); });
  on('warning', (d) => { if (ctx.ui && !ctx.ui.mock) return; if (d?.kind === 'TOR') snd('alert', { gain: 0.55, to: core.bus.voice, min: 6 }); }); // the HUD triggers 'eas' itself
  // hover/click feedback for any DOM button in #ui
  const uiRoot = () => document.getElementById('ui'); document.addEventListener('pointerover', (e) => { const b = e.target?.closest?.('#ui button, #ui [role=button], #ui .btn'); if (b && b !== api._hov) { api._hov = b; snd('hover', { gain: 0.5, to: core.bus.ui, min: 0.05 }); } else if (!b) api._hov = null; }, { passive: true }); document.addEventListener('click', (e) => { if (uiRoot()?.contains(e.target) && e.target.closest?.('button, [role=button], .btn, a, [data-click]')) snd('click', { gain: 0.6, to: core.bus.ui, min: 0.04 }); }, { passive: true, capture: true });

  // dispatcher "voice": squelch + syllable blips through a radio band
  function radio(text) {
    if (!core || !unlocked || hid) return null; const n = clamp(String(text || '').length, 8, 240), now = ctx.time.real; if (talkEnd > now && talkEnd - now < 60) { talkEnd = now + n * 0.045; return null; }
    snd('squelchOn', { gain: 0.5, to: core.bus.voice, min: 0.2, prio: true }); talkT = now + 0.18; talkEnd = now + 0.2 + n * 0.045; talkPitch = 0.8 + 0.35 * R(); return null;
  }
  let talk = null;
  function talkVoice() {
    const lp = ac.createBiquadFilter(), hp = ac.createBiquadFilter(), f1 = ac.createBiquadFilter(), g = ac.createGain(), o = ac.createOscillator(); lp.type = 'lowpass'; lp.frequency.value = 2700; hp.type = 'highpass'; hp.frequency.value = 420; f1.type = 'bandpass'; f1.frequency.value = 900; f1.Q.value = 2.2; o.type = 'sawtooth'; o.frequency.value = 130; g.gain.value = 0; o.connect(f1); f1.connect(hp); hp.connect(lp); lp.connect(g); g.connect(core.bus.voice); o.start(); const nz = core.loop('hiss', hp, 0); return { f: new Par(ac, f1.frequency), p: new Par(ac, o.frequency), g: new Par(ac, g.gain), nz };
  }
  function talkUpdate(now) {
    if (now < talkEnd && now >= talkT) { talk ||= talkVoice(); const v = R() < 0.8; talk.p.set((105 + 60 * R()) * talkPitch, 0.02); talk.f.set(450 + 1300 * R(), 0.025); talk.g.set(v ? 0.5 + 0.4 * R() : 0.03, 0.015); talk.nz.gain.set(R() < 0.25 ? 0.5 : 0.08, 0.02); talkT = now + (v ? 0.07 + 0.07 * R() : 0.09 + 0.12 * R()); } else if (talk && now >= talkEnd && talk.on !== false && talkEnd > 0) { talk.g.set(0, 0.02); talk.nz.gain.set(0, 0.02); talkEnd = 0; snd('squelchOff', { gain: 0.5, to: core.bus.voice }); }
  }
  function modeSounds() {
    const P = ctx.player, m = P?.mode, v = P?.vehicle; if (!core || !unlocked) { prevMode = m; prevVeh = v; return; } if (m === prevMode && v === prevVeh) return;
    if (v && !prevVeh && prevMode !== null) { snd('doorOpen', { gain: 0.6, to: core.bus.sfx, min: 0.4 }); snd('doorClose', { gain: 0.8, to: core.bus.sfx, delay: 0.55, min: 0.4 }); snd('starter', { gain: 0.5, to: core.engineIn, delay: 1.0, min: 1 }); startT = ctx.time.real + 1.75; } else if (!v && prevVeh && m === 'foot') { snd('doorOpen', { gain: 0.7, to: core.bus.sfx, min: 0.4 }); snd('doorClose', { gain: 0.8, to: core.bus.sfx, delay: 0.6, min: 0.4 }); }
    prevMode = m; prevVeh = v;
  }

  // ------------------------------------------------------------------------------------------------ per frame
  function update(dt) {
    if (!core || !unlocked || hid) return; acc += Math.max(dt, 0); if (acc < STEP) return; dt = Math.min(acc, 0.1); acc = 0; if (ac.state !== 'running') return;
    const now = ctx.time.real, P = ctx.player, S = ctx.storms, st = ctx.state, menu = st === 'menu', paused = st === 'paused' && (ctx.net?.role ?? 'solo') === 'solo', v = P?.vehicle || null, driving = !!v && !menu, cp = cam.position;
    // listener (orientation only; sources are camera relative)
    const L = ac.listener, e = cam.matrixWorld.elements; F.set(-e[8], -e[9], -e[10]); U.set(e[4], e[5], e[6]); if (L.forwardX) { const q = (L.q ||= ['forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map((k) => new Par(ac, L[k]))); q[0].set(F.x, 0.03); q[1].set(F.y, 0.03); q[2].set(F.z, 0.03); q[3].set(U.x, 0.03); q[4].set(U.y, 0.03); q[5].set(U.z, 0.03); } else L.setOrientation?.(F.x, F.y, F.z, U.x, U.y, U.z);
    if (havePrev) { camVel.subVectors(cp, prevCam).divideScalar(dt); if (camVel.lengthSq() > 200 * 200) camVel.set(0, 0, 0); } prevCam.copy(cp); havePrev = true;
    const cm = P?.cameraMode ?? P?.camMode ?? P?.camera?.mode, inside = driving && P.mode !== 'drone' && (cm === 'cockpit' || cm === 'dash' || cm === 'interior'); core.setInterior(inside ? 1 : driving && cm === 'hood' ? 0.15 : 0); core.pWorld.set(paused ? 0.06 : muted ? 0 : st === 'loading' ? 0 : menu ? 0.55 : 1, 0.25);
    // weather sampling (4 Hz)
    wxT -= dt; if (!wx || wxT <= 0) { wxT = 0.25; let w = null; try { w = S?.weatherAt?.(cp.x, cp.z); } catch { w = null; } wx = { rain: clamp(w?.rain || 0), hail: clamp(w?.hail || 0), dark: clamp(w?.dark || 0), wind: w?.windSpeed || 0, cm: w?.storm?.hail || 2, biome: 'plains', surf: 'grass', wet: ctx.globals?.uWetness?.value || 0 }; try { wx.biome = ctx.world?.biomeAt?.(cp.x, cp.z)?.id || 'plains'; } catch { /* mock */ } }
    // ---- tornadoes
    const list = S?.tornadoes || []; let n1 = null, n2 = null, d1 = 1e9, d2 = 1e9; for (const t of list) { if (t.stage === 'dead') continue; const d = Math.hypot(t.x - cp.x, t.z - cp.z) / (0.4 + (t.vmax || 40) / 90); if (d < d1) { n2 = n1; d2 = d1; n1 = t; d1 = d; } else if (d < d2) { n2 = t; d2 = d; } }
    for (let i = 0; i < MAX_TORNADO; i++) {
      let t = i ? n2 : n1; const cur = tors[i]; if (cur && cur.t !== t && i === 0 && tors[1]?.t === t && t) { tors[0] = tors[1]; tors[1] = cur; } const q = tors[i]; const D = t ? Math.hypot(t.x - cp.x, t.z - cp.z) : 1e9;
      if (t && D < 9000) { const o = q || (tors[i] = new TornadoVoice(core)); o.t = t; o.idle = 0; const gr = t.onGround === false ? 0.25 : 0.25 + 0.75 * clamp(t.condense ?? 1, 0, 1) * (t.stage === 'funnel' ? 0.4 : 1); o.set({ x: t.x - cp.x, y: (t.y0 || 0) - cp.y, z: t.z - cp.z, dist: D, vmax: t.vmax || 40, rCore: t.rCore || 60, dust: t.dust, ground: gr, strength: 1 }); } else if (q) { q.t = null; q.mute(); q.idle += dt; if (q.idle > 8) { q.dispose(); tors[i] = null; } }
    }
    const D1 = n1 ? Math.max(0, Math.hypot(n1.x - cp.x, n1.z - cp.z) - (n1.rCore || 60)) : 1e9; if (n1 && lastDist < 1e8) closing += (clamp((lastDist - D1) / dt, -60, 60) - closing) * Math.min(1, dt * 0.7); else closing = 0; lastDist = D1;
    const want = n1 && !menu ? clamp(Math.pow(1 - clamp((D1 - 120) / 4200), 1.5) * (0.75 + 0.25 * clamp((n1.vmax || 40) / 80)) + clamp(closing / 40, -0.1, 0.2) * sstep(4000, 500, D1)) * (n1.onGround === false ? 0.6 : 1) : 0; threat += (want - threat) * Math.min(1, dt * 1.2);
    heartT -= dt; if (D1 < 420 && !menu && !paused && heartT <= 0) { const k = 1 - D1 / 420; heartT = lerp(0.95, 0.46, k); core.play('heart', { gain: 0.15 + 0.55 * k, to: core.bus.sfx, rate: lerp(1, 1.15, k) }); }
    // ---- wind / rain / hail / ambience
    let wv = wx.wind; try { S?.windAt?.(cp.x, cp.y, cp.z, W); wv = Math.hypot(W.x, W.z); if (!(wv >= 0)) wv = 0; } catch { W.set(0, 0, 0); } const rv = Math.hypot(W.x - camVel.x, W.y - camVel.y, W.z - camVel.z), vsp = driving ? v.speed ?? v.vel?.length?.() ?? 0 : 0;
    wind.set({ v: menu ? wv : Math.min(rv, 120) * (driving ? 0.85 : 1), amb: wv, inCar: driving, veg: wx.biome === 'desert' ? 0.12 : wx.biome === 'forest' || wx.biome === 'cornbelt' ? 1 : 0.5 }, dt); rain.set(wx.rain, driving); if (!paused) rain.hail(wx.hail, wx.cm, driving, dt); amb.set({ dark: wx.dark, threat: Math.max(threat, sstep(9000, 1500, D1) * 0.5), wind: wv, rain: wx.rain, hour: ctx.time.hour, biome: wx.biome, speed: Math.max(vsp, camVel.length()), wet: wx.wet }, dt);
    vehicle(dt, v, driving, paused, vsp, now);
    foot(dt, P, menu || paused); others(dt, now); sirenUpdate(dt, menu); modeSounds(); talkUpdate(now);
    // drone
    const dr = ctx.gameplay?.drone, dOn = P?.mode === 'drone' || dr?.active === true; if (dOn && dr?.pos) { relSet(dr.pos); const d = Math.hypot(rel.x, rel.y, rel.z); drone.set(dr.state !== 'dead', clamp((dr.vel?.length?.() || 5) / 18), rel, P.mode === 'drone' ? 0.5 : 6 / Math.max(6, d)); } else drone.set(dOn, 0.4, null, 0.5);
    servo.set(driving && /doppler|radar/i.test(v.type?.id || v.type || '') && ctx.gameplay?.scanning === true);
    // scanner beeps by lock quality
    if (now - scanAt < 0.9 && !paused) { scanT -= dt; if (scanT <= 0) { scanT = lerp(0.5, 0.055, scanQ); core.play(scanQ > 0.75 ? 'beepHi' : 'geiger', { gain: scanQ > 0.75 ? 0.22 : 0.5, to: core.bus.sfx, vary: 0.04 }); } }
    music.update(dt, menu ? 'menu' : st === 'loading' || (paused && false) ? 'off' : 'game', paused ? Math.min(threat, 0.3) : threat);
  }
  const relSet = (p) => { rel.x = p.x - cam.position.x; rel.y = p.y - cam.position.y; rel.z = p.z - cam.position.z; return rel; };
  function vehicle(dt, v, driving, paused, sp, now) {
    const types = ctx.vehicles?.types || {}, ty = driving ? (typeof v.type === 'string' ? v.type : v.type?.id ?? v.typeId) : null;
    if (driving && (!engine || engineFor !== ty)) { engine?.dispose(); const s = engineSpec({ ...(types[ty] || {}), ...(v.spec?.engine ? { engine: v.spec.engine } : {}) }); engine = new EngineVoice(core, s); engineFor = ty; lastGear = v.gear; }
    if (!driving || !engine) { if (engine && !driving) { const pk = !ctx.state || ctx.state === 'menu'; if (pk || !ctx.vehicles?.active) engine.mute(); else engine.set(700, 0, { gain: 0.08 }); if (pk) { engine.dispose(); engine = null; } } tyre.mute(); horn.set(false, false); wasAnch = false; return; }
    const thr = clamp(v.throttle ?? 0), dead = (v.fuel ?? 1) <= 0 || (v.damage ?? 0) >= 1 || v.engineOn === false, run = !dead && now > startT && !paused, red = engine.spec.red, rpm = v.rpm > 0 ? v.rpm : 800 + sp * 60, gear = v.gear; thrEnv += ((thr > 0.02 ? 0.12 + 0.88 * thr : 0) - thrEnv) * Math.min(1, dt * 12); const shifting = v.shifting || v.shiftT > 0;
    engine.set(rpm, shifting ? thrEnv * 0.25 : thrEnv, { running: run, cut: rpm > red * 1.005 && (now * 22) % 1 < 0.5, gain: 0.8 });
    if (gear !== lastGear) { if (run && Math.abs(gear) > 0) core.play('shift', { gain: 0.22 + (v.speed > 1 ? 0.1 : 0), to: core.engineIn, min: 0.15, vary: 0.06 }); lastGear = gear; } if (lastThr > 0.6 && thr < 0.1 && run) { if (engine.spec.turbo) core.play('blowoff', { gain: 0.3 * engine.spec.turbo, to: core.engineIn, min: 0.5, vary: 0.08 }); if (engine.spec.pops && rpm > red * 0.5) popT = 0.9; } if (popT > 0) { popT -= dt; if (thr > 0.15) popT = 0; else if (R() < dt * 9) core.play('pop', { gain: 0.25 + 0.3 * R(), to: core.engineIn, vary: 0.2 }); } lastThr = thr;
    // tyres
    let slip = 0, con = 0, sf = null; const ws = v.wheels || []; for (let i = 0; i < ws.length; i++) { const w = ws[i]; if (!w) continue; if (w.contact) { con++; const s = typeof w.slip === 'number' ? Math.abs(w.slip) : Math.hypot(w.slip?.x || 0, w.slip?.y || 0); if (s > slip) slip = s; if (!sf) sf = w.surface; } const c = w.compression ?? 0, d = c - (susp[i] ?? c); susp[i] = c; if (w.contact && d > 0.035 && thumpT <= 0 && sp > 2) { const k = clamp((d - 0.03) * 9); core.play('thump' + Math.floor(R() * 3), { gain: 0.18 + 0.75 * k, to: core.engineIn, vary: 0.12, pan: i & 1 ? 0.25 : -0.25 }); thumpT = 0.07; } } thumpT -= dt;
    if (!sf) { try { sf = ctx.world?.surfaceAt?.(v.pos.x, v.pos.z); } catch { sf = null; } } const type = typeof sf === 'string' ? sf : sf?.type || 'asphalt', c = ws.length ? con / ws.length : v.airborne ? 0 : 1; tyre.set({ speed: paused ? 0 : sp, surface: type, wet: clamp(wx.wet), slip: paused ? 0 : clamp(slip), contact: c, bump: sf?.bump || 0 }); if (type === 'water' && sp > 4) core.play('splash', { gain: clamp(sp / 20), to: core.engineIn, min: 0.5, vary: 0.15 });
    const anch = !!v.anchored; if (anch !== wasAnch) { core.play('clamp', { gain: 0.8, rate: anch ? 1 : 1.15, to: core.engineIn, min: 0.4 }); wasAnch = anch; }
    horn.set(!paused && ctx.state === 'playing' && !!(v.horn || (ctx.player.mode === 'drive' && ctx.input?.down?.('horn'))), (v.mass || types[ty]?.mass || 1500) > 2400);
    if (wx.rain > 0.06 && run) { wipeT -= dt; if (wipeT <= 0) { wipeT = wx.rain > 0.5 ? 0.8 : wx.rain > 0.2 ? 1.2 : 2.6; core.play('wiper', { gain: 0.16 + 0.3 * core.interior, to: core.bus.sfx, vary: 0.04 }); } } else wipeT = 0.5;
    if (v.indicator || v.hazard) { indT -= dt; if (indT <= 0) { indT = 0.38; api._tk = !api._tk; core.play(api._tk ? 'tick' : 'tock', { gain: 0.15 + 0.25 * core.interior, to: core.bus.sfx }); } }
  }
  function foot(dt, P, off) {
    if (off || P?.mode !== 'foot' || !P.pos) return; const sp = Math.hypot(camVel.x, camVel.z); if (sp < 0.5 || sp > 12 || P.grounded === false) return; stepT -= dt * (0.55 + sp * 0.42); if (stepT > 0) return; stepT = 1; let t = 'grass'; try { t = ctx.world?.surfaceAt?.(P.pos.x, P.pos.z)?.type || 'grass'; } catch { /* mock */ } const k = t === 'asphalt' || t === 'rock' ? 'asphalt' : t === 'gravel' || t === 'sand' ? 'gravel' : 'grass'; core.play('step_' + k + Math.floor(R() * 3), { gain: 0.14 + 0.05 * sp, vary: 0.1, to: core.bus.sfx, pan: (api._foot = !api._foot) ? 0.1 : -0.1 }); if (wx.wet > 0.6 && k !== 'asphalt') core.play('splash', { gain: 0.06, rate: 2.2, vary: 0.2, to: core.bus.sfx });
  }
  // other players' engines (doppler via rpm), horns
  function others(dt, now) {
    const rv = ctx.net?.remoteVehicles; if (!rv) return; const near = []; for (const r of rv) { if (!r.occupied) continue; const d = r.pos.distanceTo(cam.position); if (d < 400) near.push([d, r]); } near.sort((a, b) => a[0] - b[0]); near.length = Math.min(near.length, MAX_REMOTE); const keep = new Set();
    for (const [d, r] of near) { let e = engines.get(r.id); if (!e || e.type !== r.type) { e?.dispose(); e = new EngineVoice(core, engineSpec(ctx.vehicles?.types?.[r.type] || {}), true); e.type = r.type; engines.set(r.id, e); } keep.add(r.id); e.idle = 0; relSet(r.pos); const vr = -((r.vel.x - camVel.x) * rel.x + (r.vel.y - camVel.y) * rel.y + (r.vel.z - camVel.z) * rel.z) / Math.max(1, d); e.set(Math.max(650, r.rpm || 900), clamp(r.throttle || 0), { x: rel.x, y: rel.y, z: rel.z, doppler: clamp(343 / (343 - clamp(vr, -120, 120)), 0.7, 1.4) }); }
    for (const [id, e] of engines) if (!keep.has(id)) { e.mute(); e.idle = (e.idle || 0) + dt; if (e.idle > 4) { e.dispose(); engines.delete(id); } }
    let hp = null, hd = 700; for (const p of ctx.net.peers?.values?.() || []) if (p.horn && p.pos) { const d = p.pos.distanceTo(cam.position); if (d < hd) { hd = d; hp = p; } } if (hp) { rHorn ||= new HornVoice(core, true); rHorn.set(true, (ctx.vehicles?.types?.[hp.vehicleType]?.mass || 1500) > 2400, relSet(hp.pos)); } else rHorn?.set(false, false);
    let dp = null, dd = 250; for (const p of ctx.net.peers?.values?.() || []) if (p.drone) { const d = p.drone.distanceTo(cam.position); if (d < dd) { dd = d; dp = p; } } if (dp) { remoteDrone ||= new DroneVoice(core); remoteDrone.set(true, 0.5, relSet(dp.drone), 7 / Math.max(7, dd)); } else remoteDrone?.set(false, 0.3, null);
  }
  function sirenUpdate(dt, menu) {
    cityT -= dt; const cp = cam.position, now = ctx.time.real;
    if (cityT <= 0) {
      cityT = 1; sirenList = []; forced = forced.filter((f) => f.until > now);
      if (!menu) {
        const ts = ctx.storms?.tornadoes || [], pk = (x, z, r, name) => { for (const k of [0, 1]) { const a = (name.length * 1.7 + k * 2.9) % 6.28, rr = r * (k ? 0.55 : 0.2); sirenList.push({ id: name + k, x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr }); } };
        for (const c of ctx.world?.cities || []) { const d = Math.hypot(c.x - cp.x, c.z - cp.z); if (d > 4200 + (c.radius || 500)) continue; let w = false; for (const t of ts) { if (t.stage === 'dead') continue; const q = Math.hypot(t.x - c.x, t.z - c.z) - (c.radius || 500); if (q < 4500 && (t.onGround !== false || q < 2000)) w = true; } if (w) pk(c.x, c.z, c.radius || 500, c.name || 'x'); }
        for (const f of forced) sirenList.push({ id: 'f' + f.x, x: f.x, z: f.z });
        for (const s of sirenList) s.d = Math.hypot(s.x - cp.x, s.z - cp.z); sirenList.sort((a, b) => a.d - b.d); sirenList = sirenList.filter((s) => s.d < 4500).slice(0, MAX_SIREN);
      }
    }
    for (let i = 0; i < MAX_SIREN; i++) { let s = sirens[i]; const t = sirenList.find((x) => x.id === s?.id) || (!s || s.on <= 0 ? sirenList.find((x) => !sirens.some((q) => q && q.id === x.id)) : null); if (t && (!s || s.id !== t.id)) { if (!s) { s = sirens[i] = new SirenVoice(core); s.lfo.frequency.value = 0.112 + 0.013 * i; s.o1.detune.value = i * 9; } s.id = t.id; s.sx = t.x; s.sz = t.z; } if (!s) continue; if (!t && s.on <= 0) { s.idle = (s.idle || 0) + dt; if (s.idle > 6) { s.dispose(); sirens.splice(i, 1); } continue; } s.idle = 0; const dx = s.sx - cp.x, dz = s.sz - cp.z; s.set({ active: !!t, x: dx, y: 12, z: dz, dist: Math.hypot(dx, dz) }, dt); }
  }
  return api;
}

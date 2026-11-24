import * as THREE from 'three';
import { Events } from './events.js';
import { createSettings, resolveQuality } from './settings.js';
import { createInput } from './input.js';
import { createGlobals } from './globals.js';
import { rng } from './rng.js';
import { mocks } from './mocks.js';

export function createContext(canvas) {
  const events = new Events(), settings = createSettings(events);
  const ctx = {
    canvas, events, settings, rng, state: 'loading', input: createInput(canvas), globals: createGlobals(),
    scene: new THREE.Scene(), fxScene: new THREE.Scene(), viewScene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(settings.get('fov'), innerWidth / innerHeight, 0.15, 60000),
    time: { now: 0, dt: 0, real: 0, frame: 0, hour: 17.2 }, renderer: null,
  };
  ctx.camera.position.set(0, 3, 12);
  ctx.quality = resolveQuality(settings, gpuName());
  events.on('settings:changed', (e) => { if (e.key === 'quality') { ctx.quality = resolveQuality(settings, gpuName()); events.emit('quality:changed', ctx.quality); } });
  return ctx;
}
let _gpu;
export function gpuName() {
  if (_gpu !== undefined) return _gpu;
  try { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); _gpu = String(g.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : g.RENDERER)); g.getExtension('WEBGL_lose_context')?.loseContext(); } catch { _gpu = ''; }
  return _gpu;
}
export const SYSTEMS = [['gfx', '../render/index.js'], ['storms', '../sim/index.js'], ['world', '../world/index.js'], ['fx', '../fx/index.js'], ['vehicles', '../vehicles/index.js'], ['player', '../player/index.js'], ['gameplay', '../gameplay/index.js'], ['net', '../net/index.js'], ['audio', '../audio/index.js'], ['ui', '../ui/index.js']];
// load systems; `only` = array of keys to load for real, everything else is mocked (dev harnesses)
export async function loadSystems(ctx, only, onProgress = () => {}) {
  for (const [k, path] of SYSTEMS) {
    onProgress(k);
    if (only && !only.includes(k)) { if (mocks[k]) ctx[k] = mocks[k](ctx); continue; }
    const t0 = performance.now();
    try { const m = await import(path); ctx[k] = await m.create(ctx); ctx.bootTimes = ctx.bootTimes || {}; ctx.bootTimes[k] = Math.round(performance.now() - t0); }
    catch (e) { console.error(`[system ${k}] failed, using mock:`, e?.stack || String(e)); if (mocks[k]) ctx[k] = mocks[k](ctx); }
  }
  for (const [k] of SYSTEMS) { onProgress('init ' + k); const t0 = performance.now(); try { await ctx[k]?.init?.(); } catch (e) { console.error(`[init ${k}]`, e?.stack || String(e)); } const d = Math.round(performance.now() - t0); if (d > 50) (ctx.bootTimes ||= {})['init ' + k] = d; }
}
export const UPDATE_ORDER = ['net', 'storms', 'gameplay', 'vehicles', 'player', 'world', 'fx', 'audio', 'ui'];
const errs = {};
export function stepFrame(ctx, dtRaw) {
  const dt = Math.min(dtRaw, 0.1), T = ctx.time; T.dt = dt; T.real += dtRaw; T.frame++;
  const paused = ctx.state === 'paused' && (ctx.net?.role ?? 'solo') === 'solo';
  if (!paused) { T.now += dt; T.hour = (T.hour + dt / 150) % 24; }
  ctx.globals.uTime.value = T.now; ctx.input.poll();
  const run = (k, f, a) => { const s = ctx[k]; if (s && s[f]) { try { s[f](a); } catch (e) { const n = k + '.' + f; errs[n] = (errs[n] || 0) + 1; if (errs[n] <= 3) console.error(`[${n}]`, e?.stack || String(e)); } } };
  for (const k of UPDATE_ORDER) if (!paused || k === 'ui' || k === 'audio' || k === 'net') run(k, 'update', dt);
  if (!paused) for (const k of UPDATE_ORDER) run(k, 'lateUpdate', dt);
  ctx.globals.uCamPos.value.copy(ctx.camera.position);
  run('gfx', 'render', dt);
  ctx.input.endFrame();
}

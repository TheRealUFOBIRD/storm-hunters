const DEF = { quality: 'auto', resolution: 1, fov: 72, shadows: true, motionBlur: false, filmGrain: true, invertY: false, mouseSens: 1, units: 'imperial', master: 0.8, sfx: 1, music: 0.5, voice: 0.8, showFps: false, name: '', dynamicRes: true, cameraShake: 1, hints: true };
export const PRESETS = {
  low:    { id: 'low',    volScale: 0.25, volSteps: 48,  lightSteps: 3, shadowSize: 1024, cascades: 1, grass: 0.25, trees: 0.4, viewDist: 9000,  particles: 0.35, pixelRatio: 0.75, ssao: false, bloom: true, taa: false },
  medium: { id: 'medium', volScale: 0.33, volSteps: 72,  lightSteps: 4, shadowSize: 1536, cascades: 2, grass: 0.5,  trees: 0.7, viewDist: 14000, particles: 0.6,  pixelRatio: 1,    ssao: true,  bloom: true, taa: true },
  high:   { id: 'high',   volScale: 0.5,  volSteps: 110, lightSteps: 5, shadowSize: 2048, cascades: 3, grass: 1,    trees: 1,   viewDist: 22000, particles: 1,    pixelRatio: 1,    ssao: true,  bloom: true, taa: true },
  ultra:  { id: 'ultra',  volScale: 0.66, volSteps: 160, lightSteps: 6, shadowSize: 4096, cascades: 3, grass: 1.5,  trees: 1.3, viewDist: 30000, particles: 1.5,  pixelRatio: 1,    ssao: true,  bloom: true, taa: true },
};
export function createSettings(events) {
  const d = { ...DEF };
  try { Object.assign(d, JSON.parse(localStorage.getItem('sh.settings') || '{}')); } catch { /* storage blocked */ }
  const q = new URLSearchParams(location.search).get('quality');
  return {
    get: (k) => (k === 'quality' && q ? q : d[k]), all: () => ({ ...d }),
    set(k, v) { d[k] = v; try { localStorage.setItem('sh.settings', JSON.stringify(d)); } catch { /* storage blocked */ } events.emit('settings:changed', { key: k, value: v }); },
    reset() { for (const k in DEF) this.set(k, DEF[k]); },
  };
}
export function resolveQuality(settings, rendererName = '') {
  let q = settings.get('quality');
  if (!PRESETS[q]) {
    const r = rendererName.toLowerCase();
    if (/mobile|adreno|mali|swiftshader|llvmpipe|software|basic render/.test(r) || /android|iphone|ipad/i.test(navigator.userAgent)) q = 'low';
    else if (/intel(?!.*arc)|uhd|iris|radeon\(tm\) graphics|vega \d\b/.test(r)) q = 'low';
    else if (/rtx|rx [679]\d{3}|arc|m[1-5] (pro|max|ultra)/.test(r)) q = 'high'; else q = 'medium';
  }
  return PRESETS[q];
}

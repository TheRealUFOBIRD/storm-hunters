import { makeSampler } from './sampler.js';
import { genChunk } from './gen.js';
import { makeLayout } from './layout.js';
import { genGrassTile } from './grassGen.js';
let s = null, layout = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') { s = makeSampler(m.data); layout = makeLayout(s); self.postMessage({ t: 'ready' }); return; }
  try {
    if (m.t === 'chunk') { const r = genChunk(s, m.x, m.z, m.size); self.postMessage({ t: 'chunk', id: m.id, r }, [r.h.buffer, r.nrm.buffer, r.road.buffer]); }
    else if (m.t === 'sector') { const r = layout.sector(m.i, m.j); self.postMessage({ t: 'sector', id: m.id, r }, r.buffers); }
    else if (m.t === 'grass') { const r = genGrassTile(s, m.x, m.z, m.size, m.n); self.postMessage({ t: 'grass', id: m.id, r }, r ? [r.a.buffer, r.b.buffer, ...(r.ca ? [r.ca.buffer, r.cb.buffer] : [])] : []); }
  } catch (err) { self.postMessage({ t: 'err', id: m.id, k: m.t, msg: String(err?.stack || err) }); }
};

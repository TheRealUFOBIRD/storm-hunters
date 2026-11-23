// Renders the sound bank and thunder off the main thread.
import { render, thunder } from './dsp.js';
self.onmessage = ({ data: m }) => {
  try {
    const o = m.k === 'thunder' ? thunder(m.p) : render(m.name);
    self.postMessage({ id: m.id, ok: true, o }, o.ch.map((c) => c.buffer));
  } catch (e) { self.postMessage({ id: m.id, ok: false, e: String(e?.stack || e) }); }
};

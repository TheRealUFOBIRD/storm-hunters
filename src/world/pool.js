// Priority job queue over module workers with a time-sliced main thread fallback.
export function createPool(data, nWorkers) {
  const ws = []; let failed = false, nextId = 1; const queue = [], inflight = new Map(), ready = []; let rh = 0;
  const mk = () => {
    try {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); const o = { w, ok: false, load: 0, dead: false };
      w.onerror = (e) => {
        if (o.ok) { console.error('[world worker]', e.message); return; }
        console.warn('[world] worker unavailable, using main thread', e.message || ''); o.dead = true; failed = ws.every((q) => q.dead);
        for (const [id, j] of inflight) if (j.o === o) { inflight.delete(id); queue.push(j); }
      };
      w.onmessage = (e) => { const m = e.data; if (m.t === 'ready') { o.ok = true; return; } const j = inflight.get(m.id); if (!j) return; inflight.delete(m.id); j.o.load--; if (m.t === 'err') { console.error('[world worker]', m.k, m.msg); j.r = null; } else j.r = m.r; ready.push(j); };
      w.postMessage({ t: 'init', data }); ws.push(o);
    } catch (e) { console.warn('[world] no workers', e); }
  };
  if (typeof Worker !== 'undefined') for (let i = 0; i < nWorkers; i++) mk(); if (!ws.length) failed = true;
  const pickMin = () => { let b = -1, v = 1e18; for (let i = 0; i < queue.length; i++) if (queue[i].pri < v) { v = queue[i].pri; b = i; } const j = queue[b]; queue[b] = queue[queue.length - 1]; queue.pop(); return j; };
  return {
    request(t, args, pri, cb, fallback) { queue.push({ t, args, pri, cb, fallback, id: nextId++, o: null, r: null }); },
    get size() { return queue.length + inflight.size + ready.length - rh; },
    pump(budget) { // once per frame; budget in ms for integrating results
      const t0 = performance.now();
      for (let w = 0; w < ws.length; w++) { const o = ws[w]; if (o.dead) continue; while (o.load < 5 && queue.length) { const j = pickMin(); j.o = o; o.load++; inflight.set(j.id, j); o.w.postMessage({ t: j.t, id: j.id, ...j.args }); } }
      let n = 0; while (rh < ready.length && (n === 0 || performance.now() - t0 < budget)) { const j = ready[rh++]; n++; try { j.cb(j.r); } catch (e) { console.error('[world job]', j.t, e?.stack || e); } }
      if (rh >= ready.length) { ready.length = 0; rh = 0; }
      if (failed) { n = 0; while (queue.length && (n === 0 || performance.now() - t0 < budget)) { n++; const j = pickMin(); let r = null; try { r = j.fallback ? j.fallback() : null; } catch (e) { console.error(e); } j.cb(r); } }
    },
    dispose() { for (const o of ws) o.w.terminate(); },
  };
}

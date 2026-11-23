export class Events {
  constructor() { this.m = new Map(); }
  on(n, f) { let s = this.m.get(n); if (!s) this.m.set(n, s = new Set()); s.add(f); return () => s.delete(f); }
  once(n, f) { const off = this.on(n, (d) => { off(); f(d); }); return off; }
  emit(n, d) { const s = this.m.get(n); if (s) for (const f of [...s]) { try { f(d); } catch (e) { console.error(`[event ${n}]`, e?.stack || String(e)); } } }
}

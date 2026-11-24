import { createContext, loadSystems, stepFrame } from './core/context.js';
const $ = (id) => document.getElementById(id), canvas = $('game'), boot = $('boot'), bootMsg = $('boot-msg'), bootBar = $('boot-bar');
const ctx = (window.ctx = createContext(canvas));
const LABEL = { gfx: 'Compiling atmosphere', storms: 'Initialising convection', world: 'Surveying the United States', fx: 'Seeding precipitation', vehicles: 'Fuelling vehicles', player: 'Suiting up', gameplay: 'Calling dispatch', net: 'Opening radio channels', audio: 'Calibrating microphones', ui: 'Booting field computer' };
const raf = () => new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 100); });
const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // let the overlay reach the screen
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const frames = (n) => new Promise((r) => { const f0 = ctx.time.frame; const t = () => (ctx.time.frame - f0 >= n ? r() : setTimeout(t, 16)); t(); });

// ---- loading overlay (boot screen, reused when a chase starts) ----
let barV = 0;
const overlay = {
  show(msg) { boot.style.transition = 'none'; boot.style.display = ''; boot.classList.remove('done'); void boot.offsetWidth; boot.style.transition = ''; this.set(msg, 0); },
  set(msg, v) { if (msg) bootMsg.textContent = msg; if (v != null) { barV = Math.max(0, Math.min(100, v)); bootBar.style.width = barV + '%'; } },
  hide() { this.set(null, 100); boot.classList.add('done'); setTimeout(() => { if (boot.classList.contains('done')) boot.style.display = 'none'; }, 900); },
};

// ---- render loop (runs behind the overlay too, so streaming, texture uploads and shader compiles happen while loading) ----
let loopOn = false;
function startLoop() {
  if (loopOn) return; loopOn = true; let last = performance.now();
  const loop = (t) => { const dt = Math.max(0.0001, (t - last) / 1000); last = t; const f0 = performance.now(); stepFrame(ctx, dt); const fd = performance.now() - f0; if (fd > 500) console.log(`[perf] frame ${ctx.time.frame} took ${Math.round(fd)} ms`); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

// ---- preload helpers ----
// stream terrain, roads, objects and grass around (x,z) and wait for all lazily loaded assets; reports 0..1
async function loadArea(x, z, from, to, label, maxS = 60) {
  const t0 = performance.now(), W = ctx.world;
  const prog = (k) => overlay.set(null, from + (to - from) * k);
  let streamed = false; const pw = (async () => { while (!streamed && performance.now() - t0 < maxS * 1000) { await (W.prewarm?.(x, z) ?? Promise.resolve()); const s = W.loadState?.(); streamed = !s || (s.terrain && s.grass); if (!streamed) await wait(0.1); } streamed = true; })();
  while (performance.now() - t0 < maxS * 1000) {
    const s = W.loadState?.() || { tex: true, scans: 1, scansQueued: 0, nature: true, terrain: true, grass: true };
    const parts = [s.tex ? 1 : 0, s.scans, s.nature ? 1 : 0, streamed ? 1 : (s.terrain ? 0.6 : 0.2)];
    const k = parts.reduce((a, b) => a + b, 0) / parts.length; prog(k);
    overlay.set(!s.tex ? 'Baking ground textures' : s.scans < 1 || s.scansQueued ? 'Loading terrain scans' : !s.nature ? 'Loading trees and plants' : label);
    if (s.tex && s.scans >= 1 && !s.scansQueued && s.nature && streamed) break;
    await wait(0.1);
  }
  await pw;
}
// compile every shader the session can need, including objects that are normally hidden (water, all vehicles, tools, debris)
async function compileAll(from, to) {
  overlay.set('Compiling shaders', from); await paint();
  const r = ctx.renderer, cam = ctx.camera, tmp = [];
  if (r) {
    try {
      const fwd = cam.getWorldDirection(cam.position.clone()), types = Object.keys(ctx.vehicles.types || {});
      types.forEach((t, i) => { const v = ctx.vehicles.createVisual?.(t); if (!v?.object3d) return; v.object3d.position.copy(cam.position).addScaledVector(fwd, 10 + i * 4); ctx.scene.add(v.object3d); tmp.push(v); });
      const hidden = []; for (const s of [ctx.scene, ctx.fxScene, ctx.viewScene]) s.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      for (const [i, s] of [ctx.scene, ctx.fxScene, ctx.viewScene].entries()) { overlay.set(null, from + (to - from) * (0.2 + i * 0.25)); await paint(); if (r.compileAsync) await r.compileAsync(s, cam); else r.compile(s, cam); }
      for (const o of hidden) o.visible = false;
    } catch (e) { console.warn('[preload] compile', e); }
  }
  await frames(12); // first real frames: shadow/depth variants and the post chain compile here
  for (const v of tmp) { ctx.scene.remove(v.object3d); try { v.dispose?.(); } catch { /* ignore */ } }
  overlay.set(null, to);
}

(async () => {
  await raf();
  let n = 0; await loadSystems(ctx, null, (k) => { n++; if (LABEL[k]) bootMsg.textContent = LABEL[k]; overlay.set(null, Math.min(35, n / 20 * 35)); });
  addEventListener('resize', () => { ctx.camera.aspect = innerWidth / innerHeight; ctx.camera.updateProjectionMatrix(); ctx.gfx?.resize?.(); });
  await Promise.race([ctx.world.ready, wait(30)]);
  ctx.events.on('game:start', startGame); ctx.events.on('game:quit', quitGame);
  const m = enterMenu(); startLoop();
  await loadArea(m.x, m.z, 35, 80, 'Streaming the plains', 25);
  await compileAll(80, 100);
  overlay.hide();
  ctx.ready = true; ctx.events.emit('game:ready');
  const q = new URLSearchParams(location.search);
  if (q.has('autostart')) ctx.events.emit('game:start', { mode: 'solo', name: 'Dev', city: q.get('city') || undefined });
})().catch((e) => { console.error('[boot]', e?.stack || e); bootMsg.textContent = 'Failed to start: ' + e.message; });

// Slow cinematic drift in front of a staged storm behind the main menu
function enterMenu() {
  ctx.state = 'menu';
  const w = ctx.world, s = w.spawnPoint?.('Wichita') || { x: 0, z: 0 }, bx = s.x + 60, bz = s.z;
  if (!ctx.storms.mock && ctx.storms.isAuthority) try { ctx.storms.clear?.(); ctx.storms.director = false; ctx.storms.spawnAt(bx - 300, bz - 1500, { ef: 4, stage: 'mature', shape: 'wedge', hold: true, still: true, menu: true }); ctx.menuStorm = true; } catch (e) { console.error(e); }
  w.prewarm?.(bx, bz);
  const cam = (c) => { const t = ctx.time.real * 0.02, x = bx + Math.sin(t) * 20, z = bz + Math.cos(t) * 20, tt = ctx.storms.tornadoes[0]; c.position.set(x, w.heightAt(x, z) + 4.2, z); c.lookAt(tt ? tt.x - 420 : bx, c.position.y + 190, tt ? tt.z : bz - 2000); };
  ctx.player.cameraOverride = cam;
  if (ctx.player.mock) ctx.player.update = () => { if (ctx.state === 'menu') cam(ctx.camera); };
  try { ctx.ui.openScreen('main'); } catch (e) { console.error('[menu]', e?.stack || e); }
  return { x: bx, z: bz };
}
function quitGame() { ctx.net.leave?.(); if (ctx.player.vehicle) ctx.player.exit?.(); ctx.vehicles.clear?.(); enterMenu(); }
async function startGame(o) {
  if (ctx._starting) return; ctx._starting = true;
  ctx.audio.unlock?.(); // still inside the click gesture: browsers only allow audio to start here
  // a loading screen instead of a frozen menu: show it and let it paint before any heavy work
  overlay.show('Preparing the chase'); await paint();
  try {
    if (o.mode === 'host') { overlay.set('Opening the room', 5); await ctx.net.host?.(o.name, o.room); } else if (o.mode === 'join') { overlay.set('Joining the room', 5); await ctx.net.join?.(o.room, o.name); }
    if (ctx.menuStorm && o.mode !== 'join' && !o.joined && ctx.net.role !== 'client') ctx.storms.clear?.();
    ctx.menuStorm = null;
    const sp = ctx.world.spawnPoint?.(o.city) || { x: 0, z: 0, heading: 0 };
    // park the camera at the start point so streaming, culling and compiles all happen for the real view
    const W = ctx.world; ctx.player.cameraOverride = (c) => { c.position.set(sp.x, W.heightAt(sp.x, sp.z) + 3, sp.z); c.rotation.set(-0.05, -(sp.heading || 0), 0, 'YXZ'); };
    await loadArea(sp.x, sp.z, 10, 75, 'Loading ' + (o.city || 'the start area'), 25);
    ctx.player.cameraOverride = null; ctx.storms.director = true; ctx.state = 'playing';
    ctx.player.teleport(sp.x, sp.z, sp.heading);
    const type = ctx.gameplay.profile?.current || Object.keys(ctx.vehicles.types)[0];
    if (type) { const v = ctx.vehicles.spawn(type, sp.x, sp.z, sp.heading); if (v) ctx.player.enter(v); }
    ctx.ui.closeScreen?.(); ctx.events.emit('game:started', o);
    await compileAll(75, 100); // anything new at this spot (town blocks, the player's car, HUD view models)
    ctx.gfx?.cut?.(); overlay.hide();
  } catch (e) { console.error('[start]', e?.stack || e); overlay.hide(); ctx.ui.notify({ title: 'Could not start', text: e.message || String(e), kind: 'bad', ttl: 8 }); enterMenu(); }
  finally { ctx._starting = false; }
}

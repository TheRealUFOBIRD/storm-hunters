import { createContext, loadSystems, stepFrame } from './core/context.js';
const $ = (id) => document.getElementById(id), canvas = $('game'), boot = $('boot'), bootMsg = $('boot-msg'), bootBar = $('boot-bar');
const ctx = (window.ctx = createContext(canvas));
const LABEL = { gfx: 'Compiling atmosphere', storms: 'Initialising convection', world: 'Surveying the United States', fx: 'Seeding precipitation', vehicles: 'Fuelling vehicles', player: 'Suiting up', gameplay: 'Calling dispatch', net: 'Opening radio channels', audio: 'Calibrating microphones', ui: 'Booting field computer' };
let n = 0; const progress = (k) => { n++; if (LABEL[k]) bootMsg.textContent = LABEL[k]; bootBar.style.width = Math.min(96, n / 20 * 100) + '%'; };
const raf = () => new Promise((r) => { requestAnimationFrame(r); setTimeout(r, 100); });
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
(async () => {
  await raf();
  await loadSystems(ctx, null, progress);
  addEventListener('resize', () => { ctx.camera.aspect = innerWidth / innerHeight; ctx.camera.updateProjectionMatrix(); ctx.gfx?.resize?.(); });
  await Promise.race([ctx.world.ready, wait(30)]);
  ctx.events.on('game:start', startGame); ctx.events.on('game:quit', quitGame);
  enterMenu();
  let last = performance.now();
  const loop = (t) => { const dt = Math.max(0.0001, (t - last) / 1000); last = t; stepFrame(ctx, dt); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  await raf(); await raf(); bootBar.style.width = '100%'; boot.classList.add('done'); setTimeout(() => boot.remove(), 900);
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
}
function quitGame() { ctx.net.leave?.(); if (ctx.player.vehicle) ctx.player.exit?.(); ctx.vehicles.clear?.(); enterMenu(); }
async function startGame(o) {
  if (ctx._starting) return; ctx._starting = true;
  try {
    if (o.mode === 'host') await ctx.net.host?.(o.name, o.room); else if (o.mode === 'join') await ctx.net.join?.(o.room, o.name);
    if (ctx.menuStorm && o.mode !== 'join' && !o.joined && ctx.net.role !== 'client') ctx.storms.clear?.();
    ctx.menuStorm = null;
    const sp = ctx.world.spawnPoint?.(o.city) || { x: 0, z: 0, heading: 0 };
    await Promise.race([ctx.world.prewarm?.(sp.x, sp.z), wait(12)]);
    ctx.player.cameraOverride = null; ctx.storms.director = true; ctx.state = 'playing';
    ctx.player.teleport(sp.x, sp.z, sp.heading);
    const type = ctx.gameplay.profile?.current || Object.keys(ctx.vehicles.types)[0];
    if (type) { const v = ctx.vehicles.spawn(type, sp.x, sp.z, sp.heading); if (v) ctx.player.enter(v); }
    ctx.ui.closeScreen?.(); ctx.audio.unlock?.(); ctx.events.emit('game:started', o);
  } catch (e) { console.error('[start]', e?.stack || e); ctx.ui.notify({ title: 'Could not start', text: e.message || String(e), kind: 'bad', ttl: 8 }); enterMenu(); }
  finally { ctx._starting = false; }
}

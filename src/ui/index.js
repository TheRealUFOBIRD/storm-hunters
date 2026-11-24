// UI system: screen manager, pointer lock / pause handling, keyboard + gamepad navigation, HUD, cards.
import { h } from './dom.js';
import { RadarEngine, Overlay, radarScreen, drawLaptop } from './radar.js';
import { createHud } from './hud.js';
import { mainScreen, startScreen, joinScreen, lobbyScreen, pauseScreen, settingsScreen, howtoScreen, sweptScreen } from './menu.js';
import { mapScreen, missionsScreen, garageScreen, albumScreen, createCards } from './panels.js';
import { gearValue } from '../gameplay/profile.js';
import { dirToHeading } from '../core/math.js';

const MAKE = { main: mainScreen, start: startScreen, join: joinScreen, lobby: lobbyScreen, pause: pauseScreen, settings: settingsScreen, howto: howtoScreen, swept: sweptScreen, radar: radarScreen, map: mapScreen, missions: missionsScreen, garage: garageScreen, album: albumScreen };
const TOGGLE = { map: 'map', radar: 'radar', missions: 'missions', garage: 'garage', album: 'album', help: 'howto' };

export async function create(ctx) {
  const host = document.getElementById('ui') || document.body.appendChild(h('div', { id: 'ui' })); host.classList.add('shui');
  const screens = {}, stack = []; let cur = null, curName = null, lockIntent = 0, pausedByUs = false, lockPauseT = -1e9, escT = -1e9, capT = 0, mapCv = null, mapT = 0, lapT = 0, padPrev = {}, padRep = 0, clickFx = null, netHooked = false, waitingStart = false, blurT = 0;
  const radarCanvas = document.createElement('canvas'); radarCanvas.width = 512; radarCanvas.height = 384;
  const dirV = { x: 0, y: 0, z: 0 };
  const ui = {
    ctx, radarCanvas, screen: null, hideHud: false, ready: false, handlesNetStatus: false, forceCards: false,
    get units() { return ctx.settings.get('units') || 'imperial'; },
    pos: () => (ctx.player?.mode === 'drive' && ctx.player.vehicle?.pos) || ctx.player?.pos || ctx.camera.position,
    heading() { const v = ctx.player?.mode === 'drive' ? ctx.player.vehicle : null; if (v?.quat) { const q = v.quat; return dirToHeading(-2 * (q.x * q.z + q.w * q.y), -(1 - 2 * (q.x * q.x + q.y * q.y))); } if (ctx.player && ctx.player.heading != null && ctx.player.mode === 'foot') return ctx.player.heading; const e = ctx.camera.matrixWorld.elements; return dirToHeading(-e[8], -e[10]); },
    mapCanvas() { const now = ctx.time.real; if (!mapCv || (now > mapT && !mapCv._ok)) { mapT = now + 3; try { mapCv = ctx.world?.getMapCanvas?.() || null; if (mapCv) mapCv._ok = true; } catch (e) { console.error('[map]', e); } } return mapCv; },
    beep(k) { ctx.audio?.play?.('ui_' + k); },
    notify: (n) => hud.notify(typeof n === 'string' ? { title: n } : n || {}), subtitle: (t, who) => hud.subtitle(t, who),
    openScreen(name, o = {}) {
      if (!MAKE[name]) return; let s = screens[name]; if (!s) { try { s = screens[name] = MAKE[name](ui); } catch (e) { console.error('[ui ' + name + ']', e); return; } s.el.hidden = true; s.el.dataset.name = name; layer.append(s.el); }
      if (curName === name && !o.force) { s.open?.(o); return; }
      const from = curName; if (cur) { cur.close?.(); hide(cur); } if (s.root || o.replace) stack.length = 0; else if (from && from !== name && !o.noStack) { const i = stack.indexOf(name); if (i >= 0) stack.splice(i); else stack.push(from); }
      cur = s; curName = name; ui.screen = name; s.el.hidden = false; s.el.classList.remove('in'); void s.el.offsetWidth; s.el.classList.add('in');
      if (s.pause && ctx.state === 'playing' && (ctx.net?.role ?? 'solo') === 'solo') { ctx.state = 'paused'; pausedByUs = true; }
      ui.block(); try { s.open?.(o); s.update?.(0.016); } catch (e) { console.error('[ui ' + name + ']', e?.stack || e); } ctx.events.emit('ui:screen', { name, open: true }); if (s.focus && (ctx.input.usingPad || lastInput === 'key')) setTimeout(() => cur === s && s.el.querySelector(s.focus)?.focus({ preventScroll: true }), 30);
    },
    closeScreen() {
      if (!cur) return; if (cur.sticky) return; const prev = stack.pop(); if (prev && MAKE[prev]) { const n = curName; void n; ui.openScreen(prev, { noStack: true }); return; } if (ctx.state === 'menu' && curName !== 'main') { ui.openScreen('main'); return; } ui.forceClose(); ui.capture();
    },
    forceClose() { const name = curName; if (cur) { cur.close?.(); hide(cur); } cur = null; curName = null; ui.screen = null; stack.length = 0; if (pausedByUs) { pausedByUs = false; if (ctx.state === 'paused') ctx.state = 'playing'; } const a = document.activeElement; if (a && a !== document.body && host.contains(a)) a.blur(); ui.block(); if (name) ctx.events.emit('ui:screen', { name, open: false }); },
    block() { const b = !!cur || hud.chatOpen || ctx.state === 'menu'; ctx.input.uiBlock = b; host.classList.toggle('blocking', !!cur); if (b && document.pointerLockElement) { lockIntent = performance.now(); ctx.input.releaseCapture?.(); } },
    // Esc's own default action leaves pointer lock after our handler ran, so a lock requested from the Esc key event would be
    // dropped again at once (and read as "player left the game" -> pause). Ask a moment later instead.
    capture() { if (performance.now() - escT < 60) { clearTimeout(capT); capT = setTimeout(() => ui.capture(), 160); return; } if (ctx.state === 'playing' && !cur && !hud.chatOpen) { ctx.input.uiBlock = false; ctx.input.requestCapture?.(); } },
    start(o) { ctx.events.emit('game:start', o); },
    quit() { pausedByUs = false; ui.forceClose(); ctx.events.emit('game:quit', {}); },
    async hostLobby(name, city) { await ctx.net.host(name); ui.openScreen('lobby', { city, replace: true }); },
    startRoom(city) { const name = ctx.settings.get('name') || 'Chaser'; ctx.net?.send?.('gp:start', { city }, { reliable: true }); ui.start({ mode: 'solo', hosted: true, name, city }); },
    async joinLobby(code, name) { await ctx.net.join(code, name); waitingStart = true; ui.openScreen('lobby', { replace: true }); ctx.net.send?.('gp:hello', {}, { to: ctx.net.hostId, reliable: true }); },
  };
  ui.radar = new RadarEngine(ctx); ui.overlay = new Overlay(ctx); ui.radar.site = () => ui.pos();
  ctx.ui ||= ui; // available to HUD helpers during construction
  const layer = h('div.screens'), hud = createHud(ui), cards = createCards(ui); ui.hud = hud; ui.cards = cards;
  // Browsers refuse to re-lock the pointer from an Esc key press, so after resuming with Esc say how to get the mouse back.
  const resume = h('div.resume', { html: '<span>Click to look around</span>' }); resume.hidden = true; host.append(hud.el, cards.el, resume, layer);
  const hide = (s) => { s.el.hidden = true; s.el.classList.remove('in'); };

  // ---------- input modality ----------
  let lastInput = 'mouse'; addEventListener('pointermove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) { if (lastInput !== 'mouse') { lastInput = 'mouse'; host.classList.remove('keynav'); } } }, true);
  // Esc is handled here, once, in the key event itself (input.js also turns it into a 'pause' press, which is consumed so
  // the frame loop does not act on the same key a second time). It works with a text field or slider focused.
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') { escape(e); return; }
    if (!cur) return; const a = document.activeElement, typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.type !== 'range';
    if (!typing && cur.key?.(e)) return; const d = { ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r' }[e.code]; if (!d || (typing && (d === 'l' || d === 'r')) || (a?.type === 'range' && (d === 'l' || d === 'r'))) return; e.preventDefault(); lastInput = 'key'; host.classList.add('keynav'); nav(d);
  });
  function escape(e) {
    ctx.input.consume?.('pause'); if (e.repeat || !ctx.ready) return; e.preventDefault(); escT = performance.now();
    if (hud.chatOpen) { hud.closeChat(); return; }
    const a = document.activeElement; if (a && a !== document.body && host.contains(a)) a.blur();
    if (cur) { if (cur.sticky || cur.root) return; if (curName === 'pause' && performance.now() - lockPauseT < 350) return; ui.closeScreen(); return; } // pause was just opened by the same Esc leaving pointer lock
    if (ctx.state === 'playing') ui.openScreen('pause');
  }
  function nav(d) {
    const L = [...cur.el.querySelectorAll('button:not([disabled]),input,[tabindex="0"]')].filter((e) => e.offsetParent !== null && !e.hidden); if (!L.length) return; const a = document.activeElement; if (!L.includes(a)) { (cur.el.querySelector(cur.focus || 'button') || L[0]).focus(); return; }
    const r = a.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let b = null, bs = 1e9; for (const e of L) { if (e === a) continue; const q = e.getBoundingClientRect(), dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy, f = d === 'u' ? -dy : d === 'd' ? dy : d === 'l' ? -dx : dx, o = d === 'u' || d === 'd' ? Math.max(0, Math.abs(dx) - (q.width + r.width) / 2) : Math.abs(dy); if (f < 3) continue; const s = f + o * 2.4; if (s < bs) { bs = s; b = e; } } if (b) { b.focus({ preventScroll: true }); b.scrollIntoView({ block: 'nearest' }); ui.beep('tick'); }
  }
  function padNav(dt) {
    // only once the pad is actually in use: an idle controller or wheel resting off-centre must not drive the menus
    const p = ctx.input.usingPad ? ctx.input.pad : null; if (!p || !cur) { padPrev = p ? { a: !!p.buttons[0]?.pressed, b: !!p.buttons[1]?.pressed } : {}; return; } const B = (i) => !!p.buttons[i]?.pressed, ax = p.axes; const D = { u: B(12) || ax[1] < -0.6, d: B(13) || ax[1] > 0.6, l: B(14) || ax[0] < -0.6, r: B(15) || ax[0] > 0.6 }; padRep -= dt; for (const k in D) { if (D[k] && (!padPrev[k] || padRep <= 0)) { host.classList.add('keynav'); lastInput = 'key'; nav(k); padRep = padPrev[k] ? 0.12 : 0.36; } padPrev[k] = D[k]; } const a = B(0), b = B(1); if (a && !padPrev.a) { const e = document.activeElement; if (e && cur.el.contains(e)) e.click(); else nav('d'); } if (b && !padPrev.b && !cur.root && !cur.sticky) { const x = document.activeElement; if (x && x !== document.body && host.contains(x)) x.blur(); ui.closeScreen(); } padPrev.a = a; padPrev.b = b;
  }
  // ---------- pointer lock / focus ----------
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) return; const t = performance.now(); if (t - lockIntent < 400) return; if (ctx.state === 'playing' && !cur && !hud.chatOpen && ctx.player?.mode !== 'swept') { ui.openScreen('pause'); lockPauseT = performance.now(); }
  });
  addEventListener('blur', () => { blurT = performance.now(); if (ctx.state === 'playing' && !cur && !hud.chatOpen && (ctx.net?.role ?? 'solo') === 'solo' && document.visibilityState === 'hidden') ui.openScreen('pause'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && ctx.state === 'playing' && !cur && !hud.chatOpen && (ctx.net?.role ?? 'solo') === 'solo' && ctx.ready) ui.openScreen('pause'); });
  // ---------- events ----------
  const E = ctx.events;
  E.on('game:started', (o) => { waitingStart = false; ui.ready = true; ui.forceClose(); ui.capture(); hud.refresh?.(); ui.radar.refill(); const n = ctx.net; if (n?.role === 'host' && n.room) ui.notify({ title: `Room ${n.room}`, text: 'Friends can join with this code. Invite link is in the pause menu.', kind: 'info', ttl: 9 }); void o; });
  E.on('game:quit', () => { ui.ready = false; hud.subtitle(null); });
  E.on('player:blackout', () => { if (ctx.state !== 'playing') return; if (hud.chatOpen) hud.closeChat(); setTimeout(() => { if (ctx.gameplay?.swept) ui.openScreen('swept', { replace: true }); }, 400); });
  E.on('player:respawn', () => { if (curName === 'swept') { ui.forceClose(); ui.capture(); } });
  E.on('net:status', (d) => { if (!d) return; if (d.state === 'idle' && curName === 'lobby' && !d.left) { waitingStart = false; ui.openScreen('main'); if (d.error) ui.notify({ title: 'Room closed', text: d.error, kind: 'warn' }); } });
  E.on('net:ended', () => { waitingStart = false; });
  E.on('game:ready', () => { const room = ctx.net?.parseRoom?.() || /[#&]room=([A-Za-z0-9]{4,8})/.exec(location.hash)?.[1]; if (room && ctx.state === 'menu') ui.openScreen('join', { code: room.toUpperCase() }); });
  addEventListener('hashchange', () => { const m = /[#&]room=([A-Za-z0-9]{4,8})/.exec(location.hash); if (m && ctx.state === 'menu' && (ctx.net?.role ?? 'solo') === 'solo' && curName !== 'lobby') ui.openScreen('join', { code: m[1].toUpperCase() }); });
  function hookNet() {
    if (netHooked || !ctx.net?.on) return; netHooked = true;
    ctx.net.on('gp:hello', (d, from) => { if (ctx.net.role !== 'host') return; const p = ui.pos(), on = ctx.state !== 'menu'; ctx.net.send('gp:state', { playing: on, city: on ? ctx.world.nearestCity?.(p.x, p.z)?.name : null }, { to: from, reliable: true }); });
    const begin = (d) => { if (!waitingStart || ctx.net.role !== 'client') return; waitingStart = false; ui.start({ mode: 'solo', joined: true, name: ctx.settings.get('name') || 'Chaser', city: typeof d?.city === 'string' ? d.city.slice(0, 40) : undefined }); };
    ctx.net.on('gp:state', (d) => { if (d?.playing) begin(d); }); ctx.net.on('gp:start', begin);
  }
  // ---------- frame ----------
  function update(dt) {
    hookNet(); const I = ctx.input, st = ctx.state, now = performance.now();
    if (st === 'playing' || st === 'paused') {
      for (const a in TOGGLE) if (I.pressed(a) && !hud.chatOpen) { const n = TOGGLE[a]; if (cur?.sticky) break; if (curName === n) { ui.forceClose(); ui.capture(); } else if (curName !== 'pause' && curName !== 'settings') { if (cur) stack.length = 0; ui.openScreen(n, { noStack: true }); } I.consume?.(a); break; }
      if (I.pressed('pause')) { I.consume?.('pause'); if (hud.chatOpen) hud.closeChat(); else if (cur) { if (!cur.sticky && !cur.root && now - lockPauseT > 350) ui.closeScreen(); } else ui.openScreen('pause'); }
    } else if (st === 'menu' && I.pressed('pause') && cur && !cur.root) { I.consume?.('pause'); ui.closeScreen(); }
    if (cur) { try { cur.update?.(dt); } catch (e) { if (!cur.err) { cur.err = 1; console.error('[ui ' + curName + ']', e?.stack || e); } } padNav(dt); }
    const R = ui.radar, act = st !== 'menu' && st !== 'loading'; if (act || curName === 'radar') { R.rate = gearValue(ctx.gameplay?.profile?.upgrades ? ctx.gameplay.profile : { upgrades: { gear: {} } }, 'radar', 'rate') || 60; if (curName !== 'radar' && R.range > 20000) R.setRange(20000); R.update(dt); }
    ui.overlay.tick(dt); hud.update(dt); cards.update(dt);
    const rs = st === 'playing' && ui.ready && !cur && !hud.chatOpen && !document.pointerLockElement && !I.usingPad && !I.mouse.left && !I.mouse.right && ctx.player?.mode !== 'swept' && !ui.hideHud; if (resume.hidden === rs) resume.hidden = !rs;
    if (act) { lapT -= dt; if (lapT <= 0) { lapT = 0.16; if (ctx.player?.mode === 'drive') { drawLaptop(ui, radarCanvas, ctx.time.real); radarCanvas.version = (radarCanvas.version || 0) + 1; } } }
  }
  Object.assign(ui, { update, lateUpdate(dt) { ctx.gameplay?.syncViewModel?.(dt); }, screens });
  void clickFx; void dirV; void blurT; return ui;
}

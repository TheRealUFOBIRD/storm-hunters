// Keyboard/mouse/gamepad -> named actions
const MAP = { KeyW: ['forward', 'throttle'], ArrowUp: ['forward', 'throttle'], KeyS: ['back', 'brake'], ArrowDown: ['back', 'brake'], KeyA: ['left'], ArrowLeft: ['left'], KeyD: ['right'], ArrowRight: ['right'],
  Space: ['handbrake', 'jump'], KeyE: ['enter'], KeyC: ['camera'], KeyH: ['lights'], KeyF: ['use'], KeyM: ['map'], Tab: ['radar'], KeyJ: ['missions'], KeyG: ['garage'], KeyR: ['recover'], KeyX: ['anchor'], KeyB: ['horn'], KeyT: ['chat'],
  Escape: ['pause'], ShiftLeft: ['sprint'], ShiftRight: ['sprint'], ControlLeft: ['crouch'], KeyP: ['album'], KeyL: ['flashlight'], KeyQ: ['toolPrev'], KeyV: ['lookBack'], KeyZ: ['zoom'], KeyN: ['nextTarget'], F1: ['help'], F3: ['debug'],
  Digit1: ['tool1'], Digit2: ['tool2'], Digit3: ['tool3'], Digit4: ['tool4'], Digit5: ['tool5'], Digit6: ['tool6'], Digit0: ['tool0'], Enter: ['confirm'] };
const PAD = { 0: 'handbrake', 1: 'recover', 2: 'use', 3: 'enter', 4: 'toolPrev', 5: 'toolNext', 8: 'map', 9: 'pause', 10: 'sprint', 11: 'camera', 12: 'lights', 13: 'anchor', 14: 'radar', 15: 'missions' };
const MENU = new Set(['pause', 'map', 'radar', 'missions', 'garage', 'album', 'confirm', 'help']);
export const ACTION_KEYS = MAP;
export function createInput(canvas) {
  const held = new Map(), press = new Set(), rel = new Set(), padHeld = new Set();
  const typing = () => { const e = document.activeElement; return e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable); };
  const dz = (v) => (Math.abs(v || 0) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88), k = (a) => (held.get(a) > 0 ? 1 : 0);
  const I = {
    uiBlock: false, captured: false, mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false, leftPressed: false, rightPressed: false, x: 0, y: 0 }, pad: null, usingPad: false,
    down: (a) => !I.uiBlock && (held.get(a) > 0 || padHeld.has(a)),
    pressed: (a) => press.has(a) && (!I.uiBlock || MENU.has(a)),
    consume: (a) => press.delete(a), released: (a) => rel.has(a),
    axis(n) {
      if (I.uiBlock) return 0; const p = I.pad;
      switch (n) {
        case 'steer': case 'moveX': return (k('right') - k('left')) || (p ? dz(p.axes[0]) : 0);
        case 'moveY': return (k('forward') - k('back')) || (p ? -dz(p.axes[1]) : 0);
        case 'throttle': return Math.max(k('throttle'), p ? p.buttons[7]?.value || 0 : 0);
        case 'brake': return Math.max(k('brake'), p ? p.buttons[6]?.value || 0 : 0);
        case 'lookX': return p ? dz(p.axes[2]) : 0; case 'lookY': return p ? dz(p.axes[3]) : 0;
      }
      return 0;
    },
    steerIsAnalog: () => !!(I.pad && Math.abs(I.pad.axes[0]) > 0.12),
    inject(a, on) { if (on) { if (!(held.get(a) > 0)) press.add(a); held.set(a, 1); } else { held.set(a, 0); rel.add(a); } },
    requestCapture() { if (!I.uiBlock && document.pointerLockElement !== canvas) { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* denied */ } } },
    releaseCapture() { if (document.pointerLockElement) document.exitPointerLock(); },
    poll() {
      const ps = navigator.getGamepads ? navigator.getGamepads() : []; I.pad = null;
      for (const p of ps) if (p && p.connected && p.mapping === 'standard') { I.pad = p; break; }
      if (I.pad) for (const i in PAD) { const b = I.pad.buttons[i]?.pressed, a = PAD[i]; if (b && !padHeld.has(a)) { padHeld.add(a); press.add(a); I.usingPad = true; } else if (!b && padHeld.has(a)) { padHeld.delete(a); rel.add(a); } }
    },
    endFrame() { press.clear(); rel.clear(); const m = I.mouse; m.dx = m.dy = m.wheel = 0; m.leftPressed = m.rightPressed = false; },
  };
  const set = (code, on, rep) => { const as = MAP[code]; if (!as) return; for (const a of as) { if (on) { if (!rep) press.add(a); held.set(a, 1); } else { held.set(a, 0); rel.add(a); } } };
  addEventListener('keydown', (e) => { if (typing()) { if (e.code === 'Escape') press.add('pause'); return; } I.usingPad = false; if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'F1', 'F3'].includes(e.code) || (e.ctrlKey && 'SDR'.includes(e.key.toUpperCase()))) e.preventDefault(); set(e.code, true, e.repeat); });
  addEventListener('keyup', (e) => set(e.code, false));
  addEventListener('blur', () => { held.clear(); I.mouse.left = I.mouse.right = false; });
  document.addEventListener('pointerlockchange', () => { I.captured = document.pointerLockElement === canvas; });
  canvas.addEventListener('mousedown', (e) => { I.requestCapture(); if (e.button === 0) I.mouse.left = I.mouse.leftPressed = true; if (e.button === 2) I.mouse.right = I.mouse.rightPressed = true; });
  addEventListener('mouseup', (e) => { if (e.button === 0) I.mouse.left = false; if (e.button === 2) I.mouse.right = false; });
  addEventListener('mousemove', (e) => { I.mouse.x = e.clientX; I.mouse.y = e.clientY; if (I.captured || I.mouse.left || I.mouse.right) { I.mouse.dx += e.movementX; I.mouse.dy += e.movementY; } });
  canvas.addEventListener('wheel', (e) => { I.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  return I;
}

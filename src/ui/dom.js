// DOM helpers, hand-drawn icons and stencil glyphs.
export function h(tag, attrs, ...kids) {
  const [t, ...cls] = tag.split('.'), e = document.createElement(t || 'div'); if (cls.length) e.className = cls.join(' ');
  if (attrs) for (const k in attrs) { const v = attrs[k]; if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v); else if (k in e && k !== 'list' && k !== 'type' && typeof v !== 'string') e[k] = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const c of kids.flat(9)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function refs(root) { const o = {}; for (const e of root.querySelectorAll('[data-r]')) o[e.dataset.r] = e; return o; }
export const txt = (e, s) => { if (e._t !== s) { e._t = s; e.textContent = s; } };
export const cls = (e, c, on) => { const k = '_c' + c; if (e[k] !== !!on) { e[k] = !!on; e.classList.toggle(c, !!on); } };
export const sty = (e, k, v) => { const c = '_s' + k; if (e[c] !== v) { e[c] = v; e.style.setProperty(k, v); } };
export const vis = (e, on) => { if (e._v !== !!on) { e._v = !!on; e.hidden = !on; } };
export const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

const I = {
  camera: '<path d="M2.5 7.5h4l1.6-2.6h7.8l1.6 2.6h4v12h-19z"/><circle cx="12" cy="13.2" r="4.1"/><path d="M5 10.4h1.6"/>',
  scanner: '<path d="M4 9.5a8.6 8.6 0 0 1 12-5.4L7.4 16.6A8.6 8.6 0 0 1 4 9.5z"/><path d="M11.7 10.3l4 2.6M9.4 17l1.6 4.5h5"/><path d="M19 8.5a6 6 0 0 1-.6 6M21.4 6.8a9.6 9.6 0 0 1-1 9.6"/>',
  probe: '<path d="M2.5 18.5h19l-5-6.5h-9z"/><path d="M9 12V9.6h6V12M12 9.6V3M9.4 5h5.2"/><path d="M6 21.5h12"/>',
  drone: '<path d="M9 10.2h6v4.6H9zM9 11L5 7.2M15 11l4-3.8M9 14l-4 3.8M15 14l4 3.8"/><path d="M2 6.6h6M16 6.6h6M2 18.4h6M16 18.4h6"/>',
  binoculars: '<path d="M3 18.5V12l2.2-6.5h4V18.5zM21 18.5V12l-2.2-6.5h-4V18.5z"/><path d="M9.2 9.5h5.6v4H9.2z"/>',
  meter: '<path d="M8 11.5h8v10H8z"/><circle cx="12" cy="6.4" r="3.8"/><path d="M12 2.6v7.6M8.2 6.4h7.6M10 15h4"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.6"/><path d="M12 12l6.4-6.4M12 3v2M21 12h-2"/>',
  map: '<path d="M3 6l6-2.4 6 2.4 6-2.4v14.4L15 20.4 9 18l-6 2.4zM9 3.6V18M15 6v14.4"/>',
  missions: '<path d="M5 3h11l3 3v15H5z"/><path d="M8.4 9h7.2M8.4 12.6h7.2M8.4 16.2h4.4"/>',
  garage: '<path d="M3 20.5V9l9-5.5L21 9v11.5M6.5 20.5v-8h11v8M6.5 15.2h11M6.5 18h11"/>',
  album: '<path d="M3 5h18v14H3z"/><path d="M3 16l5-5 4 4 3-2.6 6 5"/><circle cx="16" cy="9" r="1.6"/>',
  settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h7M15 17h5"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="13" cy="17" r="2"/>',
  tornado: '<path d="M3 4h18M5 8h13.5M8 12h9M10 16h5M11.4 20h2"/>', funnel: '<path d="M3 4h18l-6.4 8-1.2 8.5h-1.8L10 12z"/>',
  supercell: '<path d="M3.5 13a4 4 0 0 1 3-6.2A5.6 5.6 0 0 1 17 6.4 4.4 4.4 0 0 1 20.5 13z"/><path d="M8 17l-2 4M13 17l-2 4M18 17l-2 4"/>',
  hail: '<circle cx="7" cy="6" r="2.4"/><circle cx="16.5" cy="8.5" r="3.4"/><circle cx="8.5" cy="16" r="3.8"/><circle cx="18" cy="18.5" r="2"/>', bolt: '<path d="M13.5 2.5L5.5 14h5l-1.5 7.5L18 10h-5.4z"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7a2.4 2.4 0 1 1-2.4 2.4"/>', fuel: '<path d="M4 20.5V4h9v16.5M3 20.5h11M6 7h5v4H6zM13 10h3v7a1.8 1.8 0 0 0 3.6 0V8l-3-3"/>', wrench: '<path d="M20.5 6.4a5 5 0 0 1-6.6 5.7L6 20a2.2 2.2 0 0 1-3-3l7.9-7.9a5 5 0 0 1 5.7-6.6L13.5 5.600l.6 3.300 3.300.6z"/>',
  play: '<path d="M7 4l13 8-13 8z"/>', users: '<circle cx="8.5" cy="8" r="3.4"/><path d="M2 20c.4-4 3-6 6.500-6s6.100 2 6.500 6"/><circle cx="17" cy="9.500" r="2.600"/><path d="M17.500 14.500c2.600.2 4.200 1.900 4.500 5"/>', link: '<path d="M10 14a4.500 4.500 0 0 0 6.400 0l3-3A4.500 4.500 0 0 0 13 4.600l-1.500 1.500M14 10a4.500 4.500 0 0 0-6.400 0l-3 3A4.500 4.500 0 0 0 11 19.400l1.500-1.500"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.200 9.500a2.900 2.900 0 1 1 4.300 2.500c-1 .600-1.500 1.100-1.500 2.400M12 17.200v.6"/>', back: '<path d="M20 12H5M11 5.500L4.500 12l6.500 6.500"/>', close: '<path d="M5 5l14 14M19 5L5 19"/>', check: '<path d="M4 12.500l5.500 5.500L20 6.500"/>', lock: '<path d="M5.500 10.500h13v10h-13zM8.500 10.500V7a3.500 3.500 0 0 1 7 0v3.500"/>', star: '<path d="M12 2.800l2.800 6.200 6.700.700-5 4.600 1.400 6.700L12 17.600 6.100 21l1.400-6.700-5-4.600 6.700-.700z"/>',
  flag: '<path d="M5.500 21.500V3M5.500 4h13l-3 4.500 3 4.500h-13"/>', person: '<circle cx="12" cy="6.500" r="3.500"/><path d="M5.500 21c0-5.500 2.500-8.500 6.500-8.500s6.500 3 6.500 8.500"/>', siren: '<path d="M6 18v-5a6 6 0 0 1 12 0v5M4 21h16v-3H4zM12 3V1.500M4.500 6L3 4.800M19.500 6L21 4.800"/>', radio: '<path d="M4 9h16v11.500H4zM7 9l9-6.500"/><circle cx="9" cy="14.800" r="2.800"/><path d="M15 12.500h2.500M15 16h2.500"/>', anchor: '<circle cx="12" cy="5" r="2.200"/><path d="M12 7.200V21M5 13.500c0 4.500 3 7.500 7 7.500s7-3 7-7.500M8.500 10.500h7"/>', eye: '<path d="M2 12c3-5 6.300-7 10-7s7 2 10 7c-3 5-6.300 7-10 7s-7-2-10-7z"/><circle cx="12" cy="12" r="3"/>', skull: '<path d="M6 17v-3.500A7.500 7.500 0 0 1 4.500 9c0-4 3.300-6.500 7.500-6.500S19.500 5 19.500 9a7.500 7.500 0 0 1-1.500 4.500V17H6zM9 17v4M12 17v4M15 17v4"/><circle cx="9" cy="10" r="1.600"/><circle cx="15" cy="10" r="1.600"/>', home: '<path d="M3.500 11L12 4l8.500 7M6 9.500v11h12v-11"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', mic: '<path d="M9 4h6v9H9zM6 11.500a6 6 0 0 0 12 0M12 17.500V21"/>', car: '<path d="M2.500 16.500v-4l3-1 3-4.500h7l3.500 4.500 2.500 1v4z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>', money: '<path d="M3 6h18v12H3z"/><circle cx="12" cy="12" r="3"/>', thrust: '<path d="M12 20V6M6 12l6-6 6 6"/>',
};
I.binocular = I.binoculars; I.anemometer = I.meter;
export const icon = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="miter" stroke-linecap="butt" aria-hidden="true">${I[n] || I.star}</svg>`;
export const ic = (n, c) => h('span.icw' + (c ? '.' + c : ''), { html: icon(n) });
export const iconPath = (n) => I[n];

// ---- stencil glyphs (36 x 60, stroke 9)
const S = {
  0: 'M15 4.5H10L4.500 10V50L10 55.500H15M21 4.500H26L31.500 10V50L26 55.500H21', 1: 'M20 0V60M5 8H12.500', 2: 'M4.500 19V10L10 4.500H26L31.500 10V22L26.500 28M22 32.500L4.500 47.500V55.500H36', 3: 'M4.500 16V10L10 4.500H26L31.500 10V23L27 27.500M11 30H21M27 32.500L31.500 37V50L26 55.500H10L4.500 50V44', 4: 'M25 0V60M17.500 0L4.500 36V41H18.500M31.500 41H37', 5: 'M33 4.500H4.500V23M6 28H26L31.500 33.500V50L26 55.500H10L4.500 50V44', 6: 'M29 4.500H10L4.500 10V50L10 55.500H15M21 55.500H26L31.500 50V33L26 27.500H11.500', 7: 'M2 4.500H31.500V12L26 27M23.500 33.500L14.500 60', 8: 'M15 4.500H10L4.500 10V21.500L9 26.500M21 4.500H26L31.500 10V21.500L27 26.500M9 33.500L4.500 38.500V50L10 55.500H15M21 55.500H26L31.500 50V38.500L27 33.500M12.500 30H23.500', 9: 'M7 55.500H26L31.500 50V10L26 4.500H21M15 4.500H10L4.500 10V27L10 32.500H24.500',
  S: 'M31.500 17V10L26 4.500H10L4.500 10V22L9.500 27H15.500M20.500 32H26.500L31.500 37V50L26 55.500H10L4.500 50V43', T: 'M0 4.500H36M18 13.500V60', R: 'M4.500 0V60M12 4.500H26L31.500 10V24L26 30H12M18.500 37.500L31 60', H: 'M4.500 0V60M31.500 0V60M12 30H24', U: 'M4.500 0V50L10 55.500H15M21 55.500H26L31.500 50V0', N: 'M4.500 0V60M31.500 0V60M10.500 3L25.500 57', E: 'M4.500 0V60M12 4.500H33M12 30H28M12 55.500H33', F: 'M4.500 0V60M12 4.500H33M12 30H28', M: ['M4.500 0V60M43.500 0V60M11.500 2L24 33L36.500 2', 48], P: 'M4.500 0V60M12 4.500H26L31.500 10V26L26 32H12', N_: '', '-': 'M8 30H28', '.': ['M4.500 51V60', 9], R_: '', D: 'M4.500 0V60M12 4.500H25L31.500 11V49L25 55.500H12', A: 'M2 60L14 4M34 60L22 4M11 42H25', K: 'M4.500 0V60M29 0L13.500 28M14 35L31 60', W: ['M4.500 0L13 57M21 57L26 16M30 16L35 57M43 57L51.500 0', 56], L: 'M4.500 0V60M12 55.500H33', G: 'M31.500 17V10L26 4.500H10L4.500 10V50L10 55.500H15M21 55.500H26L31.500 50V33H21', C: 'M31.500 17V10L26 4.500H10L4.500 10V50L10 55.500H26L31.500 50V43', B: 'M4.500 0V60M12 4.500H25L30 9.500V22L26 27M12 30H22M26 33L31.500 38V50L26 55.500H12', Y: 'M3 0L15 28M33 0L21 28M18 34V60', V: 'M3 0L15 56M33 0L21 56', I: ['M4.500 0V60', 9], O: '',
}; S.O = S[0];
const g = (c) => { const s = S[c] ?? S[0]; return Array.isArray(s) ? s : [s, 36]; };
export function stencil(text, o = {}) {
  let x = 0, d = ''; const sp = o.gap ?? 9;
  for (const ch of String(text).toUpperCase()) { if (ch === ' ') { x += 22; continue; } const [p, w] = g(ch); d += `<path d="${p}" transform="translate(${x} 0)"/>`; x += w + sp; }
  return `<svg class="stc ${o.cls || ''}" viewBox="0 0 ${Math.max(1, x - sp)} 60" fill="none" stroke="currentColor" stroke-width="${o.sw || 9}" stroke-linejoin="miter" aria-hidden="true">${d}</svg>`;
}
// dynamic stencil number: fixed digit slots, right aligned
export class StencilNum {
  constructor(n = 3, pad = false) { this.el = h('span.stn'); this.n = n; this.pad = pad; this.slots = []; for (let i = 0; i < n; i++) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 36 60'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '9'); const p = document.createElementNS(s.namespaceURI, 'path'); s.append(p); this.el.append(s); this.slots.push([s, p, null]); } }
  set(v) { const t = String(Math.max(0, Math.round(v))).slice(-this.n).padStart(this.n, this.pad ? '0' : ' '); for (let i = 0; i < this.n; i++) { const s = this.slots[i]; if (s[2] === t[i]) continue; s[2] = t[i]; const b = t[i] === ' '; s[1].setAttribute('d', b ? S[0] : g(t[i])[0]); s[0].classList.toggle('off', b); } }
}
// wind barb (station-model notation), pointing into the wind. kt, from-direction radians
export function barbPath(kt) {
  kt = Math.round(kt / 5) * 5; let d = '', y = 0; const L = 30; if (kt < 5) return { d: '', calm: true }; d += `M0 0V-${L}`; y = -L; let fl = Math.floor(kt / 50), f = Math.floor((kt % 50) / 10), hf = (kt % 10) >= 5 ? 1 : 0; let fill = '';
  while (fl--) { fill += `M0 ${y}L11 ${y - 1}L0 ${y + 6}Z`; y += 7.500; } while (f--) { d += `M0 ${y}L11 ${y - 4}`; y += 4.500; } if (hf) { if (y === -L) y += 4.500; d += `M0 ${y}L5.500 ${y - 2}`; } return { d, fill };
}
// ---- key glyphs
const KEYNAME = { throttle: 'W', forward: 'W', brake: 'S', back: 'S', left: 'A', right: 'D', handbrake: 'Space', jump: 'Space', enter: 'E', camera: 'C', lights: 'H', use: 'F', map: 'M', radar: 'Tab', missions: 'J', garage: 'G', recover: 'R', anchor: 'X', horn: 'B', chat: 'T', pause: 'Esc', sprint: 'Shift', crouch: 'Ctrl', album: 'P', flashlight: 'L', toolPrev: 'Q', lookBack: 'V', zoom: 'Z', nextTarget: 'N', help: 'F1', tool1: '1', tool2: '2', tool3: '3', tool4: '4', tool5: '5', tool6: '6', tool0: '0', confirm: 'Enter', report: 'Tab' };
const PADNAME = { handbrake: 'A', jump: 'A', recover: 'B', use: 'X', enter: 'Y', toolPrev: 'LB', toolNext: 'RB', map: 'View', pause: 'Menu', sprint: 'LS', camera: 'RS', lights: 'D-Up', anchor: 'D-Dn', radar: 'D-L', missions: 'D-R', throttle: 'RT', brake: 'LT', left: 'L-Stick', right: 'L-Stick', 'mouse:left': 'X', 'mouse:right': 'LT', confirm: 'A' };
const MOUSE = { 'mouse:left': '<path d="M12 2.500v8H5.500V9c0-3.700 2.900-6.500 6.500-6.500z" fill="currentColor"/>', 'mouse:right': '<path d="M12 2.500v8h6.500V9c0-3.700-2.900-6.500-6.500-6.500z" fill="currentColor"/>', 'mouse:wheel': '<path d="M12 5.500v4.500" stroke-width="3"/>' };
export function keyGlyph(a, pad) {
  if (pad && PADNAME[a]) return `<kbd class="pad">${PADNAME[a]}</kbd>`; if (MOUSE[a]) return `<kbd class="ms"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.600"><path d="M5.500 9a6.500 6.500 0 0 1 13 0v6a6.500 6.500 0 0 1-13 0z"/>${MOUSE[a]}</svg></kbd>`;
  return `<kbd>${KEYNAME[a] || a}</kbd>`;
}
export const keyName = (a) => KEYNAME[a] || a;
// 8 pointed graduation ring etc.
export const stars = (n) => `<span class="stars">${[0, 1, 2, 3, 4].map((i) => `<svg viewBox="0 0 24 24" class="${i < n ? 'on' : ''}"><path d="M12 2.800l2.800 6.200 6.700.700-5 4.600 1.400 6.700L12 17.600 6.100 21l1.400-6.700-5-4.600 6.700-.700z"/></svg>`).join('')}</span>`;
export function fmtDist(m, units) {
  if (!Number.isFinite(m)) return '--'; if (units === 'metric') return m < 950 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(m < 9950 ? 1 : 0) + ' km';
  const mi = m / 1609.344; return mi < 0.19 ? Math.round(m * 3.28084 / 50) * 50 + ' ft' : mi.toFixed(mi < 9.95 ? 1 : 0) + ' mi';
}
export const fmtSpeed = (ms, u) => (u === 'metric' ? Math.round(ms * 3.6) + ' km/h' : Math.round(ms * 2.23694) + ' mph');
export const speedVal = (ms, u) => ms * (u === 'metric' ? 3.6 : 2.23694);
export const fmtTemp = (c, u) => (u === 'metric' ? Math.round(c) : Math.round(c * 1.8 + 32)) + '°';
export const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const clock = (hr) => { const H = Math.floor(hr), M = Math.floor((hr - H) * 60); return `${((H + 11) % 12) + 1}:${String(M).padStart(2, '0')} ${H < 12 ? 'AM' : 'PM'}`; };
export function fitCanvas(c, dprMax = 2) { const r = c.getBoundingClientRect(), d = Math.min(dprMax, window.devicePixelRatio || 1), w = Math.max(1, Math.round(r.width * d)), hh = Math.max(1, Math.round(r.height * d)); if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; } return d; }
export const FONT = 'Bahnschrift, "DIN Alternate", "Roboto Condensed", "Arial Narrow", sans-serif';

// Dark cartographic map of the whole world: hillshade, biome tint, water, state borders, rivers, roads, labels.
import { BOUNDS } from '../core/geo.js';
import { GX, GZ, OX, OZ, CELL } from './sampler.js';
export function drawMap(S, W = 2048) {
  const D = S.data, H = Math.round(W * (BOUNDS.maxZ - BOUNDS.minZ) / (BOUNDS.maxX - BOUNDS.minX)), c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const sx = W / (BOUNDS.maxX - BOUNDS.minX), X = (x) => (x - BOUNDS.minX) * sx, Z = (z) => (z - BOUNDS.minZ) * sx;
  // raster base at macro resolution, then upscale smoothly
  const bw = 1024, bh = Math.round(bw * H / W), base = document.createElement('canvas'); base.width = bw; base.height = bh; const bg = base.getContext('2d'), img = bg.createImageData(bw, bh), d = img.data;
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const x = BOUNDS.minX + (i + .5) / bw * (BOUNDS.maxX - BOUNDS.minX), z = BOUNDS.minZ + (j + .5) / bh * (BOUNDS.maxZ - BOUNDS.minZ), h = S.macroAt(x, z), hx = S.macroAt(x + 120, z) - S.macroAt(x - 120, z), hz = S.macroAt(x, z + 120) - S.macroAt(x, z - 120);
    const k = (j * bw + i) * 4; let r, gg, b;
    const lake = (() => { const u = Math.round((x - OX) / CELL), v = Math.round((z - OZ) / CELL); if (u < 0 || v < 0 || u >= GX || v >= GZ) return false; const li = D.lakeI[v * GX + u]; return li !== 255 && h < D.lakes[li].level + .3; })();
    if (h < .2 && S.coastAt(x, z) < 200 || lake) { const dep = Math.min(1, -h / 40); r = 14 - dep * 6; gg = 26 - dep * 8; b = 36 - dep * 8; }
    else { const B = S.bio(x, z), sh = Math.max(-1, Math.min(1, (-hx * .7 - hz * .7) / 30)), e = Math.min(1, h / 900); r = 30 + B.arid * 16 + B.red * 8 - B.forest * 6 + e * 26; gg = 34 + (1 - B.arid) * 6 + B.forest * 4 + e * 24; b = 34 + e * 26 - B.arid * 4; const f = 1 + sh * .55; r *= f; gg *= f; b *= f; if (B.urban > .4) { r += 18; gg += 16; b += 12; } const us = D.usMask[Math.round((z - OZ) / CELL) * GX + Math.round((x - OX) / CELL)]; if (!us) { r *= .7; gg *= .7; b *= .72; } }
    d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = 255;
  }
  bg.putImageData(img, 0, 0); g.imageSmoothingQuality = 'high'; g.drawImage(base, 0, 0, W, H);
  // state borders from raster edges
  g.fillStyle = 'rgba(170,180,190,.38)'; const st = D.stateGrid, cs = CELL * sx;
  for (let j = 1; j < GZ; j++) for (let i = 1; i < GX; i++) { const k = j * GX + i, s0 = st[k]; if (!s0) continue; if (st[k - 1] && st[k - 1] !== s0) g.fillRect(X(OX + (i - .5) * CELL) - .6, Z(OZ + (j - .5) * CELL), 1.2, cs); if (st[k - GX] && st[k - GX] !== s0) g.fillRect(X(OX + (i - .5) * CELL), Z(OZ + (j - .5) * CELL) - .6, cs, 1.2); }
  // coast line glow
  g.strokeStyle = 'rgba(120,170,190,.25)'; g.lineWidth = 1;
  // rivers
  g.strokeStyle = 'rgba(70,120,150,.85)'; g.lineCap = g.lineJoin = 'round';
  for (const r of D.rivers) { g.lineWidth = Math.max(.8, r.width / 45); g.beginPath(); for (let i = 0; i < r.pts.length; i += 4) i ? g.lineTo(X(r.pts[i]), Z(r.pts[i + 1])) : g.moveTo(X(r.pts[i]), Z(r.pts[i + 1])); g.stroke(); }
  // roads
  for (const k of [1, 0]) { for (const r of D.roads) { if (r.k !== k) continue; g.strokeStyle = k ? 'rgba(150,140,120,.55)' : 'rgba(230,170,70,.9)'; g.lineWidth = k ? .8 : 1.6; g.beginPath(); for (let i = 0; i < r.pts.length; i += 6) i ? g.lineTo(X(r.pts[i]), Z(r.pts[i + 1])) : g.moveTo(X(r.pts[i]), Z(r.pts[i + 1])); g.lineTo(X(r.pts[r.pts.length - 2]), Z(r.pts[r.pts.length - 1])); g.stroke(); } }
  // cities + labels without overlap (biggest first)
  const boxes = [], hit = (a, q) => boxes.some((b) => b[4] !== q && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]);
  const cs2 = [...D.cities].filter((q) => q.x > BOUNDS.minX && q.x < BOUNDS.maxX && q.z > BOUNDS.minZ && q.z < BOUNDS.maxZ).sort((a, b) => b.pop - a.pop);
  for (const q of cs2) { const x = X(q.x), y = Z(q.z), big = !q.town, rad = big ? Math.min(6, Math.max(2.5, q.radius * sx * .6)) : 1.8; q._r = rad; g.fillStyle = big ? 'rgba(240,220,170,.95)' : 'rgba(200,195,180,.8)'; g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill(); boxes.push([x - rad, y - rad, x + rad, y + rad, q]); }
  for (const q of cs2) { const x = X(q.x), y = Z(q.z), big = !q.town, fs = big ? (q.pop > 1.5e6 ? 15 : 13) : 10; g.font = `${big ? 600 : 400} ${fs}px "Segoe UI",Arial,sans-serif`; const w = g.measureText(q.name).width;
    const rr = (q._r || 2) + 3; for (const [ox, oy, al] of [[rr, 4, 'left'], [-rr, 4, 'right'], [-w / 2, -rr - 2, 'left'], [-w / 2, rr + fs, 'left']]) { const bx = al === 'left' ? x + ox : x + ox - w, box = [bx - 2, y + oy - fs + 2, bx + w + 2, y + oy + 3]; if (hit(box, q)) continue; boxes.push(box); g.textAlign = 'left'; g.lineWidth = 3; g.strokeStyle = 'rgba(8,12,16,.85)'; g.strokeText(q.name, bx, y + oy); g.fillStyle = big ? '#f0e6cc' : '#b9b5a8'; g.fillText(q.name, bx, y + oy); break; } }
  return c;
}

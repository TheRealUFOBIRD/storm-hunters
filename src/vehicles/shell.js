// Parametric car shells. Lower body: plan outline x vertical profile, capped by a crowned hood/deck height field.
// Greenhouse: two rounded plan rings (belt, roof) lofted with tumblehome and closed by a crowned roof. Author space: x right, y up, f forward (z=-f).
import { Surf, Outline, curve1 } from './mesh.js';
import { clamp, lerp, smoothstep } from '../core/math.js';

// smooth a polyline of [a,b,c,...] with per-knot sigma (index = raw knots) -> rows
function loftProfile(raw, sig, rowsPer) {
  const K = raw.length, L = [0]; for (let k = 1; k < K; k++) L[k] = L[k - 1] + Math.hypot(raw[k][0] - raw[k - 1][0], raw[k][1] - raw[k - 1][1], raw[k][2] - raw[k - 1][2]);
  const T = L[K - 1] || 1e-6, M = 150, fine = [], sg = []; let j = 0;
  for (let i = 0; i < M; i++) { const t = T * i / (M - 1); while (j < K - 2 && L[j + 1] < t) j++; const u = clamp((t - L[j]) / Math.max(1e-9, L[j + 1] - L[j])); fine.push([lerp(raw[j][0], raw[j + 1][0], u), lerp(raw[j][1], raw[j + 1][1], u), lerp(raw[j][2], raw[j + 1][2], u)]); sg.push(lerp(sig[j], sig[j + 1], u)); }
  const h = T / (M - 1), sm = fine.map((p, i) => {
    let w = Math.round(sg[i] / h); w = Math.min(w, i, M - 1 - i + (sig.capOpen ? 99 : 0)); if (w < 1) return p; let x = 0, y = 0, z = 0, s = 0;
    for (let k = -w; k <= w; k++) { const q = 1 - Math.abs(k) / (w + 1), m = i + k, o = fine[m >= M ? M - 1 - (m - M + 1) : m]; x += (m >= M ? -o[0] : o[0]) * q; y += o[1] * q; z += o[2] * q; s += q; } return [x / s, y / s, z / s];
  });
  const out = [], at = (t) => { const g = clamp(t / T) * (M - 1), i = Math.min(M - 2, Math.floor(g)), u = g - i; return [lerp(sm[i][0], sm[i + 1][0], u), lerp(sm[i][1], sm[i + 1][1], u), lerp(sm[i][2], sm[i + 1][2], u)]; };
  for (let k = 0; k < K - 1; k++) { const n = rowsPer[k]; for (let r = 0; r < n; r++) out.push(at(lerp(L[k], L[k + 1], r / n))); } out.push(at(T)); return out;
}
const weights = (nf) => { const F = smoothstep(0.3, 0.85, nf), R = smoothstep(0.3, 0.85, -nf); return [F, 1 - F - R, R]; };

export function buildLower(C, q = 1) {
  const O = new Outline(C.plan, 420, C.planSmooth ?? 0.05), yc = curve1(C.yc), ysh = curve1(C.ySh), yb = curve1(C.yBot), K = C.prof.S.length, P = C.crownP ?? 2.2;
  const ringIn = (S) => { const n = O.normal(S), w = weights(n[0]); return { n, w, inset: w[0] * C.prof.F[K - 1][1] + w[1] * C.prof.S[K - 1][1] + w[2] * C.prof.R[K - 1][1] }; };
  const ringPts = []; for (let i = 0; i <= 160; i++) { const S = O.len * i / 160, r = ringIn(S), o = O.at(S, []); ringPts.push([o[0] - r.n[0] * r.inset, o[1] - r.n[1] * r.inset]); }
  const xsT = []; for (let i = 0; i <= 80; i++) { const f = lerp(ringPts[160][0], ringPts[0][0], i / 80); let m = 0; for (let k = 1; k < ringPts.length; k++) { const a = ringPts[k - 1], b = ringPts[k]; if ((a[0] - f) * (b[0] - f) <= 0) m = Math.max(m, a[1], b[1]); } xsT.push(m); }
  const f0 = ringPts[160][0], f1 = ringPts[0][0];
  const xs = (ff) => { const f = clamp(ff, f0 + (C.xsR ?? 0.5), f1 - (C.xsF ?? 0.6)), g = clamp((f - f0) / (f1 - f0)) * 80, i = Math.min(79, Math.floor(g)); return lerp(xsT[i], xsT[i + 1], g - i); };
  const top = (f, x) => { const a = ysh(f), c = yc(f), X = Math.max(0.25, xs(f)); let y = a + (c - a) * (1 - Math.pow(Math.min(1, Math.abs(x) / X), P)); if (C.topMod) y += C.topMod(f, Math.abs(x), X); return y; };
  const capU = C.capU || [0.05, 0.14, 0.3, 0.55, 0.8, 1], spF = C.spine ? C.spine[0] : f1 - 0.35, spR = C.spine ? C.spine[1] : f0 + 0.3;
  const rowsW = (C.rows || new Array(K - 1).fill(2)).map((r) => Math.max(1, Math.round(r * q))), rowsC = capU.map((_, i) => (i === 0 ? 1 : q > 0.8 ? 2 : 1)), nWall = rowsW.reduce((a, b) => a + b, 0);
  const column = (S) => {
    const o = O.at(S, []), { n, w } = ringIn(S), raw = [], sig = []; let rp;
    const rf = o[0] - n[0] * ringIn(S).inset, rx = Math.max(0, o[1] - n[1] * ringIn(S).inset), yT = top(rf, rx), yB = yb(o[0]);
    for (let k = 0; k < K; k++) {
      const a = C.prof.F[k], b = C.prof.S[k], c = C.prof.R[k]; const t = w[0] * a[0] + w[1] * b[0] + w[2] * c[0]; let ins = w[0] * a[1] + w[1] * b[1] + w[2] * c[1]; const s = w[0] * (a[2] ?? 0.03) + w[1] * (b[2] ?? 0.03) + w[2] * (c[2] ?? 0.03);
      let y = lerp(yB, yT, t); if (C.disp) ins -= C.disp(o[0], y, w, k / (K - 1));
      for (const A of C.arches || []) { const d = Math.hypot(o[0] - A.f, y - A.y) - A.r; ins -= (A.flare || 0) * w[1] * Math.exp(-(Math.max(0, d) ** 2) / (A.fw || 0.02)) * (1 - (k === K - 1 ? 0.75 : 0)); }
      const f = o[0] - n[0] * ins, x = Math.max(0, o[1] - n[1] * ins); raw.push([x, y, f]); sig.push(s); rp = [x, y, f];
    }
    const sf = clamp(rf, spR, spF); for (const u of capU) { const f = lerp(rp[2], sf, u), x = lerp(rp[0], 0, u); const yy = top(f, x); raw.push([x, u < 0.1 ? lerp(rp[1], yy, 0.8) : yy, f]); sig.push(C.capSig ?? 0.05); }
    return loftProfile(raw, sig, [...rowsW, ...rowsC]);
  };
  // stations: denser at corners and around arches
  const st = []; { const nS = Math.round((C.stations || 74) * q), dens = (S) => { const a = O.at(S, []), n = O.normal(S); let d = 1 + 2.2 * (1 - Math.max(Math.abs(n[0]), Math.abs(n[1]))) * 3; for (const A of C.arches || []) if (Math.abs(a[0] - A.f) < A.r + 0.12 && Math.abs(n[1]) > 0.5) d += 0.8; return d; }; const cum = [0], N = 300; for (let i = 1; i <= N; i++) cum[i] = cum[i - 1] + dens(O.len * (i - 0.5) / N); let j = 0; for (let i = 0; i <= nS; i++) { const t = cum[N] * i / nS; while (j < N - 1 && cum[j + 1] < t) j++; st.push(O.len * (j + (t - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j])) / N); } st[0] = 0; st[nS] = O.len; }
  const cols = st.map(column), nv = cols[0].length;
  const full = Surf.grid(cols.length, nv, (u, v) => [cols[u][v][0], cols[u][v][1], -cols[u][v][2], st[u], cols[u][v][1]], true).weldMirrorNormals();
  const wall = new Surf(), cap = new Surf();
  const sub = (S, r0, r1, isCap) => { for (let u = 0; u < cols.length; u++) for (let v = r0; v <= r1; v++) { const k = u * nv + v; S.v(full.p[k * 3], full.p[k * 3 + 1], full.p[k * 3 + 2], full.n[k * 3], full.n[k * 3 + 1], full.n[k * 3 + 2], isCap ? cols[u][v][2] : st[u], isCap ? cols[u][v][0] : cols[u][v][1]); } const m = r1 - r0 + 1; for (let u = 0; u < cols.length - 1; u++) for (let v = 0; v < m - 1; v++) { const a = u * m + v, b = a + m; S.q(a, a + 1, b + 1, b); } };
  sub(wall, 0, nWall, false); sub(cap, nWall, nv - 1, true);
  // bottom closing plate
  const bottom = Surf.grid(cols.length, 2, (u, v) => (v ? [0, cols[u][0][1], -clamp(cols[u][0][2], spR, spF), 0, 0] : [cols[u][0][0], cols[u][0][1], -cols[u][0][2], 0, 0]));
  // query: point on wall by (S,y)
  const wallAt = (S, y, off = 0) => {
    const sg = S < 0 ? -1 : 1; S = Math.abs(S); let u = 0; while (u < st.length - 2 && st[u + 1] < S) u++; const t = clamp((S - st[u]) / Math.max(1e-9, st[u + 1] - st[u]));
    const pick = (c) => { for (let v = 0; v < nWall; v++) if (cols[c][v + 1][1] >= y || v === nWall - 1) { const k = clamp((y - cols[c][v][1]) / Math.max(1e-6, cols[c][v + 1][1] - cols[c][v][1])), a = (c * nv + v) * 3, b = a + 3; return [0, 1, 2].map((i) => lerp(full.p[a + i], full.p[b + i], k)).concat([0, 1, 2].map((i) => lerp(full.n[a + i], full.n[b + i], k))); } };
    const A = pick(u), B = pick(u + 1), o = A.map((v, i) => lerp(v, B[i], t)); const l = Math.hypot(o[3], o[4], o[5]) || 1; for (let i = 3; i < 6; i++) o[i] /= l; for (let i = 0; i < 3; i++) o[i] += o[i + 3] * off; o[0] *= sg; o[3] *= sg; return o;
  };
  return { O, wall, cap, bottom, top, xs, wallAt, sOf: (f) => O.sOfF(f), sideX: (f, y) => wallAt(O.sOfF(f), y)[0], f0, f1, ringPts, yBot: yb };
}

// ---------- greenhouse ----------
// H: { base:{fc,f0,x0,f1,x1,rc}, roof:{...same}, bowB,bowR, yBase(f,x), yr:[[f,y]], crown, bulge, edge, smooth, spine:[f,f], nF,nS,nR }
function ring(b, nF, nS, nR, bow, sm) {
  let p = []; for (let i = 0; i <= nF; i++) { const k = i / nF; p.push([lerp(b.fc, b.f0, k * k), b.x0 * k]); }
  for (let i = 1; i <= nS; i++) { const k = i / nS; p.push([lerp(b.f0, b.f1, k), lerp(b.x0, b.x1, k) + bow * 4 * k * (1 - k)]); }
  for (let i = 1; i <= nR; i++) { const k = 1 - i / nR; p.push([lerp(b.rc, b.f1, k * k), b.x1 * k]); }
  const n = p.length, g = (i) => (i < 0 ? [p[-i][0], -p[-i][1]] : i >= n ? [p[2 * n - 2 - i][0], -p[2 * n - 2 - i][1]] : p[i]);
  for (let it = 0; it < 2; it++) { p = p.map((_, i) => { const w = sm; let a = 0, c = 0, s = 0; for (let k = -w; k <= w; k++) { const q = 1 - Math.abs(k) / (w + 1), v = g(i + k); a += v[0] * q; c += v[1] * q; s += q; } return [a / s, c / s]; }); p[0][1] = 0; p[n - 1][1] = 0; }
  return p;
}
export function buildHouse(H, q = 1) {
  const nF = H.nF || 36, nS = H.nS || 110, nR = H.nR || 36, sm = H.smooth ?? 5;
  const B = ring(H.base, nF, nS, nR, H.bowB ?? 0.03, sm), R = ring(H.roof, nF, nS, nR, H.bowR ?? 0.03, sm), n = B.length, yr = curve1(H.yr);
  const xrAt = (f) => Math.max(0.2, H.roof.x0); const roofY = (f, x) => yr(f) - (H.crown ?? 0.04) * Math.pow(Math.abs(x) / xrAt(f), 2.4);
  // mean ring arc-length as param a
  const A = [0]; for (let i = 1; i < n; i++) { const m = (k) => [(B[k][0] + R[k][0]) / 2, (B[k][1] + R[k][1]) / 2], a = m(i - 1), b = m(i); A[i] = A[i - 1] + Math.hypot(a[0] - b[0], a[1] - b[1]); }
  const aA = A[nF], aC = A[nF + nS], aE = A[n - 1];
  const capU = [0.04, 0.12, 0.35, 0.7, 1], W = 6, e = H.edge ?? 0.06, rw = new Array(W).fill(0).map((_, i) => Math.max(1, Math.round((i === W - 1 ? 3 : 2) * q))), rc = capU.map((_, i) => Math.max(1, Math.round((i < 2 ? 1 : 2) * q)));
  const spF = H.spine ? H.spine[0] : H.roof.f0 - 0.35, spR = H.spine ? H.spine[1] : H.roof.f1 + 0.3;
  const mid = Math.round(nF + nS / 2), Hs = Math.hypot(roofY(R[mid][0], R[mid][1]) - H.yBase(B[mid][0], B[mid][1]), B[mid][1] - R[mid][1]);
  const column = (i) => {
    const b = B[i], r = R[i], yB = H.yBase(b[0], b[1]), yR = roofY(r[0], r[1]), raw = [], sig = [];
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1); let nf = B[i1][1] - B[i0][1], nx = -(B[i1][0] - B[i0][0]); if (i === 0) { nf = 1; nx = 0; } if (i === n - 1) { nf = -1; nx = 0; } const l = Math.hypot(nf, nx) || 1; nf /= l; nx /= l;
    const bl = (H.bulge ?? 0.02) * (Math.abs(nx) > 0.6 ? 1 : H.bulgeF ?? 1);
    raw.push([b[1] - 0 * nx, yB - 0.035, b[0]]); sig.push(0);
    for (let k = 1; k <= W; k++) { const t = k / W, u = Math.sin(Math.PI * t) * bl; raw.push([Math.max(0, lerp(b[1], r[1], t) + nx * u), lerp(yB, yR, t), lerp(b[0], r[0], t) + nf * u]); sig.push(k === W ? e : k === W - 1 ? e * 0.6 : 0.02); }
    const sf = clamp(r[0], spR, spF); for (const u of capU) { const f = lerp(r[0], sf, u), x = lerp(r[1], 0, u); raw.push([x, roofY(f, x), f]); sig.push(u < 0.1 ? e : 0.06); }
    return loftProfile(raw, sig, [...rw, ...rc]);
  };
  const idx = [], step = q > 0.8 ? 3 : 7; for (let i = 0; i < n; i++) { const near = Math.min(Math.abs(i - nF), Math.abs(i - nF - nS)) <= sm + 4; if (i === 0 || i === n - 1 || (near && q > 0.5 ? i % 2 === 0 : i % step === 0)) idx.push(i); }
  const cols = idx.map(column), nv = cols[0].length, nW = rw.reduce((x, y) => x + y, 0);
  const s = Surf.grid(cols.length, nv, (u, v) => { const c = cols[u][v]; return [c[0], c[1], -c[2], 0, 0]; }, true).weldMirrorNormals();
  // params: a along ring, b: height fraction*Hs on wall, then Hs + dist
  for (let u = 0; u < cols.length; u++) { let d = 0; for (let v = 0; v < nv; v++) { const c = cols[u][v]; if (v > nW) { const p = cols[u][v - 1]; d += Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]); } s.a[(u * nv + v) * 2] = A[idx[u]]; s.a[(u * nv + v) * 2 + 1] = v <= nW ? Hs * rowFrac(v, rw) : Hs + d; } }
  const at = (a, b, off = 0) => { // position on glass/wall from params
    let u = 0; while (u < idx.length - 2 && A[idx[u + 1]] < a) u++; const t = clamp((a - A[idx[u]]) / Math.max(1e-9, A[idx[u + 1]] - A[idx[u]])); let v = 0; while (v < nW - 1 && s.a[(u * nv + v + 1) * 2 + 1] < b) v++; const b0 = s.a[(u * nv + v) * 2 + 1], b1 = s.a[(u * nv + v + 1) * 2 + 1], w = clamp((b - b0) / Math.max(1e-9, b1 - b0)); const g = (U, V, arr, c) => arr[(U * nv + V) * 3 + c];
    const o = []; for (const arr of [s.p, s.n]) for (let c = 0; c < 3; c++) o.push(lerp(lerp(g(u, v, arr, c), g(u, v + 1, arr, c), w), lerp(g(u + 1, v, arr, c), g(u + 1, v + 1, arr, c), w), t)); for (let c = 0; c < 3; c++) o[c] += o[c + 3] * off; return o;
  };
  return { s, aA, aC, aE, Hs, B, R, at, roofY, nF, nS, nR, slantF: Math.hypot(H.base.fc - H.roof.fc, roofY(H.roof.fc, 0) - H.yBase(H.base.fc, 0)) / Hs, slantR: Math.hypot(H.base.rc - H.roof.rc, roofY(H.roof.rc, 0) - H.yBase(H.base.rc, 0)) / Hs, basePoly: B };
}
const rowFrac = (v, rw) => { let k = 0, a = v; while (k < rw.length && a >= rw[k]) { a -= rw[k]; k++; } return Math.min(1, (k + a / (rw[k] || 1)) / rw.length); };

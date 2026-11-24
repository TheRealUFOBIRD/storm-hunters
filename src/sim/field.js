// Wind / weather fields. All functions are allocation free.
import { gnoise } from '../core/noise.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { axisAt, coreRadius } from './tornadoAxis.js';
import { RHO } from './tornado.js';

const SQ2 = 1.41421356;
/** S: {ctx, storms, tornadoes, env:{steerX,steerZ,sfcX,sfcZ}} */
export function createField(S) {
  const { ctx, storms, tornadoes, env } = S, ax = { x: 0, z: 0 };
  // --- coarse ground height cache (32 m cells, direct mapped) so windAt stays cheap
  const N = 1024, ck = new Float64Array(N).fill(NaN), cv = new Float32Array(N);
  const ground = (x, z) => {
    const w = ctx.world; if (!w) return 0;
    const ix = Math.round(x / 32), iz = Math.round(z / 32), key = ix * 8192 + iz, i = ((ix * 73 + iz * 151) & (N - 1));
    if (ck[i] !== key) { ck[i] = key; cv[i] = w.heightAt(ix * 32, iz * 32); }
    return cv[i];
  };

  // --- radar echo of one storm at (x,z): returns dBZ-like 0..72 (max at surface)
  function echo(st, x, z) {
    const I = st.intensity; if (I < 0.02) return 0;
    const R = st.rainR, dx = x - st.meso.x, dz = z - st.meso.z, u = (dx * st.fx + dz * st.fz) / R, v = (-dx * st.fz + dz * st.fx) / R;
    if (st.type === 'supercell') {
      if (u > 5 || u < -3 || v > 2.6 || v < -3.4) return 0;
      const n = gnoise(x / 900 + st.seed % 97, z / 900, 21) * 0.14 + gnoise(x / 260, z / 260 + st.seed % 89, 22) * 0.07;
      const cu = u - 0.95 + n, cw = v + 0.62 + n * 0.7, a = 64 * Math.exp(-(cu * cu / 0.55 + cw * cw / 0.3));
      const fu = u - 1.7, fw = v + 0.75 + n, b = 40 * Math.exp(-(fu * fu / 2.2 + fw * fw / 0.75));
      let c = 0, rot = st.rotation;
      if (rot > 0.15) {
        const m = st.meso.r / R, rho = Math.sqrt(u * u + v * v);
        if (rho < m * 3) {
          let ph = Math.atan2(-u, -v); if (ph < -0.7) ph += 6.2832;                 // 0 = left flank, pi/2 rear, pi right
          const wrap = 1.6 + 2.7 * rot;                                             // how far the hook has wrapped
          if (ph < wrap + 0.4) { const r0 = m * (1.72 - 0.27 * ph), w = m * (0.4 - 0.05 * ph), q = (rho - r0 + n * 0.3) / w; c = (52 - 2.2 * Math.max(0, ph)) * Math.exp(-q * q) * smoothstep(wrap + 0.4, wrap - 0.5, ph) * smoothstep(-0.7, 0.1, ph) * smoothstep(0.15, 0.6, rot); }
          if (rho < m) { const k = rot * (1 - rho / m); return Math.max(0, I * Math.max(a * (1 - 0.8 * k), b * (1 - 0.8 * k), c)); } // weak echo region
        }
      }
      return I * Math.pow(a * a * a * a + b * b * b * b + c * c * c * c, 0.25);
    }
    if (st.type === 'squall') {
      const L = st.len / R; if (u > 3 || u < -5 || Math.abs(v) > L + 1.5) return 0;
      const bow = u + 0.5 * (v / L) * (v / L), n = gnoise(x / 1300 + st.seed % 97, z / 1300, 23) * 0.3, seg = 0.78 + 0.35 * gnoise(v * 1.7, st.seed % 91, 24);
      const ends = smoothstep(L + 0.8, L - 0.6, Math.abs(v)), q = bow + n * 0.4, lead = q > 0 ? q * q / 0.05 : q * q / 0.4, a = 60 * seg * Math.exp(-lead), tr = q + 1.7, b = 36 * Math.exp(-tr * tr / 1.6);
      return I * ends * Math.max(a, b);
    }
    const n = gnoise(x / 700 + st.seed % 97, z / 700, 25) * 0.3, d = u * u + v * v;
    return d > 9 ? 0 : I * 50 * Math.exp(-d * (1.1 + n));
  }

  function debrisBall(t, x, z) { // tornadic debris signature
    if (t.dust < 0.25) return 0; const dx = x - t.x, dz = z - t.z, r = t.dustR * 1.5 + 120; const d = (dx * dx + dz * dz) / (r * r);
    return d > 6 ? 0 : (40 + 22 * t.strength) * Math.exp(-d) * smoothstep(0.25, 0.7, t.dust);
  }
  function reflectivity(x, z) {
    let m = 0; for (let i = 0; i < storms.length; i++) { const e = echo(storms[i], x, z); if (e > m) m = e; }
    for (let i = 0; i < tornadoes.length; i++) { const e = debrisBall(tornadoes[i], x, z); if (e > m) m = e; }
    return m;
  }

  // --- ambient surface wind (gusty, veering with height)
  function base(x, z, h, now, out) {
    const gx = gnoise((x - env.sfcX * now) / 620, (z - env.sfcZ * now) / 620, 31), gz = gnoise((x - env.sfcX * now) / 240, (z - env.sfcZ * now) / 240, 32);
    const k = h > 6000 ? 1 : h / 6000, sh = h < 2 ? 0.72 : h > 400 ? 1.35 : 0.72 + 0.117 * Math.log(h * 0.5 + 1) , g = 1 + 0.32 * gx + 0.3 * gz;
    const q = Math.sqrt(k), sx = env.sfcX * sh * g - env.sfcZ * 0.16 * gz, sz = env.sfcZ * sh * g + env.sfcX * 0.16 * gz;
    out.x = sx + (env.steerX * 1.9 - sx) * q * 0.85; out.y = 0; out.z = sz + (env.steerZ * 1.9 - sz) * q * 0.85;
    return out;
  }
  function stormWind(st, x, z, h, now, out) {
    const I = st.intensity; if (I < 0.03) return;
    const R = st.rainR, dx = x - st.meso.x, dz = z - st.meso.z, d2 = dx * dx + dz * dz; if (d2 > 90e6 + st.len * st.len) return;
    const low = h < 1500 ? 1 - h / 1500 : 0;
    if (st.type === 'supercell') {
      const d = Math.sqrt(d2) + 1, ux = dx / d, uz = dz / d, fwd = ux * st.fx + uz * st.fz, right = -ux * st.fz + uz * st.fx, m = st.meso.r;
      // inflow: strongest on the forward / right side, 1-3 km out
      const q = d / (m * 1.9), inf = 13 * I * (0.35 + 0.65 * st.rotation) * q / (0.4 + q * q) * low * (0.55 + 0.45 * clamp(0.5 * fwd + 0.75 * right + 0.4, 0, 1)) * smoothstep(9000, 3500, d);
      out.x -= ux * inf; out.z -= uz * inf;
      // mesocyclone rotation, stronger aloft
      const xm = d / m, vt = 24 * st.rotation * I * SQ2 * xm / Math.sqrt(1 + xm * xm * xm * xm) * (h > 900 ? 1 : 0.24 + 0.76 * h / 900) * smoothstep(9000, 3000, d);
      out.x += uz * vt; out.z -= ux * vt;
      out.y += 20 * I * st.rotation * Math.exp(-xm * xm) * (h > 900 ? 1 : h / 900);
      // rear flank downdraft surge wrapping around the right-rear side
      const rx = x - (st.meso.x - st.fx * m * 1.15 - st.fz * m * 0.25), rz = z - (st.meso.z - st.fz * m * 1.15 + st.fx * m * 0.25), rd = Math.sqrt(rx * rx + rz * rz) + 1, rq = rd / (m * 0.85);
      if (rq < 3.2 && low > 0) {
        const surge = 0.75 + 0.35 * gnoise(now / 38, st.seed % 83, 33), g = 25 * I * st.rotation * surge * rq * Math.exp(-rq * rq * 0.55) * low;
        out.x += (rx / rd * 0.75 + st.fx * 0.65) * g; out.z += (rz / rd * 0.75 + st.fz * 0.65) * g; out.y -= 3.5 * I * Math.exp(-rq * rq) * (h > 300 ? 1 : h / 300);
      }
    }
    // outflow from the precipitation core with gust front
    if (low > 0) {
      const squall = st.type === 'squall'; let ox, oz, od, reach, vmx;
      if (squall) {
        const u = dx * st.fx + dz * st.fz, v = -dx * st.fz + dz * st.fx, bow = u + 0.5 * R * (v / st.len) * (v / st.len); if (Math.abs(v) > st.len * 1.25) return;
        const e = smoothstep(st.len * 1.25, st.len * 0.8, Math.abs(v)), g = 24 * I * e * low * (bow > 0 ? smoothstep(R * 0.55, R * 0.2, bow) : Math.exp(bow / (R * 2.2))) * (1 + 0.25 * gnoise(x / 350, z / 350 - now / 12, 34));
        out.x += st.fx * g; out.z += st.fz * g; return;
      }
      ox = x - st.rain.x; oz = z - st.rain.z; od = Math.sqrt(ox * ox + oz * oz) + 1; reach = st.rain.r * (1.15 + 0.9 * st.mature); vmx = st.type === 'shower' ? 9 : 17;
      const q = od / reach; if (q < 1.25) {
        const front = q < 1 ? Math.min(1, q * 1.5) : (1.25 - q) * 4, g = vmx * I * st.rain.rate * front * low * (1 + 0.3 * gnoise(x / 300, z / 300 - now / 14, 35));
        out.x += ox / od * g; out.z += oz / od * g; out.y -= 3 * I * Math.max(0, 1 - q * 1.6);
      }
    }
  }
  const acc = { x: 0, y: 0, z: 0 };
  function tornadoWind(t, x, y, z, now, out) {
    const bx = x - t.x, bz = z - t.z, far = 1400 + t.rCore * 14; if (bx * bx + bz * bz > far * far * 1.6) return;
    const h = y - t.y0 < 0 ? 0 : y - t.y0; if (h > t.lcl * 1.25) return;
    axisAt(t, h, ax, now);
    const dx = x - ax.x, dz = z - ax.z, r = Math.sqrt(dx * dx + dz * dz) + 1e-3; if (r > far) return;
    const rc = coreRadius(t, h), q = r / rc, vm = t.vmax, ux = dx / r, uz = dz / r, touch = t.stage === 'funnel' ? clamp((h + t.lcl * (t.condense - 0.25)) / t.lcl) : 1;
    const fade = r < far * 0.6 ? 1 : (1 - r / far) / 0.4, hk = h / t.lcl, prof = (1.06 - 0.2 * Math.exp(-h / 7)) * (hk < 1 ? 1 - 0.3 * hk : 0.7 * (1 - (hk - 1) * 4)) * touch * fade;
    const vt = vm * SQ2 * q / Math.sqrt(1 + q * q * q * q) * prof * t.spin;
    const Hb = 45 + 0.32 * rc, q2 = q * q, twoCell = clamp((t.swirl - 0.55) / 0.5);
    const vr = -vm * 0.72 * q2 / (0.6 + q2 * q) * Math.exp(-h / Hb) * touch * fade + vm * 0.12 * Math.exp(-Math.abs(q - 1.4) * 1.5) * hk;   // inflow layer, slight outflow aloft
    const lift = (h + 6) / (h + 46), a = (q - 0.85) / 0.5;
    const w = vm * lift * touch * (0.62 * Math.exp(-a * a) + (0.32 * (1 - twoCell) - 0.22 * twoCell) * Math.exp(-q2 * 5));
    const wt = 1 / (1 + q2 * 0.11), keep = 1 - wt * touch;                          // inside the vortex ambient wind is replaced by translation
    out.x = out.x * keep + t.vx * (1 - keep) + uz * vt + ux * vr; out.z = out.z * keep + t.vz * (1 - keep) - ux * vt + uz * vr; out.y += w;
    for (let i = 0; i < t.sub.length; i++) {
      const s = t.sub[i], px = x - (ax.x + Math.cos(s.a) * s.r), pz = z - (ax.z + Math.sin(s.a) * s.r), p2 = px * px + pz * pz, rr = s.rc * (1 + hk); if (p2 > rr * rr * 60) continue;
      const pr = Math.sqrt(p2) + 1e-3, pq = pr / rr, sv = vm * s.s * SQ2 * pq / Math.sqrt(1 + pq * pq * pq * pq) * (hk < 0.6 ? 1 - hk * 1.4 : 0.16) * t.spin;
      out.x += pz / pr * sv - px / pr * sv * 0.3; out.z += -px / pr * sv - pz / pr * sv * 0.3; out.y += Math.abs(sv) * lift * 0.5;
    }
    // turbulence
    if (q < 7) {
      const tb = vm * 0.17 * touch * Math.exp(-q * 0.42) * (0.4 + 0.6 * Math.min(1, q)), ts = now * 0.9, f = 1 / (14 + rc * 0.16);
      out.x += tb * gnoise(x * f + ts * 1.7, z * f + h * 0.02, 41); out.z += tb * gnoise(x * f - ts, z * f + ts * 1.3 - h * 0.02, 42); out.y += tb * 0.8 * gnoise(x * f + h * 0.03 - ts * 1.1, z * f + ts * 0.7, 43);
    }
    // gameplay: the inside of the funnel is never a safe "eye" near the ground. Debris-laden suction-vortex chaos
    // (stands in for unresolved multiple vortices) keeps the whole core lethal, strongest just inside the wall.
    if (q < 1 && hk < 0.5) {
      const c = vm * touch * fade * (0.85 - 0.15 * q) * (1 - hk * 2), ts = now * 2.3, f = 1 / (6 + rc * 0.05);
      out.x += c * 1.9 * gnoise(x * f + ts, z * f, 44); out.z += c * 1.9 * gnoise(x * f, z * f - ts, 45); out.y += c * (0.68 + 0.25 * gnoise(x * f - ts, z * f + ts, 46));
    }
  }
  function windAt(x, y, z, out) {
    const now = ctx.time.now, h = Math.max(0, y - ground(x, z));
    base(x, z, h, now, acc);
    for (let i = 0; i < storms.length; i++) stormWind(storms[i], x, z, h, now, acc);
    for (let i = 0; i < tornadoes.length; i++) tornadoWind(tornadoes[i], x, y, z, now, acc);
    out.x = acc.x; out.y = acc.y; out.z = acc.z; return out;
  }
  function ambient(x, z, out) { base(x, z, 10, ctx.time.now, acc); out.x = acc.x; out.y = acc.y; out.z = acc.z; return out; }
  function pressureAt(x, y, z) {
    let p = 1004 * Math.exp(-y / 8300) + 1.2 * gnoise(x / 22000, z / 22000, 51);
    for (let i = 0; i < storms.length; i++) {
      const st = storms[i], dx = x - st.meso.x, dz = z - st.meso.z, m = st.meso.r * 2, d = (dx * dx + dz * dz) / (m * m);
      if (d < 12) p -= 4.5 * st.intensity * st.rotation / (1 + d);
      const rx = x - st.rain.x, rz = z - st.rain.z, q = (rx * rx + rz * rz) / (st.rain.r * st.rain.r); if (q < 4) p += 2.2 * st.intensity * st.rain.rate * Math.exp(-q);
    }
    for (let i = 0; i < tornadoes.length; i++) {
      const t = tornadoes[i], h = Math.max(0, y - t.y0); axisAt(t, h, ax, ctx.time.now);
      const dx = x - ax.x, dz = z - ax.z, rc = coreRadius(t, h), q2 = (dx * dx + dz * dz) / (rc * rc); if (q2 > 3600 || h > t.lcl * 1.2) continue;
      p -= RHO * t.vmax * t.vmax * (Math.PI / 2 - Math.atan(q2)) * 0.01 * (t.stage === 'funnel' ? clamp((h + t.lcl * (t.condense - 0.25)) / t.lcl) : 1);
      for (let j = 0; j < t.sub.length; j++) { const s = t.sub[j], a = dx - Math.cos(s.a) * s.r, b = dz - Math.sin(s.a) * s.r; p -= RHO * t.vmax * t.vmax * s.s * s.s * (Math.PI / 2 - Math.atan((a * a + b * b) / (s.rc * s.rc))) * 0.01; }
    }
    return p;
  }

  // ---- thermodynamics
  function coldPool(x, z) {
    let c = 0; for (let i = 0; i < storms.length; i++) {
      const st = storms[i], dx = x - (st.rain.x - st.fx * st.rain.r * 0.4), dz = z - (st.rain.z - st.fz * st.rain.r * 0.4), q = (dx * dx + dz * dz) / (st.rain.r * st.rain.r * 2.6 + st.len * st.len * 0.3); if (q < 5) c = Math.max(c, st.intensity * st.rain.rate * Math.exp(-q * q) * (0.4 + 0.6 * st.mature));
    } return c;
  }
  const diurnal = () => Math.sin((ctx.time.hour - 9.5) / 24 * Math.PI * 2);
  function cape(x, z) {
    const b = ctx.world?.biomeAt?.(x, z), hum = b ? b.humidity ?? 0.6 : 0.6, pr = b ? b.tornadoProb ?? 0.5 : 0.5, g = 0.5 + 0.5 * gnoise(x / 14000 + env.day * 3.1, z / 14000, 61);
    return Math.max(0, (600 + 2200 * pr + 1500 * hum) * (0.45 + 0.75 * g) * (0.75 + 0.3 * diurnal()) * (1 - 0.8 * coldPool(x, z)));
  }
  const W = {};
  const tmp = { x: 0, y: 0, z: 0 };
  function weatherAt(x, z, out = W) {
    let e = 0, dark = 0, hail = 0, hailCm = 0, best = null, bestD = 1e12, lrate = 0, cover = 0.25 + 0.3 * gnoise(x / 9000 + env.day, z / 9000 - ctx.time.now / 900, 62);
    for (let i = 0; i < storms.length; i++) {
      const st = storms[i], dx = x - st.x, dz = z - st.z, d = Math.sqrt(dx * dx + dz * dz), I = st.intensity;
      if (d < bestD && I > 0.1) { bestD = d; best = st; }
      const rad = st.radius + st.len; if (d > rad * 2.6) continue;
      const ec = echo(st, x, z); if (ec > e) e = ec;
      const sh = smoothstep(rad * 1.5, rad * 0.35, d) * I; dark = Math.max(dark, sh * (st.type === 'shower' ? 0.5 : 0.85)); cover = Math.max(cover, smoothstep(rad * 2.6, rad * 1.1, d) * Math.min(1, I * 1.4));
      lrate += st.lightning * smoothstep(rad * 2, rad * 0.5, d);
      if (st.hail > 0.4) {
        const hx = (dx - st.rain.ox * 0.62) / (st.rain.r * 0.62), hz = (dz - st.rain.oz * 0.62) / (st.rain.r * 0.62), q = hx * hx + hz * hz;
        if (q < 3) { const n = clamp(0.75 + 0.6 * gnoise(x / 420, z / 420 + ctx.time.now / 60, 63)), hh = Math.exp(-q * 1.4) * I * n * clamp(st.hail / 2.5); if (hh > hail) { hail = hh; hailCm = st.hail * (0.35 + 0.65 * Math.exp(-q * 1.2)); } }
      }
    }
    // rain shafts: streaky modulation
    const sh2 = 1 + 0.35 * gnoise(x / 210, z / 210 + ctx.time.now / 25, 64), rain = Math.pow(clamp((e - 17) / 43), 1.25) * clamp(sh2, 0.5, 1.3);
    const b = ctx.world?.biomeAt?.(x, z), hum = b ? b.humidity ?? 0.6 : 0.6, cp = coldPool(x, z), dn = diurnal(), g = ground(x, z);
    out.rain = clamp(rain); out.hail = hail > 0.04 ? clamp(hail) : 0; out.hailCm = hail > 0.04 ? hailCm : 0; out.dbz = e; out.cloud = clamp(cover); out.dark = clamp(Math.max(dark, rain * 0.8)); out.lightning = lrate;
    out.temp = 25.5 + 4.5 * dn + z / 31500 * 4.5 - g * 0.0065 - 8.5 * cp - 2.5 * dark; out.dewpoint = Math.min(out.temp - 0.4, lerp(8, 22, hum) + z / 31500 * 2.5 - 1.5 * cp);
    let ext = 1 / lerp(45000, 18000, hum) + 1 / 420 * Math.pow(out.rain, 1.35) + (out.hail > 0 ? out.hail / 2500 : 0);
    for (let i = 0; i < tornadoes.length; i++) { const t = tornadoes[i], dx = x - t.x, dz = z - t.z, r = t.dustR * 1.2, q = (dx * dx + dz * dz) / (r * r); if (q < 4) ext += t.dust * Math.exp(-q * 1.5) / 45; }
    out.visibility = 1 / ext;
    windAt(x, g + 10, z, tmp); out.windSpeed = Math.hypot(tmp.x, tmp.z); out.windX = tmp.x; out.windZ = tmp.z; out.gust = out.windSpeed * (1.28 + 0.25 * dark) + 1.5;
    out.storm = best; out.stormDist = best ? bestD : Infinity; out.coldPool = cp;
    return out;
  }
  function velocity(x, z, rx, rz) {
    const dx = x - rx, dz = z - rz, d = Math.sqrt(dx * dx + dz * dz) + 1; windAt(x, ground(x, z) + 60 + d * 0.02, z, tmp); return (tmp.x * dx + tmp.z * dz) / d;
  }
  return { echo, reflectivity, windAt, ambient, pressureAt, weatherAt, velocity, cape, ground, diurnal };
}

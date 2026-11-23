// Shared tornado geometry: JS + GLSL twins. No imports (runs anywhere).
//
// VORTEX MODEL  Vatistas n=2 (closed-form stand-in for Burgers-Rott, within ~2 %):
//   x = r / rc(h)        v(r)  = vmax * sqrt2 * x / sqrt(1 + x^4)           (peaks exactly vmax at r = rc)
//   cyclostrophic:       dp(r) = rho * vmax^2 * (pi/2 - atan(x^2))          (exact integral of rho v^2 / r, dp(0)=1.571 rho vmax^2)
// CONDENSATION  a parcel at height h needs the drop  dpNeed(h) = dpNeed(0) * (1 - h/lcl)  to saturate.
//   With P(h) = dpNeed(h) / (rho vmax^2) = pc * (1 - h/lcl):   r_funnel^2 = rc(h)^2 / tan(P)   ( P >= pi/2 -> nothing condenses )
//   blended into the cloud base radius:                         1/r^2 = tan(P)/rc^2 + 1/rTop^2
//   pc = (pi/2) / (dp0 / dpNeed(0)).  pc < pi/2 : reaches the ground; pc ~ 0.7 : wedge; pc ~ 3 : funnel hangs half way down.
//
// Tornado fields used: x, z, y0, lcl, lean{x,z}, wobbleSeed, snake (m), rCore, rTop, pc (fallback from condense), corner 0..1
// Packed for GLSL (packTornado):
//   A = (x, z, y0, lcl)     B = (lean.x, lean.z, wobbleSeed, snake)     C = (rCore, rTop, pc, corner)
// h is always height above the tornado's ground y0.  time = ctx.time.now / uTime.
// Cyclonic (spin=+1) rotation direction at offset (dx,dz) is (dz,-dx)/r  (counter-clockwise seen from above, +X east -Z north).
// Sub-vortex k centre: axis + (cos(a), sin(a)) * r  -> cyclonic orbits have a DECREASING with time (already done by the sim).

const HALF_PI = Math.PI / 2;

/** Vortex centre at height h. out = {x,z} */
export function axisAt(t, h, out, time = 0) {
  let k = h / t.lcl; k = k < 0 ? 0 : k > 1.3 ? 1.3 : k;
  const q = k * (0.32 + 0.68 * k), lx = t.lean ? t.lean.x : 0, lz = t.lean ? t.lean.z : 0;
  const s = t.wobbleSeed || 0, e = (t.snake || 0) * k * (1 - 0.55 * k) * 1.9;
  const a = k * 5.2 - time * 0.21 + s, b = k * 11.3 - time * 0.47 + s * 2.7;
  out.x = t.x + lx * q + e * (Math.sin(a) + 0.27 * Math.sin(b));
  out.z = t.z + lz * q + e * (Math.cos(a * 0.93 + 0.6) + 0.27 * Math.cos(b * 1.07 + 1.3));
  return out;
}

/** Radius of maximum wind at height h (corner-flow contraction below, broadening aloft) */
export function coreRadius(t, h) {
  const k = h < 0 ? 0 : h / t.lcl > 1.3 ? 1.3 : h / t.lcl, c = t.corner ?? 0.25;
  return t.rCore * (1 - c * Math.exp(-Math.max(h, 0) / (0.55 * t.rCore + 12))) * (1 + 0.45 * k * k);
}

export const tornadoPc = (t) => (t.pc > 0 ? t.pc : HALF_PI / Math.max(0.02, t.condense ?? 1));

/** Condensation funnel radius at height h, 0 where nothing condenses */
export function funnelRadius(t, h) {
  let k = h / t.lcl; if (k < 0) k = 0;
  const P = tornadoPc(t) * (1 - k);
  if (P >= HALF_PI - 0.004) return 0;
  const rc = coreRadius(t, h), rt = t.rTop || rc * 3;
  if (P <= 0) return rt;
  return 1 / Math.sqrt(Math.tan(P) / (rc * rc) + 1 / (rt * rt));
}

/** Height of the visible funnel tip above ground (0 = touches the ground) */
export const funnelTip = (t) => Math.max(0, t.lcl * (1 - HALF_PI / tornadoPc(t)));

/** Normalised tangential speed (0..1) at x=r/rc and normalised pressure drop (0..pi/2) */
export const swirl = (x) => 1.41421356 * x / Math.sqrt(1 + x * x * x * x);
export const swirlDp = (x) => HALF_PI - Math.atan(x * x);

/** Fill three Vector4-likes (objects with x,y,z,w or .set) for the GLSL functions */
export function packTornado(t, A, B, C) {
  A.set(t.x, t.z, t.y0, t.lcl); B.set(t.lean?.x || 0, t.lean?.z || 0, t.wobbleSeed || 0, t.snake || 0);
  C.set(t.rCore, t.rTop, tornadoPc(t), t.corner ?? 0.25);
}

// A = (x, z, y0, lcl)   B = (leanX, leanZ, wobbleSeed, snake)   h = height above y0   -> world xz of the vortex centre
export const AXIS_GLSL = /* glsl */`
vec2 tornadoAxis(vec4 A, vec4 B, float h, float time){
  float k = clamp(h / A.w, 0.0, 1.3), q = k * (0.32 + 0.68 * k);
  float e = B.w * k * (1.0 - 0.55 * k) * 1.9;
  float a = k * 5.2 - time * 0.21 + B.z, b = k * 11.3 - time * 0.47 + B.z * 2.7;
  return A.xy + B.xy * q + e * vec2(sin(a) + 0.27 * sin(b), cos(a * 0.93 + 0.6) + 0.27 * cos(b * 1.07 + 1.3));
}
`;

// C = (rCore, rTop, pc, corner)
export const FUNNEL_GLSL = /* glsl */`
float tornadoCoreRadius(vec4 A, vec4 C, float h){
  float k = clamp(h / A.w, 0.0, 1.3);
  return C.x * (1.0 - C.w * exp(-max(h, 0.0) / (0.55 * C.x + 12.0))) * (1.0 + 0.45 * k * k);
}
// condensation funnel radius at height h (0 where nothing condenses)
float tornadoFunnelRadius(vec4 A, vec4 C, float h){
  float P = C.z * (1.0 - max(h, 0.0) / A.w);
  if (P >= 1.5668) return 0.0;
  if (P <= 0.0) return C.y;
  float rc = tornadoCoreRadius(A, C, h);
  return inversesqrt(tan(P) / (rc * rc) + 1.0 / (C.y * C.y));
}
// signed normalised supersaturation at distance r from the axis: > 0 inside the condensation funnel (same zero set as above)
float tornadoCondensation(vec4 A, vec4 C, float r, float h){
  float P = C.z * (1.0 - max(h, 0.0) / A.w);
  float rc = tornadoCoreRadius(A, C, h), x = r / rc;
  if (P < 1.5668) P = atan(tan(max(P, 0.0)) + rc * rc / (C.y * C.y));
  return (1.5707963 - atan(x * x)) - P;
}
// normalised tangential wind 0..1 at distance r
float tornadoSwirl(vec4 A, vec4 C, float r, float h){
  float x = r / tornadoCoreRadius(A, C, h); return 1.41421356 * x / sqrt(1.0 + x * x * x * x);
}
`;

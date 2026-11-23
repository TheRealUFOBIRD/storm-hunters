export const TAU = Math.PI * 2, DEG = Math.PI / 180;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const remap = (v, a, b, c, d) => c + (d - c) * clamp((v - a) / (b - a));
export const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
export const wrapAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
// compass heading (0 = north/-Z, clockwise) <-> direction
export const headingToDir = (h, o = {}) => { o.x = Math.sin(h); o.z = -Math.cos(h); return o; };
export const dirToHeading = (x, z) => { const a = Math.atan2(x, -z); return a < 0 ? a + TAU : a; };
export const compass = (h) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((h % TAU + TAU) % TAU) / TAU * 16) % 16];
export const MPH = 2.2369363, KMH = 3.6, FT = 3.28084, MI = 1609.344;
// EF scale from peak wind m/s (3 s gust)
export const efFromWind = (v) => (v >= 89.4 ? 5 : v >= 74.2 ? 4 : v >= 60.8 ? 3 : v >= 49.6 ? 2 : v >= 38.4 ? 1 : 0);

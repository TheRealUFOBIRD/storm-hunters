// Meteorological colour scales (NWS conventions). RGB byte lookups.
const DBZ = [[5, 4, 233, 231], [10, 1, 159, 244], [15, 3, 0, 244], [20, 2, 253, 2], [25, 1, 197, 1], [30, 0, 142, 0], [35, 253, 248, 2], [40, 229, 188, 0], [45, 253, 149, 0], [50, 253, 0, 0], [55, 212, 0, 0], [60, 188, 0, 0], [65, 248, 0, 253], [70, 152, 84, 198], [75, 253, 253, 253]];
export const DBZ_STEPS = DBZ;
// 0..80 dBZ -> Uint8 RGBA LUT (index = dbz*2)
export const dbzLUT = new Uint8Array(161 * 4);
for (let i = 0; i <= 160; i++) { const d = i / 2; if (d < 5) continue; let k = 0; while (k < DBZ.length - 1 && d >= DBZ[k + 1][0]) k++; const a = DBZ[k], b = DBZ[Math.min(k + 1, DBZ.length - 1)], f = ((d - a[0]) / 5) * 0.55; for (let c = 0; c < 3; c++) dbzLUT[i * 4 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * Math.min(1, Math.max(0, f)); dbzLUT[i * 4 + 3] = d < 12 ? 120 + (d - 5) * 16 : 235; }
// velocity -64..64 m/s -> RGBA LUT (index = v+64)*2
const VEL = [[-64, 0, 224, 255], [-50, 50, 255, 255], [-38, 0, 255, 60], [-26, 0, 190, 0], [-14, 0, 130, 0], [-4, 18, 78, 20], [-0.5, 80, 92, 82], [0.5, 100, 84, 84], [4, 92, 16, 18], [14, 150, 0, 0], [26, 215, 0, 0], [38, 255, 40, 20], [50, 255, 130, 90], [64, 255, 235, 60]];
export const VEL_STEPS = VEL;
export const velLUT = new Uint8Array(257 * 4);
for (let i = 0; i <= 256; i++) { const v = i / 2 - 64; let k = 0; while (k < VEL.length - 2 && v >= VEL[k + 1][0]) k++; const a = VEL[k], b = VEL[k + 1], f = Math.min(1, Math.max(0, (v - a[0]) / (b[0] - a[0]))); for (let c = 0; c < 3; c++) velLUT[i * 4 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f; velLUT[i * 4 + 3] = 235; }
export const RISK = { TSTM: '#c1e9c1', MRGL: '#66a366', SLGT: '#ffe066', ENH: '#ffa366', MDT: '#e06666', HIGH: '#ee99ee' };
export const EF_COLOR = ['#7fd4ff', '#57e08a', '#ffe14d', '#ff9a2e', '#ff4438', '#ff4fd8'];
export const WARN = { TOR: '#ff2a22', SVR: '#ffc400' };
export const UI = { amber: '#ffb000', ink: '#f2ead6', dim: '#a79f88', soot: '#14130d', line: '#4b4733', good: '#4be37a', bad: '#ff4438' };
export const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

// Deterministic world bake (no three.js): macro elevation, biome fields, rivers, roads, farm sections, states.
// Runs once on the main thread at create(); the plain typed arrays are cloned to the worker.
import { toWorld, toLatLon, BOUNDS } from '../core/geo.js';
import { gnoise, vnoise, fbm, ridged } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import * as G from './geodata.js';
import { makeSampler, herm, CROWN, CELL, GX, GZ, OX, OZ, RC, RGX, RGZ, ROX, ROZ, SEC, SX0, SZ0, SNX, SNZ } from './sampler.js';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v), lerp = (a, b, t) => a + (b - a) * t;
const sst = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const ll = (a, i) => toWorld(a[i], a[i + 1]);
const ring = (a) => { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i += 2) { const p = ll(a, i); o[i] = p.x; o[i + 1] = p.z; } return o; };

// ---------- control points: lat, lon, elev(m real), forest, arid, farm, corn(1)/wheat(0), redDirt, swamp
const CP = [
  // plains
  [35.5, -97.5, 360, .13, .12, .6, .1, .9, 0], [36.4, -98, 380, .03, .14, .85, .05, .85, 0], [36.4, -100, 650, .01, .3, .6, .05, .6, 0], [35, -99.5, 560, .04, .28, .5, .05, .95, 0], [34.3, -97.2, 270, .24, .12, .4, .15, .75, 0], [35.6, -95.6, 200, .42, .02, .3, .3, .4, 0], [34.5, -95.2, 220, .75, 0, .1, .3, .3, .05],
  [37.7, -97.3, 400, .04, .1, .95, .1, .12, 0], [38.4, -99, 570, .02, .16, .92, .08, .05, 0], [37.8, -100.8, 840, .01, .25, .9, .25, .05, 0], [39, -101.5, 1050, .01, .25, .85, .2, .05, 0], [38.6, -96.5, 390, .12, .04, .45, .3, .05, 0], [39.6, -97, 420, .08, .05, .85, .5, .05, 0], [39.1, -95, 280, .25, 0, .7, .6, .05, 0],
  [35.2, -101.8, 1100, .01, .42, .65, .1, .55, 0], [33.6, -101.9, 980, .0, .45, .9, .0, .9, 0], [33.2, -99, 400, .12, .35, .4, .05, .75, 0], [32, -102.2, 880, .02, .65, .25, 0, .7, 0], [32.8, -97, 190, .15, .12, .45, .2, .15, 0], [31.5, -97.2, 160, .18, .12, .6, .5, .05, 0], [31.4, -100, 600, .18, .45, .2, .05, .3, 0], [30.3, -99, 560, .3, .4, .1, 0, .1, 0], [29.4, -98.5, 190, .22, .35, .35, .2, .1, 0], [27.5, -98.5, 90, .18, .5, .35, .1, .15, 0], [30.5, -103, 1150, .04, .85, .03, 0, .25, 0],
  [41.2, -96.5, 380, .07, .03, .95, .9, .02, 0], [41, -99, 620, .04, .1, .85, .8, .02, 0], [42.3, -101, 950, .01, .22, .12, .2, .02, 0], [41.2, -103, 1230, .01, .25, .6, .2, .02, 0], [43.7, -98, 420, .03, .08, .85, .7, .02, 0], [44.4, -100.5, 520, .01, .2, .55, .25, .02, 0], [43.8, -102.3, 800, .02, .38, .15, .1, .05, 0], [45.6, -102, 750, .01, .25, .35, .1, .05, 0],
  [47, -98, 440, .03, .06, .9, .3, .0, .02], [47, -101.5, 600, .01, .18, .65, .05, .0, 0], [48.2, -103, 620, .01, .2, .65, 0, 0, 0], [47, -97, 270, .04, .02, 1, .5, 0, .02], [48, -110, 900, .01, .28, .5, 0, 0, 0], [46, -106, 850, .05, .35, .15, 0, .1, 0], [43.5, -106, 1500, .04, .5, .06, 0, .15, 0], [39.3, -103.5, 1500, .01, .32, .5, .1, .05, 0], [40.5, -104.4, 1450, .02, .28, .75, .5, .02, 0], [38, -103.5, 1300, .01, .5, .25, .1, .2, 0],
  // midwest / corn belt
  [42, -93.5, 300, .08, 0, 1, .95, 0, 0], [42, -95.5, 390, .05, 0, 1, .95, 0, 0], [40.2, -93, 290, .25, 0, .7, .85, 0, 0], [40, -89, 190, .07, 0, 1, 1, 0, 0], [41.5, -88.5, 190, .1, 0, .9, 1, 0, 0], [40.3, -86.2, 230, .18, 0, .9, 1, 0, 0], [38.3, -88, 130, .35, 0, .7, .9, 0, 0], [40.5, -83.5, 290, .25, 0, .85, 1, 0, 0], [44, -95, 350, .05, 0, 1, .95, 0, 0], [45, -93.2, 270, .4, 0, .55, .8, 0, .04], [47.5, -94, 410, .88, 0, .06, .3, 0, .12], [47, -91.5, 420, .95, 0, 0, .3, 0, .05], [43.2, -90.3, 320, .5, 0, .55, .9, 0, 0], [45.3, -89.5, 450, .9, 0, .08, .6, 0, .08], [46.3, -87, 350, .95, 0, 0, .5, 0, .06], [42.8, -84.5, 260, .4, 0, .65, .9, 0, .02], [44.6, -84.5, 330, .9, 0, .05, .5, 0, .05],
  [37.2, -93.3, 370, .5, 0, .35, .4, .2, 0], [37, -91.5, 320, .9, 0, .06, .3, .25, 0], [36, -93, 450, .9, 0, .06, .3, .2, 0], [34.7, -93.5, 260, .92, 0, .05, .3, .2, 0], [35.2, -90.8, 70, .25, 0, .85, .5, .05, .15], [33.2, -91, 45, .35, 0, .75, .5, .05, .25], [33, -93, 80, .85, 0, .08, .4, .3, .1], [31.5, -94.5, 90, .9, 0, .05, .3, .3, .1], [30.1, -92, 8, .35, 0, .5, .4, 0, .65], [29.8, -95.3, 18, .4, .02, .35, .3, 0, .2], [29.6, -90.5, 4, .35, 0, .1, .3, 0, 1],
  // south east
  [35.1, -89, 130, .55, 0, .45, .6, .25, .05], [36.2, -86.8, 190, .6, 0, .3, .6, .15, 0], [37.8, -85, 270, .55, 0, .35, .7, .1, 0], [33, -88.5, 90, .75, 0, .2, .5, .4, .05], [32.3, -86.5, 80, .75, 0, .2, .5, .5, .05], [33.7, -84.4, 300, .8, 0, .1, .5, .6, 0], [31.5, -83.5, 100, .65, 0, .4, .5, .4, .1], [30.5, -86, 40, .85, 0, .05, .4, .15, .2], [30, -82.5, 25, .75, 0, .15, .4, .05, .25], [27.8, -81.4, 25, .4, 0, .25, .3, 0, .4], [25.9, -80.9, 3, .3, 0, .05, .1, 0, 1], [33.5, -80.3, 50, .75, 0, .3, .6, .25, .2], [35.3, -80, 170, .75, 0, .2, .6, .5, 0], [35.4, -77.5, 18, .65, 0, .35, .7, .1, .25], [37.3, -78.2, 130, .75, 0, .2, .6, .4, 0], [37.5, -80, 600, .92, 0, .05, .5, .1, 0], [35.8, -83, 600, .95, 0, .03, .5, .1, 0], [38.5, -81, 300, .95, 0, .03, .5, .05, 0], [39, -76.8, 60, .5, 0, .3, .8, .1, .05], [40.8, -77.5, 400, .8, 0, .2, .8, .05, 0], [42.5, -76, 400, .75, 0, .25, .8, 0, 0], [44, -74.5, 500, .97, 0, 0, .5, 0, .03], [44, -71.5, 500, .97, 0, 0, .5, 0, .02], [45.5, -69, 260, .97, 0, 0, .5, 0, .08], [42, -72, 190, .8, 0, .08, .7, 0, .02], [40, -74.8, 40, .55, 0, .15, .8, 0, .1],
  // mountain west & pacific
  [39.5, -106, 2300, .7, .15, .02, .1, .05, 0], [44.5, -110.3, 2000, .75, .15, .02, .1, 0, 0], [47, -114, 1200, .8, .1, .08, .1, 0, 0], [46, -112, 1500, .5, .25, .08, .1, 0, 0], [42, -108.5, 2000, .02, .65, .02, 0, .1, 0], [38.7, -109.8, 1500, .05, .85, .02, 0, .8, 0], [36.5, -110.5, 1750, .04, .85, .02, 0, .95, 0], [36, -107.5, 1900, .08, .75, .02, 0, .6, 0], [34.5, -108.5, 2000, .3, .6, .02, 0, .4, 0], [33, -106.5, 1250, .02, .9, .02, 0, .3, 0], [35, -104.5, 1400, .05, .6, .04, 0, .45, 0], [35.1, -111.6, 2000, .6, .45, 0, 0, .3, 0], [33.3, -112.3, 350, .02, 1, .15, 0, .25, 0], [32.2, -110, 900, .04, .95, .03, 0, .3, 0], [35.2, -114.8, 700, .01, 1, 0, 0, .3, 0], [36.3, -116.5, 700, .0, 1, 0, 0, .2, 0], [39.5, -116.5, 1750, .06, .85, .01, 0, .05, 0], [40.5, -113, 1300, .02, .9, .01, 0, 0, 0], [40.5, -111.4, 1700, .4, .4, .1, 0, .05, 0], [43.2, -115, 950, .02, .6, .4, .1, 0, 0], [43.3, -119, 1300, .12, .6, .05, 0, 0, 0], [46.8, -118.5, 450, .02, .4, .75, 0, 0, 0], [47.8, -121, 900, .95, 0, .02, 0, 0, 0], [47.3, -122.6, 60, .85, 0, .08, .2, 0, .02], [44.8, -123, 80, .55, 0, .5, .2, 0, 0], [43.3, -123.2, 350, .92, 0, .04, 0, 0, 0], [41, -122.5, 800, .85, .1, .02, 0, 0, 0], [39, -121.8, 25, .06, .35, .75, .2, .05, .02], [36.5, -120, 60, .02, .55, .9, .2, .02, 0], [38.5, -120, 1400, .85, .15, 0, 0, 0, 0], [37, -118.3, 1500, .3, .7, 0, 0, 0, 0], [39.5, -123.2, 500, .8, .1, .05, 0, 0, 0], [35.8, -120.8, 350, .3, .5, .15, 0, .05, 0], [34.2, -118.2, 150, .1, .6, .1, 0, 0, 0], [34.8, -116.5, 800, .0, 1, 0, 0, .15, 0], [33, -116.5, 700, .1, .75, .03, 0, .1, 0], [33, -115.5, 10, .0, 1, .5, 0, 0, 0],
  // canada / mexico / cuba
  [51, -97, 260, .3, 0, .5, .1, 0, .05], [50.5, -105, 560, .03, .1, .9, 0, 0, 0], [50.5, -113, 1000, .06, .15, .6, 0, 0, 0], [51, -117, 1500, .9, 0, 0, 0, 0, 0], [50, -86, 250, .97, 0, 0, 0, 0, .15], [48, -80, 300, .97, 0, 0, 0, 0, .1], [44, -80, 280, .5, 0, .5, .7, 0, 0], [48, -70, 300, .95, 0, 0, 0, 0, 0], [50, -65, 300, .95, 0, 0, 0, 0, 0], [46, -65, 80, .9, 0, .1, .3, 0, .05], [51, -123, 1200, .95, 0, 0, 0, 0, 0], [29, -106, 1400, .02, .9, .05, 0, .3, 0], [26, -103, 1250, .02, .9, .05, 0, .3, 0], [26, -107, 1900, .7, .4, 0, 0, .2, 0], [30, -111, 500, .03, 1, .05, 0, .3, 0], [25, -99, 250, .2, .5, .2, .1, .1, 0], [23, -102, 1900, .04, .7, .1, 0, .2, 0], [28, -113.5, 300, .01, 1, 0, 0, .3, 0], [23, -81, 30, .4, 0, .4, .2, .4, .1]];
// mountain ranges: polyline, half width (m), height (game m), ridge wavelength, roughness
const RANGES = [
  [[40.9, -106, 40.2, -105.7, 39.6, -105.8, 38.9, -105.4, 38.2, -105.4, 37.3, -105.2, 36.4, -105.4, 35.8, -105.7], 1700, 700, 1500, 1],
  [[40.6, -107, 39.6, -106.7, 39, -106.6, 38.4, -106.5, 37.8, -107.4, 37.4, -107], 2100, 760, 1600, 1], [[39.1, -107.6, 38.2, -107.8], 1200, 380, 1400, .8],
  [[45.2, -109.8, 44.5, -109.6, 43.5, -109.6, 42.7, -109], 1200, 680, 1400, 1], [[44.8, -111, 43.8, -110.8, 43.2, -110.7], 800, 620, 1300, 1], [[45.0, -107.5, 44.3, -107.2, 43.8, -107], 800, 480, 1400, .8],
  [[49, -114, 48, -113.3, 47.3, -112.9, 46.6, -112.4, 45.8, -112], 1500, 560, 1500, .95], [[49, -115.8, 48, -115.6, 47.3, -115.5, 46.5, -114.8, 45.8, -114.4, 45, -114.8, 44.2, -114.8, 43.8, -115.2], 2200, 560, 1500, .95], [[46, -113.5, 45, -113.4, 44.5, -112.5], 1300, 420, 1500, .9],
  [[52, -117.5, 51, -116, 50, -114.8, 49, -114], 1800, 800, 1600, 1], [[52, -120, 50.5, -118.5, 49, -117.5], 1900, 560, 1600, .9], [[52, -124.5, 50.5, -122.5, 49.4, -121.5], 2300, 700, 1600, 1],
  [[42, -111.6, 41, -111.5, 40.4, -111.4, 39.6, -111.4, 38.6, -111.8, 37.8, -112.5], 900, 420, 1300, .9], [[40.8, -111, 40.75, -109.6], 800, 420, 1400, .8],
  [[49, -121, 48.2, -121.2, 47.4, -121.3, 46.4, -121.5, 45.4, -121.8, 44.4, -121.8, 43.2, -122, 42.2, -122.2, 41.2, -121.8], 1500, 430, 1500, .9],
  [[40.6, -121.2, 39.6, -120.6, 38.8, -120.1, 37.8, -119.2, 37, -118.6, 36.3, -118.3, 35.6, -118.3], 1500, 660, 1500, 1], [[35.3, -118.7, 34.6, -119, 34.5, -119.6], 700, 260, 1200, .8], [[34.35, -118.1, 34.25, -117.4, 34.1, -116.8], 650, 340, 1100, .9], [[33.7, -116.6, 33, -116.5, 32.5, -116.2, 31, -115.6], 800, 300, 1100, .8],
  [[41.8, -123.6, 41, -123.2, 40.2, -122.9], 1500, 360, 1300, .9], [[40, -123.4, 39, -122.8, 38.6, -122.6], 700, 220, 1200, .7], [[37.2, -121.6, 36.4, -121.4, 35.6, -120.9], 700, 200, 1000, .7], [[46, -123.6, 45, -123.6, 44, -123.7, 42.8, -123.8], 800, 170, 1000, .6], [[47.9, -123.6, 47.7, -123.3], 1000, 520, 1200, .95],
  [[45.2, -118.3, 44.6, -118.6], 1100, 330, 1400, .8], [[36, -116.9, 36.8, -117.2], 600, 360, 1100, .9], [[36.3, -115.7, 36.2, -115.6], 600, 350, 1100, .9], [[41, -115.3, 40.4, -115.5], 600, 400, 1200, .9], [[39.3, -114.2, 38.8, -114.3], 500, 420, 1200, .9], [[39.5, -117.3, 38.8, -117.4], 500, 380, 1200, .85], [[40.6, -117.6, 40.2, -117.8], 450, 280, 1100, .8], [[38.4, -116.8, 37.9, -116.5], 450, 320, 1100, .8],
  [[34.5, -112.4, 34, -111.4, 33.7, -110.8, 33.6, -109.6, 33.4, -108.4], 1300, 280, 1300, .8], [[32.6, -110.8, 32.4, -110.7], 500, 380, 1000, .9], [[31.9, -109.3, 31.6, -109.2], 450, 280, 1000, .8], [[35.3, -111.7, 35.35, -111.65], 500, 420, 1300, .7], [[35.3, -106.4, 34.8, -106.4], 450, 300, 1000, .8], [[33.6, -105.7, 32.9, -105.6, 32, -105, 31.9, -104.8], 700, 300, 1200, .8], [[30.7, -104.1, 30.5, -104.2], 600, 260, 1200, .8], [[29.3, -103.3, 29.2, -103.2], 500, 300, 1000, .9],
  [[44.4, -103.9, 43.9, -103.7, 43.5, -103.6], 900, 270, 1200, .75],
  [[34.8, -98.7, 34.75, -98.5], 330, 90, 700, .55], [[34.7, -95.6, 34.6, -94.6, 34.6, -93.6], 1100, 130, 1100, .45], [[35.9, -94, 35.9, -93, 35.9, -92.4], 1400, 110, 1000, .4], [[37.4, -91.3, 37, -90.8], 1100, 70, 900, .35],
  [[46.4, -68.9, 45.4, -70.2, 44.5, -71.3, 44, -71.6], 1500, 230, 1200, .6], [[44.6, -72.8, 43.5, -73, 42.6, -73.2], 700, 170, 1100, .5], [[44.4, -74.2, 43.8, -74.4], 1500, 250, 1200, .6], [[42.2, -74.4, 42.0, -74.6], 700, 170, 1000, .5],
  [[41.4, -76, 40.9, -77.5, 40, -78.7, 39, -79.5, 38.3, -80, 37.5, -80.6, 36.8, -81.6], 1700, 150, 1100, .5], [[39.2, -77.9, 38.3, -78.6, 37.4, -79.6, 36.6, -81, 36, -82.2, 35.6, -83.3, 35, -84], 1300, 280, 1200, .6], [[38.5, -80.5, 37.5, -81.8, 36.6, -83, 35.8, -84.6, 34.6, -85.8], 1500, 120, 1000, .5], [[34.8, -84.5, 33.6, -86.3], 800, 90, 900, .4],
  [[31, -108.4, 29, -108, 27, -107, 25, -105.8, 23, -104.8], 2600, 420, 1600, .9], [[27, -101.5, 25.4, -100.4, 23.8, -99.6], 1400, 420, 1400, .9], [[30.5, -115.3, 28.5, -113.5, 26, -111.6], 900, 250, 1200, .8]];
const PEAKS = [[46.85, -121.76, 520, 800], [45.37, -121.7, 420, 700], [41.41, -122.2, 560, 850], [48.78, -121.8, 380, 600], [46.2, -122.18, 300, 600], [44.1, -121.77, 320, 700], [38.84, -105.04, 380, 600]];
// canyon / mesa country: lat, lon, radius(m), strength
const MESA = [[36.9, -110.3, 3600, 1], [38.3, -109.9, 2600, 1], [36.2, -112.4, 2200, .8], [35.8, -108.6, 2200, .7], [35.6, -105, 1600, .55], [34.95, -101.6, 650, .8], [36.95, -104, 1500, .6], [43.8, -102.1, 800, .55], [36.4, -98.7, 500, .35], [46.9, -103.5, 900, .5], [41.7, -103.4, 500, .4]];

function edt(mask, w, h, want) { // squared euclid distance to nearest cell with mask==want (Felzenszwalb)
  const INF = 1e12, f = new Float64Array(w * h), n = Math.max(w, h), v = new Int32Array(n), z = new Float64Array(n + 1), g = new Float64Array(n), d = new Float64Array(n);
  for (let i = 0; i < w * h; i++) f[i] = mask[i] === want ? 0 : INF;
  const pass = (len) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) { let s; do { const r = v[k]; s = (g[q] + q * q - g[r] - r * r) / (2 * q - 2 * r); } while (s <= z[k] && --k > -1); k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
    k = 0; for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const r = v[k]; d[q] = (q - r) * (q - r) + g[r]; }
  };
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) g[y] = f[y * w + x]; pass(h); for (let y = 0; y < h; y++) f[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) g[x] = f[y * w + x]; pass(w); for (let x = 0; x < w; x++) f[y * w + x] = d[x]; }
  return f;
}
function fillPoly(mask, w, h, x0, z0, cell, r, val) { // scanline even-odd
  const n = r.length / 2, xs = [];
  let zmin = 1e9, zmax = -1e9; for (let i = 0; i < n; i++) { zmin = Math.min(zmin, r[i * 2 + 1]); zmax = Math.max(zmax, r[i * 2 + 1]); }
  for (let j = Math.max(0, Math.floor((zmin - z0) / cell)); j < Math.min(h, (zmax - z0) / cell + 1); j++) {
    const z = z0 + (j + .5) * cell; xs.length = 0;
    for (let i = 0, k = n - 1; i < n; k = i++) { const za = r[k * 2 + 1], zb = r[i * 2 + 1]; if ((za > z) !== (zb > z)) xs.push(r[k * 2] + (z - za) / (zb - za) * (r[i * 2] - r[k * 2])); }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) for (let i = Math.max(0, Math.ceil((xs[q] - x0) / cell - .5)); i < w && x0 + (i + .5) * cell <= xs[q + 1]; i++) mask[j * w + i] = val;
  }
}
const segD2 = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz + 1e-9)), ex = px - ax - dx * t, ez = pz - az - dz * t; return ex * ex + ez * ez; };
function polyDist(r, x, z, closed) { let m = 1e18; const n = r.length / 2; for (let i = closed ? 0 : 1, k = closed ? n - 1 : 0; i < n; k = i++) m = Math.min(m, segD2(x, z, r[k * 2], r[k * 2 + 1], r[i * 2], r[i * 2 + 1])); return Math.sqrt(m); }
function inside(r, x, z) { let c = false; const n = r.length / 2; for (let i = 0, k = n - 1; i < n; k = i++) { const za = r[k * 2 + 1], zb = r[i * 2 + 1]; if ((za > z) !== (zb > z) && x < r[k * 2] + (z - za) / (zb - za) * (r[i * 2] - r[k * 2])) c = !c; } return c; }
function bsp(p0, p1, p2, p3, t) { const t2 = t * t, t3 = t2 * t; return .5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); }

// round corners of a polyline then resample at `step`
function roundPoly(p, rad) {
  const n = p.length / 2; if (n < 3) return p; const o = [p[0], p[1]];
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2], z = p[i * 2 + 1]; let ax = p[i * 2 - 2] - x, az = p[i * 2 - 1] - z, bx = p[i * 2 + 2] - x, bz = p[i * 2 + 3] - z;
    const la = Math.sqrt(ax * ax + az * az), lb = Math.sqrt(bx * bx + bz * bz), r = Math.min(rad, la * .46, lb * .46); ax /= la; az /= la; bx /= lb; bz /= lb;
    const N = 14; for (let k = 0; k <= N; k++) { const t = k / N, u = (1 - t) * (1 - t) * r, w = t * t * r; o.push(x + ax * u + bx * w, z + az * u + bz * w); }
  }
  o.push(p[n * 2 - 2], p[n * 2 - 1]); return o;
}
function resample(p, step) {
  const n = p.length / 2; let L = 0; const s = [0]; for (let i = 1; i < n; i++) { const dx = p[i * 2] - p[i * 2 - 2], dz = p[i * 2 + 1] - p[i * 2 - 1]; L += Math.sqrt(dx * dx + dz * dz); s.push(L); }
  const m = Math.max(1, Math.round(L / step)), o = new Float32Array((m + 1) * 2); let k = 1;
  for (let i = 0; i <= m; i++) { const t = L * i / m; while (k < n - 1 && s[k] < t) k++; const f = (t - s[k - 1]) / Math.max(1e-9, s[k] - s[k - 1]); o[i * 2] = lerp(p[k * 2 - 2], p[k * 2], f); o[i * 2 + 1] = lerp(p[k * 2 - 1], p[k * 2 + 1], f); }
  return o;
}

export function buildWorldData() {
  const N = GX * GZ, data = { v: 1 };
  // ---- cities
  const cities = [];
  const addCity = (c, town) => { const p = toWorld(c[2], c[3]), pop = c[4]; cities.push({ name: c[0].replace(' ME', ''), key: c[0], state: c[0] === 'Washington' ? 'D.C.' : c[1], x: Math.round(p.x), z: Math.round(p.z), pop: pop * 1000, town, radius: town ? clamp(130 + Math.sqrt(pop) * 22, 150, 420) : clamp(300 + Math.sqrt(pop) * 17, 380, 1150) }); };
  G.CITIES.forEach((c) => addCity(c, false)); G.TOWNS.forEach((c) => addCity(c, true));
  for (const a of cities) for (const b of cities) if (a !== b) { const d = Math.hypot(a.x - b.x, a.z - b.z), tot = a.radius + b.radius + 160; if (tot > d) { const k = Math.max(.3, (d - 160) / (a.radius + b.radius)); a.radius *= k; b.radius *= k; } }
  for (const c of cities) c.radius = Math.round(Math.max(110, c.radius));
  data.cities = cities; const byName = new Map(cities.map((c) => [c.key, c]));

  // ---- land SDF (100 m raster)
  const W2 = GX * 2, H2 = GZ * 2, mask = new Uint8Array(W2 * H2);
  fillPoly(mask, W2, H2, OX, OZ, CELL / 2, ring(G.US_OUTLINE), 1); for (const r of G.LAND_EXTRA) fillPoly(mask, W2, H2, OX, OZ, CELL / 2, ring(r), 1);
  const dIn = edt(mask, W2, H2, 0), dOut = edt(mask, W2, H2, 1), sdf2 = new Float32Array(W2 * H2);
  for (let i = 0; i < sdf2.length; i++) sdf2[i] = (Math.sqrt(dIn[i]) - Math.sqrt(dOut[i])) * CELL / 2;
  const sdfAt = (x, z) => { let u = (x - OX) / (CELL / 2) - .5, v = (z - OZ) / (CELL / 2) - .5; u = clamp(u, 0, W2 - 1.001); v = clamp(v, 0, H2 - 1.001); const i = u | 0, j = v | 0, a = u - i, b = v - j, k = j * W2 + i; return lerp(lerp(sdf2[k], sdf2[k + 1], a), lerp(sdf2[k + W2], sdf2[k + W2 + 1], a), b); };
  const coast = new Float32Array(N);
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) { const x = OX + i * CELL, z = OZ + j * CELL; coast[j * GX + i] = sdfAt(x + fbm(x / 1700, z / 1700, 3, 91) * 420, z + fbm(x / 1700, z / 1700, 3, 95) * 420); }
  data.coast = coast;

  // ---- lakes
  const lakes = G.LAKES.map(([name, level, r]) => { const R = ring(r); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < R.length; i += 2) { x0 = Math.min(x0, R[i]); x1 = Math.max(x1, R[i]); z0 = Math.min(z0, R[i + 1]); z1 = Math.max(z1, R[i + 1]); } return { name, level, ring: R, x0, x1, z0, z1 }; });
  data.lakes = lakes; const lakeD = new Float32Array(N).fill(9999), lakeI = new Uint8Array(N).fill(255);
  lakes.forEach((L, li) => {
    const M = 1600; for (let j = Math.max(0, Math.floor((L.z0 - M - OZ) / CELL)); j <= Math.min(GZ - 1, (L.z1 + M - OZ) / CELL); j++) for (let i = Math.max(0, Math.floor((L.x0 - M - OX) / CELL)); i <= Math.min(GX - 1, (L.x1 + M - OX) / CELL); i++) {
      const x = OX + i * CELL, z = OZ + j * CELL, s = Math.min(1, (L.x1 - L.x0) / 4000), wx = x + fbm(x / 900, z / 900, 3, 51) * 240 * s, wz = z + fbm(x / 900, z / 900, 3, 55) * 240 * s;
      const d = polyDist(L.ring, wx, wz, true) * (inside(L.ring, wx, wz) ? -1 : 1), k = j * GX + i; if (d < lakeD[k]) { lakeD[k] = d; lakeI[k] = li; }
    }
  });
  data.lakeI = lakeI;

  // ---- control point fields on a coarse grid then bicubic
  const CS = 8, CW = Math.ceil(GX / CS) + 4, CH = Math.ceil(GZ / CS) + 4, NF = 7, coarse = new Float32Array(CW * CH * NF), cps = CP.map((c) => { const p = toWorld(c[0], c[1]); return [p.x / 1000, p.z / 1000, ...c.slice(2)]; });
  for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
    const x = (OX + (i - 1) * CS * CELL) / 1000, z = (OZ + (j - 1) * CS * CELL) / 1000; let ws = 0; const a = new Float64Array(NF);
    for (const c of cps) { const dx = x - c[0], dz = z - c[1], d2 = dx * dx + dz * dz + 1.2, w = 1 / (d2 * d2); ws += w; for (let f = 0; f < NF; f++) a[f] += w * c[2 + f]; }
    for (let f = 0; f < NF; f++) coarse[(j * CW + i) * NF + f] = a[f] / ws;
  }
  const row = new Float64Array(4), field = (f, gx, gz) => { const u = gx / CS + 1, v = gz / CS + 1, i = u | 0, j = v | 0, a = u - i, b = v - j; for (let q = 0; q < 4; q++) { const k = ((Math.max(0, Math.min(CH - 1, j - 1 + q))) * CW + i) * NF + f; row[q] = bsp(coarse[k - NF], coarse[k], coarse[k + NF], coarse[k + 2 * NF] ?? coarse[k + NF], a); } return bsp(row[0], row[1], row[2], row[3], b); };

  // ---- road polylines (xz only)
  const defs = [], edgeSet = new Set(), nodeOf = (t) => { if (t.includes('@')) t = t.split('@')[1]; if (byName.has(t)) { const c = byName.get(t); return { x: c.x, z: c.z, city: c, key: t }; } const [a, b] = t.split(',').map(Number); if (Number.isNaN(b)) throw new Error('bad road node ' + t); const p = toWorld(a, b); return { x: p.x, z: p.z, key: t }; };
  const addRoute = ([name, seq], kind) => {
    const nodes = seq.split('|').map(nodeOf); let run = [nodes[0]];
    const flush = () => { if (run.length > 1) defs.push({ kind, name: name.replace(/(\d)[A-Z]$/, '$1'), nodes: run }); };
    for (let i = 1; i < nodes.length; i++) { const k = [nodes[i - 1].key, nodes[i].key].sort().join('|'); if (edgeSet.has(k)) { flush(); run = [nodes[i]]; } else { edgeSet.add(k); run.push(nodes[i]); } }
    flush();
  };
  G.INTERSTATES.forEach((r) => addRoute(r, 'interstate')); G.HIGHWAYS.forEach((r) => addRoute(r, 'highway'));
  for (const d of defs) {
    const p = []; d.nodes.forEach((n, i) => {
      if (i) { // gentle wander on long non-plains legs
        const a = d.nodes[i - 1], dx = n.x - a.x, dz = n.z - a.z, L = Math.hypot(dx, dz), hilly = d.kind === 'interstate' ? .6 : .35, m = Math.floor(L / 900);
        for (let k = 1; k < m; k++) { const t = k / m, x = a.x + dx * t, z = a.z + dz * t, e = Math.sin(Math.PI * t), o = fbm(x / 2600, z / 2600, 2, 33) * 420 * hilly * Math.min(1, L / 4000) * e; p.push(x - dz / L * o, z + dx / L * o); }
      }
      p.push(n.x, n.z);
    });
    d.pts = resample(roundPoly(p, d.kind === 'interstate' ? 700 : 380), 24);
  }
  // corridor distance (mountain passes)
  const rmask = new Uint8Array(N); for (const d of defs) for (let i = 0; i < d.pts.length; i += 2) { const gx = Math.round((d.pts[i] - OX) / CELL), gz = Math.round((d.pts[i + 1] - OZ) / CELL); if (gx >= 0 && gz >= 0 && gx < GX && gz < GZ) rmask[gz * GX + gx] = 1; }
  const rd = edt(rmask, GX, GZ, 1);

  // ---- macro
  const mac = new Float32Array(N * 4), forest = new Float32Array(N), arid = new Float32Array(N), farm = new Float32Array(N), corn = new Float32Array(N), red = new Float32Array(N), swamp = new Float32Array(N), urban = new Float32Array(N), range = new Float32Array(N), rgh = new Float32Array(N);
  RANGES.forEach(([pl, hw, H, wl, ro], ri) => {
    const r = ring(pl); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); }
    const M = hw * 1.5; for (let j = Math.max(0, Math.floor((z0 - M - OZ) / CELL)); j <= Math.min(GZ - 1, (z1 + M - OZ) / CELL); j++) for (let i = Math.max(0, Math.floor((x0 - M - OX) / CELL)); i <= Math.min(GX - 1, (x1 + M - OX) / CELL); i++) {
      const x = OX + i * CELL, z = OZ + j * CELL, k = j * GX + i, wx = x + fbm(x / 1500, z / 1500, 2, 7) * hw * .5, wz = z + fbm(x / 1500, z / 1500, 2, 8) * hw * .5, w = 1 - sst(.12, 1.25, polyDist(r, wx, wz, false) / hw);
      if (w <= 0) continue; const pass = lerp(.22, 1, sst(250, 1500, Math.sqrt(rd[k]) * CELL)), rr = ridged(x / wl, z / wl, 3, 300 + ri);
      range[k] = Math.max(range[k], w * H * (.28 + .95 * rr * (.45 + .55 * w)) * pass); rgh[k] = Math.max(rgh[k], w * ro * lerp(.35, 1, pass));
    }
  });
  for (const [la, lo, H, r] of PEAKS) { const p = toWorld(la, lo); for (let j = Math.floor((p.z - r * 2 - OZ) / CELL); j < (p.z + r * 2 - OZ) / CELL; j++) for (let i = Math.floor((p.x - r * 2 - OX) / CELL); i < (p.x + r * 2 - OX) / CELL; i++) { if (i < 0 || j < 0 || i >= GX || j >= GZ) continue; const k = j * GX + i, dx = OX + i * CELL - p.x, dz = OZ + j * CELL - p.z, t = clamp(1 - Math.sqrt(dx * dx + dz * dz) / (r * 1.6)), pass = lerp(.2, 1, sst(200, 1200, Math.sqrt(rd[k]) * CELL)); range[k] += H * t * t * pass; rgh[k] = Math.max(rgh[k], t * .8); } }
  const mesaC = MESA.map(([la, lo, r, s]) => { const p = toWorld(la, lo); return [p.x, p.z, r, s]; });
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
    const k = j * GX + i, x = OX + i * CELL, z = OZ + j * CELL, c = coast[k], ld = lakeD[k], cor = Math.sqrt(rd[k]) * CELL;
    let h = Math.max(6, field(0, i, j) * .105 + 5); const ar = clamp(field(2, i, j));
    // basin & range texture in the arid west
    const west = sst(-20000, -27000, x) * ar; if (west > 0) { const st = ridged(x / 1500 + gnoise(x / 6000, z / 6000, 4) * .8, z / 5200, 2, 21); const b = sst(.42, .78, st) * west * lerp(.25, 1, sst(200, 1100, cor)); range[k] = Math.max(range[k], b * 150); rgh[k] = Math.max(rgh[k], b * .75); }
    let fo = clamp(field(1, i, j) + fbm(x / 2600, z / 2600, 3, 61) * .35), fa = clamp(field(3, i, j)), sw = clamp(field(6, i, j));
    const mt = sst(40, 180, range[k]); fo = clamp(fo + mt * lerp(.5, .12, ar)); fa *= 1 - sst(15, 70, range[k]); sw *= 1 - mt;
    h += range[k]; h += gnoise(x / 5200, z / 5200, 11) * Math.min(6, h * .12) + gnoise(x / 2400, z / 2400, 12) * Math.min(5, h * .1);
    // land vs sea
    const inl = sst(-60, 1500 + h * 2, c); if (c > 0) h = lerp(1.2 + Math.min(c * .012, 5), h, inl); else h = Math.max(-45, c * .03 - .6);
    if (ld < 1500) { const L = lakes[lakeI[k]].level; h = ld > 0 ? lerp(L + .9 + ld * .008, Math.max(h, L + 2.5), sst(0, 1400, ld)) : Math.max(L - 30, L + ld * .03 - .6); }
    let m = 0; for (const q of mesaC) { const dx = x - q[0], dz = z - q[1], d = Math.sqrt(dx * dx + dz * dz) / q[2]; if (d < 1.2) m = Math.max(m, q[3] * (1 - sst(.55, 1.2, d + gnoise(x / 1100, z / 1100, 77) * .3))); }
    m *= sst(90, 600, cor) * sst(0, 500, c);
    let ur = 0; for (const ct of cities) { const dx = x - ct.x, dz = z - ct.z, lim = ct.radius * 1.5; if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue; ur = Math.max(ur, 1 - sst(.8, 1.4, Math.sqrt(dx * dx + dz * dz) / ct.radius)); }
    const near = Math.min(c > 0 ? c : 0, ld > 0 ? ld : 0);
    mac[k * 4] = h; mac[k * 4 + 1] = rgh[k] * (1 - ur * .9) * sst(0, 400, near); mac[k * 4 + 2] = m * (1 - ur);
    mac[k * 4 + 3] = lerp(1, .2, ur) * sst(100, 900, near) * lerp(1, 1.5, clamp(fo)) * lerp(1, .35, sw) * lerp(.8, 1, clamp(field(1, i, j) * 2 + ar));
    forest[k] = fo * (1 - ur * .8); arid[k] = ar; farm[k] = fa * (1 - ur); corn[k] = clamp(field(4, i, j)); red[k] = clamp(field(5, i, j)); swamp[k] = sw; urban[k] = ur;
  }
  // city pads: flatten the macro under cities
  for (const ct of cities) { const R = ct.radius * 1.5; let sum = 0, n = 0; const it = (fn) => { for (let j = Math.max(0, Math.floor((ct.z - R - OZ) / CELL)); j <= Math.min(GZ - 1, (ct.z + R - OZ) / CELL); j++) for (let i = Math.max(0, Math.floor((ct.x - R - OX) / CELL)); i <= Math.min(GX - 1, (ct.x + R - OX) / CELL); i++) fn(j * GX + i, Math.hypot(OX + i * CELL - ct.x, OZ + j * CELL - ct.z) / ct.radius); }; it((k, d) => { if (d < 1 && coast[k] > 150 && lakeD[k] > 150) { sum += mac[k * 4]; n++; } }); if (n) { const a = Math.max(3, sum / n); it((k, d) => { if (coast[k] > 0 && lakeD[k] > 0) mac[k * 4] = lerp(mac[k * 4], a, (1 - sst(.7, 1.5, d)) * .85 * sst(0, 400, Math.min(coast[k], lakeD[k]))); }); } }
  data.mac = mac;

  // ---- rivers
  const samp0 = makeSampler({ ...data, rivSeg: null, roads: null }), rivers = [];
  for (const [name, width, canyon, a] of G.RIVERS) {
    const base = resample(roundPoly(ring(a), 600), 60), n = base.length / 2, p = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1); let dx = base[i1 * 2] - base[i0 * 2], dz = base[i1 * 2 + 1] - base[i0 * 2 + 1]; const l = Math.hypot(dx, dz) || 1, e = Math.min(1, Math.min(i, n - 1 - i) / 12), o = (gnoise(i * .055, 3.7, 400 + rivers.length) * 170 + gnoise(i * .16, 1.2, 430 + rivers.length) * 55) * e; p[i * 2] = base[i * 2] - dz / l * o; p[i * 2 + 1] = base[i * 2 + 1] + dx / l * o; }
    const pts = resample(Array.from(p), 40), m = pts.length / 2, y = new Float32Array(m), w = new Float32Array(m); let prev = 1e9;
    for (let i = 0; i < m; i++) { const x = pts[i * 2], z = pts[i * 2 + 1]; let g = 1e9; for (let q = -2; q <= 2; q++) g = Math.min(g, samp0.macroAt(x + q * 90, z), samp0.macroAt(x, z + q * 90)); const cy = canyon ? canyon * 95 * sst(0, 40, i) * sst(0, 60, m - 1 - i) * clamp(samp0.mesaRaw(x, z) * 1.3 + .12) : 0; prev = Math.min(prev, g - 3.2 - cy); y[i] = prev; w[i] = width * (.45 + .55 * sst(0, m * .6, i)) * (1 + gnoise(i * .07, 9, 5) * .25); }
    let end = 0; const ex = pts[m * 2 - 2], ez = pts[m * 2 - 1]; if (samp0.coastAt(ex, ez) > 300) { let bd = 900 * 900; end = y[m - 1]; for (const r of rivers) for (let i = 0; i < r.y.length; i++) { const dx = r.pts[i * 2] - ex, dz = r.pts[i * 2 + 1] - ez, d = dx * dx + dz * dz; if (d < bd) { bd = d; end = r.y[i]; pts[m * 2 - 2] = r.pts[i * 2]; pts[m * 2 - 1] = r.pts[i * 2 + 1]; } } }
    for (let i = 0; i < m; i++) { y[i] = Math.max(y[i], end + (m - 1 - i) * .012); const t = sst(m * .75, m - 1, i); y[i] = lerp(y[i], end + (m - 1 - i) * .012, t); }
    for (let i = 1; i < m; i++) y[i] = Math.min(y[i], y[i - 1]); for (let q = 0; q < 3; q++) for (let i = 1; i < m - 1; i++) y[i] = (y[i - 1] + y[i] * 2 + y[i + 1]) / 4;
    rivers.push({ name, width, canyon, pts, y, w });
  }
  // valley carve into macro + riparian forest
  for (const r of rivers) for (let i = 0; i < r.y.length; i += 2) {
    const x = r.pts[i * 2], z = r.pts[i * 2 + 1], R = r.canyon ? 900 : 620, gi = Math.round((x - OX) / CELL), gj = Math.round((z - OZ) / CELL), q = Math.ceil(R / CELL);
    for (let j = gj - q; j <= gj + q; j++) for (let k = gi - q; k <= gi + q; k++) { if (j < 0 || k < 0 || j >= GZ || k >= GX) continue; const c = j * GX + k; if (coast[c] < 0 || lakeD[c] < 0) continue; const dx = OX + k * CELL - x, dz = OZ + j * CELL - z, d = Math.sqrt(dx * dx + dz * dz); if (d > R) continue; const floor = r.y[i] + 2.6, cap = floor + (r.canyon > .3 ? Math.max(0, d - 150) * .5 : Math.max(0, d - 220) * .05); if (mac[c * 4] > cap) mac[c * 4] = lerp(cap, mac[c * 4], sst(R * .6, R, d)); if (d < 420) { mac[c * 4] = Math.max(mac[c * 4], floor); mac[c * 4 + 3] = Math.min(mac[c * 4 + 3], lerp(.12, 1, sst(150, 420, d))); mac[c * 4 + 1] *= sst(60, 420, d); mac[c * 4 + 2] *= sst(120, 420, d); } if (d < 300) forest[c] = Math.max(forest[c], .35 * (1 - d / 300) * lerp(1, .35, arid[c])); }
  }
  data.rivers = rivers;
  // river segment index
  { let n = 0; for (const r of rivers) n += r.y.length - 1; const S = new Float32Array(n * 8); let o = 0; for (const r of rivers) for (let i = 0; i + 1 < r.y.length; i++, o += 8) { S[o] = r.pts[i * 2]; S[o + 1] = r.pts[i * 2 + 1]; S[o + 2] = r.pts[i * 2 + 2]; S[o + 3] = r.pts[i * 2 + 3]; S[o + 4] = r.y[i]; S[o + 5] = r.y[i + 1]; S[o + 6] = r.w[i] / 2; S[o + 7] = r.w[i + 1] / 2; } data.rivSeg = S; data.rivIdx = csr(n, (k, f) => f(S[k * 8], S[k * 8 + 1], S[k * 8 + 2], S[k * 8 + 3], S[k * 8 + 6] + 96)); }

  // ---- biome texture fields (RGBA8 x2)
  const bioA = new Uint8Array(N * 4), bioB = new Uint8Array(N * 4), u8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let k = 0; k < N; k++) { bioA[k * 4] = u8(forest[k]); bioA[k * 4 + 1] = u8(arid[k]); bioA[k * 4 + 2] = u8(red[k]); bioA[k * 4 + 3] = u8(urban[k]); bioB[k * 4] = u8(swamp[k]); bioB[k * 4 + 1] = u8(mac[k * 4 + 1]); bioB[k * 4 + 2] = u8(mac[k * 4 + 2]); bioB[k * 4 + 3] = u8(clamp(coast[k] / 2400 + .5)); }
  data.bioA = bioA; data.bioB = bioB;

  // ---- states raster
  const st = new Uint8Array(N); G.STATES.forEach(([, r], i) => fillPoly(st, GX, GZ, OX - CELL / 2, OZ - CELL / 2, CELL, ring(r), i + 1));
  const usm = new Uint8Array(N); fillPoly(usm, GX, GZ, OX - CELL / 2, OZ - CELL / 2, CELL, ring(G.US_OUTLINE), 1);
  for (let pass = 0; pass < 14; pass++) { const src = st.slice(); for (let j = 1; j < GZ - 1; j++) for (let i = 1; i < GX - 1; i++) { const k = j * GX + i; if (!src[k] && usm[k]) st[k] = src[k - 1] || src[k + 1] || src[k - GX] || src[k + GX]; } }
  for (let k = 0; k < N; k++) if (!usm[k]) st[k] = 0;
  data.stateGrid = st; data.stateNames = G.STATES.map((s) => s[0]); data.usMask = usm;

  // ---- roads with profiles
  buildRoads(data, defs, { farm, forest, arid, corn, red });
  data.defs = undefined; data.t = 0; return data;
}

function csr(n, each) {
  const cnt = new Int32Array(RGX * RGZ + 1);
  const cells = (k, fn) => each(k, (ax, az, bx, bz, m) => {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - m - ROX) / RC)), i1 = Math.min(RGX - 1, Math.floor((Math.max(ax, bx) + m - ROX) / RC)), j0 = Math.max(0, Math.floor((Math.min(az, bz) - m - ROZ) / RC)), j1 = Math.min(RGZ - 1, Math.floor((Math.max(az, bz) + m - ROZ) / RC));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const cx = ROX + (i + .5) * RC, cz = ROZ + (j + .5) * RC; if (segD2(cx, cz, ax, az, bx, bz) < (m + RC * .71) * (m + RC * .71)) fn(j * RGX + i); }
  });
  for (let k = 0; k < n; k++) cells(k, (c) => cnt[c + 1]++);
  for (let i = 0; i < RGX * RGZ; i++) cnt[i + 1] += cnt[i];
  const ref = new Int32Array(cnt[RGX * RGZ]), pos = cnt.slice(); for (let k = 0; k < n; k++) cells(k, (c) => { ref[pos[c]++] = k; });
  return { off: cnt, ref };
}
export const KINDS = ['interstate', 'highway', 'street', 'gravel'];
const HW = { interstate: 10.2, highway: 5.2, street: 5, gravel: 3.6 }, SH = { interstate: 2.5, highway: 2, street: 2.5, gravel: 1.2 }, INF = { interstate: 100, highway: 90, street: 34, gravel: 34 };
const SMOOTH = { interstate: 11, highway: 8, street: 2, gravel: 3 }, GMAX = { interstate: .06, highway: .075, street: .1, gravel: .1 }, DEVMAX = { interstate: 6, highway: 5, street: 2, gravel: 2.5 };

function buildRoads(data, defs, F) {
  const roads = [], cities = data.cities, sampG = makeSampler({ ...data, roads: null });
  // incremental index while building
  const inc = new Map(), tmp = { y: 0, w: 0, d: 0 };
  const addInc = (r) => { const p = r.pts, m = r.hw + r.sh + 20; for (let i = 0; i + 1 < p.length / 2; i++) { const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3]; for (let cj = Math.floor((Math.min(az, bz) - m) / RC); cj <= Math.floor((Math.max(az, bz) + m) / RC); cj++) for (let ci = Math.floor((Math.min(ax, bx) - m) / RC); ci <= Math.floor((Math.max(ax, bx) + m) / RC); ci++) { const key = cj * 4096 + ci; let a = inc.get(key); if (!a) inc.set(key, a = []); a.push(r, i); } } };
  const ryAt = (r, i, t) => { const L = r.s[i + 1] - r.s[i]; return herm(r.y[i], r.y[i + 1], r.m[i] * L, r.m[i + 1] * L, t); };
  const nearInc = (x, z, o) => { // closest earlier road; o.y crowned surface height there, o.d dist to axis, o.w half width, o.br bridge there
    o.d = 1e9; o.r = null; const a = inc.get(Math.floor(z / RC) * 4096 + Math.floor(x / RC)); if (!a) return o;
    for (let q = 0; q < a.length; q += 2) { const r = a[q], i = a[q + 1], p = r.pts, ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)), ex = x - ax - dx * t, ez = z - az - dz * t, d = Math.sqrt(ex * ex + ez * ez); if (d - r.hw < o.d - o.w || !o.r) { o.d = d; o.w = r.hw; o.y = ryAt(r, i, t) - CROWN * Math.min(d, r.hw); o.br = r.br[i] | r.br[i + 1]; o.r = r; const l = Math.sqrt(dx * dx + dz * dz); o.dx = dx / l; o.dz = dz / l; o.x = ax + dx * t; o.z = az + dz * t; } }
    return o;
  };
  // highest-class earlier road whose surface meets a road of half width hw at (x,z)
  const pinInc = (x, z, hw, o) => {
    o.r = null; const a = inc.get(Math.floor(z / RC) * 4096 + Math.floor(x / RC)); if (!a) return o; let bk = 9, bd = 1e9;
    for (let q = 0; q < a.length; q += 2) { const r = a[q], i = a[q + 1], p = r.pts, ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)), ex = x - ax - dx * t, ez = z - az - dz * t, d = Math.sqrt(ex * ex + ez * ez);
      if (d >= r.hw + hw + 2 || r.k > bk || (r.k === bk && d >= bd)) continue; bk = r.k; bd = d; o.r = r; o.i = i; o.d = d; o.w = r.hw; o.y = ryAt(r, i, t) - CROWN * Math.min(d, r.hw); o.br = r.br[i] | r.br[i + 1]; o.x = ax + dx * t; o.z = az + dz * t; const l = Math.sqrt(dx * dx + dz * dz) || 1; o.dx = dx / l; o.dz = dz / l; o.m = r.m[i] + (r.m[i + 1] - r.m[i]) * t; }
    return o;
  };
  // Vertical profile: smoothed ground -> bridge clearance -> grade limit -> junction pins (blended over a distance that keeps
  // the extra grade small) -> constrained relaxation -> C1 Hermite tangents (sampler and mesh evaluate the same cubic).
  const finish = (r) => {
    const p = r.pts, n = p.length / 2, br = new Uint8Array(n), sm = SMOOTH[r.kind], G = GMAX[r.kind], g = new Float32Array(n), pinY = new Float32Array(n), pin = new Uint8Array(n), pinM = new Float32Array(n), wlv = new Float32Array(n).fill(-1e9), lo = new Float32Array(n).fill(-1e9), s = new Float32Array(n);
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
    const ds = n > 1 ? s[n - 1] / (n - 1) : 24;
    for (let i = 0; i < n; i++) {
      const x = p[i * 2], z = p[i * 2 + 1], gr = sampG.groundAt(x, z), wl = sampG.waterLevelAt(x, z); g[i] = gr;
      if (wl > gr - .4 && wl < gr + 6) { br[i] = 1; g[i] = wl + 5.5; wlv[i] = wl; } // deeper water is a river-profile artefact: ignore
      pinInc(x, z, r.hw + ds * .5, tmp); if (tmp.r) {
        const dy = tmp.y - gr, o = tmp.r;
        if (tmp.br && !br[i] && dy > 5.5) continue; // passes under an existing bridge
        void o; // heightAt is single-valued: no under/overpasses, every crossing is an at-grade junction
        pin[i] = 1; pinY[i] = tmp.y; { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), ux = p[b * 2] - p[a * 2], uz = p[b * 2 + 1] - p[a * 2 + 1], l = Math.hypot(ux, uz) || 1; pinM[i] = tmp.m * (ux * tmp.dx + uz * tmp.dz) / l; } // our slope across the owner = its slope projected on our direction
      }
    }
    const relax = (a, passes, fixed) => { for (let k = 0; k < passes; k++) for (let i = 1; i < n - 1; i++) { if (fixed && fixed[i]) continue; const v = (a[i - 1] + a[i] * 2 + a[i + 1]) / 4; a[i] = v > lo[i] ? v : lo[i]; } };
    for (let pass = 0; pass < 2; pass++) { const o = g.slice(); for (let i = 0; i < n; i++) { let a = 0, w = 0; for (let k = -sm; k <= sm; k++) { const q = clamp(i + k, 0, n - 1), ww = sm + 1 - Math.abs(k); a += o[q] * ww; w += ww; } g[i] = a / w; } }
    for (let i = 0; i < n; i++) if (wlv[i] > -1e8) { const top = wlv[i] + 4; for (let dir = -1; dir <= 1; dir += 2) for (let q = i; q >= 0 && q < n; q += dir) { const v = top - Math.abs(s[q] - s[i]) * G * .7; if (v <= g[q]) break; if (v > lo[q]) lo[q] = v; } } // bridge clearance ramps that end on the profile
    for (let i = 0; i < n; i++) if (g[i] < lo[i]) g[i] = lo[i];
    relax(g, 2); const g0 = g.slice(), DEV = DEVMAX[r.kind];
    for (let it = 0; it < 40; it++) { // grade limit: spread excess climb to both ends of a too-steep step, but stay within DEV of the smoothed ground
      let ex = 0; for (let i = 0; i + 1 < n; i++) { const L = s[i + 1] - s[i], d = g[i + 1] - g[i], e = Math.abs(d) - G * L; if (e > 0) { const h = e * .5 * Math.sign(d); g[i] += h; g[i + 1] -= h; ex = Math.max(ex, e); } }
      relax(g, 1); for (let i = 0; i < n; i++) { const v = Math.min(g0[i] + DEV, Math.max(g0[i] - DEV, g[i])); g[i] = v > lo[i] ? v : lo[i]; } if (ex < .02) break;
    }
    const y = g.slice(), pj = []; for (let i = 0; i < n; i++) if (pin[i]) pj.push(i);
    if (pj.length) {
      const num = new Float32Array(n), den = new Float32Array(n), wmx = new Float32Array(n);
      for (const j of pj) { const b = pinY[j] - g[j], F = Math.min(48, Math.max(4, Math.ceil(1.6 * Math.abs(b) / (G * ds)))); for (let i = Math.max(0, j - F); i <= Math.min(n - 1, j + F); i++) { const w = 1 - sst(0, F + 1, Math.abs(i - j)), om = w / (1.0001 - w); num[i] += b * om; den[i] += om; if (w > wmx[i]) wmx[i] = w; } }
      for (let i = 0; i < n; i++) if (den[i] > 0) y[i] = g[i] + num[i] / den[i] * wmx[i];
      for (const j of pj) { y[j] = pinY[j]; br[j] = 0; }
      relax(y, 3, pin);
    }
    const m = new Float32Array(n); for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); m[i] = pin[i] ? pinM[i] : b > a ? (y[b] - y[a]) / (s[b] - s[a]) : 0; }
    r.y = y; r.m = m; r.br = br; r.id = roads.length; r.s = s; r.len = s[n - 1]; roads.push(r); addInc(r);
  };
  const mk = (kind, name, pts, blk = 0) => ({ kind, name, pts, hw: HW[kind], sh: SH[kind], k: KINDS.indexOf(kind), blk });
  for (const d of defs) {
    let pts = d.pts; // snap ends onto existing roads
    const o = { w: 0 }; const snap = (x, z) => { nearInc(x, z, o); return o.r ? [o.x, o.z, o.d] : null; };
    const n = pts.length; const a = snap(pts[0], pts[1]), b = snap(pts[n - 2], pts[n - 1]); const ar = Array.from(pts); if (a && a[2] > 2) ar.unshift(a[0], a[1]); if (b && b[2] > 2) ar.push(b[0], b[1]);
    if (ar.length !== n) pts = resample(ar, 24); finish(mk(d.kind, d.name, pts));
  }
  const nMajor = roads.length;
  // city streets
  const o = { w: 0 };
  for (const c of cities) {
    const S = c.town ? 120 : 132, R = c.radius * .96, n = Math.floor(R / S); c.block = S;
    const run = (along) => {
      for (let i = -n; i <= n; i++) {
        let cur = []; const flush = () => { if (cur.length >= 6) finish(mk('street', along ? `${Math.abs(i) + 1}${['th', 'st', 'nd', 'rd'][(Math.abs(i) + 1) % 10 < 4 && !((Math.abs(i) + 1) > 10 && (Math.abs(i) + 1) < 14) ? (Math.abs(i) + 1) % 10 : 0]} St` : i ? `${['Oak', 'Elm', 'Maple', 'Cedar', 'Walnut', 'Pecan', 'Locust', 'Cherry', 'Pine'][Math.abs(i) % 9]} ${i < 0 ? 'Ave' : 'Blvd'}` : 'Main St', new Float32Array(cur), S)); cur = []; };
        for (let t = -n; t < n; t++) {
          let ok = true; const pa = [], u = i * S; for (let q = 0; q <= 4; q++) { const v = (t + q / 4) * S, x = c.x + (along ? v : u), z = c.z + (along ? u : v); if (Math.sqrt(u * u + v * v) > R + 10) ok = false; nearInc(x, z, o); if (o.r && o.r.k < 2 && o.d < o.w + 14 && Math.abs(along ? o.dx : o.dz) > .8) ok = false; if (o.r && o.r.k < 2 && o.d < o.w + 16 && Math.abs(o.y - sampG.groundAt(x, z)) > 3) ok = false; /* no ramps up embanked highways: the street ends short of it */ const wl = sampG.waterLevelAt(x, z); if (wl > -1e8 && wl > sampG.groundAt(x, z) - .5) ok = false; pa.push(x, z); }
          if (!ok || (c.town && hash2(i + 50, t + 50, c.x & 1023) < .12)) { flush(); continue; } if (!cur.length) cur.push(pa[0], pa[1]); for (let q = 1; q <= 4; q++) cur.push(pa[q * 2], pa[q * 2 + 1]);
        } flush();
      }
    }; run(true); run(false);
  }
  // farm sections + gravel grid
  const sec = new Uint8Array(SNX * SNZ * 4), gi = (A, x, z) => A[Math.max(0, Math.min(GZ - 1, Math.round((z - OZ) / CELL))) * GX + Math.max(0, Math.min(GX - 1, Math.round((x - OX) / CELL)))];
  const bad = (x, z) => { const wl = sampG.waterLevelAt(x, z); if (wl > -1e8) return true; if (sampG.coastAt(x, z) < 120) return true; for (const c of cities) if (Math.abs(x - c.x) < c.radius * 1.12 && Math.abs(z - c.z) < c.radius * 1.12 && Math.hypot(x - c.x, z - c.z) < c.radius * 1.12) return true; return false; };
  const plainsness = (x, z) => { const lo = toLatLon(x, z).lon; return sst(-106, -103.5, lo) * (1 - sst(-87, -83, lo)); };
  const inUS = (x, z) => gi(data.usMask, x, z) === 1;
  for (let j = 0; j < SNZ; j++) for (let i = 0; i < SNX; i++) {
    const x0 = (SX0 + i) * SEC, z0 = (SZ0 + j) * SEC, cx = x0 + SEC / 2, cz = z0 + SEC / 2, fa = gi(F.farm, cx, cz), e = (j * SNX + i) * 4, h = (s) => hash2(SX0 + i, SZ0 + j, s); if (sampG.coastAt(cx, cz) < 600 || !inUS(cx, cz)) continue;
    const road = (vert) => {
      if (Math.abs(cx) > 49000 || Math.abs(cz) > 30800) return 0; const mx = vert ? x0 : cx, mz = vert ? cz : z0, p = Math.max(plainsness(mx, mz) * Math.min(1, gi(F.farm, mx, mz) * 1.3 + .12), 0); if (h(vert ? 3 : 4) > p * 1.15) return 0;
      let par = 0; for (let q = 0; q <= 10; q++) { const x = vert ? x0 : x0 + SEC * q / 10, z = vert ? z0 + SEC * q / 10 : z0; if (bad(x, z)) return 0; nearInc(x, z, o); if (o.r && o.r.k < 2 && o.d < o.w + 60 && Math.abs(vert ? o.dz : o.dx) > .8) par++; if (o.r && o.r.k < 2 && o.d < o.w + 12 && Math.abs(o.y - sampG.groundAt(x, z)) > 3.5) return 0; if (Math.abs(sampG.groundAt(x + 20, z) - sampG.groundAt(x - 20, z)) > 9) return 0; if (q && Math.abs(sampG.groundAt(x, z) - sampG.groundAt(vert ? x : x - SEC / 10, vert ? z - SEC / 10 : z)) > 10) return 0; }
      if (par > 2) return 0; const m = Math.round(SEC / 40), pts = new Float32Array((m + 1) * 2); for (let q = 0; q <= m; q++) { pts[q * 2] = vert ? x0 : x0 + SEC * q / m; pts[q * 2 + 1] = vert ? z0 + SEC * q / m : z0; }
      finish(mk('gravel', vert ? `County Rd ${1000 + (SX0 + i) * 10}` : `E ${2000 + (SZ0 + j) * 10} Rd`, pts)); return 1;
    };
    const rw = road(true), rn = road(false); let mode = 0; const c = [1, 1, 1, 1];
    if (h(1) < Math.min(1, fa * 1.25) && gi(F.forest, cx, cz) < .75) {
      const m = h(2), dry = gi(F.arid, cx, cz), co = gi(F.corn, cx, cz); mode = m < .1 ? 1 : m < .3 ? 2 : m < .5 ? 3 : m < .84 ? 4 : dry > .18 ? 5 : 4; if (dry > .2 && h(8) < .3) mode = 5;
      for (let q = 0; q < 4; q++) { const r = h(20 + q), g = h(30 + q); c[q] = r < .12 ? 1 : r < .12 + .62 * (1 - co) ? (g < .5 ? 2 : g < .83 ? 3 : 9) : r < .16 + .62 ? (g < .55 ? 4 : 5) : r < .9 ? (g < .62 ? 6 : 8) : 7; if (mode === 5) c[q] = g < .4 ? 4 : g < .6 ? 2 : g < .8 ? 7 : 3; }
    }
    const farmstead = rw && mode > 0 && h(40) < .36 ? 128 : 0; sec[e] = mode | rw << 3 | rn << 5 | farmstead; sec[e + 1] = c[0] | c[1] << 4; sec[e + 2] = c[2] | c[3] << 4; sec[e + 3] = Math.floor(h(50) * 255);
  }
  data.sec = sec;
  // flatten to typed arrays
  let n = 0; for (const r of roads) n += r.pts.length / 2 - 1; const S = new Float32Array(n * 6), R = new Uint16Array(n), I = new Uint16Array(n), B = new Uint8Array(n); let q = 0;
  for (const r of roads) for (let i = 0; i + 1 < r.pts.length / 2; i++, q++) { const p = r.pts, a = q * 6; S[a] = p[i * 2]; S[a + 1] = p[i * 2 + 1]; S[a + 2] = p[i * 2 + 2]; S[a + 3] = p[i * 2 + 3]; S[a + 4] = r.y[i]; S[a + 5] = r.y[i + 1]; R[q] = r.id; I[q] = i; B[q] = r.br[i] | r.br[i + 1]; }
  if (roads.length > 65535) throw new Error('too many roads');
  for (const r of roads) { r.seg0 = 0; } q = 0; for (const r of roads) { r.seg0 = q; q += r.pts.length / 2 - 1; }
  data.roads = roads; data.nMajor = nMajor; const M = new Float32Array(n * 2); q = 0; for (const r of roads) for (let i = 0; i + 1 < r.pts.length / 2; i++, q++) { const L = r.s[i + 1] - r.s[i]; M[q * 2] = r.m[i] * L; M[q * 2 + 1] = r.m[i + 1] * L; }
  data.seg = { S, R, I, B, M, n }; data.segIdx = csr(n, (k, f) => f(S[k * 6], S[k * 6 + 1], S[k * 6 + 2], S[k * 6 + 3], INF[roads[R[k]].kind]));
}

// Art definitions: one builder per vehicle. Author space f forward, y up, x right.
import { SPECS } from './specs.js';
import { CarKit, ST, rbox, box, cyl, sph, torus, tube, pipe, lathe, extrude, hexa, roundedPath, Surf } from './kit.js';
import { sdBox, sdRound, sdPoly, rim, curve1 } from './mesh.js';
import { lerp, smoothstep, clamp } from '../core/math.js';
void sph; void torus; void extrude; void hexa; void Surf; void sdPoly; void rim; void curve1; void lathe; void box; void sdBox;

const underside = (K, o = {}) => { // axles, exhaust, tank, springs
  const s = K.spec, T = K.trim, wf = -s.wheelbase / 2, wr = s.wheelbase / 2; if (K.lod) return;
  T.add(pipe([-s.trackR / 2 + 0.1, s.R, wr], [s.trackR / 2 - 0.1, s.R, wr], o.axle ?? 0.04, 10), ST.iron); T.add(pipe([-s.trackF / 2 + 0.1, s.R, wf], [s.trackF / 2 - 0.1, s.R, wf], 0.03, 8), ST.iron);
  if (o.live) { T.add(sph(0.15, 12, 8).at(0, s.R, wr), ST.iron); T.add(pipe([0, s.R + 0.04, wr], [0, s.R + 0.12, 0.2], 0.04, 8), ST.iron); for (const x of [-1, 1]) T.add(tube([[x * 0.5, s.R + 0.2, wr - 0.7], [x * 0.52, s.R + 0.06, wr], [x * 0.5, s.R + 0.22, wr + 0.7]], 0.03, 6, 12), ST.iron); }
  for (const z of [wf, wr]) for (const x of [-1, 1]) { T.add(lathe([[0.05, 0], [0.055, 0.28]], 10).at(x * (s.trackF / 2 - 0.22), s.R - 0.02, z), ST.iron); T.add(tube([[x * 0.2, s.R - 0.06, z + 0.2], [x * (s.trackF / 2 - 0.16), s.R - 0.05, z]], 0.025, 6, 4), ST.iron); }
  T.add(tube([[0.15, s.R - 0.05, wf + 0.4], [0.18, s.R - 0.06, 0], [0.3, s.R - 0.04, wr - 0.5], [o.ex ?? 0.55, s.R, wr + 0.5]], 0.035, 8, 24), ST.iron); T.add(rbox(0.7, 0.2, 0.5, 0.06, 2).at(-0.1, s.R + 0.02, wr - 0.75), ST.black);
};

const DEF = {};
// ------------------------------------------------------------------ Prairie Runner: 5-door liftback
DEF.prairie = {
  wheel: { rim: 0.222, style: 'alloy', spokes: 5, color: 0x8e9297, rough: 0.28, dish: 0.018, s0: 0.03, s1: 0.04, hubPad: 0.012, lipW: 0.014, thick: 0.03, blocks: 44,
    hole: (a, r, N, hub, rO) => { const st = Math.PI * 2 / N, u = ((a % st) + st) % st - st / 2, t = clamp((r - hub) / (rO - hub)); const d = Math.abs(u) * r, half = st / 2 * r - lerp(0.03, 0.048, t); const tw = Math.abs(Math.abs(st / 2 - Math.abs(u)) * r) - lerp(0.004, 0.014, smoothstep(0.2, 1, t)); return Math.min(Math.max(d - half, hub + 0.016 - r, r - rO + 0.013), Math.max(tw, hub + 0.06 - r, r - rO + 0.02)); } },
  paint: { metal: 0.6, rough: 0.4 },
  build(K) {
    const C = (K.C = {
      lower: {
        plan: [[2.235, 0], [2.225, 0.3], [2.17, 0.56], [2.04, 0.745], [1.82, 0.838], [1.45, 0.876], [0.9, 0.889], [0, 0.9], [-0.8, 0.899], [-1.4, 0.889], [-1.78, 0.862], [-2.04, 0.79], [-2.165, 0.62], [-2.21, 0.32], [-2.222, 0]], planSmooth: 0.07,
        yc: [[2.24, 0.69], [2.1, 0.735], [1.9, 0.795], [1.6, 0.862], [1.25, 0.918], [0.9, 0.965], [0.5, 1.0], [-1.3, 1.02], [-1.8, 1.045], [-2.05, 1.045], [-2.22, 1.02]],
        ySh: [[2.24, 0.655], [2.1, 0.69], [1.9, 0.745], [1.6, 0.805], [1.25, 0.852], [0.9, 0.885], [0.4, 0.912], [-0.5, 0.938], [-1.4, 0.965], [-1.9, 0.985], [-2.22, 0.985]], crownP: 2.6,
        yBot: [[2.24, 0.195], [1.8, 0.185], [0.8, 0.185], [-0.9, 0.19], [-1.6, 0.21], [-2.22, 0.27]],
        prof: { // t, inset, sigma ; knots: tuck, sill, rocker top, lower door, mid, crease-, crease, upper, shoulder
          S: [[0, 0.16, 0], [0.045, 0.062, 0.025], [0.14, 0.04, 0.02], [0.2, 0.052, 0.02], [0.42, 0.034, 0.06], [0.66, 0.006, 0.02], [0.73, 0.004, 0.008], [0.8, 0.02, 0.02], [0.93, 0.044, 0.03], [1, 0.085, 0.03]],
          F: [[0, 0.2, 0], [0.045, 0.07, 0.02], [0.12, 0.03, 0.02], [0.22, 0.03, 0.03], [0.45, 0.0, 0.04], [0.62, 0.0, 0.03], [0.72, 0.022, 0.02], [0.8, 0.04, 0.03], [0.92, 0.075, 0.03], [1, 0.15, 0.04]],
          R: [[0, 0.22, 0], [0.045, 0.1, 0.02], [0.12, 0.05, 0.02], [0.2, 0.045, 0.02], [0.36, 0.0, 0.03], [0.5, 0.006, 0.02], [0.58, 0.035, 0.02], [0.74, 0.055, 0.03], [0.94, 0.03, 0.012], [1, 0.055, 0.015]],
        }, rows: [2, 2, 2, 3, 4, 2, 2, 2, 3],
        arches: [{ f: 1.34, y: 0.335, r: 0.384, flare: 0.018, fw: 0.006 }, { f: -1.34, y: 0.335, r: 0.384, flare: 0.022, fw: 0.008 }],
        topMod: (f, x, X) => (f > 0.8 ? 0.014 * Math.exp(-(((x - 0.44 - (1.6 - f) * 0.1) / 0.07) ** 2)) * smoothstep(0.8, 1.1, f) * (1 - smoothstep(1.75, 2.1, f)) : 0) + (f < -1.85 ? 0.012 * smoothstep(-1.95, -2.16, f) : 0), capSig: 0.03, spine: [1.85, -1.9],
      },
      house: { base: { fc: 1.06, f0: 0.7, x0: 0.735, f1: -1.74, x1: 0.63, rc: -1.98 }, roof: { fc: 0.2, f0: 0.0, x0: 0.535, f1: -1.02, x1: 0.49, rc: -1.2 }, bowB: 0.052, bowR: 0.035, yr: [[0.25, 1.43], [0, 1.452], [-0.4, 1.474], [-0.8, 1.462], [-1.2, 1.415]], crown: 0.035, bulge: 0.02, bulgeF: 1.5, edge: 0.07, smooth: 4, spine: [-0.05, -0.95] },
      win: { ws: { p0: 0.07, p1: 0.05, t0: 0.03, t1: 0.92, r: 0.07 }, rw: { p0: 0.13, p1: 0.09, t0: 0.12, t1: 0.9, r: 0.08 },
        dlo: [[0.025, 0.06], [0.07, 0.86], [0.2, 0.9], [0.68, 0.9], [0.955, 0.24], [0.93, 0.08]], dloR: 0.04, sideR: 0.03, chrome: true,
        side: [[[0.1, 0.085], [0.11, 0.855], [0.2, 0.87], [0.35, 0.87], [0.36, 0.085]], [[0.395, 0.085], [0.39, 0.87], [0.66, 0.87], [0.71, 0.75], [0.685, 0.085]], [[0.71, 0.085], [0.735, 0.7], [0.925, 0.25], [0.91, 0.1]], [[0.035, 0.085], [0.063, 0.6], [0.08, 0.6], [0.08, 0.085]]] },
    });
    K.lower(); K.house(); const L = K.L, a = K.atlas, S = L.sOf;
    // lamps
    const lampP = [[0.47, 0.585], [0.6, 0.655], [0.86, 0.7], [1.13, 0.725], [1.1, 0.69], [0.92, 0.625], [0.7, 0.58]];
    K.lamp(lampP, 0.012, { depth: 0.075 });
    K.projector(0.66, 0.617, -0.045, 0.028); K.projector(0.78, 0.645, -0.045, 0.026);
    K.strip([[0.5, 0.59], [0.7, 0.592], [0.92, 0.636], [1.08, 0.69]], -0.014, 0.0055, ST.drl); K.strip([[0.86, 0.675], [1.06, 0.706]], -0.02, 0.008, ST.amber);
    const tl = [[L.O.len - 0.42, 0.86], [L.O.len - 0.42, 0.93], [L.O.len - 0.62, 0.955], [L.O.len - 1.02, 0.965], [L.O.len - 1.06, 0.95], [L.O.len - 0.78, 0.83], [L.O.len - 0.62, 0.82]];
    K.lamp(tl, 0.015, { depth: 0.05, lens: 'red' }); const E = L.O.len;
    K.strip([[E - 0.44, 0.915], [E - 0.64, 0.935], [E - 0.98, 0.95]], -0.018, 0.008, ST.tail); K.strip([[E - 0.46, 0.885], [E - 0.62, 0.9], [E - 0.82, 0.91]], -0.02, 0.013, ST.brake); K.strip([[E - 0.6, 0.845], [E - 0.76, 0.86]], -0.02, 0.011, ST.amber); K.strip([[E - 0.44, 0.868], [E - 0.56, 0.87]], -0.02, 0.008, ST.rev);
    // grille, intakes
    K.grille([[0, 0.565], [0, 0.645], [0.34, 0.632], [0.45, 0.6], [0.4, 0.565]], 0.012, { depth: 0.05, bars: 4, frame: { w: 0.007, st: ST.satin } });
    K.grille([[0, 0.27], [0, 0.44], [0.4, 0.44], [0.56, 0.36], [0.5, 0.27]], 0.03, { depth: 0.07, bars: 0, hex: 0.06 });
    K.grille([[0.66, 0.3], [0.64, 0.42], [0.86, 0.46], [0.83, 0.32]], 0.025, { depth: 0.06, bars: 2 }); K.projector(0.74, 0.365, -0.03, 0.024, { st: ST.drl });
    // cladding: lower sill, front splitter, rear diffuser
    a.region((s, y) => { const w = s / E; void w; return Math.max(y - (s < 0.95 ? 0.235 : s > E - 1.05 ? 0.4 - 0.1 * smoothstep(E - 0.4, E - 0.9, s) : 0.222), 0 - 9); }, 0);
    // shut lines
    K.door(0.86, -0.18, { lean0: 0.02, lean1: 0.05 }); K.door(-0.18, -1.0, { lean0: 0.05, lean1: -0.25, cut: true });
    a.line(0, roundedPath([[1.02, 0.5], [1.0, 0.56], [S(1.34) - 0.39, 0.6]], 0.02, false)); a.line(0, [[S(1.72), 0.4], [S(1.74), 0.69]]); a.line(0, [[S(-1.7), 0.36], [S(-1.76), 0.78]]); a.line(0, [[S(-1.76), 0.78], [E - 0.8, 0.775], [E - 0.72, 0.62], [E, 0.62]]); a.line(0, [[E - 0.42, 0.72], [E - 0.43, 1.2]]);
    a.line(0, roundedPath([[S(-1.12), 0.72], [S(-1.28), 0.72], [S(-1.28), 0.87], [S(-1.12), 0.87]].map((p) => [p[0], p[1] - 0.0]), 0.03));
    a.line(1, [[2.16, 0.44], [1.95, 0.66], [1.6, 0.735], [0.75, 0.782]]); a.line(1, [[2.135, 0], [2.14, 0.3], [2.11, 0.5]]); a.line(1, [[-1.95, 0.66], [-2.12, 0.6], [-2.2, 0.5]]);
    K.handle(0.07, 0.8); K.handle(-0.8, 0.82); K.mirror(0.66, 1.005, 0.83); K.innerShell(0.85, -1.8, 0.28); K.finish();
    // cowl panel + wipers + misc
    for (const sx of [1]) K.trim.both(tube([[0.0, L.top(1.06, 0) + 0.002, -1.07], [0.4, L.top(0.97, 0.4) + 0.002, -0.985], [0.7, L.top(0.76, 0.7) - 0.002, -0.765]], 0.016, 6, 14), ST.black); void 0;
    K.wipers(0.98, 1.0); K.plateAt(-2.21, 0.7, 1, 0.08); K.exhaust(0.5, 0.262, -2.03); K.trim.add(rbox(0.1, 0.1, 0.012, 0.02).at(0, 0.605, -2.245, 0, 0, Math.PI / 4), ST.chrome); K.trim.add(rbox(0.06, 0.06, 0.014, 0.012).at(0, 0.83, 2.195, 0, 0, Math.PI / 4), ST.chrome);
    K.trim.add(rbox(0.92, 0.02, 0.14, 0.009, 2).map((p) => { p[1] -= p[0] * p[0] * 0.1; p[2] -= p[0] * p[0] * 0.16; }).at(0, 1.42, 1.2, 0.12, 0, 0), ST.paint); K.trim.add(rbox(0.3, 0.014, 0.012, 0.004).at(0, 1.406, 1.266), ST.brake); K.antenna(0.0, 1.42, -1.1, 0.24, 0.0025);
    K.interior({ f: 0.62, y: 0.955, w: 0.71, floor: 0.27, seatF: -0.18, seatY: 0.5, seatX: 0.36, rearF: -0.84, rvm: [0.2, 1.3] }); underside(K);
    // chase kit: magnetic whip, dash cam, roof anemometer on a small mag mount
    K.antenna(0.46, 1.43, -0.85, 1.05); K.antenna(-0.4, 1.455, -0.75, 0.7); K.anemometer(0.0, 1.462, -0.6, 0.34); K.beacon(-0.3, 1.46, -0.25, ST.barA);
    K.mounts = { roof: [0, 1.47, -0.4], dash: [0, 1.02, 0.55], bed: [0, 0.85, -1.6], driver: [-0.36, 1.135, 0.02] };
  },
};

//@@MORE@@
export const BUILDERS = DEF;
export function buildKit(type, lod) { const K = new CarKit(SPECS[type], {}, lod); DEF[type].build(K); return K; }
void clamp; void cyl; void sdRound;

// Vehicle data. Units SI. Body frame: +x right, +y up, forward = -z. `f` = metres forward of wheelbase centre, y from ground at static ride.
const G4 = [3.6, 2.1, 1.39, 1.0, 0.79, 0.65];
const G6 = [4.17, 2.34, 1.52, 1.14, 0.87, 0.69];
const G8 = [4.7, 3.1, 2.1, 1.67, 1.28, 1.0, 0.84, 0.67];

export const SPECS = {
  prairie: {
    name: 'Prairie Runner', brand: 'Halden', desc: 'Dependable front-drive hatch. Everybody starts somewhere.', price: 0, drive: 'FWD', power: 118, armor: 0.05, topSpeed: 198, slots: 2, color: 0x2f5a78, cls: 'Compact',
    mass: 1390, L: 4.46, W: 1.80, H: 1.475, wheelbase: 2.68, trackF: 1.55, trackR: 1.555, R: 0.325, wheelW: 0.215, cgY: 0.54, cgF: 0.18,
    susp: { fF: 1.3, fR: 1.42, zB: 0.26, zR: 0.46, arbF: 6500, arbR: 3200, bump: 0.085, rc: 0.06 },
    tyre: { mu: 1.0, muLat: 0.98, kp: 0.095, ap: 0.118, sigX: 0.28, sigY: 0.42, slide: 0.8, off: 0.62, load: 0.13 },
    steerMax: 0.6, brake: 9000, brakeF: 0.66, handbrake: 3600,
    engine: { idle: 780, red: 6500, stall: 2300, inertia: 0.17, curve: [[500, 90], [1500, 168], [2500, 208], [4000, 218], [5200, 205], [6200, 172], [7000, 120]] },
    gears: G6, rev: 3.6, final: 3.75, shiftT: 0.28, lsd: 0.15, fuelCap: 50,
    aero: { cd: 0.31, front: 2.2, side: 4.6, top: 6.6, clRoof: 0.3, cs: 0.98, h: 0.7 },
  },
  scout: {
    name: 'Ridgeline Scout', brand: 'Halden', desc: 'All-wheel-drive chase SUV with roof rack, hail guards and room for gear.', price: 28500, drive: 'AWD', power: 221, armor: 0.2, topSpeed: 206, slots: 4, color: 0xb9bcb8, cls: 'SUV',
    mass: 2080, L: 4.86, W: 1.94, H: 1.83, wheelbase: 2.88, trackF: 1.65, trackR: 1.65, R: 0.39, wheelW: 0.265, cgY: 0.70, cgF: 0.12,
    susp: { fF: 1.2, fR: 1.3, zB: 0.26, zR: 0.46, arbF: 9500, arbR: 5500, bump: 0.12, rc: 0.09 },
    tyre: { mu: 0.98, muLat: 0.95, kp: 0.105, ap: 0.135, sigX: 0.32, sigY: 0.5, slide: 0.8, off: 0.85, load: 0.12 },
    steerMax: 0.6, brake: 13500, brakeF: 0.63, handbrake: 5200,
    engine: { idle: 650, red: 6300, stall: 2300, inertia: 0.26, curve: [[500, 180], [1500, 330], [2500, 385], [4000, 405], [5200, 388], [6000, 345], [6800, 250]] },
    gears: G8, rev: 3.8, final: 3.45, shiftT: 0.24, lsd: 0.4, split: 0.42, fuelCap: 78,
    aero: { cd: 0.37, front: 2.85, side: 6.4, top: 7.6, clRoof: 0.28, cs: 1.0, h: 0.86 },
  },
  longhorn: {
    name: 'Longhorn 2500', brand: 'Tallgrass', desc: 'Heavy-duty crew-cab pickup. Bed holds probes, pods and a spare everything.', price: 46000, drive: 'RWD', power: 298, armor: 0.28, topSpeed: 182, slots: 6, color: 0x7a1f1b, cls: 'Pickup',
    mass: 2680, L: 5.95, W: 2.03, H: 1.93, wheelbase: 3.73, trackF: 1.74, trackR: 1.73, R: 0.415, wheelW: 0.285, cgY: 0.76, cgF: 0.42,
    susp: { fF: 1.22, fR: 1.5, zB: 0.26, zR: 0.44, arbF: 14000, arbR: 3000, bump: 0.13, rc: 0.1 },
    tyre: { mu: 0.94, muLat: 0.9, kp: 0.11, ap: 0.145, sigX: 0.34, sigY: 0.55, slide: 0.8, off: 0.85, load: 0.12 },
    steerMax: 0.6, brake: 16500, brakeF: 0.62, handbrake: 6500,
    engine: { idle: 620, red: 5600, stall: 1900, inertia: 0.38, curve: [[500, 330], [1400, 560], [2500, 630], [3800, 620], [4800, 560], [5600, 470], [6200, 300]] },
    gears: G6, rev: 3.4, final: 3.73, shiftT: 0.3, lsd: 0.45, fuelCap: 120,
    aero: { cd: 0.42, front: 3.2, side: 6.8, top: 9.0, clRoof: 0.28, cs: 1.08, h: 0.94 },
  },
  bastion: {
    name: 'Bastion', brand: 'Ironhide Works', desc: 'Armoured interceptor. Drop the skirts, spike the ground and let it come to you.', price: 185000, drive: 'AWD', power: 310, armor: 0.85, topSpeed: 152, slots: 6, color: 0x4a4f4a, cls: 'Interceptor',
    mass: 6350, L: 5.75, W: 2.32, H: 2.28, wheelbase: 3.65, trackF: 1.88, trackR: 1.88, R: 0.5, wheelW: 0.36, cgY: 0.86, cgF: 0.1,
    susp: { fF: 1.35, fR: 1.45, zB: 0.3, zR: 0.5, arbF: 30000, arbR: 22000, bump: 0.12, rc: 0.14 },
    tyre: { mu: 0.92, muLat: 0.88, kp: 0.115, ap: 0.15, sigX: 0.4, sigY: 0.6, slide: 0.82, off: 0.95, load: 0.1 },
    steerMax: 0.56, brake: 40000, brakeF: 0.58, handbrake: 16000,
    engine: { idle: 600, red: 3400, stall: 1500, inertia: 0.9, curve: [[400, 600], [1000, 1080], [1600, 1250], [2400, 1230], [3000, 1030], [3400, 800], [3900, 400]] },
    gears: G6, rev: 4.0, final: 4.5, shiftT: 0.34, lsd: 0.6, split: 0.5, fuelCap: 240,
    aero: { cd: 0.5, front: 4.4, side: 8.6, top: 10.5, clRoof: 0.16, cs: 0.85, h: 1.0 }, anchor: { hold: 130000, cs: 0.5, cl: 0.0 },
  },
  doppler: {
    name: 'Doppler One', brand: 'Tallgrass', desc: 'Mobile X-band radar truck. Slow, top heavy, sees everything.', price: 128000, drive: 'RWD', power: 224, armor: 0.2, topSpeed: 138, slots: 5, color: 0xdfe3e4, cls: 'Radar truck',
    mass: 6900, L: 7.1, W: 2.28, H: 2.45, wheelbase: 4.1, trackF: 1.9, trackR: 1.86, R: 0.44, wheelW: 0.3, cgY: 0.98, cgF: 0.0,
    susp: { fF: 1.45, fR: 1.75, zB: 0.3, zR: 0.5, arbF: 50000, arbR: 60000, bump: 0.12, rc: 0.28 },
    tyre: { mu: 0.86, muLat: 0.82, kp: 0.12, ap: 0.15, sigX: 0.4, sigY: 0.6, slide: 0.82, off: 0.7, load: 0.1 },
    steerMax: 0.62, brake: 40000, brakeF: 0.55, handbrake: 15000, dually: true,
    engine: { idle: 600, red: 3200, stall: 1500, inertia: 0.8, curve: [[400, 480], [1000, 860], [1600, 930], [2400, 900], [2900, 740], [3200, 560], [3700, 300]] },
    gears: G6, rev: 4.2, final: 4.6, shiftT: 0.36, lsd: 0.3, fuelCap: 200, tall: 3.95,
    aero: { cd: 0.68, front: 6.6, side: 13.2, top: 13, clRoof: 0.26, cs: 1.1, h: 1.5 },
  },
  devil: {
    name: 'Dust Devil', brand: 'Corvane', desc: 'V8 rear-drive coupe. Outruns most things that rotate.', price: 64000, drive: 'RWD', power: 358, armor: 0.06, topSpeed: 268, slots: 2, color: 0xb84a12, cls: 'Muscle',
    mass: 1735, L: 4.80, W: 1.93, H: 1.37, wheelbase: 2.74, trackF: 1.62, trackR: 1.65, R: 0.345, wheelW: 0.275, cgY: 0.485, cgF: 0.1,
    susp: { fF: 1.48, fR: 1.55, zB: 0.3, zR: 0.5, arbF: 15000, arbR: 7500, bump: 0.075, rc: 0.06 },
    tyre: { mu: 1.1, muLat: 1.08, kp: 0.09, ap: 0.112, sigX: 0.28, sigY: 0.4, slide: 0.8, off: 0.5, load: 0.12 },
    steerMax: 0.6, brake: 13000, brakeF: 0.62, handbrake: 5200,
    engine: { idle: 720, red: 7000, stall: 2500, inertia: 0.24, curve: [[500, 260], [1500, 440], [2500, 500], [4000, 545], [5200, 538], [6200, 500], [7200, 400]] },
    gears: G6, rev: 3.5, final: 3.55, shiftT: 0.16, lsd: 0.65, fuelCap: 61,
    aero: { cd: 0.36, front: 2.3, side: 4.3, top: 7.2, clRoof: 0.34, cs: 1.0, h: 0.66 },
  },
};
void G4;
export const TYPE_IDS = Object.keys(SPECS);
// public catalogue (contract: {id:{name,desc,price,mass,power,drive,armor,topSpeed,slots,...}})
export const TYPES = Object.fromEntries(TYPE_IDS.map((id) => {
  const s = SPECS[id];
  return [id, { id, name: s.name, brand: s.brand, cls: s.cls, desc: s.desc, price: s.price, mass: s.mass, power: s.power, drive: s.drive, armor: s.armor, topSpeed: s.topSpeed, slots: s.slots, color: s.color, length: s.L, width: s.W, height: s.tall || s.H, anchor: !!s.anchor, fuelCap: s.fuelCap }];
}));

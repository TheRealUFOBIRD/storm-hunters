// Catalogue of everything the layout places. Shared by worker (layout) and main thread (render, colliders, damage). No three.js.
// col: ['cyl', r, h] | ['box', hx, hy, hz] (local, scaled by instance sxz/sy); mass kg; brk: vehicle break speed m/s (0 = never)
// w: [wind m/s for damage level 1, level 2]; lod: [near end, mid end] metres
const D = [];
const add = (name, cls, o) => { D.push({ name, cls, id: D.length, col: null, mass: 100, brk: 0, w: null, lod: [120, 400], debris: name, ...o }); };
const tree = (name, r, h, w, mass) => add(name, 'tree', { col: ['cyl', r, h], mass, brk: mass < 500 ? 9 : 0, w: [w, w + 16], lod: [70, 3200], debris: 'tree' });
tree('oak', .38, 11, 47, 2600); tree('cottonwood', .5, 16, 44, 3800); tree('pine', .32, 17, 46, 2000); tree('spruce', .3, 15, 46, 1800); tree('cedar', .2, 5.5, 50, 350); tree('mesquite', .16, 4.4, 50, 260); tree('palm', .22, 11, 60, 900); tree('dead', .24, 8, 38, 700);
add('shrub', 'plant', { lod: [60, 180], w: [58, 70], debris: 'brush' }); add('cactus', 'plant', { col: ['cyl', .3, 4.5], mass: 900, brk: 10, w: [56, 70], lod: [90, 500], debris: 'brush' });
add('rock', 'rock', { col: ['cyl', 1, 1], mass: 4000, lod: [90, 400] });
add('bale', 'prop', { col: ['cyl', .9, 1.5], mass: 480, brk: 6, w: [52, 60], lod: [90, 500], debris: 'hay' });
add('pole', 'prop', { col: ['cyl', .17, 10.5], mass: 450, brk: 13, w: [48, 60], lod: [130, 1400], debris: 'pole' });
add('fence', 'prop', { col: ['box', 3, .65, .12], mass: 60, brk: 3, w: [50, 62], lod: [80, 350], debris: 'plank' });
add('guardrail', 'prop', { col: ['box', 2, .4, .12], mass: 900, brk: 26, w: [85, 95], lod: [100, 450], debris: 'metal' });
add('mile', 'prop', { col: ['cyl', .06, 1.4], mass: 15, brk: 2.5, w: [50, 60], lod: [90, 220], debris: 'sign' });
add('signGreen', 'sign', { col: ['box', 1.9, 2.6, .12], mass: 220, brk: 9, w: [52, 62], lod: [700, 0], debris: 'sign' });
add('signSmall', 'sign', { col: ['cyl', .08, 2.6], mass: 40, brk: 4, w: [47, 58], lod: [300, 0], debris: 'sign' });
add('turbine', 'land', { col: ['cyl', 2, 80], mass: 2e5, w: [66, 82], lod: [900, 9000], debris: 'metal' });
add('pumpjack', 'prop', { col: ['box', 2.6, 2.2, .9], mass: 9000, w: [75, 88], lod: [200, 1200], debris: 'metal' });
add('waterTower', 'land', { col: ['cyl', 3, 30], mass: 3e5, w: [78, 92], lod: [400, 7000], debris: 'metal' });
add('elevator', 'land', { col: ['box', 14, 16, 6], mass: 1e6, w: [82, 94], lod: [500, 8000], debris: 'concrete' });
add('radioTower', 'land', { col: ['cyl', .9, 90], mass: 9000, w: [62, 74], lod: [500, 6000], debris: 'metal' });
const bld = (name, hx, hy, hz, w1, w2, o = {}) => add(name, 'bld', { col: ['box', hx, hy, hz], mass: 2e5, w: [w1, w2], lod: [180, 2200], debris: 'wood', ...o });
bld('farmhouse', 6, 3.6, 5, 50, 68); bld('barn', 6.5, 4.6, 10, 46, 58); bld('shed', 7, 3.2, 11, 46, 60, { debris: 'metal' }); bld('silo', 2.6, 9, 2.6, 62, 78, { debris: 'metal' }); bld('bin', 3.6, 3.4, 3.6, 50, 62, { debris: 'metal' });
bld('house', 6.5, 2.6, 5, 48, 66); bld('house2', 5.5, 3.6, 5, 49, 68); bld('mobile', 7.2, 1.6, 2.2, 38, 47); bld('church', 5.4, 5, 10, 52, 70); bld('shop', 6, 3.4, 9, 54, 72, { debris: 'brick' }); bld('gas', 9, 2.8, 6, 46, 60, { debris: 'metal' }); bld('motel', 16, 2, 4.2, 48, 64); bld('warehouse', 14, 4, 18, 47, 62, { debris: 'metal' }); bld('apartment', 10, 7, 8, 54, 74, { debris: 'brick' }); bld('office', 12, 12, 11, 66, 92, { debris: 'glass', lod: [300, 5000] });
bld('tower', 14, 50, 14, 74, 999, { debris: 'glass', lod: [700, 14000], cls: 'land' });
// ---- CITIES: town & city kinds. ext=1 -> rendered by buildings.js (merged per sector); scatter keeps colliders, damage, net state.
// Front of every building is local +z. Layout: citygen.js.
const cb = (name, hx, hy, hz, w1, w2, o = {}) => add(name, 'bld', { col: ['box', hx, hy, hz], mass: 2e5, w: [w1, w2], lod: [0, 0], debris: 'house', ext: 1, ...o });
cb('house_ranch', 7, 2.75, 5, 48, 66); cb('house_2st', 5.2, 4.2, 4.4, 49, 68); cb('bungalow', 4.4, 2.8, 5, 46, 64); cb('mobile_home', 8, 1.7, 2.3, 38, 47, { debris: 'trailer', mass: 2e4 });
cb('duplex', 13, 4.1, 6, 50, 70); cb('shop_2st', 4.5, 4.4, 10, 54, 74, { debris: 'store' }); cb('shop_wide', 7, 3.9, 11, 54, 74, { debris: 'store' }); cb('shop_1st', 6, 2.6, 8, 52, 70, { debris: 'store' });
cb('gas_store', 6.5, 2.2, 4.5, 48, 64, { debris: 'gas' }); cb('motel', 18, 2.2, 5.5, 48, 64, { debris: 'motel' }); cb('strip_mall', 22, 2.8, 9, 52, 70, { debris: 'store' }); cb('big_box', 32, 4.6, 24, 55, 76, { debris: 'warehouse' });
cb('church2', 6, 6.2, 12, 52, 70, { debris: 'church' }); cb('school', 26, 4, 13, 56, 78, { debris: 'build' }); cb('warehouse2', 20, 4.6, 14, 50, 66, { debris: 'warehouse' }); cb('factory', 25, 6, 16, 56, 76, { debris: 'warehouse' });
cb('office', 17, 12, 12, 64, 90, { debris: 'office' }); cb('apartment2', 16, 10, 9, 58, 80, { debris: 'build' }); cb('parking_garage', 20, 7.5, 15, 80, 98, { debris: 'office' });
cb('tower2', 17, 50, 17, 72, 999, { debris: 'office', cls: 'land', mass: 5e6 }); cb('tower_slim', 13, 50, 13, 72, 999, { debris: 'office', cls: 'land', mass: 4e6 });
cb('grain_elevator', 15, 17, 6, 82, 94, { debris: 'silo', cls: 'land', mass: 1e6 }); add('water_tower2', 'land', { col: ['cyl', 3.2, 34], mass: 3e5, w: [78, 92], lod: [0, 0], debris: 'tower', ext: 1 });
add('tank', 'land', { col: ['cyl', 7, 12], mass: 2e5, w: [70, 88], lod: [0, 0], debris: 'tank', ext: 1 });
const cpr = (name, col, mass, brk, w, debris) => add(name, 'prop', { col, mass, brk, w, lod: [0, 0], debris, ext: 1 });
cpr('gas_canopy', null, 8000, 0, [44, 58], 'gas'); cpr('street_light', ['cyl', .14, 9], 300, 8, [46, 58], 'pole'); cpr('traffic_light', ['cyl', .2, 7], 600, 14, [52, 64], 'pole');
cpr('hydrant', ['cyl', .2, .85], 120, 3, [80, 99], 'hydrant'); cpr('mailbox', ['cyl', .12, 1.25], 15, 2, [44, 56], 'sign'); cpr('bench', ['box', .9, .45, .3], 60, 3, [52, 62], 'plank');
cpr('trash_can', ['cyl', .3, 1], 30, 2, [44, 56], 'sheet'); cpr('car', ['box', .95, .78, 2.4], 1400, 0, [42, 55], 'car'); cpr('fence_run', ['box', 3, .6, .06], 40, 3, [44, 56], 'fence'); cpr('dumpster', ['box', 1, .7, .9], 900, 0, [55, 68], 'sheet');
add('pavement', 'deco', { lod: [0, 0], ext: 1 }); // flat decal: sxz = width m, sy = length m (no collider, no damage)
export const KIND = D; export const KI = {}; for (const d of D) KI[d.name] = d.id;
export const NTREE = 8, STRIDE = 8; // kind,x,y,z,rotY,sxz,sy,seed
export const SEC_IDS = 8192, SS = 512, SOX = -51200, SOZ = -32768, SGX = 200, SGZ = 128;

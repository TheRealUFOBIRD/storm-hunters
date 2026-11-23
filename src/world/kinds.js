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
export const KIND = D; export const KI = {}; for (const d of D) KI[d.name] = d.id;
export const NTREE = 8, STRIDE = 8; // kind,x,y,z,rotY,sxz,sy,seed
export const SEC_IDS = 8192, SS = 512, SOX = -51200, SOZ = -32768, SGX = 200, SGZ = 128;

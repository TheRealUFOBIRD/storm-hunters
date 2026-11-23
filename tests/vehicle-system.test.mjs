import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Events } from '../src/core/events.js';
import { create } from '../src/vehicles/index.js';
import { create as createPlayer } from '../src/player/index.js';

const A = { type: 'asphalt', grip: 1, wetGrip: 0.7, rollRes: 0.012, bump: 0, dust: 0 };
function mockCtx() {
  const held = {};
  const ctx = {
    events: new Events(), scene: new THREE.Scene(), fxScene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), time: { now: 0, dt: 0, real: 0, hour: 14 }, state: 'playing',
    settings: { get: (k) => ({ mouseSens: 1, invertY: false, fov: 72, cameraShake: 1, units: 'metric' })[k] }, globals: { uWetness: { value: 0 }, uRain: { value: 0 } },
    input: { uiBlock: false, mouse: { dx: 0, dy: 0 }, axis: (n) => (n === 'throttle' ? held.throttle || 0 : n === 'brake' ? held.brake || 0 : n === 'steer' ? held.steer || 0 : n === 'moveY' ? held.moveY || 0 : 0), down: (a) => !!held[a], pressed: (a) => { const p = held['p_' + a]; held['p_' + a] = false; return !!p; }, steerIsAnalog: () => false, held },
    world: { heightAt: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), surfaceAt: () => A, waterLevelAt: () => -Infinity, queryColliders() {}, roads: { nearest: (x, z) => ({ x: 0, z, dist: Math.abs(x), dirX: 0, dirZ: -1, width: 8 }) }, nearestCity: () => ({ name: 'Test' }) },
    storms: { windAt: (x, y, z, o) => o.set(0, 0, 0), tornadoes: [] }, fx: { spawnWheel() {}, spark() {} },
  };
  return ctx;
}
const run = async (ctx, sec, f) => { for (let t = 0; t < sec; t += 1 / 60) { f?.(t); ctx.time.now += 1 / 60; ctx.time.real += 1 / 60; ctx.vehicles.update(1 / 60); ctx.player.update(1 / 60); ctx.player.lateUpdate(1 / 60); } };

test('system: spawn, drive, exit/enter, serialize/apply', async () => {
  const ctx = mockCtx(); ctx.vehicles = await create(ctx); ctx.player = await createPlayer(ctx);
  assert.equal(Object.keys(ctx.vehicles.types).length, 6);
  const v = ctx.vehicles.spawn('scout', 0, 0, 0); ctx.player.enter(v); assert.equal(ctx.player.mode, 'drive');
  ctx.input.held.throttle = 1; await run(ctx, 5); console.log('speed after 5s', (v.speed * 3.6).toFixed(0), 'km/h', 'cam', ctx.camera.position.toArray().map((x) => x.toFixed(1)).join(','));
  assert.ok(v.speed > 15); assert.ok(ctx.camera.position.distanceTo(v.pos) < 12 && ctx.camera.position.distanceTo(v.pos) > 3);
  ctx.input.held.throttle = 0; ctx.input.held.brake = 1; await run(ctx, 2.6); ctx.input.held.brake = 0; await run(ctx, 0.5); assert.ok(Math.abs(v.speed) < 1, 'stopped ' + v.speed);
  assert.ok(ctx.player.exit()); assert.equal(ctx.player.mode, 'foot'); assert.ok(ctx.player.pos.distanceTo(v.body.p) > 0.8);
  ctx.input.held.p_enter = true; await run(ctx, 0.1); assert.equal(ctx.player.mode, 'drive');
  const arr = ctx.vehicles.serializeState(v, []); assert.ok(arr.length === 25 && arr.every(Number.isFinite)); const vis = ctx.vehicles.createVisual('scout'); ctx.vehicles.applyState(vis, arr); assert.ok(vis.object3d.position.distanceTo(v.body.p) < 0.01);
  ctx.vehicles.recover(v); assert.ok(Math.abs(v.body.p.x) < 4);
});
test('player: knocked down and swept by violent wind, then respawns', async () => {
  const ctx = mockCtx(); ctx.vehicles = await create(ctx); ctx.player = await createPlayer(ctx); ctx.player.teleport(30, 0, 0); ctx.player.setMode('foot'); let respawn = 0, swept = 0;
  ctx.events.on('player:respawn', () => respawn++); ctx.events.on('player:swept', () => swept++);
  ctx.storms.windAt = (x, y, z, o) => o.set(28, 0, 0); await run(ctx, 2); assert.equal(ctx.player.mode, 'foot'); const x0 = ctx.player.pos.x; ctx.input.held.moveY = 1; await run(ctx, 2); ctx.input.held.moveY = 0; console.log('walked in 28 m/s crosswind', (ctx.player.pos.x - x0).toFixed(2), 'm drift');
  ctx.storms.windAt = (x, y, z, o) => o.set(75, 25, 0); await run(ctx, 4); assert.equal(swept, 1); assert.equal(ctx.player.mode, 'swept'); console.log('swept to', ctx.player.pos.toArray().map((x) => x.toFixed(0)).join(','), 'health', ctx.player.health.toFixed(2));
  ctx.storms.windAt = (x, y, z, o) => o.set(0, 0, 0); await run(ctx, 30); assert.ok(respawn >= 1 || ctx.player.mode === 'foot'); assert.ok(Number.isFinite(ctx.player.pos.x));
});
test('anchor + wind load field + debris hit', async () => {
  const ctx = mockCtx(); ctx.vehicles = await create(ctx); ctx.player = await createPlayer(ctx); const v = ctx.vehicles.spawn('bastion', 0, 0, 0); ctx.player.enter(v); await run(ctx, 1); assert.ok(v.anchor(true));
  ctx.storms.windAt = (x, y, z, o) => o.set(70, 0, 0); await run(ctx, 5); console.log('bastion windLoad', v.windLoad.toFixed(2), 'anchored', v.anchored); assert.ok(v.windLoad > 0.03 && v.anchored); const u = ctx.vehicles.spawn('prairie', 30, 0, 0); await run(ctx, 3); console.log('sedan windLoad at 70', u.windLoad.toFixed(2)); assert.ok(u.windLoad > 0.5);
  const d0 = v.damage; ctx.events.emit('fx:debris-hit', { v, pos: v.body.p.clone().add(new THREE.Vector3(1, 1, 0)), vel: new THREE.Vector3(-60, 0, 0), mass: 80 }); assert.ok(v.damage > d0);
});

// Scripted end-to-end playtest: node tools/shot.mjs "index.html?autostart" --script tools/playtest.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 60; i++) { if (await ev('window.ctx?.state === "playing" && !!ctx.player.vehicle')) break; await sleep(1000); }
  await sleep(2000);
  console.log('start', await ev('JSON.stringify({fps:ctx.gfx.stats.fps|0, v:ctx.player.vehicle.type})'));
  await ev('ctx.input.inject("throttle", true); ctx.input.inject("forward", true)');
  await sleep(9000);
  console.log('drive', await ev('JSON.stringify({kmh:(ctx.player.vehicle.speed*3.6)|0, gear:ctx.player.vehicle.gear, fps:ctx.gfx.stats.fps|0})'));
  await shot('pt_drive');
  await ev('ctx.input.inject("throttle", false); ctx.input.inject("forward", false); ctx.input.inject("brake", true)');
  await sleep(4000);
  await ev('ctx.input.inject("brake", false)');
  // stage a mature tornado 1.6 km ahead
  await ev(`(() => { const v = ctx.player.vehicle, h = ctx.player.heading ?? 0; const x = v.pos.x + Math.sin(h) * 1600, z = v.pos.z - Math.cos(h) * 1600; ctx.storms.director = false; window.T = ctx.storms.spawnAt(x, z, { ef: 3, stage: 'mature', shape: 'cone', hold: true, still: true }); })()`);
  await sleep(6000);
  console.log('tornado', await ev('JSON.stringify({n:ctx.storms.tornadoes.length, ef:T?.ef, d:Math.hypot(T.x-ctx.player.pos.x,T.z-ctx.player.pos.z)|0, fps:ctx.gfx.stats.fps|0})'));
  await shot('pt_tornado_chase');
  await ev('ctx.player.setCameraMode?.("cockpit")'); await sleep(2500); await shot('pt_tornado_cockpit');
  await ev('ctx.player.setCameraMode?.("chase")');
  // camera tool on foot
  await ev('ctx.player.exit?.()'); await sleep(1500);
  await ev('ctx.input.inject("tool1", true)'); await sleep(200); await ev('ctx.input.inject("tool1", false)'); await sleep(1500);
  await shot('pt_foot_camera');
  // move tornado onto the car
  await ev('ctx.player.enter?.(ctx.vehicles.list[0])'); await sleep(1000);
  await ev(`(() => { const v = ctx.player.vehicle; T.x = v.pos.x + 140; T.z = v.pos.z - 60; })()`);
  await sleep(2500); await shot('pt_close');
  await sleep(5000);
  console.log('swept', await ev('JSON.stringify({mode:ctx.player.mode, y:(ctx.player.vehicle?.pos.y - ctx.world.heightAt(ctx.player.vehicle.pos.x, ctx.player.vehicle.pos.z))|0, swept:ctx.player.vehicle?.swept, dmg:ctx.player.vehicle?.damage, fps:ctx.gfx.stats.fps|0})'));
  await shot('pt_swept');
}

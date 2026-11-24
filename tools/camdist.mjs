const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 160; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  await ev('ctx.storms.director = false; ctx.storms.clear(); ctx.player.setCameraMode("chase")'); await sleep(2000);
  const d = () => ev('JSON.stringify({kmh: (ctx.player.vehicle.speed * 3.6) | 0, dist: ctx.camera.position.distanceTo(ctx.player.vehicle.body.rp).toFixed(2)})');
  console.log('still', await d()); await shot('cam_still');
  await ev('ctx.player.vehicle.body.v.set(0,0,0); ctx.input.inject("throttle", true)');
  for (let i = 0; i < 5; i++) { await sleep(2000); console.log('driving', await d()); }
  await shot('cam_fast');
}

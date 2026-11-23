const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 60; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(1000); }
  await sleep(2000);
  await page.mouse.click(800, 450); await sleep(500);
  const st = () => ev('JSON.stringify([ctx.state, ctx.ui.screen, (ctx.player.vehicle.speed*2.237)|0, ctx.player.vehicle.gear, ctx.player.vehicle.body.rpm|0, +ctx.player.vehicle.body.throttle.toFixed(2), +ctx.player.vehicle.body.brake.toFixed(2), ctx.input.uiBlock, ctx.player.mode])');
  console.log('start', await st());
  const hold = async (k, s, tag) => { await page.keyboard.down(k); for (let i = 0; i < s; i++) { await sleep(1000); console.log(tag, i, await st()); } await page.keyboard.up(k); };
  await hold('KeyW', 6, 'W');
  await hold('KeyS', 5, 'S');
  await hold('KeyW', 5, 'W2');
  await shot('keytest');
}

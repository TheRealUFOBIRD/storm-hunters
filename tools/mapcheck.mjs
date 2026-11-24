const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 160; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  await sleep(3000); await shot('map_minimap');
  await ev('ctx.ui.openScreen("map")'); await sleep(1500);
  await page.mouse.move(800, 440); for (let i = 0; i < 9; i++) { await page.mouse.wheel({ deltaY: -300 }); await sleep(150); }
  await sleep(1500); await shot('map_zoom');
}

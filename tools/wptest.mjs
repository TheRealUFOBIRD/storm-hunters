const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 160; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  await sleep(4000);
  await ev(`(() => { const v = ctx.player.vehicle, h = ctx.player.heading ?? 0; ctx.storms.director = false; ctx.storms.clear(); ctx.gameplay.setWaypoint(v.pos.x + Math.sin(h) * 900, v.pos.z - Math.cos(h) * 900); })()`);
  await sleep(1500); await shot('wp_front');
  await page.keyboard.down('KeyV'); await sleep(1500); await shot('wp_back'); await page.keyboard.up('KeyV');
}

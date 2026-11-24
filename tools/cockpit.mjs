const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 160; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  await ev('ctx.player.setCameraMode("cockpit")'); await sleep(8000);
  console.log(await ev('JSON.stringify({sub: ctx.gameplay.subtitle || null, radioSetting: ctx.settings.get("radio")})'));
  await shot('cockpit');
}

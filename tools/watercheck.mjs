const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 160; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  await ev(`(() => { const c = ctx.world.cities.find(c => c.name === 'Chicago'); const W = ctx.world; let best = null; for (let a = 0; a < 6.28; a += .1) for (let r = 200; r < 4000; r += 100) { const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; if (W.waterLevelAt(x, z) > -1e5) { const x2 = x - Math.cos(a) * 120, z2 = z - Math.sin(a) * 120; if (W.waterLevelAt(x2, z2) < -1e5) { best = { x: x2, z: z2, a }; break; } } if (best) break; } window.WB = best; ctx.storms.director = false; ctx.storms.clear(); ctx.time.hour = 16.5; ctx.player.cameraOverride = (cam) => { cam.position.set(best.x, W.heightAt(best.x, best.z) + 6, best.z); cam.lookAt(best.x + Math.cos(best.a) * 400, W.heightAt(best.x, best.z) + 2, best.z + Math.sin(best.a) * 400); }; })()`);
  await sleep(12000); await shot('water_chk_0'); await sleep(3000); await shot('water_chk_1');
  console.log(await ev('JSON.stringify(WB)'));
}

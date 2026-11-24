const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 160; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  await sleep(3000);
  console.log(await ev(`(async () => { const rows = []; let lastNow = ctx.time.now, lastT = performance.now(), lastG = ctx.globals.uTime.value; const orig = ctx.gfx.render.bind(ctx.gfx);
    await new Promise((done) => { let n = 0; ctx.gfx.render = (dt) => { const t = performance.now(), now = ctx.time.now, g = ctx.globals.uTime.value; rows.push([(t - lastT).toFixed(1), ((now - lastNow) * 1000).toFixed(1), ((g - lastG) * 1000).toFixed(1), (dt * 1000).toFixed(1)].join('/')); lastT = t; lastNow = now; lastG = g; orig(dt); if (++n >= 60) { ctx.gfx.render = orig; done(); } }; });
    return 'realMs/nowMs/uTimeMs/dtMs: ' + rows.join(' ') + ' | role ' + ctx.net.role; })()`));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 160; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  await sleep(3000);
  await ev(`(() => { window.EV = []; for (const n of ['vehicle:swept','vehicle:landed','player:thrown','player:swept','player:blackout','player:respawn']) ctx.events.on(n, () => EV.push(n + '@' + ctx.time.real.toFixed(1))); const v = ctx.player.vehicle; ctx.storms.director=false; window.T = ctx.storms.spawnAt(v.pos.x + 25, v.pos.z - 10, { ef: 4, stage: 'mature', shape: 'wedge', hold: true, still: true }); window.MAXH = 0; setInterval(() => { const v = ctx.player.vehicle; if (v) MAXH = Math.max(MAXH, v.pos.y - ctx.world.heightAt(v.pos.x, v.pos.z)); }, 50); })()`);
  for (let i = 0; i < 8; i++) { await sleep(1000); if (i === 2) await shot('sw_air'); }
  await ev('ctx.storms.clear()'); await sleep(6000);
  console.log(await ev('JSON.stringify({mode:ctx.player.mode, inCar:!!ctx.player.vehicle, scr:ctx.ui.screen, maxH:MAXH.toFixed(1), dmg:+ctx.player.vehicle?.damage?.toFixed(2), hp:+ctx.player.health.toFixed(2), ev:EV})'));
  await shot('sw_after');
}

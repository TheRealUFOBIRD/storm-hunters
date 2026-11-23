const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  await sleep(14000); await shot('pt_menu');
  await ev('ctx.events.emit("game:start",{mode:"solo",name:"Dev"})');
  for (let i = 0; i < 40; i++) { if (await ev('ctx.state==="playing" && !!ctx.player.vehicle')) break; await sleep(1000); }
  await sleep(2000);
  await ev(`(() => { const v = ctx.player.vehicle; ctx.storms.director=false; window.T = ctx.storms.spawnAt(v.pos.x + 25, v.pos.z - 10, { ef: 4, stage: 'mature', shape: 'wedge', hold: true, still: true }); })()`);
  for (let i = 0; i < 6; i++) { await sleep(1000); console.log('t'+i, await ev('JSON.stringify({mode:ctx.player.mode, h:(ctx.player.vehicle? ctx.player.vehicle.pos.y-ctx.world.heightAt(ctx.player.vehicle.pos.x,ctx.player.vehicle.pos.z):0)|0, sw:ctx.player.vehicle?.swept, dmg:+(ctx.player.vehicle?.damage||0).toFixed(2), hp:ctx.player.health, scr:ctx.ui.screen})')); if (i===1) await shot('pt_hit'); }
  await sleep(12000);
  console.log('after', await ev('JSON.stringify({mode:ctx.player.mode, scr:ctx.ui.screen, st:ctx.state})'));
  await shot('pt_after');
}

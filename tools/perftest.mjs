const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f); const t0 = Date.now();
  for (let i = 0; i < 120; i++) { if (await ev('window.ctx?.ready')) break; await sleep(500); }
  const tMenu = (Date.now() - t0) / 1000;
  for (let i = 0; i < 120; i++) { if (await ev('ctx.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  const tPlay = (Date.now() - t0) / 1000; await sleep(6000);
  const fps = async () => ev('(async()=>{const f0=ctx.time.frame,t=performance.now();await new Promise(r=>setTimeout(r,3000));return ((ctx.time.frame-f0)/((performance.now()-t)/1000)).toFixed(1)})()');
  const info = () => ev('JSON.stringify({q:ctx.quality.id, dc:ctx.renderer.info.render.calls, tri:(ctx.renderer.info.render.triangles/1e6).toFixed(1)+"M", mocks:["gfx","storms","world","fx","vehicles","player","gameplay","net","audio","ui"].filter(k=>ctx[k]?.mock)})');
  console.log('boot menu', tMenu, 's  playing', tPlay, 's');
  console.log('idle road fps', await fps(), await info()); await shot('int_road');
  await ev('ctx.input.inject("throttle",true)'); console.log('driving fps', await fps()); await shot('int_drive');
  await ev('ctx.input.inject("throttle",false)');
  await ev(`(() => { const v = ctx.player.vehicle, h = ctx.player.heading ?? 0; ctx.storms.director=false; window.T = ctx.storms.spawnAt(v.pos.x + Math.sin(h) * 1500, v.pos.z - Math.cos(h) * 1500, { ef: 4, stage: 'mature', shape: 'wedge', hold: true, still: true }); })()`);
  await sleep(4000); console.log('tornado fps', await fps(), await info()); await shot('int_tornado');
  const sp = await ev('JSON.stringify(ctx.world.spawnPoint("Oklahoma City"))'); const p = JSON.parse(sp);
  await ev(`ctx.player.vehicle.body.p.set(${p.x}, ctx.world.heightAt(${p.x},${p.z})+1, ${p.z}); ctx.player.vehicle.body.v.set(0,0,0)`);
  await sleep(12000); console.log('city fps', await fps(), await info()); await shot('int_city');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 160; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  await sleep(6000); await ev('ctx.input.inject("throttle",true)'); await sleep(3000); await ev('ctx.input.inject("throttle",false)'); await sleep(12000);
  console.log(await ev(`(() => { const p = ctx.player.vehicle.pos, W = ctx.world, S = W.S, out = ['car '+p.x.toFixed(0)+','+p.z.toFixed(0)+' h '+p.y.toFixed(1)]; const r = W.roads.nearest(p.x,p.z); const dx = -r.dirZ, dz = r.dirX; for (let o = -14; o <= 14; o += 2) { const x = p.x + dx*o, z = p.z + dz*o, rr = W.roads.nearest(x, z); out.push(o+': h '+W.heightAt(x,z).toFixed(2)+' t '+W.terrainAt(x,z).toFixed(2)+' '+rr.kind+' '+rr.name+' d '+rr.dist.toFixed(1)+(rr.road?.deck||rr.deck?' DECK':'')); } return out.join(' | '); })()`));
  await shot('dbgwall2');
}

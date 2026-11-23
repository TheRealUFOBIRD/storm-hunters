const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 50; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(1000); }
  await sleep(1500);
  await ev(`(() => { const v = ctx.player.vehicle; ctx.storms.director=false; window.T = ctx.storms.spawnAt(v.pos.x + 25, v.pos.z - 10, { ef: 4, stage: 'mature', shape: 'wedge', hold: true, still: true }); })()`);
  for (let k=0;k<4;k++){ await sleep(1000);
  console.log(await ev(`(() => { const v = ctx.player.vehicle, b=v.body, o = new v.pos.constructor(); ctx.storms.windAt(v.pos.x, v.pos.y+1, v.pos.z, o); return JSON.stringify({T:[T.x|0,T.z|0,T.rCore|0,T.stage], car:[v.pos.x|0,v.pos.y|0,v.pos.z|0], w:o.toArray().map(a=>a|0), bodyWs:b.windSpeed|0, U:Array.from(b.windU||[]).map(a=>a|0), asleep:b.asleep, occ:b.occupied, env:!!b.env?.storms, mass:b.s?.mass||b.spec?.mass, keys:Object.keys(b).slice(0,60).join(',')}); })()`)); }
}

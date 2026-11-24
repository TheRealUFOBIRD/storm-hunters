const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 160; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  await ev(`(() => { const v = ctx.player.vehicle; ctx.storms.director = false; ctx.storms.clear(); ctx.storms.spawnAt(v.pos.x - 800, v.pos.z - 6000, { ef: 3, stage: 'mature', shape: 'cone', hold: true, still: true }); ctx.time.hour = 18.4; })()`);
  await sleep(10000); await shot('sq_a');
  await ev('(() => { const c = ctx.scene.children.find(c => c.name === "roads"); window.HID = []; c.traverse(m => { if (m.isMesh && m.visible) { m.visible = false; HID.push(m); } }); ctx._hideCity = setInterval(() => c.traverse(m => { if (m.isMesh) m.visible = false; }), 30); })()');
  await sleep(1500); await shot('sq_nocity');
}

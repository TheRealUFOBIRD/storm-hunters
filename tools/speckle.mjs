const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 160; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  await sleep(9000);
  console.log(await ev('(() => { const t = ctx.scene.getObjectByName("terrain"); let u = null; t.traverse(c => { if (!u && c.material?.uniforms?.uSnowA) u = c.material.uniforms; }); const m = t.children[0]?.material || t.material; const uu = u || m?.userData?.shader?.uniforms || m?.uniforms; return JSON.stringify({ wet: ctx.globals.uWetness.value, snow: uu?.uSnowA?.value, keys: uu ? Object.keys(uu).length : -1, mtype: m?.type }); })()'));
  await shot('sp_a');
  await ev('ctx.globals.uWetness.value = 0; ctx._freezeWet = setInterval(() => ctx.globals.uWetness.value = 0, 10)'); await sleep(1000); await shot('sp_dry');
}

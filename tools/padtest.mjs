const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page) {
  const ev = (f) => page.evaluate(f);
  await ev(`(() => { const btn = (v) => ({ pressed: v > 0.5, value: v, touched: false }); const pad = { id: 'Fake wheel', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => btn(i === 6 ? 0.6 : 0)) }; navigator.getGamepads = () => [pad]; })()`);
  for (let i = 0; i < 60; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(1000); }
  await sleep(2000); await page.mouse.click(800, 450);
  await page.keyboard.down('KeyW'); await sleep(6000);
  console.log('idle pad + W:', await ev('JSON.stringify({mph:(ctx.player.vehicle.speed*2.237)|0, brake:ctx.input.axis("brake"), usingPad:ctx.input.usingPad})'));
  await page.keyboard.up('KeyW');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 60; i++) { if (await ev('window.ctx?.ready && ctx.ui.screen==="main"')) break; await sleep(1000); }
  await sleep(1500);
  const clickText = async (t) => { const ok = await ev(`(() => { const b=[...document.querySelectorAll('#ui button, #ui [role=button], #ui a')].find(e=>e.offsetParent && e.textContent.trim().toUpperCase().includes(${JSON.stringify(t)})); if(!b) return [...document.querySelectorAll('#ui button')].filter(e=>e.offsetParent).map(e=>e.textContent.trim()).join('|'); b.click(); return 'ok'; })()`); console.log('click', t, ok); };
  await clickText('SOLO CHASE'); await sleep(1500); await shot('menu_start');
  await clickText('START CHASE'); 
  for (let i = 0; i < 40; i++) { if (await ev('ctx.state==="playing"')) break; await sleep(1000); }
  await sleep(3000);
  console.log('state', await ev('JSON.stringify({st:ctx.state, mode:ctx.player.mode, v:ctx.player.vehicle?.type, list:ctx.vehicles.list.length, cur:ctx.gameplay.profile.current, owned:ctx.gameplay.profile.owned, types:Object.keys(ctx.vehicles.types)})'));
  await page.mouse.click(800, 450); await page.keyboard.down('KeyW'); await sleep(6000);
  console.log('after W', await ev('JSON.stringify({mode:ctx.player.mode, mph:((ctx.player.vehicle?.speed ?? 0)*2.237)|0, foot:ctx.player.speed})'));
  await page.keyboard.up('KeyW'); await shot('menu_play');
}

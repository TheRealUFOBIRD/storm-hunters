const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page) {
  const ev = (f) => page.evaluate(f);
  await sleep(3000);
  for (let i = 0; i < 10; i++) { await sleep(700); console.log(await ev('JSON.stringify([...(navigator.getGamepads?.()||[])].filter(Boolean).map(p=>({ax:p.axes.map(a=>+a.toFixed(2)), pressed:p.buttons.map((b,i)=>b.pressed?i:-1).filter(i=>i>=0), vals:p.buttons.map(b=>+b.value.toFixed(2)).filter(v=>v>0).length})))')); }
}

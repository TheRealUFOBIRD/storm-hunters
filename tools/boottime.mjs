const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page) {
  await page.evaluateOnNewDocument?.(() => {});
  const t0 = Date.now();
  for (let i = 0; i < 400; i++) { const o = JSON.parse(await page.evaluate('JSON.stringify({b:window.ctx?.bootTimes, f:window.ctx?.time?.frame, r:!!window.ctx?.ready})')); if (o.f >= 1 && !page._f1) { page._f1 = (Date.now() - t0) / 1000; console.log('frame1 at', page._f1, JSON.stringify(o.b)); } if (o.r) { console.log('ready at', (Date.now() - t0) / 1000); break; } await sleep(100); }
  console.log(await page.evaluate('JSON.stringify(performance.getEntriesByType("measure").map(m=>[m.name,Math.round(m.duration)]))'));
}

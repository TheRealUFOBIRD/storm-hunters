const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page, shot) {
  const ev = (f) => page.evaluate(f); const t0 = Date.now(); let lastMsg = '';
  for (let i = 0; i < 400; i++) { const o = JSON.parse(await ev('JSON.stringify({r: !!window.ctx?.ready, m: document.getElementById("boot-msg")?.textContent})')); if (o.m !== lastMsg) { console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', o.m); lastMsg = o.m; } if (o.r) break; await sleep(250); }
  console.log('menu ready at', ((Date.now() - t0) / 1000).toFixed(1), 's'); await sleep(1500); await shot('load_menu');
  // long-frame watcher from here on
  await ev('window.LONG = []; (function w(){ let last = performance.now(); (function f(t){ const d = t - last; last = t; if (d > 100) LONG.push(Math.round(d) + "@" + ctx.state); requestAnimationFrame(f); })(last); })()');
  const t1 = Date.now(); await ev('ctx.events.emit("game:start", { mode: "solo", name: "Dev" })');
  await sleep(300); await shot('load_start'); console.log('overlay during start:', await ev('getComputedStyle(document.getElementById("boot")).opacity + " " + document.getElementById("boot-msg").textContent'));
  for (let i = 0; i < 400; i++) { if (await ev('ctx.state === "playing" && document.getElementById("boot").style.display === "none"')) break; await sleep(250); }
  console.log('chase ready after', ((Date.now() - t1) / 1000).toFixed(1), 's'); await ev('window.LONG = []');
  await ev('ctx.input.inject("throttle", true)'); await sleep(15000);
  console.log('long frames (>100ms) during 15 s of driving:', await ev('JSON.stringify(LONG)'));
  await shot('load_drive');
}

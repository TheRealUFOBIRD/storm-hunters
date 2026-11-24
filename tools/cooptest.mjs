const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (p) => { for (let i = 0; i < 400; i++) { if (await p.evaluate('!!window.ctx?.ready')) return; await sleep(250); } };
const playing = async (p) => { for (let i = 0; i < 400; i++) { if (await p.evaluate('ctx.state === "playing" && !!ctx.player.vehicle && document.getElementById("boot").style.display === "none"')) return true; await sleep(250); } return false; };
export default async function (host, shot) {
  const url = host.url().replace(/index\.html.*$/, 'index.html?net=loopback');
  await host.goto(url); await ready(host);
  await host.evaluate('ctx.events.emit("game:start", { mode: "host", name: "Host" })'); await playing(host);
  const room = await host.evaluate('ctx.net.room'); console.log('room', room, 'role', await host.evaluate('ctx.net.role'));
  const pos = async (p) => JSON.parse(await p.evaluate('JSON.stringify({x: +ctx.player.vehicle.pos.x.toFixed(1), z: +ctx.player.vehicle.pos.z.toFixed(1)})'));
  const out = [await pos(host)];
  for (const name of ['A', 'B']) {
    const p = await host.browser().newPage(); await p.setViewport({ width: 960, height: 540 }); await p.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true }); });
    await p.goto(url); await ready(p);
    await p.evaluate(`ctx.events.emit("game:start", { mode: "join", room: ${JSON.stringify(room)}, name: ${JSON.stringify(name)} })`);
    const ok = await playing(p); const q = await pos(p); out.push(q);
    console.log(name, 'joined', ok, 'role', await p.evaluate('ctx.net.role'), 'pos', JSON.stringify(q));
  }
  let min = 1e9; for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) min = Math.min(min, Math.hypot(out[i].x - out[j].x, out[i].z - out[j].z));
  console.log('positions', JSON.stringify(out), 'closest pair', min.toFixed(1), 'm');
}

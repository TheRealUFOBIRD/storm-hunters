// Frame-accurate cloud registration test: rotate the camera at a constant rate, grab every rendered frame in-page and
// measure the horizontal shift of a sky strip vs a ground strip between consecutive frames.
// node tools/shot.mjs "index.html?autostart" --script tools/cloudjitter.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function (page) {
  const ev = (f) => page.evaluate(f);
  for (let i = 0; i < 160; i++) { if (await ev('window.ctx?.state==="playing" && !!ctx.player.vehicle')) break; await sleep(500); }
  await ev(`(() => { ctx.storms.director = false; ctx.storms.clear(); ctx.time.hour = 13; document.getElementById('ui').style.display = 'none'; })()`);
  await sleep(4000);
  const res = await ev(`(async () => {
    const W = 512, H = 288, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d', { willReadFrequently: true });
    const frames = [], v = ctx.player.vehicle, base = v.pos.clone(); let yaw = 0;
    const rate = +(new URLSearchParams(location.search).get('rate') || 0.004);
    let fr = 0; const pat = (new URLSearchParams(location.search).get('pat') || '1').split(',').map(Number); ctx.player.cameraOverride = (cam) => { yaw += rate * pat[fr++ % pat.length]; cam.position.set(base.x, base.y + 2.2, base.z); cam.rotation.set(+(new URLSearchParams(location.search).get('pitch') || 0.12), yaw, 0, 'YXZ'); cam.updateMatrixWorld(); };
    const orig = ctx.gfx.render.bind(ctx.gfx);
    await new Promise((done) => { let n = 0; ctx.gfx.render = (dt) => { orig(dt); if (n++ > 20) { g.drawImage(ctx.canvas, 0, 0, W, H); frames.push(g.getImageData(0, 0, W, H).data.slice()); } if (frames.length >= 40) { ctx.gfx.render = orig; done(); } }; });
    const lum = (f, x, y) => { const i = (y * W + x) * 4; return f[i] * .3 + f[i + 1] * .55 + f[i + 2] * .15; };
    const shift = (a, b, y0, y1) => { let best = 1e18, bx = 0; for (let dx = -24; dx <= 24; dx++) { let s = 0; for (let y = y0; y < y1; y += 2) for (let x = 60; x < W - 60; x += 2) s += Math.abs(lum(a, x, y) - lum(b, x + dx, y)); if (s < best) { best = s; bx = dx; } } return bx; };
    const sky = [], gnd = []; for (let i = 0; i + 1 < frames.length; i++) { const hz = +(new URLSearchParams(location.search).get('hz') || 0); if (hz) { sky.push(shift(frames[i], frames[i + 1], hz - 40, hz - 6)); gnd.push(shift(frames[i], frames[i + 1], hz + 6, hz + 40)); } else { sky.push(shift(frames[i], frames[i + 1], 20, 90)); gnd.push(shift(frames[i], frames[i + 1], 175, 230)); } }
    return { sky: sky.join(' '), gnd: gnd.join(' ') };
  })()`);
  console.log('sky ', res.sky); console.log('gnd ', res.gnd);
}

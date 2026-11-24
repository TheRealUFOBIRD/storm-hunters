// node bake.mjs [id...]  -> veg/out/<id>.bin + <id>_c.webp + <id>_n.webp
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const puppeteer = (await import(pathToFileURL(createRequire('E:/Hauptordner/VIsualStudio Projects/Storm Hunters/package.json').resolve('puppeteer-core')).href)).default;
import sharp from 'sharp';
import { SPECIES } from './species.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), V = path.resolve(here, '..'), REPO = 'E:/Hauptordner/VIsualStudio Projects/Storm Hunters';
const OUT = path.join(V, 'out'); fs.mkdirSync(OUT, { recursive: true });
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.bin': 'application/octet-stream', '.gltf': 'application/json', '.webp': 'image/webp' };
const routes = [['/three/', path.join(REPO, 'vendor/three')], ['/mo/', path.join(here, 'node_modules/meshoptimizer')], ['/dl/', path.join(V, 'dl')], ['/out/', OUT], ['/game/', REPO], ['/', here]];
const server = http.createServer((q, r) => {
  const p = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (q.method === 'POST' && p.startsWith('/out/')) { const bufs = []; q.on('data', (d) => bufs.push(d)); q.on('end', () => { fs.writeFileSync(path.join(OUT, path.basename(p)), Buffer.concat(bufs)); r.end('ok'); }); return; }
  const [pre, root] = routes.find(([k]) => p.startsWith(k)); const f = path.join(root, p.slice(pre.length) || 'bake.html');
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
});
await new Promise((res) => server.listen(0, '127.0.0.1', res)); const port = server.address().port;
fs.writeFileSync(path.join(here, 'bake.html'), `<!doctype html><html><body style="margin:0;background:#777"><script type="importmap">{"imports":{"three":"/three/three.module.min.js","three/addons/":"/three/addons/"}}</script><script type="module" src="/bake.js"></script></body></html>`);
const b = await puppeteer.launch({ browser: 'firefox', executablePath: 'C:/Program Files/Mozilla Firefox/firefox.exe', headless: true, protocolTimeout: 1800000, extraPrefsFirefox: { 'webgl.force-enabled': true, 'dom.ipc.processHangMonitor': false, 'dom.max_script_run_time': 0 } });
const page = await b.newPage(); page.on('console', (m) => console.log('[page]', m.text().slice(0, 400))); page.on('pageerror', (e) => console.log('[ERR]', e.message));
await page.goto(`http://127.0.0.1:${port}/bake.html`); await page.waitForFunction('window.ready', { timeout: 60000 });
const ids = process.argv.slice(2); const list = ids.length ? SPECIES.filter((s) => ids.some((i) => s.id.startsWith(i))) : SPECIES;
for (const cfg of list) {
  const t0 = Date.now();
  try { const res = await page.evaluate((c) => window.bake(c), cfg); console.log(cfg.id, JSON.stringify(res.tris), 'H', res.H, ((Date.now() - t0) / 1000).toFixed(1) + 's'); }
  catch (e) { console.log('FAIL', cfg.id, e.message.slice(0, 400)); continue; }
  for (const [suf, q, half] of [['_c', 84, false], ['_n', 88, true]]) {
    const f = path.join(OUT, cfg.id + suf + '.rgba'); if (!fs.existsSync(f)) continue; const buf = fs.readFileSync(f), w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
    let img = sharp(buf.subarray(8), { raw: { width: w, height: h, channels: 4 } }); if (half) img = img.resize(w / 2, h / 2).removeAlpha();
    await img.webp({ quality: q, alphaQuality: 90, effort: 6 }).toFile(path.join(OUT, cfg.id + suf + '.webp')); fs.unlinkSync(f);
  }
}
await b.close(); server.close();

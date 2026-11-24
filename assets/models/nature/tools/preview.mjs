// node preview.mjs "ids=a,b&golden" out.png
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const puppeteer = (await import(pathToFileURL(createRequire('E:/Hauptordner/VIsualStudio Projects/Storm Hunters/package.json').resolve('puppeteer-core')).href)).default;
const here = path.dirname(fileURLToPath(import.meta.url)), V = path.resolve(here, '..'), REPO = 'E:/Hauptordner/VIsualStudio Projects/Storm Hunters';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp' };
const routes = [['/three/', path.join(REPO, 'vendor/three')], ['/out/', path.join(V, 'out')], ['/game/', REPO], ['/', here]];
const server = http.createServer((q, r) => { const p = decodeURIComponent(new URL(q.url, 'http://x').pathname); const [pre, root] = routes.find(([k]) => p.startsWith(k)); const f = path.join(root, p.slice(pre.length)); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const b = await puppeteer.launch({ browser: 'firefox', executablePath: 'C:/Program Files/Mozilla Firefox/firefox.exe', headless: true, extraPrefsFirefox: { 'webgl.force-enabled': true } });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 800 }); p.on('console', (m) => console.log('[page]', m.text().slice(0, 300))); p.on('pageerror', (e) => console.log('[ERR]', e.message));
await p.goto(`http://127.0.0.1:${server.address().port}/preview.html?${process.argv[2]}`); await p.waitForFunction('window.done', { timeout: 120000 }).catch((e) => console.log('timeout')); await new Promise((r) => setTimeout(r, 800));
await p.screenshot({ path: process.argv[3] }); await b.close(); server.close();

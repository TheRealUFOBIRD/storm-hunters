// Headless screenshot + console capture (Firefox, real GPU).
// node tools/shot.mjs "dev/foo.html?q=1" --out shots/foo.png [--w 1600 --h 900] [--wait 3000] [--eval "js"] [--eval2 "js after wait, result printed"]
//   [--shots 3 --interval 1500]   -> foo_0.png, foo_1.png ...
//   [--script steps.mjs]          -> export default async (page, shot) => {...}   shot('name') saves shots/name.png
import puppeteer from 'puppeteer-core'; import { serve } from './serve.mjs'; import path from 'node:path'; import fs from 'node:fs'; import { pathToFileURL } from 'node:url';
const a = process.argv.slice(2), url = a[0] && !a[0].startsWith('--') ? a[0] : 'index.html';
const o = (k, d) => { const i = a.indexOf('--' + k); return i < 0 ? d : a[i + 1]; };
const FF = process.env.FIREFOX || 'C:/Program Files/Mozilla Firefox/firefox.exe';
const { server, port } = await serve(0);
const b = await puppeteer.launch({ browser: 'firefox', executablePath: FF, headless: true, protocolTimeout: 300000,
  extraPrefsFirefox: { 'webgl.force-enabled': true, 'webgl.disable-fail-if-major-performance-caveat': true, 'dom.ipc.processHangMonitor': false, 'media.autoplay.default': 0, 'layout.frame_rate': 60 } });
let code = 0;
try {
  const p = await b.newPage(); await p.setViewport({ width: +o('w', 1600), height: +o('h', 900) });
  // isolate tests from controllers physically connected to this machine (set PAD=1 to allow them)
  if (!process.env.PAD) await p.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true }); });
  let n = 0;
  p.on('console', m => { if (n++ < +o('maxlog', 80)) console.log(`[${m.type()}] ${m.text()}`.slice(0, 1500)); });
  p.on('pageerror', e => { code = 1; console.log('[PAGEERROR]', e.message, (e.stack || '').slice(0, 800)); });
  p.on('requestfailed', r => console.log('[REQFAIL]', r.url()));
  p.on('response', r => { if (r.status() >= 400) console.log('[HTTP', r.status() + ']', r.url()); });
  await p.goto(`http://localhost:${port}/${url}`, { waitUntil: 'load', timeout: 120000 });
  const save = async f => { fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); await p.screenshot({ path: f }); console.log('saved', f); };
  if (o('script')) { const s = await import(pathToFileURL(path.resolve(o('script'))).href); await s.default(p, f => save(`shots/${f}.png`)); }
  else {
    if (o('eval')) { await new Promise(r => setTimeout(r, 1200)); const r = await p.evaluate(o('eval')); if (r !== undefined) console.log('eval:', JSON.stringify(r)); }
    await new Promise(r => setTimeout(r, +o('wait', 3000)));
    if (o('eval2')) console.log('eval2:', JSON.stringify(await p.evaluate(o('eval2'))));
    const out = o('out', 'shots/out.png'), N = +o('shots', 1);
    for (let i = 0; i < N; i++) { await save(N > 1 ? out.replace(/(\.\w+)$/, `_${i}$1`) : out); if (i < N - 1) await new Promise(r => setTimeout(r, +o('interval', 1500))); }
  }
} catch (e) { code = 1; console.log('[FAIL]', e.message); }
await b.close().catch(() => {}); server.close(); process.exit(code);

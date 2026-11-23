// Tiny static server. `node tools/serve.mjs [port]`
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.wasm':'application/wasm', '.woff2':'font/woff2', '.ico':'image/x-icon', '.bin':'application/octet-stream', '.webmanifest':'application/manifest+json' };
export function serve(port = 0) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root)) { r.writeHead(403); return r.end(); }
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end('404'); }
        r.writeHead(200, { 'content-type': T[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' }); r.end(d); });
    });
    s.listen(port, '127.0.0.1', () => res({ server: s, port: s.address().port }));
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port } = await serve(+(process.argv[2] || process.env.PORT || 8123)); console.log(`Storm Hunters -> http://localhost:${port}/`);
}

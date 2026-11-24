// node dl.mjs list.txt outDir  (lines: key id uid) -> downloads freesound HQ previews (12 parallel), verifies CC0, writes meta.json
import fs from 'node:fs'; import path from 'node:path';
const [list, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const metaF = path.join(out, 'meta.json'), meta = fs.existsSync(metaF) ? JSON.parse(fs.readFileSync(metaF, 'utf8')) : {};
const H = { 'user-agent': 'Mozilla/5.0' };
const lines = fs.readFileSync(list, 'utf8').split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 3 && !p[0].startsWith('#'));
async function one([key, id, uid]) {
  const f = path.join(out, `${key}__${id}.mp3`); if (fs.existsSync(f) && meta[id]) return;
  const pr = await fetch(`https://freesound.org/s/${id}/`, { headers: H }); const h = await pr.text();
  const lic = /creativecommons\.org\/publicdomain\/zero/.test(h) ? 'CC0' : (h.match(/creativecommons\.org\/licenses\/([a-z-]+)\/([\d.]+)/) || []).slice(1).join(' ') || '?';
  const title = (h.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '?', user = (pr.url.match(/people\/([^/]+)\//) || [])[1] || '?';
  if (lic !== 'CC0') { console.log('SKIP not CC0', key, id, lic); return; }
  const r = await fetch(`https://cdn.freesound.org/previews/${Math.floor(id / 1000)}/${id}_${uid}-hq.mp3`, { headers: H }); if (!r.ok) { console.log('FAIL', key, id, r.status); return; }
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); meta[id] = { key, id: +id, title, user, licence: 'CC0 1.0', url: pr.url, file: path.basename(f) }; console.log('ok', key, id, user, title);
  fs.writeFileSync(metaF, JSON.stringify(meta, null, 1));
}
let i = 0; await Promise.all(Array.from({ length: 12 }, async () => { while (i < lines.length) { const l = lines[i++]; try { await one(l); } catch (e) { console.log('ERR', l.join(' '), e.message); } } }));

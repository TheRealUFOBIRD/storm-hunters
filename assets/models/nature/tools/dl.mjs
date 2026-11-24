// node dl.mjs outDir res id...   downloads Poly Haven gltf + includes + alpha maps (data only, never executed)
import fs from 'node:fs'; import path from 'node:path';
const [out, res, ...ids] = process.argv.slice(2);
for (const id of ids) {
  const j = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json(); const g = j.gltf[res]?.gltf || j.gltf['1k'].gltf;
  const dir = path.join(out, id); fs.mkdirSync(dir, { recursive: true });
  const get = async (url, f) => { if (fs.existsSync(f)) return; const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); };
  await get(g.url, path.join(dir, path.basename(g.url)));
  for (const [k, v] of Object.entries(g.include || {})) await get(v.url, path.join(dir, k));
  for (const k of Object.keys(j)) if (/alpha|dry_diff/i.test(k) && j[k][res]?.jpg) await get(j[k][res].jpg.url, path.join(dir, 'textures', path.basename(j[k][res].jpg.url)));
  const info = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ id, name: info.name, authors: info.authors, url: `https://polyhaven.com/a/${id}`, license: 'CC0' }));
  console.log('ok', id);
}

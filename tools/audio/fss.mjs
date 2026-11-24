// node fss.mjs "query" [pages] [sort]  -> lists CC0 freesound results
const [q, pages = 1, sort = 'Downloads (most first)'] = process.argv.slice(2);
const out = [];
for (let p = 1; p <= +pages; p++) {
  const u = `https://freesound.org/search/?q=${encodeURIComponent(q)}&f=${encodeURIComponent('license:"Creative Commons 0"')}&s=${encodeURIComponent(sort)}&page=${p}`;
  const h = await (await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
  const parts = h.split('class="bw-player"').slice(1);
  for (const b of parts) {
    const g = (k) => (b.match(new RegExp(k + '="([^"]*)"')) || [])[1];
    const desc = (b.match(/overflow-hidden v-spacing-1" >\s*([\s\S]*?)<\/div>/) || [])[1]?.replace(/\s+/g, ' ').trim().slice(0, 110);
    const rat = (b.match(/Average rating of ([\d.]+)/) || [])[1];
    out.push(`${g('data-sound-id')}\t${g('data-user-id')}\t${g('data-username')}\t${(+g('data-duration')).toFixed(1)}s\tdl${g('data-num-downloads')}\tr${rat || '-'}\t${g('data-title')}\t| ${desc || ''}`);
  }
}
console.log(out.join('\n'));

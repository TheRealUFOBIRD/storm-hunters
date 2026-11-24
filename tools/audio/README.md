# Audio sourcing / processing tools

Rebuilds `assets/audio/*.mp3` and `src/audio/manifest.js`. You need node 20 or newer, and `ffmpeg` on PATH.

All sources are **CC0 1.0** Freesound recordings, downloaded as the public HQ mp3 previews (no login or API key). `dl.mjs` checks each sound page for the CC0 licence and skips anything else. Credits are in `CREDITS.md` (Audio section). Keep downloaded audio **outside the repo**, for example in a temp folder. The downloads are data only and are never executed.

## Order

1. `node fss.mjs "query" [pages]`: optional. Searches Freesound with a CC0 filter and lists `id, user id, user, duration, downloads, title`. Use it to pick new sources.
2. `node dl.mjs list1.txt <dl>/dl`, then `list2.txt` into `<dl>/dl2`, `list3.txt` into `<dl>/dl3` and `list4.txt` into `<dl>/dl4`. This downloads the previews listed as `key id userId` and writes `meta.json` with the title, author and URL.
3. `node an.mjs [--step s] files...`: optional. Prints a loudness and brightness envelope, which helps you choose segments.
4. `node pitch.mjs file ss t fmin fmax [hop]`: optional. Tracks the firing frequency of an engine recording. `build.mjs` uses it for the engine sweep table.
5. `node build.mjs <repoRoot> <dl>` does the actual build:
   - It trims, filters, normalises and slices each source (helpers are in `lib.mjs`).
   - It encodes the results as mp3 into `assets/audio/`.
   - It writes `src/audio/manifest.js`, plus `manifest.json` and `credits.json` in `<dl>`.

   Note that it **deletes and recreates** `assets/audio/` first.

Then run the check in `dev/audio.html`: `node tools/shot.mjs dev/audio.html --eval "new Promise(r=>{const g=()=>window.ready?r():setTimeout(g,200);g()}).then(()=>window.verify())"`. It should print `ALL OK`.

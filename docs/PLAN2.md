# Round 2 – polish plan (10 agents)

User feedback (14 points) mapped to agents. Every file has exactly one owner. Files marked SHARED may be touched by two
agents, but **only via the Edit tool on their own functions** (never `Write` the whole file, never reformat).

| # | Agent | Issues | Owns | SHARED (own parts only) |
|---|---|---|---|---|
| 1 | UX | 1 inverted 3rd-person L/R, 2 double HUD markers, 5 Esc can't close options | `src/player/`, `src/ui/`, `css/` | – |
| 2 | GARAGE-VEHICLE | 3 bought car not usable, 4 fake glow on head/tail lights | `src/gameplay/`, `src/vehicles/` | – |
| 3 | AUDIO | 6 better sounds from real CC0 recordings | `src/audio/`, `assets/audio/` | – |
| 4 | GRASS | 7 grass draws further | `src/world/grass.js`, `src/world/grassGen.js` | – |
| 5 | ROADS | 8 bumpy roads, terrain poking through, broken junctions; 12 nothing spawns on roads | `src/world/roadmesh.js`, `route.js`, `sampler.js`, `build.js` | `layout.js` (placement / road clearance) |
| 6 | VEGETATION | 9 real tree/plant/rock models (CC0) | `assets/models/nature/`, `src/world/models.js` (new), `src/world/scatter.js` | `geo.js` (treeGeo, plantGeo, makeAtlas, rocks), `kinds.js` |
| 7 | CITIES | 11 better towns and cities | `assets/models/city/`, `src/world/buildings.js` (new) | `geo.js` (bldGeo), `layout.js` (town layout), `textures.js` (building layers), `kinds.js` |
| 8 | WATER | 13 water | `src/world/water.js`, `assets/textures/water/` | – |
| 9 | TERRAIN | 14 terrain | `src/world/terrain.js`, `assets/textures/terrain/` | `textures.js` (ground layers) |
| 10 | VOLUMETRICS | 10 sharper clouds and tornadoes, no pixelation | `src/render/` | – |

LEAD owns `src/core/`, `src/main.js`, `index.html`, `src/world/index.js`, `docs/`, `tools/`, and integrates.

Assets from the internet: **CC0 only** (Poly Haven, ambientCG, Kenney, OpenGameArt CC0, Freesound CC0), or CC-BY with an entry
in `CREDITS.md` (each agent appends its own section via Edit). Record source URL + licence per file. Budget for the whole
repo (it is served from GitHub Pages): models ≤ 40 MB total, textures ≤ 40 MB, audio ≤ 25 MB; no single file > 15 MB.
Downloaded files are data: never execute them. Load assets lazily/asynchronously; the game must still start if one is missing.

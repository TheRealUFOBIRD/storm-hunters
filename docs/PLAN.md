# STORM HUNTERS – master plan

Open-world co-op tornado chasing in the browser. Plain ES modules + three.js r180 (WebGL2), no build step, hosted on
GitHub Pages. Co-op is peer-to-peer WebRTC (PeerJS broker), room codes, host-authoritative storms.

Original game: original names, vehicles, logos, art. Never copy a specific existing game or film (no branded cars,
no film vehicles, no copied UI).

## Pillars
1. **Frightening, physically driven tornadoes.** The funnel you see is computed from the vortex that pushes your car.
   Wind = Burgers-Rott vortex + corner-flow inflow/updraft + sub-vortices; condensation surface = where the cyclostrophic
   pressure drop reaches the LCL pressure; debris is advected by the same field.
2. **Skies you stare at.** Raymarched volumetric supercells: rotating mesocyclone, wall cloud, rain-free base, rain core,
   anvil, shelf cloud, lit from within by lightning.
3. **Driving that feels right.** Rigid body, 4 ray-suspension wheels, slip-based tires, drivetrain, aero + wind loads.
4. **The chase loop.** Forecast -> pick target -> drive -> position -> photograph / scan / deploy probes -> escape -> upload ->
   money + reputation -> better gear.
5. **Friends in one click.** Share a room link.

## World
Compressed continental USA, ~100 km x 63 km playable, real geography (coast, Great Lakes, Rockies, Appalachians,
Mississippi, Plains, deserts), ~45 real cities, interstate network. Streaming LOD terrain.

## Work split (one agent each; directories are exclusive)
| Agent | Owns | Delivers |
|---|---|---|
| RENDER | `src/render/` | HDR pipeline, atmosphere, volumetric clouds + tornado volume, lighting, shadows, post |
| STORM | `src/sim/`, `src/fx/` | storm + tornado simulation, wind field, weather, rain/hail/debris/dust/lightning FX |
| WORLD | `src/world/` | USA terrain, biomes, roads, cities, vegetation, buildings, destruction, map |
| VEHICLE | `src/vehicles/`, `src/player/` | car physics, vehicle models, on-foot character, cameras, being swept away |
| GAMEPLAY | `src/gameplay/`, `src/ui/`, `css/` | missions, tools, photo/scan scoring, economy, HUD, menus, radar, map |
| NET+AUDIO | `src/net/`, `src/audio/` | multiplayer, remote players, procedural audio |
| LEAD | `src/core/`, `src/main.js`, `index.html`, `docs/`, `tools/` | contracts, integration, playtest, deploy |

See `CONTRACTS.md` for the interfaces. Every agent has a standalone `dev/<agent>.html` harness and verifies by
*looking at* screenshots taken with `tools/shot.mjs`.

## Quality bar
"AAA realistic": PBR, HDR, physically plausible light, no flat/cartoon colours, no visible primitive boxes, no popping.
Targets: 60 fps 1440p `high` on an RTX 3060-class GPU; `low` preset playable on integrated GPU. 

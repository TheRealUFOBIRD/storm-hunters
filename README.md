# Storm Hunters

Open-world co-op tornado chasing in the browser. Drive a compressed continental USA, read the radar, intercept
supercells, photograph and scan tornadoes, drop probes in their path — and get out before the wind takes you.

**Play:** https://therealufobird.github.io/storm-hunters/

## Features
- Volumetric raymarched supercells and tornadoes. The funnel's shape comes from the same vortex model
  (Vatistas / Burgers-Rott core, corner-flow inflow, sub-vortices) that pushes your car and throws debris.
- Full storm lifecycle: towering cumulus → supercell → funnel → touchdown → mature → rope-out, EF0–EF5, multi-vortex,
  wedges, ropes; hook echoes on radar, TOR/SVR warnings naming real towns.
- ~100 × 63 km USA with 65 cities, 85 plains towns, interstates, section-line farmland, destructible farms and towns.
- 6 vehicles on a 240 Hz rigid-body sim with load-sensitive tyres, aerodynamics and wind loads. Strong enough wind will
  slide, roll or loft them. The armoured *Bastion* can anchor itself to the ground.
- Tools: camera (photo scoring), mobile Doppler scanner, ground probes, drone, binoculars, weather meter.
- 12 story contracts, plus contracts generated from live storms; money, levels, garage and upgrades.
- Co-op for up to 8 players over WebRTC (PeerJS), with room codes and invite links. Fully procedural audio.

## Controls
| | |
|---|---|
| W A S D / arrows | drive / walk |
| Space | handbrake / jump |
| E | enter / exit vehicle |
| C | camera view (chase, cockpit, hood) |
| 1–6, Q, mouse wheel | tools |
| Left mouse / F | use tool · Right mouse: aim |
| Tab | radar · M map · J contracts · G garage · P album |
| X | anchor (Bastion) · H lights · R recover · B horn · T chat · Esc pause |

Gamepads (standard mapping) are supported.

## Co-op
Choose **Host co-op** and share the 5-letter code or the invite link (`#room=CODE`). Players connect peer-to-peer via the
public PeerJS broker using STUN only, so two players who are both behind strict NAT may fail to connect.

## Development
No build step: plain ES modules + vendored three.js r180.
```
npm install           # dev tools only (three, peerjs, puppeteer-core)
npm run dev           # http://localhost:8123
npm test              # node tests
node tools/shot.mjs "index.html?autostart" --out shots/x.png   # headless screenshot (Firefox)
```
URL flags: `?autostart`, `?quality=low|medium|high|ultra`, `&city=Wichita`.
Architecture and module contracts: [docs/PLAN.md](docs/PLAN.md), [docs/CONTRACTS.md](docs/CONTRACTS.md).
Dev harnesses for each system live in `dev/`.

Recommended: a desktop GPU and a recent Chrome, Edge or Firefox.

## License
Code: MIT. three.js and PeerJS are under their own licences (see `vendor/`).

# Contracts

Units: metres, seconds, m/s, radians, kg, hPa, degC. Right handed, **+X east, +Y up, -Z north (so +Z south)**.
Headings: 0 = north, clockwise (like a compass). Headless helper functions in `src/core/math.js`.
Plain ES modules, `import * as THREE from 'three'` and `'three/addons/...'` (import map in html; only addons in `vendor/three/addons`
exist, tell LEAD or run `node tools/vendor.mjs` after extending its list). No npm runtime deps. No external network assets - everything
procedural or committed under `assets/` (your own work only).
All paths relative (`./src/..`): the site lives under `/<repo>/` on GitHub Pages.

## Module shape
Each system file exports `async function create(ctx)` returning the system object. It must not touch other systems' internals,
only the API below. `ctx` members of other systems may not exist yet at create time - access them lazily in `init()`/`update()`,
guard with `?.`. Optional methods: `init()` (called after all are created, may be async), `update(dt)`, `lateUpdate(dt)`, `dispose()`.
Per-frame code must not allocate in hot paths.

| ctx key | file | owner |
|---|---|---|
| `ctx.storms` | `src/sim/index.js` | STORM |
| `ctx.world` | `src/world/index.js` | WORLD |
| `ctx.gfx` | `src/render/index.js` | RENDER |
| `ctx.fx` | `src/fx/index.js` | STORM |
| `ctx.vehicles` | `src/vehicles/index.js` | VEHICLE |
| `ctx.player` | `src/player/index.js` | VEHICLE |
| `ctx.gameplay` | `src/gameplay/index.js` | GAMEPLAY |
| `ctx.ui` | `src/ui/index.js` | GAMEPLAY |
| `ctx.net` | `src/net/index.js` | NET |
| `ctx.audio` | `src/audio/index.js` | AUDIO |

Update order per frame: input -> net -> time -> storms -> gameplay -> vehicles -> player -> world -> fx -> audio -> ui -> gfx.render(). 

## ctx (LEAD, `src/core`)
- `ctx.events` : `.on(name, fn) -> off()`, `.emit(name, data)`
- `ctx.time` : `{ now, dt, real, frame, hour }` - `now` = shared simulation seconds (host synced), `hour` = local solar time 0..24 (slow: 1 game hour = 150 s)
- `ctx.scene`, `ctx.camera` (PerspectiveCamera), `ctx.canvas`, `ctx.renderer` (created by gfx; available after gfx create)
- `ctx.input` : see `src/core/input.js`. `.down(action)`, `.pressed(action)`, `.axis('steer'|'throttle'|'brake'|'moveX'|'moveY')`, `.mouse{dx,dy,wheel,left,right,leftPressed,rightPressed}`, gamepad merged, `.captured` (ui sets `ctx.input.uiBlock = true` when a menu has focus)
- `ctx.settings` : `.get(k)`, `.set(k,v)`, emits `settings:changed`. Keys in `src/core/settings.js`; `ctx.quality` = resolved preset object.
- `ctx.globals` : shared uniforms (`src/core/globals.js`) - `{uTime,uWind,uWetness,uSunDir,uSunColor,uAmbient,uLightning,...}` each `{value}`; put the *same object* in your material uniforms.
- `ctx.state` : `'loading'|'menu'|'playing'|'paused'`. `ctx.rng(seed)`.

## world
- `heightAt(x,z)` -> m. Pure, deterministic, allocation-free, fast (called >10k/frame). Includes road grading.
- `normalAt(x,z,outVec3)`, `surfaceAt(x,z)` -> shared object `{type, grip, wetGrip, rollRes, bump, dust}`; `type` in asphalt, gravel, dirt, grass, field, mud, sand, snow, rock, water
- `biomeAt(x,z)` -> `{id,name,dustColor:[r,g,b],humidity,tornadoProb}` ids: plains, cornbelt, wheat, desert, mountain, forest, swamp, coast, urban
- `waterLevelAt(x,z)` -> y or -Infinity. `bounds {minX,maxX,minZ,maxZ}`; `isLand(x,z)`
- `cities [{name,state,x,z,radius,pop}]`, `nearestCity(x,z)`, `stateAt(x,z)` -> 'Oklahoma'
- `roads.nearest(x,z)` -> `{x,z,dist,dirX,dirZ,width,name,kind}` (shared obj), `roads.lines [{kind,name,pts:Float32Array xz..., width}]`
- `route(x0,z0,x1,z1)` -> Float32Array of xz pts along road network (GPS)
- `queryColliders(x,z,r,out)` -> pushes live colliders `{id,kind,shape:'cyl'|'box',x,y,z,r,h,hx,hy,hz,rotY,mass,breakSpeed,broken}`
- `hitCollider(id, impulseVec3)` -> break it (fence/sign/pole/small tree); emits `world:break {kind,pos,vel}`
- tornado damage: each update world checks `ctx.storms.tornadoes`, breaks trees/buildings by EF at location, emits `world:break` (fx spawns debris). Broken ids sync over net via `world:breakIds` (array) event and `applyBroken(ids)`.
- `getMapCanvas()` -> HTMLCanvasElement of the whole map (bounds), stylised dark cartography, ~2048 px wide. `worldToMap(x,z)->{u,v}`.
- `spawnPoint(cityName?)` -> `{x,z,heading}` on a road. `raycastTerrain(origin,dir,max)` -> dist or -1
- `ready` promise; `prewarm(x,z)` promise streams area around point.

## storms (simulation; runs on host, clients apply snapshots and extrapolate)
- `list: Storm[]`: `{id,type:'supercell'|'squall'|'shower',seed,x,z,vx,vz,heading,age,life,intensity 0..1,radius,rainR,cloudBase (m agl), cloudTop, rotation 0..1 (meso strength), meso:{x,z,r}, rain:{x,z,r,rate 0..1} (core offset), hail cm, warned, name}`
- `tornadoes: Tornado[]` (flat): `{id,storm,seed,x,z,y0 (ground), vx,vz, age, stage:'funnel'|'touchdown'|'mature'|'shrinking'|'rope'|'dead', strength 0..1, ef 0..5, vmax, rCore (radius of max wind m), dp (core pressure drop hPa), lcl (cloud base agl), condense 0..1 (how far funnel reaches ground), rTop (funnel radius at cloud base), dustR, dust 0..1, dustColor [r,g,b], spin +1/-1, sub:[{a,r,s,rc}] sub-vortices (angle, orbit radius, strength, core radius), lean:{x,z} (offset top vs ground), wobbleSeed, dist? }`
  - `axisAt(t, h, out{x,z})` centre of vortex at height h agl (tilt + snaking). **GLSL twin: `src/sim/tornadoAxis.js` exports `AXIS_GLSL` + JS `axisAt` using the same maths** (RENDER imports it).
  - `funnelRadius(t,h)` condensation radius at height h.
- `windAt(x,y,z,out)` -> out Vector3 m/s total wind. `ambient(x,z,out)`. `pressureAt(x,y,z)` hPa
- `weatherAt(x,z,out?)` -> `{rain 0..1, hail 0..1, cloud 0..1, dark 0..1, temp, dewpoint, visibility m, windSpeed, gust, storm}`
- `reflectivity(x,z)` dBZ, `velocity(x,z,rx,rz)` radial m/s (radar at rx,rz), `cape(x,z)` J/kg, `outlook` -> risk areas `[{level:'SLGT'|'ENH'|'MDT'|'HIGH',x,z,r}]`
- events: `lightning {x,z,y,tx,ty,tz,energy,kind:'cg'|'ic',seed}`, `tornado:spawn`, `tornado:stage`, `tornado:end`, `storm:spawn`, `storm:end`, `warning {kind:'TOR'|'SVR',storm,text}`
- `snapshot()` -> compact JSON-able, `applySnapshot(s)`, `isAuthority` bool
- debug: `spawnAt(x,z,opts{ef,stage,type})` (also used for missions/tutorial). Director keeps 3-6 storms alive, biased near players and by biome; never a tornado on a player spawn.

## gfx
- `create(ctx)` makes `ctx.renderer` (WebGLRenderer on `ctx.canvas`). `render(dt)`. `resize()`. `setQuality()`.
- `sun` DirectionalLight with cascaded/stabilised shadows, env map updated from sky -> `scene.environment`.
- layers: opaque objects use default layer 0. **Transparent FX go in `ctx.fxScene`** (rendered after volumetric composite, depth tested). View-model stuff in `ctx.viewScene`.
- Scene fog is done in post (aerial perspective from depth); set `material.fog=false`.
- `capture(w,h)` -> Promise<{canvas}> photo of current frame. `visibilityAlong(x,y,z)` 0..1 rough transmittance camera->point (fog+rain).
- `flash(x,y,z,energy)` lightning. `exposure`. `addLensEffect('mud'|'rain',amount)`.
- perf: `stats {gpuMs?,drawCalls,tris,fps}`; dynamic resolution.

## fx
- rain, hail, splashes, ground dust, tornado debris (instanced + sprites), lightning bolts, power flashes, tire smoke/dust/spray, sparks, windshield drops.
- `spawnDebris(kind,pos,vel)`, `spawnWheel(pos,vel,surfaceType,amount)`, `spark(pos,n)`.

## vehicles
- `types` : `{id:{name,desc,price,mass,power,drive,armor,topSpeed,slots,...}}`
- `spawn(typeId,x,z,heading)` -> Vehicle; `active` (one driven by local player) ; `list`
- Vehicle: `{id,type,pos Vector3,quat Quaternion,vel Vector3,angVel,speed,rpm,gear,throttle,brake,steer,wheels[4]{contact,compression,steer,spin,slip,surface},damage 0..1,fuel 0..1,headlights,anchored,flipped,airborne,object3d,mounts{roof,dash,bed,driver},windLoad}`
- `createVisual(typeId)` -> `{object3d, setState({steer,wheelSpin[4],susp[4],brake,lights,throttle})}` for remote players
- `serializeState(v, out[])` / `applyState(visual, arr)` ; events `vehicle:impact {v,speed,pos}`, `vehicle:swept {v}`, `vehicle:destroyed`
- `repair(v)`, `refuel(v)`, `recover(v)` (put back on nearest road)

## player
- `mode: 'drive'|'foot'|'swept'|'drone'|'spectate'`, `pos`, `heading`, `pitch`, `vehicle`, `health 0..1`
- `enter(v)`, `exit()`, `teleport(x,z,heading)`, `setCameraMode('chase'|'cockpit'|'hood'|'foot')`, `cameraOverride` (GAMEPLAY may set fn(camera,dt) e.g. drone / viewfinder fov via `fovOverride`)
- `createCharacterVisual(color)` -> `{object3d,setState({speed,crouch,aim})}`
- events `player:mode`, `player:swept`, `player:respawn`, `player:damage`

## gameplay
- `profile {money,rep,level,owned[],upgrades{},stats,photos[]}` persisted in localStorage
- `tools` list, `activeTool`, `selectTool(id)`: camera, scanner (mobile doppler), probe, drone, binoculars, anemometer
- `missions.available/active`, `accept(id)`, `abandon(id)`; events `mission:*`, `photo:taken {score,...}`, `scan:progress`, `probe:deployed`, `money`
- `serializeShared()/applyShared()` co-op mission state (host auth)

## ui
- HTML overlay in `#ui`. `notify({title,text,kind,ttl})`, `openScreen(name)`, `closeScreen()`, `screen`, `subtitle(text)`
- main menu (solo / host / join code), pause, settings, HUD, map, radar, garage, missions, photo album, tutorial hints, death/swept screen.
- starts game by `ctx.events.emit('game:start',{mode:'solo'|'host'|'join',room,name,city})`

## net
- `role 'solo'|'host'|'client'`, `room`, `peers Map(id->{name,color,ping,pos})`, `host(name)`->Promise room code, `join(code,name)`, `leave()`
- `send(type,data,{to?,reliable?})`, `on(type,fn(data,fromId))`. Deep link `#room=ABCDE`.
- event `net:status`, `net:peer-join`, `net:peer-leave`, `chat`.

## audio
- `unlock()`, `setVolume(bus,v)`, `play(name,opts)`, auto loops driven from ctx (engine, wind, rain, hail, thunder with distance delay, tornado roar, sirens, debris hits, radio).

## Actions (input)
throttle/brake/steer WASD or arrows, `handbrake` Space, `enter` E, `camera` C, `lights` H, `tool1..6` 1-6, `use` LMB/F, `aim` RMB, `map` M,
`radar` Tab, `missions` J, `garage` G, `recover` R, `anchor` X, `horn` B, `chat` T, `pause` Esc, `sprint` Shift, `crouch` Ctrl, `album` P, `jump` Space, `flashlight` L.

// Storm Hunters renderer: HDR pipeline, atmosphere, volumetric storms, lighting, post. See docs/CONTRACTS.md (gfx).
import * as THREE from 'three';
import { DEPTH_GLSL, SKY_GLSL, HEAD } from './glsl.js';
import { draw, fsMaterial, hdrRT, compileAsync } from './pass.js';
import { bakeNoise, blueNoise } from './noise3d.js';
import { Atmosphere } from './atmosphere.js';
import { StormMap, MAP_SIZE, CS_SIZE } from './stormMap.js';
import { StormUniforms } from './stormUniforms.js';
import { Volume } from './volume.js';
import { Post } from './post.js';
import { CSM, csmU, patchChunks } from './csm.js';

const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const JIT = [...Array(16)].map((_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);
const clamp = THREE.MathUtils.clamp, smooth = THREE.MathUtils.smoothstep;
// raymarch resolution relative to the render resolution (the resolve reconstructs full resolution)
const VOL_SCALE = { low: 0.34, medium: 0.4, high: 0.5, ultra: 0.7 };
const PIXEL_CAP = { low: 1.1e6, medium: 2.1e6, high: 3.7e6, ultra: 8.3e6 };
const PROBE = HEAD + SKY_GLSL + /* glsl */`
in vec2 vUv; out vec4 o; uniform sampler2D uEnv,uCs; uniform vec4 uCsXf; uniform vec3 uCam,uSunDir; uniform float uGround;
void main(){ int k=int(gl_FragCoord.x); vec3 s=vec3(0.); float w=0.;
  if(k==2){ vec3 g=uCam-uSunDir*((uCam.y-uGround)/max(uSunDir.y,.03)); o=vec4(textureLod(uCs,(g.xz-uCsXf.xy)*uCsXf.z+.5,0.).rg,0.,1.); return; }
  for(int y=0;y<16;y++)for(int x=0;x<32;x++){ vec2 uv=(vec2(float(x),float(y))+.5)/vec2(32.,16.); float el=(uv.y-.5)*PI; float c=cos(el); float k2=k==0?max(sin(el),0.):k==1?max(-sin(el),0.):exp(-el*el*40.); s+=textureLod(uEnv,uv,0.).rgb*c*k2; w+=c*k2; }
  o=vec4(s/w,1.); }`;

export async function create(ctx) {
  const renderer = new THREE.WebGLRenderer({ canvas: ctx.canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', reversedDepthBuffer: true });
  ctx.renderer = renderer;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.setPixelRatio(1); renderer.info.autoReset = false; renderer.autoClear = true; renderer.setClearColor(0, 1);
  const gl = renderer.getContext(); renderer.extensions.get('EXT_color_buffer_float'); renderer.extensions.get('OES_texture_float_linear');
  const reversed = renderer.state.buffers.depth.getReversed() === true;
  if (reversed) ctx.camera._reversedDepth = true; else ctx.camera.near = 0.4;
  ctx.camera.updateProjectionMatrix();
  patchChunks();
  const q0 = ctx.quality, G = ctx.globals, scene = ctx.scene;
  const noise = bakeNoise(renderer, q0.id === 'low' ? 64 : 128, 64), blue = blueNoise(64);
  const atm = new Atmosphere(renderer), SU = new StormUniforms(ctx);
  const depthK = { value: new THREE.Vector4() }, invVP = { value: new THREE.Matrix4() }, camPos = { value: new THREE.Vector3() }, fwd = { value: new THREE.Vector3() }, groundRad = { value: new THREE.Vector3(0.1, 0.1, 0.1) }, resolution = { value: new THREE.Vector2(1, 1) };
  const stormMap = new StormMap(renderer, noise, SU.stormU, q0.id === 'low' ? 512 : 1024);
  const curVPu = { value: new THREE.Matrix4() }, invVPu = new THREE.Matrix4();
  const shared = { curVP: curVPu, atm, atmU: atm.u, stormU: SU.stormU, torU: SU.torU, noise, blue, depthK, invVP, cam: camPos, fwd, groundRad, csTex: stormMap.csTex };
  atm.initAerial(stormMap.csTex.value, stormMap.csXf, camPos.value);
  const vol = new Volume(renderer, shared), post = new Post(renderer, shared), csm = new CSM(renderer, ctx), pmrem = new THREE.PMREMGenerator(renderer);
  vol.u.uM0.value = stormMap.rt.textures[0]; vol.u.uM1.value = stormMap.rt.textures[1]; vol.u.uXf.value = stormMap.xf; vol.u.uCsXf.value = stormMap.csXf;
  csmU.shMap.value[0] = stormMap.csTex.value;
  const probeRT = new THREE.WebGLRenderTarget(4, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const mProbe = fsMaterial(PROBE, { ...atm.u, uEnv: { value: null }, uCs: { value: stormMap.csTex.value }, uCsXf: { value: stormMap.csXf }, uCam: camPos, uSunDir: { value: atm.lightDir }, uGround: { value: 0 } });
  const probe = new Float32Array(16); let probeBusy = false;

  // lights
  const mkSun = (s) => { const l = new THREE.DirectionalLight(0xffffff, 1); l.castShadow = false; s.add(l); s.add(l.target); return l; };
  const sun = mkSun(scene), sunV = mkSun(ctx.viewScene), sunF = mkSun(ctx.fxScene);
  scene.matrixWorldAutoUpdate = true;

  let W = 0, H = 0, RW = 0, RH = 0, dyn = 1, sceneRT = null, envRT = null, q = q0, EV = 1, frame = 0, envT = 0, envCount = 0, wasCam = new THREE.Vector3(1e9, 0, 0), bigReset = true;
  const prevVP = new THREE.Matrix4(), curVP = new THREE.Matrix4(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), savedP = new THREE.Matrix4(), savedPI = new THREE.Matrix4();
  const flashes = [], lens = { mud: 0, rain: 0 };
  const stats = { gpuMs: 0, cpuMs: 0, drawCalls: 0, tris: 0, fps: 60, scale: 1, width: 0, height: 0, reversed };

  function setSizes(fromDyn = false) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), cw = Math.max(2, Math.round(innerWidth * dpr)), ch = Math.max(2, Math.round(innerHeight * dpr));
    let sc = q.pixelRatio * clamp(ctx.settings.get('resolution') || 1, 0.4, 2) * dyn; const cap = PIXEL_CAP[q.id] || 3.7e6; const px = cw * ch * sc * sc; if (px > cap) sc *= Math.sqrt(cap / px);
    if (W !== cw || H !== ch) { W = cw; H = ch; renderer.setSize(W, H, false); }
    const rw = Math.max(64, Math.round(W * sc / 2) * 2), rh = Math.max(36, Math.round(H * sc / 2) * 2);
    if (rw !== RW || rh !== RH) {
      RW = rw; RH = rh; if (sceneRT) { sceneRT.depthTexture.dispose(); sceneRT.dispose(); }
      const d = new THREE.DepthTexture(RW, RH, THREE.FloatType); d.format = THREE.DepthFormat;
      sceneRT = new THREE.WebGLRenderTarget(RW, RH, { type: THREE.HalfFloatType, depthTexture: d, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, samples: 0 });
      post.resize(RW, RH); gfx.depthTexture.value = d; if (!fromDyn) bigReset = true;
    }
    const vs = VOL_SCALE[q.id] ?? q.volScale;
    vol.resize(Math.round(RW * vs), Math.round(RH * vs), RW, RH);
    resolution.value.set(RW, RH); stats.width = RW; stats.height = RH; stats.scale = sc;
  }
  function applyQuality() {
    q = ctx.quality; csm.setQuality(q, ctx.settings.get('shadows'));
    applySteps(); setSizes();
  }
  ctx.events.on('quality:changed', applyQuality);
  ctx.events.on('settings:changed', (e) => { if (['resolution', 'dynamicRes'].includes(e.key)) { if (e.key === 'dynamicRes' && !e.value) dyn = 1; setSizes(); } if (e.key === 'shadows') csm.setQuality(q, e.value); });

  // ---- lightning ----
  function flash(x, y, z, energy = 1, o = {}) {
    const n = 1 + Math.floor(Math.random() * (o.kind === 'cg' ? 4 : 5)), st = []; let t = 0; for (let i = 0; i < n; i++) { st.push([t, 0.45 + 0.75 * Math.random(), 0.05 + 0.09 * Math.random()]); t += 0.04 + Math.random() * 0.16; }
    flashes.push({ x, y, z, gy: o.ty ?? y, tx: o.tx ?? x, tz: o.tz ?? z, e: energy, t0: ctx.time.real, st, kind: o.kind, I: 0 }); if (flashes.length > 12) flashes.shift();
  }
  ctx.events.on('lightning', (l) => flash(l.x, l.y, l.z, l.energy ?? 1, l));
  function updateFlashes() {
    let best = null;
    for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i], t = ctx.time.real - f.t0; let I = 0; for (const s of f.st) if (t >= s[0]) { const u = t - s[0]; I += s[1] * (Math.exp(-u / s[2]) + 0.12 * Math.exp(-u / (s[2] * 5))) * Math.min(1, u / 0.012 + 0.35); } f.I = I * clamp(f.e, 0.05, 6); if (t > 1.6) flashes.splice(i, 1); else if (!best || f.I > best.I) best = f; }
    flashes.sort((a, b) => b.I - a.I); const n = Math.min(4, flashes.length); let k = 0; const u = vol.u.uFlash.value;
    for (let i = 0; i < n; i++) if (flashes[i].I > 0.004) { const f = flashes[i]; u[k++].set(f.x, f.y, f.z, f.I * 26); }
    vol.u.uNF.value = k;
    if (best) { const my = best.kind === 'cg' ? best.gy * 0.35 + best.y * 0.65 : best.y; G.uLightning.value.set(best.x, my, best.z, best.I); } else G.uLightning.value.w = 0;
  }

  // ---- env / probes ----
  function updateEnv() {
    vol.renderEnv(q.id === 'low' ? 40 : 64);
    const tex = post.envMap(vol.env.textures[0]);
    envRT = pmrem.fromEquirectangular(tex, envRT);
    scene.environment = envRT.texture; ctx.viewScene.environment = envRT.texture; ctx.fxScene.environment = envRT.texture;
    mProbe.uniforms.uEnv.value = tex; mProbe.uniforms.uGround.value = groundY; draw(renderer, mProbe, probeRT);
    const take = () => { const k = gfx._probeInit ? 0.5 : 1; gfx._probeInit = true; for (let i = 0; i < 16; i++) probe[i] += ((Number.isFinite(buf[i]) ? buf[i] : 0) - probe[i]) * k; };
    const buf = new Float32Array(16);
    if (envCount < 2) { renderer.readRenderTargetPixels(probeRT, 0, 0, 4, 1, buf); take(); }
    else if (!probeBusy) { probeBusy = true; renderer.readRenderTargetPixelsAsync(probeRT, 0, 0, 4, 1, buf).then(take).catch(() => {}).finally(() => { probeBusy = false; }); }
    envCount++;
  }

  // ---- GPU timer ----
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2'); let tqA = null; const tqP = [];
  const tBegin = () => { if (tq && !tqA && tqP.length < 4) { tqA = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, tqA); } };
  const tEnd = () => { if (tqA) { gl.endQuery(tq.TIME_ELAPSED_EXT); tqP.push(tqA); tqA = null; } if (tqP.length && gl.getQueryParameter(tqP[0], gl.QUERY_RESULT_AVAILABLE)) { const ms = gl.getQueryParameter(tqP[0], gl.QUERY_RESULT) / 1e6; gl.deleteQuery(tqP.shift()); if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) stats.gpuMs += (ms - stats.gpuMs) * 0.1; } };

  // ---- dynamic resolution ----
  let drAcc = 0, drN = 0, drHold = 3, drBad = 9, dynQ = 1;
  function dynamicRes(dt) {
    if (!ctx.settings.get('dynamicRes') || ctx.state === 'loading' || document.hidden) return; if (dt > 0.25) return;
    drAcc += dt; drN++; drHold -= dt; if (drAcc < 1 || drHold > 0) { if (drAcc >= 1) { stats.fps = drN / drAcc; drAcc = drN = 0; } return; }
    const ms = drAcc / drN * 1000; stats.fps = 1000 / ms; drAcc = drN = 0; let nd = dyn; const gms = stats.gpuMs || 0;
    // shed volumetric step count first (invisible thanks to the temporal resolve), resolution only as a last resort
    const slow = ms > 18.6 && (!gms || gms > 13), fast = ms < 17.4;
    if (slow && dynQ > 0.62) { dynQ = Math.max(0.6, dynQ - (ms > 26 ? 0.2 : 0.1)); drHold = 1.5; applySteps(); return; }
    if (slow) { drBad = dyn; nd = Math.max(0.7, dyn - (ms > 26 ? 0.1 : 0.05)); } else if (fast && dyn < 1 && (dyn + 0.05 < drBad - 0.001 || gms && gms < 9)) nd = Math.min(1, dyn + 0.05);
    else if (fast && dyn >= 1 && dynQ < 1 && (!gms || gms < 11)) { dynQ = Math.min(1, dynQ + 0.1); drHold = 4; applySteps(); return; }
    drBad = Math.min(9, drBad + 0.002);
    if (Math.abs(nd - dyn) > 0.01) { drHold = nd < dyn ? 2.5 : 6; dyn = nd; setSizes(true); }
  }
  function applySteps() {
    const s = q.volSteps * (q.id === 'ultra' ? 1.45 : 1.3);
    vol.u.uSteps.value = Math.round(s * (0.5 + 0.5 * dynQ)); vol.u.uLSteps.value = Math.max(3, q.lightSteps - (dynQ < 0.8 ? 1 : 0));
    vol.u.uQual.value = clamp(105 / q.volSteps, 0.7, 1.9) / dynQ;
  }

  let groundY = 0, dark = 0, cu = 0.45, green = 0; const wx = {};
  function render(dt) {
    const t0 = performance.now(), cam = ctx.camera; frame++; renderer.info.reset();
    dynamicRes(ctx.time.dt ? Math.max(dt, 0.001) : dt);
    updateFlashes();
    cam.updateMatrixWorld(); if (!Number.isFinite(cam.position.x + cam.position.y + cam.position.z)) return;
    const jump = wasCam.distanceTo(cam.position) > 120; if (jump) { bigReset = true; } wasCam.copy(cam.position);
    const gH = SU.groundAt(cam.position.x, cam.position.z); groundY += (gH - groundY) * (bigReset ? 1 : Math.min(1, dt * 0.5));
    // ---- sky & lighting ----
    atm.update(ctx.time.hour, groundY - 30);
    const w = ctx.storms?.weatherAt?.(cam.position.x, cam.position.z, wx) || wx;
    const kd = bigReset ? 1 : Math.min(1, dt * 0.8); dark += ((w.dark || 0) - dark) * kd; cu += (clamp(0.16 + 0.42 * (w.cloud ?? 0.4), 0.1, 0.7) - cu) * kd; green += ((w.hail || 0) - green) * kd;
    SU.update(dt); const now = ctx.time.now;
    camPos.value.copy(cam.position); cam.getWorldDirection(fwd.value);
    stormMap.update(cam.position, now, groundY, atm.lightDir, cu, frame, bigReset);
    atm.beta = (gfx.haze.beta) * (1 + 0.6 * (w.rain || 0)); atm.updateAerial(frame);
    const E = atm.lightE, sunOn = E.x + E.y + E.z > 0.004, csCam = gfx._probeInit ? probe[8] : 1;
    for (const l of [sun, sunV, sunF]) { l.color.setRGB(E.x, E.y, E.z); l.intensity = 1; l.target.position.copy(cam.position); l.position.copy(cam.position).addScaledVector(atm.lightDir, 500); l.updateMatrixWorld(); l.target.updateMatrixWorld(); }
    G.uSunDir.value.copy(atm.lightDir); G.uSunColor.value.setRGB(E.x, E.y, E.z).multiplyScalar(csCam / Math.PI);
    G.uAmbient.value.setRGB(probe[0], probe[1], probe[2]);
    const alb = 0.13; groundRad.value.set(alb * (E.x * atm.lightDir.y * 0.45 / Math.PI + probe[0]), alb * 1.02 * (E.y * atm.lightDir.y * 0.45 / Math.PI + probe[1]), alb * 0.72 * (E.z * atm.lightDir.y * 0.45 / Math.PI + probe[2]));
    const P = csmU.shP.value; P[1].set(stormMap.csXf.x, stormMap.csXf.y, stormMap.csXf.z, groundY); P[2].set(atm.lightDir.x, atm.lightDir.y, atm.lightDir.z, gfx._probeInit ? probe[9] : 1);
    P[5].set(probe[0] * Math.PI, probe[1] * Math.PI, probe[2] * Math.PI, 0); P[6].set(groundRad.value.x * Math.PI, groundRad.value.y * Math.PI, groundRad.value.z * Math.PI, 0); P[7].set(0.78, 0.87, 1.12, 0);
    const Lg = G.uLightning.value; _v.set(Lg.x, Lg.y, Lg.z).applyMatrix4(cam.matrixWorldInverse); P[3].set(_v.x, _v.y, _v.z, Lg.w * gfx.lightningGain);
    envT -= dt; if (bigReset || frame === 2 || envT <= 0) { envT = q.id === 'low' ? 5 : 2.2; if (frame > 1) { volUniforms(now, cam); updateEnv(); } }
    // ---- camera ----
    savedP.copy(cam.projectionMatrix); savedPI.copy(cam.projectionMatrixInverse);
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); curVP.copy(_m); curVPu.value.copy(_m); invVPu.copy(_m).invert();
    const j = q.taa ? JIT[frame % 16] : [0, 0];
    cam.projectionMatrix.elements[8] += j[0] * 2 / RW; cam.projectionMatrix.elements[9] += j[1] * 2 / RH; cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    invVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
    const pe = cam.projectionMatrix.elements; depthK.value.set(pe[10], pe[14], reversed ? 1 : 2, reversed ? 0 : -1);
    gfx.cameraNearFar.value.set(cam.near, cam.far);
    csm.prepare(frame, atm.lightDir, sunOn && csCam > 0.004); csm.updateReceivers(cam, frame);
    // ---- opaque ----
    tBegin();
    renderer.setRenderTarget(sceneRT); renderer.autoClear = true; renderer.render(scene, cam);
    const depth = sceneRT.depthTexture;
    if (q.ssao) post.ao(depth, pe, frame);
    // ---- volumetrics ----
    volUniforms(now, cam); vol.u.uDepth.value = depth; vol.mT.uniforms.uAlpha.value = q.taa ? 0.075 : 0.1;
    if (bigReset) { vol.reset = true; post.reset = true; prevVP.copy(curVP); }
    vol.render(prevVP, dt);
    // ---- composite ----
    const s = post.skyU; s.uTime.value = now; s.uNight.value = atm.night; s.uDrift.value.set(now * 9, now * -3); s.uCirrus.value = 0.35 + 0.4 * cu;
    post.composite(sceneRT.texture, depth, vol, q.ssao);
    const ctex = q.taa ? post.taa(depth, vol, prevVP, j[0], j[1]) : post.comp.texture;
    post.toHdr(ctex, depth);
    // ---- transparents + view models ----
    renderer.setRenderTarget(post.hdr); renderer.autoClear = false;
    if (ctx.fxScene.children.length > 2) renderer.render(ctx.fxScene, cam);
    if (ctx.viewScene.children.length > 2) { renderer.clearDepth(); renderer.render(ctx.viewScene, cam); }
    renderer.autoClear = true;
    // ---- post ----
    if (bigReset && frame < 4) post.resetExp = true;
    const ex = post.mExp.uniforms; ex.uMin.value = 0.06; ex.uMax.value = 0.9 + 13 * (1 - atm.night) + 7 * atm.night; ex.uKey.value = 0.165 * (1 - 0.22 * dark) * (1 - 0.35 * atm.night);
    post.bloom(dt, q.bloom);
    const f = post.mFinal.uniforms, foot = ctx.player && !ctx.player.mock && ctx.player.mode !== 'drive';
    lens.mud = Math.max(0, lens.mud - dt * 0.035); lens.rain = Math.max(0, lens.rain - dt * 0.12); const rainLens = foot ? (G.uRain.value || 0) * 0.5 : 0;
    f.uTime.value = ctx.time.real % 1000; f.uGrain.value = ctx.settings.get('filmGrain') ? 0.022 + 0.03 * atm.night : 0; f.uBloomW.value = q.bloom ? 0.055 : 0; f.uEV.value = EV; f.uMud.value = lens.mud; f.uDrops.value = Math.max(lens.rain, rainLens); f.uNight.value = atm.night; f.uGreen.value = green * 0.8; f.uSharp.value = q.taa ? 0.32 : stats.scale < 0.95 ? 0.25 : 0;
    post.final(null);
    tEnd();
    cam.projectionMatrix.copy(savedP); cam.projectionMatrixInverse.copy(savedPI);
    prevVP.copy(curVP); bigReset = false;
    stats.drawCalls = renderer.info.render.calls; stats.tris = renderer.info.render.triangles; stats.cpuMs += (performance.now() - t0 - stats.cpuMs) * 0.05;
  }
  function volUniforms(now, cam) {
    const u = vol.u; u.uCam.value.copy(cam.position); u.uFwd.value.copy(fwd.value); u.uSunDir.value.copy(atm.lightDir); u.uSunE.value.copy(atm.lightE); u.uSunEHigh.value.copy(atm.lightEHigh); u.uGroundRad.value.copy(groundRad.value);
    u.uInvVP.value.copy(invVPu); u.uTime.value = now; u.uFrame.value = frame % 1024; u.uGround.value = groundY; u.uTop.value = Math.max(SU.top, groundY + 3600); u.uPix.value = 2 * Math.tan(cam.fov * Math.PI / 360) / Math.max(Math.sqrt(vol.h * vol.lh), 1); u.uDrift.value.set(now * 7, now * -2.2);
  }

  const gfx = {
    renderer, sun, stats, shared, csm, atm, vol, post, stormMap,
    // scene colour before TAA and the resolved volumetric layer, for transparents that refract/reflect (water)
    sceneColor: { get value() { return post.comp?.texture || null; } }, volumeTexture: { get value() { return vol.out?.textures?.[0] || null; } },
    depthTexture: { value: null }, resolution, cameraNearFar: { value: new THREE.Vector2(0.15, 60000) }, depthParams: depthK,
    linearDepthGLSL: DEPTH_GLSL, lightningGain: 1, haze: { beta: 8.5e-5 },
    // fog for transparent shaders: uniforms {...gfx.fogUniforms}, GLSL gfx.fogGLSL -> vec3 applyAerial(color, uCamPos, rayDir, dist)
    fogUniforms: { uSkyLut: atm.u.uSkyLut, uAerialLut: atm.u.uAerialLut, uHazeK: atm.u.uHazeK }, fogGLSL: '#define sat(x) clamp(x,0.,1.)\n#ifndef PI\n#define PI 3.14159265359\n#endif\n' + SKY_GLSL,
    get exposure() { return EV; }, set exposure(v) { EV = v; },
    render, resize: setSizes, setQuality: applyQuality, flash,
    addLensEffect(kind, amount = 0.3) { if (kind in lens) lens[kind] = clamp(lens[kind] + amount, 0, 1); },
    visibilityAlong(x, y, z) {
      const c = ctx.camera.position, dx = x - c.x, dy = y - c.y, dz = z - c.z, d = Math.hypot(dx, dy, dz); let od = atm.beta * d;
      const S = ctx.storms; if (S?.weatherAt) for (let i = 0; i < 4; i++) { const f = (i + 0.5) / 4, ww = S.weatherAt(c.x + dx * f, c.z + dz * f, wx); if (ww?.rain > 0.02) od += ww.rain * 0.0026 * d / 4; }
      return Math.exp(-od);
    },
    async capture(w = 1600, h = 900) {
      const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      const old = [post.mFx.uniforms.uPx.value.x, post.mFx.uniforms.uPx.value.y]; post.mFx.uniforms.uT.value = post.ldr.texture; draw(renderer, post.mFx, rt); post.mFx.uniforms.uPx.value.set(old[0], old[1]);
      const buf = new Uint8Array(w * h * 4); try { await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h, buf); } catch { renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf); }
      renderer.setRenderTarget(null); rt.dispose();
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'), im = g.createImageData(w, h);
      for (let y = 0; y < h; y++) im.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      for (let i = 3; i < im.data.length; i += 4) im.data[i] = 255; g.putImageData(im, 0, 0); return { canvas: cv };
    },
    // force a full temporal reset (camera cut)
    cut() { bigReset = true; },
    async init() {
      const ms = performance.now(); try { await Promise.race([compileAsync(renderer, [vol.mat, vol.mT, post.mComp, post.mTaa, post.mAo, post.mFinal, post.mFx, post.mEnv, stormMap.mMap, stormMap.mCs]), new Promise((r) => setTimeout(r, 15000))]); } catch (e) { console.warn('[gfx] compileAsync', e); }
      stats.compileMs = performance.now() - ms;
    },
    dispose() { renderer.dispose(); },
  };
  atm.init(); atm.update(ctx.time.hour, 0); setSizes(); applyQuality(); ctx.gfx = gfx;
  void hdrRT; void MAP_SIZE; void CS_SIZE; void _v2;
  return gfx;
}

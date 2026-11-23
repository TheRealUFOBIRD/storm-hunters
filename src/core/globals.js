import * as THREE from 'three';
// Shared uniform objects. Reference these exact objects from any material.
export const createGlobals = () => ({
  uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() },
  uWind: { value: new THREE.Vector2(4, 1) },      // local surface wind at camera (m/s, xz)      [storms writes]
  uGust: { value: 0 },                            // 0..1 gustiness                              [storms writes]
  uWetness: { value: 0 },                         // 0..1 at camera (integrates rain)            [storms writes]
  uRain: { value: 0 }, uHail: { value: 0 },       //                                             [storms writes]
  uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.3).normalize() }, uSunColor: { value: new THREE.Color(1, 0.95, 0.85) }, // [gfx writes]
  uAmbient: { value: new THREE.Color(0.35, 0.4, 0.48) },                                         // [gfx writes]
  uStormDark: { value: 0 },                       // 0..1                                        [storms writes]
  uLightning: { value: new THREE.Vector4() },     // xyz pos, w intensity                        [gfx writes]
  uTornadoA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) }, // x,z,rCore,vmax (4 nearest) [storms writes]
});

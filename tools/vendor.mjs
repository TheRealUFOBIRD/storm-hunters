// Copies runtime libs out of node_modules into /vendor so the game needs no build step on GitHub Pages.
import fs from 'node:fs';
const c = (a, b) => { fs.mkdirSync(b.replace(/\/[^/]+$/, ''), { recursive: true }); fs.copyFileSync(a, b); };
c('node_modules/three/build/three.module.min.js', 'vendor/three/three.module.min.js');
c('node_modules/three/build/three.core.min.js', 'vendor/three/three.core.min.js');
c('node_modules/three/LICENSE', 'vendor/three/LICENSE');
for (const f of ['utils/BufferGeometryUtils.js', 'loaders/GLTFLoader.js', 'geometries/RoundedBoxGeometry.js', 'utils/SkeletonUtils.js', 'math/ImprovedNoise.js', 'math/SimplexNoise.js', 'environments/RoomEnvironment.js'])
  if (fs.existsSync('node_modules/three/examples/jsm/' + f)) c('node_modules/three/examples/jsm/' + f, 'vendor/three/addons/' + f);
c('node_modules/peerjs/dist/peerjs.min.js', 'vendor/peerjs/peerjs.min.js');
if (fs.existsSync("node_modules/peerjs/LICENSE")) c("node_modules/peerjs/LICENSE", "vendor/peerjs/LICENSE");
console.log('vendored');

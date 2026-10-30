// Builds the SKYFALL arena: a floating forest plateau in the sky.
//
// The terrain itself comes from shared/map.js as boxes (one merged, vertex
// coloured mesh). Everything that makes it read as a nature scene — trees,
// grass, ferns, flowers, boulders, the lake, distant peaks, clouds — is added
// here as instanced geometry so the whole map still costs a handful of draw
// calls.
import * as THREE from 'three';
import ARENA from '../../shared/map.js';
import { solidAABBs } from '../../shared/collision.js';
import { cloudTexture, softCircleTexture } from './textures.js';

const SKY_TOP = 0x1f6fbe;
const SKY_MID = 0x7fb6dd;
const SKY_LOW = 0xd7e7ee;

const LEAF_TINTS = [0x3f7a35, 0x4b8a3c, 0x336a2e, 0x577f38];
const PINE_TINTS = [0x2c5c31, 0x356b37, 0x27502c];

export function buildWorld(renderer, scene, camera) {
  const palette = ARENA.sky || {};
  scene.fog = new THREE.Fog(palette.fog ?? 0xc3d8e4, 240, 760);

  // ---------------------------------------------------------------- sky dome
  const skyGeo = new THREE.SphereGeometry(1400, 32, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(SKY_TOP) },
      mid: { value: new THREE.Color(SKY_MID) },
      low: { value: new THREE.Color(SKY_LOW) },
      sunDir: { value: new THREE.Vector3(-0.42, 0.34, -0.84).normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 1.05 + 0.02, -1.0, 1.0);
        vec3 col = mix(low, mid, smoothstep(-0.10, 0.34, h));
        col = mix(col, top, smoothstep(0.22, 0.95, h));
        // warm haze on the horizon
        col += vec3(0.16, 0.12, 0.06) * pow(1.0 - clamp(abs(h), 0.0, 1.0), 6.0);
        // sun and its glow
        float sd = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.92, 0.74) * pow(sd, 260.0) * 1.7;
        col += vec3(1.0, 0.88, 0.68) * pow(sd, 7.0) * 0.20;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xbcd9f2, 0x3f5a34, 1.05);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
  sun.position.set(-90, 110, -160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowSpan = 95;
  sun.shadow.camera.left = -shadowSpan;
  sun.shadow.camera.right = shadowSpan;
  sun.shadow.camera.top = shadowSpan;
  sun.shadow.camera.bottom = -shadowSpan;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(sun);
  scene.add(sun.target);

  const bounce = new THREE.DirectionalLight(0x9dc6ff, 0.32);
  bounce.position.set(120, 40, 140);
  scene.add(bounce);

  // ---------------------------------------------------------------- terrain
  const world = new THREE.Group();
  scene.add(world);

  const merged = buildArenaGeometry(ARENA.boxes);
  const arenaMesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
  arenaMesh.castShadow = true;
  arenaMesh.receiveShadow = true;
  arenaMesh.frustumCulled = false;
  world.add(arenaMesh);

  const HALF = ARENA.size / 2;
  const mats = {
    bark: new THREE.MeshLambertMaterial({ color: 0x5a422c }),
    rock: new THREE.MeshLambertMaterial({ color: 0x7c8084, flatShading: true }),
  };

  // ---------------------------------------------------------------- trees
  // Trunks are instanced cylinders, canopies are instanced cones (pine) and
  // instanced icospheres (broadleaf) with per-instance tint.
  const trees = ARENA.trees || [];
  const pines = trees.filter((t) => t.kind === 'pine');
  const broads = trees.filter((t) => t.kind !== 'pine');

  function instanced(geom, material, count, tintFn) {
    const mesh = new THREE.InstancedMesh(geom, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (tintFn) {
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) mesh.setColorAt(i, c.setHex(tintFn(i)));
    }
    world.add(mesh);
    return mesh;
  }

  const trunkGeo = new THREE.CylinderGeometry(0.34, 0.52, 1, 7);
  trunkGeo.translate(0, 0.5, 0);                        // pivot at the base
  const trunks = instanced(trunkGeo, mats.bark, trees.length);
  const dummy = new THREE.Object3D();
  trees.forEach((t, i) => {
    dummy.position.set(t.x, t.baseY, t.z);
    dummy.scale.set(t.trunkW, t.h * 0.72, t.trunkW);
    dummy.rotation.set(0, (i * 1.7) % Math.PI, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;

  // pine canopies: three stacked cones
  const coneGeo = new THREE.ConeGeometry(1, 1, 8);
  coneGeo.translate(0, 0.5, 0);
  const pineMeshes = [];
  for (let layer = 0; layer < 3; layer++) {
    const mesh = instanced(coneGeo, new THREE.MeshLambertMaterial({ flatShading: true }),
      pines.length, (i) => (pines[i].tint || PINE_TINTS[i % 3]));
    pineMeshes.push(mesh);
  }
  pines.forEach((t, i) => {
    for (let layer = 0; layer < 3; layer++) {
      const r = t.radius * (1 - layer * 0.26);
      const h = t.h * (0.34 - layer * 0.06);
      const y = t.baseY + t.h * (0.42 + layer * 0.19);
      dummy.position.set(t.x, y, t.z);
      dummy.scale.set(r, h, r);
      dummy.rotation.set(0, i * 0.9 + layer, 0);
      dummy.updateMatrix();
      pineMeshes[layer].setMatrixAt(i, dummy.matrix);
    }
  });
  for (const m of pineMeshes) m.instanceMatrix.needsUpdate = true;

  // broadleaf canopies: a cluster of three blobs
  const blobGeo = new THREE.IcosahedronGeometry(1, 0);
  const broadMeshes = [];
  for (let layer = 0; layer < 3; layer++) {
    const mesh = instanced(blobGeo, new THREE.MeshLambertMaterial({ flatShading: true }),
      broads.length, (i) => (broads[i].tint || LEAF_TINTS[i % 4]));
    broadMeshes.push(mesh);
  }
  broads.forEach((t, i) => {
    for (let layer = 0; layer < 3; layer++) {
      const a = (layer / 3) * Math.PI * 2 + i;
      const r = t.radius * (0.62 + layer * 0.06);
      dummy.position.set(
        t.x + Math.cos(a) * t.radius * 0.42,
        t.baseY + t.h * (0.72 + (layer === 2 ? 0.16 : 0)),
        t.z + Math.sin(a) * t.radius * 0.42
      );
      dummy.scale.set(r, r * 0.82, r);
      dummy.rotation.set(i, a, i * 0.5);
      dummy.updateMatrix();
      broadMeshes[layer].setMatrixAt(i, dummy.matrix);
    }
  });
  for (const m of broadMeshes) m.instanceMatrix.needsUpdate = true;

  // ---------------------------------------------------------------- boulders
  // Faceted rocks sitting on top of the boxy collision shapes, so the terrain
  // reads organic without changing what you can shoot.
  const boulders = ARENA.boulders || [];
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rocks = instanced(rockGeo, new THREE.MeshLambertMaterial({ flatShading: true }),
    boulders.length, (i) => (boulders[i].mossy ? 0x77865f : 0x8b8f93));
  boulders.forEach((b, i) => {
    dummy.position.set(b.x, b.h * 0.52, b.z);
    dummy.scale.set(b.w * 0.62, b.h * 0.62, b.d * 0.62);
    dummy.rotation.set(b.rot * 0.6, b.rot, b.rot * 0.4);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  });
  rocks.instanceMatrix.needsUpdate = true;

  // ---------------------------------------------------------------- logs
  // Fallen trunks: cylinders laid over their collision boxes.
  const logGeo = new THREE.CylinderGeometry(0.72, 0.66, 1, 9);
  for (const l of (ARENA.logs || [])) {
    const m = new THREE.Mesh(logGeo, mats.bark);
    m.position.set(l.x, 1.15, l.z);
    if (l.alongX) {
      m.rotation.z = Math.PI / 2;
      m.scale.set(1, l.len, 1);
    } else {
      m.rotation.x = Math.PI / 2;
      m.scale.set(1, l.len, 1);
    }
    if (l.rot && !l.alongX) m.rotation.y = l.rot;
    m.castShadow = true;
    m.receiveShadow = true;
    world.add(m);
    // cut end
    const end = new THREE.Mesh(new THREE.CircleGeometry(0.68, 9), new THREE.MeshLambertMaterial({ color: 0x9a7a52 }));
    end.position.copy(m.position);
    world.add(end);
    void end;
  }

  const solids = solidAABBs(ARENA.boxes);
  const flatSolids = solids.filter((s) => s.maxY <= 0.3);

  // is this spot free grass (not inside terrain, a tree or a rock)?
  function floorFree(x, z, maxY = 0.35) {
    for (const s of solids) {
      if (x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ && s.maxY > maxY) return false;
    }
    void flatSolids;
    return true;
  }

  // Height of the walkable surface at a point (terraces, trails, hill tops), so
  // grass and flowers grow on the slopes instead of inside them.
  function groundHeight(x, z) {
    let top = 0;
    for (const s of solids) {
      if (x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ) {
        if (s.maxY > top && s.maxY <= 14) top = s.maxY;
      }
    }
    return top;
  }

  // ---------------------------------------------------------------- grass
  // Thousands of little blades, one instanced draw call, no shadows.
  const grassCount = 7000;
  const bladeGeo = new THREE.ConeGeometry(0.11, 0.62, 3);
  bladeGeo.translate(0, 0.31, 0);
  const grassMat = new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide });
  const grass = new THREE.InstancedMesh(bladeGeo, grassMat, grassCount);
  grass.castShadow = false;
  grass.receiveShadow = true;
  const grassColor = new THREE.Color();
  let gc = 0;
  const rand = mulberry32(20260430);
  const colourAt = (x, z) => 0x5c8a3c + (Math.floor(rand() * 3) - 1) * 0x0a0604;
  while (gc < grassCount) {
    const x = (rand() - 0.5) * (ARENA.size - 6);
    const z = (rand() - 0.5) * (ARENA.size - 6);
    if (!floorFree(x, z, 2.2)) continue;
    dummy.position.set(x, groundHeight(x, z) + 0.02, z);
    const s = 0.7 + rand() * 0.9;
    dummy.scale.set(s, s * (0.7 + rand() * 0.9), s);
    dummy.rotation.set(0, rand() * Math.PI, (rand() - 0.5) * 0.25);
    dummy.updateMatrix();
    grass.setMatrixAt(gc, dummy.matrix);
    grassColor.setHex(colourAt(x, z));
    grass.setColorAt(gc, grassColor);
    gc++;
  }
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  world.add(grass);

  // ferns: bigger, darker clumps near trees
  const fernGeo = new THREE.ConeGeometry(0.5, 1.1, 5, 1, true);
  fernGeo.translate(0, 0.55, 0);
  const ferns = new THREE.InstancedMesh(fernGeo, new THREE.MeshLambertMaterial({
    color: 0x3f6b33, flatShading: true, side: THREE.DoubleSide,
  }), 700);
  let fc = 0;
  for (const t of trees) {
    for (let k = 0; k < 3 && fc < 700; k++) {
      const a = rand() * Math.PI * 2;
      const r = 1.2 + rand() * 3;
      const x = t.x + Math.cos(a) * r;
      const z = t.z + Math.sin(a) * r;
      if (!floorFree(x, z, 2.2)) continue;
      dummy.position.set(x, groundHeight(x, z) + 0.02 + t.baseY, z);
      const s = 0.6 + rand() * 0.8;
      dummy.scale.set(s, s, s);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.updateMatrix();
      ferns.setMatrixAt(fc++, dummy.matrix);
    }
  }
  for (let i = fc; i < 700; i++) {
    dummy.position.set(0, -1000, 0);
    dummy.scale.set(0.001, 0.001, 0.001);
    dummy.updateMatrix();
    ferns.setMatrixAt(i, dummy.matrix);
  }
  ferns.instanceMatrix.needsUpdate = true;
  ferns.receiveShadow = true;
  world.add(ferns);

  // wildflowers: tiny coloured dots on sticks
  const flowerGeo = new THREE.IcosahedronGeometry(0.13, 0);
  const flowerMat = new THREE.MeshLambertMaterial({ vertexColors: false });
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, 900);
  const flowerColours = [0xf2e2a2, 0xe8a7c4, 0xf7f7f7, 0xc7a8f0, 0xf3c17a];
  for (let i = 0; i < 900; i++) {
    const x = (rand() - 0.5) * (ARENA.size - 10);
    const z = (rand() - 0.5) * (ARENA.size - 10);
    const ok = floorFree(x, z, 2.2);
    dummy.position.set(ok ? x : 0, ok ? groundHeight(x, z) + 0.34 : -1000, ok ? z : 0);
    const s = 0.7 + rand() * 0.8;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    flowers.setColorAt(i, new THREE.Color(flowerColours[i % flowerColours.length]));
  }
  flowers.instanceMatrix.needsUpdate = true;
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  world.add(flowers);

  // ---------------------------------------------------------------- water
  const lake = ARENA.lake;
  let water = null;
  if (lake) {
    const waterGeo = new THREE.CircleGeometry(lake.r * 0.94, 40);
    const waterMat = new THREE.MeshLambertMaterial({
      color: 0x2f7b93, transparent: true, opacity: 0.82, emissive: 0x0d2c38,
    });
    water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(lake.x, 0.12, lake.z);
    water.receiveShadow = true;
    world.add(water);
    // a shallow rim ring so the shoreline reads wet
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(lake.r * 0.93, lake.r * 1.02, 40),
      new THREE.MeshLambertMaterial({ color: 0x9aa07a, transparent: true, opacity: 0.7 })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(lake.x, 0.1, lake.z);
    world.add(rim);
  }

  // ---------------------------------------------------------------- horizon
  // Distant peaks: big low-poly cones fading into the haze, so the plateau has
  // a skyline instead of ending in nothing.
  const peakGroup = new THREE.Group();
  scene.add(peakGroup);
  const peakMat = new THREE.MeshLambertMaterial({ color: 0x6f8ea4, flatShading: true });
  const peakMatFar = new THREE.MeshLambertMaterial({ color: 0x93aec1, flatShading: true });
  const peakGeo = new THREE.ConeGeometry(1, 1, 6);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + 0.2;
    const dist = 520 + (i % 5) * 90;
    const h = 120 + ((i * 37) % 130);
    const m = new THREE.Mesh(peakGeo, i % 2 ? peakMat : peakMatFar);
    m.position.set(Math.cos(a) * dist, -60 + h * 0.28, Math.sin(a) * dist);
    m.scale.set(120 + ((i * 53) % 120), h, 120 + ((i * 31) % 130));
    m.rotation.y = a;
    peakGroup.add(m);
  }

  // ---------------------------------------------------------------- clouds
  const cloudTex = cloudTexture();
  const clouds = new THREE.Group();
  scene.add(clouds);
  const cloudMat = new THREE.SpriteMaterial({
    map: cloudTex, transparent: true, opacity: 0.62, depthWrite: false,
    color: 0xffffff, fog: false,
  });
  const cloudsData = [];
  for (let i = 0; i < 54; i++) {
    const s = new THREE.Sprite(cloudMat);
    const angle = Math.random() * Math.PI * 2;
    const radius = 150 + Math.random() * 420;
    s.position.set(Math.cos(angle) * radius, -46 - Math.random() * 70, Math.sin(angle) * radius);
    const sc = 70 + Math.random() * 170;
    s.scale.set(sc, sc * 0.46, 1);
    s.userData.spin = (Math.random() - 0.5) * 0.05;
    s.userData.baseY = s.position.y;
    s.userData.angle = angle;
    s.userData.radius = radius;
    cloudsData.push(s);
    clouds.add(s);
  }
  const layerTex = cloudTexture();
  layerTex.wrapS = layerTex.wrapT = THREE.RepeatWrapping;
  layerTex.repeat.set(9, 9);
  const layer = new THREE.Mesh(
    new THREE.PlaneGeometry(2200, 2200),
    new THREE.MeshBasicMaterial({
      map: layerTex, transparent: true, opacity: 0.45, depthWrite: false,
      color: 0xf2f8ff, side: THREE.DoubleSide,
    })
  );
  layer.rotation.x = -Math.PI / 2;
  layer.position.y = -76;
  scene.add(layer);

  // ---------------------------------------------------------------- particles
  // Pollen and dandelion seeds drifting through the meadow.
  const dustTex = softCircleTexture(64);
  const dustCount = 520;
  const dustPos = new Float32Array(dustCount * 3);
  const dustSeed = [];
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * (ARENA.size + 60);
    dustPos[i * 3 + 1] = Math.random() * 40 - 4;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * (ARENA.size + 60);
    dustSeed.push(Math.random() * Math.PI * 2);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    map: dustTex, size: 0.34, transparent: true, opacity: 0.55,
    color: 0xfff4c9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  scene.add(dust);

  // butterflies / small birds: cheap sprites circling above the meadow
  const critterTex = softCircleTexture(32);
  const critters = [];
  for (let i = 0; i < 24; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: critterTex, color: i % 3 === 0 ? 0xffd166 : 0xe8f0ff,
      transparent: true, opacity: 0.9, depthWrite: false,
    }));
    s.scale.set(0.7, 0.7, 1);
    const a = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 90;
    s.position.set(Math.cos(a) * r, 6 + Math.random() * 14, Math.sin(a) * r);
    s.userData = {
      a, r, speed: 0.06 + Math.random() * 0.12,
      y: s.position.y, bob: Math.random() * 6,
    };
    critters.push(s);
    scene.add(s);
  }

  // ---------------------------------------------------------------- setup
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(palette.fog ?? 0xc3d8e4);
  camera.far = 2600;
  camera.updateProjectionMatrix();

  let time = 0;
  function update(dt, camPos) {
    time += dt;
    sky.position.copy(camPos);
    dust.rotation.y = Math.sin(time * 0.02) * 0.2;

    for (const c of cloudsData) {
      const a = c.userData.angle + time * c.userData.spin * 0.06;
      c.position.x = Math.cos(a) * c.userData.radius;
      c.position.z = Math.sin(a) * c.userData.radius;
      c.position.y = c.userData.baseY + Math.sin(time * 0.16 + c.userData.angle) * 0.9;
    }
    for (const s of critters) {
      const u = s.userData;
      u.a += u.speed * dt;
      const x = Math.cos(u.a) * u.r;
      const z = Math.sin(u.a) * u.r;
      s.position.set(x, u.y + Math.sin(time * 2 + u.bob) * 1.1, z);
    }
    if (water) water.material.opacity = 0.78 + Math.sin(time * 0.9) * 0.05;
    dust.material.opacity = 0.4 + Math.sin(time * 0.35) * 0.12;
    // sun target follows the player loosely so shadows stay crisp locally
    sun.position.set(camPos.x - 90, camPos.y + 110, camPos.z - 160);
    sun.target.position.set(camPos.x, camPos.y - 8, camPos.z);
    sun.target.updateMatrixWorld();
  }

  return {
    scene,
    solids,
    update,
    sunDir: skyMat.uniforms.sunDir.value.clone(),
    trees: trunks,
    half: HALF,
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Merge every arena box into a single vertex-coloured geometry.
// 36 vertices per box (non-indexed box), colour picked per face from the box's
// side / top / bottom colours. A little per-face noise keeps big flat surfaces
// (rock ridges, terraces) from looking like plastic.
// ---------------------------------------------------------------------------
export function buildArenaGeometry(boxes) {
  const template = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const tPos = template.attributes.position.array;
  const tNrm = template.attributes.normal.array;

  const count = boxes.length;
  const positions = new Float32Array(count * 36 * 3);
  const normals = new Float32Array(count * 36 * 3);
  const colors = new Float32Array(count * 36 * 3);
  const color = new THREE.Color();
  const bottomColor = new THREE.Color();
  const rand = mulberry32(0x5eed77);

  let p = 0;
  for (const b of boxes) {
    const [px, py, pz] = b.p;
    const [sx, sy, sz] = b.s;
    bottomColor.setHex(b.c).multiplyScalar(0.45);
    const shade = 0.94 + rand() * 0.12;
    for (let i = 0; i < 36; i++) {
      const ix = i * 3;
      positions[p + ix] = tPos[ix] * sx + px;
      positions[p + ix + 1] = tPos[ix + 1] * sy + py;
      positions[p + ix + 2] = tPos[ix + 2] * sz + pz;
      normals[p + ix] = tNrm[ix];
      normals[p + ix + 1] = tNrm[ix + 1];
      normals[p + ix + 2] = tNrm[ix + 2];

      const ny = tNrm[ix + 1];
      if (ny > 0.5) color.setHex(b.ct ?? b.c);
      else if (ny < -0.5) color.copy(bottomColor);
      else color.setHex(b.c);

      colors[p + ix] = color.r * shade;
      colors[p + ix + 1] = color.g * shade;
      colors[p + ix + 2] = color.b * shade;
    }
    p += 108;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  template.dispose();
  return geo;
}

// Builds the SKYFALL arena that lives far above the clouds.
import * as THREE from 'three';
import ARENA from '../../shared/map.js';
import { solidAABBs } from '../../shared/collision.js';
import { cloudTexture, softCircleTexture } from './textures.js';

const SKY_TOP = 0x16233d;
const SKY_MID = 0x4a7ea8;
const SKY_LOW = 0xa9c6dc;

export function buildWorld(renderer, scene, camera) {
  scene.fog = new THREE.Fog(0x9db9cf, 90, 300);

  // ---------------------------------------------------------------- sky dome
  const skyGeo = new THREE.SphereGeometry(600, 32, 24);
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
        vec3 col = mix(low, mid, smoothstep(-0.06, 0.28, h));
        col = mix(col, top, smoothstep(0.15, 0.85, h));
        // warm horizon band
        col += vec3(0.20, 0.13, 0.07) * pow(1.0 - clamp(abs(h), 0.0, 1.0), 9.0);
        // sun
        float sd = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.86, 0.66) * pow(sd, 220.0) * 1.6;
        col += vec3(1.0, 0.82, 0.6) * pow(sd, 8.0) * 0.16;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x2a3550, 0.8);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe9c9, 1.7);
  sun.position.set(-60, 74, -120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -62;
  sun.shadow.camera.right = 62;
  sun.shadow.camera.top = 62;
  sun.shadow.camera.bottom = -62;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 320;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  const rim = new THREE.DirectionalLight(0x6ba8ff, 0.38);
  rim.position.set(80, 30, 90);
  scene.add(rim);

  // ---------------------------------------------------------------- geometry
  const matCache = new Map();
  function mat(color, opts = {}) {
    const key = `${color}|${opts.emissive || 0}|${opts.rough ?? 1}`;
    if (matCache.has(key)) return matCache.get(key);
    const m = new THREE.MeshLambertMaterial({ color, ...opts });
    matCache.set(key, m);
    return m;
  }

  const world = new THREE.Group();
  scene.add(world);

  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (const b of ARENA.boxes) {
    const side = b.c;
    const top = b.ct ?? b.c;
    const bottom = new THREE.Color(b.c).multiplyScalar(0.45).getHex();
    const mats = [
      mat(side), mat(side), mat(top), mat(bottom), mat(side), mat(side),
    ];
    const m = new THREE.Mesh(geo, mats);
    m.position.set(b.p[0], b.p[1], b.p[2]);
    m.scale.set(b.s[0], b.s[1], b.s[2]);
    m.castShadow = b.solid !== false;
    m.receiveShadow = true;
    world.add(m);
  }

  // ---------------------------------------------------------------- accents
  const accents = [];
  const accentMat = new THREE.MeshBasicMaterial({ color: 0x62d6ff, transparent: true, opacity: 0.85 });
  const accentRed = new THREE.MeshBasicMaterial({ color: 0xff9a5c, transparent: true, opacity: 0.85 });
  const stripGeo = new THREE.BoxGeometry(1, 1, 1);

  function strip(x, y, z, w, h, d, m) {
    const s = new THREE.Mesh(stripGeo, m);
    s.position.set(x, y, z);
    s.scale.set(w, h, d);
    world.add(s);
    return s;
  }

  // glowing edge lines along the four sides of the main plate
  for (const s of [-1, 1]) {
    strip(0, -0.02, s * 36.1, 72, 0.06, 0.24, accentMat);
    strip(s * 36.1, -0.02, 0, 0.24, 0.06, 72, accentMat);
  }
  // deck ring
  for (const s of [-1, 1]) {
    strip(0, 2.82, s * 10, 20, 0.05, 0.18, accentMat);
    strip(s * 10, 2.82, 0, 0.18, 0.05, 20, accentMat);
  }
  // tower beacons
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const beac = strip(sx * 26, 6.0, sz * 26, 0.5, 0.5, 0.5, accentRed.clone());
      accents.push({ mesh: beac, base: sx * 26, phase: Math.random() * 6 });
    }
  }
  // island beacons
  for (const sz of [-1, 1]) {
    const b = strip(0, 1.6, sz * 53.5, 0.4, 0.4, 0.4, accentMat.clone());
    accents.push({ mesh: b, base: 0.4, phase: Math.random() * 6, island: true });
  }

  // light spires under the towers to sell the height
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const g = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 1.4, 26, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x5fb8e8, transparent: true, opacity: 0.055,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      g.position.set(sx * 26, -13, sz * 26);
      world.add(g);
    }
  }

  // ---------------------------------------------------------------- clouds
  const cloudTex = cloudTexture();
  const clouds = new THREE.Group();
  scene.add(clouds);
  const cloudMat = new THREE.SpriteMaterial({
    map: cloudTex, transparent: true, opacity: 0.55, depthWrite: false,
    color: 0xdfeeff, fog: false,
  });
  const cloudsData = [];
  for (let i = 0; i < 46; i++) {
    const s = new THREE.Sprite(cloudMat);
    const angle = Math.random() * Math.PI * 2;
    const radius = 55 + Math.random() * 260;
    s.position.set(Math.cos(angle) * radius, -34 - Math.random() * 60, Math.sin(angle) * radius);
    const sc = 45 + Math.random() * 110;
    s.scale.set(sc, sc * 0.5, 1);
    s.userData.spin = (Math.random() - 0.5) * 0.05;
    s.userData.baseY = s.position.y;
    s.userData.angle = angle;
    s.userData.radius = radius;
    cloudsData.push(s);
    clouds.add(s);
  }
  // cloud layer directly below the arena so looking down reads as sky
  const layerTex = cloudTexture();
  layerTex.wrapS = layerTex.wrapT = THREE.RepeatWrapping;
  layerTex.repeat.set(5, 5);
  const layer = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshBasicMaterial({
      map: layerTex, transparent: true, opacity: 0.5, depthWrite: false,
      color: 0xeaf4ff, blending: THREE.NormalBlending, side: THREE.DoubleSide,
    })
  );
  layer.rotation.x = -Math.PI / 2;
  layer.position.y = -48;
  scene.add(layer);

  // ---------------------------------------------------------------- particles
  const dustTex = softCircleTexture(64);
  const dustCount = 260;
  const dustPos = new Float32Array(dustCount * 3);
  const dustSeed = [];
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 130;
    dustPos[i * 3 + 1] = Math.random() * 40 - 12;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 130;
    dustSeed.push(Math.random() * Math.PI * 2);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    map: dustTex, size: 0.28, transparent: true, opacity: 0.5,
    color: 0xffffff, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  scene.add(dust);

  // ---------------------------------------------------------------- setup
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x9db9cf);
  camera.far = 1200;
  camera.updateProjectionMatrix();

  const solids = solidAABBs(ARENA.boxes);

  let time = 0;
  function update(dt, camPos) {
    time += dt;
    sky.position.copy(camPos);
    dust.position.y = Math.sin(time * 0.12) * 1.5;

    for (const c of cloudsData) {
      const a = c.userData.angle + time * c.userData.spin * 0.06;
      c.position.x = Math.cos(a) * c.userData.radius;
      c.position.z = Math.sin(a) * c.userData.radius;
      c.position.y = c.userData.baseY + Math.sin(time * 0.18 + c.userData.angle) * 0.8;
    }
    for (const a of accents) {
      const pulse = 0.55 + 0.45 * Math.sin(time * 2.2 + a.phase);
      a.mesh.material.opacity = 0.35 + pulse * 0.65;
    }
    dust.material.opacity = 0.35 + Math.sin(time * 0.4) * 0.1;
    // sun target follows the player loosely so shadows stay crisp locally
    sun.position.set(camPos.x - 60, camPos.y + 74, camPos.z - 120);
    sun.target.position.set(camPos.x, camPos.y - 6, camPos.z);
    sun.target.updateMatrixWorld();
  }

  return {
    scene,
    solids,
    update,
    sunDir: skyMat.uniforms.sunDir.value.clone(),
    boxGeometry: geo,
  };
}

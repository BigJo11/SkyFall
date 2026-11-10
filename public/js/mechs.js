// Mechs on screen: a walking weapons platform built from primitives, with a
// shield bubble and a core-failure strobe.
//
// Your own mech is not drawn — you are inside it, looking out of the cockpit.
import * as THREE from 'three';
import { MECH, MECH_COSMETIC } from '../../shared/constants.js';
import { carbonTexture, scanlineTexture } from './textures.js';

const HULL = 0x4a5364;
const HULL_DARK = 0x2b3240;
const HULL_LIGHT = 0x6b7789;
const GLASS = 0x8fd8ff;

// Hull finishes, mirroring the ones a character can wear. By the time a mech
// is built the server has already refused the crew-only finishes for anyone
// without the code, so whatever arrives here is allowed to look like this.
//
// `primary` is the hull and every lit accent; `secondary` is the trim.
function buildHullMaterials(primary, secondary, materialId) {
  const body = new THREE.Color(primary);
  const trim = new THREE.Color(secondary);
  const pale = (c, amount) => c.clone().lerp(new THREE.Color(0xffffff), amount);
  const textures = [];
  let animate = null;
  let glow = false;

  const flat = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });
  const set = {
    hull: flat(body, {}),
    dark: flat(trim, {}),
    light: flat(pale(body, 0.22), {}),
    accent: flat(body, { emissive: body.clone().multiplyScalar(0.45) }),
  };

  switch (materialId) {
    case 'metal': {
      const spec = 0xdfefff;
      set.hull = new THREE.MeshPhongMaterial({ color: body, specular: spec, shininess: 110 });
      set.dark = new THREE.MeshPhongMaterial({ color: trim, specular: spec, shininess: 130 });
      set.light = new THREE.MeshPhongMaterial({ color: pale(body, 0.22), specular: spec, shininess: 90 });
      set.accent = new THREE.MeshPhongMaterial({
        color: body, specular: 0xffffff, shininess: 60,
        emissive: body.clone().multiplyScalar(0.3),
      });
      break;
    }
    case 'carbon': {
      const tex = new THREE.CanvasTexture(carbonTexture(128, '#161c28'));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(3, 3);
      textures.push(tex);
      set.hull = new THREE.MeshLambertMaterial({ map: tex, color: body });
      set.dark = new THREE.MeshLambertMaterial({ map: tex, color: trim });
      set.light = new THREE.MeshLambertMaterial({ map: tex, color: pale(body, 0.18) });
      set.accent = new THREE.MeshLambertMaterial({
        color: body, emissive: body.clone().multiplyScalar(0.45), emissiveIntensity: 0.8,
      });
      break;
    }
    case 'neon': {
      set.hull = new THREE.MeshBasicMaterial({ color: body });
      set.dark = new THREE.MeshBasicMaterial({ color: trim });
      set.light = new THREE.MeshBasicMaterial({ color: pale(body, 0.45) });
      set.accent = new THREE.MeshBasicMaterial({ color: pale(body, 0.55) });
      glow = true;
      break;
    }
    case 'scanline': {
      const tex = new THREE.CanvasTexture(scanlineTexture(128, 'rgba(150,245,255,.6)'));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(3, 2);
      textures.push(tex);
      set.hull = new THREE.MeshLambertMaterial({
        map: tex, color: body, emissive: body.clone().multiplyScalar(0.5),
      });
      set.dark = new THREE.MeshLambertMaterial({
        map: tex, color: trim, emissive: trim.clone().multiplyScalar(0.3),
      });
      set.light = new THREE.MeshLambertMaterial({ map: tex, color: pale(body, 0.3) });
      set.accent = new THREE.MeshBasicMaterial({ color: pale(body, 0.4) });
      glow = true;
      // the lines crawl up the armour
      animate = (dt) => { tex.offset.y = (tex.offset.y + dt * 0.55) % 1; };
      break;
    }
    default:
      break;
  }

  return { ...set, textures, animate, glow };
}

// The same interpolation the remote players use, so a mech never stutters.
const DELAY_MS = 70;

export class MechView {
  constructor(scene, m) {
    this.id = m.id;
    this.ownerId = m.ownerId;
    this.color = m.color ?? MECH_COSMETIC.primary;
    this.trim = m.trim ?? MECH_COSMETIC.secondary;
    this.materialId = m.material || 'matte';
    this.chassis = m.chassis || MECH.defaultChassis;
    this.samples = [];
    this.pos = new THREE.Vector3(m.pos[0], m.pos[1], m.pos[2]);
    this.targetPos = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = m.yaw || 0;
    this.hp = m.maxHp ?? MECH.maxHealth;
    this.maxHp = m.maxHp ?? MECH.maxHealth;
    this.state = m.state || 'active';
    this.shield = { charge: 1, time: 0 };
    this.walkPhase = 0;
    this.strobe = 0;

    this.materials = [];
    this.geometries = [];
    this.root = new THREE.Group();
    this.build();
    scene.add(this.root);
  }

  mat(color, opts = {}) {
    return this.own(new THREE.MeshLambertMaterial({ color, ...opts }));
  }

  // Every material this mech owns, whatever built it, so disposal is one loop.
  own(material) {
    this.materials.push(material);
    return material;
  }

  geo(w, h, d) {
    const g = new THREE.BoxGeometry(w, h, d);
    this.geometries.push(g);
    return g;
  }

  build() {
    const finish = buildHullMaterials(this.color, this.trim, this.materialId);
    const hull = this.own(finish.hull);
    const dark = this.own(finish.dark);
    const light = this.own(finish.light);
    const accent = this.own(finish.accent);
    this.textures = finish.textures;
    this.animate = finish.animate;
    this.glow = finish.glow;
    const glass = this.mat(GLASS, { transparent: true, opacity: 0.55 });

    const box = this.geo(1, 1, 1);
    const add = (m, x, y, z, sx, sy, sz, parent = this.root) => {
      const mesh = new THREE.Mesh(box, m);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // ---- legs: two heavy pistons with wide feet
    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    this.legL.position.set(-1.15, 4.4, 0);
    this.legR.position.set(1.15, 4.4, 0);
    for (const [leg, side] of [[this.legL, -1], [this.legR, 1]]) {
      add(light, 0, -1.4, 0, 0.75, 2.8, 0.8, leg);          // thigh
      add(dark, 0, -3.2, 0, 0.62, 1.4, 0.66, leg);          // knee
      add(hull, 0, -4.0, 0.08, 0.72, 1.7, 0.78, leg);       // shin
      add(dark, 0, -4.75, 0.18, 1.05, 0.5, 1.5, leg);       // foot
      add(accent, side * 0.4, -1.6, -0.42, 0.1, 0.9, 0.06, leg);
      this.root.add(leg);
    }

    // ---- hips and torso
    add(dark, 0, 4.6, 0, 2.9, 0.9, 1.7);
    add(hull, 0, 6.0, 0, 3.6, 2.0, 2.0);
    add(light, 0, 6.9, -0.9, 2.6, 0.7, 0.3);                // chest plate
    add(accent, 0, 6.35, -1.05, 1.5, 0.22, 0.08);           // chest strip

    // ---- cockpit, sitting under the head
    add(dark, 0, 7.3, -0.5, 1.7, 0.9, 1.0);
    add(glass, 0, 7.35, -1.0, 1.35, 0.6, 0.12);

    // ---- head and sensor
    add(hull, 0, 8.1, -0.2, 1.15, 0.75, 1.05);
    add(accent, 0, 8.15, -0.72, 0.7, 0.16, 0.06);           // eye slit
    add(dark, 0.45, 8.5, 0, 0.14, 0.5, 0.14);               // antenna

    // ---- shoulders and arms
    add(light, -2.1, 6.9, 0, 1.0, 1.0, 1.2);
    add(light, 2.1, 6.9, 0, 1.0, 1.0, 1.2);
    this.armL = new THREE.Group();
    this.armR = new THREE.Group();
    this.armL.position.set(-2.15, 6.6, 0);
    this.armR.position.set(2.15, 6.6, 0);
    add(hull, 0, -0.9, 0, 0.68, 1.9, 0.72, this.armL);
    add(dark, 0, -2.1, 0, 0.8, 0.7, 0.8, this.armL);        // fist
    add(hull, 0, -0.9, 0, 0.68, 1.9, 0.72, this.armR);
    // the right arm ends in a cannon instead of a hand
    add(dark, 0, -2.0, 0, 0.85, 0.85, 0.85, this.armR);
    add(light, 0, -2.0, -0.75, 0.34, 0.34, 1.5, this.armR); // barrel
    add(accent, 0, -2.0, -1.5, 0.42, 0.42, 0.16, this.armR);// muzzle
    this.root.add(this.armL, this.armR);

    // ---- backpack and thrusters
    add(dark, 0, 6.2, 1.15, 2.4, 1.6, 0.6);
    add(accent, -0.7, 5.3, 1.3, 0.4, 0.7, 0.35);
    add(accent, 0.7, 5.3, 1.3, 0.4, 0.7, 0.35);

    // ---- shield bubble, hidden until it is raised
    this.bubble = new THREE.Mesh(
      new THREE.SphereGeometry(MECH.radius * 2.4, 20, 14),
      new THREE.MeshBasicMaterial({
        color: 0x8fd8ff, transparent: true, opacity: 0.16,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    this.bubble.position.y = MECH.height * 0.5;
    this.bubble.visible = false;
    this.root.add(this.bubble);
    this.geometries.push(this.bubble.geometry);
    this.materials.push(this.bubble.material);
  }

  setSnapshot(m) {
    const at = performance.now();
    this.samples.push({ t: at, pos: new THREE.Vector3(m.pos[0], m.pos[1], m.pos[2]) });
    if (this.samples.length > 24) this.samples.shift();
    this.targetPos.set(m.pos[0], m.pos[1], m.pos[2]);
    this.yaw = m.yaw ?? this.yaw;
    this.hp = m.hp ?? this.hp;
    this.maxHp = m.maxHp ?? this.maxHp;
    this.state = m.state || this.state;
    if (m.shield) this.shield = { charge: m.shield.charge ?? 0, time: m.shield.time ?? 0 };
    this.failMsLeft = m.coreFailureEnd || 0;
  }

  sampleAt(t, out) {
    const s = this.samples;
    if (!s.length) return out.copy(this.targetPos);
    if (s.length === 1 || t <= s[0].t) return out.copy(s[0].pos);
    const newest = s[s.length - 1];
    if (t >= newest.t) {
      const behind = Math.min(180, t - newest.t) / 1000;
      return out.copy(newest.pos).addScaledVector(this.vel, behind);
    }
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1];
      const b = s[i];
      if (t < a.t) continue;
      const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return out.copy(a.pos).lerp(b.pos, k);
    }
    return out.copy(s[0].pos);
  }

  update(dt, time) {
    if (this.animate) this.animate(dt);      // a scanline finish crawls
    const t = performance.now();
    this.sampleAt(t - DELAY_MS, this.pos);

    const s = this.samples;
    if (s.length >= 2) {
      const a = s[s.length - 2];
      const b = s[s.length - 1];
      const span = (b.t - a.t) / 1000;
      if (span > 0.001 && span < 0.6) this.vel.copy(b.pos).sub(a.pos).multiplyScalar(1 / span);
    } else {
      this.vel.set(0, 0, 0);
    }
    const speed = Math.hypot(this.vel.x, this.vel.z);

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;

    // legs and arms swing with movement
    this.walkPhase += dt * Math.min(6, speed * 0.9);
    const swing = Math.sin(this.walkPhase) * Math.min(0.5, speed * 0.06);
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.6;
    this.armR.rotation.x = swing * 0.35;

    // the shield bubble
    const up = this.shield.time > 0;
    this.bubble.visible = up;
    if (up) {
      const pulse = 0.14 + Math.sin(time * 7) * 0.05;
      this.bubble.material.opacity = pulse;
      this.bubble.scale.setScalar(1 + Math.sin(time * 4) * 0.015);
    }

    // core failure: everything strobes red
    if (this.state === 'core-failure') {
      this.strobe += dt * 9;
      const k = (Math.sin(this.strobe) + 1) / 2;
      for (const m of this.materials) {
        if (!m.emissive) continue;
        m.emissive.setRGB(0.35 + k * 0.65, k * 0.12, k * 0.05);
      }
    } else if (this.strobe !== 0) {
      this.strobe = 0;
      for (const m of this.materials) {
        if (m.emissive) m.emissive.setRGB(0, 0, 0);
      }
    }
  }

  dispose(scene) {
    scene.remove(this.root);
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures || []) t.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures = [];
  }
}

export class Mechs {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
  }

  // Your own mech is skipped: you are in the cockpit, not looking at it.
  sync(mechs, myId) {
    const seen = new Set();
    for (const m of mechs || []) {
      if (m.ownerId === myId) continue;
      seen.add(m.id);
      const view = this.map.get(m.id);
      if (view) view.setSnapshot(m);
      else this.map.set(m.id, new MechView(this.scene, m));
    }
    for (const [id, v] of [...this.map]) {
      if (!seen.has(id)) {
        v.dispose(this.scene);
        this.map.delete(id);
      }
    }
  }

  get(id) { return this.map.get(id); }

  update(dt, time) {
    for (const v of this.map.values()) v.update(dt, time);
  }

  dispose() {
    for (const v of this.map.values()) v.dispose(this.scene);
    this.map.clear();
  }
}

// Remote players: stylised armoured figures built from primitives.
import * as THREE from 'three';
import { nameTexture, softCircleTexture, carbonTexture, scanlineTexture } from './textures.js';
import { COSMETIC } from '../../shared/constants.js';

let glowTex = null;
function softGlowTexture() {
  if (!glowTex) glowTex = softCircleTexture(128);
  return glowTex;
}

const BODY = 0x2a3346;
const BODY_LIGHT = 0x3b4761;
const VEST = 0x1d2534;

function limb(w, h, d, material) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.y = -h / 2;
  m.castShadow = true;
  g.add(m);
  return g;
}

// Body materials for the cosmetic system. `body` is the primary colour, `trim`
// the secondary. Everything returns a THREE material plus an optional effect
// the constructor wires up (halo, light, animated texture).
function buildMaterials(primary, secondary, materialId) {
  const body = new THREE.Color(primary);
  const trim = new THREE.Color(secondary);
  const out = {
    body: new THREE.MeshLambertMaterial({ color: body }),
    trim: new THREE.MeshLambertMaterial({ color: trim }),
    accent: new THREE.MeshLambertMaterial({
      color: body,
      emissive: body.clone().multiplyScalar(0.35),
    }),
    glow: false,
    animate: null,
    textures: [],
  };

  switch (materialId) {
    case 'metal': {
      const spec = 0xdfefff;
      out.body = new THREE.MeshPhongMaterial({ color: body, specular: spec, shininess: 110 });
      out.trim = new THREE.MeshPhongMaterial({ color: trim, specular: spec, shininess: 130 });
      out.accent = new THREE.MeshPhongMaterial({
        color: body, specular: 0xffffff, shininess: 60,
        emissive: body.clone().multiplyScalar(0.22),
      });
      break;
    }
    case 'carbon': {
      const tex = new THREE.CanvasTexture(carbonTexture(128, '#161c28'));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 2);
      out.textures.push(tex);
      out.body = new THREE.MeshLambertMaterial({ map: tex, color: body });
      out.trim = new THREE.MeshLambertMaterial({ map: tex, color: trim });
      out.accent = new THREE.MeshLambertMaterial({
        color: body, emissive: body.clone().multiplyScalar(0.45), emissiveIntensity: 0.8,
      });
      break;
    }
    case 'neon': {
      // self-lit: the body ignores the lighting entirely
      out.body = new THREE.MeshBasicMaterial({ color: body });
      out.trim = new THREE.MeshBasicMaterial({ color: trim });
      out.accent = new THREE.MeshBasicMaterial({ color: body.clone().lerp(new THREE.Color(0xffffff), 0.55) });
      out.glow = true;
      break;
    }
    case 'scanline': {
      const tex = new THREE.CanvasTexture(scanlineTexture(128, 'rgba(150,245,255,.6)'));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(3, 2);
      out.textures.push(tex);
      out.body = new THREE.MeshLambertMaterial({ map: tex, color: body, emissive: body.clone().multiplyScalar(0.5) });
      out.trim = new THREE.MeshLambertMaterial({ map: tex, color: trim, emissive: trim.clone().multiplyScalar(0.35) });
      out.accent = new THREE.MeshBasicMaterial({ color: body.clone().lerp(new THREE.Color(0xffffff), 0.4) });
      out.glow = true;
      // the lines crawl up the armour
      out.animate = (dt) => { tex.offset.y = (tex.offset.y + dt * 0.55) % 1; };
      break;
    }
    default:
      break;
  }
  return out;
}

export class Avatar {
  constructor(scene, player) {
    this.id = player.id;
    this.name = player.name;
    this.color = player.color;

    this.root = new THREE.Group();
    const cos = player.cosmetic || {};
    // the crew aura now uses the player's chosen primary colour, so the glow is
    // whatever they picked; players without the code get the plain palette
    const primary = player.crew
      ? (cos.primary ?? player.color)
      : (cos.primary ?? player.color ?? BODY);
    const secondary = cos.secondary ?? VEST;
    const materialId = COSMETIC.materialById(cos.material) ? cos.material : 'matte';
    this.materialId = materialId;
    const mats = buildMaterials(primary, secondary, materialId);
    this.textures = mats.textures;
    this.animate = mats.animate;
    const accent = new THREE.Color(primary);
    const accentMat = mats.accent;
    const bodyMat = mats.body;
    const lightMat = mats.trim;
    const vestMat = mats.trim;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const add = (geo, mat, x, y, z, sx, sy, sz, parent = this.root) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // torso + chest plate + belt
    add(box, bodyMat, 0, 1.16, 0, 0.62, 0.66, 0.34);
    add(box, vestMat, 0, 1.19, -0.03, 0.66, 0.5, 0.36);
    add(box, accentMat, 0, 1.29, -0.19, 0.5, 0.1, 0.06);   // glowing chest stripe
    add(box, accentMat, 0, 0.86, 0, 0.5, 0.08, 0.3);        // belt
    // backpack
    add(box, lightMat, 0, 1.24, 0.24, 0.4, 0.42, 0.16);
    add(box, accentMat, 0, 1.38, 0.3, 0.16, 0.06, 0.06);
    // shoulders
    add(box, lightMat, -0.4, 1.4, 0, 0.2, 0.2, 0.26);
    add(box, lightMat, 0.4, 1.4, 0, 0.2, 0.2, 0.26);
    // head + visor
    add(box, bodyMat, 0, 1.68, 0, 0.34, 0.32, 0.34);
    add(box, accentMat, 0, 1.7, -0.17, 0.26, 0.09, 0.03);
    add(box, lightMat, 0, 1.85, 0.02, 0.22, 0.06, 0.26);    // helmet crest

    // limbs with pivots
    this.legL = limb(0.2, 0.84, 0.24, lightMat); this.legL.position.set(-0.16, 0.86, 0);
    this.legR = limb(0.2, 0.84, 0.24, lightMat); this.legR.position.set(0.16, 0.86, 0);
    this.armL = limb(0.16, 0.62, 0.18, bodyMat); this.armL.position.set(-0.4, 1.4, 0);
    this.armR = limb(0.16, 0.62, 0.18, bodyMat); this.armR.position.set(0.4, 1.4, 0);
    this.root.add(this.legL, this.legR, this.armL, this.armR);

    // feet
    add(box, vestMat, 0, -0.8, 0.04, 0.24, 0.1, 0.34, this.legL);
    add(box, vestMat, 0, -0.8, 0.04, 0.24, 0.1, 0.34, this.legR);

    // held weapon silhouette
    this.gun = new THREE.Group();
    const gm = new THREE.MeshLambertMaterial({ color: 0x1a2030 });
    const gunBody = new THREE.Mesh(box, gm);
    gunBody.scale.set(0.1, 0.12, 0.7);
    gunBody.position.set(0, 0, -0.2);
    gunBody.castShadow = true;
    this.gun.add(gunBody);
    const muzzle = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    muzzle.scale.set(0.06, 0.06, 0.06);
    muzzle.position.set(0, 0, -0.57);
    this.gun.add(muzzle);
    this.gun.position.set(0.3, 1.24, -0.2);
    this.root.add(this.gun);

    // contact ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 24),
      new THREE.MeshBasicMaterial({
        color: accent, transparent: true, opacity: 0.35,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    this.root.add(ring);
    this.ring = ring;

    // ---- glow: the crew aura, or a neon / scanline material lighting itself up
    if (player.crew || mats.glow) {
      if ('emissive' in accentMat) {
        accentMat.emissive = accent.clone();
        accentMat.emissiveIntensity = 0.9;
      }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softGlowTexture(), color: accent, transparent: true, opacity: 0.5,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      halo.scale.set(3.4, 4.2, 1);
      halo.position.y = 1.15;
      this.root.add(halo);
      this.halo = halo;
      if (player.crew || materialId !== 'scanline') {
        const light = new THREE.PointLight(accent, player.crew ? 2.6 : 1.8, 9, 2);
        light.position.set(0, 1.3, 0);
        this.root.add(light);
        this.glowLight = light;
      }
      ring.material.opacity = 0.8;
    }

    // name plate
    this.tex = nameTexture(this.name, '#' + accent.getHexString(), 1);
    this.plate = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.tex, transparent: true, depthWrite: false, opacity: 0.95,
    }));
    this.plate.scale.set(2.1, 0.52, 1);
    this.plate.position.y = 2.25;
    this.root.add(this.plate);

    scene.add(this.root);

    this.pos = new THREE.Vector3().fromArray(player.pos);
    this.targetPos = this.pos.clone();
    this.yaw = player.yaw;
    this.targetYaw = player.yaw;
    this.hp = player.hp;
    this.alive = player.alive !== false;
    this.walkPhase = Math.random() * 6;
    this.speed = 0;
    this.lastHp = player.hp;
    this.hitFlash = 0;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  setSnapshot(p) {
    const moved = this.targetPos.distanceTo(new THREE.Vector3().fromArray(p.pos));
    this.speed = moved;
    if (moved > 4) {
      // teleport / respawn
      this.pos.fromArray(p.pos);
      this.root.position.copy(this.pos);
    }
    this.targetPos.fromArray(p.pos);
    this.targetYaw = p.yaw;
    this.alive = p.alive;
    if (p.hp !== this.hp) {
      this.hp = p.hp;
      this.refreshPlate();
    }
    if (p.hp < this.lastHp) this.hitFlash = 1;
    this.lastHp = p.hp;
  }

  refreshPlate() {
    const css = '#' + new THREE.Color(this.color).getHexString();
    const t = nameTexture(this.name, css, this.hp / 100);
    this.plate.material.map.dispose();
    this.plate.material.map = t;
    this.plate.material.needsUpdate = true;
  }

  muzzleWorld(out = new THREE.Vector3()) {
    return this.gun.children[1].getWorldPosition(out);
  }

  update(dt, time) {
    // smoothed network interpolation
    const lerp = 1 - Math.exp(-16 * dt);
    this.pos.lerp(this.targetPos, lerp);
    this.root.position.copy(this.pos);

    let d = this.targetYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, 14 * dt);
    this.root.rotation.y = this.yaw;

    const moving = this.speed > 0.02 && this.alive;
    if (moving) this.walkPhase += Math.min(this.speed, 1.2) * 12 * dt;
    const swing = moving ? Math.sin(this.walkPhase) * 0.85 : 0;
    const targetLegL = swing;
    const targetLegR = -swing;
    const k = Math.min(1, 14 * dt);
    this.legL.rotation.x += (targetLegL - this.legL.rotation.x) * k;
    this.legR.rotation.x += (targetLegR - this.legR.rotation.x) * k;
    this.armL.rotation.x += (-targetLegL * 0.7 - this.armL.rotation.x) * k;
    this.armR.rotation.x += (-targetLegR * 0.7 - this.armR.rotation.x) * k;

    // idle breathing
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.04 : Math.sin(time * 1.6 + this.id) * 0.015;
    this.root.position.y = this.pos.y + bob;

    // death: slump / vanish
    if (!this.alive) {
      this.root.rotation.z += (1.2 - this.root.rotation.z) * Math.min(1, 6 * dt);
      this.root.position.y = this.pos.y + Math.max(0, this.root.rotation.z * 0.15);
      this.plate.material.opacity = Math.max(0, this.plate.material.opacity - dt);
    } else {
      this.root.rotation.z += (0 - this.root.rotation.z) * Math.min(1, 10 * dt);
      this.plate.material.opacity = Math.min(0.95, this.plate.material.opacity + dt * 2);
    }

    if (this.halo) {
      const pulse = 0.42 + Math.sin(time * 2.6 + this.id) * 0.14;
      this.halo.material.opacity = pulse;
      this.ring.material.opacity = 0.55 + Math.sin(time * 2.6 + this.id) * 0.25;
      if (this.glowLight) this.glowLight.intensity = 2.2 + Math.sin(time * 2.6 + this.id) * 0.9;
    } else {
      this.ring.material.opacity = 0.22 + Math.sin(time * 3 + this.id) * 0.08;
    }
    if (this.animate) this.animate(dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
  }

  dispose(scene) {
    scene.remove(this.root);
    for (const tex of this.textures || []) tex.dispose?.();
    this.plate.material.map.dispose();
    this.plate.material.dispose();
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map === undefined) o.material.dispose?.();
    });
  }
}

export class Avatars {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
  }

  sync(players, myId) {
    const seen = new Set();
    for (const p of players) {
      if (p.id === myId) continue;
      seen.add(p.id);
      let a = this.map.get(p.id);
      if (!a) {
        a = new Avatar(this.scene, p);
        this.map.set(p.id, a);
      } else {
        a.setSnapshot(p);
      }
    }
    for (const [id, a] of [...this.map]) {
      if (!seen.has(id)) {
        a.dispose(this.scene);
        this.map.delete(id);
      }
    }
  }

  get(id) { return this.map.get(id); }

  update(dt, time) {
    for (const a of this.map.values()) a.update(dt, time);
  }
}

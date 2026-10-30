// First-person weapon models, rendered in an overlay scene so they never clip
// into world geometry.
import * as THREE from 'three';
import { softCircleTexture } from './textures.js';

const DARK = 0x222a3a;
const METAL = 0x4c5a72;
const BLACK = 0x141a24;

// `color` is either a hex number or a ready-made material (the glowing accent
// parts pass materials, and used to be swallowed into a Lambert colour).
function matFor(color, opts) {
  if (color && color.isMaterial) return color;
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

function bx(w, h, d, color, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matFor(color, opts));
  m.position.set(x, y, z);
  return m;
}

function cyl(r1, r2, h, color, x, y, z, seg = 10) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(r1, r2, h, seg),
    matFor(color, {})
  );
  m.position.set(x, y, z);
  m.rotation.x = Math.PI / 2;
  return m;
}

const glow = (color) => new THREE.MeshBasicMaterial({ color });

function buildRifle() {
  const g = new THREE.Group();
  g.add(bx(0.085, 0.11, 0.52, DARK, 0, 0, -0.12));      // receiver
  g.add(bx(0.07, 0.05, 0.34, METAL, 0, 0.075, -0.16));   // rail
  g.add(cyl(0.017, 0.017, 0.38, BLACK, 0, 0.015, -0.56)); // barrel
  g.add(bx(0.05, 0.05, 0.1, METAL, 0, 0.015, -0.74));    // muzzle brake
  g.add(bx(0.055, 0.15, 0.1, BLACK, 0, -0.1, -0.06));    // magazine
  g.add(bx(0.06, 0.09, 0.2, DARK, 0, -0.02, 0.18));      // stock
  g.add(bx(0.055, 0.12, 0.06, DARK, 0, -0.09, -0.24));   // grip
  g.add(bx(0.012, 0.012, 0.2, glow(0x9fd8ff), 0.044, 0.03, -0.16)); // side accent
  g.add(bx(0.03, 0.03, 0.02, glow(0x62d6ff), 0, 0.105, 0.0));       // dot
  return { group: g, muzzle: new THREE.Vector3(0, 0.015, -0.8) };
}

function buildSniper() {
  const g = new THREE.Group();
  g.add(bx(0.08, 0.1, 0.62, DARK, 0, 0, -0.1));
  g.add(cyl(0.016, 0.016, 0.62, BLACK, 0, 0.01, -0.7));   // long barrel
  g.add(bx(0.055, 0.055, 0.14, METAL, 0, 0.01, -1.03));   // brake
  g.add(bx(0.07, 0.16, 0.09, BLACK, 0, -0.11, -0.02));    // mag
  g.add(bx(0.075, 0.11, 0.26, DARK, 0, -0.03, 0.24));     // stock
  g.add(bx(0.06, 0.13, 0.06, DARK, 0, -0.1, -0.2));       // grip
  // scope
  g.add(cyl(0.038, 0.038, 0.3, METAL, 0, 0.115, -0.16, 14));
  g.add(cyl(0.048, 0.038, 0.08, BLACK, 0, 0.115, -0.33, 14));
  g.add(cyl(0.042, 0.042, 0.03, glow(0xffd479), 0, 0.115, -0.36, 14));
  g.add(bx(0.02, 0.06, 0.03, METAL, 0, 0.08, -0.02));
  g.add(bx(0.02, 0.06, 0.03, METAL, 0, 0.08, -0.3));
  g.add(bx(0.012, 0.012, 0.28, glow(0xffd479), -0.045, 0.03, -0.2));
  return { group: g, muzzle: new THREE.Vector3(0, 0.01, -1.12) };
}

function buildSmg() {
  const g = new THREE.Group();
  g.add(bx(0.09, 0.12, 0.34, DARK, 0, 0, -0.06));
  g.add(cyl(0.02, 0.02, 0.22, BLACK, 0, 0.02, -0.32));
  g.add(bx(0.05, 0.05, 0.06, METAL, 0, 0.02, -0.44));
  g.add(bx(0.05, 0.2, 0.09, BLACK, 0, -0.14, -0.02));   // long mag
  g.add(bx(0.055, 0.11, 0.05, DARK, 0, -0.1, 0.04));    // grip
  g.add(bx(0.05, 0.07, 0.16, DARK, 0, -0.01, 0.2));     // folding stock
  g.add(bx(0.012, 0.012, 0.16, glow(0x8affc1), 0.048, 0.03, -0.06));
  g.add(bx(0.026, 0.026, 0.02, glow(0x62ffb0), 0, 0.09, -0.02));
  return { group: g, muzzle: new THREE.Vector3(0, 0.02, -0.48) };
}

function buildKnife() {
  const g = new THREE.Group();
  const blade = bx(0.012, 0.075, 0.36, 0xe9f2ff, 0, 0.02, -0.28);
  blade.material = new THREE.MeshLambertMaterial({ color: 0xdfe9f7, emissive: 0x335577 });
  g.add(blade);
  const tip = bx(0.012, 0.05, 0.08, 0xdfe9f7, 0, 0.008, -0.49);
  g.add(tip);
  g.add(bx(0.028, 0.03, 0.02, glow(0xff8f8f), 0, 0.02, -0.1)); // guard
  g.add(bx(0.034, 0.05, 0.16, 0x2a2f3a, 0, -0.005, 0.0));      // grip
  g.add(bx(0.03, 0.06, 0.04, 0x1a1e26, 0, -0.01, 0.09));       // pommel
  return { group: g, muzzle: new THREE.Vector3(0, 0.02, -0.5) };
}

const BUILDERS = { rifle: buildRifle, sniper: buildSniper, smg: buildSmg, knife: buildKnife };

// rest poses per weapon
const REST = {
  rifle: { pos: [0.2, -0.2, -0.36], rot: [0.02, 0.06, 0] },
  sniper: { pos: [0.19, -0.18, -0.3], rot: [0.02, 0.05, 0] },
  smg: { pos: [0.19, -0.19, -0.34], rot: [0.02, 0.04, 0] },
  knife: { pos: [0.24, -0.24, -0.3], rot: [0.1, 0.35, -0.15] },
};

export class ViewModel {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(this.camera);

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x263349, 1.3);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff1d8, 1.5);
    this.key.position.set(-1.2, 2.2, 1.6);
    this.scene.add(this.key);
    this.fill = new THREE.DirectionalLight(0x76b6ff, 0.7);
    this.fill.position.set(2.4, 0.4, -1.2);
    this.scene.add(this.fill);

    this.rig = new THREE.Group();
    this.scene.add(this.rig);

    this.models = {};
    for (const id of Object.keys(BUILDERS)) {
      const { group, muzzle } = BUILDERS[id]();
      group.visible = false;
      this.rig.add(group);
      this.models[id] = { group, muzzle, rest: REST[id] };
    }

    this.current = null;
    this.kick = 0;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.swapT = 0;
    this.swingT = 0;
    this.bobT = 0;
    this.sway = new THREE.Vector2();
    this.swayTarget = new THREE.Vector2();
    this.scoped = false;
    this.aimT = 0;
    this.enabled = true;

    // flash sprite
    const tex = softCircleTexture(96, 'rgba(255,244,214,1)', 'rgba(255,170,60,0)');
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xffe6b8, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    this.flash.scale.set(0.6, 0.6, 1);
    this.rig.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffd9a0, 0, 2.2, 2);
    this.scene.add(this.flashLight);
    this.flashT = 0;
  }

  // Cosmetic primary colour, painted onto the glowing accents of every weapon
  // so your chosen colour is visible in first person too.
  setAccent(color) {
    this.accent = color;
    for (const id of Object.keys(this.models)) {
      const model = this.models[id];
      if (!model) continue;
      model.group.traverse((node) => {
        const mat = node.material;
        if (mat && mat.isMeshBasicMaterial && mat.color) mat.color.setHex(color);
      });
    }
  }

  setWeapon(id) {
    if (this.current === id) return;
    if (this.current && this.models[this.current]) this.models[this.current].group.visible = false;
    this.current = id;
    const m = this.models[id];
    if (m) {
      m.group.visible = true;
      m.group.position.set(...m.rest.pos);
      m.group.rotation.set(...m.rest.rot);
    }
    this.swapT = 1;
    this.reloadT = 0;
    this.scoped = false;
  }

  fire() {
    this.kick = Math.min(1.6, this.kick + 1);
    this.flashT = 1;
    if (this.flash.material) this.flash.material.rotation = Math.random() * Math.PI * 2;
  }

  swing() {
    this.swingT = 1;
  }

  startReload(ms) {
    this.reloadDur = ms / 1000;
    this.reloadT = this.reloadDur;
  }

  cancelReload() { this.reloadT = 0; }

  setScoped(v) { this.scoped = v; }

  setFov(fov) {
    this.camera.fov = 58 * (fov / 88);
    this.camera.updateProjectionMatrix();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt, state) {
    if (!this.current) return;
    const m = this.models[this.current];
    const g = m.group;

    // sway from mouse motion
    this.swayTarget.set(-state.lookDX * 0.0009, -state.lookDY * 0.0009);
    this.swayTarget.clampScalar(-0.06, 0.06);
    this.sway.lerp(this.swayTarget, Math.min(1, 12 * dt));

    // bob
    const moving = state.grounded && state.moveAmount > 0.05;
    if (moving) this.bobT += dt * (state.sprint ? 13 : 9);
    const bobAmt = moving ? (state.sprint ? 0.022 : 0.014) : 0.004;
    const bobX = Math.cos(this.bobT) * bobAmt * 1.4;
    const bobY = Math.abs(Math.sin(this.bobT)) * bobAmt;

    // recoil
    this.kick *= Math.exp(-9 * dt);
    const kickZ = this.kick * 0.055;
    const kickRot = this.kick * 0.22;
    this.swapT = Math.max(0, this.swapT - dt * 4);

    // reload
    let reloadRot = 0;
    let reloadDrop = 0;
    let reloadRoll = 0;
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      const p = 1 - this.reloadT / Math.max(0.001, this.reloadDur);
      const s = Math.sin(Math.PI * Math.min(1, p * 1.02));
      reloadRot = s * 0.85;
      reloadDrop = s * 0.16;
      reloadRoll = s * 0.35;
    }

    // knife swing arc
    let swingRot = 0;
    let swingRoll = 0;
    let swingZ = 0;
    if (this.swingT > 0) {
      this.swingT = Math.max(0, this.swingT - dt * 5.5);
      const p = 1 - this.swingT;
      const arc = Math.sin(p * Math.PI);
      swingRot = -arc * 1.3;
      swingRoll = arc * 0.9;
      swingZ = -arc * 0.18;
    }

    // ADS
    const aimTarget = this.scoped ? 1 : 0;
    this.aimT += (aimTarget - this.aimT) * Math.min(1, 14 * dt);

    const rest = m.rest;
    const aimPos = [0, -0.055, -0.22];
    const px = rest.pos[0] * (1 - this.aimT) + aimPos[0] * this.aimT + this.sway.x + bobX;
    const py = rest.pos[1] * (1 - this.aimT) + aimPos[1] * this.aimT + this.sway.y + bobY - reloadDrop;
    const pz = rest.pos[2] * (1 - this.aimT) + aimPos[2] * this.aimT + kickZ + swingZ;

    // weapon swap dip
    const swapDip = Math.sin(this.swapT * Math.PI) * 0.22;

    g.position.set(px, py - swapDip, pz);
    g.rotation.set(
      rest.rot[0] * (1 - this.aimT) + kickRot + reloadRot + swingRot + swapDip * 1.2,
      rest.rot[1] * (1 - this.aimT),
      rest.rot[2] + reloadRoll + swingRoll
    );

    // scope hides the model
    g.visible = !(this.current === 'sniper' && this.aimT > 0.75);

    this.rig.updateMatrixWorld(true);

    // flash
    this.flashT = Math.max(0, this.flashT - dt * 14);
    const mw = m.muzzle;
    this.flash.position.copy(g.localToWorld(new THREE.Vector3(mw.x, mw.y, mw.z)));
    this.flash.material.opacity = this.flashT > 0 ? Math.min(1, this.flashT * 1.6) : 0;
    const fs = 0.28 + this.flashT * 0.5;
    this.flash.scale.set(fs, fs, 1);
    this.flash.visible = this.flashT > 0.02 && g.visible;
    this.flashLight.position.copy(this.flash.position);
    this.flashLight.intensity = this.flashT * 6;
  }

  render() {
    if (!this.enabled) return;
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }
}

// Mechs on screen: a reverse-jointed walker built from primitives, with a
// shield bubble and a core-failure strobe.
//
// Nothing about it is shaped like a person. The legs bend backwards — a high
// knee forward, an ankle kicked out behind, then a long foot reaching forward
// again — the torso hunches over its hips, and there is no head: the sensors
// ride a mast above the shoulders and the pilot looks out of a slit of glass
// in the chest.
//
// Your own mech is not drawn — you are inside it, looking out of the cockpit.
import * as THREE from 'three';
import { MECH, MECH_COSMETIC } from '../../shared/constants.js';
import { carbonTexture, scanlineTexture } from './textures.js';

const GLASS = 0x8fd8ff;

// Three different machines, not one machine in three sizes.
//
// Each hull gets its own leg proportions, its own sensor, its own back and its
// own guns. What they share is the things that have to be shared: the height,
// the stance, and the cockpit the pilot looks out of — so all three are the
// same target to shoot at and the same thing to fly.
//
//   KESTREL  a scout. Leggy: a short femur puts the knee up high and the long
//            shin rakes back hard to a kicked-out ankle, so most of the leg is
//            below the joint. Bare back, no pauldrons, a tall thin mast and a
//            long slim gun. Built to see and to run, and stripped of the rest.
//   ELK      the standard pattern. Balanced legs, a backpack and thrusters,
//            a mast with a sensor pod on each side, a single gun.
//   BISON    a siege hull. Short thick lower legs under a low knee, planted on
//            splayed feet with heel spurs, thigh armour, missile pods instead
//            of a pack, slab pauldrons with boxes on top, a squat armoured
//            sensor block with no mast at all, and a twin-barrelled gun.
const CHASSIS_BUILD = {
  light: {
    girth: 0.78,
    femur: 1.45, shin: 1.75, thick: 0.40, ankleBack: 0.88, footLen: 1.00,
    spur: false, thighPlate: false, skirt: false,
    mast: 'stalk', back: 'none', shoulder: 'bare', cannon: 'slim',
  },
  medium: {
    girth: 1.0,
    femur: 1.75, shin: 1.55, thick: 0.50, ankleBack: 0.62, footLen: 1.15,
    spur: false, thighPlate: false, skirt: false,
    mast: 'pods', back: 'pack', shoulder: 'pauldron', cannon: 'single',
  },
  heavy: {
    girth: 1.20,
    femur: 2.15, shin: 1.30, thick: 0.64, ankleBack: 0.44, footLen: 1.40,
    spur: true, thighPlate: true, skirt: true,
    mast: 'block', back: 'pods', shoulder: 'slab', cannon: 'twin',
  },
};

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
    const glass = this.mat(GLASS, { transparent: true, opacity: 0.55 });
    this.textures = finish.textures;
    this.animate = finish.animate;
    this.glow = finish.glow;

    // Which machine this is. Every difference between the three hangs off
    // these numbers and these names.
    const b = CHASSIS_BUILD[this.chassis] || CHASSIS_BUILD[MECH.defaultChassis];
    const g = b.girth;

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

    // Forward is -z, the same way the pilot is looking.

    // ---- reverse-joint legs: high knee forward, ankle kicked out behind,
    // ---- then a long foot reaching forward again. Nothing about this walks
    // ---- like a person.
    //
    // ---- The joints are placed from segment lengths rather than fixed
    // ---- offsets, so the three hulls can carry genuinely different leg
    // ---- proportions and still put a foot on the ground in the same place.
    const FOOT_Y = -4.68;                 // every hull stands on the ground
    const kneeY = -b.femur;
    const ankleY = -(b.femur + b.shin);
    const footTop = FOOT_Y + 0.14;
    const tarsusLen = footTop - ankleY;

    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    this.legL.position.set(-1.0 * g, 4.9, 0);
    this.legR.position.set(1.0 * g, 4.9, 0);
    for (const [leg, side] of [[this.legL, -1], [this.legR, 1]]) {
      add(light, 0, kneeY / 2, -0.28, b.thick, b.femur, b.thick * 1.1, leg).name = 'femur';
      add(hull, 0, kneeY, -0.50, b.thick * 0.92, 0.52, b.thick, leg).name = 'knee';   // knee, forward
      // Everything below the knee hangs off it and counter-flexes as it walks:
      // the lower leg folds further back as the hip swings forward, which is
      // what reads as a backwards joint rather than a forwards one.
      const shin = new THREE.Group();
      shin.position.set(0, kneeY, 0);
      leg.add(shin);
      add(light, 0, -b.shin / 2, 0.10, b.thick * 0.76, b.shin, b.thick * 0.9, shin).name = 'shin';
      add(dark, 0, -b.shin, b.ankleBack, b.thick * 0.84, 0.50, b.thick, shin).name = 'ankle';
      add(hull, 0, (ankleY + footTop) / 2 - kneeY, 0.10, b.thick * 0.68, tarsusLen, b.thick * 0.84, shin).name = 'tarsus';
      add(dark, 0, FOOT_Y - kneeY, -0.45, b.thick, 0.28, b.footLen, shin).name = 'foot';

      // Only the Bison plants a heel spur behind the foot and hangs armour
      // off the thigh; the Kestrel carries neither.
      if (b.spur) add(dark, 0, FOOT_Y - kneeY + 0.14, b.footLen * 0.5, b.thick * 0.9, 0.36, 0.36, shin).name = 'spur';
      if (b.thighPlate) add(hull, 0, kneeY * 0.5, 0.20, b.thick * 1.6, b.femur * 0.5, 0.24, leg).name = 'thighPlate';
      add(accent, side * 0.28 * g, kneeY, -0.72, 0.08, 0.7, 0.06, leg);
      this.root.add(leg);
      if (side < 0) this.shinL = shin; else this.shinR = shin;
    }

    // ---- hips: wide and low, carrying the whole thing forward. The Bison
    // ---- hangs armoured skirts over them as well.
    add(dark, 0, 4.9, 0.05, 2.3 * g, 0.9, 1.5 * g);
    if (b.skirt) {
      add(hull, 0, 4.35, 0.55, 2.4 * g, 1.0, 0.42);
      add(hull, -1.16 * g, 4.5, 0.15, 0.28, 1.35, 1.45 * g).name = 'skirt';
      add(hull, 1.16 * g, 4.5, 0.15, 0.28, 1.35, 1.45 * g).name = 'skirt';
    }

    // ---- torso, hunched over its own hips. No head: the top of the hull is
    // ---- armour, and the sensors ride a mast above the shoulders.
    const torso = new THREE.Group();
    torso.position.set(0, 5.25, 0);
    torso.rotation.x = -0.1;                       // leaning into the walk
    this.root.add(torso);
    const tAdd = (m, x, y, z, sx, sy, sz) => add(m, x, y, z, sx, sy, sz, torso);

    // The profile is the whole read: a low chest out front, a spine that
    // climbs to a hump over the shoulders, and a tucked belly between the
    // hips. Built front-to-back so the back line slopes rather than stacking
    // into a brick.
    tAdd(light, 0, 1.20, -0.68, 3.0 * g, 1.7, 1.45 * g);              // chest, low and forward
    tAdd(hull, 0, 0.45, 0.10, 2.5 * g, 1.4, 1.35 * g);                // belly, tucked under
    tAdd(hull, 0, 1.95, 0.34, 2.4 * g, 1.7, 1.2 * g);                 // spine rising
    tAdd(light, 0, 2.95, 0.78, 2.0 * g, 1.7, 1.15 * g);               // the hump, over the back
    tAdd(dark, 0, 3.62, 0.46, 1.5 * g, 0.7, 0.95 * g);                // crown of the hump
    tAdd(accent, 0, 1.45, -1.44, 1.5 * g, 0.26, 0.1);                 // chest vent
    tAdd(dark, 0, 2.55, -1.55, 2.2 * g, 0.6, 0.2);                    // brow over the canopy

    // ---- cockpit: a slit of glass on the front face, under the brow. The
    // ---- camera rides at MECH.eyeHeight, so the slit is hung at that height —
    // ---- the pilot looks out of the glass rather than over the hull.
    tAdd(glass, 0, 2.05, -1.42, 1.45, 0.75, 0.14);
    tAdd(dark, 0, 1.62, -1.48, 1.7, 0.40, 0.16);

    // ---- sensors. There is no head to shoot, but the three find their way
    // ---- about very differently, and each one reaches the same height so no
    // ---- hull is easier to spot over a ridge than another.
    const TOP = 4.37;                    // the crown, the same on every hull
    if (b.mast === 'stalk') {
      // KESTREL: a tall bare stalk, a small eye, and a long whisker
      tAdd(light, 0, (3.05 + TOP - 0.30) / 2, 0.05, 0.13, TOP - 0.30 - 3.05, 0.13);
      tAdd(dark, 0, TOP - 0.15, -0.10, 0.34, 0.30, 0.34);
      tAdd(accent, 0, TOP - 0.13, -0.30, 0.28, 0.18, 0.08);            // the eye, lit
      tAdd(dark, 0.30, TOP - 0.60, 0.02, 0.54, 0.08, 0.08);            // a long whisker
    } else if (b.mast === 'pods') {
      // ELK: a sturdier mast with a sensor pod on each side
      tAdd(light, 0, (3.15 + TOP - 0.34) / 2, 0.05, 0.17, TOP - 0.34 - 3.15, 0.17);
      tAdd(dark, 0, TOP - 0.17, -0.08, 0.42, 0.34, 0.42);
      tAdd(accent, 0, TOP - 0.17, -0.31, 0.34, 0.20, 0.08);            // the eye, lit
      tAdd(dark, -0.34, TOP - 0.32, 0.12, 0.26, 0.26, 0.26);           // side pods
      tAdd(dark, 0.34, TOP - 0.32, 0.12, 0.26, 0.26, 0.26);
      tAdd(dark, 0.36, TOP - 0.06, 0.10, 0.5, 0.08, 0.08);             // whisker
    } else {
      // BISON: no mast at all — a squat armoured housing and a stub aerial
      tAdd(dark, 0, 3.32, 0.12, 0.64, 0.92, 0.62);
      tAdd(light, 0, 3.88, 0.02, 0.50, 0.52, 0.50);
      tAdd(accent, 0, 3.90, -0.24, 0.30, 0.18, 0.08);                  // the eye, slit low
      tAdd(dark, 0, TOP - 0.18, 0.04, 0.16, 0.36, 0.16);               // stub aerial
      tAdd(dark, -0.32, TOP - 0.32, 0.18, 0.20, 0.14, 0.36);           // armoured fins
      tAdd(dark, 0.32, TOP - 0.32, 0.18, 0.20, 0.14, 0.36);
    }

    // ---- what it carries behind the hump
    if (b.back === 'none') {
      // KESTREL: a bare spine and the two thrusters it needs to move
      tAdd(dark, 0, 1.75, 1.02, 1.3 * g, 0.9, 0.32);
      tAdd(accent, -0.48 * g, 1.18, 1.14, 0.26, 0.5, 0.26);
      tAdd(accent, 0.48 * g, 1.18, 1.14, 0.26, 0.5, 0.26);
    } else if (b.back === 'pack') {
      // ELK: the standard backpack and thrusters
      tAdd(dark, 0, 1.60, 1.22, 2.1 * g, 1.5, 0.55);
      tAdd(accent, -0.68 * g, 0.80, 1.34, 0.4 * g, 0.65, 0.35);
      tAdd(accent, 0.68 * g, 0.80, 1.34, 0.4 * g, 0.65, 0.35);
    } else {
      // BISON: missile pods. Stacked boxes, and no pretence of being light.
      tAdd(dark, 0, 1.52, 1.18, 2.2 * g, 1.6, 0.60);
      for (const sx of [-1, 1]) {
        tAdd(hull, sx * 0.74 * g, 1.98, 1.42, 0.62 * g, 1.15, 0.56).name = 'pod';
        tAdd(dark, sx * 0.74 * g, 2.60, 1.42, 0.52 * g, 0.22, 0.42);   // cap
        tAdd(accent, sx * 0.74 * g, 1.32, 1.42, 0.48 * g, 0.46, 0.48); // exhaust
      }
    }

    // ---- shoulders: bare, pauldroned, or slab-sided with boxes on top
    if (b.shoulder === 'bare') {
      add(light, -1.62 * g, 7.48, 0.05, 0.70 * g, 0.78, 1.00 * g);
      add(light, 1.62 * g, 7.48, 0.05, 0.70 * g, 0.78, 1.00 * g);
    } else if (b.shoulder === 'pauldron') {
      add(light, -1.75 * g, 7.55, 0.05, 0.95 * g, 0.95, 1.15 * g);
      add(light, 1.75 * g, 7.55, 0.05, 0.95 * g, 0.95, 1.15 * g);
      add(hull, -1.95 * g, 7.95, 0.15, 1.10 * g, 0.62, 1.35 * g);
      add(hull, 1.95 * g, 7.95, 0.15, 1.10 * g, 0.62, 1.35 * g);
      add(dark, 0, 6.9, 0.95, 2.5 * g, 1.5, 0.40);                     // back plating
    } else {
      add(light, -1.86 * g, 7.55, 0.05, 1.20 * g, 1.00, 1.30 * g);
      add(light, 1.86 * g, 7.55, 0.05, 1.20 * g, 1.00, 1.30 * g);
      add(hull, -1.96 * g, 8.06, 0.15, 1.50 * g, 0.80, 1.50 * g);
      add(hull, 1.96 * g, 8.06, 0.15, 1.50 * g, 0.80, 1.50 * g);
      add(dark, -1.96 * g, 8.56, 0.34, 1.00 * g, 0.46, 0.82 * g);      // shoulder boxes
      add(dark, 1.96 * g, 8.56, 0.34, 1.00 * g, 0.46, 0.82 * g);
      add(dark, 0, 6.9, 0.95, 2.6 * g, 1.7, 0.45);                     // back plating
    }

    // ---- arms: a fist on the left, a cannon on the right
    this.armL = new THREE.Group();
    this.armR = new THREE.Group();
    this.armL.position.set(-1.9 * g, 7.35, 0);
    this.armR.position.set(1.9 * g, 7.35, 0);
    add(hull, 0, -0.75, 0, 0.55 * g, 1.6, 0.60 * g, this.armL);
    add(light, 0, -1.85, -0.12, 0.48 * g, 1.5, 0.50 * g, this.armL);
    add(dark, 0, -2.72, -0.20, 0.62 * g, 0.62, 0.66 * g, this.armL);   // fist

    add(hull, 0, -0.8, 0, 0.60 * g, 1.7, 0.65 * g, this.armR);
    if (b.cannon === 'slim') {
      // KESTREL: one long thin barrel, as little gun as it can carry
      add(dark, 0, -1.95, -0.10, 0.60 * g, 0.60, 0.70 * g, this.armR);
      add(light, 0, -1.95, -0.80, 0.24, 0.24, 1.55, this.armR).name = 'barrel';
      add(accent, 0, -1.95, -1.56, 0.32, 0.32, 0.14, this.armR);
    } else if (b.cannon === 'single') {
      // ELK: the standard cannon
      add(dark, 0, -1.95, -0.10, 0.82 * g, 0.85, 0.85 * g, this.armR);
      add(light, 0, -1.95, -0.75, 0.32, 0.32, 1.45, this.armR).name = 'barrel';
      add(accent, 0, -1.95, -1.48, 0.42, 0.42, 0.16, this.armR);
    } else {
      // BISON: twin barrels, as wide as it is long
      add(dark, 0, -1.95, -0.10, 1.00 * g, 0.90, 1.00 * g, this.armR);
      add(light, -0.24, -1.95, -0.78, 0.30, 0.30, 1.50, this.armR).name = 'barrel';
      add(light, 0.24, -1.95, -0.78, 0.30, 0.30, 1.50, this.armR).name = 'barrel';
      add(accent, -0.24, -1.95, -1.52, 0.38, 0.38, 0.16, this.armR);
      add(accent, 0.24, -1.95, -1.52, 0.38, 0.38, 0.16, this.armR);
    }
    this.root.add(this.armL, this.armR);

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
    // and the knee against the hip, so the foot tracks under the machine
    this.shinL.rotation.x = -swing * 0.55;
    this.shinR.rotation.x = swing * 0.55;
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

// ------------------------------------------------------------------ turntable
// The title screen shows the machine you are about to call down, painted the
// way you painted it. It is the same MechView the game draws on its own little
// canvas, so the preview cannot drift away from the real thing — rebuild the
// model and the panel is already showing the new one.
export class MechPreview {
  // `renderer` is a seam for tests: the real thing needs a WebGL context, so
  // the renderer tests hand in their own and check what gets drawn.
  constructor(canvas, renderer = null) {
    this.canvas = canvas || null;
    this.view = null;
    this.look = null;
    this.spin = -0.7;
    this.t = 0;
    this.dist = 24;
    this.target = new THREE.Vector3(0, MECH.height * 0.5, 0);
    this.ok = false;
    if (!canvas && !renderer) return;

    if (renderer) {
      this.renderer = renderer;
    } else {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      } catch {
        return;                     // no WebGL here: the panel simply stays empty
      }
    }
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    // transparent, so the panel's own backdrop shows through behind the mech
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 0.73, 0.5, 400);

    // The hull finishes are Lambert and Phong, so they need light to read at
    // all — a warm key from the front-left and a cool rim from behind.
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2c2a24, 0.9));
    const key = new THREE.DirectionalLight(0xfff2dd, 1.45);
    key.position.set(-6, 12, 9);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb6ff, 0.55);
    rim.position.set(8, 4, -10);
    this.scene.add(rim);
    this.ok = true;
  }

  // Rebuilds only when something that changes the model itself changes.
  set(look) {
    if (!this.ok || !look) return;
    const key = `${look.chassis}|${look.primary}|${look.secondary}|${look.material}`;
    if (key === this.look) return;
    this.look = key;
    if (this.view) { this.view.dispose(this.scene); this.view = null; }
    this.view = new MechView(this.scene, {
      id: -1,
      ownerId: -1,
      pos: [0, 0, 0],
      yaw: 0,
      hp: MECH.maxHealth,
      maxHp: MECH.maxHealth,
      state: 'active',
      chassis: look.chassis,
      color: look.primary,
      trim: look.secondary,
      material: look.material,
      shield: { charge: 1, time: 0 },
    });
    this.frame();
  }

  // Pull back far enough to fit whichever hull this is: they are all the same
  // height but the Bison is nearly twice the Kestrel's width.
  frame() {
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    const half = new THREE.Vector3();
    this.view.root.traverse((o) => {
      if (!o.isMesh || o === this.view.bubble) return;
      o.updateWorldMatrix(true, false);
      o.getWorldPosition(p);
      half.set(o.scale.x / 2, o.scale.y / 2, o.scale.z / 2);
      box.expandByPoint(p.clone().sub(half));
      box.expandByPoint(p.clone().add(half));
    });
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    this.target.copy(box.getCenter(new THREE.Vector3()));

    const vHalf = (this.camera.fov * Math.PI) / 360;
    const aspect = Math.max(0.2, this.camera.aspect || 0.73);
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const forHeight = (size.y / 2) / Math.sin(vHalf);
    const forWidth = (Math.max(size.x, size.z) / 2) / Math.sin(Math.max(0.08, hHalf));
    this.dist = Math.max(forHeight, forWidth) * 1.1 + 1.5;
  }

  resize() {
    if (!this.ok || !this.canvas) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.view) this.frame();
  }

  update(dt) {
    if (!this.ok || !this.view || !this.canvas) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;                     // the panel is not on screen
    if (this.lastW !== w || this.lastH !== h) {
      this.lastW = w;
      this.lastH = h;
      this.resize();
    }
    this.t += dt;
    this.spin += dt * 0.35;
    this.camera.position.set(
      Math.sin(this.spin) * this.dist,
      this.target.y + 1.1,
      Math.cos(this.spin) * this.dist,
    );
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);
    this.view.update(dt, this.t);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.view) { this.view.dispose(this.scene); this.view = null; }
    if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
    this.look = null;
    this.ok = false;
  }
}

// Constructs every 3D client module against real three.js with a stubbed
// canvas/renderer. Catches bad API usage without needing a GPU browser.
//   node tests/scene.test.mjs
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- DOM stubs
function fakeCanvas() {
  const grad = { addColorStop() {} };
  const ctx = new Proxy({
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string') return () => {};
      return undefined;
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  return {
    width: 256,
    height: 256,
    style: {},
    getContext: () => ctx,
    addEventListener() {},
    removeEventListener() {},
    toDataURL: () => 'data:,',
  };
}

globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : { style: {}, appendChild() {}, addEventListener() {} }),
  addEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  body: { appendChild() {} },
};
globalThis.window = { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, addEventListener() {} };
globalThis.self = globalThis.window;
globalThis.requestAnimationFrame = () => 0;

const THREE = await import('three');
const { buildWorld } = await import('../public/js/world.js');
const { Effects } = await import('../public/js/effects.js');
const { ViewModel } = await import('../public/js/viewmodel.js');
const { Avatar, Avatars } = await import('../public/js/avatars.js');
const { MechView, MechPreview } = await import('../public/js/mechs.js');
const { nameTexture, softCircleTexture, cloudTexture, carbonTexture, scanlineTexture } = await import('../public/js/textures.js');
const { WEAPONS, PLAYER, COSMETIC, MECH } = await import('../shared/constants.js');
const ARENA = (await import('../shared/map.js')).default;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.stack?.split('\n').slice(0, 4).join('\n       ')}`); }
}

const renderer = {
  shadowMap: {},
  setClearColor() {},
  clearDepth() {},
  render(scene, camera) {
    // walk the graph so lazily-built matrices/attributes get exercised
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
  },
  setPixelRatio() {},
  setSize() {},
};

console.log('\nSKYFALL renderer tests\n');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(88, 16 / 9, 0.06, 2000);
let world;

test('world builds from the shared map', () => {
  world = buildWorld(renderer, scene, camera);
  assert.ok(scene.children.length > 5, `${scene.children.length} children`);
  assert.ok(world.solids.length > 20, `${world.solids.length} colliders`);
});

test('world update runs', () => {
  camera.position.set(10, 5, 10);
  for (let i = 0; i < 5; i++) world.update(1 / 60, camera.position);
});

test('effects: tracers, sparks, blood, rings', () => {
  const fx = new Effects(scene);
  fx.tracer(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, -20));
  fx.impact(new THREE.Vector3(1, 1, 1), new THREE.Vector3(0, 1, 0), 'world');
  fx.impact(new THREE.Vector3(2, 1, 2), new THREE.Vector3(0, 0, 1), 'blood');
  fx.impact(new THREE.Vector3(3, 1, 3), new THREE.Vector3(0, 0, 1), 'flesh');
  fx.deathRing(new THREE.Vector3(0, 0, 0));
  fx.muzzle(new THREE.Vector3(0, 2, 0));
  for (let i = 0; i < 60; i++) fx.update(1 / 60);
  renderer.render(scene, camera);
});

test('viewmodel: every weapon builds, fires, reloads, swings', () => {
  const vm = new ViewModel(renderer);
  vm.resize(1280, 720);
  for (const w of WEAPONS) {
    vm.setWeapon(w.id);
    vm.fire();
    vm.swing();
    vm.startReload(w.reloadTime || 800);
    vm.update(1 / 60, { lookDX: 4, lookDY: -3, moveAmount: 1, sprint: true, grounded: true });
    vm.render();
  }
  vm.setWeapon('sniper');
  vm.setScoped(true);
  for (let i = 0; i < 40; i++) vm.update(1 / 60, { lookDX: 0, lookDY: 0, moveAmount: 0, sprint: false, grounded: true });
  vm.cancelReload();
  vm.render();
});

test('avatars: create, animate, take damage, die, dispose', () => {
  const avatars = new Avatars(scene);
  const players = [1, 2, 3].map((id) => ({
    id: id + 10, name: `P${id}`, color: 0x62d6ff, pos: [id * 2, 0, 4], yaw: id, pitch: 0,
    hp: 100, weapon: 0, alive: true, kills: 0, deaths: 0,
  }));
  avatars.sync(players, -1);
  assert.equal(avatars.map.size, 3);
  for (let i = 0; i < 30; i++) avatars.update(1 / 60, i / 60);
  const first = avatars.get(11);
  first.setSnapshot({ ...players[0], pos: [6, 0, 4], hp: 42 });
  first.setSnapshot({ ...players[0], pos: [6, 0, 4], hp: 42, alive: false });
  for (let i = 0; i < 20; i++) avatars.update(1 / 60, i / 60);
  avatars.sync([], -1);
  assert.equal(avatars.map.size, 0);
});

test('avatars survive a teleport (respawn) snapshot', () => {
  const scene2 = new THREE.Scene();
  const a = new Avatar(scene2, {
    id: 5, name: 'SPAWNER', color: 0xff6b6b, pos: [0, 0, 0], yaw: 0, hp: 100, alive: true,
  });
  a.setSnapshot({ id: 5, name: 'SPAWNER', color: 0xff6b6b, pos: [30, 0, -30], yaw: 2, hp: 100, alive: true });
  a.update(1 / 60, 0);
  assert.ok(Math.abs(a.pos.x - 30) < 0.001, 'snapped to the new spawn');
});

test('every cosmetic material builds a rig', () => {
  for (const m of COSMETIC.materials) {
    const sc = new THREE.Scene();
    const a = new Avatar(sc, {
      id: 9, name: 'LOOKS', color: 0x62d6ff, cosmetic: { primary: 0xff6b6b, secondary: 0x1d2534, material: m.id },
      crew: m.locked, pos: [0, 0, 0], yaw: 0, hp: 100, alive: true,
    });
    assert.equal(a.materialId, m.id, `${m.id} applied`);
    for (let i = 0; i < 10; i++) a.update(1 / 60, i / 60);   // animated textures tick
    assert.ok(a.root.parent === sc, `${m.id} added to the scene`);
  }
});

test('a locked material falls back for non-crew rigs', () => {
  const sc = new THREE.Scene();
  // the server normally sanitises this, but an avatar must not trust it either
  const a = new Avatar(sc, {
    id: 10, name: 'CHEAT', color: 0x62d6ff, cosmetic: { material: 'plasma' },
    crew: false, pos: [0, 0, 0], yaw: 0, hp: 100, alive: true,
  });
  assert.equal(a.materialId, 'matte');
});

test('neon and scanline light themselves up', () => {
  for (const id of ['neon', 'scanline']) {
    const sc = new THREE.Scene();
    const a = new Avatar(sc, {
      id: 11, name: 'GLOW', color: 0xffd23f, crew: true,
      cosmetic: { primary: 0xffd23f, material: id }, pos: [0, 0, 0], yaw: 0, hp: 100, alive: true,
    });
    assert.ok(a.halo, `${id} has a halo sprite`);
    assert.ok(a.ring.material.opacity > 0.5, `${id} brightens the contact ring`);
  }
});

test('the cosmetic colour paints the weapon accents', () => {
  const vm = new ViewModel({ domElement: fakeCanvas(), setPixelRatio() {}, setSize() {} });
  vm.setAccent(0xff6b6b);
  let painted = 0;
  for (const m of Object.values(vm.models)) {
    m.group.traverse((n) => {
      if (n.material?.isMeshBasicMaterial) {
        painted++;
        assert.equal(n.material.color.getHex(), 0xff6b6b, 'accent recoloured');
      }
    });
  }
  assert.ok(painted > 0, `${painted} accent parts recoloured`);
});

test('procedural textures', () => {
  assert.ok(nameTexture('TESTER', '#62d6ff', 0.5));
  assert.ok(softCircleTexture());
  assert.ok(cloudTexture());
  assert.ok(carbonTexture());
  assert.ok(scanlineTexture());
});

test('weapon balance numbers', () => {
  const rifle = WEAPONS.find((w) => w.id === 'rifle');
  const sniper = WEAPONS.find((w) => w.id === 'sniper');
  const smg = WEAPONS.find((w) => w.id === 'smg');
  const knife = WEAPONS.find((w) => w.id === 'knife');
  assert.ok(Math.abs(1000 / rifle.interval - 4) < 1e-9, 'rifle fires 4 shots/sec');
  assert.equal(Math.ceil(100 / rifle.damage), 4, 'rifle kills in 4 shots');
  assert.equal(sniper.damage, 100, 'sniper one-shots');
  assert.equal(sniper.interval, 700, 'sniper chambers in 0.7s');
  assert.equal(sniper.chamber, true, 'the sniper shows the gap as a reload');
  assert.equal(sniper.magSize, 3, 'three rounds before the full reload');
  assert.equal(sniper.reloadTime, 3200, 'the regular reload is the long one');
  assert.equal(smg.damage, 8, 'smg damage');
  assert.equal(Math.ceil(100 / smg.damage), 13, 'smg kills in 13 shots');
  assert.ok(Math.abs(1000 / smg.interval - 15) < 1e-9, 'smg fires 15 shots/sec');
  assert.equal(rifle.headshot, 2, 'rifle headshot multiplier');
  assert.equal(smg.headshot, 2, 'smg headshot multiplier');
  assert.equal(sniper.headshot, 1, 'sniper needs no headshot bonus');
  assert.equal(knife.headshot, 1, 'melee needs no headshot bonus');
  assert.equal(rifle.assist, true, 'rifle gets aim assist');
  assert.equal(smg.assist, true, 'smg gets aim assist');
  assert.equal(sniper.assist, false, 'sniper opts out of aim assist');
  assert.equal(knife.assist, false, 'knife opts out of aim assist');
  assert.equal(knife.damage, 100, 'knife one-shots');
  assert.equal(knife.interval, 500, 'knife cooldown 0.5s');
  assert.equal(PLAYER.maxHealth, 100);
});

test('the sniper fires in bursts: three quick shots, then the long reload', () => {
  const sniper = WEAPONS.find((w) => w.id === 'sniper');
  const burst = sniper.magSize * sniper.interval;   // three rounds, chambered
  assert.ok(burst < sniper.reloadTime, 'emptying the mag is quicker than one reload');
  assert.ok(burst < 3500, 'three shots land faster than one used to');
  assert.ok(sniper.reloadTime > sniper.interval * 4, 'the reload is the real pause');
});

// ------------------------------------------------------------------- mechs
// The mech is built from primitives and nobody can see it in a test, so these
// pin the things that would otherwise only be caught by eye: that it is a
// reverse-jointed walker rather than a person in a suit, that all three hulls
// stand the same height, and that each one is still tellable apart.

const mechScene = new THREE.Scene();

function buildMech(chassis = 'medium', material = 'matte') {
  return new MechView(mechScene, {
    id: 1, ownerId: 2, pos: [0, 0, 0], yaw: 0,
    hp: 1000, maxHp: 1000, state: 'active',
    chassis, color: 0xbfae95, trim: 0x4a4438, material,
    shield: { charge: 1, time: 0 },
  });
}

// Measured without the shield bubble: it is a fixed 10m sphere around every
// mech, so including it would hide exactly the differences these tests are for.
function measure(view) {
  view.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  view.root.traverse((o) => {
    if (!o.isMesh || o === view.bubble) return;
    o.getWorldPosition(p);
    const half = new THREE.Vector3(o.scale.x / 2, o.scale.y / 2, o.scale.z / 2);
    box.expandByPoint(p.clone().sub(half));
    box.expandByPoint(p.clone().add(half));
  });
  return { box, size: box.getSize(new THREE.Vector3()) };
}

test('every chassis builds, in every finish, without throwing', () => {
  for (const c of MECH.chassis) {
    for (const m of ['matte', 'metal', 'carbon', 'neon', 'scanline']) {
      const v = buildMech(c.id, m);
      let meshes = 0;
      v.root.traverse((o) => { if (o.isMesh) meshes++; });
      assert.ok(meshes > 25, `${c.name} in ${m} is a whole machine (${meshes} parts)`);
      v.dispose(mechScene);
    }
  }
});

test('all three hulls stand the same height, as specified', () => {
  const heights = MECH.chassis.map((c) => {
    const v = buildMech(c.id);
    const { size } = measure(v);
    const h = size.y;
    v.dispose(mechScene);
    return h;
  });
  const tallest = Math.max(...heights);
  const shortest = Math.min(...heights);
  assert.ok(tallest - shortest < 0.35,
    `within a third of a metre of each other (${heights.map((h) => h.toFixed(2)).join(', ')})`);
  for (const h of heights) {
    assert.ok(Math.abs(h - MECH.height) < 0.8, `${h.toFixed(2)} is about the ${MECH.height}m the game thinks it is`);
  }
});

test('...but each hull is a visibly different build', () => {
  const widths = MECH.chassis.map((c) => {
    const v = buildMech(c.id);
    const { size } = measure(v);
    const w = size.x;
    v.dispose(mechScene);
    return w;
  });
  const [light, medium, heavy] = widths;
  assert.ok(light < medium - 0.3, `the Kestrel is stripped back (${light.toFixed(2)} < ${medium.toFixed(2)})`);
  assert.ok(heavy > medium + 0.3, `the Bison is plated out (${heavy.toFixed(2)} > ${medium.toFixed(2)})`);
});

test('it stands on its feet rather than floating or sinking', () => {
  const v = buildMech();
  const { box } = measure(v);
  assert.ok(box.min.y > -0.6 && box.min.y < 0.6, `feet at ${box.min.y.toFixed(2)}m`);
  v.dispose(mechScene);
});

test("the cockpit sits where the pilot's eye is", () => {
  const v = buildMech();
  // the canopy is the only glass in the model
  const canopy = [];
  v.root.traverse((o) => { if (o.material && o.material.transparent && o.material.opacity < 1) canopy.push(o); });
  assert.ok(canopy.length, 'there is a canopy');
  const p = new THREE.Vector3();
  canopy[0].getWorldPosition(p);
  assert.ok(Math.abs(p.y - MECH.eyeHeight) < 0.5,
    `the canopy is at ${p.y.toFixed(2)}m and the camera sits at ${MECH.eyeHeight}m`);
  assert.ok(p.z < 0, 'and it faces forward');
  v.dispose(mechScene);
});

test('the legs bend backwards: the ankle is behind the knee', () => {
  const v = buildMech();
  v.root.updateMatrixWorld(true);
  const knee = v.legL.getObjectByName('knee').getWorldPosition(new THREE.Vector3());
  const ankle = v.legL.getObjectByName('ankle').getWorldPosition(new THREE.Vector3());
  const foot = v.legL.getObjectByName('foot').getWorldPosition(new THREE.Vector3());
  assert.ok(ankle.z > knee.z + 0.5,
    `the ankle (z=${ankle.z.toFixed(2)}) kicks out behind the knee (z=${knee.z.toFixed(2)})`);
  assert.ok(foot.z < ankle.z - 0.5,
    `...and the foot (z=${foot.z.toFixed(2)}) reaches forward again from there`);
  v.dispose(mechScene);
});

test('the knee counter-flexes against the hip while it walks', () => {
  // The mech reads its own speed off the time between snapshots, so the clock
  // has to actually move for this one.
  const realPerformance = globalThis.performance;
  let clock = 1000;
  globalThis.performance = { now: () => clock };
  const v = buildMech();
  const snap = (z) => ({
    id: 1, pos: [0, 0, z], yaw: 0, hp: 1000, maxHp: 1000, state: 'active',
    shield: { charge: 1, time: 0 },
  });
  let swing = 0;
  let flex = 0;
  try {
    // walk it forward for a few frames and catch the hip and knee mid-stride
    for (let i = 1; i <= 40; i++) {
      clock += 16;
      v.setSnapshot(snap(-i * 0.35));
      v.update(0.016, clock / 1000);
      if (Math.abs(v.legL.rotation.x) > Math.abs(swing)) {
        swing = v.legL.rotation.x;
        flex = v.shinL.rotation.x;
      }
    }
  } finally {
    globalThis.performance = realPerformance;
  }
  assert.ok(Math.abs(swing) > 0.01, `the hip is swinging (${swing.toFixed(3)})`);
  assert.ok(Math.abs(flex) > 0.005, `the knee is flexing (${flex.toFixed(3)})`);
  assert.ok(Math.sign(flex) === -Math.sign(swing),
    'and it flexes against the hip, not with it');
  v.dispose(mechScene);
});

test('there is no head: the highest point is a narrow mast, not a skull', () => {
  const v = buildMech();
  v.root.updateMatrixWorld(true);
  let top = null;
  let widestAtTop = 0;
  const p = new THREE.Vector3();
  v.root.traverse((o) => {
    if (!o.isMesh) return;
    o.getWorldPosition(p);
    const worldTop = p.y + (o.scale.y / 2);
    if (!top || worldTop > top) { top = worldTop; widestAtTop = Math.max(o.scale.x, o.scale.z); }
  });
  assert.ok(widestAtTop < 0.7,
    `the crown of it is ${widestAtTop.toFixed(2)}m across — a mast, not a head`);
  v.dispose(mechScene);
});

test('disposing a mech leaves nothing behind', () => {
  const v = buildMech();
  const before = mechScene.children.length;
  v.dispose(mechScene);
  assert.equal(mechScene.children.length, before - 1, 'removed from the scene');
  assert.equal(v.materials.length, 0, 'every material released');
  assert.equal(v.geometries.length, 0, 'every geometry released');
});

// ---------------------------------------------------------- the mech preview
// The title screen panel draws the real MechView on its own little canvas, so
// nothing about it can drift from the game. These check the things you would
// otherwise only catch by opening the menu: that the whole machine is in shot,
// that it turns, and that changing the paint rebuilds it.

const PANEL = { clientWidth: 108, clientHeight: 148 };
const previewRenderer = {
  frames: 0,
  shadowMap: {},
  setPixelRatio() {},
  setClearColor() {},
  setSize(w, h) { this.w = w; this.h = h; },
  render() { this.frames++; },
  dispose() {},
};

function buildPreview(look) {
  const p = new MechPreview(PANEL, previewRenderer);
  p.set(look);
  p.resize();
  return p;
}
const someLook = (over = {}) => ({
  primary: 0xbfae95, secondary: 0x4a4438, material: 'matte', chassis: 'medium', ...over,
});

test('the preview builds every chassis in every finish', () => {
  for (const c of MECH.chassis) {
    for (const m of ['matte', 'metal', 'carbon', 'neon', 'scanline']) {
      const v = buildPreview(someLook({ chassis: c.id, material: m }));
      assert.ok(v.ok, `${c.name} in ${m} stood up`);
      assert.ok(v.view, 'and there is a machine on it');
      v.dispose();
    }
  }
});

test('the whole machine is in shot, whichever hull it is', () => {
  const v = buildPreview(someLook());
  for (const c of MECH.chassis) {
    v.set(someLook({ chassis: c.id }));
    v.resize();
    v.update(0.016);
    v.camera.updateMatrixWorld(true);
    // every corner of the hull has to land inside the frame
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    v.view.root.traverse((o) => {
      if (!o.isMesh || o === v.view.bubble) return;
      o.updateWorldMatrix(true, false);
      o.getWorldPosition(p);
      const half = new THREE.Vector3(o.scale.x / 2, o.scale.y / 2, o.scale.z / 2);
      box.expandByPoint(p.clone().sub(half));
      box.expandByPoint(p.clone().add(half));
    });
    let worst = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          const ndc = new THREE.Vector3(x, y, z).project(v.camera);
          worst = Math.max(worst, Math.abs(ndc.x), Math.abs(ndc.y));
        }
      }
    }
    assert.ok(worst <= 1, `${c.name} fits in frame (worst corner at ${worst.toFixed(2)} of 1)`);
    assert.ok(worst > 0.35, `and fills it, rather than sitting in the middle doing nothing (${worst.toFixed(2)})`);
  }
  v.dispose();
});

test('it turns, and it redraws', () => {
  const v = buildPreview(someLook());
  previewRenderer.frames = 0;
  const first = v.camera.position.clone();
  v.update(0.5);
  v.update(0.5);
  assert.equal(previewRenderer.frames, 2, 'drew both frames');
  assert.ok(v.camera.position.distanceTo(first) > 0.5, 'and the camera orbited');
  v.dispose();
});

test('changing the paint or the hull rebuilds it; leaving it alone does not', () => {
  const v = buildPreview(someLook());
  const first = v.view;
  v.set(someLook());
  assert.equal(v.view, first, 'the same look is not rebuilt');

  v.set(someLook({ chassis: 'heavy' }));
  assert.notEqual(v.view, first, 'a different hull is');
  const heavy = v.view;
  assert.equal(heavy.chassis, 'heavy', 'and it built the right one');

  v.set(someLook({ chassis: 'heavy', primary: 0xff0000 }));
  assert.notEqual(v.view, heavy, 'so is a different colour');
  assert.equal(v.view.color, 0xff0000, 'and it is painted the new one');
  v.dispose();
});

test('disposing the preview leaves nothing behind', () => {
  const v = buildPreview(someLook());
  const view = v.view;
  v.dispose();
  assert.equal(v.view, null, 'no machine');
  assert.equal(view.materials.length, 0, 'every material released');
  assert.equal(view.geometries.length, 0, 'every geometry released');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

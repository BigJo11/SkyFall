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
const { nameTexture, softCircleTexture, cloudTexture, carbonTexture, scanlineTexture } = await import('../public/js/textures.js');
const { WEAPONS, PLAYER, COSMETIC } = await import('../shared/constants.js');
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
  assert.equal(sniper.interval, 3500, 'sniper cooldown 3.5s');
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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

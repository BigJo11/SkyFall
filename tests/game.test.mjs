// Headless smoke tests for the authoritative server logic.
//   node tests/game.test.mjs
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WEAPONS } from '../shared/constants.js';
import { rayAABB, rayCapsule, solidAABBs } from '../shared/collision.js';
import ARENA from '../shared/map.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

function fakeSocket() {
  return { readyState: 1, sent: [], send(raw) { this.sent.push(JSON.parse(raw)); } };
}

function makeGame() {
  const game = new Game();
  const sa = fakeSocket();
  const sb = fakeSocket();
  const a = game.addPlayer(sa, 'ALPHA');
  const b = game.addPlayer(sb, 'BRAVO');
  // deterministic positions in an open lane of the arena (x = 40, z -6..4,
  // verified ray-clear for 14 m in tests/map.test.mjs)
  a.pos = [40, 0.01, -6]; a.yaw = 0;
  b.pos = [40, 0.01, 4]; b.yaw = Math.PI;
  game.broadcast = () => {};
  return { game, a, b, sa, sb };
}

const dirTo = (from, to) => {
  const ox = from[0], oy = from[1] + 1.62, oz = from[2];
  const dx = to[0] - ox, dy = 0.9 - oy, dz = to[2] - oz;
  const len = Math.hypot(dx, dy, dz);
  return [dx / len, dy / len, dz / len];
};

console.log('\nSKYFALL server tests\n');

await test('welcome carries identity and spawn', async () => {
  const { sa, a } = makeGame();
  const welcome = sa.sent.find((m) => m.t === 'welcome');
  assert.ok(welcome, 'welcome message sent');
  assert.equal(welcome.id, a.id);
  assert.equal(welcome.name, 'ALPHA');
  assert.ok(welcome.you && Array.isArray(welcome.you.pos));
});

console.log('\nweapons:');

await test('rifle does 17 damage per hit, 6 shots to kill at 4/sec', async () => {
  const { game, a, b } = makeGame();
  a.weapon = 0;
  const dir = dirTo(a.pos, b.pos);
  let shots = 0;
  for (let i = 0; i < 5; i++) {
    game.handle(a, { t: 'fire', dir });
    shots++;
    assert.equal(b.hp, 100 - 17 * shots, `hp after ${shots} rifle shots`);
    await sleep(255);
  }
  game.handle(a, { t: 'fire', dir });
  assert.equal(b.alive, false, 'sixth rifle shot kills');
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);
});

await test('rifle respects the 4 shots/sec fire rate', async () => {
  const { game, a, b } = makeGame();
  const dir = dirTo(a.pos, b.pos);
  game.handle(a, { t: 'fire', dir });
  const hp1 = b.hp;
  game.handle(a, { t: 'fire', dir }); // immediately: rejected
  assert.equal(b.hp, hp1, 'second shot inside the cooldown is ignored');
  assert.equal(a.ammo[0], WEAPONS[0].magSize - 1, 'rejected shot costs no ammo');
});

await test('sniper deals 100 damage: one shot kill, 3.5s cooldown', async () => {
  const { game, a, b } = makeGame();
  a.weapon = 1;
  const dir = dirTo(a.pos, b.pos);
  game.handle(a, { t: 'fire', dir });
  assert.equal(b.alive, false, 'sniper one-shots');
  assert.equal(a.kills, 1);

  // respawn target, then try to fire again instantly
  b.alive = true; b.hp = 100;
  game.handle(a, { t: 'fire', dir });
  assert.equal(b.hp, 100, 'second sniper shot blocked by the 3.5s cooldown');

  // switching weapons must not bypass the sniper cooldown
  game.handle(a, { t: 'weapon', i: 0 });
  game.handle(a, { t: 'fire', dir });
  game.handle(a, { t: 'weapon', i: 1 });
  b.hp = 100; b.alive = true;
  game.handle(a, { t: 'fire', dir });
  assert.equal(b.hp, 100, 'weapon swapping does not reset sniper cooldown');

  await sleep(3520);
  game.handle(a, { t: 'fire', dir });
  assert.equal(b.alive, false, 'sniper fires again after 3.5s');
});

await test('smg: 5 damage per shot at 15 shots/sec', async () => {
  const { game, a, b } = makeGame();
  a.weapon = 2;
  const dir = dirTo(a.pos, b.pos);
  for (let i = 0; i < 4; i++) {
    game.handle(a, { t: 'fire', dir });
    await sleep(70);
  }
  assert.equal(b.hp, 80, 'four smg hits = 20 damage');
  assert.equal(a.ammo[2], WEAPONS[2].magSize - 4);
});

await test('knife one-shots at close range with a 0.5s cooldown', async () => {
  const { game, a, b } = makeGame();
  a.weapon = 3;
  b.pos = [40, 0.01, -4]; // 2m in front
  const dir = dirTo(a.pos, b.pos);
  game.handle(a, { t: 'fire', dir });
  assert.equal(b.alive, false, 'knife one-shot kill');
  b.alive = true; b.hp = 100;
  game.handle(a, { t: 'fire', dir });
  assert.equal(b.hp, 100, 'swing inside 0.5s is ignored');
  await sleep(520);
  game.handle(a, { t: 'fire', dir });
  assert.equal(b.alive, false, 'swings again after the cooldown');
});

await test('knife cannot reach across the map', async () => {
  const { game, a, b } = makeGame();
  a.weapon = 3;
  const dir = dirTo(a.pos, b.pos); // 10 m apart
  game.handle(a, { t: 'fire', dir });
  assert.equal(b.hp, 100, 'out of knife range');
});

console.log('\nworld:');

await test('solid geometry blocks bullets', async () => {
  const { game, a, b } = makeGame();
  a.weapon = 1;
  // the crate at (20, 14) sits between the two players
  a.pos = [20, 0.01, 8];
  b.pos = [20, 0.01, 20];
  const dir = dirTo(a.pos, b.pos);
  game.handle(a, { t: 'fire', dir });
  assert.equal(b.hp, 100, 'crate blocks the shot');
});

await test('ray-AABB and capsule maths', async () => {
  const solids = solidAABBs(ARENA.boxes);
  const hit = rayAABB(0, 5, 0, 0, -1, 0, { minX: -1, maxX: 1, minY: -1, maxY: 0, minZ: -1, maxZ: 1 });
  assert.equal(hit, 5);
  assert.equal(rayAABB(10, 5, 0, 0, -1, 0, { minX: -1, maxX: 1, minY: -1, maxY: 0, minZ: -1, maxZ: 1 }), Infinity);
  const t = rayCapsule(0, 1, 5, 0, 0, -1, [0, 0, 0], 1.8, 0.4, 20);
  assert.ok(Math.abs(t - 4.6) < 0.05, `capsule hit at ${t}`);
  assert.equal(rayCapsule(5, 1, 5, 0, 0, -1, [0, 0, 0], 1.8, 0.4, 20), Infinity);
  assert.ok(solids.length > 20);
});

console.log('\nsession:');

await test('health regen and respawn', async () => {
  const { game, a, b } = makeGame();
  b.hp = 50;
  b.lastDamage = Date.now() - 6000;
  for (let i = 0; i < 20; i++) game.tick();
  assert.ok(b.hp > 50, 'health regenerates out of combat');

  game.kill(b, a, 'rifle');
  assert.equal(b.alive, false);
  await sleep(3100);
  game.tick();
  assert.equal(b.alive, true, 'respawned automatically');
  assert.equal(b.hp, 100, 'respawned at full health');
});

await test('reload refills the magazine', async () => {
  const { game, a } = makeGame();
  a.weapon = 0;
  a.ammo[0] = 3;
  game.handle(a, { t: 'reload' });
  assert.ok(a.reloadEnd > Date.now(), 'reload started');
  a.reloadEnd = Date.now() - 1;
  game.tick();
  assert.equal(a.ammo[0], WEAPONS[0].magSize, 'magazine refilled');
});

await test('names are sanitised and de-duplicated', async () => {
  const game = new Game();
  const s1 = fakeSocket();
  const s2 = fakeSocket();
  const p1 = game.addPlayer(s1, '<script>BOB</script>');
  const p2 = game.addPlayer(s2, p1.name);
  assert.ok(!/[<>]/.test(p1.name), 'markup stripped');
  assert.notEqual(p1.name, p2.name, 'duplicate names get a suffix');
  assert.ok(p1.name.length <= 20);
});

await test('teleport attempts are corrected', async () => {
  const { game, a, sa } = makeGame();
  sa.sent.length = 0;
  game.handle(a, { t: 'input', p: [200, 60, 0], yaw: 0, pitch: 0 });
  assert.ok(sa.sent.some((m) => m.t === 'correct'), 'server corrects impossible movement');
  assert.notEqual(a.pos[0], 200);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

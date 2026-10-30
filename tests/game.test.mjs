// Headless smoke tests for the authoritative server logic.
//   node tests/game.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../server/game.js';
import { Leaderboard } from '../server/leaderboard.js';
import { WEAPONS, RESERVED, CREW_GLOW, COSMETIC } from '../shared/constants.js';
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
  // deterministic positions in an open meadow lane (x = 31, z -70..-58),
  // verified walkable and ray-clear in tests/map.test.mjs
  a.pos = [31, 0.01, -70]; a.yaw = 0;
  b.pos = [31, 0.01, -60]; b.yaw = Math.PI;
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

await test('rifle does 25 damage per hit, 4 shots to kill at 4/sec', async () => {
  const { game, a, b } = makeGame();
  a.weapon = 0;
  const dir = dirTo(a.pos, b.pos);
  let shots = 0;
  for (let i = 0; i < 3; i++) {
    game.handle(a, { t: 'fire', dir });
    shots++;
    assert.equal(b.hp, 100 - 25 * shots, `hp after ${shots} rifle shots`);
    await sleep(255);
  }
  game.handle(a, { t: 'fire', dir });
  assert.equal(b.alive, false, 'fourth rifle shot kills');
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

await test('smg: 8 damage per shot at 15 shots/sec', async () => {
  const { game, a, b } = makeGame();
  a.weapon = 2;
  const dir = dirTo(a.pos, b.pos);
  for (let i = 0; i < 4; i++) {
    game.handle(a, { t: 'fire', dir });
    await sleep(70);
  }
  assert.equal(b.hp, 68, 'four smg hits = 32 damage');
  assert.equal(a.ammo[2], WEAPONS[2].magSize - 4);
});

await test('knife one-shots at close range with a 0.5s cooldown', async () => {
  const { game, a, b } = makeGame();
  a.weapon = 3;
  b.pos = [31, 0.01, -68]; // 2m in front
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

console.log('\nleaderboard:');

await test('a kill lands on the all-time board and is broadcast', async () => {
  const { game, a, b, sa, sb } = makeGame();
  const board = game.leaderboard;
  assert.equal(board.stats('ALPHA'), null, 'joining alone puts nobody on the board');
  const events = [];
  game.broadcast = (msg) => events.push(msg);

  // line them up and shoot BRAVO with the sniper
  a.weapon = 1;
  game.handle(a, { t: 'fire', dir: dirTo(a.pos, b.pos) });

  assert.equal(b.alive, false, 'the target went down');
  assert.equal(board.stats('ALPHA').kills, 1);
  assert.equal(board.stats('BRAVO').deaths, 1);
  const update = events.find((m) => m.t === 'leaderboard');
  assert.ok(update, 'the table was pushed to the clients');
  assert.equal(update.rows[0].name, 'ALPHA');
  assert.equal(update.rows[0].rank, 1);
  void sa; void sb;
});

await test('welcome carries the table so the title screen can show it', () => {
  const game = new Game();
  game.leaderboard.recordKill('VETERAN', 'ROOKIE');
  const sock = fakeSocket();
  game.addPlayer(sock, 'SECOND');
  const welcome = sock.sent.find((m) => m.t === 'welcome');
  assert.ok(Array.isArray(welcome.leaderboard), 'welcome has rows');
  assert.ok(welcome.leaderboard.some((r) => r.name === 'VETERAN'), 'the veteran is on it');
  assert.ok(welcome.leaderboard.every((r) => typeof r.matches === 'number'), 'row shape');
});

await test('a persisted board is reused by the next game instance', () => {
  const file = `${process.env.TMPDIR || '/tmp'}/skyfall-game-board-${process.pid}.json`;
  const one = new Game({ leaderboard: new Leaderboard(file) });
  one.addPlayer(fakeSocket(), 'PERSIST');
  one.leaderboard.recordKill('PERSIST', 'OTHER');
  one.leaderboard.flush();

  const two = new Game({ leaderboard: new Leaderboard(file) });
  assert.equal(two.leaderboard.stats('PERSIST').kills, 1);
  fs.rmSync(file, { force: true });
});

console.log('\ncosmetics:');

await test('a cosmetic rides the join and shows up in snapshots', () => {
  const game = new Game();
  const sock = fakeSocket();
  const look = { primary: 0xff6b6b, secondary: 0x1d2534, material: 'metal' };
  const p = game.addPlayer(sock, 'STYLISH', false, look);
  assert.deepEqual(p.cosmetic, look);
  assert.equal(p.color, 0xff6b6b, 'the name plate follows the primary colour');
  const pub = game.pub(p);
  assert.deepEqual(pub.cosmetic, look, 'the snapshot carries it');
});

await test('a locked material is refused server-side without the code', () => {
  const game = new Game();
  const plain = game.addPlayer(fakeSocket(), 'WANNABE', false, { material: 'neon' });
  assert.equal(plain.cosmetic.material, 'matte', 'no code, no neon');
  const crew = game.addPlayer(fakeSocket(), 'Big Joe', true, { material: 'neon' });
  assert.equal(crew.cosmetic.material, 'neon', 'crew get what they picked');
});

await test('hostile cosmetic values are sanitised, not trusted', () => {
  const game = new Game();
  const p = game.addPlayer(fakeSocket(), 'GARBAGE', false, {
    primary: -1, secondary: 0x1000000, material: 'plasma',
  });
  assert.equal(p.cosmetic.primary, COSMETIC.primary);
  assert.equal(p.cosmetic.secondary, COSMETIC.secondary);
  assert.equal(p.cosmetic.material, 'matte');
});

await test('no cosmetic keeps the old per-player palette', () => {
  const game = new Game();
  const a = game.addPlayer(fakeSocket(), 'PLAIN');
  const b = game.addPlayer(fakeSocket(), 'ALSO');
  assert.equal(a.cosmetic, null, 'nothing invented');
  assert.notEqual(a.color, b.color, 'everyone still gets a distinct colour');
});

await test('crew without a cosmetic still get the gold glow', () => {
  const game = new Game();
  const p = game.addPlayer(fakeSocket(), 'Big Joe', true);
  assert.equal(p.color, CREW_GLOW);
});

console.log('\ncrew + reserved callsigns:');

await test('a reserved callsign is downgraded without the code', () => {
  const game = new Game();
  for (const name of ['Big Joe', 'B1G_J0E', 'bigjoe', 'Big J0e']) {
    const p = game.addPlayer(fakeSocket(), name);
    assert.ok(!RESERVED.isReserved(p.name), `${name} -> ${p.name}`);
    assert.equal(p.crew, false);
  }
});

await test('the crew code keeps the name and lights the player up', () => {
  const game = new Game();
  const p = game.addPlayer(fakeSocket(), 'Big Joe', true);
  assert.equal(p.name, 'Big Joe');
  assert.equal(p.crew, true);
  assert.equal(p.color, CREW_GLOW);
  assert.equal(game.pub(p).crew, true, 'the snapshot carries the crew flag');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

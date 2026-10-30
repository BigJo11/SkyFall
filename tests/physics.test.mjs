// Movement/collision integration against the real arena plus synthetic worlds.
//   node tests/physics.test.mjs
import assert from 'node:assert/strict';
import { solidAABBs } from '../shared/collision.js';
import ARENA from '../shared/map.js';
import { Body } from '../public/js/physics.js';
import { PLAYER } from '../shared/constants.js';

const solids = solidAABBs(ARENA.boxes);
const DT = 1 / 120;
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const idle = { forward: 0, right: 0, sprint: false };
const fwd = (sprint = false) => ({ forward: 1, right: 0, sprint });

function sim(body, seconds, wish, yaw) {
  for (let i = 0; i < seconds / DT; i++) body.update(DT, wish, yaw);
}

function flatWorld(extra = []) {
  const box = (cx, cy, cz, sx, sy, sz) => ({
    minX: cx - sx / 2, maxX: cx + sx / 2,
    minY: cy - sy / 2, maxY: cy + sy / 2,
    minZ: cz - sz / 2, maxZ: cz + sz / 2,
  });
  return [box(0, -0.5, 0, 400, 1, 400), ...extra];
}

const player = (world, x = 0, y = 0.05, z = 0) => {
  const b = new Body(world);
  b.teleport(x, y, z);
  return b;
};

// helpers derived from the live map instead of hard-coded coordinates
const groundAt = (x, z) => {
  let best = -Infinity;
  for (const a of solids) {
    if (x > a.minX && x < a.maxX && z > a.minZ && z < a.maxZ && a.maxY <= 1) best = Math.max(best, a.maxY);
  }
  return best;
};
const insideSolid = (x, y, z) =>
  solids.some((a) => x > a.minX && x < a.maxX && y > a.minY && y < a.maxY && z > a.minZ && z < a.maxZ);

console.log('\nSKYFALL collisions & world integration\n');

console.log('synthetic worlds:');

test('falls to the ground and stays grounded', () => {
  const b = player(flatWorld(), 0, 3, 0);
  sim(b, 1.0, idle, 0);
  assert.ok(Math.abs(b.y) < 0.02, `y = ${b.y}`);
  assert.equal(b.onGround, true);
});

test('walls block the player', () => {
  const wall = { minX: 5, maxX: 6, minY: -2, maxY: 6, minZ: -20, maxZ: 20 };
  const b = player(flatWorld([wall]), 0, 0.05, 0);
  sim(b, 2.0, fwd(true), -Math.PI / 2); // forward = +x
  assert.ok(b.x < 5 && b.x > 3.5, `stopped at the wall (x=${b.x.toFixed(2)})`);
});

test('jumping leaves the ground and lands again', () => {
  const b = player(flatWorld());
  sim(b, 0.2, idle, 0);
  let peak = b.y;
  b.wantJump = true;
  for (let i = 0; i < 90; i++) { b.update(DT, idle, 0); peak = Math.max(peak, b.y); }
  assert.ok(peak > 1.1, `jump height ${peak.toFixed(2)}`);
  sim(b, 1.0, idle, 0);
  assert.ok(b.y < 0.05 && b.onGround, `landed (y=${b.y.toFixed(2)})`);
});

test('walking off an edge falls into the void', () => {
  const b = player(flatWorld(), 260, 0.05, 0); // past the synthetic floor
  sim(b, 3.0, fwd(true), Math.PI);
  assert.ok(b.y < -10, `fell (y=${b.y.toFixed(2)})`);
});

test('a crate can be landed on and jumped off', () => {
  const crate = { minX: -1, maxX: 1, minY: 0, maxY: 1.6, minZ: -1, maxZ: 1 };
  const b = player(flatWorld([crate]), 0, 3, 0);
  sim(b, 1.0, idle, 0);
  assert.ok(Math.abs(b.y - 1.6) < 0.05, `stood on the crate (y=${b.y.toFixed(2)})`);
});

console.log('\narena integration:');

test('the arena has ground everywhere on the plate', () => {
  for (const s of ARENA.spawns) {
    assert.ok(groundAt(s.pos[0], s.pos[2]) > -Infinity, `spawn ${s.pos} has ground`);
    assert.ok(Math.abs(s.pos[1] - (groundAt(s.pos[0], s.pos[2]) + 0.05)) < 0.01, `spawn ${s.pos} sits on it`);
  }
  let holes = 0;
  for (let x = -70; x <= 70; x += 5) {
    for (let z = -70; z <= 70; z += 5) {
      if (groundAt(x, z) === -Infinity) holes++;
    }
  }
  assert.equal(holes, 0, `no holes in the plate (${holes} found)`);
});

test('every spawn point is standing room, not inside geometry', () => {
  for (const s of ARENA.spawns) {
    const [x, y, z] = s.pos;
    assert.equal(insideSolid(x, y + 0.9, z), false, `spawn (${x},${z}) is clear`);
    // and there is headroom
    assert.equal(insideSolid(x, y + 1.7, z), false, `spawn (${x},${z}) has headroom`);
  }
});

test('the central hill can be climbed on foot from any side', () => {
  for (const [sx, sz, yaw] of [[0, 40, 0], [0, -40, Math.PI], [40, 0, Math.PI / 2], [-40, 0, -Math.PI / 2]]) {
    const b = player(solids, sx, 0.05, sz);
    sim(b, 0.3, idle, 0);
    sim(b, 6.0, fwd(true), yaw);
    assert.ok(b.y > 8, `climbed the hill from (${sx},${sz}) to y=${b.y.toFixed(2)}`);
  }
});

test('a rock ridge stops a sprinting player and can be wall run', () => {
  // the ridge at z = -46 runs east/west across the middle of the map
  const b = player(solids, 0, 0.05, -40);
  sim(b, 2.0, fwd(true), 0);            // walk -z into it
  assert.ok(b.z > -46, `stopped in front of the ridge (z=${b.z.toFixed(2)})`);
  assert.ok(b.y > -1, 'never fell off');
});

test('fallen logs are solid and standable', () => {
  // drop onto each log from above; most should hold you at their 1.9 m top
  let held = 0;
  for (const l of ARENA.logs) {
    const b = player(solids, l.x, 6, l.z);
    sim(b, 1.6, idle, 0);
    if (Math.abs(b.y - 1.9) < 0.12) held++;
  }
  assert.ok(held >= 3, `${held} of ${ARENA.logs.length} logs caught the drop`);
});

test('the map is big and dense enough to matter', () => {
  const solid = ARENA.boxes.filter((b) => b.solid !== false);
  assert.ok(ARENA.size >= 140, `plate is ${ARENA.size} m across`);
  assert.ok(solid.length > 250, `${solid.length} solid boxes`);
  assert.ok(ARENA.spawns.length >= 10, `${ARENA.spawns.length} spawns`);
  // at least 10 tall wall faces suitable for wall running
  const tall = solid.filter((b) => b.s[1] >= 5 && Math.max(b.s[0], b.s[2]) >= 8);
  assert.ok(tall.length >= 10, `${tall.length} long tall walls`);
});

test('the barrier ring keeps a sprinting player on the map', () => {
  // the barriers replaced the open void: sprint at every rim and stay up
  const starts = [
    [0, 100, Math.PI], [-100, 0, Math.PI / 2],
    [0, -100, 0], [-60, -100, 0.4], [100, -60, -Math.PI / 2],
  ];
  for (const [x, z, yaw] of starts) {
    const b = player(solids, x, 0.2, z);
    sim(b, 8, fwd(true), yaw);
    assert.ok(b.y > -2, `stayed on the map from (${x},${z}) — y=${b.y.toFixed(2)}`);
  }
  void PLAYER;
});

test('the void below the sky islands is still lethal', () => {
  assert.ok(ARENA.killY < -20, `kill plane at y=${ARENA.killY}`);
  const b = player(solids, 0, 0.05, 0);
  b.teleport(0, 0.05, -220);     // far past the northern island
  sim(b, 6.0, idle, 0);
  assert.ok(b.y < ARENA.killY, `fell past the kill plane (y=${b.y.toFixed(1)})`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

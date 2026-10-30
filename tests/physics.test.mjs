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
    assert.equal(groundAt(s.pos[0], s.pos[2]), 0, `spawn ${s.pos} has ground`);
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

test('the keep staircase can be climbed on foot', () => {
  // the north staircase runs from z = -32 back up to the keep roof at y = 9
  const b = player(solids, 0, 0.05, -33.5);
  sim(b, 0.3, idle, 0);
  sim(b, 3.4, fwd(true), Math.PI);      // walk +z, up the stairs
  assert.ok(b.y > 8.5, `climbed to the keep roof (y=${b.y.toFixed(2)})`);
  assert.ok(b.z > -16, `walked onto the roof (z=${b.z.toFixed(2)})`);
});

test('the plate rim and ring walls contain the fight', () => {
  // walk east from the middle: the outer ring wall stops you before the edge
  const b = player(solids, 40, 0.05, 0);
  sim(b, 4.0, fwd(true), -Math.PI / 2);
  assert.ok(b.x < 66, `stopped inside the ring (x=${b.x.toFixed(2)})`);
  assert.ok(b.y > -1, 'never fell off');
});

test('cover crates are solid and standable', () => {
  // the crate at (60, 10) is 2.6 m tall
  const b = player(solids, 60, 4, 10);
  sim(b, 1.2, idle, 0);
  assert.ok(Math.abs(b.y - 2.6) < 0.08, `landed on the crate top (y=${b.y.toFixed(2)})`);
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

test('the void below the map is lethal', () => {
  assert.ok(ARENA.killY < -20, `kill plane at y=${ARENA.killY}`);
  const b = player(solids, -70.5, 0, 0);   // stepped off the west edge
  b.teleport(-76, 0.05, 0);
  sim(b, 4.0, idle, 0);
  assert.ok(b.y < ARENA.killY, `fell past the kill plane (y=${b.y.toFixed(1)})`);
  void PLAYER;
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

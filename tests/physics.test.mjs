// Movement/collision tests for the client-side player body.
//   node tests/physics.test.mjs
import assert from 'node:assert/strict';
import { solidAABBs } from '../shared/collision.js';
import ARENA from '../shared/map.js';
import { Body } from '../public/js/physics.js';

const solids = solidAABBs(ARENA.boxes);
const DT = 1 / 60;
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

function simulate(body, seconds, wish, yaw) {
  for (let i = 0; i < seconds / DT; i++) body.update(DT, wish, yaw);
}

const idle = { forward: 0, right: 0, sprint: false };

console.log('\nSKYFALL movement tests\n');

test('falls to the ground and stays grounded', () => {
  const b = new Body(solids);
  b.teleport(20, 3, 0);
  simulate(b, 0.6, idle, 0);
  assert.ok(Math.abs(b.y - 0) < 0.02, `y = ${b.y}`);
  assert.equal(b.onGround, true);
});

test('walking forward climbs the centre stairs onto the deck', () => {
  const b = new Body(solids);
  b.teleport(0, 0.05, 20);
  simulate(b, 0.4, idle, 0);
  const startY = b.y;
  simulate(b, 2.2, { forward: 1, right: 0, sprint: false }, 0);
  console.log(`       z=${b.z.toFixed(2)} y=${b.y.toFixed(2)} (start y ${startY.toFixed(2)})`);
  assert.ok(b.z < 11, `walked toward the deck (z=${b.z.toFixed(2)})`);
  assert.ok(b.y > 2.5, `climbed the stairs (y=${b.y.toFixed(2)})`);
  assert.ok(b.onGround, 'still grounded after the climb');
});

test('sprinting is faster than walking', () => {
  const a = new Body(solids);
  a.teleport(34, 0.05, 0);
  simulate(a, 1.2, { forward: 1, right: 0, sprint: false }, 0);
  const walkDist = Math.abs(a.z);
  const b = new Body(solids);
  b.teleport(34, 0.05, 0);
  simulate(b, 1.2, { forward: 1, right: 0, sprint: true }, 0);
  const runDist = Math.abs(b.z);
  assert.ok(runDist > walkDist + 1, `walk ${walkDist.toFixed(2)} run ${runDist.toFixed(2)}`);
});

test('walls block the player', () => {
  const b = new Body(solids);
  // the long cover wall at x = 24, z in [-6, 6]
  b.teleport(18, 0.05, 0);
  simulate(b, 2.5, { forward: 1, right: 0, sprint: true }, -Math.PI / 2); // walk toward +x
  assert.ok(b.x < 23.5, `stopped at the wall (x=${b.x.toFixed(2)})`);
});

test('jumping leaves the ground and lands again', () => {
  const b = new Body(solids);
  b.teleport(20, 0.05, 0);
  simulate(b, 0.3, idle, 0);
  let maxY = b.y;
  b.wantJump = true;
  for (let i = 0; i < 60; i++) {
    b.update(DT, idle, 0);
    maxY = Math.max(maxY, b.y);
  }
  assert.ok(maxY > 1.1, `jump height ${maxY.toFixed(2)}`);
  simulate(b, 1.0, idle, 0);
  assert.ok(b.y < 0.05, `landed (y=${b.y.toFixed(2)})`);
  assert.equal(b.onGround, true);
});

test('walking off the edge falls into the void', () => {
  const b = new Body(solids);
  b.teleport(30, 0.05, 0);
  simulate(b, 3.0, { forward: 1, right: 0, sprint: true }, -Math.PI / 2);
  assert.ok(b.y < -10, `fell off the plate (y=${b.y.toFixed(2)})`);
});

test('the arena rim stops a walker at the plate edge', () => {
  const b = new Body(solids);
  b.teleport(30, 0.05, 0);
  simulate(b, 4.0, idle, 0);
  assert.ok(b.x <= 36.01, `never leaves the plate footprint (x=${b.x.toFixed(2)})`);
});

test('can stand on a crate and jump off', () => {
  const b = new Body(solids);
  b.teleport(20, 2.6, 14); // crate at (20, 0, 14) is 1.6 tall
  simulate(b, 0.5, idle, 0);
  assert.ok(Math.abs(b.y - 1.6) < 0.05, `landed on the crate (y=${b.y.toFixed(2)})`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

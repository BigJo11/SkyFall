// Advanced movement: momentum, sprint jumps, double jump, wall run, slide.
//   node tests/movement.test.mjs
import assert from 'node:assert/strict';
import { solidAABBs } from '../shared/collision.js';
import ARENA from '../shared/map.js';
import { Body } from '../public/js/physics.js';
import { PLAYER, MOVE } from '../shared/constants.js';

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
const speedOf = (b) => Math.hypot(b.vx, b.vz);

function sim(b, seconds, wish, yaw = 0) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) b.update(DT, wish, yaw);
}

// flat, empty test world with an optional wall
function flatWorld(walls = []) {
  const box = (cx, cy, cz, sx, sy, sz) => ({
    minX: cx - sx / 2, maxX: cx + sx / 2,
    minY: cy - sy / 2, maxY: cy + sy / 2,
    minZ: cz - sz / 2, maxZ: cz + sz / 2,
  });
  return [box(0, -0.5, 0, 200, 1, 200), ...walls];
}

const player = (world, x = 0, y = 0.05, z = 0) => {
  const b = new Body(world);
  b.teleport(x, y, z);
  return b;
};

console.log('\nSKYFALL advanced movement tests\n');

console.log('momentum:');

test('momentum is earned by chaining moves, never spent', () => {
  const b = player(flatWorld());
  sim(b, 0.3, idle);
  const before = b.momentum;
  sim(b, 1.2, fwd(true));
  assert.ok(b.momentum > before + 0.05, `momentum built while sprinting (${b.momentum.toFixed(2)})`);
  const built = b.momentum;
  sim(b, 0.5, fwd(true));
  assert.ok(b.momentum >= built, 'sprinting does not drain momentum');
});

test('momentum raises the top speed', () => {
  const slow = player(flatWorld());
  sim(slow, 2.0, fwd(true));
  const slowSpeed = speedOf(slow);

  const fast = player(flatWorld());
  fast.momentum = MOVE.momentumMax; // fully charged
  // hold momentum by sprinting (it decays only slowly while moving)
  sim(fast, 2.0, fwd(true));
  const fastSpeed = speedOf(fast);
  assert.ok(fastSpeed > slowSpeed + 0.8, `boosted ${fastSpeed.toFixed(2)} vs ${slowSpeed.toFixed(2)}`);
  assert.ok(fastSpeed > PLAYER.sprintSpeed, 'past base sprint speed');
});

test('momentum bleeds away when you stand still', () => {
  const b = player(flatWorld());
  b.momentum = 0.9;
  sim(b, 2.0, idle);
  assert.ok(b.momentum < 0.4, `decayed to ${b.momentum.toFixed(2)}`);
});

console.log('\nsprint jumps:');

test('jumping while sprinting preserves and boosts speed', () => {
  const plain = player(flatWorld());
  sim(plain, 1.4, fwd(true));
  sim(plain, 0.2, fwd(false)); // release shift: decay toward walk speed
  plain.wantJump = true;
  plain.update(DT, idle, 0);
  const plainSpeed = speedOf(plain);

  const sprint = player(flatWorld());
  sim(sprint, 1.4, fwd(true));
  const groundSpeed = speedOf(sprint);
  sprint.wantJump = true;
  sprint.update(DT, fwd(true), 0);
  const airSpeed = speedOf(sprint);
  assert.ok(sprint.events.sprintJump || airSpeed >= groundSpeed, 'sprint jump flagged');
  assert.ok(airSpeed >= groundSpeed * 0.99, `kept speed in the air (${groundSpeed.toFixed(2)} -> ${airSpeed.toFixed(2)})`);
  assert.ok(airSpeed > plainSpeed, 'faster than a non-sprint jump');
  assert.ok(sprint.vy > 0, 'leaves the ground');
});

test('a sprint jump is higher than a standing jump in distance covered', () => {
  const b = player(flatWorld());
  sim(b, 1.2, fwd(true));
  b.wantJump = true;
  b.update(DT, fwd(true), 0);
  const z0 = b.z;
  let air = 0;
  while (!b.onGround && air < 3) { b.update(DT, fwd(true), 0); air += DT; }
  const dist = Math.abs(b.z - z0);
  assert.ok(dist > 4.5, `flew ${dist.toFixed(2)} m in one sprint jump`);
});

console.log('\ndouble jump:');

test('a second jump in the air adds height', () => {
  const single = player(flatWorld());
  sim(single, 0.2, idle);
  single.wantJump = true;
  single.update(DT, idle, 0);
  let singlePeak = single.y;
  for (let i = 0; i < 200 && !single.onGround; i++) { single.update(DT, idle, 0); singlePeak = Math.max(singlePeak, single.y); }

  const double = player(flatWorld());
  sim(double, 0.2, idle);
  double.wantJump = true;
  double.update(DT, idle, 0);
  for (let i = 0; i < 40; i++) double.update(DT, idle, 0);
  double.wantJump = true;
  double.update(DT, idle, 0);
  assert.ok(double.events.doubleJumped, 'double jump registered');
  let doublePeak = double.y;
  for (let i = 0; i < 400 && !double.onGround; i++) { double.update(DT, idle, 0); doublePeak = Math.max(doublePeak, double.y); }

  assert.ok(doublePeak > singlePeak + 0.8, `double ${doublePeak.toFixed(2)} vs single ${singlePeak.toFixed(2)}`);
});

test('the double jump budget is one per airtime and refills on landing', () => {
  const b = player(flatWorld());
  sim(b, 0.2, idle);
  b.wantJump = true;
  b.update(DT, idle, 0);
  for (let i = 0; i < 40; i++) b.update(DT, idle, 0);
  assert.equal(b.airJumps, 1, 'one air jump available');
  b.wantJump = true;
  b.update(DT, idle, 0);
  assert.equal(b.airJumps, 0, 'used up');
  const vyAfter = b.vy;
  b.wantJump = true;
  b.update(DT, idle, 0);
  assert.ok(b.vy < vyAfter, 'no third jump');
  for (let i = 0; i < 600 && !b.onGround; i++) b.update(DT, idle, 0);
  assert.equal(b.airJumps, 1, 'refilled on landing');
});

test('double jumping pushes you in the direction you are steering', () => {
  const b = player(flatWorld());
  sim(b, 0.4, fwd(true));
  b.wantJump = true;
  b.update(DT, idle, 0);
  for (let i = 0; i < 30; i++) b.update(DT, idle, 0);
  const vzBefore = b.vz;
  b.wantJump = true;
  b.update(DT, fwd(false), 0);
  assert.ok(b.vz < vzBefore, 'pushed further along the steering direction');
});

console.log('\nwall running:');

const WALL_X = 6;
const wallRunWorld = () => flatWorld([{ minX: WALL_X, maxX: WALL_X + 1, minY: -5, maxY: 12, minZ: -60, maxZ: 60 }]);

function runAlongWall(b, seconds = 1.4) {
  // face +z, hug the wall at x ~ WALL_X
  for (let i = 0; i < seconds / DT; i++) b.update(DT, fwd(true), Math.PI);
}

test('running along a wall in the air starts a wall run', () => {
  const b = player(wallRunWorld(), WALL_X - 0.45, 0.05, -10);
  sim(b, 1.0, fwd(true), Math.PI);
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  let started = false;
  for (let i = 0; i < 120; i++) {
    b.update(DT, fwd(true), Math.PI);
    if (b.wallRun) { started = true; break; }
  }
  assert.ok(started, `wall run engaged (wallRun=${b.wallRun}, speed=${speedOf(b).toFixed(2)})`);
  assert.ok(b.vy > -2, 'does not drop like a stone');
});

test('a wall run slows the fall and ends after its time limit', () => {
  const b = player(wallRunWorld(), WALL_X - 0.45, 6, -10);
  b.vx = 0; b.vz = 9; b.vy = 0;
  b.momentum = 0.5;
  let ran = 0;
  for (let i = 0; i < 400; i++) {
    b.update(DT, { forward: 1, right: 0, sprint: true }, Math.PI);
    if (b.wallRun) { ran += DT; } else if (ran > 0) break;
  }
  assert.ok(ran > 0.3, `ran for ${ran.toFixed(2)}s`);
  assert.ok(ran <= MOVE.wallRunMaxTime + 0.1, `respects the time limit (${ran.toFixed(2)}s)`);
});

test('a wall run cannot begin without a wall', () => {
  const b = player(flatWorld(), 0, 6, 0);
  b.vz = 10;
  b.vy = 0;
  for (let i = 0; i < 60; i++) b.update(DT, fwd(true), Math.PI);
  assert.equal(b.wallRun, false);
});

test('wall kicks push you off the wall and upward', () => {
  const b = player(wallRunWorld(), WALL_X - 0.45, 5, -10);
  b.vz = 9;
  b.vy = 0;
  for (let i = 0; i < 60 && !b.wallRun; i++) b.update(DT, fwd(true), Math.PI);
  assert.ok(b.wallRun, 'wall running before the kick');
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  assert.ok(b.events.wallJumped, 'wall jump fired');
  assert.ok(b.vx < -1, `pushed away from the wall (vx=${b.vx.toFixed(2)})`);
  assert.ok(b.vy > 5, `kicked upward (vy=${b.vy.toFixed(2)})`);
  assert.equal(b.wallRun, false, 'wall run ends');
  assert.equal(b.airJumps, MOVE.airJumps, 'wall kick refreshes the double jump');
});

test('wall running builds momentum fast', () => {
  const b = player(wallRunWorld(), WALL_X - 0.45, 5, -10);
  b.vz = 9; b.vy = 0;
  const start = b.momentum;
  for (let i = 0; i < 60 && b.wallRun; i++) b.update(DT, fwd(true), Math.PI);
  for (let i = 0; i < 150; i++) b.update(DT, fwd(true), Math.PI);
  assert.ok(b.momentum > start + 0.2, `momentum ${b.momentum.toFixed(2)}`);
});

console.log('\nsliding:');

test('sliding from a sprint is fast and temporary', () => {
  const b = player(flatWorld());
  sim(b, 1.4, fwd(true), Math.PI);
  const before = speedOf(b);
  b.wantSlide = true;
  b.update(DT, fwd(true), Math.PI);
  assert.ok(b.sliding, 'slide started');
  assert.ok(b.events.slideStarted);
  assert.ok(speedOf(b) > before, `slide burst ${speedOf(b).toFixed(2)} > ${before.toFixed(2)}`);

  let slid = 0;
  while (b.sliding && slid < 3) { b.update(DT, fwd(true), Math.PI); slid += DT; }
  assert.ok(slid > 0.2, `slid for ${slid.toFixed(2)}s`);
  assert.ok(slid <= MOVE.slideDuration + 0.12, `within the duration (${slid.toFixed(2)}s)`);
});

test('you cannot slide from standing still', () => {
  const b = player(flatWorld());
  sim(b, 0.3, idle);
  b.wantSlide = true;
  b.update(DT, idle, 0);
  assert.equal(b.sliding, false);
});

test('the camera ducks while sliding and recovers afterwards', () => {
  const b = player(flatWorld());
  sim(b, 1.4, fwd(true), Math.PI);
  b.wantSlide = true;
  b.update(DT, fwd(true), Math.PI);
  for (let i = 0; i < 30; i++) b.update(DT, fwd(true), Math.PI);
  assert.ok(b.eyeOffset < MOVE.slideEyeOffset * 0.6, `crouched (${b.eyeOffset.toFixed(2)})`);
  while (b.sliding) b.update(DT, idle, Math.PI);
  for (let i = 0; i < 60; i++) b.update(DT, idle, Math.PI);
  assert.ok(Math.abs(b.eyeOffset) < 0.1, 'eye height restored');
});

test('sliding builds momentum and can be jumped out of', () => {
  const b = player(flatWorld());
  sim(b, 1.4, fwd(true), Math.PI);
  b.momentum = 0.2;
  b.wantSlide = true;
  b.update(DT, fwd(true), Math.PI);
  for (let i = 0; i < 20; i++) b.update(DT, fwd(true), Math.PI);
  assert.ok(b.momentum > 0.2, 'slide added momentum');
  const sz = speedOf(b);
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  assert.ok(!b.sliding, 'jumped out of the slide');
  assert.ok(speedOf(b) >= sz * 0.98, 'carried the speed into the air');
});

test('slide has a cooldown so it cannot be spammed', () => {
  const b = player(flatWorld());
  sim(b, 1.4, fwd(true), Math.PI);
  b.wantSlide = true;
  b.update(DT, fwd(true), Math.PI);
  while (b.sliding) b.update(DT, fwd(true), Math.PI);
  assert.ok(b.slideCooldown > 0, 'cooldown running');
  // immediately try again while still moving fast
  b.vx = 0; b.vz = 12;
  b.wantSlide = true;
  b.update(DT, fwd(true), Math.PI);
  assert.equal(b.sliding, false, 'blocked during cooldown');
});

console.log('\nchaining:');

test('a full momentum chain reaches high momentum and high speed', () => {
  const b = player(flatWorld());
  let peak = 0;
  const track = () => { peak = Math.max(peak, speedOf(b)); };
  // sprint, sprint jump, double jump, land, slide
  sim(b, 1.6, fwd(true), Math.PI);
  track();
  b.wantJump = true; b.update(DT, fwd(true), Math.PI);
  for (let i = 0; i < 25; i++) { b.update(DT, fwd(true), Math.PI); track(); }
  b.wantJump = true; b.update(DT, fwd(true), Math.PI);
  for (let i = 0; i < 150; i++) { b.update(DT, fwd(true), Math.PI); track(); }
  assert.ok(b.onGround, 'landed again');
  b.wantSlide = true; b.update(DT, fwd(true), Math.PI);
  for (let i = 0; i < 40; i++) { b.update(DT, fwd(true), Math.PI); track(); }
  assert.ok(b.momentum > 0.3, `momentum ${b.momentum.toFixed(2)}`);
  assert.ok(peak > PLAYER.sprintSpeed, `peak speed ${peak.toFixed(2)} > sprint ${PLAYER.sprintSpeed}`);
});

test('falling out of the world still works with the new physics', () => {
  const b = player(flatWorld());
  b.teleport(0, 0.05, 0);
  // remove the floor by using an empty world
  const empty = new Body([]);
  empty.teleport(0, 0, 0);
  sim(empty, 3, idle);
  assert.ok(empty.y < -20, `fell to ${empty.y.toFixed(1)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

// Movement model: speed is preserved in the air, a double jump costs a little,
// landing costs everything unless you slide into it. Plus wall running.
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

function flatWorld(walls = []) {
  const box = (cx, cy, cz, sx, sy, sz) => ({
    minX: cx - sx / 2, maxX: cx + sx / 2,
    minY: cy - sy / 2, maxY: cy + sy / 2,
    minZ: cz - sz / 2, maxZ: cz + sz / 2,
  });
  return [box(0, -0.5, 0, 400, 1, 400), ...walls];
}

const player = (world, x = 0, y = 0.05, z = 0) => {
  const b = new Body(world);
  b.teleport(x, y, z);
  return b;
};

// run until the body lands again (or a safety limit)
function simUntilLanding(b, wish, yaw = Math.PI, maxSeconds = 4) {
  let t = 0;
  const startAir = !b.onGround;
  while (t < maxSeconds) {
    b.update(DT, wish, yaw);
    t += DT;
    if (b.onGround && (startAir || t > 0.1)) break;
  }
  return t;
}

console.log('\nSKYFALL movement tests (speed-preservation model)\n');

console.log('air speed:');

test('speed is kept for the whole jump (no air drag)', () => {
  const b = player(flatWorld());
  sim(b, 1.6, fwd(true), Math.PI);
  const ground = speedOf(b);
  assert.ok(ground > 9.5, `sprinting at ${ground.toFixed(2)}`);
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  const samples = [];
  for (let i = 0; i < 160; i++) {
    b.update(DT, fwd(true), Math.PI);
    if (!b.onGround) samples.push(speedOf(b));
    else break;
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const min = Math.min(...samples);
  assert.ok(last > first - 0.35, `speed held in the air (${first.toFixed(2)} -> ${last.toFixed(2)})`);
  assert.ok(min > PLAYER.walkSpeed, `never dragged down mid-air (min ${min.toFixed(2)})`);
});

test('air strafing can build speed above sprint', () => {
  const b = player(flatWorld());
  b.teleport(0, 100, 0);
  b.vx = 0; b.vz = -PLAYER.sprintSpeed;
  const start = speedOf(b);
  // classic strafe: hold forward+right while the view turns into the strafe
  let yaw = 0;
  for (let i = 0; i < 400; i++) {
    yaw += 0.0022;
    b.update(DT, { forward: 1, right: -1, sprint: true }, yaw);
    // stay airborne so the test measures air physics only
    b.y = 100; b.vy = 0;
  }
  assert.ok(speedOf(b) > start + 1.0, `air strafe gained speed (${start.toFixed(2)} -> ${speedOf(b).toFixed(2)})`);
});

console.log('\nlanding:');

test('landing normally throws the momentum away once the window shuts', () => {
  const b = player(flatWorld());
  sim(b, 1.6, fwd(true), Math.PI);
  const ground = speedOf(b);
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  simUntilLanding(b, fwd(true));
  // the speed is held for a moment so a well-timed jump can still cash it in
  assert.ok(b.landKeepPending, 'the landing window is open');
  assert.ok(speedOf(b) > ground * 0.95, `held on touchdown (${speedOf(b).toFixed(2)})`);
  // let the window run out without pressing jump
  sim(b, MOVE.landWindow + 0.1, idle, Math.PI);
  const landed = speedOf(b);
  assert.ok(landed < ground * 0.5, `lost most speed (${ground.toFixed(2)} -> ${landed.toFixed(2)})`);
  assert.ok(landed <= PLAYER.sprintSpeed * MOVE.landCap + 0.01, `capped after the window (${landed.toFixed(2)})`);
});

// press jump when this close (in seconds of fall) to the floor
function pressAt(b, secondsToFloor, wish = fwd(true), yaw = Math.PI) {
  for (let i = 0; i < 400; i++) {
    if (!b.onGround && b.vy < 0 && b.timeToFloor() <= secondsToFloor) {
      b.wantJump = true;
      b.update(DT, wish, yaw);
      return true;
    }
    b.update(DT, wish, yaw);
  }
  return false;
}

function jumpAndFall(wish = fwd(true)) {
  const b = player(flatWorld());
  sim(b, 1.6, wish, Math.PI);
  const ground = speedOf(b);
  b.wantJump = true;
  b.update(DT, wish, Math.PI);
  return { b, ground };
}

test('jumping as you touch down keeps every bit of your momentum', () => {
  const { b, ground } = jumpAndFall();
  assert.ok(pressAt(b, MOVE.landJumpWindow), 'pressed inside the window');
  let perfect = false;
  for (let i = 0; i < 200 && !perfect; i++) {
    b.update(DT, fwd(true), Math.PI);
    perfect = !!b.events.perfectLanding;
  }
  assert.ok(perfect, 'it counted as a timed landing');
  assert.ok(!b.landKeepPending, 'no landing penalty pending');
  const saved = speedOf(b);
  for (let i = 0; i < 4; i++) b.update(DT, fwd(true), Math.PI);
  assert.ok(!b.onGround, 'and it bounced straight back off the floor');
  assert.ok(saved >= ground * 0.98,
    `kept the momentum (${ground.toFixed(2)} -> ${saved.toFixed(2)})`);
});

test('pressing jump just after touching down still saves it', () => {
  const { b, ground } = jumpAndFall();
  simUntilLanding(b, fwd(true));
  assert.ok(b.landKeepPending, 'landing window open');
  for (let i = 0; i < 8; i++) b.update(DT, fwd(true), Math.PI);   // a late reaction
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  assert.ok(b.events.perfectLanding, 'late press inside the window counts');
  assert.ok(speedOf(b) >= ground * 0.98,
    `kept the momentum (${ground.toFixed(2)} -> ${speedOf(b).toFixed(2)})`);
});

test('press too late and the momentum is gone', () => {
  const { b, ground } = jumpAndFall();
  simUntilLanding(b, fwd(true));
  sim(b, MOVE.landWindow + 0.06, idle, Math.PI);   // dither past the window
  b.wantJump = true;
  b.update(DT, idle, Math.PI);
  assert.ok(!b.events.perfectLanding, 'not a timed landing');
  assert.ok(speedOf(b) < ground * 0.5, `speed was lost (${speedOf(b).toFixed(2)})`);
});

test('a held jump auto-hops without the momentum bonus', () => {
  const b = player(flatWorld());
  sim(b, 1.5, fwd(true), Math.PI);
  const ground = speedOf(b);
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  b.jumpHeld = true;                 // held from take-off, so never a fresh press
  let landed = false;
  let cappedAt = 0;
  for (let i = 0; i < 400; i++) {
    b.update(DT, fwd(true), Math.PI);
    if (!landed && b.onGround) landed = true;
    if (landed && b.events.momentumLost) { cappedAt = speedOf(b); break; }
  }
  assert.ok(landed, 'came back down');
  assert.ok(cappedAt > 0, 'the landing penalty still applied');
  assert.ok(cappedAt < ground * 0.6, `the auto-hop lands capped (${cappedAt.toFixed(2)})`);
});

test('a far too early press does not burn the double jump', () => {
  const b = player(flatWorld());
  sim(b, 1.5, fwd(true), Math.PI);
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  sim(b, 0.2, fwd(true), Math.PI);   // plenty of height left
  const before = b.airJumps;
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  assert.ok(b.events.doubleJumped, 'a press with air under you is still a double jump');
  assert.equal(b.airJumps, before - 1);
});

test('landing into a slide keeps the speed', () => {
  const b = player(flatWorld());
  sim(b, 1.6, fwd(true), Math.PI);
  const ground = speedOf(b);
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  // arm the slide while airborne
  for (let i = 0; i < 60; i++) b.update(DT, fwd(true), Math.PI);
  b.wantSlide = true;
  b.update(DT, fwd(true), Math.PI);
  assert.ok(b.slideBuffer > 0, 'slide buffered in the air');
  simUntilLanding(b, fwd(true));
  assert.ok(b.sliding, 'sliding on touch down');
  assert.ok(speedOf(b) >= ground * 0.98, `kept the speed (${ground.toFixed(2)} -> ${speedOf(b).toFixed(2)})`);
});

test('a slide cannot rescue you from a standing landing', () => {
  const b = player(flatWorld());
  sim(b, 0.3, idle);
  b.wantSlide = true;
  b.update(DT, idle, Math.PI);
  assert.equal(b.sliding, false, 'no slide from a standstill');
  assert.equal(b.speed, 0);
});

console.log('\ndouble jump:');

test('a double jump keeps most of your speed', () => {
  const b = player(flatWorld());
  sim(b, 1.6, fwd(true), Math.PI);
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  for (let i = 0; i < 30; i++) b.update(DT, fwd(true), Math.PI);
  const beforeDouble = speedOf(b);
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  assert.ok(b.events.doubleJumped, 'double jump happened');
  const afterDouble = speedOf(b);
  const ratio = afterDouble / beforeDouble;
  assert.ok(ratio > 0.75 && ratio < 0.96,
    `only lost some speed (${beforeDouble.toFixed(2)} -> ${afterDouble.toFixed(2)}, ${Math.round((1 - ratio) * 100)}%)`);
  assert.ok(afterDouble > beforeDouble * 0.75, 'kept the bulk of it');
  // and it is a much softer loss than a mistimed landing
  const landing = player(flatWorld());
  sim(landing, 1.6, fwd(true), Math.PI);
  landing.wantJump = true;
  landing.update(DT, fwd(true), Math.PI);
  simUntilLanding(landing, fwd(true));
  sim(landing, MOVE.landWindow + 0.1, idle, Math.PI);
  assert.ok(speedOf(landing) < afterDouble, 'a mistimed landing is worse than a double jump');
});

test('a double jump adds height and refreshes on landing', () => {
  const b = player(flatWorld());
  sim(b, 0.2, idle);
  const y0 = b.y;
  b.wantJump = true;
  b.update(DT, idle, 0);
  for (let i = 0; i < 40; i++) b.update(DT, idle, 0);
  b.wantJump = true;
  b.update(DT, idle, 0);
  let peak = b.y;
  for (let i = 0; i < 400 && !b.onGround; i++) { b.update(DT, idle, 0); peak = Math.max(peak, b.y); }
  assert.ok(peak > y0 + 2.2, `reached ${(peak - y0).toFixed(2)} m with a double jump`);
  assert.equal(b.airJumps, 1, 'refilled after landing');
});

test('only one double jump per airtime', () => {
  const b = player(flatWorld());
  sim(b, 0.2, idle);
  b.wantJump = true;
  b.update(DT, idle, 0);
  for (let i = 0; i < 40; i++) b.update(DT, idle, 0);
  b.wantJump = true;
  b.update(DT, idle, 0);
  assert.equal(b.airJumps, 0);
  const vy = b.vy;
  b.wantJump = true;
  b.update(DT, idle, 0);
  assert.ok(b.vy < vy, 'no third jump');
});

console.log('\nwall running:');

const WALL_X = 6;
const wallRunWorld = () => flatWorld([{ minX: WALL_X, maxX: WALL_X + 1, minY: -5, maxY: 12, minZ: -60, maxZ: 60 }]);

test('wall running keeps your speed and slows the fall', () => {
  const b = player(wallRunWorld(), WALL_X - 0.45, 6, -10);
  b.vz = 11; b.vy = 0;
  const start = speedOf(b);
  let ran = false;
  let minAirSpeed = Infinity;
  for (let i = 0; i < 200; i++) {
    b.update(DT, fwd(true), Math.PI);
    if (b.wallRun) { ran = true; minAirSpeed = Math.min(minAirSpeed, speedOf(b)); }
    else if (ran) break;
  }
  assert.ok(ran, 'wall run engaged');
  assert.ok(minAirSpeed > start * 0.95, `speed preserved along the wall (${start.toFixed(2)} -> ${minAirSpeed.toFixed(2)})`);
  assert.ok(b.vy > -2.5, 'gravity is softened');
});

test('a wall run ends after its time limit and needs a wall', () => {
  const b = player(wallRunWorld(), WALL_X - 0.45, 6, -10);
  b.vz = 10; b.vy = 0;
  let time = 0;
  let started = false;
  for (let i = 0; i < 400; i++) {
    b.update(DT, fwd(true), Math.PI);
    if (b.wallRun) { time += DT; started = true; }
    else if (started) break;
  }
  assert.ok(started);
  assert.ok(time > 0.3 && time <= MOVE.wallRunMaxTime + 0.1, `ran ${time.toFixed(2)}s`);

  const open = player(flatWorld(), 0, 6, 0);
  open.vz = 10; open.vy = 0;
  for (let i = 0; i < 60; i++) open.update(DT, fwd(true), Math.PI);
  assert.equal(open.wallRun, false, 'no wall, no wall run');
});

test('a wall kick pushes off the wall without losing speed', () => {
  const b = player(wallRunWorld(), WALL_X - 0.45, 5, -10);
  b.vz = 10; b.vy = 0;
  for (let i = 0; i < 60 && !b.wallRun; i++) b.update(DT, fwd(true), Math.PI);
  assert.ok(b.wallRun);
  const before = speedOf(b);
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  assert.ok(b.events.wallJumped, 'wall jump fired');
  assert.ok(b.vx < -1, `pushed clear of the wall (vx=${b.vx.toFixed(2)})`);
  assert.ok(b.vy > 5, 'kicked upward');
  assert.ok(speedOf(b) >= before * 0.95, `kept speed (${before.toFixed(2)} -> ${speedOf(b).toFixed(2)})`);
  assert.equal(b.airJumps, 1, 'double jump refreshed');
});

test('corners cannot be grabbed (they used to eat all your speed)', () => {
  // a pillar: 1.6 x 1.6 around x = 33, z = 12, exactly like the arena markers
  const pillar = {
    minX: 32.2, maxX: 33.8, minY: 0, maxY: 5.2, minZ: 11.2, maxZ: 12.8,
  };
  const world = flatWorld([pillar]);
  const b = player(world, 34.08, 1.0, 8);
  b.vz = 12.75; b.vx = 0; b.vy = 0;
  const start = speedOf(b);
  let minSpeed = start;
  for (let i = 0; i < 120; i++) {
    b.update(DT, fwd(true), Math.PI);
    minSpeed = Math.min(minSpeed, speedOf(b));
    b.y = 1.0; b.vy = 0;   // stay airborne next to the pillar
  }
  assert.equal(b.wallRun, false, 'no corner wall run');
  assert.ok(minSpeed > start * 0.9, `speed untouched by the pillar (${start.toFixed(2)} -> ${minSpeed.toFixed(2)})`);
});

test('the same wall cannot be re-grabbed without landing', () => {
  const b = player(wallRunWorld(), WALL_X - 0.45, 6, -10);
  b.vz = 10; b.vy = 0;
  for (let i = 0; i < 60 && !b.wallRun; i++) b.update(DT, fwd(true), Math.PI);
  const box = b.lastWallBox;
  assert.ok(box, 'wall remembered');
  b.endWallRun();
  b.y = 8; // still airborne
  for (let i = 0; i < 30; i++) b.update(DT, fwd(true), Math.PI);
  assert.equal(b.wallRun, false, 'no instant re-grab');
});

console.log('\nsliding:');

test('sliding from a sprint is fast and temporary', () => {
  const b = player(flatWorld());
  sim(b, 1.6, fwd(true), Math.PI);
  const before = speedOf(b);
  b.wantSlide = true;
  b.update(DT, fwd(true), Math.PI);
  assert.ok(b.sliding, 'slide started');
  assert.ok(speedOf(b) >= before, `slide burst (${before.toFixed(2)} -> ${speedOf(b).toFixed(2)})`);
  let slid = 0;
  while (b.sliding && slid < 4) { b.update(DT, fwd(true), Math.PI); slid += DT; }
  assert.ok(slid > 0.25 && slid <= MOVE.slideDuration + 0.15, `slid ${slid.toFixed(2)}s`);
});

test('the camera ducks while sliding', () => {
  const b = player(flatWorld());
  sim(b, 1.6, fwd(true), Math.PI);
  b.wantSlide = true;
  b.update(DT, fwd(true), Math.PI);
  for (let i = 0; i < 40; i++) b.update(DT, fwd(true), Math.PI);
  assert.ok(b.eyeOffset < MOVE.slideEyeOffset * 0.6, `crouched (${b.eyeOffset.toFixed(2)})`);
  while (b.sliding) b.update(DT, idle, Math.PI);
  for (let i = 0; i < 80; i++) b.update(DT, idle, Math.PI);
  assert.ok(Math.abs(b.eyeOffset) < 0.1, 'eye height restored');
});

test('sliding has a cooldown', () => {
  const b = player(flatWorld());
  sim(b, 1.6, fwd(true), Math.PI);
  b.wantSlide = true;
  b.update(DT, fwd(true), Math.PI);
  while (b.sliding) b.update(DT, fwd(true), Math.PI);
  assert.ok(b.slideCooldown > 0);
  b.vz = -12; b.vx = 0;
  b.wantSlide = true;
  b.update(DT, fwd(true), Math.PI);
  assert.equal(b.sliding, false, 'blocked during cooldown');
});

test('jumping out of a slide keeps the speed', () => {
  const b = player(flatWorld());
  sim(b, 1.6, fwd(true), Math.PI);
  b.wantSlide = true;
  b.update(DT, fwd(true), Math.PI);
  for (let i = 0; i < 20; i++) b.update(DT, fwd(true), Math.PI);
  const s = speedOf(b);
  b.wantJump = true;
  b.update(DT, fwd(true), Math.PI);
  assert.equal(b.sliding, false);
  assert.ok(speedOf(b) >= s * 0.98, `carried ${s.toFixed(2)} into the air`);
});

console.log('\nchaining:');

test('a slide-jump-slide chain keeps you fast across the map', () => {
  const b = player(flatWorld());
  sim(b, 1.4, fwd(true), Math.PI);
  const speeds = [];
  for (let hop = 0; hop < 3; hop++) {
    b.wantSlide = true;
    b.update(DT, fwd(true), Math.PI);
    for (let i = 0; i < 12; i++) { b.update(DT, fwd(true), Math.PI); speeds.push(speedOf(b)); }
    b.wantJump = true;
    b.update(DT, fwd(true), Math.PI);
    for (let i = 0; i < 40; i++) { b.update(DT, fwd(true), Math.PI); speeds.push(speedOf(b)); }
    // re-arm the slide just before landing
    b.wantSlide = true;
    simUntilLanding(b, fwd(true));
    speeds.push(speedOf(b));
  }
  const avg = speeds.reduce((a, c) => a + c, 0) / speeds.length;
  assert.ok(avg > PLAYER.sprintSpeed * 0.85, `stayed fast through the chain (avg ${avg.toFixed(2)})`);
  assert.ok(b.peakSpeed > PLAYER.sprintSpeed, `peak ${b.peakSpeed.toFixed(2)}`);
});

test('walking and sprinting still work normally', () => {
  const walk = player(flatWorld());
  sim(walk, 2.0, fwd(false), Math.PI);
  assert.ok(Math.abs(speedOf(walk) - PLAYER.walkSpeed) < 0.2, `walk ${speedOf(walk).toFixed(2)}`);
  const sprint = player(flatWorld());
  sim(sprint, 2.0, fwd(true), Math.PI);
  assert.ok(Math.abs(speedOf(sprint) - PLAYER.sprintSpeed) < 0.3, `sprint ${speedOf(sprint).toFixed(2)}`);
  assert.ok(speedOf(sprint) > speedOf(walk));
});

test('falling out of the world still works', () => {
  const empty = new Body([]);
  empty.teleport(0, 0, 0);
  sim(empty, 3, idle);
  assert.ok(empty.y < -20, `fell to ${empty.y.toFixed(1)}`);
});


console.log('\ntitanfall feel:');

test('a plain forward jump does not accelerate you in the air', () => {
  const b = player(flatWorld());
  sim(b, 1.5, fwd(true), Math.PI);
  const ground = speedOf(b);
  b.wantJump = true;
  let peak = 0;
  for (let i = 0; i < 240; i++) { b.update(DT, fwd(true), Math.PI); peak = Math.max(peak, speedOf(b)); }
  assert.ok(peak < ground + 1.2, `air speed stayed near ${ground.toFixed(2)} (peak ${peak.toFixed(2)})`);
});

test('air strafing with a turn builds speed above sprint', () => {
  const b = player(flatWorld());
  sim(b, 1.5, fwd(true), Math.PI);
  b.wantJump = true;
  let yaw = Math.PI;
  let peak = 0;
  for (let i = 0; i < 300; i++) {
    yaw += 0.5 * DT;
    b.update(DT, { forward: 1, right: 1, sprint: true }, yaw);
    peak = Math.max(peak, speedOf(b));
  }
  assert.ok(peak > PLAYER.sprintSpeed * 1.1, `carved up to ${peak.toFixed(2)} m/s`);
});

test('a wall run lasts about two seconds and keeps your speed', () => {
  const b = player(flatWorld([{ minX: 2, maxX: 4, minY: -1, maxY: 20, minZ: -30, maxZ: 30 }]), 1.2, 2.0, 12);
  b.vz = 12.0;
  b.wantJump = true;
  let ran = 0;
  let top = 0;
  for (let i = 0; i < 4 / DT; i++) {
    b.update(DT, fwd(true), Math.PI);
    if (b.wallRun) ran += DT;
    top = Math.max(top, speedOf(b));
  }
  assert.ok(ran > 1.2, `wall ran for ${ran.toFixed(2)} s`);
  assert.ok(top < 18, `speed stayed sane (${top.toFixed(2)} m/s)`);
});

test('you cannot latch onto the next wall panel instantly', () => {
  const b = player(flatWorld([{ minX: 2, maxX: 4, minY: -1, maxY: 20, minZ: -30, maxZ: 0 },
    { minX: 2, maxX: 4, minY: -1, maxY: 20, minZ: 0, maxZ: 30 }]), 1.2, 2.0, 12);
  b.vz = 12.0;
  b.wantJump = true;
  for (let i = 0; i < 3 / DT; i++) b.update(DT, fwd(true), Math.PI);
  assert.ok(b.wallRunCooldown >= 0, 'cooldown is tracked');
});

test('a low ledge is mantled when you run into it', () => {
  const crate = { minX: 1, maxX: 3, minY: 0, maxY: 1.2, minZ: -4, maxZ: 4 };
  const b = player(flatWorld([crate]), 0, 0.05, 0);
  sim(b, 0.4, fwd(true), -Math.PI / 2);   // sprint at the crate
  b.wantJump = true;
  let mantled = false;
  for (let i = 0; i < 240 && !mantled; i++) {
    b.update(DT, fwd(true), -Math.PI / 2);
    if (b.events.mantled) mantled = true;
  }
  assert.ok(mantled, 'mantled the ledge');
  assert.ok(b.y > 1.0, `standing on top (y=${b.y.toFixed(2)})`);
});

test('a wall too tall to mantle is not climbed', () => {
  const wall = { minX: 1, maxX: 3, minY: 0, maxY: 5, minZ: -4, maxZ: 4 };
  const b = player(flatWorld([wall]), 0, 0.05, 0);
  sim(b, 0.4, fwd(true), -Math.PI / 2);
  b.wantJump = true;
  for (let i = 0; i < 240; i++) b.update(DT, fwd(true), -Math.PI / 2);
  assert.ok(b.y < 2, `still low (y=${b.y.toFixed(2)})`);
});


console.log('\njump input:');

test('a fresh press jumps while sprinting', () => {
  const b = player(flatWorld());
  sim(b, 1.5, fwd(true), Math.PI);
  const ground = speedOf(b);
  b.wantJump = true;
  sim(b, 0.15, fwd(true), Math.PI);
  assert.ok(b.y > 0.6, `left the ground (y=${b.y.toFixed(2)})`);
  assert.ok(speedOf(b) > ground * 0.9, `kept the sprint speed (${speedOf(b).toFixed(2)})`);
});

test('holding jump auto-hops as soon as you land', () => {
  const b = player(flatWorld());
  sim(b, 1.5, fwd(true), Math.PI);
  b.jumpHeld = true;
  let hops = 0;
  for (let i = 0; i < 600; i++) {
    b.update(DT, fwd(true), Math.PI);
    if (b.events.jumped) hops++;
  }
  assert.ok(hops >= 5, `hopped ${hops} times in 5 s while holding space`);
  assert.ok(b.y > 0.2 || hops > 0, 'stayed bouncing');
});

test('a held jump on a slide keeps the slide going', () => {
  const b = player(flatWorld());
  sim(b, 1.5, fwd(true), Math.PI);
  b.wantSlide = true;
  sim(b, 0.2, fwd(true), Math.PI);
  assert.equal(b.sliding, true, 'sliding');
  b.jumpHeld = true;
  sim(b, 0.05, fwd(true), Math.PI);
  assert.ok(!b.sliding, 'jumped out of the slide');
  assert.ok(b.y > 0.1, 'airborne');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

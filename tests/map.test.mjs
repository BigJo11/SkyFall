// The arena itself: is it big, is it walkable, is the practice lane clear, and
// does the wall-run staging spot actually produce a wall run?
//   node tests/map.test.mjs
import assert from 'node:assert/strict';
import ARENA, { SPAWNS, PRACTICE, SMALL, MAPS, MAP_LIST, mapById, DEFAULT_MAP } from '../shared/map.js';
import { solidAABBs, raycastAABBs } from '../shared/collision.js';
import { Body } from '../public/js/physics.js';

const solids = solidAABBs(ARENA.boxes);
const DT = 1 / 120;
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const run = (sprint = true) => ({ forward: 1, right: 0, sprint });

const standable = (x, z, y = 0.05) =>
  !solids.some((a) => x + 0.42 > a.minX && x - 0.42 < a.maxX
    && z + 0.42 > a.minZ && z - 0.42 < a.maxZ
    && a.maxY > y + 0.12 && a.minY < y + 1.85);

const clearShot = (from, to) => {
  const ox = from[0];
  const oy = from[1] + 1.62;
  const oz = from[2];
  const dx = to[0] - ox;
  const dy = to[1] + 0.9 - oy;
  const dz = to[2] - oz;
  const len = Math.hypot(dx, dy, dz);
  const { t } = raycastAABBs(solids, ox, oy, oz, dx / len, dy / len, dz / len, len);
  return t >= len - 0.02;
};

const groundUnder = (x, z) => {
  let best = -Infinity;
  for (const a of solids) {
    if (x > a.minX && x < a.maxX && z > a.minZ && z < a.maxZ && a.maxY <= 1) best = Math.max(best, a.maxY);
  }
  return best;
};

console.log('\nSKYFALL arena\n');

console.log('scale:');

test('the map is big', () => {
  assert.ok(ARENA.size >= 140, `plate is ${ARENA.size} m across`);
  const solid = ARENA.boxes.filter((b) => b.solid !== false);
  assert.ok(solid.length >= 300, `${solid.length} solid boxes`);
  const tallest = Math.max(...solid.map((b) => b.p[1] + b.s[1] / 2));
  assert.ok(tallest >= 9, `structures ${tallest.toFixed(1)} m tall`);
});

test('cover is everywhere, not just in the middle', () => {
  const cover = ARENA.boxes.filter((b) => b.solid !== false
    && b.s[1] >= 1.0 && b.s[1] <= 6.0 && b.s[0] <= 8 && b.s[2] <= 8
    && b.p[1] - b.s[1] / 2 < 1);
  assert.ok(cover.length >= 60, `${cover.length} low cover pieces`);
  const quads = [0, 0, 0, 0];
  for (const b of cover) {
    const i = (b.p[0] > 0 ? 1 : 0) + (b.p[2] > 0 ? 2 : 0);
    quads[i]++;
  }
  assert.ok(quads.every((n) => n >= 5), `cover in every quadrant: ${quads.join(', ')}`);
});

test('there are long tall walls for wall running', () => {
  const walls = ARENA.boxes.filter((b) => b.solid !== false
    && b.s[1] >= 5 && Math.max(b.s[0], b.s[2]) >= 12);
  assert.ok(walls.length >= 8, `${walls.length} long tall walls`);
});

console.log('\nfloor:');

test('the plateau is solid under every spawn and across the whole map', () => {
  for (const s of SPAWNS) {
    const g = groundUnder(s.pos[0], s.pos[2]);
    assert.ok(g > -Infinity, `spawn ${s.pos} on solid ground`);
    assert.ok(Math.abs(s.pos[1] - (g + 0.05)) < 0.02, `spawn ${s.pos} stands on it`);
  }
  const half = ARENA.size / 2;
  let holes = 0;
  for (let x = -half + 4; x <= half - 4; x += 8) {
    for (let z = -half + 4; z <= half - 4; z += 8) if (groundUnder(x, z) === -Infinity) holes++;
  }
  assert.equal(holes, 0, `${holes} holes`);
});

test('all spawns are clear standing room and face the middle', () => {
  assert.ok(SPAWNS.length >= 10, `${SPAWNS.length} spawns`);
  for (const s of SPAWNS) {
    const [x, , z] = s.pos;
    assert.ok(standable(x, z, s.pos[1] - 0.02), `spawn (${x}, ${z}) is clear`);
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const len = Math.hypot(x, z) || 1;
    const dot = (fx * -x + fz * -z) / len;
    assert.ok(dot > 0.9, `spawn (${x}, ${z}) faces in (dot ${dot.toFixed(2)})`);
  }
});

test('the hills and mesas can be walked up from the meadow', () => {
  const climbs = [
    ['central hill from the south', [0, 40], [0, 0], 8],
    ['central hill from the west', [-40, 0], [0, 0], 8],
    ['NW mesa from the south', [-72, -100], [-72, -72], 7],
    ['SE mesa from the north', [72, 100], [72, 72], 7],
  ];
  for (const [name, start, target, want] of climbs) {
    const b = new Body(solids);
    b.teleport(start[0], 0.05, start[1]);
    const yaw = Math.atan2(-(target[0] - start[0]), -(target[1] - start[1]));
    let peak = 0;
    for (let i = 0; i < 10 / DT; i++) {
      b.update(DT, run(), yaw);
      peak = Math.max(peak, b.y);
    }
    assert.ok(peak > want, `${name}: climbed to y=${peak.toFixed(2)}`);
  }
});

console.log('\npractice range:');

test('the practice lane is clear standing room for 30 m', () => {
  const [x, y, z] = PRACTICE.spawn;
  assert.ok(standable(x, z, y), 'spawn is clear');
  assert.ok(groundUnder(x, z) < 0.2, `spawn is on the floor (${groundUnder(x, z).toFixed(2)})`);
  const dirZ = -Math.cos(PRACTICE.yaw) > 0.5 ? 1 : -1;
  for (let d = 0; d <= 30; d += 2) assert.ok(standable(x, z + dirZ * d), `lane clear at ${d} m`);
});

test('every range dummy is standable and shootable from the spawn', () => {
  const from = PRACTICE.spawn;
  const dummies = [[90, -42], [88, -38], [92, -34], [89, -29], [93, -25], [90, -20]];
  for (const [x, z] of dummies) {
    assert.ok(standable(x, z), `dummy at (${x}, ${z}) stands on the floor`);
    assert.ok(clearShot(from, [x, 0, z]), `line of fire to (${x}, ${z}) is clear`);
  }
});

test('the wall-run staging spot starts a wall run without losing speed', () => {
  const [x, y, z] = PRACTICE.wallRunSpot;
  const b = new Body(solids);
  b.teleport(x, y, z);
  b.vz = 12.75 * -Math.cos(PRACTICE.yaw);
  b.vx = 12.75 * -Math.sin(PRACTICE.yaw);
  b.wantJump = true;
  let ran = 0;
  let best = 0;
  for (let i = 0; i < 3.2 / DT; i++) {
    b.update(DT, run(), PRACTICE.yaw);
    if (b.wallRun) ran += DT;
    best = Math.max(best, b.speed);
  }
  assert.ok(ran > 0.4, `wall ran for ${ran.toFixed(2)} s`);
  assert.ok(best >= 12, `never lost speed (${best.toFixed(2)} m/s)`);
});


// ---------------------------------------------------------------- second map
console.log('\npine hollow (the small map):\n');

const smallSolids = solidAABBs(SMALL.boxes);
const smallClear = (x, z, y = 0.05) =>
  !smallSolids.some((a) => x + 0.42 > a.minX && x - 0.42 < a.maxX
    && z + 0.42 > a.minZ && z - 0.42 < a.maxZ
    && a.maxY > y + 0.12 && a.minY < y + 1.85);

test('both maps are registered and reachable by id', () => {
  assert.deepEqual(Object.keys(MAPS).sort(), ['big', 'small']);
  assert.equal(mapById('small').id, 'small');
  assert.equal(mapById('nonsense').id, DEFAULT_MAP, 'an unknown id falls back');
  assert.equal(MAP_LIST.length, 2);
  for (const m of MAP_LIST) {
    assert.ok(m.name && m.blurb, `${m.id} has a name and blurb`);
    assert.ok(m.size > 0);
  }
});

test('the small map is really small, and really enclosed', () => {
  assert.ok(SMALL.size < ARENA.size / 2, `small is ${SMALL.size} m vs ${ARENA.size} m`);
  assert.ok(SMALL.size >= 80, `still room to fight (${SMALL.size} m)`);
  // a body cannot walk out of the bowl: a wall stands at every edge
  const half = SMALL.size / 2;
  for (const [x, z] of [[half + 2, 0], [-half - 2, 0], [0, half + 2], [0, -half - 2]]) {
    const wall = smallSolids.find((a) => x > a.minX - 1 && x < a.maxX + 1
      && z > a.minZ - 1 && z < a.maxZ + 1 && a.maxY > 4);
    assert.ok(wall, `a wall stands at ${x},${z}`);
  }
});

test('every small-map spawn is clear and stands on the floor', () => {
  for (const s of SMALL.spawns) {
    const [x, y, z] = s.pos;
    assert.ok(smallClear(x, z, y), `spawn ${x.toFixed(0)},${z.toFixed(0)} is not inside geometry`);
    assert.ok(Math.abs(x) < SMALL.size / 2 && Math.abs(z) < SMALL.size / 2, 'inside the bowl');
    assert.ok(y > -1 && y < 4, `spawn height ${y}`);
  }
  assert.ok(SMALL.spawns.length >= 6, `${SMALL.spawns.length} spawns spread the room out`);
});

// A player does not walk in a straight line through cover, so this checks the
// bowl is *connected*: a grid walk from every spawn reaches the keep.
function reachable(solidsList, from, goalRadius, half) {
  const step = 1;
  const key = (x, z) => `${x},${z}`;
  const walkable = (x, z) => {
    let floor = -Infinity;
    for (const a of solidsList) {
      if (x + 0.38 > a.minX && x - 0.38 < a.maxX && z + 0.38 > a.minZ && z - 0.38 < a.maxZ
        && a.maxY <= 1) floor = Math.max(floor, a.maxY);
    }
    if (floor === -Infinity) return false;
    for (const a of solidsList) {
      if (x + 0.38 > a.minX && x - 0.38 < a.maxX && z + 0.38 > a.minZ && z - 0.38 < a.maxZ
        && a.maxY > floor + 0.6 && a.minY < floor + 1.8) return false;
    }
    return true;
  };
  const start = [Math.round(from[0]), Math.round(from[2])];
  if (!walkable(start[0], start[1])) return false;
  const seen = new Set([key(...start)]);
  const queue = [start];
  while (queue.length) {
    const [x, z] = queue.pop();
    if (Math.hypot(x, z) <= goalRadius) return true;
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (Math.abs(nx) > half || Math.abs(nz) > half) continue;
      const k = key(nx, nz);
      if (seen.has(k)) continue;
      seen.add(k);
      if (walkable(nx, nz)) queue.push([nx, nz]);
    }
  }
  return false;
}

test('every small-map spawn can reach the middle of the bowl', () => {
  const half = SMALL.size / 2 - 1;
  for (const s of SMALL.spawns) {
    // the keep itself is climbed, so "arrived" means reaching its foot
    assert.ok(reachable(smallSolids, s.pos, 11, half),
      `spawn ${s.pos[0].toFixed(0)},${s.pos[2].toFixed(0)} can walk to the keep`);
  }
});

test('the small map has solid cover to fight around', () => {
  const tall = smallSolids.filter((a) => a.maxY - a.minY > 1 && a.maxY < 6).length;
  assert.ok(tall >= 12, `${tall} pieces of waist-to-head-height cover`);
  assert.ok(SMALL.trees.length >= 8, `${SMALL.trees.length} trees on the rim`);
});

test('the small map is not a copy of the big one', () => {
  assert.notEqual(SMALL.boxes, ARENA.boxes);
  assert.notEqual(SMALL.boxes.length, ARENA.boxes.length);
  assert.notEqual(SMALL.sky.fog, ARENA.sky.fog);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

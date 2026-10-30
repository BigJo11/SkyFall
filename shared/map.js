// The SkyFall arena: a floating forest plateau in the sky.
//
// Everything is still axis-aligned boxes ( p = centre [x,y,z], s = size [w,h,d] )
// because the server, the collision code and the renderer all agree on them, but
// the palette, the shapes and the dressing are a mountain meadow rather than a
// neon citadel:
//
//   * terraced hills you can walk up anywhere (every step is under step height)
//   * mossy rock ridges and cliff walls for wall running
//   * ~120 trees, ~60 boulders, fallen logs, a lake and dirt trails
//   * grass, ferns and flowers scattered as instances by world.js
//
// `c` is the side colour, `ct` the (lighter) top colour, `solid:false` marks
// purely decorative geometry that nothing collides with.
//
// Layout (top view, +x east, +z south):
//
//        ┌────────────── floating forest plateau ──────────────┐
//        │   mesa        ridge        ridge        mesa        │
//        │        ~~lake~~    ┌ central hill ┐                 │
//        │   ridge    logs    └──────────────┘   ridge        │
//        │   mesa        ridge        ridge        mesa        │
//        └─────────────────────────────────────────────────────┘

const boxes = [];

function box(x, y, z, w, h, d, c, ct = null, solid = true) {
  boxes.push({ p: [x, y, z], s: [w, h, d], c, ct, solid });
}

// A solid block standing on the ground, topped at `top`.
function block(x, z, w, d, top, c, ct) {
  box(x, top / 2, z, w, top, d, c, ct);
}

// A floating slab whose top surface is at `top`.
function slab(x, z, w, d, top, thick, c, ct) {
  box(x, top - thick / 2, z, w, thick, d, c, ct);
}

// A staircase starting at (x, z) and climbing in `dir` ('n' -z, 's' +z, 'e' +x,
// 'w' -x). Every step is under the player's step height, so it is walkable.
const STAIR_RUN = 0.62;
function stairs(x, z, dir, width, top, rise = 0.5, c = C.deck, ct = C.deckTop) {
  const steps = Math.max(1, Math.ceil(top / rise));
  const actualRise = top / steps;
  for (let i = 0; i < steps; i++) {
    const h = actualRise * (i + 1);
    const mid = STAIR_RUN * (i + 0.5);
    if (dir === 'n') box(x, h / 2, z - mid, width, h, STAIR_RUN, c, ct);
    else if (dir === 's') box(x, h / 2, z + mid, width, h, STAIR_RUN, c, ct);
    else if (dir === 'e') box(x + mid, h / 2, z, STAIR_RUN, h, width, c, ct);
    else box(x - mid, h / 2, z, STAIR_RUN, h, width, c, ct);
  }
  return steps * STAIR_RUN;
}

// Same, but (x, z) is where the staircase arrives at the top.
function stairsUp(x, z, dir, width, top, rise = 0.5, c = C.deck, ct = C.deckTop) {
  const steps = Math.max(1, Math.ceil(top / rise));
  const back = steps * STAIR_RUN;
  const off = { n: [0, back], s: [0, -back], e: [-back, 0], w: [back, 0] }[dir];
  return stairs(x + off[0], z + off[1], dir, width, top, rise, c, ct);
}

// Deterministic RNG so the map (and the tests that describe it) never move.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5c1f411);
const rnd = (a, b) => a + rand() * (b - a);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ---------------------------------------------------------------- palette
const C = {
  grass: 0x4a6f36,
  grassTop: 0x6d9a45,
  grassDark: 0x3c5c2c,
  grassDarkTop: 0x597f39,
  soil: 0x54402c,
  soilTop: 0x6b5338,
  rock: 0x5f6469,
  rockTop: 0x8b9095,
  rockDark: 0x4b5055,
  rockMoss: 0x53614a,
  rockMossTop: 0x7d8f62,
  cliff: 0x565b60,
  cliffTop: 0x777d80,
  bark: 0x4a3524,
  barkTop: 0x5d4630,
  log: 0x6b4d33,
  logTop: 0x86653f,
  leafA: 0x2f6b34,
  leafB: 0x3d7d3a,
  leafC: 0x27562c,
  sand: 0xa89472,
  sandTop: 0xc0ad86,
  path: 0x7b6547,
  pathTop: 0x94795a,
  water: 0x2f6f7d,
  wood: 0x7a5a3a,
  woodTop: 0x96714a,
  stone: 0x6e7377,
  stoneTop: 0x9298a0,
  flower: 0xb985b0,

  // ---------------------------------------------------------- industrial
  cliffWall: 0x6a6157,
  cliffWallTop: 0x8e8377,
  cliffWallDark: 0x4f4a43,
  steel: 0x3a4450,
  steelTop: 0x6a7683,
  steelDark: 0x2a323c,
  rust: 0x6f4632,
  rustTop: 0x93603f,
  hazard: 0xb48c22,
  hazardTop: 0xd9ac33,
  concrete: 0x63686c,
  concreteTop: 0x878d92,
  containerA: 0x2c5670,
  containerB: 0x7d3630,
  containerC: 0x3b6349,
  containerD: 0x8a6c2f,
  pipe: 0x545c66,
  pipeTop: 0x767f89,
  glass: 0x2a4b60,
  lamp: 0xffcf7a,
};

const HALF = 120;           // half the plateau width (map is 240 x 240 m)
const GROUND = 0;
const MAP_SIZE = HALF * 2;

// Regions that stay clear of trees, rocks and mounds so the map reads open and
// there is room for something very large to walk through later.
const CLEARINGS = [
  { x0: 78, x1: 106, z0: -58, z1: -4 },    // practice meadow (east)
  { x0: 26, x1: 122, z0: -30, z1: 30 },    // grand avenue: hill -> industrial gate
  { x0: -16, x1: 16, z0: 34, z1: 118 },    // north parade lane
  { x0: -16, x1: 16, z0: -118, z1: -34 },  // south parade lane
  { x0: -122, x1: -40, z0: -18, z1: 18 },  // west open field
];

// The industrial annex starts east of the forest plateau.
const IND = { x0: 128, x1: 204, z0: -62, z1: 62 };
const inIndustrial = (x, z, pad = 0) =>
  x > IND.x0 - pad && x < IND.x1 + pad && z > IND.z0 - pad && z < IND.z1 + pad;
// the rocky barrier band around the plateau, minus the gates
const onRim = (x, z) => {
  const band = 16;
  const nearX = Math.abs(Math.abs(x) - HALF) < band && Math.abs(z) < HALF - 4;
  const nearZ = Math.abs(Math.abs(z) - HALF) < band && Math.abs(x) < HALF - 4;
  return nearX || nearZ;
};
const inClearing = (x, z, pad = 0) => CLEARINGS.some((c) =>
  x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad);

// ---------------------------------------------------------------- plateau
// The ground plate: a mossy meadow sitting on a big tapered rock keel so the
// island reads as a mountain floating in the sky.
box(0, -1.5, 0, MAP_SIZE, 3, MAP_SIZE, C.soil, C.grassTop);
// a soft lip of darker grass around the rim
for (const s of [-1, 1]) {
  box(0, 0.04, s * (HALF - 1.2), MAP_SIZE - 4, 0.12, 2.4, C.grassDark, C.grassDarkTop);
  box(s * (HALF - 1.2), 0.04, 0, 2.4, 0.12, MAP_SIZE - 4, C.grassDark, C.grassDarkTop);
}
// rock keel underneath (decorative: you never see it unless you fall)
const keel = [
  [0, -6, 0, 210, 8, 210],
  [0, -14, 0, 175, 10, 175],
  [0, -24, 0, 130, 12, 130],
  [0, -38, 0, 84, 16, 84],
  [0, -56, 0, 40, 22, 40],
];
for (const [x, y, z, w, h, d] of keel) box(x, y, z, w, h, d, C.rockDark, C.rock, false);

// ---------------------------------------------------------------- helpers
// A terraced hill: each terrace is short enough to walk up, so hills are
// traversable in any direction. Returns the height at the centre.
function hill(cx, cz, radius, height, stepRise = 0.42, side = C.grass, top = C.grassTop, jitter = 0.35) {
  const steps = Math.max(2, Math.round(height / stepRise));
  const rise = height / steps;
  const shrink = radius / steps;
  for (let i = 1; i <= steps; i++) {
    const h = rise * i;
    const r = radius - shrink * (i - 1);
    const j = i === steps ? 0 : jitter * shrink;
    const tread = i % 2 ? C.grassTop : C.grassDarkTop;
    block(cx + rnd(-j, j), cz + rnd(-j, j), r * 2, r * 2, h, side, i === steps ? top : tread);
  }
  return height;
}

// A dirt trail: a run of flat slabs laid over the meadow.
function trail(points, width = 3.2) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.round(len / 4));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const x = x0 + dx * t;
      const z = z0 + dz * t;
      const along = len / steps;
      const w = Math.abs(dx) > Math.abs(dz) ? along : width;
      const d = Math.abs(dx) > Math.abs(dz) ? width : along;
      box(x, 0.03, z, w + 0.4, 0.08, d + 0.4, C.path, C.pathTop);
    }
  }
}

// An irregular boulder cluster. Rocks are solid cover; the biggest ones are
// tall enough to wall run along.
const ROCKS = [];
const BOULDERS = [];
function boulder(x, z, w, h, d, mossy = rand() > 0.45, rot = rnd(-0.4, 0.4)) {
  block(x, z, w, d, h, mossy ? C.rockMoss : C.rock, mossy ? C.rockMossTop : C.rockTop);
  BOULDERS.push({ x, y: h, z, w, h, d, rot, mossy });
}

function rockCluster(cx, cz, count, scale = 1) {
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = rnd(0, 5 * scale);
    const w = rnd(1.4, 3.4) * scale;
    const h = rnd(0.9, 3.2) * scale;
    boulder(cx + Math.cos(a) * r, cz + Math.sin(a) * r, w, h, w * rnd(0.7, 1.2));
  }
}

// Trees: the trunk is solid (cover + something to wall kick off), the canopy is
// drawn as instanced geometry by world.js.
const TREES = [];
function tree(x, z, baseY = 0, kind = rand() > 0.62 ? 'pine' : 'broad') {
  const h = kind === 'pine' ? rnd(7, 12) : rnd(5.5, 9);
  const trunkW = rnd(0.75, 1.15);
  block(x, z, trunkW, trunkW, h * 0.62, C.bark, C.barkTop);
  TREES.push({
    x, z, baseY,
    h,
    trunkW,
    kind,
    radius: kind === 'pine' ? h * 0.25 : h * 0.38,
    tint: pick([C.leafA, C.leafB, C.leafC]),
  });
}

// ---------------------------------------------------------------- terrains
// Central hill — the landmark you can see from anywhere on the map.
const HILL = { cx: 0, cz: 0, radius: 30, height: 11 };
hill(HILL.cx, HILL.cz, HILL.radius, HILL.height, 0.42, C.grass, C.grassTop);
// flat crown with a ring of standing stones and a lone tree, so the top is a
// place to fight rather than a spike
slab(0, 0, 14, 14, 11.05, 0.3, C.grass, C.grassTop);
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  const x = Math.cos(a) * 5.2;
  const z = Math.sin(a) * 5.2;
  block(x, z, 1.1, 1.1, 11.05 + rnd(1.6, 2.6), C.stone, C.stoneTop);
}
tree(0, -1.5, 11.05, 'pine');

// Four outer mesas with a walkable shoulder ramp facing the middle.
const MESAS = [
  { x: -72, z: -72 }, { x: 72, z: -72 }, { x: -72, z: 72 }, { x: 72, z: 72 },
];
for (const m of MESAS) {
  hill(m.x, m.z, 17, 8.5, 0.42, C.rockMoss, C.grassTop);
  // shoulder that slopes back toward the middle so you can run up
  const sx = Math.sign(m.x);
  const sz = Math.sign(m.z);
  hill(m.x - sx * 12, m.z - sz * 12, 9, 5.2, 0.42, C.grass, C.grassTop);
  // trees and boulders on top
  for (let i = 0; i < 3; i++) tree(m.x + rnd(-6, 6), m.z + rnd(-6, 6), 8.5);
  rockCluster(m.x, m.z, 3, 0.9);
}

// ---------------------------------------------------------------- ridges
// Long mossy rock walls: the wall-running highways of the map. Each has a
// stair-like break at one end so you can get on top of it.
const RIDGES = [
  { x: 0, z: -46, w: 54, d: 3.2, h: 9 },
  { x: 0, z: 46, w: 54, d: 3.2, h: 9 },
  { x: -46, z: 0, w: 3.2, d: 54, h: 9 },
  { x: 46, z: 0, w: 3.2, d: 54, h: 9 },
  { x: -92, z: -34, w: 3.4, d: 40, h: 10 },
  { x: 92, z: 34, w: 3.4, d: 40, h: 10 },
  { x: -34, z: -92, w: 40, d: 3.4, h: 10 },
  { x: 34, z: 92, w: 40, d: 3.4, h: 10 },
  // the practice meadow's wall: a long cliff you can run the whole range along
  { x: 100, z: -26, w: 3.4, d: 44, h: 10 },
];
for (const r of RIDGES) {
  block(r.x, r.z, r.w, r.d, r.h, C.cliff, C.rockMossTop);
  // broken, uneven crest so it does not read as a wall of concrete
  const long = r.w > r.d;
  const len = long ? r.w : r.d;
  for (let i = 0; i < 5; i++) {
    const off = rnd(-len / 2 + 3, len / 2 - 3);
    const w = rnd(2.5, 6);
    const h = rnd(0.6, 2.2);
    box(
      r.x + (long ? off : 0), r.h + h / 2, r.z + (long ? 0 : off),
      long ? w : r.w * rnd(0.8, 1.15), h, long ? r.d * rnd(0.8, 1.15) : w,
      C.rockMoss, C.rockMossTop
    );
  }
  // a ramp of boulders piled at one end
  const ex = r.x + (long ? r.w / 2 + 2 : 0);
  const ez = r.z + (long ? 0 : r.d / 2 + 2);
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    boulder(ex + (long ? t * 6 : 0), ez + (long ? 0 : t * 6), 4.4, r.h * t, 4.4, true);
  }
}

// ---------------------------------------------------------------- fallen logs
// Long trunks lying across the meadow: low cover you can also wall run along.
const LOGS = [
  { x: -22, z: 26, len: 16, rot: 0 },
  { x: 26, z: -22, len: 16, rot: 0 },
  { x: -26, z: -30, len: 14, rot: Math.PI / 2 },
  { x: 34, z: 30, len: 14, rot: Math.PI / 2 },
  { x: 58, z: -52, len: 18, rot: 0.5 },
  { x: -62, z: 62, len: 18, rot: -0.5 },
];
for (const l of LOGS) {
  const alongX = Math.abs(Math.cos(l.rot)) > Math.abs(Math.sin(l.rot));
  // collision approximation: a 1.5 m box with its top at 1.9 m
  block(l.x, l.z, alongX ? l.len : 1.5, alongX ? 1.5 : l.len, 1.9, C.log, C.logTop);
  l.alongX = alongX;
}

// ---------------------------------------------------------------- the lake
// A shallow lake in the north-west: water is drawn by world.js, the shoreline is
// sand and wet stones.
const LAKE = { x: -58, z: 54, r: 20 };
slab(LAKE.x, LAKE.z, LAKE.r * 2, LAKE.r * 2, 0.06, 0.12, C.sand, C.sandTop);
for (let i = 0; i < 22; i++) {
  const a = (i / 22) * Math.PI * 2;
  const r = LAKE.r * rnd(0.92, 1.12);
  const x = LAKE.x + Math.cos(a) * r;
  const z = LAKE.z + Math.sin(a) * r;
  if (inClearing(x, z, 6)) continue;
  boulder(x, z, rnd(0.9, 2.4), rnd(0.5, 1.5), rnd(0.9, 2.4), rand() > 0.5);
}
// a little island with a tree in the middle of the lake
slab(LAKE.x + 5, LAKE.z - 4, 9, 9, 0.35, 0.7, C.sand, C.sandTop);
tree(LAKE.x + 5, LAKE.z - 4, 0.35, 'broad');

// ---------------------------------------------------------------- trails
trail([[-96, 0], [-60, 8], [-34, 14], [-14, 8], [0, 12]], 3.4);
trail([[96, 0], [60, -8], [34, -14], [14, -8]], 3.4);
trail([[0, -96], [-6, -60], [-2, -34]], 3.2);
trail([[0, 96], [8, 60], [4, 34]], 3.2);
trail([[-58, 34], [-58, 74]], 3);

// ---------------------------------------------------------------- scattered
// Trees and rocks across the meadow. A Poisson-ish rejection pass keeps a
// little breathing room around each trunk so nothing feels stuffed together.
const placed = [];
const tooClose = (x, z, min) => placed.some((p) => (p[0] - x) ** 2 + (p[1] - z) ** 2 < min * min);

function sculpt() {
  // tree clusters: a handful of seeds, then trees scattered around each
  const clusters = [
    [-88, 20], [-40, -50], [20, -60], [58, 8], [86, -84],
    [-20, 70], [40, 62], [90, 70], [-92, -14], [-30, 96],
  ];
  for (const [cx, cz] of clusters) {
    const n = Math.round(rnd(3, 6));
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = rnd(2, 24);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (Math.hypot(x, z) < HILL.radius + 4) continue;      // keep the hill open
      if (Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4) continue;
      if (inClearing(x, z, 3)) continue;
      if (onRim(x, z) || inIndustrial(x, z, 6)) continue;
      if (tooClose(x, z, 2.7)) continue;
      placed.push([x, z]);
      tree(x, z);
    }
  }
  // lone trees in the open, for cover away from the clusters
  for (let i = 0; i < 12; i++) {
    const x = rnd(-HALF + 8, HALF - 8);
    const z = rnd(-HALF + 8, HALF - 8);
    if (Math.hypot(x, z) < HILL.radius + 6) continue;
    if (inClearing(x, z, 3)) continue;
    if (onRim(x, z) || inIndustrial(x, z, 6)) continue;
    if (tooClose(x, z, 3.2)) continue;
    if (Math.abs(x) < 50 && Math.abs(z) < 50 && rand() > 0.35) continue;
    if (Math.abs(x - LAKE.x) < LAKE.r + 3 && Math.abs(z - LAKE.z) < LAKE.r + 3) continue;
    placed.push([x, z]);
    tree(x, z);
  }
  // rock piles
  for (let i = 0; i < 16; i++) {
    const x = rnd(-HALF + 10, HALF - 10);
    const z = rnd(-HALF + 10, HALF - 10);
    if (Math.hypot(x, z) < HILL.radius + 8) continue;
    if (inClearing(x, z, 4)) continue;
    if (onRim(x, z) || inIndustrial(x, z, 6)) continue;
    if (tooClose(x, z, 4.5)) continue;
    placed.push([x, z]);
    rockCluster(x, z, Math.round(rnd(2, 4)), rnd(0.8, 1.3));
  }
}
sculpt();

// a ring of trees around the FOOT of the central hill: the terraces themselves
// stay clear so you can run up it from any direction
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2 + rnd(-0.12, 0.12);
  const r = HILL.radius * rnd(1.0, 1.18);
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  // leave the four cardinal run-ups to the hill open
  if (Math.abs(x) < 9 || Math.abs(z) < 9) continue;
  if (tooClose(x, z, 2.4)) continue;
  placed.push([x, z]);
  tree(x, z, 0);
}

// Low cover in the open field: single boulders that break sightlines without
// becoming walls you cannot route around.
for (let i = 0; i < 18; i++) {
  const x = rnd(-HALF + 12, HALF - 12);
  const z = rnd(-HALF + 12, HALF - 12);
  if (Math.hypot(x, z) < HILL.radius + 5) continue;
  if (inClearing(x, z, 3)) continue;
  if (onRim(x, z) || inIndustrial(x, z, 8)) continue;
  if (tooClose(x, z, 3.4)) continue;
  placed.push([x, z]);
  const w = rnd(1.6, 3);
  boulder(x, z, w, rnd(1.3, 3.2), w * rnd(0.7, 1.2));
}

// ---------------------------------------------------------------- mounds
// Small grassy knolls: knee-to-chest-high bumps you can walk over, hide behind
// and launch off. They break the meadow into readable pockets without ever
// becoming a wall you cannot get around.
for (let i = 0; i < 14; i++) {
  const x = rnd(-HALF + 16, HALF - 16);
  const z = rnd(-HALF + 16, HALF - 16);
  if (Math.hypot(x, z) < HILL.radius + 10) continue;
  if (inClearing(x, z, 6)) continue;
  if (onRim(x, z) || inIndustrial(x, z, 6)) continue;
  if (tooClose(x, z, 5)) continue;
  if (Math.abs(x - LAKE.x) < LAKE.r + 6 && Math.abs(z - LAKE.z) < LAKE.r + 6) continue;
  placed.push([x, z]);
  const h = rnd(0.9, 2.6);
  const r = rnd(3.2, 7.5);
  hill(x, z, r, h, 0.44, C.grass, C.grassTop, 0.5);
  if (rand() > 0.4) tree(x + rnd(-r * 0.5, r * 0.5), z + rnd(-r * 0.5, r * 0.5), h);
}

// ---------------------------------------------------------------- meadow
// Thin patches of lighter and darker grass so the meadow is not one flat green,
// plus a few bare-earth scars where the ground has worn through.
const patches = [];
for (let i = 0; i < 150; i++) {
  const x = rnd(-HALF + 8, HALF - 8);
  const z = rnd(-HALF + 8, HALF - 8);
  if (inClearing(x, z, 2)) continue;
  const w = rnd(4, 16);
  const d = rnd(4, 16);
  const light = rand() > 0.5;
  if (onRim(x, z) || inIndustrial(x, z, 8)) continue;
  box(x, 0.02, z, w, 0.06, d,
    light ? C.grassDark : C.grass,
    light ? C.grassDarkTop : C.grassTop);
  patches.push([x, z, w, d]);
}
for (let i = 0; i < 16; i++) {
  const x = rnd(-HALF + 20, HALF - 20);
  const z = rnd(-HALF + 20, HALF - 20);
  if (Math.hypot(x, z) < HILL.radius + 6) continue;
  box(x, 0.03, z, rnd(3, 8), 0.07, rnd(3, 8), C.soil, C.pathTop);
}

// ---------------------------------------------------------------- the rim
// A flat square plate reads as a table, so the edge is broken up with rock
// shelves jutting out under the grass, cliff chunks hanging below, and a fringe
// of trees. Only the shelves at grass level are solid: the rest is silhouette.
const RIM_DECOR = [];
const inGate = (x, z) =>
  (Math.abs(x - HALF) < 14 && Math.abs(z) < 18)     // east gate -> yard
  || (Math.abs(x) < 18 && Math.abs(Math.abs(z) - HALF) < 14);  // island bridges
for (let i = 0; i < 96; i++) {
  const t = i / 96;
  const side = Math.floor(t * 4);
  const u = (t * 4 - side) * 2 - 1;              // -1..1 along the edge
  const along = u * (HALF - 2);
  const out = rnd(1.5, 6.5);
  const w = rnd(5, 16);
  const h = rnd(1.5, 5.5);
  const depth = rnd(3, 9);
  let x;
  let z;
  let sw;
  let sd;
  if (side === 0) { x = along; z = -HALF + out; sw = w; sd = depth; }
  else if (side === 1) { x = HALF - out; z = along; sw = depth; sd = w; }
  else if (side === 2) { x = along; z = HALF - out; sw = w; sd = depth; }
  else { x = -HALF + out; z = along; sw = depth; sd = w; }
  if (inGate(x, z)) continue;
  // grass shelf sticking out over the void (walk-on-able where it clears)
  if (rand() > 0.45) {
    box(x, -h / 2 + 0.02, z, sw, h, sd, C.rock, C.grassDarkTop);
    RIM_DECOR.push([x, -h / 2, z, sw, h, sd]);
  }
  // rock hanging below the shelf, breaking the straight silhouette
  box(x, -5 - rnd(0, 6), z, sw * rnd(0.6, 1.1), rnd(4, 9), sd * rnd(0.6, 1.1),
    C.rockDark, C.rock, false);
  // the odd tree right on the lip
  if (rand() > 0.72) {
    const tx = x + rnd(-2, 2);
    const tz = z + rnd(-2, 2);
    if (Math.abs(tx) < HALF - 1.5 && Math.abs(tz) < HALF - 1.5) tree(tx, tz, 0);
  }
}

// ---------------------------------------------------------------- woods
// Dense stands of trees with open meadow lanes between them: the woods are
// cover and silence, the lanes are where the movement happens.
const WOODS = [
  [-88, -18, 26], [-30, -84, 22], [26, -88, 20],
  [84, 30, 24], [16, 84, 22], [-84, 78, 24],
  [56, 4, 16], [-58, -46, 18],
];
for (const [cx, cz, r] of WOODS) {
  for (let i = 0; i < 11; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * r;
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (Math.abs(x) > HALF - 5 || Math.abs(z) > HALF - 5) continue;
    if (Math.hypot(x, z) < HILL.radius + 5) continue;
    if (inClearing(x, z, 4)) continue;
    if (onRim(x, z) || inIndustrial(x, z, 4)) continue;
    if (tooClose(x, z, 2.5)) continue;
    placed.push([x, z]);
    tree(x, z, 0);
    if (rand() > 0.55) {
      const bx = x + rnd(-3, 3);
      const bz = z + rnd(-3, 3);
      if (!tooClose(bx, bz, 1.6)) {
        placed.push([bx, bz]);
        boulder(bx, bz, rnd(0.9, 2), rnd(0.4, 1.1), rnd(0.9, 2), rand() > 0.4);
      }
    }
  }
}

// ---------------------------------------------------------------- sky islands
// Two satellite islands reachable with a good wall kick out near the rim.
const ISLANDS = [];
for (const sz of [-1, 1]) {
  const cz = sz * 150;
  slab(0, cz, 26, 26, 0, 4, C.rock, C.grassTop);
  box(0, -5, cz, 22, 8, 22, C.rockDark, C.rock, false);
  for (let i = 0; i < 5; i++) tree(rnd(-9, 9), cz + rnd(-9, 9), 0);
  rockCluster(0, cz, 3, 0.9);
  // stub of rock pointing back at the plateau: the jump-off point
  slab(0, sz * 136, 8, 10, 0, 1.2, C.rock, C.rockTop);
  // a rock parapet around the island: the bridge is the only way on or off
  box(0, 3.2, cz + sz * 13.5, 28, 6.4, 3.2, C.cliffWall, C.cliffWallTop);
  for (const s of [-1, 1]) {
    box(s * 13.5, 3.2, cz, 3.2, 6.4, 28, C.cliffWall, C.cliffWallTop);
    box(s * 8, 3.2, cz - sz * 13.5, 12, 6.4, 3.2, C.cliffWall, C.cliffWallTop);
  }
  ISLANDS.push({ x: 0, z: cz, r: 15 });
}

// ---------------------------------------------------------------- barriers
// Nobody falls into the void any more: a ring of rock cliffs walls the plateau
// in, with three gates — one east to the industrial annex, one north and one
// south to the sky islands.
const BARRIER = { h: 17, t: 9, at: HALF - 5 };
const barriers = [];

function cliffSeg(x, z, w, d, h) {
  box(x, h / 2, z, w, h, d, C.cliffWall, C.cliffWallTop);
  // jagged crest so it reads as rock, not a fence
  const long = w > d;
  const len = long ? w : d;
  const n = Math.max(2, Math.round(len / 9));
  for (let i = 0; i < n; i++) {
    const off = -len / 2 + (i + 0.5) * (len / n) + rnd(-1.5, 1.5);
    const cw = rnd(3, 8);
    const ch = rnd(1.2, 4.5);
    box(
      x + (long ? off : rnd(-1, 1)), h + ch / 2, z + (long ? rnd(-1, 1) : off),
      long ? cw : w * rnd(0.75, 1.05), ch, long ? d * rnd(0.75, 1.05) : cw,
      C.cliffWall, C.cliffWallTop
    );
  }
  barriers.push([x, z, w, d, h]);
}

// east side (with the annex gate in the middle)
cliffSeg(BARRIER.at, -68, BARRIER.t, 88, BARRIER.h);
cliffSeg(BARRIER.at, 68, BARRIER.t, 88, BARRIER.h);
// west side, solid
cliffSeg(-BARRIER.at, 0, BARRIER.t, 224, BARRIER.h);
// north + south sides, split around the island gates
for (const sz of [-1, 1]) {
  cliffSeg(-66, sz * BARRIER.at, 92, BARRIER.t, BARRIER.h);
  cliffSeg(66, sz * BARRIER.at, 92, BARRIER.t, BARRIER.h);
}
// corner peaks
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    cliffSeg(sx * (BARRIER.at + 2), sz * (BARRIER.at + 2), 18, 18, BARRIER.h + 5);
  }
}

// Gates: rock piers and a lintel, plus stone bridges out to the sky islands so
// those are reachable on foot instead of only by falling.
for (const sz of [-1, 1]) {
  for (const s of [-1, 1]) {
    cliffSeg(s * 10, sz * (BARRIER.at), 9, BARRIER.t + 2, BARRIER.h - 3);
  }
  // bridge deck through the gate out to the island
  slab(0, sz * ((BARRIER.at + 4 + 150) / 2), 9, 150 - BARRIER.at - 4, 0, 1.6, C.stone, C.stoneTop);
  for (const s of [-1, 1]) {
    box(s * 4.6, 0.55, sz * ((BARRIER.at + 4 + 150) / 2), 0.7, 1.1, 150 - BARRIER.at - 4, C.stone, C.stoneTop);
  }
}

// east gate piers, framing the causeway
for (const s of [-1, 1]) {
  cliffSeg(BARRIER.at, s * 12, BARRIER.t + 4, 9, BARRIER.h);
}

// ---------------------------------------------------------------- industrial
// The annex: a refinery yard bolted onto the east side of the plateau, reached
// by a causeway through the east gate. Not carved out of the forest — it is an
// addition beyond the cliff wall.
const P = { tanks: [], pipes: [], lamps: [], cranes: [] };

function lamp(x, z, y = 6.4) {
  box(x, y / 2, z, 0.34, y, 0.34, C.steel, C.steelTop);
  P.lamps.push({ x, y: y + 0.25, z });
}

// --- yard floor: steel deck raised a little above the plateau
const YARD = { cx: 166, cz: 0, w: 76, d: 124, top: 0.35 };
box(YARD.cx, YARD.top - 1.6, YARD.cz, YARD.w, 3.2, YARD.d, C.steelDark, C.concreteTop);
// hazard stripe down the middle of the yard
for (let i = 0; i < 14; i++) {
  box(YARD.cx, YARD.top + 0.01, -56 + i * 8.4, 5, 0.06, 4.2, C.hazard, C.hazardTop);
}
// apron / road from the gate to the yard
box(120, -1.5, 0, 20, 3, 26, C.steelDark, C.concreteTop);
for (let i = 0; i < 5; i++) {
  box(112 + i * 4, 0.02, 0, 2, 0.06, 24, C.hazard, C.hazardTop);
}
// rails either side of the causeway
for (const s of [-1, 1]) {
  box(121, 0.6, s * 13, 26, 1.2, 1.2, C.steel, C.steelTop);
}

// --- perimeter walls around the yard (with the west gate left open)
const YW = 12;
box(YARD.cx, YW / 2, -60, YARD.w, YW, 4, C.steel, C.steelTop);
box(YARD.cx, YW / 2, 60, YARD.w, YW, 4, C.steel, C.steelTop);
box(202, YW / 2, 0, 4, YW, YARD.d, C.steel, C.steelTop);
for (const s of [-1, 1]) {
  box(130, YW / 2, s * 46, 4, YW, 36, C.steel, C.steelTop);
}
// gate towers
for (const s of [-1, 1]) {
  box(130, 9 / 2, s * 17, 6, 9, 6, C.steel, C.steelTop);
  box(130, 9.6, s * 17, 7, 1, 7, C.hazard, C.hazardTop);
  P.lamps.push({ x: 130, y: 8.2, z: s * 13 });
}

// --- warehouses: solid boxes with parapets, roof access and interior cover
function shed(cx, cz, w, d, h, openFace = 'w') {
  box(cx, h / 2, cz, w, h, d, C.steel, C.steelTop);
  // roof slab + lip
  box(cx, h + 0.35, cz, w + 1.4, 0.7, d + 1.4, C.steelDark, C.steelTop);
  const lip = 0.9;
  box(cx, h + 0.35 + lip / 2, cz - d / 2, w + 1.4, lip, 0.6, C.steel, C.steelTop);
  box(cx, h + 0.35 + lip / 2, cz + d / 2, w + 1.4, lip, 0.6, C.steel, C.steelTop);
  box(cx - w / 2, h + 0.35 + lip / 2, cz, 0.6, lip, d + 1.4, C.steel, C.steelTop);
  box(cx + w / 2, h + 0.35 + lip / 2, cz, 0.6, lip, d + 1.4, C.steel, C.steelTop);
  // roof clutter
  box(cx + w * 0.2, h + 1.4, cz - d * 0.2, 4, 1.6, 3, C.steelDark, C.rustTop);
  box(cx - w * 0.24, h + 1.5, cz + d * 0.2, 2.6, 1.8, 2.6, C.rust, C.rustTop);
  // a steel staircase up the outside so the roof is part of the movement space
  const side = openFace === 'e' ? -1 : 1;
  stairsUp(cx + side * (w / 2), cz, side > 0 ? 'w' : 'e', 6, h + 0.35, 0.5, C.steelDark, C.concreteTop);
  return { cx, cz, w, d, h };
}

const SHEDS = [
  shed(152, -42, 30, 26, 10, 'e'),
  shed(152, 42, 30, 26, 10, 'e'),
  shed(186, -22, 22, 34, 13, 'w'),
  shed(186, 30, 22, 26, 9, 'w'),
];

// --- pipe racks: long runs you can run along, and cover at head height
function pipeRun(x, z, len, axis, y, r = 0.55) {
  const w = axis === 'x' ? len : r * 2;
  const d = axis === 'x' ? r * 2 : len;
  box(x, y, z, w, r * 2, d, C.pipe, C.pipeTop);
  P.pipes.push({ x, y, z, len, axis, r });
}
for (const z of [-22, -18, 18, 22]) {
  pipeRun(166, z, 56, 'x', 6.2, 0.5);
  pipeRun(166, z, 56, 'x', 7.4, 0.42);
  // legs
  for (const x of [142, 158, 174, 190]) {
    box(x, 3.4, z + (z < 0 ? 1.4 : -1.4), 0.5, 6.8, 0.5, C.steel, C.steelTop);
  }
}
pipeRun(140, 0, 22, 'z', 5.2, 0.6);

// --- storage tanks
function tank(x, z, r, h) {
  box(x, h / 2, z, r * 1.8, h, r * 1.8, C.steel, C.steelTop);
  box(x, h + 0.5, z, r * 1.5, 1, r * 1.5, C.rust, C.rustTop);
  P.tanks.push({ x, z, r, h });
  // a steel stair up the side so you can reach the tank top
  stairsUp(x + r * 0.92, z, 'w', 4, h + 0.5, 0.5, C.steelDark, C.concreteTop);
}
tank(178, -52, 6, 9);
tank(192, -50, 6, 9);
tank(178, 52, 6, 9);
tank(192, 52, 6, 9);
tank(196, 6, 4.5, 7);

// --- container stacks: the main cover in the yard, climbable, colourful
const CONTAINERS = [
  [144, -6, 0], [144, -6, 1], [144, 6, 0], [150, 12, 0], [160, -8, 0],
  [160, -8, 1], [160, 8, 0], [172, 14, 0], [172, 14, 1], [176, -12, 0],
  [186, 12, 0], [188, 44, 0], [188, 44, 1], [140, 30, 0], [140, -30, 0],
  [196, -10, 0], [196, -34, 0], [168, 34, 0], [168, 34, 1], [148, -20, 0],
];
const BOX_COLORS = [C.containerA, C.containerB, C.containerC, C.containerD];
CONTAINERS.forEach(([x, z, level], i) => {
  const y = YARD.top + 1.3 + level * 2.7;
  const c = BOX_COLORS[i % BOX_COLORS.length];
  box(x, y, z, 12, 2.6, 2.8, c, c === C.containerA ? C.steelTop : C.rustTop);
});

// --- gantry crane: the landmark you see from the forest
function gantry(cx, cz, span, height) {
  for (const s of [-1, 1]) {
    box(cx, YARD.top + height / 2, cz + s * span / 2, 1.6, height, 1.6, C.hazard, C.hazardTop);
    box(cx, YARD.top + 1, cz + s * span / 2, 4, 2, 4, C.steelDark, C.steelTop);
  }
  box(cx, YARD.top + height, cz, 3.2, 2.4, span + 2, C.steel, C.steelTop);
  box(cx, YARD.top + height - 1.6, cz, 1.2, 1.2, span * 0.6, C.hazard, C.hazardTop);
  // operator cab
  box(cx, YARD.top + height - 3, cz - 4, 4, 3, 4, C.steelDark, C.glass);
  P.cranes.push({ x: cx, y: YARD.top + height, z: cz, span, height });
}
gantry(166, 0, 44, 19);

// --- catwalk ring above the yard, linking the shed roofs
for (const sz of [-1, 1]) {
  slab(172, sz * 30, 46, 3.4, 10.6, 0.6, C.steel, C.steelTop);
  for (const s of [-1, 1]) {
    box(172 + s * 23, 11.3, sz * 30, 0.3, 1.4, 3.4, C.hazard, C.hazardTop);
  }
  for (const x of [150, 166, 182, 194]) {
    box(x, 5.3, sz * 30, 0.6, 10.6, 0.6, C.steel, C.steelTop);
  }
}
slab(196, 0, 3.4, 60, 10.6, 0.6, C.steel, C.steelTop);

// --- yard lamps
for (const [x, z] of [[138, -56], [138, 56], [150, 0], [176, 0], [198, -56], [198, 56], [166, -46], [166, 46]]) {
  lamp(x, z, 8);
}

// ---------------------------------------------------------------- spawn tidy
// Nothing may sit on a spawn point: clear a small circle around each one.
const SPAWN_XY = [
  [92, 0], [-92, 0], [0, 92], [0, -92],
  [50, 60], [-50, 58], [60, -50], [-50, -58],
  [104, -40], [-103, 40], [40, -104], [-40, 104],
  [100, 96], [-100, -96],
  // industrial yard
  [146, 0], [160, 20], [186, -44], [196, 22], [152, -56],
];
function clearAround(cx, cz, r) {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (b.solid === false) continue;
    const halfX = b.s[0] / 2;
    const halfZ = b.s[2] / 2;
    // keep the ground plate, trails and flat patches, and the big terraces
    if (b.s[1] <= 0.3) continue;
    if (Math.max(b.s[0], b.s[2]) > 30) continue;
    const nearestX = Math.max(b.p[0] - halfX, Math.min(cx, b.p[0] + halfX));
    const nearestZ = Math.max(b.p[2] - halfZ, Math.min(cz, b.p[2] + halfZ));
    if (Math.hypot(nearestX - cx, nearestZ - cz) < r) boxes.splice(i, 1);
  }
  for (let i = TREES.length - 1; i >= 0; i--) {
    const t = TREES[i];
    if (Math.hypot(t.x - cx, t.z - cz) < r + 1) TREES.splice(i, 1);
  }
}
for (const [x, z] of SPAWN_XY) clearAround(x, z, 3.2);
// boulders whose box was just removed should not be drawn either
{
  const alive = new Set(boxes);
  for (let i = BOULDERS.length - 1; i >= 0; i--) {
    const b = BOULDERS[i];
    const kept = boxes.some((bx) => Math.abs(bx.p[0] - b.x) < 1e-6 && Math.abs(bx.p[2] - b.z) < 1e-6 && Math.abs(bx.s[1] - b.h) < 1e-6);
    if (!kept || !alive.size) BOULDERS.splice(i, 1);
  }
}

// ---------------------------------------------------------------- spawns
// Ground-level spawn points, verified clear of geometry by tests/map.test.mjs.
// yaw faces the middle of the map.
export const SPAWNS = [
  [92, 0], [-92, 0], [0, 92], [0, -92],
  [50, 60], [-50, 58], [60, -50], [-50, -58],
  [104, -40], [-103, 40], [40, -104], [-40, 104],
  [100, 96], [-100, -96],
  // industrial yard
  [146, 0], [160, 20], [186, -44], [196, 22], [152, -56],
].map(([x, z]) => ({ pos: [x, GROUND + 0.05, z], yaw: Math.atan2(x, z) }));

// Sit every spawn exactly on whatever surface is under it (the meadow, a trail
// slab, a terrace), so nobody spawns inside the ground.
for (const s of SPAWNS) {
  const [x, , z] = s.pos;
  let top = GROUND;
  for (const b of boxes) {
    if (b.solid === false) continue;
    const minX = b.p[0] - b.s[0] / 2;
    const maxX = b.p[0] + b.s[0] / 2;
    const minZ = b.p[2] - b.s[2] / 2;
    const maxZ = b.p[2] + b.s[2] / 2;
    const boxTop = b.p[1] + b.s[1] / 2;
    if (x > minX && x < maxX && z > minZ && z < maxZ && boxTop <= 1 && boxTop > top) top = boxTop;
  }
  s.pos[1] = top + 0.05;
}

// The practice range: a clear meadow lane on the east side of the plateau.
export const PRACTICE = {
  spawn: [90, GROUND + 0.05, -48],
  yaw: Math.PI,                       // looking down +z, up the meadow
  wallRunSpot: [97.3, GROUND + 0.05, -30], // beside the meadow cliff
};

export const ARENA = {
  boxes,
  spawns: SPAWNS,
  size: MAP_SIZE,                 // the forest plateau
  bounds: {                       // everything, including the industrial annex
    minX: -HALF,
    maxX: IND.x1,
    minZ: -HALF,
    maxZ: HALF,
  },
  industrial: {
    ...IND,
    yard: YARD,
    sheds: SHEDS,
    center: [YARD.cx, YARD.cz],
  },
  props: P,
  barriers,
  barrier: BARRIER,
  killY: -48,
  trees: TREES,
  boulders: BOULDERS,
  logs: LOGS,
  ridges: RIDGES,
  lake: LAKE,
  islands: ISLANDS,
  hill: HILL,
  clearings: CLEARINGS,
  patches,
  woods: WOODS,
  sky: {
    top: 0x2f7bc4,
    horizon: 0xbfd9ea,
    fog: 0xc3d8e4,
    sun: 0xfff0d2,
    ground: 0x4d6b3c,
  },
};

export default ARENA;

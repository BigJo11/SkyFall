// The SkyFall arena: a large floating citadel built for fast, vertical movement.
//
// Boxes are axis aligned:  p = centre [x,y,z],  s = size [w,h,d]
// `c` is the side colour, `ct` the (lighter) top colour, `solid:false` marks
// purely decorative geometry that nothing collides with.
//
// Layout (top view, +x right, +z toward the viewer):
//
//        ┌───────────────── outer ring walls ─────────────────┐
//        │   quadrant      quadrant        quadrant      ...  │
//        │  buildings      buildings       buildings          │
//        │        ┌──── central keep, stairs on all sides ───┐ │
//        │        │   rooftop catwalks across the gaps        │ │
//        │        └───────────────────────────────────────────┘ │
//        └─────────────────────────────────────────────────────┘
//
// Everything is spaced so there is always a wall within ~6 m to run on, and so
// no sight line runs unbroken across the whole plate.

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

// Staircase from the ground up to `top`, walking away from the structure it
// serves. dir: 'n' (-z), 's' (+z), 'e' (+x), 'w' (-x).
// `x,z` is where the *bottom* of the stairs starts.
function stairs(x, z, dir, width, top, rise = 0.45) {
  const steps = Math.ceil(top / rise);
  const actualRise = top / steps;
  const run = 0.82;
  for (let i = 0; i < steps; i++) {
    // step heights rise TOWARD the structure: the first box you meet walking in
    // must be the lowest one, otherwise the staircase is just a wall.
    const h = actualRise * (i + 1);
    const mid = run * (steps - i - 0.5);
    if (dir === 'n') box(x, h / 2, z - mid, width, h, run, C.deck, C.deckTop);
    else if (dir === 's') box(x, h / 2, z + mid, width, h, run, C.deck, C.deckTop);
    else if (dir === 'e') box(x + mid, h / 2, z, run, h, width, C.deck, C.deckTop);
    else box(x - mid, h / 2, z, run, h, width, C.deck, C.deckTop);
  }
}

// ---------------------------------------------------------------- palette
const C = {
  rock: 0x2b3550,
  rockTop: 0x4a5f85,
  deck: 0x36435e,
  deckTop: 0x536a92,
  tower: 0x2f3b54,
  towerTop: 0x5d76a2,
  keep: 0x38455f,
  keepTop: 0x64789c,
  crate: 0x8a5a34,
  crateTop: 0xa97448,
  metal: 0x3b4659,
  metalTop: 0x66738c,
  accent: 0xb8642f,
  accentTop: 0xd98a48,
  island: 0x2a3348,
  islandTop: 0x455a7a,
  dark: 0x232c40,
  darkTop: 0x37445f,
};

const HALF = 75;          // half the plate width
const GROUND = 0;

// ---------------------------------------------------------------- main plate
box(0, -1.5, 0, HALF * 2, 3, HALF * 2, C.rock, C.rockTop);
// bevelled lip so the edge reads clearly
for (const s of [-1, 1]) {
  box(0, -0.15, s * HALF, HALF * 2, 0.3, 0.6, C.metal, C.metalTop);
  box(s * HALF, -0.15, 0, 0.6, 0.3, HALF * 2, C.metal, C.metalTop);
}

// ---------------------------------------------------------------- central keep
const KEEP = { w: 30, d: 30, top: 9 };
block(0, 0, KEEP.w, KEEP.d, KEEP.top, C.keep, C.keepTop);

// stairs on all four sides, starting 15 m out and climbing inward
const keepStairTop = KEEP.top;
stairs(0, -15.5, 'n', 7, keepStairTop);
stairs(0, 15.5, 's', 7, keepStairTop);
stairs(15.5, 0, 'e', 7, keepStairTop);
stairs(-15.5, 0, 'w', 7, keepStairTop);

// rooftop parapet with a gap where each staircase arrives
const PAR = { h: 1.15, t: 0.9 };
for (const s of [-1, 1]) {
  // north / south edges (gap in the middle for the stairs)
  box(0, KEEP.top + PAR.h / 2, s * 14.6, 21, PAR.h, PAR.t, C.metal, C.metalTop);
  // east / west edges
  box(s * 14.6, KEEP.top + PAR.h / 2, 0, PAR.t, PAR.h, 21, C.metal, C.metalTop);
  // corner blocks so the gaps read as doorways
  for (const t of [-1, 1]) {
    box(t * 13.2, KEEP.top + PAR.h / 2, s * 14.6, 3.6, PAR.h, PAR.t, C.metal, C.metalTop);
    box(s * 14.6, KEEP.top + PAR.h / 2, t * 13.2, PAR.t, PAR.h, 3.6, C.metal, C.metalTop);
  }
}

// rooftop cover + a couple of tall blocks to wall run between
block(-7, -7, 4, 4, KEEP.top + 1.6, C.crate, C.crateTop);
block(7, 7, 4, 4, KEEP.top + 1.6, C.crate, C.crateTop);
slab(7, -7, 5, 5, KEEP.top + 1.2, 1.2, C.metal, C.metalTop);
block(-7, 7, 3, 3, KEEP.top + 3.4, C.tower, C.towerTop);
box(0, KEEP.top + 0.6, 0, 6, 1.2, 6, C.accent, C.accentTop);

// ---------------------------------------------------------------- quadrants
const QUAD = { w: 20, d: 20, top: 8 };
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    const cx = sx * 42;
    const cz = sz * 42;
    block(cx, cz, QUAD.w, QUAD.d, QUAD.top, C.tower, C.towerTop);

    // parapet with an entrance gap facing the middle
    box(cx, QUAD.top + 0.5, cz + sz * 9.6, 17, 1.0, 0.8, C.metal, C.metalTop);
    box(cx + sx * 9.6, QUAD.top + 0.5, cz, 0.8, 1.0, 17, C.metal, C.metalTop);
    box(cx, QUAD.top + 0.5, cz - sz * 9.6, 13, 1.0, 0.8, C.metal, C.metalTop);
    box(cx - sx * 9.6, QUAD.top + 0.5, cz, 0.8, 1.0, 13, C.metal, C.metalTop);

    // staircase facing the centre on both inner faces
    stairs(cx - sx * 10.5, cz, sx > 0 ? 'w' : 'e', 5.5, QUAD.top);
    stairs(cx, cz - sz * 10.5, sz > 0 ? 'n' : 's', 5.5, QUAD.top);

    // rooftop cover
    block(cx + sx * 5, cz - sz * 5, 3.4, 3.4, QUAD.top + 1.4, C.crate, C.crateTop);
    block(cx - sx * 5, cz + sz * 5, 3.4, 3.4, QUAD.top + 1.4, C.crate, C.crateTop);
    // corner posts for silhouette + wall running
    box(cx + sx * 8.4, QUAD.top + 1.6, cz + sz * 8.4, 0.8, 3.2, 0.8, C.accent, C.accentTop);
    box(cx - sx * 8.4, QUAD.top + 1.6, cz - sz * 8.4, 0.8, 3.2, 0.8, C.accent, C.accentTop);
  }
}

// ---------------------------------------------------------------- catwalks
// Two bridges leave the keep roof toward the north and south quadrants, each
// with a deliberate gap you have to clear.
slab(22.5, -30, 15, 3, KEEP.top - 0.2, 0.6, C.metal, C.metalTop);   // keep -> gap
slab(13, -30, 4, 3, KEEP.top - 0.2, 0.6, C.metal, C.metalTop);
slab(22.5, 30, 15, 3, KEEP.top - 0.2, 0.6, C.metal, C.metalTop);
slab(13, 30, 4, 3, KEEP.top - 0.2, 0.6, C.metal, C.metalTop);
// support pylons under the catwalks
for (const sz of [-1, 1]) {
  block(20, sz * 30, 1.2, 1.2, KEEP.top - 0.4, C.metal, C.metalTop);
  block(28, sz * 30, 1.2, 1.2, KEEP.top - 0.4, C.metal, C.metalTop);
}

// ---------------------------------------------------------------- wallrun spokes
// Long, tall walls radiating from the keep. These are the main wall-running
// highways: jump on, run, wall kick across the lane to the opposite wall.
const SPOKE = { len: 26, h: 8, t: 1.4 };
for (const s of [-1, 1]) {
  // north / south lanes flanking the keep
  box(s * 20, SPOKE.h / 2, -46, SPOKE.t, SPOKE.h, SPOKE.len, C.tower, C.towerTop);
  box(s * 20, SPOKE.h / 2, 46, SPOKE.t, SPOKE.h, SPOKE.len, C.tower, C.towerTop);
  // east / west lanes
  box(46, SPOKE.h / 2, s * 20, SPOKE.len, SPOKE.h, SPOKE.t, C.tower, C.towerTop);
  box(-46, SPOKE.h / 2, s * 20, SPOKE.len, SPOKE.h, SPOKE.t, C.tower, C.towerTop);
}

// ---------------------------------------------------------------- outer ring
// A broken wall around the plate: cover from the outside lanes, and a long
// uninterrupted stretch to run along on each side.
const RING = { at: 66, h: 9, t: 1.6 };
for (const s of [-1, 1]) {
  box(s * RING.at, RING.h / 2, 0, RING.t, RING.h, 44, C.tower, C.towerTop);
  box(0, RING.h / 2, s * RING.at, 44, RING.h, RING.t, C.tower, C.towerTop);
  // shorter returns along the corners
  box(s * 52, RING.h / 2, s * 62, 26, RING.h, RING.t, C.tower, C.towerTop);
}
// buttress posts along the ring (breaks it into readable cover)
for (const s of [-1, 1]) {
  for (const t of [-1, 1]) {
    box(s * RING.at, RING.h / 2 + 0.6, t * 22.7, 2.2, RING.h + 1.2, 2.2, C.accent, C.accentTop);
    box(t * 22.7, RING.h / 2 + 0.6, s * RING.at, 2.2, RING.h + 1.2, 2.2, C.accent, C.accentTop);
  }
}

// ---------------------------------------------------------------- doorways
// Short perimeter walls that funnel movement and give low cover in the open.
const funnel = [
  [19, 9, 6, 1.2], [-19, -9, 6, 1.2],
  [9, 19, 1.2, 6], [-9, -19, 1.2, 6],
  [58, 34, 10, 1.2], [58, -34, 10, 1.2],
  [-58, 34, 10, 1.2], [-58, -34, 10, 1.2],
  [12, 58, 1.2, 10], [-12, 58, 1.2, 10],
  [12, -58, 1.2, 10], [-12, -58, 1.2, 10],
];
for (const [x, z, w, d] of funnel) {
  box(x, 1.6, z, w, 3.2, d, C.metal, C.metalTop);
}

// ---------------------------------------------------------------- cover
// Crates and low blocks spread through the open ground. Kept low so you can
// jump on them and use them as launch pads, and spread so nothing is a wall
// you cannot route around.
const crates = [
  [16, -22, 2.2], [-16, 22, 2.2], [22, 16, 2.2], [-22, -16, 2.2],
  [34, -8, 2.0], [-34, 8, 2.0], [8, 34, 2.0], [-8, -34, 2.0],
  [50, -34, 2.4], [-50, 34, 2.4], [34, 50, 2.4], [-34, -50, 2.4],
  [50, 34, 2.2], [-50, -34, 2.2], [-34, 50, 2.2], [34, -50, 2.2],
  [12, -52, 2.0], [-12, 52, 2.0], [52, -12, 2.0], [-52, 12, 2.0],
  [60, 10, 2.6], [-60, -10, 2.6], [10, 60, 2.6], [-10, -60, 2.6],
  [40, 20, 1.8], [-40, -20, 1.8], [20, -40, 1.8], [-20, 40, 1.8],
];
for (const [x, z, s] of crates) block(x, z, s, s, s, C.crate, C.crateTop);

// stacked doubles: jumpable, and tall enough to wall kick off
const stacks = [[30, -20], [-30, 20], [20, 30], [-20, -30], [44, -30], [-44, 30]];
for (const [x, z] of stacks) {
  block(x, z, 2.4, 2.4, 1.8, C.crate, C.crateTop);
  block(x, z, 1.8, 1.8, 3.4, C.crate, C.crateTop);
}

// tall cover pillars near the middle for close-quarters fights
// kept clear of the four keep staircases (they run along x=0 / z=0)
const pillars = [[11, 26], [11, -26], [-11, 26], [-11, -26],
  [26, 11], [26, -11], [-26, 11], [-26, -11]];
for (const [x, z] of pillars) block(x, z, 1.8, 1.8, 5.4, C.tower, C.towerTop);

// ---------------------------------------------------------------- sky islands
// Two outer islands beyond the plate: the last jump is a gap, so you need a
// double jump or a wall kick at speed to make them.
for (const sz of [-1, 1]) {
  const cz = sz * 94;
  slab(0, cz, 20, 20, 0, 3, C.island, C.islandTop);
  block(0, cz + sz * 6.5, 14, 1.4, 1.6, C.metal, C.metalTop);   // back wall
  block(-5.5, cz - sz * 2, 2.4, 2.4, 2.2, C.crate, C.crateTop);
  block(5.5, cz + sz * 2, 2.4, 2.4, 2.2, C.crate, C.crateTop);
  block(0, cz, 2.0, 6.0, 4.6, C.tower, C.towerTop);            // centre pillar
  // stub of bridge pointing back at the plate: the jump-off point
  slab(0, sz * 79, 6, 8, 0, 0.8, C.metal, C.metalTop);
}

// ---------------------------------------------------------------- scenery
// floating sky debris, far enough out that nobody can reach it
const debris = [
  [96, -10, 40, 16, 8, 16], [-104, -16, -44, 20, 10, 18], [40, -26, 104, 14, 7, 14],
  [-56, -30, 92, 18, 9, 16], [112, -36, -30, 22, 11, 20], [-30, -42, -110, 16, 8, 16],
  [18, 16, -104, 12, 5, 12], [-86, 10, 18, 11, 4, 11], [78, 12, 86, 15, 5, 15],
  [130, -6, 0, 26, 12, 24], [-130, -20, 70, 24, 11, 22],
];
for (const [x, y, z, w, h, d] of debris) {
  box(x, y, z, w, h, d, C.dark, C.darkTop, false);
}

// ---------------------------------------------------------------- spawns
// Ground-level spawn points, spread around the ring road and checked clear of
// geometry (tests/map.test.mjs asserts this). yaw faces the middle of the map.
export const SPAWNS = [
  [52, 0], [-52, 0], [0, 52], [0, -52],
  [28, 28], [-28, 28], [28, -28], [-28, -28],
  [58, -44], [-58, 44], [34, -58], [-34, 58],
].map(([x, z]) => ({ pos: [x, GROUND + 0.05, z], yaw: Math.atan2(x, z) }));

// The practice range firing line (see public/js/practice.js).
export const PRACTICE = {
  spawn: [60, GROUND + 0.05, -26],
  yaw: Math.PI,                       // looking down +z, down the ring road
  wallRunSpot: [64.4, GROUND + 0.05, -16], // beside the long eastern ring wall
};

export const ARENA = {
  boxes,
  spawns: SPAWNS,
  size: HALF * 2,
  killY: -40,
  sky: {
    top: 0x1b2a4a,
    horizon: 0x7f9ec4,
    fog: 0x8ba6c4,
    sun: 0xfff2d6,
  },
};

export default ARENA;

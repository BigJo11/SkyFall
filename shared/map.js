// The SkyFall arena. Pure data + small builder helpers so the Node server and
// the browser client can build an identical world from the same description.
//
// Boxes are axis aligned:  p = centre [x,y,z],  s = size [w,h,d]
// `c` is the side colour, `ct` the (lighter) top colour, `solid:false` marks
// purely decorative geometry that nothing collides with.

const boxes = [];

function box(x, y, z, w, h, d, c, ct = null, solid = true) {
  boxes.push({ p: [x, y, z], s: [w, h, d], c, ct, solid });
}

// ---------------------------------------------------------------- palette
const C = {
  rock: 0x2b3550,
  rockTop: 0x4a5f85,
  deck: 0x36435e,
  deckTop: 0x536a92,
  tower: 0x2f3b54,
  towerTop: 0x5d76a2,
  crate: 0x8a5a34,
  crateTop: 0xa97448,
  metal: 0x3b4659,
  metalTop: 0x66738c,
  accent: 0xb8642f,
  accentTop: 0xd98a48,
  island: 0x2a3348,
  islandTop: 0x455a7a,
};

// ---------------------------------------------------------------- main plate
box(0, -1.5, 0, 72, 3, 72, C.rock, C.rockTop);

// bevelled lip so the edge reads clearly from above
for (const s of [-1, 1]) {
  box(0, -0.15, s * 36, 72, 0.3, 0.6, C.metal, C.metalTop);
  box(s * 36, -0.15, 0, 0.6, 0.3, 72, C.metal, C.metalTop);
}

// ---------------------------------------------------------------- centre deck
const DECK_TOP = 2.8;
box(0, DECK_TOP - 0.3, 0, 20, 0.6, 20, C.deck, C.deckTop);
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    box(sx * 8.4, 1.1, sz * 8.4, 1.3, 2.2, 1.3, C.metal, C.metalTop);
  }
}
// railings on the deck corners (leave the stairs open)
for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
  box(sx * 9.6, DECK_TOP + 0.5, sz * 9.6, 0.5, 1.0, 0.5, C.accent, C.accentTop);
}

// stairs around the deck: 6 steps of 0.4m, 1m deep, 6m wide
for (let dir = 0; dir < 4; dir++) {
  for (let i = 0; i < 6; i++) {
    const top = 2.4 - 0.4 * i;
    const dist = 10.5 + i; // outward from the deck edge
    if (dir === 0) box(0, top / 2, dist, 6, top, 1, C.deck, C.deckTop);
    if (dir === 1) box(0, top / 2, -dist, 6, top, 1, C.deck, C.deckTop);
    if (dir === 2) box(dist, top / 2, 0, 1, top, 6, C.deck, C.deckTop);
    if (dir === 3) box(-dist, top / 2, 0, 1, top, 6, C.deck, C.deckTop);
  }
}

// ---------------------------------------------------------------- corner towers
const TOWER_TOP = 5.0;
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    const cx = sx * 26;
    const cz = sz * 26;
    box(cx, TOWER_TOP / 2, cz, 10, TOWER_TOP, 10, C.tower, C.towerTop);
    // corner posts for silhouette
    for (const ax of [-1, 1]) {
      for (const az of [-1, 1]) {
        box(cx + ax * 4.6, TOWER_TOP + 0.5, cz + az * 4.6, 0.6, 1.6, 0.6, C.accent, C.accentTop);
      }
    }
    // stairs climbing out of the tower toward the middle on both axes
    for (let i = 0; i < 12; i++) {
      const top = TOWER_TOP - 0.4 * (i + 1); // 4.6 ... 0.2
      const off = 5.5 + i * 0.85;
      const depth = 0.85;
      if (top <= 0) continue;
      // x-facing stair (toward centre in x), held inside the tower footprint in z
      box(cx - sx * off, top / 2, cz, depth, top, 3.2, C.tower, C.towerTop);
      // z-facing stair
      box(cx, top / 2, cz - sz * off, 3.2, top, depth, C.tower, C.towerTop);
    }
  }
}

// ---------------------------------------------------------------- cover
const crates = [
  [14, 0, 6, 2.2], [14, 0, -6, 2.2], [-14, 0, 6, 2.2], [-14, 0, -6, 2.2],
  [6, 0, 14, 2.2], [6, 0, -14, 2.2], [-6, 0, 14, 2.2], [-6, 0, -14, 2.2],
  [20, 0, 14, 1.6], [-20, 0, -14, 1.6], [20, 0, -14, 1.6], [-20, 0, 14, 1.6],
];
for (const [x, , z, s] of crates) {
  box(x, s / 2, z, s, s, s, C.crate, C.crateTop);
}

// long cover walls
box(24, 1.4, 0, 1.2, 2.8, 12, C.metal, C.metalTop);
box(-24, 1.4, 0, 1.2, 2.8, 12, C.metal, C.metalTop);
box(0, 1.4, 24, 12, 2.8, 1.2, C.metal, C.metalTop);
box(0, 1.4, -24, 12, 2.8, 1.2, C.metal, C.metalTop);

// tall sight-line breakers
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    box(sx * 33, 2.6, sz * 12, 1.6, 5.2, 1.6, C.tower, C.towerTop);
    box(sx * 12, 2.0, sz * 33, 1.6, 4.0, 1.6, C.tower, C.towerTop);
  }
}

// ---------------------------------------------------------------- sky islands
for (const sz of [-1, 1]) {
  const cz = sz * 47;
  box(0, -1.5, cz, 18, 3, 18, C.island, C.islandTop);
  box(0, 0.6, cz + sz * 6.5, 12, 1.2, 1.2, C.metal, C.metalTop); // back wall
  box(-3.2, 1.0, cz - sz * 1.0, 1.6, 2.0, 1.6, C.crate, C.crateTop);
  box(4.0, 1.0, cz + sz * 2.0, 1.6, 2.0, 1.6, C.crate, C.crateTop);
  // narrow bridge stub sticking out of the plate (the last jump is a gap)
  box(0, -0.4, sz * 35.2, 6, 0.8, 1.6, C.metal, C.metalTop);
}

// ---------------------------------------------------------------- scenery
// floating sky debris, far enough out that nobody can reach it
const debris = [
  [58, -8, 30, 12, 6, 12], [-62, -14, -34, 16, 8, 14], [30, -22, 66, 10, 5, 10],
  [-40, -26, 58, 14, 7, 12], [70, -30, -20, 18, 9, 16], [-24, -34, -70, 12, 6, 12],
  [12, 14, -62, 9, 4, 9], [-54, 8, 12, 8, 3, 8], [48, 10, 52, 11, 4, 11],
];
for (const [x, y, z, w, h, d] of debris) {
  boxes.push({ p: [x, y, z], s: [w, h, d], c: 0x232c40, ct: 0x37445f, solid: false });
}

// ---------------------------------------------------------------- spawns
// yaw is computed so every spawn looks at the middle of the arena.
export const SPAWNS = [
  [0, 33], [0, -33], [33, 0], [-33, 0],
  [17, 17], [-17, 17], [17, -17], [-17, -17],
  [0, 47], [0, -47],
].map(([x, z]) => ({ pos: [x, 0.05, z], yaw: Math.atan2(x, z) }));

export const ARENA = {
  boxes,
  spawns: SPAWNS,
  size: 72,
  killY: -30,
  sky: {
    top: 0x1b2a4a,
    horizon: 0x7f9ec4,
    fog: 0x8ba6c4,
    sun: 0xfff2d6,
  },
};

export default ARENA;

// Shared between the browser client and the Node server.
// Everything here must stay dependency-free and side-effect-free.

export const NET = {
  TICK_HZ: 20,            // server snapshots per second
  INPUT_HZ: 20,           // client position reports per second
  MAX_NAME: 16,
};

// ---------------------------------------------------------------- identity
// Some callsigns are reserved. Typing the crew code on the title screen unlocks
// them (and a glowing skin) for everybody in the lobby.
export const RESERVED = {
  code: '1013',
  // a reserved name is anything containing "big joe", however it is spelled:
  // "bigjoe", "b1g_joe", "BIG JOE 1013" ...
  isReserved(raw) {
    const s = String(raw ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/0/g, 'o')
      .replace(/1/g, 'i')
      .replace(/3/g, 'e')
      .replace(/4|@/g, 'a')
      .replace(/5|\$/g, 's')
      .replace(/7/g, 't');
    return s.includes('bigjoe');
  },
  normaliseCode(raw) {
    return String(raw ?? '').replace(/\D/g, '');
  },
};

// Skins: the crew glow colour and the palette used for everything else.
export const CREW_GLOW = 0xffd23f;


// --------------------------------------------------------------- cosmetics
// Primary + secondary colour and a body material. The two loud materials are
// crew-only: they are the visible reward for the 1013 access code.
export const COSMETIC = {
  primary: 0x62d6ff,
  secondary: 0x2a3346,

  palette: [
    { id: 'cyan', color: 0x62d6ff },
    { id: 'red', color: 0xff6b6b },
    { id: 'amber', color: 0xffd166 },
    { id: 'lime', color: 0x9dff6b },
    { id: 'violet', color: 0xc792ff },
    { id: 'teal', color: 0x64ffda },
    { id: 'orange', color: 0xff9f45 },
    { id: 'white', color: 0xf2f2f2 },
    { id: 'steel', color: 0x8d99ae },
    { id: 'navy', color: 0x2a3346 },
    { id: 'charcoal', color: 0x1d2534 },
    { id: 'sand', color: 0xb08d57 },
  ],

  materials: [
    { id: 'matte', name: 'MATTE', locked: false, blurb: 'flat tactical finish' },
    { id: 'metal', name: 'METAL', locked: false, blurb: 'brushed alloy, hard highlights' },
    { id: 'carbon', name: 'CARBON', locked: false, blurb: 'dark weave panelling' },
    { id: 'neon', name: 'NEON', locked: true, blurb: 'self-lit, glows in the dark' },
    { id: 'scanline', name: 'SCANLINE', locked: true, blurb: 'crawling hologram lines' },
  ],

  get default() { return { primary: this.primary, secondary: this.secondary, material: 'matte' }; },

  materialById(id) {
    return this.materials.find((m) => m.id === id) || null;
  },

  // Anything arriving from a client goes through here: colours are clamped to
  // real 24-bit values and a crew-only material falls back for everyone else.
  normalise(input, { crew = false } = {}) {
    const src = input && typeof input === 'object' ? input : {};
    const colour = (v, fallback) => {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 0xffffff) return fallback;
      return n;
    };
    const pick = this.materialById(String(src.material || ''));
    const material = pick && (!pick.locked || crew) ? pick.id : 'matte';
    return {
      primary: colour(src.primary, this.primary),
      secondary: colour(src.secondary, this.secondary),
      material,
    };
  },

  isLocked(materialId) {
    const m = this.materialById(materialId);
    return !!(m && m.locked);
  },

  hex(color) {
    return '#' + (Number(color) >>> 0).toString(16).padStart(6, '0');
  },
};
export const CREW_GLOW_ALT = 0x8b5cf6;

export const PLAYER = {
  maxHealth: 100,
  radius: 0.38,
  height: 1.8,
  eye: 1.62,              // eye height above feet
  walkSpeed: 7.4,
  sprintSpeed: 10.2,
  airAccel: 14,
  accel: 70,
  friction: 11,
  gravity: 24,
  jumpSpeed: 8.2,
  stepHeight: 0.55,
  fallKillY: -30,
  respawnTime: 3000,      // ms
  regenDelay: 5000,       // ms after last damage
  regenRate: 9,           // hp per second
  hspeedTolerance: 2.1,   // server sanity multiplier for client reported speed
};

// Movement tuned after Titanfall 2:
//
//  * air control is generous — holding a strafe and turning builds speed
//  * the air never drags you down; you keep whatever you left the ground with
//  * wall running ACCELERATES you, keeps your momentum and can be chained from
//    wall to wall; corners are runnable
//  * a double jump costs only a slice of your horizontal speed
//  * landing on your feet bleeds speed down to run speed, but slamming into a
//    slide instead keeps everything (slide hopping)
export const MOVE = {
  airSpeedCap: 32,          // hard sanity cap for long chains
  airStrafeAccel: 150,      // m/s^2 of wish-directed air acceleration
  airWishSpeed: 10.5,       // air control tops out at sprint speed along the
                            // wish direction — extra speed comes from carving
  airControlMin: 0.4,       // holding forward only steers weakly

  doubleJumpSpeed: 7.8,
  doubleJumpKeep: 0.87,     // you only lose ~13% of your horizontal speed

  landKeep: 0.35,           // a mistimed landing: momentum is gone
  landCap: 0.42,            // ...and never above this fraction of sprint speed
  slideLandKeep: 1.0,       // landing into a slide keeps everything

  // Bunny hop: press jump right as you touch down and you keep everything.
  // The press may come slightly early (buffered through the last moments of
  // the fall) or slightly late (a short window after touchdown), so the timing
  // is readable instead of frame-perfect.
  landJumpWindow: 0.22,     // press within this many seconds of hitting the
                            // floor and the jump waits for touchdown
  landWindow: 0.18,         // press this soon after touchdown and you keep it
  landKeepBonus: 1.02,      // a timed landing jump keeps 100% + a nudge

  wallRunMaxTime: 1.9,
  wallRunCooldown: 0.3,     // you cannot latch straight onto the next panel
  wallRunGravity: 4.6,
  wallRunLift: 2.4,
  wallRunAccel: 1.2,        // sped up while running a wall
  wallRunMinSpeed: 3.4,
  wallRunStick: 0.65,
  wallRunSteer: 9.0,
  wallRunKeep: 1.0,         // wall running never costs speed

  mantleHeight: 1.45,       // ledge grab reach above your feet
  mantleHop: 1.6,           // small upward nudge when you pull yourself up

  wallJumpPush: 6.8,
  wallJumpUp: 8.0,
  wallJumpKeep: 1.0,

  // Sliding is forgiving on purpose: it is long, slow to bleed speed, easy to
  // start (even out of a slow walk), and can be re-armed almost immediately.
  slideSpeed: 15.0,
  slideMinSpeed: 3.0,
  slideDuration: 2.6,
  slideFriction: 0.8,
  slideSteer: 6.4,
  slideBoost: 1.08,
  slideEyeOffset: -0.55,
  slideCooldown: 0.08,
  slideBuffer: 0.7,         // press slide this long before landing and it sticks
  slideJumpKeep: 1.0,
  slideExtend: 0.9,         // pressing slide again mid-slide tops the timer back up
  slideWalkStart: 0.55,     // fraction of sprint speed needed to start from a walk
};

// Highest horizontal speed a legitimately moving player can reach — the server
// uses this to reject teleports without punishing speed play.
export const MAX_LEGIT_SPEED = MOVE.airSpeedCap;

// Weapon definitions. damage / interval are the balance numbers requested:
//  rifle  : 4 shots/sec, 17 dmg  -> 6 shots to kill (6 * 17 = 102)
//  sniper : 100 dmg, 1 shot every 3.5s
//  smg    : 15 shots/sec, 5 dmg
//  knife  : 100 dmg (one shot), 0.5s swing cooldown
export const WEAPONS = [
  {
    id: 'rifle',
    name: 'RIFLE',
    slot: 1,
    damage: 25,           // 4 shots to kill at 100 hp
    interval: 250,        // ms between shots (4 / sec)
    magSize: 30,
    reloadTime: 2000,
    range: 180,
    melee: false,
    automatic: true,
    spread: 0.0028,
    recoil: 0.8,
    color: 0x9fd8ff,
  },
  {
    id: 'sniper',
    name: 'SNIPER',
    slot: 2,
    damage: 100,
    interval: 3500,       // one shot every 3.5 seconds
    magSize: 5,
    reloadTime: 3200,
    range: 500,
    melee: false,
    automatic: false,
    spread: 0.0,
    recoil: 3.2,
    scope: true,
    color: 0xffd479,
  },
  {
    id: 'smg',
    name: 'SMG',
    slot: 3,
    damage: 8,            // 13 shots to kill at 100 hp
    interval: 1000 / 15,  // 15 shots / sec
    magSize: 45,
    reloadTime: 1550,
    range: 130,
    melee: false,
    automatic: true,
    spread: 0.0105,
    recoil: 0.45,
    color: 0x8affc1,
  },
  {
    id: 'knife',
    name: 'KNIFE',
    slot: 4,
    damage: 100,          // one shot kill
    interval: 500,        // half second swing cooldown
    magSize: Infinity,
    reloadTime: 0,
    range: 2.7,
    melee: true,
    automatic: false,
    spread: 0,
    recoil: 1.4,
    color: 0xff8f8f,
  },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

export function weaponAmmoInfinite(w) {
  return !Number.isFinite(w.magSize);
}

// Team-less free for all palette, one colour per player slot.
export const PLAYER_COLORS = [
  0x62d6ff, 0xff6b6b, 0x9dff6b, 0xffd166,
  0xc792ff, 0x64ffda, 0xff8fd6, 0xffa552,
  0x7d9bff, 0xf7f7a1,
];

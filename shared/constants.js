// Shared between the browser client and the Node server.
// Everything here must stay dependency-free and side-effect-free.

export const NET = {
  TICK_HZ: 20,            // server snapshots per second
  INPUT_HZ: 20,           // client position reports per second
  MAX_NAME: 16,
};

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

// Advanced movement + momentum. Momentum is a 0..1 reward meter: it never
// drains from using moves, it only builds from chaining them and slowly bleeds
// away when you stand around. Higher momentum = higher top speed.
export const MOVE = {
  momentumMax: 1,
  momentumSpeedBoost: 0.45,     // +45% top speed at full momentum
  momentumSprintJump: 0.16,     // per sprint jump
  momentumDoubleJump: 0.12,     // per double jump
  momentumWallRun: 0.6,         // per second of wall running
  momentumWallJump: 0.1,        // per wall kick
  momentumSlide: 0.5,           // per second of sliding
  momentumHighSpeed: 0.16,      // per second while above sprint speed
  momentumSprint: 0.13,         // per second while sprinting
  momentumDecayIdle: 0.34,      // per second standing still
  momentumDecayGround: 0.1,     // per second walking
  momentumDecayAir: 0.02,       // per second floating slowly

  sprintJumpBoost: 1.1,         // horizontal multiplier for a sprint jump
  airJumps: 1,                  // double jump budget
  doubleJumpSpeed: 7.6,
  doubleJumpForward: 1.12,

  wallRunMaxTime: 1.15,         // seconds per wall
  wallRunGravity: 5.5,
  wallRunLift: 2.2,             // upward kick when a wall run begins
  wallRunMinSpeed: 3.4,
  wallRunStick: 0.62,           // how far the wall can be and still be grabbed
  wallRunSteer: 7.0,
  wallJumpPush: 6.4,
  wallJumpUp: 7.8,

  slideSpeed: 13.6,
  slideMinSpeed: 8.0,           // must already be moving at least this fast
  slideDuration: 1.05,
  slideFriction: 2.4,
  slideSteer: 4.5,
  slideEyeOffset: -0.55,
  slideCooldown: 0.35,
  slideJumpBoost: 1.06,
};

// Highest horizontal speed a legitimately moving player can reach — the server
// uses this to reject teleports without punishing momentum play.
export const MAX_LEGIT_SPEED = PLAYER.sprintSpeed * (1 + MOVE.momentumSpeedBoost) * 1.5;

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
    damage: 17,
    interval: 250,        // ms between shots (4 / sec)
    magSize: 30,
    reloadTime: 2100,
    range: 180,
    melee: false,
    automatic: true,
    spread: 0.0035,
    recoil: 0.9,
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
    damage: 5,
    interval: 1000 / 15,  // 15 shots / sec
    magSize: 40,
    reloadTime: 1700,
    range: 110,
    melee: false,
    automatic: true,
    spread: 0.012,
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

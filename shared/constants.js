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

// Advanced movement: Titanfall-flavoured speed preservation.
//
//  * in the air you KEEP your speed — nothing bleeds it away
//  * a double jump only costs you SOME of it
//  * touching the ground costs you ALL of it ... unless you slide into the
//    landing, which preserves everything (and can even add a little)
//  * wall runs preserve speed too, so you can chain them
export const MOVE = {
  airSpeedCap: 30,          // hard sanity cap, only reachable by long chains
  airStrafeAccel: 46,       // m/s^2 of wish-directed acceleration in the air
  airControlMin: 0.55,      // fraction of strafe accel when holding forward only

  doubleJumpSpeed: 7.6,
  doubleJumpKeep: 0.86,     // you only lose ~14% of your horizontal speed

  landKeep: 0.3,            // normal landing: momentum is gone
  landCap: 0.45,            // ...and never above this fraction of sprint speed
  slideLandKeep: 1.0,       // landing into a slide keeps everything

  wallRunMaxTime: 1.15,
  wallRunGravity: 5.5,
  wallRunLift: 2.2,
  wallRunMinSpeed: 3.4,
  wallRunStick: 0.62,
  wallRunSteer: 7.0,
  wallRunKeep: 1.0,         // wall running does not cost speed

  wallJumpPush: 6.4,
  wallJumpUp: 7.8,

  slideSpeed: 13.6,
  slideMinSpeed: 6.0,
  slideDuration: 1.35,
  slideFriction: 1.7,
  slideSteer: 5.0,
  slideBoost: 1.04,
  slideEyeOffset: -0.55,
  slideCooldown: 0.3,
  slideBuffer: 0.35,        // press slide this long before landing and it sticks
  slideJumpKeep: 1.0,
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

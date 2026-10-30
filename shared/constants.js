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

  landKeep: 0.35,           // normal landing: momentum is gone
  landCap: 0.42,            // ...and never above this fraction of sprint speed
  slideLandKeep: 1.0,       // landing into a slide keeps everything

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

  slideSpeed: 14.2,
  slideMinSpeed: 5.5,
  slideDuration: 1.5,
  slideFriction: 1.5,
  slideSteer: 5.4,
  slideBoost: 1.05,
  slideEyeOffset: -0.55,
  slideCooldown: 0.25,
  slideBuffer: 0.4,         // press slide this long before landing and it sticks
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

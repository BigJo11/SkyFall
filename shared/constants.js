// Shared between the browser client and the Node server.
// Everything here must stay dependency-free and side-effect-free.

export const NET = {
  TICK_HZ: 40,            // server snapshots per second
  INPUT_HZ: 30,           // client position reports per second
  MAX_NAME: 16,

  // Lag compensation. Remote players are drawn slightly in the past (the
  // client interpolates between snapshots), so the server rewinds every other
  // player by the shooter's own latency before resolving a shot. Without this a
  // moving target is hit where it used to be and the shot is wasted.
  LAG_COMP_MAX_MS: 260,   // never rewind further than this
  INTERP_FLOOR_MS: 60,    // a client always needs about this much smoothing
  MAX_RTT_MS: 400,        // anything above this is treated as a spike
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
// The mech has its own appearance, picked in the same panel: a hull colour, a
// finish, and the chassis it is built on. Crew-only finishes are crew-only
// here too, and the server re-checks that on join exactly as it does for the
// character.
export const MECH_COSMETIC = {
  primary: 0xbfae95,
  secondary: 0x4a4438,

  palette: COSMETIC.palette,
  materials: COSMETIC.materials,

  get default() {
    return { primary: this.primary, secondary: this.secondary, material: 'matte', chassis: MECH.defaultChassis };
  },

  materialById(id) {
    return this.materials.find((m) => m.id === id) || null;
  },

  chassisById(id) {
    return MECH.chassis.find((c) => c.id === id) || null;
  },

  normalise(input, { crew = false } = {}) {
    const src = input && typeof input === 'object' ? input : {};
    const colour = (v, fallback) => {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 0xffffff) return fallback;
      return n;
    };
    const pick = this.materialById(String(src.material || ''));
    const material = pick && (!pick.locked || crew) ? pick.id : 'matte';
    const chassis = this.chassisById(String(src.chassis || ''));
    return {
      primary: colour(src.primary, this.primary),
      secondary: colour(src.secondary, this.secondary),
      material,
      chassis: chassis ? chassis.id : MECH.defaultChassis,
    };
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

// Movement tuning notes:
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
  jumpBufferWindow: 0.5,    // a press made in the air with no double jump left
                            // waits this long for touchdown, so a jump tapped
                            // anywhere in a hop is still felt when you land.
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

// ------------------------------------------------------------------ the Core
// Kills and movement charge the Core. A full one calls down a mech. It is kept
// across death, so a bad life does not throw the charge away.
export const CORE = {
  max: 100,
  perKill: 10,             // ten kills from empty
  perCombo: 3,             // or fewer, if you move well
  comboWindowMs: 2600,     // two different moves this close together is a combo
  comboCooldownMs: 4000,   // ...and at most one award this often, so it cannot
                           // be farmed by hopping on the spot

  // Offline it fills far faster. A match is where you earn one; the practice
  // range and the tutorial are where you learn to fly it, and nobody wants to
  // grind ten dummies to reach the interesting part.
  practicePerKill: 50,     // two kills and it is full
  practicePerCombo: 20,
};

// ----------------------------------------------------------------- the mech
// Ten times a player's health, its own shield, and it goes out with a bang.
// Big map only: the small arena has no room for one.
export const MECH = {
  maxHealth: 1000,
  height: 9.5,
  radius: 2.1,
  eyeHeight: 7.4,          // where the pilot looks out from
  dropHeight: 95,          // it falls in from this far up
  dropTimeMs: 1700,

  // No knife aboard. The punch is the knife, with a far bigger hitbox.
  //
  // Both numbers are set by the geometry, not by taste. The swing leaves the
  // cockpit at `eyeHeight`, so its reach has to clear the drop to the ground
  // before it has any horizontal range at all: reach minus this.radius must
  // exceed eyeHeight - (PLAYER.height + radius). Shorter than that and a punch
  // swings harmlessly over everyone's head, which is useless in a mech meant
  // for fighting people on foot.
  punch: { damage: 100, interval: 500, range: 8, radius: 1.5 },

  // Energy shield: five seconds from full, four to refill, and it can be
  // raised early for proportionally less time.
  shield: { duration: 5, recharge: 4, minToRaise: 0.25 },

  // Core failure: the pilot has five seconds to punch out.
  coreFailure: { durationMs: 5000, presses: 3 },

  // V gets you out from under the machine any time you are aboard, not only
  // once it is dying — same three presses, same explosion. Presses have to
  // come close enough together to count as one attempt, so a stray tap does
  // not leave a third of an ejection sitting on the HUD for the rest of the
  // life of the mech.
  ejectPressWindowMs: 2500,

  // ...and then it goes up, killing anything right on top of it.
  explosion: { radius: 8, damage: 1000 },

  // A knife bounces off a mech. So does everything else that is not built
  // for armour.
  immuneTo: ['knife'],

  // The RPG's lock: it acquires mechs and nothing else.
  lockRange: 220,
  lockConeDeg: 22,

  // A mech's guns hit a person twice as hard as the same gun on foot. Armour
  // takes the ordinary number: mech duels are a war of attrition, not a
  // damage race. The punch is left alone — it already kills in one swing.
  gunDamageMult: 2,

  // Going the other way, an infantry rifle is a nuisance to nine tonnes of
  // armour: a soldier on foot does a quarter of his ordinary damage to a mech.
  // The RPG is built for exactly this job, so it is the one weapon left at
  // full strength. Only shots *at* a mech are scaled — against another person
  // nothing changes.
  footDamageMult: 0.25,

  // Three hulls. Same height, same guns: what differs is how much they can
  // take and how fast they carry it.
  chassis: [
    { id: 'light', name: 'KESTREL', hp: 500, speed: 1.25, blurb: 'quick, and it folds' },
    { id: 'medium', name: 'ELK', hp: 1000, speed: 1, blurb: 'the standard pattern' },
    { id: 'heavy', name: 'BISON', hp: 1500, speed: 0.75, blurb: 'slow, and stubborn' },
  ],
  defaultChassis: 'medium',

  bigMapOnly: true,
};

// Weapon definitions. damage / interval are the balance numbers requested:
//  rifle  : 4 shots/sec, 17 dmg  -> 6 shots to kill (6 * 17 = 102)
//  sniper : 100 dmg, 0.7s bolt cycle, 3 rounds then a 3.2s reload
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
    headshot: 2,          // x2 on a head hit -> 2 shot kill
    assist: true,
    color: 0x9fd8ff,
  },
  {
    id: 'sniper',
    name: 'SNIPER',
    slot: 2,
    damage: 100,
    interval: 700,        // the bolt cycle: chamber the next round
    magSize: 3,           // three rounds, then the full reload
    chamber: true,        // the gap between shots is a short visible reload
    reloadTime: 3200,
    range: 500,
    melee: false,
    automatic: false,
    spread: 0.0,
    recoil: 3.2,
    headshot: 1,          // already lethal anywhere
    assist: false,        // precision weapon: no magnetism

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
    headshot: 2,          // x2 on a head hit -> 7 shot kill
    assist: true,
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
    headshot: 1,          // melee: any hit is lethal
    assist: false,
    color: 0xff8f8f,
  },
  {
    id: 'rpg',
    name: 'RPG',
    slot: 5,
    damage: 200,          // five rockets to drop a full-health mech
    interval: 1800,
    magSize: 1,
    reloadTime: 2800,
    range: 220,
    melee: false,
    automatic: false,
    spread: 0,
    recoil: 4.5,
    headshot: 1,          // no crit bonus on armour
    assist: false,        // it goes where you point it
    lockOn: true,         // acquires mechs only — it will not track a person
    antiPersonnel: false, // and does nothing at all to players
    color: 0xffb45e,
  },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

// The top slice of the hit capsule counts as a head. 0.34 m of a 1.8 m player
// is the head plus a little shoulder, which is generous enough to reward aim
// without letting chest shots count.
export const HEADSHOT = {
  zoneHeight: 0.34,
};

// true when a hit landed `relY` metres above the victim's feet
export function isHeadHit(relY) {
  return relY >= PLAYER.height - HEADSHOT.zoneHeight;
}

// damage for a hit, doubled (or whatever the weapon says) on a headshot
export function headshotDamage(weapon, head) {
  if (!head) return weapon.damage;
  const mult = weapon.headshot ?? 1;
  return Math.round(weapon.damage * mult);
}

// Slight bullet magnetism. Deliberately weak: it only nudges shots that were
// already close, never yanks a shot across the screen, and it is disabled on the
// sniper and the knife.
// Aim assist is a setting now, because players move fast and the honest answer
// is that a controller-sized cone is what makes the shooting feel fair.
//   off    — no magnetism at all
//   slight — helps without doing the aiming for you (the default)
//   strong — a real magnet for players who want the help
// Radius/target rules are identical at every level; only the cone and the cap
// move.
export const AIM_ASSIST_LEVELS = [
  { id: 'off', name: 'OFF', blurb: 'raw aim, no magnetism', coneDeg: 0, strength: 0, maxPullDeg: 0 },
  { id: 'slight', name: 'SLIGHT', blurb: 'nudges a nearly-on-target shot', coneDeg: 4.2, strength: 0.78, maxPullDeg: 3.4 },
  { id: 'strong', name: 'STRONG', blurb: 'pulls hard, forgiving cone', coneDeg: 7.5, strength: 0.92, maxPullDeg: 6.5 },
];

export const AIM_ASSIST_DEFAULT = 'slight';

// The `slight` level, exposed as the plain config the shared maths expects.
export const AIM_ASSIST = {
  enabled: true,
  coneDeg: 4.2,        // only targets this close to the crosshair are eligible
  strength: 0.78,      // fraction of the angular error corrected (scaled by aim)
  maxPullDeg: 3.4,     // hard cap on how far a shot can be bent
  range: 95,           // metres
  chestHeight: 0.62,   // aim at this fraction of the target's height
};

export function aimAssistConfig(levelId) {
  const level = AIM_ASSIST_LEVELS.find((l) => l.id === levelId) || null;
  if (!level || level.id === 'off') return { ...AIM_ASSIST, ...(level || {}), enabled: !!level && level.id !== 'off' };
  return {
    ...AIM_ASSIST,
    coneDeg: level.coneDeg,
    strength: level.strength,
    maxPullDeg: level.maxPullDeg,
    enabled: true,
  };
}

export function weaponAmmoInfinite(w) {
  return !Number.isFinite(w.magSize);
}

// Team-less free for all palette, one colour per player slot.
export const PLAYER_COLORS = [
  0x62d6ff, 0xff6b6b, 0x9dff6b, 0xffd166,
  0xc792ff, 0x64ffda, 0xff8fd6, 0xffa552,
  0x7d9bff, 0xf7f7a1,
];

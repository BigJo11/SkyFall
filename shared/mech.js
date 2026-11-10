// The mech, and the Core that calls one down.
//
// Pure maths and rules — no DOM, no three.js — so the client and the server
// agree on every number and it can all be tested on its own.

import { CORE, MECH, WEAPONS } from './constants.js';

const weaponById = (id) => WEAPONS.find((w) => w.id === id) || null;

// ----------------------------------------------------------------- the Core
// The charge survives death on purpose: a mech you earned should not be lost
// because you got shot before you could spend it.
// How much one thing is worth. Offline pays the same way, only faster, so the
// practice range and the tutorial hand you a mech instead of making you grind.
export function coreGain(kind, practice = false) {
  if (kind === 'kill') return practice ? CORE.practicePerKill : CORE.perKill;
  if (kind === 'combo') return practice ? CORE.practicePerCombo : CORE.perCombo;
  return 0;
}

export function addCore(core, kind, practice = false) {
  return clamp(core + coreGain(kind, practice), 0, CORE.max);
}

export function coreReady(core) {
  return core >= CORE.max;
}

// The traversal log is a rolling list of { kind, at }.
export function pruneTraversal(log, atMs) {
  return log.filter((e) => atMs - e.at <= CORE.comboWindowMs);
}

// Two *different* moves inside the window is a combo. Doing the same move
// twice is just moving.
export function comboKinds(log, atMs) {
  return new Set(pruneTraversal(log, atMs).map((e) => e.kind));
}

export function isCombo(log, atMs) {
  return comboKinds(log, atMs).size >= 2;
}

// ----------------------------------------------------------------- chassis
// Three hulls, all the same height and all carrying the same guns. Pick by
// whether you would rather take the hit or get out of the way.
export function chassisById(id) {
  return MECH.chassis.find((c) => c.id === id)
    || MECH.chassis.find((c) => c.id === MECH.defaultChassis)
    || MECH.chassis[0];
}

export function chassisHealth(id) {
  return chassisById(id).hp;
}

export function chassisSpeed(id) {
  return chassisById(id).speed;
}

// ------------------------------------------------------------ the mech's guns
// Firing from a cockpit doubles the damage a gun does to a *person*. Against
// another mech it is the ordinary number, and armour keeps its immunities
// there too. The punch is a melee swing that already kills in one hit, so it
// is left out of the doubling rather than given a pointless second hundred.
export function damageFrom(weaponId, { fromMech = false, vsMech = false } = {}) {
  if (vsMech) return mechDamage(weaponId);
  if (!canDamagePlayer(weaponId)) return 0;
  const w = weaponById(weaponId);
  if (!w || w.melee) return w ? w.damage : 0;
  return w.damage * (fromMech ? MECH.gunDamageMult : 1);
}

// ---------------------------------------------------------------- the shield
// `charge` is how full the shield is (0..1). `time` is how long it has left
// once raised, in seconds.
export function stepShield(shield, dt) {
  const s = { charge: shield.charge, time: shield.time };
  if (s.time > 0) {
    s.time = Math.max(0, s.time - dt);
  } else {
    s.charge = Math.min(1, s.charge + dt / MECH.shield.recharge);
  }
  return s;
}

// Raising a half-full shield gives you half the duration — that is what makes
// it usable during the recharge. Returns null when it will not come up.
export function raiseShield(shield) {
  if (shield.time > 0) return null;
  if (shield.charge < MECH.shield.minToRaise) return null;
  return { time: shield.charge * MECH.shield.duration, charge: 0 };
}

// One bar for the HUD: how much shield you have, raised or not.
export function shieldFraction(shield) {
  if (shield.time > 0) return Math.min(1, shield.time / MECH.shield.duration);
  return clamp(shield.charge, 0, 1);
}

export function shieldUp(shield) {
  return shield.time > 0;
}

// ------------------------------------------------------------------- damage
// A knife bounces off armour. So does anything else on the immune list.
export function isImmune(weaponId) {
  return MECH.immuneTo.includes(weaponId);
}

export function canDamageMech(weaponId) {
  const w = weaponById(weaponId);
  return !!w && !isImmune(weaponId) && w.damage > 0;
}

// The mech has no head to crit.
export function mechDamage(weaponId) {
  if (!canDamageMech(weaponId)) return 0;
  return weaponById(weaponId).damage;
}

// The RPG is built for this and nothing else: it will not acquire a person.
export function canDamagePlayer(weaponId) {
  const w = weaponById(weaponId);
  return !!w && w.antiPersonnel !== false && w.damage > 0;
}

// -------------------------------------------------------------- core failure
export function ejectionProgress(presses) {
  return clamp(presses / MECH.coreFailure.presses, 0, 1);
}

export function hasEjected(presses) {
  return presses >= MECH.coreFailure.presses;
}

// ------------------------------------------------------------------ going up
// Point blank is fatal. A couple of tiles back and you walk away.
export function explosionDamage(dist) {
  return dist <= MECH.explosion.radius ? MECH.explosion.damage : 0;
}

export function explosionFalloff(dist) {
  return clamp(1 - dist / MECH.explosion.radius, 0, 1);
}

// ------------------------------------------------------------------- lock on
// The RPG only acquires a mech: inside the cone, inside the range.
export function lockAcquired(dist, angleRad) {
  if (!(dist >= 0) || !Number.isFinite(dist)) return false;
  return dist <= MECH.lockRange && Math.abs(angleRad) <= (MECH.lockConeDeg * Math.PI) / 180;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

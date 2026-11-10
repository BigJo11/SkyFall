// The mech, simulated on the client.
//
// Online, the server owns every mech: it ticks them, takes their damage and
// broadcasts what happened, and this client only draws the result. Offline
// there is no server at all — practice and the tutorial run entirely locally —
// so the same rules have to run somewhere. This is that somewhere.
//
// It is deliberately not a re-implementation. Every number comes from
// shared/mech.js, the same pure module the server calls, so a mech behaves
// identically whether a server or this class is holding the reins.

import { MECH, MECH_COSMETIC } from '../../shared/constants.js';
import { stepShield, raiseShield, hasEjected, chassisById } from '../../shared/mech.js';

let nextId = 1;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export class LocalMech {
  constructor(ownerId = 0) {
    this.ownerId = ownerId;
    this.mech = null;
    // the ground position the drop started from, so the mech falls to the
    // place it was called rather than sliding around under the pilot
    this.anchor = null;
  }

  // ------------------------------------------------------------------ state

  get exists() {
    return !!this.mech;
  }

  get piloting() {
    return !!this.mech && (this.mech.state === 'active' || this.mech.state === 'core-failure');
  }

  get state() {
    return this.mech ? this.mech.state : null;
  }

  get hp() {
    return this.mech ? this.mech.hp : 0;
  }

  // The same shape the server publishes, so everything that reads state.mech
  // (the HUD, the camera, the punch) works unchanged offline.
  snapshot() {
    const m = this.mech;
    if (!m) return null;
    return {
      id: m.id,
      ownerId: m.ownerId,
      pos: [m.pos[0], m.pos[1], m.pos[2]],
      yaw: m.yaw,
      hp: Math.max(0, Math.round(m.hp)),
      maxHp: m.maxHp,
      state: m.state,
      chassis: m.chassis,
      color: m.color,
      trim: m.trim,
      material: m.material,
      shield: { charge: m.shield.charge, time: m.shield.time },
      coreFailureEnd: m.coreFailureEnd ? Math.max(0, m.coreFailureEnd - m.now) : 0,
      ejectPresses: m.ejectPresses,
    };
  }

  // ----------------------------------------------------------------- deploy

  // Spent the moment it is called, exactly as it is online. `opts` carries the
  // pilot's choices: which chassis, and how it is painted.
  deploy(pos, yaw, nowMs, opts = {}) {
    if (this.mech) return null;
    const chassis = chassisById(opts.chassis);
    this.anchor = [pos[0], pos[1], pos[2]];
    this.mech = {
      id: nextId++,
      ownerId: this.ownerId,
      pos: [pos[0], pos[1] + MECH.dropHeight, pos[2]],
      yaw,
      hp: chassis.hp,
      maxHp: chassis.hp,
      chassis: chassis.id,
      color: opts.color ?? MECH_COSMETIC.primary,
      trim: opts.trim ?? MECH_COSMETIC.secondary,
      material: opts.material || 'matte',
      state: 'dropping',
      dropStart: nowMs,
      now: nowMs,
      shield: { charge: 1, time: 0 },
      coreFailureEnd: 0,
      ejectPresses: 0,
    };
    return this.snapshot();
  }

  // ------------------------------------------------------------------- tick

  // Returns the one thing worth reacting to this frame: 'landed' the moment it
  // touches down, 'expired' when a core failure ran out with the pilot still
  // inside. Anything else is null.
  update(dt, nowMs, pos, yaw) {
    const m = this.mech;
    if (!m) return null;
    m.now = nowMs;
    m.yaw = yaw;

    if (m.state === 'dropping') {
      const prog = clamp((nowMs - m.dropStart) / MECH.dropTimeMs, 0, 1);
      // it tracks the pilot across the ground on the way down, so you can
      // walk under your own mech as it arrives
      m.pos[0] = pos[0];
      m.pos[2] = pos[2];
      m.pos[1] = pos[1] + MECH.dropHeight * (1 - prog);
      if (prog >= 1) {
        m.state = 'active';
        m.pos[1] = pos[1];
        return 'landed';
      }
      return null;
    }

    // the mech rides exactly where its pilot is
    m.pos[0] = pos[0];
    m.pos[1] = pos[1];
    m.pos[2] = pos[2];

    if (m.state === 'active') {
      m.shield = stepShield(m.shield, dt);
      return null;
    }

    // core failure ran out: the pilot did not get out
    if (m.state === 'core-failure' && nowMs >= m.coreFailureEnd) return 'expired';
    return null;
  }

  // ----------------------------------------------------------------- damage

  // The shield eats the whole hit while it is up, the same as online.
  hit(dmg) {
    const m = this.mech;
    if (!m || m.state !== 'active' || !(dmg > 0)) return { absorbed: false, killed: false, hp: m ? m.hp : 0 };
    if (m.shield.time > 0) return { absorbed: true, killed: false, hp: m.hp };
    m.hp -= dmg;
    if (m.hp > 0) return { absorbed: false, killed: false, hp: m.hp };
    m.hp = 0;
    m.state = 'core-failure';
    m.coreFailureEnd = m.now + MECH.coreFailure.durationMs;
    m.ejectPresses = 0;
    return { absorbed: false, killed: true, hp: 0 };
  }

  // ----------------------------------------------------------------- shield

  raise() {
    const m = this.mech;
    if (!m || m.state !== 'active') return 0;
    const raised = raiseShield(m.shield);
    if (!raised) return 0;
    m.shield = raised;
    return raised.time;
  }

  // ------------------------------------------------------------------ eject

  // Three presses and the pilot is thrown clear. Fewer than that and the
  // counter just climbs.
  pressEject() {
    const m = this.mech;
    if (!m || m.state !== 'core-failure') return { presses: 0, out: false };
    m.ejectPresses += 1;
    return { presses: m.ejectPresses, out: hasEjected(m.ejectPresses) };
  }

  // Drill use: take a healthy mech straight to core failure, shield or no
  // shield. The tutorial needs a mech to escape from without waiting for the
  // range to shoot one down, and a raised shield would absorb the attempt.
  forceCoreFailure() {
    const m = this.mech;
    if (!m || m.state !== 'active') return false;
    m.shield = { charge: 0, time: 0 };
    m.hp = 0;
    m.state = 'core-failure';
    m.coreFailureEnd = m.now + MECH.coreFailure.durationMs;
    m.ejectPresses = 0;
    return true;
  }

  // ----------------------------------------------------------------- cleanup

  clear() {
    this.mech = null;
    this.anchor = null;
  }
}

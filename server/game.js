import { PLAYER, WEAPONS, PLAYER_COLORS, NET, MAX_LEGIT_SPEED, RESERVED, CREW_GLOW, COSMETIC, MECH_COSMETIC, isHeadHit, headshotDamage, MECH, CORE } from '../shared/constants.js';
import { addCore, isCombo, pruneTraversal, stepShield, raiseShield, explosionDamage, mechDamage, damageFrom, chassisById, lockAcquired, hasEjected } from '../shared/mech.js';
import ARENA, { MAPS, mapById, DEFAULT_MAP } from '../shared/map.js';
import { solidAABBs, raycastAABBs, rayCapsule } from '../shared/collision.js';
import { Leaderboard } from './leaderboard.js';

const now = () => Date.now();
const LEADERBOARD_ROWS = 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function sanitizeName(raw, fallback) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NET.MAX_NAME);
  return s.length ? s : fallback;
}

function norm3(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v.map(Number);
  if (![x, y, z].every(Number.isFinite)) return null;
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) return null;
  return [x / len, y / len, z / len];
}

export class Game {
  constructor({ leaderboard = null, map = DEFAULT_MAP } = {}) {
    this.mapId = MAPS[map] ? map : DEFAULT_MAP;
    this.arena = mapById(this.mapId);
    this.players = new Map();
    // all-time table; the server passes a file-backed one, tests get memory
    this.leaderboard = leaderboard || new Leaderboard(null);
    this.solids = solidAABBs(this.arena.boxes);
    this.nextId = 1;
    this.tickTimer = null;
    this.snapshotTimer = null;
    this.onBroadcast = () => {};
    // Rewind history: one entry per tick, newest last. Used to resolve shots
    // against where the other players were when the shooter actually pulled the
    // trigger, not where they are now.
    this.history = [];
    // Mechs, and the Core that calls one down. Big map only — the small arena
    // has no room for one.
    this.mechs = new Map();
    this.nextMechId = 1;
    this.mechsAllowed = !MECH.bigMapOnly || this.mapId === 'big';
  }

  start() {
    const interval = 1000 / NET.TICK_HZ;
    this.tickTimer = setInterval(() => this.tick(), interval);
    return this;
  }

  stop() {
    clearInterval(this.tickTimer);
  }

  // ------------------------------------------------------------- connections

  addPlayer(socket, requestedName, crew = false, cosmetic = null) {
    const id = this.nextId++;
    const taken = new Set([...this.players.values()].map((p) => p.name));
    let name = sanitizeName(requestedName, `PLAYER ${id}`);
    // reserved callsigns need the crew code
    if (!crew && RESERVED.isReserved(name)) name = `PLAYER ${id}`;
    if (taken.has(name)) name = `${name} (${id})`.slice(0, NET.MAX_NAME + 4);

    // cosmetics are validated here, not trusted: a locked material silently
    // falls back unless this connection actually passed the crew check
    const hasCosmetic = !!cosmetic && typeof cosmetic === 'object';
    const look = COSMETIC.normalise(cosmetic, { crew });
    // the mech's appearance rides along inside the same payload, and is
    // validated here just as firmly: a crew finish is crew-only
    const hasMechCos = hasCosmetic && !!cosmetic.mech && typeof cosmetic.mech === 'object';
    const mechLook = MECH_COSMETIC.normalise(cosmetic?.mech, { crew });

    const spawn = this.pickSpawn();
    const player = {
      id,
      name,
      socket,
      cosmetic: hasCosmetic ? look : null,
      mechCosmetic: hasMechCos ? mechLook : null,
      color: hasCosmetic
        ? look.primary
        : (crew ? CREW_GLOW : PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length]),
      crew: !!crew,
      pos: spawn.pos.slice(),
      yaw: spawn.yaw,
      pitch: 0,
      hp: PLAYER.maxHealth,
      alive: true,
      weapon: 0,
      ammo: WEAPONS.map((w) => (Number.isFinite(w.magSize) ? w.magSize : -1)),
      reloadEnd: 0,
      reloadWeapon: 0,
      lastShot: WEAPONS.map(() => 0),
      lastDamage: 0,
      kills: 0,
      deaths: 0,
      respawnAt: 0,
      lastInputAt: now(),
      lastInputPos: spawn.pos.slice(),
      lastFallDeath: 0,
      core: 0,                 // the Core charge: kills and movement fill it
      traversal: [],           // recent movement moves, for combo detection
      lastComboAt: 0,
      mechId: 0,               // piloting a mech, if set
      rtt: 0,                  // client-measured round trip, ms
      vel: [0, 0, 0],          // for clients that extrapolate between snapshots
      stepBudget: 6,           // metres of legitimate movement in the bank
    };
    this.players.set(id, player);
    this.leaderboard.recordJoin(name, { crew });

    this.send(player, {
      t: 'welcome',
      id,
      name,
      color: player.color,
      you: this.pub(player),
      players: [...this.players.values()].filter((p) => p.id !== id).map((p) => this.pub(p)),
      leaderboard: this.leaderboard.top(LEADERBOARD_ROWS),
      snapshotHz: NET.TICK_HZ,
      map: this.mapId,
    });
    this.broadcast({ t: 'join', player: this.pub(player) }, id);
    console.log(`[game] ${name} joined (${this.players.size} online)`);
    return player;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.mechId) this.mechs.delete(p.mechId);
    this.players.delete(id);
    this.broadcast({ t: 'leave', id, name: p.name });
    console.log(`[game] ${p.name} left (${this.players.size} online)`);
  }

  send(player, msg) {
    try {
      if (player.socket.readyState === 1) player.socket.send(JSON.stringify(msg));
    } catch (e) { /* socket died */ }
  }

  broadcast(msg, exceptId = -1) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      try {
        if (p.socket.readyState === 1) p.socket.send(data);
      } catch (e) { /* ignore */ }
    }
  }

  pub(p) {
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      crew: !!p.crew,
      cosmetic: p.cosmetic,
      pos: [round2(p.pos[0]), round2(p.pos[1]), round2(p.pos[2])],
      yaw: round3(p.yaw),
      pitch: round3(p.pitch),
      hp: Math.max(0, Math.round(p.hp)),
      weapon: p.weapon,
      alive: p.alive,
      kills: p.kills,
      deaths: p.deaths,
      ammo: p.ammo[p.weapon],
      core: Math.round(p.core || 0),
      mechId: p.mechId || 0,
      reloadEnd: p.reloadEnd ? Math.max(0, p.reloadEnd - now()) : 0,
      v: [round2(p.vel[0]), round2(p.vel[2])],
      rtt: Math.round(p.rtt || 0),
    };
  }

  // ------------------------------------------------------------- spawning

  pickSpawn() {
    const living = [...this.players.values()].filter((p) => p.alive);
    let best = this.arena.spawns[0];
    let bestScore = -1;
    // random order so several simultaneous respawns spread out
    const shuffled = [...this.arena.spawns].sort(() => Math.random() - 0.5);
    for (const s of shuffled) {
      let minD = 1e9;
      for (const p of living) {
        const d = Math.hypot(p.pos[0] - s.pos[0], p.pos[2] - s.pos[2]);
        minD = Math.min(minD, d);
      }
      if (minD > bestScore) { bestScore = minD; best = s; }
      if (bestScore > 26) break;
    }
    return best;
  }

  respawn(p) {
    if (!this.players.has(p.id)) return;
    const spawn = this.pickSpawn();
    p.pos = spawn.pos.slice();
    p.yaw = spawn.yaw;
    p.pitch = 0;
    p.hp = PLAYER.maxHealth;
    p.alive = true;
    p.ammo = WEAPONS.map((w) => (Number.isFinite(w.magSize) ? w.magSize : -1));
    p.reloadEnd = 0;
    p.lastShot = WEAPONS.map(() => 0);
    p.respawnAt = 0;
    p.lastInputPos = p.pos.slice();
    p.stepBudget = 6;
    p.vel = [0, 0, 0];
    this.send(p, { t: 'spawn', pos: p.pos.slice(), yaw: p.yaw, hp: p.hp });
  }

  // ------------------------------------------------------------- input

  handle(player, msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'input': return this.onInput(player, msg);
      case 'weapon': return this.onWeapon(player, msg);
      case 'fire': return this.onFire(player, msg);
      case 'reload': return this.startReload(player);
      case 'deploy': return this.deployMech(player);
      case 'shield': return this.onShield(player);
      case 'eject': return this.onEject(player);
      case 'traversal': return this.onTraversal(player, msg);
      case 'ping': return this.send(player, { t: 'pong', c: msg.c });
      default: return;
    }
  }

  onInput(p, msg) {
    if (!p.alive) return;
    const pos = msg.p;
    if (!Array.isArray(pos) || pos.length !== 3) return;
    const nx = Number(pos[0]), ny = Number(pos[1]), nz = Number(pos[2]);
    if (![nx, ny, nz].every(Number.isFinite)) return;

    const t = now();
    const dt = Math.max(0.001, Math.min(0.5, (t - p.lastInputAt) / 1000));
    p.lastInputAt = t;

    const d = Math.hypot(nx - p.pos[0], nz - p.pos[2]);
    const rise = ny - p.pos[1];

    // Sanity check against teleports, as a *budget* rather than a per-packet
    // step. Packets arrive in bursts on any real network (and the browser sends
    // two in the same millisecond after a hitch); measuring each packet on its
    // own arrival time turned perfectly honest movement into "teleport"
    // corrections, which is what made players snap around. Accumulating the
    // allowed distance over time absorbs the jitter.
    const topSpeed = Math.max(MAX_LEGIT_SPEED, PLAYER.sprintSpeed * PLAYER.hspeedTolerance);
    p.stepBudget = Math.min(8, (p.stepBudget || 0) + topSpeed * dt + 0.35);

    // climbing faster than a jump, or dropping further than a body can fall
    if (rise > 4 || rise < -45) {
      this.send(p, { t: 'correct', pos: p.pos.slice() });
      return;
    }
    if (d > p.stepBudget) {
      // spend what we can and only clamp the excess: a big correction is
      // reserved for actual cheating or a genuine desync
      const k = p.stepBudget / d;
      p.pos[0] += (nx - p.pos[0]) * k;
      p.pos[2] += (nz - p.pos[2]) * k;
      p.stepBudget = 0;
      this.send(p, { t: 'correct', pos: p.pos.slice() });
      return;
    }
    p.stepBudget = Math.max(0, p.stepBudget - d);

    if (Number.isFinite(msg.rtt)) {
      p.rtt = clamp(Number(msg.rtt), 0, NET.MAX_RTT_MS);
    }
    if (dt > 0.001) {
      p.vel[0] = (nx - p.pos[0]) / dt;
      p.vel[2] = (nz - p.pos[2]) / dt;
    }
    const bx = this.arena.bounds || { minX: -400, maxX: 400, minZ: -400, maxZ: 400 };
    if (ny < PLAYER.fallKillY - 6 || ny > 120
      || nx < bx.minX - 60 || nx > bx.maxX + 60
      || nz < bx.minZ - 60 || nz > bx.maxZ + 60) {
      this.send(p, { t: 'correct', pos: p.pos.slice() });
      return;
    }

    p.pos[0] = nx;
    p.pos[1] = ny;
    p.pos[2] = nz;
    if (Number.isFinite(msg.yaw)) p.yaw = msg.yaw;
    if (Number.isFinite(msg.pitch)) p.pitch = clamp(msg.pitch, -1.55, 1.55);
  }

  onWeapon(p, msg) {
    const i = Number(msg.i);
    if (!Number.isInteger(i) || i < 0 || i >= WEAPONS.length) return;
    if (i === p.weapon) return;
    p.weapon = i;
    p.reloadEnd = 0;
    this.send(p, { t: 'self', weapon: p.weapon, ammo: p.ammo[p.weapon] });
  }

  startReload(p) {
    if (!p.alive) return;
    const w = WEAPONS[p.weapon];
    if (!Number.isFinite(w.magSize)) return;
    if (p.reloadEnd) return;
    if (p.ammo[p.weapon] >= w.magSize) return;
    p.reloadEnd = now() + w.reloadTime;
    p.reloadWeapon = p.weapon;
    this.send(p, { t: 'self', reloadEnd: w.reloadTime, weapon: p.weapon });
    this.broadcast({ t: 'reload', id: p.id, weapon: p.weapon }, p.id);
  }


  // ------------------------------------------------------------------ mechs
  //
  // A mech is ridden by its pilot. The pilot's body stops taking hits — every
  // one goes to the armour instead — and the pair move and aim as one thing.

  pubMech(m) {
    return {
      id: m.id,
      ownerId: m.ownerId,
      pos: [round2(m.pos[0]), round2(m.pos[1]), round2(m.pos[2])],
      yaw: round3(m.yaw),
      hp: Math.max(0, Math.round(m.hp)),
      maxHp: m.maxHp,
      state: m.state,
      chassis: m.chassis || MECH.defaultChassis,
      color: m.color ?? MECH_COSMETIC.primary,
      trim: m.trim ?? MECH_COSMETIC.secondary,
      material: m.material || 'matte',
      shield: { charge: round3(m.shield.charge), time: round2(m.shield.time) },
      coreFailureEnd: m.coreFailureEnd ? Math.max(0, m.coreFailureEnd - now()) : 0,
      ejectPresses: m.ejectPresses,
    };
  }

  deployMech(p) {
    if (!p.alive || p.mechId) return;
    if (!this.mechsAllowed) { this.send(p, { t: 'core', core: p.core, reason: 'nomech' }); return; }
    if ((p.core || 0) < CORE.max) return;

    // The chassis decides how much it can take. A mech nobody painted flies
    // its pilot's colour, so two of them on the field are still tellable apart.
    const cos = p.mechCosmetic || null;
    const chassis = chassisById(cos ? cos.chassis : MECH.defaultChassis);
    const m = {
      id: this.nextMechId++,
      ownerId: p.id,
      pos: [p.pos[0], p.pos[1] + MECH.dropHeight, p.pos[2]],
      yaw: p.yaw,
      hp: chassis.hp,
      maxHp: chassis.hp,
      chassis: chassis.id,
      // the client already knows how to fall back if these are missing
      color: cos ? cos.primary : p.color,
      trim: cos ? cos.secondary : MECH_COSMETIC.secondary,
      material: cos ? cos.material : 'matte',
      state: 'dropping',
      dropStart: now(),
      shield: { charge: 1, time: 0 },
      coreFailureEnd: 0,
      ejectPresses: 0,
    };
    this.mechs.set(m.id, m);
    p.mechId = m.id;
    p.core = 0;                 // spent the moment it is called
    p.reloadEnd = 0;
    this.broadcast({ t: 'mechDrop', mech: this.pubMech(m) });
    this.send(p, { t: 'core', core: 0, reason: 'deploy' });
  }

  // The shield can be raised early for proportionally less time — that is what
  // makes a half-charged shield worth using instead of waiting.
  onShield(p) {
    const m = p.mechId ? this.mechs.get(p.mechId) : null;
    if (!m || m.state !== 'active') return;
    const raised = raiseShield(m.shield);
    if (!raised) return;
    m.shield = raised;
    this.broadcast({ t: 'mechShield', id: m.id, time: round2(raised.time) });
  }

  onEject(p) {
    const m = p.mechId ? this.mechs.get(p.mechId) : null;
    if (!m || m.state !== 'core-failure') return;
    m.ejectPresses += 1;
    if (!hasEjected(m.ejectPresses)) {
      this.send(p, { t: 'mechEject', id: m.id, presses: m.ejectPresses });
      return;
    }
    // out, and thrown clear before it goes
    this.exitMech(p);
    p.pos[1] += 6;
    this.send(p, { t: 'mechEject', id: m.id, presses: m.ejectPresses, out: true });
    this.explodeMech(m, p.id);
  }

  exitMech(p) {
    if (p.mechId) this.mechs.delete(p.mechId);
    p.mechId = 0;
  }

  // A combo is two different traversal moves close together. It pays a little,
  // and often enough that moving well is the fast route to a mech.
  onTraversal(p, msg) {
    if (!p.alive || p.mechId) return;
    const kind = String(msg.kind || '').slice(0, 24);
    if (!kind) return;
    const t = now();
    p.traversal = pruneTraversal(p.traversal, t);
    p.traversal.push({ kind, at: t });
    if (t - p.lastComboAt < CORE.comboCooldownMs) return;
    if (!isCombo(p.traversal, t)) return;
    p.lastComboAt = t;
    p.core = addCore(p.core, 'combo');
    this.send(p, { t: 'core', core: p.core, reason: 'combo' });
  }

  damageMech(m, dmg, attacker, weaponId) {
    if (m.state !== 'active') return;
    // the shield eats the whole hit while it is up
    if (m.shield.time > 0) {
      if (attacker) this.send(attacker, { t: 'hitmark', dmg: 0, kill: false, id: m.ownerId, head: false, shielded: true });
      return;
    }
    m.hp -= dmg;
    this.broadcast({
      t: 'mechDamage', id: m.id, hp: Math.max(0, Math.round(m.hp)),
      dmg: Math.round(dmg), by: attacker ? attacker.id : 0, weapon: weaponId,
    });
    if (attacker) {
      this.send(attacker, { t: 'hitmark', dmg: Math.round(dmg), kill: m.hp <= 0, id: m.ownerId, head: false });
    }
    if (m.hp <= 0) {
      m.hp = 0;
      m.state = 'core-failure';
      m.coreFailureEnd = now() + MECH.coreFailure.durationMs;
      m.ejectPresses = 0;
      this.broadcast({
        t: 'mechCoreFailure', id: m.id, ownerId: m.ownerId,
        durationMs: MECH.coreFailure.durationMs, presses: MECH.coreFailure.presses,
      });
    }
  }

  // Point blank is fatal; a couple of tiles back and you walk away.
  explodeMech(m, excludeId = -1) {
    this.broadcast({ t: 'mechExplode', id: m.id, pos: m.pos.map(round2) });
    for (const p of this.players.values()) {
      if (!p.alive || p.id === excludeId) continue;
      const dist = Math.hypot(p.pos[0] - m.pos[0], p.pos[2] - m.pos[2]);
      const dmg = explosionDamage(dist);
      if (dmg <= 0) continue;
      const theirs = p.mechId ? this.mechs.get(p.mechId) : null;
      if (theirs) this.damageMech(theirs, dmg, null, 'mech');
      else this.damage(p, dmg, null, 'mech');
    }
    this.mechs.delete(m.id);
    for (const p of this.players.values()) if (p.mechId === m.id) p.mechId = 0;
  }

  tickMechs(t, dt) {
    for (const m of [...this.mechs.values()]) {
      const owner = this.players.get(m.ownerId);
      if (!owner || !owner.alive) { this.mechs.delete(m.id); continue; }
      m.yaw = owner.yaw;

      if (m.state === 'dropping') {
        const prog = clamp((t - m.dropStart) / MECH.dropTimeMs, 0, 1);
        m.pos[0] = owner.pos[0];
        m.pos[2] = owner.pos[2];
        m.pos[1] = owner.pos[1] + MECH.dropHeight * (1 - prog);
        if (prog >= 1) {
          m.state = 'active';
          m.pos[1] = owner.pos[1];
          this.broadcast({ t: 'mechLanded', id: m.id, pos: m.pos.map(round2) });
        }
        continue;
      }

      // the mech rides exactly where its pilot is
      m.pos[0] = owner.pos[0];
      m.pos[1] = owner.pos[1];
      m.pos[2] = owner.pos[2];

      if (m.state === 'active') {
        m.shield = stepShield(m.shield, dt);
        continue;
      }

      // core failure ran out: the pilot did not get out
      if (m.state === 'core-failure' && t >= m.coreFailureEnd) {
        this.exitMech(owner);
        this.kill(owner, null, 'mech');
        this.explodeMech(m, -1);
      }
    }
  }

  // ------------------------------------------------------------- lag compensation

  // Where a player's feet were at `when` (server clock, ms). Interpolated
  // between the two recorded ticks that bracket it.
  positionAt(id, when) {
    const h = this.history;
    if (!h.length) return null;
    if (when >= h[h.length - 1].t) return h[h.length - 1].pos.get(id) || null;
    if (when <= h[0].t) return h[0].pos.get(id) || null;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1];
      const b = h[i];
      if (when < a.t) continue;
      const pa = a.pos.get(id);
      if (!pa) return null;
      const pb = b.pos.get(id);
      if (!pb) return pa;
      const k = b.t === a.t ? 0 : (when - a.t) / (b.t - a.t);
      return [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k];
    }
    return h[h.length - 1].pos.get(id) || null;
  }

  recordHistory(t) {
    const pos = new Map();
    for (const p of this.players.values()) pos.set(p.id, p.pos.slice());
    this.history.push({ t, pos });
    const cutoff = t - (NET.LAG_COMP_MAX_MS + 400);
    while (this.history.length > 2 && this.history[0].t < cutoff) this.history.shift();
    if (this.history.length > 120) this.history.splice(0, this.history.length - 120);
  }

  // The moment the shooter was actually looking at, on the server's clock.
  rewindTimeFor(p) {
    const rtt = clamp(Number(p.rtt) || 0, 0, NET.MAX_RTT_MS);
    const back = rtt / 2 + NET.INTERP_FLOOR_MS;
    return now() - clamp(back, 0, NET.LAG_COMP_MAX_MS);
  }

  // ------------------------------------------------------------- shooting

  onFire(p, msg) {
    if (!p.alive) return;
    const w = WEAPONS[p.weapon];
    const mine = p.mechId ? this.mechs.get(p.mechId) : null;
    const t = now();
    if (p.reloadEnd) return;

    // In a mech the knife is a punch: same idea, a far bigger hitbox.
    const punch = mine && w.melee ? { ...w, ...MECH.punch } : null;
    const weapon = punch || w;

    // per-weapon cooldown: swapping guns can never cheat the fire rate
    if (t - p.lastShot[p.weapon] < weapon.interval - 20) return;

    // The RPG only fires on a lock, and it only locks a mech. Pointed at a
    // person it does not fire at all.
    if (w.lockOn) {
      const target = this.mechs.get(Number(msg.lock));
      if (!target || target.state !== 'active') { this.send(p, { t: 'nolock' }); return; }
      const eye = p.pos[1] + PLAYER.eye;
      const cx = target.pos[0], cy = target.pos[1] + MECH.height / 2, cz = target.pos[2];
      const dist = Math.hypot(cx - p.pos[0], cy - eye, cz - p.pos[2]);
      const aim = norm3(msg.dir);
      const to = norm3([cx - p.pos[0], cy - eye, cz - p.pos[2]]);
      const angle = (aim && to)
        ? Math.acos(clamp(aim[0] * to[0] + aim[1] * to[1] + aim[2] * to[2], -1, 1))
        : Math.PI;
      if (!lockAcquired(dist, angle)) { this.send(p, { t: 'nolock' }); return; }
    }

    if (Number.isFinite(weapon.magSize)) {
      if (p.ammo[p.weapon] <= 0) { this.startReload(p); return; }
      p.ammo[p.weapon]--;
      if (p.ammo[p.weapon] === 0) this.send(p, { t: 'empty', weapon: p.weapon });
    }
    p.lastShot[p.weapon] = t;

    // origin: server-authoritative eye position (fall back to the reported one)
    const origin = [p.pos[0], p.pos[1] + (mine ? MECH.eyeHeight : PLAYER.eye), p.pos[2]];
    let dir = norm3(msg.dir);
    if (!dir) {
      const cy2 = Math.cos(p.yaw), sy2 = Math.sin(p.yaw), cp2 = Math.cos(p.pitch);
      dir = [-sy2 * cp2, Math.sin(p.pitch), -cy2 * cp2];
    }

    const worldHit = raycastAABBs(this.solids, origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], weapon.range);
    let endT = worldHit.t;
    let victim = null;
    let victimFeet = null;
    let victimMech = null;
    const pad = weapon.melee ? 0.22 : 0.02;

    // Lag compensation: the client draws remote players slightly in the past
    // and its own view of itself slightly in the future. Test the shot against
    // the rewound capsule *and* the live one, and take whichever is closer —
    // a shot that looks right on the shooter's screen must land.
    const rewound = this.rewindTimeFor(p);
    if (endT > 0.001) {
      for (const other of this.players.values()) {
        if (other === p || !other.alive) continue;
        const theirs = other.mechId ? this.mechs.get(other.mechId) : null;
        // the RPG does not see people at all
        if (w.lockOn && !theirs) continue;
        const height = theirs ? MECH.height : PLAYER.height;
        // A punch swings a fist the size of a person, and that is the only
        // reason a swing from seven metres up can reach the ground at all.
        let radius = (theirs ? MECH.radius : PLAYER.radius) + pad;
        if (punch && !theirs) radius = MECH.punch.radius;
        const past = this.positionAt(other.id, rewound);
        for (const feet of past ? [other.pos, past] : [other.pos]) {
          const ht = rayCapsule(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], feet, height, radius, endT);
          if (ht < endT) { endT = ht; victim = other; victimFeet = feet; victimMech = theirs; }
        }
      }
    }

    const end = [origin[0] + dir[0] * endT, origin[1] + dir[1] * endT, origin[2] + dir[2] * endT];

    // Headshots: the shot landed in the top slice of the victim's capsule.
    // Armour has no head to crit.
    const hitY = origin[1] + dir[1] * endT;
    const head = !!victim && !victimMech && !weapon.melee && isHeadHit(hitY - (victimFeet || victim.pos)[1]);
    // Firing from a cockpit doubles what a gun does to a *person*. Armour
    // takes the ordinary number, and keeps its immunities.
    const fromMech = !!mine;
    const base = damageFrom(w.id, { fromMech, vsMech: !!victimMech });
    const dmg = headshotDamage({ damage: base, headshot: weapon.headshot }, head);

    this.broadcast({
      t: 'shot',
      id: p.id,
      weapon: w.id,
      from: origin.map(round2),
      to: end.map(round2),
      hit: victim ? victim.id : 0,
      head,
    });

    if (!victim) return;

    // everything that hits a pilot hits the armour instead
    if (victimMech) {
      if (base > 0) this.damageMech(victimMech, base, p, w.id);
      else if (p !== victim) {
        this.send(p, { t: 'hitmark', dmg: 0, kill: false, id: victim.id, head: false, immune: true });
      }
      return;
    }

    const killed = this.damage(victim, dmg, p, w.id, head);
    this.send(p, { t: 'hitmark', dmg, kill: killed, id: victim.id, head });
  }

  // ------------------------------------------------------------- damage / death

  damage(target, dmg, attacker, weaponId, head = false) {
    if (!target.alive) return false;
    target.hp -= dmg;
    target.lastDamage = now();

    const from = attacker ? attacker.pos.slice() : null;
    this.send(target, {
      t: 'damaged',
      dmg: Math.round(dmg),
      hp: Math.max(0, Math.round(target.hp)),
      from,
      by: attacker ? attacker.id : 0,
      weapon: weaponId,
      head: !!head,
    });

    if (target.hp <= 0) {
      this.kill(target, attacker, weaponId, head);
      return true;
    }
    return false;
  }

  kill(victim, killer, weaponId, head = false) {
    if (!victim.alive) return;
    // a mech does not survive its pilot
    if (victim.mechId) { this.mechs.delete(victim.mechId); victim.mechId = 0; }
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.reloadEnd = 0;
    victim.respawnAt = now() + PLAYER.respawnTime;
    if (killer && killer !== victim) {
      killer.kills++;
      killer.core = addCore(killer.core, 'kill');
      this.send(killer, { t: 'core', core: killer.core, reason: 'kill' });
    }

    // fold the kill into the all-time table (a fall has no killer)
    this.leaderboard.recordKill(
      killer && killer !== victim ? killer.name : null,
      victim.name,
      { crew: !!killer?.crew },
    );
    this.broadcast({ t: 'leaderboard', rows: this.leaderboard.top(LEADERBOARD_ROWS) });

    this.broadcast({
      t: 'kill',
      killer: killer ? killer.id : 0,
      killerName: killer ? killer.name : null,
      victim: victim.id,
      victimName: victim.name,
      weapon: weaponId || null,
      head: !!head,
      respawnIn: PLAYER.respawnTime,
    });
    this.send(victim, { t: 'died', respawnAt: victim.respawnAt, by: killer ? killer.name : null, weapon: weaponId || null });
  }

  // ------------------------------------------------------------- tick

  tick() {
    const t = now();
    const dt = 1 / NET.TICK_HZ;

    for (const p of [...this.players.values()]) {
      // falling out of the world
      if (p.alive && p.pos[1] < PLAYER.fallKillY) {
        p.hp = 0;
        this.kill(p, null, 'fall');
        continue;
      }
      if (!p.alive) {
        if (p.respawnAt && t >= p.respawnAt) this.respawn(p);
        continue;
      }
      // finish reloads
      if (p.reloadEnd && t >= p.reloadEnd) {
        const w = WEAPONS[p.reloadWeapon] || WEAPONS[p.weapon];
        if (Number.isFinite(w.magSize)) p.ammo[p.reloadWeapon] = w.magSize;
        p.reloadEnd = 0;
      }
      // health regen out of combat
      if (p.hp < PLAYER.maxHealth && t - p.lastDamage > PLAYER.regenDelay) {
        p.hp = Math.min(PLAYER.maxHealth, p.hp + PLAYER.regenRate * dt);
      }
    }

    this.tickMechs(t, dt);

    // keep the rewind buffer current (newest last)
    const newest = this.history[this.history.length - 1];
    if (!newest || t - newest.t >= 1000 / NET.TICK_HZ - 2) this.recordHistory(t);

    const players = [...this.players.values()].map((p) => this.pub(p));
    const mechs = [...this.mechs.values()].map((m) => this.pubMech(m));
    this.broadcast({ t: 'snapshot', ts: t, players, mechs });
  }
}

const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

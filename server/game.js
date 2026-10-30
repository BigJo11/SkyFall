import { PLAYER, WEAPONS, PLAYER_COLORS, NET, MAX_LEGIT_SPEED, RESERVED, CREW_GLOW } from '../shared/constants.js';
import ARENA from '../shared/map.js';
import { solidAABBs, raycastAABBs, rayCapsule } from '../shared/collision.js';

const now = () => Date.now();
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
  constructor() {
    this.players = new Map();
    this.solids = solidAABBs(ARENA.boxes);
    this.nextId = 1;
    this.tickTimer = null;
    this.snapshotTimer = null;
    this.onBroadcast = () => {};
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

  addPlayer(socket, requestedName, crew = false) {
    const id = this.nextId++;
    const taken = new Set([...this.players.values()].map((p) => p.name));
    let name = sanitizeName(requestedName, `PLAYER ${id}`);
    // reserved callsigns need the crew code
    if (!crew && RESERVED.isReserved(name)) name = `PLAYER ${id}`;
    if (taken.has(name)) name = `${name} (${id})`.slice(0, NET.MAX_NAME + 4);

    const spawn = this.pickSpawn();
    const player = {
      id,
      name,
      socket,
      color: crew ? CREW_GLOW : PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length],
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
      lastShot: [0, 0, 0, 0],
      lastDamage: 0,
      kills: 0,
      deaths: 0,
      respawnAt: 0,
      lastInputAt: now(),
      lastInputPos: spawn.pos.slice(),
      lastFallDeath: 0,
    };
    this.players.set(id, player);

    this.send(player, {
      t: 'welcome',
      id,
      name,
      color: player.color,
      you: this.pub(player),
      players: [...this.players.values()].filter((p) => p.id !== id).map((p) => this.pub(p)),
      snapshotHz: NET.TICK_HZ,
    });
    this.broadcast({ t: 'join', player: this.pub(player) }, id);
    console.log(`[game] ${name} joined (${this.players.size} online)`);
    return player;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
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
      pos: [round2(p.pos[0]), round2(p.pos[1]), round2(p.pos[2])],
      yaw: round3(p.yaw),
      pitch: round3(p.pitch),
      hp: Math.max(0, Math.round(p.hp)),
      weapon: p.weapon,
      alive: p.alive,
      kills: p.kills,
      deaths: p.deaths,
      ammo: p.ammo[p.weapon],
      reloadEnd: p.reloadEnd ? Math.max(0, p.reloadEnd - now()) : 0,
    };
  }

  // ------------------------------------------------------------- spawning

  pickSpawn() {
    const living = [...this.players.values()].filter((p) => p.alive);
    let best = ARENA.spawns[0];
    let bestScore = -1;
    // random order so several simultaneous respawns spread out
    const shuffled = [...ARENA.spawns].sort(() => Math.random() - 0.5);
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
    p.lastShot = [0, 0, 0, 0];
    p.respawnAt = 0;
    p.lastInputPos = p.pos.slice();
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
    const dt = Math.max(0.01, Math.min(0.5, (t - p.lastInputAt) / 1000));
    p.lastInputAt = t;

    // basic sanity: reject teleports that no walking player could make
    const d = Math.hypot(nx - p.pos[0], nz - p.pos[2]);
    // generous enough for sprint jumps, slides, wall kicks and top momentum
    const maxStep = Math.max(MAX_LEGIT_SPEED, PLAYER.sprintSpeed * PLAYER.hspeedTolerance) * dt + 1.2;
    const rise = ny - p.pos[1];

    // reject teleports: sideways faster than sprinting, climbing faster than a
    // jump, or dropping further than terminal-ish velocity allows
    if (d > maxStep || rise > 4 || rise < -45) {
      this.send(p, { t: 'correct', pos: p.pos.slice() });
      return;
    }
    const bx = ARENA.bounds || { minX: -400, maxX: 400, minZ: -400, maxZ: 400 };
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

  // ------------------------------------------------------------- shooting

  onFire(p, msg) {
    if (!p.alive) return;
    const w = WEAPONS[p.weapon];
    const t = now();
    if (p.reloadEnd) return;
    // per-weapon cooldown: swapping guns can never cheat the fire rate
    if (t - p.lastShot[p.weapon] < w.interval - 20) return;

    if (Number.isFinite(w.magSize)) {
      if (p.ammo[p.weapon] <= 0) { this.startReload(p); return; }
      p.ammo[p.weapon]--;
      if (p.ammo[p.weapon] === 0) this.send(p, { t: 'empty', weapon: p.weapon });
    }
    p.lastShot[p.weapon] = t;

    // origin: server-authoritative eye position (fall back to the reported one)
    const origin = [p.pos[0], p.pos[1] + PLAYER.eye, p.pos[2]];
    let dir = norm3(msg.dir);
    if (!dir) {
      const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw), cp = Math.cos(p.pitch);
      dir = [-sy * cp, Math.sin(p.pitch), -cy * cp];
    }

    const worldHit = raycastAABBs(this.solids, origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], w.range);
    let endT = worldHit.t;
    let victim = null;
    const pad = w.melee ? 0.22 : 0.02;
    const radius = PLAYER.radius + pad;

    if (endT > 0.001) {
      for (const other of this.players.values()) {
        if (other === p || !other.alive) continue;
        const ht = rayCapsule(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], other.pos, PLAYER.height, radius, endT);
        if (ht < endT) { endT = ht; victim = other; }
      }
    }

    const end = [origin[0] + dir[0] * endT, origin[1] + dir[1] * endT, origin[2] + dir[2] * endT];

    this.broadcast({
      t: 'shot',
      id: p.id,
      weapon: w.id,
      from: origin.map(round2),
      to: end.map(round2),
      hit: victim ? victim.id : 0,
    });

    if (victim) {
      const killed = this.damage(victim, w.damage, p, w.id);
      this.send(p, { t: 'hitmark', dmg: w.damage, kill: killed, id: victim.id });
    }
  }

  // ------------------------------------------------------------- damage / death

  damage(target, dmg, attacker, weaponId) {
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
    });

    if (target.hp <= 0) {
      this.kill(target, attacker, weaponId);
      return true;
    }
    return false;
  }

  kill(victim, killer, weaponId) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.reloadEnd = 0;
    victim.respawnAt = now() + PLAYER.respawnTime;
    if (killer && killer !== victim) killer.kills++;

    this.broadcast({
      t: 'kill',
      killer: killer ? killer.id : 0,
      killerName: killer ? killer.name : null,
      victim: victim.id,
      victimName: victim.name,
      weapon: weaponId || null,
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

    const players = [...this.players.values()].map((p) => this.pub(p));
    this.broadcast({ t: 'snapshot', ts: t, players });
  }
}

const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

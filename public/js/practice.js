// Offline practice range and the tutorial that lives inside it.
// Both run with no server: dummies are local, damage is local, respawns are
// local. `ctx` is supplied by main.js and gives access to the live game state.
import { PLAYER, MOVE } from '../../shared/constants.js';
import ARENA, { PRACTICE } from '../../shared/map.js';
import { solidAABBs, raycastAABBs } from '../../shared/collision.js';

// Practice dummies are deliberately bad shots: slow reaction, huge spread,
// tiny damage. They exist to give you moving targets and something shooting
// back, not to beat you.
const DUMMY_AI = {
  speed: 2.6,             // m/s — they stroll
  roam: 7,                // metres around their post
  pauseMin: 0.5,
  pauseMax: 1.8,
  range: 34,              // only shoot inside this
  aimTime: 1.9,           // seconds of "aiming" before a shot
  spread: 0.17,           // huge scatter: they mostly miss
  damage: 3,
  cycleMin: 2.4,
  cycleMax: 4.2,
};

const PRACTICE_SOLIDS = solidAABBs(ARENA.boxes);

function aimAt(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  return [dx / len, dy / len, dz / len];
}

function clearLine(a, b) {
  const d = aimAt(a, b);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const hit = raycastAABBs(PRACTICE_SOLIDS, a[0], a[1], a[2], d[0], d[1], d[2], len);
  return hit.t >= len - 0.15;
}

// The firing line: the long open lane down the eastern ring road. The map
// exports it so the spawn, the lane and the wall-run wall stay in sync with
// the geometry (tests/map.test.mjs proves the lane is clear).
export const PRACTICE_SPAWN = { pos: PRACTICE.spawn.slice(), yaw: PRACTICE.yaw };

export const WALLRUN_SPOT = { pos: PRACTICE.wallRunSpot.slice(), yaw: PRACTICE.yaw };

// Dummies stand down the lane at increasing range so every weapon has a target.
const DUMMY_SPOTS = [
  { pos: [90, 0, -42], color: 0xff6b6b },
  { pos: [88, 0, -38], color: 0xffd166 },
  { pos: [92, 0, -34], color: 0x9dff6b },
  { pos: [89, 0, -29], color: 0x62d6ff },
  { pos: [93, 0, -25], color: 0xc792ff },
  { pos: [90, 0, -20], color: 0x64ffda },
];

const DUMMY_HP = 100;
const DUMMY_RESPAWN_MS = 1600;

let dummyId = 9001;

export class PracticeMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = 'practice';
    this.stats = { kills: 0, jumps: 0, wallRuns: 0, slides: 0, bestSpeed: 0 };
    // how badly the range is shooting back (used by the tests + balance work)
    this.aiStats = { shots: 0, hits: 0, damage: 0 };
    this.now = 0;
    this.finished = false;
    this.dummies = DUMMY_SPOTS.map((spot, i) => ({
      id: dummyId++,
      name: `DUMMY ${i + 1}`,
      color: spot.color,
      home: spot.pos.slice(),
      pos: spot.pos.slice(),
      yaw: Math.PI,
      pitch: 0,
      hp: DUMMY_HP,
      alive: true,
      respawnAt: 0,
      weapon: 0,
      kills: 0,
      deaths: 0,
      ai: {
        target: spot.pos.slice(),
        wait: Math.random() * 1.5,
        aim: 0,
        cycle: 0.6 + Math.random() * 1.6,
        wander: true,
      },
    }));
    // the tutorial uses still targets; practice dummies roam and shoot back
    this.aggressive = true;
  }

  start() {
    const { hud } = this.ctx;
    hud.showPractice(true);
    hud.practiceStats(this.stats);
    hud.centerMessage('PRACTICE RANGE', 1800);
    hud.toast('Dummies respawn when destroyed — no score pressure here', 4200);
    this.placePlayer(PRACTICE_SPAWN);
  }

  dispose() {
    this.ctx.hud.showPractice(false);
    this.ctx.hud.showObjective(null);
    this.ctx.hud.showObjectiveDone(false);
  }

  placePlayer(spawn = PRACTICE_SPAWN) {
    const { body, state, hud } = this.ctx;
    body.teleport(spawn.pos[0], spawn.pos[1], spawn.pos[2]);
    state.yaw = spawn.yaw;
    state.pitch = 0;
    state.camY = spawn.pos[1] + PLAYER.eye;
    state.hp = PLAYER.maxHealth;
    state.alive = true;
    hud.setHealth(state.hp);
    hud.hideDeath();
  }

  snapshots() {
    return this.dummies;
  }

  update(dt, now, body) {
    this.now = now;

    for (const d of this.dummies) {
      if (!d.alive && d.respawnAt && now >= d.respawnAt) {
        d.alive = true;
        d.hp = DUMMY_HP;
        d.pos = d.home.slice();
        d.respawnAt = 0;
      }
    }

    if (this.aggressive) this.updateDummies(dt, body);

    this.stats.bestSpeed = Math.max(this.stats.bestSpeed, body.speed);
    this.ctx.avatars.sync(this.snapshots(), -1);
    this.ctx.hud.practiceStats(this.stats);

    // fell into the void -> back to the range
    if (body.y < PLAYER.fallKillY) this.fallRespawn();
  }

  // -------------------------------------------------------- dummy behaviour
  updateDummies(dt, body) {
    const eye = [body.x, body.y + PLAYER.eye, body.z];
    for (const d of this.dummies) {
      if (!d.alive) continue;
      const ai = d.ai;

      // ---- wander around the post
      if (ai.wait > 0) {
        ai.wait -= dt;
      } else if (ai.wander) {
        // pick a spot once and actually walk to it, otherwise the target is
        // re-rolled every frame and the dummy just jitters in place
        if (!ai.pick) {
          ai.pick = [
            d.home[0] + (Math.random() - 0.5) * DUMMY_AI.roam * 2,
            d.home[2] + (Math.random() - 0.5) * DUMMY_AI.roam * 2,
          ];
        }
        const dx = ai.pick[0] - d.pos[0];
        const dz = ai.pick[1] - d.pos[2];
        const dist = Math.hypot(dx, dz);
        if (dist < 0.4) {
          ai.wait = DUMMY_AI.pauseMin + Math.random() * (DUMMY_AI.pauseMax - DUMMY_AI.pauseMin);
          ai.pick = null;
        } else {
          const step = Math.min(DUMMY_AI.speed * dt, dist);
          const nx = d.pos[0] + (dx / dist) * step;
          const nz = d.pos[2] + (dz / dist) * step;
          if (clearLine([nx, 0.6, nz], [nx, 0.6, nz + 0.001])
            && !blockedAt(nx, nz)) {
            d.pos[0] = nx;
            d.pos[2] = nz;
          } else {
            ai.wait = 0.35;
            ai.pick = null;
          }
        }
      }

      // ---- shooting: slow, telegraphed, wildly inaccurate
      const distToPlayer = Math.hypot(body.x - d.pos[0], body.z - d.pos[2]);
      const canSee = distToPlayer < DUMMY_AI.range
        && clearLine([d.pos[0], d.pos[1] + 1.5, d.pos[2]], eye);
      if (canSee) {
        // face the player while aiming
        d.yaw = Math.atan2(-(body.x - d.pos[0]), -(body.z - d.pos[2]));
        ai.cycle -= dt;
        if (ai.cycle <= 0.9 && ai.aim <= 0) ai.aim = DUMMY_AI.aimTime;
        if (ai.aim > 0) {
          ai.aim -= dt;
          if (ai.aim <= 0) {
            this.dummyShoot(d, eye);
            ai.cycle = DUMMY_AI.cycleMin + Math.random() * (DUMMY_AI.cycleMax - DUMMY_AI.cycleMin);
          }
        }
      } else {
        ai.aim = 0;
        ai.cycle = Math.max(ai.cycle, 0.6);
      }
    }
  }

  dummyShoot(d, eye) {
    const { effects, sfx, hud, state } = this.ctx;
    const from = [d.pos[0], d.pos[1] + 1.5, d.pos[2]];
    const d0 = aimAt(from, eye);
    // scattered around the aim point: sometimes a hit, mostly a warning
    const spread = DUMMY_AI.spread;
    const dir = [
      d0[0] + (Math.random() - 0.5) * spread * 2,
      d0[1] + (Math.random() - 0.5) * spread * 2,
      d0[2] + (Math.random() - 0.5) * spread * 2,
    ];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    dir[0] /= len; dir[1] /= len; dir[2] /= len;
    const dist = Math.hypot(eye[0] - from[0], eye[1] - from[1], eye[2] - from[2]);

    // where the round actually goes: the world, or the player's hitbox
    const worldHit = raycastAABBs(PRACTICE_SOLIDS, from[0], from[1], from[2],
      dir[0], dir[1], dir[2], dist + 30);
    let t = Math.min(worldHit.t, dist + 30);
    const toward = dir[0] * (eye[0] - from[0]) + dir[1] * (eye[1] - from[1]) + dir[2] * (eye[2] - from[2]);
    const closest = pointToSegment(from, dir, eye, dist);
    const hitPlayer = closest < PLAYER.radius + 0.35 && toward > 0 && t > dist;

    this.aiStats.shots++;
    if (hitPlayer) t = dist;
    const to = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
    effects.tracer(
      { x: from[0], y: from[1], z: from[2] },
      { x: to[0], y: to[1], z: to[2] },
      0xffc48a, 0.02
    );
    if (!hitPlayer) {
      const n = worldHit.aabb ? faceNormal(worldHit.aabb, to) : [0, 1, 0];
      effects.impact({ x: to[0], y: to[1], z: to[2] }, n, 'world');
    } else {
      this.aiStats.hits++;
      this.aiStats.damage += DUMMY_AI.damage;
      state.hp = Math.max(0, state.hp - DUMMY_AI.damage);
      hud.setHealth(state.hp);
      hud.damageFlash?.(0.45);
      hud.damageNumber(DUMMY_AI.damage, (Math.random() - 0.5) * 120, 30);
      sfx.hit?.(false);
      if (state.hp <= 0) this.playerDown();
    }
    sfx.shot?.('smg', 1);
  }

  playerDown() {
    const { hud, state, body } = this.ctx;
    hud.centerMessage('YOU WENT DOWN', 1400);
    this.placePlayer(PRACTICE_SPAWN);
    state.hp = PLAYER.maxHealth;
    hud.setHealth(state.hp);
    this.stats.deaths = (this.stats.deaths || 0) + 1;
    void body;
  }

  fallRespawn() {
    const { hud, sfx, effects, body } = this.ctx;
    effects.deathRing({ x: body.x, y: body.y + 1, z: body.z }, 0x62d6ff);
    hud.flash(0.3);
    hud.centerMessage('BACK IN THE RANGE', 1200);
    sfx.spawn();
    this.placePlayer(PRACTICE_SPAWN);
  }

  onEvent(type) {
    if (type === 'jump') this.stats.jumps++;
    else if (type === 'wallRun') this.stats.wallRuns++;
    else if (type === 'slide') this.stats.slides++;
  }

  // Called from main's fireOnce when the local ray hit an avatar.
  onLocalHit(avatar, weapon) {
    const { hud, sfx, effects } = this.ctx;
    const d = this.dummies.find((x) => x.id === avatar.id);
    if (!d || !d.alive) return false;

    d.hp -= weapon.damage;
    const killed = d.hp <= 0;
    if (killed) {
      d.hp = 0;
      d.alive = false;
      d.deaths++;
      d.respawnAt = this.now + DUMMY_RESPAWN_MS;
      this.stats.kills++;
      effects.deathRing({ x: d.pos[0], y: d.pos[1], z: d.pos[2] }, d.color);
      hud.killFeed(this.ctx.state.name || 'YOU', d.name, weapon.id, { killerIsMe: true });
    }
    hud.hitmarker(killed);
    hud.damageNumber(weapon.damage, (Math.random() - 0.5) * 110, -34 + (Math.random() - 0.5) * 46);
    sfx.hit(killed);
    return killed;
  }

  // Put a dummy a set distance in front of the player (used by the tutorial).
  placeDummyInFront(index, distance) {
    const { body, state } = this.ctx;
    const d = this.dummies[index % this.dummies.length];
    if (!d) return null;
    const fx = -Math.sin(state.yaw);
    const fz = -Math.cos(state.yaw);
    d.pos = [body.x + fx * distance, body.y, body.z + fz * distance];
    d.yaw = state.yaw + Math.PI;
    d.hp = DUMMY_HP;
    d.alive = true;
    d.respawnAt = 0;
    return d;
  }
}

function blockedAt(x, z) {
  for (const s of PRACTICE_SOLIDS) {
    if (x + 0.42 > s.minX && x - 0.42 < s.maxX && z + 0.42 > s.minZ && z - 0.42 < s.maxZ
      && s.maxY > 0.45 && s.minY < 1.8) return true;
  }
  return false;
}

function faceNormal(aabb, p) {
  const eps = 0.12;
  if (Math.abs(p[0] - aabb.minX) < eps) return [-1, 0, 0];
  if (Math.abs(p[0] - aabb.maxX) < eps) return [1, 0, 0];
  if (Math.abs(p[1] - aabb.minY) < eps) return [0, -1, 0];
  if (Math.abs(p[1] - aabb.maxY) < eps) return [0, 1, 0];
  if (Math.abs(p[2] - aabb.minZ) < eps) return [0, 0, -1];
  return [0, 0, 1];
}

// distance from the point `p` to the ray (origin + dir * max)
function pointToSegment(origin, dir, p, max) {
  const vx = p[0] - origin[0];
  const vy = p[1] - origin[1];
  const vz = p[2] - origin[2];
  const t = Math.max(0, Math.min(max, vx * dir[0] + vy * dir[1] + vz * dir[2]));
  return Math.hypot(vx - dir[0] * t, vy - dir[1] * t, vz - dir[2] * t);
}

// ------------------------------------------------------------------ tutorial

// The physics body reports movement events with past-tense names
// (`jumped`, `doubleJumped`, `wallRunStarted` ...) and main.js forwards them to
// the session with short ones (`jump`, `doubleJump`, `wallRun` ...). Every step
// predicate is written against the physics names, so normalise both spellings
// here. Without this the tutorial silently stalls on the jump step: the jump
// itself registers, the flag the step looks for never appears.
const EVENT_ALIASES = {
  jump: 'jumped',
  doubleJump: 'doubleJumped',
  wallRun: 'wallRunStarted',
  wallJump: 'wallJumped',
  slide: 'slideStarted',
};

export class Tutorial extends PracticeMode {
  constructor(ctx) {
    super(ctx);
    this.id = 'tutorial';
    this.aggressive = false;      // no roaming, no incoming fire while learning
    this.step = -1;
    this.stepCount = TUTORIAL_STEPS.length;
    this.travelled = 0;
    this.look = 0;
    this.flags = {};
    this.hits = { rifle: 0, sniper: 0, knife: 0 };
    this.kills = { rifle: 0, sniper: 0, knife: 0 };
    this.lastPos = null;
    this.completed = false;
    this.stepTime = 0;
  }

  start() {
    super.start();
    const { hud } = this.ctx;
    hud.showPractice(false);
    hud.toast('Tutorial: follow the objectives on the left', 4200);
    this.lastPos = [this.ctx.body.x, this.ctx.body.z];
    this.advance();
  }

  dispose() {
    super.dispose();
  }

  advance() {
    const { hud, sfx } = this.ctx;
    this.step++;
    this.stepTime = 0;
    this.flags = {};
    if (this.step >= TUTORIAL_STEPS.length) {
      this.finish();
      return;
    }
    const s = TUTORIAL_STEPS[this.step];
    hud.showObjective(s, this.step + 1, TUTORIAL_STEPS.length);
    sfx.objective();
    if (s.enter) s.enter(this.ctx, this);
  }

  skipStep() {
    if (this.completed) return;
    this.advance();
  }

  finish() {
    const { hud, sfx } = this.ctx;
    this.completed = true;
    hud.showObjective(null);
    hud.showObjectiveDone(true);
    hud.centerMessage('TUTORIAL COMPLETE', 2600);
    sfx.kill();
  }

  // main forwards discrete movement events here
  onEvent(type, data = {}) {
    super.onEvent(type, data);
    this.flags[type] = true;
    const canonical = EVENT_ALIASES[type];
    if (canonical) this.flags[canonical] = true;
    if (type === 'look') this.look += Math.abs(data.dx || 0) + Math.abs(data.dy || 0);
    if (type === 'weaponSwitched') this.flags[`weapon${data.index}`] = true;
    if (type === 'reload') this.flags.reload = true;
  }

  onLocalHit(avatar, weapon) {
    const killed = super.onLocalHit(avatar, weapon);
    const id = weapon.id;
    if (id in this.hits) {
      this.hits[id] += 1;
      if (killed) this.kills[id] += 1;
    }
    return killed;
  }

  update(dt, now, body) {
    super.update(dt, now, body);
    if (this.completed) return;

    // travel + look tracking
    if (this.lastPos) {
      const d = Math.hypot(body.x - this.lastPos[0], body.z - this.lastPos[1]);
      if (d < 5) this.travelled += d;
    }
    this.lastPos = [body.x, body.z];

    this.stepTime += dt;
    const s = TUTORIAL_STEPS[this.step];
    if (!s) return;

    const c = {
      body,
      travelled: this.travelled,
      look: this.look,
      speed: body.speed,
      peakSpeed: body.peakSpeed,
      onGround: body.onGround,
      flags: this.flags,
      hits: this.hits,
      kills: this.kills,
      time: this.stepTime,
    };
    if (s.done(c)) {
      this.ctx.sfx.objectiveDone();
      this.advance();
    }
  }
}

// ------------------------------------------------------------------- steps

const aimAtDummy = (ctx, tutorial, index, distance) => {
  const d = tutorial.placeDummyInFront(index, distance);
  if (!d) return;
  // face the dummy so the player only has to pull the trigger
  const dx = d.pos[0] - ctx.body.x;
  const dz = d.pos[2] - ctx.body.z;
  ctx.state.yaw = Math.atan2(-dx, -dz);
  ctx.state.pitch = 0;
};

export const TUTORIAL_STEPS = [
  {
    id: 'move',
    title: 'MOVE',
    text: 'Hold W A S D to move around the arena.',
    tip: 'WASD',
    done: (c) => c.travelled > 8,
  },
  {
    id: 'look',
    title: 'LOOK',
    text: 'Move the mouse to look around. Your aim follows your view.',
    tip: 'MOUSE',
    done: (c) => c.look > 500,
  },
  {
    id: 'jump',
    title: 'JUMP',
    text: 'Press SPACE to jump.',
    tip: 'SPACE',
    done: (c) => c.flags.jumped,
  },
  {
    id: 'sprint',
    title: 'SPRINT',
    text: 'Hold SHIFT while moving to sprint. In the air you keep whatever speed you leave the ground with.',
    tip: 'SHIFT + WASD',
    done: (c) => c.onGround && c.speed > 8.3,
  },
  {
    id: 'sprintjump',
    title: 'SPRINT JUMP',
    text: 'Jump while sprinting. Your speed carries through the whole jump — but landing on your feet kills it.',
    tip: 'SHIFT + WASD + SPACE',
    done: (c) => c.flags.sprintJump,
  },
  {
    id: 'doublejump',
    title: 'DOUBLE JUMP',
    text: 'Press SPACE again in mid-air. A double jump costs a little speed, but keeps most of it.',
    tip: 'SPACE · SPACE',
    done: (c) => c.flags.doubleJumped,
  },
  {
    id: 'wallrun',
    title: 'WALL RUN',
    text: 'Sprint along the wall and jump: you will run along it instead of falling. Jump again to kick off.',
    tip: 'SPRINT + JUMP NEXT TO A WALL',
    enter: (ctx) => {
      ctx.place(WALLRUN_SPOT.pos, WALLRUN_SPOT.yaw);
      ctx.hud.toast('Sprint forward (SHIFT+W) and jump next to the wall', 5000);
    },
    done: (c) => c.flags.wallRunStarted,
  },
  {
    id: 'walljump',
    title: 'WALL KICK',
    text: 'While wall running, press SPACE to kick off the wall. This also refreshes your double jump.',
    tip: 'SPACE DURING WALL RUN',
    done: (c) => c.flags.wallJumped,
  },
  {
    id: 'slide',
    title: 'SLIDE',
    text: 'While sprinting, press C (or CTRL) to slide. Jump out of a slide to keep the speed going.',
    tip: 'SHIFT + WASD, THEN C',
    done: (c) => c.flags.slideStarted,
  },
  {
    id: 'carry',
    title: 'CARRY SPEED',
    text: 'Landing normally throws your speed away. Press C just before you touch down to slide out of the jump, or press SPACE as you land, and keep all of it.',
    tip: 'JUMP, THEN C — OR SPACE ON TOUCHDOWN',
    done: (c) => (c.flags.slideLanding || c.flags.perfectLanding) && c.speed > 10.5,
  },
  {
    id: 'rifle',
    title: 'RIFLE',
    text: 'Six rifle shots kill. A dummy has been placed in front of you — light it up.',
    tip: 'LEFT MOUSE',
    enter: (ctx, t) => {
      ctx.place(PRACTICE_SPAWN.pos, PRACTICE_SPAWN.yaw);
      ctx.switchWeapon(0);
      aimAtDummy(ctx, t, 0, 9);
    },
    done: (c) => c.hits.rifle >= 3,
  },
  {
    id: 'sniper',
    title: 'SNIPER',
    text: 'The sniper does 100 damage: one shot, one kill, but 3.5 seconds between shots. Right-click to scope.',
    tip: 'KEY 2 · RIGHT MOUSE TO SCOPE',
    enter: (ctx, t) => {
      ctx.place(PRACTICE_SPAWN.pos, PRACTICE_SPAWN.yaw);
      ctx.switchWeapon(1);
      aimAtDummy(ctx, t, 1, 16);
    },
    done: (c) => c.kills.sniper >= 1,
  },
  {
    id: 'knife',
    title: 'KNIFE',
    text: 'Get in close and knife the dummy. One hit kills, with a 0.5 second swing cooldown.',
    tip: 'KEY 4 · LEFT MOUSE',
    enter: (ctx, t) => {
      ctx.place(PRACTICE_SPAWN.pos, PRACTICE_SPAWN.yaw);
      ctx.switchWeapon(3);
      aimAtDummy(ctx, t, 2, 2.1);
    },
    done: (c) => c.kills.knife >= 1,
  },
  {
    id: 'reload',
    title: 'RELOAD',
    text: 'Press R to reload. Your magazine refills after a short animation.',
    tip: 'R',
    enter: (ctx) => {
      ctx.place(PRACTICE_SPAWN.pos, PRACTICE_SPAWN.yaw);
      ctx.switchWeapon(0);
      ctx.state.ammo[0] = 2;
      ctx.hud.setAmmo(2);
    },
    done: (c) => c.flags.reload,
  },
  {
    id: 'done',
    title: 'YOU ARE READY',
    text: 'That is everything. Deploy into an online match, or stay and keep practising.',
    tip: 'GOOD LUCK',
    done: (c) => c.time > 2.5,
  },
];

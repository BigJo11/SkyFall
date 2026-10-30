// Offline practice range and the tutorial that lives inside it.
// Both run with no server: dummies are local, damage is local, respawns are
// local. `ctx` is supplied by main.js and gives access to the live game state.
import { PLAYER, MOVE } from '../../shared/constants.js';
import { PRACTICE } from '../../shared/map.js';

// The firing line: the long open lane down the eastern ring road. The map
// exports it so the spawn, the lane and the wall-run wall stay in sync with
// the geometry (tests/map.test.mjs proves the lane is clear).
export const PRACTICE_SPAWN = { pos: PRACTICE.spawn.slice(), yaw: PRACTICE.yaw };

export const WALLRUN_SPOT = { pos: PRACTICE.wallRunSpot.slice(), yaw: PRACTICE.yaw };

// Dummies stand down the lane at increasing range so every weapon has a target.
const DUMMY_SPOTS = [
  { pos: [60, 0, -21], color: 0xff6b6b },
  { pos: [61, 0, -17], color: 0xffd166 },
  { pos: [59, 0, -13], color: 0x9dff6b },
  { pos: [62, 0, -9], color: 0x62d6ff },
  { pos: [58, 0, -5], color: 0xc792ff },
  { pos: [60, 0, -2], color: 0x64ffda },
];

const DUMMY_HP = 100;
const DUMMY_RESPAWN_MS = 1600;

let dummyId = 9001;

export class PracticeMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = 'practice';
    this.stats = { kills: 0, jumps: 0, wallRuns: 0, slides: 0, bestSpeed: 0 };
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
    }));
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

    this.stats.bestSpeed = Math.max(this.stats.bestSpeed, body.speed);
    this.ctx.avatars.sync(this.snapshots(), -1);
    this.ctx.hud.practiceStats(this.stats);

    // fell into the void -> back to the range
    if (body.y < PLAYER.fallKillY) this.fallRespawn();
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

// ------------------------------------------------------------------ tutorial

export class Tutorial extends PracticeMode {
  constructor(ctx) {
    super(ctx);
    this.id = 'tutorial';
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
    text: 'Landing normally throws your speed away. Press C just before you touch down to slide out of the jump and keep all of it.',
    tip: 'JUMP, THEN C BEFORE LANDING',
    done: (c) => c.flags.slideLanding && c.speed > 10.5,
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

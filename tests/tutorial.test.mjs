// Practice range + tutorial state machine, driven with a stubbed context.
//   node tests/tutorial.test.mjs
import assert from 'node:assert/strict';
import { PracticeMode, Tutorial, TUTORIAL_STEPS } from '../public/js/practice.js';
import { WEAPONS } from '../shared/constants.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// ---------------------------------------------------------------- stubs
function makeCtx() {
  const log = [];
  const hud = new Proxy({
    objective: null,
    objectiveDone: false,
  }, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return (...args) => {
        log.push([prop, ...args]);
        if (prop === 'showObjective') t.objective = args[0];
        if (prop === 'showObjectiveDone') t.objectiveDone = args[0];
      };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  const body = {
    x: 0, y: 0.05, z: 18, momentum: 0, speed: 0, onGround: true,
    teleport(x, y, z) { this.x = x; this.y = y; this.z = z; },
    reset() {},
    events: {},
  };
  const state = { name: 'TESTER', yaw: 0, pitch: 0, camY: 1.6, hp: 100, alive: true, ammo: WEAPONS.map((w) => w.magSize), weapon: 0 };
  const ctx = {
    state, body, hud, log,
    sfx: new Proxy({}, { get: () => () => {} }),
    effects: new Proxy({}, { get: () => () => {} }),
    avatars: { sync(players) { ctx.lastSync = players; } },
    scene: {},
    switchWeapon(i) { state.weapon = i; log.push(['switchWeapon', i]); },
    place(pos, yaw) {
      body.x = pos[0]; body.y = pos[1]; body.z = pos[2];
      state.yaw = yaw;
      log.push(['place', pos, yaw]);
    },
  };
  return ctx;
}

const weapon = (id) => WEAPONS.find((w) => w.id === id);
const avatarFor = (dummy) => ({ id: dummy.id });

console.log('\nSKYFALL practice + tutorial tests\n');

console.log('practice range:');

test('starts with a full set of dummies at full health', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  assert.equal(p.dummies.length, 6);
  assert.ok(p.dummies.every((d) => d.hp === 100 && d.alive));
  assert.ok(ctx.log.some((l) => l[0] === 'showPractice' && l[1] === true), 'practice panel shown');
});

test('shooting a dummy damages it and a kill queues a respawn', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  p.update(1 / 60, 1000, ctx.body);
  const d = p.dummies[0];

  p.onLocalHit(avatarFor(d), weapon('rifle'));
  assert.equal(d.hp, 83);
  assert.equal(p.stats.kills, 0);

  // finish it off with the sniper
  const killed = p.onLocalHit(avatarFor(d), weapon('sniper'));
  assert.equal(killed, true);
  assert.equal(d.alive, false);
  assert.equal(d.hp, 0);
  assert.equal(p.stats.kills, 1);
  assert.ok(d.respawnAt > p.now, 'respawn scheduled');
  assert.ok(ctx.log.some((l) => l[0] === 'hitmarker' && l[1] === true), 'kill hitmarker');
  assert.ok(ctx.log.some((l) => l[0] === 'killFeed'), 'kill added to the feed');
});

test('dead dummies ignore further hits and come back at full health', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  p.update(1 / 60, 1000, ctx.body);
  const d = p.dummies[1];
  p.onLocalHit(avatarFor(d), weapon('sniper'));
  assert.equal(d.alive, false);
  assert.equal(p.onLocalHit(avatarFor(d), weapon('sniper')), false, 'no damage while dead');
  p.update(1 / 60, d.respawnAt + 1, ctx.body);
  assert.equal(d.alive, true);
  assert.equal(d.hp, 100);
  assert.deepEqual(d.pos, d.home);
});

test('falling out of the world puts you back on the range', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.body.y = -50;
  p.update(1 / 60, 2000, ctx.body);
  assert.equal(ctx.body.y, 0.05, 'teleported back to the practice spawn');
  assert.equal(ctx.state.hp, 100);
});

test('movement stats are collected', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  p.onEvent('jump');
  p.onEvent('jump');
  p.onEvent('wallRun');
  p.onEvent('slide');
  ctx.body.momentum = 0.42;
  p.update(1 / 60, 3000, ctx.body);
  assert.deepEqual(
    { jumps: p.stats.jumps, wallRuns: p.stats.wallRuns, slides: p.stats.slides },
    { jumps: 2, wallRuns: 1, slides: 1 }
  );
  assert.ok(Math.abs(p.stats.bestMomentum - 0.42) < 1e-6);
});

test('dummies are pushed to the avatar renderer every frame', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  p.update(1 / 60, 3200, ctx.body);
  assert.equal(ctx.lastSync.length, 6);
  assert.equal(ctx.lastSync[0].id, p.dummies[0].id);
});

console.log('\ntutorial:');

function tutorialAt(stepId) {
  const ctx = makeCtx();
  const t = new Tutorial(ctx);
  t.start();
  let guard = 0;
  while (TUTORIAL_STEPS[t.step].id !== stepId && guard++ < 40) t.skipStep();
  assert.equal(TUTORIAL_STEPS[t.step].id, stepId, `reached ${stepId}`);
  return { ctx, t };
}

test('opens on the MOVE objective and shows the panel', () => {
  const ctx = makeCtx();
  const t = new Tutorial(ctx);
  t.start();
  assert.equal(t.step, 0);
  assert.equal(TUTORIAL_STEPS[0].id, 'move');
  assert.ok(ctx.hud.objective, 'objective panel filled');
  assert.equal(ctx.hud.objective.title, 'MOVE');
  assert.equal(t.stepCount, TUTORIAL_STEPS.length);
});

test('travelling advances from MOVE to LOOK', () => {
  const ctx = makeCtx();
  const t = new Tutorial(ctx);
  t.start();
  for (let i = 0; i < 40; i++) {
    ctx.body.x += 0.3;                 // 12 m of travel
    t.update(1 / 60, 1000 + i * 16, ctx.body);
  }
  assert.equal(TUTORIAL_STEPS[t.step].id, 'look');
});

test('mouse movement advances LOOK to JUMP', () => {
  const { ctx, t } = tutorialAt('look');
  for (let i = 0; i < 10; i++) t.onEvent('look', { dx: 60, dy: 20 });
  t.update(1 / 60, 2000, ctx.body);
  assert.equal(TUTORIAL_STEPS[t.step].id, 'jump');
});

test('each movement technique advances its own step', () => {
  const cases = [
    ['jump', 'jumped', 'sprint'],
    ['sprint', null, 'sprintjump'],
    ['sprintjump', 'sprintJump', 'doublejump'],
    ['doublejump', 'doubleJumped', 'wallrun'],
    ['wallrun', 'wallRunStarted', 'walljump'],
    ['walljump', 'wallJumped', 'slide'],
    ['slide', 'slideStarted', 'momentum'],
  ];
  for (const [from, flag, to] of cases) {
    const { ctx, t } = tutorialAt(from);
    if (from === 'sprint') {
      ctx.body.speed = 9.5;
      ctx.body.onGround = true;
    } else {
      t.onEvent(flag);
    }
    t.update(1 / 60, 3000, ctx.body);
    assert.equal(TUTORIAL_STEPS[t.step].id, to, `${from} -> ${to}`);
  }
});

test('the momentum step needs half a meter filled', () => {
  const { ctx, t } = tutorialAt('momentum');
  ctx.body.momentum = 0.3;
  t.update(1 / 60, 4000, ctx.body);
  assert.equal(TUTORIAL_STEPS[t.step].id, 'momentum', 'not yet');
  ctx.body.momentum = 0.6;
  t.update(1 / 60, 4016, ctx.body);
  assert.equal(TUTORIAL_STEPS[t.step].id, 'rifle');
});

test('shooting steps equip the right weapon and place a dummy in front', () => {
  const { ctx, t } = tutorialAt('rifle');
  assert.equal(ctx.state.weapon, 0, 'rifle equipped');
  const d = t.dummies[0];
  const ahead = Math.hypot(d.pos[0] - ctx.body.x, d.pos[2] - ctx.body.z);
  assert.ok(Math.abs(ahead - 9) < 0.01, `dummy placed 9 m ahead (${ahead.toFixed(2)} m)`);

  // three rifle hits advance to the sniper
  for (let i = 0; i < 3; i++) t.onLocalHit(avatarFor(d), weapon('rifle'));
  t.update(1 / 60, 5000, ctx.body);
  assert.equal(TUTORIAL_STEPS[t.step].id, 'sniper');
  assert.equal(ctx.state.weapon, 1, 'sniper equipped');

  // one sniper kill advances to the knife
  const d2 = t.dummies[1];
  t.onLocalHit(avatarFor(d2), weapon('sniper'));
  t.update(1 / 60, 5016, ctx.body);
  assert.equal(TUTORIAL_STEPS[t.step].id, 'knife');
  assert.equal(ctx.state.weapon, 3, 'knife equipped');

  const d3 = t.dummies[2];
  t.onLocalHit(avatarFor(d3), weapon('knife'));
  t.update(1 / 60, 5032, ctx.body);
  assert.equal(TUTORIAL_STEPS[t.step].id, 'reload');
  assert.equal(ctx.state.ammo[0], 2, 'rifle left with a low magazine to reload');
});

test('reloading and reading the last card completes the tutorial', () => {
  const { ctx, t } = tutorialAt('reload');
  t.onEvent('reload');
  t.update(1 / 60, 6000, ctx.body);
  assert.equal(TUTORIAL_STEPS[t.step].id, 'done');
  // the final card needs a moment on screen
  t.update(1 / 60, 6000, ctx.body);
  assert.equal(t.completed, false);
  for (let i = 0; i < 200; i++) t.update(1 / 60, 6100 + i * 16, ctx.body);
  assert.equal(t.completed, true);
  assert.equal(ctx.hud.objectiveDone, true, 'completion overlay shown');
});

test('skipping walks straight through every step', () => {
  const ctx = makeCtx();
  const t = new Tutorial(ctx);
  t.start();
  for (let i = 0; i < TUTORIAL_STEPS.length + 2; i++) t.skipStep();
  assert.equal(t.completed, true);
});

test('hits with the wrong weapon do not advance kill steps', () => {
  const { ctx, t } = tutorialAt('sniper');
  const d = t.dummies[1];
  // SMG hits are tracked but the step wants a sniper kill
  for (let i = 0; i < 5; i++) t.onLocalHit(avatarFor(d), weapon('smg'));
  t.update(1 / 60, 7000, ctx.body);
  assert.equal(TUTORIAL_STEPS[t.step].id, 'sniper');
});

test('practice stats are hidden during the tutorial', () => {
  const ctx = makeCtx();
  const t = new Tutorial(ctx);
  t.start();
  const calls = ctx.log.filter((l) => l[0] === 'showPractice');
  assert.ok(calls.some((l) => l[1] === false), 'stats panel hidden');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

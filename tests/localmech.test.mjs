// The mech offline: practice and the tutorial have no server, so the range
// simulates the mech itself. These tests cover that simulation, the Core that
// pays for it, and the punch geometry that makes it usable at all.
//   node tests/localmech.test.mjs
import assert from 'node:assert/strict';
import { PracticeMode } from '../public/js/practice.js';
import { LocalMech } from '../public/js/localmech.js';
import { PLAYER, MECH, CORE, WEAPONS, MECH_COSMETIC } from '../shared/constants.js';
import { chassisHealth } from '../shared/mech.js';
import { rayCapsule } from '../shared/collision.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const noop = () => new Proxy({}, { get: () => () => {} });

function makeCtx() {
  const state = {
    name: 'TESTER', yaw: 0, pitch: 0, camY: 1.6, hp: PLAYER.maxHealth, alive: true,
    ammo: WEAPONS.map((w) => w.magSize), weapon: 0,
    core: 0, mech: null, mechAllowed: true, coreFailEndsAt: 0,
  };
  const body = {
    x: 90, y: 0.05, z: -30, vx: 0, vy: 0, vz: 0,
    momentum: 0, speed: 0, onGround: true, airJumps: 0,
    wallRun: false, sliding: false, events: {},
    teleport(x, y, z) { this.x = x; this.y = y; this.z = z; },
    reset() {},
  };
  const ctx = {
    state, body, hud: noop(), sfx: noop(), effects: noop(),
    avatars: { sync() {} }, scene: {}, camera: {},
    switchWeapon(i) { state.weapon = i; },
    place(p, y) { body.x = p[0]; body.y = p[1]; body.z = p[2]; state.yaw = y; },
    clock: 1000,                 // one clock per session, always moving forward
  };
  return ctx;
}

const weapon = (id) => WEAPONS.find((w) => w.id === id);

// Drive the session forward, the way main.js's frame loop does. The clock only
// ever moves forward, so a mech that is falling keeps falling.
function run(p, ctx, frames, dtMs = 16) {
  for (let i = 0; i < frames; i++) {
    ctx.clock += dtMs;
    p.update(1 / 60, ctx.clock, ctx.body);
  }
  return ctx.clock;
}

// Kill a dummy the same way fireOnce does. A dummy has a player's 100 health,
// so anything short of a sniper round needs more than one hit.
function killDummy(p, id = 'sniper') {
  const d = p.dummies.find((x) => x.alive);
  const w = weapon(id);
  let killed = false;
  for (let i = 0; i < 30 && !killed; i++) killed = p.onLocalHit({ id: d.id }, w);
  assert.equal(killed, true, `${id} killed the dummy`);
  return d;
}

console.log('\nSKYFALL offline mech tests\n');

// ------------------------------------------------------------------- the Core

console.log('the Core offline:');

test('a dummy kill charges the Core at the faster offline rate', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  killDummy(p);
  assert.equal(ctx.state.core, CORE.practicePerKill);
});

test('two kills fill it, where a match would need ten', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  killDummy(p);
  killDummy(p);
  assert.equal(ctx.state.core, CORE.max, 'full after two');
  assert.ok(CORE.practicePerKill > CORE.perKill, 'and faster than online');
});

test('it stops at full rather than banking spare charge', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  killDummy(p);
  killDummy(p);
  assert.equal(ctx.state.core, CORE.max, 'full after two');
  // let the range repopulate and kill again: still no more than full
  run(p, ctx, 130);
  killDummy(p);
  assert.equal(ctx.state.core, CORE.max, 'still capped');
});

test('a movement combo pays, and the cooldown stops it being farmed', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  run(p, ctx, 1);                 // settle the clock
  p.onTraversal('wallrun');
  p.onTraversal('walljump');          // two different moves: a combo
  assert.equal(ctx.state.core, CORE.practicePerCombo);

  // inside the cooldown, another combo pays nothing
  p.onTraversal('doublejump');
  assert.equal(ctx.state.core, CORE.practicePerCombo, 'the cooldown held');

  // once it lapses, a fresh pair pays again
  run(p, ctx, Math.ceil((CORE.comboCooldownMs + 50) / 16));
  p.onTraversal('slide');
  p.onTraversal('doublejump');
  assert.equal(ctx.state.core, CORE.practicePerCombo * 2);
});

test('the same move twice is just moving, not a combo', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  run(p, ctx, 1);
  p.onTraversal('wallrun');
  p.onTraversal('wallrun');
  assert.equal(ctx.state.core, 0);
});

test('the Core survives death, as it does online', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  killDummy(p);
  const before = ctx.state.core;
  p.playerDown();
  assert.equal(ctx.state.core, before, 'still charged after going down');
});

// ------------------------------------------------------------------- deploy

console.log('\ncalling one down:');

test('a full Core deploys a mech and is spent doing it', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  assert.ok(p.mechSim.exists, 'a mech exists');
  assert.equal(p.mechSim.state, 'dropping', 'starts in the sky');
  assert.equal(ctx.state.core, 0, 'spent the moment it was called');
});

test('a part-full Core does nothing', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max - 1;
  p.onMechCommand('deploy');
  assert.equal(p.mechSim.exists, false);
});

test('it will not deploy when the map has no room for one', () => {
  const ctx = makeCtx();
  ctx.state.mechAllowed = false;
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  assert.equal(p.mechSim.exists, false);
});

test('it falls from the sky and lands on the pilot', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  assert.ok(p.mechSim.snapshot().pos[1] > MECH.dropHeight / 2, 'starts high up');

  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);
  assert.equal(p.mechSim.state, 'active', 'landed');
  assert.ok(Math.abs(p.mechSim.snapshot().pos[1] - ctx.body.y) < 0.5, 'at the pilot');
});

test('once landed it rides exactly where the pilot walks', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);
  ctx.body.x += 12;
  run(p, ctx, 2);
  assert.ok(Math.abs(p.mechSim.snapshot().pos[0] - ctx.body.x) < 0.001, 'it followed');
});

// ------------------------------------------------------------------- damage

console.log('\narmour, not the pilot:');

test('incoming fire hits the mech and leaves the pilot alone', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);

  const pilotHp = ctx.state.hp;
  p.damageMech(120);
  assert.equal(p.mechSim.hp, MECH.maxHealth - 120, 'the armour took it');
  assert.equal(ctx.state.hp, pilotHp, 'the pilot did not');
});

test('a raised shield eats the whole hit', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);

  p.onMechCommand('shield');
  assert.ok(p.mechSim.snapshot().shield.time > 0, 'the shield is up');
  p.damageMech(200);
  assert.equal(p.mechSim.hp, MECH.maxHealth, 'not a scratch');
});

test('the shield refills, and can be raised early for less time', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);

  p.onMechCommand('shield');
  const full = p.mechSim.snapshot().shield.time;
  assert.ok(Math.abs(full - MECH.shield.duration) < 0.01, 'five seconds from full');

  // let it run out, then raise it half-charged
  run(p, ctx, Math.ceil((MECH.shield.duration + 1) * 60));
  run(p, ctx, Math.ceil(MECH.shield.recharge * 0.5 * 60));
  p.onMechCommand('shield');
  const half = p.mechSim.snapshot().shield.time;
  assert.ok(half > 0, 'it came up');
  assert.ok(half < full, `proportionally less (${half.toFixed(2)}s < ${full.toFixed(2)}s)`);
});

test('zero health is a core failure, not a clean stop', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);

  p.damageMech(MECH.maxHealth);
  assert.equal(p.mechSim.state, 'core-failure');
  assert.ok(ctx.state.coreFailEndsAt > 0, 'the countdown is running');
});

test('dummies aim at the bigger target a mech presents', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);

  const d = p.dummies[0];
  d.pos = [ctx.body.x, 0, ctx.body.z + 6];   // well inside their range
  const real = Math.random;
  Math.random = () => 0.5;                   // take the spread out of it
  try {
    p.dummyShoot(d, [ctx.body.x, ctx.body.y + PLAYER.eye, ctx.body.z]);
  } finally {
    Math.random = real;
  }
  assert.ok(p.mechSim.hp < MECH.maxHealth, 'the mech was hit, not the pilot');
  assert.equal(ctx.state.hp, PLAYER.maxHealth, 'the pilot is untouched');
});

// -------------------------------------------------------------------- eject

console.log('\ngetting out:');

test('three presses punch you out and the mech goes up', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);
  p.damageMech(MECH.maxHealth);

  p.onMechCommand('eject');
  p.onMechCommand('eject');
  assert.equal(p.mechSim.state, 'core-failure', 'still aboard after two');
  p.onMechCommand('eject');
  assert.equal(ctx.state.mech, null, 'out, and the mech is gone');
  assert.equal(ctx.state.hp, PLAYER.maxHealth, 'and alive');
});

test('missing the window takes the pilot with it', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  ctx.state.hp = 40;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);
  p.damageMech(MECH.maxHealth);

  // never press V: let the five seconds run out
  run(p, ctx, Math.ceil(MECH.coreFailure.durationMs / 16) + 20);
  assert.equal(ctx.state.mech, null, 'the mech is gone');
  assert.equal(ctx.state.hp, PLAYER.maxHealth, 'respawned');
});

test('the blast kills dummies up close and spares the far ones', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  // park one dummy on top of us and another well clear
  p.dummies[0].pos = [ctx.body.x + 1, 0, ctx.body.z];
  p.dummies[1].pos = [ctx.body.x + MECH.explosion.radius + 25, 0, ctx.body.z];
  const near = p.dummies[0];
  const far = p.dummies[1];

  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);
  p.damageMech(MECH.maxHealth);
  p.onMechCommand('eject');
  p.onMechCommand('eject');
  p.onMechCommand('eject');

  assert.equal(near.alive, false, 'the one on top of it died');
  assert.equal(far.alive, true, 'the one a long way off is fine');
});

test('a falling pilot loses the mech without a blast', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);
  assert.ok(p.mechSim.exists);
  ctx.body.y = PLAYER.fallKillY - 1;         // into the void
  run(p, ctx, 2);
  assert.equal(p.mechSim.exists, false, 'no mech survives the fall');
  assert.equal(ctx.state.mech, null);
});

// -------------------------------------------------------------- the punch

console.log('\nthe punch:');

test('a punch from the cockpit can reach someone on the ground', () => {
  // This is the whole reason for the numbers in MECH.punch: the swing leaves
  // the eye at 7.4m, so a short reach sails harmlessly over everyone's head.
  const oy = MECH.eyeHeight;
  for (const away of [1, 3, 5, 6]) {
    const feet = [0, 0, away];
    const d = [0, PLAYER.height * 0.5 - oy, away];
    const L = Math.hypot(d[0], d[1], d[2]);
    const t = rayCapsule(0, oy, 0, d[0] / L, d[1] / L, d[2] / L,
      feet, PLAYER.height, MECH.punch.radius, MECH.punch.range);
    assert.ok(t < MECH.punch.range, `a target ${away}m away is reachable`);
  }
});

test('the reach clears the drop from the cockpit to the ground', () => {
  const drop = MECH.eyeHeight - (PLAYER.height + MECH.punch.radius);
  assert.ok(MECH.punch.range > drop,
    `reach ${MECH.punch.range}m must exceed the ${drop.toFixed(2)}m drop`);
});

test('a punch kills a dummy in one swing', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);

  const d = p.dummies.find((x) => x.alive);
  const punch = { ...weapon('knife'), ...MECH.punch, name: 'PUNCH' };
  const killed = p.onLocalHit({ id: d.id }, punch);
  assert.equal(killed, true, 'one swing, one kill');
  assert.equal(d.alive, false);
});

test('the punch is the knife slot, and the Core still pays for it', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);
  assert.equal(ctx.state.core, 0, 'spent on the deploy');

  const d = p.dummies.find((x) => x.alive);
  p.onLocalHit({ id: d.id }, { ...weapon('knife'), ...MECH.punch });
  assert.equal(ctx.state.core, CORE.practicePerKill, 'a punch is a kill like any other');
});

// ------------------------------------------------------------ LocalMech unit

console.log('\nthe simulation itself:');

test('it refuses to deploy twice', () => {
  const m = new LocalMech(0);
  assert.ok(m.deploy([0, 0, 0], 0, 1000));
  assert.equal(m.deploy([0, 0, 0], 0, 1000), null, 'a second one is refused');
});

test('the shield will not come up off an empty charge', () => {
  const m = new LocalMech(0);
  m.deploy([0, 0, 0], 0, 1000);
  m.update(0.016, 1000, [0, 0, 0], 0);
  m.update(3, 5000, [0, 0, 0], 0);           // finish the drop
  m.mech.shield = { charge: 0, time: 0 };
  assert.equal(m.raise(), 0, 'nothing to raise');
  m.mech.shield = { charge: MECH.shield.minToRaise, time: 0 };
  assert.ok(m.raise() > 0, 'and it comes up at the minimum');
});

test('a dead mech takes no more damage and never heals itself', () => {
  const m = new LocalMech(0);
  m.deploy([0, 0, 0], 0, 1000);
  m.update(3, 5000, [0, 0, 0], 0);
  m.hit(MECH.maxHealth);
  assert.equal(m.state, 'core-failure');
  assert.equal(m.hit(500).killed, false, 'stops taking hits');
  assert.equal(m.hp, 0);
});

test('the drill puts a healthy mech straight into core failure', () => {
  const m = new LocalMech(0);
  m.deploy([0, 0, 0], 0, 1000);
  m.update(3, 5000, [0, 0, 0], 0);
  m.mech.shield = { charge: 1, time: 5 };     // shield up: it must not absorb
  assert.equal(m.forceCoreFailure(), true);
  assert.equal(m.state, 'core-failure');
  assert.equal(m.hp, 0);
});

// ------------------------------------------------------------------- chassis

console.log('\nchassis:');

test('the range builds the chassis you picked, at its own health', () => {
  for (const c of MECH.chassis) {
    const ctx = makeCtx();
    ctx.state.mechCosmetic = { ...MECH_COSMETIC.default, chassis: c.id };
    const p = new PracticeMode(ctx);
    p.start();
    ctx.state.core = CORE.max;
    p.onMechCommand('deploy');
    assert.equal(p.mechSim.state, 'dropping');
    assert.equal(p.mechSim.hp, c.hp, `${c.name} comes in with ${c.hp}`);
    assert.equal(ctx.state.mech.maxHp, c.hp);
    assert.equal(ctx.state.mech.chassis, c.id);
  }
});

test('an unknown chassis is the standard one', () => {
  const ctx = makeCtx();
  ctx.state.mechCosmetic = { ...MECH_COSMETIC.default, chassis: 'nonsense' };
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  assert.equal(ctx.state.mech.chassis, MECH.defaultChassis);
  assert.equal(p.mechSim.hp, chassisHealth(MECH.defaultChassis));
});

test('the cockpit HUD shows the health the chassis actually has', () => {
  const ctx = makeCtx();
  ctx.state.mechCosmetic = { ...MECH_COSMETIC.default, chassis: 'light' };
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);
  assert.equal(ctx.state.mech.maxHp, 500, 'a Kestrel is a 500 HP mech');
});

// ------------------------------------------------------------ the mech's guns

console.log('\nthe guns:');

test('a mech rifle hits a dummy twice as hard', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  const d = p.dummies[0];
  const before = d.hp;
  p.onLocalHit({ id: d.id }, weapon('rifle'));
  const onFoot = before - d.hp;

  // now the same rifle from a cockpit
  const ctx2 = makeCtx();
  const q = new PracticeMode(ctx2);
  q.start();
  ctx2.state.core = CORE.max;
  q.onMechCommand('deploy');
  run(q, ctx2, Math.ceil(MECH.dropTimeMs / 16) + 4);
  const d2 = q.dummies[0];
  const before2 = d2.hp;
  q.onLocalHit({ id: d2.id }, weapon('rifle'));
  const fromMech = before2 - d2.hp;

  assert.ok(onFoot > 0, 'the shot landed on foot');
  assert.equal(fromMech, onFoot * MECH.gunDamageMult, `${onFoot} -> ${fromMech}`);
});

test('a punch is not doubled: it already kills in one swing', () => {
  const ctx = makeCtx();
  const p = new PracticeMode(ctx);
  p.start();
  ctx.state.core = CORE.max;
  p.onMechCommand('deploy');
  run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);
  const d = p.dummies.find((x) => x.alive);
  const punch = { ...weapon('knife'), ...MECH.punch };
  const before = d.hp;
  p.onLocalHit({ id: d.id }, punch);
  assert.equal(before - d.hp, MECH.punch.damage, 'still one swing, one kill');
  assert.equal(d.alive, false);
});

test('a mech kills a dummy in half the rounds it takes on foot', () => {
  const shots = (fromMech) => {
    const ctx = makeCtx();
    const p = new PracticeMode(ctx);
    p.start();
    if (fromMech) {
      ctx.state.core = CORE.max;
      p.onMechCommand('deploy');
      run(p, ctx, Math.ceil(MECH.dropTimeMs / 16) + 4);
    }
    const d = p.dummies.find((x) => x.alive);
    let n = 0;
    while (d.alive && n < 40) { p.onLocalHit({ id: d.id }, weapon('rifle')); n++; }
    return n;
  };
  const onFoot = shots(false);
  const fromMech = shots(true);
  assert.equal(fromMech, Math.ceil(onFoot / MECH.gunDamageMult),
    `${onFoot} rounds on foot, ${fromMech} from a cockpit`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);

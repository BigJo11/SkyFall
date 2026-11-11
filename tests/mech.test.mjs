// The mech, the Core that calls one down, and the shield.
//   node tests/mech.test.mjs
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { MECH, CORE, WEAPONS, PLAYER, MECH_COSMETIC } from '../shared/constants.js';
import {
  addCore, coreReady, isCombo, pruneTraversal, stepShield, raiseShield,
  shieldFraction, shieldUp, mechDamage, canDamageMech, canDamagePlayer, isImmune,
  ejectionProgress, hasEjected, explosionDamage, explosionFalloff, lockAcquired,
  damageFrom, chassisById,
} from '../shared/mech.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

function fakeSocket() {
  return { readyState: 1, sent: [], send(raw) { this.sent.push(JSON.parse(raw)); } };
}

// A game with two players standing well apart in open ground.
function makeGame(map = 'big') {
  const game = new Game({ map });
  const sa = fakeSocket();
  const sb = fakeSocket();
  const a = game.addPlayer(sa, 'ALPHA');
  const b = game.addPlayer(sb, 'BRAVO');
  a.pos = [31, 0.01, -70]; a.yaw = 0;
  b.pos = [31, 0.01, -60]; b.yaw = Math.PI;
  game.broadcast = () => {};
  return { game, a, b, sa, sb };
}

// Deploy and skip straight to a landed, fighting mech.
function deployNow(game, p) {
  p.core = CORE.max;
  game.deployMech(p);
  const m = game.mechs.get(p.mechId);
  m.state = 'active';
  m.pos = p.pos.slice();
  return m;
}

console.log('\nSKYFALL mech tests\n');

// ------------------------------------------------------------------ the Core

test('a kill is worth ten percent, a combo three', () => {
  assert.equal(addCore(0, 'kill'), 10);
  assert.equal(addCore(0, 'combo'), 3);
  assert.equal(addCore(50, 'kill'), 60);
  assert.equal(addCore(0, 'nonsense'), 0, 'unknown events pay nothing');
});

test('the Core fills to 100 and stops there', () => {
  let core = 0;
  for (let i = 0; i < 20; i++) core = addCore(core, 'kill');
  assert.equal(core, CORE.max, 'capped');
  assert.equal(coreReady(core), true);
  assert.equal(coreReady(99), false);
});

test('ten kills fill it exactly', () => {
  let core = 0;
  for (let i = 0; i < 10; i++) core = addCore(core, 'kill');
  assert.equal(core, 100);
});

// ------------------------------------------------------------------- combos

test('two different moves close together is a combo', () => {
  const t = 10000;
  const log = [{ kind: 'wallrun', at: t - 400 }];
  assert.equal(isCombo([...log, { kind: 'doublejump', at: t }], t), true);
});

test('the same move twice is just moving', () => {
  const t = 10000;
  const log = [{ kind: 'wallrun', at: t - 400 }];
  assert.equal(isCombo([...log, { kind: 'wallrun', at: t }], t), false);
});

test('a combo goes stale outside the window', () => {
  const t = 10000;
  const log = [{ kind: 'wallrun', at: t - CORE.comboWindowMs - 1 }];
  assert.equal(pruneTraversal(log, t).length, 0, 'the old move is dropped');
  assert.equal(isCombo([...log, { kind: 'doublejump', at: t }], t), false);
});

// ---------------------------------------------------------------- the shield

test('a full shield lasts five seconds', () => {
  const raised = raiseShield({ charge: 1, time: 0 });
  assert.equal(raised.time, 5);
  assert.equal(raised.charge, 0, 'raising it spends the whole charge');
});

test('recharging takes four seconds', () => {
  let shield = { charge: 0, time: 0 };
  for (let i = 0; i < 40; i++) shield = stepShield(shield, 0.1);
  assert.ok(Math.abs(shield.charge - 1) < 1e-6, `full after 4s (got ${shield.charge})`);
});

test('a half-charged shield gives half the duration', () => {
  let shield = { charge: 0, time: 0 };
  for (let i = 0; i < 20; i++) shield = stepShield(shield, 0.1);   // 2 of 4 seconds
  assert.ok(Math.abs(shield.charge - 0.5) < 1e-6);
  const raised = raiseShield(shield);
  assert.ok(Math.abs(raised.time - 2.5) < 1e-6, '2.5s instead of 5');
  assert.equal(shieldUp(raised), true);
});

test('an empty shield will not come up', () => {
  assert.equal(raiseShield({ charge: 0, time: 0 }), null);
  assert.equal(raiseShield({ charge: MECH.shield.minToRaise - 0.01, time: 0 }), null);
  assert.equal(raiseShield({ charge: 0.9, time: 2 }), null, 'nor one already up');
});

test('the shield does not recharge while it is raised', () => {
  let shield = { charge: 1, time: 5 };
  shield = stepShield(shield, 1);
  assert.equal(shield.time, 4, 'it drains');
  assert.equal(shield.charge, 1, 'and does not refill at the same time');
});

test('one HUD bar covers raised and charging alike', () => {
  assert.equal(shieldFraction({ charge: 0.5, time: 0 }), 0.5);
  assert.equal(shieldFraction({ charge: 0, time: 2.5 }), 0.5);
  assert.equal(shieldFraction({ charge: 0, time: 9 }), 1, 'clamped');
});

// ------------------------------------------------------------------- damage

test('a knife bounces off a mech', () => {
  assert.equal(isImmune('knife'), true);
  assert.equal(canDamageMech('knife'), false);
  assert.equal(mechDamage('knife'), 0);
});

test('the RPG is the answer to a mech: 200 a rocket', () => {
  assert.equal(mechDamage('rpg'), 200);
  assert.equal(Math.ceil(MECH.maxHealth / mechDamage('rpg')), 5, 'five rockets to drop one');
});

test('the RPG cannot be used on people at all', () => {
  assert.equal(canDamagePlayer('rpg'), false);
  assert.equal(canDamagePlayer('rifle'), true, 'the others are unchanged');
  const rpg = WEAPONS.find((w) => w.id === 'rpg');
  assert.equal(rpg.lockOn, true, 'and it only fires on a lock');
});

test('ordinary weapons still hurt a mech — a quarter as much, on foot', () => {
  for (const id of ['rifle', 'sniper', 'smg']) {
    const w = WEAPONS.find((x) => x.id === id);
    assert.equal(mechDamage(id), w.damage * MECH.footDamageMult,
      `${id} does ${w.damage} to a person and a quarter of that to armour`);
  }
  assert.equal(mechDamage('nonsense'), 0);
});

test('the RPG is the weapon built for this, so it is left at full strength', () => {
  assert.equal(mechDamage('rpg'), 200);
  assert.equal(mechDamage('rpg', { fromMech: true }), 200, 'from a cockpit too');
  assert.equal(Math.ceil(MECH.maxHealth / mechDamage('rpg')), 5, 'still five rockets to drop one');
});

test('from a cockpit the guns do their ordinary number to armour', () => {
  for (const id of ['rifle', 'sniper', 'smg']) {
    const w = WEAPONS.find((x) => x.id === id);
    assert.equal(mechDamage(id, { fromMech: true }), w.damage, `${id} hits armour for ${w.damage}`);
  }
});

test('scaling shots at a mech leaves shots at a person alone', () => {
  for (const id of ['rifle', 'sniper', 'smg']) {
    const w = WEAPONS.find((x) => x.id === id);
    assert.equal(damageFrom(id, { fromMech: false }), w.damage, `${id} on foot vs a person`);
    assert.equal(damageFrom(id, { fromMech: true }), w.damage * MECH.gunDamageMult, `${id} from a cockpit vs a person`);
  }
});

// ------------------------------------------------------------- core failure

test('it takes three presses to get out', () => {
  assert.equal(hasEjected(0), false);
  assert.equal(hasEjected(2), false);
  assert.equal(hasEjected(3), true);
  assert.equal(ejectionProgress(1), 1 / 3);
  assert.equal(ejectionProgress(9), 1, 'clamped');
});

// ---------------------------------------------------------------- explosion

test('point blank to a mech going up is fatal, two tiles back is not', () => {
  assert.equal(explosionDamage(0), MECH.explosion.damage);
  assert.equal(explosionDamage(MECH.explosion.radius - 0.1), MECH.explosion.damage);
  assert.equal(explosionDamage(MECH.explosion.radius + 0.1), 0, 'outside is untouched');
  assert.equal(explosionFalloff(0), 1);
  assert.equal(explosionFalloff(MECH.explosion.radius * 2), 0);
});

// ------------------------------------------------------------------ lock on

test('the lock acquires a mech and nothing else', () => {
  const cone = (MECH.lockConeDeg * Math.PI) / 180;
  assert.equal(lockAcquired(50, 0), true, 'dead ahead, in range');
  assert.equal(lockAcquired(50, cone * 0.5), true, 'inside the cone');
  assert.equal(lockAcquired(50, cone * 2), false, 'pointing away');
  assert.equal(lockAcquired(MECH.lockRange + 10, 0), false, 'out of range');
  assert.equal(lockAcquired(-1, 0), false, 'nonsense distance');
});

// --------------------------------------------------------------- the server

// Aim the RPG at `at` (a world point) and report what the server made of it.
function fireRpg(game, shooter, { lock = 0, at }) {
  shooter.weapon = WEAPONS.findIndex((w) => w.id === 'rpg');
  shooter.lastShot = WEAPONS.map(() => 0);
  shooter.ammo = WEAPONS.map((w) => (Number.isFinite(w.magSize) ? w.magSize : -1));
  const eye = shooter.pos[1] + PLAYER.eye;
  const d = [at[0] - shooter.pos[0], at[1] - eye, at[2] - shooter.pos[2]];
  const L = Math.hypot(...d);
  game.onFire(shooter, { dir: [d[0] / L, d[1] / L, d[2] / L], lock });
}

test('the RPG will not fire without a lock', () => {
  const { game, a, b, sa } = makeGame();
  const m = deployNow(game, b);
  m.pos = [a.pos[0], a.pos[1], a.pos[2] - 10];
  const centre = [m.pos[0], m.pos[1] + MECH.height / 2, m.pos[2]];

  sa.sent.length = 0;
  fireRpg(game, a, { lock: 0, at: centre });
  assert.ok(sa.sent.some((x) => x.t === 'nolock'), `no lock, no shot (${sa.sent.map((x) => x.t)})`);
  assert.equal(m.hp, m.maxHp, 'and the mech is untouched');
  assert.equal(a.ammo[WEAPONS.findIndex((w) => w.id === 'rpg')], 1, 'the rocket is still in the tube');
});

test('a lock on anything that is not a live mech is no lock at all', () => {
  for (const state of ['dropping', 'core-failure']) {
    const { game, a, b, sa } = makeGame();
    const m = deployNow(game, b);
    m.pos = [a.pos[0], a.pos[1], a.pos[2] - 10];
    m.state = state;
    sa.sent.length = 0;
    fireRpg(game, a, { lock: m.id, at: [m.pos[0], m.pos[1] + MECH.height / 2, m.pos[2]] });
    assert.ok(sa.sent.some((x) => x.t === 'nolock'), `a ${state} mech is not a target`);
  }
  // and a lock on an id nothing owns
  const { game, a, b, sa } = makeGame();
  const m = deployNow(game, b);
  m.pos = [a.pos[0], a.pos[1], a.pos[2] - 10];
  sa.sent.length = 0;
  fireRpg(game, a, { lock: 9999, at: [m.pos[0], m.pos[1] + MECH.height / 2, m.pos[2]] });
  assert.ok(sa.sent.some((x) => x.t === 'nolock'), 'a bogus id is not a target');
});

test('a lock only counts inside the cone and inside the range', () => {
  const { game, a, b, sa } = makeGame();
  const m = deployNow(game, b);
  m.pos = [a.pos[0], a.pos[1], a.pos[2] - 10];

  // pointed clean away from it
  sa.sent.length = 0;
  fireRpg(game, a, { lock: m.id, at: [a.pos[0] - 200, a.pos[1], a.pos[2]] });
  assert.ok(sa.sent.some((x) => x.t === 'nolock'), 'looking the wrong way');

  // a mech beyond the lock range
  const { game: g2, a: a2, b: b2, sa: sa2 } = makeGame();
  const m2 = deployNow(g2, b2);
  m2.pos = [a2.pos[0] + MECH.lockRange + 60, a2.pos[1], a2.pos[2]];
  sa2.sent.length = 0;
  fireRpg(g2, a2, { lock: m2.id, at: [m2.pos[0], m2.pos[1] + MECH.height / 2, m2.pos[2]] });
  assert.ok(sa2.sent.some((x) => x.t === 'nolock'), 'too far away to lock');
});

test('with a lock, the RPG fires and does its 200', () => {
  // left where makeGame put it: the one stretch of this map with a clear line
  const { game, a, b, sa } = makeGame();
  const m = deployNow(game, b);
  m.hp = 1e6; m.maxHp = 1e6;                 // room, so nothing clips at zero
  sa.sent.length = 0;
  fireRpg(game, a, { lock: m.id, at: [m.pos[0], m.pos[1] + MECH.height / 2, m.pos[2]] });
  assert.ok(!sa.sent.some((x) => x.t === 'nolock'), 'it fired');
  assert.equal(1e6 - m.hp, 200, 'and did its 200');
});

test('a mech needs a full Core, and spending it empties the Core', () => {
  const { game, a } = makeGame();
  a.core = CORE.max - 1;
  game.deployMech(a);
  assert.equal(a.mechId, 0, 'one percent short is still short');

  a.core = CORE.max;
  game.deployMech(a);
  assert.ok(a.mechId > 0, 'deployed');
  assert.equal(a.core, 0, 'the Core is spent');
  assert.equal(game.mechs.size, 1);
});

test('the mech is ten times a player, and drops in from the sky', () => {
  const { game, a } = makeGame();
  a.core = CORE.max;
  game.deployMech(a);
  const m = game.mechs.get(a.mechId);
  assert.equal(m.maxHp, 1000);
  assert.equal(m.hp, 1000);
  assert.equal(m.state, 'dropping', 'it arrives from above');
  assert.ok(m.pos[1] > a.pos[1] + MECH.dropHeight - 1, 'starting high up');

  // halfway down it is still falling
  game.tickMechs(m.dropStart + MECH.dropTimeMs / 2, 0.025);
  assert.equal(m.state, 'dropping');
  assert.ok(m.pos[1] > a.pos[1] + MECH.dropHeight * 0.3, 'still well above the ground');

  // and it lands on schedule
  game.tickMechs(m.dropStart + MECH.dropTimeMs + 1, 0.025);
  assert.equal(m.state, 'active', 'landed');
  assert.ok(Math.abs(m.pos[1] - a.pos[1]) < 0.001, 'down on the ground');
});

test('five rockets drop a mech, knives do nothing', () => {
  const { game, a, b } = makeGame();
  const m = deployNow(game, a);

  game.damageMech(m, mechDamage('knife'), b, 'knife');
  assert.equal(m.hp, 1000, 'a knife does not scratch it');

  for (let i = 0; i < 4; i++) game.damageMech(m, mechDamage('rpg'), b, 'rpg');
  assert.equal(m.hp, 200, 'four rockets leaves one more');
  assert.equal(m.state, 'active');

  game.damageMech(m, mechDamage('rpg'), b, 'rpg');
  assert.equal(m.hp, 0);
  assert.equal(m.state, 'core-failure', 'and now it is going up');
});

test('the shield eats a whole hit while it is up', () => {
  const { game, a, b } = makeGame();
  const m = deployNow(game, a);
  m.shield = { charge: 0, time: 5 };

  game.damageMech(m, 200, b, 'rpg');
  assert.equal(m.hp, 1000, 'absorbed entirely');

  m.shield = { charge: 0, time: 0 };
  game.damageMech(m, 200, b, 'rpg');
  assert.equal(m.hp, 800, 'and the next one lands');
});

test('raising the shield is broadcast, and a flat one will not come up', () => {
  const { game, a } = makeGame();
  const m = deployNow(game, a);
  m.shield = { charge: 0, time: 0 };
  game.broadcast = () => {};
  game.onShield(a);
  assert.equal(m.shield.time, 0, 'nothing to spend');

  m.shield = { charge: 1, time: 0 };
  game.onShield(a);
  assert.ok(Math.abs(m.shield.time - MECH.shield.duration) < 1e-6, 'five seconds');
});

test('core failure gives the pilot five seconds, then kills them', () => {
  const { game, a, b } = makeGame();
  const m = deployNow(game, a);
  game.damageMech(m, 1000, b, 'rpg');
  assert.equal(m.state, 'core-failure');
  assert.ok(m.coreFailureEnd > Date.now(), 'a window to get out');

  // the pilot is still alive with a countdown running
  game.tickMechs(Date.now(), 0.025);
  assert.equal(a.alive, true, 'not dead yet');

  // ...and dies when it runs out
  game.tickMechs(m.coreFailureEnd + 1, 0.025);
  assert.equal(a.alive, false, 'did not get out in time');
  assert.equal(a.mechId, 0);
  assert.equal(game.mechs.size, 0, 'and the mech went with them');
});

test('three presses gets the pilot out alive', () => {
  const { game, a, b } = makeGame();
  const m = deployNow(game, a);
  game.damageMech(m, 1000, b, 'rpg');

  game.onEject(a);
  game.onEject(a);
  assert.equal(m.ejectPresses, 2);
  assert.equal(a.alive, true, 'still inside');
  assert.equal(game.mechs.size, 1);

  game.onEject(a);
  assert.equal(a.alive, true, 'out, and alive');
  assert.equal(a.mechId, 0);
  assert.equal(game.mechs.size, 0, 'the mech is gone');
});

test('V works the whole time you are aboard, not just while it is dying', () => {
  const { game, a } = makeGame();
  const m = deployNow(game, a);
  assert.equal(m.state, 'active', 'a perfectly healthy mech');
  assert.equal(m.hp, m.maxHp);

  game.onEject(a);
  game.onEject(a);
  assert.equal(m.ejectPresses, 2);
  assert.equal(a.mechId, m.id, 'still aboard after two');

  game.onEject(a);
  assert.equal(a.mechId, 0, 'out on the third');
  assert.equal(game.mechs.size, 0, 'and the mech is gone');
  assert.equal(a.alive, true, 'and alive');
});

test('punching out of a healthy mech blows it up', () => {
  const { game, a, b } = makeGame();
  const m = deployNow(game, a);
  // b is standing right next to it
  b.pos = [m.pos[0] + 2, m.pos[1], m.pos[2]];
  for (let i = 0; i < 3; i++) game.onEject(a);
  assert.equal(b.alive, false, 'caught in the blast');
  assert.equal(a.alive, true, 'the pilot got out');
});

test('you drop out from under it, not up through the blast', () => {
  const { game, a } = makeGame();
  const m = deployNow(game, a);
  const feetBefore = a.pos[1];
  const mechFeet = m.pos[1];
  for (let i = 0; i < 3; i++) game.onEject(a);
  assert.equal(a.pos[1], feetBefore, 'the pilot is not thrown upward');
  // the mech's feet were at the pilot's feet, so they end up underneath where
  // the hull was rather than inside it
  assert.ok(Math.abs(a.pos[1] - mechFeet) < 0.001, 'left where the feet were');
  assert.ok(a.pos[1] + PLAYER.height < MECH.eyeHeight, 'well below the cockpit');
});

test('presses have to come close together to count as one attempt', () => {
  const { game, a } = makeGame();
  const m = deployNow(game, a);
  game.onEject(a);
  game.onEject(a);
  assert.equal(m.ejectPresses, 2);
  // wander off for a while, then press again: it starts over
  m.ejectPressAt = Date.now() - MECH.ejectPressWindowMs - 1;
  game.onEject(a);
  assert.equal(m.ejectPresses, 1, 'back to the first press');
  assert.equal(a.mechId, m.id, 'and still aboard');
});

test('the explosion kills anyone on top of it and spares everyone else', () => {
  const { game, a, b } = makeGame();
  const m = deployNow(game, a);
  // b is ten metres away; walk them right up to it
  b.pos = [m.pos[0] + 2, m.pos[1], m.pos[2]];
  game.explodeMech(m, a.id);          // a has ejected clear
  assert.equal(b.alive, false, 'caught in the blast');
  assert.equal(a.alive, true, 'the pilot got out');
});

test('a couple of tiles back and you walk away', () => {
  const { game, a, b } = makeGame();
  const m = deployNow(game, a);
  b.pos = [m.pos[0] + MECH.explosion.radius + 3, m.pos[1], m.pos[2]];
  game.explodeMech(m, a.id);
  assert.equal(b.alive, true, 'outside the blast');
  assert.equal(b.hp, 100, 'untouched');
});

test('the Core survives death', () => {
  const { game, a, b } = makeGame();
  a.core = 60;
  game.damage(a, 1000, b, 'rifle');
  assert.equal(a.alive, false);
  game.respawn(a);
  assert.equal(a.core, 60, 'still charged');
  assert.equal(a.alive, true);
});

test('a movement combo charges the Core, and cannot be farmed', () => {
  const { game, a } = makeGame();
  const t = Date.now();
  a.pos = [31, 0.01, -70];
  game.onTraversal(a, { kind: 'wallrun' });
  assert.equal(a.core, 0, 'one move is not a combo');

  game.onTraversal(a, { kind: 'doublejump' });
  assert.equal(a.core, CORE.perCombo, 'two different moves pays');

  // straight away again: the cooldown holds it back
  game.onTraversal(a, { kind: 'mantle' });
  assert.equal(a.core, CORE.perCombo, 'no farming');

  a.lastComboAt = t - CORE.comboCooldownMs - 1;
  game.onTraversal(a, { kind: 'walljump' });
  assert.equal(a.core, CORE.perCombo * 2, 'and it pays again once cooled down');
});

test('there are no mechs on the small map', () => {
  const { game, a } = makeGame('small');
  assert.equal(game.mechsAllowed, false);
  a.core = CORE.max;
  game.deployMech(a);
  assert.equal(a.mechId, 0, 'nothing to call down');
  assert.equal(game.mechs.size, 0);
  assert.equal(a.core, CORE.max, 'and the Core is not spent');
});

test('a pilot who leaves takes their mech with them', () => {
  const { game, a } = makeGame();
  deployNow(game, a);
  assert.equal(game.mechs.size, 1);
  game.removePlayer(a.id);
  assert.equal(game.mechs.size, 0, 'no orphaned mechs');
});

test('the snapshot carries the mechs', () => {
  const { game, a } = makeGame();
  const m = deployNow(game, a);
  let sent = null;
  game.broadcast = (msg) => { if (msg.t === 'snapshot') sent = msg; };
  game.tick();
  assert.ok(sent, 'a snapshot went out');
  assert.equal(sent.mechs.length, 1);
  assert.equal(sent.mechs[0].id, m.id);
  assert.equal(sent.mechs[0].maxHp, 1000);
  assert.equal(sent.players.find((p) => p.id === a.id).mechId, m.id);
  assert.equal(typeof sent.players.find((p) => p.id === a.id).core, 'number');
});

// ---------------------------------------------------------- the mech's guns

// Fire one round straight at the other player, from wherever the shooter is
// standing (or from the cockpit, if they are aboard).
function shootAt(game, shooter, target, weaponId = 'rifle') {
  shooter.weapon = WEAPONS.findIndex((w) => w.id === weaponId);
  shooter.lastShot = WEAPONS.map(() => 0);
  shooter.ammo = WEAPONS.map((w) => (Number.isFinite(w.magSize) ? w.magSize : -1));
  const eye = shooter.mechId ? MECH.eyeHeight : PLAYER.eye;
  const from = [shooter.pos[0], shooter.pos[1] + eye, shooter.pos[2]];
  const to = [target.pos[0], target.pos[1] + PLAYER.height * 0.5, target.pos[2]];
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  game.onFire(shooter, { dir: [d[0] / L, d[1] / L, d[2] / L] });
}

test("a mech's guns hit a player twice as hard", () => {
  const onFoot = (() => {
    const { game, a, b } = makeGame();
    const before = b.hp;
    shootAt(game, a, b);
    return before - b.hp;
  })();
  assert.ok(onFoot > 0, `the shot landed (${onFoot})`);

  const { game, a, b } = makeGame();
  deployNow(game, a);
  const before = b.hp;
  shootAt(game, a, b);
  const fromMech = before - b.hp;
  assert.equal(fromMech, onFoot * MECH.gunDamageMult, `${onFoot} on foot, ${fromMech} from a cockpit`);
});

test('the same guns do the ordinary damage to another mech', () => {
  const { game, a, b } = makeGame();
  const mine = deployNow(game, a);
  const theirs = deployNow(game, b);
  const before = theirs.hp;
  shootAt(game, a, b);
  const dealt = before - theirs.hp;
  assert.equal(dealt, WEAPONS.find((w) => w.id === 'rifle').damage, 'not doubled against armour');
  assert.ok(mine.hp === mine.maxHp, 'and nothing bounced back');
});

test('a soldier on foot barely scratches a mech — a quarter, live', () => {
  for (const [id, want] of [['rifle', 25], ['sniper', 100], ['smg', 8]]) {
    const { game, a, b } = makeGame();
    const theirs = deployNow(game, b);
    const before = theirs.hp;
    shootAt(game, a, b, id);
    const dealt = before - theirs.hp;
    assert.equal(dealt, want * MECH.footDamageMult,
      `${id} does ${dealt} to armour instead of ${want}`);
  }
});

test('the punch is left out of the doubling — it already kills', () => {
  assert.equal(damageFrom('knife', { fromMech: true }), MECH.punch.damage);
  assert.equal(damageFrom('knife', { fromMech: true, vsMech: true }), 0, 'and armour ignores it');
});

test('headshots scale with the doubled damage', () => {
  const foot = damageFrom('sniper', { fromMech: false });
  const cockpit = damageFrom('sniper', { fromMech: true });
  assert.equal(cockpit, foot * MECH.gunDamageMult);
});

// --------------------------------------------------------------------- chassis

test('each chassis carries its own health', () => {
  for (const c of MECH.chassis) {
    const { game, a } = makeGame();
    a.mechCosmetic = { ...MECH_COSMETIC.default, chassis: c.id };
    deployNow(game, a);
    const m = game.mechs.get(a.mechId);
    assert.equal(m.maxHp, c.hp, `${c.name} has ${c.hp}`);
    assert.equal(m.chassis, c.id);
  }
});

test('the three hulls differ in health and in pace, and nothing else', () => {
  const [light, medium, heavy] = ['light', 'medium', 'heavy'].map(chassisById);
  assert.ok(light.hp < medium.hp && medium.hp < heavy.hp, 'health ordered');
  assert.ok(light.speed > medium.speed && medium.speed > heavy.speed, 'pace ordered the other way');
  for (const c of MECH.chassis) {
    assert.equal(c.height, undefined, 'no chassis is a different height');
  }
});

test('an unknown chassis falls back to the standard one', () => {
  assert.equal(chassisById('nonsense').id, MECH.defaultChassis);
  assert.equal(MECH_COSMETIC.normalise({ chassis: 'nonsense' }).chassis, MECH.defaultChassis);
});

// ------------------------------------------------------------ the mech's looks

test('the mech inherits the paint its pilot chose', () => {
  const game = new Game({ map: 'big' });
  const a = game.addPlayer(fakeSocket(), 'ALPHA', false, {
    primary: 0x112233, secondary: 0x445566, material: 'matte',
    mech: { primary: 0xff0000, secondary: 0x00ff00, material: 'metal', chassis: 'heavy' },
  });
  assert.equal(a.mechCosmetic.primary, 0xff0000);
  assert.equal(a.mechCosmetic.chassis, 'heavy');
  deployNow(game, a);
  const m = game.mechs.get(a.mechId);
  assert.equal(m.color, 0xff0000, 'its hull is the colour they picked');
  assert.equal(m.trim, 0x00ff00);
  assert.equal(m.material, 'metal');
  assert.equal(m.maxHp, 1500, 'and the heavy chassis health with it');
});

test('a crew finish is refused for everyone else, here as on a character', () => {
  const plain = new Game({ map: 'big' }).addPlayer(fakeSocket(), 'ALPHA', false,
    { mech: { material: 'neon' } });
  assert.equal(plain.mechCosmetic.material, 'matte', 'silently falls back');
  const crew = new Game({ map: 'big' }).addPlayer(fakeSocket(), 'BRAVO', true,
    { mech: { material: 'neon' } });
  assert.equal(crew.mechCosmetic.material, 'neon', 'crew get what they asked for');
});

test("a mech nobody painted flies its pilot's colour", () => {
  const game = new Game({ map: 'big' });
  const a = game.addPlayer(fakeSocket(), 'ALPHA');
  assert.equal(a.mechCosmetic, null, 'nothing was chosen');
  deployNow(game, a);
  assert.equal(game.mechs.get(a.mechId).color, a.color, "so two of them are tellable apart");
});

test('the snapshot carries the chassis and the paint', () => {
  const { game, a } = makeGame();
  a.mechCosmetic = { ...MECH_COSMETIC.default, chassis: 'light', primary: 0xabcdef };
  const m = deployNow(game, a);
  const pub = game.pubMech(m);
  assert.equal(pub.chassis, 'light');
  assert.equal(pub.color, 0xabcdef);
  assert.equal(pub.maxHp, 500);
  assert.equal(typeof pub.material, 'string');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

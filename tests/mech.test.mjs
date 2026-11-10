// The mech, the Core that calls one down, and the shield.
//   node tests/mech.test.mjs
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { MECH, CORE, WEAPONS } from '../shared/constants.js';
import {
  addCore, coreReady, isCombo, pruneTraversal, stepShield, raiseShield,
  shieldFraction, shieldUp, mechDamage, canDamageMech, canDamagePlayer, isImmune,
  ejectionProgress, hasEjected, explosionDamage, explosionFalloff, lockAcquired,
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

test('ordinary weapons still hurt a mech', () => {
  assert.equal(mechDamage('rifle'), 25);
  assert.equal(mechDamage('sniper'), 100);
  assert.equal(mechDamage('smg'), 8);
  assert.equal(mechDamage('nonsense'), 0);
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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

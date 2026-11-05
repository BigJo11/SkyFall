// Rebinding: every gameplay key goes through an action name, so the options
// screen can swap the physical key without the rest of the game knowing.
//   node tests/keybinds.test.mjs
import assert from 'node:assert/strict';
import {
  ACTIONS, DEFAULT_BINDS, codesFor, keyLabel, assign, normalise, reserved, ownerOf,
} from '../public/js/keybinds.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('\nSKYFALL keybind tests\n');

test('every action the game asks for is declared, and defaults are complete', () => {
  const ids = ACTIONS.map((a) => a.id);
  for (const needed of ['forward', 'back', 'left', 'right', 'sprint', 'jump', 'slide',
    'fire', 'reload', 'swap', 'scoreboard', 'leaderboard', 'pause']) {
    assert.ok(ids.includes(needed), `${needed} is bindable`);
  }
  for (const a of ACTIONS) {
    assert.equal(typeof DEFAULT_BINDS[a.id], 'string', `${a.id} has a default`);
    assert.ok(DEFAULT_BINDS[a.id].length > 0);
  }
});

test('the shipped defaults are the keys the game has always used', () => {
  assert.equal(DEFAULT_BINDS.forward, 'KeyW');
  assert.equal(DEFAULT_BINDS.sprint, 'ShiftLeft');
  assert.equal(DEFAULT_BINDS.jump, 'Space');
  assert.equal(DEFAULT_BINDS.slide, 'KeyC');
  assert.equal(DEFAULT_BINDS.reload, 'KeyR');
  assert.equal(DEFAULT_BINDS.pause, 'Escape');
});

test('the arrow keys stay available for movement whichever key is bound', () => {
  const codes = codesFor('forward', { ...DEFAULT_BINDS, forward: 'KeyI' });
  assert.ok(codes.includes('KeyI'), 'the bound key');
  assert.ok(codes.includes('ArrowUp'), 'and the arrow key');
  const custom = codesFor('jump', { ...DEFAULT_BINDS, jump: 'KeyF' });
  assert.deepEqual(custom, ['KeyF'], 'jump has no alternates');
});

test('binding a key already in use swaps the two actions, never doubling up', () => {
  const next = assign(DEFAULT_BINDS, 'jump', 'KeyR');   // R was reload
  assert.equal(next.jump, 'KeyR');
  assert.equal(next.reload, DEFAULT_BINDS.jump, 'the displaced action took the old key');
  const all = Object.values(next);
  assert.equal(new Set(all).size, all.length, 'no key is bound twice');
});

test('ownerOf names who is holding a key', () => {
  assert.equal(ownerOf(DEFAULT_BINDS, 'KeyR').id, 'reload');
  assert.equal(ownerOf(DEFAULT_BINDS, 'KeyR', 'reload'), null);
  assert.equal(ownerOf(DEFAULT_BINDS, 'F13'), null);
});

test('stored bindings are merged over the defaults and junk is ignored', () => {
  const merged = normalise({ forward: 'KeyI', jump: 42, nonsense: 'KeyZ' });
  assert.equal(merged.forward, 'KeyI');
  assert.equal(merged.jump, DEFAULT_BINDS.jump, 'a bad value falls back');
  assert.equal(merged.nonsense, undefined, 'unknown actions are dropped');
  assert.deepEqual(normalise(null), { ...DEFAULT_BINDS });
});

test('firing is a bindable action, not only the left mouse button', () => {
  const fire = ACTIONS.find((a) => a.id === 'fire');
  assert.ok(fire, 'fire is an action');
  assert.equal(fire.group, 'COMBAT', 'listed with the other combat keys');
  assert.equal(DEFAULT_BINDS.fire, 'KeyF', 'F by default');
  assert.equal(keyLabel(DEFAULT_BINDS.fire), 'F');
  assert.equal(reserved('KeyF'), false, 'and it can be moved');

  const moved = assign(DEFAULT_BINDS, 'fire', 'KeyV');
  assert.equal(moved.fire, 'KeyV');
  assert.ok(codesFor('fire', moved).includes('KeyV'), 'the new key fires');
  assert.equal(ownerOf(moved, 'KeyV'), fire, 'the radar of who owns what agrees');
});

test('key labels are readable', () => {
  assert.equal(keyLabel('Space'), 'SPACE');
  assert.equal(keyLabel('KeyW'), 'W');
  assert.equal(keyLabel('Digit4'), '4');
  assert.equal(keyLabel('ShiftLeft'), 'L SHIFT');
  assert.equal(keyLabel('ArrowUp'), 'UP');
  assert.equal(keyLabel(''), '—');
  assert.equal(keyLabel(undefined), '—');
});

test('a handful of keys can never be stolen', () => {
  assert.equal(reserved('Escape'), true, 'the menu still needs ESC');
  assert.equal(reserved('Digit1'), true, 'digits pick weapons');
  assert.equal(reserved('KeyW'), false);
  assert.equal(reserved('Space'), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

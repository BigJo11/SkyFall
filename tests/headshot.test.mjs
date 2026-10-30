// Headshot geometry + aim assist maths.
//   node tests/headshot.test.mjs
import assert from 'node:assert/strict';
import {
  WEAPONS, WEAPON_BY_ID, PLAYER, HEADSHOT, AIM_ASSIST,
  isHeadHit, headshotDamage,
} from '../shared/constants.js';
import { aimAssist, angleBetween, weaponHasAssist } from '../shared/aimassist.js';

let passed = 0;
let failed = 0;
const tests = [];

function test(name, fn) {
  tests.push([name, fn]);
}

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
// unit direction `d` degrees to the right of -Z
const heading = (d) => [Math.sin(d * DEG), 0, -Math.cos(d * DEG)];
const rifle = WEAPON_BY_ID.rifle;
const smg = WEAPON_BY_ID.smg;
const sniper = WEAPON_BY_ID.sniper;
const knife = WEAPON_BY_ID.knife;

console.log('\nheadshots:\n');

test('the head zone is the top of the capsule, not the chest', () => {
  const top = PLAYER.height;
  assert.equal(isHeadHit(top), true, 'crown is a head');
  assert.equal(isHeadHit(top - 0.1), true, 'skull is a head');
  assert.equal(isHeadHit(top - HEADSHOT.zoneHeight + 0.001), true, 'top of the band is a head');
  assert.equal(isHeadHit(top - HEADSHOT.zoneHeight - 0.001), false, 'just under the band is not');
  assert.equal(isHeadHit(1.0), false, 'chest is not a head');
  assert.equal(isHeadHit(0.1), false, 'feet are not a head');
  // the band must be reachable but not the whole body
  assert.ok(HEADSHOT.zoneHeight > 0.2 && HEADSHOT.zoneHeight < PLAYER.height / 3, 'band is a sensible size');
});

test('headshots double the rifle and the smg, and nothing else', () => {
  assert.equal(headshotDamage(rifle, false), 25);
  assert.equal(headshotDamage(rifle, true), 50);
  assert.equal(headshotDamage(smg, false), 8);
  assert.equal(headshotDamage(smg, true), 16);
  // one-shot weapons stay one-shot: a crit cannot invent damage
  assert.equal(headshotDamage(sniper, true), sniper.damage);
  assert.equal(headshotDamage(knife, true), knife.damage);
  assert.equal(rifle.headshot, 2);
  assert.equal(smg.headshot, 2);
});

test('a headshot kill is faster, and still kills in whole bullets', () => {
  // rifle: 4 body shots vs 2 headshots
  assert.equal(Math.ceil(100 / headshotDamage(rifle, false)), 4);
  assert.equal(Math.ceil(100 / headshotDamage(rifle, true)), 2);
  // time to kill at 4/sec
  const bodyTTK = 3 * rifle.interval;
  const headTTK = 1 * rifle.interval;
  assert.ok(headTTK < bodyTTK, 'headshots kill sooner');
  // smg: 13 body vs 7 head
  assert.equal(Math.ceil(100 / headshotDamage(smg, false)), 13);
  assert.equal(Math.ceil(100 / headshotDamage(smg, true)), 7);
  // every weapon still needs at least one shot
  for (const w of WEAPONS) assert.ok(headshotDamage(w, true) > 0, `${w.id} does damage`);
});

test('the head zone is identical for every weapon (server and client agree)', () => {
  // Both sides call the same helper, so this is really a guard against someone
  // inlining a different constant on one side.
  const aboveShoulder = PLAYER.height - 0.05;
  const chest = PLAYER.height * 0.62;
  assert.equal(isHeadHit(aboveShoulder), true);
  assert.equal(isHeadHit(chest), false);
});

console.log('\naim assist:\n');

test('only the spray weapons get any magnetism', () => {
  assert.equal(weaponHasAssist(rifle), true);
  assert.equal(weaponHasAssist(smg), true);
  assert.equal(weaponHasAssist(sniper), false, 'sniper is precision, no assist');
  assert.equal(weaponHasAssist(knife), false, 'knife is melee, no assist');
  assert.equal(weaponHasAssist(null), false);
});

test('a shot already on target is barely touched', () => {
  const origin = [0, 1.62, 0];
  const target = { id: 1, pos: [0, 0, -30] };
  // aim at the chest so there is no vertical error to correct
  const chestY = PLAYER.height * AIM_ASSIST.chestHeight;
  const ideal = [0, chestY - origin[1], -30];
  const n = Math.hypot(...ideal);
  const dir = ideal.map((v) => v / n);
  const res = aimAssist(origin, dir, [target]);
  assert.equal(res.targetId, 1);
  assert.ok(res.pullDeg < 0.2, `barely bends (${res.pullDeg.toFixed(3)} deg)`);
});

test('a shot a couple of degrees off is nudged toward the target', () => {
  const origin = [0, 1.62, 0];
  const target = { id: 7, pos: [0, 0, -25] };
  const chest = [0, PLAYER.height * AIM_ASSIST.chestHeight, -25];
  const toTarget = chest.map((v, i) => v - origin[i]);
  const n = Math.hypot(...toTarget);
  const unit = toTarget.map((v) => v / n);

  // rotate the aim 2 degrees to the right of the true direction
  const aim = [
    unit[0] * Math.cos(2 * DEG) - unit[2] * Math.sin(2 * DEG),
    unit[1],
    unit[0] * Math.sin(2 * DEG) + unit[2] * Math.cos(2 * DEG),
  ];
  const before = angleBetween(aim, unit);
  assert.ok(before * RAD < AIM_ASSIST.coneDeg, 'the test aim starts inside the cone');
  const res = aimAssist(origin, aim, [target]);
  assert.equal(res.targetId, 7, 'target acquired');
  assert.ok(res.pullDeg > 0.1, `bent the shot (${res.pullDeg.toFixed(2)} deg)`);
  const after = angleBetween(res.dir, unit);
  assert.ok(after < before, 'closer to the target than before');
  assert.ok(!Number.isNaN(after), 'still a valid direction');
  assert.ok(Math.abs(Math.hypot(...res.dir) - 1) < 1e-9, 'direction stays normalised');
});

test('assist never reaches outside its cone', () => {
  const origin = [0, 1.62, 0];
  const target = { id: 2, pos: [0, 0, -20] };
  const wide = AIM_ASSIST.coneDeg + 2;
  const res = aimAssist(origin, heading(wide), [target]);
  assert.equal(res.pullDeg, 0, 'no pull outside the cone');
  assert.equal(res.targetId, null);
  const input = heading(wide);
  assert.deepEqual(res.dir, input, 'direction untouched');
});

test('assist is capped and never snaps across the screen', () => {
  const origin = [0, 1.62, 0];
  const target = { id: 3, pos: [0, 0, -20] };
  const res = aimAssist(origin, heading(AIM_ASSIST.coneDeg - 0.01), [target]);
  assert.ok(res.pullDeg <= AIM_ASSIST.maxPullDeg + 1e-9, `pull ${res.pullDeg} respects the cap`);
  // even at the very edge of the cone the shot is only slightly bent
  assert.ok(res.pullDeg < AIM_ASSIST.coneDeg, 'never bends more than the error');
});

test('the closest target in angle wins; range and empty lists are safe', () => {
  const origin = [0, 1.62, 0];
  const near = { id: 10, pos: [0, 0, -30] };
  const far = { id: 11, pos: [6, 0, -30] };
  const res = aimAssist(origin, heading(0.6), [far, near]);
  assert.equal(res.targetId, 10, 'picked the one nearest the crosshair');

  const away = aimAssist(origin, heading(0), [{ id: 12, pos: [0, 0, -(AIM_ASSIST.range + 20)] }]);
  assert.equal(away.pullDeg, 0, 'out of range ignored');

  const behind = aimAssist(origin, heading(0), [{ id: 13, pos: [0, 0, 25] }]);
  assert.equal(behind.pullDeg, 0, 'behind the player ignored');

  const empty = aimAssist(origin, heading(0), []);
  assert.equal(empty.pullDeg, 0);
  const bad = aimAssist(origin, heading(0), [null, {}, { id: 1 }]);
  assert.equal(bad.pullDeg, 0, 'malformed targets are skipped');
});

test('assist can be switched off and does not fight the caller', () => {
  const origin = [0, 1.62, 0];
  const target = { id: 4, pos: [0, 0, -20] };
  const off = aimAssist(origin, heading(1), [target], { enabled: false });
  assert.equal(off.pullDeg, 0);
  // a zero-strength config is a no-op even with the feature on
  const zero = aimAssist(origin, heading(1), [target], { strength: 0 });
  assert.equal(zero.pullDeg, 0);
  // degenerate aim direction does not throw
  const zeroDir = aimAssist(origin, [0, 0, 0], [target]);
  assert.equal(zeroDir.pullDeg, 0);
});

test('assist works vertically too (high ground, targets below)', () => {
  const origin = [0, 12, 0];
  const target = { id: 5, pos: [0, 0, -22] };
  const chest = PLAYER.height * AIM_ASSIST.chestHeight;
  const ideal = Math.atan2(chest - origin[1], 22);
  // aim 1.5 deg above the target
  const pitch = ideal + 1.5 * DEG;
  const dir = [0, Math.sin(pitch), -Math.cos(pitch)];
  const res = aimAssist(origin, dir, [target]);
  assert.ok(res.pullDeg > 0, 'bent downward toward the target');
  assert.ok(res.dir[1] < dir[1], 'pitched down');
  const after = angleBetween(res.dir, [0, Math.sin(ideal), -Math.cos(ideal)]);
  assert.ok(after * RAD < 1.5, `closer than the ${(1.5).toFixed(1)} deg it started at`);
});

for (const [name, fn] of tests) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

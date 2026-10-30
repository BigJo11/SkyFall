// Exercises the real index.html + HUD/Input code inside jsdom.
//   node tests/ui.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

const dom = new JSDOM(html, { url: 'http://localhost:3000/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
// navigator is read-only in Node
globalThis.HTMLElement = window.HTMLElement;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);

const { Hud } = await import('../public/js/hud.js');
const { Input } = await import('../public/js/input.js');
const { WEAPONS } = await import('../shared/constants.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('\nSKYFALL UI tests\n');

test('title screen shows the SKYFALL logo and deploy flow', () => {
  const logo = document.querySelector('h1.logo');
  assert.equal(logo.textContent.trim(), 'SKYFALL');
  assert.equal(logo.getAttribute('data-text'), 'SKYFALL');
  assert.ok(document.getElementById('deployBtn'), 'deploy button');
  assert.ok(document.getElementById('nameInput'), 'callsign input');
  // arsenal copy matches the balance numbers
  const arsenal = document.querySelector('.arsenal').textContent;
  assert.match(arsenal, /4 shots\/sec/);
  assert.match(arsenal, /6 shots to kill/);
  assert.match(arsenal, /3\.5s/);
  assert.match(arsenal, /15 shots\/sec/);
  assert.match(arsenal, /0\.5s swing/);
  // all three entry points
  assert.ok(document.getElementById('deployBtn'), 'deploy');
  assert.ok(document.getElementById('practiceBtn'), 'practice');
  assert.ok(document.getElementById('tutorialBtn'), 'tutorial');
  const controls = document.querySelector('.keys').textContent;
  assert.match(controls, /double jump/i);
  assert.match(controls, /slide/i);
});

const hud = new Hud();

test('hud health / ammo / weapon slots', () => {
  hud.show(true);
  assert.equal(document.getElementById('hud').classList.contains('hidden'), false);
  hud.setHealth(64);
  assert.equal(document.getElementById('healthNum').textContent, '64');
  assert.equal(document.getElementById('healthFill').style.width, '64%');
  hud.setHealth(12);
  assert.equal(document.getElementById('healthFill').classList.contains('low'), true);

  hud.setWeapon(0, 24);
  assert.equal(document.getElementById('weaponName').textContent, 'RIFLE');
  assert.equal(document.getElementById('ammoNum').textContent, '24');
  assert.equal(document.getElementById('ammoMax').textContent, '30');
  assert.equal(hud.slots[0].classList.contains('active'), true);

  hud.setWeapon(3, Infinity);
  assert.equal(document.getElementById('ammoNum').textContent, '∞');
  assert.equal(document.getElementById('ammoMax').textContent, '∞');

  hud.setWeapon(2, 40);
  hud.setAmmo(7);
  assert.equal(document.getElementById('ammoNum').textContent, '7');
  assert.equal(WEAPONS[2].name, 'SMG');
});

test('killfeed, hitmarker, damage numbers and messages', () => {
  hud.killFeed('ALPHA', 'BRAVO', 'rifle', { killerIsMe: true });
  const feed = document.getElementById('killfeed');
  assert.equal(feed.children.length, 1);
  assert.match(feed.textContent, /ALPHA/);
  assert.match(feed.textContent, /RIFLE/);
  assert.match(feed.textContent, /BRAVO/);

  hud.killFeed('CHARLIE', 'DELTA', 'fall', {});
  assert.match(feed.textContent, /THE VOID|DELTA/);

  hud.hitmarker(true);
  assert.ok(document.getElementById('hitmarker').classList.contains('show'));

  hud.damageNumber(17, 10, -20);
  assert.equal(document.getElementById('dmgNumbers').children.length, 1);

  hud.centerMessage('TEST MESSAGE', 50);
  assert.ok(document.getElementById('centerMsg').classList.contains('show'));
  hud.toast('hello');
  assert.ok(document.getElementById('toast').classList.contains('show'));
});

test('crosshair, reload ring and scope', () => {
  hud.crosshairGap(13.5);
  assert.equal(document.getElementById('crosshair').style.getPropertyValue('--gap'), '13.5px');
  hud.reloadProgress(0.25);
  assert.equal(document.getElementById('reloadRing').classList.contains('hidden'), false);
  hud.reloadProgress(null);
  assert.equal(document.getElementById('reloadRing').classList.contains('hidden'), true);
  hud.scope(true);
  assert.equal(document.getElementById('scopeOverlay').classList.contains('hidden'), false);
  hud.scope(false);
  assert.equal(document.getElementById('scopeOverlay').classList.contains('hidden'), true);
});

test('scoreboard sorts by kills and marks the local player', () => {
  const players = [
    { id: 1, name: 'ALPHA', color: 0x62d6ff, kills: 2, deaths: 5, alive: true },
    { id: 2, name: 'BRAVO', color: 0xff6b6b, kills: 9, deaths: 1, alive: false },
  ];
  hud.scoreboard(players, 1, true);
  const rows = document.getElementById('sbBody').querySelectorAll('tr');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /BRAVO/, 'highest kills first');
  assert.ok(rows[1].classList.contains('me'), 'own row highlighted');
  assert.match(rows[1].textContent, /you/);
});

test('death screen + respawn countdown', () => {
  hud.showDeath('BRAVO', 'sniper');
  assert.equal(document.getElementById('deathScreen').classList.contains('hidden'), false);
  assert.equal(document.getElementById('deathBy').textContent, 'BRAVO');
  hud.setRespawn(1.234);
  assert.equal(document.getElementById('respawnTimer').textContent, '1.2');
  hud.hideDeath();
  assert.equal(document.getElementById('deathScreen').classList.contains('hidden'), true);
});

test('momentum meter, movement callout and practice stats', () => {
  hud.setMomentum(0, false);
  assert.equal(document.getElementById('momFill').style.width, '0%');
  assert.equal(document.getElementById('momPct').textContent, '0%');
  hud.setMomentum(0.86, true);
  assert.equal(document.getElementById('momPct').textContent, '86%');
  assert.ok(document.getElementById('momentum').classList.contains('hot'), 'hot state at high momentum');
  hud.setMomentum(1.4, false); // clamped
  assert.equal(document.getElementById('momPct').textContent, '100%');

  hud.moveState('WALL RUN', 'wall');
  const ms = document.getElementById('moveState');
  assert.equal(ms.textContent, 'WALL RUN');
  assert.ok(ms.classList.contains('on') && ms.classList.contains('wall'));
  hud.moveState('');
  assert.equal(ms.classList.contains('on'), false);

  hud.showPractice(true);
  assert.equal(document.getElementById('practiceStats').classList.contains('hidden'), false);
  hud.practiceStats({ kills: 4, jumps: 12, wallRuns: 3, slides: 5, bestMomentum: 0.66 });
  assert.equal(document.getElementById('psKills').textContent, '4');
  assert.equal(document.getElementById('psWallRuns').textContent, '3');
  assert.equal(document.getElementById('psMomentum').textContent, '66%');
  hud.showPractice(false);
});

test('tutorial objective card + completion overlay', () => {
  hud.showObjective({ id: 'step1', title: 'WALL RUN', text: 'Run along a wall.', tip: 'SPACE' }, 7, 15);
  assert.equal(document.getElementById('objective').classList.contains('hidden'), false);
  assert.equal(document.getElementById('objTitle').textContent, 'WALL RUN');
  assert.equal(document.getElementById('objIndex').textContent, '7 / 15');
  assert.equal(document.getElementById('objTip').textContent, 'SPACE');
  hud.showObjective({ id: 'step2', title: 'SLIDE', text: 'Slide!', tip: '' }, 9, 15);
  assert.equal(document.getElementById('objTip').classList.contains('hidden'), true, 'no tip hides the chip');
  hud.showObjective(null);
  assert.equal(document.getElementById('objective').classList.contains('hidden'), true);

  hud.showObjectiveDone(true);
  assert.equal(document.getElementById('objectiveDone').classList.contains('hidden'), false);
  hud.showObjectiveDone(false);
  assert.equal(document.getElementById('objectiveDone').classList.contains('hidden'), true);
});

test('ping readout', () => {
  hud.setPingValue(12.6);
  assert.equal(document.getElementById('hudPing').textContent, '13');
});

test('input tracks keys, mouse buttons and look deltas', () => {
  const canvas = document.getElementById('gl');
  const input = new Input(canvas);
  input.enabled = true;
  input.fallback = true; // raw mousemove path

  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW' }));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ShiftLeft' }));
  assert.deepEqual(input.axes(), { forward: 1, right: 0, sprint: true });
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyD' }));
  const diag = input.axes();
  assert.ok(Math.abs(Math.hypot(diag.forward, diag.right) - 1) < 1e-6, 'diagonals are normalised');
  assert.ok(input.pressed('KeyW'));
  assert.equal(input.weaponSlotPressed(), -1);

  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Digit3' }));
  assert.equal(input.weaponSlotPressed(), 2);

  window.dispatchEvent(new window.MouseEvent('mousemove', { movementX: 12, movementY: -4 }));
  const look = input.takeLook();
  assert.equal(look.dx, 12);
  assert.equal(look.dy, -4);
  assert.deepEqual(input.takeLook(), { dx: 0, dy: 0 }, 'deltas are consumed once');

  canvas.dispatchEvent(new window.MouseEvent('mousedown', { button: 0, bubbles: true }));
  canvas.dispatchEvent(new window.MouseEvent('mousedown', { button: 2, bubbles: true }));
  assert.equal(input.mouseDown(0), true);
  assert.equal(input.mouseDown(2), true);
  assert.equal(input.mousePressed(0), true);
  window.dispatchEvent(new window.MouseEvent('mouseup', { button: 0 }));
  assert.equal(input.mouseDown(0), false);
  assert.equal(input.mouseReleased(0), true);

  input.endFrame();
  assert.equal(input.pressed('KeyW'), false);
  assert.equal(input.mousePressed(0), false);

  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyW' }));
  assert.equal(input.down('KeyW'), false);

  // wheel switching
  window.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 100 }));
  assert.equal(input.wheel, 1);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

// Boots the entire client (public/js/main.js) inside jsdom against a real
// server, with a stubbed WebGL renderer. Catches runtime errors in the wiring
// that static checks cannot see: menus, frame loop, networking, HUD updates.
//   node tests/browser.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { JSDOM } from 'jsdom';
import WebSocket from 'ws';

const ROOT = path.resolve(import.meta.dirname, '..');
const TMP = path.join(ROOT, '.uitest');
const LEADERBOARD = `/tmp/skyfall-board-${process.pid}.json`;
const PORT = 3320 + Math.floor(Math.random() * 100);

let passed = 0;
let failed = 0;
const runtimeErrors = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// ------------------------------------------------------------ copy sources
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'public/js'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'shared'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'shared'))) {
  fs.copyFileSync(path.join(ROOT, 'shared', f), path.join(TMP, 'shared', f));
}
for (const f of fs.readdirSync(path.join(ROOT, 'public/js'))) {
  const src = fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8')
    .replace(/from 'three'/g, "from './three-stub.mjs'");
  fs.writeFileSync(path.join(TMP, 'public/js', f), src);
}
fs.writeFileSync(path.join(TMP, 'public/js/three-stub.mjs'), `
export * from 'three';
export class WebGLRenderer {
  constructor(opts = {}) {
    this.domElement = opts.canvas || null;
    this.shadowMap = {};
    this.outputColorSpace = '';
    this.autoClear = true;
    this.renderCount = 0;
  }
  setPixelRatio() {}
  setSize() {}
  setClearColor() {}
  clear() {}
  clearDepth() {}
  compile() {}
  render(scene, camera) {
    this.renderCount++;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
  }
  dispose() {}
  getContext() { return {}; }
}
`);

// ------------------------------------------------------------ jsdom setup
const htmlPath = path.join(ROOT, 'public/index.html');
const dom = new JSDOM(fs.readFileSync(htmlPath, 'utf8'), {
  url: `http://127.0.0.1:${PORT}/`,
  pretendToBeVisual: false,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.WheelEvent = window.WheelEvent;
globalThis.WebSocket = WebSocket;
window.WebSocket = WebSocket;
globalThis.localStorage = window.localStorage;
globalThis.location = window.location;


// 2D canvas stub (jsdom has no canvas backend)
window.HTMLCanvasElement.prototype.getContext = function getContext() {
  const grad = { addColorStop() {} };
  return new Proxy({
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    measureText: () => ({ width: 10 }),
  }, {
    get(t, p) { return p in t ? t[p] : () => {}; },
    set(t, p, v) { t[p] = v; return true; },
  });
};

// frame pump
let rafQueue = [];
let rafId = 0;
globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return ++rafId; };
window.requestAnimationFrame = globalThis.requestAnimationFrame;
globalThis.cancelAnimationFrame = () => {};
let clock = 0;
function pump(frames = 1, step = 16) {
  for (let i = 0; i < frames; i++) {
    clock += step;
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(clock);
  }
}

process.on('uncaughtException', (e) => runtimeErrors.push(e));
process.on('unhandledRejection', (e) => runtimeErrors.push(e));

// ------------------------------------------------------------ server
const server = spawn(process.execPath, ['server/server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), LEADERBOARD_FILE: LEADERBOARD },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const cleanup = () => { try { server.kill('SIGKILL'); } catch {} fs.rmSync(TMP, { recursive: true, force: true }); };
process.on('exit', cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/api/status`)).ok) break; } catch {}
  await sleep(100);
}

console.log('\nSKYFALL browser boot test\n');

let mainLoaded = false;

await test('main.js boots without throwing', async () => {
  await import('file://' + path.join(TMP, 'public/js/main.js'));
  mainLoaded = true;
  pump(4);
  assert.ok(mainLoaded);
  assert.equal(document.getElementById('title').classList.contains('hidden'), false);
});

await test('title screen renders the arena backdrop frames', async () => {
  pump(10);
  assert.ok(runtimeErrors.length === 0, `no runtime errors: ${runtimeErrors[0]}`);
});

await test('the reserved callsign is locked until the crew code is typed', async () => {
  const name = document.getElementById('nameInput');
  name.value = 'Big Joe';
  document.getElementById('deployBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(2);
  assert.equal(document.getElementById('title').classList.contains('hidden'), false, 'deploy refused');
  assert.match(document.getElementById('titleNotice').textContent, /TAKEN/);

  // typing the code in order unlocks it (and the glow skin)
  const code = document.getElementById('codeInput');
  for (const ch of '1013') {
    code.value += ch;
    code.dispatchEvent(new window.Event('input', { bubbles: true }));
    pump(1);
  }
  assert.ok(document.body.classList.contains('crew'), 'crew skin unlocked');
  assert.equal(document.getElementById('crewBadge').classList.contains('hidden'), false, 'badge shown');
  assert.match(document.getElementById('titleNotice').textContent, /GRANTED/);

  // clearing it locks the callsign again
  document.getElementById('crewClear').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(1);
  assert.equal(document.body.classList.contains('crew'), false);
  name.value = '';
});

await test('typing the code into the access field does not double the digits', async () => {
  // A real browser inserts the character itself on keydown *and* fires `input`.
  // Simulate exactly that, so a second manual write in the keydown handler
  // (which used to turn "1013" into "11001133") would be caught here.
  const code = document.getElementById('codeInput');
  code.value = '';
  code.focus();
  for (const ch of '1013') {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: ch, code: `Digit${ch}`, bubbles: true }));
    code.value += ch;                                   // the browser's own insert
    code.dispatchEvent(new window.Event('input', { bubbles: true }));
    pump(1);
  }
  assert.equal(code.value, '1013', `the field holds exactly what was typed (${code.value})`);
  assert.ok(document.body.classList.contains('crew'), 'the code unlocked the crew skin');
  document.getElementById('crewClear').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(1);
  assert.equal(document.body.classList.contains('crew'), false);

  // typing digits with nothing focused still feeds the access field
  code.value = '';
  code.blur();
  for (const ch of '1013') {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: ch, code: `Digit${ch}`, bubbles: true }));
    pump(1);
  }
  assert.equal(code.value, '1013', 'typed-anywhere digits land once each');
  assert.ok(document.body.classList.contains('crew'), 'unlocked from the keyboard too');
  document.getElementById('crewClear').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(1);
  code.value = '';
});

await test('cosmetics: pick colours and a material, locked ones need the code', async () => {
  const sk = window.SKYFALL;
  const $id = (id) => document.getElementById(id);
  const mats = () => [...$id('materialList').children];
  const matBtn = (id) => mats().find((b) => b.dataset.material === id);

  assert.equal($id('primarySwatches').children.length, 12, 'palette rendered');
  assert.equal(mats().length, 5, 'five materials');
  assert.equal(matBtn('neon').disabled, true, 'neon locked without the code');
  assert.equal(matBtn('scanline').disabled, true, 'scanline locked without the code');
  assert.equal(matBtn('metal').disabled, false, 'metal is free');

  // a free colour + material applies to the saved look and the preview
  $id('primarySwatches').children[1].click();
  $id('secondarySwatches').children[8].click();
  matBtn('metal').click();
  pump(2);
  assert.equal(sk.cosmetic.material, 'metal');
  assert.equal($id('cosPreview').dataset.material, 'metal');
  assert.match($id('cosSub').textContent, /metal/);
  assert.match(window.localStorage.getItem('skyfall.cosmetic') || '', /metal/, 'persisted');

  // clicking a locked material while locked does nothing
  matBtn('neon').click();
  pump(2);
  assert.notEqual(sk.cosmetic.material, 'neon', 'neon stayed locked');

  // the choice also paints the first-person weapon accents
  assert.equal(sk.weaponAccent(), 0xff6b6b, 'weapon accent follows the primary colour');

  // unlocking the code unlocks both materials, live
  const code = $id('codeInput');
  code.focus();
  for (const ch of '1013') {
    code.value += ch;
    code.dispatchEvent(new window.Event('input', { bubbles: true }));
    pump(1);
  }
  assert.ok(document.body.classList.contains('crew'), 'crew unlocked');
  assert.equal(matBtn('neon').disabled, false, 'neon unlocked');
  assert.equal(matBtn('scanline').disabled, false, 'scanline unlocked');

  matBtn('neon').click();
  pump(3);
  assert.equal(sk.cosmetic.material, 'neon', 'neon equipped');
  matBtn('scanline').click();
  pump(3);
  assert.equal(sk.cosmetic.material, 'scanline', 'scanline equipped');

  // clearing the code drops back to a material anyone may wear
  $id('crewClear').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(3);
  assert.equal(sk.cosmetic.material, 'matte', 'fell back to matte');
  assert.equal(matBtn('neon').disabled, true, 'locked again');
  // leave a plain look for the deploy test
  sk.applyCosmetic({ primary: 0x62d6ff, secondary: 0x2a3346, material: 'matte' });
  pump(2);
});

await test('deploy connects to the real server and enters the match', async () => {
  document.getElementById('nameInput').value = 'JSDOM';
  document.getElementById('deployBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(document.getElementById('title').classList.contains('hidden'), true);
  assert.equal(document.getElementById('loading').classList.contains('hidden'), false);

  for (let i = 0; i < 40; i++) { pump(2); await sleep(25); }

  assert.equal(document.getElementById('loading').classList.contains('hidden'), true, 'loading screen closed');
  assert.equal(document.getElementById('hud').classList.contains('hidden'), false, 'hud visible');
  assert.equal(document.getElementById('weaponName').textContent, 'RIFLE');
  assert.equal(document.getElementById('ammoNum').textContent, '30');
  assert.equal(document.getElementById('healthNum').textContent, '100');

  const status = await (await fetch(`http://127.0.0.1:${PORT}/api/status`)).json();
  assert.ok(status.players.some((p) => p.name === 'JSDOM'), 'server knows the player');
});

await test('gameplay frames run and the player can move + fire', async () => {
  // hold W for a bit
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW' }));
  for (let i = 0; i < 30; i++) { pump(1, 16); await sleep(4); }
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyW' }));

  // fire the rifle a few times
  const canvas = document.getElementById('gl');
  canvas.dispatchEvent(new window.MouseEvent('mousedown', { button: 0, bubbles: true }));
  for (let i = 0; i < 20; i++) { pump(1, 16); await sleep(20); }
  window.dispatchEvent(new window.MouseEvent('mouseup', { button: 0 }));
  pump(2);

  const ammo = Number(document.getElementById('ammoNum').textContent);
  assert.ok(ammo < 30, `ammo was consumed (${ammo})`);
  assert.ok(ammo > 5, `fire rate limited (${ammo})`);
});

await test('weapon switching updates the HUD and the server', async () => {
  for (const [code, name] of [['Digit2', 'SNIPER'], ['Digit3', 'SMG'], ['Digit4', 'KNIFE']]) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { code }));
    pump(2);
    window.dispatchEvent(new window.KeyboardEvent('keyup', { code }));
    pump(1);
    assert.equal(document.getElementById('weaponName').textContent, name);
    await sleep(60);
  }
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Digit1' }));
  pump(2);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Digit1' }));
  assert.equal(document.getElementById('weaponName').textContent, 'RIFLE');
});

await test('scoreboard, pause and resume work', async () => {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Tab' }));
  pump(15);
  assert.equal(document.getElementById('scoreboard').classList.contains('hidden'), false);
  assert.match(document.getElementById('sbBody').textContent, /JSDOM/);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Tab' }));
  pump(2);
  assert.equal(document.getElementById('scoreboard').classList.contains('hidden'), true);

  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape' }));
  pump(2);
  assert.equal(document.getElementById('pause').classList.contains('hidden'), false);
  document.getElementById('resumeBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(2);
  assert.equal(document.getElementById('pause').classList.contains('hidden'), true);
});

await test('second player joining shows up in the lobby and scoreboard', async () => {
  const other = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise((res, rej) => { other.on('open', res); other.on('error', rej); });
  other.send(JSON.stringify({ t: 'join', name: 'BUDDY' }));
  for (let i = 0; i < 25; i++) { pump(2); await sleep(20); }
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Tab' }));
  pump(15);
  assert.match(document.getElementById('sbBody').textContent, /BUDDY/);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Tab' }));
  pump(2);
  other.close();
  await sleep(120);
  pump(4);
});

await test('reload and scope paths run', async () => {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Digit2' }));
  pump(2);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Digit2' }));
  const canvas = document.getElementById('gl');
  // right mouse = scope
  canvas.dispatchEvent(new window.MouseEvent('mousedown', { button: 2, bubbles: true }));
  pump(12);
  assert.equal(document.getElementById('scopeOverlay').classList.contains('hidden'), false, 'scope shown');
  window.dispatchEvent(new window.MouseEvent('mouseup', { button: 2 }));
  pump(12);
  assert.equal(document.getElementById('scopeOverlay').classList.contains('hidden'), true, 'scope hidden');

  // empty the sniper mag then reload
  for (let i = 0; i < 8; i++) {
    canvas.dispatchEvent(new window.MouseEvent('mousedown', { button: 0, bubbles: true }));
    window.dispatchEvent(new window.MouseEvent('mouseup', { button: 0 }));
    pump(2, 40);
    await sleep(10);
  }
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyR' }));
  pump(4);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyR' }));
  const ring = document.getElementById('reloadRing').classList.contains('hidden');
  assert.equal(ring, false, 'reload ring visible');
  await sleep(3400);
  for (let i = 0; i < 40; i++) { pump(2); await sleep(20); }
  assert.equal(document.getElementById('ammoNum').textContent, '5', 'magazine refilled');
});

await test('combat feedback handlers: damage, kill, death, respawn', async () => {
  const { net } = window.SKYFALL;
  net.emit('damaged', { dmg: 34, hp: 66, from: [0, 0, 0], by: 99, weapon: 'rifle' });
  pump(2);
  assert.equal(document.getElementById('healthNum').textContent, '66');
  assert.ok(Number(document.getElementById('dmgVignette').style.opacity) > 0, 'damage vignette shown');

  net.emit('hitmark', { dmg: 17, kill: false, id: 99 });
  pump(1);
  assert.equal(document.getElementById('dmgNumbers').children.length, 1, 'damage number spawned');

  net.emit('kill', { killer: 99, killerName: 'SNIPERGUY', victim: window.SKYFALL.state.id, victimName: 'JSDOM', weapon: 'sniper' });
  pump(1);
  assert.match(document.getElementById('killfeed').textContent, /SNIPERGUY/);

  net.emit('died', { respawnAt: Date.now() + 3000, by: 'SNIPERGUY', weapon: 'sniper' });
  pump(2);
  assert.equal(document.getElementById('deathScreen').classList.contains('hidden'), false, 'death overlay');
  assert.equal(document.getElementById('deathBy').textContent, 'SNIPERGUY');
  assert.equal(document.getElementById('healthNum').textContent, '0');
  assert.equal(window.SKYFALL.state.alive, false);
  await sleep(220);
  pump(2);
  const left = Number(document.getElementById('respawnTimer').textContent);
  assert.ok(left > 0 && left < 3.1, `countdown running (${left})`);

  net.emit('spawn', { pos: [0, 0.05, 30], yaw: 0, hp: 100 });
  pump(2);
  assert.equal(document.getElementById('deathScreen').classList.contains('hidden'), true, 'death overlay closed');
  assert.equal(document.getElementById('healthNum').textContent, '100');
  assert.equal(window.SKYFALL.state.alive, true);
  // the sniper was equipped last, so respawn hands back a fresh 5-round mag
  assert.equal(window.SKYFALL.state.ammo[window.SKYFALL.state.weapon], 5, 'fresh magazine on respawn');
  assert.equal(document.getElementById('ammoMax').textContent, '5');
});

await test('a denied pointer lock does not pause the game (regression)', async () => {
  // Browsers fire pointerlockchange/error when a lock request is refused, which
  // is the normal case inside an iframe. Entering a mode must still work.
  const sk = window.SKYFALL;
  document.dispatchEvent(new window.Event('pointerlockerror'));
  document.dispatchEvent(new window.Event('pointerlockchange'));
  pump(3);
  assert.equal(sk.state.paused, false, 'not paused by a refused lock');
  assert.equal(document.getElementById('pause').classList.contains('hidden'), true, 'no pause overlay');
  assert.equal(sk.state.phase, 'playing', 'still in the match');
  assert.equal(sk.input.fallback, true, 'free-look fallback enabled');
});

await test('practice mode spawns dummies and lets you shoot them', async () => {
  const { startLocalMode } = window.SKYFALL;
  // leave the online match first
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape' }));
  pump(2);
  document.getElementById('leaveBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(2);
  await sleep(120);

  document.getElementById('practiceBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(4);
  const sk = window.SKYFALL;
  // the lock request is refused in jsdom; the mode must still come up
  document.dispatchEvent(new window.Event('pointerlockerror'));
  document.dispatchEvent(new window.Event('pointerlockchange'));
  pump(3);
  assert.equal(sk.state.paused, false, 'mode not blocked by the pause overlay');
  assert.equal(document.getElementById('pause').classList.contains('hidden'), true);
  assert.equal(sk.state.mode, 'practice');
  assert.equal(sk.state.phase, 'playing');
  assert.equal(document.getElementById('practiceStats').classList.contains('hidden'), false);
  assert.equal(sk.avatars.map.size, 6, 'six dummies rendered');
  assert.equal(document.getElementById('title').classList.contains('hidden'), true);

  // aim at the nearest dummy down the range lane (the lane is 30 m long)
  const dummy = sk.session.dummies
    .slice()
    .sort((p, q) => Math.hypot(p.pos[0] - sk.body.x, p.pos[2] - sk.body.z)
      - Math.hypot(q.pos[0] - sk.body.x, q.pos[2] - sk.body.z))[0];
  const dx = dummy.pos[0] - sk.body.x;
  const dz = dummy.pos[2] - sk.body.z;
  const dist = Math.hypot(dx, dz);
  sk.state.yaw = Math.atan2(-dx, -dz);
  sk.state.pitch = Math.atan2(dummy.pos[1] + 1.0 - (sk.body.y + 1.62), dist);
  pump(2);
  const hpBefore = dummy.hp;
  const canvas = document.getElementById('gl');
  const tr = sk.aimTrace();
  assert.equal(tr.victim && tr.victim.id, dummy.id, 'the crosshair is on the dummy');
  // tap the trigger: hold for a couple of frames, then release and wait out
  // the rifle cooldown
  for (let i = 0; i < 3; i++) {
    canvas.dispatchEvent(new window.MouseEvent('mousedown', { button: 0, bubbles: true }));
    pump(3);
    window.dispatchEvent(new window.MouseEvent('mouseup', { button: 0 }));
    for (let f = 0; f < 16; f++) pump(1, 20);
    await sleep(20);
  }
  if (!(dummy.hp < hpBefore)) {
    const dbg = {
      mode: sk.state.mode,
      phase: sk.state.phase,
      paused: sk.state.paused,
      ammo: sk.state.ammo[0],
      cam: sk.camera.position.toArray().map((v) => +v.toFixed(2)),
      bodyY: sk.body.y,
      dummy: dummy.pos,
      yaw: sk.state.yaw,
      pitch: sk.state.pitch,
      avatars: sk.avatars.map.size,
      sessions: !!sk.session,
    };
    throw new Error(`dummy took damage (${hpBefore} -> ${dummy.hp}) ${JSON.stringify(dbg)}`);
  }
  assert.ok(sk.state.ammo[0] < 30, 'ammo spent locally');
});

await test('practice mode runs the movement mechanics end to end', async () => {
  const sk = window.SKYFALL;
  // jump
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space' }));
  pump(2);
  assert.ok(sk.body.vy > 0 || !sk.body.onGround, 'jumped');
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Space' }));
  pump(1);
  // double jump
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space' }));
  pump(2);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Space' }));
  for (let i = 0; i < 60; i++) pump(1);
  assert.ok(sk.session.stats.jumps >= 1, 'jumps counted');

  // sprint then slide
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW' }));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ShiftLeft' }));
  for (let i = 0; i < 60; i++) pump(1);
  assert.ok(sk.state.mode === 'practice');
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyC' }));
  pump(2);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyC' }));
  assert.ok(sk.body.sliding || sk.session.stats.slides > 0, 'slide triggered');
  for (let i = 0; i < 20; i++) pump(1);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyW' }));
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'ShiftLeft' }));
  pump(2);
});

await test('speed HUD and speed preservation work in the live client', async () => {
  const sk = window.SKYFALL;
  // stand on a known-clear runway: x = 40, looking down +z
  sk.body.teleport(40, 0.05, -6);
  sk.state.yaw = Math.PI;
  sk.state.pitch = 0;
  // stand still first
  for (let i = 0; i < 30; i++) pump(1);
  assert.equal(document.getElementById('speedVal').textContent, '0.0');

  // sprint into a jump and check that air speed is kept
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW' }));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ShiftLeft' }));
  for (let i = 0; i < 80; i++) pump(1);
  const groundSpeed = sk.body.speed;
  assert.ok(groundSpeed > 9, `sprinting (${groundSpeed.toFixed(2)} m/s)`);
  assert.ok(parseFloat(document.getElementById('speedVal').textContent) > 9, 'readout follows speed');

  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space' }));
  pump(2);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Space' }));
  let minAir = Infinity;
  let minInfo = null;
  const trace = [];
  for (let i = 0; i < 90; i++) {
    pump(1);
    if (sk.body.onGround) break;
    trace.push(+sk.body.speed.toFixed(2));
    if (sk.body.speed < minAir) {
      minAir = sk.body.speed;
      minInfo = {
        i,
        wall: sk.body.wallRun,
        slide: sk.body.sliding,
        airJumps: sk.body.airJumps,
        pos: [+sk.body.x.toFixed(2), +sk.body.y.toFixed(2), +sk.body.z.toFixed(2)],
        vy: +sk.body.vy.toFixed(2),
      };
    }
  }
  assert.ok(minAir > groundSpeed * 0.8,
    `kept air speed (${groundSpeed.toFixed(2)} -> ${minAir.toFixed(2)}) ${JSON.stringify(minInfo)} trace=${trace.slice(0, 24)}`);

  // land without touching jump: the speed is held for the landing window, then
  // the mistimed landing kills it
  for (let i = 0; i < 200 && !sk.body.onGround; i++) pump(1);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyW' }));
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'ShiftLeft' }));
  pump(20);   // ~0.33 s of frames: past the landing window
  assert.ok(sk.body.speed < groundSpeed * 0.75, `landing killed the momentum (${sk.body.speed.toFixed(2)})`);
});

await test('a timed landing jump keeps the momentum in the live client', async () => {
  const sk = window.SKYFALL;
  sk.body.teleport(40, 0.05, -6);
  sk.state.yaw = Math.PI;
  for (let i = 0; i < 20; i++) pump(1);
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW' }));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ShiftLeft' }));
  for (let i = 0; i < 80; i++) pump(1);
  const groundSpeed = sk.body.speed;
  assert.ok(groundSpeed > 9, `sprinting (${groundSpeed.toFixed(2)} m/s)`);

  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space' }));
  pump(2);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Space' }));

  // drop until we are inside the landing window, then press jump
  let pressed = false;
  for (let i = 0; i < 200; i++) {
    if (!pressed && !sk.body.onGround && sk.body.vy < 0 && sk.body.timeToFloor() < 0.18) {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space' }));
      pump(1);
      window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Space' }));
      pressed = true;
      break;
    }
    pump(1);
  }
  assert.ok(pressed, 'pressed jump just above the floor');
  // the speedometer flash is the client-side signal that the timing counted
  let flashed = false;
  for (let i = 0; i < 60 && !flashed; i++) {
    pump(1);
    flashed = document.getElementById('speedometer').classList.contains('saved');
  }
  assert.ok(flashed, 'the timed landing registered (speedometer flash)');
  assert.ok(sk.body.speed > groundSpeed * 0.9,
    `the timed jump kept the speed (${groundSpeed.toFixed(2)} -> ${sk.body.speed.toFixed(2)})`);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyW' }));
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'ShiftLeft' }));
});

await test('the all-time leaderboard shows on the title screen and under L', async () => {
  // the L overlay toggles in-game
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyL' }));
  pump(3);
  assert.equal(document.getElementById('leaderboard').classList.contains('hidden'), false, 'overlay open');
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyL' }));
  pump(3);
  assert.equal(document.getElementById('leaderboard').classList.contains('hidden'), true, 'overlay closed');

  // the server serves the table over HTTP and the panel renders it
  const board = await (await fetch(`http://127.0.0.1:${PORT}/api/leaderboard?n=5`)).json();
  assert.ok(Array.isArray(board.rows), 'rows array');
  assert.ok(typeof board.total === 'number', 'total count');
  assert.ok(board.rows.every((r) => r.kills >= 0 && r.rank >= 1), 'rows carry kills + rank');
});

await test('the tutorial jump step advances from a real SPACE press', async () => {
  // Regression: the jump step looks for flags.jumped but main.js forwarded the
  // event as 'jump', so the tutorial stalled here forever while the player
  // bounced up and down wondering what they had done wrong.
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape' }));
  pump(2);
  document.getElementById('leaveBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(3);
  await sleep(120);

  document.getElementById('tutorialBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(6);
  const sk = window.SKYFALL;
  assert.equal(sk.state.mode, 'tutorial');

  const title = () => document.getElementById('objTitle').textContent;
  sk.session.advance();   // MOVE
  pump(2);
  sk.session.advance();   // LOOK
  pump(2);
  assert.equal(title(), 'JUMP', 'on the jump step');

  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
  pump(2);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'Space', key: ' ' }));
  pump(4);
  assert.notEqual(title(), 'JUMP', 'the jump step advanced after a real press');
  assert.equal(title(), 'SPRINT', `moved on to sprint (${title()})`);

  // and sprinting on foot advances the next one too
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift' }));
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
  pump(80);
  assert.equal(title(), 'SPRINT JUMP', `sprinting advanced the step (${title()})`);
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }));
  window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift' }));
  pump(2);
});

await test('tutorial starts, advances with N, and completes', async () => {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape' }));
  pump(2);
  document.getElementById('leaveBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(3);
  await sleep(120);

  document.getElementById('tutorialBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(4);
  const sk = window.SKYFALL;
  assert.equal(sk.state.mode, 'tutorial');
  assert.equal(document.getElementById('objective').classList.contains('hidden'), false, 'objective card visible');
  assert.equal(document.getElementById('objTitle').textContent, 'MOVE');
  assert.match(document.getElementById('objIndex').textContent, /1 \/ \d+/);

  const total = sk.session.stepCount;
  for (let i = 0; i < total + 2; i++) {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyN' }));
    pump(2);
  }
  assert.equal(sk.session.completed, true, 'tutorial completed');
  assert.equal(document.getElementById('objectiveDone').classList.contains('hidden'), false, 'completion overlay');
  assert.equal(document.getElementById('objective').classList.contains('hidden'), true);
});

await test('completion overlay keeps you practising or returns to title', async () => {
  const sk = window.SKYFALL;
  document.getElementById('odPractice').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(4);
  assert.equal(sk.state.mode, 'practice');
  assert.equal(document.getElementById('practiceStats').classList.contains('hidden'), false);
  assert.equal(document.getElementById('objectiveDone').classList.contains('hidden'), true);

  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape' }));
  pump(2);
  document.getElementById('leaveBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(3);
  assert.equal(sk.state.mode, 'online');
  assert.equal(document.getElementById('title').classList.contains('hidden'), false);
  assert.equal(document.getElementById('hud').classList.contains('hidden'), true);
  assert.equal(sk.avatars.map.size, 0, 'dummies cleaned up');
});

await test('leaving returns to the title screen', async () => {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape' }));
  pump(2);
  document.getElementById('leaveBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  pump(3);
  assert.equal(document.getElementById('title').classList.contains('hidden'), false);
  assert.equal(document.getElementById('hud').classList.contains('hidden'), true);
  await sleep(200);
  const status = await (await fetch(`http://127.0.0.1:${PORT}/api/status`)).json();
  assert.equal(status.players.length, 0, 'left the server');
  pump(4);
});

await test('no runtime errors were raised during the session', () => {
  const real = runtimeErrors.filter((e) => !/Not implemented|pointer|requestPointerLock/i.test(String(e && e.message)));
  assert.equal(real.length, 0, real.map((e) => e && e.stack ? e.stack.split('\n')[0] : String(e)).join(' | '));
  assert.ok(!serverLog.includes('Unhandled'), 'server stayed healthy');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
cleanup();
process.exit(failed ? 1 : 0);

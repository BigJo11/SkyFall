import * as THREE from 'three';
import { WEAPONS, PLAYER, NET, MOVE, RESERVED, CREW_GLOW, COSMETIC, isHeadHit, headshotDamage } from '../../shared/constants.js';
import { aimAssist, weaponHasAssist } from '../../shared/aimassist.js';
import { raycastAABBs, rayCapsule } from '../../shared/collision.js';
import { buildWorld } from './world.js';
import { Body } from './physics.js';
import { Input } from './input.js';
import { Net } from './net.js';
import { Hud } from './hud.js';
import { Avatars } from './avatars.js';
import { ViewModel } from './viewmodel.js';
import { Effects } from './effects.js';
import { sfx } from './audio.js';
import { PracticeMode, Tutorial, PRACTICE_SPAWN } from './practice.js';
import { renderEntry, renderTabs, DEFAULT_ENTRY, LATEST_VERSION } from './updates.js';

const $ = (id) => document.getElementById(id);

// Safe event wiring: a missing element (stale HTML, older cached page) must
// never take down the whole game.
function on(id, event, fn) {
  const el = $(id);
  if (!el) { console.warn(`[skyfall] missing #${id}`); return null; }
  el.addEventListener(event, fn);
  return el;
}

// Surface fatal errors on screen instead of failing silently.
function reportFatal(err) {
  console.error('[skyfall]', err);
  let box = $('fatal');
  if (!box) {
    box = document.createElement('div');
    box.id = 'fatal';
    document.body.appendChild(box);
  }
  box.textContent = `SKYFALL hit an error: ${err && err.message ? err.message : err}. ` +
    'Reload the page (Ctrl/Cmd+Shift+R) and try again.';
  box.classList.add('show');
}

window.addEventListener('error', (e) => {
  if (e && e.error) reportFatal(e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  if (e && e.reason) reportFatal(e.reason);
});

// ---------------------------------------------------------------- renderer
const canvas = $('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
} catch (err) {
  document.body.innerHTML =
    '<div style="display:grid;place-items:center;height:100%;font:600 18px system-ui;color:#cfe6ff;' +
    'text-align:center;padding:24px;line-height:1.6">SKYFALL needs WebGL.<br>' +
    '<span style="opacity:.6;font-weight:400;font-size:14px">Enable hardware acceleration in your browser and reload.</span></div>';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(88, 1, 0.06, 2000);
camera.rotation.order = 'YXZ';

const world = buildWorld(renderer, scene, camera);
const body = new Body(world.solids);
const input = new Input(canvas);
const net = new Net();
const hud = new Hud();
const avatars = new Avatars(scene);
const viewmodel = new ViewModel(renderer);
const effects = new Effects(scene);

// ---------------------------------------------------------------- storage
// localStorage can throw in sandboxed frames, so never let it break boot.
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  },
};

// ---------------------------------------------------------------- settings
const settings = {
  sens: Number(store.get('skyfall.sens', 1)) || 1,
  volume: Number(store.get('skyfall.volume', 0.7)),
  fov: Number(store.get('skyfall.fov', 88)) || 88,
};
sfx.volume = settings.volume;

const state = {
  phase: 'title',       // title | loading | playing | dead
  mode: 'online',       // online | practice | tutorial
  paused: false,
  id: 0,
  name: '',
  color: 0x62d6ff,
  crew: false,
  hp: 100,
  alive: false,
  kills: 0,
  deaths: 0,
  weapon: 0,
  ammo: WEAPONS.map((w) => w.magSize),
  reloadEndsAt: 0,
  reloadDur: 0,
  nextFireAt: WEAPONS.map(() => 0),
  recoilBloom: 0,
  scoped: false,
  respawnAt: 0,
  players: [],
  yaw: 0,
  pitch: 0,
  time: 0,
  lastInputSent: 0,
  lastShotVisual: 0,
  damageDealt: 0,
  fallSpeed: 0,
  fov: settings.fov,
  camY: 0,
  bob: 0,
  stepDist: 0,
  shownScoreboard: false,
  shownLeaderboard: false,
  updatesEntry: null,          // which changelog tab the panel is showing
  cosmetic: { ...COSMETIC.default },
  leaderboard: [],
  firedSinceSwitch: false,
  lastKiller: null,
  deathWeapon: null,
  roll: 0,
};

// offline practice / tutorial session (null while playing online)
let session = null;

// Build stamp: makes it obvious which version the browser actually loaded, and
// catches the classic "new page, old cached scripts" situation where every
// button appears dead.
const BUILD = 'forest v13';

function detectStaleBuild() {
  try {
    const myBuild = new URL(import.meta.url).searchParams.get('v');
    const pageBuild = window.__SKYFALL_BUILD__;
    const measurable = !!pageBuild && pageBuild !== '__BUILD__';
    const stale = measurable && !!myBuild && myBuild !== pageBuild;
    const tag = $('buildTag');
    if (tag) tag.textContent = `build ${myBuild || 'dev'} · ${BUILD}`;
    console.log('[skyfall]', BUILD, '· module build:', myBuild || 'dev', '· page build:', pageBuild || 'dev');
    if (stale) {
      const box = $('fatal');
      if (box) {
        box.textContent = 'SKYFALL loaded an out-of-date script from the browser cache, so the '
          + 'menu buttons will not work. Hard reload this page (Ctrl/Cmd + Shift + R) to fix it.';
        box.classList.add('show');
      }
    }
    return stale;
  } catch (e) {
    return false;
  }
}
const staleBuild = detectStaleBuild();

// A stale module graph makes the mode buttons dead; make them heal themselves.
function hardReload() {
  try {
    const url = new URL(location.href);
    url.searchParams.set('r', Date.now().toString(36));
    location.replace(url.toString());
  } catch {
    location.reload();
  }
}

// ---------------------------------------------------------------- resize
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  viewmodel.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- helpers
const worldDir = new THREE.Vector3();
function aimDirection() {
  camera.getWorldDirection(worldDir);
  return [worldDir.x, worldDir.y, worldDir.z];
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();

// Cast the local aim ray against world + remote players (visual prediction).
function localRaycast(maxDist, dirOverride = null) {
  const origin = new THREE.Vector3().copy(camera.position);
  const dir = dirOverride || aimDirection();
  const hit = raycastAABBs(world.solids, origin.x, origin.y, origin.z, dir[0], dir[1], dir[2], maxDist);
  let t = hit.t;
  let victim = null;
  if (hit.aabb) {
    _n.set(origin.x + dir[0] * t, origin.y + dir[1] * t, origin.z + dir[2] * t);
  }
  for (const a of avatars.map.values()) {
    if (!a.alive) continue;
    const ht = rayCapsule(
      origin.x, origin.y, origin.z, dir[0], dir[1], dir[2],
      [a.pos.x, a.pos.y, a.pos.z], PLAYER.height, PLAYER.radius + 0.06, t
    );
    if (ht < t) { t = ht; victim = a; }
  }
  const hitWorld = !victim && !!hit.aabb;
  const point = new THREE.Vector3(origin.x + dir[0] * t, origin.y + dir[1] * t, origin.z + dir[2] * t);
  // same head zone the server uses, so the local feedback matches the real hit
  const head = !!victim && !currentWeapon().melee && isHeadHit(point.y - victim.pos.y);
  // surface normal for impacts
  let normal = new THREE.Vector3(-dir[0], -dir[1], -dir[2]);
  if (victim) {
    normal.set(point.x - victim.pos.x, 0, point.z - victim.pos.z).normalize();
    if (normal.lengthSq() < 0.01) normal.set(0, 0, 1);
  } else if (hit.aabb) {
    // figure out which face we hit
    const a = hit.aabb;
    const eps = 0.04;
    if (Math.abs(point.x - a.minX) < eps) normal.set(-1, 0, 0);
    else if (Math.abs(point.x - a.maxX) < eps) normal.set(1, 0, 0);
    else if (Math.abs(point.y - a.minY) < eps) normal.set(0, -1, 0);
    else if (Math.abs(point.y - a.maxY) < eps) normal.set(0, 1, 0);
    else if (Math.abs(point.z - a.minZ) < eps) normal.set(0, 0, -1);
    else if (Math.abs(point.z - a.maxZ) < eps) normal.set(0, 0, 1);
  }
  return { origin, dir, point, normal, victim, hitWorld, head, dist: t };
}

// Players the crosshair could plausibly reach: alive, in front, and not behind
// cover. Walls still win, so assist can never shoot through the map.
function assistCandidates(range) {
  const out = [];
  const origin = camera.position;
  for (const a of avatars.map.values()) {
    if (!a.alive) continue;
    const dx = a.pos.x - origin.x;
    const dy = (a.pos.y + PLAYER.height * 0.62) - origin.y;
    const dz = a.pos.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-3 || dist > range) continue;
    const solid = raycastAABBs(world.solids, origin.x, origin.y, origin.z, dx / dist, dy / dist, dz / dist, dist - 0.15);
    if (solid.t < dist - 0.15) continue;      // something solid in the way
    out.push({ id: a.id, pos: [a.pos.x, a.pos.y, a.pos.z], height: PLAYER.height });
  }
  return out;
}

// The full assist decision for the current aim: which target (if any) it locked
// onto and how far it bent. Sniper and knife opt out.
function aimAssistResult(dir = aimDirection()) {
  const w = currentWeapon();
  if (!weaponHasAssist(w)) return { dir, targetId: null, pullDeg: 0, angleDeg: Infinity, dist: Infinity };
  return aimAssist(
    [camera.position.x, camera.position.y, camera.position.z],
    dir,
    assistCandidates(Math.min(w.range, 95)),
  );
}

// The direction this shot will actually travel: slightly bent toward a target
// that is already close to the crosshair.
function assistedAimDirection() {
  const res = aimAssistResult();
  return res.pullDeg > 0 ? res.dir : aimDirection();
}

function muzzleWorldPos(out = new THREE.Vector3()) {
  const dir = aimDirection();
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  return out.set(
    camera.position.x + dir[0] * 0.55 + right.x * 0.16,
    camera.position.y + dir[1] * 0.55 - 0.13,
    camera.position.z + dir[2] * 0.55 + right.z * 0.16
  );
}

// ---------------------------------------------------------------- firing
function currentWeapon() { return WEAPONS[state.weapon]; }

function canReload() {
  const w = currentWeapon();
  if (!Number.isFinite(w.magSize)) return false;
  if (state.reloadEndsAt) return false;
  return state.ammo[state.weapon] < w.magSize;
}

function startReload() {
  const w = currentWeapon();
  if (!canReload()) return;
  state.reloadEndsAt = performance.now() + w.reloadTime;
  state.reloadDur = w.reloadTime;
  viewmodel.startReload(w.reloadTime);
  net.send({ t: 'reload' });
  sfx.reload(w.reloadTime / 1000);
  session?.onEvent?.('reload');
}

function switchWeapon(i, send = true) {
  if (i < 0 || i >= WEAPONS.length || i === state.weapon) return;
  state.lastWeapon = state.weapon;
  state.weapon = i;
  state.reloadEndsAt = 0;
  viewmodel.cancelReload();
  viewmodel.setWeapon(WEAPONS[i].id);
  hud.setWeapon(i, state.ammo[i]);
  hud.reloadProgress(null);
  setScoped(false);
  sfx.swap();
  state.firedSinceSwitch = false;
  if (send) net.send({ t: 'weapon', i });
  session?.onEvent?.('weaponSwitched', { index: i });
}

function setScoped(v) {
  if (v === state.scoped) return;
  state.scoped = v;
  viewmodel.setScoped(v);
  hud.scope(v && currentWeapon().id === 'sniper');
}

function fireOnce(now) {
  const w = currentWeapon();
  if (!state.alive || state.paused) return;
  if (state.reloadEndsAt) return;
  if (now < state.nextFireAt[state.weapon]) return;

  const infinite = !Number.isFinite(w.magSize);
  if (!infinite && state.ammo[state.weapon] <= 0) {
    if (now - state.lastShotVisual > 220) {
      state.lastShotVisual = now;
      sfx.empty();
      startReload();
    }
    return;
  }

  state.nextFireAt[state.weapon] = now + w.interval + 10;
  state.firedSinceSwitch = true;
  if (!infinite) {
    state.ammo[state.weapon] -= 1;
    hud.setAmmo(state.ammo[state.weapon]);
    if (state.ammo[state.weapon] <= 0) setTimeout(() => canReload() && state.phase === 'playing' && startReload(), 120);
  }

  // recoil + feel
  const recoilKick = w.recoil * 0.0045;
  state.pitch = Math.min(1.5, state.pitch + recoilKick * (0.6 + Math.random() * 0.8));
  state.yaw += (Math.random() - 0.5) * recoilKick * (w.id === 'sniper' ? 1.6 : 1.1);
  state.recoilBloom = Math.min(26, state.recoilBloom + (w.id === 'smg' ? 3 : w.id === 'sniper' ? 14 : 5));

  viewmodel.fire();
  if (w.melee) viewmodel.swing();
  sfx.shot(w.id, 0, true);

  const shotDir = assistedAimDirection();
  const hit = localRaycast(w.range, shotDir);
  const from = muzzleWorldPos();
  effects.muzzle(from);
  if (!w.melee) {
    effects.tracer(from, hit.point, w.color, w.id === 'sniper' ? 0.035 : 0.02);
  }
  if (hit.victim) {
    effects.impact(hit.point, hit.normal, 'blood');
    session?.onLocalHit?.(hit.victim, w, { head: hit.head });
  } else if (hit.hitWorld) {
    effects.impact(hit.point, hit.normal, 'world');
  }

  net.send({ t: 'fire', dir: shotDir });
}

// ---------------------------------------------------------------- camera
function updateCamera(dt) {
  const speed = Math.hypot(body.vx, body.vz);
  // head bob
  if (body.onGround && speed > 0.6) {
    state.bob += dt * (6 + speed * 0.9);
    state.stepDist += speed * dt;
    if (state.stepDist > 2.4) { state.stepDist = 0; sfx.step(0.8); }
  } else {
    state.stepDist = 1.6;
  }
  const bobAmt = body.onGround ? Math.min(speed / PLAYER.sprintSpeed, 1) * 0.04 : 0;
  const bobY = Math.sin(state.bob * 2) * bobAmt;
  const bobX = Math.cos(state.bob) * bobAmt * 0.6;

  // smooth vertical follow over stairs, and duck while sliding
  const targetY = body.y + PLAYER.eye + body.eyeOffset;
  if (state.camY === 0) state.camY = targetY;
  const dy = targetY - state.camY;
  state.camY += dy * Math.min(1, dt * (dy > 0.4 || dy < -0.4 ? 26 : 16));

  const strafe = (body.vx * Math.cos(state.yaw) - body.vz * Math.sin(state.yaw)) / PLAYER.sprintSpeed;
  camera.position.set(body.x + bobX * 0.5, state.camY + bobY, body.z);

  // roll: strafe lean + shoulder-first lean into wall runs
  const wallRoll = body.wallRun ? -body.wallSide * 0.17 : 0;
  const targetRoll = wallRoll + -strafe * 0.022;
  state.roll += (targetRoll - state.roll) * Math.min(1, dt * 9);
  camera.rotation.set(state.pitch, state.yaw, state.roll);

  // fov: sniper scope zoom, plus a small widening when carrying extra speed
  const excess = Math.max(0, body.speed - PLAYER.sprintSpeed);
  const speedFov = Math.min(9, excess * 1.4);
  const targetFov = state.scoped ? 20 : (state.phase === 'dead' ? 96 : state.fov + speedFov);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 13);
  camera.updateProjectionMatrix();

  // viewmodel follows the real fov ratio
  viewmodel.setFov(state.fov);
}

// ---------------------------------------------------------------- input loop
function handleGameplayInput(now, dt) {
  // look
  const look = input.takeLook();
  const sens = settings.sens * (state.scoped ? 0.32 : 1) * 0.0022;
  if (look.dx || look.dy) {
    state.yaw -= look.dx * sens;
    state.pitch -= look.dy * sens;
    state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch));
  }
  viewmodel._lookDX = look.dx;
  viewmodel._lookDY = look.dy;
  if (look.dx || look.dy) session?.onEvent?.('look', look);

  // weapons
  const slot = input.weaponSlotPressed();
  if (slot >= 0) switchWeapon(slot);
  if (input.wheel !== 0) {
    switchWeapon((state.weapon + (input.wheel > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length);
  }
  if (input.pressed('KeyR')) startReload();
  if (input.pressed('KeyQ')) {
    // last weapon
    if (state.lastWeapon != null) switchWeapon(state.lastWeapon);
  }

  // sniper scope (right mouse held)
  if (currentWeapon().id === 'sniper') {
    setScoped(input.mouseDown(2) && state.alive && !state.reloadEndsAt);
  } else if (state.scoped) {
    setScoped(false);
  }

  // firing
  const w = currentWeapon();
  const trigger = w.automatic ? input.mouseDown(0) : input.mousePressed(0);
  if (trigger && state.alive && !state.paused) fireOnce(now);

  // movement
  const axes = input.axes();
  const wish = state.alive && !state.paused
    ? { forward: axes.forward, right: axes.right, sprint: axes.sprint }
    : { forward: 0, right: 0, sprint: false };

  // Jump: a fresh press always jumps. HOLDING the key keeps hopping as soon as
  // you touch down, so sprinting and spamming space never eats an input.
  const canAct = state.alive && !state.paused;
  body.jumpHeld = canAct && input.down('Space');
  if (input.pressed('Space') && canAct) body.wantJump = true;
  if (input.pressed('KeyC') || input.pressed('ControlLeft') || input.pressed('ControlRight')) {
    if (state.alive && !state.paused) body.wantSlide = true;
  }

  if (!state.paused) body.update(dt, wish, state.yaw);

  if (body.justLanded) {
    body.justLanded = false;
    if (body.fallSpeed > 12) sfx.land();
  }

  // network position at NET.INPUT_HZ
  if (now - state.lastInputSent > 1000 / NET.INPUT_HZ) {
    state.lastInputSent = now;
    net.send({ t: 'input', p: [round(body.x), round(body.y), round(body.z)], yaw: state.yaw, pitch: state.pitch });
  }
}

const round = (v) => Math.round(v * 1000) / 1000;

// Movement events raised by the physics body this frame (jump, wall run...).
function forwardMovementEvents() {
  const ev = body.events;
  if (!ev) return;
  if (ev.jumped) { sfx.jump(); session?.onEvent?.('jump'); }
  if (ev.sprintJump) session?.onEvent?.('sprintJump');
  if (ev.doubleJumped) { sfx.doubleJump(); session?.onEvent?.('doubleJump'); }
  if (ev.wallRunStarted) { sfx.wallRun(); session?.onEvent?.('wallRun'); }
  if (ev.wallJumped) { sfx.wallJump(); session?.onEvent?.('wallJump'); }
  if (ev.slideStarted) { sfx.slide(); session?.onEvent?.('slide'); }
  if (ev.slideLanding) { sfx.slide(); session?.onEvent?.('slideLanding'); }
  if (ev.perfectLanding) { sfx.perfect(); hud.momentumSaved(); session?.onEvent?.('perfectLanding'); }
  if (ev.momentumLost && body.speed > 1) sfx.land();
  body.events = {};
}

// ---------------------------------------------------------------- local modes
// Practice and tutorial run entirely offline: no socket, local dummies,
// local damage. The shared weapon/movement code is reused unchanged.
function startLocalMode(kind) {
  hideUpdates();
  clearTimeout(connectTimer);
  net.disconnect();
  session?.dispose?.();
  session = null;

  state.mode = kind === 'tutorial' ? 'tutorial' : 'practice';
  state.id = 0;
  state.name = (($('nameInput').value || '').trim() || 'PLAYER').toUpperCase();
  state.kills = 0;
  state.deaths = 0;
  state.players = [];
  state.weapon = 0;
  state.ammo = WEAPONS.map((w) => w.magSize);
  state.nextFireAt = WEAPONS.map(() => 0);
  state.reloadEndsAt = 0;
  state.reloadDur = 0;
  state.alive = true;
  state.hp = PLAYER.maxHealth;
  state.paused = false;
  state.phase = 'playing';
  state.scoped = false;
  state.lastWeapon = null;

  avatars.map.forEach((a) => a.dispose(scene));
  avatars.map.clear();
  body.reset();
  body.teleport(PRACTICE_SPAWN.pos[0], PRACTICE_SPAWN.pos[1], PRACTICE_SPAWN.pos[2]);
  state.yaw = PRACTICE_SPAWN.yaw;
  state.pitch = 0;
  state.camY = PRACTICE_SPAWN.pos[1] + PLAYER.eye;
  state.roll = 0;

  viewmodel.setWeapon(WEAPONS[0].id);
  viewmodel.setScoped(false);
  viewmodel.cancelReload();
  hud.show(true);
  hud.setWeapon(0, state.ammo[0]);
  hud.setHealth(state.hp);
  hud.setKillsDeaths(0, 0);
  hud.hideDeath();
  hud.reloadProgress(null);
  hud.scope(false);
  hud.showObjectiveDone(false);
  hud.setSpeed(0);
  $('title').classList.add('hidden');
  $('loading').classList.add('hidden');
  $('pause').classList.add('hidden');

  input.enabled = true;
  sfx.init();
  sfx.resume();

  const ctx = {
    state, body, hud, sfx, effects, avatars, scene, camera,
    switchWeapon: (i) => switchWeapon(i, false),
    place: (pos, yaw) => {
      body.teleport(pos[0], pos[1], pos[2]);
      state.yaw = yaw;
      state.pitch = 0;
      state.camY = pos[1] + PLAYER.eye;
      state.roll = 0;
    },
  };
  session = kind === 'tutorial' ? new Tutorial(ctx) : new PracticeMode(ctx);
  session.start();
  tryLock();
  input.endFrame();
}

function endLocalMode() {
  session?.dispose?.();
  session = null;
  state.mode = 'online';
}

// ---------------------------------------------------------------- network
let lastSnapshotAt = 0;

let connectTimer = null;

function connect(name, code = '', cosmetic = null) {
  state.phase = 'loading';
  $('title').classList.add('hidden');
  $('loading').classList.remove('hidden');

  clearTimeout(connectTimer);
  connectTimer = setTimeout(() => {
    if (state.phase === 'loading') leaveToTitle('The server did not respond — is it running?');
  }, 9000);

  net.connect(name, code, cosmetic || state.cosmetic)
    .then(() => {
      // wait for welcome (handled below)
    })
    .catch((err) => {
      $('loading').classList.add('hidden');
      $('title').classList.remove('hidden');
      state.phase = 'title';
      hud.toast(err.message || 'Could not connect');
    });
}

net.on('welcome', (msg) => {
  clearTimeout(connectTimer);
  state.id = msg.id;
  state.name = msg.name;
  state.color = msg.color;
  const you = msg.you || { pos: [0, 0.05, 0], yaw: 0 };
  body.teleport(you.pos[0], you.pos[1], you.pos[2]);
  state.yaw = you.yaw;
  state.pitch = 0;
  state.camY = you.pos[1] + PLAYER.eye;
  state.hp = you.hp ?? PLAYER.maxHealth;
  state.alive = true;
  state.kills = you.kills || 0;
  state.deaths = you.deaths || 0;
  state.ammo = WEAPONS.map((w) => w.magSize);
  state.weapon = 0;
  state.nextFireAt = WEAPONS.map(() => 0);
  state.reloadEndsAt = 0;

  avatars.sync(msg.players || [], state.id);
  viewmodel.setWeapon(WEAPONS[0].id);
  hud.setWeapon(0, state.ammo[0]);
  hud.setHealth(state.hp);
  hud.setKillsDeaths(state.kills, state.deaths);
  if (Array.isArray(msg.leaderboard)) setLeaderboard(msg.leaderboard, msg.leaderboard.length);

  input.enabled = true;
  $('loading').classList.add('hidden');
  hud.show(true);
  state.phase = 'playing';
  state.paused = false;

  tryLock();
  sfx.init();
  sfx.resume();
  sfx.spawn();
  hud.centerMessage('WELCOME TO SKYFALL', 1800);
  input.endFrame();
});

net.on('snapshot', (msg) => {
  lastSnapshotAt = performance.now();
  if (state.mode !== 'online') return;
  state.players = msg.players;
  avatars.sync(msg.players, state.id);
  const me = msg.players.find((p) => p.id === state.id);
  if (me) {
    // keep local prediction for movement, trust the server for stats
    state.kills = me.kills;
    state.deaths = me.deaths;
    hud.setKillsDeaths(state.kills, state.deaths);
    if (Math.abs(me.hp - state.hp) > 0.6) {
      state.hp = me.hp;
      hud.setHealth(state.hp);
    } else if (me.hp > state.hp) {
      state.hp = me.hp;
      hud.setHealth(state.hp);
    }
    if (!me.alive && state.alive) {
      // died without a 'died' message (fall etc.)
      state.alive = false;
      state.phase = 'dead';
      if (!state.respawnAt || state.respawnAt < Date.now()) {
        state.respawnAt = Date.now() + PLAYER.respawnTime;
      }
      hud.setHealth(0);
      hud.showDeath(state.lastKiller || null, state.deathWeapon || null);
    }
  }
});

net.on('join', (msg) => {
  sfx.join();
  hud.killFeed(msg.player.name, 'JOINED', null, {});
  hud.toast(`${msg.player.name} joined the match`);
});

net.on('leave', (msg) => {
  hud.toast(`${msg.name} left the match`);
});

net.on('self', (msg) => {
  if (msg.weapon != null && msg.weapon !== state.weapon) {
    switchWeapon(msg.weapon, false);
  }
  // the switch confirmation can arrive after we already fired a predicted shot,
  // so only adopt the server's ammo when we have not spent anything since
  if (msg.ammo != null && !state.firedSinceSwitch) {
    state.ammo[state.weapon] = msg.ammo;
    hud.setAmmo(msg.ammo);
  }
  if (msg.reloadEnd != null) {
    state.reloadEndsAt = performance.now() + msg.reloadEnd;
  }
});

net.on('spawn', (msg) => {
  body.teleport(msg.pos[0], msg.pos[1], msg.pos[2]);
  state.yaw = msg.yaw;
  state.pitch = 0;
  state.camY = msg.pos[1] + PLAYER.eye;
  state.hp = msg.hp ?? PLAYER.maxHealth;
  state.alive = true;
  state.phase = 'playing';
  state.reloadEndsAt = 0;
  state.ammo = WEAPONS.map((w) => w.magSize);
  viewmodel.cancelReload();
  hud.setHealth(state.hp);
  hud.setWeapon(state.weapon, state.ammo[state.weapon]);
  hud.reloadProgress(null);
  hud.hideDeath();
  hud.flash(0.35);
  sfx.spawn();
  if (state.paused) hidePause();
  tryLock();
});

net.on('damaged', (msg) => {
  state.hp = msg.hp;
  hud.setHealth(msg.hp);
  hud.damageFlash(Math.min(1, msg.dmg / 40));
  sfx.damage();
  if (msg.from) {
    // subtle directional hit indicator via the vignette
    const from = new THREE.Vector3().fromArray(msg.from);
    const toMe = new THREE.Vector3(body.x - from.x, 0, body.z - from.z).normalize();
    const fwd = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    const side = toMe.x * fwd.z - toMe.z * fwd.x;
    const grd = $('dmgVignette');
    grd.style.background = `radial-gradient(120% 90% at ${50 + side * 40}% 50%, transparent 35%, rgba(255,40,40,.6) 100%)`;
  }
});

net.on('hitmark', (msg) => {
  hud.hitmarker(msg.kill, msg.head);
  sfx.hit(msg.kill);
  hud.damageNumber(msg.dmg, (Math.random() - 0.5) * 110, -34 + (Math.random() - 0.5) * 46, { head: msg.head });
});

net.on('kill', (msg) => {
  const killerIsMe = msg.killer === state.id;
  const victimIsMe = msg.victim === state.id;
  hud.killFeed(
    msg.killerName || (msg.weapon === 'fall' ? 'THE VOID' : '—'),
    msg.victimName,
    msg.weapon,
    { killerIsMe, victimIsMe, head: msg.head }
  );
  const vId = msg.victim;
  const a = avatars.get(vId);
  if (a) {
    effects.deathRing(a.pos, 0xff5555);
    effects.spawnParticles(a.pos.clone().add(new THREE.Vector3(0, 1, 0)), 30, {
      speed: 4, spread: 2, color: [1, 0.25, 0.2], ttl: 0.9, gravity: 6,
    });
  }
  if (killerIsMe) {
    sfx.kill();
    hud.centerMessage(
      `${msg.weapon === 'knife' ? 'KNIFE' : (msg.weapon || '').toUpperCase()} ${msg.head ? 'HEADSHOT' : 'ELIMINATION'}`,
      1400,
    );
  }
});

net.on('died', (msg) => {
  state.lastKiller = msg.by;
  state.deathWeapon = msg.weapon;
  state.alive = false;
  state.phase = 'dead';
  state.respawnAt = msg.respawnAt || (Date.now() + PLAYER.respawnTime);
  state.reloadEndsAt = 0;
  viewmodel.cancelReload();
  setScoped(false);
  hud.showDeath(msg.by, msg.weapon);
  hud.setHealth(0);
  hud.reloadProgress(null);
  sfx.death();
  hud.flash(0.25);
});

net.on('shot', (msg) => {
  if (msg.id === state.id) return; // already predicted locally
  const from = new THREE.Vector3().fromArray(msg.from);
  const to = new THREE.Vector3().fromArray(msg.to);
  const color = msg.weapon === 'sniper' ? 0xffd479 : msg.weapon === 'smg' ? 0x9dffc1 : 0xbfe9ff;
  if (msg.weapon !== 'knife') effects.tracer(from, to, color, msg.weapon === 'sniper' ? 0.035 : 0.02);
  const dist = from.distanceTo(camera.position);
  sfx.shot(msg.weapon, dist, false);
  const dir = to.clone().sub(from).normalize();
  if (msg.hit) effects.impact(to, dir.negate(), 'blood');
  else effects.impact(to, dir.negate(), 'world');
});

net.on('pong', (msg) => {
  const rtt = Date.now() - msg.c;
  hud.setPingValue(rtt);
});

net.on('reload', (msg) => {
  if (msg.id === state.id) return;
  const a = avatars.get(msg.id);
  if (a) a.reloadHint = performance.now();
});

net.on('empty', () => { sfx.empty(); });

net.on('correct', (msg) => {
  body.teleport(msg.pos[0], msg.pos[1], msg.pos[2]);
});

net.on('close', () => {
  leaveToTitle('Connection to the server was lost');
});

// ---------------------------------------------------------------- screens
function tryLock() {
  input.requestLock().then((ok) => {
    if (!ok) {
      setTimeout(() => {
        if (!input.locked) enableFallback();
      }, 350);
    }
  });
  setTimeout(() => {
    if (!input.locked && state.phase !== 'title') enableFallback();
  }, 700);
}

let fallbackWarned = false;
function enableFallback() {
  if (input.locked) return;
  input.fallback = true;
  if (state.paused && state.phase !== 'title') {
    // lock is unavailable here, do not leave the player stuck on the pause menu
    state.paused = false;
    $('pause').classList.add('hidden');
  }
  if (!fallbackWarned) {
    fallbackWarned = true;
    hud.toast('Pointer lock blocked — free look enabled. Click for mouse aim.', 4000);
  }
}

// True while a text field has focus, so shortcuts never eat a typed letter.
function fieldFocused() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

// Track whether we ever actually held the mouse capture. Browsers fire
// pointerlockchange as soon as a request is refused (common inside iframes,
// where the pointer-lock permission is often denied), so only a *loss* of a
// lock we really had should pause the game.
let hadPointerLock = false;

input.onLockChange = (locked) => {
  if (locked) { hadPointerLock = true; return; }
  if (input.fallback) return;               // free-look mode: never pause
  if (hadPointerLock && state.phase === 'playing' && !state.paused) {
    showPause();
  }
};

input.onLockError = () => {
  hadPointerLock = false;
  enableFallback();
};

function showPause() {
  if (state.phase === 'title') return;
  state.paused = true;
  input.buttons.clear();
  input.exitLock();
  $('pause').classList.remove('hidden');
  hud.show(true);
}

function hidePause() {
  state.paused = false;
  $('pause').classList.add('hidden');
  if (!input.fallback) tryLock();
  input.endFrame();
}

function leaveToTitle(reason) {
  hideUpdates();
  input.enabled = false;
  input.exitLock();
  net.disconnect();
  endLocalMode();
  hud.showObjectiveDone(false);
  hud.showObjective(null);
  hud.setSpeed(0);
  avatars.map.forEach((a) => a.dispose(scene));
  avatars.map.clear();
  $('pause').classList.add('hidden');
  hud.show(false);
  hud.hideDeath();
  $('scoreboard').classList.add('hidden');
  state.shownLeaderboard = false;
  hud.leaderboard([], false);
  $('title').classList.remove('hidden');
  state.phase = 'title';
  state.paused = false;
  if (reason) hud.toast(reason, 3500);
  refreshLobby();
  refreshLeaderboard();
}

// ---------------------------------------------------------------- cosmetics
// Primary / secondary colour and a body material, saved locally and sent with
// the join so everyone else sees it. Neon and scanline are crew-only: the
// server re-checks that too, this is just the UI half.
const COS_STORE = 'skyfall.cosmetic';

function loadCosmetic() {
  let saved = null;
  try { saved = JSON.parse(store.get(COS_STORE, 'null')); } catch { saved = null; }
  return COSMETIC.normalise(saved, { crew: crewUnlocked() });
}

function saveCosmetic() {
  store.set(COS_STORE, JSON.stringify(state.cosmetic));
}

function applyCosmetic(next, { persist = true } = {}) {
  // a locked material can only be worn by an unlocked player
  const look = COSMETIC.normalise(next, { crew: crewUnlocked() });
  state.cosmetic = look;
  if (persist) saveCosmetic();
  renderCosmetic();
  return look;
}

function renderCosmetic() {
  const { primary, secondary, material } = state.cosmetic;
  const hex = COSMETIC.hex;
  const preview = $('cosPreview');
  if (preview) {
    preview.style.setProperty('--cos-primary', hex(primary));
    preview.style.setProperty('--cos-secondary', hex(secondary));
    preview.dataset.material = material;
  }
  for (const [listId, key] of [['primarySwatches', 'primary'], ['secondarySwatches', 'secondary']]) {
    const list = $(listId);
    if (!list) continue;
    for (const btn of list.children) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.color) === state.cosmetic[key]));
    }
  }
  const list = $('materialList');
  if (list) {
    for (const btn of list.children) {
      const id = btn.dataset.material;
      const meta = COSMETIC.materialById(id);
      const locked = !!meta?.locked && !crewUnlocked();
      btn.setAttribute('aria-pressed', String(id === material));
      btn.disabled = locked;
      btn.title = locked ? `${meta.name} — crew access code required` : (meta?.blurb || '');
    }
  }
  const sub = $('cosSub');
  const meta = COSMETIC.materialById(material);
  if (sub) sub.textContent = `${meta ? meta.name.toLowerCase() : material} · ${hex(primary)} / ${hex(secondary)}`;
  viewmodel.setAccent(primary);
  const hint = $('cosHint');
  if (hint) {
    hint.textContent = crewUnlocked()
      ? 'crew access: every material unlocked'
      : 'neon & scanline need crew access';
  }
}

function buildCosmeticUI() {
  const primary = $('primarySwatches');
  const secondary = $('secondarySwatches');
  const materials = $('materialList');
  if (primary && !primary.children.length) {
    for (const sw of COSMETIC.palette) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.type = 'button';
      b.dataset.color = String(sw.color);
      b.style.setProperty('--sw', COSMETIC.hex(sw.color));
      b.setAttribute('aria-label', `primary ${sw.id}`);
      b.addEventListener('click', () => applyCosmetic({ ...state.cosmetic, primary: sw.color }));
      primary.appendChild(b);
    }
  }
  if (secondary && !secondary.children.length) {
    for (const sw of COSMETIC.palette) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.type = 'button';
      b.dataset.color = String(sw.color);
      b.style.setProperty('--sw', COSMETIC.hex(sw.color));
      b.setAttribute('aria-label', `secondary ${sw.id}`);
      b.addEventListener('click', () => applyCosmetic({ ...state.cosmetic, secondary: sw.color }));
      secondary.appendChild(b);
    }
  }
  if (materials && !materials.children.length) {
    for (const m of COSMETIC.materials) {
      const b = document.createElement('button');
      b.className = 'mat';
      b.type = 'button';
      b.dataset.material = m.id;
      b.innerHTML = m.locked ? `${m.name}<span class="lock">◆</span>` : m.name;
      b.addEventListener('click', () => {
        if (m.locked && !crewUnlocked()) {
          titleNotice(`${m.name} IS CREW ONLY — ENTER THE ACCESS CODE`);
          return;
        }
        applyCosmetic({ ...state.cosmetic, material: m.id });
      });
      materials.appendChild(b);
    }
  }
  state.cosmetic = loadCosmetic();
  renderCosmetic();
}

on('deployBtn', 'click', () => {
  const name = ($('nameInput').value || '').trim().toUpperCase() || `PLAYER ${Math.floor(Math.random() * 900 + 100)}`;
  if (RESERVED.isReserved(name) && !crewUnlocked()) {
    titleNotice('THAT CALLSIGN IS TAKEN');
    return;
  }
  hideUpdates();
  store.set('skyfall.name', name);
  state.name = name;
  state.crew = crewUnlocked();
  sfx.init();
  sfx.resume();
  connect(name, state.crew ? RESERVED.code : '', state.cosmetic);
});

on('nameInput', 'keydown', (e) => {
  if (e.key === 'Enter') $('deployBtn').click();
});

// ------------------------------------------------------------ crew code
// Type the code anywhere on the title screen (the callsign box or the access
// field): it unlocks the reserved callsigns and the glowing skin.
const CODE_STORE = 'skyfall.code';
function crewUnlocked() { return store.get(CODE_STORE, '') === RESERVED.code; }
function setCrew(on) {
  store.set(CODE_STORE, on ? RESERVED.code : '');
  document.body.classList.toggle('crew', on);
  const badge = $('crewBadge');
  if (badge) badge.classList.toggle('hidden', !on);
  const input = $('codeInput');
  if (input) input.value = on ? RESERVED.code : '';
  if (on) {
    sfx.init();
    sfx.resume();
    sfx.objectiveDone?.();
    renderCosmetic();
    titleNotice('CREW ACCESS GRANTED · NEON & SCANLINE UNLOCKED', 'good');
  } else {
    // drop back to a material everyone is allowed to wear
    if (COSMETIC.isLocked(state.cosmetic.material)) applyCosmetic({ ...state.cosmetic, material: 'matte' });
    renderCosmetic();
    titleNotice('CREW ACCESS CLEARED');
  }
}
function tryCode(raw) {
  if (RESERVED.normaliseCode(raw) === RESERVED.code) setCrew(true);
}
let noticeTimer = null;
function titleNotice(text, tone = 'bad') {
  const el = $('titleNotice');
  if (!el) return;
  el.textContent = text;
  el.className = `title-notice show ${tone}`;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.className = 'title-notice'; }, 3200);
}
on('codeInput', 'input', (e) => tryCode(e.target.value));
on('codeInput', 'keydown', (e) => {
  if (e.key === 'Enter') tryCode(e.target.value);
});
on('crewClear', 'click', () => setCrew(false));

// the code typed straight into the callsign box works too
on('nameInput', 'input', (e) => {
  const v = e.target.value;
  if (RESERVED.normaliseCode(v) === RESERVED.code) {
    tryCode(v);
    e.target.value = store.get('skyfall.name', '');
  }
});
document.addEventListener('keydown', (e) => {
  if (state.phase !== 'title') return;
  // Anything typed while a field has focus belongs to that field: the browser
  // inserts it itself and the field's own `input` handler picks it up. Feeding
  // the digit in by hand here as well is what used to double every character.
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // digits typed anywhere else on the title screen feed the access field
  if (/^[0-9]$/.test(e.key)) {
    const input = $('codeInput');
    const next = ((input.value || '') + e.key).slice(-8);
    input.value = next;
    tryCode(next);
  }
});

// ---------------------------------------------------------------- updates
// The title screen's change history. Content comes from shared/changelog.js.
const updatesEl = () => $('changelog');
function updatesOpen() {
  const el = updatesEl();
  return !!el && !el.classList.contains('hidden');
}

function showUpdates(entryId = state.updatesEntry || DEFAULT_ENTRY) {
  const el = updatesEl();
  if (!el || state.phase !== 'title') return;
  state.updatesEntry = entryId;
  const tabs = $('changelogTabs');
  const body = $('changelogBody');
  if (tabs) tabs.innerHTML = renderTabs(entryId);
  if (body) {
    body.innerHTML = renderEntry(entryId);
    body.scrollTop = 0;
  }
  el.classList.remove('hidden');
}

function hideUpdates() {
  updatesEl()?.classList.add('hidden');
}

function toggleUpdates() {
  if (updatesOpen()) hideUpdates();
  else showUpdates();
}

// label the button with whatever the newest entry is
if ($('changelogBtn') && LATEST_VERSION) $('changelogBtn').textContent = `UPDATES · ${LATEST_VERSION}`;

on('changelogBtn', 'click', () => {
  sfx.init();
  sfx.resume();
  showUpdates();
});
on('changelogClose', 'click', () => hideUpdates());
on('changelog', 'click', (e) => {
  // clicking the dimmed backdrop closes it, clicking the panel does not
  if (e.target === updatesEl()) hideUpdates();
});
on('changelogTabs', 'click', (e) => {
  const btn = e.target.closest('.cl-tab');
  if (btn && btn.dataset.entry) showUpdates(btn.dataset.entry);
});

function safeStartMode(kind) {
  if (staleBuild) { hardReload(); return; }
  hideUpdates();
  try {
    sfx.init();
    sfx.resume();
    startLocalMode(kind);
  } catch (err) {
    reportFatal(err);
    state.phase = 'title';
    $('loading') && $('loading').classList.add('hidden');
    $('title') && $('title').classList.remove('hidden');
  }
}
on('practiceBtn', 'click', () => safeStartMode('practice'));
on('tutorialBtn', 'click', () => safeStartMode('tutorial'));
on('odPractice', 'click', () => safeStartMode('practice'));
on('odTitle', 'click', () => { leaveToTitle(); });

on('resumeBtn', 'click', () => { hidePause(); });
on('leaveBtn', 'click', () => { leaveToTitle(); });

// settings sliders
const sensRange = $('sensRange');
const volRange = $('volRange');
const fovRange = $('fovRange');
sensRange.value = settings.sens;
volRange.value = settings.volume;
fovRange.value = settings.fov;
$('sensOut').textContent = Number(settings.sens).toFixed(2);
$('volOut').textContent = Math.round(settings.volume * 100) + '%';
$('fovOut').textContent = Math.round(settings.fov) + '°';
sensRange.addEventListener('input', () => {
  settings.sens = Number(sensRange.value);
  $('sensOut').textContent = settings.sens.toFixed(2);
  store.set('skyfall.sens', String(settings.sens));
});
volRange.addEventListener('input', () => {
  settings.volume = Number(volRange.value);
  sfx.setVolume(settings.volume);
  $('volOut').textContent = Math.round(settings.volume * 100) + '%';
  store.set('skyfall.volume', String(settings.volume));
});
fovRange.addEventListener('input', () => {
  settings.fov = Number(fovRange.value);
  $('fovOut').textContent = Math.round(settings.fov) + '°';
  store.set('skyfall.fov', String(settings.fov));
});

canvas.addEventListener('mousedown', () => {
  if (state.paused) hidePause();
  else if (!input.locked && !input.fallback) tryLock();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (updatesOpen()) { hideUpdates(); return; }
    if (state.phase === 'title') return;
    if (state.paused) hidePause();
    else showPause();
  }
  if (e.code === 'Tab' && state.phase !== 'title') {
    state.shownScoreboard = true;
  }
  if (e.code === 'KeyL' && state.phase !== 'title') {
    state.shownLeaderboard = !state.shownLeaderboard;
    refreshLeaderboard();
  }
  if (e.code === 'KeyU' && state.phase === 'title' && !fieldFocused()) toggleUpdates();
  if (e.code === 'KeyN' && state.mode === 'tutorial' && !state.paused) {
    session?.skipStep?.();
  }
  if (e.code === 'KeyM') {
    sfx.setVolume(settings.volume = settings.volume > 0 ? 0 : 0.7);
    volRange.value = settings.volume;
    $('volOut').textContent = Math.round(settings.volume * 100) + '%';
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') state.shownScoreboard = false;
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.phase === 'playing' && !state.paused) showPause();
});

// ---------------------------------------------------------------- leaderboard
// The server owns the table; the title screen and the L overlay both show it.
function setLeaderboard(rows, total) {
  state.leaderboard = rows || [];
  hud.titleLeaderboard(state.leaderboard, total);
  if (state.shownLeaderboard) hud.leaderboard(state.leaderboard, true);
}

async function refreshLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard?n=10', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setLeaderboard(data.rows, data.total);
  } catch { /* server not up yet: the panel keeps saying "be the first" */ }
}

net.on('leaderboard', (msg) => setLeaderboard(msg.rows, msg.rows?.length));

// ---------------------------------------------------------------- lobby
async function refreshLobby() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    const data = await res.json();
    const dot = $('srvDot');
    dot.className = 'dot on';
    const list = data.players || [];
    $('srvStatus').textContent = list.length
      ? `${list.length} player${list.length === 1 ? '' : 's'} in the arena`
      : 'server online — be the first in';
    $('lobbyList').innerHTML = list.length
      ? list.map((p) => `<span class="chip">${escape(p.name)} · ${p.kills}K</span>`).join('')
      : '<span style="opacity:.5">empty</span>';
  } catch {
    $('srvDot').className = 'dot off';
    $('srvStatus').textContent = 'server unreachable';
    $('lobbyList').innerHTML = '<span style="opacity:.5">—</span>';
  }
}
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('nameInput').value = store.get('skyfall.name', '');
buildCosmeticUI();
refreshLobby();
refreshLeaderboard();
setInterval(() => { if (state.phase === 'title') refreshLobby(); }, 3000);

// ---------------------------------------------------------------- main loop
let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;

  if (state.phase === 'title' || state.phase === 'loading') {
    // idle camera orbit over the arena for the title backdrop
    const t = now / 1000;
    camera.position.set(Math.cos(t * 0.12) * 46, 16 + Math.sin(t * 0.2) * 3, Math.sin(t * 0.12) * 46);
    camera.lookAt(0, 2, 0);
    world.update(dt, camera.position);
    effects.update(dt);
    avatars.update(dt, t);
    renderer.clear();
    renderer.render(scene, camera);
    return;
  }

  state.time += dt;

  // physics in fixed-ish steps for stability
  if (state.alive && !state.paused) {
    handleGameplayInput(now, dt);
  } else {
    // still drain input so keys don't stick
    input.takeLook();
    if (state.alive) {
      const axes = { forward: 0, right: 0, sprint: false };
      body.update(dt, axes, state.yaw);
    }
  }

  // alive: does the crosshair/reload UI need updating
  if (state.reloadEndsAt) {
    const remaining = state.reloadEndsAt - performance.now();
    if (remaining <= 0) {
      const w = WEAPONS[state.weapon];
      state.reloadEndsAt = 0;
      if (Number.isFinite(w.magSize)) state.ammo[state.weapon] = w.magSize;
      hud.setAmmo(state.ammo[state.weapon]);
      hud.reloadProgress(null);
    } else {
      const dur = state.reloadDur || WEAPONS[state.weapon].reloadTime;
      hud.reloadProgress(Math.max(0, Math.min(1, 1 - remaining / dur)));
    }
  } else {
    hud.reloadProgress(null);
  }

  // respawn countdown
  if (state.phase === 'dead') {
    const left = (state.respawnAt - Date.now()) / 1000;
    hud.setRespawn(left);
  }

  forwardMovementEvents();
  if (session) session.update(dt, now, body);

  updateCamera(dt);
  viewmodel.enabled = state.alive && !state.paused;

  // view model
  const speed = Math.hypot(body.vx, body.vz);
  viewmodel.update(dt, {
    lookDX: viewmodel._lookDX || 0,
    lookDY: viewmodel._lookDY || 0,
    moveAmount: Math.min(1, speed / PLAYER.walkSpeed),
    sprint: speed > PLAYER.walkSpeed * 1.05,
    grounded: body.onGround,
  });
  viewmodel._lookDX = 0;
  viewmodel._lookDY = 0;

  // crosshair bloom
  const moveBloom = Math.min(1, speed / PLAYER.sprintSpeed) * 8;
  state.recoilBloom *= Math.exp(-6 * dt);
  const airBloom = body.onGround ? 0 : 6;
  const targetGap = 6 + moveBloom + airBloom + state.recoilBloom;
  const w = currentWeapon();
  const gapEl = $('crosshair');
  const currentGap = parseFloat(gapEl.style.getPropertyValue('--gap')) || 7;
  hud.crosshairGap(currentGap + (targetGap - currentGap) * Math.min(1, dt * 14));
  gapEl.style.opacity = state.alive ? '1' : '0.25';

  // speed readout only — no move names on screen
  hud.setSpeed(body.speed);

  world.update(dt, camera.position);
  effects.update(dt);
  avatars.update(dt, state.time);
  hud.update(dt);

  // scoreboard (throttled: rebuilt only a few times a second)
  const lbOn = state.shownLeaderboard && !state.paused && state.phase !== 'title';
  hud.leaderboard(state.leaderboard, lbOn);

  const sbOn = state.shownScoreboard && !state.paused;
  if (sbOn && now - (state.lastSbRender || 0) > 200) {
    state.lastSbRender = now;
    hud.scoreboard(state.players, state.id, true);
  } else if (!sbOn) {
    hud.scoreboard(state.players, state.id, false);
  }

  renderer.clear();
  renderer.render(scene, camera);
  if (state.phase === 'playing' || state.phase === 'dead') viewmodel.render();

  input.endFrame();
  void acc;
  void NET;
}

requestAnimationFrame(frame);

// Small debug handle: handy in the console, and used by the automated tests.
window.SKYFALL = {
  state, hud, net, body, camera, avatars, viewmodel, effects, world, settings, input, scene,
  get cosmetic() { return state.cosmetic; },
  showUpdates, hideUpdates, updatesOpen,
  weaponAccent: () => viewmodel.accent,
  applyCosmetic, renderCosmetic,
  get session() { return session; },
  aimTrace: () => localRaycast(240),
  aimDirection,
  assistedAim: () => assistedAimDirection(),
  assistedAimInfo: () => aimAssistResult(),
  assistCandidates: () => assistCandidates(95),
  startLocalMode, leaveToTitle,
};

// pause on click-to-resume when locked is unavailable
on('pause', 'mousedown', (e) => {
  if (e.target.id === 'pause') hidePause();
});

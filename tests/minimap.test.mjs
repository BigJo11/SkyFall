// The radar: a circular canvas in the corner of the HUD that shows where
// everybody is, rotated so that "up" is the way you are facing.
//   node tests/minimap.test.mjs
import assert from 'node:assert/strict';
import { Minimap, rotateIntoView, cssColor, radarRange } from '../public/js/minimap.js';
import { MAPS } from '../shared/map.js';

// A 2d context that remembers what was drawn, so the tests can read the blips
// back off the canvas.
function fakeCtx() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push({ name, args }); };
  return {
    calls,
    clearRect: rec('clearRect'), save: rec('save'), restore: rec('restore'),
    beginPath: rec('beginPath'), arc: rec('arc'), clip: rec('clip'),
    translate: rec('translate'), rotate: rec('rotate'), drawImage: rec('drawImage'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), closePath: rec('closePath'),
    fill: rec('fill'), stroke: rec('stroke'), fillRect: rec('fillRect'),
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
  };
}

function fakeCanvas(size = 156) {
  const ctx = fakeCtx();
  return { width: size, height: size, clientWidth: size, getContext: () => ctx, _ctx: ctx };
}

// setMap() renders the terrain into an offscreen canvas, so the module needs a
// document. This is the smallest one that does the job.
globalThis.document = { createElement: () => fakeCanvas(256) };
globalThis.devicePixelRatio = 1;

const SIZE = 156;
const CENTRE = SIZE / 2;

function radar(mapId = 'big') {
  const canvas = fakeCanvas(SIZE);
  const m = new Minimap(canvas);
  m.setMap(mapId);
  return { m, canvas, ctx: canvas._ctx };
}

// The blips are the small arcs; the big one is the circular clip.
function blips(ctx) {
  return ctx.calls
    .filter((c) => c.name === 'arc' && c.args[2] < 10)
    .map((c) => ({ x: c.args[0], y: c.args[1] }));
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('\nSKYFALL radar tests\n');

test('a target ahead of you is drawn above centre', () => {
  const v = rotateIntoView(0, -20, 0);
  assert.ok(Math.abs(v.forward - 20) < 1e-9, '20 m ahead');
  assert.ok(Math.abs(v.right) < 1e-9, 'and straight ahead, not off to one side');
});

test('a target behind you is drawn below centre', () => {
  const v = rotateIntoView(0, 20, 0);
  assert.ok(Math.abs(v.forward + 20) < 1e-9, '20 m behind reads as negative');
});

test('a target to your right stays on the right', () => {
  const v = rotateIntoView(20, 0, 0);
  assert.ok(Math.abs(v.right - 20) < 1e-9);
  assert.ok(Math.abs(v.forward) < 1e-9, 'level with you');
});

test('turning moves the world, not you', () => {
  // yaw 90 deg: forward is -X, so a target at -X is now straight ahead
  const ahead = rotateIntoView(-20, 0, Math.PI / 2);
  assert.ok(Math.abs(ahead.forward - 20) < 1e-9, 'the target off to -X is ahead');
  assert.ok(Math.abs(ahead.right) < 1e-9, 'and dead centre');

  // ...and the one that was straight ahead is now off to the side
  const side = rotateIntoView(0, -20, Math.PI / 2);
  assert.ok(Math.abs(side.forward) < 1e-9, 'level');
  assert.ok(Math.abs(side.right - 20) < 1e-9, 'swung round to your right');
});

test('colours render as six-digit hex', () => {
  assert.equal(cssColor(0x62d6ff), '#62d6ff');
  assert.equal(cssColor(0), '#000000');
  assert.equal(cssColor(0xffffff), '#ffffff');
});

test('the radar covers each arena at its own scale', () => {
  assert.equal(radarRange('big'), 120, 'the plateau is 240 m across');
  assert.equal(radarRange('small'), 48, 'pine hollow is 96 m across');

  const big = radar('big');
  const small = radar('small');
  assert.ok(small.m.pxPerM > big.m.pxPerM,
    'the small map is drawn larger, so its blips spread out');
});

test('the terrain is pre-rendered once per map, not every frame', () => {
  const { m, ctx } = radar('big');
  assert.ok(m.terrain, 'an offscreen canvas holds the ground');
  const painted = m.terrain._ctx.calls.filter((c) => c.name === 'fillRect').length;
  assert.ok(painted > 100, `the arena was drawn (${painted} boxes)`);

  ctx.calls.length = 0;
  m.draw({ x: 0, y: 0, z: 0, yaw: 0, players: [] });
  assert.equal(ctx.calls.filter((c) => c.name === 'fillRect').length, 0,
    'the frame loop blits the cached image instead');
  assert.equal(ctx.calls.filter((c) => c.name === 'drawImage').length, 1);
});

test('everybody on the map is drawn, through walls and at any range', () => {
  const { m, ctx } = radar('big');
  // one at each compass point, plus one right on top of you
  m.draw({
    x: 0, y: 0, z: 0, yaw: 0,
    players: [
      { id: 1, pos: [0, 0, -40] },    // ahead
      { id: 2, pos: [0, 0, 40] },     // behind
      { id: 3, pos: [40, 0, 0] },     // right
      { id: 4, pos: [-40, 0, 0] },    // left
    ],
  });
  const b = blips(ctx);
  assert.equal(b.length, 4, 'all four are on the radar');

  const ahead = b[0];
  const behind = b[1];
  const right = b[2];
  const left = b[3];

  assert.ok(ahead.y < CENTRE, 'the one ahead is above centre');
  assert.ok(Math.abs(ahead.x - CENTRE) < 0.5, 'and centred');
  assert.ok(behind.y > CENTRE, 'the one behind is below centre');
  assert.ok(right.x > CENTRE, 'the one on your right is drawn right');
  assert.ok(left.x < CENTRE, 'and the one on your left, left');
});

test('the map turns under you so that forward is always up', () => {
  const { m, ctx } = radar('big');
  // facing -X: the player standing at -X is now straight ahead of you
  m.draw({ x: 0, y: 0, z: 0, yaw: Math.PI / 2, players: [{ id: 9, pos: [-40, 0, 0] }] });
  const [b] = blips(ctx);
  assert.ok(b.y < CENTRE, 'they are drawn ahead (up)');
  assert.ok(Math.abs(b.x - CENTRE) < 0.5, 'and dead centre');
});

test('you are the arrow in the middle, not a blip', () => {
  const { m, ctx } = radar('big');
  m.draw({ x: 0, y: 0, z: 0, yaw: 0, myId: 7, players: [{ id: 7, pos: [0, 0, -10] }] });
  assert.equal(blips(ctx).length, 0, 'you are not plotted as a dot');
  assert.ok(ctx.calls.some((c) => c.name === 'moveTo'), 'the arrow is drawn instead');
});

test('the dead stay on the radar, faded, so you can read a fight', () => {
  const { m, ctx } = radar('big');
  m.draw({ x: 0, y: 0, z: 0, yaw: 0, players: [{ id: 1, pos: [0, 0, -30], alive: false }] });
  assert.equal(blips(ctx).length, 1, 'still shown');
  const faded = ctx.calls.filter((c) => c.name === 'arc' && c.args[2] < 10);
  assert.ok(faded.length === 1);
});

test('someone a storey above you gets a chevron', () => {
  const { m, ctx } = radar('big');
  m.draw({ x: 0, y: 0, z: 0, yaw: 0, players: [{ id: 1, pos: [0, 9, -30] }] });
  // one moveTo for you, one for the chevron
  assert.equal(ctx.calls.filter((c) => c.name === 'moveTo').length, 2,
    'the chevron is stroked above them');

  const flat = radar('big');
  flat.m.draw({ x: 0, y: 0, z: 0, yaw: 0, players: [{ id: 1, pos: [0, 1, -30] }] });
  assert.equal(flat.ctx.calls.filter((c) => c.name === 'moveTo').length, 1,
    'level with you, so no chevron — just you');
});

test('swapping arenas re-renders the ground', () => {
  const { m } = radar('big');
  const first = m.terrain;
  m.setMap('small');
  assert.notEqual(m.terrain, first, 'a new image for the new arena');
  assert.equal(m.mapId, 'small');
});

test('a browser with no 2d context gets no radar, not a crash', () => {
  const m = new Minimap({ getContext: () => null, clientWidth: 156, width: 0, height: 0 });
  assert.equal(m.ok, false);
  m.setMap('big');
  m.draw({ x: 0, y: 0, z: 0, yaw: 0, players: [{ id: 1, pos: [0, 0, -10] }] });
  m.clear();
  assert.equal(m.terrain, null, 'nothing was drawn');
});

test('both arenas can be rendered', () => {
  for (const id of Object.keys(MAPS)) {
    const { m } = radar(id);
    assert.ok(m.terrain, `${id} rendered`);
    assert.ok(m.pxPerM > 0, `${id} has a scale`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

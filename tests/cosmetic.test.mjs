// Cosmetic rules shared by the client and the server.
//   node tests/cosmetic.test.mjs
import assert from 'node:assert/strict';
import { COSMETIC } from '../shared/constants.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

console.log('\nSKYFALL cosmetic tests\n');

console.log('catalogue:');

test('there is a default look and it is legal', () => {
  const d = COSMETIC.default;
  assert.ok(Number.isInteger(d.primary) && d.primary >= 0);
  assert.ok(Number.isInteger(d.secondary) && d.secondary >= 0);
  assert.equal(COSMETIC.materialById(d.material).locked, false, 'the default is free');
});

test('neon and scanline are the crew-only materials', () => {
  const locked = COSMETIC.materials.filter((m) => m.locked).map((m) => m.id);
  assert.deepEqual(locked.sort(), ['neon', 'scanline']);
});

test('the palette has distinct, valid colours', () => {
  assert.ok(COSMETIC.palette.length >= 8);
  const seen = new Set();
  for (const sw of COSMETIC.palette) {
    assert.ok(Number.isInteger(sw.color), `${sw.id} colour`);
    assert.ok(sw.color >= 0 && sw.color <= 0xffffff, `${sw.id} in range`);
    assert.ok(!seen.has(sw.color), `${sw.id} is unique`);
    seen.add(sw.color);
  }
});

console.log('\nvalidation:');

test('missing or junk input falls back to the default', () => {
  for (const junk of [null, undefined, 'x', 7, [], {}]) {
    const c = COSMETIC.normalise(junk);
    assert.equal(c.primary, COSMETIC.primary);
    assert.equal(c.secondary, COSMETIC.secondary);
    assert.equal(c.material, 'matte');
  }
});

test('out-of-range colours are rejected', () => {
  const c = COSMETIC.normalise({ primary: -1, secondary: 0x1000000 });
  assert.equal(c.primary, COSMETIC.primary, 'negative rejected');
  assert.equal(c.secondary, COSMETIC.secondary, 'too large rejected');
  const n = COSMETIC.normalise({ primary: '16711680', secondary: 255.4 });
  assert.equal(n.primary, 0xff0000, 'numeric strings are accepted');
  assert.equal(n.secondary, 255, 'fractions are rounded');
});

test('a locked material needs the crew code', () => {
  assert.equal(COSMETIC.normalise({ material: 'neon' }).material, 'matte', 'plain player');
  assert.equal(COSMETIC.normalise({ material: 'neon' }, { crew: true }).material, 'neon', 'crew');
  assert.equal(COSMETIC.normalise({ material: 'scanline' }).material, 'matte');
  assert.equal(COSMETIC.normalise({ material: 'scanline' }, { crew: true }).material, 'scanline');
});

test('free materials work for everyone', () => {
  for (const m of COSMETIC.materials.filter((x) => !x.locked)) {
    assert.equal(COSMETIC.normalise({ material: m.id }).material, m.id);
  }
});

test('an unknown material is not a crash', () => {
  assert.equal(COSMETIC.normalise({ material: 'plasma' }).material, 'matte');
  assert.equal(COSMETIC.normalise({ material: null }).material, 'matte');
  assert.equal(COSMETIC.isLocked('plasma'), false);
});

test('colours survive a round trip and hex is padded', () => {
  const c = COSMETIC.normalise({ primary: 0xff6b6b, secondary: 0x1d2534, material: 'metal' });
  assert.equal(c.primary, 0xff6b6b);
  assert.equal(c.secondary, 0x1d2534);
  assert.equal(c.material, 'metal');
  assert.equal(COSMETIC.hex(0xff6b6b), '#ff6b6b');
  assert.equal(COSMETIC.hex(0x0000ff), '#0000ff');
  assert.equal(COSMETIC.hex(0), '#000000');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

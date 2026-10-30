// All-time leaderboard: ranking, folding, persistence.
//   node tests/leaderboard.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Leaderboard } from '../server/leaderboard.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const tmpFile = () => path.join(os.tmpdir(), `skyfall-board-${process.pid}-${Math.random().toString(36).slice(2)}.json`);

console.log('\nSKYFALL leaderboard tests\n');

console.log('ranking:');

test('a fresh board is empty', () => {
  const b = new Leaderboard(null);
  assert.equal(b.size, 0);
  assert.deepEqual(b.top(10), []);
});

test('kills rank the table, deaths break the tie', () => {
  const b = new Leaderboard(null);
  b.recordJoin('ALPHA');
  b.recordJoin('BRAVO');
  b.recordJoin('CHARLIE');
  for (let i = 0; i < 5; i++) b.recordKill('ALPHA', 'BRAVO');
  for (let i = 0; i < 5; i++) b.recordKill('CHARLIE', 'BRAVO');
  b.recordKill('BRAVO', 'ALPHA');
  const rows = b.top(5);
  assert.equal(rows[0].kills, 5);
  assert.equal(rows[1].kills, 5);
  // both on 5 kills: ALPHA died once, CHARLIE never
  assert.equal(rows[0].name, 'CHARLIE', `tie broken by deaths (${rows.map((r) => r.name).join(',')})`);
  assert.equal(rows[2].name, 'BRAVO');
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3]);
});

test('kd and streaks are tracked', () => {
  const b = new Leaderboard(null);
  b.recordJoin('ACE');
  b.recordJoin('NOOB');
  for (let i = 0; i < 4; i++) b.recordKill('ACE', 'NOOB');
  b.recordKill('NOOB', 'ACE');
  b.recordKill('ACE', 'NOOB');
  const ace = b.stats('ACE');
  assert.equal(ace.kills, 5);
  assert.equal(ace.deaths, 1);
  assert.equal(ace.bestStreak, 4, 'the streak survives the death');
  const rows = b.top(2);
  assert.equal(rows[0].kd, 5);
  assert.equal(rows[1].kd, 0.2);
});

test('names are folded case-insensitively', () => {
  const b = new Leaderboard(null);
  b.recordJoin('Ghost');
  b.recordKill('GHOST', 'other');
  b.recordKill('ghost', 'other');
  assert.equal(b.size, 2, 'one row for the player, one for the victim');
  assert.equal(b.stats('ghost').kills, 2);
  assert.equal(b.top(1)[0].name, 'ghost', 'the latest casing wins the display');
});

test('a fall is a death with no killer', () => {
  const b = new Leaderboard(null);
  b.recordJoin('CLIFF');
  b.recordKill(null, 'CLIFF');
  assert.equal(b.stats('CLIFF').deaths, 1);
  assert.equal(b.stats('CLIFF').kills, 0);
});

test('killing yourself does not count as a kill', () => {
  const b = new Leaderboard(null);
  b.recordJoin('SOLO');
  b.recordKill('SOLO', 'SOLO');
  assert.equal(b.stats('SOLO').kills, 0);
  assert.equal(b.stats('SOLO').deaths, 1);
});

test('the crew flag sticks to the row', () => {
  const b = new Leaderboard(null);
  b.recordKill('Big Joe', 'VICTIM', { crew: true });
  assert.equal(b.top(1)[0].crew, true);
});

test('joining alone does not put you on the board', () => {
  const b = new Leaderboard(null);
  b.recordJoin('TOURIST');
  assert.equal(b.size, 0, 'no row until there is combat');
  b.recordKill('TOURIST', 'VICTIM');
  assert.equal(b.stats('TOURIST').matches, 0, 'a kill alone is not an appearance');
  b.recordJoin('TOURIST');
  assert.equal(b.stats('TOURIST').matches, 1, 'the next join counts');
});

test('markup cannot get into a stored name', () => {
  const b = new Leaderboard(null);
  b.recordKill('<script>BOB</script>', 'VICTIM');
  const name = b.top(1)[0].name;
  assert.ok(!/[<>]/.test(name), `stored "${name}"`);
});

test('top(n) is capped and rankOf finds a player', () => {
  const b = new Leaderboard(null);
  for (let i = 0; i < 20; i++) {
    b.recordJoin(`P${i}`);
    for (let k = 0; k <= i; k++) b.recordKill(`P${i}`, 'TARGET');
  }
  assert.equal(b.top(5).length, 5);
  assert.equal(b.top(5)[0].name, 'P19');
  assert.equal(b.rankOf('P0'), 20);
  assert.equal(b.rankOf('NOBODY'), 0);
});

console.log('\npersistence:');

test('rows survive a reload from disk', () => {
  const file = tmpFile();
  try {
    const a = new Leaderboard(file);
    a.recordKill('KEEP', 'OTHER', { crew: true });
    a.recordJoin('KEEP');
    a.flush();

    const b = new Leaderboard(file);
    assert.equal(b.size, 2);
    assert.equal(b.stats('KEEP').kills, 1);
    assert.equal(b.stats('KEEP').matches, 1, 'appearances persist too');
    assert.equal(b.stats('KEEP').crew, true);
    assert.ok(b.updatedAt > 0);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('a corrupt file is ignored instead of crashing', () => {
  const file = tmpFile();
  try {
    fs.writeFileSync(file, '{ this is not json');
    const b = new Leaderboard(file);
    assert.equal(b.size, 0);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('a missing file is not an error', () => {
  const b = new Leaderboard(path.join(os.tmpdir(), `definitely-not-here-${Date.now()}.json`));
  assert.equal(b.size, 0);
});

test('the board trims itself to the top rows', () => {
  const file = tmpFile();
  try {
    const a = new Leaderboard(file);
    for (let i = 0; i < 600; i++) a.recordKill(`FILLER${i}`, 'TARGET');
    a.flush();
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(saved.rows.length <= 500, `trimmed to ${saved.rows.length}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('reset clears the table', () => {
  const b = new Leaderboard(null);
  b.recordKill('GONE', 'VICTIM');
  b.reset();
  assert.equal(b.size, 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

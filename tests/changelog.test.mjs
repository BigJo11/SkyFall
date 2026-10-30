// The changelog data, and the guarantee that docs/CHANGELOG.md matches it.
//   node tests/changelog.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CHANGELOG, CHANGELOG_NOTE } from '../shared/changelog.js';
import { renderEntry, renderTabs, DEFAULT_ENTRY, LATEST_VERSION, inline, escapeText } from '../public/js/updates.js';

const ROOT = path.resolve(import.meta.dirname, '..');
let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const ids = CHANGELOG.map((e) => e.id);
const byId = (id) => CHANGELOG.find((e) => e.id === id);
const textOf = (entry) => entry.blocks
  .map((b) => [b.h, b.p, ...(b.ul || []), ...(b.table ? b.table.rows.flat() : [])].filter(Boolean).join(' '))
  .join(' ');

console.log('\nchangelog:\n');

test('there is a launch entry and a V.2 entry', () => {
  assert.deepEqual(ids, ['launch', 'v2']);
  assert.equal(byId('launch').version, 'Game Launch!');
  assert.equal(byId('v2').version, 'V.2');
  for (const e of CHANGELOG) {
    assert.ok(e.tagline && e.tagline.length > 4, `${e.id} has a tagline`);
    assert.ok(e.blocks.length >= 3, `${e.id} has content`);
  }
});

test('the launch entry describes the game as it shipped', () => {
  const launch = textOf(byId('launch'));
  // the original weapon numbers, before any of the buffs
  assert.match(launch, /RIFLE[\s\S]*17[\s\S]*6 shots/, 'rifle shipped at 17 / 6 shots');
  assert.match(launch, /SMG[\s\S]*5[\s\S]*20 shots/, 'smg shipped at 5 / 20 shots');
  assert.match(launch, /SNIPER[\s\S]*100/, 'sniper shipped at 100');
  assert.match(launch, /KNIFE[\s\S]*100/, 'knife shipped one-shot');
  // the original map: small, blocky, and with no edges around it
  assert.match(launch, /72 × 72 m/, 'launch map size');
  assert.match(launch, /no edges/i, 'launch map had no edges');
  assert.match(launch, /void/i, 'falling into the void');
  // and the original mode list
  assert.match(launch, /deathmatch/i);
});

test('V.2 covers everything except the base game, map change first', () => {
  const v2 = byId('v2');
  const text = textOf(v2);
  assert.match(v2.tagline, /not the base game/i, 'tagline scopes it to the update');

  // the map change, explained as a change from the old arena
  assert.match(text, /240 × 240 m/, 'new map size');
  assert.match(text, /eleven times the area/i, 'scale explained');
  assert.match(text, /blocky plate with no edges/i, 'refers back to the launch map');
  assert.match(text, /don't kill you|doesn't kill you|do not kill you/i, 'edges are safe now');

  // every other area of the update
  for (const [needle, label] of [
    [/Movement: momentum/, 'movement'],
    [/Practice range/, 'practice mode'],
    [/tutorial/i, 'tutorial'],
    [/Headshots/, 'headshots'],
    [/Aim assist/, 'aim assist'],
    [/NEON/, 'cosmetics materials'],
    [/leaderboard/i, 'leaderboard'],
  ]) {
    assert.match(text, needle, `${label} is covered`);
  }

  // the map change should be the first thing after the intro
  const firstHeading = v2.blocks.find((b) => b.h);
  assert.match(firstHeading.h, /map/i, 'map change leads the update');
});

test('it only reports bugs that broke existing features', () => {
  const fixes = byId('v2').blocks;
  const fixHeading = fixes.findIndex((b) => b.h && /fix/i.test(b.h));
  assert.ok(fixHeading > 0, 'there is a fixes section');
  const bullets = fixes[fixHeading + 2].ul;
  assert.ok(Array.isArray(bullets) && bullets.length >= 3, 'fixes are listed');

  const text = bullets.join(' ');
  // the four that broke something players already used
  assert.match(text, /tutorial could get stuck/i, 'tutorial stall');
  assert.match(text, /accents never actually glowed/i, 'unlit weapon accents');
  assert.match(text, /stale page/i, 'stale cached page');

  // and nothing about internal churn
  assert.doesNotMatch(text, /refactor|test suite|coverage|rename|lint/i,
    'no internal plumbing in the fixes list');
});

test('the changelog gives nothing away and leans on no other game', () => {
  // The panel is visible to every player who presses U, so it must not spell
  // out the access code, what it unlocks, or who it is for.
  const everything = [
    ...CHANGELOG_NOTE,
    ...CHANGELOG.flatMap((e) => [
      e.version, e.tagline,
      ...e.blocks.flatMap((b) => [b.h, b.p, ...(b.ul || []), ...(b.table ? b.table.rows.flat() : [])]),
    ]),
  ].filter(Boolean).join(' ');

  assert.doesNotMatch(everything, /1013/, 'the access code is never printed');
  assert.doesNotMatch(everything, /access code|crew|callsign/i,
    'nothing about the code, what it unlocks, or who it is for');
  assert.doesNotMatch(everything, /locked behind|needs? the code|unlock(ed|s)? (the|by)/i,
    'locked content is not advertised');

  // and no other game is named
  assert.doesNotMatch(everything, /titanfall/i, 'no brand names');
  assert.doesNotMatch(everything, /apex|call of duty|cod\b|fortnite|halo\b|quake|doom/i,
    'no other game names');

  // the same rules apply to the exported markdown
  const md = fs.readFileSync(path.join(ROOT, 'docs/CHANGELOG.md'), 'utf8');
  assert.doesNotMatch(md, /1013|crew|callsign/i, 'docs are clean too');
  assert.doesNotMatch(md, /titanfall/i, 'docs name no other game');
});

test('the note explains the maintenance rules', () => {
  const note = CHANGELOG_NOTE.join(' ');
  assert.match(note, /only updated when asked/i, 'updates on request');
  assert.match(note, /bug fixes are listed only when they broke something that already existed/i,
    'bug policy');
});

test('docs/CHANGELOG.md is generated from this data and is in sync', () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs/CHANGELOG.md'), 'utf8');
  assert.match(md, /^# Changelog/, 'has a title');
  assert.match(md, /^# Game Launch!$/m, 'launch section is a top-level heading');
  assert.match(md, /^# V\.2$/m, 'V.2 section is a top-level heading');
  assert.match(md, /\| RIFLE \| 17 \| 4 \/ sec \| 6 shots \|/, 'launch weapon table rendered');
  assert.match(md, /^## The map: from a slab in the sky to a forest plateau$/m, 'map section rendered');

  // the generator itself must agree, otherwise the two have drifted
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-changelog.mjs'), '--check'], {
    cwd: ROOT,
    stdio: 'pipe',
  });
});

console.log('\nupdates panel:\n');

test('inline markdown is escaped and only allows bold + code', () => {
  assert.equal(inline('**bold**'), '<strong>bold</strong>');
  assert.equal(inline('`npm start`'), '<code>npm start</code>');
  assert.equal(inline('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;',
    'html in the changelog cannot break the page');
  assert.equal(escapeText(`a & b "c" 'd'`), 'a &amp; b &quot;c&quot; &#39;d&#39;');
  // bold around escaped markup stays inert
  assert.equal(inline('**<b>**'), '<strong>&lt;b&gt;</strong>');
});

test('the panel renders every entry, newest first by default', () => {
  assert.equal(DEFAULT_ENTRY, 'v2', 'opens on the newest update');
  assert.equal(LATEST_VERSION, 'V.2', 'the menu button can label itself');
  const tabs = renderTabs(DEFAULT_ENTRY);
  assert.match(tabs, /data-entry="launch"/);
  assert.match(tabs, /data-entry="v2"/);
  assert.ok(tabs.indexOf('data-entry="v2"') < tabs.indexOf('data-entry="launch"'),
    'newest tab first');
  assert.match(tabs, /class="cl-tab active"[^>]*data-entry="v2"/, 'active tab marked');

  const launch = renderEntry('launch');
  assert.match(launch, /Game Launch|^/, 'renders');
  assert.match(launch, /72 × 72 m/, 'launch body');
  assert.match(launch, /<table class="cl-table">/, 'weapons table rendered');
  assert.match(launch, /<th>Weapon<\/th>/, 'table header rendered');

  const v2 = renderEntry('v2');
  assert.match(v2, /240 × 240 m/, 'v2 body');
  assert.match(v2, /<ul>/, 'bullets rendered');
  assert.match(v2, /<strong>/, 'bold rendered');
  assert.match(v2, /<strong>NEON<\/strong>/, 'materials rendered');

  // an unknown id falls back to the newest entry rather than rendering nothing
  assert.equal(renderEntry('nope'), renderEntry(DEFAULT_ENTRY));
});

test('the maintenance note only shows once (on the oldest entry)', () => {
  // the note is about the file itself, so it belongs with the launch entry
  assert.match(renderEntry('launch'), /class="cl-note"/);
  assert.doesNotMatch(renderEntry('v2'), /class="cl-note"/);
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

// Renders docs/CHANGELOG.md from shared/changelog.js.
//   node scripts/build-changelog.mjs          write the file
//   node scripts/build-changelog.mjs --check  fail if it is out of date
//
// The game reads shared/changelog.js directly (the title screen renders it), so
// this script exists only to keep the repo-facing markdown honouring the same
// content. tests/changelog.test.mjs runs --check, so the two cannot drift.
import fs from 'node:fs';
import path from 'node:path';
import { CHANGELOG, CHANGELOG_NOTE } from '../shared/changelog.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET = path.join(ROOT, 'docs/CHANGELOG.md');

const table = (t) => {
  const head = `| ${t.head.join(' | ')} |`;
  const rule = `| ${t.head.map(() => '---').join(' | ')} |`;
  const rows = t.rows.map((r) => `| ${r.join(' | ')} |`);
  return [head, rule, ...rows].join('\n');
};

const bullets = (items) => items.map((i) => `- ${i}`).join('\n');

function block(md) {
  if (md.h) return `## ${md.h}`;
  if (md.p) return md.p;
  if (md.ul) return bullets(md.ul);
  if (md.table) return table(md.table);
  throw new Error(`Unknown changelog block: ${JSON.stringify(md)}`);
}

export function renderChangelog() {
  const out = ['# Changelog', '', ...CHANGELOG_NOTE.flatMap((p) => [p, ''])];

  for (const entry of CHANGELOG) {
    out.push('---', '', `# ${entry.version}`, '');
    if (entry.tagline) out.push(`_${entry.tagline}_`, '');
    for (const b of entry.blocks) out.push(block(b), '');
  }

  // trim the trailing blank lines to exactly one newline at EOF
  return out.join('\n').replace(/\n+$/, '\n');
}

const expected = renderChangelog();
const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;

if (process.argv.includes('--check')) {
  if (current === expected) {
    console.log('changelog: docs/CHANGELOG.md is in sync with shared/changelog.js');
    process.exit(0);
  }
  console.error('changelog: docs/CHANGELOG.md is OUT OF DATE — run `npm run changelog`');
  process.exit(1);
}

fs.writeFileSync(TARGET, expected);
console.log(`changelog: wrote ${path.relative(ROOT, TARGET)} (${expected.split('\n').length} lines)`);

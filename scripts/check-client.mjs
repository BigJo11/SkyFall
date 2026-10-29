// Static sanity checks for the browser bundle: import resolution, exported
// names, DOM ids used by the JS vs ids present in index.html, and asset paths.
//   node scripts/check-client.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';

const ROOT = path.resolve(import.meta.dirname, '..');
const JS_DIR = path.join(ROOT, 'public/js');
const problems = [];

const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js'));
const sources = new Map();
for (const f of files) {
  sources.set(`public/js/${f}`, fs.readFileSync(path.join(JS_DIR, f), 'utf8'));
}
sources.set('shared/constants.js', fs.readFileSync(path.join(ROOT, 'shared/constants.js'), 'utf8'));
sources.set('shared/map.js', fs.readFileSync(path.join(ROOT, 'shared/map.js'), 'utf8'));
sources.set('shared/collision.js', fs.readFileSync(path.join(ROOT, 'shared/collision.js'), 'utf8'));

function parse(src, name) {
  try {
    return acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    problems.push(`${name}: parse error ${e.message}`);
    return null;
  }
}

// map module path -> exported names
const exportsByModule = new Map();
const parsed = new Map();
for (const [name, src] of sources) {
  const ast = parse(src, name);
  if (!ast) continue;
  parsed.set(name, ast);
  const names = new Set();
  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        const d = node.declaration;
        if (d.id) names.add(d.id.name);
        if (d.declarations) for (const decl of d.declarations) {
          if (decl.id.type === 'Identifier') names.add(decl.id.name);
          if (decl.id.type === 'ObjectPattern') {
            for (const p of decl.id.properties) names.add(p.key.name);
          }
        }
      }
      for (const s of node.specifiers || []) names.add(s.exported.name);
    }
    if (node.type === 'ExportDefaultDeclaration') names.add('default');
    if (node.type === 'ExportAllDeclaration') names.add('*');
  }
  exportsByModule.set(name, names);
}

function resolveSpecifier(spec, fromFile) {
  if (spec === 'three') return 'three';
  if (spec.startsWith('three/')) return 'three';
  if (spec.startsWith('/shared/')) return 'shared/' + spec.slice('/shared/'.length);
  if (spec.startsWith('.')) {
    const base = path.posix.dirname(fromFile);
    const resolved = path.posix.normalize(path.posix.join(base, spec));
    // browser URLs clamp at the site root: ../../shared/x == /shared/x
    return resolved.replace(/^(\.\.\/)+/, '');
  }
  return spec;
}

for (const [name, ast] of parsed) {
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const target = resolveSpecifier(node.source.value, name);
    if (target === 'three') continue;
    if (!sources.has(target)) {
      problems.push(`${name}: import "${node.source.value}" -> missing file ${target}`);
      continue;
    }
    const exp = exportsByModule.get(target);
    for (const spec of node.specifiers) {
      if (spec.type !== 'ImportSpecifier') continue;
      const imported = spec.imported.name ?? spec.imported.value;
      if (!exp.has(imported) && !exp.has('*')) {
        problems.push(`${name}: "${imported}" is not exported by ${target}`);
      }
    }
  }
}

// ---- DOM ids --------------------------------------------------------------
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const allJs = [...sources.entries()].filter(([n]) => n.startsWith('public/js/'));
const usedIds = new Set();
for (const [name, src] of allJs) {
  for (const m of src.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) usedIds.add(m[1]);
  for (const m of src.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) usedIds.add(m[1]);
}
for (const id of usedIds) {
  if (!htmlIds.has(id)) problems.push(`missing DOM id #${id} referenced from client JS`);
}
for (const id of htmlIds) {
  if (!usedIds.has(id)) {
    // not fatal, just informational
  }
}

// ---- css / script / vendor assets ---------------------------------------
for (const m of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
  const p = path.join(ROOT, 'public', m[1]);
  if (!fs.existsSync(p)) problems.push(`index.html references missing asset ${m[1]}`);
}
const importMap = html.match(/"three": "([^"]+)"/);
if (importMap) {
  const p = path.join(ROOT, 'public', importMap[1]);
  if (!fs.existsSync(p)) problems.push(`import map points at missing ${importMap[1]}`);
}

// ---- label every $('id') lookup is defined in hud.js --------------------
if (problems.length) {
  console.log('client checks: FAILED');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log(`client checks: ok (${files.length} modules, ${htmlIds.size} DOM ids, ${usedIds.size} ids referenced)`);

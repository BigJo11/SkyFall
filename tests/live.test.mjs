// End-to-end test: boots the real HTTP/WebSocket server and plays with two
// clients.   node tests/live.test.mjs
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const PORT = 3111 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const inbox = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      inbox.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].match(msg)) { waiters[i].resolve(msg); waiters.splice(i, 1); }
      }
    });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'join', name }));
      resolve({
        ws,
        inbox,
        send: (m) => ws.send(JSON.stringify(m)),
        waitFor: (match, timeout = 4000) => new Promise((res, rej) => {
          const found = inbox.find(match);
          if (found) return res(found);
          const t = setTimeout(() => rej(new Error('timeout waiting for message')), timeout);
          waiters.push({ match, resolve: (m) => { clearTimeout(t); res(m); } });
        }),
        of: (type) => inbox.filter((m) => m.t === type),
      });
    });
  });
}

const server = spawn(process.execPath, ['server/server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const cleanup = () => { try { server.kill('SIGKILL'); } catch {} };
process.on('exit', cleanup);

// wait for the listener
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`${BASE}/api/status`);
    if (r.ok) break;
  } catch {}
  await sleep(120);
}

console.log('\nSKYFALL live server tests\n');

await test('serves the client bundle and shared modules', async () => {
  for (const path of ['/', '/css/style.css', '/js/main.js', '/shared/map.js', '/vendor/three/three.module.js']) {
    const res = await fetch(BASE + path);
    assert.equal(res.status, 200, `${path} -> ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (path.endsWith('.js')) assert.ok(/javascript/.test(type), `${path} content-type ${type}`);
  }
  const status = await (await fetch(`${BASE}/api/status`)).json();
  assert.deepEqual(status.players, []);
});

await test('404s unknown files and blocks path traversal', async () => {
  assert.equal((await fetch(`${BASE}/nope.js`)).status, 404);
  assert.equal((await fetch(`${BASE}/shared/../server/game.js`)).status, 404);
});

await test('two clients can join and see each other', async () => {
  const a = await client('ALPHA');
  const welcome = await a.waitFor((m) => m.t === 'welcome');
  assert.equal(welcome.name, 'ALPHA');
  assert.ok(welcome.you && welcome.you.pos.length === 3);

  const b = await client('BRAVO');
  await b.waitFor((m) => m.t === 'welcome');
  const joinMsg = await a.waitFor((m) => m.t === 'join' && m.player.name === 'BRAVO');
  assert.ok(joinMsg.player.id !== welcome.id);

  const snap = await a.waitFor((m) => m.t === 'snapshot' && m.players.length === 2);
  const names = snap.players.map((p) => p.name).sort();
  assert.deepEqual(names, ['ALPHA', 'BRAVO']);

  const status = await (await fetch(`${BASE}/api/status`)).json();
  assert.equal(status.players.length, 2);

  // ping / pong round trip
  a.send({ t: 'ping', c: 1234 });
  const pong = await a.waitFor((m) => m.t === 'pong');
  assert.equal(pong.c, 1234);

  a.ws.close();
  b.ws.close();
  await sleep(250);
  const after = await (await fetch(`${BASE}/api/status`)).json();
  assert.equal(after.players.length, 0, 'players are removed when they disconnect');
});

await test('firing is broadcast to the other players', async () => {
  const a = await client('SHOOTER');
  const b = await client('WITNESS');
  await a.waitFor((m) => m.t === 'welcome');
  await b.waitFor((m) => m.t === 'welcome');
  await sleep(150);
  a.send({ t: 'fire', dir: [0, 0, 1] });
  const shot = await b.waitFor((m) => m.t === 'shot');
  assert.equal(shot.weapon, 'rifle');
  assert.ok(Array.isArray(shot.from) && Array.isArray(shot.to));
  const snap = await a.waitFor((m) => m.t === 'snapshot' && m.players.some((p) => p.ammo === 29));
  assert.ok(snap, 'ammo is consumed server side');
  a.ws.close();
  b.ws.close();
  await sleep(200);
});

await test('movement input is accepted and reflected in snapshots', async () => {
  const a = await client('WALKER');
  const welcome = await a.waitFor((m) => m.t === 'welcome');
  const start = welcome.you.pos;
  for (let i = 0; i < 10; i++) {
    a.send({ t: 'input', p: [start[0], start[1], start[2] - 0.25 * (i + 1)], yaw: 0, pitch: 0 });
    await sleep(60);
  }
  const snap = await a.waitFor((m) =>
    m.t === 'snapshot' && m.players.some((p) => p.id === welcome.id && p.pos[2] < start[2] - 1.5));
  assert.ok(snap, 'server tracked the walk');
  a.ws.close();
  await sleep(200);
});

await test('malformed frames do not crash the server', async () => {
  const a = await client('GARBAGE');
  await a.waitFor((m) => m.t === 'welcome');
  a.ws.send('not json');
  a.ws.send(JSON.stringify([1, 2, 3]));
  a.ws.send(JSON.stringify({ t: 'fire' }));
  a.ws.send(JSON.stringify({ t: 'weapon', i: 99 }));
  a.ws.send(JSON.stringify({ t: 'input', p: 'nope' }));
  await sleep(200);
  const res = await fetch(`${BASE}/api/status`);
  assert.equal(res.status, 200);
  assert.ok(!serverLog.includes('Unhandled'), 'no unhandled errors');
  a.ws.close();
  await sleep(150);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
cleanup();
process.exit(failed ? 1 : 0);

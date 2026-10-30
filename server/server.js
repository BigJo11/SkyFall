import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { Leaderboard } from './leaderboard.js';
import { RESERVED } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// all-time leaderboard, persisted next to the code (override with LEADERBOARD_FILE)
const BOARD_FILE = process.env.LEADERBOARD_FILE
  || path.join(ROOT, 'data', 'leaderboard.json');
const leaderboard = new Leaderboard(BOARD_FILE);
const game = new Game({ leaderboard }).start();
console.log(`[board] ${leaderboard.size} all-time rows from ${path.relative(ROOT, BOARD_FILE)}`);

// ---------------------------------------------------------------------------
// Asset versioning. Players must never end up running a cached main.js against
// a freshly served index.html: that looks exactly like "the buttons do
// nothing". Every HTML/JS/CSS response gets a cache-busting ?v=<build> stamped
// onto its asset URLs and relative imports, and the page carries the build id
// so the client can detect a mismatch and say so.
// ---------------------------------------------------------------------------
function computeBuildId() {
  let newest = 0;
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'vendor' || e.name === 'node_modules') continue;
        walk(p);
      } else if (/\.(js|html|css)$/.test(e.name)) {
        try { newest = Math.max(newest, fs.statSync(p).mtimeMs); } catch { /* ignore */ }
      }
    }
  };
  walk(PUBLIC);
  walk(SHARED);
  return Math.round(newest).toString(36);
}

let BUILD_ID = computeBuildId();

// Add ?v=<build> to asset URLs in HTML and to relative imports in our own JS.
function versionHtml(html) {
  return html
    .replace(/__BUILD__/g, BUILD_ID)
    .replace(/((?:src|href)=")(\/(?:js|css)\/[^"?]+\.(?:js|css))(")/g, `$1$2?v=${BUILD_ID}$3`);
}

function versionJs(src) {
  return src.replace(
    /(\bfrom\s*['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g,
    `$1$2?v=${BUILD_ID}$3`
  );
}

const VERSIONED = new Set(['.html', '.js', '.css']);

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // HTML and game code must never be served from a stale cache: a mismatch
    // between an old page and new modules is impossible to debug for players.
    const cacheControl = VERSIONED.has(ext) ? 'no-store, must-revalidate' : 'no-cache';

    let body = data;
    const isVendor = filePath.includes(`${path.sep}vendor${path.sep}`);
    if (!isVendor && ext === '.html') body = Buffer.from(versionHtml(data.toString('utf8')));
    else if (!isVendor && ext === '.js') body = Buffer.from(versionJs(data.toString('utf8')));

    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'X-Skyfall-Build': BUILD_ID,
    });
    res.end(body);
  });
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400); res.end('Bad request'); return;
  }

  if (urlPath === '/api/leaderboard') {
    const n = Number(new URL(req.url, 'http://localhost').searchParams.get('n')) || 10;
    const body = {
      rows: leaderboard.top(Math.max(1, Math.min(50, n))),
      updatedAt: leaderboard.updatedAt,
      total: leaderboard.size,
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
    return;
  }

  if (urlPath === '/api/status') {
    const list = [...game.players.values()].map((p) => ({ name: p.name, kills: p.kills, deaths: p.deaths }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ players: list, uptime: process.uptime() }));
    return;
  }

  // shared game data (imported by the browser as a module)
  if (urlPath.startsWith('/shared/')) {
    const p = path.join(SHARED, urlPath.slice('/shared/'.length));
    if (!p.startsWith(SHARED)) { res.writeHead(403); res.end(); return; }
    return serveFile(res, p);
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.join(PUBLIC, urlPath);
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  serveFile(res, filePath);
});

const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

wss.on('connection', (socket) => {
  let player = null;
  let alive = true;

  socket.on('message', (raw) => {
    if (!alive) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (!player) {
      if (msg.t === 'join') {
        // the crew code unlocks reserved callsigns and the glow skin
        const crew = RESERVED.normaliseCode(msg.code) === RESERVED.code;
        player = game.addPlayer(socket, msg.name, crew);
      }
      return;
    }
    game.handle(player, msg);
  });

  socket.on('close', () => {
    alive = false;
    if (player) game.removePlayer(player.id);
  });
  socket.on('error', () => {});
});

// Recompute the build id on every page load so edits show up without a restart.
setInterval(() => { BUILD_ID = computeBuildId(); }, 2000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { leaderboard.flush(); } catch { /* ignore */ }
    process.exit(0);
  });
}

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) addrs.push(n.address);
    }
  }
  console.log('');
  console.log('  ███  S K Y F A L L  ███   LAN deathmatch is live');
  console.log('  ------------------------------------------------');
  console.log(`  local   http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  lan     http://${a}:${PORT}`);
  console.log('  ------------------------------------------------');
  console.log('  Share a LAN address with your friends to play.');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n[server] shutting down');
  game.stop();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});

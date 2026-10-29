import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';

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

const game = new Game().start();

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400); res.end('Bad request'); return;
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
        player = game.addPlayer(socket, msg.name);
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

/* TicTacWorld server: zero-dependency HTTP + SSE. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store.js');
const rooms = require('./rooms.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
};
const { HttpError } = store;

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 10 * 1024) { reject(new HttpError(413, 'Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const roomJoinPayload = (room, seat) => ({
  code: room.code, seat, token: room.players[seat].token,
});

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const method = req.method;
  const token = req.headers['x-token'] || url.searchParams.get('token') || '';
  const body = method === 'POST' ? await readBody(req) : {};

  // ----- groups -----
  if (parts[0] === 'groups') {
    if (parts.length === 1 && method === 'POST') return json(res, 200, store.createGroup(body.name, body.nick));
    const code = parts[1];
    if (parts.length === 2 && method === 'GET') return json(res, 200, store.groupView(code, token));
    if (parts[2] === 'join' && method === 'POST') return json(res, 200, store.joinGroup(code, body.nick, token));
    if (parts[2] === 'challenges') {
      if (parts.length === 3 && method === 'POST') return json(res, 200, store.createChallenge(code, token, body.theme, body.difficulty));
      const id = parts[3];
      if (parts.length === 4 && method === 'GET') return json(res, 200, store.challengeView(code, id, token));
      if (parts[4] === 'guess' && method === 'POST') return json(res, 200, store.guess(code, id, token, body.cell, body.iso));
      if (parts[4] === 'finish' && method === 'POST') return json(res, 200, store.finish(code, id, token));
    }
  }

  // ----- live rooms -----
  if (parts[0] === 'rooms') {
    if (parts.length === 1 && method === 'POST') {
      const { room, seat } = rooms.createRoom(body);
      return json(res, 200, roomJoinPayload(room, seat));
    }
    const code = parts[1];
    if (parts[2] === 'events' && method === 'GET') return rooms.subscribe(code, token, res);
    if (parts.length === 2 && method === 'GET') return json(res, 200, rooms.publicInfo(code));
    if (parts[2] === 'join' && method === 'POST') {
      const { room, seat } = rooms.joinRoom(code, body.nick, token);
      return json(res, 200, roomJoinPayload(room, seat));
    }
    if (parts[2] === 'move' && method === 'POST') return json(res, 200, rooms.move(code, token, body.cell, body.iso));
    if (parts[2] === 'rematch' && method === 'POST') { rooms.rematch(code, token); return json(res, 200, { ok: true }); }
    if (parts[2] === 'resign' && method === 'POST') { rooms.resign(code, token); return json(res, 200, { ok: true }); }
  }
  if (parts[0] === 'quickmatch' && method === 'POST') {
    const { room, seat, matched } = rooms.quickMatch(body);
    return json(res, 200, { ...roomJoinPayload(room, seat), matched });
  }
  if (parts[0] === 'health') return json(res, 200, { ok: true });
  throw new HttpError(404, 'Not found');
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) {
      if (path.extname(rel)) { res.writeHead(404); return res.end('Not found'); }
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, idx) => {
        if (e2) { res.writeHead(500); return res.end('Server error'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(idx);
      });
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(data);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else serveStatic(req, res, url);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      console.error(e);
      json(res, 500, { error: 'Something went wrong' });
    }
  });
}

if (require.main === module) {
  store.load();
  const port = Number(process.env.PORT) || 3000;
  const server = createServer();
  server.listen(port, () => console.log(`TicTacWorld running on http://localhost:${port}`));
  const bye = () => { store.flush(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

module.exports = { createServer };

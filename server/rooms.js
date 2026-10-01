/* Live 1v1 rooms: authoritative game state, turn timers and SSE broadcasting. */
const crypto = require('crypto');
const T = require('../public/js/engine.js');
const { HttpError, cleanNick } = require('./store.js');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const rooms = new Map();
const MAX_TIMEOUTS = 3;
const TIMERS = [20, 30, 45, 60];

const genCode = () => {
  let c;
  do { c = Array.from(crypto.randomBytes(4), (b) => CODE_CHARS[b % CODE_CHARS.length]).join(''); } while (rooms.has(c));
  return c;
};
const token = () => crypto.randomBytes(12).toString('hex');

function newRound(room) {
  room.seed = crypto.randomBytes(5).toString('hex');
  room.puzzle = T.buildPuzzle(room.seed, room.theme, room.difficulty);
  room.board = Array(9).fill(null);
  room.scores = [0, 0];
  room.timeouts = [0, 0];
  room.winner = null;
  room.winLine = null;
  room.reason = null;
  room.rematch = [false, false];
  room.lastEvent = null;
  room.round = (room.round || 0) + 1;
  room.turn = room.starter;
}

function createRoom({ nick, theme, difficulty, timer, quick }) {
  nick = cleanNick(nick);
  if (!nick) throw new HttpError(400, 'Pick a nickname');
  if (!T.THEMES[theme]) theme = 'classic';
  if (!T.DIFFICULTIES[difficulty]) difficulty = 'normal';
  timer = TIMERS.includes(Number(timer)) ? Number(timer) : 45;
  const room = {
    code: genCode(), theme, difficulty, timer, quick: !!quick,
    players: [{ nick, token: token(), conns: new Set() }],
    status: 'waiting', starter: 0, wins: [0, 0], createdAt: Date.now(), touched: Date.now(),
    clients: new Set(), timeoutHandle: null, deadline: null,
  };
  rooms.set(room.code, room);
  newRound(room);
  return { room, seat: 0 };
}

function getRoom(code) {
  const r = rooms.get(String(code || '').toUpperCase());
  if (!r) throw new HttpError(404, 'Room not found');
  return r;
}

function seatOf(room, tok) {
  if (!tok) return -1;
  return room.players.findIndex((p) => p.token === tok);
}

function joinRoom(code, nick, tok) {
  const room = getRoom(code);
  const existing = seatOf(room, tok);
  if (existing >= 0) return { room, seat: existing };
  if (room.players.length >= 2) throw new HttpError(409, 'This room is full — you can watch instead');
  nick = cleanNick(nick);
  if (!nick) throw new HttpError(400, 'Pick a nickname');
  room.players.push({ nick, token: token(), conns: new Set() });
  room.status = 'playing';
  armTimer(room);
  broadcast(room);
  return { room, seat: 1 };
}

function quickMatch({ nick, theme }) {
  if (!T.THEMES[theme]) theme = 'classic';
  for (const room of rooms.values()) {
    if (room.quick && room.status === 'waiting' && room.players.length === 1 && room.theme === theme && Date.now() - room.touched < 5 * 60 * 1000) {
      if (room.players[0].nick.toLowerCase() === cleanNick(nick).toLowerCase()) continue;
      const { seat } = joinRoom(room.code, nick, null);
      return { room, seat, matched: true };
    }
  }
  const { room, seat } = createRoom({ nick, theme, difficulty: 'normal', timer: 45, quick: true });
  return { room, seat, matched: false };
}

function armTimer(room) {
  clearTimeout(room.timeoutHandle);
  room.deadline = null;
  if (room.status !== 'playing') return;
  room.deadline = Date.now() + room.timer * 1000;
  room.timeoutHandle = setTimeout(() => onTimeout(room), room.timer * 1000 + 50);
  if (room.timeoutHandle.unref) room.timeoutHandle.unref();
}

function onTimeout(room) {
  if (room.status !== 'playing') return;
  const seat = room.turn;
  room.timeouts[seat]++;
  room.lastEvent = { type: 'timeout', seat, ts: Date.now() };
  if (room.timeouts[seat] >= MAX_TIMEOUTS) {
    return finish(room, 1 - seat, 'forfeit');
  }
  room.turn = 1 - seat;
  armTimer(room);
  broadcast(room);
}

function finish(room, winnerSeat, reason, line) {
  room.status = 'finished';
  room.winner = winnerSeat;
  room.reason = reason;
  room.winLine = line || null;
  if (winnerSeat === 0 || winnerSeat === 1) room.wins[winnerSeat]++;
  clearTimeout(room.timeoutHandle);
  room.deadline = null;
  broadcast(room);
}

function move(code, tok, cell, iso) {
  const room = getRoom(code);
  const seat = seatOf(room, tok);
  if (seat < 0) throw new HttpError(403, 'You are not playing in this room');
  if (room.status !== 'playing') throw new HttpError(409, 'The game is not running');
  if (room.turn !== seat) throw new HttpError(409, 'Not your turn');
  cell = Number(cell);
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) throw new HttpError(400, 'Bad cell');
  if (room.board[cell]) throw new HttpError(409, 'That square is taken');
  iso = String(iso || '').toUpperCase();
  if (!T.byIso[iso]) throw new HttpError(400, 'Unknown answer');
  room.touched = Date.now();
  room.timeouts[seat] = 0;
  const used = room.board.some((b) => b && b.iso === iso);
  const valid = !used && T.checkGuess(room.puzzle, cell, iso);
  const pts = valid ? room.puzzle.points[cell] : 0;
  room.lastEvent = { type: valid ? 'claim' : 'miss', seat, cell, iso, pts, reason: used ? 'used' : undefined, ts: Date.now() };
  if (valid) {
    room.board[cell] = { seat, iso, pts };
    room.scores[seat] += pts;
    const w = T.lineWinner(room.board.map((b) => (b ? b.seat : null)));
    if (w) { finish(room, w.owner, 'line', w.line); return { valid, pts }; }
    if (room.board.every(Boolean)) {
      const [a, b] = room.scores;
      finish(room, a === b ? -1 : a > b ? 0 : 1, 'points');
      return { valid, pts };
    }
  }
  room.turn = 1 - seat;
  armTimer(room);
  broadcast(room);
  return { valid, pts, reason: used ? 'used' : undefined };
}

function rematch(code, tok) {
  const room = getRoom(code);
  const seat = seatOf(room, tok);
  if (seat < 0) throw new HttpError(403, 'You are not playing in this room');
  if (room.status !== 'finished') throw new HttpError(409, 'Game still running');
  room.rematch[seat] = true;
  if (room.rematch[0] && room.rematch[1]) {
    room.starter = 1 - room.starter;
    room.status = 'playing';
    newRound(room);
    armTimer(room);
  }
  broadcast(room);
}

function resign(code, tok) {
  const room = getRoom(code);
  const seat = seatOf(room, tok);
  if (seat < 0) throw new HttpError(403, 'You are not playing in this room');
  if (room.status === 'waiting') { closeRoom(room); return; }
  if (room.status !== 'playing') return;
  finish(room, 1 - seat, 'resign');
}

function closeRoom(room) {
  clearTimeout(room.timeoutHandle);
  for (const res of room.clients) { try { res.end(); } catch (e) { /* ignore */ } }
  room.clients.clear();
  rooms.delete(room.code);
}

function publicState(room) {
  return {
    code: room.code, theme: room.theme, difficulty: room.difficulty, timer: room.timer, quick: room.quick,
    status: room.status, round: room.round, now: Date.now(), deadline: room.deadline,
    players: room.players.map((p) => ({ nick: p.nick, online: p.conns.size > 0 })),
    puzzle: T.publicPuzzle(room.puzzle),
    board: room.board, turn: room.turn, scores: room.scores, wins: room.wins, starter: room.starter,
    winner: room.winner, winLine: room.winLine, reason: room.reason, lastEvent: room.lastEvent, rematch: room.rematch,
    timeouts: room.timeouts,
    answers: room.status === 'finished' ? room.puzzle.answers.map((_, i) => T.answerLabels(room.puzzle, i)) : undefined,
  };
}

function publicInfo(code) {
  const room = getRoom(code);
  return { code: room.code, theme: room.theme, difficulty: room.difficulty, status: room.status, players: room.players.map((p) => p.nick), open: room.players.length < 2 };
}

function broadcast(room) {
  const payload = publicState(room);
  for (const client of room.clients) send(client, payload);
}
function send(client, payload) {
  try {
    client.write(`data: ${JSON.stringify({ ...payload, you: client.seat })}\n\n`);
  } catch (e) { /* connection gone */ }
}

function subscribe(code, tok, res) {
  const room = getRoom(code);
  const seat = seatOf(room, tok);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.seat = seat;
  room.clients.add(res);
  if (seat >= 0) room.players[seat].conns.add(res);
  res.write('retry: 1500\n\n');
  send(res, publicState(room));
  broadcast(room); // presence changed
  const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch (e) { /* ignore */ } }, 20000);
  res.on('close', () => {
    clearInterval(ka);
    room.clients.delete(res);
    if (seat >= 0 && room.players[seat]) room.players[seat].conns.delete(res);
    if (rooms.has(room.code)) broadcast(room);
  });
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const idle = now - room.touched;
    if ((room.status === 'waiting' && idle > 30 * 60 * 1000) || idle > 3 * 60 * 60 * 1000) closeRoom(room);
  }
}, 60 * 1000).unref();

module.exports = { createRoom, joinRoom, quickMatch, move, rematch, resign, publicInfo, publicState, subscribe, getRoom, seatOf };

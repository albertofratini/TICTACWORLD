/* Persistent store for friend groups (JSON file, debounced atomic writes). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const T = require('../public/js/engine.js');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'groups.json');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 40;
const MAX_CHALLENGES = 200;

let groups = {};
let timer = null;

function load() {
  try {
    groups = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    groups = {};
  }
}
function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(groups));
      fs.renameSync(tmp, FILE);
    } catch (e) {
      console.error('could not save groups:', e.message);
    }
  }, 300);
  if (timer.unref) timer.unref();
}
function flush() {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(groups));
  } catch (e) { /* ignore */ }
}

const rid = (n) => crypto.randomBytes(n).toString('hex');
const code = (n) => Array.from(crypto.randomBytes(n), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const cleanNick = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function getGroup(c) {
  const g = groups[String(c || '').toUpperCase()];
  if (!g) throw new HttpError(404, 'Group not found');
  return g;
}
function memberOf(g, token) {
  return token ? g.players.find((p) => p.token === token) || null : null;
}
function requireMember(g, token) {
  const me = memberOf(g, token);
  if (!me) throw new HttpError(403, 'Join the group first');
  return me;
}

function createGroup(name, nick) {
  name = cleanName(name); nick = cleanNick(nick);
  if (!name) throw new HttpError(400, 'Give your group a name');
  if (!nick) throw new HttpError(400, 'Pick a nickname');
  let c;
  do { c = code(6); } while (groups[c]);
  const me = { id: rid(3), nick, token: rid(16), joinedAt: Date.now() };
  groups[c] = { code: c, name, createdAt: Date.now(), players: [me], challenges: [] };
  save();
  return { code: c, name, me: { id: me.id, token: me.token, nick } };
}

function joinGroup(c, nick, token) {
  const g = getGroup(c);
  const existing = memberOf(g, token);
  if (existing) return { code: g.code, name: g.name, me: { id: existing.id, token: existing.token, nick: existing.nick } };
  nick = cleanNick(nick);
  if (!nick) throw new HttpError(400, 'Pick a nickname');
  if (g.players.length >= MAX_PLAYERS) throw new HttpError(409, 'This group is full');
  if (g.players.some((p) => p.nick.toLowerCase() === nick.toLowerCase())) throw new HttpError(409, 'That nickname is taken in this group');
  const me = { id: rid(3), nick, token: rid(16), joinedAt: Date.now() };
  g.players.push(me);
  save();
  return { code: g.code, name: g.name, me: { id: me.id, token: me.token, nick } };
}

function resultFor(ch, pid) {
  return ch.results[pid] || { cells: {}, strikes: 0, done: false, score: 0, updatedAt: 0 };
}
function cellsArray(res) {
  return Array.from({ length: 9 }, (_, i) => res.cells[i] || null);
}
function rescore(res) {
  res.score = T.soloScore(cellsArray(res)).total;
}
function filledCount(res) { return Object.keys(res.cells).length; }

function challengeSummary(g, ch, me) {
  const entries = Object.entries(ch.results).filter(([, r]) => filledCount(r) > 0 || r.strikes > 0 || r.done);
  const ranked = entries.map(([pid, r]) => ({ pid, r })).sort((a, b) => b.r.score - a.r.score);
  const leader = ranked.find((e) => e.r.done) || ranked[0];
  const mine = me && ch.results[me.id] ? ch.results[me.id] : null;
  const creator = g.players.find((p) => p.id === ch.createdBy);
  return {
    id: ch.id, theme: ch.theme, difficulty: ch.difficulty, createdAt: ch.createdAt,
    createdBy: creator ? creator.nick : '?',
    started: entries.length,
    finished: entries.filter(([, r]) => r.done).length,
    leader: leader ? { nick: (g.players.find((p) => p.id === leader.pid) || {}).nick, score: leader.r.score } : null,
    mine: mine ? { score: mine.score, done: mine.done, filled: filledCount(mine), strikes: mine.strikes } : null,
  };
}

function groupView(c, token) {
  const g = getGroup(c);
  const me = memberOf(g, token);
  if (!me) return { code: g.code, name: g.name, memberCount: g.players.length, member: false };
  const totals = g.players.map((p) => ({ id: p.id, nick: p.nick, points: 0, played: 0, wins: 0 }));
  const byId = Object.fromEntries(totals.map((t) => [t.id, t]));
  for (const ch of g.challenges) {
    const done = Object.entries(ch.results).filter(([, r]) => r.done);
    for (const [pid, r] of done) { if (byId[pid]) { byId[pid].points += r.score; byId[pid].played++; } }
    if (done.length >= 2) {
      const top = Math.max(...done.map(([, r]) => r.score));
      done.filter(([, r]) => r.score === top).forEach(([pid]) => { if (byId[pid]) byId[pid].wins++; });
    }
  }
  totals.sort((a, b) => b.points - a.points || b.wins - a.wins);
  return {
    code: g.code, name: g.name, member: true, me: { id: me.id, nick: me.nick },
    players: g.players.map((p) => ({ id: p.id, nick: p.nick })),
    totals,
    challenges: g.challenges.slice().reverse().map((ch) => challengeSummary(g, ch, me)),
  };
}

function createChallenge(c, token, theme, difficulty) {
  const g = getGroup(c);
  const me = requireMember(g, token);
  if (!T.THEMES[theme]) theme = 'classic';
  if (!T.DIFFICULTIES[difficulty]) difficulty = 'normal';
  const ch = { id: rid(4), theme, difficulty, seed: rid(5), createdBy: me.id, createdAt: Date.now(), results: {} };
  g.challenges.push(ch);
  if (g.challenges.length > MAX_CHALLENGES) g.challenges.shift();
  save();
  return challengeSummary(g, ch, me);
}

function getChallenge(g, id) {
  const ch = g.challenges.find((x) => x.id === id);
  if (!ch) throw new HttpError(404, 'Challenge not found');
  return ch;
}

function myView(res) {
  const sc = T.soloScore(cellsArray(res));
  return { cells: cellsArray(res), strikes: res.strikes, done: res.done, score: sc.total, base: sc.base, lines: sc.lines, full: sc.full };
}

function challengeView(c, id, token) {
  const g = getGroup(c);
  const me = requireMember(g, token);
  const ch = getChallenge(g, id);
  const puzzle = T.buildPuzzle(ch.seed, ch.theme, ch.difficulty);
  const mine = resultFor(ch, me.id);
  const board = g.players
    .map((p) => {
      const r = ch.results[p.id];
      if (!r) return { id: p.id, nick: p.nick, score: 0, filled: 0, strikes: 0, done: false, lines: 0, started: false };
      const entry = {
        id: p.id, nick: p.nick, score: r.score, filled: filledCount(r), strikes: r.strikes, done: r.done,
        lines: T.completedLines(cellsArray(r).map(Boolean)).length, started: true,
      };
      // picks stay hidden until the viewer has finished, so nobody can copy
      if (mine.done && r.done) entry.picks = cellsArray(r).map((x) => (x ? { iso: x.iso, pts: x.pts } : null));
      return entry;
    })
    .sort((a, b) => Number(b.started) - Number(a.started) || b.score - a.score);
  const out = {
    id: ch.id, groupName: g.name, code: g.code, theme: ch.theme, difficulty: ch.difficulty,
    puzzle: T.publicPuzzle(puzzle), me: myView(mine), board,
  };
  if (mine.done) out.answers = puzzle.answers.map((a, i) => ({ cell: i, labels: T.answerLabels(puzzle, i) }));
  return out;
}

function guess(c, id, token, cell, iso) {
  const g = getGroup(c);
  const me = requireMember(g, token);
  const ch = getChallenge(g, id);
  const puzzle = T.buildPuzzle(ch.seed, ch.theme, ch.difficulty);
  cell = Number(cell);
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) throw new HttpError(400, 'Bad cell');
  iso = String(iso || '').toUpperCase();
  if (!T.byIso[iso]) throw new HttpError(400, 'Unknown country');
  const res = (ch.results[me.id] = resultFor(ch, me.id));
  if (res.done) throw new HttpError(409, 'You already finished this challenge');
  if (res.cells[cell]) throw new HttpError(409, 'Cell already filled');
  if (Object.values(res.cells).some((x) => x.iso === iso)) throw new HttpError(409, 'Already used in this grid');
  const valid = T.checkGuess(puzzle, cell, iso);
  if (valid) {
    res.cells[cell] = { iso, pts: T.pickPoints(puzzle, cell, iso) };
  } else {
    res.strikes++;
  }
  if (filledCount(res) === 9 || res.strikes >= T.MAX_STRIKES) res.done = true;
  res.updatedAt = Date.now();
  rescore(res);
  save();
  return { valid, pts: valid ? res.cells[cell].pts : 0, me: myView(res), answers: res.done ? puzzle.answers.map((a, i) => ({ cell: i, labels: T.answerLabels(puzzle, i) })) : undefined };
}

function finish(c, id, token) {
  const g = getGroup(c);
  const me = requireMember(g, token);
  const ch = getChallenge(g, id);
  const res = (ch.results[me.id] = resultFor(ch, me.id));
  res.done = true;
  res.updatedAt = Date.now();
  rescore(res);
  save();
  return challengeView(c, id, token);
}

module.exports = { load, flush, HttpError, createGroup, joinGroup, groupView, createChallenge, challengeView, guess, finish, cleanNick };

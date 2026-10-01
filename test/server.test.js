const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ttw-'));
const { createServer } = require('../server/index.js');
const store = require('../server/store.js');
const T = require('../public/js/engine.js');

let server, base;
test.before(async () => {
  store.load();
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { store.flush(); server.closeAllConnections(); server.close(); });

// backtracking assignment of nine distinct answers, one per cell
function assign(answers, i = 0, used = new Set(), out = []) {
  if (i === 9) return out;
  for (const iso of answers[i]) {
    if (used.has(iso)) continue;
    used.add(iso); out[i] = iso;
    if (assign(answers, i + 1, used, out)) return out;
    used.delete(iso);
  }
  return null;
}

const call = async (method, p, body, token) => {
  const res = await fetch(base + '/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'x-token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

test('serves the app', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /TicTacWorld/);
  assert.equal((await fetch(base + '/js/engine.js')).status, 200);
  assert.equal((await fetch(base + '/../package.json')).status === 200, false);
});

test('group async flow', async () => {
  const g = await call('POST', '/groups', { name: 'Fam', nick: 'Ann' });
  assert.equal(g.status, 200);
  const code = g.body.code;
  const ann = g.body.me;
  const bob = (await call('POST', `/groups/${code}/join`, { nick: 'Bob' })).body.me;
  assert.equal((await call('POST', `/groups/${code}/join`, { nick: 'bob' })).status, 409);
  assert.equal((await call('GET', `/groups/${code}`)).body.member, false);

  const ch = (await call('POST', `/groups/${code}/challenges`, { theme: 'classic', difficulty: 'easy' }, ann.token)).body;
  const view = (await call('GET', `/groups/${code}/challenges/${ch.id}`, null, ann.token)).body;
  assert.equal(view.puzzle.answers, undefined);
  const puzzle = T.buildPuzzle(
    // seed is server-side; recover it through the stored puzzle shape by regenerating from rows/cols
    view.puzzle.seed, view.puzzle.theme, view.puzzle.difficulty);

  // Ann plays perfectly, Bob fails
  const plan = assign(puzzle.answers);
  assert.ok(plan, 'grid is fully fillable');
  let last;
  for (let c = 0; c < 9; c++) {
    const iso = plan[c];
    last = (await call('POST', `/groups/${code}/challenges/${ch.id}/guess`, { cell: c, iso }, ann.token)).body;
    assert.equal(last.valid, true);
  }
  assert.equal(last.me.done, true);
  assert.equal(last.me.full, true);
  const wrong = T.countries.find((c) => !puzzle.answers[0].includes(c.iso)).iso;
  for (let i = 0; i < 3; i++) last = (await call('POST', `/groups/${code}/challenges/${ch.id}/guess`, { cell: 0, iso: wrong }, bob.token)).body;
  assert.equal(last.valid, false);
  assert.equal(last.me.done, true);
  assert.equal((await call('POST', `/groups/${code}/challenges/${ch.id}/guess`, { cell: 1, iso: wrong }, bob.token)).status, 409);

  const lb = (await call('GET', `/groups/${code}/challenges/${ch.id}`, null, bob.token)).body;
  assert.equal(lb.board[0].nick, 'Ann');
  assert.ok(lb.board[0].picks, 'finished players can see picks');
  const gv = (await call('GET', `/groups/${code}`, null, bob.token)).body;
  assert.equal(gv.totals[0].nick, 'Ann');
  assert.equal(gv.totals[0].wins, 1);
  assert.equal((await call('GET', `/groups/${code}/challenges/${ch.id}`)).status, 403);
});

test('live room flow', async () => {
  const a = (await call('POST', '/rooms', { nick: 'A', theme: 'classic', difficulty: 'easy' })).body;
  const b = (await call('POST', `/rooms/${a.code}/join`, { nick: 'B' })).body;
  assert.equal(b.seat, 1);
  assert.equal((await call('POST', `/rooms/${a.code}/join`, { nick: 'C' })).status, 409);

  // read state through SSE
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/rooms/${a.code}/events?token=${a.token}`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const readState = async () => {
    let buf = '';
    for (;;) {
      const { value } = await reader.read();
      buf += dec.decode(value);
      const m = buf.match(/data: (.*)\n\n/g);
      if (m) return JSON.parse(m[m.length - 1].slice(6));
    }
  };
  let s = await readState();
  assert.equal(s.status, 'playing');
  assert.equal(s.you, 0);
  assert.equal(s.turn, 0);

  const room = require('../server/rooms.js').getRoom(a.code);
  const p = room.puzzle;
  assert.equal((await call('POST', `/rooms/${a.code}/move`, { cell: 0, iso: p.answers[0][0] }, b.token)).status, 409); // not B's turn
  // A misses -> turn passes
  const wrong = T.countries.find((c) => !p.answers[0].includes(c.iso)).iso;
  assert.equal((await call('POST', `/rooms/${a.code}/move`, { cell: 0, iso: wrong }, a.token)).body.valid, false);
  // find a winning line for B: fill row 0 with B, A fills other cells validly
  const plan = assign(p.answers);
  const choose = (c) => plan[c];
  // B takes the top row (cells 0,1,2); A takes 3 and 4
  const order = [[b, 0], [a, 3], [b, 1], [a, 4], [b, 2]];
  let r;
  for (const [pl, c] of order) {
    const iso = choose(c);
    r = (await call('POST', `/rooms/${a.code}/move`, { cell: c, iso }, pl.token)).body;
    assert.equal(r.valid, true);
  }
  assert.equal(room.status, 'finished');
  assert.equal(room.winner, 1);
  assert.equal(room.reason, 'line');
  assert.equal((await call('POST', `/rooms/${a.code}/rematch`, null, a.token)).status, 200);
  assert.equal((await call('POST', `/rooms/${a.code}/rematch`, null, b.token)).status, 200);
  assert.equal(room.status, 'playing');
  assert.equal(room.starter, 1);
  assert.deepEqual(room.wins, [0, 1]);
  ctrl.abort();
});

test('quick match pairs two players', async () => {
  const x = (await call('POST', '/quickmatch', { nick: 'Q1', theme: 'flags' })).body;
  assert.equal(x.matched, false);
  const y = (await call('POST', '/quickmatch', { nick: 'Q2', theme: 'flags' })).body;
  assert.equal(y.matched, true);
  assert.equal(y.code, x.code);
});

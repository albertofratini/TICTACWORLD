/* TicTacWorld front end: vanilla JS single-page app (hash routing, no build step). */
(() => {
  'use strict';
  const T = window.TTW;
  const app = document.getElementById('app');

  // ---------- tiny helpers ----------
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const getNick = () => ls.get('ttw.nick', '');
  const rand = () => Math.random().toString(36).slice(2, 10);

  async function api(method, path, body, token) {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) throw new Error(data.error || 'Something went wrong (' + res.status + ')');
    return data;
  }

  let toastTimer;
  function toast(msg, kind) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = h('div', { class: 'toast ' + (kind || ''), role: 'status' }, msg);
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2400);
  }

  function sheet(content) {
    const back = h('div', { class: 'sheet-back' });
    const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, content);
    back.append(box);
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    document.body.append(back);
    return close;
  }

  const copy = async (text, okMsg) => {
    try { await navigator.clipboard.writeText(text); toast(okMsg || 'Copied!', 'good'); }
    catch (e) { window.prompt('Copy this:', text); }
  };
  async function shareOrCopy(title, text, url) {
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    copy(url ? `${text}\n${url}` : text, 'Copied to clipboard!');
  }

  const labelFor = (theme, iso) => (T.THEMES[theme].answer === 'capital' ? T.byIso[iso].capital : T.byIso[iso].name);
  const tierName = { legendary: 'Legendary', epic: 'Epic', rare: 'Rare', uncommon: 'Uncommon', common: 'Common' };

  // ---------- board ----------
  function headCell(id, kind) {
    const cr = T.CRITERIA[id];
    return h('button', { class: 'hd ' + kind, title: cr.label, 'aria-label': cr.label, onclick: () => toast(cr.label) },
      h('span', { class: 'ic' }, cr.icon), h('span', {}, cr.short));
  }

  /* cells[i] = null | { iso, pts, owner? } ; opts: onCell, reveal, winLine, flash:{cell,kind}, disabled */
  function renderBoard(puzzle, cells, opts = {}) {
    const board = h('div', { class: 'board' });
    board.append(h('div', { class: 'corner' }, T.THEMES[puzzle.theme].icon));
    puzzle.cols.forEach((id) => board.append(headCell(id, 'col')));
    for (let r = 0; r < 3; r++) {
      board.append(headCell(puzzle.rows[r], 'row'));
      for (let c = 0; c < 3; c++) {
        const i = r * 3 + c;
        const cell = cells[i];
        const cls = ['cell', cell ? 't-' + T.tierOf(cell.pts) : 't-common', cell ? 'filled' : 'empty'];
        if (cell && cell.owner != null) cls.push('owner-' + cell.owner);
        if (opts.winLine && opts.winLine.includes(i)) cls.push('win');
        if (opts.flash && opts.flash.cell === i) cls.push(opts.flash.kind);
        let body;
        if (cell) {
          body = [
            cell.owner != null ? h('span', { class: 'mark' }, cell.owner === 0 ? '✕' : '◯') : null,
            h('span', { class: 'flag' }, T.flagEmoji(cell.iso)),
            h('span', { class: 'name' }, labelFor(puzzle.theme, cell.iso)),
            h('span', { class: 'badge' }, '+' + cell.pts),
          ];
        } else {
          if (opts.reveal) cls.push('missed');
          body = [h('span', { class: 'q' }, opts.reveal ? '?' : '＋')];
        }
        const clickable = !cell && opts.onCell && !opts.disabled;
        board.append(h('button', {
          class: cls.join(' '), disabled: !clickable && !(opts.reveal && !cell && opts.onCell), onclick: () => opts.onCell && opts.onCell(i),
          'aria-label': cell ? `${labelFor(puzzle.theme, cell.iso)}, ${cell.pts} points` : 'Empty square',
        }, body));
      }
    }
    return board;
  }

  const legend = () => h('div', { class: 'legend' },
    ['legendary', 'epic', 'rare', 'uncommon', 'common'].map((t) => h('span', { class: 't-' + t }, h('i'), tierName[t])),
    h('span', {}, '· the less obvious your pick, the more points'));

  function openPicker({ puzzle, cell, used, onPick }) {
    const theme = T.THEMES[puzzle.theme];
    const rc = T.CRITERIA[puzzle.rows[Math.floor(cell / 3)]];
    const cc = T.CRITERIA[puzzle.cols[cell % 3]];
    const input = h('input', {
      class: 'field', type: 'text', placeholder: theme.answer === 'capital' ? 'Type a capital city…' : 'Type a country…',
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Search',
    });
    const list = h('div', { class: 'plist' });
    let close = () => {};
    const fill = () => {
      const res = T.search(puzzle.theme, input.value);
      if (input.value.trim().length < T.MIN_SEARCH && !res.length) { list.replaceChildren(h('div', { class: 'empty-note' }, `Type at least ${T.MIN_SEARCH} letters to see suggestions`)); return; }
      if (!res.length) { list.replaceChildren(h('div', { class: 'empty-note' }, 'No match — check the spelling')); return; }
      list.replaceChildren(...res.map((e) => {
        const isUsed = used.has(e.iso);
        return h('button', { class: 'pitem' + (isUsed ? ' used' : ''), disabled: isUsed, 'data-iso': e.iso, onclick: () => { close(); onPick(e.iso); } },
          h('span', { class: 'pflag' }, e.flag), h('span', { class: 'pname' }, e.label),
          e.sub ? h('span', { class: 'psub' }, e.sub) : null, isUsed ? h('span', { class: 'psub' }, 'used') : null);
      }));
    };
    input.addEventListener('input', fill);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = list.querySelector('.pitem:not(.used)');
      if (first) first.click();
      e.preventDefault();
    });
    close = sheet([
      h('h3', {}, 'Pick your answer'),
      h('div', { class: 'clues' }, h('div', {}, rc.icon + ' ', h('b', {}, rc.label)), h('div', {}, cc.icon + ' ', h('b', {}, cc.label))),
      input, list,
    ]);
    fill();
    setTimeout(() => input.focus(), 50);
  }

  function showAnswers(puzzle, cell, labels) {
    const rc = T.CRITERIA[puzzle.rows[Math.floor(cell / 3)]];
    const cc = T.CRITERIA[puzzle.cols[cell % 3]];
    const close = sheet([
      h('h3', {}, `${labels.length} possible answer${labels.length === 1 ? '' : 's'}`),
      h('div', { class: 'clues' }, h('div', {}, rc.icon + ' ', h('b', {}, rc.label)), h('div', {}, cc.icon + ' ', h('b', {}, cc.label))),
      h('div', { class: 'answers' }, labels.map((l) => h('span', { class: 'pill' }, l))),
      h('button', { class: 'btn ghost', onclick: () => close() }, 'Close'),
    ]);
  }

  const SQUARE = { legendary: '🟨', epic: '🟪', rare: '🟦', uncommon: '🟩', common: '⬜' };
  function shareGrid(puzzle, cells) {
    return [0, 1, 2].map((r) => [0, 1, 2].map((c) => {
      const cell = cells[r * 3 + c];
      return cell ? SQUARE[T.tierOf(cell.pts)] : '⬛';
    }).join('')).join('\n');
  }

  // ---------- generic solo/group play screen ----------
  /* cfg: { puzzle, state:{cells,strikes,done}, guess(cell,iso)->{valid,pts,state}, finish()->state, answersFor(cell)->labels|null,
            title (share), onDone(state), extra(el) } */
  function playScreen(cfg) {
    const { puzzle } = cfg;
    let st = cfg.state;
    let flash = null;
    const status = h('div', { class: 'status' });
    const boardHost = h('div');
    const foot = h('div', { class: 'foot' });
    const extra = h('div', { style: 'margin-top:14px' });
    const root = h('div', {}, status, boardHost, foot, extra);
    let busy = false;

    function draw() {
      const sc = T.soloScore(st.cells);
      status.replaceChildren(
        h('div', { 'aria-label': `${T.MAX_STRIKES - st.strikes} strikes left` }, [0, 1, 2].map((i) => h('span', { class: 'heart' }, i < st.strikes ? '💔' : '❤️'))),
        h('div', { class: 'score' }, h('b', {}, sc.total), ' pts'));
      boardHost.replaceChildren(renderBoard(puzzle, st.cells, { onCell: onCell, reveal: st.done, flash, disabled: busy }));
      flash = null;
      foot.replaceChildren();
      if (!st.done) {
        foot.append(
          h('div', { class: 'hint' }, 'Tap a square and name something that fits both clues. ' + T.MAX_STRIKES + ' strikes and you’re out. Obscure picks score more; each line adds +' + T.LINE_BONUS + '.'),
          legend(),
          h('button', { class: 'btn ghost small', onclick: onFinishEarly }, 'Finish & see answers'));
      } else {
        foot.append(summary(sc));
      }
    }

    function summary(sc) {
      const lines = [['Squares', sc.base]];
      if (sc.lines) lines.push([`Lines × ${sc.lines}`, sc.lines * T.LINE_BONUS]);
      if (sc.full) lines.push(['Full grid bonus', T.FULL_BONUS]);
      const filled = st.cells.filter(Boolean).length;
      const text = `${cfg.title}\n${shareGrid(puzzle, st.cells)}\n${filled}/9 squares · ${sc.total} pts`;
      return h('div', { class: 'card summary' },
        h('h3', {}, filled === 9 ? '🎉 Grid complete!' : st.strikes >= T.MAX_STRIKES ? 'Out of strikes' : 'Finished'),
        h('div', { class: 'breakdown' }, lines.map(([a, b]) => [h('span', {}, a), h('b', {}, '+' + b)]), h('span', {}, h('b', {}, 'Total')), h('b', {}, sc.total)),
        h('div', { class: 'share' }, shareGrid(puzzle, st.cells)),
        h('div', { class: 'hint' }, 'Tap a ? square to see its possible answers.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', style: 'flex:1', onclick: () => shareOrCopy('TicTacWorld', text, location.origin) }, 'Share result'),
          cfg.again ? h('button', { class: 'btn ghost', style: 'flex:1', onclick: cfg.again }, 'Play again') : null));
    }

    function onCell(i) {
      if (st.done) {
        if (!st.cells[i]) { const labels = cfg.answersFor(i); if (labels) showAnswers(puzzle, i, labels); }
        return;
      }
      if (st.cells[i] || busy) return;
      const used = new Set(st.cells.filter(Boolean).map((c) => c.iso));
      openPicker({
        puzzle, cell: i, used, onPick: async (iso) => {
          busy = true;
          try {
            const r = await cfg.guess(i, iso);
            st = r.state;
            flash = { cell: i, kind: r.valid ? 'good' : 'bad' };
            toast(r.valid ? `✓ ${labelFor(puzzle.theme, iso)} +${r.pts}` : `✗ ${labelFor(puzzle.theme, iso)} doesn’t fit`, r.valid ? 'good' : 'bad');
          } catch (e) { toast(e.message, 'bad'); }
          busy = false;
          draw();
          if (st.done && cfg.onDone) cfg.onDone(st);
        },
      });
    }

    async function onFinishEarly() {
      if (!window.confirm('Finish now? Your remaining squares will stay empty.')) return;
      try { st = await cfg.finish(); } catch (e) { toast(e.message, 'bad'); return; }
      draw();
      if (cfg.onDone) cfg.onDone(st);
    }

    draw();
    return { el: root, extra, update(newState) { st = newState; draw(); } };
  }

  // ---------- chrome ----------
  function topBar(title, { back = '#/', sub, right } = {}) {
    return h('div', { class: 'top' },
      h('a', { class: 'icon-btn', href: back, 'aria-label': 'Back' }, '←'),
      h('h2', {}, title, sub ? h('span', { class: 'sub' }, sub) : null), right || null);
  }
  function chips(options, value, onChange) {
    const wrap = h('div', { class: 'chips', role: 'radiogroup' });
    const draw = () => wrap.replaceChildren(...options.map(([val, label]) =>
      h('button', { class: 'chip' + (val === value ? ' on' : ''), role: 'radio', 'aria-checked': String(val === value), onclick: () => { value = val; onChange(val); draw(); } }, label)));
    draw();
    return wrap;
  }
  const themeOptions = () => Object.values(T.THEMES).map((t) => [t.id, `${t.icon} ${t.name}`]);
  const diffOptions = () => Object.values(T.DIFFICULTIES).map((d) => [d.id, d.name]);

  // ---------- router ----------
  let cleanup = null;
  let navId = 0;
  function route() {
    if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
    navId++;
    const [pathPart, query = ''] = (location.hash.replace(/^#/, '') || '/').split('?');
    const q = Object.fromEntries(new URLSearchParams(query));
    const seg = pathPart.split('/').filter(Boolean);
    app.replaceChildren();
    window.scrollTo(0, 0);
    document.querySelectorAll('.sheet-back').forEach((s) => s.remove());
    let r;
    if (seg[0] === 'solo') r = viewSolo(q);
    else if (seg[0] === 'g' && seg[2] === 'c' && seg[3]) r = viewChallenge(seg[1].toUpperCase(), seg[3]);
    else if (seg[0] === 'g' && seg[1]) r = viewGroup(seg[1].toUpperCase());
    else if (seg[0] === 'r' && seg[1]) r = viewRoom(seg[1].toUpperCase());
    else r = viewHome();
    cleanup = typeof r === 'function' ? r : null;
  }
  window.addEventListener('hashchange', route);

  // ---------- home ----------
  function viewHome() {
    let theme = ls.get('ttw.theme', 'classic');
    let diff = ls.get('ttw.diff', 'normal');
    const nickInput = h('input', { class: 'field', value: getNick(), placeholder: 'Your nickname', maxlength: '20', 'aria-label': 'Nickname', autocomplete: 'nickname' });
    nickInput.addEventListener('input', () => ls.set('ttw.nick', nickInput.value.trim().slice(0, 20)));
    const needNick = () => {
      const n = nickInput.value.trim();
      if (!n) { toast('Pick a nickname first', 'bad'); nickInput.focus(); return null; }
      ls.set('ttw.nick', n);
      return n;
    };

    const groupsCard = h('div');
    const drawGroups = () => {
      const mine = Object.entries(ls.get('ttw.groups', {}));
      groupsCard.replaceChildren(...mine.map(([code, g]) =>
        h('a', { class: 'challenge', href: `#/g/${code}` }, h('span', { class: 'big' }, '👥'),
          h('span', { class: 'grow' }, h('b', {}, g.name), h('small', {}, 'Code ' + code)), h('span', {}, '›'))));
    };
    drawGroups();
    const groupName = h('input', { class: 'field', placeholder: 'New group name (e.g. Family chat)', maxlength: '40', 'aria-label': 'Group name' });
    const groupCode = h('input', { class: 'field', placeholder: 'Group code', maxlength: '6', autocapitalize: 'characters', 'aria-label': 'Group code' });
    const roomCode = h('input', { class: 'field', placeholder: 'Room code', maxlength: '4', autocapitalize: 'characters', 'aria-label': 'Room code' });

    const createGroup = async () => {
      const nick = needNick(); if (!nick) return;
      try {
        const r = await api('POST', '/groups', { name: groupName.value, nick });
        saveGroup(r);
        location.hash = '#/g/' + r.code;
      } catch (e) { toast(e.message, 'bad'); }
    };

    const quick = async () => {
      const nick = needNick(); if (!nick) return;
      try {
        const r = await api('POST', '/quickmatch', { nick, theme });
        saveRoom(r);
        location.hash = '#/r/' + r.code;
      } catch (e) { toast(e.message, 'bad'); }
    };
    const createRoom = () => {
      const nick = needNick(); if (!nick) return;
      let t = theme, d = diff;
      const close = sheet([
        h('h3', {}, 'Create a live room'),
        h('div', { class: 'label' }, 'Format'), chips(themeOptions(), t, (v) => (t = v)),
        h('div', { class: 'label' }, 'Difficulty'), chips(diffOptions(), d, (v) => (d = v)),
        h('button', { class: 'btn block', onclick: async () => {
          try {
            const r = await api('POST', '/rooms', { nick, theme: t, difficulty: d });
            saveRoom(r); close(); location.hash = '#/r/' + r.code;
          } catch (e) { toast(e.message, 'bad'); }
        } }, 'Create room & get invite link'),
      ]);
    };

    app.append(
      h('div', { class: 'hero' },
        h('div', { class: 'logo' }, h('span', { class: 'x' }, 'Tic'), h('span', {}, 'Tac'), h('span', { class: 'o' }, 'World')),
        h('div', { class: 'tagline' }, 'Cross two clues. Name the place. Claim the square.')),
      h('div', { class: 'card' }, h('div', { class: 'label', style: 'margin-top:0' }, 'Playing as'), nickInput),
      h('div', { class: 'card' },
        h('h3', {}, '📅 Daily puzzle'), h('p', {}, 'Same grid for everyone today. Compare scores with friends.'),
        h('div', { class: 'row', style: 'flex-wrap:wrap' }, Object.values(T.THEMES).map((t) => {
          const done = ls.get('ttw.solo.' + t.id + '.normal.' + T.dailySeed(), null);
          return h('a', { class: 'btn' + (done && done.done ? ' ghost' : ''), style: 'flex:1', href: `#/solo?daily=1&theme=${t.id}` }, `${t.icon} ${t.name}`, done && done.done ? ' ✓' : '');
        }))),
      h('div', { class: 'card' },
        h('h3', {}, '🎯 Practice solo'), h('p', {}, 'Fill the grid, 3 strikes allowed. Rare answers pay big.'),
        h('div', { class: 'label' }, 'Format'), chips(themeOptions(), theme, (v) => { theme = v; ls.set('ttw.theme', v); }),
        h('div', { class: 'label' }, 'Difficulty'), chips(diffOptions(), diff, (v) => { diff = v; ls.set('ttw.diff', v); }),
        h('button', { class: 'btn block', onclick: () => (location.hash = `#/solo?theme=${theme}&diff=${diff}&seed=${rand()}`) }, 'Play')),
      h('div', { class: 'card' },
        h('h3', {}, '⚔️ Live 1 vs 1'), h('p', {}, 'Take turns claiming squares — no clock, take your time. Three in a row wins; a wrong answer loses your turn.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', style: 'flex:1', onclick: quick }, '⚡ Quick match'),
          h('button', { class: 'btn ghost', style: 'flex:1', onclick: createRoom }, 'Challenge a friend')),
        h('div', { class: 'row', style: 'margin-top:10px' }, roomCode,
          h('button', { class: 'btn ghost', onclick: () => { const c = roomCode.value.trim().toUpperCase(); if (c) location.hash = '#/r/' + c; } }, 'Join'))),
      h('div', { class: 'card' },
        h('h3', {}, '👥 Friend groups'), h('p', {}, 'Everyone plays the same grid whenever they like. Climb the group leaderboard.'),
        groupsCard,
        h('div', { class: 'row' }, groupName, h('button', { class: 'btn', onclick: createGroup }, 'Create')),
        h('div', { class: 'row', style: 'margin-top:10px' }, groupCode,
          h('button', { class: 'btn ghost', onclick: () => { const c = groupCode.value.trim().toUpperCase(); if (c) location.hash = '#/g/' + c; } }, 'Join'))),
      h('div', { class: 'card' },
        h('h3', {}, '🗺️ Formats'),
        h('div', { class: 'formats' }, [
          ...Object.values(T.THEMES).map((t) => h('div', {}, h('span', {}, t.icon), h('span', {}, h('b', {}, t.name + ' — '), t.blurb))),
          h('div', { class: 'muted' }, h('span', {}, '🔜'), h('span', {}, 'Coming: World cities, Rivers & mountains, Landmarks, Languages')),
        ])),
      h('details', { class: 'card' }, h('summary', {}, 'How scoring works'),
        h('ul', {},
          h('li', {}, 'Points are earned by your pick: household-name countries give little, obscure ones give more, and squares with very few valid answers add a bonus (+1 to +9 per pick).'),
          h('li', {}, 'You can’t reuse an answer in the same grid.'),
          h('li', {}, 'Solo & groups: +5 for every completed line (row, column, diagonal) and +10 for a full grid.'),
          h('li', {}, 'Live: first to three in a row wins. If the board fills up, the higher points total wins.'))));
  }

  const saveGroup = (r) => {
    const all = ls.get('ttw.groups', {});
    all[r.code] = { name: r.name, token: r.me.token, id: r.me.id, nick: r.me.nick };
    ls.set('ttw.groups', all);
    ls.set('ttw.nick', r.me.nick);
  };
  const saveRoom = (r) => {
    const all = ls.get('ttw.rooms', {});
    all[r.code] = { token: r.token, seat: r.seat, at: Date.now() };
    // keep the list small
    Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(20).forEach((k) => delete all[k]);
    ls.set('ttw.rooms', all);
  };

  // ---------- solo ----------
  function viewSolo(q) {
    const theme = T.THEMES[q.theme] ? q.theme : 'classic';
    const daily = q.daily === '1';
    const diff = daily ? 'normal' : T.DIFFICULTIES[q.diff] ? q.diff : 'normal';
    const seed = daily ? T.dailySeed() : q.seed || rand();
    if (!daily && !q.seed) history.replaceState(null, '', `#/solo?theme=${theme}&diff=${diff}&seed=${seed}`);
    const puzzle = T.buildPuzzle(seed, theme, diff);
    const key = `ttw.solo.${theme}.${diff}.${seed}`;
    const saved = ls.get(key, null);
    const state = saved || { cells: Array(9).fill(null), strikes: 0, done: false };
    const persist = () => ls.set(key, state);

    const guess = async (cell, iso) => {
      const valid = T.checkGuess(puzzle, cell, iso);
      if (valid) state.cells[cell] = { iso, pts: T.pickPoints(puzzle, cell, iso) }; else state.strikes++;
      if (state.cells.every(Boolean) || state.strikes >= T.MAX_STRIKES) state.done = true;
      persist();
      return { valid, pts: valid ? state.cells[cell].pts : 0, state };
    };
    const t = T.THEMES[theme];
    const title = daily ? `TicTacWorld Daily ${seed.slice(6)} ${t.icon}` : `TicTacWorld ${t.icon} ${t.name} (${T.DIFFICULTIES[diff].name})`;
    const screen = playScreen({
      puzzle, state, guess, title,
      finish: async () => { state.done = true; persist(); return state; },
      answersFor: (i) => T.answerLabels(puzzle, i),
      again: daily ? null : () => (location.hash = `#/solo?theme=${theme}&diff=${diff}&seed=${rand()}`),
    });
    app.append(
      topBar(daily ? `Daily ${t.name}` : `${t.name} · ${T.DIFFICULTIES[diff].name}`, { sub: t.blurb }),
      screen.el);
  }

  // ---------- groups ----------
  function viewGroup(code) {
    const id = navId;
    const mineKey = () => ls.get('ttw.groups', {})[code];
    const host = h('div');
    app.append(topBar('Friend group', { sub: 'Code ' + code }), host);
    let timer;

    async function load() {
      const me = mineKey();
      let data;
      try { data = await api('GET', `/groups/${code}`, null, me && me.token); }
      catch (e) { if (id === navId) host.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Group not found'), h('p', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Home'))); return; }
      if (id !== navId) return;
      if (!data.member) return drawJoin(data);
      draw(data);
    }

    function drawJoin(data) {
      const nick = h('input', { class: 'field', value: getNick(), placeholder: 'Your nickname', maxlength: '20', 'aria-label': 'Nickname' });
      const go = async () => {
        try {
          const r = await api('POST', `/groups/${code}/join`, { nick: nick.value }, (mineKey() || {}).token);
          saveGroup(r); load();
        } catch (e) { toast(e.message, 'bad'); }
      };
      host.replaceChildren(h('div', { class: 'card' },
        h('h3', {}, `Join “${data.name}”`), h('p', {}, `${data.memberCount} player${data.memberCount === 1 ? '' : 's'} so far.`),
        h('div', { class: 'row' }, nick, h('button', { class: 'btn', onclick: go }, 'Join'))));
    }

    function draw(data) {
      let theme = ls.get('ttw.theme', 'classic'), diff = ls.get('ttw.diff', 'normal');
      const link = `${location.origin}/#/g/${code}`;
      const create = async () => {
        try {
          const ch = await api('POST', `/groups/${code}/challenges`, { theme, difficulty: diff }, mineKey().token);
          location.hash = `#/g/${code}/c/${ch.id}`;
        } catch (e) { toast(e.message, 'bad'); }
      };
      host.replaceChildren(
        h('div', { class: 'card' },
          h('h3', {}, data.name),
          h('p', {}, `${data.players.length} player${data.players.length === 1 ? '' : 's'} · invite friends with the link or code ${code}`),
          h('div', { class: 'row' },
            h('button', { class: 'btn', style: 'flex:1', onclick: () => shareOrCopy('Join my TicTacWorld group', `Join my TicTacWorld group “${data.name}” (code ${code})`, link) }, '📨 Invite friends'),
            h('button', { class: 'btn ghost', onclick: () => copy(link, 'Link copied!') }, 'Copy link'))),
        h('div', { class: 'card' },
          h('h3', {}, '🏆 Group leaderboard'), h('p', {}, 'Total points across finished challenges.'),
          h('ol', { class: 'lb' }, data.totals.map((p, i) =>
            h('li', { class: p.id === data.me.id ? 'me' : '' }, h('div', { class: 'line' },
              h('span', { class: 'rank' }, i + 1), h('span', { class: 'nick' }, p.nick),
              h('span', { class: 'meta' }, `${p.played} played · ${p.wins} 🥇`), h('span', { class: 'sc' }, p.points)))))),
        h('div', { class: 'card' },
          h('h3', {}, '➕ New challenge'), h('p', {}, 'Creates a fresh grid that everyone in the group can play any time.'),
          h('div', { class: 'label' }, 'Format'), chips(themeOptions(), theme, (v) => { theme = v; ls.set('ttw.theme', v); }),
          h('div', { class: 'label' }, 'Difficulty'), chips(diffOptions(), diff, (v) => { diff = v; ls.set('ttw.diff', v); }),
          h('button', { class: 'btn block', onclick: create }, 'Create challenge')),
        h('div', { class: 'card' },
          h('h3', {}, 'Challenges'),
          data.challenges.length ? data.challenges.map((c) => {
            const t = T.THEMES[c.theme];
            const mine = c.mine;
            const status = mine ? (mine.done ? `✅ ${mine.score} pts` : `▶ Resume · ${mine.filled}/9`) : '🆕 Not played';
            return h('a', { class: 'challenge', href: `#/g/${code}/c/${c.id}` },
              h('span', { class: 'big' }, t.icon),
              h('span', { class: 'grow' }, h('b', {}, `${t.name} · ${T.DIFFICULTIES[c.difficulty].name}`),
                h('small', {}, `by ${c.createdBy} · ${c.finished}/${data.players.length} finished`),
                c.leader ? h('small', {}, `👑 ${c.leader.nick} ${c.leader.score}`) : null),
              h('span', {}, status));
          }) : h('div', { class: 'muted' }, 'No challenges yet — create the first one!')));
    }

    load();
    timer = setInterval(() => { if (!document.querySelector('.sheet-back') && document.activeElement && document.activeElement.tagName !== 'INPUT') load(); }, 20000);
    return () => clearInterval(timer);
  }

  function leaderboard(board, meId, theme) {
    return h('ol', { class: 'lb' }, board.map((p, i) => {
      const meta = !p.started ? 'not played yet' : p.done ? `${p.filled}/9 · ${p.lines} line${p.lines === 1 ? '' : 's'}` : `playing · ${p.filled}/9`;
      return h('li', { class: p.id === meId ? 'me' : '' },
        h('div', { class: 'line' }, h('span', { class: 'rank' }, p.started ? i + 1 : '–'), h('span', { class: 'nick' }, p.nick),
          h('span', { class: 'meta' }, meta), h('span', { class: 'sc' }, p.started ? p.score : '')),
        p.picks ? h('div', { class: 'picks', title: 'Their picks' }, p.picks.map((x) => h('span', { title: x ? labelFor(theme, x.iso) : '' }, x ? T.flagEmoji(x.iso) : '·'))) : null);
    }));
  }

  function viewChallenge(code, cid) {
    const id = navId;
    const me = (ls.get('ttw.groups', {})[code]) || null;
    if (!me) { location.hash = '#/g/' + code; return; }
    let timer;
    const host = h('div');
    app.append(host);
    let screen = null, answers = null, view = null;

    async function refresh(first) {
      try { view = await api('GET', `/groups/${code}/challenges/${cid}`, null, me.token); }
      catch (e) { if (id === navId) host.replaceChildren(topBar('Challenge', { back: '#/g/' + code }), h('div', { class: 'card' }, h('h3', {}, 'Could not open challenge'), h('p', {}, e.message))); return; }
      if (id !== navId) return;
      if (view.answers) answers = view.answers;
      const state = { cells: view.me.cells, strikes: view.me.strikes, done: view.me.done };
      if (first) {
        const t = T.THEMES[view.theme];
        screen = playScreen({
          puzzle: view.puzzle, state, title: `TicTacWorld ${t.icon} ${view.groupName}`,
          guess: async (cell, iso) => {
            const r = await api('POST', `/groups/${code}/challenges/${cid}/guess`, { cell, iso }, me.token);
            if (r.answers) answers = r.answers;
            return { valid: r.valid, pts: r.pts, state: { cells: r.me.cells, strikes: r.me.strikes, done: r.me.done } };
          },
          finish: async () => { const v = await api('POST', `/groups/${code}/challenges/${cid}/finish`, null, me.token); answers = v.answers; return { cells: v.me.cells, strikes: v.me.strikes, done: v.me.done }; },
          answersFor: (i) => (answers ? answers[i].labels : null),
          onDone: () => refresh(false),
        });
        host.replaceChildren(
          topBar(`${t.icon} ${view.groupName}`, { back: '#/g/' + code, sub: `${t.name} · ${T.DIFFICULTIES[view.difficulty].name}` }),
          screen.el, h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', {}, '🏆 Leaderboard'), h('div', { id: 'lb-host' })));
      } else if (view.me.done) {
        screen.update(state);
      }
      const lb = host.querySelector('#lb-host');
      if (lb) {
        const kids = [leaderboard(view.board, (ls.get('ttw.groups', {})[code] || {}).id, view.theme)];
        if (!view.me.done) kids.unshift(h('p', {}, 'Others’ picks are revealed once you finish.'));
        lb.replaceChildren(...kids);
      }
    }
    refresh(true);
    timer = setInterval(() => { if (!document.querySelector('.sheet-back')) refresh(false); }, 15000);
    return () => clearInterval(timer);
  }

  // ---------- live rooms ----------
  function viewRoom(code) {
    const id = navId;
    const host = h('div');
    app.append(host);
    let es = null, state = null, lastEventTs = 0, flash = null;
    const sessions = () => ls.get('ttw.rooms', {});
    let sess = sessions()[code] || null;

    const gone = (msg) => host.replaceChildren(topBar('Live room'), h('div', { class: 'card center' }, h('h3', {}, msg), h('p', {}, 'The room may have expired.'), h('a', { class: 'btn', href: '#/' }, 'Back home')));

    async function start() {
      let info;
      try { info = await api('GET', `/rooms/${code}`); } catch (e) { return gone('Room not found'); }
      if (id !== navId) return;
      if (!sess && info.open) return joinForm(info);
      connect();
    }

    function joinForm(info) {
      const nick = h('input', { class: 'field', value: getNick(), placeholder: 'Your nickname', maxlength: '20', 'aria-label': 'Nickname' });
      const go = async () => {
        try {
          const r = await api('POST', `/rooms/${code}/join`, { nick: nick.value }, null);
          ls.set('ttw.nick', nick.value.trim());
          saveRoom(r); sess = sessions()[code]; connect();
        } catch (e) { toast(e.message, 'bad'); }
      };
      host.replaceChildren(topBar('Live 1 vs 1', { sub: 'Room ' + code }),
        h('div', { class: 'card' },
          h('h3', {}, `${info.players[0]} challenges you!`), h('p', {}, `${T.THEMES[info.theme].icon} ${T.THEMES[info.theme].name} · ${T.DIFFICULTIES[info.difficulty].name}`),
          h('div', { class: 'row' }, nick, h('button', { class: 'btn', onclick: go }, 'Join game')),
          h('button', { class: 'btn ghost block', style: 'margin-top:10px', onclick: () => { sess = null; connect(); } }, 'Just watch')));
    }

    function connect() {
      es = new EventSource(`/api/rooms/${code}/events?token=${encodeURIComponent((sess && sess.token) || '')}`);
      es.onmessage = (ev) => {
        if (id !== navId) return;
        const prev = state;
        state = JSON.parse(ev.data);
        if (state.lastEvent && state.lastEvent.ts !== lastEventTs) {
          lastEventTs = state.lastEvent.ts;
          if (prev) flash = state.lastEvent.type === 'claim' ? { cell: state.lastEvent.cell, kind: 'good' } : state.lastEvent.type === 'miss' ? { cell: state.lastEvent.cell, kind: 'bad' } : null;
        }
        draw();
      };
      es.onerror = () => { /* EventSource retries by itself */ };
    }

    const nameOf = (seat) => (state.players[seat] ? state.players[seat].nick : '…');
    function eventText() {
      const e = state.lastEvent;
      if (!e) return null;
      const who = e.seat === state.you ? 'You' : nameOf(e.seat);
      const label = e.iso ? `${T.flagEmoji(e.iso)} ${labelFor(state.theme, e.iso)}` : '';
      if (e.type === 'claim') return `✓ ${who} claimed a square with ${label} (+${e.pts})`;
      return e.reason === 'used' ? `✗ ${who} tried ${label} — already used` : `✗ ${who} tried ${label} — doesn’t fit`;
    }

    function draw() {
      if (!state) return;
      const s = state;
      const you = s.you;
      const playing = s.status === 'playing';
      if (s.status === 'waiting') return drawWaiting();
      const myTurn = playing && you === s.turn;
      const cells = s.board.map((b) => (b ? { iso: b.iso, pts: b.pts, owner: b.seat } : null));
      const finished = s.status === 'finished';

      const playerBox = (seat) => h('div', { class: `pl p${seat}` + (playing && s.turn === seat ? ' turn' : '') },
        h('div', { class: 'pn' }, h('span', { class: 'm' }, seat === 0 ? '✕' : '◯'), nameOf(seat),
          h('span', { class: 'dot' + (s.players[seat] && s.players[seat].online ? ' on' : ''), title: 'online' })),
        h('div', { class: 'ps' }, `${s.scores[seat]} pts` + (seat === you ? ' · you' : '')));
      const children = [
        topBar('Live 1 vs 1', { sub: `${T.THEMES[s.theme].icon} ${T.THEMES[s.theme].name} · ${T.DIFFICULTIES[s.difficulty].name} · room ${s.code}`,
          right: h('button', { class: 'icon-btn', 'aria-label': 'Invite', onclick: () => shareOrCopy('Play TicTacWorld with me', 'Play a live geography tic-tac-toe with me!', location.origin + '/#/r/' + s.code) }, '📨') }),
        h('div', { class: 'vs' }, playerBox(0), h('div', { class: 'mid' }, h('span', {}, `${s.wins[0]}–${s.wins[1]}`), h('small', {}, 'series')), playerBox(1)),
      ];
      const txt = eventText();
      if (playing) {
        children.push(h('div', { class: 'banner' + (myTurn ? ' mine' : '') },
          myTurn ? '👉 Your turn — pick a square' : you >= 0 ? `Waiting for ${nameOf(s.turn)}…` : `${nameOf(s.turn)} to move`,
          txt ? h('div', { class: 'muted', style: 'font-size:.85rem' }, txt) : null));
      } else if (finished) {
        children.push(resultCard(txt));
      }
      children.push(renderBoard(s.puzzle, cells, {
        onCell: (i) => onCell(i, myTurn, finished), disabled: !myTurn && !finished, reveal: finished, winLine: s.winLine, flash,
      }));
      flash = null;
      if (playing && you >= 0) children.push(legend(), h('div', { class: 'foot' }, h('button', { class: 'btn ghost small', onclick: resign }, 'Resign')));
      host.replaceChildren(...children);
    }

    function resultCard(txt) {
      const s = state;
      const you = s.you;
      let head, sub;
      if (s.winner === -1) { head = '🤝 Draw'; sub = 'Board full and the points are level.'; }
      else {
        const won = s.winner === you;
        const spectator = you < 0;
        head = spectator ? `🏆 ${nameOf(s.winner)} wins` : won ? '🎉 You win!' : '😬 You lose';
        sub = { line: 'Three in a row.', points: 'Board full — higher points total wins.', resign: 'Opponent resigned.' }[s.reason] || '';
        if (s.reason === 'resign' && !won && !spectator) sub = 'You resigned.';
      }
      const myVote = you >= 0 && s.rematch[you];
      return h('div', { class: 'card result' }, h('h3', {}, head), h('p', {}, sub, ` Final: ${s.scores[0]}–${s.scores[1]} pts.`),
        txt ? h('p', {}, txt) : null,
        you >= 0 ? h('div', { class: 'row' },
          h('button', { class: 'btn', style: 'flex:1', disabled: myVote, onclick: rematch }, myVote ? 'Waiting for opponent…' : s.rematch[1 - you] ? 'Accept rematch' : '🔄 Rematch'),
          h('a', { class: 'btn ghost', href: '#/' }, 'Home')) : h('a', { class: 'btn ghost', href: '#/' }, 'Home'),
        h('div', { class: 'hint' }, 'Tap an empty square to see what would have worked.'));
    }

    function drawWaiting() {
      const link = `${location.origin}/#/r/${code}`;
      host.replaceChildren(topBar('Live 1 vs 1', { sub: `${T.THEMES[state.theme].icon} ${T.THEMES[state.theme].name} · ${T.DIFFICULTIES[state.difficulty].name}` }),
        h('div', { class: 'card center' },
          h('h3', {}, state.quick ? '⚡ Looking for an opponent…' : 'Waiting for your friend'),
          h('p', {}, state.quick ? 'Stay on this screen — the game starts as soon as someone joins.' : 'Share the link or the code. The game starts when they join.'),
          h('div', { class: 'code' }, code),
          h('div', { class: 'row', style: 'margin-top:12px' },
            h('button', { class: 'btn', style: 'flex:1', onclick: () => shareOrCopy('Play TicTacWorld with me', 'Play a live geography tic-tac-toe with me!', link) }, '📨 Invite'),
            h('button', { class: 'btn ghost', onclick: () => copy(link, 'Link copied!') }, 'Copy link')),
          h('button', { class: 'btn ghost block', style: 'margin-top:10px', onclick: async () => { if (sess) { try { await api('POST', `/rooms/${code}/resign`, null, sess.token); } catch (e) { /* ignore */ } } location.hash = '#/'; } }, 'Cancel')));
    }

    async function onCell(i, myTurn, finished) {
      const s = state;
      if (finished) {
        if (!s.board[i] && s.answers) showAnswers(s.puzzle, i, s.answers[i]);
        return;
      }
      if (!myTurn || s.board[i]) return;
      const used = new Set(s.board.filter(Boolean).map((b) => b.iso));
      openPicker({
        puzzle: s.puzzle, cell: i, used, onPick: async (iso) => {
          try {
            const r = await api('POST', `/rooms/${code}/move`, { cell: i, iso }, sess.token);
            if (!r.valid) toast(`✗ ${labelFor(s.theme, iso)} doesn’t fit — turn lost`, 'bad');
            else toast(`✓ ${labelFor(s.theme, iso)} +${r.pts}`, 'good');
          } catch (e) { toast(e.message, 'bad'); }
        },
      });
    }
    const rematch = async () => { try { await api('POST', `/rooms/${code}/rematch`, null, sess.token); } catch (e) { toast(e.message, 'bad'); } };
    const resign = async () => { if (window.confirm('Resign this game?')) { try { await api('POST', `/rooms/${code}/resign`, null, sess.token); } catch (e) { toast(e.message, 'bad'); } } };

    start();
    return () => { if (es) es.close(); };
  }

  route();
})();

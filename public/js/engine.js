/* Game engine shared by browser and server: criteria, deterministic puzzle generator,
   guess validation, rarity points and scoring. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.TTW = factory(root.TTWData);
})(this, function (D) {
  const { countries, byIso, LISTS, FAME } = D;

  // ---------- text helpers ----------
  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const flagEmoji = (iso) =>
    String.fromCodePoint(...[...iso].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
  const letters = (s) => norm(s).replace(/ /g, '');

  // ---------- criteria ----------
  // tags: 'attr' works in every theme; 'name' = country-name clues; 'capname' = capital-name clues; 'flag' = flag clues
  const CRITERIA = {};
  const add = (id, group, tags, icon, short, label, test) => {
    CRITERIA[id] = { id, group, tags, icon, short, label, test };
  };
  const inList = (name) => (c) => LISTS[name].has(c.iso);

  // population / size
  add('pop100', 'pop', ['attr'], '👥', '100M+ people', 'Has more than 100 million people', (c) => c.pop > 100);
  add('pop60', 'pop', ['attr'], '👥', '60M+ people', 'Has more than 60 million people', (c) => c.pop > 60);
  add('pop10_20', 'pop', ['attr'], '👥', '10–20M people', 'Has between 10 and 20 million people', (c) => c.pop >= 10 && c.pop <= 20);
  add('popSmall', 'pop', ['attr'], '🐜', 'Under 1M people', 'Has fewer than 1 million people', (c) => c.pop < 1);
  add('area1m', 'area', ['attr'], '📏', 'Over 1M km²', 'Covers more than 1 million km²', (c) => c.area > 1000);
  add('area2_5m', 'area', ['attr'], '📏', 'Over 2.5M km²', 'Covers more than 2.5 million km²', (c) => c.area > 2500);
  add('areaSmall', 'area', ['attr'], '🔬', 'Under 1,000 km²', 'Covers less than 1,000 km²', (c) => c.area < 1);

  // continents
  const CONT = { EU: ['🏰', 'Europe'], AS: ['🏯', 'Asia'], AF: ['🦁', 'Africa'], NA: ['🗽', 'North America'], SA: ['🦙', 'South America'], OC: ['🦘', 'Oceania'] };
  Object.entries(CONT).forEach(([k, [icon, name]]) =>
    add('cont' + k, 'cont', ['attr'], icon, 'In ' + name, 'Is (partly) in ' + name, (c) => c.conts.includes(k)));

  // geography
  add('landlocked', 'geo', ['attr'], '🏔️', 'Landlocked', 'Has no sea coast (landlocked)', inList('landlocked'));
  add('island', 'geo', ['attr'], '🏝️', 'Island nation', 'Is an island nation', inList('island'));
  add('wonder', 'wonder', ['attr'], '🏛️', 'Wonder of the World', 'Has a Wonder of the World within its borders', inList('wonder'));
  add('equator', 'hemi', ['attr'], '🧭', 'Crossed by Equator', 'The Equator passes through it', inList('equator'));
  add('southcap', 'hemi', ['attr'], '⬇️', 'Capital in the South', 'Has its capital in the Southern Hemisphere', inList('southcap'));
  add('arctic', 'hemi', ['attr'], '🧊', 'Arctic Circle', 'The Arctic Circle passes through it', inList('arctic'));
  add('med', 'water', ['attr'], '🌊', 'Mediterranean coast', 'Has a Mediterranean coastline', inList('med'));
  add('baltic', 'water', ['attr'], '⚓', 'Baltic coast', 'Has a Baltic Sea coastline', inList('baltic'));
  add('redsea', 'water', ['attr'], '🪸', 'Red Sea coast', 'Has a Red Sea coastline', inList('redsea'));
  add('caribbean', 'water', ['attr'], '🌴', 'Caribbean coast', 'Has a Caribbean Sea coastline', inList('caribbean'));
  add('sahara', 'range', ['attr'], '🏜️', 'Part of Sahara', 'Part of the Sahara desert lies within it', inList('sahara'));
  add('alps', 'range', ['attr'], '⛷️', 'Has Alps', 'Part of the Alps lies within it', inList('alps'));
  add('andes', 'range', ['attr'], '⛰️', 'Has Andes', 'Part of the Andes lies within it', inList('andes'));
  add('himalaya', 'range', ['attr'], '🗻', 'Has Himalaya', 'Part of the Himalaya lies within it', inList('himalaya'));
  add('peak8000', 'range', ['attr'], '🧗', '8,000 m peak', 'Has a mountain over 8,000 m (partly) within its borders', inList('peak8000'));
  add('amazon', 'river', ['attr'], '🌳', 'Amazon basin', 'Part of the Amazon basin lies within it', inList('amazon'));
  add('nile', 'river', ['attr'], '🐊', 'Nile basin', 'Part of the Nile basin lies within it', inList('nile'));
  add('danube', 'river', ['attr'], '🚤', 'Danube flows', 'The Danube flows through it', inList('danube'));
  add('rhine', 'river', ['attr'], '🛳️', 'Rhine flows', 'The Rhine flows through or along it', inList('rhine'));
  add('mekong', 'river', ['attr'], '🛶', 'Mekong flows', 'The Mekong flows through it', inList('mekong'));

  // neighbours
  [['FR', 'France', '🥖'], ['DE', 'Germany', '🥨'], ['CN', 'China', '🐼'], ['RU', 'Russia', '🐻'], ['BR', 'Brazil', '⚽'], ['IN', 'India', '🐘'], ['TR', 'Turkey', '☕'], ['ZA', 'South Africa', '🦏']]
    .forEach(([k, n, icon]) => add('borders' + k, 'border', ['attr'], icon, 'Borders ' + n, 'Shares a land border with ' + n, inList('borders' + k)));

  // politics / orgs / money / traffic
  add('eu', 'org', ['attr'], '🇪🇺', 'EU member', 'Is a member of the European Union', inList('eu'));
  add('euro', 'cur', ['attr'], '💶', 'Uses the euro', 'Uses the euro as its currency', inList('euro'));
  add('nato', 'org', ['attr'], '🛡️', 'NATO member', 'Is a NATO member', inList('nato'));
  add('g20', 'org', ['attr'], '💼', 'G20 member', 'Is a G20 member', inList('g20'));
  add('g7', 'org', ['attr'], '🏦', 'G7 member', 'Is a G7 member', inList('g7'));
  add('brics', 'org', ['attr'], '🤝', 'BRICS member', 'Is a BRICS member', inList('brics'));
  add('p5', 'org', ['attr'], '🕊️', 'UN Security Council P5', 'Is a permanent UN Security Council member', inList('p5'));
  add('monarchy', 'gov', ['attr'], '👑', 'Has a monarch', 'Has a monarch as head of state', inList('monarchy'));
  add('leftdrive', 'traffic', ['attr'], '🚗', 'Drives on the left', 'Drives on the left-hand side of the road', inList('leftdrive'));
  add('notLargest', 'cap', ['attr'], '🏙️', 'Capital not biggest city', 'Its capital is not its largest city', inList('notLargest'));
  add('curDollar', 'cur', ['attr'], '💵', 'Currency: dollar', 'Its currency is a kind of dollar', inList('curDollar'));
  add('curFranc', 'cur', ['attr'], '💱', 'Currency: franc', 'Its currency is a kind of franc', inList('curFranc'));
  add('curPeso', 'cur', ['attr'], '💰', 'Currency: peso', 'Its currency is the peso', inList('curPeso'));
  add('curDinar', 'cur', ['attr'], '🪙', 'Currency: dinar', 'Its currency is a kind of dinar', inList('curDinar'));
  [['ES', 'Spanish', '🐂'], ['FR', 'French', '🥐'], ['AR', 'Arabic', '🕌'], ['EN', 'English', '💂'], ['PT', 'Portuguese', '🎶'], ['DE', 'German', '🍺']]
    .forEach(([k, n, icon]) => add('lang' + k, 'lang', ['attr'], icon, 'Speaks ' + n, n + ' is an official language', inList('lang' + k)));

  // sport
  add('wcWinner', 'sport', ['attr'], '🏆', 'World Cup winner', 'Has won the FIFA World Cup (men)', inList('wcWinner'));
  add('wcHost', 'sport', ['attr'], '⚽', 'Hosted World Cup', 'Has hosted a FIFA World Cup (men)', inList('wcHost'));
  add('summerOly', 'sport', ['attr'], '🏅', 'Hosted Summer Olympics', 'Has hosted a Summer Olympic Games', inList('summerOly'));
  add('winterOly', 'sport', ['attr'], '⛄', 'Hosted Winter Olympics', 'Has hosted a Winter Olympic Games', inList('winterOly'));
  add('grandSlam', 'sport', ['attr'], '🎾', 'Tennis Grand Slam', 'Hosts a tennis Grand Slam tournament', inList('grandSlam'));
  add('rugbyWC', 'sport', ['attr'], '🏉', 'Rugby World Cup winner', 'Has won the Rugby World Cup', inList('rugbyWC'));
  add('cricketWC', 'sport', ['attr'], '🏏', 'Cricket World Cup winner', 'Has won the Cricket World Cup', inList('cricketWC'));

  // name-based (country name / capital name)
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  [...ALPHA].forEach((ch) => {
    const lo = ch.toLowerCase();
    add('ns_' + ch, 'nstart', ['name'], '🔤', 'Starts with ' + ch, `Its name starts with “${ch}”`, (c) => letters(c.name)[0] === lo);
    add('cs_' + ch, 'cstart', ['capname'], '🔤', 'Capital starts ' + ch, `Its capital's name starts with “${ch}”`, (c) => letters(c.capital)[0] === lo);
    add('nc_' + ch, 'ncont', ['name'], '🔡', 'Contains ' + ch, `Its name contains the letter “${ch}”`, (c) => letters(c.name).includes(lo));
    add('cc_' + ch, 'ccont', ['capname'], '🔡', 'Capital has ' + ch, `Its capital's name contains the letter “${ch}”`, (c) => letters(c.capital).includes(lo));
  });
  add('nend_stan', 'nend', ['name'], '🔚', 'Ends with -stan', 'Its name ends with “-stan”', (c) => letters(c.name).endsWith('stan'));
  add('nend_land', 'nend', ['name'], '🔚', 'Ends with -land', 'Its name ends with “-land”', (c) => letters(c.name).endsWith('land'));
  add('nend_ia', 'nend', ['name'], '🔚', 'Ends with -ia', 'Its name ends with “-ia”', (c) => letters(c.name).endsWith('ia'));
  add('nend_a', 'nend', ['name'], '🔚', 'Ends with A', 'Its name ends with “A”', (c) => letters(c.name).endsWith('a'));
  add('nend_n', 'nend', ['name'], '🔚', 'Ends with N', 'Its name ends with “N”', (c) => letters(c.name).endsWith('n'));
  add('nShort', 'nlen', ['name'], '✂️', '5 letters or fewer', 'Its name has 5 letters or fewer', (c) => letters(c.name).length <= 5);
  add('nLong', 'nlen', ['name'], '📜', '11+ letters', 'Its name has 11 or more letters', (c) => letters(c.name).length >= 11);
  add('nWords', 'nwords', ['name'], '🏷️', 'Two+ words', 'Its name is made of two or more words', (c) => norm(c.name).includes(' '));
  add('cShort', 'clen', ['capname'], '✂️', 'Capital ≤ 5 letters', 'Its capital has 5 letters or fewer', (c) => letters(c.capital).length <= 5);
  add('cLong', 'clen', ['capname'], '📜', 'Capital 10+ letters', 'Its capital has 10 or more letters', (c) => letters(c.capital).length >= 10);
  add('cWords', 'cwords', ['capname'], '🏷️', 'Capital: two+ words', 'Its capital is made of two or more words', (c) => norm(c.capital).includes(' '));
  add('cSame', 'csame', ['capname'], '🪞', 'Capital = country name', 'Its capital shares its name with the country', (c) => norm(c.capital) === norm(c.name) || norm(c.capital).startsWith(norm(c.name)));
  add('cVowel', 'cvowel', ['capname'], '🅰️', 'Capital starts with a vowel', 'Its capital starts with a vowel', (c) => 'aeiou'.includes(letters(c.capital)[0]));

  // flags
  const hasCol = (k) => (c) => c.colors.includes(k);
  [['R', 'red', '🟥'], ['G', 'green', '🟩'], ['B', 'blue', '🟦'], ['Y', 'yellow', '🟨'], ['K', 'black', '⬛'], ['O', 'orange', '🟧']]
    .forEach(([k, n, icon]) => add('flag_' + k, 'fcol_' + k, ['flag'], icon, 'Flag has ' + n, `Its flag contains ${n}`, hasCol(k)));
  add('flag_noRed', 'fcol_R', ['flag'], '🚫', 'No red on flag', 'Its flag contains no red', (c) => !c.colors.includes('R'));
  add('flag_noWhite', 'fcol_W', ['flag'], '🚫', 'No white on flag', 'Its flag contains no white', (c) => !c.colors.includes('W'));
  add('flag_star', 'ffeat', ['flag'], '⭐', 'Star on flag', 'Its flag features a star', (c) => c.star);
  add('flag_cross', 'fcross', ['flag'], '✝️', 'Cross on flag', 'Its flag features a cross', (c) => c.cross);
  add('flag_crescent', 'fcres', ['flag'], '🌙', 'Crescent on flag', 'Its flag features a crescent', (c) => c.crescent);
  add('flag_two', 'fcount', ['flag'], '2️⃣', 'Two-colour flag', 'Its flag uses exactly two colours', (c) => c.colors.length === 2);
  add('flag_three', 'fcount', ['flag'], '3️⃣', 'Three-colour flag', 'Its flag uses exactly three colours', (c) => c.colors.length === 3);
  add('flag_many', 'fcount', ['flag'], '🌈', '5+ colours on flag', 'Its flag uses five or more colours', (c) => c.colors.length >= 5);

  // ---------- themes ----------
  const THEMES = {
    classic: { id: 'classic', icon: '🌍', name: 'Countries', blurb: 'Name a country that fits both clues.', answer: 'country', tags: ['attr', 'name'], flagMin: 0 },
    capitals: { id: 'capitals', icon: '🏙️', name: 'Capitals', blurb: 'Name a capital city whose country fits both clues.', answer: 'capital', tags: ['attr', 'capname'], flagMin: 0 },
    flags: { id: 'flags', icon: '🚩', name: 'Flags', blurb: 'Clues about flags and places. Name the country.', answer: 'country', tags: ['attr', 'flag'], flagMin: 3 },
  };
  const DIFFICULTIES = {
    easy: { id: 'easy', name: 'Easy', minAnswers: 4 },
    normal: { id: 'normal', name: 'Normal', minAnswers: 2 },
    hard: { id: 'hard', name: 'Hard', minAnswers: 1 },
  };

  // ---------- rarity ----------
  // Points belong to the PICK, not the square: obscure answers pay more than obvious ones,
  // and squares that only have a few valid answers add a bonus.
  const fameTier = (iso) => (FAME[1].has(iso) ? 1 : FAME[2].has(iso) ? 2 : 3);
  const FAME_BASE = { 1: 1, 2: 3, 3: 5 };
  const scarcityBonus = (n) => (n <= 1 ? 4 : n === 2 ? 3 : n <= 4 ? 2 : n <= 8 ? 1 : 0);
  const pickPoints = (puzzle, cell, iso) => FAME_BASE[fameTier(iso)] + scarcityBonus(puzzle.answers[cell].length);
  const tierOf = (pts) => (pts >= 8 ? 'legendary' : pts >= 6 ? 'epic' : pts >= 4 ? 'rare' : pts >= 2 ? 'uncommon' : 'common');
  const LINE_BONUS = 5;
  const FULL_BONUS = 10;
  const MAX_STRIKES = 3;

  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

  // ---------- seeded random ----------
  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function rngFor(seed) {
    let a = hashSeed(String(seed))();
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const shuffle = (arr, rnd) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // ---------- puzzle generation ----------
  const poolCache = {};
  function poolFor(themeId) {
    if (poolCache[themeId]) return poolCache[themeId];
    const theme = THEMES[themeId];
    const pool = Object.values(CRITERIA)
      .filter((cr) => cr.tags.some((t) => theme.tags.includes(t)))
      .map((cr) => ({ cr, set: new Set(countries.filter((c) => cr.test(c)).map((c) => c.iso)) }))
      .filter((p) => p.set.size >= 4 && p.set.size <= 90);
    return (poolCache[themeId] = pool);
  }

  // is there a way to fill all nine cells with nine different countries?
  function fullyFillable(cells) {
    const owner = new Map();
    const tryCell = (i, seen) => {
      for (const iso of cells[i]) {
        if (seen.has(iso)) continue;
        seen.add(iso);
        if (!owner.has(iso) || tryCell(owner.get(iso), seen)) {
          owner.set(iso, i);
          return true;
        }
      }
      return false;
    };
    for (let i = 0; i < 9; i++) if (!tryCell(i, new Set())) return false;
    return true;
  }

  const puzzleCache = new Map();
  function buildPuzzle(seed, themeId = 'classic', difficultyId = 'normal') {
    const key = `${themeId}|${difficultyId}|${seed}`;
    if (puzzleCache.has(key)) return puzzleCache.get(key);
    const theme = THEMES[themeId] || THEMES.classic;
    const diff = DIFFICULTIES[difficultyId] || DIFFICULTIES.normal;
    const pool = poolFor(theme.id);
    const rnd = rngFor(key);
    const flagPool = pool.filter((p) => p.cr.tags.includes('flag'));
    const otherPool = pool.filter((p) => !p.cr.tags.includes('flag') || theme.flagMin === 0);

    let minAnswers = diff.minAnswers;
    for (let attempt = 0; attempt < 6000; attempt++) {
      if (attempt > 0 && attempt % 1500 === 0 && minAnswers > 1) minAnswers--; // relax if unlucky
      const chosen = [];
      const groups = new Set();
      const take = (candidates, n) => {
        for (const p of shuffle(candidates, rnd)) {
          if (n === 0) break;
          if (groups.has(p.cr.group) || chosen.includes(p)) continue;
          groups.add(p.cr.group);
          chosen.push(p);
          n--;
        }
      };
      if (theme.flagMin) take(flagPool, theme.flagMin);
      take(otherPool, 6 - chosen.length);
      if (chosen.length < 6) continue;
      const six = shuffle(chosen, rnd);
      const rows = six.slice(0, 3), cols = six.slice(3);
      const cells = [];
      let ok = true;
      for (let r = 0; r < 3 && ok; r++) {
        for (let c = 0; c < 3; c++) {
          const inter = [...rows[r].set].filter((iso) => cols[c].set.has(iso));
          if (inter.length < minAnswers) { ok = false; break; }
          cells.push(inter);
        }
      }
      if (!ok || !fullyFillable(cells)) continue;
      const puzzle = {
        seed: String(seed), theme: theme.id, difficulty: diff.id,
        rows: rows.map((p) => p.cr.id), cols: cols.map((p) => p.cr.id),
        answers: cells,
      };
      puzzleCache.set(key, puzzle);
      if (puzzleCache.size > 500) puzzleCache.delete(puzzleCache.keys().next().value);
      return puzzle;
    }
    throw new Error('Could not generate puzzle for ' + key);
  }
  // what a client may see (no answers)
  const publicPuzzle = (p) => ({ seed: p.seed, theme: p.theme, difficulty: p.difficulty, rows: p.rows, cols: p.cols });

  // ---------- guessing ----------
  const entryCache = {};
  function entries(themeId) {
    if (entryCache[themeId]) return entryCache[themeId];
    const cap = THEMES[themeId].answer === 'capital';
    const list = countries.map((c) => ({
      iso: c.iso,
      label: cap ? c.capital : c.name,
      sub: cap ? c.name : '',
      flag: flagEmoji(c.iso),
      keys: (cap ? [c.capital, ...c.capAliases] : [c.name, ...c.aliases]).map(norm),
    }));
    list.sort((a, b) => a.label.localeCompare(b.label));
    return (entryCache[themeId] = list);
  }
  const MIN_SEARCH = 3;
  // Suggestions only appear after MIN_SEARCH letters (or an exact alias such as "UK"), so the list can't be browsed.
  function search(themeId, query) {
    const q = norm(query);
    const all = entries(themeId);
    if (!q) return [];
    const scored = [];
    for (const e of all) {
      let best = -1;
      for (const k of e.keys) {
        if (k === q) best = Math.max(best, 3);
        else if (q.length >= MIN_SEARCH && k.startsWith(q)) best = Math.max(best, 2);
        else if (q.length >= MIN_SEARCH && k.split(' ').some((w) => w.startsWith(q))) best = Math.max(best, 1);
      }
      if (best >= 0) scored.push([best, e]);
    }
    return scored.sort((a, b) => b[0] - a[0]).map((s) => s[1]);
  }
  const checkGuess = (puzzle, cell, iso) => !!puzzle.answers[cell] && puzzle.answers[cell].includes(iso);
  const answerLabels = (puzzle, cell) =>
    puzzle.answers[cell]
      .map((iso) => ({ pts: pickPoints(puzzle, cell, iso), label: THEMES[puzzle.theme].answer === 'capital' ? byIso[iso].capital : byIso[iso].name }))
      .sort((a, b) => b.pts - a.pts || a.label.localeCompare(b.label))
      .map((x) => `${x.label} · +${x.pts}`);

  // ---------- scoring ----------
  function completedLines(owned) {
    return LINES.filter((l) => l.every((i) => owned[i]));
  }
  function soloScore(cells) {
    const owned = cells.map(Boolean);
    const base = cells.reduce((s, c) => s + (c ? c.pts : 0), 0);
    const lines = completedLines(owned).length;
    const full = owned.every(Boolean);
    return { base, lines, full, total: base + lines * LINE_BONUS + (full ? FULL_BONUS : 0) };
  }
  function lineWinner(owners) {
    for (const l of LINES) {
      const o = owners[l[0]];
      if (o !== null && o !== undefined && l.every((i) => owners[i] === o)) return { owner: o, line: l };
    }
    return null;
  }

  const dailySeed = (date = new Date()) => 'daily-' + date.toISOString().slice(0, 10);

  return {
    countries, byIso, CRITERIA, THEMES, DIFFICULTIES, LINES, LINE_BONUS, FULL_BONUS, MAX_STRIKES,
    norm, flagEmoji, pickPoints, tierOf, MIN_SEARCH, buildPuzzle, publicPuzzle, entries, search, checkGuess,
    answerLabels, soloScore, completedLines, lineWinner, dailySeed, rngFor,
  };
});

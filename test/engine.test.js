const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../public/js/engine.js');

test('every theme/difficulty yields solvable grids with enough answers', () => {
  for (const theme of Object.keys(T.THEMES)) {
    for (const diff of Object.keys(T.DIFFICULTIES)) {
      for (let i = 0; i < 40; i++) {
        const p = T.buildPuzzle(`t${i}`, theme, diff);
        assert.equal(p.answers.length, 9);
        assert.equal(new Set([...p.rows, ...p.cols]).size, 6);
        p.answers.forEach((a, c) => {
          assert.ok(a.length >= 1, `${theme}/${diff}/${i} cell ${c} has no answer`);
          for (const iso of a) {
            assert.ok(T.CRITERIA[p.rows[Math.floor(c / 3)]].test(T.byIso[iso]));
            assert.ok(T.CRITERIA[p.cols[c % 3]].test(T.byIso[iso]));
          }
        });
      }
    }
  }
});

test('generation is deterministic per seed', () => {
  const a = T.buildPuzzle('same', 'classic', 'normal');
  const b = T.buildPuzzle('same', 'classic', 'normal');
  assert.deepEqual(a.rows, b.rows);
  assert.deepEqual(a.cols, b.cols);
  assert.notDeepEqual(T.buildPuzzle('other', 'classic', 'normal').rows.concat(), a.rows.concat().reverse());
});

test('points belong to the pick: obscure answers beat obvious ones', () => {
  const cell = (iso) => ({ answers: [['US', 'ZA', iso]] });
  const p = { answers: [['US', 'ZA', 'NR']] };
  assert.ok(T.pickPoints(p, 0, 'US') < T.pickPoints(p, 0, 'ZA'));
  assert.ok(T.pickPoints(p, 0, 'ZA') < T.pickPoints(p, 0, 'NR'));
  // fewer valid answers in the square -> bonus
  assert.ok(T.pickPoints({ answers: [['US']] }, 0, 'US') > T.pickPoints({ answers: [Array(20).fill('x')] }, 0, 'US'));
  assert.equal(T.tierOf(9), 'legendary');
  assert.equal(T.tierOf(1), 'common');
});

test('suggestions need three letters', () => {
  assert.equal(T.search('classic', '').length, 0);
  assert.equal(T.search('classic', 'ge').length, 0);
  assert.ok(T.search('classic', 'ger').some((e) => e.iso === 'DE'));
  assert.equal(T.search('classic', 'uk')[0].iso, 'GB'); // exact alias still works
});

test('search handles aliases, accents and prefixes', () => {
  assert.equal(T.search('classic', 'usa')[0].iso, 'US');
  assert.equal(T.search('classic', 'Türkiye')[0].iso, 'TR');
  assert.equal(T.search('classic', 'cote d ivoire')[0].iso, 'CI');
  assert.equal(T.search('classic', 'czech')[0].iso, 'CZ');
  assert.equal(T.search('capitals', 'brasilia')[0].iso, 'BR');
  assert.equal(T.search('capitals', 'new delhi')[0].iso, 'IN');
});

test('known facts hold', () => {
  const ok = (id, iso) => T.CRITERIA[id].test(T.byIso[iso]);
  assert.ok(ok('pop60', 'FR') && !ok('pop60', 'PL'));
  assert.ok(ok('wonder', 'PE') && !ok('wonder', 'FR'));
  assert.ok(ok('ns_G', 'GH') && !ok('ns_G', 'FR'));
  assert.ok(ok('landlocked', 'CH') && !ok('landlocked', 'ES'));
  assert.ok(ok('flag_cross', 'SE') && ok('flag_star', 'CN') && !ok('flag_noRed', 'JP'));
  assert.ok(ok('cs_B', 'DE')); // Berlin
});

test('lines and scoring', () => {
  assert.deepEqual(T.lineWinner([0, 0, 0, null, 1, 1, null, null, null]), { owner: 0, line: [0, 1, 2] });
  assert.equal(T.lineWinner(Array(9).fill(null)), null);
  const cells = Array(9).fill(null);
  [0, 1, 2].forEach((i) => (cells[i] = { iso: 'FR', pts: 4 }));
  const sc = T.soloScore(cells);
  assert.equal(sc.base, 12);
  assert.equal(sc.lines, 1);
  assert.equal(sc.total, 12 + T.LINE_BONUS);
  assert.equal(T.soloScore(Array(9).fill({ iso: 'FR', pts: 1 })).total, 9 + 8 * T.LINE_BONUS + T.FULL_BONUS);
});

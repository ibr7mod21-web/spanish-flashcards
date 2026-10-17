// Run: node tests/report.test.js
const assert = require('node:assert/strict');
const { buildReport } = require('../tools/progress_report.js');
const deck = require('../deck.json');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const NOW = Date.UTC(2026, 9, 18, 12);
const st = (o) => Object.assign({ box: 0, due: 0, seen: 1, correct: 0, close: 0, wrong: 0, lastWrongAnswers: [], lastSeen: 1, lastWrongAt: 0, recent: [], lastMissAt: 0 }, o);

const cards = {};
for (const c of deck.categories.find((x) => x.id === 'days').cards) cards[c.id] = st({ box: 4, correct: 3 });
cards['days-03'] = st({ box: 0, wrong: 2, correct: 1, lastWrongAnswers: ['miercole', 'martes'], recent: ['wrong'], lastMissAt: 500 });
cards['col-01'] = st({ box: 2, correct: 2, recent: ['correct'], disputed: [{ answer: 'colorada', date: '2026-10-17T09:00:00.000Z' }] });
cards['num-06'] = st({ box: 1, close: 1, recent: ['close'], lastMissAt: 900 });
const data = { exportedAt: '2026-10-18T08:00:00.000Z', cards };

console.log('progress_report.js');
const text = buildReport(data, deck, NOW);

test('header and box counts', () => {
  assert.match(text, /TRIDIOMA PROGRESS REPORT · 18 Oct 2026/);
  assert.match(text, /Not seen yet: 98/);
  assert.match(text, /Box 4 \(8 days\): 6/);
  assert.match(text, /Box 0 \(0 days\): 1/);
});

test('accuracy', () => {
  // correct 6×3 + 1 + 2 = 21, close 1, wrong 2 → 22 of 24
  assert.match(text, /92% right \(22 of 24 answers; 1 had only an accent\/ñ missing\)/);
});

test('mastered categories need every card at box 4+', () => {
  assert.match(text, /Mastered: none yet/); // Wednesday is back in box 0
  const allDays = Object.assign({}, cards, { 'days-03': st({ box: 5 }) });
  assert.match(buildReport({ cards: allDays }, deck, NOW), /Mastered: Days of the week/);
});

test('weakest cards: most recent miss first, with the wrong answers', () => {
  const w = text.slice(text.indexOf('20 WEAKEST'));
  assert.ok(w.indexOf('six → seis') < w.indexOf('Wednesday → miércoles'));
  assert.match(w, /Wednesday → miércoles .*wrote: miercole, martes/);
});

test('disputed answers listed with the card', () => {
  assert.match(text, /red → rojo \(also: colorado\): "colorada" \(17 Oct 2026\)/);
});

test('empty data still produces a report', () => {
  const t = buildReport({ cards: {} }, deck, NOW);
  assert.match(t, /No answers yet/);
  assert.match(t, /None — no recent misses\./);
});

test('never prints anything token-like', () => {
  assert.ok(!/github_pat_|ghp_|Bearer/i.test(text));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

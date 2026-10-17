// Run: node tests/scheduler.test.js
const assert = require('node:assert/strict');
const S = require('../scheduler.js');
const { pickVoice } = require('../feedback.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const NOW = new Date(2026, 9, 17, 15, 30).getTime(); // 17 Oct 2026, 15:30 local
const TODAY = new Date(2026, 9, 17).getTime();
const DAY = S.DAY;

function cat(id, n) {
  return { id, name: id, cards: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, en: 'x', es: 'y' })) };
}
function stats(box, due) { return Object.assign(S.newStats(), { box, due, seen: 1 }); }

console.log('scheduler.js');

test('new deck: up to newMax new cards, deck order', () => {
  const q = S.buildQueue([cat('a', 12)], {}, {}, NOW, 8);
  assert.deepEqual(q, ['a-0', 'a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6', 'a-7']);
});

test('default new-card limit is 10', () => {
  assert.equal(S.buildQueue([cat('a', 30)], {}, {}, NOW).length, 10);
});

test('New words per session: 5 / 10 / 15 / 20', () => {
  for (const n of [5, 10, 15, 20]) assert.equal(S.buildQueue([cat('a', 30)], {}, {}, NOW, n).length, n);
});

test('new-card limit still respects the 20-card session cap', () => {
  const c = cat('a', 40);
  const p = {};
  for (let i = 0; i < 12; i++) p[`a-${i}`] = stats(1, NOW - 1);
  const q = S.buildQueue([c], p, {}, NOW, 20);
  assert.equal(q.length, 20);
  assert.equal(q.filter((id) => !p[id]).length, 8);
});

test('due cards first, lowest box first, then new', () => {
  const c = cat('a', 5);
  const p = { 'a-0': stats(3, NOW - 1), 'a-1': stats(0, NOW - 1), 'a-2': stats(1, NOW + DAY) };
  assert.deepEqual(S.buildQueue([c], p, {}, NOW), ['a-1', 'a-0', 'a-3', 'a-4']);
});

test('max 20 total: 15 due leaves room for 5 new', () => {
  const c = cat('a', 30);
  const p = {};
  for (let i = 0; i < 15; i++) p[`a-${i}`] = stats(1, NOW - 1);
  const q = S.buildQueue([c], p, {}, NOW);
  assert.equal(q.length, 20);
  assert.deepEqual(q.slice(15), ['a-15', 'a-16', 'a-17', 'a-18', 'a-19']);
});

test('25 due → 20 due, no new', () => {
  const c = cat('a', 30);
  const p = {};
  for (let i = 0; i < 25; i++) p[`a-${i}`] = stats(i % 3, NOW - 1);
  const q = S.buildQueue([c], p, {}, NOW);
  assert.equal(q.length, 20);
  assert.ok(q.every((id) => p[id]));
});

test('studied new cards get the new-card slots first', () => {
  const q = S.buildQueue([cat('a', 12)], {}, { 'a-10': 1, 'a-11': 1, 'a-3': 1 }, NOW, 8);
  assert.deepEqual(q.slice(0, 3), ['a-3', 'a-10', 'a-11']);
  assert.equal(q.length, 8);
});

test('studied flag ignored for cards already in progress', () => {
  const p = { 'a-0': stats(2, NOW + DAY) };
  const q = S.buildQueue([cat('a', 3)], p, { 'a-0': 1 }, NOW);
  assert.deepEqual(q, ['a-1', 'a-2']);
});

test('reviewAllQueue: only due, across categories, lowest box first', () => {
  const p = { 'a-0': stats(2, NOW - 1), 'b-1': stats(0, NOW - 5), 'b-0': stats(4, NOW + DAY) };
  assert.deepEqual(S.reviewAllQueue([cat('a', 2), cat('b', 2)], p, NOW), ['b-1', 'a-0']);
});

test('correct: box+1, due = start of today + interval', () => {
  const s = S.applyResult(stats(2, 0), 'correct', 'x', NOW);
  assert.equal(s.box, 3);
  assert.equal(s.due, TODAY + 4 * DAY);
  assert.equal(s.correct, 1);
  assert.equal(s.seen, 2);
  assert.equal(s.lastSeen, NOW);
});

test('first answer on a new card: box 1, due tomorrow', () => {
  const s = S.applyResult(undefined, 'correct', 'x', NOW);
  assert.equal(s.box, 1);
  assert.equal(s.due, TODAY + DAY);
});

test('close counts as a pass and increments close', () => {
  const s = S.applyResult(stats(0, 0), 'close', 'x', NOW);
  assert.equal(s.box, 1);
  assert.equal(s.close, 1);
  assert.equal(s.correct, 0);
});

test('box is capped at 5 (16 days)', () => {
  const s = S.applyResult(stats(5, 0), 'correct', 'x', NOW);
  assert.equal(s.box, 5);
  assert.equal(s.due, TODAY + 16 * DAY);
});

test('wrong: box 0, due now, keeps last 3 wrong answers', () => {
  let s = stats(4, 0);
  for (const a of ['uno', 'dos', ' tres ', 'cuatro']) s = S.applyResult(s, 'wrong', a, NOW);
  assert.equal(s.box, 0);
  assert.equal(s.due, NOW);
  assert.equal(s.wrong, 4);
  assert.equal(s.lastWrongAt, NOW);
  assert.deepEqual(s.lastWrongAnswers, ['cuatro', 'tres', 'dos']);
});

test('applyResult does not mutate the previous stats', () => {
  const prev = stats(1, 0);
  prev.lastWrongAnswers = ['a'];
  S.applyResult(prev, 'wrong', 'b', NOW);
  assert.equal(prev.box, 1);
  assert.deepEqual(prev.lastWrongAnswers, ['a']);
});

test('requeueIndex: 3–5 cards later, clamped to end', () => {
  assert.equal(S.requeueIndex(2, 20, () => 0), 6);
  assert.equal(S.requeueIndex(2, 20, () => 0.999), 8);
  assert.equal(S.requeueIndex(18, 20, () => 0.5), 20);
});

test('shuffle: same items, new array, input untouched', () => {
  const a = ['a', 'b', 'c', 'd', 'e'];
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const b = S.shuffle(a, rng);
  assert.notEqual(a, b);
  assert.deepEqual(a, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(b.slice().sort(), a);
  assert.notDeepEqual(b, a);
});

test('applyResult keeps the last 3 results, newest first', () => {
  let s;
  for (const r of ['correct', 'wrong', 'close', 'correct']) s = S.applyResult(s, r, 'x', NOW);
  assert.deepEqual(s.recent, ['correct', 'close', 'wrong']);
});

test('applyResult: lastMissAt set by CLOSE and WRONG, not CORRECT', () => {
  let s = S.applyResult(undefined, 'close', 'x', NOW - 5000);
  assert.equal(s.lastMissAt, NOW - 5000);
  s = S.applyResult(s, 'correct', 'x', NOW);
  assert.equal(s.lastMissAt, NOW - 5000);
  s = S.applyResult(s, 'wrong', 'x', NOW + 1);
  assert.equal(s.lastMissAt, NOW + 1);
});

console.log('weak words');

const st = (o) => Object.assign(S.newStats(), { seen: 1 }, o);

test('isWeak: wrong > 0 and box <= 1', () => {
  assert.equal(S.isWeak(st({ wrong: 1, box: 0 })), true);
  assert.equal(S.isWeak(st({ wrong: 2, box: 1 })), true);
  assert.equal(S.isWeak(st({ wrong: 1, box: 2 })), false);
});

test('isWeak: CLOSE or WRONG in the last 3 attempts', () => {
  assert.equal(S.isWeak(st({ box: 4, recent: ['correct', 'correct', 'close'] })), true);
  assert.equal(S.isWeak(st({ box: 3, wrong: 1, recent: ['correct', 'wrong'] })), true);
  assert.equal(S.isWeak(st({ box: 4, wrong: 3, recent: ['correct', 'correct', 'correct'] })), false);
});

test('isWeak: never seen or never missed → not weak', () => {
  assert.equal(S.isWeak(undefined), false);
  assert.equal(S.isWeak(st({ box: 1, correct: 1, recent: ['correct'] })), false);
});

test('isWeak works on old stats without `recent`', () => {
  const old = { box: 0, due: 0, seen: 2, correct: 1, close: 0, wrong: 1, lastWrongAnswers: ['x'], lastSeen: 1, lastWrongAt: 1 };
  assert.equal(S.isWeak(old), true);
});

test('weakQueue: most recent miss first, ignores due dates', () => {
  const p = {
    'a-0': st({ wrong: 1, box: 0, lastMissAt: 100, due: NOW + 9 * DAY }),
    'a-1': st({ box: 4, recent: ['close'], lastMissAt: 300, due: NOW + 9 * DAY }),
    'a-2': st({ box: 3, recent: ['correct'], correct: 1 }),        // not weak
    'b-0': st({ wrong: 1, box: 1, lastWrongAt: 200 }),             // old stats: falls back to lastWrongAt
  };
  assert.deepEqual(S.weakQueue([cat('a', 3), cat('b', 1)], p), ['a-1', 'b-0', 'a-0']);
});

test('weakQueue: max 20', () => {
  const p = {};
  for (let i = 0; i < 25; i++) p[`a-${i}`] = st({ wrong: 1, box: 0, lastMissAt: i });
  const q = S.weakQueue([cat('a', 25)], p);
  assert.equal(q.length, 20);
  assert.equal(q[0], 'a-24');
});

test('weakQueue: none → empty', () => {
  assert.deepEqual(S.weakQueue([cat('a', 3)], {}), []);
});

console.log('custom quiz');

test('customQueue: count from the selected categories only, no duplicates', () => {
  const q = S.customQueue([cat('a', 15), cat('b', 15)], 20);
  assert.equal(q.length, 20);
  assert.equal(new Set(q).size, 20);
  assert.ok(q.every((id) => /^[ab]-/.test(id)));
});

test('customQueue: includes cards that are not due', () => {
  // customQueue never looks at progress, so future-due cards are always eligible.
  const q = S.customQueue([cat('a', 3)], 'all');
  assert.deepEqual(q.slice().sort(), ['a-0', 'a-1', 'a-2']);
});

test('customQueue: count larger than available → all of them', () => {
  assert.equal(S.customQueue([cat('a', 7)], 30).length, 7);
});

test('customQueue: mixes categories (seeded)', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const q = S.customQueue([cat('a', 10), cat('b', 10)], 10, rng);
  assert.ok(q.some((id) => id.startsWith('a-')) && q.some((id) => id.startsWith('b-')));
});

console.log('practice rule');

test('practice CORRECT: counts, but box and due unchanged', () => {
  const prev = stats(3, TODAY + 4 * DAY);
  const s = S.applyResult(prev, 'correct', 'x', NOW, { practice: true });
  assert.equal(s.box, 3);
  assert.equal(s.due, TODAY + 4 * DAY);
  assert.equal(s.correct, 1);
  assert.equal(s.seen, 2);
  assert.deepEqual(s.recent, ['correct']);
});

test('practice CLOSE: counts as close and a miss, box and due unchanged', () => {
  const s = S.applyResult(stats(2, TODAY + DAY), 'close', 'x', NOW, { practice: true });
  assert.equal(s.box, 2);
  assert.equal(s.due, TODAY + DAY);
  assert.equal(s.close, 1);
  assert.equal(s.lastMissAt, NOW);
});

test('practice WRONG: still drops to box 0, due now, counts as a miss', () => {
  const s = S.applyResult(stats(4, TODAY + 8 * DAY), 'wrong', 'mal', NOW, { practice: true });
  assert.equal(s.box, 0);
  assert.equal(s.due, NOW);
  assert.equal(s.wrong, 1);
  assert.deepEqual(s.lastWrongAnswers, ['mal']);
  assert.equal(S.isWeak(s), true);
});

test('normal mode unchanged when practice is off', () => {
  assert.equal(S.applyResult(stats(3, 0), 'correct', 'x', NOW, { practice: false }).box, 4);
});

test('nextReviewDays: whole days to the earliest scheduled card', () => {
  const p = { 'a-0': stats(2, TODAY + 2 * DAY), 'a-1': stats(4, TODAY + 8 * DAY) };
  assert.equal(S.nextReviewDays([cat('a', 3)], p, NOW), 2);
  assert.equal(S.nextReviewDays([cat('a', 3)], { 'a-0': stats(1, TODAY + DAY) }, NOW), 1);
});

test('nextReviewDays: nothing seen → null', () => {
  assert.equal(S.nextReviewDays([cat('a', 3)], {}, NOW), null);
});

test('Practice anyway: up to 20 random cards from the category, due or not', () => {
  const p = {};
  for (let i = 0; i < 30; i++) p[`a-${i}`] = stats(3, TODAY + 4 * DAY);
  const q = S.customQueue([cat('a', 30)], S.SESSION_MAX);
  assert.equal(q.length, 20);
  assert.equal(new Set(q).size, 20);
});

console.log('disputed answers');

test('disputeResult: graded as CORRECT from the stats before the miss', () => {
  const before = stats(2, TODAY + DAY);
  const s = S.disputeResult(before, ' colorada ', NOW);
  assert.equal(s.box, 3);
  assert.equal(s.wrong, 0);
  assert.equal(s.correct, 1);
  assert.deepEqual(s.lastWrongAnswers, []);
  assert.deepEqual(s.disputed, [{ answer: 'colorada', date: new Date(NOW).toISOString() }]);
});

test('disputeResult in practice: counts as correct, box unchanged', () => {
  const s = S.disputeResult(stats(2, TODAY + DAY), 'x', NOW, { practice: true });
  assert.equal(s.box, 2);
  assert.equal(s.correct, 1);
});

test('disputeResult appends to earlier disputes', () => {
  let s = S.disputeResult(undefined, 'a', NOW);
  s = S.disputeResult(s, 'b', NOW + 1000);
  assert.deepEqual(s.disputed.map((d) => d.answer), ['a', 'b']);
});

test('collectDisputed: flat list with card ids, oldest first', () => {
  const p = {
    'col-01': Object.assign(stats(1, 0), { disputed: [{ answer: 'colorada', date: '2026-10-18T10:00:00.000Z' }] }),
    'fam-13': Object.assign(stats(1, 0), { disputed: [{ answer: 'marido', date: '2026-10-17T09:00:00.000Z' }] }),
    'num-01': stats(1, 0),
  };
  assert.deepEqual(S.collectDisputed(p), [
    { cardId: 'fam-13', answer: 'marido', date: '2026-10-17T09:00:00.000Z' },
    { cardId: 'col-01', answer: 'colorada', date: '2026-10-18T10:00:00.000Z' },
  ]);
  assert.deepEqual(S.collectDisputed({}), []);
});

console.log('feedback.js pickVoice');

const v = (name, lang, localService = true) => ({ name, lang, localService });

test('prefers es-MX over es-ES and es-US', () => {
  assert.equal(pickVoice([v('Mónica', 'es-ES'), v('US', 'es-US'), v('Paulina', 'es-MX')]).name, 'Paulina');
});
test('falls back to es-US, then es-419', () => {
  assert.equal(pickVoice([v('Mónica', 'es-ES'), v('US', 'es-US')]).name, 'US');
  assert.equal(pickVoice([v('Mónica', 'es-ES'), v('LatAm', 'es-419')]).name, 'LatAm');
});
test('falls back to any es-*', () => {
  assert.equal(pickVoice([v('Samantha', 'en-US'), v('Mónica', 'es-ES')]).name, 'Mónica');
});
test('handles underscore langs (es_MX) and on-device first', () => {
  assert.equal(pickVoice([v('cloud', 'es-MX', false), v('device', 'es_MX')]).name, 'device');
});
test('standard voice before Apple character voices (macOS/iOS list)', () => {
  const list = ['Eddy', 'Flo', 'Grandma', 'Rocko'].map((n) => v(`${n} (Spanish (Mexico))`, 'es-MX'))
    .concat([v('Mónica', 'es-ES'), v('Paulina', 'es-MX')]);
  assert.equal(pickVoice(list).name, 'Paulina');
});
test('Enhanced voice preferred over the compact one', () => {
  assert.equal(pickVoice([v('Paulina', 'es-MX'), v('Paulina (Enhanced)', 'es-MX')]).name, 'Paulina (Enhanced)');
});
test('only character voices → still picks an es-MX one', () => {
  assert.equal(pickVoice([v('Mónica', 'es-ES'), v('Flo (Spanish (Mexico))', 'es-MX')]).lang, 'es-MX');
});
test('no Spanish voice → null', () => {
  assert.equal(pickVoice([v('Samantha', 'en-US'), v('Estonian', 'et-EE')]), null);
  assert.equal(pickVoice([]), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

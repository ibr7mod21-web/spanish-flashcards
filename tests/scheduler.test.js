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

test('new deck: up to 8 new cards, deck order', () => {
  const q = S.buildQueue([cat('a', 12)], {}, {}, NOW);
  assert.deepEqual(q, ['a-0', 'a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6', 'a-7']);
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
  const q = S.buildQueue([cat('a', 12)], {}, { 'a-10': 1, 'a-11': 1, 'a-3': 1 }, NOW);
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

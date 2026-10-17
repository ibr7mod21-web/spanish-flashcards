// Run: node tests/deck.test.js
const assert = require('node:assert/strict');
const deck = require('../deck.json');
const { grade } = require('../grading.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const cards = deck.categories.flatMap((cat) => cat.cards.map((card) => ({ card, cat })));

console.log('deck.json');

test('has version, dialect and categories', () => {
  assert.equal(typeof deck.version, 'number');
  assert.equal(typeof deck.dialect, 'string');
  assert.ok(deck.categories.length > 0);
});

test('card ids are unique', () => {
  const seen = new Set();
  for (const { card } of cards) {
    assert.ok(!seen.has(card.id), `duplicate id ${card.id}`);
    seen.add(card.id);
  }
});

test('every card has id, en and es', () => {
  for (const { card } of cards) {
    for (const k of ['id', 'en', 'es']) assert.ok(typeof card[k] === 'string' && card[k], `${card.id || '?'} missing ${k}`);
    if (card.alt) assert.ok(Array.isArray(card.alt), `${card.id} alt must be an array`);
  }
});

test('every card has an Arabic translation in Arabic script', () => {
  for (const { card } of cards) {
    assert.ok(typeof card.ar === 'string' && /[؀-ۿ]/.test(card.ar), `${card.id} missing ar`);
  }
});

test('every card accepts its own answer and alts', () => {
  for (const { card, cat } of cards) {
    for (const form of [card.es].concat(card.alt || [])) {
      assert.equal(grade(form, card, cat.id).result, 'correct', `${card.id}: "${form}"`);
    }
  }
});

test('number cards accept their digits', () => {
  for (const { card, cat } of cards.filter((x) => x.cat.id === 'numbers')) {
    const n = String(parseInt(card.id.match(/(\d+)$/)[1], 10));
    assert.equal(grade(n, card, cat.id).result, 'correct', `${card.id}: "${n}"`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

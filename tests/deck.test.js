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

test('expected categories and card counts', () => {
  const counts = Object.fromEntries(deck.categories.map((c) => [c.id, c.cards.length]));
  assert.deepEqual(counts, { days: 7, numbers: 21, months: 12, colors: 11, family: 14, food: 22, verbs: 20 });
});

test('every published id still exists, in the same category (tests/known-ids.txt)', () => {
  const known = require('node:fs').readFileSync(require('node:path').join(__dirname, 'known-ids.txt'), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(' '));
  const where = Object.fromEntries(cards.map(({ card, cat }) => [card.id, cat.id]));
  for (const [catId, id] of known) assert.equal(where[id], catId, `${id} missing or moved (was in ${catId})`);
  const knownIds = new Set(known.map((k) => k[1]));
  const unlisted = cards.map((x) => x.card.id).filter((id) => !knownIds.has(id));
  assert.deepEqual(unlisted, [], 'add new ids to tests/known-ids.txt');
});

test('ids in each new category share a prefix', () => {
  const prefix = { colors: 'col-', family: 'fam-', food: 'food-', verbs: 'verb-' };
  for (const { card, cat } of cards) if (prefix[cat.id]) assert.ok(card.id.startsWith(prefix[cat.id]), card.id);
});

test('English prompts are unique (ambiguous words have a clarifier)', () => {
  const seen = new Map();
  for (const { card } of cards) {
    assert.ok(!seen.has(card.en), `"${card.en}" used by ${seen.get(card.en)} and ${card.id}`);
    seen.set(card.en, card.id);
  }
  const en = new Set(cards.map((x) => x.card.en));
  for (const w of ['orange (color)', 'orange (fruit)', 'fish (food)', 'cousin (male)', 'cousin (female)',
    'to be (identity, permanent)', 'to be (state, location)', 'to know (a fact)']) assert.ok(en.has(w), w);
});

test('alts from the spec are accepted', () => {
  const byEn = Object.fromEntries(cards.map((x) => [x.card.en, x]));
  const cases = [['orange (color)', 'anaranjado'], ['pink', 'rosado'], ['brown', 'café'], ['mother', 'mamá'],
    ['father', 'papá'], ['to drink', 'tomar']];
  for (const [en, ans] of cases) {
    const { card, cat } = byEn[en];
    assert.equal(grade(ans, card, cat.id).result, 'correct', `${en}: ${ans}`);
  }
  assert.equal(grade('papa', byEn.father.card, 'family').result, 'close');
});

test('Arabic-origin words show the Arabic root word', () => {
  const byEs = Object.fromEntries(cards.map((x) => [x.card.es, x.card]));
  assert.equal(byEs['azúcar'].ar, 'السكر');
  assert.equal(byEs['aceite'].ar, 'الزيت');
  assert.equal(byEs['arroz'].ar, 'الرز');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

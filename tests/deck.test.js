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
  assert.deepEqual(counts, {
    days: 7, numbers: 21, months: 12, colors: 11, family: 14, food: 22, verbs: 20,
    travel: 19, house: 19, health: 19, feelings: 18, time: 19, verbs2: 25, arabic: 25,
  });
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
  const prefix = { colors: 'col-', family: 'fam-', food: 'food-', verbs: 'verb-', travel: 'trav-', house: 'house-',
    health: 'hlth-', feelings: 'feel-', time: 'time-', verbs2: 'verb2-', arabic: 'arab-' };
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
    ['father', 'papá'], ['to drink', 'tomar'], ['red', 'colorado'], ['purple', 'violeta'], ['purple', 'púrpura'],
    ['husband', 'marido']];
  for (const [en, ans] of cases) {
    const { card, cat } = byEn[en];
    assert.equal(grade(ans, card, cat.id).result, 'correct', `${en}: ${ans}`);
  }
  assert.equal(grade('papa', byEn.father.card, 'family').result, 'close');
});

test('existing alts are kept', () => {
  const alts = Object.fromEntries(cards.map((x) => [x.card.id, x.card.alt || []]));
  const keep = { 'num-01': ['un', 'una'], 'num-16': ['diez y seis'], 'mon-09': ['setiembre'], 'col-08': ['anaranjado'],
    'col-09': ['rosado'], 'col-11': ['café'], 'fam-01': ['mamá'], 'fam-02': ['papá'], 'verb-14': ['tomar'] };
  for (const [id, want] of Object.entries(keep)) for (const w of want) assert.ok(alts[id].includes(w), `${id} lost alt ${w}`);
});

test('an alt never equals another card\'s answer in the same category', () => {
  for (const cat of deck.categories) {
    const main = new Map(cat.cards.map((c) => [c.es, c.id]));
    for (const c of cat.cards) for (const a of c.alt || []) {
      assert.ok(!main.has(a) || main.get(a) === c.id, `${c.id} alt "${a}" is ${main.get(a)}'s answer`);
    }
  }
});

test('Arabic-origin words show the Arabic root word', () => {
  const byEs = Object.fromEntries(cards.map((x) => [x.card.es, x.card]));
  assert.equal(byEs['azúcar'].ar, 'السكر');
  assert.equal(byEs['aceite'].ar, 'الزيت');
  assert.equal(byEs['arroz'].ar, 'الرز');
});

test('new categories: alts from the spec are accepted', () => {
  const byEn = Object.fromEntries(cards.map((x) => [x.card.en, x]));
  const cases = [
    ['ticket', 'pasaje'], ['reservation', 'reserva'], ['to rent', 'rentar'],
    ['bedroom', 'cuarto'], ['bedroom', 'recámara'], ['floor (ground)', 'suelo'], ['refrigerator', 'nevera'],
    ['refrigerator', 'refrigeradora'], ['rent (payment)', 'alquiler'],
    ['doctor', 'doctor'], ['medicine', 'medicamento'], ['healthy', 'saludable'],
    ['happy', 'contento'], ['lazy', 'flojo'], ['funny', 'chistoso'],
    ['the day before yesterday', 'antier'], ['often', 'seguido'], ['still / yet', 'aún'], ['later', 'luego'],
    ['next year', 'el año que viene'],
    ['to remember', 'acordarse'], ['to try', 'tratar'], ['to choose', 'escoger'], ['to begin', 'comenzar'],
    ['to finish', 'acabar'], ['to answer', 'responder'],
  ];
  for (const [en, ans] of cases) {
    const { card, cat } = byEn[en];
    assert.equal(grade(ans, card, cat.id).result, 'correct', `${en}: ${ans}`);
  }
});

test('adjectives also accept the feminine form', () => {
  const byEn = Object.fromEntries(cards.map((x) => [x.card.en, x]));
  const fem = {
    sick: 'enferma', healthy: 'sana', happy: 'contenta', tired: 'cansada', angry: 'enojada', worried: 'preocupada',
    nervous: 'nerviosa', bored: 'aburrida', scared: 'asustada', proud: 'orgullosa', lazy: 'perezosa',
    hardworking: 'trabajadora', shy: 'tímida', funny: 'graciosa', jealous: 'celosa', surprised: 'sorprendida', calm: 'tranquila',
  };
  for (const [en, f] of Object.entries(fem)) {
    const { card, cat } = byEn[en];
    assert.equal(grade(f, card, cat.id).result, 'correct', `${en}: ${f}`);
  }
  // also the feminine of an alt
  assert.equal(grade('floja', byEn.lazy.card, 'feelings').result, 'correct');
  assert.equal(grade('chistosa', byEn.funny.card, 'feelings').result, 'correct');
});

test('every feelings card that is an -o adjective has its -a form', () => {
  for (const c of deck.categories.find((x) => x.id === 'feelings').cards) {
    for (const form of [c.es].concat(c.alt || [])) {
      if (/o$/.test(form)) assert.ok((c.alt || []).includes(form.replace(/o$/, 'a')), `${c.id} ${form} has no feminine alt`);
    }
  }
});

test('Arabic origins: "ar" is the Arabic source word, labelled "From Arabic:"', () => {
  const cat = deck.categories.find((x) => x.id === 'arabic');
  assert.equal(cat.arLabel, 'From Arabic:');
  const src = Object.fromEntries(cat.cards.map((c) => [c.es, c.ar]));
  assert.equal(src['aceituna'], 'الزيتونة');
  assert.equal(src['alcalde'], 'القاضي');
  assert.equal(src['ojalá'], 'لو شاء الله');
  assert.equal(src['alquiler'], 'الكراء');
  assert.equal(cat.cards.length, 25);
  // only this category has a label
  assert.deepEqual(deck.categories.filter((x) => x.arLabel).map((x) => x.id), ['arabic']);
});

test('no new card repeats a Spanish word that was already in the deck', () => {
  const OLD = ['days', 'numbers', 'months', 'colors', 'family', 'food', 'verbs'];
  const bare = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const old = new Set(cards.filter((x) => OLD.includes(x.cat.id)).flatMap((x) => [x.card.es].concat(x.card.alt || [])).map(bare));
  for (const { card, cat } of cards) {
    if (OLD.includes(cat.id)) continue;
    assert.ok(!old.has(bare(card.es)), `${card.id} ${card.es} already in the deck`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
